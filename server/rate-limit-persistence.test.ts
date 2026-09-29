import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  POSTGRES_SCHEMA_REVISION_TABLE,
  POSTGRES_SCHEMA_SHA256,
  POSTGRES_SCHEMA_VERSION
} from "./postgres-schema-contract";
import { postgresSchemaContractFromSql } from "./postgres-schema-parser.mjs";
import type { PostgresSchemaContractManifest } from "./postgres-schema-parser.mjs";

const TEST_RATE_LIMIT_HMAC_SECRET = "rate-limit-test-key-".padEnd(64, "x");
const runtimeSchemaContract = postgresSchemaContractFromSql(readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8"));

const fakeDatabase = vi.hoisted(() => ({
  buckets: new Map<string, { startedAt: number; count: number; lastSeenAt: number }>(),
  queries: [] as Array<{ sql: string; values?: unknown[] }>,
  clientQueries: [] as Array<{ sql: string; values?: unknown[] }>,
  runtimeSchema: null as unknown,
  nowMs: 10_000,
  failRateLimitWrites: false
}));

vi.mock("pg", () => ({
  Pool: class {
    async query(sql: string, values?: unknown[]) {
      fakeDatabase.queries.push({ sql, values });
      if (sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) return { rows: [], rowCount: 0 };
      if (sql === "SELECT 1") return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.startsWith("INSERT INTO api_rate_limit_buckets")) {
        if (fakeDatabase.failRateLimitWrites) throw new Error("synthetic rate-limit database outage");
        const [scope, keyHash, rawWindowMs] = values ?? [];
        const key = `${String(scope)}:${String(keyHash)}`;
        const windowMs = Number(rawWindowMs);
        const current = fakeDatabase.buckets.get(key);
        const bucket = !current || fakeDatabase.nowMs - current.startedAt >= windowMs
          ? { startedAt: fakeDatabase.nowMs, count: 0, lastSeenAt: fakeDatabase.nowMs }
          : current;
        bucket.count += 1;
        bucket.lastSeenAt = fakeDatabase.nowMs;
        fakeDatabase.buckets.set(key, bucket);
        return {
          rows: [{ window_started_at: new Date(bucket.startedAt), request_count: bucket.count, last_seen_at: new Date(bucket.lastSeenAt) }],
          rowCount: 1
        };
      }
      if (sql.includes("DELETE FROM api_rate_limit_buckets")) {
        const [rawRetentionMs, rawLimit] = values ?? [];
        const retentionMs = Number(rawRetentionMs);
        const limit = Number(rawLimit);
        const expired = [...fakeDatabase.buckets.entries()]
          .filter(([, bucket]) => fakeDatabase.nowMs - bucket.lastSeenAt > retentionMs)
          .slice(0, limit);
        expired.forEach(([key]) => fakeDatabase.buckets.delete(key));
        return { rows: [], rowCount: expired.length };
      }
      throw new Error(`Unexpected fake PostgreSQL query: ${sql.slice(0, 120)}`);
    }

    async connect() {
      return {
        query: async (sql: string, values?: unknown[]) => {
          fakeDatabase.clientQueries.push({ sql, values });
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK"
            || sql.includes("pg_advisory_xact_lock") || sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes(`FROM ${POSTGRES_SCHEMA_REVISION_TABLE}`)) {
            return {
              rows: [{ schema_version: POSTGRES_SCHEMA_VERSION, schema_sha256: POSTGRES_SCHEMA_SHA256 }],
              rowCount: 1
            };
          }
          if (sql.includes("FROM information_schema.columns")) {
            const contract = fakeDatabase.runtimeSchema as PostgresSchemaContractManifest;
            const tables = new Set(values?.[0] as string[]);
            const rows = contract.columns
              .filter((column) => tables.has(column.tableName))
              .map((column) => ({
                table_name: column.tableName,
                column_name: column.columnName,
                data_type: column.dataType,
                is_nullable: column.nullable ? "YES" : "NO"
              }));
            return { rows, rowCount: rows.length };
          }
          if (sql.includes("FROM pg_catalog.pg_index")) {
            const contract = fakeDatabase.runtimeSchema as PostgresSchemaContractManifest;
            const tables = new Set(values?.[0] as string[]);
            const rows = contract.indexes
              .filter((index) => tables.has(index.tableName))
              .flatMap((index) => index.keyColumns.map((column_name, indexKey) => ({
                table_name: index.tableName,
                index_name: index.indexName,
                is_unique: index.unique,
                column_name,
                key_order: indexKey + 1
              })));
            return { rows, rowCount: rows.length };
          }
          if (sql.includes("FROM pg_catalog.pg_constraint")) {
            const contract = fakeDatabase.runtimeSchema as PostgresSchemaContractManifest;
            const rows = [
              ...contract.keyConstraints.flatMap((constraint, constraintIndex) => constraint.columns.map((column_name, columnIndex) => ({
                table_name: constraint.tableName,
                constraint_name: `key_constraint_${constraintIndex}`,
                constraint_type: constraint.constraintType,
                column_name,
                column_order: columnIndex + 1
              }))),
              ...contract.countedConstraints.flatMap((constraint) => Array.from({ length: constraint.count }, (_, index) => ({
                table_name: constraint.tableName,
                constraint_name: `${constraint.constraintType}_${constraint.tableName}_${index}`,
                constraint_type: constraint.constraintType,
                column_name: null,
                column_order: null
              })))
            ];
            return { rows, rowCount: rows.length };
          }
          if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }], rowCount: 1 };
          if (sql.includes("pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }], rowCount: 1 };
          throw new Error(`Unexpected fake PostgreSQL client query: ${sql.slice(0, 120)}`);
        },
        release: () => undefined
      };
    }
  }
}));

describe("PostgreSQL shared rate-limit storage", () => {
  const keys = ["DATABASE_URL", "RATE_LIMIT_HMAC_SECRET", "NODE_ENV"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]])) as Record<(typeof keys)[number], string | undefined>;

  beforeEach(() => {
    vi.resetModules();
    fakeDatabase.buckets.clear();
    fakeDatabase.queries = [];
    fakeDatabase.clientQueries = [];
    fakeDatabase.runtimeSchema = runtimeSchemaContract;
    fakeDatabase.nowMs = 10_000;
    fakeDatabase.failRateLimitWrites = false;
    process.env.DATABASE_URL = "postgres://synthetic.test/pc_supporter";
    process.env.RATE_LIMIT_HMAC_SECRET = TEST_RATE_LIMIT_HMAC_SECRET;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  });

  it("shares an atomic fixed window across route scopes and stores only a scoped HMAC", async () => {
    const { consumeRateLimitWindow } = await import("./repository");
    const policy = { limit: 2, windowMs: 10_000 };
    const address = "198.51.100.77";

    await expect(consumeRateLimitWindow("public-read", address, policy)).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(consumeRateLimitWindow("public-read", address, policy)).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(consumeRateLimitWindow("public-read", address, policy)).resolves.toMatchObject({ allowed: false, remaining: 0 });
    await expect(consumeRateLimitWindow("public-write", address, policy)).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(consumeRateLimitWindow("public-read", "198.51.100.78", policy)).resolves.toMatchObject({ allowed: true, remaining: 1 });

    const writes = fakeDatabase.queries.filter(({ sql }) => sql.startsWith("INSERT INTO api_rate_limit_buckets"));
    expect(writes).toHaveLength(5);
    expect(writes[0].sql).toContain("ON CONFLICT (scope, client_key_hash) DO UPDATE");
    expect(writes[0].sql).toContain("RETURNING window_started_at, request_count, last_seen_at");
    expect(writes.every(({ values }) => !values?.includes(address))).toBe(true);
    expect(String(writes[0].values?.[1])).toMatch(/^[0-9a-f]{64}$/);
    expect(writes[0].values?.[1]).toBe(createHmac("sha256", TEST_RATE_LIMIT_HMAC_SECRET).update(`public-read\0${address}`).digest("hex"));
    expect(writes[0].values?.[1]).not.toBe(writes[3].values?.[1]);
    expect(fakeDatabase.buckets.size).toBe(3);
    expect(fakeDatabase.clientQueries.some(({ sql }) => sql.includes("CREATE TABLE IF NOT EXISTS api_rate_limit_buckets"))).toBe(true);
    const schemaLock = fakeDatabase.clientQueries.findIndex(({ sql }) => sql.includes("pg_advisory_xact_lock(hashtextextended($1, 0))"));
    const schemaDdl = fakeDatabase.clientQueries.findIndex(({ sql }) => sql.includes("CREATE TABLE IF NOT EXISTS api_rate_limit_buckets"));
    expect(schemaLock).toBeGreaterThanOrEqual(0);
    expect(schemaLock).toBeLessThan(schemaDdl);
  });

  it("keeps runtime, baseline, and deployment migration schemas aligned", async () => {
    const baseline = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
    const migration = await readFile(new URL("../db/migrations/20260930_api_rate_limit_buckets.sql", import.meta.url), "utf8");
    const tableDefinition = "CREATE TABLE IF NOT EXISTS api_rate_limit_buckets";
    const indexDefinition = "CREATE INDEX IF NOT EXISTS api_rate_limit_buckets_last_seen_idx ON api_rate_limit_buckets(last_seen_at)";

    expect(baseline).toContain(tableDefinition);
    expect(migration).toContain(tableDefinition);
    expect(baseline).toContain(indexDefinition);
    expect(migration).toContain(indexDefinition);
  });

  it("resets at the policy boundary and prunes only expired buckets", async () => {
    const { consumeRateLimitWindow, pruneRateLimitWindows } = await import("./repository");
    const policy = { limit: 1, windowMs: 10_000 };
    await expect(consumeRateLimitWindow("login", "203.0.113.5", policy)).resolves.toMatchObject({ allowed: true });
    await expect(consumeRateLimitWindow("login", "203.0.113.5", policy)).resolves.toMatchObject({ allowed: false });

    fakeDatabase.nowMs += 10_000;
    await expect(consumeRateLimitWindow("login", "203.0.113.5", policy)).resolves.toMatchObject({ allowed: true, remaining: 0 });
    fakeDatabase.nowMs += 25 * 60 * 60 * 1_000;

    await expect(pruneRateLimitWindows()).resolves.toBe(1);
    expect(fakeDatabase.buckets.size).toBe(0);
  });

  it("reports a missing production HMAC key as not ready and never falls back to a local bucket", async () => {
    delete process.env.RATE_LIMIT_HMAC_SECRET;
    process.env.NODE_ENV = "production";
    vi.resetModules();
    const { consumeRateLimitWindow, persistenceDiagnostics } = await import("./repository");

    await expect(persistenceDiagnostics()).resolves.toMatchObject({ ready: false, unavailableReason: "rate_limit_key_unconfigured" });
    await expect(consumeRateLimitWindow("public-read", "192.0.2.10", { limit: 2, windowMs: 10_000 })).rejects.toMatchObject({ code: "RATE_LIMIT_KEY_UNCONFIGURED" });
    expect(fakeDatabase.buckets.size).toBe(0);
  });

  it("does not fall back to a process-local decision if PostgreSQL writes fail", async () => {
    fakeDatabase.failRateLimitWrites = true;
    const { consumeRateLimitWindow } = await import("./repository");

    await expect(consumeRateLimitWindow("admin-login", "192.0.2.11", { limit: 2, windowMs: 10_000 })).rejects.toMatchObject({ code: "PERSISTENCE_UNAVAILABLE" });
    expect(fakeDatabase.buckets.size).toBe(0);
  });
});
