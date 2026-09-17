import { USAGE_EVENTS_PATH, readJson, withSerializedFileMutation, writeJson } from "./storage";

// Phase 0 최소 사용량 카운터: 익명·집계 전용 (개인 식별자/페이로드 없음).
// 파일 기반 단일 카운터 — PostgreSQL 모드에서도 같은 파일을 사용한다.
// 분석 품질보다 측정 가능성이 목적이므로 손실을 감수하고 저장 계약을 단순하게 유지한다.

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
  const store = await readJson<UsageEventStore>(USAGE_EVENTS_PATH, { schemaVersion: 1, daily: {} });
  const daily = store.daily && typeof store.daily === "object" ? store.daily : {};
  const totals: Partial<Record<UsageEventName, number>> = {};
  for (const bucket of Object.values(daily)) {
    for (const name of USAGE_EVENT_NAMES) {
      const value = bucket[name];
      if (typeof value === "number" && Number.isFinite(value)) totals[name] = (totals[name] ?? 0) + value;
    }
  }
  return { retentionDays: USAGE_EVENT_RETENTION_DAYS, days: Object.keys(daily).length, totals, daily };
}
