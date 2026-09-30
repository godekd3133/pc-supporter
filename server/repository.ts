import "dotenv/config";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { isOwnerSessionResourceType, OWNER_SESSION_RESOURCE_TYPES } from "../shared/owner-session-contract";
import type { OwnerSessionResourceType as OwnerShareResourceType } from "../shared/owner-session-contract";
import type { CatalogSpecOverride } from "../shared/catalog-spec-overrides";
import type { AccessoryCategory, AccessoryCoverageSnapshot, AccessoryItem, BenchmarkOverride, CoolingFanLoadOverride, M2SlotOverride, Part, PartCategory, PersistenceDiagnostics, SavedBuildPurchasePriceHistory, SavedBuildPurchasePriceHistorySnapshot, SavedBuildPurchaseProgress } from "../shared/types";
import { RateLimitStoreUnavailableError, type RateLimitDecision, type RateLimitPolicy } from "./rate-limit";
import { appendSavedBuildCheckHistory, savedBuildCheckHistoryFromUnknown, savedBuildCheckSnapshotFromUnknown, SAVED_BUILD_CHECK_HISTORY_LIMIT } from "../shared/saved-build-check";
import type { SavedBuildCheckSnapshot } from "../shared/types";
import { savedBuildMonitorSubscriptionFromUnknown } from "../shared/saved-build-monitor-subscription";
import type { SavedBuildMonitorSubscription } from "../shared/saved-build-monitor-subscription";
import { savedBuildVersionBackupDiffFor, savedBuildVersionGroupIdFor, savedBuildVersionMigratedBuildsFor, savedBuildVersionMigrationPreviewFor, savedBuildVersionNumberFor } from "../shared/saved-build-version";
import type { SavedBuildVersionBackupDetail, SavedBuildVersionBackupSummary, SavedBuildVersionMigrationPreview, SavedBuildVersionMigrationMutationResult, SavedBuildVersionMigrationRollbackResult } from "../shared/saved-build-version";
import type { SavedBuildRecord } from "./build-share";
import type { AssemblyVerificationSavedSnapshot } from "../shared/assembly-verification";
import { savedAlternativeComparisonFromUnknown, type SavedAlternativeComparisonRecord } from "./comparison-share";
import { savedBuildVersionComparisonFromUnknown, type SavedBuildVersionComparisonShareRecord } from "../shared/saved-build-version-share";
import { savedBudgetLadderFromUnknown } from "./budget-ladder-share";
import type { SavedBudgetLadderRecord } from "../shared/budget-ladder-share";
import { savedGeneratorVariantsFromUnknown } from "./generator-variants-share";
import type { SavedGeneratorVariantsRecord } from "../shared/generator-variants-share";
import { savedCatalogWatchlistFromUnknown, savedWatchlistAlertPreferencesFromUnknown, type SavedWatchlistAlertPreferences } from "./watchlist-store";
import type { SavedCatalogWatchlistRecord } from "./watchlist-share";
import { savedBuildPurchaseProgressFromUnknown, savedBuildPurchaseProgressHistoryTargetFor, savedBuildPurchaseProgressRevisionMatchesFor, savedBuildPurchaseProgressWithNextRevisionFor } from "./purchase-progress";
import { savedBuildPurchasePriceHistoryFromUnknown, savedBuildPurchasePriceHistoryHistoryTargetFor, savedBuildPurchasePriceHistoryRevisionMatchesFor, savedBuildPurchasePriceHistoryWithNextRevisionFor } from "./purchase-price-history";
import { savedWatchlistAlertStateFromUnknown, upsertSavedWatchlistAlertStates } from "./watchlist-alert-state";
import { savedBuildDecisionNoteFromUnknown, savedBuildMetadataHistoryEntryFor, savedBuildMetadataHistoryFromUnknown, savedBuildMetadataHistoryWithNextEntryFor } from "../shared/saved-build-decision-note";
import { savedBuildOriginFromUnknown } from "../shared/saved-build-origin";
import type { SavedWatchlistAlertState } from "./watchlist-alert-state";
import type { UsageEventName } from "./usage-events";

import { initializePostgresSchemaWithClient, postgresSchemaInitializationModeForNodeEnv } from "./postgres-schema-contract";

export { OWNER_SESSION_RESOURCE_TYPES as OWNER_SHARE_RESOURCE_TYPES };
export type { OwnerShareResourceType };

const OWNER_SESSION_RESOURCE_TYPES_SQL = OWNER_SESSION_RESOURCE_TYPES.map((resourceType) => "'" + resourceType + "'").join(", ");

export const POSTGRES_SCHEMA_SQL = `
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
CREATE TABLE IF NOT EXISTS catalog_accessories (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  source_product_code TEXT,
  data_quality TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS catalog_accessories_danawa_product_code_idx
  ON catalog_accessories(source_product_code)
  WHERE source = 'danawa' AND source_product_code IS NOT NULL;
CREATE TABLE IF NOT EXISTS accessory_coverage_state (
  singleton_id TEXT PRIMARY KEY CHECK (singleton_id = 'current'),
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE IF NOT EXISTS cooling_fan_load_overrides (
  singleton_id TEXT PRIMARY KEY CHECK (singleton_id = 'current'),
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE IF NOT EXISTS catalog_spec_overrides (
  singleton_id TEXT PRIMARY KEY CHECK (singleton_id = 'current'),
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE IF NOT EXISTS m2_slot_overrides (
  singleton_id TEXT PRIMARY KEY CHECK (singleton_id = 'current'),
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
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
  monitor_state JSONB,
  purchase_progress JSONB,
  purchase_price_history JSONB,
  decision_note TEXT,
  origin JSONB,
  metadata_history JSONB
);
CREATE INDEX IF NOT EXISTS saved_builds_updated_idx ON saved_builds(updated_at DESC);
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS recommendation_preferences JSONB;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS owner_token_hash TEXT;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS recovery_code_hash TEXT;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS my_pc_at TIMESTAMPTZ;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS version_group_id TEXT;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS version_number INTEGER;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS derived_from_build_id TEXT;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS check_snapshot JSONB;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS check_history JSONB;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS monitor_state JSONB;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS purchase_progress JSONB;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS purchase_price_history JSONB;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS decision_note TEXT;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS origin JSONB;
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS metadata_history JSONB;
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
  current_part_summary TEXT,
  current_part_price TEXT,
  catalog_snapshot_at TIMESTAMPTZ,
  engine_version TEXT,
  candidates JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  owner_token_hash TEXT
);
CREATE INDEX IF NOT EXISTS saved_comparisons_updated_idx ON saved_comparisons(updated_at DESC);
ALTER TABLE saved_comparisons ADD COLUMN IF NOT EXISTS catalog_snapshot_at TIMESTAMPTZ;
ALTER TABLE saved_comparisons ADD COLUMN IF NOT EXISTS engine_version TEXT;
ALTER TABLE saved_comparisons ADD COLUMN IF NOT EXISTS current_part_summary TEXT;
ALTER TABLE saved_comparisons ADD COLUMN IF NOT EXISTS current_part_price TEXT;
CREATE TABLE IF NOT EXISTS saved_version_comparisons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload JSONB NOT NULL,
  source_before_build_id TEXT NOT NULL,
  source_after_build_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  owner_token_hash TEXT
);
CREATE INDEX IF NOT EXISTS saved_version_comparisons_updated_idx ON saved_version_comparisons(updated_at DESC);
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
CREATE TABLE IF NOT EXISTS saved_generator_variants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload JSONB NOT NULL,
  request JSONB,
  catalog_snapshot_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  owner_token_hash TEXT
);
CREATE INDEX IF NOT EXISTS saved_generator_variants_updated_idx ON saved_generator_variants(updated_at DESC);
ALTER TABLE saved_generator_variants ADD COLUMN IF NOT EXISTS request JSONB;
CREATE TABLE IF NOT EXISTS saved_watchlist_alert_states (
  watchlist_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (watchlist_id, alert_id)
);
CREATE INDEX IF NOT EXISTS saved_watchlist_alert_states_updated_idx ON saved_watchlist_alert_states(updated_at DESC);
CREATE TABLE IF NOT EXISTS usage_event_daily_counts (
  day_utc DATE PRIMARY KEY,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS api_rate_limit_buckets (
  scope TEXT NOT NULL,
  client_key_hash TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 1),
  last_seen_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, client_key_hash)
);
CREATE INDEX IF NOT EXISTS api_rate_limit_buckets_last_seen_idx ON api_rate_limit_buckets(last_seen_at);
CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('catalog-ingestion', 'price-refresh', 'saved-build-monitor')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  available_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  progress JSONB CHECK (progress IS NULL OR jsonb_typeof(progress) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  finished_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  error JSONB CHECK (error IS NULL OR jsonb_typeof(error) = 'object'),
  idempotency_key TEXT,
  result JSONB CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  CHECK (attempt <= max_attempts),
  CHECK ((status = 'running' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'running' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK ((status IN ('succeeded', 'failed') AND finished_at IS NOT NULL)
    OR (status IN ('queued', 'running') AND finished_at IS NULL)),
  CHECK (status <> 'failed' OR error IS NOT NULL),
  CHECK (status <> 'succeeded' OR error IS NULL)
);
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE background_jobs ADD COLUMN IF NOT EXISTS result JSONB;
CREATE INDEX IF NOT EXISTS background_jobs_claim_idx
  ON background_jobs(available_at, created_at, id)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS background_jobs_expired_lease_idx
  ON background_jobs(lease_expires_at)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS background_jobs_kind_created_idx
  ON background_jobs(kind, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS background_jobs_kind_idempotency_idx
  ON background_jobs(kind, idempotency_key);
CREATE TABLE IF NOT EXISTS price_refresh_attempts (
  item_kind TEXT NOT NULL CHECK (item_kind IN ('part', 'accessory')),
  item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 512),
  attempted_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (item_kind, item_id)
);
CREATE INDEX IF NOT EXISTS price_refresh_attempts_attempted_idx
  ON price_refresh_attempts(attempted_at, item_kind, item_id);
CREATE TABLE IF NOT EXISTS owner_sessions (
  session_hash TEXT PRIMARY KEY CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS owner_sessions_expiry_idx
  ON owner_sessions(expires_at);
CREATE TABLE IF NOT EXISTS owner_session_grants (
  session_hash TEXT NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  resource_type TEXT NOT NULL CHECK (resource_type IN (${OWNER_SESSION_RESOURCE_TYPES_SQL})),
  resource_id TEXT NOT NULL CHECK (length(resource_id) BETWEEN 1 AND 512),
  owner_token_hash TEXT NOT NULL CHECK (owner_token_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (session_hash, resource_type, resource_id, owner_token_hash),
  FOREIGN KEY (session_hash) REFERENCES owner_sessions(session_hash) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS owner_session_grants_session_expiry_idx
  ON owner_session_grants(session_hash, expires_at);
CREATE INDEX IF NOT EXISTS owner_session_grants_resource_idx
  ON owner_session_grants(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS owner_session_grants_expiry_idx
  ON owner_session_grants(expires_at)
  WHERE expires_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS pc_supporter_schema_revision (
  singleton_id TEXT PRIMARY KEY CHECK (singleton_id = 'current'),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  schema_sha256 TEXT NOT NULL CHECK (schema_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
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
const configuredRateLimitHmacSecret = process.env.RATE_LIMIT_HMAC_SECRET?.trim();
const DEVELOPMENT_RATE_LIMIT_HMAC_SECRET = "pc-supporter-local-rate-limit-secret";
const DATABASE_RETRY_COOLDOWN_MS = 1_000;
const RATE_LIMIT_BUCKET_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const RATE_LIMIT_BUCKET_CLEANUP_INTERVAL_MS = 10 * 60 * 1_000;
const RATE_LIMIT_BUCKET_CLEANUP_BATCH_SIZE = 1_000;
// Vitest reloads modules between tests; keep pools alive on globalThis so a reset module
// reuses the connection pool for the same DATABASE_URL instead of leaking clients.
// The registry is keyed by the Pool implementation too: files that mock "pg" with a
// synthetic class must never share a live pool with the real driver or other mocks.
const sharedPoolGroups = ((globalThis as { __pcSupporterPgPools?: Map<unknown, Map<string, Pool>> }).__pcSupporterPgPools ??= new Map());
let sharedPools = sharedPoolGroups.get(Pool);
if (!sharedPools) {
  sharedPools = new Map<string, Pool>();
  sharedPoolGroups.set(Pool, sharedPools);
}
let pool: Pool | null = null;
let poolCreationError: unknown;
if (configuredDatabaseUrl) {
  try {
    pool = sharedPools.get(configuredDatabaseUrl) ?? null;
    if (!pool) {
      pool = new Pool({ connectionString: configuredDatabaseUrl, max: 5, connectionTimeoutMillis: 2_000 });
      sharedPools.set(configuredDatabaseUrl, pool);
    }
  } catch (error: unknown) {
    poolCreationError = error;
  }
}
let databaseReady = false;
let schemaPromise: Promise<boolean> | null = null;
let nextDatabaseRetryAt = 0;
let lastDatabaseError: unknown;

class DatabaseRetryDeferredError extends Error {
  constructor(retryAt: number, lastError: unknown) {
    super(`PostgreSQL retry is deferred until ${new Date(retryAt).toISOString()}: ${postgresErrorMessage(lastError)}`);
    this.name = "DatabaseRetryDeferredError";
  }
}

function postgresErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function rateLimitHmacSecret() {
  if (configuredRateLimitHmacSecret && configuredRateLimitHmacSecret.length >= 32) return configuredRateLimitHmacSecret;
  return process.env.NODE_ENV === "production" ? undefined : DEVELOPMENT_RATE_LIMIT_HMAC_SECRET;
}

function markDatabaseUnavailable(operation: string, error: unknown) {
  databaseReady = false;
  schemaPromise = null;
  nextDatabaseRetryAt = Date.now() + DATABASE_RETRY_COOLDOWN_MS;
  lastDatabaseError = error;
  console.warn(`PostgreSQL ${operation} failed: ${postgresErrorMessage(error)}`);
}

export type SavedBuildMonitorLeaseResult<T> =
  | { backend: "postgres"; acquired: true; value: T }
  | { backend: "postgres"; acquired: false };

async function ensureDatabase(): Promise<boolean> {
  if (!configuredDatabaseUrl) {
    throw new Error("DATABASE_URL is required; the JSON file persistence mode has been removed.");
  }
  if (!pool) {
    throw new Error(`PostgreSQL is configured but its connection pool could not be created: ${postgresErrorMessage(poolCreationError)}`);
  }
  if (databaseReady) return true;
  if (schemaPromise) return schemaPromise;
  if (Date.now() < nextDatabaseRetryAt) throw new DatabaseRetryDeferredError(nextDatabaseRetryAt, lastDatabaseError);
  if (!schemaPromise) {
    schemaPromise = (async () => {
      let client: PoolClient | undefined;
      let clientReleased = false;
      try {
        client = await pool!.connect();
        await initializePostgresSchemaWithClient(
          client,
          postgresSchemaInitializationModeForNodeEnv(process.env.NODE_ENV),
          POSTGRES_SCHEMA_SQL
        );
        databaseReady = true;
        nextDatabaseRetryAt = 0;
        lastDatabaseError = undefined;
        return true;
      } catch (error: unknown) {
        if (client) {
          client.release(true);
          clientReleased = true;
        }
        markDatabaseUnavailable("initialization", error);
        throw error;
      } finally {
        if (client && !clientReleased) client.release();
      }
    })()
  }
  return schemaPromise;
}

export interface OwnerShareSession {
  sessionHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface OwnerShareSessionGrant {
  sessionHash: string;
  resourceType: OwnerShareResourceType;
  resourceId: string;
  ownerTokenHash: string;
  createdAt: string;
  expiresAt?: string;
}

export interface OwnerShareSessionGrantReference {
  resourceType: OwnerShareResourceType;
  resourceId: string;
  ownerTokenHash: string;
}

export const OWNER_SHARE_SESSION_GRANT_MAX_PRUNE_BATCH = 500;
export const OWNER_SHARE_SESSION_MAX_PRUNE_BATCH = 500;
const OWNER_SHARE_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OWNER_SHARE_ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function ownerShareRecordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function ownerShareHash(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !OWNER_SHARE_SHA256_PATTERN.test(value)) {
    throw new Error(`Owner session ${fieldName} must be a lowercase SHA-256 hex digest.`);
  }
  return value;
}

function ownerShareResourceType(value: unknown): OwnerShareResourceType {
  if (!isOwnerSessionResourceType(value)) {
    throw new Error("Owner session resource type is invalid.");
  }
  return value;
}

function ownerShareResourceId(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > 512 || value.includes("\u0000")) {
    throw new Error("Owner session resource ID must be a non-empty string of at most 512 characters.");
  }
  return value;
}

function ownerShareIsoTimestamp(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !OWNER_SHARE_ISO_TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Owner session ${fieldName} must be an ISO timestamp.`);
  }
  return value;
}

function ownerShareNow(value?: Date | string): { iso: string; time: number } {
  const iso = value instanceof Date ? value.toISOString() : value === undefined ? new Date().toISOString() : ownerShareIsoTimestamp(value, "current time");
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) throw new Error("Owner session current time is invalid.");
  return { iso, time };
}

function ownerShareSessionGrantFromUnknown(value: unknown): OwnerShareSessionGrant {
  const record = ownerShareRecordFromUnknown(value);
  if (!record) throw new Error("Owner session grant must be an object.");
  const grant: OwnerShareSessionGrant = {
    sessionHash: ownerShareHash(record.sessionHash, "session hash"),
    resourceType: ownerShareResourceType(record.resourceType),
    resourceId: ownerShareResourceId(record.resourceId),
    ownerTokenHash: ownerShareHash(record.ownerTokenHash, "owner token hash"),
    createdAt: ownerShareIsoTimestamp(record.createdAt, "creation time")
  };
  if (record.expiresAt !== undefined) grant.expiresAt = ownerShareIsoTimestamp(record.expiresAt, "expiry time");
  return grant;
}

function ownerShareSessionFromUnknown(value: unknown): OwnerShareSession {
  const record = ownerShareRecordFromUnknown(value);
  if (!record) throw new Error("Owner session record must be an object.");
  const session: OwnerShareSession = {
    sessionHash: ownerShareHash(record.sessionHash, "session hash"),
    createdAt: ownerShareIsoTimestamp(record.createdAt, "creation time"),
    expiresAt: ownerShareIsoTimestamp(record.expiresAt, "expiry time")
  };
  if (Date.parse(session.expiresAt) <= Date.parse(session.createdAt)) {
    throw new Error("Owner session expiry must be later than its creation time.");
  }
  return session;
}

function ownerShareGrantReferenceFromUnknown(value: unknown): OwnerShareSessionGrantReference {
  const record = ownerShareRecordFromUnknown(value);
  if (!record) throw new Error("Owner session grant query returned an invalid row.");
  return {
    resourceType: ownerShareResourceType(record.resource_type ?? record.resourceType),
    resourceId: ownerShareResourceId(record.resource_id ?? record.resourceId),
    ownerTokenHash: ownerShareHash(record.owner_token_hash ?? record.ownerTokenHash, "owner token hash")
  };
}

export async function createOwnerShareSession(input: OwnerShareSession): Promise<void> {
  const session = ownerShareSessionFromUnknown(input);
  await ensureDatabase();
  let created = false;
  try {
    const result = await pool!.query(
      `INSERT INTO owner_sessions (session_hash, created_at, expires_at)
       SELECT $1, $2::timestamptz, $3::timestamptz
       WHERE NOT EXISTS (SELECT 1 FROM owner_session_grants WHERE session_hash = $1)
       ON CONFLICT (session_hash) DO NOTHING
       RETURNING session_hash`,
      [session.sessionHash, session.createdAt, session.expiresAt]
    );
    created = result.rows.length > 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session create", error);
    throw error;
  }
  if (!created) throw new Error("Owner session hash already exists or conflicts with a pending grant.");
}

export async function ownerShareSessionIsActive(sessionHashValue: string, nowValue?: Date | string): Promise<boolean> {
  const sessionHash = ownerShareHash(sessionHashValue, "session hash");
  const now = ownerShareNow(nowValue);
  await ensureDatabase();
  try {
    const result = await pool!.query(
      "SELECT 1 AS active FROM owner_sessions WHERE session_hash = $1 AND expires_at > $2::timestamptz LIMIT 1",
      [sessionHash, now.iso]
    );
    return result.rows.length > 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session active check", error);
    throw error;
  }
}

export async function deleteOwnerShareSession(sessionHashValue: string): Promise<boolean> {
  const sessionHash = ownerShareHash(sessionHashValue, "session hash");
  await ensureDatabase();
  return withPostgresTransaction("owner session revoke", async (client) => {
    const sessionResult = await client.query("DELETE FROM owner_sessions WHERE session_hash = $1 RETURNING session_hash", [sessionHash]);
    // The FK cascade handles normal rows. This second delete also clears pre-lifecycle orphaned grants.
    const grantResult = await client.query("DELETE FROM owner_session_grants WHERE session_hash = $1 RETURNING session_hash", [sessionHash]);
    return (sessionResult.rowCount ?? sessionResult.rows.length) > 0 || (grantResult.rowCount ?? grantResult.rows.length) > 0;
  });
}

function ownerShareSessionPruneLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Owner session prune limit must be a non-negative integer.");
  return Math.min(limit, OWNER_SHARE_SESSION_MAX_PRUNE_BATCH);
}

export async function pruneExpiredOwnerShareSessions(limit = OWNER_SHARE_SESSION_MAX_PRUNE_BATCH, nowValue?: Date | string): Promise<number> {
  const boundedLimit = ownerShareSessionPruneLimit(limit);
  if (boundedLimit === 0) return 0;
  const now = ownerShareNow(nowValue);
  await ensureDatabase();
  try {
    const result = await pool!.query(
      `WITH expired_sessions AS (
         SELECT session_hash
         FROM owner_sessions
         WHERE expires_at <= $2::timestamptz
         ORDER BY expires_at, session_hash
         LIMIT $1
       )
       DELETE FROM owner_sessions
       WHERE session_hash IN (SELECT session_hash FROM expired_sessions)
       RETURNING session_hash`,
      [boundedLimit, now.iso]
    );
    return result.rowCount ?? result.rows.length;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session prune", error);
    throw error;
  }
}

export async function upsertOwnerShareSessionGrant(input: OwnerShareSessionGrant, nowValue?: Date | string): Promise<boolean> {
  const grant = ownerShareSessionGrantFromUnknown(input);
  const now = ownerShareNow(nowValue);
  await ensureDatabase();
  try {
    const result = await pool!.query(
      `INSERT INTO owner_session_grants (session_hash, resource_type, resource_id, owner_token_hash, created_at, expires_at)
       SELECT $1, $2, $3, $4, $5::timestamptz, $6::timestamptz
       WHERE EXISTS (SELECT 1 FROM owner_sessions WHERE session_hash = $1 AND expires_at > $7::timestamptz)
       ON CONFLICT (session_hash, resource_type, resource_id, owner_token_hash)
       DO UPDATE SET expires_at = COALESCE(EXCLUDED.expires_at, owner_session_grants.expires_at)
       RETURNING session_hash`,
      [grant.sessionHash, grant.resourceType, grant.resourceId, grant.ownerTokenHash, grant.createdAt, grant.expiresAt ?? null, now.iso]
    );
    return result.rows.length > 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session grant upsert", error);
    throw error;
  }
}

export async function ownerShareSessionGrantMatches(input: {
  sessionHash: string;
  resourceType: OwnerShareResourceType;
  resourceId: string;
  ownerTokenHash: string;
  now?: Date | string;
}): Promise<boolean> {
  const sessionHash = ownerShareHash(input.sessionHash, "session hash");
  const resourceType = ownerShareResourceType(input.resourceType);
  const resourceId = ownerShareResourceId(input.resourceId);
  const ownerTokenHash = ownerShareHash(input.ownerTokenHash, "owner token hash");
  const now = ownerShareNow(input.now);
  await ensureDatabase();
  try {
    const result = await pool!.query(
      `SELECT 1 AS present
       FROM owner_session_grants AS grants
       JOIN owner_sessions AS sessions ON sessions.session_hash = grants.session_hash
       WHERE grants.session_hash = $1
         AND grants.resource_type = $2
         AND grants.resource_id = $3
         AND grants.owner_token_hash = $4
         AND sessions.expires_at > $5::timestamptz
         AND (grants.expires_at IS NULL OR grants.expires_at > $5::timestamptz)
       LIMIT 1`,
      [sessionHash, resourceType, resourceId, ownerTokenHash, now.iso]
    );
    return result.rows.length > 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session grant match", error);
    throw error;
  }
}

export async function listOwnerShareSessionGrants(sessionHashValue: string, nowValue?: Date | string): Promise<OwnerShareSessionGrantReference[]> {
  const sessionHash = ownerShareHash(sessionHashValue, "session hash");
  const now = ownerShareNow(nowValue);
  await ensureDatabase();
  try {
    const result = await pool!.query(
      `SELECT grants.resource_type, grants.resource_id, grants.owner_token_hash
       FROM owner_session_grants AS grants
       JOIN owner_sessions AS sessions ON sessions.session_hash = grants.session_hash
       WHERE grants.session_hash = $1
         AND sessions.expires_at > $2::timestamptz
         AND (grants.expires_at IS NULL OR grants.expires_at > $2::timestamptz)
       ORDER BY grants.resource_type, grants.resource_id, grants.owner_token_hash`,
      [sessionHash, now.iso]
    );
    return result.rows.map(ownerShareGrantReferenceFromUnknown);
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session grant list", error);
    throw error;
  }
}

export async function deleteOwnerShareSessionGrantsForResource(resourceTypeValue: OwnerShareResourceType, resourceIdValue: string): Promise<number> {
  const resourceType = ownerShareResourceType(resourceTypeValue);
  const resourceId = ownerShareResourceId(resourceIdValue);
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM owner_session_grants WHERE resource_type = $1 AND resource_id = $2", [resourceType, resourceId]);
    return result.rowCount ?? 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session grant resource delete", error);
    throw error;
  }
}

export async function deleteOwnerShareSessionGrantsForSession(sessionHashValue: string): Promise<number> {
  const sessionHash = ownerShareHash(sessionHashValue, "session hash");
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM owner_session_grants WHERE session_hash = $1", [sessionHash]);
    return result.rowCount ?? 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session grant session delete", error);
    throw error;
  }
}

function ownerShareGrantPruneLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Owner session grant prune limit must be a non-negative integer.");
  return Math.min(limit, OWNER_SHARE_SESSION_GRANT_MAX_PRUNE_BATCH);
}

export async function pruneExpiredOwnerShareSessionGrants(limit = OWNER_SHARE_SESSION_GRANT_MAX_PRUNE_BATCH, nowValue?: Date | string): Promise<number> {
  const boundedLimit = ownerShareGrantPruneLimit(limit);
  if (boundedLimit === 0) return 0;
  const now = ownerShareNow(nowValue);
  await ensureDatabase();
  try {
    const result = await pool!.query(
      `WITH expired AS (
         SELECT ctid
         FROM owner_session_grants
         WHERE expires_at IS NOT NULL AND expires_at <= $2::timestamptz
         ORDER BY expires_at, session_hash, resource_type, resource_id, owner_token_hash
         LIMIT $1
       )
       DELETE FROM owner_session_grants
       WHERE ctid IN (SELECT ctid FROM expired)
       RETURNING session_hash`,
      [boundedLimit, now.iso]
    );
    return result.rowCount ?? result.rows.length;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session grant prune", error);
    throw error;
  }
}

export async function initializePersistence() {
  await ensureDatabase();
}

export type PostgresTransactionErrorClassifier = (error: unknown) => boolean;

export type PostgresTransactionRunner = <T>(
  operation: string,
  callback: (client: PoolClient) => Promise<T>,
  expectedDomainConflict?: PostgresTransactionErrorClassifier
) => Promise<T>;

/**
 * Run an internal repository operation in PostgreSQL only. This deliberately
 * throws when file mode is selected and never redirects database failures to
 * JSON storage.
 */
export async function withPostgresTransaction<T>(
  operation: string,
  callback: (client: PoolClient) => Promise<T>,
  expectedDomainConflict?: PostgresTransactionErrorClassifier
): Promise<T> {
  await ensureDatabase();

  let client: PoolClient;
  try {
    client = await pool!.connect();
  } catch (error: unknown) {
    markDatabaseUnavailable(`${operation} connection`, error);
    throw error;
  }

  let transactionStarted = false;
  let discardClient = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await callback(client);
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error: unknown) {
    let rollbackFailed = false;
    let rollbackError: unknown;
    if (!transactionStarted) {
      discardClient = true;
    } else {
      try {
        await client.query("ROLLBACK");
      } catch (failure: unknown) {
        discardClient = true;
        rollbackFailed = true;
        rollbackError = failure;
      }
    }
    let preserveDatabaseReadiness = false;
    if (transactionStarted && !rollbackFailed && expectedDomainConflict) {
      try {
        preserveDatabaseReadiness = expectedDomainConflict(error);
      } catch {
        // A failing conflict classifier must not mask the transaction error.
      }
    }
    if (!preserveDatabaseReadiness) markDatabaseUnavailable(operation, rollbackFailed ? rollbackError : error);
    throw error;
  } finally {
    client.release(discardClient);
  }
}

async function withPersistenceLease<T>(leaseScope: string, operation: () => Promise<T>): Promise<SavedBuildMonitorLeaseResult<T>> {
  await ensureDatabase();
  let client: PoolClient | undefined;
  let acquired = false;
  try {
    client = await pool!.connect();
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [`pc-supporter:${leaseScope}`]
    );
    acquired = result.rows[0]?.acquired === true;
  } catch (error: unknown) {
    client?.release(true);
    markDatabaseUnavailable("background job lease", error);
    throw error;
  }
  if (client && !acquired) {
    client.release();
    return { backend: "postgres", acquired: false };
  }
  if (client && acquired) {
    try {
      return { backend: "postgres", acquired: true, value: await operation() };
    } finally {
      let discardClient = false;
      try {
        const result = await client.query<{ pg_advisory_unlock: boolean }>(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [`pc-supporter:${leaseScope}`]
        );
        discardClient = result.rows[0]?.pg_advisory_unlock !== true;
        if (discardClient) console.warn("PostgreSQL background-job lease release reported no held lock; discarding the connection.");
      } catch (error: unknown) {
        discardClient = true;
        console.warn(`PostgreSQL background-job lease release failed; discarding the connection: ${error instanceof Error ? error.message : String(error)}`);
      }
      client.release(discardClient);
    }
  }
  return { backend: "postgres", acquired: false };
}

function normalizedLeaseScope(scope: string) {
  const normalized = scope.trim().replace(/[^a-z0-9:_-]/gi, "-").slice(0, 80);
  if (!normalized) throw new Error("Background job lease scope is required.");
  return normalized;
}

export async function withBackgroundJobLease<T>(scope: string, operation: () => Promise<T>): Promise<SavedBuildMonitorLeaseResult<T>> {
  const normalized = normalizedLeaseScope(scope);
  return withPersistenceLease(`background-job:${normalized}`, operation);
}

export async function withSavedBuildMonitorLease<T>(operation: () => Promise<T>, scope = "scheduler"): Promise<SavedBuildMonitorLeaseResult<T>> {
  return withPersistenceLease(`saved-build-monitor:${normalizedLeaseScope(scope)}`, operation);
}

export async function incrementUsageEventInDatabase(dayUtc: string, name: UsageEventName, maxDailyBuckets: number) {
  await ensureDatabase();

  let client: PoolClient;
  try {
    client = await pool!.connect();
  } catch (error: unknown) {
    markDatabaseUnavailable("usage-event connection", error);
    throw error;
  }
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pc-supporter:usage_event_daily_counts'))");
    await client.query(
      `INSERT INTO usage_event_daily_counts (day_utc, counts)
       VALUES ($1::date, jsonb_build_object($2::text, 1))
       ON CONFLICT (day_utc) DO UPDATE SET counts = jsonb_set(
         usage_event_daily_counts.counts,
         ARRAY[$2::text],
         to_jsonb(COALESCE((usage_event_daily_counts.counts ->> $2::text)::integer, 0) + 1),
         true
       )`,
      [dayUtc, name]
    );
    await client.query(
      `DELETE FROM usage_event_daily_counts
       WHERE day_utc NOT IN (
         SELECT day_utc FROM usage_event_daily_counts ORDER BY day_utc DESC LIMIT $1
       )`,
      [maxDailyBuckets]
    );
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("usage-event write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function readUsageEventDailyCountsFromDatabase(): Promise<Record<string, Partial<Record<UsageEventName, number>>>> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ day_utc: string; counts: Partial<Record<UsageEventName, number>> }>(
      "SELECT day_utc::text AS day_utc, counts FROM usage_event_daily_counts ORDER BY day_utc"
    );
    return Object.fromEntries(result.rows.map((row) => [row.day_utc, row.counts]));
  } catch (error: unknown) {
    markDatabaseUnavailable("usage-event read", error);
    throw error;
  }
}

export async function persistenceDiagnostics(): Promise<PersistenceDiagnostics> {
  if (!configuredDatabaseUrl) {
    return { databaseConfigured: false, storageMode: "postgres", ready: false, unavailableReason: "database_unavailable" };
  }
  try {
    await ensureDatabase();
    await pool!.query("SELECT 1");
    if (!rateLimitHmacSecret()) return { databaseConfigured: true, storageMode: "postgres", ready: false, unavailableReason: "rate_limit_key_unconfigured" };
    return { databaseConfigured: true, storageMode: "postgres", ready: true };
  } catch (error: unknown) {
    if (Date.now() >= nextDatabaseRetryAt) markDatabaseUnavailable("readiness check", error);
    return { databaseConfigured: true, storageMode: "postgres", ready: false, unavailableReason: "database_unavailable" };
  }
}

export async function consumeRateLimitWindow(scope: string, address: string, policy: RateLimitPolicy, _now = Date.now()): Promise<RateLimitDecision | undefined> {
  try {
    await ensureDatabase();
  } catch {
    throw new RateLimitStoreUnavailableError("PERSISTENCE_UNAVAILABLE");
  }
  const secret = rateLimitHmacSecret();
  if (!secret) throw new RateLimitStoreUnavailableError("RATE_LIMIT_KEY_UNCONFIGURED");
  const limit = Math.max(1, Math.floor(policy.limit));
  const windowMs = Math.max(1_000, Math.floor(policy.windowMs));
  const clientKeyHash = createHmac("sha256", secret).update(`${scope}\0${address}`).digest("hex");
  try {
    const result = await pool!.query<{ window_started_at: Date | string; request_count: number; last_seen_at: Date | string }>(
      `INSERT INTO api_rate_limit_buckets (scope, client_key_hash, window_started_at, request_count, last_seen_at)
       VALUES ($1, $2, statement_timestamp(), 1, statement_timestamp())
       ON CONFLICT (scope, client_key_hash) DO UPDATE SET
         window_started_at = CASE
           WHEN api_rate_limit_buckets.window_started_at + ($3::double precision * INTERVAL '1 millisecond') <= EXCLUDED.last_seen_at
           THEN EXCLUDED.last_seen_at
           ELSE api_rate_limit_buckets.window_started_at
         END,
         request_count = CASE
           WHEN api_rate_limit_buckets.window_started_at + ($3::double precision * INTERVAL '1 millisecond') <= EXCLUDED.last_seen_at
           THEN 1
           ELSE api_rate_limit_buckets.request_count + 1
         END,
         last_seen_at = EXCLUDED.last_seen_at
       RETURNING window_started_at, request_count, last_seen_at`,
      [scope, clientKeyHash, windowMs]
    );
    const row = result.rows[0];
    const startedAt = row ? new Date(row.window_started_at).getTime() : Number.NaN;
    const observedAt = row ? new Date(row.last_seen_at).getTime() : Number.NaN;
    const count = Number(row?.request_count);
    if (!Number.isFinite(startedAt) || !Number.isFinite(observedAt) || !Number.isSafeInteger(count) || count < 1) {
      throw new Error("PostgreSQL returned an invalid shared rate-limit counter.");
    }
    const resetAt = startedAt + windowMs;
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - observedAt) / 1_000))
    };
  } catch (error: unknown) {
    markDatabaseUnavailable("rate limit update", error);
    throw new RateLimitStoreUnavailableError("PERSISTENCE_UNAVAILABLE");
  }
}

export async function pruneRateLimitWindows() {
  await ensureDatabase();
  try {
    const lease = await withBackgroundJobLease("rate-limit-window-prune", async () => {
      const result = await pool!.query(
        `WITH expired AS (
           SELECT scope, client_key_hash
           FROM api_rate_limit_buckets
           WHERE last_seen_at < statement_timestamp() - ($1::double precision * INTERVAL '1 millisecond')
           ORDER BY last_seen_at
           LIMIT $2
         )
         DELETE FROM api_rate_limit_buckets AS buckets
         USING expired
         WHERE buckets.scope = expired.scope AND buckets.client_key_hash = expired.client_key_hash`,
        [RATE_LIMIT_BUCKET_RETENTION_MS, RATE_LIMIT_BUCKET_CLEANUP_BATCH_SIZE]
      );
      return result.rowCount ?? 0;
    });
    return lease.acquired ? lease.value : 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("rate limit cleanup", error);
    throw error;
  }
}

export async function readCatalogRecords(): Promise<Part[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ payload: Part }>("SELECT payload FROM catalog_parts ORDER BY updated_at DESC");
    return result.rows.map((row) => row.payload);
  } catch (error) {
    markDatabaseUnavailable("catalog read", error);
    throw error;
  }
}

export async function writeCatalogRecords(
  parts: Part[],
  options: { replaceDanawaCategories?: PartCategory[]; removeIds?: string[] } = {}
) {
  await ensureDatabase();
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
    const removeIds = [...new Set(options.removeIds ?? [])];
    if (removeIds.length > 0) {
      await client.query(
        "DELETE FROM catalog_parts WHERE id = ANY($1::text[])",
        [removeIds]
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
    markDatabaseUnavailable("catalog write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function patchCatalogPriceRecords(
  patches: Array<{ id: string; sourceProductCode: string; danawaUrl: string; priceWon: number; priceCheckedAt: string }>
): Promise<Array<{ before: Part; after: Part }> | undefined> {
  await ensureDatabase();
  const client = await pool!.connect();
  const changed: Array<{ before: Part; after: Part }> = [];
  try {
    await client.query("BEGIN");
    for (const patch of patches) {
      const result = await client.query<{ before_payload: Part; after_payload: Part }>(
        `WITH current AS (
           SELECT id, payload AS before_payload FROM catalog_parts
           WHERE id = $1 AND source = 'danawa' AND source_product_code = $2 AND payload->>'danawaUrl' = $3
           FOR UPDATE
         ), updated AS (
           UPDATE catalog_parts AS catalog
           SET payload = jsonb_set(
             jsonb_set(current.before_payload, '{priceWon}', to_jsonb($4::numeric), true),
             '{priceCheckedAt}', to_jsonb($5::text), true
           )
           FROM current
           WHERE catalog.id = current.id
           RETURNING catalog.id, catalog.payload AS after_payload
         )
         SELECT current.before_payload, updated.after_payload FROM current JOIN updated USING (id)`,
        [patch.id, patch.sourceProductCode, patch.danawaUrl, patch.priceWon, patch.priceCheckedAt]
      );
      if (result.rows[0]) changed.push({ before: result.rows[0].before_payload, after: result.rows[0].after_payload });
    }
    await client.query("COMMIT");
    return changed;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw new Error(`PostgreSQL catalog price patch failed; kept the existing database price: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export interface AccessoryCatalogSnapshot {
  items: AccessoryItem[];
  updatedAt: string;
}

export interface AccessoryCatalogMutation {
  items: AccessoryItem[];
  /** Optional delta to persist while `items` remains the complete post-mutation snapshot. */
  writeItems?: AccessoryItem[];
  /** Ids to delete outright — accessory rows absent from `items` are otherwise kept. */
  removeIds?: string[];
  replaceDanawaCategories?: AccessoryCategory[];
}

export interface AccessoryCatalogPricePatchResult {
  updates: Array<{ before: AccessoryItem; after: AccessoryItem }>;
  updatedAt: string;
}

function accessoryCatalogTimestamp(value: Date | string | null | undefined) {
  if (value === null || value === undefined) return "";
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : "";
}

function assertUniqueAccessoryCatalogKeys(items: AccessoryItem[]) {
  const ids = new Set<string>();
  const danawaProductCodes = new Set<string>();
  for (const item of items) {
    if (!item.id || ids.has(item.id)) throw new Error(`Accessory catalog contains a duplicate or empty id: ${item.id}`);
    ids.add(item.id);
    if (item.source === "danawa" && item.sourceProductCode) {
      if (danawaProductCodes.has(item.sourceProductCode)) throw new Error(`Accessory catalog contains duplicate Danawa product code: ${item.sourceProductCode}`);
      danawaProductCodes.add(item.sourceProductCode);
    }
  }
}

export async function readAccessoryCatalogRecords(): Promise<AccessoryCatalogSnapshot> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ payload: AccessoryItem; updated_at: Date | string }>(
      "SELECT payload, updated_at FROM catalog_accessories ORDER BY updated_at DESC, id ASC"
    );
    return {
      items: result.rows.map((row) => row.payload),
      updatedAt: accessoryCatalogTimestamp(result.rows[0]?.updated_at)
    };
  } catch (error: unknown) {
    markDatabaseUnavailable("accessory catalog read", error);
    throw error;
  }
}

/**
 * Serializes read/merge/write operations across API replicas. The callback receives
 * the authoritative PostgreSQL snapshot while holding the same transaction lock
 * used by accessory price patches.
 */
export async function mutateAccessoryCatalogRecords(
  mutation: (current: AccessoryItem[]) => AccessoryCatalogMutation
): Promise<AccessoryCatalogSnapshot> {
  await ensureDatabase();

  let client: PoolClient;
  try {
    client = await pool!.connect();
  } catch (error: unknown) {
    markDatabaseUnavailable("accessory catalog connection", error);
    throw error;
  }

  let discardClient = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:catalog-accessories', 0))");
    const currentResult = await client.query<{ payload: AccessoryItem }>(
      "SELECT payload FROM catalog_accessories ORDER BY updated_at DESC, id ASC"
    );
    const currentItems = currentResult.rows.map((row) => row.payload);
    const next = mutation(currentItems);
    assertUniqueAccessoryCatalogKeys(next.items);
    const writeItems = next.writeItems ?? next.items;
    assertUniqueAccessoryCatalogKeys(writeItems);

    const replaceDanawaCategories = [...new Set(next.replaceDanawaCategories ?? [])];
    if (replaceDanawaCategories.length > 0) {
      await client.query(
        "DELETE FROM catalog_accessories WHERE source = 'danawa' AND category = ANY($1::text[])",
        [replaceDanawaCategories]
      );
    }

    const removeIds = [...new Set(next.removeIds ?? [])];
    if (removeIds.length > 0) {
      await client.query(
        "DELETE FROM catalog_accessories WHERE id = ANY($1::text[])",
        [removeIds]
      );
    }

    const insertBatch = async (items: AccessoryItem[], conflictTarget: "id" | "danawa_product_code") => {
      const batchSize = 300;
      for (let offset = 0; offset < items.length; offset += batchSize) {
        const batch = items.slice(offset, offset + batchSize);
        const values: unknown[] = [];
        const rowsSql = batch.map((item, index) => {
          const firstParameter = index * 6 + 1;
          values.push(item.id, item.category, item.source, item.sourceProductCode ?? null, item.dataQuality, JSON.stringify(item));
          return `($${firstParameter}, $${firstParameter + 1}, $${firstParameter + 2}, $${firstParameter + 3}, $${firstParameter + 4}, $${firstParameter + 5}::jsonb, statement_timestamp())`;
        });
        const conflictSql = conflictTarget === "danawa_product_code"
          ? `ON CONFLICT (source_product_code) WHERE source = 'danawa' AND source_product_code IS NOT NULL DO UPDATE SET
               id = EXCLUDED.id,
               category = EXCLUDED.category,
               source = EXCLUDED.source,
               data_quality = EXCLUDED.data_quality,
               payload = EXCLUDED.payload,
               updated_at = statement_timestamp()`
          : `ON CONFLICT (id) DO UPDATE SET
               category = EXCLUDED.category,
               source = EXCLUDED.source,
               source_product_code = EXCLUDED.source_product_code,
               data_quality = EXCLUDED.data_quality,
               payload = EXCLUDED.payload,
               updated_at = statement_timestamp()`;
        await client.query(
          `INSERT INTO catalog_accessories (id, category, source, source_product_code, data_quality, payload, updated_at)
           VALUES ${rowsSql.join(", ")}
           ${conflictSql}`,
          values
        );
      }
    };

    await insertBatch(writeItems.filter((item) => item.source === "danawa" && Boolean(item.sourceProductCode)), "danawa_product_code");
    await insertBatch(writeItems.filter((item) => item.source !== "danawa" || !item.sourceProductCode), "id");

    const timestampResult = await client.query<{ updated_at: Date | string | null }>(
      "SELECT MAX(updated_at) AS updated_at FROM catalog_accessories"
    );
    await client.query("COMMIT");
    return { items: next.items, updatedAt: accessoryCatalogTimestamp(timestampResult.rows[0]?.updated_at) };
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    markDatabaseUnavailable("accessory catalog write", error);
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function patchAccessoryCatalogPriceRecords(
  patches: Array<{ id: string; sourceProductCode: string; danawaUrl: string; priceWon: number; priceCheckedAt: string }>
): Promise<AccessoryCatalogPricePatchResult> {
  if (patches.length === 0) return { updates: [], updatedAt: "" };
  await ensureDatabase();

  let client: PoolClient;
  try {
    client = await pool!.connect();
  } catch (error: unknown) {
    markDatabaseUnavailable("accessory price patch connection", error);
    throw error;
  }

  let discardClient = false;
  const changed: Array<{ before: AccessoryItem; after: AccessoryItem }> = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:catalog-accessories', 0))");
    for (const patch of patches) {
      const result = await client.query<{ before_payload: AccessoryItem; after_payload: AccessoryItem }>(
        `WITH current AS (
           SELECT id, payload AS before_payload FROM catalog_accessories
           WHERE id = $1 AND source = 'danawa' AND source_product_code = $2 AND payload->>'danawaUrl' = $3
           FOR UPDATE
         ), updated AS (
           UPDATE catalog_accessories AS catalog
           SET payload = jsonb_set(
             jsonb_set(current.before_payload, '{priceWon}', to_jsonb($4::numeric), true),
             '{priceCheckedAt}', to_jsonb($5::text), true
           ), updated_at = statement_timestamp()
           FROM current
           WHERE catalog.id = current.id
           RETURNING catalog.id, catalog.payload AS after_payload
         )
         SELECT current.before_payload, updated.after_payload FROM current JOIN updated USING (id)`,
        [patch.id, patch.sourceProductCode, patch.danawaUrl, patch.priceWon, patch.priceCheckedAt]
      );
      if (result.rows[0]) changed.push({ before: result.rows[0].before_payload, after: result.rows[0].after_payload });
    }
    const timestampResult = await client.query<{ updated_at: Date | string | null }>("SELECT MAX(updated_at) AS updated_at FROM catalog_accessories");
    await client.query("COMMIT");
    return { updates: changed, updatedAt: accessoryCatalogTimestamp(timestampResult.rows[0]?.updated_at) };
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    markDatabaseUnavailable("accessory price patch", error);
    throw new Error(`PostgreSQL accessory price patch failed; kept the existing database prices: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release(discardClient);
  }
}

export type CoolingFanLoadOverrideMapRecord = Record<string, CoolingFanLoadOverride>;
export type CoolingFanLoadOverrideSnapshotRecord = {
  overrides: CoolingFanLoadOverrideMapRecord;
  updatedAt: string;
};

function coolingFanLoadOverrideMapFromUnknown(value: unknown): CoolingFanLoadOverrideMapRecord {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PostgreSQL cooling-fan override snapshot is not an object.");
  }
  return value as CoolingFanLoadOverrideMapRecord;
}

export async function readCoolingFanLoadOverrideRecords(): Promise<CoolingFanLoadOverrideSnapshotRecord> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ payload: unknown; updated_at: Date | string | null }>(
      "SELECT payload, updated_at FROM cooling_fan_load_overrides WHERE singleton_id = 'current'"
    );
    return {
      overrides: coolingFanLoadOverrideMapFromUnknown(result.rows[0]?.payload),
      updatedAt: accessoryCatalogTimestamp(result.rows[0]?.updated_at)
    };
  } catch (error: unknown) {
    markDatabaseUnavailable("cooling-fan override read", error);
    throw error;
  }
}

/**
 * Serializes read/modify/write operations for the singleton override map across
 * API replicas. The transaction lock also protects the first insert when the
 * singleton row does not exist yet.
 */
export async function mutateCoolingFanLoadOverrideRecords(
  mutation: (current: CoolingFanLoadOverrideMapRecord) => CoolingFanLoadOverrideMapRecord
): Promise<CoolingFanLoadOverrideMapRecord> {
  await ensureDatabase();

  let client: PoolClient;
  try {
    client = await pool!.connect();
  } catch (error: unknown) {
    markDatabaseUnavailable("cooling-fan override connection", error);
    throw error;
  }

  let discardClient = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:cooling-fan-load-overrides', 0))");
    const currentResult = await client.query<{ payload: unknown }>(
      "SELECT payload FROM cooling_fan_load_overrides WHERE singleton_id = 'current' FOR UPDATE"
    );
    const next = coolingFanLoadOverrideMapFromUnknown(mutation(coolingFanLoadOverrideMapFromUnknown(currentResult.rows[0]?.payload)));
    await client.query(
      `INSERT INTO cooling_fan_load_overrides (singleton_id, payload, updated_at)
       VALUES ('current', $1::jsonb, statement_timestamp())
       ON CONFLICT (singleton_id) DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = statement_timestamp()`,
      [JSON.stringify(next)]
    );
    await client.query("COMMIT");
    return next;
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    markDatabaseUnavailable("cooling-fan override write", error);
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export type CatalogSpecOverrideMapRecord = Record<string, CatalogSpecOverride>;
export type M2SlotOverrideMapRecord = Record<string, M2SlotOverride>;

type SingletonOverrideTable = "catalog_spec_overrides" | "m2_slot_overrides";
type SingletonOverrideMutation<T, V> = {
  value: V;
  overrides: Record<string, T>;
  changed: boolean;
};

function singletonOverrideMapFromUnknown<T>(value: unknown, label: string): Record<string, T> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`PostgreSQL ${label} snapshot is not an object.`);
  }
  return value as Record<string, T>;
}

async function readPostgresSingletonOverrideMap<T>(table: SingletonOverrideTable, label: string): Promise<Record<string, T>> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ payload: unknown }>(
      `SELECT payload FROM ${table} WHERE singleton_id = 'current'`
    );
    return singletonOverrideMapFromUnknown<T>(result.rows[0]?.payload, label);
  } catch (error: unknown) {
    markDatabaseUnavailable(`${label} read`, error);
    throw error;
  }
}

async function mutatePostgresSingletonOverrideMap<T, V>(
  table: SingletonOverrideTable,
  lockScope: string,
  label: string,
  mutation: (current: Record<string, T>) => SingletonOverrideMutation<T, V> | Promise<SingletonOverrideMutation<T, V>>
): Promise<V> {
  await ensureDatabase();

  let client: PoolClient;
  try {
    client = await pool!.connect();
  } catch (error: unknown) {
    markDatabaseUnavailable(`${label} connection`, error);
    throw error;
  }

  let discardClient = false;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:${lockScope}', 0))`);
    const currentResult = await client.query<{ payload: unknown }>(
      `SELECT payload FROM ${table} WHERE singleton_id = 'current' FOR UPDATE`
    );
    const current = singletonOverrideMapFromUnknown<T>(currentResult.rows[0]?.payload, label);
    const result = await mutation(current);
    if (result.changed) {
      await client.query(
        `INSERT INTO ${table} (singleton_id, payload, updated_at)
         VALUES ('current', $1::jsonb, statement_timestamp())
         ON CONFLICT (singleton_id) DO UPDATE SET
           payload = EXCLUDED.payload,
           updated_at = statement_timestamp()`,
        [JSON.stringify(result.overrides)]
      );
    }
    await client.query("COMMIT");
    return result.value;
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    markDatabaseUnavailable(`${label} write`, error);
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function readCatalogSpecOverrideRecords(): Promise<CatalogSpecOverrideMapRecord> {
  return readPostgresSingletonOverrideMap<CatalogSpecOverride>("catalog_spec_overrides", "catalog-spec override");
}

export async function mutateCatalogSpecOverrideRecords<V>(
  mutation: (current: CatalogSpecOverrideMapRecord) => SingletonOverrideMutation<CatalogSpecOverride, V> | Promise<SingletonOverrideMutation<CatalogSpecOverride, V>>
): Promise<V> {
  return mutatePostgresSingletonOverrideMap("catalog_spec_overrides", "catalog-spec-overrides", "catalog-spec override", mutation);
}

export async function readM2SlotOverrideRecords(): Promise<M2SlotOverrideMapRecord> {
  return readPostgresSingletonOverrideMap<M2SlotOverride>("m2_slot_overrides", "M.2 slot override");
}

export async function mutateM2SlotOverrideRecords<V>(
  mutation: (current: M2SlotOverrideMapRecord) => SingletonOverrideMutation<M2SlotOverride, V> | Promise<SingletonOverrideMutation<M2SlotOverride, V>>
): Promise<V> {
  return mutatePostgresSingletonOverrideMap("m2_slot_overrides", "m2-slot-overrides", "M.2 slot override", mutation);
}

export type CatalogOverrideMapUpdatedAtRecord = {
  catalogSpecUpdatedAt: string;
  m2SlotUpdatedAt: string;
};

export async function readCatalogOverrideMapUpdatedAtRecords(): Promise<CatalogOverrideMapUpdatedAtRecord> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{
      catalog_spec_updated_at: Date | string | null;
      m2_slot_updated_at: Date | string | null;
    }>(
      `SELECT
         (SELECT updated_at FROM catalog_spec_overrides WHERE singleton_id = 'current') AS catalog_spec_updated_at,
         (SELECT updated_at FROM m2_slot_overrides WHERE singleton_id = 'current') AS m2_slot_updated_at`
    );
    return {
      catalogSpecUpdatedAt: accessoryCatalogTimestamp(result.rows[0]?.catalog_spec_updated_at),
      m2SlotUpdatedAt: accessoryCatalogTimestamp(result.rows[0]?.m2_slot_updated_at)
    };
  } catch (error: unknown) {
    markDatabaseUnavailable("catalog override timestamp read", error);
    throw error;
  }
}

const EMPTY_ACCESSORY_COVERAGE: AccessoryCoverageSnapshot = { updatedAt: "", categories: [] };

export async function readAccessoryCoverageRecord(): Promise<AccessoryCoverageSnapshot> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ payload: AccessoryCoverageSnapshot }>(
      "SELECT payload FROM accessory_coverage_state WHERE singleton_id = 'current'"
    );
    return result.rows[0]?.payload ?? EMPTY_ACCESSORY_COVERAGE;
  } catch (error: unknown) {
    markDatabaseUnavailable("accessory coverage read", error);
    throw error;
  }
}

export async function mutateAccessoryCoverageRecord(
  mutation: (current: AccessoryCoverageSnapshot) => AccessoryCoverageSnapshot
): Promise<AccessoryCoverageSnapshot> {
  await ensureDatabase();

  let client: PoolClient;
  try {
    client = await pool!.connect();
  } catch (error: unknown) {
    markDatabaseUnavailable("accessory coverage connection", error);
    throw error;
  }

  let discardClient = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:accessory-coverage', 0))");
    const currentResult = await client.query<{ payload: AccessoryCoverageSnapshot }>(
      "SELECT payload FROM accessory_coverage_state WHERE singleton_id = 'current' FOR UPDATE"
    );
    const next = mutation(currentResult.rows[0]?.payload ?? EMPTY_ACCESSORY_COVERAGE);
    await client.query(
      `INSERT INTO accessory_coverage_state (singleton_id, payload, updated_at)
       VALUES ('current', $1::jsonb, statement_timestamp())
       ON CONFLICT (singleton_id) DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = statement_timestamp()`,
      [JSON.stringify(next)]
    );
    await client.query("COMMIT");
    return next;
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    markDatabaseUnavailable("accessory coverage write", error);
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function readBenchmarkOverrideRecords(): Promise<Record<string, BenchmarkOverride>> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ part_id: string; payload: BenchmarkOverride }>(
      "SELECT part_id, payload FROM benchmark_overrides ORDER BY updated_at DESC"
    );
    if (result.rows.length > 0) return Object.fromEntries(result.rows.map((row) => [row.part_id, row.payload]));
    return {};
  } catch (error) {
    markDatabaseUnavailable("benchmark override read", error);
    throw error;
  }
}

export async function writeBenchmarkOverrideRecords(overrides: Record<string, BenchmarkOverride>) {
  const values = Object.values(overrides);
  await ensureDatabase();
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
    markDatabaseUnavailable("benchmark override write", error);
    throw error;
  } finally {
    client.release();
  }
}

const SAVED_BUILD_DATABASE_COLUMNS = "id, name, selection, recommendation_preferences, created_at, updated_at, expires_at, owner_token_hash, recovery_code_hash, my_pc_at, version_group_id, version_number, derived_from_build_id, check_snapshot, check_history, monitor_state, purchase_progress, purchase_price_history, decision_note, origin, metadata_history";

type SavedBuildDatabaseRow = {
  id: string;
  name: string;
  selection: SavedBuildRecord["selection"];
  recommendation_preferences: SavedBuildRecord["recommendationPreferences"] | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  owner_token_hash: string | null;
  recovery_code_hash: string | null;
  my_pc_at: Date | null;
  version_group_id: string | null;
  version_number: number | null;
  derived_from_build_id: string | null;
  check_snapshot: SavedBuildRecord["checkSnapshot"] | null;
  check_history: SavedBuildRecord["checkHistory"] | null;
  monitor_state: SavedBuildMonitorSubscription | null;
  purchase_progress: SavedBuildPurchaseProgress | null;
  purchase_price_history: SavedBuildPurchasePriceHistory | null;
  decision_note: string | null;
  origin: SavedBuildRecord["origin"] | null;
  metadata_history: unknown | null;
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

type SavedGeneratorVariantsDatabaseRow = {
  id: string;
  name: string;
  payload: SavedGeneratorVariantsRecord["payload"];
  request: SavedGeneratorVariantsRecord["request"] | null;
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
  const recoveryCodeHash = typeof candidate.recoveryCodeHash === "string" && /^[0-9a-f]{64}$/.test(candidate.recoveryCodeHash) ? candidate.recoveryCodeHash : undefined;
  const myPcAt = typeof candidate.myPcAt === "string" && Number.isFinite(Date.parse(candidate.myPcAt)) ? candidate.myPcAt : undefined;
  const explicitSnapshot = savedBuildCheckSnapshotFromUnknown(candidate.checkSnapshot);
  const parsedHistory = savedBuildCheckHistoryFromUnknown(candidate.checkHistory);
  if (candidate.checkHistory !== undefined && !parsedHistory) return undefined;
  const normalizedHistory = parsedHistory ?? [];
  const checkHistory = explicitSnapshot && (normalizedHistory.length === 0 || normalizedHistory[normalizedHistory.length - 1].checkedAt !== explicitSnapshot.checkedAt)
    ? [...normalizedHistory, explicitSnapshot].slice(-SAVED_BUILD_CHECK_HISTORY_LIMIT)
    : normalizedHistory;
  const checkSnapshot = explicitSnapshot ?? checkHistory[checkHistory.length - 1];
  const monitorState = savedBuildMonitorSubscriptionFromUnknown(candidate.monitorState);
  const purchaseProgress = savedBuildPurchaseProgressFromUnknown(candidate.purchaseProgress);
  const purchasePriceHistory = savedBuildPurchasePriceHistoryFromUnknown(candidate.purchasePriceHistory);
  const decisionNote = savedBuildDecisionNoteFromUnknown(candidate.decisionNote);
  const origin = savedBuildOriginFromUnknown(candidate.origin);
  if (candidate.origin !== undefined && !origin) return undefined;
  const metadataHistory = savedBuildMetadataHistoryFromUnknown(candidate.metadataHistory);
  if (candidate.metadataHistory !== undefined && !metadataHistory) return undefined;
  const normalizedMetadataHistory = metadataHistory ?? [];
  const versionGroupId = typeof candidate.versionGroupId === "string" && candidate.versionGroupId.length > 0 && candidate.versionGroupId.length <= 120 ? candidate.versionGroupId : undefined;
  const versionNumber = Number.isInteger(candidate.versionNumber) && (candidate.versionNumber ?? 0) >= 1 && (candidate.versionNumber ?? 0) <= 1_000_000 ? candidate.versionNumber : undefined;
  const derivedFromBuildId = typeof candidate.derivedFromBuildId === "string" && candidate.derivedFromBuildId.length > 0 && candidate.derivedFromBuildId.length <= 120 ? candidate.derivedFromBuildId : undefined;
  const { ownerTokenHash: _rawOwnerTokenHash, recoveryCodeHash: _rawRecoveryCodeHash, myPcAt: _rawMyPcAt, versionGroupId: _rawVersionGroupId, versionNumber: _rawVersionNumber, derivedFromBuildId: _rawDerivedFromBuildId, checkSnapshot: _rawCheckSnapshot, checkHistory: _rawCheckHistory, monitorState: _rawMonitorState, purchaseProgress: _rawPurchaseProgress, purchasePriceHistory: _rawPurchasePriceHistory, decisionNote: _rawDecisionNote, origin: _rawOrigin, metadataHistory: _rawMetadataHistory, ...build } = candidate as SavedBuildRecord;
  return { ...build, ...(decisionNote ? { decisionNote } : {}), ...(origin ? { origin } : {}), ...(normalizedMetadataHistory.length > 0 ? { metadataHistory: normalizedMetadataHistory } : {}), ...(ownerTokenHash ? { ownerTokenHash } : {}), ...(recoveryCodeHash ? { recoveryCodeHash } : {}), ...(myPcAt ? { myPcAt } : {}), ...(versionGroupId ? { versionGroupId } : {}), ...(versionNumber ? { versionNumber } : {}), ...(derivedFromBuildId ? { derivedFromBuildId } : {}), ...(checkSnapshot ? { checkSnapshot } : {}), ...(checkHistory.length > 0 ? { checkHistory } : {}), ...(monitorState ? { monitorState } : {}), ...(purchaseProgress ? { purchaseProgress } : {}), ...(purchasePriceHistory ? { purchasePriceHistory } : {}) };
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
    ...(row.recovery_code_hash ? { recoveryCodeHash: row.recovery_code_hash } : {}),
    ...(row.my_pc_at ? { myPcAt: new Date(row.my_pc_at).toISOString() } : {}),
    ...(row.version_group_id ? { versionGroupId: row.version_group_id } : {}),
    ...(row.version_number ? { versionNumber: row.version_number } : {}),
    ...(row.derived_from_build_id ? { derivedFromBuildId: row.derived_from_build_id } : {}),
    ...(row.check_snapshot ? { checkSnapshot: row.check_snapshot } : {}),
    ...(row.check_history ? { checkHistory: row.check_history } : {}),
    ...(row.monitor_state ? { monitorState: row.monitor_state } : {}),
    ...(row.purchase_progress ? { purchaseProgress: row.purchase_progress } : {}),
    ...(row.purchase_price_history ? { purchasePriceHistory: row.purchase_price_history } : {}),
    ...(row.decision_note ? { decisionNote: row.decision_note } : {}),
    ...(row.origin ? { origin: row.origin } : {}),
    ...(row.metadata_history ? { metadataHistory: row.metadata_history } : {})
  });
}

function requiredSavedBuildRecordFromDatabaseRow(row: SavedBuildDatabaseRow | undefined) {
  const build = row ? savedBuildRecordFromDatabaseRow(row) : undefined;
  if (!build) throw new Error("저장 견적 변경 결과를 안전하게 해석할 수 없습니다.");
  return build;
}

export async function readSavedBuilds(): Promise<SavedBuildRecord[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedBuildDatabaseRow>(
      `SELECT ${SAVED_BUILD_DATABASE_COLUMNS} FROM saved_builds ORDER BY updated_at DESC`
    );
    return savedBuildRecordsFromUnknownArray(result.rows.map(savedBuildRecordFromDatabaseRow));
  } catch (error) {
    markDatabaseUnavailable("build read", error);
    throw error;
  }
}

function savedBuildRecordsFromUnknownArray(value: unknown): SavedBuildRecord[] {
  if (!Array.isArray(value)) throw new Error("저장 견적 데이터가 배열 형식이 아니므로 원본을 보존했습니다.");
  const builds = value.map(savedBuildRecordFromUnknown);
  if (builds.some((build) => build === undefined)) throw new Error("저장 견적 데이터 일부를 안전하게 해석할 수 없어 원본을 보존했습니다.");
  return builds.filter((build): build is SavedBuildRecord => build !== undefined);
}

export async function writeSavedBuilds(builds: SavedBuildRecord[]) {
  await ensureDatabase();
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
        `INSERT INTO saved_builds (id, name, decision_note, origin, selection, recommendation_preferences, created_at, updated_at, expires_at, owner_token_hash, recovery_code_hash, my_pc_at, version_group_id, version_number, derived_from_build_id, check_snapshot, check_history, monitor_state, purchase_progress, purchase_price_history, metadata_history)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::timestamptz, $8::timestamptz, $9::timestamptz, $10, $11, $12::timestamptz, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb, $21::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           decision_note = EXCLUDED.decision_note,
           origin = EXCLUDED.origin,
           selection = EXCLUDED.selection,
           recommendation_preferences = EXCLUDED.recommendation_preferences,
           updated_at = EXCLUDED.updated_at,
           expires_at = EXCLUDED.expires_at,
           owner_token_hash = EXCLUDED.owner_token_hash,
           my_pc_at = EXCLUDED.my_pc_at,
           recovery_code_hash = EXCLUDED.recovery_code_hash,
           version_group_id = EXCLUDED.version_group_id,
           version_number = EXCLUDED.version_number,
           derived_from_build_id = EXCLUDED.derived_from_build_id,
           check_snapshot = EXCLUDED.check_snapshot,
           check_history = EXCLUDED.check_history,
           monitor_state = EXCLUDED.monitor_state,
           purchase_progress = EXCLUDED.purchase_progress,
           purchase_price_history = EXCLUDED.purchase_price_history,
           metadata_history = EXCLUDED.metadata_history`,
        [build.id, build.name, build.decisionNote ?? null, build.origin ? JSON.stringify(build.origin) : null, JSON.stringify(build.selection), build.recommendationPreferences ? JSON.stringify(build.recommendationPreferences) : null, build.createdAt, build.updatedAt, build.expiresAt ?? null, build.ownerTokenHash ?? null, build.recoveryCodeHash ?? null, build.myPcAt ?? null, build.versionGroupId ?? null, build.versionNumber ?? null, build.derivedFromBuildId ?? null, build.checkSnapshot ? JSON.stringify(build.checkSnapshot) : null, build.checkHistory ? JSON.stringify(build.checkHistory) : null, build.monitorState ? JSON.stringify(build.monitorState) : null, build.purchaseProgress ? JSON.stringify(build.purchaseProgress) : null, build.purchasePriceHistory ? JSON.stringify(build.purchasePriceHistory) : null, build.metadataHistory ? JSON.stringify(build.metadataHistory) : null]
      );
    }
    await client.query("COMMIT");
    return;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("build write", error);
    throw error;
  } finally {
    client.release();
  }
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
      `INSERT INTO saved_builds (id, name, decision_note, origin, selection, recommendation_preferences, created_at, updated_at, expires_at, owner_token_hash, recovery_code_hash, my_pc_at, version_group_id, version_number, derived_from_build_id, check_snapshot, check_history, monitor_state, purchase_progress, purchase_price_history, metadata_history)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::timestamptz, $8::timestamptz, $9::timestamptz, $10, $11, $12::timestamptz, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb, $21::jsonb)`,
      [next.id, next.name, next.decisionNote ?? null, next.origin ? JSON.stringify(next.origin) : null, JSON.stringify(next.selection), next.recommendationPreferences ? JSON.stringify(next.recommendationPreferences) : null, next.createdAt, next.updatedAt, next.expiresAt ?? null, next.ownerTokenHash ?? null, next.recoveryCodeHash ?? null, next.myPcAt ?? null, next.versionGroupId, next.versionNumber, next.derivedFromBuildId ?? null, next.checkSnapshot ? JSON.stringify(next.checkSnapshot) : null, next.checkHistory ? JSON.stringify(next.checkHistory) : null, next.monitorState ? JSON.stringify(next.monitorState) : null, next.purchaseProgress ? JSON.stringify(next.purchaseProgress) : null, next.purchasePriceHistory ? JSON.stringify(next.purchasePriceHistory) : null, next.metadataHistory ? JSON.stringify(next.metadataHistory) : null]
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
  await ensureDatabase();
  try {
    return await appendSavedBuildToDatabase(build, boundedMax);
  } catch (error: unknown) {
    markDatabaseUnavailable("versioned build write", error);
    throw error;
  }
}

export type SavedBuildMetadataUpdateResult =
  | { status: "updated"; build: SavedBuildRecord }
  | { status: "not-found" };

export async function updateSavedBuildMetadata(id: string, name: string, decisionNote?: string): Promise<SavedBuildMetadataUpdateResult> {
  const updatedAt = new Date().toISOString();
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<{ name: string; decision_note: string | null; metadata_history: unknown }>(
      "SELECT name, decision_note, metadata_history FROM saved_builds WHERE id = $1 FOR UPDATE",
      [id]
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("COMMIT");
      return { status: "not-found" };
    }
    const metadataHistory = savedBuildMetadataHistoryWithNextEntryFor(
      savedBuildMetadataHistoryFromUnknown(current.metadata_history),
      savedBuildMetadataHistoryEntryFor(
        { name: current.name, ...(current.decision_note ? { decisionNote: current.decision_note } : {}) },
        { name, ...(decisionNote ? { decisionNote } : {}) },
        updatedAt
      )
    );
    const updatedResult = await client.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET name = $2, decision_note = $3, updated_at = $4::timestamptz, metadata_history = $5::jsonb WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, name, decisionNote ?? null, updatedAt, JSON.stringify(metadataHistory)]
    );
    const updated = requiredSavedBuildRecordFromDatabaseRow(updatedResult.rows[0]);
    await client.query("COMMIT");
    return { status: "updated", build: updated };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("saved build metadata update", error);
    throw error;
  } finally {
    client.release();
  }
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

function savedBuildVersionBackupSummaryFor(backup: SavedBuildVersionBackup, currentFingerprint: string): SavedBuildVersionBackupSummary {
  return { backupId: backup.id, createdAt: backup.createdAt, totalBuilds: backup.builds.length, changedCount: backup.changedCount, sourceFingerprint: backup.sourceFingerprint, resultingFingerprint: backup.resultingFingerprint, rollbackAvailable: currentFingerprint === backup.resultingFingerprint };
}

function savedBuildVersionBackupDetailFor(backup: SavedBuildVersionBackup, currentFingerprint: string): SavedBuildVersionBackupDetail {
  return { ...savedBuildVersionBackupSummaryFor(backup, currentFingerprint), currentFingerprint, items: savedBuildVersionBackupDiffFor(backup.builds) };
}

export async function readSavedBuildVersionBackups(): Promise<SavedBuildVersionBackupSummary[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ id: string; created_at: Date; source_fingerprint: string; resulting_fingerprint: string; changed_count: number | string; total_builds: number | string }>(
      "SELECT id, created_at, source_fingerprint, resulting_fingerprint, changed_count, jsonb_array_length(builds) AS total_builds FROM saved_build_version_backups ORDER BY created_at DESC LIMIT $1",
      [SAVED_BUILD_VERSION_BACKUP_RETENTION]
    );
    const currentFingerprint = savedBuildVersionSnapshotFingerprintFor(await readSavedBuilds());
    return result.rows.map((row) => ({ backupId: row.id, createdAt: new Date(row.created_at).toISOString(), totalBuilds: Number(row.total_builds), changedCount: Number(row.changed_count), sourceFingerprint: row.source_fingerprint, resultingFingerprint: row.resulting_fingerprint, rollbackAvailable: currentFingerprint === row.resulting_fingerprint }));
  } catch (error: unknown) {
    markDatabaseUnavailable("version backup read", error);
    throw error;
  }
}

export async function readLatestSavedBuildVersionBackup(): Promise<SavedBuildVersionBackupSummary | undefined> {
  return (await readSavedBuildVersionBackups())[0];
}

export async function readSavedBuildVersionBackupDetail(backupId: string): Promise<SavedBuildVersionBackupDetail | undefined> {
  await ensureDatabase();
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
    markDatabaseUnavailable("version backup detail read", error);
    throw error;
  }
}

async function readSavedBuildsWithDatabaseClient(client: PoolClient) {
  const result = await client.query<SavedBuildDatabaseRow>(
    `SELECT ${SAVED_BUILD_DATABASE_COLUMNS} FROM saved_builds ORDER BY updated_at DESC`
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
  await ensureDatabase();
  return migrateSavedBuildVersionsInDatabase(expectedFingerprint);
}

export async function rollbackSavedBuildVersions(backupId: string, expectedFingerprint: string): Promise<SavedBuildVersionRollbackOperation> {
  await ensureDatabase();
  return rollbackSavedBuildVersionsInDatabase(backupId, expectedFingerprint);
}

export async function appendSavedBuildCheck(id: string, snapshot: SavedBuildCheckSnapshot, max = 20) {
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
}

export async function updateSavedBuildAssemblyVerification(id: string, verification: AssemblyVerificationSavedSnapshot, verificationHistory: AssemblyVerificationSavedSnapshot[] = [verification]) {
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
}

export type SavedBuildPurchaseProgressUpdateResult =
  | { status: "updated"; build: SavedBuildRecord; purchaseProgress: SavedBuildPurchaseProgress }
  | { status: "not-found" }
  | { status: "conflict"; currentProgress?: SavedBuildPurchaseProgress };

export type SavedBuildPurchaseProgressRestoreResult = SavedBuildPurchaseProgressUpdateResult
  | { status: "history-unavailable"; currentProgress?: SavedBuildPurchaseProgress };

export async function updateSavedBuildPurchaseProgress(id: string, purchaseProgress: SavedBuildPurchaseProgress, expectedRevision: number | null = null): Promise<SavedBuildPurchaseProgressUpdateResult> {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<{ purchase_progress: unknown }>("SELECT purchase_progress FROM saved_builds WHERE id = $1 FOR UPDATE", [id]);
    if (currentResult.rows.length === 0) {
      await client.query("COMMIT");
      return { status: "not-found" };
    }
    const currentProgress = savedBuildPurchaseProgressFromUnknown(currentResult.rows[0].purchase_progress);
    if (!savedBuildPurchaseProgressRevisionMatchesFor(currentProgress, expectedRevision)) {
      await client.query("COMMIT");
      return { status: "conflict", ...(currentProgress ? { currentProgress } : {}) };
    }
    const nextPurchaseProgress = savedBuildPurchaseProgressWithNextRevisionFor(purchaseProgress, currentProgress);
    const updatedResult = await client.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET purchase_progress = $2::jsonb WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, JSON.stringify(nextPurchaseProgress)]
    );
    const build = requiredSavedBuildRecordFromDatabaseRow(updatedResult.rows[0]);
    await client.query("COMMIT");
    return { status: "updated", build, purchaseProgress: nextPurchaseProgress };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("purchase progress update", error);
    throw error;
  } finally {
    client.release();
  }
}

export type SavedBuildPurchasePriceHistoryUpdateResult =
  | { status: "updated"; build: SavedBuildRecord; purchasePriceHistory: SavedBuildPurchasePriceHistory }
  | { status: "not-found" }
  | { status: "conflict"; currentPriceHistory?: SavedBuildPurchasePriceHistory };

export async function updateSavedBuildPurchasePriceHistory(id: string, purchasePriceHistory: SavedBuildPurchasePriceHistorySnapshot, expectedRevision: number | null = null): Promise<SavedBuildPurchasePriceHistoryUpdateResult> {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<{ purchase_price_history: unknown }>("SELECT purchase_price_history FROM saved_builds WHERE id = $1 FOR UPDATE", [id]);
    if (currentResult.rows.length === 0) {
      await client.query("COMMIT");
      return { status: "not-found" };
    }
    const currentPriceHistory = savedBuildPurchasePriceHistoryFromUnknown(currentResult.rows[0].purchase_price_history);
    if (!savedBuildPurchasePriceHistoryRevisionMatchesFor(currentPriceHistory, expectedRevision)) {
      await client.query("COMMIT");
      return { status: "conflict", ...(currentPriceHistory ? { currentPriceHistory } : {}) };
    }
    const nextPriceHistory = savedBuildPurchasePriceHistoryWithNextRevisionFor(purchasePriceHistory, currentPriceHistory);
    const updatedResult = await client.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET purchase_price_history = $2::jsonb WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, JSON.stringify(nextPriceHistory)]
    );
    const build = requiredSavedBuildRecordFromDatabaseRow(updatedResult.rows[0]);
    await client.query("COMMIT");
    return { status: "updated", build, purchasePriceHistory: nextPriceHistory };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("purchase price history update", error);
    throw error;
  } finally {
    client.release();
  }
}

export type SavedBuildPurchasePriceHistoryRestoreResult = SavedBuildPurchasePriceHistoryUpdateResult
  | { status: "history-unavailable"; currentPriceHistory?: SavedBuildPurchasePriceHistory };

export async function restoreSavedBuildPurchasePriceHistory(id: string, targetRevision: number, expectedRevision: number | null = null, expectedFingerprint?: string, expectedRowKeys: string[] = []): Promise<SavedBuildPurchasePriceHistoryRestoreResult> {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<{ purchase_price_history: unknown }>("SELECT purchase_price_history FROM saved_builds WHERE id = $1 FOR UPDATE", [id]);
    if (currentResult.rows.length === 0) {
      await client.query("COMMIT");
      return { status: "not-found" };
    }
    const currentPriceHistory = savedBuildPurchasePriceHistoryFromUnknown(currentResult.rows[0].purchase_price_history);
    if (!savedBuildPurchasePriceHistoryRevisionMatchesFor(currentPriceHistory, expectedRevision)) {
      await client.query("COMMIT");
      return { status: "conflict", ...(currentPriceHistory ? { currentPriceHistory } : {}) };
    }
    const target = savedBuildPurchasePriceHistoryHistoryTargetFor(currentPriceHistory, targetRevision);
    const rowKeysMatch = expectedRowKeys.length === 0 || (target ? target.rowKeys.length === expectedRowKeys.length && target.rowKeys.every((key) => expectedRowKeys.includes(key)) : false);
    if (!target || (expectedFingerprint && target.inputFingerprint !== expectedFingerprint) || !rowKeysMatch) {
      await client.query("COMMIT");
      return { status: "history-unavailable", ...(currentPriceHistory ? { currentPriceHistory } : {}) };
    }
    const nextPriceHistory = savedBuildPurchasePriceHistoryWithNextRevisionFor(target, currentPriceHistory);
    const updatedResult = await client.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET purchase_price_history = $2::jsonb WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, JSON.stringify(nextPriceHistory)]
    );
    const build = requiredSavedBuildRecordFromDatabaseRow(updatedResult.rows[0]);
    await client.query("COMMIT");
    return { status: "updated", build, purchasePriceHistory: nextPriceHistory };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("purchase price history restore", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function restoreSavedBuildPurchaseProgress(id: string, targetRevision: number, expectedRevision: number | null = null, expectedFingerprint?: string, expectedRowKeys: string[] = []): Promise<SavedBuildPurchaseProgressRestoreResult> {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<{ purchase_progress: unknown }>("SELECT purchase_progress FROM saved_builds WHERE id = $1 FOR UPDATE", [id]);
    if (currentResult.rows.length === 0) {
      await client.query("COMMIT");
      return { status: "not-found" };
    }
    const currentProgress = savedBuildPurchaseProgressFromUnknown(currentResult.rows[0].purchase_progress);
    if (!savedBuildPurchaseProgressRevisionMatchesFor(currentProgress, expectedRevision)) {
      await client.query("COMMIT");
      return { status: "conflict", ...(currentProgress ? { currentProgress } : {}) };
    }
    const target = savedBuildPurchaseProgressHistoryTargetFor(currentProgress, targetRevision);
    const rowKeysMatch = expectedRowKeys.length === 0 || (target ? target.rowKeys.length === expectedRowKeys.length && target.rowKeys.every((key) => expectedRowKeys.includes(key)) : false);
    if (!target || (expectedFingerprint && target.inputFingerprint !== expectedFingerprint) || !rowKeysMatch) {
      await client.query("COMMIT");
      return { status: "history-unavailable", ...(currentProgress ? { currentProgress } : {}) };
    }
    const nextPurchaseProgress = savedBuildPurchaseProgressWithNextRevisionFor(target, currentProgress);
    const updatedResult = await client.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET purchase_progress = $2::jsonb WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, JSON.stringify(nextPurchaseProgress)]
    );
    const build = requiredSavedBuildRecordFromDatabaseRow(updatedResult.rows[0]);
    await client.query("COMMIT");
    return { status: "updated", build, purchaseProgress: nextPurchaseProgress };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("purchase progress restore", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateSavedBuildMonitorState(id: string, monitorState: SavedBuildMonitorSubscription) {
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET monitor_state = $2::jsonb WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, JSON.stringify(monitorState)]
    );
    const row = result.rows[0];
    return row ? requiredSavedBuildRecordFromDatabaseRow(row) : undefined;
  } catch (error) {
    markDatabaseUnavailable("build monitor update", error);
    throw error;
  }
}

export async function updateSavedBuildShareCredentials(
  id: string,
  ownerTokenHash: string,
  recoveryCodeHash: string,
  expectedRecoveryCodeHash: string | undefined
): Promise<{ id: string } | undefined> {
  await ensureDatabase();
  try {
    const result = await pool!.query(
      "UPDATE saved_builds SET owner_token_hash = $2, recovery_code_hash = $3 WHERE id = $1 AND recovery_code_hash IS NOT DISTINCT FROM $4 RETURNING id",
      [id, ownerTokenHash, recoveryCodeHash, expectedRecoveryCodeHash ?? null]
    );
    return result.rows[0]?.id ? { id: result.rows[0].id as string } : undefined;
  } catch (error) {
    markDatabaseUnavailable("build credential update", error);
    throw error;
  }
}

export async function updateSavedBuildMyPc(id: string, myPcAt: string | null, monitorState?: SavedBuildMonitorSubscription) {
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET my_pc_at = $2::timestamptz, monitor_state = COALESCE($3::jsonb, monitor_state) WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, myPcAt, monitorState ? JSON.stringify(monitorState) : null]
    );
    const row = result.rows[0];
    return row ? requiredSavedBuildRecordFromDatabaseRow(row) : undefined;
  } catch (error) {
    markDatabaseUnavailable("build my-pc update", error);
    throw error;
  }
}

export async function deleteSavedBuild(id: string) {
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM saved_builds WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    markDatabaseUnavailable("build delete", error);
    throw error;
  }
}

function savedWatchlistRecordFromUnknown(value: unknown): SavedCatalogWatchlistRecord | undefined {
  const normalized = savedCatalogWatchlistFromUnknown(value);
  if (!normalized || !value || typeof value !== "object" || Array.isArray(value)) return normalized;
  const candidate = value as { ownerTokenHash?: unknown };
  const ownerTokenHash = typeof candidate.ownerTokenHash === "string" && /^[0-9a-f]{64}$/.test(candidate.ownerTokenHash) ? candidate.ownerTokenHash : undefined;
  return { ...normalized, ...(ownerTokenHash ? { ownerTokenHash } : {}) };
}

export async function readSavedWatchlists(): Promise<SavedCatalogWatchlistRecord[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ id: string; name: string; entries: SavedCatalogWatchlistRecord["entries"]; near_low_threshold_percent: 5 | 10 | 20; alert_preferences: SavedWatchlistAlertPreferences | null; created_at: Date; updated_at: Date; expires_at: Date | null; owner_token_hash: string | null }>(
      "SELECT id, name, entries, near_low_threshold_percent, alert_preferences, created_at, updated_at, expires_at, owner_token_hash FROM saved_watchlists ORDER BY updated_at DESC"
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, entries: row.entries, nearLowThresholdPercent: row.near_low_threshold_percent, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), ...(row.alert_preferences ? { alertPreferences: savedWatchlistAlertPreferencesFromUnknown(row.alert_preferences) } : {}), ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}), ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {}) }));
  } catch (error) {
    markDatabaseUnavailable("watchlist read", error);
    throw error;
  }
}

export async function writeSavedWatchlists(watchlists: SavedCatalogWatchlistRecord[]) {
  await ensureDatabase();
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
    markDatabaseUnavailable("watchlist write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendSavedWatchlist(watchlist: SavedCatalogWatchlistRecord, max = 100) {
  const watchlists = await readSavedWatchlists();
  await writeSavedWatchlists([watchlist, ...watchlists].slice(0, max));
}

export async function updateSavedWatchlist(watchlist: SavedCatalogWatchlistRecord) {
  await ensureDatabase();
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
    markDatabaseUnavailable("watchlist update", error);
    throw error;
  }
}

export async function deleteSavedWatchlist(id: string) {
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM saved_watchlists WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    markDatabaseUnavailable("watchlist delete", error);
    throw error;
  }
}

export async function readSavedComparisons(): Promise<SavedAlternativeComparisonRecord[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedAlternativeComparisonDatabaseRow>(
      "SELECT id, name, category, current_part_name, current_part_summary, current_part_price, catalog_snapshot_at, engine_version, candidates, created_at, updated_at, expires_at, owner_token_hash FROM saved_comparisons ORDER BY updated_at DESC"
    );
    return result.rows.map(savedAlternativeComparisonFromDatabaseRow);
  } catch (error) {
    markDatabaseUnavailable("comparison read", error);
    throw error;
  }
}

type SavedAlternativeComparisonDatabaseRow = {
  id: string;
  name: string;
  category: string | null;
  current_part_name: string | null;
  current_part_summary: string | null;
  current_part_price: string | null;
  catalog_snapshot_at: Date | null;
  engine_version: string | null;
  candidates: SavedAlternativeComparisonRecord["candidates"];
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  owner_token_hash: string | null;
};

export function savedAlternativeComparisonFromDatabaseRow(row: SavedAlternativeComparisonDatabaseRow): SavedAlternativeComparisonRecord {
  return {
    id: row.id,
    name: row.name,
    ...(row.category ? { category: row.category } : {}),
    ...(row.current_part_name ? { currentPartName: row.current_part_name } : {}),
    ...(row.current_part_summary ? { currentPartSummary: row.current_part_summary } : {}),
    ...(row.current_part_price ? { currentPartPrice: row.current_part_price } : {}),
    ...(row.catalog_snapshot_at ? { catalogSnapshotAt: new Date(row.catalog_snapshot_at).toISOString() } : {}),
    ...(row.engine_version ? { engineVersion: row.engine_version } : {}),
    candidates: row.candidates,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {})
  };
}

export async function writeSavedComparisons(comparisons: SavedAlternativeComparisonRecord[]) {
  await ensureDatabase();
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
        `INSERT INTO saved_comparisons (id, name, category, current_part_name, current_part_summary, current_part_price, catalog_snapshot_at, engine_version, candidates, created_at, updated_at, expires_at, owner_token_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9::jsonb, $10::timestamptz, $11::timestamptz, $12::timestamptz, $13)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           current_part_name = EXCLUDED.current_part_name,
           current_part_summary = EXCLUDED.current_part_summary,
           current_part_price = EXCLUDED.current_part_price,
           catalog_snapshot_at = EXCLUDED.catalog_snapshot_at,
           engine_version = EXCLUDED.engine_version,
           candidates = EXCLUDED.candidates,
           updated_at = EXCLUDED.updated_at,
           expires_at = EXCLUDED.expires_at,
           owner_token_hash = EXCLUDED.owner_token_hash`,
        [comparison.id, comparison.name, comparison.category ?? null, comparison.currentPartName ?? null, comparison.currentPartSummary ?? null, comparison.currentPartPrice ?? null, comparison.catalogSnapshotAt ?? null, comparison.engineVersion ?? null, JSON.stringify(comparison.candidates), comparison.createdAt, comparison.updatedAt, comparison.expiresAt ?? null, comparison.ownerTokenHash ?? null]
      );
    }
    await client.query("COMMIT");
    return;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("comparison write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendSavedComparison(comparison: SavedAlternativeComparisonRecord, max = 100) {
  const comparisons = await readSavedComparisons();
  await writeSavedComparisons([comparison, ...comparisons].slice(0, max));
}

export async function deleteSavedComparison(id: string) {
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM saved_comparisons WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    markDatabaseUnavailable("comparison delete", error);
    throw error;
  }
}

type SavedBuildVersionComparisonDatabaseRow = {
  id: string;
  name: string;
  payload: SavedBuildVersionComparisonShareRecord["payload"];
  source_before_build_id: string;
  source_after_build_id: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  owner_token_hash: string | null;
};

function savedBuildVersionComparisonRecordFromDatabaseRow(row: SavedBuildVersionComparisonDatabaseRow) {
  return savedBuildVersionComparisonFromUnknown({
    id: row.id,
    name: row.name,
    payload: row.payload,
    sourceBeforeBuildId: row.source_before_build_id,
    sourceAfterBuildId: row.source_after_build_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {})
  });
}

export async function readSavedBuildVersionComparisons(): Promise<SavedBuildVersionComparisonShareRecord[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedBuildVersionComparisonDatabaseRow>(
      "SELECT id, name, payload, source_before_build_id, source_after_build_id, created_at, updated_at, expires_at, owner_token_hash FROM saved_version_comparisons ORDER BY updated_at DESC"
    );
    return result.rows.map(savedBuildVersionComparisonRecordFromDatabaseRow).filter((value): value is SavedBuildVersionComparisonShareRecord => value !== undefined);
  } catch (error) {
    markDatabaseUnavailable("saved version comparison read", error);
    throw error;
  }
}

export async function writeSavedBuildVersionComparisons(comparisons: SavedBuildVersionComparisonShareRecord[]) {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    if (comparisons.length === 0) {
      await client.query("DELETE FROM saved_version_comparisons");
    } else {
      await client.query("DELETE FROM saved_version_comparisons WHERE NOT (id = ANY($1::text[]))", [comparisons.map((comparison) => comparison.id)]);
    }
    for (const comparison of comparisons) {
      await client.query(
        `INSERT INTO saved_version_comparisons (id, name, payload, source_before_build_id, source_after_build_id, created_at, updated_at, expires_at, owner_token_hash)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           payload = EXCLUDED.payload,
           source_before_build_id = EXCLUDED.source_before_build_id,
           source_after_build_id = EXCLUDED.source_after_build_id,
           updated_at = EXCLUDED.updated_at,
           expires_at = EXCLUDED.expires_at,
           owner_token_hash = EXCLUDED.owner_token_hash`,
        [comparison.id, comparison.name, JSON.stringify(comparison.payload), comparison.sourceBeforeBuildId, comparison.sourceAfterBuildId, comparison.createdAt, comparison.updatedAt, comparison.expiresAt ?? null, comparison.ownerTokenHash ?? null]
      );
    }
    await client.query("COMMIT");
    return;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("saved version comparison write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendSavedBuildVersionComparison(comparison: SavedBuildVersionComparisonShareRecord, max = 100) {
  const comparisons = await readSavedBuildVersionComparisons();
  await writeSavedBuildVersionComparisons([comparison, ...comparisons].slice(0, Math.max(1, Math.floor(max))));
}

export async function deleteSavedBuildVersionComparison(id: string) {
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM saved_version_comparisons WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    markDatabaseUnavailable("saved version comparison delete", error);
    throw error;
  }
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
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedBudgetLadderDatabaseRow>(
      "SELECT id, name, payload, request, parent_id, lineage_id, version_number, catalog_snapshot_at, created_at, updated_at, expires_at, owner_token_hash FROM saved_budget_ladders ORDER BY updated_at DESC"
    );
    return result.rows.map(savedBudgetLadderRecordFromDatabaseRow).filter((value): value is SavedBudgetLadderRecord => value !== undefined);
  } catch (error) {
    markDatabaseUnavailable("budget ladder read", error);
    throw error;
  }
}

export async function writeSavedBudgetLadders(ladders: SavedBudgetLadderRecord[]) {
  await ensureDatabase();
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
    markDatabaseUnavailable("budget ladder write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendSavedBudgetLadder(ladder: SavedBudgetLadderRecord, max = 100) {
  const ladders = await readSavedBudgetLadders();
  await writeSavedBudgetLadders([ladder, ...ladders].slice(0, Math.max(1, Math.floor(max))));
}

export async function deleteSavedBudgetLadder(id: string) {
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM saved_budget_ladders WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    markDatabaseUnavailable("budget ladder delete", error);
    throw error;
  }
}

function savedGeneratorVariantsRecordFromDatabaseRow(row: SavedGeneratorVariantsDatabaseRow) {
  return savedGeneratorVariantsFromUnknown({
    id: row.id,
    name: row.name,
    payload: row.payload,
    ...(row.request ? { request: row.request } : {}),
    catalogSnapshotAt: new Date(row.catalog_snapshot_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {})
  });
}

export async function readSavedGeneratorVariants(): Promise<SavedGeneratorVariantsRecord[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedGeneratorVariantsDatabaseRow>(
      "SELECT id, name, payload, request, catalog_snapshot_at, created_at, updated_at, expires_at, owner_token_hash FROM saved_generator_variants ORDER BY updated_at DESC"
    );
    return result.rows.map(savedGeneratorVariantsRecordFromDatabaseRow).filter((value): value is SavedGeneratorVariantsRecord => value !== undefined);
  } catch (error) {
    markDatabaseUnavailable("generator variants read", error);
    throw error;
  }
}

export async function writeSavedGeneratorVariants(records: SavedGeneratorVariantsRecord[]) {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    if (records.length === 0) {
      await client.query("DELETE FROM saved_generator_variants");
    } else {
      await client.query("DELETE FROM saved_generator_variants WHERE NOT (id = ANY($1::text[]))", [records.map((record) => record.id)]);
    }
    for (const record of records) {
      await client.query(
        `INSERT INTO saved_generator_variants (id, name, payload, request, catalog_snapshot_at, created_at, updated_at, expires_at, owner_token_hash)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::timestamptz, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           payload = EXCLUDED.payload,
           request = EXCLUDED.request,
           catalog_snapshot_at = EXCLUDED.catalog_snapshot_at,
           updated_at = EXCLUDED.updated_at,
           expires_at = EXCLUDED.expires_at,
           owner_token_hash = EXCLUDED.owner_token_hash`,
        [record.id, record.name, JSON.stringify(record.payload), record.request ? JSON.stringify(record.request) : null, record.catalogSnapshotAt, record.createdAt, record.updatedAt, record.expiresAt ?? null, record.ownerTokenHash ?? null]
      );
    }
    await client.query("COMMIT");
    return;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("generator variants write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendSavedGeneratorVariants(record: SavedGeneratorVariantsRecord, max = 100) {
  const records = await readSavedGeneratorVariants();
  await writeSavedGeneratorVariants([record, ...records].slice(0, Math.max(1, Math.floor(max))));
}

export async function deleteSavedGeneratorVariants(id: string) {
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM saved_generator_variants WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    markDatabaseUnavailable("generator variants delete", error);
    throw error;
  }
}

export async function readSavedWatchlistAlertStates(): Promise<SavedWatchlistAlertState[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ watchlist_id: string; alert_id: string; read_at: Date | null; dismissed_at: Date | null; updated_at: Date }>(
      "SELECT watchlist_id, alert_id, read_at, dismissed_at, updated_at FROM saved_watchlist_alert_states ORDER BY updated_at DESC"
    );
    return result.rows.map((row) => ({ watchlistId: row.watchlist_id, alertId: row.alert_id, ...(row.read_at ? { readAt: new Date(row.read_at).toISOString() } : {}), ...(row.dismissed_at ? { dismissedAt: new Date(row.dismissed_at).toISOString() } : {}), updatedAt: new Date(row.updated_at).toISOString() }));
  } catch (error) {
    markDatabaseUnavailable("watchlist alert state read", error);
    throw error;
  }
}

export async function writeSavedWatchlistAlertStates(states: SavedWatchlistAlertState[]) {
  await ensureDatabase();
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
    markDatabaseUnavailable("watchlist alert state write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateSavedWatchlistAlertStates(watchlistId: string, alertIds: string[], patch: "read" | "dismiss", updatedAt: string) {
  const states = await readSavedWatchlistAlertStates();
  const next = upsertSavedWatchlistAlertStates(states, watchlistId, alertIds, patch, updatedAt);
  await writeSavedWatchlistAlertStates(next);
  return next.filter((state) => state.watchlistId === watchlistId);
}

export async function deleteSavedWatchlistAlertStates(watchlistId: string) {
  await ensureDatabase();
  try {
    await pool!.query("DELETE FROM saved_watchlist_alert_states WHERE watchlist_id = $1", [watchlistId]);
    return;
  } catch (error) {
    markDatabaseUnavailable("watchlist alert state delete", error);
    throw error;
  }
}

export async function closePersistence() {
  const closing = pool;
  pool = null;
  if (configuredDatabaseUrl && closing) sharedPools.delete(configuredDatabaseUrl);
  if (closing) await closing.end();
}
