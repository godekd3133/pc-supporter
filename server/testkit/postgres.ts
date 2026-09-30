import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { vi } from "vitest";
import { TEST_DATABASE_URL } from "./postgres-url";

export { TEST_DATABASE_URL };

let adminPool: Pool | undefined;

async function testAdminPool() {
  if (!adminPool) {
    adminPool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2, connectionTimeoutMillis: 5_000 });
  }
  return adminPool;
}

export async function truncatePostgresTables() {
  const pool = await testAdminPool();
  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'pc_supporter_schema_revision'`
  );
  if (tables.rows.length === 0) return;
  const names = tables.rows.map((row) => `"${row.table_name.replace(/"/g, '""')}"`).join(", ");
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
