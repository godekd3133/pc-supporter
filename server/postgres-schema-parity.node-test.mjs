import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { effectiveSchema, normalizedSql, postgresSchemaContractFromSql } from "./postgres-schema-parser.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function extractOwnerSessionResourceTypes(source) {
  const match = source.match(/export const OWNER_SESSION_RESOURCE_TYPES = \[([\s\S]*?)\] as const;/);
  assert.ok(match, "owner-session-contract.ts must expose a literal OWNER_SESSION_RESOURCE_TYPES tuple");
  const resourceTypes = [...match[1].matchAll(/"([a-z-]+)"/g)].map((item) => item[1]);
  assert.ok(resourceTypes.length > 0, "OWNER_SESSION_RESOURCE_TYPES must contain at least one resource kind");
  assert.equal(new Set(resourceTypes).size, resourceTypes.length, "OWNER_SESSION_RESOURCE_TYPES must not contain duplicates");
  return resourceTypes;
}

function extractRuntimeSchema(source, resourceTypes) {
  const marker = "export const POSTGRES_SCHEMA_SQL = `";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "repository.ts must declare POSTGRES_SCHEMA_SQL as a template literal");
  const bodyStart = start + marker.length;
  const end = source.indexOf("`;", bodyStart);
  assert.notEqual(end, -1, "POSTGRES_SCHEMA_SQL template literal must terminate");
  const sql = source.slice(bodyStart, end);
  const resourceTypesToken = "${OWNER_SESSION_RESOURCE_TYPES_SQL}";
  assert.equal(sql.split(resourceTypesToken).length - 1, 1, "POSTGRES_SCHEMA_SQL must include the shared owner-session resource check exactly once");
  const resourceTypesSql = resourceTypes.map((resourceType) => `'${resourceType.replaceAll("'", "''")}'`).join(", ");
  return sql.replace(resourceTypesToken, resourceTypesSql);
}

test("baseline schema matches the effective runtime DDL without importing server code", async () => {
  const [repositorySource, contractSource, baseline] = await Promise.all([
    readFile(resolve(ROOT, "server/repository.ts"), "utf8"),
    readFile(resolve(ROOT, "shared/owner-session-contract.ts"), "utf8"),
    readFile(resolve(ROOT, "db/schema.sql"), "utf8")
  ]);
  const runtimeSchema = extractRuntimeSchema(repositorySource, extractOwnerSessionResourceTypes(contractSource));
  const expected = effectiveSchema(runtimeSchema);
  const actual = effectiveSchema(baseline);
  assert.deepEqual(actual, expected, "db/schema.sql must describe the same tables, columns, constraints, and indexes as POSTGRES_SCHEMA_SQL");

  const contract = postgresSchemaContractFromSql(baseline);
  const declaredColumnNames = [...actual.tables.entries()].flatMap(([tableName, declarations]) => declarations.flatMap((declaration) => {
    const body = declaration.replace(/^CONSTRAINT\s+(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+/i, "");
    if (/^(?:PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)\b/i.test(body)) return [];
    const match = body.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+/);
    assert.ok(match, `schema contract parser must recognize ${tableName} column declaration`);
    return [`${tableName}\0${match[1].toLowerCase()}`];
  })).sort();
  assert.deepEqual(
    contract.columns.map((column) => `${column.tableName}\0${column.columnName}`).sort(),
    declaredColumnNames,
    "runtime schema contract must cover every canonical CREATE/ALTER column"
  );
  assert.deepEqual(contract.tables, [...actual.tables.keys()].sort(), "runtime schema contract must cover every canonical table");
  for (const [tableName, constraintType, columns] of [
    ["saved_builds", "PRIMARY KEY", ["id"]],
    ["api_rate_limit_buckets", "PRIMARY KEY", ["scope", "client_key_hash"]],
    ["owner_session_grants", "PRIMARY KEY", ["session_hash", "resource_type", "resource_id", "owner_token_hash"]]
  ]) {
    assert.ok(contract.keyConstraints.some((constraint) => constraint.tableName === tableName && constraint.constraintType === constraintType && JSON.stringify(constraint.columns) === JSON.stringify(columns)), `${tableName} ${constraintType} conflict columns must match the canonical order`);
  }
  for (const [tableName, columnName, dataType, nullable] of [
    ["catalog_spec_overrides", "payload", "jsonb", false],
    ["m2_slot_overrides", "payload", "jsonb", false],
    ["saved_builds", "my_pc_at", "timestamp with time zone", true]
  ]) {
    assert.ok(contract.columns.some((column) => column.tableName === tableName && column.columnName === columnName && column.dataType === dataType && column.nullable === nullable), `${tableName}.${columnName} type/nullability contract must be present`);
  }

  const requiredTablesAndColumns = [
    ["saved_builds", "my_pc_at TIMESTAMPTZ"],
    ["saved_budget_ladders", "id TEXT PRIMARY KEY"],
    ["saved_generator_variants", "id TEXT PRIMARY KEY"]
  ];
  for (const [tableName, declaration] of requiredTablesAndColumns) {
    assert.ok(actual.tables.get(tableName)?.includes(declaration), `db/schema.sql is missing ${tableName}.${declaration}`);
  }

  for (const expectedIndex of [
    "CREATE INDEX IF NOT EXISTS owner_sessions_expiry_idx ON owner_sessions(expires_at)",
    "CREATE INDEX IF NOT EXISTS owner_session_grants_session_expiry_idx ON owner_session_grants(session_hash, expires_at)",
    "CREATE INDEX IF NOT EXISTS owner_session_grants_resource_idx ON owner_session_grants(resource_type, resource_id)",
    "CREATE INDEX IF NOT EXISTS owner_session_grants_expiry_idx ON owner_session_grants(expires_at) WHERE expires_at IS NOT NULL"
  ]) {
    assert.ok(actual.indexes.includes(normalizedSql(expectedIndex)), `db/schema.sql is missing ${expectedIndex}`);
  }
  assert.ok(actual.tables.has("owner_sessions"), "db/schema.sql is missing owner_sessions");
  assert.ok(actual.tables.has("owner_session_grants"), "db/schema.sql is missing owner_session_grants");
});
