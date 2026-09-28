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
      : `${CATEGORY_LABELS[primary.category]} 부품 ${primary.toPartName} 확인`;
    return {
      kind: "repair_plan",
      title: "호환 문제 줄이기",
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
      title: "확인할 항목",
      summary: "한 번에 호환 문제를 해결할 구성을 찾지 못했어요. 아래 항목을 하나씩 살펴봐 주세요.",
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
    title: "추가 추천 없음",
    summary: "현재 부품을 바꾸지 않고 해결할 수 있는 추천 구성이 없습니다.",
    changes: [],
    resolvedBlockers: 0,
    remainingBlockers: result.blockerCount,
    remainingWarnings: result.warningCount,
    remainingUnknown: result.unknownCount,
    priceComplete: result.priceComplete
  };
}
