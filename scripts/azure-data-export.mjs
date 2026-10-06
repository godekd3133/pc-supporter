#!/usr/bin/env node
// Run as root on the original PC Supporter Ubuntu host. Never exports cluster roles.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseDotenv } from "dotenv";
import pg from "pg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENV = "/etc/pc-supporter/backend.env";
const MIGRATION_ENV = "/etc/pc-supporter/migration.env";
const RUNTIME_DIR = "/var/lib/pc-supporter";
const BACKUP_PARENT = "/opt/pc-supporter/backups";
const PG_DUMP = "/usr/lib/postgresql/16/bin/pg_dump";
const PG_RESTORE = "/usr/lib/postgresql/16/bin/pg_restore";
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const TOOL_ENV = { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C" };

class ExportError extends Error {}
function fail(message) { throw new ExportError(message); }
function quoteIdentifier(value) {
  if (!IDENTIFIER.test(value)) fail("Invalid PostgreSQL identifier.");
  return `"${value}"`;
}

export function parseArgs(argv) {
  const options = { phase: "preflight", checkOnly: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return { help: true };
    if (seen.has(flag)) fail("An option was provided more than once.");
    seen.add(flag);
    if (flag === "--check-only") { options.checkOnly = true; continue; }
    const key = { "--phase": "phase", "--expected-database": "database", "--expected-host": "host", "--expected-port": "port" }[flag];
    if (!key || !argv[index + 1] || argv[index + 1].startsWith("--")) fail("Unknown option or missing option value.");
    options[key] = argv[++index];
  }
  if (!IDENTIFIER.test(options.database ?? "")) fail("--expected-database must name the verified PC Supporter database.");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(options.host)) fail("--expected-host must be the verified loopback PostgreSQL endpoint.");
  if (!/^\d{1,5}$/.test(options.port ?? "") || Number(options.port) < 1 || Number(options.port) > 65535) fail("--expected-port must be the verified PostgreSQL port.");
  if (!["preflight", "cutover"].includes(options.phase)) fail("--phase must be preflight or cutover.");
  options.port = String(Number(options.port));
  return options;
}

export function databaseConfig(backend, migration, expected) {
  function parseUrl(value, fallbackPassword) {
    let url;
    try { url = new URL(value); } catch { fail("A configured PostgreSQL URL is invalid."); }
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hash) fail("A configured PostgreSQL URL is invalid.");
    for (const key of url.searchParams.keys()) {
      if (!["sslmode", "connect_timeout"].includes(key) || url.searchParams.getAll(key).length !== 1) fail("Unsupported PostgreSQL URL parameter; inspect it before export.");
    }
    let database, user, password;
    try {
      database = decodeURIComponent(url.pathname.slice(1));
      user = decodeURIComponent(url.username);
      password = decodeURIComponent(url.password) || fallbackPassword;
    } catch { fail("A configured PostgreSQL URL encoding is invalid."); }
    if (!IDENTIFIER.test(database) || !IDENTIFIER.test(user) || typeof password !== "string" || !password || /[\x00-\x1f\x7f]/.test(password)) fail("Configured PostgreSQL identity or password is invalid.");
    const endpoint = { host: url.hostname, port: url.port || "5432", database };
    if (endpoint.host !== expected.host || endpoint.port !== expected.port || endpoint.database !== expected.database) fail("Configured PostgreSQL endpoint does not match the verified source boundary.");
    const sslmode = url.searchParams.get("sslmode") || "prefer";
    if (!["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(sslmode)) fail("Configured PostgreSQL SSL mode is invalid.");
    const connectTimeout = url.searchParams.get("connect_timeout") || "10";
    if (!/^\d{1,3}$/.test(connectTimeout) || Number(connectTimeout) < 1) fail("Configured PostgreSQL connect timeout is invalid.");
    return { url: value, ...endpoint, user, password, sslmode, connectTimeout };
  }
  const runtime = parseUrl(backend.DATABASE_URL?.trim(), backend.PGPASSWORD);
  const owner = parseUrl(migration.DATABASE_MIGRATION_URL?.trim(), migration.PGPASSWORD);
  if (migration.DATABASE_URL || migration.POSTGRES_PASSWORD || migration.POSTGRES_OWNER_PASSWORD) fail("Migration env contains forbidden runtime/Compose password keys.");
  if (runtime.user !== migration.DATABASE_RUNTIME_ROLE || runtime.password !== migration.DATABASE_RUNTIME_PASSWORD) fail("Runtime PostgreSQL credentials do not match root-only bootstrap configuration.");
  if (owner.user === runtime.user) fail("Schema owner and application runtime role must be separate.");
  if ((backend.PC_SUPPORTER_DATA_DIR?.trim() || RUNTIME_DIR) !== RUNTIME_DIR) fail("Configured runtime directory is outside the approved PC Supporter path.");
  return { runtime, owner };
}

export function canonicalTables(schemaSql) {
  const tables = [...schemaSql.matchAll(/^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gim)].map((match) => match[1]).sort();
  if (!tables.length || tables.length !== [...schemaSql.matchAll(/^\s*CREATE\s+TABLE\b/gim)].length
    || new Set(tables).size !== tables.length || tables.some((table) => !IDENTIFIER.test(table))
    || !tables.includes("pc_supporter_schema_revision") || !tables.includes("saved_builds")) fail("Canonical PC Supporter table boundary is invalid.");
  return tables;
}

async function privateEnv(path, allowServiceGroup) {
  const info = await lstat(path);
  if (await realpath(path) !== path || !info.isFile() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o400) === 0 || (info.mode & (allowServiceGroup ? 0o137 : 0o177)) !== 0) fail("Application env ownership or permissions are unsafe.");
  const bytes = await readFile(path);
  return { bytes, env: parseDotenv(bytes) };
}

// Child stderr can contain a URL, password, or row data. Keep it private by
// discarding it and report only the tool label and numeric exit/signal.
export function runTool(binary, args, env = TOOL_ENV, { allowedExitCodes = [0], captureOutput = false } = {}) {
  return new Promise((resolveTool, reject) => {
    const child = spawn(binary, args, { env, stdio: ["ignore", captureOutput ? "pipe" : "ignore", "ignore"] });
    let output = "";
    child.stdout?.on("data", (chunk) => { if (output.length < 16384) output += chunk.toString(); });
    child.once("error", () => reject(new ExportError("An export tool could not be started.")));
    child.once("close", (code, signal) => {
      if (!allowedExitCodes.includes(code)) reject(new ExportError(`Export tool ${binary.split("/").at(-1)} failed (exit ${code ?? "none"}, signal ${signal ?? "none"}).`));
      else resolveTool({ code, output });
    });
  });
}

async function cutoverGuard(phase) {
  if (phase !== "cutover") return;
  for (const service of ["pc-supporter-api", "pc-supporter-worker"]) {
    const { output } = await runTool("/usr/bin/systemctl", ["show", service, "--property=LoadState,ActiveState", "--no-pager"], TOOL_ENV, { captureOutput: true });
    if (!/^LoadState=loaded$/m.test(output) || !/^ActiveState=inactive$/m.test(output)) fail("Cutover export requires both PC Supporter services to be loaded and fully inactive; this helper never stops services.");
  }
}

export async function inspectSnapshot(client, config, schemaSql, schemaSha256) {
  const tables = canonicalTables(schemaSql);
  const identity = (await client.query(`SELECT current_database() AS database_name, current_user AS owner_role,
    current_setting('server_version') AS server_version, current_setting('server_version_num') AS version_num,
    pg_get_userbyid(datdba) AS database_owner,
    (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS connection_ssl
    FROM pg_database WHERE datname = current_database()`)).rows[0];
  if (!identity || identity.database_name !== config.owner.database || identity.owner_role !== config.owner.user || identity.database_owner !== config.owner.user) fail("Connected PostgreSQL database/owner does not match the source configuration.");
  if (Math.floor(Number(identity.version_num) / 10000) !== 16) fail("Source PostgreSQL major must be 16; inspect it before choosing a matching dump tool.");
  const actual = (await client.query(`SELECT n.nspname AS schema_name, c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner_role
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p','f') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
    ORDER BY n.nspname, c.relname`)).rows;
  if (actual.length !== tables.length || actual.some((row, index) => row.schema_name !== "public" || row.table_name !== tables[index] || row.owner_role !== config.owner.user)) fail("Database has missing, foreign, or differently owned tables outside the canonical PC Supporter boundary.");
  const revisionRows = (await client.query("SELECT schema_version, schema_sha256 FROM public.pc_supporter_schema_revision WHERE singleton_id = 'current'")).rows;
  if (revisionRows.length !== 1 || Number(revisionRows[0].schema_version) < 1 || revisionRows[0].schema_sha256 !== schemaSha256) fail("Source DB schema revision does not match the deployment schema.sql.");
  const rowCounts = {};
  for (const table of tables) rowCounts[table] = String((await client.query(`SELECT count(*)::text AS count FROM public.${quoteIdentifier(table)}`)).rows[0].count);
  const savedBuildState = (await client.query(`SELECT
    count(*) FILTER (WHERE owner_token_hash IS NOT NULL)::text AS owned,
    count(*) FILTER (WHERE recovery_code_hash IS NOT NULL)::text AS recoverable,
    count(*) FILTER (WHERE my_pc_at IS NOT NULL)::text AS my_pc,
    count(*) FILTER (WHERE check_snapshot IS NOT NULL)::text AS check_snapshot,
    count(*) FILTER (WHERE check_history IS NOT NULL)::text AS check_history,
    count(*) FILTER (WHERE monitor_state IS NOT NULL)::text AS monitor_state,
    count(*) FILTER (WHERE purchase_progress IS NOT NULL)::text AS purchase_progress,
    count(*) FILTER (WHERE purchase_price_history IS NOT NULL)::text AS purchase_price_history,
    count(*) FILTER (WHERE decision_note IS NOT NULL)::text AS decision_note,
    count(*) FILTER (WHERE metadata_history IS NOT NULL)::text AS metadata_history
    FROM public.saved_builds`)).rows[0];
  const userStateCounts = Object.fromEntries(tables.filter((table) => table.startsWith("saved_") || ["owner_sessions", "owner_session_grants"].includes(table)).map((table) => [table, rowCounts[table]]));
  return { database: identity.database_name, ownerRole: identity.owner_role, runtimeRole: config.runtime.user,
    serverVersion: identity.server_version, connectionSsl: Boolean(identity.connection_ssl), configuredSslMode: config.owner.sslmode,
    schemaVersion: Number(revisionRows[0].schema_version), schemaSha256,
    rowCounts, userStateCounts, savedBuildState };
}

async function checksum(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { sha256: hash.digest("hex"), bytes: (await stat(path)).size };
}

async function exportData(options) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) fail("Run as root on the original PC Supporter Ubuntu host.");
  process.umask(0o077);
  const os = parseDotenv(await readFile("/etc/os-release"));
  if (os.ID !== "ubuntu") fail("This helper requires the original Ubuntu host.");
  const [backend, migration] = await Promise.all([privateEnv(BACKEND_ENV, true), privateEnv(MIGRATION_ENV, false)]);
  const config = databaseConfig(backend.env, migration.env, options);
  if (await realpath(RUNTIME_DIR) !== RUNTIME_DIR || !(await stat(RUNTIME_DIR)).isDirectory()) fail("Runtime files must reside in the approved non-symlink directory.");
  const schemaBytes = await readFile(join(ROOT, "db/schema.sql"));
  const schemaSql = schemaBytes.toString("utf8");
  const schemaSha256 = createHash("sha256").update(schemaBytes).digest("hex");
  for (const binary of [PG_DUMP, PG_RESTORE]) {
    const { output } = await runTool(binary, ["--version"], TOOL_ENV, { captureOutput: true });
    if (!/\(PostgreSQL\) 16\./.test(output)) fail("Explicit PostgreSQL 16 dump/restore tool version is required.");
  }
  await cutoverGuard(options.phase);
  // pg merges a connectionString's empty password over a separate password
  // option. Fill the URL in private memory only; never pass it to a command.
  const privateOwnerUrl = new URL(config.owner.url);
  privateOwnerUrl.password = config.owner.password;
  const client = new pg.Client({ connectionString: privateOwnerUrl.toString(), connectionTimeoutMillis: 10000,
    statement_timeout: 60000, idle_in_transaction_session_timeout: 0, application_name: "pc-supporter-azure-export" });
  await client.connect();
  let backup;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const manifest = await inspectSnapshot(client, config, schemaSql, schemaSha256);
    if (options.checkOnly) {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({ status: "ok", mode: "check-only", phase: options.phase, ...manifest }));
      return;
    }
    const snapshot = String((await client.query("SELECT pg_export_snapshot() AS snapshot")).rows[0].snapshot);
    if (!/^[0-9A-Fa-f-]+$/.test(snapshot)) fail("PostgreSQL exported snapshot identity is invalid.");
    const parentInfo = await lstat(BACKUP_PARENT);
    if (await realpath(BACKUP_PARENT) !== BACKUP_PARENT || !parentInfo.isDirectory() || parentInfo.isSymbolicLink() || parentInfo.uid !== 0 || (parentInfo.mode & 0o022) !== 0) fail("Backup parent must be a root-owned directory without group/other writes.");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    backup = join(BACKUP_PARENT, `azure-${stamp}-${options.phase}`);
    await mkdir(backup, { mode: 0o700 }); // Do not overwrite a previous snapshot.
    await writeFile(join(backup, "INCOMPLETE"), "Export has not completed; do not restore this directory.\n", { mode: 0o600, flag: "wx" });
    // Preserve exactly the env bytes whose credentials and paths were verified.
    await writeFile(join(backup, "backend.env"), backend.bytes, { mode: 0o600, flag: "wx" });
    await writeFile(join(backup, "migration.env"), migration.bytes, { mode: 0o600, flag: "wx" });
    // A single-database custom archive includes all app schemas/data/sequences,
    // but no pg_dumpall role export. Restore uses --no-owner --no-acl.
    await runTool(PG_DUMP, ["--format=custom", "--no-password", "--lock-wait-timeout=60000", `--snapshot=${snapshot}`, `--file=${join(backup, "database.dump")}`], {
      ...TOOL_ENV, PGHOST: config.owner.host === "[::1]" ? "::1" : config.owner.host, PGPORT: config.owner.port,
      PGDATABASE: config.owner.database, PGUSER: config.owner.user, PGPASSWORD: config.owner.password,
      PGSSLMODE: config.owner.sslmode, PGCONNECT_TIMEOUT: config.owner.connectTimeout, PGAPPNAME: "pc-supporter-azure-pg-dump"
    });
    await chmod(join(backup, "database.dump"), 0o600);
    await runTool(PG_RESTORE, ["--list", join(backup, "database.dump")]);
    await client.query("COMMIT");
    await cutoverGuard(options.phase);
    await runTool("/usr/bin/tar", ["--create", "--gzip", `--file=${join(backup, "runtime-files.tar.gz")}`, "--directory=/var/lib", "--", "pc-supporter"]);
    await chmod(join(backup, "runtime-files.tar.gz"), 0o600);
    await cutoverGuard(options.phase);
    const files = {};
    for (const name of ["database.dump", "runtime-files.tar.gz", "backend.env", "migration.env"]) files[name] = await checksum(join(backup, name));
    const releasePath = await realpath(ROOT);
    const complete = { format: "pc-supporter-azure-export-v1", phase: options.phase, completedAtUtc: new Date().toISOString(), releasePath,
      consistency: { database: "exported PostgreSQL repeatable-read snapshot", runtimeFiles: options.phase === "cutover" ? "PC Supporter API and worker inactive before and after archive" : "live preflight copy; final stopped-service export required" },
      ...manifest, files };
    await writeFile(join(backup, "manifest.json"), JSON.stringify(complete, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await unlink(join(backup, "INCOMPLETE"));
    console.log(JSON.stringify({ status: "ok", mode: "export", phase: options.phase, backupDirectory: backup, database: manifest.database,
      serverVersion: manifest.serverVersion, schemaVersion: manifest.schemaVersion, tableCount: Object.keys(manifest.rowCounts).length }));
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

function usage() {
  console.log(`Usage: sudo node scripts/azure-data-export.mjs --expected-database <verified-name> --expected-host <verified-loopback> --expected-port <verified-port> [--phase preflight|cutover] [--check-only]

Reads /etc/pc-supporter/backend.env and root-only migration.env without printing credentials.
Uses explicit PostgreSQL 16 tools. Backs up only the canonical PC Supporter DB and
/var/lib/pc-supporter into /opt/pc-supporter/backups/azure-<UTC>-<phase> (0700/0600).
--check-only validates source identity/schema/row counts without creating backup files.
--phase cutover requires PC Supporter API and worker already inactive; this helper
never stops services. A preflight archive is not the final runtime-file snapshot.
Other databases and cluster-global roles are never exported. No restore is performed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) usage(); else await exportData(options);
  } catch (error) {
    // Driver errors may echo secrets/data. Only our fixed validation messages or
    // a validated SQLSTATE are safe to expose outside the root-only process.
    const code = /^[0-9A-Z]{5}$/.test(String(error?.code)) ? ` (SQLSTATE ${error.code})` : "";
    console.error(`pc_supporter_azure_export: ${error instanceof ExportError ? error.message : `Source export failed${code}; private files remain marked incomplete if created.`}`);
    process.exitCode = 1;
  }
}
