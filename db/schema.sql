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
  recovery_code_hash TEXT,
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
  resource_type TEXT NOT NULL CHECK (resource_type IN ('build', 'watchlist', 'comparison', 'version-comparison', 'budget-ladder', 'generator-variants')),
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
