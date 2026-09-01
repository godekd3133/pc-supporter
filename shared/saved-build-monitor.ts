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
  const base = `${snapshot.blockerCount}개 차단 · ${snapshot.warningCount}개 주의 · ${snapshot.unknownCount}개 확인 필요`;
  const accessory = snapshot.accessoryCompatibility;
  if (!accessory || (accessory.blockerCount === 0 && accessory.warningCount === 0 && accessory.unknownCount === 0)) return base;
  return `${base} · 주변 부품 ${accessory.blockerCount}개 차단 · ${accessory.warningCount}개 주의 · ${accessory.unknownCount}개 확인 필요`;
}

function riskDeltaText(transition: SavedBuildCheckTransitionSummary) {
  const values = [
    transition.blockerDelta !== 0 ? `차단 ${transition.blockerDelta > 0 ? "+" : ""}${transition.blockerDelta}` : undefined,
    transition.warningDelta !== 0 ? `주의 ${transition.warningDelta > 0 ? "+" : ""}${transition.warningDelta}` : undefined,
    transition.unknownDelta !== 0 ? `확인 필요 ${transition.unknownDelta > 0 ? "+" : ""}${transition.unknownDelta}` : undefined,
    transition.accessoryBlockerDelta !== 0 ? `주변 차단 ${transition.accessoryBlockerDelta > 0 ? "+" : ""}${transition.accessoryBlockerDelta}` : undefined,
    transition.accessoryWarningDelta !== 0 ? `주변 주의 ${transition.accessoryWarningDelta > 0 ? "+" : ""}${transition.accessoryWarningDelta}` : undefined,
    transition.accessoryUnknownDelta !== 0 ? `주변 확인 필요 ${transition.accessoryUnknownDelta > 0 ? "+" : ""}${transition.accessoryUnknownDelta}` : undefined
  ].filter((value): value is string => Boolean(value));
  return values.join(" · ");
}

export function savedBuildMonitorAssessmentFor(snapshot: SavedBuildCheckSnapshot, transition?: SavedBuildCheckTransitionSummary): SavedBuildMonitorAssessment {
  const accessory = snapshot.accessoryCompatibility;
  const riskIncreased = Boolean(transition && (transition.blockerDelta > 0 || transition.warningDelta > 0 || transition.unknownDelta > 0 || transition.accessoryBlockerDelta > 0 || transition.accessoryWarningDelta > 0 || transition.accessoryUnknownDelta > 0));
  const riskDecreased = Boolean(transition && (transition.blockerDelta < 0 || transition.warningDelta < 0 || transition.unknownDelta < 0 || transition.accessoryBlockerDelta < 0 || transition.accessoryWarningDelta < 0 || transition.accessoryUnknownDelta < 0));
  const deltaText = transition ? riskDeltaText(transition) : "";

  if (snapshot.status === "incompatible" || snapshot.blockerCount > 0 || (accessory?.blockerCount ?? 0) > 0) {
    return {
      level: "critical",
      label: riskIncreased ? "차단 위험 악화" : "구매 전 수정 필요",
      summary: `${riskCountsText(snapshot)}${deltaText ? ` · 마지막 기록 대비 ${deltaText}` : ""}`,
      requiresAttention: true,
      recordRecommended: !transition || transition.hasChanges
    };
  }

  if (snapshot.status === "needs_review" || snapshot.unknownCount > 0 || riskIncreased || snapshot.warningCount > 0 || (accessory?.unknownCount ?? 0) > 0 || (accessory?.warningCount ?? 0) > 0) {
    return {
      level: "review",
      label: riskIncreased ? "검토 항목 증가" : "확인 필요",
      summary: `${riskCountsText(snapshot)}${deltaText ? ` · 마지막 기록 대비 ${deltaText}` : ""}`,
      requiresAttention: true,
      recordRecommended: !transition || transition.hasChanges
    };
  }

  if (!transition) {
    return {
      level: "baseline",
      label: "첫 기준 기록 권장",
      summary: "현재 상태는 양호하지만 비교할 이전 검사 기준이 없습니다.",
      requiresAttention: false,
      recordRecommended: true
    };
  }

  if (transition.direction === "improved" || (riskDecreased && !riskIncreased)) {
    return {
      level: "improved",
      label: "상태 개선",
      summary: `${deltaText ? `마지막 기록 대비 ${deltaText}` : "호환 판정이 개선되었습니다."}`,
      requiresAttention: false,
      recordRecommended: true
    };
  }

  if (transition.hasChanges) {
    const changedReasons = [
      transition.priceDeltaWon !== undefined && transition.priceDeltaWon !== 0 ? "가격" : undefined,
      transition.priceCompletenessChanged ? "가격 확인 상태" : undefined,
      transition.catalogChanged ? "카탈로그 기준" : undefined,
      transition.engineChanged ? "검사 엔진" : undefined,
      transition.newFindingCount > 0 || transition.resolvedFindingCount > 0 || transition.severityChangedFindingCount > 0 || transition.detailsChangedFindingCount > 0 ? "판정 상세" : undefined
    ].filter((value): value is string => Boolean(value));
    return {
      level: "changed",
      label: "정보 변화 감지",
      summary: changedReasons.length > 0 ? `${changedReasons.join(" · ")} 변화가 있습니다.` : "마지막 검사 기록과 현재 정보가 다릅니다.",
      requiresAttention: false,
      recordRecommended: true
    };
  }

  return {
    level: "stable",
    label: "현재 상태 안정",
    summary: "마지막 기록과 현재 호환 판정·가격·검사 기준이 같습니다.",
    requiresAttention: false,
    recordRecommended: false
  };
}
