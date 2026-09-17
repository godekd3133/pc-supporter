import type { BudgetLadderBandId, BudgetLadderOutcome } from "./budget-ladder";

export interface BudgetLadderTradeoffSummary {
  scenarioIndex: number;
  scenarioId: BudgetLadderBandId;
  riskScore?: number;
  totalPriceWon?: number;
  analysisScore?: number;
  frontier: boolean;
  dominatedByScenarioIndex?: number;
  reason: string;
}

type BudgetLadderTradeoffMetric = Pick<BudgetLadderTradeoffSummary, "scenarioIndex" | "scenarioId" | "riskScore" | "totalPriceWon" | "analysisScore">;

function riskScoreFor(outcome: BudgetLadderOutcome) {
  if (!outcome.draft) return undefined;
  return outcome.draft.blockerCount * 100 + outcome.draft.warningCount * 10 + outcome.draft.unknownCount;
}

function analysisScoreFor(outcome: BudgetLadderOutcome) {
  const score = outcome.draft?.analysis?.overallScore;
  return score !== undefined && Number.isFinite(score) ? score : undefined;
}

function metricDominates(left: BudgetLadderTradeoffMetric, right: BudgetLadderTradeoffMetric) {
  if (left.riskScore === undefined || right.riskScore === undefined) return false;
  // If only one side has a confirmed value for an optional dimension, do not
  // claim a total ordering from incomplete evidence.
  const comparablePrice = left.totalPriceWon === undefined && right.totalPriceWon === undefined
    || left.totalPriceWon !== undefined && right.totalPriceWon !== undefined;
  const comparableAnalysis = left.analysisScore === undefined && right.analysisScore === undefined
    || left.analysisScore !== undefined && right.analysisScore !== undefined;
  if (!comparablePrice || !comparableAnalysis) return false;
  if (left.riskScore > right.riskScore) return false;
  if (left.totalPriceWon !== undefined && right.totalPriceWon !== undefined && left.totalPriceWon > right.totalPriceWon) return false;
  if (left.analysisScore !== undefined && right.analysisScore !== undefined && left.analysisScore < right.analysisScore) return false;
  return left.riskScore < right.riskScore
    || left.totalPriceWon !== undefined && right.totalPriceWon !== undefined && left.totalPriceWon < right.totalPriceWon
    || left.analysisScore !== undefined && right.analysisScore !== undefined && left.analysisScore > right.analysisScore;
}

function dimensionReason(left: BudgetLadderTradeoffMetric, right: BudgetLadderTradeoffMetric) {
  const dimensions: string[] = [];
  if (left.riskScore !== undefined && right.riskScore !== undefined && left.riskScore < right.riskScore) dimensions.push("남은 위험");
  if (left.totalPriceWon !== undefined && right.totalPriceWon !== undefined && left.totalPriceWon < right.totalPriceWon) dimensions.push("실제 합계");
  if (left.analysisScore !== undefined && right.analysisScore !== undefined && left.analysisScore > right.analysisScore) dimensions.push("분석 점수");
  return dimensions.length > 0 ? dimensions.join("·") : "비교 기준";
}

export function budgetLadderTradeoffFor(outcomes: ReadonlyArray<BudgetLadderOutcome>): BudgetLadderTradeoffSummary[] {
  const metrics: BudgetLadderTradeoffMetric[] = outcomes.map((outcome, scenarioIndex) => ({
    scenarioIndex,
    scenarioId: outcome.id,
    ...(riskScoreFor(outcome) === undefined ? {} : { riskScore: riskScoreFor(outcome) }),
    ...(outcome.draft?.priceComplete && Number.isFinite(outcome.draft.totalPriceWon) ? { totalPriceWon: outcome.draft.totalPriceWon } : {}),
    ...(analysisScoreFor(outcome) === undefined ? {} : { analysisScore: analysisScoreFor(outcome) })
  }));
  return metrics.map((metric) => {
    if (metric.riskScore === undefined) {
      return { ...metric, frontier: true, reason: "생성 실패로 다른 예산 구간과 비교하지 않았습니다." };
    }
    const dominators = metrics
      .filter((candidate) => candidate.scenarioIndex !== metric.scenarioIndex && metricDominates(candidate, metric))
      .sort((left, right) => left.riskScore! - right.riskScore! || (left.totalPriceWon ?? Number.POSITIVE_INFINITY) - (right.totalPriceWon ?? Number.POSITIVE_INFINITY) || (right.analysisScore ?? Number.NEGATIVE_INFINITY) - (left.analysisScore ?? Number.NEGATIVE_INFINITY));
    const dominator = dominators[0];
    if (!dominator) {
      return {
        ...metric,
        frontier: true,
        reason: metric.totalPriceWon === undefined || metric.analysisScore === undefined
          ? "확인된 비용·분석 점수 범위 안에서 비교 대상으로 남겼습니다."
          : "위험·실제 합계·분석 점수에서 다른 구간에 밀리지 않았습니다."
      };
    }
    return {
      ...metric,
      frontier: false,
      dominatedByScenarioIndex: dominator.scenarioIndex,
      reason: `${outcomes[dominator.scenarioIndex]?.label ?? "다른"} 구간이 ${dimensionReason(dominator, metric)} 기준으로 더 나아 비교 대상에서 제외했습니다.`
    };
  });
}
