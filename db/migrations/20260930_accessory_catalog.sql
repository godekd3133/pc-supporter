BEGIN;

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

COMMIT;
