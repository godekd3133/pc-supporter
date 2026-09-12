import type { AccessoryItem, Part, RecommendationPreferences, SavedBuild, SavedBuildCheckSnapshot } from "./types";
import { buildTransferDiffFor, type BuildTransferDiffRow } from "./build-transfer-diff";
import { savedBuildCheckFindingDiffFor, savedBuildCheckTransitionSummaryFor } from "./saved-build-check";
import { savedBuildVersionLabelFor, savedBuildVersionNumberFor } from "./saved-build-version";
import { savedBuildVersionDeltaFor } from "./saved-build-version-delta";

export const SAVED_BUILD_VERSION_EXPORT_SCHEMA_VERSION = 1;

export type SavedBuildVersionComparisonInput = {
  before: SavedBuild;
  after: SavedBuild;
  partMap?: ReadonlyMap<string, Part>;
  accessoryMap?: ReadonlyMap<string, AccessoryItem>;
  fallbackPreferences: RecommendationPreferences;
};

export type SavedBuildVersionExportCheck = {
  status: SavedBuildCheckSnapshot["status"];
  blockerCount: number;
  warningCount: number;
  unknownCount: number;
  totalPriceWon: number;
  priceComplete: boolean;
  coreTotalPriceWon: number;
  corePriceComplete: boolean;
  accessoryTotalPriceWon: number;
  accessoryPriceComplete: boolean;
  accessoryCompatibility?: SavedBuildCheckSnapshot["accessoryCompatibility"];
  findings?: SavedBuildCheckSnapshot["findings"];
  analysisScore?: number;
  analysisScoreLabel: SavedBuildCheckSnapshot["analysisScoreLabel"];
  analysisConfidence: SavedBuildCheckSnapshot["analysisConfidence"];
  resourceBudget?: SavedBuildCheckSnapshot["resourceBudget"];
  benchmarkSnapshot?: SavedBuildCheckSnapshot["benchmarkSnapshot"];
  engineVersion: string;
  catalogSnapshotAt: string;
  checkedAt: string;
};

export type SavedBuildVersionExportBuild = {
  id: string;
  label: string;
  versionNumber: number;
  name: string;
  updatedAt: string;
  decisionNote?: string;
  check?: SavedBuildVersionExportCheck;
};

export type SavedBuildVersionComparisonExport = {
  schemaVersion: typeof SAVED_BUILD_VERSION_EXPORT_SCHEMA_VERSION;
  kind: "pc-supporter.saved-build-version-comparison";
  generatedAt: string;
  before: SavedBuildVersionExportBuild;
  after: SavedBuildVersionExportBuild;
  summary: {
    direction?: ReturnType<typeof savedBuildCheckTransitionSummaryFor>["direction"];
    selectionChangedCategoryCount: number;
    priceDeltaWon?: number;
    analysisScoreDelta?: number;
    resolvedFindingCount?: number;
    newFindingCount?: number;
    changedFindingCount?: number;
  };
  transition?: ReturnType<typeof savedBuildCheckTransitionSummaryFor>;
  changes: BuildTransferDiffRow[];
  findingChanges: ReturnType<typeof savedBuildCheckFindingDiffFor>["changes"];
  dataBoundary: string;
};

function checkSnapshotFor(build: SavedBuild) {
  return build.checkSnapshot ?? build.checkHistory?.at(-1);
}

function checkExportFor(snapshot: SavedBuildCheckSnapshot): SavedBuildVersionExportCheck {
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
    ...(snapshot.accessoryCompatibility ? { accessoryCompatibility: snapshot.accessoryCompatibility } : {}),
    ...(snapshot.findings ? { findings: snapshot.findings } : {}),
    ...(snapshot.analysisScore !== undefined ? { analysisScore: snapshot.analysisScore } : {}),
    analysisScoreLabel: snapshot.analysisScoreLabel,
    analysisConfidence: snapshot.analysisConfidence,
    ...(snapshot.resourceBudget ? { resourceBudget: snapshot.resourceBudget } : {}),
    ...(snapshot.benchmarkSnapshot ? { benchmarkSnapshot: snapshot.benchmarkSnapshot } : {}),
    engineVersion: snapshot.engineVersion,
    catalogSnapshotAt: snapshot.catalogSnapshotAt,
    checkedAt: snapshot.checkedAt
  };
}

function buildExportFor(build: SavedBuild): SavedBuildVersionExportBuild {
  const snapshot = checkSnapshotFor(build);
  return {
    id: build.id,
    label: savedBuildVersionLabelFor(build),
    versionNumber: savedBuildVersionNumberFor(build),
    name: build.name,
    updatedAt: build.updatedAt,
    ...(build.decisionNote ? { decisionNote: build.decisionNote } : {}),
    ...(snapshot ? { check: checkExportFor(snapshot) } : {})
  };
}

function priceText(value: number | undefined, complete: boolean | undefined) {
  return complete && value !== undefined ? `${value.toLocaleString("ko-KR")}원` : "가격 확인 필요";
}

function statusText(status: SavedBuildCheckSnapshot["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function directionText(direction: SavedBuildVersionComparisonExport["summary"]["direction"] | undefined) {
  return direction === "improved" ? "위험 감소" : direction === "regressed" ? "위험 증가" : direction === "changed" ? "일부 변경" : direction === "same" ? "변화 없음" : "검사 기준 없음";
}

function signed(value: number) {
  return value === 0 ? "변화 없음" : `${value > 0 ? "+" : ""}${value}`;
}

function findingChangeText(change: ReturnType<typeof savedBuildCheckFindingDiffFor>["changes"][number]) {
  const label = change.change === "resolved" ? "해결됨" : change.change === "new" ? "신규" : change.change === "severity_changed" ? "심각도 변경" : change.change === "details_changed" ? "내용 변경" : "변화 없음";
  return `${label}: ${(change.after ?? change.before)?.title ?? change.key}`;
}

export function savedBuildVersionComparisonExportFor(input: SavedBuildVersionComparisonInput, generatedAt = new Date().toISOString()): SavedBuildVersionComparisonExport {
  const beforeSnapshot = checkSnapshotFor(input.before);
  const afterSnapshot = checkSnapshotFor(input.after);
  const delta = savedBuildVersionDeltaFor(input.before, input.after);
  const transition = beforeSnapshot && afterSnapshot ? savedBuildCheckTransitionSummaryFor(beforeSnapshot, afterSnapshot) : undefined;
  const findingChanges = beforeSnapshot && afterSnapshot ? savedBuildCheckFindingDiffFor(beforeSnapshot, afterSnapshot).changes.filter((change) => change.change !== "unchanged") : [];
  const changes = buildTransferDiffFor(
    input.before.selection,
    input.before.recommendationPreferences ?? input.fallbackPreferences,
    input.after.selection,
    input.after.recommendationPreferences ?? input.fallbackPreferences,
    {
      partName: (partId) => input.partMap?.get(partId)?.name,
      accessoryName: (accessoryId) => input.accessoryMap?.get(accessoryId)?.name
    }
  ).rows;
  return {
    schemaVersion: SAVED_BUILD_VERSION_EXPORT_SCHEMA_VERSION,
    kind: "pc-supporter.saved-build-version-comparison",
    generatedAt,
    before: buildExportFor(input.before),
    after: buildExportFor(input.after),
    summary: {
      ...(transition ? { direction: transition.direction } : {}),
      selectionChangedCategoryCount: delta.selectionChangedCategoryCount,
      ...(transition?.priceDeltaWon !== undefined ? { priceDeltaWon: transition.priceDeltaWon } : {}),
      ...(transition?.analysisScoreDelta !== undefined ? { analysisScoreDelta: transition.analysisScoreDelta } : {}),
      ...(delta.resolvedFindingCount !== undefined ? { resolvedFindingCount: delta.resolvedFindingCount, newFindingCount: delta.newFindingCount, changedFindingCount: delta.changedFindingCount } : {})
    },
    ...(transition ? { transition } : {}),
    changes,
    findingChanges,
    dataBoundary: "저장된 두 버전의 선택·검사 snapshot 비교입니다. 실제 판매가·재고·FPS·제조사 QVL·물리 장착·케이블 배선은 별도로 확인해야 합니다."
  };
}

export function savedBuildVersionComparisonTextFor(input: SavedBuildVersionComparisonInput, generatedAt = new Date().toISOString()) {
  const exported = savedBuildVersionComparisonExportFor(input, generatedAt);
  const before = exported.before;
  const after = exported.after;
  const beforeCheck = before.check;
  const afterCheck = after.check;
  const transition = exported.transition;
  const lines = [
    "PC Supporter 저장 견적 버전 비교",
    "================================",
    `생성 시각: ${generatedAt}`,
    `비교: ${before.label} ${before.name} → ${after.label} ${after.name}`,
    `결과 방향: ${directionText(exported.summary.direction)}`,
    "",
    "[구성 변경]",
    `변경 범주: ${exported.summary.selectionChangedCategoryCount}개`,
    ...(exported.changes.length > 0 ? exported.changes.map((row) => `- ${row.label}: ${row.before} → ${row.after}`) : ["- 변경 부품 없음"]),
    "",
    "[검사 snapshot]",
    ...(beforeCheck && afterCheck ? [
      `판정: ${statusText(beforeCheck.status)} → ${statusText(afterCheck.status)}`,
      `위험: 차단 ${beforeCheck.blockerCount} → ${afterCheck.blockerCount} · 주의 ${beforeCheck.warningCount} → ${afterCheck.warningCount} · 확인 필요 ${beforeCheck.unknownCount} → ${afterCheck.unknownCount}`,
      `위험 변화: 차단 ${signed(transition?.blockerDelta ?? 0)} · 주의 ${signed(transition?.warningDelta ?? 0)} · 확인 필요 ${signed(transition?.unknownDelta ?? 0)}`,
      `구매 금액: ${priceText(beforeCheck.totalPriceWon, beforeCheck.priceComplete)} → ${priceText(afterCheck.totalPriceWon, afterCheck.priceComplete)}${transition?.priceDeltaWon !== undefined ? ` · ${transition.priceDeltaWon === 0 ? "변화 없음" : `${transition.priceDeltaWon > 0 ? "+" : ""}${transition.priceDeltaWon.toLocaleString("ko-KR")}원`}` : ""}`,
      `성능 분석: ${beforeCheck.analysisScore !== undefined ? `${beforeCheck.analysisScore}점 · ` : ""}${beforeCheck.analysisScoreLabel} → ${afterCheck.analysisScore !== undefined ? `${afterCheck.analysisScore}점 · ` : ""}${afterCheck.analysisScoreLabel}`,
      `finding 변화: 해결 ${transition?.resolvedFindingCount ?? 0}개 · 신규 ${transition?.newFindingCount ?? 0}개 · 변경 ${((transition?.severityChangedFindingCount ?? 0) + (transition?.detailsChangedFindingCount ?? 0))}개`
    ] : ["- 저장된 검사 snapshot이 한쪽 이상 없어 전체 검사 비교를 계산할 수 없습니다."]),
    "",
    "[변경된 호환성 판정]",
    ...(exported.findingChanges.length > 0 ? exported.findingChanges.map(findingChangeText).map((line) => `- ${line}`) : ["- finding 변화 없음 또는 snapshot 없음"]),
    "",
    "[선택 이유]",
    `${before.label}: ${before.decisionNote ?? "메모 없음"}`,
    `${after.label}: ${after.decisionNote ?? "메모 없음"}`,
    "",
    "[데이터 경계]",
    exported.dataBoundary
  ];
  return lines.join("\n");
}
