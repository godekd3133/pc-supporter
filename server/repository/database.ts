import "dotenv/config";
import { OWNER_SESSION_RESOURCE_TYPES, type OwnerSessionResourceType as OwnerShareResourceType } from "../../shared/owner-session-contract";
import { Pool, type PoolClient } from "pg";
import { registerPostgresPoolErrorHandlers } from "../postgres-pool-errors";
import { initializePostgresSchemaWithClient, postgresSchemaInitializationModeForNodeEnv } from "../postgres-schema-contract";
import { type PersistenceDiagnostics } from "../../shared/types";
import { type SavedCatalogWatchlistRecord } from "../watchlist-share";
import { savedCatalogWatchlistFromUnknown } from "../watchlist-store";

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
CREATE TABLE IF NOT EXISTS usage_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  event TEXT NOT NULL,
  visitor_key TEXT,
  session_key TEXT,
  path TEXT,
  props JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(props) = 'object')
);
CREATE INDEX IF NOT EXISTS usage_events_occurred_idx ON usage_events(occurred_at);
CREATE INDEX IF NOT EXISTS usage_events_event_idx ON usage_events(event, occurred_at);
CREATE INDEX IF NOT EXISTS usage_events_visitor_idx ON usage_events(visitor_key, occurred_at);
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
CREATE TABLE IF NOT EXISTS runtime_configs (
  config_key TEXT PRIMARY KEY CHECK (length(config_key) BETWEEN 1 AND 120),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) IN ('object', 'array')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS pc_supporter_schema_revision (
  singleton_id TEXT PRIMARY KEY CHECK (singleton_id = 'current'),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  schema_sha256 TEXT NOT NULL CHECK (schema_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);
`;

const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
const configuredRateLimitHmacSecret = process.env.RATE_LIMIT_HMAC_SECRET?.trim();
const DEVELOPMENT_RATE_LIMIT_HMAC_SECRET = "pc-supporter-local-rate-limit-secret";
const DATABASE_RETRY_COOLDOWN_MS = 1_000;
export const RATE_LIMIT_BUCKET_CLEANUP_INTERVAL_MS = 10 * 60 * 1_000;
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
export let pool: Pool | null = null;
let poolCreationError: unknown;
if (configuredDatabaseUrl) {
  try {
    pool = sharedPools.get(configuredDatabaseUrl) ?? null;
    if (!pool) {
      // 트래픽 규모에 맞게 풀을 조정한다 — 동시 요청이 풀 한계를 넘으면
      // 큐잉되므로 idle 커넥션은 빠르게 반납하고 연결 생성에는 제한을 둔다.
      pool = new Pool({
        connectionString: configuredDatabaseUrl,
        max: Math.max(1, Number(process.env.PC_SUPPORTER_DB_POOL_MAX ?? 10)),
        idleTimeoutMillis: Math.max(1_000, Number(process.env.PC_SUPPORTER_DB_POOL_IDLE_MS ?? 30_000)),
        connectionTimeoutMillis: Math.max(500, Number(process.env.PC_SUPPORTER_DB_CONNECT_TIMEOUT_MS ?? 2_000)),
        // 길어지는 쿼리가 풀 커넥션을 무한히 잡아두지 못하게 쿼리/유휴 트랜잭션
        // 제한을 둔다 — 백그라운드 작업은 advisory lease로 이미 직렬화된다.
        statement_timeout: Math.max(1_000, Number(process.env.PC_SUPPORTER_DB_STATEMENT_TIMEOUT_MS ?? 15_000)),
        idle_in_transaction_session_timeout: Math.max(1_000, Number(process.env.PC_SUPPORTER_DB_IDLE_TX_TIMEOUT_MS ?? 10_000)),
        keepAlive: true
      });
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

export function rateLimitHmacSecret() {
  if (configuredRateLimitHmacSecret && configuredRateLimitHmacSecret.length >= 32) return configuredRateLimitHmacSecret;
  return process.env.NODE_ENV === "production" ? undefined : DEVELOPMENT_RATE_LIMIT_HMAC_SECRET;
}

export function markDatabaseUnavailable(operation: string, error: unknown) {
  databaseReady = false;
  schemaPromise = null;
  nextDatabaseRetryAt = Date.now() + DATABASE_RETRY_COOLDOWN_MS;
  lastDatabaseError = error;
  console.warn(`PostgreSQL ${operation} failed: ${postgresErrorMessage(error)}`);
}

if (pool) registerPostgresPoolErrorHandlers(pool, (error) => markDatabaseUnavailable("connection", error));

export type SavedBuildMonitorLeaseResult<T> =
  | { backend: "postgres"; acquired: true; value: T }
  | { backend: "postgres"; acquired: false };

export async function ensureDatabase(): Promise<boolean> {
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
 * Run an internal repository operation in PostgreSQL only. Database failures
 * propagate to the caller and never redirect to JSON storage.
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

function savedWatchlistRecordFromUnknown(value: unknown): SavedCatalogWatchlistRecord | undefined {
  const normalized = savedCatalogWatchlistFromUnknown(value);
  if (!normalized || !value || typeof value !== "object" || Array.isArray(value)) return normalized;
  const candidate = value as { ownerTokenHash?: unknown };
  const ownerTokenHash = typeof candidate.ownerTokenHash === "string" && /^[0-9a-f]{64}$/.test(candidate.ownerTokenHash) ? candidate.ownerTokenHash : undefined;
  return { ...normalized, ...(ownerTokenHash ? { ownerTokenHash } : {}) };
}

export async function closePersistence() {
  const closing = pool;
  pool = null;
  if (configuredDatabaseUrl && closing) sharedPools.delete(configuredDatabaseUrl);
  if (closing) await closing.end();
}
