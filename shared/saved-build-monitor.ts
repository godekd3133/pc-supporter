import type { SavedBuildCheckTransitionSummary } from "./saved-build-check";
import type { SavedBuildCheckSnapshot } from "./types";

export const SAVED_BUILD_MONITOR_LIMIT = 20;

export type SavedBuildMonitorReadyItem = {
  id: string;
  status: "ready";
  snapshot: SavedBuildCheckSnapshot;
  transition?: SavedBuildCheckTransitionSummary;
};

export type SavedBuildMonitorFailedItem = {
  id: string;
  status: "not_found" | "error";
  message: string;
};

export type SavedBuildMonitorItem = SavedBuildMonitorReadyItem | SavedBuildMonitorFailedItem;

export interface SavedBuildMonitorResponse {
  requestedCount: number;
  checkedCount: number;
  checkedAt: string;
  items: SavedBuildMonitorItem[];
}

export type SavedBuildMonitorLevel = "critical" | "review" | "improved" | "changed" | "baseline" | "stable";

export interface SavedBuildMonitorAssessment {
  level: SavedBuildMonitorLevel;
  label: string;
  summary: string;
  requiresAttention: boolean;
  recordRecommended: boolean;
}

function riskCountsText(snapshot: SavedBuildCheckSnapshot) {
  const base = `호환 불가 ${snapshot.blockerCount}개 · 주의 ${snapshot.warningCount}개 · 확인 필요 ${snapshot.unknownCount}개`;
  const accessory = snapshot.accessoryCompatibility;
  const withAccessory = !accessory || (accessory.blockerCount === 0 && accessory.warningCount === 0 && accessory.unknownCount === 0)
    ? base
    : `${base} · 주변 부품 호환 불가 ${accessory.blockerCount}개 · 주의 ${accessory.warningCount}개 · 확인 필요 ${accessory.unknownCount}개`;
  const resourceState = snapshot.resourceBudget?.state;
  if (resourceState === "danger") return `${withAccessory} · 전력·냉각 예산 기준 미달`;
  if (resourceState === "warning") return `${withAccessory} · 전력·냉각 여유 좁음`;
  if (resourceState === "unknown") return `${withAccessory} · 전력·냉각 수치 확인 필요`;
  return withAccessory;
}

function riskDeltaText(transition: SavedBuildCheckTransitionSummary) {
  const values = [
    transition.blockerDelta !== 0 ? `호환 불가 ${transition.blockerDelta > 0 ? "+" : ""}${transition.blockerDelta}` : undefined,
    transition.warningDelta !== 0 ? `주의 ${transition.warningDelta > 0 ? "+" : ""}${transition.warningDelta}` : undefined,
    transition.unknownDelta !== 0 ? `확인 필요 ${transition.unknownDelta > 0 ? "+" : ""}${transition.unknownDelta}` : undefined,
    transition.accessoryBlockerDelta !== 0 ? `주변 부품 호환 불가 ${transition.accessoryBlockerDelta > 0 ? "+" : ""}${transition.accessoryBlockerDelta}` : undefined,
    transition.accessoryWarningDelta !== 0 ? `주변 주의 ${transition.accessoryWarningDelta > 0 ? "+" : ""}${transition.accessoryWarningDelta}` : undefined,
    transition.accessoryUnknownDelta !== 0 ? `주변 확인 필요 ${transition.accessoryUnknownDelta > 0 ? "+" : ""}${transition.accessoryUnknownDelta}` : undefined,
    transition.powerHeadroomDeltaW !== undefined ? `전력 여유 ${transition.powerHeadroomDeltaW > 0 ? "+" : ""}${transition.powerHeadroomDeltaW}W` : undefined,
    transition.coolerHeadroomDeltaW !== undefined ? `냉각 여유 ${transition.coolerHeadroomDeltaW > 0 ? "+" : ""}${transition.coolerHeadroomDeltaW}W` : undefined,
    transition.resourceBudgetChanged && transition.powerHeadroomDeltaW === undefined && transition.coolerHeadroomDeltaW === undefined ? "전력·냉각 예산 상태" : undefined
  ].filter((value): value is string => Boolean(value));
  return values.join(" · ");
}

function analysisDeltaText(transition: SavedBuildCheckTransitionSummary) {
  if (!transition.analysisChanged) return undefined;
  if (transition.analysisScoreDelta === undefined) return "성능 비교 정보를 다시 확인했어요.";
  if (transition.analysisScoreDelta === 0) return "성능 비교 내용 변경";
  return "성능 비교 결과가 달라졌어요.";
}

export function savedBuildMonitorAssessmentFor(snapshot: SavedBuildCheckSnapshot, transition?: SavedBuildCheckTransitionSummary): SavedBuildMonitorAssessment {
  const accessory = snapshot.accessoryCompatibility;
  const riskIncreased = Boolean(transition && (transition.blockerDelta > 0 || transition.warningDelta > 0 || transition.unknownDelta > 0 || transition.accessoryBlockerDelta > 0 || transition.accessoryWarningDelta > 0 || transition.accessoryUnknownDelta > 0 || transition.resourceRiskIncreased));
  const riskDecreased = Boolean(transition && (transition.blockerDelta < 0 || transition.warningDelta < 0 || transition.unknownDelta < 0 || transition.accessoryBlockerDelta < 0 || transition.accessoryWarningDelta < 0 || transition.accessoryUnknownDelta < 0 || transition.resourceRiskDecreased));
  const deltaText = transition ? riskDeltaText(transition) : "";
  const analysisText = transition ? analysisDeltaText(transition) : undefined;
  const transitionDeltaText = [deltaText || undefined, analysisText].filter((value): value is string => Boolean(value)).join(" · ");

  if (snapshot.status === "incompatible" || snapshot.blockerCount > 0 || (accessory?.blockerCount ?? 0) > 0 || snapshot.resourceBudget?.state === "danger") {
    return {
      level: "critical",
      label: riskIncreased ? "호환 문제 증가" : "구매 전 확인 필요",
      summary: `${riskCountsText(snapshot)}${transitionDeltaText ? ` · 마지막 기록 대비 ${transitionDeltaText}` : ""}`,
      requiresAttention: true,
      recordRecommended: !transition || transition.hasChanges
    };
  }

  if (snapshot.status === "needs_review" || snapshot.unknownCount > 0 || riskIncreased || snapshot.warningCount > 0 || (accessory?.unknownCount ?? 0) > 0 || (accessory?.warningCount ?? 0) > 0 || snapshot.resourceBudget?.state === "warning" || snapshot.resourceBudget?.state === "unknown") {
    return {
      level: "review",
      label: riskIncreased ? "확인할 항목 증가" : "확인 필요",
      summary: `${riskCountsText(snapshot)}${transitionDeltaText ? ` · 마지막 기록 대비 ${transitionDeltaText}` : ""}`,
      requiresAttention: true,
      recordRecommended: !transition || transition.hasChanges
    };
  }

  if (!transition) {
    return {
      level: "baseline",
      label: "첫 기록이 필요해요",
      summary: "현재 상태는 괜찮지만 이전 기록이 없어 변화를 비교할 수 없어요.",
      requiresAttention: false,
      recordRecommended: true
    };
  }

  if (transition.direction === "improved" || (riskDecreased && !riskIncreased)) {
    return {
      level: "improved",
      label: "상태 개선",
      summary: `${transitionDeltaText ? `마지막 기록 대비 ${transitionDeltaText}` : "호환 상태가 나아졌어요."}`,
      requiresAttention: false,
      recordRecommended: true
    };
  }

  if (transition.hasChanges) {
    const changedReasons = [
      transition.priceDeltaWon !== undefined && transition.priceDeltaWon !== 0 ? "가격" : undefined,
      transition.priceCompletenessChanged ? "가격 확인 상태" : undefined,
      analysisText,
      transition.catalogChanged ? "부품 정보 확인 시점" : undefined,
      transition.engineChanged ? "결과 계산 방식" : undefined,
      transition.resourceBudgetChanged ? "전력·냉각 예산" : undefined,
      transition.newFindingCount > 0 || transition.resolvedFindingCount > 0 || transition.severityChangedFindingCount > 0 || transition.detailsChangedFindingCount > 0 ? "결과 상세" : undefined
    ].filter((value): value is string => Boolean(value));
    return {
      level: "changed",
      label: "가격·부품 정보 변경",
      summary: changedReasons.length > 0 ? `${changedReasons.join(" · ")} 내용이 바뀌었어요.` : "저장된 결과와 현재 정보가 달라졌어요.",
      requiresAttention: false,
      recordRecommended: true
    };
  }

  return {
    level: "stable",
    label: "현재 상태 안정",
      summary: "마지막 기록과 호환 결과·가격·성능 점수·전력·냉각 상태가 같습니다.",
    requiresAttention: false,
    recordRecommended: false
  };
}
