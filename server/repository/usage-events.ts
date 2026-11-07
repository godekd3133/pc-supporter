import { type UsageEventName } from "../usage-events";
import { ensureDatabase, pool, markDatabaseUnavailable, rateLimitHmacSecret } from "./database";
import { type PoolClient } from "pg";
import { createHmac } from "node:crypto";

export async function incrementUsageEventInDatabase(dayUtc: string, name: UsageEventName, maxDailyBuckets: number) {
  await ensureDatabase();

  let client: PoolClient;
  try {
    client = await pool!.connect();
  } catch (error: unknown) {
    markDatabaseUnavailable("usage-event connection", error);
    throw error;
  }
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pc-supporter:usage_event_daily_counts'))");
    await client.query(
      `INSERT INTO usage_event_daily_counts (day_utc, counts)
       VALUES ($1::date, jsonb_build_object($2::text, 1))
       ON CONFLICT (day_utc) DO UPDATE SET counts = jsonb_set(
         usage_event_daily_counts.counts,
         ARRAY[$2::text],
         to_jsonb(COALESCE((usage_event_daily_counts.counts ->> $2::text)::integer, 0) + 1),
         true
       )`,
      [dayUtc, name]
    );
    await client.query(
      `DELETE FROM usage_event_daily_counts
       WHERE day_utc NOT IN (
         SELECT day_utc FROM usage_event_daily_counts ORDER BY day_utc DESC LIMIT $1
       )`,
      [maxDailyBuckets]
    );
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("usage-event write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function readUsageEventDailyCountsFromDatabase(): Promise<Record<string, Partial<Record<UsageEventName, number>>>> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ day_utc: string; counts: Partial<Record<UsageEventName, number>> }>(
      "SELECT day_utc::text AS day_utc, counts FROM usage_event_daily_counts ORDER BY day_utc"
    );
    return Object.fromEntries(result.rows.map((row) => [row.day_utc, row.counts]));
  } catch (error: unknown) {
    markDatabaseUnavailable("usage-event read", error);
    throw error;
  }
}

// 클라이언트가 보낸 익명 ID는 DB에 원문으로 남기지 않는다 — rate-limit과 같은
// HMAC 비밀키로 해시해 "같은 방문자"만 구분할 수 있게 한다.
function usageEventIdentityKey(kind: "visitor" | "session", raw: string | undefined) {
  if (!raw) return null;
  const secret = rateLimitHmacSecret() ?? "pc-supporter-usage-event-identity";
  return createHmac("sha256", secret).update(`usage-event\0${kind}\0${raw}`).digest("hex");
}

export type UsageEventInsertRow = {
  event: string;
  occurredAt: Date;
  visitorId?: string;
  sessionId?: string;
  path?: string;
  props?: Record<string, unknown>;
};

export type UsageEventAnalyticsRow = {
  event: string;
  visitor_key: string | null;
  session_key: string | null;
  path: string | null;
  props: Record<string, unknown> | null;
  occurred_at: Date;
};

const USAGE_EVENT_RETENTION_MS = 95 * 24 * 60 * 60 * 1_000;
const USAGE_EVENT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const USAGE_EVENT_ANALYTICS_ROW_LIMIT = 250_000;
let lastUsageEventPruneAt = 0;

export async function insertUsageEventsInDatabase(rows: UsageEventInsertRow[]) {
  if (rows.length === 0) return;
  await ensureDatabase();
  try {
    await pool!.query(
      `INSERT INTO usage_events (occurred_at, event, visitor_key, session_key, path, props)
       SELECT occurred_at, event, visitor_key, session_key, path, props
       FROM unnest(
         $1::timestamptz[], $2::text[], $3::text[], $4::text[], $5::text[], $6::jsonb[]
       ) AS inserted(occurred_at, event, visitor_key, session_key, path, props)`,
      [
        rows.map((row) => row.occurredAt.toISOString()),
        rows.map((row) => row.event),
        rows.map((row) => usageEventIdentityKey("visitor", row.visitorId)),
        rows.map((row) => usageEventIdentityKey("session", row.sessionId)),
        rows.map((row) => row.path ?? null),
        rows.map((row) => JSON.stringify(row.props ?? {}))
      ]
    );
    // 이벤트 로그는 95일만 보존한다 — 인스턴스당 하루 한 번만 정리한다.
    if (Date.now() - lastUsageEventPruneAt >= USAGE_EVENT_PRUNE_INTERVAL_MS) {
      lastUsageEventPruneAt = Date.now();
      await pool!.query("DELETE FROM usage_events WHERE occurred_at < $1::timestamptz", [new Date(Date.now() - USAGE_EVENT_RETENTION_MS).toISOString()]);
    }
  } catch (error: unknown) {
    markDatabaseUnavailable("usage-event raw insert", error);
    throw error;
  }
}

export async function readUsageEventRowsForAnalytics(since: Date): Promise<UsageEventAnalyticsRow[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<UsageEventAnalyticsRow>(
      `SELECT event, visitor_key, session_key, path, props, occurred_at
       FROM usage_events
       WHERE occurred_at >= $1::timestamptz
       ORDER BY occurred_at ASC
       LIMIT $2`,
      [since.toISOString(), USAGE_EVENT_ANALYTICS_ROW_LIMIT]
    );
    return result.rows;
  } catch (error: unknown) {
    markDatabaseUnavailable("usage-event analytics read", error);
    throw error;
  }
}
