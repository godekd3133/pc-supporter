import { type OwnerSessionResourceType as OwnerShareResourceType, isOwnerSessionResourceType } from "../../shared/owner-session-contract";
import { ensureDatabase, pool, markDatabaseUnavailable, withPostgresTransaction } from "./database";

export interface OwnerShareSession {
  sessionHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface OwnerShareSessionGrant {
  sessionHash: string;
  resourceType: OwnerShareResourceType;
  resourceId: string;
  ownerTokenHash: string;
  createdAt: string;
  expiresAt?: string;
}

export interface OwnerShareSessionGrantReference {
  resourceType: OwnerShareResourceType;
  resourceId: string;
  ownerTokenHash: string;
}

export const OWNER_SHARE_SESSION_GRANT_MAX_PRUNE_BATCH = 500;
export const OWNER_SHARE_SESSION_MAX_PRUNE_BATCH = 500;
const OWNER_SHARE_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OWNER_SHARE_ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function ownerShareRecordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function ownerShareHash(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !OWNER_SHARE_SHA256_PATTERN.test(value)) {
    throw new Error(`Owner session ${fieldName} must be a lowercase SHA-256 hex digest.`);
  }
  return value;
}

function ownerShareResourceType(value: unknown): OwnerShareResourceType {
  if (!isOwnerSessionResourceType(value)) {
    throw new Error("Owner session resource type is invalid.");
  }
  return value;
}

function ownerShareResourceId(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > 512 || value.includes("\u0000")) {
    throw new Error("Owner session resource ID must be a non-empty string of at most 512 characters.");
  }
  return value;
}

function ownerShareIsoTimestamp(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !OWNER_SHARE_ISO_TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Owner session ${fieldName} must be an ISO timestamp.`);
  }
  return value;
}

function ownerShareNow(value?: Date | string): { iso: string; time: number } {
  const iso = value instanceof Date ? value.toISOString() : value === undefined ? new Date().toISOString() : ownerShareIsoTimestamp(value, "current time");
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) throw new Error("Owner session current time is invalid.");
  return { iso, time };
}

function ownerShareSessionGrantFromUnknown(value: unknown): OwnerShareSessionGrant {
  const record = ownerShareRecordFromUnknown(value);
  if (!record) throw new Error("Owner session grant must be an object.");
  const grant: OwnerShareSessionGrant = {
    sessionHash: ownerShareHash(record.sessionHash, "session hash"),
    resourceType: ownerShareResourceType(record.resourceType),
    resourceId: ownerShareResourceId(record.resourceId),
    ownerTokenHash: ownerShareHash(record.ownerTokenHash, "owner token hash"),
    createdAt: ownerShareIsoTimestamp(record.createdAt, "creation time")
  };
  if (record.expiresAt !== undefined) grant.expiresAt = ownerShareIsoTimestamp(record.expiresAt, "expiry time");
  return grant;
}

function ownerShareSessionFromUnknown(value: unknown): OwnerShareSession {
  const record = ownerShareRecordFromUnknown(value);
  if (!record) throw new Error("Owner session record must be an object.");
  const session: OwnerShareSession = {
    sessionHash: ownerShareHash(record.sessionHash, "session hash"),
    createdAt: ownerShareIsoTimestamp(record.createdAt, "creation time"),
    expiresAt: ownerShareIsoTimestamp(record.expiresAt, "expiry time")
  };
  if (Date.parse(session.expiresAt) <= Date.parse(session.createdAt)) {
    throw new Error("Owner session expiry must be later than its creation time.");
  }
  return session;
}

function ownerShareGrantReferenceFromUnknown(value: unknown): OwnerShareSessionGrantReference {
  const record = ownerShareRecordFromUnknown(value);
  if (!record) throw new Error("Owner session grant query returned an invalid row.");
  return {
    resourceType: ownerShareResourceType(record.resource_type ?? record.resourceType),
    resourceId: ownerShareResourceId(record.resource_id ?? record.resourceId),
    ownerTokenHash: ownerShareHash(record.owner_token_hash ?? record.ownerTokenHash, "owner token hash")
  };
}

export async function createOwnerShareSession(input: OwnerShareSession): Promise<void> {
  const session = ownerShareSessionFromUnknown(input);
  await ensureDatabase();
  let created = false;
  try {
    const result = await pool!.query(
      `INSERT INTO owner_sessions (session_hash, created_at, expires_at)
       SELECT $1, $2::timestamptz, $3::timestamptz
       WHERE NOT EXISTS (SELECT 1 FROM owner_session_grants WHERE session_hash = $1)
       ON CONFLICT (session_hash) DO NOTHING
       RETURNING session_hash`,
      [session.sessionHash, session.createdAt, session.expiresAt]
    );
    created = result.rows.length > 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session create", error);
    throw error;
  }
  if (!created) throw new Error("Owner session hash already exists or conflicts with a pending grant.");
}

export async function ownerShareSessionIsActive(sessionHashValue: string, nowValue?: Date | string): Promise<boolean> {
  const sessionHash = ownerShareHash(sessionHashValue, "session hash");
  const now = ownerShareNow(nowValue);
  await ensureDatabase();
  try {
    const result = await pool!.query(
      "SELECT 1 AS active FROM owner_sessions WHERE session_hash = $1 AND expires_at > $2::timestamptz LIMIT 1",
      [sessionHash, now.iso]
    );
    return result.rows.length > 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session active check", error);
    throw error;
  }
}

export async function deleteOwnerShareSession(sessionHashValue: string): Promise<boolean> {
  const sessionHash = ownerShareHash(sessionHashValue, "session hash");
  await ensureDatabase();
  return withPostgresTransaction("owner session revoke", async (client) => {
    const sessionResult = await client.query("DELETE FROM owner_sessions WHERE session_hash = $1 RETURNING session_hash", [sessionHash]);
    // The FK cascade handles normal rows. This second delete also clears pre-lifecycle orphaned grants.
    const grantResult = await client.query("DELETE FROM owner_session_grants WHERE session_hash = $1 RETURNING session_hash", [sessionHash]);
    return (sessionResult.rowCount ?? sessionResult.rows.length) > 0 || (grantResult.rowCount ?? grantResult.rows.length) > 0;
  });
}

function ownerShareSessionPruneLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Owner session prune limit must be a non-negative integer.");
  return Math.min(limit, OWNER_SHARE_SESSION_MAX_PRUNE_BATCH);
}

export async function pruneExpiredOwnerShareSessions(limit = OWNER_SHARE_SESSION_MAX_PRUNE_BATCH, nowValue?: Date | string): Promise<number> {
  const boundedLimit = ownerShareSessionPruneLimit(limit);
  if (boundedLimit === 0) return 0;
  const now = ownerShareNow(nowValue);
  await ensureDatabase();
  try {
    const result = await pool!.query(
      `WITH expired_sessions AS (
         SELECT session_hash
         FROM owner_sessions
         WHERE expires_at <= $2::timestamptz
         ORDER BY expires_at, session_hash
         LIMIT $1
       )
       DELETE FROM owner_sessions
       WHERE session_hash IN (SELECT session_hash FROM expired_sessions)
       RETURNING session_hash`,
      [boundedLimit, now.iso]
    );
    return result.rowCount ?? result.rows.length;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session prune", error);
    throw error;
  }
}

export async function upsertOwnerShareSessionGrant(input: OwnerShareSessionGrant, nowValue?: Date | string): Promise<boolean> {
  const grant = ownerShareSessionGrantFromUnknown(input);
  const now = ownerShareNow(nowValue);
  await ensureDatabase();
  try {
    const result = await pool!.query(
      `INSERT INTO owner_session_grants (session_hash, resource_type, resource_id, owner_token_hash, created_at, expires_at)
       SELECT $1, $2, $3, $4, $5::timestamptz, $6::timestamptz
       WHERE EXISTS (SELECT 1 FROM owner_sessions WHERE session_hash = $1 AND expires_at > $7::timestamptz)
       ON CONFLICT (session_hash, resource_type, resource_id, owner_token_hash)
       DO UPDATE SET expires_at = COALESCE(EXCLUDED.expires_at, owner_session_grants.expires_at)
       RETURNING session_hash`,
      [grant.sessionHash, grant.resourceType, grant.resourceId, grant.ownerTokenHash, grant.createdAt, grant.expiresAt ?? null, now.iso]
    );
    return result.rows.length > 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session grant upsert", error);
    throw error;
  }
}

export async function ownerShareSessionGrantMatches(input: {
  sessionHash: string;
  resourceType: OwnerShareResourceType;
  resourceId: string;
  ownerTokenHash: string;
  now?: Date | string;
}): Promise<boolean> {
  const sessionHash = ownerShareHash(input.sessionHash, "session hash");
  const resourceType = ownerShareResourceType(input.resourceType);
  const resourceId = ownerShareResourceId(input.resourceId);
  const ownerTokenHash = ownerShareHash(input.ownerTokenHash, "owner token hash");
  const now = ownerShareNow(input.now);
  await ensureDatabase();
  try {
    const result = await pool!.query(
      `SELECT 1 AS present
       FROM owner_session_grants AS grants
       JOIN owner_sessions AS sessions ON sessions.session_hash = grants.session_hash
       WHERE grants.session_hash = $1
         AND grants.resource_type = $2
         AND grants.resource_id = $3
         AND grants.owner_token_hash = $4
         AND sessions.expires_at > $5::timestamptz
         AND (grants.expires_at IS NULL OR grants.expires_at > $5::timestamptz)
       LIMIT 1`,
      [sessionHash, resourceType, resourceId, ownerTokenHash, now.iso]
    );
    return result.rows.length > 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session grant match", error);
    throw error;
  }
}

export async function listOwnerShareSessionGrants(sessionHashValue: string, nowValue?: Date | string): Promise<OwnerShareSessionGrantReference[]> {
  const sessionHash = ownerShareHash(sessionHashValue, "session hash");
  const now = ownerShareNow(nowValue);
  await ensureDatabase();
  try {
    const result = await pool!.query(
      `SELECT grants.resource_type, grants.resource_id, grants.owner_token_hash
       FROM owner_session_grants AS grants
       JOIN owner_sessions AS sessions ON sessions.session_hash = grants.session_hash
       WHERE grants.session_hash = $1
         AND sessions.expires_at > $2::timestamptz
         AND (grants.expires_at IS NULL OR grants.expires_at > $2::timestamptz)
       ORDER BY grants.resource_type, grants.resource_id, grants.owner_token_hash`,
      [sessionHash, now.iso]
    );
    return result.rows.map(ownerShareGrantReferenceFromUnknown);
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session grant list", error);
    throw error;
  }
}

export async function deleteOwnerShareSessionGrantsForResource(resourceTypeValue: OwnerShareResourceType, resourceIdValue: string): Promise<number> {
  const resourceType = ownerShareResourceType(resourceTypeValue);
  const resourceId = ownerShareResourceId(resourceIdValue);
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM owner_session_grants WHERE resource_type = $1 AND resource_id = $2", [resourceType, resourceId]);
    return result.rowCount ?? 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session grant resource delete", error);
    throw error;
  }
}

export async function deleteOwnerShareSessionGrantsForSession(sessionHashValue: string): Promise<number> {
  const sessionHash = ownerShareHash(sessionHashValue, "session hash");
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM owner_session_grants WHERE session_hash = $1", [sessionHash]);
    return result.rowCount ?? 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session grant session delete", error);
    throw error;
  }
}

function ownerShareGrantPruneLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Owner session grant prune limit must be a non-negative integer.");
  return Math.min(limit, OWNER_SHARE_SESSION_GRANT_MAX_PRUNE_BATCH);
}

export async function pruneExpiredOwnerShareSessionGrants(limit = OWNER_SHARE_SESSION_GRANT_MAX_PRUNE_BATCH, nowValue?: Date | string): Promise<number> {
  const boundedLimit = ownerShareGrantPruneLimit(limit);
  if (boundedLimit === 0) return 0;
  const now = ownerShareNow(nowValue);
  await ensureDatabase();
  try {
    const result = await pool!.query(
      `WITH expired AS (
         SELECT ctid
         FROM owner_session_grants
         WHERE expires_at IS NOT NULL AND expires_at <= $2::timestamptz
         ORDER BY expires_at, session_hash, resource_type, resource_id, owner_token_hash
         LIMIT $1
       )
       DELETE FROM owner_session_grants
       WHERE ctid IN (SELECT ctid FROM expired)
       RETURNING session_hash`,
      [boundedLimit, now.iso]
    );
    return result.rowCount ?? result.rows.length;
  } catch (error: unknown) {
    markDatabaseUnavailable("owner session grant prune", error);
    throw error;
  }
}
