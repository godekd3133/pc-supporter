BEGIN;

CREATE TABLE IF NOT EXISTS price_refresh_attempts (
  item_kind TEXT NOT NULL CHECK (item_kind IN ('part', 'accessory')),
  item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 512),
  attempted_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (item_kind, item_id)
);

CREATE INDEX IF NOT EXISTS price_refresh_attempts_attempted_idx
  ON price_refresh_attempts(attempted_at, item_kind, item_id);

COMMIT;
