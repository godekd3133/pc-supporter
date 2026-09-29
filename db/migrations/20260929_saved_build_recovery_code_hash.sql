BEGIN;

-- Store only a digest for the single-use saved-build recovery code.
ALTER TABLE saved_builds ADD COLUMN IF NOT EXISTS recovery_code_hash TEXT;

COMMIT;
