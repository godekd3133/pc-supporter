import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client, Pool } from "pg";
import { vi } from "vitest";
import { migratePostgresSchemaWithClient } from "../postgres-schema-contract";
import { TEST_ADMIN_DATABASE_URL, TEST_DATABASE, TEST_DATABASE_URL } from "./postgres-url";

export { TEST_DATABASE_URL };

let adminPool: Pool | undefined;
let ensureDatabasePromise: Promise<void> | undefined;

// Each worker owns its own database (see postgres-url.ts), so creating it is
// cheap and idempotent; migrating it here keeps table truncation lists real
// from the first beforeEach instead of caching an empty-database table list.
export function ensureTestDatabase() {
  if (!ensureDatabasePromise) {
    ensureDatabasePromise = (async () => {
      const admin = new Client({ connectionString: TEST_ADMIN_DATABASE_URL, connectionTimeoutMillis: 5_000 });
      await admin.connect();
      try {
        const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DATABASE]);
        if (found.rows.length === 0) {
          await admin.query(`CREATE DATABASE "${TEST_DATABASE}"`).catch((error: { code?: string }) => {
            if (error?.code !== "42P04") throw error;
          });
        }
      } finally {
        await admin.end();
      }
      const schemaBytes = await readFile(resolve(process.cwd(), "db/schema.sql"));
      const migrationClient = new Client({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 5_000 });
      await migrationClient.connect();
      try {
        await migratePostgresSchemaWithClient(migrationClient, schemaBytes.toString("utf8"), createHash("sha256").update(schemaBytes).digest("hex"));
      } finally {
        await migrationClient.end();
      }
    })();
    ensureDatabasePromise.catch(() => { ensureDatabasePromise = undefined; });
  }
  return ensureDatabasePromise;
}

async function testAdminPool() {
  if (!adminPool) {
    await ensureTestDatabase();
    adminPool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2, connectionTimeoutMillis: 5_000 });
  }
  return adminPool;
}

let cachedTableNames: string[] | undefined;

export async function truncatePostgresTables() {
  const pool = await testAdminPool();
  if (!cachedTableNames) {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'pc_supporter_schema_revision'`
    );
    cachedTableNames = tables.rows.map((row) => row.table_name);
  }
  if (cachedTableNames.length === 0) return;
  const names = cachedTableNames.map((name) => `"${name.replace(/"/g, '""')}"`).join(", ");
  await pool.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}

export async function closePostgresTestkit() {
  if (adminPool) {
    const pool = adminPool;
    adminPool = undefined;
    await pool.end().catch(() => undefined);
  }
}

type PostgresStoreTools = {
  dataDirectory: string;
  repository: typeof import("../repository");
};

const POSTGRES_ENV_KEYS = ["DATABASE_URL", "PC_SUPPORTER_DATA_DIR"] as const;

/**
 * Boots the app modules against the shared dockerized test database with an
 * isolated data directory for crawl-style file artifacts.
 */
export async function withPostgresStore<T>(run: (tools: PostgresStoreTools) => Promise<T>): Promise<T> {
  const dataDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-pg-store-"));
  const previous = Object.fromEntries(POSTGRES_ENV_KEYS.map((key) => [key, process.env[key]])) as Record<(typeof POSTGRES_ENV_KEYS)[number], string | undefined>;
  let repository: typeof import("../repository") | undefined;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.PC_SUPPORTER_DATA_DIR = dataDirectory;
  vi.resetModules();
  try {
    repository = await import("../repository");
    await repository.initializePersistence();
    await truncatePostgresTables();
    return await run({ dataDirectory, repository });
  } finally {
    if (repository) await repository.closePersistence().catch(() => undefined);
    vi.resetModules();
    for (const key of POSTGRES_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dataDirectory, { recursive: true, force: true });
  }
}
