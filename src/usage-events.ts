import { apiRequestUrl } from "./api";
import { safeLocalStorage, safeSessionStorage } from "./safe-storage";

// 익명·집계 전용 퍼널 이벤트 (개인 식별자/민감 페이로드 없음).
// visitor/session 키는 랜덤 UUID이며 서버에서 HMAC 해시 후 저장된다 — 원문은 남지 않는다.
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

export type UsageEventProps = Record<string, string | number | boolean | null | undefined>;

const VISITOR_ID_STORAGE_KEY = "pc-supporter-visitor-id";
const SESSION_ID_STORAGE_KEY = "pc-supporter-session-id";
const APP_OPEN_SESSION_KEY = "pc-supporter-app-opened";
const FLUSH_BATCH_SIZE = 8;
const FLUSH_INTERVAL_MS = 15_000;

type QueuedUsageEvent = {
  name: ClientUsageEventName;
  at: string;
  path: string;
  props?: UsageEventProps;
};

const eventQueue: QueuedUsageEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushInFlight = false;

function randomUsageId() {
  try {
    return crypto.randomUUID().replaceAll("-", "").slice(0, 24);
  } catch {
    return `id-${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`;
  }
}

function storedUsageId(storage: Pick<Storage, "getItem" | "setItem">, key: string) {
  try {
    const existing = storage.getItem(key);
    if (existing && existing.length >= 8 && existing.length <= 72) return existing;
    const created = randomUsageId();
    storage.setItem(key, created);
    return created;
  } catch {
    return undefined;
  }
}

// localStorage 기반 — 같은 브라우저의 재방문을 식별한다 (삭제하면 새 방문자로 집계).
export function usageVisitorId() {
  return storedUsageId(safeLocalStorage, VISITOR_ID_STORAGE_KEY);
}

// sessionStorage 기반 — 탭/세션 단위 방문을 식별한다.
export function usageSessionId() {
  return storedUsageId(safeSessionStorage, SESSION_ID_STORAGE_KEY);
}

function usageEventPayload(events: QueuedUsageEvent[]) {
  return JSON.stringify({ visitorId: usageVisitorId(), sessionId: usageSessionId(), events });
}

function flushUsageEvents() {
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  if (flushInFlight || eventQueue.length === 0) return;
  const events = eventQueue.splice(0, eventQueue.length);
  flushInFlight = true;
  void fetch(apiRequestUrl("/api/events"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: usageEventPayload(events),
    keepalive: true
  })
    .catch(() => undefined)
    .finally(() => {
      flushInFlight = false;
      if (eventQueue.length > 0) scheduleUsageEventFlush();
    });
}

function flushUsageEventsViaBeacon() {
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  if (eventQueue.length === 0) return;
  const events = eventQueue.splice(0, eventQueue.length);
  const body = usageEventPayload(events);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(apiRequestUrl("/api/events"), new Blob([body], { type: "application/json" }))) return;
    }
  } catch {
    // beacon 실패 시 fetch keepalive로 한 번 더 시도한다
  }
  void fetch(apiRequestUrl("/api/events"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true
  }).catch(() => undefined);
}

function scheduleUsageEventFlush() {
  if (flushTimer !== undefined || flushInFlight) return;
  flushTimer = setTimeout(flushUsageEvents, FLUSH_INTERVAL_MS);
}

export function trackUsageEvent(name: ClientUsageEventName, props?: UsageEventProps) {
  try {
    if (name === "app_open") {
      if (safeSessionStorage.getItem(APP_OPEN_SESSION_KEY)) return;
      safeSessionStorage.setItem(APP_OPEN_SESSION_KEY, "1");
    }
    eventQueue.push({ name, at: new Date().toISOString(), path: window.location.pathname, ...(props ? { props } : {}) });
    if (eventQueue.length >= FLUSH_BATCH_SIZE || name === "app_open" || name === "onboarding_complete" || name === "build_save" || name === "share_link") flushUsageEvents();
    else scheduleUsageEventFlush();
  } catch {
    // 추적 실패는 앱 동작에 영향을 주지 않는다
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushUsageEventsViaBeacon();
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushUsageEventsViaBeacon);
}
