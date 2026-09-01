import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { BenchmarkOverride, Part, PartCategory, PersistenceDiagnostics } from "../shared/types";
import { appendSavedBuildCheckHistory, savedBuildCheckHistoryFromUnknown, savedBuildCheckSnapshotFromUnknown, SAVED_BUILD_CHECK_HISTORY_LIMIT } from "../shared/saved-build-check";
import type { SavedBuildCheckSnapshot } from "../shared/types";
import { savedBuildMonitorSubscriptionFromUnknown } from "../shared/saved-build-monitor-subscription";
import type { SavedBuildMonitorSubscription } from "../shared/saved-build-monitor-subscription";
import { savedBuildVersionBackupDiffFor, savedBuildVersionGroupIdFor, savedBuildVersionMigratedBuildsFor, savedBuildVersionMigrationPreviewFor, savedBuildVersionNumberFor } from "../shared/saved-build-version";
import type { SavedBuildVersionBackupDetail, SavedBuildVersionBackupSummary, SavedBuildVersionMigrationPreview, SavedBuildVersionMigrationMutationResult, SavedBuildVersionMigrationRollbackResult } from "../shared/saved-build-version";
import type { SavedBuildRecord } from "./build-share";
import type { AssemblyVerificationSavedSnapshot } from "../shared/assembly-verification";
import { savedAlternativeComparisonFromUnknown, type SavedAlternativeComparisonRecord } from "./comparison-share";
import { savedBudgetLadderFromUnknown } from "./budget-ladder-share";
import type { SavedBudgetLadderRecord } from "../shared/budget-ladder-share";
import { savedCatalogWatchlistFromUnknown, savedWatchlistAlertPreferencesFromUnknown, type SavedWatchlistAlertPreferences } from "./watchlist-store";
import type { SavedCatalogWatchlistRecord } from "./watchlist-share";
import { savedWatchlistAlertStateFromUnknown, upsertSavedWatchlistAlertStates } from "./watchlist-alert-state";
import type { SavedWatchlistAlertState } from "./watchlist-alert-state";
import {
  BUILDS_PATH,
  SAVED_BUILD_VERSION_BACKUP_PATH,
  SAVED_BUILD_VERSION_LEASE_PATH,
  SAVED_BUILD_MONITOR_LEASE_PATH,
  BENCHMARK_OVERRIDES_PATH,
  CATALOG_PATH,
  COMPARISONS_PATH,
  BUDGET_LADDERS_PATH,
  WATCHLIST_ALERT_STATES_PATH,
  WATCHLISTS_PATH,
  readJson,
  withSerializedFileMutation,
  writeJson
} from "./storage";
import { withFileLease } from "./lease";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS catalog_parts (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  source_product_code TEXT,
  data_quality TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS catalog_parts_category_idx ON catalog_parts(category);
CREATE INDEX IF NOT EXISTS catalog_parts_quality_idx ON catalog_parts(data_quality);
CREATE TABLE IF NOT EXISTS benchmark_overrides (
  part_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS benchmark_overrides_updated_idx ON benchmark_overrides(updated_at DESC);
CREATE TABLE IF NOT EXISTS saved_builds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  selection JSONB NOT NULL,
  recommendation_preferences JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  owner_token_hash TEXT,
  version_group_id TEXT,
  version_number INTEGER,
  derived_from_build_id TEXT,
  check_snapshot JSONB,
  check_history JSONB,
  monitor_state JSONB
);
CREATE INDEX IF NOT EXISTS saved_builds_updated_idx ON saved_builds(updated_at DESC);
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS recommendation_preferences JSONB;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS owner_token_hash TEXT;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS version_group_id TEXT;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS version_number INTEGER;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS derived_from_build_id TEXT;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS check_snapshot JSONB;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS check_history JSONB;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS monitor_state JSONB;
CREATE TABLE IF NOT EXISTS saved_build_version_backups (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  source_fingerprint TEXT NOT NULL,
  resulting_fingerprint TEXT NOT NULL,
  changed_count INTEGER NOT NULL,
  builds JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS saved_build_version_backups_created_idx ON saved_build_version_backups(created_at DESC);
CREATE TABLE IF NOT EXISTS saved_watchlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  entries JSONB NOT NULL,
  near_low_threshold_percent INTEGER NOT NULL,
  alert_preferences JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  owner_token_hash TEXT
);
CREATE INDEX IF NOT EXISTS saved_watchlists_updated_idx ON saved_watchlists(updated_at DESC);
ALTER TABLE saved_watchlists ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE saved_watchlists ADD COLUMN IF NOT EXISTS owner_token_hash TEXT;
ALTER TABLE saved_watchlists ADD COLUMN IF NOT EXISTS alert_preferences JSONB;
CREATE TABLE IF NOT EXISTS saved_comparisons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  current_part_name TEXT,
  candidates JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  owner_token_hash TEXT
);
CREATE INDEX IF NOT EXISTS saved_comparisons_updated_idx ON saved_comparisons(updated_at DESC);
CREATE TABLE IF NOT EXISTS saved_budget_ladders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload JSONB NOT NULL,
  request JSONB,
  parent_id TEXT,
  lineage_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  catalog_snapshot_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  owner_token_hash TEXT
);
CREATE INDEX IF NOT EXISTS saved_budget_ladders_updated_idx ON saved_budget_ladders(updated_at DESC);
ALTER TABLE saved_budget_ladders ADD COLUMN IF NOT EXISTS parent_id TEXT;
ALTER TABLE saved_budget_ladders ADD COLUMN IF NOT EXISTS lineage_id TEXT;
ALTER TABLE saved_budget_ladders ADD COLUMN IF NOT EXISTS version_number INTEGER;
CREATE TABLE IF NOT EXISTS saved_watchlist_alert_states (
  watchlist_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (watchlist_id, alert_id)
);
CREATE INDEX IF NOT EXISTS saved_watchlist_alert_states_updated_idx ON saved_watchlist_alert_states(updated_at DESC);
`;

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function savedBuildVersionSnapshotFingerprintFor(builds: SavedBuildRecord[]) {
  return createHash("sha256").update(canonicalJson(builds)).digest("hex");
}

const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
let pool: Pool | null = configuredDatabaseUrl ? new Pool({ connectionString: configuredDatabaseUrl, max: 5 }) : null;
let databaseReady = false;
let databaseDisabled = false;
let schemaPromise: Promise<boolean> | null = null;

export type SavedBuildMonitorLeaseResult<T> =
  | { backend: "postgres" | "file"; acquired: true; value: T }
  | { backend: "postgres" | "file"; acquired: false };

async function ensureDatabase() {
  if (!pool || databaseDisabled) return false;
  if (databaseReady) return true;
  if (!schemaPromise) {
    schemaPromise = pool.query(SCHEMA_SQL)
      .then(() => {
        databaseReady = true;
        return true;
      })
      .catch((error) => {
        databaseDisabled = true;
        console.warn(`PostgreSQL unavailable; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      });
  }
  return schemaPromise;
}

export async function initializePersistence() {
  await ensureDatabase();
}

export async function withSavedBuildMonitorLease<T>(operation: () => Promise<T>, scope = "scheduler"): Promise<SavedBuildMonitorLeaseResult<T>> {
  if (await ensureDatabase()) {
    let client: PoolClient | undefined;
    let acquired = false;
    try {
      client = await pool!.connect();
      const result = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
        [`pc-supporter:saved-build-monitor:${scope}`]
      );
      acquired = result.rows[0]?.acquired === true;
    } catch (error: unknown) {
      client?.release();
      databaseDisabled = true;
      console.warn(`PostgreSQL monitor lease failed; using file lease instead: ${error instanceof Error ? error.message : String(error)}`);
      client = undefined;
    }
    if (client && !acquired) {
      client.release();
      return { backend: "postgres", acquired: false };
    }
    if (client && acquired) {
      try {
        return { backend: "postgres", acquired: true, value: await operation() };
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`pc-supporter:saved-build-monitor:${scope}`]).catch((error: unknown) => {
          console.warn(`PostgreSQL monitor lease release failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        client.release();
      }
    }
  }
  const fileLease = await withFileLease(SAVED_BUILD_MONITOR_LEASE_PATH, operation);
  return fileLease.acquired
    ? { backend: "file", acquired: true, value: fileLease.value }
    : { backend: "file", acquired: false };
}

export async function persistenceMode(): Promise<"postgres" | "file"> {
  return (await ensureDatabase()) ? "postgres" : "file";
}

export async function persistenceDiagnostics(): Promise<PersistenceDiagnostics> {
  const storageMode = await persistenceMode();
  return {
    databaseConfigured: Boolean(configuredDatabaseUrl),
    storageMode,
    ...(configuredDatabaseUrl && storageMode === "file" ? { fallbackReason: "database_unavailable" as const } : {})
  };
}

export async function readCatalogRecords(): Promise<Part[]> {
  if (await ensureDatabase()) {
    try {
      const result = await pool!.query<{ payload: Part }>("SELECT payload FROM catalog_parts ORDER BY updated_at DESC");
      return result.rows.map((row) => row.payload);
    } catch (error) {
      databaseDisabled = true;
      console.warn(`PostgreSQL catalog read failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return readJson<Part[]>(CATALOG_PATH, []);
}

export async function writeCatalogRecords(
  parts: Part[],
  options: { replaceDanawaCategories?: PartCategory[] } = {}
) {
  if (await ensureDatabase()) {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const replaceCategories = [...new Set(options.replaceDanawaCategories ?? [])];
      if (replaceCategories.length > 0) {
        await client.query(
          "DELETE FROM catalog_parts WHERE source = 'danawa' AND category = ANY($1::text[])",
          [replaceCategories]
        );
      }
      for (const part of parts) {
        await client.query(
          `INSERT INTO catalog_parts (id, category, source, source_product_code, data_quality, payload, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
           ON CONFLICT (id) DO UPDATE SET
             category = EXCLUDED.category,
             source = EXCLUDED.source,
             source_product_code = EXCLUDED.source_product_code,
             data_quality = EXCLUDED.data_quality,
             payload = EXCLUDED.payload,
             updated_at = EXCLUDED.updated_at`,
          [part.id, part.category, part.source, part.sourceProductCode ?? null, part.dataQuality, JSON.stringify(part), part.updatedAt]
        );
      }
      await client.query("COMMIT");
      return;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      databaseDisabled = true;
      console.warn(`PostgreSQL catalog write failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }
  await writeJson(CATALOG_PATH, parts);
}

async function readFileBenchmarkOverrideRecords(): Promise<Record<string, BenchmarkOverride>> {
  const raw = await readJson<unknown>(BENCHMARK_OVERRIDES_PATH, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, BenchmarkOverride> : {};
}

export async function readBenchmarkOverrideRecords(): Promise<Record<string, BenchmarkOverride>> {
  if (await ensureDatabase()) {
    try {
      const result = await pool!.query<{ part_id: string; payload: BenchmarkOverride }>(
        "SELECT part_id, payload FROM benchmark_overrides ORDER BY updated_at DESC"
      );
      if (result.rows.length > 0) return Object.fromEntries(result.rows.map((row) => [row.part_id, row.payload]));
      const fileOverrides = await readFileBenchmarkOverrideRecords();
      if (Object.keys(fileOverrides).length > 0) {
        await writeBenchmarkOverrideRecords(fileOverrides);
        return fileOverrides;
      }
      return {};
    } catch (error) {
      databaseDisabled = true;
      console.warn(`PostgreSQL benchmark override read failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return readFileBenchmarkOverrideRecords();
}

export async function writeBenchmarkOverrideRecords(overrides: Record<string, BenchmarkOverride>) {
  const values = Object.values(overrides);
  if (await ensureDatabase()) {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (values.length === 0) {
        await client.query("DELETE FROM benchmark_overrides");
      } else {
        await client.query("DELETE FROM benchmark_overrides WHERE NOT (part_id = ANY($1::text[]))", [values.map((value) => value.partId)]);
      }
      for (const override of values) {
        await client.query(
          `INSERT INTO benchmark_overrides (part_id, payload, updated_at)
           VALUES ($1, $2::jsonb, $3::timestamptz)
           ON CONFLICT (part_id) DO UPDATE SET
             payload = EXCLUDED.payload,
             updated_at = EXCLUDED.updated_at`,
          [override.partId, JSON.stringify(override), override.updatedAt]
        );
      }
      await client.query("COMMIT");
      return;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      databaseDisabled = true;
      console.warn(`PostgreSQL benchmark override write failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }
  await writeJson(BENCHMARK_OVERRIDES_PATH, overrides);
}

type SavedBuildDatabaseRow = {
  id: string;
  name: string;
  selection: SavedBuildRecord["selection"];
  recommendation_preferences: SavedBuildRecord["recommendationPreferences"] | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  owner_token_hash: string | null;
  version_group_id: string | null;
  version_number: number | null;
  derived_from_build_id: string | null;
  check_snapshot: SavedBuildRecord["checkSnapshot"] | null;
  check_history: SavedBuildRecord["checkHistory"] | null;
  monitor_state: SavedBuildMonitorSubscription | null;
};

type SavedBudgetLadderDatabaseRow = {
  id: string;
  name: string;
  payload: SavedBudgetLadderRecord["payload"];
  request: SavedBudgetLadderRecord["request"] | null;
  parent_id: string | null;
  lineage_id: string | null;
  version_number: number | null;
  catalog_snapshot_at: Date;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  owner_token_hash: string | null;
};

export function savedBuildRecordFromUnknown(value: unknown): SavedBuildRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<SavedBuildRecord>;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || !candidate.selection || typeof candidate.selection !== "object" || typeof candidate.createdAt !== "string" || typeof candidate.updatedAt !== "string") return undefined;
  const ownerTokenHash = typeof candidate.ownerTokenHash === "string" && /^[0-9a-f]{64}$/.test(candidate.ownerTokenHash) ? candidate.ownerTokenHash : undefined;
  const explicitSnapshot = savedBuildCheckSnapshotFromUnknown(candidate.checkSnapshot);
  const parsedHistory = savedBuildCheckHistoryFromUnknown(candidate.checkHistory);
  const checkHistory = explicitSnapshot && (parsedHistory.length === 0 || parsedHistory[parsedHistory.length - 1].checkedAt !== explicitSnapshot.checkedAt)
    ? [...parsedHistory, explicitSnapshot].slice(-SAVED_BUILD_CHECK_HISTORY_LIMIT)
    : parsedHistory;
  const checkSnapshot = explicitSnapshot ?? checkHistory[checkHistory.length - 1];
  const monitorState = savedBuildMonitorSubscriptionFromUnknown(candidate.monitorState);
  const versionGroupId = typeof candidate.versionGroupId === "string" && candidate.versionGroupId.length > 0 && candidate.versionGroupId.length <= 120 ? candidate.versionGroupId : undefined;
  const versionNumber = Number.isInteger(candidate.versionNumber) && (candidate.versionNumber ?? 0) >= 1 && (candidate.versionNumber ?? 0) <= 1_000_000 ? candidate.versionNumber : undefined;
  const derivedFromBuildId = typeof candidate.derivedFromBuildId === "string" && candidate.derivedFromBuildId.length > 0 && candidate.derivedFromBuildId.length <= 120 ? candidate.derivedFromBuildId : undefined;
  const { ownerTokenHash: _rawOwnerTokenHash, versionGroupId: _rawVersionGroupId, versionNumber: _rawVersionNumber, derivedFromBuildId: _rawDerivedFromBuildId, checkSnapshot: _rawCheckSnapshot, checkHistory: _rawCheckHistory, monitorState: _rawMonitorState, ...build } = candidate as SavedBuildRecord;
  return { ...build, ...(ownerTokenHash ? { ownerTokenHash } : {}), ...(versionGroupId ? { versionGroupId } : {}), ...(versionNumber ? { versionNumber } : {}), ...(derivedFromBuildId ? { derivedFromBuildId } : {}), ...(checkSnapshot ? { checkSnapshot } : {}), ...(checkHistory.length > 0 ? { checkHistory } : {}), ...(monitorState ? { monitorState } : {}) };
}

function savedBuildRecordFromDatabaseRow(row: SavedBuildDatabaseRow) {
  return savedBuildRecordFromUnknown({
    id: row.id,
    name: row.name,
    selection: row.selection,
    recommendationPreferences: row.recommendation_preferences ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {}),
    ...(row.version_group_id ? { versionGroupId: row.version_group_id } : {}),
    ...(row.version_number ? { versionNumber: row.version_number } : {}),
    ...(row.derived_from_build_id ? { derivedFromBuildId: row.derived_from_build_id } : {}),
    ...(row.check_snapshot ? { checkSnapshot: row.check_snapshot } : {}),
    ...(row.check_history ? { checkHistory: row.check_history } : {}),
    ...(row.monitor_state ? { monitorState: row.monitor_state } : {})
  });
}

export async function readSavedBuilds(): Promise<SavedBuildRecord[]> {
  if (await ensureDatabase()) {
    try {
      const result = await pool!.query<SavedBuildDatabaseRow>(
        "SELECT id, name, selection, recommendation_preferences, created_at, updated_at, expires_at, owner_token_hash, version_group_id, version_number, derived_from_build_id, check_snapshot, check_history, monitor_state FROM saved_builds ORDER BY updated_at DESC"
      );
      return result.rows.map(savedBuildRecordFromDatabaseRow).filter((value): value is SavedBuildRecord => value !== undefined);
    } catch (error) {
      databaseDisabled = true;
      console.warn(`PostgreSQL build read failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const raw = await readJson<unknown[]>(BUILDS_PATH, []);
  return raw.map(savedBuildRecordFromUnknown).filter((value): value is SavedBuildRecord => value !== undefined);
}

export async function writeSavedBuilds(builds: SavedBuildRecord[]) {
  if (await ensureDatabase()) {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (builds.length === 0) {
        await client.query("DELETE FROM saved_builds");
      } else {
        await client.query("DELETE FROM saved_builds WHERE NOT (id = ANY($1::text[]))", [builds.map((build) => build.id)]);
      }
      for (const build of builds) {
        await client.query(
          `INSERT INTO saved_builds (id, name, selection, recommendation_preferences, created_at, updated_at, expires_at, owner_token_hash, version_group_id, version_number, derived_from_build_id, check_snapshot, check_history, monitor_state)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::timestamptz, $6::timestamptz, $7::timestamptz, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             selection = EXCLUDED.selection,
             recommendation_preferences = EXCLUDED.recommendation_preferences,
             updated_at = EXCLUDED.updated_at,
             expires_at = EXCLUDED.expires_at,
             owner_token_hash = EXCLUDED.owner_token_hash,
             version_group_id = EXCLUDED.version_group_id,
             version_number = EXCLUDED.version_number,
             derived_from_build_id = EXCLUDED.derived_from_build_id,
             check_snapshot = EXCLUDED.check_snapshot,
             check_history = EXCLUDED.check_history,
             monitor_state = EXCLUDED.monitor_state`,
          [build.id, build.name, JSON.stringify(build.selection), build.recommendationPreferences ? JSON.stringify(build.recommendationPreferences) : null, build.createdAt, build.updatedAt, build.expiresAt ?? null, build.ownerTokenHash ?? null, build.versionGroupId ?? null, build.versionNumber ?? null, build.derivedFromBuildId ?? null, build.checkSnapshot ? JSON.stringify(build.checkSnapshot) : null, build.checkHistory ? JSON.stringify(build.checkHistory) : null, build.monitorState ? JSON.stringify(build.monitorState) : null]
        );
      }
      await client.query("COMMIT");
      return;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      databaseDisabled = true;
      console.warn(`PostgreSQL build write failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }
  await writeJson(BUILDS_PATH, builds);
}

function savedBuildWithNextVersionFor(build: SavedBuildRecord, existingBuilds: SavedBuildRecord[]) {
  const versionGroupId = savedBuildVersionGroupIdFor(build);
  const maxVersion = existingBuilds
    .filter((existing) => savedBuildVersionGroupIdFor(existing) === versionGroupId)
    .reduce((max, existing) => Math.max(max, savedBuildVersionNumberFor(existing)), 0);
  return { ...build, versionGroupId, versionNumber: maxVersion + 1 } satisfies SavedBuildRecord;
}

async function appendSavedBuildToDatabase(build: SavedBuildRecord, max: number) {
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const versionGroupId = savedBuildVersionGroupIdFor(build);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`pc-supporter:saved-build-version:${versionGroupId}`]);
    const result = await client.query<{ max_version: number | string | null }>(
      "SELECT COALESCE(MAX(COALESCE(version_number, 1)), 0) AS max_version FROM saved_builds WHERE version_group_id = $1 OR (version_group_id IS NULL AND id = $1)",
      [versionGroupId]
    );
    const nextVersion = Number(result.rows[0]?.max_version ?? 0) + 1;
    const next = { ...build, versionGroupId, versionNumber: nextVersion } satisfies SavedBuildRecord;
    await client.query(
      `INSERT INTO saved_builds (id, name, selection, recommendation_preferences, created_at, updated_at, expires_at, owner_token_hash, version_group_id, version_number, derived_from_build_id, check_snapshot, check_history, monitor_state)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::timestamptz, $6::timestamptz, $7::timestamptz, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb)`,
      [next.id, next.name, JSON.stringify(next.selection), next.recommendationPreferences ? JSON.stringify(next.recommendationPreferences) : null, next.createdAt, next.updatedAt, next.expiresAt ?? null, next.ownerTokenHash ?? null, next.versionGroupId, next.versionNumber, next.derivedFromBuildId ?? null, next.checkSnapshot ? JSON.stringify(next.checkSnapshot) : null, next.checkHistory ? JSON.stringify(next.checkHistory) : null, next.monitorState ? JSON.stringify(next.monitorState) : null]
    );
    const boundedMax = Math.max(1, Math.floor(max));
    const stale = await client.query<{ id: string }>("SELECT id FROM saved_builds ORDER BY updated_at DESC, id DESC OFFSET $1", [boundedMax]);
    if (stale.rows.length > 0) await client.query("DELETE FROM saved_builds WHERE id = ANY($1::text[])", [stale.rows.map((row) => row.id)]);
    await client.query("COMMIT");
    return next;
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendSavedBuild(build: SavedBuildRecord, max = 100) {
  const boundedMax = Math.max(1, Math.floor(max));
  if (await ensureDatabase()) {
    try {
      return await appendSavedBuildToDatabase(build, boundedMax);
    } catch (error: unknown) {
      databaseDisabled = true;
      console.warn(`PostgreSQL versioned build write failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const fileLease = await withSerializedFileMutation(BUILDS_PATH, () => withFileLease(SAVED_BUILD_VERSION_LEASE_PATH, async () => {
    const builds = await readSavedBuilds();
    const next = savedBuildWithNextVersionFor(build, builds);
    await writeJson(BUILDS_PATH, [next, ...builds].slice(0, boundedMax));
    return next;
  }));
  if (!fileLease.acquired) throw new Error("다른 저장 요청이 버전 번호를 발급 중입니다. 잠시 후 다시 시도해 주세요.");
  return fileLease.value;
}

type SavedBuildVersionBackup = {
  id: string;
  createdAt: string;
  sourceFingerprint: string;
  resultingFingerprint: string;
  changedCount: number;
  builds: SavedBuildRecord[];
};

export type SavedBuildVersionMigrationOperation =
  | SavedBuildVersionMigrationMutationResult
  | { status: "conflict"; expectedFingerprint: string; actualFingerprint: string; totalBuilds: number }
  | { status: "blocked"; sourceFingerprint: string; preview: SavedBuildVersionMigrationPreview };

export type SavedBuildVersionRollbackOperation =
  | SavedBuildVersionMigrationRollbackResult
  | { status: "conflict"; backupId: string; expectedFingerprint: string; actualFingerprint: string }
  | { status: "not_found"; backupId: string };

const SAVED_BUILD_VERSION_MIGRATION_LOCK = "pc-supporter:saved-build-version-migration";
const SAVED_BUILD_VERSION_BACKUP_RETENTION = 5;

function savedBuildVersionBackupFromUnknown(value: unknown): SavedBuildVersionBackup | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<SavedBuildVersionBackup>;
  const changedCount = candidate.changedCount;
  if (typeof candidate.id !== "string" || typeof candidate.createdAt !== "string" || typeof candidate.sourceFingerprint !== "string" || typeof candidate.resultingFingerprint !== "string" || typeof changedCount !== "number" || !Number.isInteger(changedCount) || changedCount < 1 || !Array.isArray(candidate.builds)) return undefined;
  const builds = candidate.builds.map(savedBuildRecordFromUnknown).filter((build): build is SavedBuildRecord => build !== undefined);
  return builds.length === candidate.builds.length ? { id: candidate.id, createdAt: candidate.createdAt, sourceFingerprint: candidate.sourceFingerprint, resultingFingerprint: candidate.resultingFingerprint, changedCount, builds } : undefined;
}

function savedBuildVersionBackupsFromUnknown(value: unknown): SavedBuildVersionBackup[] {
  const rawItems = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : value === undefined
        ? []
        : [value];
  return rawItems.map(savedBuildVersionBackupFromUnknown).filter((backup): backup is SavedBuildVersionBackup => backup !== undefined);
}

function savedBuildVersionBackupSummaryFor(backup: SavedBuildVersionBackup, currentFingerprint: string): SavedBuildVersionBackupSummary {
  return { backupId: backup.id, createdAt: backup.createdAt, totalBuilds: backup.builds.length, changedCount: backup.changedCount, sourceFingerprint: backup.sourceFingerprint, resultingFingerprint: backup.resultingFingerprint, rollbackAvailable: currentFingerprint === backup.resultingFingerprint };
}

function savedBuildVersionBackupDetailFor(backup: SavedBuildVersionBackup, currentFingerprint: string): SavedBuildVersionBackupDetail {
  return { ...savedBuildVersionBackupSummaryFor(backup, currentFingerprint), currentFingerprint, items: savedBuildVersionBackupDiffFor(backup.builds) };
}

export async function readSavedBuildVersionBackups(): Promise<SavedBuildVersionBackupSummary[]> {
  if (await ensureDatabase()) {
    try {
      const result = await pool!.query<{ id: string; created_at: Date; source_fingerprint: string; resulting_fingerprint: string; changed_count: number | string; total_builds: number | string }>(
        "SELECT id, created_at, source_fingerprint, resulting_fingerprint, changed_count, jsonb_array_length(builds) AS total_builds FROM saved_build_version_backups ORDER BY created_at DESC LIMIT $1",
        [SAVED_BUILD_VERSION_BACKUP_RETENTION]
      );
      const currentFingerprint = savedBuildVersionSnapshotFingerprintFor(await readSavedBuilds());
      return result.rows.map((row) => ({ backupId: row.id, createdAt: new Date(row.created_at).toISOString(), totalBuilds: Number(row.total_builds), changedCount: Number(row.changed_count), sourceFingerprint: row.source_fingerprint, resultingFingerprint: row.resulting_fingerprint, rollbackAvailable: currentFingerprint === row.resulting_fingerprint }));
    } catch (error: unknown) {
      databaseDisabled = true;
      console.warn(`PostgreSQL version backup read failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const backups = savedBuildVersionBackupsFromUnknown(await readJson<unknown>(SAVED_BUILD_VERSION_BACKUP_PATH, undefined))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  if (backups.length === 0) return [];
  const currentFingerprint = savedBuildVersionSnapshotFingerprintFor(await readSavedBuilds());
  return backups.slice(0, SAVED_BUILD_VERSION_BACKUP_RETENTION).map((backup) => savedBuildVersionBackupSummaryFor(backup, currentFingerprint));
}

export async function readLatestSavedBuildVersionBackup(): Promise<SavedBuildVersionBackupSummary | undefined> {
  return (await readSavedBuildVersionBackups())[0];
}

export async function readSavedBuildVersionBackupDetail(backupId: string): Promise<SavedBuildVersionBackupDetail | undefined> {
  if (await ensureDatabase()) {
    try {
      const result = await pool!.query<{ id: string; created_at: Date; source_fingerprint: string; resulting_fingerprint: string; changed_count: number | string; builds: unknown }>(
        "SELECT id, created_at, source_fingerprint, resulting_fingerprint, changed_count, builds FROM saved_build_version_backups WHERE id = $1",
        [backupId]
      );
      const row = result.rows[0];
      if (!row) return undefined;
      const backup = savedBuildVersionBackupFromUnknown({ id: row.id, createdAt: new Date(row.created_at).toISOString(), sourceFingerprint: row.source_fingerprint, resultingFingerprint: row.resulting_fingerprint, changedCount: Number(row.changed_count), builds: row.builds });
      if (!backup) return undefined;
      const currentFingerprint = savedBuildVersionSnapshotFingerprintFor(await readSavedBuilds());
      return savedBuildVersionBackupDetailFor(backup, currentFingerprint);
    } catch (error: unknown) {
      databaseDisabled = true;
      console.warn(`PostgreSQL version backup detail read failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const backup = savedBuildVersionBackupsFromUnknown(await readJson<unknown>(SAVED_BUILD_VERSION_BACKUP_PATH, undefined)).find((candidate) => candidate.id === backupId);
  if (!backup) return undefined;
  return savedBuildVersionBackupDetailFor(backup, savedBuildVersionSnapshotFingerprintFor(await readSavedBuilds()));
}

async function readSavedBuildsWithDatabaseClient(client: PoolClient) {
  const result = await client.query<SavedBuildDatabaseRow>(
    "SELECT id, name, selection, recommendation_preferences, created_at, updated_at, expires_at, owner_token_hash, version_group_id, version_number, derived_from_build_id, check_snapshot, check_history, monitor_state FROM saved_builds ORDER BY updated_at DESC"
  );
  const builds = result.rows.map(savedBuildRecordFromDatabaseRow).filter((value): value is SavedBuildRecord => value !== undefined);
  if (builds.length !== result.rows.length) throw new Error("저장 견적 데이터 일부를 안전하게 해석할 수 없어 마이그레이션을 중단했습니다.");
  return builds;
}

async function migrateSavedBuildVersionsInDatabase(expectedFingerprint: string): Promise<SavedBuildVersionMigrationOperation> {
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [SAVED_BUILD_VERSION_MIGRATION_LOCK]);
    await client.query("LOCK TABLE saved_builds IN ACCESS EXCLUSIVE MODE");
    const builds = await readSavedBuildsWithDatabaseClient(client);
    const sourceFingerprint = savedBuildVersionSnapshotFingerprintFor(builds);
    if (sourceFingerprint !== expectedFingerprint) {
      await client.query("ROLLBACK");
      return { status: "conflict", expectedFingerprint, actualFingerprint: sourceFingerprint, totalBuilds: builds.length };
    }
    const preview = savedBuildVersionMigrationPreviewFor(builds);
    if (preview.status !== "ready") {
      await client.query("ROLLBACK");
      return { status: "blocked", sourceFingerprint, preview };
    }
    const migrated = savedBuildVersionMigratedBuildsFor(builds);
    if (!migrated || preview.changedCount === 0) {
      await client.query("COMMIT");
      return { status: "noop", totalBuilds: builds.length, changedCount: 0, sourceFingerprint, resultingFingerprint: sourceFingerprint };
    }
    const backupId = randomUUID();
    const createdAt = new Date().toISOString();
    const resultingFingerprint = savedBuildVersionSnapshotFingerprintFor(migrated);
    await client.query(
      "INSERT INTO saved_build_version_backups (id, created_at, source_fingerprint, resulting_fingerprint, changed_count, builds) VALUES ($1, $2::timestamptz, $3, $4, $5, $6::jsonb)",
      [backupId, createdAt, sourceFingerprint, resultingFingerprint, preview.changedCount, JSON.stringify(builds)]
    );
    for (const build of migrated) {
      await client.query("UPDATE saved_builds SET version_group_id = $1, version_number = $2 WHERE id = $3", [build.versionGroupId ?? null, build.versionNumber ?? null, build.id]);
    }
    await client.query("DELETE FROM saved_build_version_backups WHERE id NOT IN (SELECT id FROM saved_build_version_backups ORDER BY created_at DESC LIMIT $1)", [SAVED_BUILD_VERSION_BACKUP_RETENTION]);
    await client.query("COMMIT");
    return { status: "applied", backupId, totalBuilds: builds.length, changedCount: preview.changedCount, sourceFingerprint, resultingFingerprint };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function rollbackSavedBuildVersionsInDatabase(backupId: string, expectedFingerprint: string): Promise<SavedBuildVersionRollbackOperation> {
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [SAVED_BUILD_VERSION_MIGRATION_LOCK]);
    await client.query("LOCK TABLE saved_builds IN ACCESS EXCLUSIVE MODE");
    const backupResult = await client.query<{ id: string; source_fingerprint: string; resulting_fingerprint: string; changed_count: number; builds: unknown }>(
      "SELECT id, source_fingerprint, resulting_fingerprint, changed_count, builds FROM saved_build_version_backups WHERE id = $1",
      [backupId]
    );
    const backupRow = backupResult.rows[0];
    if (!backupRow) {
      await client.query("ROLLBACK");
      return { status: "not_found", backupId };
    }
    const builds = await readSavedBuildsWithDatabaseClient(client);
    const actualFingerprint = savedBuildVersionSnapshotFingerprintFor(builds);
    if (actualFingerprint !== expectedFingerprint || actualFingerprint !== backupRow.resulting_fingerprint) {
      await client.query("ROLLBACK");
      return { status: "conflict", backupId, expectedFingerprint, actualFingerprint };
    }
    const backupBuilds = Array.isArray(backupRow.builds) ? backupRow.builds.map(savedBuildRecordFromUnknown).filter((build): build is SavedBuildRecord => build !== undefined) : [];
    if (backupBuilds.length !== builds.length) throw new Error("백업과 현재 저장 견적 수가 달라 rollback을 중단했습니다.");
    const currentIds = new Set(builds.map((build) => build.id));
    if (backupBuilds.some((build) => !currentIds.has(build.id))) throw new Error("백업과 현재 저장 견적 ID가 달라 rollback을 중단했습니다.");
    for (const build of backupBuilds) {
      await client.query("UPDATE saved_builds SET version_group_id = $1, version_number = $2, derived_from_build_id = $3 WHERE id = $4", [build.versionGroupId ?? null, build.versionNumber ?? null, build.derivedFromBuildId ?? null, build.id]);
    }
    await client.query("COMMIT");
    return { status: "rolled_back", backupId, totalBuilds: backupBuilds.length, changedCount: backupRow.changed_count, sourceFingerprint: backupRow.source_fingerprint, resultingFingerprint: backupRow.source_fingerprint };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function migrateSavedBuildVersions(expectedFingerprint: string): Promise<SavedBuildVersionMigrationOperation> {
  if (await ensureDatabase()) return migrateSavedBuildVersionsInDatabase(expectedFingerprint);
  const fileLease = await withSerializedFileMutation(BUILDS_PATH, () => withFileLease(SAVED_BUILD_VERSION_LEASE_PATH, async () => {
    const builds = await readSavedBuilds();
    const sourceFingerprint = savedBuildVersionSnapshotFingerprintFor(builds);
    if (sourceFingerprint !== expectedFingerprint) return { status: "conflict", expectedFingerprint, actualFingerprint: sourceFingerprint, totalBuilds: builds.length } satisfies SavedBuildVersionMigrationOperation;
    const preview = savedBuildVersionMigrationPreviewFor(builds);
    if (preview.status !== "ready") return { status: "blocked", sourceFingerprint, preview } satisfies SavedBuildVersionMigrationOperation;
    const migrated = savedBuildVersionMigratedBuildsFor(builds);
    if (!migrated || preview.changedCount === 0) return { status: "noop", totalBuilds: builds.length, changedCount: 0, sourceFingerprint, resultingFingerprint: sourceFingerprint } satisfies SavedBuildVersionMigrationOperation;
    const backupId = randomUUID();
    const createdAt = new Date().toISOString();
    const resultingFingerprint = savedBuildVersionSnapshotFingerprintFor(migrated);
    const backup: SavedBuildVersionBackup = { id: backupId, createdAt, sourceFingerprint, resultingFingerprint, changedCount: preview.changedCount, builds };
    const existingBackups = savedBuildVersionBackupsFromUnknown(await readJson<unknown>(SAVED_BUILD_VERSION_BACKUP_PATH, undefined));
    await writeJson(SAVED_BUILD_VERSION_BACKUP_PATH, [backup, ...existingBackups].slice(0, SAVED_BUILD_VERSION_BACKUP_RETENTION));
    await writeJson(BUILDS_PATH, migrated);
    return { status: "applied", backupId, totalBuilds: builds.length, changedCount: preview.changedCount, sourceFingerprint, resultingFingerprint } satisfies SavedBuildVersionMigrationOperation;
  }));
  if (!fileLease.acquired) throw new Error("다른 저장 요청이 버전 번호를 발급 중입니다. 잠시 후 다시 시도해 주세요.");
  return fileLease.value;
}

export async function rollbackSavedBuildVersions(backupId: string, expectedFingerprint: string): Promise<SavedBuildVersionRollbackOperation> {
  if (await ensureDatabase()) return rollbackSavedBuildVersionsInDatabase(backupId, expectedFingerprint);
  const fileLease = await withSerializedFileMutation(BUILDS_PATH, () => withFileLease(SAVED_BUILD_VERSION_LEASE_PATH, async () => {
    const backup = savedBuildVersionBackupsFromUnknown(await readJson<unknown>(SAVED_BUILD_VERSION_BACKUP_PATH, undefined)).find((candidate) => candidate.id === backupId);
    if (!backup) return { status: "not_found", backupId } satisfies SavedBuildVersionRollbackOperation;
    const builds = await readSavedBuilds();
    const actualFingerprint = savedBuildVersionSnapshotFingerprintFor(builds);
    if (actualFingerprint !== expectedFingerprint || actualFingerprint !== backup.resultingFingerprint) return { status: "conflict", backupId, expectedFingerprint, actualFingerprint } satisfies SavedBuildVersionRollbackOperation;
    await writeJson(BUILDS_PATH, backup.builds);
    return { status: "rolled_back", backupId, totalBuilds: backup.builds.length, changedCount: backup.changedCount, sourceFingerprint: backup.sourceFingerprint, resultingFingerprint: backup.sourceFingerprint } satisfies SavedBuildVersionRollbackOperation;
  }));
  if (!fileLease.acquired) throw new Error("다른 저장 요청이 진행 중입니다. 잠시 후 다시 시도해 주세요.");
  return fileLease.value;
}

export async function appendSavedBuildCheck(id: string, snapshot: SavedBuildCheckSnapshot, max = 20) {
  return withSerializedFileMutation(BUILDS_PATH, async () => {
    const builds = await readSavedBuilds();
    const current = builds.find((build) => build.id === id);
    if (!current) return undefined;
    const existingHistory = current.checkHistory ?? (current.checkSnapshot ? [current.checkSnapshot] : []);
    const nextSnapshot = snapshot.assemblyVerification || !current.checkSnapshot?.assemblyVerification
      ? snapshot
      : {
          ...snapshot,
          assemblyVerification: current.checkSnapshot.assemblyVerification,
          ...(current.checkSnapshot.assemblyVerificationHistory ? { assemblyVerificationHistory: current.checkSnapshot.assemblyVerificationHistory } : {})
        };
    const checkHistory = appendSavedBuildCheckHistory(existingHistory, nextSnapshot, max);
    const next = { ...current, checkSnapshot: nextSnapshot, checkHistory };
    await writeSavedBuilds(builds.map((build) => build.id === id ? next : build));
    return next;
  });
}

export async function updateSavedBuildAssemblyVerification(id: string, verification: AssemblyVerificationSavedSnapshot, verificationHistory: AssemblyVerificationSavedSnapshot[] = [verification]) {
  return withSerializedFileMutation(BUILDS_PATH, async () => {
    const builds = await readSavedBuilds();
    const current = builds.find((build) => build.id === id);
    if (!current) return undefined;
    const existingHistory = current.checkHistory ?? (current.checkSnapshot ? [current.checkSnapshot] : []);
    const currentSnapshot = current.checkSnapshot ?? existingHistory.at(-1);
    if (!currentSnapshot) return undefined;
    const nextSnapshot = { ...currentSnapshot, assemblyVerification: verification, assemblyVerificationHistory: verificationHistory };
    const checkHistory = existingHistory.length > 0
      ? existingHistory.map((snapshot, index) => index === existingHistory.length - 1 ? { ...snapshot, assemblyVerification: verification, assemblyVerificationHistory: verificationHistory } : snapshot)
      : [nextSnapshot];
    const next = { ...current, checkSnapshot: nextSnapshot, checkHistory };
    await writeSavedBuilds(builds.map((build) => build.id === id ? next : build));
    return next;
  });
}

export async function updateSavedBuildMonitorState(id: string, monitorState: SavedBuildMonitorSubscription) {
  if (await ensureDatabase()) {
    try {
      const result = await pool!.query(
        "UPDATE saved_builds SET monitor_state = $2::jsonb WHERE id = $1",
        [id, JSON.stringify(monitorState)]
      );
      if ((result.rowCount ?? 0) === 0) return undefined;
      return (await readSavedBuilds()).find((build) => build.id === id);
    } catch (error) {
      databaseDisabled = true;
      console.warn(`PostgreSQL build monitor update failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return withSerializedFileMutation(BUILDS_PATH, async () => {
    const builds = await readSavedBuilds();
    const current = builds.find((build) => build.id === id);
    if (!current) return undefined;
    const next = { ...current, monitorState };
    await writeSavedBuilds(builds.map((build) => build.id === id ? next : build));
    return next;
  });
}

export async function deleteSavedBuild(id: string) {
  return withSerializedFileMutation(BUILDS_PATH, async () => {
    if (await ensureDatabase()) {
      try {
        const result = await pool!.query("DELETE FROM saved_builds WHERE id = $1", [id]);
        return (result.rowCount ?? 0) > 0;
      } catch (error) {
        databaseDisabled = true;
        console.warn(`PostgreSQL build delete failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const builds = await readSavedBuilds();
    const next = builds.filter((build) => build.id !== id);
    if (next.length === builds.length) return false;
    await writeJson(BUILDS_PATH, next);
    return true;
  });
}

function savedWatchlistRecordFromUnknown(value: unknown): SavedCatalogWatchlistRecord | undefined {
  const normalized = savedCatalogWatchlistFromUnknown(value);
  if (!normalized || !value || typeof value !== "object" || Array.isArray(value)) return normalized;
  const candidate = value as { ownerTokenHash?: unknown };
  const ownerTokenHash = typeof candidate.ownerTokenHash === "string" && /^[0-9a-f]{64}$/.test(candidate.ownerTokenHash) ? candidate.ownerTokenHash : undefined;
  return { ...normalized, ...(ownerTokenHash ? { ownerTokenHash } : {}) };
}

export async function readSavedWatchlists(): Promise<SavedCatalogWatchlistRecord[]> {
  if (await ensureDatabase()) {
    try {
      const result = await pool!.query<{ id: string; name: string; entries: SavedCatalogWatchlistRecord["entries"]; near_low_threshold_percent: 5 | 10 | 20; alert_preferences: SavedWatchlistAlertPreferences | null; created_at: Date; updated_at: Date; expires_at: Date | null; owner_token_hash: string | null }>(
        "SELECT id, name, entries, near_low_threshold_percent, alert_preferences, created_at, updated_at, expires_at, owner_token_hash FROM saved_watchlists ORDER BY updated_at DESC"
      );
      return result.rows.map((row) => ({ id: row.id, name: row.name, entries: row.entries, nearLowThresholdPercent: row.near_low_threshold_percent, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), ...(row.alert_preferences ? { alertPreferences: savedWatchlistAlertPreferencesFromUnknown(row.alert_preferences) } : {}), ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}), ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {}) }));
    } catch (error) {
      databaseDisabled = true;
      console.warn(`PostgreSQL watchlist read failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const raw = await readJson<unknown[]>(WATCHLISTS_PATH, []);
  return raw.map(savedWatchlistRecordFromUnknown).filter((value): value is SavedCatalogWatchlistRecord => value !== undefined);
}

export async function writeSavedWatchlists(watchlists: SavedCatalogWatchlistRecord[]) {
  if (await ensureDatabase()) {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (watchlists.length === 0) {
        await client.query("DELETE FROM saved_watchlists");
      } else {
        await client.query("DELETE FROM saved_watchlists WHERE NOT (id = ANY($1::text[]))", [watchlists.map((watchlist) => watchlist.id)]);
      }
      for (const watchlist of watchlists) {
        await client.query(
          `INSERT INTO saved_watchlists (id, name, entries, near_low_threshold_percent, alert_preferences, created_at, updated_at, expires_at, owner_token_hash)
           VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             entries = EXCLUDED.entries,
             near_low_threshold_percent = EXCLUDED.near_low_threshold_percent,
             alert_preferences = EXCLUDED.alert_preferences,
             updated_at = EXCLUDED.updated_at,
             expires_at = EXCLUDED.expires_at,
             owner_token_hash = EXCLUDED.owner_token_hash`,
          [watchlist.id, watchlist.name, JSON.stringify(watchlist.entries), watchlist.nearLowThresholdPercent, watchlist.alertPreferences ? JSON.stringify(watchlist.alertPreferences) : null, watchlist.createdAt, watchlist.updatedAt, watchlist.expiresAt ?? null, watchlist.ownerTokenHash ?? null]
        );
      }
      await client.query("COMMIT");
      return;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      databaseDisabled = true;
      console.warn(`PostgreSQL watchlist write failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }
  await writeJson(WATCHLISTS_PATH, watchlists);
}

export async function appendSavedWatchlist(watchlist: SavedCatalogWatchlistRecord, max = 100) {
  return withSerializedFileMutation(WATCHLISTS_PATH, async () => {
    const watchlists = await readSavedWatchlists();
    await writeSavedWatchlists([watchlist, ...watchlists].slice(0, max));
  });
}

export async function updateSavedWatchlist(watchlist: SavedCatalogWatchlistRecord) {
  if (await ensureDatabase()) {
    try {
      const result = await pool!.query(
        `UPDATE saved_watchlists
         SET name = $2,
             entries = $3::jsonb,
             near_low_threshold_percent = $4,
             alert_preferences = $5::jsonb,
             updated_at = $6::timestamptz,
             expires_at = $7::timestamptz
         WHERE id = $1`,
        [watchlist.id, watchlist.name, JSON.stringify(watchlist.entries), watchlist.nearLowThresholdPercent, watchlist.alertPreferences ? JSON.stringify(watchlist.alertPreferences) : null, watchlist.updatedAt, watchlist.expiresAt ?? null]
      );
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      databaseDisabled = true;
      console.warn(`PostgreSQL watchlist update failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return withSerializedFileMutation(WATCHLISTS_PATH, async () => {
    const watchlists = await readSavedWatchlists();
    const index = watchlists.findIndex((current) => current.id === watchlist.id);
    if (index < 0) return false;
    const next = [...watchlists];
    next[index] = watchlist;
    await writeSavedWatchlists(next);
    return true;
  });
}

export async function deleteSavedWatchlist(id: string) {
  return withSerializedFileMutation(WATCHLISTS_PATH, async () => {
    if (await ensureDatabase()) {
      try {
        const result = await pool!.query("DELETE FROM saved_watchlists WHERE id = $1", [id]);
        return (result.rowCount ?? 0) > 0;
      } catch (error) {
        databaseDisabled = true;
        console.warn(`PostgreSQL watchlist delete failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const watchlists = await readSavedWatchlists();
    const next = watchlists.filter((watchlist) => watchlist.id !== id);
    if (next.length === watchlists.length) return false;
    await writeJson(WATCHLISTS_PATH, next);
    return true;
  });
}

export async function readSavedComparisons(): Promise<SavedAlternativeComparisonRecord[]> {
  if (await ensureDatabase()) {
    try {
      const result = await pool!.query<{ id: string; name: string; category: string | null; current_part_name: string | null; candidates: SavedAlternativeComparisonRecord["candidates"]; created_at: Date; updated_at: Date; expires_at: Date | null; owner_token_hash: string | null }>(
        "SELECT id, name, category, current_part_name, candidates, created_at, updated_at, expires_at, owner_token_hash FROM saved_comparisons ORDER BY updated_at DESC"
      );
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        ...(row.category ? { category: row.category } : {}),
        ...(row.current_part_name ? { currentPartName: row.current_part_name } : {}),
        candidates: row.candidates,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
        ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {})
      }));
    } catch (error) {
      databaseDisabled = true;
      console.warn(`PostgreSQL comparison read failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const raw = await readJson<unknown[]>(COMPARISONS_PATH, []);
  return raw.map(savedAlternativeComparisonFromUnknown).filter((value): value is SavedAlternativeComparisonRecord => value !== undefined);
}

export async function writeSavedComparisons(comparisons: SavedAlternativeComparisonRecord[]) {
  if (await ensureDatabase()) {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (comparisons.length === 0) {
        await client.query("DELETE FROM saved_comparisons");
      } else {
        await client.query("DELETE FROM saved_comparisons WHERE NOT (id = ANY($1::text[]))", [comparisons.map((comparison) => comparison.id)]);
      }
      for (const comparison of comparisons) {
        await client.query(
          `INSERT INTO saved_comparisons (id, name, category, current_part_name, candidates, created_at, updated_at, expires_at, owner_token_hash)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             category = EXCLUDED.category,
             current_part_name = EXCLUDED.current_part_name,
             candidates = EXCLUDED.candidates,
             updated_at = EXCLUDED.updated_at,
             expires_at = EXCLUDED.expires_at,
             owner_token_hash = EXCLUDED.owner_token_hash`,
          [comparison.id, comparison.name, comparison.category ?? null, comparison.currentPartName ?? null, JSON.stringify(comparison.candidates), comparison.createdAt, comparison.updatedAt, comparison.expiresAt ?? null, comparison.ownerTokenHash ?? null]
        );
      }
      await client.query("COMMIT");
      return;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      databaseDisabled = true;
      console.warn(`PostgreSQL comparison write failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }
  await writeJson(COMPARISONS_PATH, comparisons);
}

export async function appendSavedComparison(comparison: SavedAlternativeComparisonRecord, max = 100) {
  return withSerializedFileMutation(COMPARISONS_PATH, async () => {
    const comparisons = await readSavedComparisons();
    await writeSavedComparisons([comparison, ...comparisons].slice(0, max));
  });
}

export async function deleteSavedComparison(id: string) {
  return withSerializedFileMutation(COMPARISONS_PATH, async () => {
    if (await ensureDatabase()) {
      try {
        const result = await pool!.query("DELETE FROM saved_comparisons WHERE id = $1", [id]);
        return (result.rowCount ?? 0) > 0;
      } catch (error) {
        databaseDisabled = true;
        console.warn(`PostgreSQL comparison delete failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const comparisons = await readSavedComparisons();
    const next = comparisons.filter((comparison) => comparison.id !== id);
    if (next.length === comparisons.length) return false;
    await writeJson(COMPARISONS_PATH, next);
    return true;
  });
}

function savedBudgetLadderRecordFromDatabaseRow(row: SavedBudgetLadderDatabaseRow) {
  return savedBudgetLadderFromUnknown({
    id: row.id,
    name: row.name,
    payload: row.payload,
    ...(row.request ? { request: row.request } : {}),
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    ...(row.lineage_id ? { lineageId: row.lineage_id } : {}),
    ...(row.version_number ? { versionNumber: row.version_number } : {}),
    catalogSnapshotAt: new Date(row.catalog_snapshot_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {})
  });
}

export async function readSavedBudgetLadders(): Promise<SavedBudgetLadderRecord[]> {
  if (await ensureDatabase()) {
    try {
      const result = await pool!.query<SavedBudgetLadderDatabaseRow>(
        "SELECT id, name, payload, request, parent_id, lineage_id, version_number, catalog_snapshot_at, created_at, updated_at, expires_at, owner_token_hash FROM saved_budget_ladders ORDER BY updated_at DESC"
      );
      return result.rows.map(savedBudgetLadderRecordFromDatabaseRow).filter((value): value is SavedBudgetLadderRecord => value !== undefined);
    } catch (error) {
      databaseDisabled = true;
      console.warn(`PostgreSQL budget ladder read failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const raw = await readJson<unknown[]>(BUDGET_LADDERS_PATH, []);
  return raw.map(savedBudgetLadderFromUnknown).filter((value): value is SavedBudgetLadderRecord => value !== undefined);
}

export async function writeSavedBudgetLadders(ladders: SavedBudgetLadderRecord[]) {
  if (await ensureDatabase()) {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (ladders.length === 0) {
        await client.query("DELETE FROM saved_budget_ladders");
      } else {
        await client.query("DELETE FROM saved_budget_ladders WHERE NOT (id = ANY($1::text[]))", [ladders.map((ladder) => ladder.id)]);
      }
      for (const ladder of ladders) {
        await client.query(
          `INSERT INTO saved_budget_ladders (id, name, payload, request, parent_id, lineage_id, version_number, catalog_snapshot_at, created_at, updated_at, expires_at, owner_token_hash)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10::timestamptz, $11::timestamptz, $12)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             payload = EXCLUDED.payload,
             request = EXCLUDED.request,
             parent_id = EXCLUDED.parent_id,
             lineage_id = EXCLUDED.lineage_id,
             version_number = EXCLUDED.version_number,
             catalog_snapshot_at = EXCLUDED.catalog_snapshot_at,
             updated_at = EXCLUDED.updated_at,
             expires_at = EXCLUDED.expires_at,
             owner_token_hash = EXCLUDED.owner_token_hash`,
          [ladder.id, ladder.name, JSON.stringify(ladder.payload), ladder.request ? JSON.stringify(ladder.request) : null, ladder.parentId ?? null, ladder.lineageId ?? ladder.id, ladder.versionNumber ?? 1, ladder.catalogSnapshotAt, ladder.createdAt, ladder.updatedAt, ladder.expiresAt ?? null, ladder.ownerTokenHash ?? null]
        );
      }
      await client.query("COMMIT");
      return;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      databaseDisabled = true;
      console.warn(`PostgreSQL budget ladder write failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }
  await writeJson(BUDGET_LADDERS_PATH, ladders);
}

export async function appendSavedBudgetLadder(ladder: SavedBudgetLadderRecord, max = 100) {
  return withSerializedFileMutation(BUDGET_LADDERS_PATH, async () => {
    const ladders = await readSavedBudgetLadders();
    await writeSavedBudgetLadders([ladder, ...ladders].slice(0, Math.max(1, Math.floor(max))));
  });
}

export async function deleteSavedBudgetLadder(id: string) {
  return withSerializedFileMutation(BUDGET_LADDERS_PATH, async () => {
    if (await ensureDatabase()) {
      try {
        const result = await pool!.query("DELETE FROM saved_budget_ladders WHERE id = $1", [id]);
        return (result.rowCount ?? 0) > 0;
      } catch (error) {
        databaseDisabled = true;
        console.warn(`PostgreSQL budget ladder delete failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const ladders = await readSavedBudgetLadders();
    const next = ladders.filter((ladder) => ladder.id !== id);
    if (next.length === ladders.length) return false;
    await writeJson(BUDGET_LADDERS_PATH, next);
    return true;
  });
}

export async function readSavedWatchlistAlertStates(): Promise<SavedWatchlistAlertState[]> {
  if (await ensureDatabase()) {
    try {
      const result = await pool!.query<{ watchlist_id: string; alert_id: string; read_at: Date | null; dismissed_at: Date | null; updated_at: Date }>(
        "SELECT watchlist_id, alert_id, read_at, dismissed_at, updated_at FROM saved_watchlist_alert_states ORDER BY updated_at DESC"
      );
      return result.rows.map((row) => ({ watchlistId: row.watchlist_id, alertId: row.alert_id, ...(row.read_at ? { readAt: new Date(row.read_at).toISOString() } : {}), ...(row.dismissed_at ? { dismissedAt: new Date(row.dismissed_at).toISOString() } : {}), updatedAt: new Date(row.updated_at).toISOString() }));
    } catch (error) {
      databaseDisabled = true;
      console.warn(`PostgreSQL watchlist alert state read failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const raw = await readJson<unknown[]>(WATCHLIST_ALERT_STATES_PATH, []);
  return raw.map(savedWatchlistAlertStateFromUnknown).filter((value): value is SavedWatchlistAlertState => value !== undefined);
}

export async function writeSavedWatchlistAlertStates(states: SavedWatchlistAlertState[]) {
  if (await ensureDatabase()) {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      if (states.length === 0) {
        await client.query("DELETE FROM saved_watchlist_alert_states");
      } else {
        await client.query("DELETE FROM saved_watchlist_alert_states WHERE NOT (watchlist_id || ':' || alert_id = ANY($1::text[]))", [states.map((state) => state.watchlistId + ":" + state.alertId)]);
      }
      for (const state of states) {
        await client.query(
          `INSERT INTO saved_watchlist_alert_states (watchlist_id, alert_id, read_at, dismissed_at, updated_at)
           VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5::timestamptz)
           ON CONFLICT (watchlist_id, alert_id) DO UPDATE SET
             read_at = EXCLUDED.read_at,
             dismissed_at = EXCLUDED.dismissed_at,
             updated_at = EXCLUDED.updated_at`,
          [state.watchlistId, state.alertId, state.readAt ?? null, state.dismissedAt ?? null, state.updatedAt]
        );
      }
      await client.query("COMMIT");
      return;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      databaseDisabled = true;
      console.warn(`PostgreSQL watchlist alert state write failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }
  await writeJson(WATCHLIST_ALERT_STATES_PATH, states);
}

export async function updateSavedWatchlistAlertStates(watchlistId: string, alertIds: string[], patch: "read" | "dismiss", updatedAt: string) {
  return withSerializedFileMutation(WATCHLIST_ALERT_STATES_PATH, async () => {
    const states = await readSavedWatchlistAlertStates();
    const next = upsertSavedWatchlistAlertStates(states, watchlistId, alertIds, patch, updatedAt);
    await writeSavedWatchlistAlertStates(next);
    return next.filter((state) => state.watchlistId === watchlistId);
  });
}

export async function deleteSavedWatchlistAlertStates(watchlistId: string) {
  return withSerializedFileMutation(WATCHLIST_ALERT_STATES_PATH, async () => {
    if (await ensureDatabase()) {
      try {
        await pool!.query("DELETE FROM saved_watchlist_alert_states WHERE watchlist_id = $1", [watchlistId]);
        return;
      } catch (error) {
        databaseDisabled = true;
        console.warn(`PostgreSQL watchlist alert state delete failed; using file persistence instead: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const states = await readSavedWatchlistAlertStates();
    const next = states.filter((state) => state.watchlistId !== watchlistId);
    if (next.length !== states.length) await writeSavedWatchlistAlertStates(next);
  });
}

export async function closePersistence() {
  if (pool) await pool.end();
  pool = null;
}
