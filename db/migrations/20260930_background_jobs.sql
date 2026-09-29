BEGIN;

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

COMMIT;
