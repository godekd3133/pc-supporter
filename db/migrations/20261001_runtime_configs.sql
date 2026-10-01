-- v1 -> v2: 파일 기반 운영 설정을 인스턴스 간 공유하기 위한 runtime_configs.
BEGIN;

CREATE TABLE IF NOT EXISTS runtime_configs (
  config_key TEXT PRIMARY KEY CHECK (length(config_key) BETWEEN 1 AND 120),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) IN ('object', 'array')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_by TEXT
);

UPDATE pc_supporter_schema_revision
SET schema_version = 2,
    schema_sha256 = '43dc9c8be8220a862e226dd32e8e590a5930787f6cd5158ea9bbbc07f0f6f5b0',
    applied_at = statement_timestamp()
WHERE singleton_id = 'current';

COMMIT;
