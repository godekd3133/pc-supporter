#!/usr/bin/env node

import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REVISION_TABLE = "pc_supporter_schema_revision";
const APP_DML_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"];
const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const TABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export function quotePostgresIdentifier(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 63 || value.includes("\0")) {
    throw new Error("PostgreSQL identifier is invalid.");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

export function quotePostgresLiteral(value) {
  if (typeof value !== "string" || /[\x00-\x1f\x7f]/.test(value)) throw new Error("PostgreSQL string value is invalid.");
  return `E'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

export function quotePostgresPasswordLiteral(value) {
  if (typeof value !== "string" || value.length < 32 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error("DATABASE_RUNTIME_PASSWORD must be at least 32 printable characters.");
  }
  return `E'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

export function runtimeRoleProvisioningSql(quotedRole, passwordLiteral, roleExists) {
  return roleExists
    ? `ALTER ROLE ${quotedRole} WITH LOGIN INHERIT PASSWORD ${passwordLiteral}`
    : `CREATE ROLE ${quotedRole} WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${passwordLiteral}`;
}

export function parseCanonicalRuntimeTableNames(schemaSql) {
  if (typeof schemaSql !== "string" || schemaSql.length === 0) throw new Error("Canonical PostgreSQL schema is empty.");
  const declarations = [...schemaSql.matchAll(/^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_$]*)\s*\(/gim)]
    .map((match) => match[1]);
  const createTableCount = [...schemaSql.matchAll(/^\s*CREATE\s+TABLE\b/gim)].length;
  if (declarations.length === 0 || declarations.length !== createTableCount
    || declarations.some((name) => !TABLE_NAME_PATTERN.test(name))
    || new Set(declarations).size !== declarations.length
    || declarations.filter((name) => name === REVISION_TABLE).length !== 1) {
    throw new Error("Canonical PostgreSQL table declarations are not safe to provision.");
  }
  const appTables = declarations.filter((name) => name !== REVISION_TABLE).sort();
  if (appTables.length === 0) throw new Error("Canonical PostgreSQL application tables are missing.");
  return { appTables, revisionTable: REVISION_TABLE };
}

export function readRuntimeBootstrapConfig(env = process.env) {
  const migrationUrl = env.DATABASE_MIGRATION_URL?.trim();
  const runtimeRole = env.DATABASE_RUNTIME_ROLE?.trim();
  const runtimePassword = env.DATABASE_RUNTIME_PASSWORD;
  if (!migrationUrl) throw new Error("DATABASE_MIGRATION_URL is required for runtime-role bootstrap.");
  let parsedUrl;
  try {
    parsedUrl = new URL(migrationUrl);
  } catch {
    throw new Error("DATABASE_MIGRATION_URL must be a valid PostgreSQL URL.");
  }
  if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_MIGRATION_URL must use the PostgreSQL protocol.");
  }
  if (!runtimeRole || !ROLE_NAME_PATTERN.test(runtimeRole)) {
    throw new Error("DATABASE_RUNTIME_ROLE must be a lowercase PostgreSQL role identifier of at most 63 characters.");
  }
  quotePostgresPasswordLiteral(runtimePassword);
  return { migrationUrl, runtimeRole, runtimePassword };
}

function safeSqlState(error) {
  if (error && typeof error === "object" && "code" in error && /^[0-9A-Z]{5}$/.test(String(error.code))) return String(error.code);
  return "unknown";
}

function postgresQualifiedName(schemaName, tableName) {
  return `${quotePostgresIdentifier(schemaName)}.${quotePostgresIdentifier(tableName)}`;
}

async function verifySchemaRevision(client, schemaName, schemaSha256) {
  const relation = postgresQualifiedName(schemaName, REVISION_TABLE);
  const result = await client.query(`SELECT schema_version, schema_sha256 FROM ${relation} WHERE singleton_id = 'current'`);
  if (result.rows.length !== 1 || Number(result.rows[0].schema_version) < 1 || result.rows[0].schema_sha256 !== schemaSha256) {
    throw new Error("PostgreSQL schema revision does not match db/schema.sql.");
  }
}

async function provisionRuntimeRole(client, schemaSql, schemaSha256, runtimeRole, runtimePassword) {
  const { appTables, revisionTable } = parseCanonicalRuntimeTableNames(schemaSql);
  const identifiers = [...appTables, revisionTable];
  const quotedRole = quotePostgresIdentifier(runtimeRole);
  const passwordLiteral = quotePostgresPasswordLiteral(runtimePassword);

  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["pc-supporter:postgres-runtime-role"]);
    const identity = await client.query(`
      SELECT current_database() AS database_name,
             current_user AS current_role,
             session_user AS session_role,
             current_schema() AS schema_name
    `);
    const current = identity.rows[0];
    if (!current?.database_name || !current.current_role || !current.session_role || !current.schema_name) {
      throw new Error("The migration connection has no current database schema.");
    }
    const schemaName = String(current.schema_name);
    if (runtimeRole === current.current_role || runtimeRole === current.session_role) {
      throw new Error("DATABASE_RUNTIME_ROLE must differ from the migration owner role.");
    }
    const quotedSchema = quotePostgresIdentifier(schemaName);

    const revisionExists = await client.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2 AND table_type = 'BASE TABLE') AS present",
      [schemaName, revisionTable]
    );
    if (revisionExists.rows[0]?.present !== true) throw new Error("PostgreSQL schema revision ledger is missing; run db:migrate first.");
    await verifySchemaRevision(client, schemaName, schemaSha256);

    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' AND table_name = ANY($2::text[])",
      [schemaName, identifiers]
    );
    const presentTables = new Set(tables.rows.map((row) => String(row.table_name)));
    const missingTables = identifiers.filter((name) => !presentTables.has(name));
    if (missingTables.length > 0) throw new Error("Canonical PostgreSQL application tables are missing; run db:migrate first.");

    const role = await client.query(
      "SELECT oid, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = $1",
      [runtimeRole]
    );
    const existingRole = role.rows[0];
    if (existingRole) {
      const memberships = await client.query(
        "SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = $1::oid LIMIT 1",
        [existingRole.oid]
      );
      if (memberships.rowCount) throw new Error("DATABASE_RUNTIME_ROLE has role memberships; remove them before provisioning.");
      if (existingRole.rolsuper || existingRole.rolcreatedb || existingRole.rolcreaterole || existingRole.rolreplication || existingRole.rolbypassrls) {
        throw new Error("DATABASE_RUNTIME_ROLE has elevated role attributes; remove them before provisioning.");
      }
    }

    const owners = await client.query(`
      SELECT owner_name FROM (
        SELECT pg_catalog.pg_get_userbyid(database_row.datdba) AS owner_name
        FROM pg_catalog.pg_database AS database_row
        WHERE database_row.datname = current_database()
        UNION
        SELECT pg_catalog.pg_get_userbyid(namespace_row.nspowner) AS owner_name
        FROM pg_catalog.pg_namespace AS namespace_row
        WHERE namespace_row.nspname = $1
        UNION
        SELECT pg_catalog.pg_get_userbyid(table_row.relowner) AS owner_name
        FROM pg_catalog.pg_class AS table_row
        JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
        WHERE namespace_row.nspname = $1
          AND table_row.relname = ANY($2::text[])
      ) AS object_owners
    `, [schemaName, identifiers]);
    if (owners.rows.some((row) => String(row.owner_name) === runtimeRole)) {
      throw new Error("DATABASE_RUNTIME_ROLE owns the database, schema, or a canonical table; use a separate DML role.");
    }

    await client.query(runtimeRoleProvisioningSql(quotedRole, passwordLiteral, Boolean(existingRole)));

    const databaseName = String(current.database_name);
    const quotedDatabase = quotePostgresIdentifier(databaseName);
    await client.query(`REVOKE ALL PRIVILEGES ON DATABASE ${quotedDatabase} FROM ${quotedRole}`);
    await client.query(`REVOKE TEMPORARY ON DATABASE ${quotedDatabase} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${quotedRole}`);
    await client.query(`REVOKE CREATE ON SCHEMA ${quotedSchema} FROM PUBLIC`);
    await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA ${quotedSchema} FROM ${quotedRole}`);
    await client.query(`GRANT USAGE ON SCHEMA ${quotedSchema} TO ${quotedRole}`);
    await client.query(`ALTER ROLE ${quotedRole} IN DATABASE ${quotedDatabase} SET search_path = ${quotePostgresLiteral(schemaName)}`);

    const columnGrants = await client.query(
      "SELECT table_name, column_name, privilege_type, grantee FROM information_schema.column_privileges WHERE table_schema = $1 AND table_name = ANY($2::text[]) AND grantee = ANY($3::text[])",
      [schemaName, identifiers, [runtimeRole, "PUBLIC"]]
    );
    for (const row of columnGrants.rows) {
      const privilege = String(row.privilege_type).toUpperCase();
      if (!["SELECT", "INSERT", "UPDATE", "REFERENCES"].includes(privilege)) throw new Error("Unexpected PostgreSQL column privilege was found.");
      const relation = postgresQualifiedName(schemaName, String(row.table_name));
      const column = quotePostgresIdentifier(String(row.column_name));
      const grantee = row.grantee === "PUBLIC" ? "PUBLIC" : quotePostgresIdentifier(runtimeRole);
      await client.query(`REVOKE ${privilege} (${column}) ON TABLE ${relation} FROM ${grantee}`);
    }

    for (const tableName of appTables) {
      const relation = postgresQualifiedName(schemaName, tableName);
      await client.query(`REVOKE ALL PRIVILEGES ON TABLE ${relation} FROM PUBLIC`);
      await client.query(`REVOKE ALL PRIVILEGES ON TABLE ${relation} FROM ${quotedRole}`);
      await client.query(`GRANT ${APP_DML_PRIVILEGES.join(", ")} ON TABLE ${relation} TO ${quotedRole}`);
    }
    const revisionRelation = postgresQualifiedName(schemaName, revisionTable);
    await client.query(`REVOKE ALL PRIVILEGES ON TABLE ${revisionRelation} FROM PUBLIC`);
    await client.query(`REVOKE ALL PRIVILEGES ON TABLE ${revisionRelation} FROM ${quotedRole}`);
    await client.query(`GRANT SELECT ON TABLE ${revisionRelation} TO ${quotedRole}`);

    const grantCheck = await client.query(`
      SELECT has_database_privilege($1, current_database(), 'CONNECT') AS can_connect,
             has_database_privilege($1, current_database(), 'TEMP') AS can_temp,
             has_schema_privilege($1, $2, 'USAGE') AS can_use_schema,
             has_schema_privilege($1, $2, 'CREATE') AS can_create_schema,
             has_table_privilege($1, $3, 'SELECT') AS can_read_revision,
             has_table_privilege($1, $3, 'INSERT') AS can_insert_revision,
             has_table_privilege($1, $3, 'UPDATE') AS can_update_revision,
             has_table_privilege($1, $3, 'DELETE') AS can_delete_revision,
             has_any_column_privilege($1, $3, 'INSERT') AS can_insert_revision_column,
             has_any_column_privilege($1, $3, 'UPDATE') AS can_update_revision_column,
             has_any_column_privilege($1, $3, 'REFERENCES') AS can_reference_revision_column
    `, [runtimeRole, schemaName, revisionRelation]);
    const grants = grantCheck.rows[0];
    if (grants?.can_connect !== true || grants.can_temp !== false || grants.can_use_schema !== true || grants.can_create_schema !== false
      || grants.can_read_revision !== true || grants.can_insert_revision !== false || grants.can_update_revision !== false || grants.can_delete_revision !== false
      || grants.can_insert_revision_column !== false || grants.can_update_revision_column !== false || grants.can_reference_revision_column !== false) {
      throw new Error("PostgreSQL runtime role has privileges outside the requested schema and ledger policy.");
    }

    const nonCanonicalPrivileges = await client.query(`
      SELECT relation.relname
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = relation.relnamespace
      WHERE namespace_row.nspname = $1
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'S')
        AND NOT (relation.relname = ANY($2::text[]))
        AND (
          CASE WHEN relation.relkind = 'S' THEN
            has_sequence_privilege($3, relation.oid, 'USAGE') OR has_sequence_privilege($3, relation.oid, 'SELECT') OR has_sequence_privilege($3, relation.oid, 'UPDATE')
          ELSE
            has_table_privilege($3, relation.oid, 'SELECT') OR has_table_privilege($3, relation.oid, 'INSERT')
            OR has_table_privilege($3, relation.oid, 'UPDATE') OR has_table_privilege($3, relation.oid, 'DELETE')
            OR has_table_privilege($3, relation.oid, 'TRUNCATE') OR has_table_privilege($3, relation.oid, 'REFERENCES')
            OR has_table_privilege($3, relation.oid, 'TRIGGER')
          END
        )
      LIMIT 1
    `, [schemaName, identifiers, runtimeRole]);
    if (nonCanonicalPrivileges.rowCount) throw new Error("DATABASE_RUNTIME_ROLE has privileges on non-canonical relations; remove them before provisioning.");

    await client.query("COMMIT");
    return { database: databaseName, role: runtimeRole, appTableCount: appTables.length, schema: schemaName };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Keep the bootstrap error sanitized. */ }
    throw error;
  }
}

export async function executePostgresRuntimeRoleBootstrap(dependencies = {}) {
  const config = readRuntimeBootstrapConfig(dependencies.env ?? process.env);
  let schemaBytes;
  try {
    schemaBytes = await (dependencies.readCanonicalSchema ?? (() => readFile(resolve(process.cwd(), "db/schema.sql"))))();
  } catch {
    throw new Error("Canonical db/schema.sql could not be read.");
  }
  const schemaSha256 = createHash("sha256").update(schemaBytes).digest("hex");
  let pool;
  try {
    pool = await (dependencies.createPool ?? (async (connectionString) => {
      const { Pool } = await import("pg");
      return new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000, keepAlive: true });
    }))(config.migrationUrl);
  } catch {
    throw new Error("PostgreSQL runtime-role bootstrap connection could not be created.");
  }

  let client;
  let releaseClient = false;
  try {
    client = await pool.connect();
    const result = await provisionRuntimeRole(client, Buffer.from(schemaBytes).toString("utf8"), schemaSha256, config.runtimeRole, config.runtimePassword);
    client.release();
    releaseClient = true;
    return { ok: true, ...result };
  } catch (error) {
    const wrapped = error instanceof Error && /^(DATABASE_RUNTIME_ROLE|Canonical|PostgreSQL schema|The migration|Canonical PostgreSQL)/.test(error.message)
      ? error
      : new Error(`PostgreSQL runtime-role bootstrap failed (SQLSTATE ${safeSqlState(error)}).`);
    if (client && !releaseClient) client.release(true);
    throw wrapped;
  } finally {
    try { await pool.end(); } catch { /* Keep pool details and credentials out of output. */ }
  }
}

export async function runPostgresRuntimeRoleBootstrap(dependencies = {}) {
  const writeStdout = dependencies.writeStdout ?? ((value) => process.stdout.write(value));
  const writeStderr = dependencies.writeStderr ?? ((value) => process.stderr.write(value));
  try {
    const result = await executePostgresRuntimeRoleBootstrap(dependencies);
    writeStdout(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    writeStderr(`${error instanceof Error ? error.message : "PostgreSQL runtime-role bootstrap failed."}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runPostgresRuntimeRoleBootstrap().then((exitCode) => { process.exitCode = exitCode; });
}
