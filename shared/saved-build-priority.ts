import { savedBuildCheckTransitionSummaryFor } from "./saved-build-check";
import type { SavedBuildCheckTransitionSummary } from "./saved-build-check";
import type { SavedBuildMonitorItem } from "./saved-build-monitor";
import type { SavedBuildCheckFindingSummary, SavedBuildCheckSnapshot, SavedBuild } from "./types";

export type SavedBuildPriorityLevel = "critical" | "review" | "failed" | "changed" | "baseline" | "stable";
export type SavedBuildPriorityFilter = "all" | "attention" | "changed" | "stable";

export interface SavedBuildRiskPoint {
  checkedAt: string;
  riskScore: number;
  blockerCount: number;
  warningCount: number;
  unknownCount: number;
  priceComplete: boolean;
  totalPriceWon: number;
}

export interface SavedBuildPriorityRow {
  id: string;
  name: string;
  level: SavedBuildPriorityLevel;
  label: string;
  priorityRank: number;
  status?: SavedBuildCheckSnapshot["status"];
  snapshot?: SavedBuildCheckSnapshot;
  previousSnapshot?: SavedBuildCheckSnapshot;
  transition?: SavedBuildCheckTransitionSummary;
  riskScore?: number;
  riskDelta?: number;
  priceDeltaWon?: number;
  priceComplete: boolean;
  lastCheckedAt?: string;
  primaryFinding?: SavedBuildCheckFindingSummary;
  trend: SavedBuildRiskPoint[];
}

export interface SavedBuildPriorityInput {
  id: string;
  name: string;
  checkSnapshot?: SavedBuild["checkSnapshot"];
  checkHistory?: SavedBuild["checkHistory"];
  current?: SavedBuildMonitorItem;
  serverSnapshot?: SavedBuildCheckSnapshot;
}

const levelRank: Record<SavedBuildPriorityLevel, number> = {
  critical: 0,
  failed: 0,
  review: 1,
  changed: 2,
  baseline: 3,
  stable: 4
};

const levelLabels: Record<SavedBuildPriorityLevel, string> = {
  critical: "즉시 확인",
  failed: "점검 실패",
  review: "검토 필요",
  changed: "변화 감지",
  baseline: "첫 기준",
  stable: "안정"
};

function isSnapshot(value: SavedBuildCheckSnapshot | undefined): value is SavedBuildCheckSnapshot {
  return value !== undefined && typeof value.checkedAt === "string";
}

export function savedBuildRiskScoreFor(snapshot: SavedBuildCheckSnapshot) {
  const accessory = snapshot.accessoryCompatibility;
  return snapshot.blockerCount * 100 + snapshot.warningCount * 10 + snapshot.unknownCount
    + (accessory?.blockerCount ?? 0) * 100
    + (accessory?.warningCount ?? 0) * 10
    + (accessory?.unknownCount ?? 0);
}

function snapshotsFor(input: SavedBuildPriorityInput) {
  const byCheckedAt = new Map<string, SavedBuildCheckSnapshot>();
  for (const snapshot of input.checkHistory ?? []) if (isSnapshot(snapshot)) byCheckedAt.set(snapshot.checkedAt, snapshot);
  if (isSnapshot(input.checkSnapshot)) byCheckedAt.set(input.checkSnapshot.checkedAt, input.checkSnapshot);
  if (input.current?.status === "ready" && isSnapshot(input.current.snapshot)) byCheckedAt.set(input.current.snapshot.checkedAt, input.current.snapshot);
  if (isSnapshot(input.serverSnapshot)) byCheckedAt.set(input.serverSnapshot.checkedAt, input.serverSnapshot);
  return [...byCheckedAt.values()].sort((left, right) => Date.parse(left.checkedAt) - Date.parse(right.checkedAt));
}

function primaryFindingFor(snapshot: SavedBuildCheckSnapshot | undefined) {
  if (!snapshot?.findings || snapshot.findings.length === 0) return undefined;
  const severityRank: Record<SavedBuildCheckFindingSummary["severity"], number> = { blocker: 0, warning: 1, unknown: 2, info: 3 };
  return snapshot.findings.slice().sort((left, right) => severityRank[left.severity] - severityRank[right.severity])[0];
}

function snapshotPointFor(snapshot: SavedBuildCheckSnapshot): SavedBuildRiskPoint {
  return {
    checkedAt: snapshot.checkedAt,
    riskScore: savedBuildRiskScoreFor(snapshot),
    blockerCount: snapshot.blockerCount,
    warningCount: snapshot.warningCount,
    unknownCount: snapshot.unknownCount,
    priceComplete: snapshot.priceComplete,
    totalPriceWon: snapshot.totalPriceWon
  };
}

function levelFor(snapshot: SavedBuildCheckSnapshot | undefined, current: SavedBuildMonitorItem | undefined, transition: SavedBuildCheckTransitionSummary | undefined, historyLength: number): SavedBuildPriorityLevel {
  if (current && current.status !== "ready") return "failed";
  if (!snapshot) return "failed";
  if (snapshot.status === "incompatible" || snapshot.blockerCount > 0 || (snapshot.accessoryCompatibility?.blockerCount ?? 0) > 0) return "critical";
  if (snapshot.status === "needs_review" || snapshot.warningCount > 0 || snapshot.unknownCount > 0 || (snapshot.accessoryCompatibility?.warningCount ?? 0) > 0 || (snapshot.accessoryCompatibility?.unknownCount ?? 0) > 0) return "review";
  if (transition?.hasChanges) return "changed";
  return historyLength < 2 ? "baseline" : "stable";
}

function priorityLabelFor(level: SavedBuildPriorityLevel) {
  return levelLabels[level];
}

export function savedBuildPriorityRowsFor(inputs: SavedBuildPriorityInput[]): SavedBuildPriorityRow[] {
  return inputs.map((input) => {
    const snapshots = snapshotsFor(input);
    const snapshot = snapshots.at(-1);
    const previousSnapshot = snapshots.at(-2);
    const transition = input.current?.status === "ready" && snapshot?.checkedAt === input.current.snapshot.checkedAt
      ? input.current.transition
      : snapshot && previousSnapshot
        ? savedBuildCheckTransitionSummaryFor(previousSnapshot, snapshot)
        : undefined;
    const level = levelFor(snapshot, input.current, transition, snapshots.length);
    const trend = snapshots.slice(-20).map(snapshotPointFor);
    const riskScore = snapshot ? savedBuildRiskScoreFor(snapshot) : undefined;
    const previousRiskScore = previousSnapshot ? savedBuildRiskScoreFor(previousSnapshot) : undefined;
    const priceDeltaWon = snapshot && previousSnapshot && snapshot.priceComplete && previousSnapshot.priceComplete
      ? snapshot.totalPriceWon - previousSnapshot.totalPriceWon
      : undefined;
    return {
      id: input.id,
      name: input.name,
      level,
      label: priorityLabelFor(level),
      priorityRank: levelRank[level],
      ...(snapshot ? { status: snapshot.status, snapshot } : {}),
      ...(previousSnapshot ? { previousSnapshot } : {}),
      ...(transition ? { transition } : {}),
      ...(riskScore !== undefined ? { riskScore } : {}),
      ...(riskScore !== undefined && previousRiskScore !== undefined ? { riskDelta: riskScore - previousRiskScore } : {}),
      ...(priceDeltaWon !== undefined ? { priceDeltaWon } : {}),
      priceComplete: snapshot?.priceComplete ?? false,
      ...(snapshot ? { lastCheckedAt: snapshot.checkedAt } : {}),
      ...(primaryFindingFor(snapshot) ? { primaryFinding: primaryFindingFor(snapshot) } : {}),
      trend
    } satisfies SavedBuildPriorityRow;
  }).sort((left, right) => left.priorityRank - right.priorityRank
    || (right.riskScore ?? -1) - (left.riskScore ?? -1)
    || Date.parse(right.lastCheckedAt ?? "") - Date.parse(left.lastCheckedAt ?? "")
    || left.name.localeCompare(right.name));
}

export function savedBuildPriorityMatches(row: SavedBuildPriorityRow, filter: SavedBuildPriorityFilter) {
  if (filter === "all") return true;
  if (filter === "attention") return row.level === "critical" || row.level === "review" || row.level === "failed";
  if (filter === "changed") return row.level === "changed";
  return row.level === "stable" || row.level === "baseline";
}
