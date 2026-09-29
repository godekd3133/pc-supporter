import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { postgresSchemaContractFromSql, type PostgresSchemaContractManifest } from "./postgres-schema-parser.mjs";
import {
  initializePostgresSchemaWithClient,
  migratePostgresSchemaWithClient,
  POSTGRES_SCHEMA_ADVISORY_LOCK,
  POSTGRES_SCHEMA_REVISION_TABLE,
  POSTGRES_SCHEMA_SHA256,
  POSTGRES_SCHEMA_VERSION,
  postgresSchemaInitializationModeForNodeEnv,
  validatePostgresSchemaWithClient
} from "./postgres-schema-contract";

type SchemaRevision = { schema_version: number; schema_sha256: string };
type ColumnShape = { data_type: string; is_nullable: string };
type SchemaState = {
  revisionTableExists: boolean;
  revision?: SchemaRevision;
  columns: Map<string, ColumnShape>;
  indexes: Map<string, PostgresSchemaContractManifest["indexes"][number]>;
  keyConstraints: PostgresSchemaContractManifest["keyConstraints"];
  countedConstraints: PostgresSchemaContractManifest["countedConstraints"];
};

let canonicalSchemaSql = "";
let canonicalSchemaContract: PostgresSchemaContractManifest;

function schemaColumnsMap(contract: PostgresSchemaContractManifest) {
  return new Map(contract.columns.map((column) => [
    `${column.tableName}\0${column.columnName}`,
    { data_type: column.dataType, is_nullable: column.nullable ? "YES" : "NO" }
  ]));
}

function schemaStateWithCanonicalShape(contract: PostgresSchemaContractManifest): SchemaState {
  return {
    revisionTableExists: true,
    columns: schemaColumnsMap(contract),
    indexes: new Map(contract.indexes.map((index) => [index.indexName, structuredClone(index)])),
    keyConstraints: structuredClone(contract.keyConstraints),
    countedConstraints: structuredClone(contract.countedConstraints)
  };
}

function cloneState(state: SchemaState): SchemaState {
  return {
    revisionTableExists: state.revisionTableExists,
    ...(state.revision ? { revision: { ...state.revision } } : {}),
    columns: new Map([...state.columns.entries()].map(([key, value]) => [key, { ...value }])),
    indexes: new Map([...state.indexes.entries()].map(([key, value]) => [key, structuredClone(value)])),
    keyConstraints: structuredClone(state.keyConstraints),
    countedConstraints: structuredClone(state.countedConstraints)
  };
}

class FakeSchemaClient {
  readonly queries: Array<{ sql: string; values?: unknown[] }> = [];
  state: SchemaState;
  failCanonicalSchema = false;
  corruptAfterSchema?: { tableName: string; columnName: string; dataType?: string; isNullable?: string };
  corruptKeyAfterSchema?: { tableName: string; constraintType: "PRIMARY KEY" | "UNIQUE"; columns: string[] };
  corruptIndexAfterSchema?: { indexName: string; tableName: string; unique: boolean; keyColumns: string[] };
  private transactionState: SchemaState | undefined;

  constructor(state: Partial<SchemaState> = {}) {
    const defaultState = schemaStateWithCanonicalShape(canonicalSchemaContract);
    defaultState.revisionTableExists = false;
    defaultState.columns.clear();
    defaultState.indexes.clear();
    defaultState.keyConstraints = [];
    defaultState.countedConstraints = [];
    this.state = { ...defaultState, ...state, columns: new Map(state.columns ?? []), indexes: new Map(state.indexes ?? []), keyConstraints: state.keyConstraints ?? [], countedConstraints: state.countedConstraints ?? [] };
  }

  asPoolClient() {
    return this as unknown as PoolClient;
  }

  async query(sql: string, values?: unknown[]) {
    this.queries.push({ sql, values });
    if (sql === "BEGIN") {
      this.transactionState = cloneState(this.state);
      return { rows: [] };
    }
    if (sql === "COMMIT") {
      if (!this.transactionState) throw new Error("No fake schema transaction is active.");
      this.state = this.transactionState;
      this.transactionState = undefined;
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      this.transactionState = undefined;
      return { rows: [] };
    }
    const state = this.transactionState;
    if (!state) throw new Error(`Schema SQL ran outside a fake transaction: ${sql.slice(0, 80)}`);
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.startsWith("SELECT to_regclass")) {
      return { rows: [{ revision_table: state.revisionTableExists ? POSTGRES_SCHEMA_REVISION_TABLE : null }] };
    }
    if (sql.startsWith("CREATE TABLE IF NOT EXISTS pc_supporter_schema_revision")) {
      state.revisionTableExists = true;
      return { rows: [] };
    }
    if (sql.startsWith("SELECT schema_version, schema_sha256")) {
      return { rows: state.revision ? [{ ...state.revision }] : [] };
    }
    if (sql.includes("FROM information_schema.columns")) {
      const tables = new Set(values?.[0] as string[]);
      const rows = [...state.columns.entries()].flatMap(([key, column]) => {
        const [table_name, column_name] = key.split("\0");
        return tables.has(table_name) ? [{ table_name, column_name, ...column }] : [];
      });
      return { rows };
    }
    if (sql.includes("FROM pg_catalog.pg_index")) {
      const tables = new Set(values?.[0] as string[]);
      const rows: Array<Record<string, unknown>> = [];
      for (const index of state.indexes.values()) {
        if (!tables.has(index.tableName)) continue;
        index.keyColumns.forEach((column_name, indexKey) => rows.push({
          table_name: index.tableName,
          index_name: index.indexName,
          is_unique: index.unique,
          column_name,
          key_order: indexKey + 1
        }));
      }
      return { rows };
    }
    if (sql.includes("FROM pg_catalog.pg_constraint")) {
      const rows: Array<Record<string, unknown>> = [];
      for (const [index, constraint] of state.keyConstraints.entries()) {
        constraint.columns.forEach((column_name, columnIndex) => rows.push({
          table_name: constraint.tableName,
          constraint_name: `key_constraint_${index}`,
          constraint_type: constraint.constraintType,
          column_name,
          column_order: columnIndex + 1
        }));
      }
      for (const constraint of state.countedConstraints) {
        for (let index = 0; index < constraint.count; index += 1) rows.push({
          table_name: constraint.tableName,
          constraint_name: `${constraint.constraintType}_${constraint.tableName}_${index}`,
          constraint_type: constraint.constraintType,
          column_name: null,
          column_order: null
        });
      }
      return { rows };
    }
    if (sql === canonicalSchemaSql) {
      if (this.failCanonicalSchema) throw new Error("Synthetic canonical DDL failure.");
      const canonicalState = schemaStateWithCanonicalShape(canonicalSchemaContract);
      state.revisionTableExists = true;
      state.columns = canonicalState.columns;
      state.indexes = canonicalState.indexes;
      state.keyConstraints = canonicalState.keyConstraints;
      state.countedConstraints = canonicalState.countedConstraints;
      if (this.corruptAfterSchema) {
        const key = `${this.corruptAfterSchema.tableName}\0${this.corruptAfterSchema.columnName}`;
        if (this.corruptAfterSchema.dataType === undefined && this.corruptAfterSchema.isNullable === undefined) state.columns.delete(key);
        else state.columns.set(key, {
          data_type: this.corruptAfterSchema.dataType ?? state.columns.get(key)?.data_type ?? "text",
          is_nullable: this.corruptAfterSchema.isNullable ?? state.columns.get(key)?.is_nullable ?? "YES"
        });
      }
      if (this.corruptKeyAfterSchema) {
        state.keyConstraints = state.keyConstraints.filter((constraint) => !(constraint.tableName === this.corruptKeyAfterSchema?.tableName && constraint.constraintType === this.corruptKeyAfterSchema.constraintType));
        state.keyConstraints.push({
          tableName: this.corruptKeyAfterSchema.tableName,
          constraintType: this.corruptKeyAfterSchema.constraintType,
          columns: [...this.corruptKeyAfterSchema.columns]
        });
      }
      if (this.corruptIndexAfterSchema) {
        state.indexes.set(this.corruptIndexAfterSchema.indexName, {
          ...this.corruptIndexAfterSchema,
          indexName: this.corruptIndexAfterSchema.indexName
        });
      }
      return { rows: [] };
    }
    if (sql.startsWith(`INSERT INTO ${POSTGRES_SCHEMA_REVISION_TABLE}`)) {
      state.revision = { schema_version: Number(values?.[0]), schema_sha256: String(values?.[1]) };
      return { rows: [] };
    }
    throw new Error(`Unexpected fake schema query: ${sql.slice(0, 100)}`);
  }
}

describe("PostgreSQL schema contract", () => {
  beforeAll(async () => {
    canonicalSchemaSql = await readFile(resolve(process.cwd(), "db/schema.sql"), "utf8");
    canonicalSchemaContract = postgresSchemaContractFromSql(canonicalSchemaSql);
  });

  it("pins the runtime contract checksum to the canonical baseline file", async () => {
    const bytes = await readFile(resolve(process.cwd(), "db/schema.sql"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(POSTGRES_SCHEMA_SHA256);
  });

  it("applies the full canonical schema and revision marker atomically to an unversioned database", async () => {
    const client = new FakeSchemaClient();

    const outcome = await migratePostgresSchemaWithClient(client.asPoolClient(), canonicalSchemaSql, POSTGRES_SCHEMA_SHA256);

    expect(outcome).toBe("applied");
    expect(client.state.revision).toEqual({ schema_version: POSTGRES_SCHEMA_VERSION, schema_sha256: POSTGRES_SCHEMA_SHA256 });
    expect(client.queries[0].sql).toBe("BEGIN");
    expect(client.queries.some(({ sql, values }) => sql.includes("pg_advisory_xact_lock") && values?.[0] === POSTGRES_SCHEMA_ADVISORY_LOCK)).toBe(true);
    expect(client.queries.some(({ sql }) => sql === canonicalSchemaSql)).toBe(true);
    expect(client.queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("replays an exact version/hash without executing DDL", async () => {
    const client = new FakeSchemaClient({
      revisionTableExists: true,
      revision: { schema_version: POSTGRES_SCHEMA_VERSION, schema_sha256: POSTGRES_SCHEMA_SHA256 },
      columns: schemaColumnsMap(canonicalSchemaContract),
      indexes: new Map(canonicalSchemaContract.indexes.map((index) => [index.indexName, structuredClone(index)])),
      keyConstraints: structuredClone(canonicalSchemaContract.keyConstraints),
      countedConstraints: structuredClone(canonicalSchemaContract.countedConstraints)
    });

    const outcome = await migratePostgresSchemaWithClient(client.asPoolClient(), canonicalSchemaSql, POSTGRES_SCHEMA_SHA256);

    expect(outcome).toBe("already-current");
    expect(client.queries.some(({ sql }) => sql === canonicalSchemaSql || sql.startsWith("CREATE TABLE"))).toBe(false);
    expect(client.queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("fails closed on a ledger version or checksum mismatch without applying canonical DDL", async () => {
    const client = new FakeSchemaClient({
      revisionTableExists: true,
      revision: { schema_version: POSTGRES_SCHEMA_VERSION, schema_sha256: "0".repeat(64) }
    });

    await expect(migratePostgresSchemaWithClient(client.asPoolClient(), canonicalSchemaSql, POSTGRES_SCHEMA_SHA256)).rejects.toThrow(/checksum mismatch/);

    expect(client.queries.some(({ sql }) => sql === canonicalSchemaSql)).toBe(false);
    expect(client.queries.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rolls back when an unversioned legacy table has a missing payload column", async () => {
    const client = new FakeSchemaClient({ revisionTableExists: true });
    client.corruptAfterSchema = { tableName: "catalog_spec_overrides", columnName: "payload" };

    await expect(migratePostgresSchemaWithClient(client.asPoolClient(), canonicalSchemaSql, POSTGRES_SCHEMA_SHA256)).rejects.toThrow(/catalog_spec_overrides.payload/);

    expect(client.state.revision).toBeUndefined();
    expect(client.queries.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rejects a legacy column with the wrong type and does not record the revision", async () => {
    const client = new FakeSchemaClient({ revisionTableExists: true });
    client.corruptAfterSchema = { tableName: "catalog_spec_overrides", columnName: "payload", dataType: "text" };

    await expect(migratePostgresSchemaWithClient(client.asPoolClient(), canonicalSchemaSql, POSTGRES_SCHEMA_SHA256)).rejects.toThrow(/catalog_spec_overrides.payload.*incompatible type/);

    expect(client.state.revision).toBeUndefined();
    expect(client.queries.some(({ sql }) => sql.startsWith(`INSERT INTO ${POSTGRES_SCHEMA_REVISION_TABLE}`))).toBe(false);
    expect(client.queries.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rejects a singleton table whose primary-key conflict target has the wrong column", async () => {
    const client = new FakeSchemaClient();
    client.corruptKeyAfterSchema = { tableName: "catalog_spec_overrides", constraintType: "PRIMARY KEY", columns: ["payload"] };

    await expect(migratePostgresSchemaWithClient(client.asPoolClient(), canonicalSchemaSql, POSTGRES_SCHEMA_SHA256)).rejects.toThrow(/primary-key or unique-constraint columns/);

    expect(client.state.revision).toBeUndefined();
    expect(client.queries.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rejects a canonical index with the wrong target, key, or uniqueness", async () => {
    const client = new FakeSchemaClient();
    client.corruptIndexAfterSchema = {
      indexName: "catalog_accessories_danawa_product_code_idx",
      tableName: "catalog_accessories",
      unique: false,
      keyColumns: ["category"]
    };

    await expect(migratePostgresSchemaWithClient(client.asPoolClient(), canonicalSchemaSql, POSTGRES_SCHEMA_SHA256)).rejects.toThrow(/canonical table, uniqueness, or key-column contract/);

    expect(client.state.revision).toBeUndefined();
    expect(client.queries.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("keeps production initialization read-only while dev/test retain startup schema bootstrap", async () => {
    const productionClient = new FakeSchemaClient({
      revisionTableExists: true,
      revision: { schema_version: POSTGRES_SCHEMA_VERSION, schema_sha256: POSTGRES_SCHEMA_SHA256 },
      columns: schemaColumnsMap(canonicalSchemaContract),
      indexes: new Map(canonicalSchemaContract.indexes.map((index) => [index.indexName, structuredClone(index)])),
      keyConstraints: structuredClone(canonicalSchemaContract.keyConstraints),
      countedConstraints: structuredClone(canonicalSchemaContract.countedConstraints)
    });
    await initializePostgresSchemaWithClient(productionClient.asPoolClient(), postgresSchemaInitializationModeForNodeEnv("production"), canonicalSchemaSql);
    expect(productionClient.queries.some(({ sql }) => /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
    expect(productionClient.queries.some(({ sql }) => sql.includes("pg_advisory_xact_lock_shared"))).toBe(true);

    const testClient = new FakeSchemaClient();
    await initializePostgresSchemaWithClient(testClient.asPoolClient(), postgresSchemaInitializationModeForNodeEnv("test"), canonicalSchemaSql);
    expect(testClient.queries.some(({ sql }) => sql === canonicalSchemaSql)).toBe(true);
    expect(testClient.queries.some(({ sql, values }) => sql.includes("pg_advisory_xact_lock") && values?.[0] === POSTGRES_SCHEMA_ADVISORY_LOCK)).toBe(true);
    expect(testClient.state.revision).toBeUndefined();
  });

  it("selects file mode from DATABASE_URL alone even when DATABASE_MIGRATION_URL is set", async () => {
    const keys = ["DATABASE_URL", "DATABASE_MIGRATION_URL", "DOTENV_CONFIG_PATH"] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]])) as Record<(typeof keys)[number], string | undefined>;
    try {
      delete process.env.DATABASE_URL;
      process.env.DATABASE_MIGRATION_URL = "postgres://migration-only.invalid/pc_supporter";
      process.env.DOTENV_CONFIG_PATH = "/dev/null";
      vi.resetModules();
      const repository = await import("./repository");
      await expect(repository.persistenceMode()).resolves.toBe("file");
      await expect(repository.initializePersistence()).resolves.toBeUndefined();
    } finally {
      for (const key of keys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      vi.resetModules();
    }
  });
});
