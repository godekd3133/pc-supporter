import { benchmarkEvidenceForPart } from "./benchmark-evidence";
import { physicalSourceCheckNeedsReview } from "./physical-source-check";
import type { AlternativeComparisonBenchmarkEvidence, AlternativeComparisonCandidate } from "./alternative-comparison-export";
import type { BenchmarkEvidencePart } from "./benchmark-evidence";
import type { BenchmarkScoreKey, Part } from "./types";

export type AlternativeComparisonBenchmarkRecheckStatus = "not_recorded" | "current_unavailable" | "current_missing" | "current_incomplete" | "changed" | "needs_review" | "same";
export type AlternativeComparisonBenchmarkDecisionImpact = "stable" | "changed" | "unverified" | "not_recorded";

export interface AlternativeComparisonBenchmarkRecheckRow {
  key: BenchmarkScoreKey;
  label: string;
  sharedValue?: number;
  currentValue?: number;
  delta?: number;
  changed: boolean;
}

export interface AlternativeComparisonBenchmarkRecheck {
  status: AlternativeComparisonBenchmarkRecheckStatus;
  benchmarkDecisionImpact: AlternativeComparisonBenchmarkDecisionImpact;
  currentStatus?: BenchmarkEvidencePart["status"];
  rows: AlternativeComparisonBenchmarkRecheckRow[];
  changedRowCount: number;
  sourceChanged: boolean;
  benchmarkDateChanged: boolean;
  sourceCheckNeedsReview: boolean;
  freshnessNeedsReview: boolean;
  needsRecheck: boolean;
}

function benchmarkDecisionImpactFor(status: AlternativeComparisonBenchmarkRecheckStatus): AlternativeComparisonBenchmarkDecisionImpact {
  return status === "same" ? "stable" : status === "changed" ? "changed" : status === "not_recorded" ? "not_recorded" : "unverified";
}

function rowsForUnavailable(snapshot: AlternativeComparisonBenchmarkEvidence): AlternativeComparisonBenchmarkRecheckRow[] {
  return snapshot.rows.map((row) => ({ key: row.key, label: row.label, ...(row.value !== undefined ? { sharedValue: row.value } : {}), changed: false }));
}

function normalizedSourceUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).toString();
  } catch {
    return trimmed;
  }
}

function sourceChangedFor(shared: AlternativeComparisonBenchmarkEvidence["provenance"], current: BenchmarkEvidencePart["provenance"]) {
  return shared?.sourceKind !== current?.sourceKind
    || shared?.sourceNote !== current?.sourceNote
    || normalizedSourceUrl(shared?.sourceUrl) !== normalizedSourceUrl(current?.sourceUrl);
}

function currentEvidenceStatusFor(current: BenchmarkEvidencePart): "current_missing" | "current_incomplete" | undefined {
  return current.status === "missing" ? "current_missing" : current.status === "partial" ? "current_incomplete" : undefined;
}

function statusFor({ snapshot, current, rows, sourceChanged, benchmarkDateChanged, sourceCheckNeedsReview, freshnessNeedsReview }: { snapshot: AlternativeComparisonBenchmarkEvidence; current: BenchmarkEvidencePart; rows: AlternativeComparisonBenchmarkRecheckRow[]; sourceChanged: boolean; benchmarkDateChanged: boolean; sourceCheckNeedsReview: boolean; freshnessNeedsReview: boolean }): AlternativeComparisonBenchmarkRecheckStatus {
  const changedRowCount = rows.filter((row) => row.changed).length;
  const currentStatus = currentEvidenceStatusFor(current);
  if (currentStatus) return currentStatus;
  if (changedRowCount > 0 || sourceChanged || benchmarkDateChanged) return "changed";
  if (sourceCheckNeedsReview || freshnessNeedsReview) return "needs_review";
  return snapshot.status === "complete" && current.status === "complete" ? "same" : "needs_review";
}

export function alternativeComparisonBenchmarkRecheckFor(candidate: AlternativeComparisonCandidate, currentPart: Part | undefined, now: string | number = Date.now()): AlternativeComparisonBenchmarkRecheck {
  const snapshot = candidate.benchmarkEvidence;
  if (!snapshot) return { status: "not_recorded", benchmarkDecisionImpact: "not_recorded", rows: [], changedRowCount: 0, sourceChanged: false, benchmarkDateChanged: false, sourceCheckNeedsReview: false, freshnessNeedsReview: false, needsRecheck: false };
  if (!currentPart || currentPart.category !== snapshot.category) return { status: "current_unavailable", benchmarkDecisionImpact: "unverified", rows: rowsForUnavailable(snapshot), changedRowCount: 0, sourceChanged: false, benchmarkDateChanged: false, sourceCheckNeedsReview: false, freshnessNeedsReview: false, needsRecheck: true };

  const current = benchmarkEvidenceForPart(currentPart, now);
  if (!current) return { status: "current_unavailable", benchmarkDecisionImpact: "unverified", rows: rowsForUnavailable(snapshot), changedRowCount: 0, sourceChanged: false, benchmarkDateChanged: false, sourceCheckNeedsReview: false, freshnessNeedsReview: false, needsRecheck: true };

  const currentRows = new Map(current.rows.map((row) => [row.key, row]));
  const rows = snapshot.rows.map((sharedRow) => {
    const currentRow = currentRows.get(sharedRow.key);
    const sharedValue = sharedRow.value;
    const currentValue = currentRow?.value;
    const changed = sharedValue !== currentValue;
    const delta = sharedValue !== undefined && currentValue !== undefined ? currentValue - sharedValue : undefined;
    return { key: sharedRow.key, label: sharedRow.label, ...(sharedValue !== undefined ? { sharedValue } : {}), ...(currentValue !== undefined ? { currentValue } : {}), ...(delta !== undefined ? { delta } : {}), changed };
  });
  const sourceChanged = sourceChangedFor(snapshot.provenance, current.provenance);
  const benchmarkDateChanged = snapshot.dataUpdatedAt !== current.dataUpdatedAt || snapshot.provenance?.updatedAt !== current.provenance?.updatedAt;
  const sourceCheckNeedsReview = Boolean(current.provenance?.sourceUrl) && physicalSourceCheckNeedsReview(current.sourceCheck, true, now);
  const freshnessNeedsReview = current.benchmarkFreshness === "aging" || current.benchmarkFreshness === "stale" || current.benchmarkFreshness === "unknown";
  const status = statusFor({ snapshot, current, rows, sourceChanged, benchmarkDateChanged, sourceCheckNeedsReview, freshnessNeedsReview });
  return { status, benchmarkDecisionImpact: benchmarkDecisionImpactFor(status), currentStatus: current.status, rows, changedRowCount: rows.filter((row) => row.changed).length, sourceChanged, benchmarkDateChanged, sourceCheckNeedsReview, freshnessNeedsReview, needsRecheck: status !== "same" };
}

export function alternativeComparisonBenchmarkRecheckStatusText(status: AlternativeComparisonBenchmarkRecheckStatus) {
  return status === "same" ? "공유 당시와 동일" : status === "changed" ? "benchmark 변경" : status === "current_missing" ? "현재 점수 없음" : status === "current_incomplete" ? "현재 점수 일부" : status === "needs_review" ? "benchmark 재확인 필요" : status === "current_unavailable" ? "현재 근거 확인 불가" : "공유 당시 기록 없음";
}

export function alternativeComparisonBenchmarkDecisionImpactText(impact: AlternativeComparisonBenchmarkDecisionImpact) {
  return impact === "stable" ? "benchmark 판단 영향 없음" : impact === "changed" ? "추천 성능 판단 재검토" : impact === "unverified" ? "추천 성능 판단 확인 필요" : "benchmark 판단 근거 없음";
}

export function alternativeComparisonBenchmarkRecheckRowText(row: AlternativeComparisonBenchmarkRecheckRow) {
  const shared = row.sharedValue === undefined ? "없음" : `${row.sharedValue.toLocaleString("ko-KR")}점`;
  const current = row.currentValue === undefined ? "확인 필요" : `${row.currentValue.toLocaleString("ko-KR")}점`;
  const delta = row.delta === undefined ? "" : ` (${row.delta > 0 ? "+" : ""}${row.delta.toLocaleString("ko-KR")}점)`;
  return `${row.label} · 공유 ${shared} → 현재 ${current}${delta}`;
}
