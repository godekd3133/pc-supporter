import { type RateLimitPolicy, type RateLimitDecision, RateLimitStoreUnavailableError } from "../rate-limit";
import { ensureDatabase, rateLimitHmacSecret, pool, markDatabaseUnavailable, withBackgroundJobLease } from "./database";
import { createHmac } from "node:crypto";

const RATE_LIMIT_BUCKET_RETENTION_MS = 24 * 60 * 60 * 1_000;
const RATE_LIMIT_BUCKET_CLEANUP_BATCH_SIZE = 1_000;

export async function consumeRateLimitWindow(scope: string, address: string, policy: RateLimitPolicy, _now = Date.now()): Promise<RateLimitDecision | undefined> {
  try {
    await ensureDatabase();
  } catch {
    throw new RateLimitStoreUnavailableError("PERSISTENCE_UNAVAILABLE");
  }
  const secret = rateLimitHmacSecret();
  if (!secret) throw new RateLimitStoreUnavailableError("RATE_LIMIT_KEY_UNCONFIGURED");
  const limit = Math.max(1, Math.floor(policy.limit));
  const windowMs = Math.max(1_000, Math.floor(policy.windowMs));
  const clientKeyHash = createHmac("sha256", secret).update(`${scope}\0${address}`).digest("hex");
  try {
    const result = await pool!.query<{ window_started_at: Date | string; request_count: number; last_seen_at: Date | string }>(
      `INSERT INTO api_rate_limit_buckets (scope, client_key_hash, window_started_at, request_count, last_seen_at)
       VALUES ($1, $2, statement_timestamp(), 1, statement_timestamp())
       ON CONFLICT (scope, client_key_hash) DO UPDATE SET
         window_started_at = CASE
           WHEN api_rate_limit_buckets.window_started_at + ($3::double precision * INTERVAL '1 millisecond') <= EXCLUDED.last_seen_at
           THEN EXCLUDED.last_seen_at
           ELSE api_rate_limit_buckets.window_started_at
         END,
         request_count = CASE
           WHEN api_rate_limit_buckets.window_started_at + ($3::double precision * INTERVAL '1 millisecond') <= EXCLUDED.last_seen_at
           THEN 1
           ELSE api_rate_limit_buckets.request_count + 1
         END,
         last_seen_at = EXCLUDED.last_seen_at
       RETURNING window_started_at, request_count, last_seen_at`,
      [scope, clientKeyHash, windowMs]
    );
    const row = result.rows[0];
    const startedAt = row ? new Date(row.window_started_at).getTime() : Number.NaN;
    const observedAt = row ? new Date(row.last_seen_at).getTime() : Number.NaN;
    const count = Number(row?.request_count);
    if (!Number.isFinite(startedAt) || !Number.isFinite(observedAt) || !Number.isSafeInteger(count) || count < 1) {
      throw new Error("PostgreSQL returned an invalid shared rate-limit counter.");
    }
    const resetAt = startedAt + windowMs;
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - observedAt) / 1_000))
    };
  } catch (error: unknown) {
    markDatabaseUnavailable("rate limit update", error);
    throw new RateLimitStoreUnavailableError("PERSISTENCE_UNAVAILABLE");
  }
}

export async function pruneRateLimitWindows() {
  await ensureDatabase();
  try {
    const lease = await withBackgroundJobLease("rate-limit-window-prune", async () => {
      const result = await pool!.query(
        `WITH expired AS (
           SELECT scope, client_key_hash
           FROM api_rate_limit_buckets
           WHERE last_seen_at < statement_timestamp() - ($1::double precision * INTERVAL '1 millisecond')
           ORDER BY last_seen_at
           LIMIT $2
         )
         DELETE FROM api_rate_limit_buckets AS buckets
         USING expired
         WHERE buckets.scope = expired.scope AND buckets.client_key_hash = expired.client_key_hash`,
        [RATE_LIMIT_BUCKET_RETENTION_MS, RATE_LIMIT_BUCKET_CLEANUP_BATCH_SIZE]
      );
      return result.rowCount ?? 0;
    });
    return lease.acquired ? lease.value : 0;
  } catch (error: unknown) {
    markDatabaseUnavailable("rate limit cleanup", error);
    throw error;
  }
}
