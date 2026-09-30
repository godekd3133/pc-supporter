import { incrementUsageEventInDatabase, readUsageEventDailyCountsFromDatabase } from "./repository";

// Phase 0 최소 사용량 카운터: 익명·집계 전용 (개인 식별자/페이로드 없음).
// PostgreSQL `usage_event_daily_counts` 테이블에 저장한다.

export const USAGE_EVENT_NAMES = ["app_open", "check", "recommend", "recommend_failed", "save", "share"] as const;
export type UsageEventName = (typeof USAGE_EVENT_NAMES)[number];

const USAGE_EVENT_RETENTION_DAYS = 90;
const MAX_DAILY_BUCKETS = USAGE_EVENT_RETENTION_DAYS + 7;

function dayKeyFor(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function recordUsageEvent(name: UsageEventName, at: Date = new Date()) {
  await incrementUsageEventInDatabase(dayKeyFor(at), name, MAX_DAILY_BUCKETS);
}

// Route handler 전용 fire-and-forget — 응답을 지연시키거나 실패를 전파하지 않는다.
export function trackUsageEvent(name: UsageEventName) {
  void recordUsageEvent(name).catch(() => undefined);
}

export async function usageEventSummaryFor() {
  const dailyCounts = await readUsageEventDailyCountsFromDatabase();
  const totals: Partial<Record<UsageEventName, number>> = {};
  for (const bucket of Object.values(dailyCounts)) {
    for (const name of USAGE_EVENT_NAMES) {
      const value = bucket[name];
      if (typeof value === "number" && Number.isFinite(value)) totals[name] = (totals[name] ?? 0) + value;
    }
  }
  return { retentionDays: USAGE_EVENT_RETENTION_DAYS, days: Object.keys(dailyCounts).length, totals, daily: dailyCounts };
}
