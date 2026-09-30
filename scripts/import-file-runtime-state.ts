import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PoolClient } from "pg";
import { POSTGRES_SCHEMA_SHA256, POSTGRES_SCHEMA_VERSION } from "../server/postgres-schema-contract";

const MAX_ITEM_ID_LENGTH = 512;
const MAX_DAILY_BUCKETS = 97;
const MAX_EVENT_COUNT = 2_147_483_647;
const TARGET_DATABASE = "pcsupporter";
const IMPORT_LOCK = "pc-supporter:file-runtime-state-import";
const EVENT_NAMES = ["app_open", "check", "recommend", "save", "share"] as const;
type UsageEventName = (typeof EVENT_NAMES)[number];
type PriceRefreshAttempt = { kind: "part" | "accessory"; itemId: string; attemptedAt: string };
type UsageDay = { dayUtc: string; counts: Partial<Record<UsageEventName, number>> };
type SourceFile<T> = { path: string; sha256: string; value: T };

export type FileRuntimeStateSnapshot = {
  attempts: SourceFile<PriceRefreshAttempt[]>;
  usage: SourceFile<UsageDay[]>;
  usageTotal: number;
};

type ImportOptions = {
  mode: "dry-run" | "apply";
  attemptsPath: string;
  usagePath: string;
  expectedAttemptsSha256?: string;
  expectedUsageSha256?: string;
};

type ImportPool = { connect(): Promise<PoolClient>; end(): Promise<void> };
export type FileRuntimeStateImportDependencies = {
  env?: Record<string, string | undefined>;
  readSource?: (path: string) => Promise<Uint8Array>;
  createPool?: (connectionString: string) => Promise<ImportPool> | ImportPool;
  now?: () => Date;
  writeStdout?: (text: string) => void;
  writeStderr?: (text: string) => void;
};

export type FileRuntimeStateImportReport = {
  ok: true;
  mode: "dry-run" | "apply";
  connectedToDatabase: boolean;
  priceRefreshAttempts: { file: string; sha256: string; records: number; status?: "imported" | "unchanged" };
  usageEvents: { file: string; sha256: string; dailyBuckets: number; totalEvents: number; status?: "imported" | "unchanged" };
  targetDatabase?: string;
  schemaVersion?: number;
  schemaSha256?: string;
};

export class FileRuntimeStateImportConflictError extends Error {
  constructor(table: "price_refresh_attempts" | "usage_event_daily_counts") {
    super(`PostgreSQL ${table} contains data that differs from the reviewed file snapshot; no rows were changed.`);
    this.name = "FileRuntimeStateImportConflictError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function isoTimestamp(value: unknown, label: string, now: Date): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid timestamp string.`);
  const timestamp = new Date(value);
  if (timestamp.getTime() > now.getTime()) throw new Error(`${label} cannot be in the future.`);
  return timestamp.toISOString();
}

export function priceRefreshAttemptsFromUnknown(value: unknown, nowValue: Date = new Date()): PriceRefreshAttempt[] {
  if (!isRecord(value)) throw new Error("price-refresh-attempts.json must contain a JSON object map.");
  const now = nowValue.getTime();
  if (!Number.isFinite(now)) throw new Error("The import validation clock is invalid.");
  const attempts = Object.entries(value).map(([key, rawTimestamp]): PriceRefreshAttempt => {
    const delimiter = key.indexOf(":");
    if (delimiter < 1) throw new Error("price-refresh-attempts.json contains an invalid item key.");
    const kind = key.slice(0, delimiter);
    const itemId = key.slice(delimiter + 1);
    if (kind !== "part" && kind !== "accessory") throw new Error("price-refresh-attempts.json contains an unsupported item kind.");
    if (!itemId || itemId.length > MAX_ITEM_ID_LENGTH || itemId !== itemId.trim()) throw new Error("price-refresh-attempts.json contains an invalid item ID.");
    const attemptedAt = isoTimestamp(rawTimestamp, "A price refresh attempt timestamp", nowValue);
    return { kind, itemId, attemptedAt };
  });
  attempts.sort((left, right) => left.kind.localeCompare(right.kind) || left.itemId.localeCompare(right.itemId));
  return attempts;
}

function dayKey(value: string, now: Date): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("usage-events.json contains an invalid UTC day key.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("usage-events.json contains an invalid UTC calendar day.");
  if (value > now.toISOString().slice(0, 10)) throw new Error("usage-events.json contains a future daily bucket.");
  return value;
}

export function usageEventsFromUnknown(value: unknown, nowValue: Date = new Date()): { days: UsageDay[]; totalEvents: number } {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.daily)
    || Object.keys(value).some((key) => key !== "schemaVersion" && key !== "daily")) {
    throw new Error("usage-events.json must match the supported schemaVersion 1 store.");
  }
  const dailyEntries = Object.entries(value.daily);
  if (dailyEntries.length > MAX_DAILY_BUCKETS) throw new Error(`usage-events.json exceeds the ${MAX_DAILY_BUCKETS}-bucket retention limit.`);
  let totalEvents = 0;
  const days = dailyEntries.map(([rawDay, rawCounts]): UsageDay => {
    const parsedDay = dayKey(rawDay, nowValue);
    if (!isRecord(rawCounts)) throw new Error("usage-events.json contains a daily bucket that is not an object.");
    const counts: Partial<Record<UsageEventName, number>> = {};
    for (const [rawName, rawCount] of Object.entries(rawCounts)) {
      if (!(EVENT_NAMES as readonly string[]).includes(rawName)) throw new Error("usage-events.json contains an unsupported event name.");
      if (!Number.isSafeInteger(rawCount) || Number(rawCount) < 0 || Number(rawCount) > MAX_EVENT_COUNT) {
        throw new Error("usage-events.json event counts must be non-negative PostgreSQL integer values.");
      }
      counts[rawName as UsageEventName] = Number(rawCount);
      totalEvents += Number(rawCount);
    }
    return { dayUtc: parsedDay, counts };
  }).sort((left, right) => left.dayUtc.localeCompare(right.dayUtc));
  return { days, totalEvents };
}

async function readSourceFile<T>(path: string, readSource: (path: string) => Promise<Uint8Array>, parse: (value: unknown) => T) {
  let bytes: Uint8Array;
  try {
    bytes = await readSource(path);
  } catch {
    throw new Error(`Required runtime state file could not be read: ${path.split(/[\\/]/).at(-1) ?? "file"}.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error(`Runtime state file is not valid JSON: ${path.split(/[\\/]/).at(-1) ?? "file"}.`);
  }
  return { path, sha256: createHash("sha256").update(bytes).digest("hex"), value: parse(value) };
}

export async function readFileRuntimeStateSnapshot(
  attemptsPath: string,
  usagePath: string,
  options: { readSource?: (path: string) => Promise<Uint8Array>; now?: Date } = {}
): Promise<FileRuntimeStateSnapshot> {
  const readSource = options.readSource ?? (async (path) => readFile(path));
  const now = options.now ?? new Date();
  const attempts = await readSourceFile(attemptsPath, readSource, (value) => priceRefreshAttemptsFromUnknown(value, now));
  const parsedUsage = await readSourceFile(usagePath, readSource, (value) => usageEventsFromUnknown(value, now));
  return {
    attempts: { path: attempts.path, sha256: attempts.sha256, value: attempts.value as PriceRefreshAttempt[] },
    usage: { path: parsedUsage.path, sha256: parsedUsage.sha256, value: (parsedUsage.value as { days: UsageDay[] }).days },
    usageTotal: (parsedUsage.value as { totalEvents: number }).totalEvents
  };
}

function optionValue(args: string[], flag: string): string | undefined {
  const indices = args.flatMap((value, index) => value === flag ? [index] : []);
  if (indices.length > 1) throw new Error(`${flag} may be supplied only once.`);
  if (indices.length === 0) return undefined;
  const value = args[indices[0] + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseFileRuntimeStateImportOptions(args: string[]): ImportOptions {
  const knownFlags = new Set(["--dry-run", "--apply", "--price-attempts-file", "--usage-events-file", "--price-attempts-sha256", "--usage-events-sha256"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.startsWith("--") && !knownFlags.has(argument)) throw new Error("Unknown option. See import:file-runtime-state --help.");
    if (knownFlags.has(argument) && argument !== "--dry-run" && argument !== "--apply") index += 1;
  }
  const dryRun = args.includes("--dry-run");
  const apply = args.includes("--apply");
  if (dryRun === apply) throw new Error("Specify exactly one of --dry-run or --apply.");
  const attemptsPath = optionValue(args, "--price-attempts-file");
  const usagePath = optionValue(args, "--usage-events-file");
  if (!attemptsPath || !usagePath) throw new Error("Both --price-attempts-file and --usage-events-file are required.");
  const expectedAttemptsSha256 = optionValue(args, "--price-attempts-sha256")?.toLowerCase();
  const expectedUsageSha256 = optionValue(args, "--usage-events-sha256")?.toLowerCase();
  const shaPattern = /^[a-f0-9]{64}$/;
  if (dryRun && (expectedAttemptsSha256 || expectedUsageSha256)) throw new Error("Reviewed SHA-256 values are accepted only with --apply.");
  if (apply && (!expectedAttemptsSha256 || !shaPattern.test(expectedAttemptsSha256)
    || !expectedUsageSha256 || !shaPattern.test(expectedUsageSha256))) {
    throw new Error("--apply requires the reviewed SHA-256 for both source files.");
  }
  return {
    mode: apply ? "apply" : "dry-run",
    attemptsPath: resolve(attemptsPath),
    usagePath: resolve(usagePath),
    ...(expectedAttemptsSha256 ? { expectedAttemptsSha256 } : {}),
    ...(expectedUsageSha256 ? { expectedUsageSha256 } : {})
  };
}

function attemptsCanonical(value: PriceRefreshAttempt[]) {
  return canonicalJson([...value].sort((left, right) => left.kind.localeCompare(right.kind) || left.itemId.localeCompare(right.itemId)));
}

function usageCanonical(value: UsageDay[]) {
  return canonicalJson([...value].sort((left, right) => left.dayUtc.localeCompare(right.dayUtc)).map(({ dayUtc, counts }) => ({
    dayUtc,
    counts: Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
  })));
}

function rowsAsAttempts(rows: Array<{ item_kind: unknown; item_id: unknown; attempted_at: unknown }>) {
  return rows.map((row) => {
    if ((row.item_kind !== "part" && row.item_kind !== "accessory") || typeof row.item_id !== "string") throw new Error("PostgreSQL price_refresh_attempts readback is invalid.");
    const attemptedAt = new Date(row.attempted_at as string | Date);
    if (!Number.isFinite(attemptedAt.getTime())) throw new Error("PostgreSQL price_refresh_attempts readback has an invalid timestamp.");
    return { kind: row.item_kind, itemId: row.item_id, attemptedAt: attemptedAt.toISOString() } as PriceRefreshAttempt;
  });
}

function rowsAsUsage(rows: Array<{ day_utc: unknown; counts: unknown }>) {
  return rows.map((row) => {
    if (typeof row.day_utc !== "string" || !isRecord(row.counts)) throw new Error("PostgreSQL usage_event_daily_counts readback is invalid.");
    return { dayUtc: row.day_utc, counts: row.counts as Partial<Record<UsageEventName, number>> };
  });
}

async function readTargetState(client: PoolClient) {
  const [attempts, usage] = await Promise.all([
    client.query<{ item_kind: string; item_id: string; attempted_at: Date | string }>(
      "SELECT item_kind, item_id, attempted_at FROM price_refresh_attempts ORDER BY item_kind, item_id"
    ),
    client.query<{ day_utc: string; counts: unknown }>(
      "SELECT day_utc::text AS day_utc, counts FROM usage_event_daily_counts ORDER BY day_utc"
    )
  ]);
  return { attempts: rowsAsAttempts(attempts.rows), usage: rowsAsUsage(usage.rows) };
}

export async function importFileRuntimeStateWithClient(client: PoolClient, snapshot: FileRuntimeStateSnapshot) {
  let transactionStarted = false;
  let discardClient = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const database = await client.query<{ database_name: string }>("SELECT current_database() AS database_name");
    if (database.rows[0]?.database_name !== TARGET_DATABASE) throw new Error(`Runtime state import is restricted to the ${TARGET_DATABASE} database.`);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [IMPORT_LOCK]);
    const revision = await client.query<{ schema_version: number; schema_sha256: string }>(
      "SELECT schema_version, schema_sha256 FROM pc_supporter_schema_revision WHERE singleton_id = 'current'"
    );
    if (Number(revision.rows[0]?.schema_version) !== POSTGRES_SCHEMA_VERSION || revision.rows[0]?.schema_sha256 !== POSTGRES_SCHEMA_SHA256) {
      throw new Error("Canonical PostgreSQL schema is not current; run db:migrate before the import.");
    }

    const current = await readTargetState(client);
    const attemptsExact = attemptsCanonical(current.attempts) === attemptsCanonical(snapshot.attempts.value);
    const usageExact = usageCanonical(current.usage) === usageCanonical(snapshot.usage.value);
    if (current.attempts.length > 0 && !attemptsExact) throw new FileRuntimeStateImportConflictError("price_refresh_attempts");
    if (current.usage.length > 0 && !usageExact) throw new FileRuntimeStateImportConflictError("usage_event_daily_counts");

    if (!attemptsExact && snapshot.attempts.value.length > 0) {
      await client.query(
        `INSERT INTO price_refresh_attempts (item_kind, item_id, attempted_at)
         SELECT item_kind, item_id, attempted_at
         FROM UNNEST($1::text[], $2::text[], $3::timestamptz[]) AS input(item_kind, item_id, attempted_at)`,
        [snapshot.attempts.value.map((row) => row.kind), snapshot.attempts.value.map((row) => row.itemId), snapshot.attempts.value.map((row) => row.attemptedAt)]
      );
    }
    if (!usageExact) {
      for (const day of snapshot.usage.value) {
        await client.query(
          "INSERT INTO usage_event_daily_counts (day_utc, counts) VALUES ($1::date, $2::jsonb)",
          [day.dayUtc, JSON.stringify(day.counts)]
        );
      }
    }

    const readback = await readTargetState(client);
    if (attemptsCanonical(readback.attempts) !== attemptsCanonical(snapshot.attempts.value)
      || usageCanonical(readback.usage) !== usageCanonical(snapshot.usage.value)) {
      throw new Error("PostgreSQL runtime-state readback did not match the reviewed snapshot.");
    }
    await client.query("COMMIT");
    transactionStarted = false;
    return {
      targetDatabase: TARGET_DATABASE,
      schemaVersion: POSTGRES_SCHEMA_VERSION,
      schemaSha256: POSTGRES_SCHEMA_SHA256,
      priceRefreshAttempts: { records: readback.attempts.length, status: attemptsExact ? "unchanged" as const : "imported" as const },
      usageEvents: { dailyBuckets: readback.usage.length, status: usageExact ? "unchanged" as const : "imported" as const }
    };
  } catch (error: unknown) {
    if (transactionStarted) {
      try { await client.query("ROLLBACK"); } catch { discardClient = true; }
    } else {
      discardClient = true;
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}

function assertReviewedHash(actual: string, expected: string | undefined, label: string) {
  if (!expected || actual !== expected) throw new Error(`${label} does not match the reviewed SHA-256.`);
}

async function defaultCreatePool(connectionString: string): Promise<ImportPool> {
  const { Pool } = await import("pg");
  return new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 });
}

function safeDatabaseError(error: unknown): Error {
  if (error instanceof FileRuntimeStateImportConflictError) return error;
  if (error instanceof Error && /database is restricted|Canonical PostgreSQL schema|readback did not match/.test(error.message)) return error;
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "42P01") return new Error("Required PostgreSQL runtime-state tables are missing; run db:migrate first.");
  if (code === "23505") return new Error("PostgreSQL contains a conflicting runtime-state row; no rows were changed.");
  return new Error("PostgreSQL runtime-state import failed; its transaction was rolled back.");
}

export async function executeFileRuntimeStateImport(args: string[], dependencies: FileRuntimeStateImportDependencies = {}): Promise<FileRuntimeStateImportReport> {
  const options = parseFileRuntimeStateImportOptions(args);
  const snapshot = await readFileRuntimeStateSnapshot(options.attemptsPath, options.usagePath, {
    ...(dependencies.readSource ? { readSource: dependencies.readSource } : {}),
    ...(dependencies.now ? { now: dependencies.now() } : {})
  });
  const report: FileRuntimeStateImportReport = {
    ok: true,
    mode: options.mode,
    connectedToDatabase: false,
    priceRefreshAttempts: { file: "price-refresh-attempts.json", sha256: snapshot.attempts.sha256, records: snapshot.attempts.value.length },
    usageEvents: { file: "usage-events.json", sha256: snapshot.usage.sha256, dailyBuckets: snapshot.usage.value.length, totalEvents: snapshot.usageTotal }
  };
  if (options.mode === "dry-run") return report;
  assertReviewedHash(snapshot.attempts.sha256, options.expectedAttemptsSha256, "price-refresh-attempts.json");
  assertReviewedHash(snapshot.usage.sha256, options.expectedUsageSha256, "usage-events.json");
  const env = dependencies.env ?? process.env;
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for --apply.");

  let pool: ImportPool;
  try {
    pool = await (dependencies.createPool ?? defaultCreatePool)(databaseUrl);
  } catch {
    throw new Error("PostgreSQL connection could not be opened; connection details were not printed.");
  }
  try {
    const client = await pool.connect();
    const result = await importFileRuntimeStateWithClient(client, snapshot);
    report.connectedToDatabase = true;
    report.targetDatabase = result.targetDatabase;
    report.schemaVersion = result.schemaVersion;
    report.schemaSha256 = result.schemaSha256;
    report.priceRefreshAttempts.status = result.priceRefreshAttempts.status;
    report.usageEvents.status = result.usageEvents.status;
    return report;
  } catch (error: unknown) {
    throw safeDatabaseError(error);
  } finally {
    try { await pool.end(); } catch { /* Do not print driver or connection details. */ }
  }
}

export async function runFileRuntimeStateImportCommand(args: string[], dependencies: FileRuntimeStateImportDependencies = {}) {
  const writeStdout = dependencies.writeStdout ?? ((text: string) => { process.stdout.write(text); });
  const writeStderr = dependencies.writeStderr ?? ((text: string) => { process.stderr.write(text); });
  if (args.includes("--help") || args.includes("-h")) {
    writeStdout(`${[
      "Dry-run: npm run import:file-runtime-state -- --price-attempts-file /private/snapshot/price-refresh-attempts.json --usage-events-file /private/snapshot/usage-events.json --dry-run",
      "Apply:   npm run import:file-runtime-state -- --price-attempts-file /private/snapshot/price-refresh-attempts.json --usage-events-file /private/snapshot/usage-events.json --apply --price-attempts-sha256 <reviewed-sha256> --usage-events-sha256 <reviewed-sha256>"
    ].join("\n")}\n`);
    return 0;
  }
  if (args.includes("--verify-cutover-manifest")) {
    try {
      const knownFlags = new Set(["--verify-cutover-manifest", "--manifest-file", "--manifest-sha256"]);
      if (args.some((argument) => argument.startsWith("--") && !knownFlags.has(argument))) throw new Error("Unknown cutover manifest verification option.");
      const manifestPath = optionValue(args, "--manifest-file");
      const manifestSha256 = optionValue(args, "--manifest-sha256");
      if (!manifestPath || !manifestSha256) throw new Error("--verify-cutover-manifest requires --manifest-file and --manifest-sha256.");
      const report = await verifyPostgresCutoverManifestFile(manifestPath, manifestSha256.toLowerCase());
      writeStdout(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    } catch (error: unknown) {
      writeStderr(`${error instanceof Error ? error.message : "Cutover manifest verification failed."}\n`);
      return 1;
    }
  }
  try {
    const report = await executeFileRuntimeStateImport(args, dependencies);
    writeStdout(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } catch (error: unknown) {
    writeStderr(`${error instanceof Error ? error.message : "File runtime-state import failed."}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runFileRuntimeStateImportCommand(process.argv.slice(2)).then((exitCode) => { process.exitCode = exitCode; });
}
