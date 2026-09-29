import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

function statementsFrom(sql) {
  const statements = [];
  let start = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (inSingleQuote) {
      if (char === "'" && sql[index + 1] === "'") index += 1;
      else if (char === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && sql[index + 1] === '"') index += 1;
      else if (char === '"') inDoubleQuote = false;
      continue;
    }
    if (char === "'") inSingleQuote = true;
    else if (char === '"') inDoubleQuote = true;
    else if (char === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const trailing = sql.slice(start).trim();
  if (trailing) statements.push(trailing);
  assert.equal(inSingleQuote, false, "SQL must not contain an unterminated string literal");
  assert.equal(inDoubleQuote, false, "SQL must not contain an unterminated quoted identifier");
  return statements;
}

function normalizedSql(sql) {
  let output = "";
  let pendingSpace = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (inSingleQuote) {
      output += char;
      if (char === "'" && sql[index + 1] === "'") output += sql[++index];
      else if (char === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      output += char;
      if (char === '"' && sql[index + 1] === '"') output += sql[++index];
      else if (char === '"') inDoubleQuote = false;
      continue;
    }
    if (/\s/.test(char)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && output && !/[\s(]/.test(output.at(-1)) && !/[),;]/.test(char)) output += " ";
    pendingSpace = false;
    output += char;
    if (char === "'") inSingleQuote = true;
    else if (char === '"') inDoubleQuote = true;
  }
  return output.trim();
}

function matchingCloseParen(source, openIndex) {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inSingleQuote) {
      if (char === "'" && source[index + 1] === "'") index += 1;
      else if (char === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && source[index + 1] === '"') index += 1;
      else if (char === '"') inDoubleQuote = false;
      continue;
    }
    if (char === "'") inSingleQuote = true;
    else if (char === '"') inDoubleQuote = true;
    else if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return index;
  }
  assert.fail("CREATE TABLE statement has unbalanced parentheses");
}

function splitTopLevel(source) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inSingleQuote) {
      if (char === "'" && source[index + 1] === "'") index += 1;
      else if (char === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && source[index + 1] === '"') index += 1;
      else if (char === '"') inDoubleQuote = false;
      continue;
    }
    if (char === "'") inSingleQuote = true;
    else if (char === '"') inDoubleQuote = true;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function effectiveSchema(sql) {
  const tables = new Map();
  const indexes = new Set();

  for (const statement of statementsFrom(sql)) {
    const tableMatch = statement.match(/^CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i);
    if (tableMatch) {
      const tableName = tableMatch[1].toLowerCase();
      const openIndex = statement.indexOf("(", tableMatch[0].length - 1);
      const closeIndex = matchingCloseParen(statement, openIndex);
      const declarations = splitTopLevel(statement.slice(openIndex + 1, closeIndex));
      const columns = tables.get(tableName) ?? new Set();
      for (const declaration of declarations) columns.add(normalizedSql(declaration));
      tables.set(tableName, columns);
      continue;
    }

    const alterMatch = statement.match(/^ALTER TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD COLUMN IF NOT EXISTS\s+([\s\S]+)$/i);
    if (alterMatch) {
      const tableName = alterMatch[1].toLowerCase();
      const columns = tables.get(tableName) ?? new Set();
      columns.add(normalizedSql(alterMatch[2]));
      tables.set(tableName, columns);
      continue;
    }

    if (/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+/i.test(statement)) {
      indexes.add(normalizedSql(statement));
      continue;
    }

    assert.fail(`Unrecognized PostgreSQL schema statement: ${statement.slice(0, 80)}`);
  }

  return {
    tables: new Map([...tables.entries()].map(([name, columns]) => [name, [...columns].sort()])),
    indexes: [...indexes].sort()
  };
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
