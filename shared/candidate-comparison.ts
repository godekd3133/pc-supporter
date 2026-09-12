import type { AlternativeRisk, CandidateDecisionStatus, CatalogPriceEvidence, DataFreshness, PhysicalEvidenceStatus, RecommendationTrustLevel, SimilarityEvidence } from "./types";
import type { AlternativeComparisonScenarioTradeoff } from "./alternative-comparison-scenario";

export const CANDIDATE_COMPARISON_CRITERIA = ["balanced", "compatibility", "performance", "price", "evidence"] as const;
export type CandidateComparisonCriterion = (typeof CANDIDATE_COMPARISON_CRITERIA)[number];

export interface CandidateComparisonItem {
  id: string;
  name: string;
  priceWon?: number;
  priceEvidence?: CatalogPriceEvidence;
  priceDeltaWon?: number;
  similarityScore?: number;
  similarityEvidence?: SimilarityEvidence;
  analysisScore?: number;
  analysisScoreDelta?: number;
  analysisConfidence?: "high" | "limited" | "unknown";
  recommendationTrustScore?: number;
  recommendationTrustLevel?: RecommendationTrustLevel;
  candidateRisk?: AlternativeRisk;
  decisionStatus?: CandidateDecisionStatus;
  freshness?: DataFreshness;
  physicalStatus?: PhysicalEvidenceStatus;
  remainingBlockers?: number;
  remainingWarnings?: number;
  remainingUnknown?: number;
}

export interface CandidateComparisonTradeoff extends AlternativeComparisonScenarioTradeoff {
  id: string;
  name: string;
}

export interface CandidateComparisonRank {
  id: string;
  name: string;
  score: number;
  reason: string;
}

export interface CandidateComparisonDecision {
  criterion: CandidateComparisonCriterion;
  label: string;
  top?: CandidateComparisonRank;
  ranking: CandidateComparisonRank[];
  eligibleRanking: CandidateComparisonRank[];
  excludedIds: string[];
  summary: string;
}

const CRITERION_LABELS: Record<CandidateComparisonCriterion, string> = {
  balanced: "균형",
  compatibility: "호환 우선",
  performance: "성능 우선",
  price: "가격 우선",
  evidence: "근거 우선"
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function confirmedPriceFor(item: CandidateComparisonItem) {
  if (item.priceEvidence === undefined) return typeof item.priceWon === "number" && Number.isFinite(item.priceWon) && item.priceWon > 0;
  return (item.priceEvidence === "live" || item.priceEvidence === "manual") && typeof item.priceWon === "number" && Number.isFinite(item.priceWon) && item.priceWon > 0;
}

function comparableScenarioPriceFor(item: CandidateComparisonItem) {
  return item.priceEvidence === undefined || item.priceEvidence === "live" || item.priceEvidence === "manual";
}

function priceScores(items: CandidateComparisonItem[]) {
  const known = items.filter(confirmedPriceFor).map((item) => item.priceWon as number);
  const min = known.length > 0 ? Math.min(...known) : undefined;
  const max = known.length > 0 ? Math.max(...known) : undefined;
  return new Map(items.map((item) => {
    if (!confirmedPriceFor(item) || min === undefined || max === undefined) return [item.id, 0] as const;
    if (min === max) return [item.id, 100] as const;
    return [item.id, clampScore(100 - (((item.priceWon as number) - min) / (max - min)) * 100)] as const;
  }));
}

function compatibilityScore(item: CandidateComparisonItem) {
  if (item.candidateRisk === "unsafe" || item.decisionStatus === "avoid") return 0;
  let score = item.candidateRisk === "review" || item.decisionStatus === "review" ? 58 : 100;
  if (item.remainingBlockers !== undefined) score -= Math.min(40, item.remainingBlockers * 8);
  if (item.remainingWarnings !== undefined) score -= Math.min(15, item.remainingWarnings * 3);
  if (item.remainingUnknown !== undefined) score -= Math.min(20, item.remainingUnknown * 5);
  if (item.physicalStatus === "verified") score += 5;
  if (item.physicalStatus === "review") score -= 18;
  if (item.freshness === "stale" || item.freshness === "unknown") score -= 12;
  else if (item.freshness === "aging") score -= 3;
  return clampScore(score);
}

function evidenceScore(item: CandidateComparisonItem) {
  let score = item.recommendationTrustScore ?? (item.recommendationTrustLevel === "high" ? 85 : item.recommendationTrustLevel === "medium" ? 65 : item.recommendationTrustLevel === "low" ? 30 : 0);
  if (item.physicalStatus === "verified") score += 10;
  if (item.physicalStatus === "review") score -= 10;
  if (item.freshness === "fresh") score += 5;
  else if (item.freshness === "aging") score -= 2;
  else if (item.freshness === "stale" || item.freshness === "unknown") score -= 12;
  return clampScore(score);
}

function analysisConfidenceLabel(confidence: CandidateComparisonItem["analysisConfidence"]) {
  return confidence === "high" ? "근거 충분" : confidence === "limited" ? "일부 스펙 기준" : "근거 확인 필요";
}

function analysisWeightFor(item: CandidateComparisonItem) {
  if (item.analysisScore === undefined || !Number.isFinite(item.analysisScore)) return 0;
  if (item.analysisConfidence === "unknown") return 0;
  return item.analysisConfidence === "limited" ? 0.1 : 0.25;
}

function performanceScore(item: CandidateComparisonItem) {
  const componentScore = item.similarityScore !== undefined && Number.isFinite(item.similarityScore) ? clampScore(item.similarityScore) : undefined;
  const appliedBuildScore = item.analysisScore !== undefined && Number.isFinite(item.analysisScore) ? clampScore(item.analysisScore) : undefined;
  const analysisWeight = analysisWeightFor(item);
  if (componentScore !== undefined && appliedBuildScore !== undefined && analysisWeight > 0) return clampScore(componentScore * (1 - analysisWeight) + appliedBuildScore * analysisWeight);
  if (componentScore !== undefined) return componentScore;
  return analysisWeight > 0 && appliedBuildScore !== undefined ? appliedBuildScore : 0;
}

function similarityEvidenceSummary(evidence: SimilarityEvidence | undefined) {
  if (!evidence) return "성능 근거 확인 필요";
  const basis = evidence.basis === "benchmark"
    ? "벤치마크 기준"
    : evidence.basis === "mixed"
      ? "벤치마크·스펙 혼합"
      : evidence.basis === "spec"
        ? "확인 스펙 기준"
        : "기준 미분류";
  const confidence = evidence.confidence === "high" ? "근거 충분" : evidence.confidence === "limited" ? "일부 근거" : "근거 확인 필요";
  return `비교 ${evidence.comparedDimensions}/${evidence.totalDimensions} · ${basis} · ${confidence}`;
}

function reasonFor(criterion: CandidateComparisonCriterion, item: CandidateComparisonItem, score: number, priceScore: number, compatibility: number, performance: number, evidence: number) {
  if (criterion === "compatibility") return `호환 ${compatibility}점 · 후보 위험 ${item.candidateRisk === "safe" ? "없음" : "확인 필요"}`;
  if (criterion === "performance") {
    const details = [
      item.similarityScore !== undefined && Number.isFinite(item.similarityScore) ? `부품 유사도 ${clampScore(item.similarityScore)}점` : undefined,
      item.analysisScore !== undefined && Number.isFinite(item.analysisScore) ? `적용 후 구성 ${clampScore(item.analysisScore)}점 · ${analysisConfidenceLabel(item.analysisConfidence)}` : undefined,
      item.analysisScoreDelta !== undefined && Number.isFinite(item.analysisScoreDelta) ? `현재 대비 ${item.analysisScoreDelta > 0 ? "+" : ""}${Math.round(item.analysisScoreDelta)}점` : undefined
    ].filter((value): value is string => Boolean(value));
    return `성능 종합 ${performance}점${details.length > 0 ? ` · ${details.join(" · ")}` : ""} · ${similarityEvidenceSummary(item.similarityEvidence)}`;
  }
  if (criterion === "price") {
    if (confirmedPriceFor(item)) return `가격 ${item.priceWon!.toLocaleString("ko-KR")}원 · 가격 점수 ${priceScore}점`;
    if (item.priceEvidence === "reference") return "프로젝트 기준가 · 실판매가가 아니어서 가격 점수를 산정하지 않음";
    if (item.priceEvidence === "recorded") return "기록 가격 · 재확인 전까지 가격 점수를 산정하지 않음";
    return "가격 확인 필요";
  }
  if (criterion === "evidence") return `근거 ${evidence}점 · ${item.freshness === "fresh" ? "최근 확인" : item.freshness === "aging" ? "갱신 권장" : item.freshness === "stale" ? "오래된 정보" : item.freshness === "unknown" ? "시점 확인 필요" : "상태 미확인"}`;
  return `균형 ${score}점 · 호환 ${compatibility} · 성능 ${performance} · 근거 ${evidence} · ${similarityEvidenceSummary(item.similarityEvidence)}`;
}

export function candidateComparisonDecisionFor(items: CandidateComparisonItem[], criterion: CandidateComparisonCriterion = "balanced"): CandidateComparisonDecision {
  const priceMap = priceScores(items);
  const ranked = items.map((item) => {
    const price = priceMap.get(item.id) ?? 0;
    const compatibility = compatibilityScore(item);
    const performance = performanceScore(item);
    const evidence = evidenceScore(item);
    const score = criterion === "compatibility"
      ? compatibility
      : criterion === "performance"
        ? performance
        : criterion === "price"
          ? price
          : criterion === "evidence"
            ? evidence
            : clampScore(compatibility * 0.45 + performance * 0.25 + price * 0.15 + evidence * 0.15);
    return {
      id: item.id,
      name: item.name,
      score,
      reason: reasonFor(criterion, item, score, price, compatibility, performance, evidence)
    };
  }).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "ko-KR") || left.id.localeCompare(right.id));
  const excludedIds = items.filter((item) => item.candidateRisk === "unsafe" || item.decisionStatus === "avoid").map((item) => item.id);
  const eligibleRanking = ranked.filter((item) => !excludedIds.includes(item.id));
  const top = eligibleRanking[0];
  const criterionSummary = criterion === "balanced"
    ? "호환·성능·가격·근거를 함께 반영한 균형 기준"
    : criterion === "performance"
      ? "부품 유사도와 후보 적용 후 전체 성능을 함께 반영한 성능 기준"
      : `${CRITERION_LABELS[criterion]} 기준`;
  return {
    criterion,
    label: CRITERION_LABELS[criterion],
    ...(top ? { top } : {}),
    ranking: ranked,
    eligibleRanking,
    excludedIds,
    summary: top
      ? `${top.name} · ${top.score}점 · ${criterionSummary}${excludedIds.length > 0 ? ` · 적용하지 않음 ${excludedIds.length}개 제외` : ""}`
      : "적용 가능한 후보가 없습니다. 차단 후보만 남아 있습니다."
  };
}

type CandidateTradeoffMetric = Pick<CandidateComparisonTradeoff, "id" | "name" | "riskScore" | "priceDeltaWon" | "analysisScore" | "evidenceScore">;

function candidateRiskScoreFor(item: CandidateComparisonItem) {
  if (item.remainingBlockers === undefined || item.remainingWarnings === undefined || item.remainingUnknown === undefined) return undefined;
  return item.remainingBlockers * 100 + item.remainingWarnings * 10 + item.remainingUnknown;
}

function candidateAnalysisScoreFor(item: CandidateComparisonItem) {
  if (item.analysisScore === undefined || !Number.isFinite(item.analysisScore) || item.analysisConfidence === "unknown") return undefined;
  return Math.max(0, Math.min(100, Math.round(item.analysisScore)));
}

function candidateTradeoffDominates(left: CandidateTradeoffMetric, right: CandidateTradeoffMetric) {
  if (left.riskScore === undefined || right.riskScore === undefined) return false;
  const comparablePrice = left.priceDeltaWon === undefined && right.priceDeltaWon === undefined || left.priceDeltaWon !== undefined && right.priceDeltaWon !== undefined;
  const comparableAnalysis = left.analysisScore === undefined && right.analysisScore === undefined || left.analysisScore !== undefined && right.analysisScore !== undefined;
  if (!comparablePrice || !comparableAnalysis) return false;
  if (left.riskScore > right.riskScore || left.priceDeltaWon !== undefined && right.priceDeltaWon !== undefined && left.priceDeltaWon > right.priceDeltaWon || left.analysisScore !== undefined && right.analysisScore !== undefined && left.analysisScore < right.analysisScore || left.evidenceScore! < right.evidenceScore!) return false;
  return left.riskScore < right.riskScore
    || left.priceDeltaWon !== undefined && right.priceDeltaWon !== undefined && left.priceDeltaWon < right.priceDeltaWon
    || left.analysisScore !== undefined && right.analysisScore !== undefined && left.analysisScore > right.analysisScore
    || left.evidenceScore! > right.evidenceScore!;
}

function candidateTradeoffDimensionReason(left: CandidateTradeoffMetric, right: CandidateTradeoffMetric) {
  const dimensions: string[] = [];
  if (left.riskScore !== undefined && right.riskScore !== undefined && left.riskScore < right.riskScore) dimensions.push("잔여 위험");
  if (left.priceDeltaWon !== undefined && right.priceDeltaWon !== undefined && left.priceDeltaWon < right.priceDeltaWon) dimensions.push("가격 변화");
  if (left.analysisScore !== undefined && right.analysisScore !== undefined && left.analysisScore > right.analysisScore) dimensions.push("적용 후 분석");
  if (left.evidenceScore! > right.evidenceScore!) dimensions.push("근거");
  return dimensions.length > 0 ? dimensions.join("·") : "비교 기준";
}

export function candidateComparisonTradeoffsFor(items: CandidateComparisonItem[]): CandidateComparisonTradeoff[] {
  const metrics: CandidateTradeoffMetric[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    ...(candidateRiskScoreFor(item) === undefined ? {} : { riskScore: candidateRiskScoreFor(item) }),
    ...(comparableScenarioPriceFor(item) && item.priceDeltaWon !== undefined && Number.isFinite(item.priceDeltaWon) ? { priceDeltaWon: item.priceDeltaWon } : {}),
    ...(candidateAnalysisScoreFor(item) === undefined ? {} : { analysisScore: candidateAnalysisScoreFor(item) }),
    evidenceScore: evidenceScore(item)
  }));
  return metrics.map((metric) => {
    const excluded = items.find((item) => item.id === metric.id)?.candidateRisk === "unsafe" || items.find((item) => item.id === metric.id)?.decisionStatus === "avoid";
    if (excluded) return { ...metric, eligible: false, frontier: false, reason: "후보 자체가 차단 상태여서 효율 비교에서 제외했습니다." };
    if (metric.riskScore === undefined) return { ...metric, frontier: true, reason: "잔여 위험 카운트가 모두 확인되지 않아 다른 후보와 우열을 확정하지 않았습니다." };
    const dominators = metrics
      .filter((candidate) => candidate.id !== metric.id && !items.find((item) => item.id === candidate.id && (item.candidateRisk === "unsafe" || item.decisionStatus === "avoid")) && candidateTradeoffDominates(candidate, metric))
      .sort((left, right) => left.riskScore! - right.riskScore! || (left.priceDeltaWon ?? Number.POSITIVE_INFINITY) - (right.priceDeltaWon ?? Number.POSITIVE_INFINITY) || (right.analysisScore ?? Number.NEGATIVE_INFINITY) - (left.analysisScore ?? Number.NEGATIVE_INFINITY) || right.evidenceScore! - left.evidenceScore!);
    const dominator = dominators[0];
    if (!dominator) {
      return {
        ...metric,
        frontier: true,
        reason: metric.priceDeltaWon === undefined || metric.analysisScore === undefined
          ? "가격·분석 근거가 일부 확인되지 않아 우열을 확정하지 않고 효율 경계에 남겼습니다."
          : "호환 위험·가격 변화·적용 후 분석·근거에서 다른 후보에 일방적으로 대체되지 않는 선택지입니다."
      };
    }
    return {
      ...metric,
      frontier: false,
      dominatedByCandidateId: dominator.id,
      reason: `${dominator.name}이(가) ${candidateTradeoffDimensionReason(dominator, metric)} 기준으로 더 유리해 효율 경계에서 제외했습니다.`
    };
  });
}
