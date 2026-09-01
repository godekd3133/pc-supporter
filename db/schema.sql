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

CREATE TABLE IF NOT EXISTS saved_watchlist_alert_states (
  watchlist_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (watchlist_id, alert_id)
);

CREATE INDEX IF NOT EXISTS saved_watchlist_alert_states_updated_idx ON saved_watchlist_alert_states(updated_at DESC);
