import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { TEST_POSTGRES_PORT } from "./postgres-url";

const require = createRequire(import.meta.url);
const DATA_DIRECTORY = resolve(process.cwd(), "node_modules/.cache/pc-supporter-test-pg");
const TEST_DATABASE = "pcsupporter_test";
const ADMIN_CONNECTION = {
  host: "127.0.0.1",
  port: TEST_POSTGRES_PORT,
  user: "postgres",
  password: "pc-supporter-test-password",
  database: "postgres",
  connectionTimeoutMillis: 1_500
};

function hydrateBundledSymlinks() {
  const platformPackages: Record<string, Record<string, string>> = {
    darwin: { arm64: "darwin-arm64", x64: "darwin-x64" },
    linux: { arm64: "linux-arm64", arm: "linux-arm", ia32: "linux-ia32", ppc64: "linux-ppc64", x64: "linux-x64" },
    win32: { x64: "windows-x64" }
  };
  const suffix = platformPackages[process.platform]?.[process.arch];
  if (!suffix) return;
  try {
    const packageJson = require.resolve(`@embedded-postgres/${suffix}/package.json`);
    const packageDirectory = resolve(packageJson, "..");
    execFileSync(process.execPath, ["scripts/hydrate-symlinks.js"], { cwd: packageDirectory, stdio: "ignore" });
  } catch {
    // Optional dependency may be absent on other platforms; the cluster start below will fail loudly if unusable.
  }
}

async function adminReachable() {
  const client = new Client(ADMIN_CONNECTION);
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function startCluster() {
  const cluster = new EmbeddedPostgres({
    databaseDir: DATA_DIRECTORY,
    port: TEST_POSTGRES_PORT,
    user: "postgres",
    password: "pc-supporter-test-password",
    persistent: true,
    onLog: () => undefined,
    onError: () => undefined
  });
  if (!existsSync(resolve(DATA_DIRECTORY, "PG_VERSION"))) {
    rmSync(DATA_DIRECTORY, { recursive: true, force: true });
    await cluster.initialise();
  }
  await cluster.start();
  return cluster;
}

async function waitForCluster() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await adminReachable()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error("Embedded PostgreSQL test cluster did not become ready.");
}

async function ensureTestDatabase() {
  const client = new Client({ ...ADMIN_CONNECTION, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DATABASE]);
    if (found.rows.length === 0) await client.query(`CREATE DATABASE "${TEST_DATABASE}"`);
  } finally {
    await client.end();
  }
}

export default async function setup() {
  hydrateBundledSymlinks();
  if (await adminReachable()) {
    await ensureTestDatabase();
    return async function teardown() {};
  }
  const cluster = await startCluster();
  await waitForCluster();
  await ensureTestDatabase();
  return async function teardown() {
    await cluster.stop().catch(() => undefined);
  };
}
