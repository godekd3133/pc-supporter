// Scratch PostgreSQL for standalone smoke scripts and CI steps.
// Reuses the embedded-postgres cluster that `server/testkit/global-setup.ts`
// manages for Vitest so smoke runs never depend on a developer's Postgres.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { unhookEmbeddedPostgresExitMask } = require("./async-exit-hook-fix.cjs");

// See async-exit-hook-fix.cjs: embedded-postgres' exit handlers rewrite or
// corrupt the real exit code, so they are removed. Live clusters are still
// stopped here — 'beforeExit' awaits them (bounded) on a natural exit and
// 'exit' sends their SIGINT synchronously on an explicit process.exit().
unhookEmbeddedPostgresExitMask();
const liveClusters = new Set();
process.on("beforeExit", (code) => {
  if (liveClusters.size === 0) return;
  const pending = [...liveClusters].map((cluster) => cluster.stop().catch(() => undefined));
  liveClusters.clear();
  const force = setTimeout(() => process.exit(code || 0), 10_000);
  Promise.allSettled(pending).then(() => clearTimeout(force));
});
process.on("exit", () => {
  for (const cluster of liveClusters) void cluster.stop().catch(() => undefined);
});
const DATA_DIRECTORY = resolve(ROOT, "node_modules/.cache/pc-supporter-test-pg");
export const EMBEDDED_POSTGRES_PORT = 55439;
const ADMIN_CONNECTION = {
  host: "127.0.0.1",
  port: EMBEDDED_POSTGRES_PORT,
  user: "postgres",
  password: "pc-supporter-test-password",
  database: "postgres",
  connectionTimeoutMillis: 1_500
};

function hydrateBundledSymlinks() {
  const platformPackages = {
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
    // The cluster start below fails loudly if the bundled binaries are unusable.
  }
}

async function adminReachable() {
  const client = new pg.Client(ADMIN_CONNECTION);
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

export function embeddedPostgresUrl(database) {
  return `postgresql://postgres:pc-supporter-test-password@127.0.0.1:${EMBEDDED_POSTGRES_PORT}/${database}`;
}

/**
 * Ensures the embedded cluster is running, drops and recreates `database`
 * for a clean scratch state, and returns the connection URL plus a stop()
 * that only stops a cluster this call started.
 */
export async function ensureEmbeddedPostgres(database) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(database)) {
    throw new Error(`Refusing unsafe scratch database name: ${database}`);
  }
  hydrateBundledSymlinks();
  let cluster;
  if (!(await adminReachable())) {
    cluster = new EmbeddedPostgres({
      databaseDir: DATA_DIRECTORY,
      port: EMBEDDED_POSTGRES_PORT,
      user: "postgres",
      password: "pc-supporter-test-password",
      persistent: true,
      onLog: () => undefined,
      onError: () => undefined
    });
    liveClusters.add(cluster);
    if (!existsSync(resolve(DATA_DIRECTORY, "PG_VERSION"))) {
      rmSync(DATA_DIRECTORY, { recursive: true, force: true });
      await cluster.initialise();
    }
    await cluster.start();
    for (let attempt = 0; attempt < 60 && !(await adminReachable()); attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    if (!(await adminReachable())) throw new Error("Embedded PostgreSQL cluster did not become ready.");
  }
  const client = new pg.Client({ ...ADMIN_CONNECTION, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${database}"`);
    await client.query(`CREATE DATABASE "${database}"`);
  } finally {
    await client.end();
  }
  return {
    url: embeddedPostgresUrl(database),
    async stop() {
      liveClusters.delete(cluster);
      const admin = new pg.Client({ ...ADMIN_CONNECTION, connectionTimeoutMillis: 5_000 });
      await admin.connect().catch(() => undefined);
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      } catch {
        // The scratch database is best-effort cleanup only.
      } finally {
        await admin.end().catch(() => undefined);
      }
      await cluster?.stop().catch(() => undefined);
    }
  };
}
