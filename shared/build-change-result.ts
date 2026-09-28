import type { CompatibilityResult } from "./types";
import type { BuildTransferDiffRow } from "./build-transfer-diff";
import { savedBuildCheckFindingDiffFor, savedBuildCheckSnapshotFor, savedBuildCheckTransitionSummaryFor } from "./saved-build-check";
import type { SavedBuildCheckFindingChange } from "./saved-build-check";

export const BUILD_CHANGE_RESULT_EXPORT_SCHEMA_VERSION = 1;

export type BuildChangeResultComparison = {
  title: string;
  summary: string;
  rows: BuildTransferDiffRow[];
  beforeResult: CompatibilityResult;
  afterResult: CompatibilityResult;
};

type BuildChangeResultSnapshotExport = {
  status: CompatibilityResult["status"];
  blockerCount: number;
  warningCount: number;
  unknownCount: number;
  totalPriceWon: number;
  priceComplete: boolean;
  coreTotalPriceWon: number;
  corePriceComplete: boolean;
  accessoryTotalPriceWon: number;
  accessoryPriceComplete: boolean;
  resourceBudget?: ReturnType<typeof savedBuildCheckSnapshotFor>["resourceBudget"];
  engineVersion: string;
  catalogSnapshotAt: string;
  checkedAt: string;
};

type BuildChangeResultFindingExport = {
  key: string;
  change: SavedBuildCheckFindingChange;
  before?: { ruleId: string; title: string; severity: string };
  after?: { ruleId: string; title: string; severity: string };
};

export type BuildChangeResultExport = {
  schemaVersion: typeof BUILD_CHANGE_RESULT_EXPORT_SCHEMA_VERSION;
  kind: "pc-supporter.build-change-result";
  generatedAt: string;
  title: string;
  summary: string;
  direction: ReturnType<typeof savedBuildCheckTransitionSummaryFor>["direction"];
  before: BuildChangeResultSnapshotExport;
  after: BuildChangeResultSnapshotExport;
  deltas: {
    statusChanged: boolean;
    blockerDelta: number;
    warningDelta: number;
    unknownDelta: number;
    priceDeltaWon?: number;
    priceCompletenessChanged: boolean;
    resourceBudgetChanged: boolean;
    resourceRiskIncreased: boolean;
    resourceRiskDecreased: boolean;
  };
  changes: BuildTransferDiffRow[];
  findingChanges: BuildChangeResultFindingExport[];
};

function resultSnapshotFor(result: CompatibilityResult): BuildChangeResultSnapshotExport {
  const snapshot = savedBuildCheckSnapshotFor(result);
  return {
    status: snapshot.status,
    blockerCount: snapshot.blockerCount,
    warningCount: snapshot.warningCount,
    unknownCount: snapshot.unknownCount,
    totalPriceWon: snapshot.totalPriceWon,
    priceComplete: snapshot.priceComplete,
    coreTotalPriceWon: snapshot.coreTotalPriceWon,
    corePriceComplete: snapshot.corePriceComplete,
    accessoryTotalPriceWon: snapshot.accessoryTotalPriceWon,
    accessoryPriceComplete: snapshot.accessoryPriceComplete,
    ...(snapshot.resourceBudget ? { resourceBudget: snapshot.resourceBudget } : {}),
    engineVersion: snapshot.engineVersion,
    catalogSnapshotAt: snapshot.catalogSnapshotAt,
    checkedAt: snapshot.checkedAt
  };
}

function findingSummaryFor(finding: { ruleId: string; title: string; severity: string }) {
  return { ruleId: finding.ruleId, title: finding.title, severity: finding.severity };
}

export function buildChangeResultExportFor(comparison: BuildChangeResultComparison, generatedAt = new Date().toISOString()): BuildChangeResultExport {
  const before = savedBuildCheckSnapshotFor(comparison.beforeResult);
  const after = savedBuildCheckSnapshotFor(comparison.afterResult);
  const transition = savedBuildCheckTransitionSummaryFor(before, after);
  const findingDiff = savedBuildCheckFindingDiffFor(before, after);
  return {
    schemaVersion: BUILD_CHANGE_RESULT_EXPORT_SCHEMA_VERSION,
    kind: "pc-supporter.build-change-result",
    generatedAt,
    title: comparison.title,
    summary: comparison.summary,
    direction: transition.direction,
    before: resultSnapshotFor(comparison.beforeResult),
    after: resultSnapshotFor(comparison.afterResult),
    deltas: {
      statusChanged: transition.statusChanged,
      blockerDelta: transition.blockerDelta,
      warningDelta: transition.warningDelta,
      unknownDelta: transition.unknownDelta,
      ...(transition.priceDeltaWon !== undefined ? { priceDeltaWon: transition.priceDeltaWon } : {}),
      priceCompletenessChanged: transition.priceCompletenessChanged,
      resourceBudgetChanged: transition.resourceBudgetChanged,
      resourceRiskIncreased: transition.resourceRiskIncreased,
      resourceRiskDecreased: transition.resourceRiskDecreased
    },
    changes: comparison.rows.map((row) => ({ ...row })),
    findingChanges: findingDiff.changes
      .filter((change) => change.change !== "unchanged")
      .map((change) => ({
        key: change.key,
        change: change.change,
        ...(change.before ? { before: findingSummaryFor(change.before) } : {}),
        ...(change.after ? { after: findingSummaryFor(change.after) } : {})
      }))
  };
}

function statusLabel(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function directionLabel(direction: BuildChangeResultExport["direction"]) {
  return direction === "improved" ? "호환 상태 개선" : direction === "regressed" ? "호환 문제가 늘었어요" : direction === "changed" ? "일부 변경" : "변화 없음";
}

function priceText(snapshot: BuildChangeResultSnapshotExport) {
  return snapshot.priceComplete ? `${snapshot.totalPriceWon.toLocaleString("ko-KR")}원` : "가격 확인 필요";
}

function signed(value: number) {
  return value === 0 ? "변화 없음" : `${value > 0 ? "+" : ""}${value}`;
}

function findingChangeLabel(change: SavedBuildCheckFindingChange) {
  return change === "resolved" ? "해결됨" : change === "new" ? "신규" : change === "severity_changed" ? "중요도 변경" : "내용 변경";
}

export function buildChangeResultTextFor(comparison: BuildChangeResultComparison, generatedAt = new Date().toISOString()) {
  const exported = buildChangeResultExportFor(comparison, generatedAt);
  const before = exported.before;
  const after = exported.after;
  const lines = [
    "PC Supporter 부품 변경 결과",
    "================================",
    `생성 시각: ${generatedAt}`,
    `적용: ${exported.title}`,
    `설명: ${exported.summary}`,
    `변경 내용: ${directionLabel(exported.direction)}`,
    "",
    "[적용 전 → 적용 후]",
    `결과: ${statusLabel(before.status)} → ${statusLabel(after.status)}`,
    `호환 상태: 호환 불가 ${before.blockerCount} → ${after.blockerCount} · 주의 ${before.warningCount} → ${after.warningCount} · 확인 필요 ${before.unknownCount} → ${after.unknownCount}`,
    `호환 상태 변화: 호환 불가 ${signed(exported.deltas.blockerDelta)} · 주의 ${signed(exported.deltas.warningDelta)} · 확인 필요 ${signed(exported.deltas.unknownDelta)}`,
    `구매 금액: ${priceText(before)} → ${priceText(after)}${exported.deltas.priceDeltaWon !== undefined ? ` · ${exported.deltas.priceDeltaWon === 0 ? "변화 없음" : `${exported.deltas.priceDeltaWon > 0 ? "+" : ""}${exported.deltas.priceDeltaWon.toLocaleString("ko-KR")}원`}` : ""}`,
    `전력·냉각 여유 변경: ${exported.deltas.resourceBudgetChanged ? "변경됨" : "변화 없음"}`,
    "",
    "[변경 부품]",
    ...(exported.changes.length > 0 ? exported.changes.map((row) => `- ${row.label}: ${row.before} → ${row.after}`) : ["- 변경 부품 없음"]),
    "",
    "[변경된 호환성 결과]",
    ...(exported.findingChanges.length > 0 ? exported.findingChanges.map((finding) => `- ${findingChangeLabel(finding.change)}: ${(finding.after ?? finding.before)?.title ?? finding.key}`) : ["- 항목 변화 없음"]),
    "",
    "[구매 전 확인]",
    "실제 판매가와 재고는 판매처에서 확인하세요. 게임 성능은 게임과 설정에 따라 달라집니다. 메모리 호환성·케이스 장착 공간·케이블 연결은 구매 전에 확인하세요."
  ];
  return lines.join("\n");
}

export function buildChangeResultDecisionNoteFor(comparison: BuildChangeResultComparison) {
  const exported = buildChangeResultExportFor(comparison);
  const after = exported.after;
  const price = exported.deltas.priceDeltaWon === undefined
    ? "가격 확인 필요"
    : `${exported.deltas.priceDeltaWon > 0 ? "+" : ""}${exported.deltas.priceDeltaWon.toLocaleString("ko-KR")}원`;
  return `적용 후 결과 · ${comparison.title} · ${directionLabel(exported.direction)} · 호환 ${statusLabel(after.status)} · 호환 불가 ${after.blockerCount} · 주의 ${after.warningCount} · 확인 ${after.unknownCount} · 금액 ${price} · 확인한 때 ${after.checkedAt}`;
}
