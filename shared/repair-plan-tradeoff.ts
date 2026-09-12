import type { RecommendationPlan } from "./types";

export interface RepairPlanTradeoffSummary {
  planIndex: number;
  riskScore: number;
  changeCount: number;
  priceDeltaWon?: number;
  frontier: boolean;
  dominatedByPlanIndex?: number;
  reason: string;
}

type RepairPlanTradeoffMetric = Pick<RepairPlanTradeoffSummary, "planIndex" | "riskScore" | "changeCount" | "priceDeltaWon">;

function riskScoreFor(plan: RecommendationPlan) {
  return plan.remainingBlockers * 100 + plan.remainingWarnings * 10 + plan.remainingUnknown;
}

function planDominates(left: RepairPlanTradeoffMetric, right: RepairPlanTradeoffMetric) {
  const bothPricesUnknown = left.priceDeltaWon === undefined && right.priceDeltaWon === undefined;
  const bothPricesKnown = left.priceDeltaWon !== undefined && right.priceDeltaWon !== undefined;
  // A known price and an unknown price cannot establish a safe cost ordering.
  if (!bothPricesUnknown && !bothPricesKnown) return false;
  const noWorseOnRisk = left.riskScore <= right.riskScore;
  const noWorseOnChange = left.changeCount <= right.changeCount;
  const noWorseOnPrice = bothPricesKnown ? left.priceDeltaWon! <= right.priceDeltaWon! : true;
  if (!noWorseOnRisk || !noWorseOnChange || !noWorseOnPrice) return false;
  return left.riskScore < right.riskScore
    || left.changeCount < right.changeCount
    || (bothPricesKnown && left.priceDeltaWon! < right.priceDeltaWon!);
}

function dimensionReason(left: RepairPlanTradeoffMetric, right: RepairPlanTradeoffMetric) {
  const dimensions: string[] = [];
  if (left.riskScore < right.riskScore) dimensions.push("잔여 위험");
  if (left.changeCount < right.changeCount) dimensions.push("변경 규모");
  if (left.priceDeltaWon !== undefined && right.priceDeltaWon !== undefined && left.priceDeltaWon < right.priceDeltaWon) dimensions.push("추가 비용");
  return dimensions.length > 0 ? dimensions.join("·") : "비교 기준";
}

export function repairPlanTradeoffFor(plans: ReadonlyArray<RecommendationPlan>): RepairPlanTradeoffSummary[] {
  const metrics: RepairPlanTradeoffMetric[] = plans.map((plan, planIndex) => ({
    planIndex,
    riskScore: riskScoreFor(plan),
    changeCount: plan.changes.length,
    ...(plan.priceDeltaWon === undefined ? {} : { priceDeltaWon: plan.priceDeltaWon })
  }));
  return metrics.map((metric) => {
    const dominators = metrics
      .filter((candidate) => candidate.planIndex !== metric.planIndex && planDominates(candidate, metric))
      .sort((left, right) => left.riskScore - right.riskScore || left.changeCount - right.changeCount || (left.priceDeltaWon ?? Number.POSITIVE_INFINITY) - (right.priceDeltaWon ?? Number.POSITIVE_INFINITY));
    const dominator = dominators[0];
    if (!dominator) {
      return {
        ...metric,
        frontier: true,
        reason: metric.priceDeltaWon === undefined
          ? "가격 확인 필요 상태를 유지한 채 잔여 위험·변경 규모 기준의 효율 경계에 있습니다."
          : "비용·잔여 위험·변경 규모에서 다른 플랜에 일방적으로 대체되지 않는 선택지입니다."
      };
    }
    return {
      ...metric,
      frontier: false,
      dominatedByPlanIndex: dominator.planIndex,
      reason: `${plans[dominator.planIndex]?.label ?? "다른"} 플랜이 ${dimensionReason(dominator, metric)} 기준으로 더 유리해 효율 경계에서 제외했습니다.`
    };
  });
}
