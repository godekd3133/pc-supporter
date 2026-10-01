import { incrementUsageEventInDatabase, insertUsageEventsInDatabase, readUsageEventDailyCountsFromDatabase, readUsageEventRowsForAnalytics } from "./repository";
import type { UsageEventInsertRow } from "./repository";

// Phase 0 최소 사용량 카운터: 익명·집계 전용 (개인 식별자/페이로드 없음).
// PostgreSQL `usage_event_daily_counts` 테이블에 저장한다.
// Phase 1 퍼널 분석: 클라이언트 이벤트는 `usage_events` 원시 로그에 기록하고
// 일별 카운터는 기존 서버 계수 이벤트(app_open 포함)만 유지한다.

export const USAGE_EVENT_NAMES = ["app_open", "check", "recommend", "recommend_failed", "save", "share"] as const;
export type UsageEventName = (typeof USAGE_EVENT_NAMES)[number];

// 서버 route handler가 직접 계수하는 이벤트 — 클라이언트가 보낼 수 없다.
const SERVER_OWNED_EVENT_NAMES = new Set<string>(["check", "recommend", "recommend_failed", "save", "share"]);

// 클라이언트가 /api/events로 보낼 수 있는 퍼널 이벤트 화이트리스트.
export const CLIENT_USAGE_EVENT_NAMES = [
  "app_open",
  "view",
  "onboarding_step",
  "onboarding_resume",
  "onboarding_complete",
  "onboarding_exit",
  "recommend_request",
  "recommend_success",
  "recommend_fail",
  "check_request",
  "check_success",
  "check_fail",
  "part_picker_open",
  "part_select",
  "build_save",
  "share_link"
] as const;
export type ClientUsageEventName = (typeof CLIENT_USAGE_EVENT_NAMES)[number];

const CLIENT_USAGE_EVENT_NAME_SET = new Set<string>(CLIENT_USAGE_EVENT_NAMES);
const USAGE_EVENT_MAX_BATCH = 30;
const USAGE_EVENT_MAX_AGE_MS = 48 * 60 * 60 * 1_000;
const USAGE_EVENT_MAX_CLOCK_SKEW_MS = 10 * 60 * 1_000;
const USAGE_EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,72}$/;
const USAGE_EVENT_PROP_KEY_PATTERN = /^[a-z_][a-z0-9_]{0,39}$/;
const USAGE_EVENT_MAX_PROPS = 16;

const USAGE_EVENT_RETENTION_DAYS = 90;
const MAX_DAILY_BUCKETS = USAGE_EVENT_RETENTION_DAYS + 7;

function dayKeyFor(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function recordUsageEvent(name: UsageEventName, at: Date = new Date(), raw?: { path?: string; props?: Record<string, unknown> }) {
  const writes: Promise<unknown>[] = [incrementUsageEventInDatabase(dayKeyFor(at), name, MAX_DAILY_BUCKETS)];
  // 서버 계수 이벤트도 원시 로그에 남겨 일별 추이를 같은 표면에서 본다.
  if (raw) writes.push(insertUsageEventsInDatabase([{ event: name, occurredAt: at, path: raw.path, props: raw.props }]));
  await Promise.all(writes);
}

// Route handler 전용 fire-and-forget — 응답을 지연시키거나 실패를 전파하지 않는다.
export function trackUsageEvent(name: UsageEventName, raw?: { path?: string; props?: Record<string, unknown> }) {
  void recordUsageEvent(name, new Date(), raw).catch(() => undefined);
}

export type ClientUsageEventInput = {
  name: ClientUsageEventName;
  at: Date;
  path?: string;
  props?: Record<string, unknown>;
};

export type ClientUsageEventBatch = {
  visitorId?: string;
  sessionId?: string;
  events: ClientUsageEventInput[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeUsageEventProps(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).slice(0, USAGE_EVENT_MAX_PROPS);
  const props: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    if (!USAGE_EVENT_PROP_KEY_PATTERN.test(key)) continue;
    if (typeof item === "string") props[key] = item.slice(0, 160);
    else if (typeof item === "number" && Number.isFinite(item)) props[key] = Math.round(item * 1000) / 1000;
    else if (typeof item === "boolean" || item === null) props[key] = item;
  }
  return props;
}

function sanitizeUsageEventPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.length > 200) return undefined;
  return trimmed;
}

function sanitizeUsageEventId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return USAGE_EVENT_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

function sanitizeUsageEventAt(value: unknown, now: number): Date {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && Math.abs(parsed - now) <= USAGE_EVENT_MAX_AGE_MS + USAGE_EVENT_MAX_CLOCK_SKEW_MS) {
      return new Date(Math.min(parsed, now + USAGE_EVENT_MAX_CLOCK_SKEW_MS));
    }
  }
  return new Date(now);
}

function clientUsageEventFromUnknown(value: unknown, now: number): ClientUsageEventInput | undefined {
  if (!isRecord(value)) return undefined;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!CLIENT_USAGE_EVENT_NAME_SET.has(name) || SERVER_OWNED_EVENT_NAMES.has(name)) return undefined;
  return {
    name: name as ClientUsageEventName,
    at: sanitizeUsageEventAt(value.at, now),
    path: sanitizeUsageEventPath(value.path),
    props: sanitizeUsageEventProps(value.props)
  };
}

// 단일 {name} 형태와 {visitorId, sessionId, events:[...]} 배치를 모두 받는다.
// 잘못된 이벤트는 건너뛰고, 유효 이벤트가 하나도 없으면 undefined를 반환한다.
export function clientUsageEventsFromRequest(body: unknown): ClientUsageEventBatch | undefined {
  if (!isRecord(body)) return undefined;
  const now = Date.now();
  const visitorId = sanitizeUsageEventId(body.visitorId);
  const sessionId = sanitizeUsageEventId(body.sessionId);
  const rawEvents = Array.isArray(body.events) ? body.events.slice(0, USAGE_EVENT_MAX_BATCH) : [body];
  const events = rawEvents.map((item) => clientUsageEventFromUnknown(item, now)).filter((item): item is ClientUsageEventInput => Boolean(item));
  if (events.length === 0) return undefined;
  return { visitorId, sessionId, events };
}

export async function recordClientUsageEvents(batch: ClientUsageEventBatch) {
  const rows: UsageEventInsertRow[] = batch.events.map((event) => ({
    event: event.name,
    occurredAt: event.at,
    visitorId: batch.visitorId,
    sessionId: batch.sessionId,
    path: event.path,
    ...(event.props ? { props: event.props } : {})
  }));
  await insertUsageEventsInDatabase(rows);
  // app_open만 기존 일별 카운터와 병행 계수한다 — 서버 소유 이벤트와 같은 규칙.
  const appOpens = batch.events.filter((event) => event.name === "app_open");
  for (const event of appOpens) {
    await incrementUsageEventInDatabase(dayKeyFor(event.at), "app_open", MAX_DAILY_BUCKETS);
  }
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

// ─── 퍼널·리텐션 집계 ────────────────────────────────────────────────

type AnalyticsRow = {
  event: string;
  visitor_key: string | null;
  session_key: string | null;
  path: string | null;
  props: Record<string, unknown> | null;
  occurred_at: Date;
};

function propString(row: AnalyticsRow, key: string) {
  const value = row.props?.[key];
  return typeof value === "string" ? value : undefined;
}

const ONBOARDING_STEP_ORDER = ["intent", "mode", "upgrade", "usecase", "games", "performance", "graphics", "works", "intensity", "spec", "budget", "summary"] as const;
const ONBOARDING_STEP_LABELS: Record<string, string> = {
  intent: "목적 선택",
  mode: "기준 선택",
  upgrade: "업그레이드 안내",
  usecase: "용도 선택",
  games: "게임 선택",
  performance: "목표 성능",
  graphics: "그래픽 설정",
  works: "작업 선택",
  intensity: "작업 강도",
  spec: "사양 입력",
  budget: "예산 입력",
  summary: "최종 확인"
};
const VIEW_LABELS: Record<string, string> = {
  home: "홈",
  start: "온보딩",
  generator: "자동 구성",
  editor: "견적 편집",
  result: "결과",
  history: "저장 목록",
  admin: "관리자",
  accessories: "주변 부품",
  catalog: "카탈로그",
  pricewatchlist: "가격 추적",
  watchlist: "공유 추적",
  budget: "예산 비교 공유",
  "generator-variants": "구성 비교 공유",
  comparison: "부품 비교 공유",
  "version-comparison": "버전 비교 공유"
};

type FunnelStage = { key: string; label: string; match: (row: AnalyticsRow) => boolean };

// 자동 구성 경로와 수동 편집 경로를 하나의 여정으로 합친다.
const FUNNEL_STAGES: FunnelStage[] = [
  { key: "visit", label: "앱 방문", match: (row) => row.event === "app_open" },
  { key: "entry", label: "견적 시작", match: (row) => row.event === "onboarding_step" || row.event === "onboarding_resume" || (row.event === "view" && (propString(row, "view") === "start" || propString(row, "view") === "editor")) },
  { key: "configured", label: "조건·부품 입력", match: (row) => (row.event === "onboarding_step" && !["intent", "mode"].includes(propString(row, "step") ?? "")) || row.event === "part_select" },
  { key: "requested", label: "생성·검사 요청", match: (row) => row.event === "recommend_request" || row.event === "check_request" },
  { key: "generated", label: "생성·검사 성공", match: (row) => row.event === "recommend_success" || row.event === "check_success" },
  { key: "result", label: "결과 열람", match: (row) => row.event === "view" && propString(row, "view") === "result" },
  { key: "saved", label: "견적 저장", match: (row) => row.event === "build_save" },
  { key: "shared", label: "공유", match: (row) => row.event === "share_link" }
];

function dayKeyOf(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function usageAnalyticsFor(days: number) {
  const rangeDays = Math.min(USAGE_EVENT_RETENTION_DAYS, Math.max(1, Math.floor(days)));
  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1_000);
  const rows = (await readUsageEventRowsForAnalytics(since)) as AnalyticsRow[];

  const visitors = new Set<string>();
  const sessions = new Set<string>();
  const daily = new Map<string, { day: string; events: number; visitors: Set<string>; sessions: Set<string>; appOpens: number }>();
  const eventCounts = new Map<string, { count: number; visitors: Set<string> }>();
  const viewCounts = new Map<string, { events: number; visitors: Set<string> }>();
  const onboardingSteps = new Map<string, Set<string>>();
  // visitor별 각 퍼널 단계의 최초 도달 시각
  const visitorStageAt = new Map<string, number[]>();
  const visitorDays = new Map<string, Set<string>>();
  const visitorFirstDay = new Map<string, string>();
  const sessionRows = new Map<string, { events: number; firstAt: number; lastAt: number }>();
  let recommendRequestCount = 0;
  let recommendSuccessCount = 0;
  let checkSuccessCount = 0;
  let saveCount = 0;
  let shareCount = 0;

  for (const row of rows) {
    const at = row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at);
    const atMs = at.getTime();
    const day = dayKeyOf(at);
    const visitor = row.visitor_key ?? undefined;
    const session = row.session_key ?? undefined;

    if (visitor) {
      visitors.add(visitor);
      const daySet = visitorDays.get(visitor) ?? new Set<string>();
      daySet.add(day);
      visitorDays.set(visitor, daySet);
      const firstDay = visitorFirstDay.get(visitor);
      if (firstDay === undefined || day < firstDay) visitorFirstDay.set(visitor, day);
    }
    if (session) sessions.add(session);

    const bucket = daily.get(day) ?? { day, events: 0, visitors: new Set<string>(), sessions: new Set<string>(), appOpens: 0 };
    bucket.events += 1;
    if (row.event === "app_open") bucket.appOpens += 1;
    if (visitor) bucket.visitors.add(visitor);
    if (session) bucket.sessions.add(session);
    daily.set(day, bucket);

    const eventBucket = eventCounts.get(row.event) ?? { count: 0, visitors: new Set<string>() };
    eventBucket.count += 1;
    if (visitor) eventBucket.visitors.add(visitor);
    eventCounts.set(row.event, eventBucket);

    if (row.event === "view") {
      const viewName = propString(row, "view") ?? "unknown";
      const viewBucket = viewCounts.get(viewName) ?? { events: 0, visitors: new Set<string>() };
      viewBucket.events += 1;
      if (visitor) viewBucket.visitors.add(visitor);
      viewCounts.set(viewName, viewBucket);
    }

    if (row.event === "onboarding_step" && visitor) {
      const step = propString(row, "step") ?? "unknown";
      const set = onboardingSteps.get(step) ?? new Set<string>();
      set.add(visitor);
      onboardingSteps.set(step, set);
    }

    if (row.event === "recommend_request") recommendRequestCount += 1;
    if (row.event === "recommend_success") recommendSuccessCount += 1;
    if (row.event === "check_success") checkSuccessCount += 1;
    if (row.event === "build_save") saveCount += 1;
    if (row.event === "share_link") shareCount += 1;

    if (session) {
      const stats = sessionRows.get(session) ?? { events: 0, firstAt: atMs, lastAt: atMs };
      stats.events += 1;
      stats.firstAt = Math.min(stats.firstAt, atMs);
      stats.lastAt = Math.max(stats.lastAt, atMs);
      sessionRows.set(session, stats);
    }

    if (visitor) {
      const stageAt = visitorStageAt.get(visitor) ?? [];
      FUNNEL_STAGES.forEach((stage, index) => {
        if (stageAt[index] === undefined && stage.match(row)) stageAt[index] = atMs;
      });
      visitorStageAt.set(visitor, stageAt);
    }
  }

  // 단조 퍼널 — 이전 단계 이후에 도달한 방문자만 다음 단계로 센다.
  const funnelCounts = FUNNEL_STAGES.map(() => 0);
  const deepestStageCounts = FUNNEL_STAGES.map(() => 0);
  for (const stageAt of visitorStageAt.values()) {
    let previousAt = -Infinity;
    let deepest = -1;
    FUNNEL_STAGES.forEach((stage, index) => {
      const at = stageAt[index];
      if (at !== undefined && at >= previousAt) {
        funnelCounts[index] += 1;
        previousAt = at;
        deepest = index;
      }
    });
    if (deepest >= 0) deepestStageCounts[deepest] += 1;
  }

  const funnel = FUNNEL_STAGES.map((stage, index) => {
    const count = funnelCounts[index];
    const previous = index > 0 ? funnelCounts[index - 1] : 0;
    return {
      key: stage.key,
      label: stage.label,
      visitors: count,
      conversionFromStart: funnelCounts[0] > 0 ? count / funnelCounts[0] : 0,
      conversionFromPrev: index === 0 ? 1 : previous > 0 ? count / previous : 0,
      dropFromPrev: index === 0 ? 0 : previous > 0 ? Math.max(0, 1 - count / previous) : 0,
      exitedHere: deepestStageCounts[index]
    };
  });

  // 온보딩 스텝별 도달 — 브랜치 플로우라 단조 체인 대신 단계별 고유 방문자를 본다.
  const onboarding = ONBOARDING_STEP_ORDER.map((step) => ({
    step,
    label: ONBOARDING_STEP_LABELS[step] ?? step,
    visitors: onboardingSteps.get(step)?.size ?? 0
  }));

  // 리텐션 코호트 — 첫 방문일 기준으로 D+1/D+7/D+30 재방문율.
  const cohortMap = new Map<string, { size: number; day1: number; day7: number; day30: number }>();
  for (const [visitor, firstDay] of visitorFirstDay) {
    const cohort = cohortMap.get(firstDay) ?? { size: 0, day1: 0, day7: 0, day30: 0 };
    cohort.size += 1;
    const days = visitorDays.get(visitor)!;
    const firstTime = Date.parse(`${firstDay}T00:00:00.000Z`);
    for (const offset of [1, 7, 30] as const) {
      const target = dayKeyOf(new Date(firstTime + offset * 24 * 60 * 60 * 1_000));
      if (days.has(target)) cohort[`day${offset}`] += 1;
    }
    cohortMap.set(firstDay, cohort);
  }
  const cohorts = [...cohortMap.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, 30)
    .map(([day, cohort]) => ({
      day,
      size: cohort.size,
      day1: cohort.size > 0 ? cohort.day1 / cohort.size : 0,
      day7: cohort.size > 0 ? cohort.day7 / cohort.size : 0,
      day30: cohort.size > 0 ? cohort.day30 / cohort.size : 0
    }));

  const sessionStats = [...sessionRows.values()];
  const completedSessions = sessionStats.length;
  const avgEventsPerSession = completedSessions > 0 ? sessionStats.reduce((sum, item) => sum + item.events, 0) / completedSessions : 0;
  const avgSessionMinutes = completedSessions > 0 ? sessionStats.reduce((sum, item) => sum + (item.lastAt - item.firstAt), 0) / completedSessions / 60_000 : 0;
  const bounceSessions = sessionStats.filter((item) => item.events <= 1).length;

  return {
    generatedAt: new Date().toISOString(),
    rangeDays,
    totals: {
      events: rows.length,
      visitors: visitors.size,
      sessions: sessions.size,
      appOpens: rows.filter((row) => row.event === "app_open").length,
      recommendRequests: recommendRequestCount,
      recommendSuccesses: recommendSuccessCount,
      recommendSuccessRate: recommendRequestCount > 0 ? recommendSuccessCount / recommendRequestCount : 0,
      checkSuccesses: checkSuccessCount,
      saves: saveCount,
      shares: shareCount
    },
    daily: [...daily.values()].sort((left, right) => left.day.localeCompare(right.day)).map((bucket) => ({
      day: bucket.day,
      events: bucket.events,
      visitors: bucket.visitors.size,
      sessions: bucket.sessions.size,
      appOpens: bucket.appOpens
    })),
    funnel,
    onboarding,
    views: [...viewCounts.entries()].sort((left, right) => right[1].events - left[1].events).map(([view, bucket]) => ({
      view,
      label: VIEW_LABELS[view] ?? view,
      events: bucket.events,
      visitors: bucket.visitors.size
    })),
    events: [...eventCounts.entries()].sort((left, right) => right[1].count - left[1].count).map(([event, bucket]) => ({
      event,
      count: bucket.count,
      visitors: bucket.visitors.size
    })),
    retention: { cohorts },
    sessions: {
      count: completedSessions,
      avgEventsPerSession,
      avgSessionMinutes,
      bounceRate: completedSessions > 0 ? bounceSessions / completedSessions : 0
    }
  };
}

export type UsageAnalyticsSummary = Awaited<ReturnType<typeof usageAnalyticsFor>>;
