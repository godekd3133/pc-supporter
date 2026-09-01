import type { CompatibilityResult, PartCategory } from "./types";
import { CATEGORY_LABELS } from "./types";

export interface SavedBuildPriorityActionChange {
  kind: "replace_part" | "change_quantity";
  category: PartCategory;
  fromPartName?: string;
  toPartName: string;
  fromQuantity?: number;
  toQuantity?: number;
  priceDeltaWon?: number;
}

export interface SavedBuildPriorityAction {
  kind: "repair_plan" | "analysis" | "none";
  title: string;
  summary: string;
  nextAction?: string;
  changes: SavedBuildPriorityActionChange[];
  resolvedBlockers: number;
  remainingBlockers: number;
  remainingWarnings: number;
  remainingUnknown: number;
  priceDeltaWon?: number;
  afterTotalPriceWon?: number;
  priceComplete: boolean;
}

export function savedBuildNextActionFor(result: CompatibilityResult): SavedBuildPriorityAction {
  const plan = result.repairPlans?.[0];
  if (plan && plan.changes.length > 0) {
    const changes = plan.changes.map((change) => ({
      kind: change.kind,
      category: change.category,
      ...(change.fromPartName ? { fromPartName: change.fromPartName } : {}),
      toPartName: change.toPart.name,
      ...(change.fromQuantity !== undefined ? { fromQuantity: change.fromQuantity } : {}),
      ...(change.toQuantity !== undefined ? { toQuantity: change.toQuantity } : {}),
      ...(change.priceDeltaWon !== undefined ? { priceDeltaWon: change.priceDeltaWon } : {})
    } satisfies SavedBuildPriorityActionChange));
    const primary = changes[0];
    const nextAction = primary.kind === "change_quantity"
      ? `${CATEGORY_LABELS[primary.category]} 수량 ${primary.fromQuantity ?? "?"}개 → ${primary.toQuantity ?? "?"}개`
      : `${CATEGORY_LABELS[primary.category]} 후보 ${primary.toPartName} 확인`;
    return {
      kind: "repair_plan",
      title: "추천 수리 플랜",
      summary: plan.reason,
      nextAction,
      changes,
      resolvedBlockers: plan.resolvedBlockers,
      remainingBlockers: plan.remainingBlockers,
      remainingWarnings: plan.remainingWarnings,
      remainingUnknown: plan.remainingUnknown,
      ...(plan.priceDeltaWon !== undefined ? { priceDeltaWon: plan.priceDeltaWon } : {}),
      afterTotalPriceWon: plan.afterTotalPriceWon,
      priceComplete: plan.priceComplete
    };
  }

  const analysisAction = result.analysis.nextActions[0];
  if (analysisAction) {
    return {
      kind: "analysis",
      title: "분석 기준 다음 행동",
      summary: "현재 전체 수리 플랜으로 계산된 안전한 후보가 없어, 분석 엔진이 제안한 다음 행동을 먼저 확인합니다.",
      nextAction: analysisAction,
      changes: [],
      resolvedBlockers: 0,
      remainingBlockers: result.blockerCount,
      remainingWarnings: result.warningCount,
      remainingUnknown: result.unknownCount,
      priceComplete: result.priceComplete
    };
  }

  return {
    kind: "none",
    title: "추가 조치 없음",
    summary: "현재 분석 기준에서 별도로 제안할 다음 조치가 없습니다.",
    changes: [],
    resolvedBlockers: 0,
    remainingBlockers: result.blockerCount,
    remainingWarnings: result.warningCount,
    remainingUnknown: result.unknownCount,
    priceComplete: result.priceComplete
  };
}
