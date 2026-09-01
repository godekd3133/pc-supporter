import { savedBuildMonitorAssessmentFor } from "./saved-build-monitor";
import type { SavedBuildMonitorItem } from "./saved-build-monitor";

export const SAVED_BUILD_MONITOR_ALERT_LIMIT = 50;

export type SavedBuildMonitorAlertKind = "critical" | "review" | "improved" | "changed" | "baseline" | "failed";
export type SavedBuildMonitorAlertFilter = "all" | "unread" | "attention" | "changes";
const SAVED_BUILD_MONITOR_ALERT_KINDS: SavedBuildMonitorAlertKind[] = ["critical", "review", "improved", "changed", "baseline", "failed"];

export interface SavedBuildMonitorAlert {
  id: string;
  buildId: string;
  buildName: string;
  kind: SavedBuildMonitorAlertKind;
  title: string;
  message: string;
  createdAt: string;
  checkedAt?: string;
  readAt?: string;
  dismissedAt?: string;
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function savedBuildMonitorAlertFromUnknown(value: unknown): SavedBuildMonitorAlert | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<SavedBuildMonitorAlert>;
  if (!boundedText(candidate.id, 240)
    || !boundedText(candidate.buildId, 120)
    || !boundedText(candidate.buildName, 160)
    || !SAVED_BUILD_MONITOR_ALERT_KINDS.includes(candidate.kind as SavedBuildMonitorAlertKind)
    || !boundedText(candidate.title, 160)
    || !boundedText(candidate.message, 300)
    || !boundedText(candidate.createdAt, 120)
    || (candidate.checkedAt !== undefined && !boundedText(candidate.checkedAt, 120))
    || (candidate.readAt !== undefined && !boundedText(candidate.readAt, 120))
    || (candidate.dismissedAt !== undefined && !boundedText(candidate.dismissedAt, 120))) return undefined;
  return candidate as SavedBuildMonitorAlert;
}

export function savedBuildMonitorAlertsFromUnknown(value: unknown, limit = SAVED_BUILD_MONITOR_ALERT_LIMIT) {
  if (!Array.isArray(value)) return [];
  const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : SAVED_BUILD_MONITOR_ALERT_LIMIT;
  const boundedLimit = Math.max(1, Math.min(SAVED_BUILD_MONITOR_ALERT_LIMIT, requestedLimit));
  return value.map(savedBuildMonitorAlertFromUnknown).filter((alert): alert is SavedBuildMonitorAlert => alert !== undefined).slice(0, boundedLimit);
}

function hashText(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function readyItemSignal(item: Extract<SavedBuildMonitorItem, { status: "ready" }>, level: SavedBuildMonitorAlertKind) {
  const transition = item.transition;
  return {
    level,
    status: item.snapshot.status,
    blockerCount: item.snapshot.blockerCount,
    warningCount: item.snapshot.warningCount,
    unknownCount: item.snapshot.unknownCount,
    accessoryCompatibility: item.snapshot.accessoryCompatibility ? {
      status: item.snapshot.accessoryCompatibility.status,
      blockerCount: item.snapshot.accessoryCompatibility.blockerCount,
      warningCount: item.snapshot.accessoryCompatibility.warningCount,
      unknownCount: item.snapshot.accessoryCompatibility.unknownCount
    } : undefined,
    totalPriceWon: item.snapshot.totalPriceWon,
    priceComplete: item.snapshot.priceComplete,
    engineVersion: item.snapshot.engineVersion,
    transition: transition ? {
      direction: transition.direction,
      statusChanged: transition.statusChanged,
      blockerDelta: transition.blockerDelta,
      warningDelta: transition.warningDelta,
      unknownDelta: transition.unknownDelta,
      accessoryBlockerDelta: transition.accessoryBlockerDelta,
      accessoryWarningDelta: transition.accessoryWarningDelta,
      accessoryUnknownDelta: transition.accessoryUnknownDelta,
      accessoryRiskChanged: transition.accessoryRiskChanged,
      priceDeltaWon: transition.priceDeltaWon,
      priceCompletenessChanged: transition.priceCompletenessChanged,
      engineChanged: transition.engineChanged,
      catalogChanged: transition.catalogChanged,
      resolvedFindingCount: transition.resolvedFindingCount,
      newFindingCount: transition.newFindingCount,
      severityChangedFindingCount: transition.severityChangedFindingCount,
      detailsChangedFindingCount: transition.detailsChangedFindingCount
    } : undefined
  };
}

export function savedBuildMonitorAlertFor(build: { id: string; name: string }, item: SavedBuildMonitorItem, createdAt: string): SavedBuildMonitorAlert | undefined {
  if (item.status !== "ready") {
    const signature = JSON.stringify({ buildId: build.id, status: item.status, message: item.message });
    return {
      id: `build-monitor:${build.id}:failed:${hashText(signature)}`,
      buildId: build.id,
      buildName: build.name,
      kind: "failed",
      title: item.status === "not_found" ? "견적 확인 불가" : "자동 점검 실패",
      message: item.message,
      createdAt
    };
  }

  const assessment = savedBuildMonitorAssessmentFor(item.snapshot, item.transition);
  if (assessment.level === "stable") return undefined;
  const kind = assessment.level;
  const signature = JSON.stringify({ buildId: build.id, signal: readyItemSignal(item, kind) });
  return {
    id: `build-monitor:${build.id}:${kind}:${hashText(signature)}`,
    buildId: build.id,
    buildName: build.name,
    kind,
    title: assessment.label,
    message: assessment.summary,
    createdAt,
    checkedAt: item.snapshot.checkedAt
  };
}

export function mergeSavedBuildMonitorAlerts(existing: SavedBuildMonitorAlert[], incoming: SavedBuildMonitorAlert[], limit = SAVED_BUILD_MONITOR_ALERT_LIMIT) {
  const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : SAVED_BUILD_MONITOR_ALERT_LIMIT;
  const boundedLimit = Math.max(1, Math.min(SAVED_BUILD_MONITOR_ALERT_LIMIT, requestedLimit));
  const byId = new Map(existing.map((alert) => [alert.id, alert]));
  for (const alert of incoming) {
    const current = byId.get(alert.id);
    if (!current) {
      byId.set(alert.id, alert);
      continue;
    }
    byId.set(alert.id, {
      ...current,
      buildName: alert.buildName,
      ...(current.readAt || alert.readAt ? { readAt: current.readAt ?? alert.readAt } : {}),
      ...(current.dismissedAt || alert.dismissedAt ? { dismissedAt: current.dismissedAt ?? alert.dismissedAt } : {})
    });
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id))
    .slice(0, boundedLimit);
}

export function markSavedBuildMonitorAlertsRead(alerts: SavedBuildMonitorAlert[], readAt: string) {
  return alerts.map((alert) => alert.readAt ? alert : { ...alert, readAt });
}

export function removeSavedBuildMonitorAlert(alerts: SavedBuildMonitorAlert[], id: string) {
  return alerts.filter((alert) => alert.id !== id);
}

export function dismissSavedBuildMonitorAlerts(alerts: SavedBuildMonitorAlert[], ids: string[], dismissedAt: string) {
  const selected = new Set(ids);
  return alerts.map((alert) => selected.has(alert.id) && !alert.dismissedAt ? { ...alert, dismissedAt } : alert);
}

export function savedBuildMonitorAlertMatches(alert: SavedBuildMonitorAlert, filter: SavedBuildMonitorAlertFilter) {
  if (alert.dismissedAt) return false;
  if (filter === "unread") return !alert.readAt;
  if (filter === "attention") return alert.kind === "critical" || alert.kind === "review" || alert.kind === "failed";
  if (filter === "changes") return alert.kind === "improved" || alert.kind === "changed" || alert.kind === "baseline";
  return true;
}
