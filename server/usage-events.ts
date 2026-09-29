import { USAGE_EVENTS_PATH, readJson, withSerializedFileMutation, writeJson } from "./storage";
import { incrementUsageEventInDatabase, persistenceMode, readUsageEventDailyCountsFromDatabase } from "./repository";

// Phase 0 최소 사용량 카운터: 익명·집계 전용 (개인 식별자/페이로드 없음).
// 저장 위치는 서비스의 선택된 persistence mode를 따른다.

export const USAGE_EVENT_NAMES = ["app_open", "check", "recommend", "save", "share"] as const;
export type UsageEventName = (typeof USAGE_EVENT_NAMES)[number];

const USAGE_EVENT_RETENTION_DAYS = 90;
const MAX_DAILY_BUCKETS = USAGE_EVENT_RETENTION_DAYS + 7;

interface UsageEventStore {
  schemaVersion: 1;
  daily: Record<string, Partial<Record<UsageEventName, number>>>;
}

function dayKeyFor(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function recordUsageEvent(name: UsageEventName, at: Date = new Date()) {
  const day = dayKeyFor(at);
  if (await persistenceMode() === "postgres") {
    await incrementUsageEventInDatabase(day, name, MAX_DAILY_BUCKETS);
    return;
  }

  await withSerializedFileMutation(USAGE_EVENTS_PATH, async () => {
    const store = await readJson<UsageEventStore>(USAGE_EVENTS_PATH, { schemaVersion: 1, daily: {} });
    const daily = store.daily && typeof store.daily === "object" ? store.daily : {};
    const bucket = { ...(daily[day] ?? {}) };
    bucket[name] = (bucket[name] ?? 0) + 1;
    daily[day] = bucket;
    const keys = Object.keys(daily).sort();
    while (keys.length > MAX_DAILY_BUCKETS) {
      const oldest = keys.shift();
      if (oldest) delete daily[oldest];
    }
    await writeJson(USAGE_EVENTS_PATH, { schemaVersion: 1, daily });
  });
}

// Route handler 전용 fire-and-forget — 응답을 지연시키거나 실패를 전파하지 않는다.
export function trackUsageEvent(name: UsageEventName) {
  void recordUsageEvent(name).catch(() => undefined);
}

export async function usageEventSummaryFor() {
  const storageMode = await persistenceMode();
  let dailyCounts: UsageEventStore["daily"];
  if (storageMode === "postgres") {
    dailyCounts = await readUsageEventDailyCountsFromDatabase();
  } else {
    const store = await readJson<UsageEventStore>(USAGE_EVENTS_PATH, { schemaVersion: 1, daily: {} });
    dailyCounts = store.daily && typeof store.daily === "object" ? store.daily : {};
  }
  const totals: Partial<Record<UsageEventName, number>> = {};
  for (const bucket of Object.values(dailyCounts)) {
    for (const name of USAGE_EVENT_NAMES) {
      const value = bucket[name];
      if (typeof value === "number" && Number.isFinite(value)) totals[name] = (totals[name] ?? 0) + value;
    }
  }
  return { retentionDays: USAGE_EVENT_RETENTION_DAYS, days: Object.keys(dailyCounts).length, totals, daily: dailyCounts };
}
