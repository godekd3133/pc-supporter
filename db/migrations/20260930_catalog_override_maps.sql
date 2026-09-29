BEGIN;

-- Cutover gate: this migration creates shared storage but does not import the
-- per-instance catalog-spec-overrides.json or m2-slot-overrides.json files.
-- Before enabling DATABASE_URL for an existing JSON-backed installation,
-- explicitly import and verify each full JSON map in its matching singleton
-- row. Keep the source files unchanged as recovery copies through cutover.
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

COMMIT;
