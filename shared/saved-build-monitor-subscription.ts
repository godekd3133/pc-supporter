import { dismissSavedBuildMonitorAlerts, mergeSavedBuildMonitorAlerts, savedBuildMonitorAlertFor, savedBuildMonitorAlertsFromUnknown } from "./saved-build-monitor-alerts";
import type { SavedBuildMonitorAlert } from "./saved-build-monitor-alerts";
import { savedBuildCheckSnapshotFromUnknown, savedBuildCheckTransitionSummaryFor } from "./saved-build-check";
import type { SavedBuildCheckSnapshot } from "./types";

export const SAVED_BUILD_SERVER_MONITOR_INTERVALS = [60, 360, 1440] as const;
export type SavedBuildServerMonitorInterval = (typeof SAVED_BUILD_SERVER_MONITOR_INTERVALS)[number];
export const DEFAULT_SAVED_BUILD_SERVER_MONITOR_INTERVAL: SavedBuildServerMonitorInterval = 360;
export const SAVED_BUILD_SERVER_MONITOR_ALERT_POLICIES = ["critical", "risk", "all"] as const;
export type SavedBuildServerMonitorAlertPolicy = (typeof SAVED_BUILD_SERVER_MONITOR_ALERT_POLICIES)[number];
export const DEFAULT_SAVED_BUILD_SERVER_MONITOR_ALERT_POLICY: SavedBuildServerMonitorAlertPolicy = "all";
export const SAVED_BUILD_SERVER_MONITOR_SCHEDULER_BATCH_LIMIT = 5;

export interface SavedBuildMonitorSubscription {
  enabled: boolean;
  intervalMinutes: SavedBuildServerMonitorInterval;
  alertPolicy: SavedBuildServerMonitorAlertPolicy;
  updatedAt: string;
  alerts: SavedBuildMonitorAlert[];
  lastAttemptedAt?: string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  lastSnapshot?: SavedBuildCheckSnapshot;
  lastError?: string;
  lastErrorAt?: string;
}

export interface SavedBuildMonitorSubscriptionResponse {
  buildId: string;
  buildName: string;
  subscription: SavedBuildMonitorSubscription;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && Number.isFinite(Date.parse(value));
}

function boundedError(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 300;
}

export function defaultSavedBuildMonitorSubscription(updatedAt = new Date().toISOString()): SavedBuildMonitorSubscription {
  return { enabled: false, intervalMinutes: DEFAULT_SAVED_BUILD_SERVER_MONITOR_INTERVAL, alertPolicy: DEFAULT_SAVED_BUILD_SERVER_MONITOR_ALERT_POLICY, updatedAt, alerts: [] };
}

export function savedBuildMonitorSubscriptionFromUnknown(value: unknown): SavedBuildMonitorSubscription | undefined {
  if (!isRecord(value) || typeof value.enabled !== "boolean" || !SAVED_BUILD_SERVER_MONITOR_INTERVALS.includes(value.intervalMinutes as SavedBuildServerMonitorInterval) || (value.alertPolicy !== undefined && !SAVED_BUILD_SERVER_MONITOR_ALERT_POLICIES.includes(value.alertPolicy as SavedBuildServerMonitorAlertPolicy)) || !validTimestamp(value.updatedAt)) return undefined;
  const alertPolicy = value.alertPolicy === undefined ? DEFAULT_SAVED_BUILD_SERVER_MONITOR_ALERT_POLICY : value.alertPolicy as SavedBuildServerMonitorAlertPolicy;
  const lastAttemptedAt = validTimestamp(value.lastAttemptedAt) ? value.lastAttemptedAt : undefined;
  const lastCheckedAt = validTimestamp(value.lastCheckedAt) ? value.lastCheckedAt : undefined;
  const nextCheckAt = validTimestamp(value.nextCheckAt) ? value.nextCheckAt : undefined;
  const lastSnapshot = savedBuildCheckSnapshotFromUnknown(value.lastSnapshot);
  const lastError = boundedError(value.lastError) ? value.lastError : undefined;
  const lastErrorAt = validTimestamp(value.lastErrorAt) ? value.lastErrorAt : undefined;
  return {
    enabled: value.enabled,
    intervalMinutes: value.intervalMinutes as SavedBuildServerMonitorInterval,
    alertPolicy,
    updatedAt: value.updatedAt,
    alerts: savedBuildMonitorAlertsFromUnknown(value.alerts),
    ...(lastAttemptedAt ? { lastAttemptedAt } : {}),
    ...(lastCheckedAt ? { lastCheckedAt } : {}),
    ...(value.enabled && nextCheckAt ? { nextCheckAt } : {}),
    ...(lastSnapshot ? { lastSnapshot } : {}),
    ...(lastError ? { lastError } : {}),
    ...(lastErrorAt ? { lastErrorAt } : {})
  };
}

export function parseSavedBuildMonitorSettings(value: unknown, fallbackInterval: SavedBuildServerMonitorInterval = DEFAULT_SAVED_BUILD_SERVER_MONITOR_INTERVAL, fallbackAlertPolicy: SavedBuildServerMonitorAlertPolicy = DEFAULT_SAVED_BUILD_SERVER_MONITOR_ALERT_POLICY) {
  if (!isRecord(value)) return { errors: ["모니터링 설정 객체가 필요합니다."] };
  const errors: string[] = [];
  if (typeof value.enabled !== "boolean") errors.push("enabled는 boolean이어야 합니다.");
  const intervalMinutes = value.intervalMinutes === undefined ? fallbackInterval : Number(value.intervalMinutes);
  if (!SAVED_BUILD_SERVER_MONITOR_INTERVALS.includes(intervalMinutes as SavedBuildServerMonitorInterval)) errors.push("intervalMinutes는 60, 360, 1440 중 하나여야 합니다.");
  const alertPolicy = value.alertPolicy === undefined ? fallbackAlertPolicy : value.alertPolicy;
  if (!SAVED_BUILD_SERVER_MONITOR_ALERT_POLICIES.includes(alertPolicy as SavedBuildServerMonitorAlertPolicy)) errors.push("alertPolicy는 critical, risk, all 중 하나여야 합니다.");
  if (errors.length > 0 || typeof value.enabled !== "boolean") return { errors };
  return { errors, settings: { enabled: value.enabled, intervalMinutes: intervalMinutes as SavedBuildServerMonitorInterval, alertPolicy: alertPolicy as SavedBuildServerMonitorAlertPolicy } };
}

export function configureSavedBuildMonitorSubscription(current: SavedBuildMonitorSubscription | undefined, settings: { enabled: boolean; intervalMinutes: SavedBuildServerMonitorInterval; alertPolicy: SavedBuildServerMonitorAlertPolicy }, updatedAt: string) {
  const base = current ?? defaultSavedBuildMonitorSubscription(updatedAt);
  return {
    ...base,
    enabled: settings.enabled,
    intervalMinutes: settings.intervalMinutes,
    alertPolicy: settings.alertPolicy,
    updatedAt,
    ...(settings.enabled ? { nextCheckAt: updatedAt } : { nextCheckAt: undefined })
  } satisfies SavedBuildMonitorSubscription;
}

function nextCheckAtFor(checkedAt: string, intervalMinutes: SavedBuildServerMonitorInterval) {
  return new Date(Date.parse(checkedAt) + intervalMinutes * 60 * 1000).toISOString();
}

export function savedBuildMonitorSubscriptionDue(subscription: SavedBuildMonitorSubscription | undefined, now: string) {
  if (!subscription?.enabled) return false;
  if (!subscription.nextCheckAt) return true;
  return Date.parse(subscription.nextCheckAt) <= Date.parse(now);
}

export function savedBuildMonitorTransitionHasActionableChange(transition: ReturnType<typeof savedBuildCheckTransitionSummaryFor>) {
  return transition.statusChanged
    || transition.blockerDelta !== 0
    || transition.warningDelta !== 0
    || transition.unknownDelta !== 0
    || transition.accessoryBlockerDelta !== 0
    || transition.accessoryWarningDelta !== 0
    || transition.accessoryUnknownDelta !== 0
    || transition.accessoryRiskChanged
    || transition.priceCompletenessChanged
    || (transition.priceDeltaWon !== undefined && transition.priceDeltaWon !== 0)
    || transition.resolvedFindingCount > 0
    || transition.newFindingCount > 0
    || transition.severityChangedFindingCount > 0
    || transition.detailsChangedFindingCount > 0;
}

export function savedBuildMonitorAlertAllowed(policy: SavedBuildServerMonitorAlertPolicy, kind: SavedBuildMonitorAlert["kind"]) {
  if (policy === "all") return true;
  if (policy === "risk") return kind === "critical" || kind === "review" || kind === "failed";
  return kind === "critical" || kind === "failed";
}

export function completeSavedBuildMonitorRun(build: { id: string; name: string }, current: SavedBuildMonitorSubscription | undefined, snapshot: SavedBuildCheckSnapshot, checkedAt: string, fallbackBaseline?: SavedBuildCheckSnapshot) {
  const base = current ?? defaultSavedBuildMonitorSubscription(checkedAt);
  const firstMonitorRun = !base.lastSnapshot;
  const baseline = base.lastSnapshot ?? fallbackBaseline;
  const transition = baseline ? savedBuildCheckTransitionSummaryFor(baseline, snapshot) : undefined;
  const monitorItem = { id: build.id, status: "ready" as const, snapshot, ...(transition ? { transition } : {}) };
  const candidateAlert = firstMonitorRun || !transition || savedBuildMonitorTransitionHasActionableChange(transition) ? savedBuildMonitorAlertFor(build, monitorItem, checkedAt) : undefined;
  const allowedAlert = candidateAlert && savedBuildMonitorAlertAllowed(base.alertPolicy, candidateAlert.kind) ? candidateAlert : undefined;
  const alerts = allowedAlert ? mergeSavedBuildMonitorAlerts(base.alerts, [allowedAlert]) : base.alerts;
  return {
    ...base,
    updatedAt: checkedAt,
    lastAttemptedAt: checkedAt,
    lastCheckedAt: checkedAt,
    lastSnapshot: snapshot,
    alerts,
    ...(base.enabled ? { nextCheckAt: nextCheckAtFor(checkedAt, base.intervalMinutes) } : { nextCheckAt: undefined }),
    lastError: undefined,
    lastErrorAt: undefined
  } satisfies SavedBuildMonitorSubscription;
}

export function failSavedBuildMonitorRun(current: SavedBuildMonitorSubscription | undefined, message: string, attemptedAt: string, build?: { id: string; name: string }) {
  const base = current ?? defaultSavedBuildMonitorSubscription(attemptedAt);
  const lastError = message.trim().slice(0, 300) || "저장 견적 자동 점검에 실패했습니다.";
  const failureAlert = build ? savedBuildMonitorAlertFor(build, { id: build.id, status: "error", message: lastError }, attemptedAt) : undefined;
  const allowedFailureAlert = failureAlert && savedBuildMonitorAlertAllowed(base.alertPolicy, failureAlert.kind) ? failureAlert : undefined;
  return {
    ...base,
    updatedAt: attemptedAt,
    lastAttemptedAt: attemptedAt,
    ...(base.enabled ? { nextCheckAt: nextCheckAtFor(attemptedAt, base.intervalMinutes) } : { nextCheckAt: undefined }),
    alerts: allowedFailureAlert ? mergeSavedBuildMonitorAlerts(base.alerts, [allowedFailureAlert]) : base.alerts,
    lastError,
    lastErrorAt: attemptedAt
  } satisfies SavedBuildMonitorSubscription;
}

export function parseSavedBuildMonitorAlertIds(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.alertIds)) return { ids: [], errors: ["alertIds 배열이 필요합니다."] };
  const ids = [...new Set(value.alertIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 240))].slice(0, 50);
  const errors: string[] = [];
  if (ids.length !== value.alertIds.length) errors.push("alertIds에는 최대 50개의 유효한 알림 ID만 사용할 수 있습니다.");
  if (ids.length === 0 && errors.length === 0) errors.push("처리할 알림 ID가 없습니다.");
  return { ids, errors };
}

export function updateSavedBuildMonitorAlertState(current: SavedBuildMonitorSubscription, alertIds: string[], action: "read" | "dismiss", updatedAt: string) {
  const selected = new Set(alertIds);
  const alerts = action === "read"
    ? current.alerts.map((alert) => selected.has(alert.id) && !alert.readAt ? { ...alert, readAt: updatedAt } : alert)
    : dismissSavedBuildMonitorAlerts(current.alerts, alertIds, updatedAt);
  return { ...current, alerts, updatedAt };
}
