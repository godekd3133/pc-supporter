BEGIN;

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

COMMIT;
