-- v2 -> v3: 클라이언트 퍼널·리텐션 분석용 원시 사용 이벤트 로그.
-- visitor/session은 HMAC 해시된 익명 키이며 props는 정제된 스칼라만 담는다.
BEGIN;

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

UPDATE pc_supporter_schema_revision
SET schema_version = 3,
    schema_sha256 = '2eac909c9efc45e6cf78cab3171ea86e93b199063cad2e9cf69d4cb7e46e0fd6',
    applied_at = statement_timestamp()
WHERE singleton_id = 'current';

COMMIT;
