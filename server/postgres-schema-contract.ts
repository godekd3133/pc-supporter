import type { PoolClient, QueryResultRow } from "pg";
import { postgresSchemaContractFromSql } from "./postgres-schema-parser.mjs";
import type { PostgresSchemaContractManifest } from "./postgres-schema-parser.mjs";

export const POSTGRES_SCHEMA_VERSION = 1;
export const POSTGRES_SCHEMA_SHA256 = "95e0fc5b0b63ef7d1d308d3b7b4575616c3b1584a5a6d755a32378ef2f48f6f7";
export const POSTGRES_SCHEMA_ADVISORY_LOCK = "pc-supporter:postgres-schema";
export const POSTGRES_SCHEMA_REVISION_TABLE = "pc_supporter_schema_revision";

export const POSTGRES_SCHEMA_REVISION_DDL = `CREATE TABLE IF NOT EXISTS pc_supporter_schema_revision (
  singleton_id TEXT PRIMARY KEY CHECK (singleton_id = 'current'),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  schema_sha256 TEXT NOT NULL CHECK (schema_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
)`;

export type PostgresSchemaClient = Pick<PoolClient, "query">;
export type PostgresSchemaMigrationOutcome = "applied" | "already-current";
export type PostgresSchemaInitializationMode = "production-read-only" | "development-auto";

export function postgresSchemaInitializationModeForNodeEnv(nodeEnv: string | undefined): PostgresSchemaInitializationMode {
  return nodeEnv === "production" ? "production-read-only" : "development-auto";
}

export class PostgresSchemaContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresSchemaContractError";
  }
}

async function inSchemaTransaction<T>(client: PostgresSchemaClient, lockMode: "exclusive" | "shared", operation: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  let transactionStarted = true;
  try {
    const lockFunction = lockMode === "exclusive" ? "pg_advisory_xact_lock" : "pg_advisory_xact_lock_shared";
    await client.query(`SELECT ${lockFunction}(hashtextextended($1, 0))`, [POSTGRES_SCHEMA_ADVISORY_LOCK]);
    const result = await operation();
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error: unknown) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The caller discards this client when the schema operation fails.
      }
    }
    throw error;
  }
}

async function schemaRevisionRow(client: PostgresSchemaClient) {
  const result = await client.query<QueryResultRow & { schema_version: number | string; schema_sha256: string }>(
    `SELECT schema_version, schema_sha256
     FROM ${POSTGRES_SCHEMA_REVISION_TABLE}
     WHERE singleton_id = 'current'`
  );
  if (result.rows.length > 1) throw new PostgresSchemaContractError("PostgreSQL schema revision ledger has multiple current rows.");
  return result.rows[0];
}

function assertCurrentRevision(row: { schema_version: number | string; schema_sha256: string } | undefined) {
  if (!row) throw new PostgresSchemaContractError("PostgreSQL schema revision is not installed; run npm run db:migrate before starting production services.");
  if (Number(row.schema_version) !== POSTGRES_SCHEMA_VERSION) {
    throw new PostgresSchemaContractError(`PostgreSQL schema version mismatch; expected ${POSTGRES_SCHEMA_VERSION}.`);
  }
  if (row.schema_sha256 !== POSTGRES_SCHEMA_SHA256) {
    throw new PostgresSchemaContractError("PostgreSQL schema checksum mismatch; refusing to start with an unverified schema.");
  }
}

function keyConstraintSignatures(constraints: PostgresSchemaContractManifest["keyConstraints"]) {
  return constraints.map((constraint) => `${constraint.tableName}\0${constraint.constraintType}\0${constraint.columns.join("\0")}`).sort();
}

async function assertSchemaShape(client: PostgresSchemaClient, schemaSql: string) {
  const contract = postgresSchemaContractFromSql(schemaSql);
  const columnsResult = await client.query<QueryResultRow & { table_name: string; column_name: string; data_type: string; is_nullable: string }>(
    `SELECT table_name, column_name
            , data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = ANY($1::text[])`,
    [contract.tables]
  );
  const expectedColumns = new Map(contract.columns.map((column) => [`${column.tableName}\0${column.columnName}`, column]));
  const actualColumns = new Map(columnsResult.rows.map((row) => [`${row.table_name}\0${row.column_name}`, row]));
  const missingColumns = [...expectedColumns.keys()].filter((key) => !actualColumns.has(key));
  if (missingColumns.length > 0) throw new PostgresSchemaContractError(`PostgreSQL schema is missing required columns: ${missingColumns.map((key) => key.replace("\0", ".")).join(", ")}.`);
  for (const [key, expected] of expectedColumns) {
    const actual = actualColumns.get(key)!;
    if (actual.data_type !== expected.dataType || (actual.is_nullable === "YES") !== expected.nullable) {
      throw new PostgresSchemaContractError(`PostgreSQL schema column ${expected.tableName}.${expected.columnName} has an incompatible type or nullability.`);
    }
  }
  const unexpectedColumns = [...actualColumns.keys()].filter((key) => !expectedColumns.has(key));
  if (unexpectedColumns.length > 0) throw new PostgresSchemaContractError(`PostgreSQL schema has unexpected columns: ${unexpectedColumns.map((key) => key.replace("\0", ".")).join(", ")}.`);

  const indexResult = await client.query<QueryResultRow & { table_name: string; index_name: string; is_unique: boolean; column_name: string | null; key_order: number }>(
    `SELECT table_relation.relname AS table_name,
            index_relation.relname AS index_name,
            index_data.indisunique AS is_unique,
            attribute.attname AS column_name,
            index_key.ordinality AS key_order
     FROM pg_catalog.pg_index AS index_data
     JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_data.indexrelid
     JOIN pg_catalog.pg_class AS table_relation ON table_relation.oid = index_data.indrelid
     JOIN pg_catalog.pg_namespace AS table_namespace ON table_namespace.oid = table_relation.relnamespace
     CROSS JOIN LATERAL unnest(index_data.indkey::smallint[]) WITH ORDINALITY AS index_key(attnum, ordinality)
     LEFT JOIN pg_catalog.pg_attribute AS attribute
       ON attribute.attrelid = table_relation.oid AND attribute.attnum = index_key.attnum
     WHERE table_namespace.nspname = current_schema()
       AND table_relation.relname = ANY($1::text[])
       AND index_key.ordinality <= index_data.indnkeyatts
     ORDER BY table_relation.relname, index_relation.relname, index_key.ordinality`,
    [contract.tables]
  );
  const actualIndexes = new Map<string, { tableName: string; unique: boolean; keyColumns: Array<string | null> }>();
  for (const row of indexResult.rows) {
    const index = actualIndexes.get(row.index_name) ?? { tableName: row.table_name, unique: row.is_unique, keyColumns: [] };
    index.keyColumns[Number(row.key_order) - 1] = row.column_name;
    actualIndexes.set(row.index_name, index);
  }
  for (const expected of contract.indexes) {
    const actual = actualIndexes.get(expected.indexName);
    if (!actual || actual.tableName !== expected.tableName || actual.unique !== expected.unique
      || actual.keyColumns.length !== expected.keyColumns.length
      || actual.keyColumns.some((column, index) => column !== expected.keyColumns[index])) {
      throw new PostgresSchemaContractError(`PostgreSQL index ${expected.indexName} does not match the canonical table, uniqueness, or key-column contract.`);
    }
  }

  const constraintResult = await client.query<QueryResultRow & { table_name: string; constraint_name: string; constraint_type: string; column_name: string | null; column_order: number | null }>(
    `SELECT table_relation.relname AS table_name,
            constraint_data.conname AS constraint_name,
            CASE constraint_data.contype
              WHEN 'p' THEN 'PRIMARY KEY'
              WHEN 'u' THEN 'UNIQUE'
              WHEN 'c' THEN 'CHECK'
              WHEN 'f' THEN 'FOREIGN KEY'
            END AS constraint_type,
            attribute.attname AS column_name,
            constraint_key.ordinality AS column_order
     FROM pg_catalog.pg_constraint AS constraint_data
     JOIN pg_catalog.pg_class AS table_relation ON table_relation.oid = constraint_data.conrelid
     JOIN pg_catalog.pg_namespace AS table_namespace ON table_namespace.oid = table_relation.relnamespace
     LEFT JOIN LATERAL unnest(constraint_data.conkey) WITH ORDINALITY AS constraint_key(attnum, ordinality) ON true
     LEFT JOIN pg_catalog.pg_attribute AS attribute
       ON attribute.attrelid = table_relation.oid AND attribute.attnum = constraint_key.attnum
     WHERE table_namespace.nspname = current_schema()
       AND table_relation.relname = ANY($1::text[])
       AND constraint_data.contype IN ('p', 'u', 'c', 'f')
     ORDER BY table_relation.relname, constraint_data.conname, constraint_key.ordinality`,
    [contract.tables]
  );
  const actualKeyGroups = new Map<string, { tableName: string; constraintType: "PRIMARY KEY" | "UNIQUE"; columns: string[] }>();
  const actualCounted = new Map<string, number>();
  for (const row of constraintResult.rows) {
    if (row.constraint_type === "CHECK" || row.constraint_type === "FOREIGN KEY") {
      const key = `${row.table_name}\0${row.constraint_type}\0${row.constraint_name}`;
      actualCounted.set(key, 1);
      continue;
    }
    if (row.constraint_type !== "PRIMARY KEY" && row.constraint_type !== "UNIQUE") continue;
    const groupKey = `${row.table_name}\0${row.constraint_type}\0${row.constraint_name}`;
    const group = actualKeyGroups.get(groupKey) ?? { tableName: row.table_name, constraintType: row.constraint_type, columns: [] };
    if (row.column_name !== null && row.column_order !== null) group.columns[Number(row.column_order) - 1] = row.column_name;
    actualKeyGroups.set(groupKey, group);
  }
  if (JSON.stringify(keyConstraintSignatures(contract.keyConstraints)) !== JSON.stringify(keyConstraintSignatures([...actualKeyGroups.values()]))) {
    throw new PostgresSchemaContractError("PostgreSQL primary-key or unique-constraint columns do not match the canonical ordered keys.");
  }
  const actualCountedConstraints = [...actualCounted.entries()].reduce<Array<{ tableName: string; constraintType: string; count: number }>>((items, [key]) => {
    const [tableName, constraintType] = key.split("\0");
    const existing = items.find((item) => item.tableName === tableName && item.constraintType === constraintType);
    if (existing) existing.count += 1;
    else items.push({ tableName, constraintType, count: 1 });
    return items;
  }, []).sort((left, right) => left.tableName.localeCompare(right.tableName) || left.constraintType.localeCompare(right.constraintType));
  if (JSON.stringify(actualCountedConstraints) !== JSON.stringify(contract.countedConstraints)) {
    throw new PostgresSchemaContractError("PostgreSQL CHECK or FOREIGN KEY constraint counts do not match the canonical schema contract.");
  }
}

export async function validatePostgresSchemaWithClient(client: PostgresSchemaClient, schemaSql: string) {
  return inSchemaTransaction(client, "shared", async () => {
    const revision = await schemaRevisionRow(client);
    assertCurrentRevision(revision);
    await assertSchemaShape(client, schemaSql);
    return { schemaVersion: POSTGRES_SCHEMA_VERSION, schemaSha256: POSTGRES_SCHEMA_SHA256 };
  });
}

export async function initializePostgresSchemaWithClient(
  client: PostgresSchemaClient,
  mode: PostgresSchemaInitializationMode,
  developmentBootstrapSql: string
) {
  if (mode === "production-read-only") return validatePostgresSchemaWithClient(client, developmentBootstrapSql);
  return inSchemaTransaction(client, "exclusive", async () => {
    await client.query(developmentBootstrapSql);
    return { schemaVersion: undefined, schemaSha256: undefined };
  });
}

export async function migratePostgresSchemaWithClient(
  client: PostgresSchemaClient,
  canonicalSchemaSql: string,
  canonicalSchemaSha256: string
): Promise<PostgresSchemaMigrationOutcome> {
  if (canonicalSchemaSha256 !== POSTGRES_SCHEMA_SHA256) {
    throw new PostgresSchemaContractError("Canonical db/schema.sql checksum does not match the application schema contract.");
  }

  return inSchemaTransaction(client, "exclusive", async () => {
    const relationResult = await client.query<QueryResultRow & { revision_table: string | null }>(
      "SELECT to_regclass($1)::text AS revision_table",
      [POSTGRES_SCHEMA_REVISION_TABLE]
    );
    if (!relationResult.rows[0]?.revision_table) await client.query(POSTGRES_SCHEMA_REVISION_DDL);

    const revision = await schemaRevisionRow(client);
    if (revision) {
      assertCurrentRevision(revision);
      await assertSchemaShape(client, canonicalSchemaSql);
      return "already-current";
    }

    await client.query(canonicalSchemaSql);
    await assertSchemaShape(client, canonicalSchemaSql);
    await client.query(
      `INSERT INTO ${POSTGRES_SCHEMA_REVISION_TABLE} (singleton_id, schema_version, schema_sha256, applied_at)
       VALUES ('current', $1, $2, statement_timestamp())`,
      [POSTGRES_SCHEMA_VERSION, POSTGRES_SCHEMA_SHA256]
    );
    return "applied";
  });
}
