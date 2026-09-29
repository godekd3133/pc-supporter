import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PoolClient } from "pg";
import {
  migratePostgresSchemaWithClient,
  POSTGRES_SCHEMA_SHA256,
  POSTGRES_SCHEMA_VERSION,
  PostgresSchemaContractError,
  type PostgresSchemaMigrationOutcome
} from "../server/postgres-schema-contract";

type MigrationPool = {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
};

export type PostgresMigrationCommandDependencies = {
  env?: Record<string, string | undefined>;
  readCanonicalSchema?: () => Promise<Uint8Array>;
  createPool?: (migrationUrl: string) => Promise<MigrationPool> | MigrationPool;
  writeStdout?: (text: string) => void;
  writeStderr?: (text: string) => void;
};

export type PostgresMigrationCommandResult = {
  ok: true;
  status: PostgresSchemaMigrationOutcome;
  schemaVersion: number;
  schemaSha256: string;
};

async function defaultCreatePool(migrationUrl: string): Promise<MigrationPool> {
  const { Pool } = await import("pg");
  return new Pool({ connectionString: migrationUrl, max: 1, connectionTimeoutMillis: 5_000 });
}

function safeDatabaseFailure(error: unknown) {
  if (error instanceof PostgresSchemaContractError) return error;
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  return code === "42P01"
    ? new Error("PostgreSQL schema metadata is missing or incompatible; canonical migration was rolled back.")
    : new Error("PostgreSQL canonical schema migration failed; transaction was rolled back.");
}

export async function executePostgresMigrationCommand(args: string[], dependencies: PostgresMigrationCommandDependencies = {}): Promise<PostgresMigrationCommandResult> {
  if (args.length > 0) throw new Error("db:migrate does not accept command-line arguments.");
  const migrationUrl = (dependencies.env ?? process.env).DATABASE_MIGRATION_URL?.trim();
  if (!migrationUrl) throw new Error("DATABASE_MIGRATION_URL is required for db:migrate.");

  let schemaBytes: Uint8Array;
  try {
    schemaBytes = await (dependencies.readCanonicalSchema ?? (() => readFile(resolve(process.cwd(), "db/schema.sql"))))();
  } catch {
    throw new Error("Canonical db/schema.sql could not be read.");
  }
  const schemaSha256 = createHash("sha256").update(schemaBytes).digest("hex");
  if (schemaSha256 !== POSTGRES_SCHEMA_SHA256) {
    throw new PostgresSchemaContractError("Canonical db/schema.sql checksum does not match the application schema contract.");
  }

  let pool: MigrationPool;
  try {
    pool = await (dependencies.createPool ?? defaultCreatePool)(migrationUrl);
  } catch {
    throw new Error("PostgreSQL migration connection pool could not be created.");
  }

  let client: PoolClient | undefined;
  let released = false;
  try {
    client = await pool.connect();
    const result = await migratePostgresSchemaWithClient(client, Buffer.from(schemaBytes).toString("utf8"), schemaSha256);
    client.release();
    released = true;
    return { ok: true, status: result, schemaVersion: POSTGRES_SCHEMA_VERSION, schemaSha256 };
  } catch (error: unknown) {
    if (client && !released) client.release(true);
    throw safeDatabaseFailure(error);
  } finally {
    try {
      await pool.end();
    } catch {
      // Avoid printing pool or connection details.
    }
  }
}

export async function runPostgresMigrationCommand(args: string[], dependencies: PostgresMigrationCommandDependencies = {}) {
  const writeStdout = dependencies.writeStdout ?? ((text: string) => { process.stdout.write(text); });
  const writeStderr = dependencies.writeStderr ?? ((text: string) => { process.stderr.write(text); });
  try {
    const result = await executePostgresMigrationCommand(args, dependencies);
    writeStdout(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error: unknown) {
    writeStderr(`${error instanceof Error ? error.message : "PostgreSQL migration failed."}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runPostgresMigrationCommand(process.argv.slice(2)).then((exitCode) => { process.exitCode = exitCode; });
}
