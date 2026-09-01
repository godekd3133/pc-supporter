import type { AlternativeRisk, CandidateDecisionStatus, DataFreshness, PhysicalEvidenceStatus, RecommendationTrustLevel } from "./types";

export const CANDIDATE_COMPARISON_CRITERIA = ["balanced", "compatibility", "performance", "price", "evidence"] as const;
export type CandidateComparisonCriterion = (typeof CANDIDATE_COMPARISON_CRITERIA)[number];

export interface CandidateComparisonItem {
  id: string;
  name: string;
  priceWon?: number;
  similarityScore?: number;
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

function priceScores(items: CandidateComparisonItem[]) {
  const known = items.map((item) => item.priceWon).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const min = known.length > 0 ? Math.min(...known) : undefined;
  const max = known.length > 0 ? Math.max(...known) : undefined;
  return new Map(items.map((item) => {
    if (item.priceWon === undefined || !Number.isFinite(item.priceWon) || item.priceWon <= 0 || min === undefined || max === undefined) return [item.id, 0] as const;
    if (min === max) return [item.id, 100] as const;
    return [item.id, clampScore(100 - ((item.priceWon - min) / (max - min)) * 100)] as const;
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

function performanceScore(item: CandidateComparisonItem) {
  return item.similarityScore === undefined || !Number.isFinite(item.similarityScore) ? 0 : clampScore(item.similarityScore);
}

function reasonFor(criterion: CandidateComparisonCriterion, item: CandidateComparisonItem, score: number, priceScore: number, compatibility: number, performance: number, evidence: number) {
  if (criterion === "compatibility") return `호환 ${compatibility}점 · 후보 위험 ${item.candidateRisk === "safe" ? "없음" : "확인 필요"}`;
  if (criterion === "performance") return `성능 유사도 ${performance}점`;
  if (criterion === "price") return item.priceWon !== undefined && item.priceWon > 0 ? `가격 ${item.priceWon.toLocaleString("ko-KR")}원 · 가격 점수 ${priceScore}점` : "가격 확인 필요";
  if (criterion === "evidence") return `근거 ${evidence}점 · ${item.freshness === "fresh" ? "최근 확인" : item.freshness === "aging" ? "갱신 권장" : item.freshness === "stale" ? "오래된 정보" : item.freshness === "unknown" ? "시점 확인 필요" : "상태 미확인"}`;
  return `균형 ${score}점 · 호환 ${compatibility} · 성능 ${performance} · 근거 ${evidence}`;
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
  return {
    criterion,
    label: CRITERION_LABELS[criterion],
    ...(top ? { top } : {}),
    ranking: ranked,
    eligibleRanking,
    excludedIds,
    summary: top
      ? `${top.name} · ${top.score}점 · ${criterion === "balanced" ? "호환·성능·가격·근거를 함께 반영한 균형 기준" : `${CRITERION_LABELS[criterion]} 기준`}${excludedIds.length > 0 ? ` · 적용하지 않음 ${excludedIds.length}개 제외` : ""}`
      : "적용 가능한 후보가 없습니다. 차단 후보만 남아 있습니다."
  };
}
