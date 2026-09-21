import { savedBuildMonitorAssessmentFor } from "./saved-build-monitor";
import type { SavedBuildMonitorItem } from "./saved-build-monitor";
import { PART_CATEGORIES } from "./types";
import type { PartCategory } from "./types";

export const SAVED_BUILD_MONITOR_ALERT_LIMIT = 50;

export type SavedBuildMonitorAlertKind = "critical" | "review" | "improved" | "changed" | "baseline" | "failed" | "alternative";
export type SavedBuildMonitorAlertFilter = "all" | "unread" | "attention" | "changes";
const SAVED_BUILD_MONITOR_ALERT_KINDS: SavedBuildMonitorAlertKind[] = ["critical", "review", "improved", "changed", "baseline", "failed", "alternative"];

export interface SavedBuildMonitorAlternative {
  category: PartCategory;
  currentPartId: string;
  currentPartName: string;
  candidatePartId: string;
  candidatePartName: string;
  scoreLabel: string;
  currentScore: number;
  candidateScore: number;
  currentPriceWon?: number;
  candidatePriceWon?: number;
  priceDeltaWon?: number;
}

export interface SavedBuildMonitorAlert {
  id: string;
  buildId: string;
  buildName: string;
  kind: SavedBuildMonitorAlertKind;
  title: string;
  message: string;
  findingRuleIds?: string[];
  findingTitles?: string[];
  alternative?: SavedBuildMonitorAlternative;
  createdAt: string;
  checkedAt?: string;
  readAt?: string;
  dismissedAt?: string;
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function boundedTextArray(value: unknown, maxItems: number, maxText: number) {
  if (!Array.isArray(value)) return undefined;
  if (value.length > maxItems) return undefined;
  const items = value.filter((item): item is string => boundedText(item, maxText)).slice(0, maxItems);
  return items.length === value.length ? items : undefined;
}

function alternativeFromUnknown(value: unknown): SavedBuildMonitorAlternative | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<SavedBuildMonitorAlternative>;
  if (!PART_CATEGORIES.includes(candidate.category as PartCategory)
    || !boundedText(candidate.currentPartId, 160)
    || !boundedText(candidate.currentPartName, 180)
    || !boundedText(candidate.candidatePartId, 160)
    || !boundedText(candidate.candidatePartName, 180)
    || !boundedText(candidate.scoreLabel, 80)
    || typeof candidate.currentScore !== "number"
    || !Number.isFinite(candidate.currentScore)
    || typeof candidate.candidateScore !== "number"
    || !Number.isFinite(candidate.candidateScore)
    || (candidate.currentPriceWon !== undefined && (typeof candidate.currentPriceWon !== "number" || !Number.isFinite(candidate.currentPriceWon)))
    || (candidate.candidatePriceWon !== undefined && (typeof candidate.candidatePriceWon !== "number" || !Number.isFinite(candidate.candidatePriceWon)))
    || (candidate.priceDeltaWon !== undefined && (typeof candidate.priceDeltaWon !== "number" || !Number.isFinite(candidate.priceDeltaWon)))) return undefined;
  return candidate as SavedBuildMonitorAlternative;
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
    || (candidate.findingRuleIds !== undefined && !boundedTextArray(candidate.findingRuleIds, 4, 120))
    || (candidate.findingTitles !== undefined && !boundedTextArray(candidate.findingTitles, 4, 160))
    || (candidate.alternative !== undefined && !alternativeFromUnknown(candidate.alternative))
    || !boundedText(candidate.createdAt, 120)
    || (candidate.checkedAt !== undefined && !boundedText(candidate.checkedAt, 120))
    || (candidate.readAt !== undefined && !boundedText(candidate.readAt, 120))
    || (candidate.dismissedAt !== undefined && !boundedText(candidate.dismissedAt, 120))) return undefined;
  const findingRuleIds = boundedTextArray(candidate.findingRuleIds, 4, 120);
  const findingTitles = boundedTextArray(candidate.findingTitles, 4, 160);
  const alternative = alternativeFromUnknown(candidate.alternative);
  return {
    ...candidate,
    ...(findingRuleIds && findingRuleIds.length > 0 ? { findingRuleIds } : {}),
    ...(findingTitles && findingTitles.length > 0 ? { findingTitles } : {}),
    ...(alternative ? { alternative } : {})
  } as SavedBuildMonitorAlert;
}

export function savedBuildMonitorAlertsFromUnknown(value: unknown, limit = SAVED_BUILD_MONITOR_ALERT_LIMIT) {
  if (!Array.isArray(value)) return [];
  const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : SAVED_BUILD_MONITOR_ALERT_LIMIT;
  const boundedLimit = Math.max(1, Math.min(SAVED_BUILD_MONITOR_ALERT_LIMIT, requestedLimit));
  if (value.length > boundedLimit) return [];
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

function findingContextFor(item: Extract<SavedBuildMonitorItem, { status: "ready" }>) {
  const severityRank = { blocker: 0, warning: 1, unknown: 2, info: 3 } as const;
  const findings = (item.snapshot.findings ?? [])
    .filter((finding) => finding.severity !== "info")
    .slice()
    .sort((left, right) => severityRank[left.severity] - severityRank[right.severity] || left.title.localeCompare(right.title))
    .slice(0, 4);
  if (findings.length === 0) return undefined;
  return {
    findingRuleIds: findings.map((finding) => finding.ruleId),
    findingTitles: findings.map((finding) => finding.title)
  };
}

function readyItemSignal(item: Extract<SavedBuildMonitorItem, { status: "ready" }>, level: SavedBuildMonitorAlertKind) {
  const transition = item.transition;
  const findingContext = findingContextFor(item);
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
    analysisScore: item.snapshot.analysisScore,
    analysisScoreLabel: item.snapshot.analysisScoreLabel,
    analysisConfidence: item.snapshot.analysisConfidence,
    resourceBudget: item.snapshot.resourceBudget,
    engineVersion: item.snapshot.engineVersion,
    findingRuleIds: findingContext?.findingRuleIds,
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
      analysisScoreDelta: transition.analysisScoreDelta,
      analysisChanged: transition.analysisChanged,
      resourceBudgetChanged: transition.resourceBudgetChanged,
      resourceRiskIncreased: transition.resourceRiskIncreased,
      resourceRiskDecreased: transition.resourceRiskDecreased,
      powerHeadroomDeltaW: transition.powerHeadroomDeltaW,
      coolerHeadroomDeltaW: transition.coolerHeadroomDeltaW,
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
  const findingContext = findingContextFor(item);
  return {
    id: `build-monitor:${build.id}:${kind}:${hashText(signature)}`,
    buildId: build.id,
    buildName: build.name,
    kind,
    title: assessment.label,
    message: assessment.summary,
    ...(findingContext ?? {}),
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
      ...(alert.findingRuleIds ? { findingRuleIds: alert.findingRuleIds } : {}),
      ...(alert.findingTitles ? { findingTitles: alert.findingTitles } : {}),
      ...(alert.alternative ? { alternative: alert.alternative } : {}),
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
  if (filter === "attention") return alert.kind === "critical" || alert.kind === "review" || alert.kind === "failed" || alert.kind === "alternative";
  if (filter === "changes") return alert.kind === "improved" || alert.kind === "changed" || alert.kind === "baseline";
  return true;
}
