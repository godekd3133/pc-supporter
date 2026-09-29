#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectPermissionDenied(client, savepoint, sql) {
  await client.query(`SAVEPOINT ${savepoint}`);
  let denied = false;
  try {
    await client.query(sql);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "42501") throw new Error(`Runtime privilege smoke expected SQLSTATE 42501, received ${/^[0-9A-Z]{5}$/.test(code) ? code : "unknown"}.`);
    denied = true;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  assert(denied, "Runtime privilege smoke unexpectedly accepted a forbidden operation.");
}

export async function runPostgresRuntimeRoleSmoke(env = process.env, dependencies = {}) {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the runtime-role PostgreSQL smoke.");
  const createPool = dependencies.createPool ?? (async (connectionString) => {
    const { Pool } = await import("pg");
    return new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000, keepAlive: true });
  });
  let pool;
  try {
    pool = await createPool(databaseUrl);
  } catch {
    throw new Error("Runtime-role PostgreSQL smoke connection could not be created.");
  }
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const identity = await client.query(`
      SELECT current_database() AS database_name,
             current_user AS runtime_role,
             schema_version,
             schema_sha256
      FROM pc_supporter_schema_revision
      WHERE singleton_id = 'current'
    `);
    assert(identity.rows.length === 1, "Runtime-role PostgreSQL smoke could not read the current schema revision.");

    const suffix = randomUUID().replaceAll("-", "");
    const dmlKey = `pc-supporter-runtime-smoke-${suffix}`;
    const clientKeyHash = suffix.padEnd(64, "0").slice(0, 64);
    await client.query(
      `INSERT INTO api_rate_limit_buckets (scope, client_key_hash, window_started_at, request_count, last_seen_at)
       VALUES ($1, $2, statement_timestamp(), 1, statement_timestamp())`,
      [dmlKey, clientKeyHash]
    );
    await client.query("UPDATE api_rate_limit_buckets SET request_count = request_count + 1 WHERE scope = $1 AND client_key_hash = $2", [dmlKey, clientKeyHash]);
    const readback = await client.query("SELECT request_count FROM api_rate_limit_buckets WHERE scope = $1 AND client_key_hash = $2", [dmlKey, clientKeyHash]);
    assert(Number(readback.rows[0]?.request_count) === 2, "Runtime-role PostgreSQL smoke could not read its app-table DML write.");
    await client.query("DELETE FROM api_rate_limit_buckets WHERE scope = $1 AND client_key_hash = $2", [dmlKey, clientKeyHash]);

    const ddlIdentifier = `pc_supporter_runtime_probe_${suffix}`;
    await expectPermissionDenied(client, "deny_public_ddl", `CREATE TABLE public."${ddlIdentifier}" (id integer)`);
    await expectPermissionDenied(client, "deny_revision_insert", `INSERT INTO pc_supporter_schema_revision (singleton_id, schema_version, schema_sha256) VALUES ('current', 1, repeat('a', 64))`);
    await expectPermissionDenied(client, "deny_revision_update", `UPDATE pc_supporter_schema_revision SET applied_at = applied_at WHERE false`);
    await expectPermissionDenied(client, "deny_revision_delete", `DELETE FROM pc_supporter_schema_revision WHERE false`);
    await client.query("ROLLBACK");
    const result = {
      ok: true,
      database: String(identity.rows[0].database_name),
      runtimeRole: String(identity.rows[0].runtime_role),
      schemaVersion: Number(identity.rows[0].schema_version),
      appTableCrud: "passed",
      publicSchemaDdl: "denied",
      schemaRevisionSelect: "passed",
      schemaRevisionWrites: "denied"
    };
    client.release();
    client = undefined;
    return result;
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* Drop this connection below. */ }
      client.release(true);
      client = undefined;
    }
    if (error instanceof Error && /^(DATABASE_URL|Runtime-role PostgreSQL|Runtime privilege smoke|Runtime-role PostgreSQL smoke|Runtime-role PostgreSQL smoke unexpectedly|Runtime-role PostgreSQL smoke could not)/.test(error.message)) throw error;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
    throw new Error(`Runtime-role PostgreSQL smoke failed (SQLSTATE ${/^[0-9A-Z]{5}$/.test(code) ? code : "unknown"}).`);
  } finally {
    try { await pool.end(); } catch { /* Never print connection details. */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runPostgresRuntimeRoleSmoke().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Runtime-role PostgreSQL smoke failed."}\n`);
    process.exitCode = 1;
  });
}
