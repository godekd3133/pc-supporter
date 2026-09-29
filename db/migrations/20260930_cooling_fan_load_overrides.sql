BEGIN;

CREATE TABLE IF NOT EXISTS cooling_fan_load_overrides (
  singleton_id TEXT PRIMARY KEY CHECK (singleton_id = 'current'),
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);

COMMIT;
