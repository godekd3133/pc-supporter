import type { BenchmarkSourceKind, Part, RecommendationTrustEvidence, RecommendationTrustFilter, SimilarityEvidence } from "../shared/types";
import { BENCHMARK_SOURCE_KIND_LABELS, isKnownPrice } from "../shared/types";
import { classifyDataFreshness } from "./data-health";

export type RecommendationTrustInput = {
  candidate: Pick<Part, "dataQuality" | "missingFields" | "priceWon" | "updatedAt" | "danawaUrl">;
  similarityEvidence: SimilarityEvidence;
  resolvesTarget: boolean;
  candidateBlockers: number;
  candidateWarnings: number;
  candidateUnknown: number;
  benchmarkSourceKind?: BenchmarkSourceKind;
  remainingBlockers: number;
  remainingWarnings: number;
  remainingUnknown: number;
  now?: string | number;
};

export function recommendationTrustFilterFromUnknown(value: unknown): RecommendationTrustFilter {
  return value === "medium_plus" || value === "high" ? value : "all";
}

export function recommendationTrustMatchesFilter(filter: RecommendationTrustFilter, trust: RecommendationTrustEvidence | undefined) {
  if (filter === "all") return true;
  if (!trust) return false;
  return filter === "high" ? trust.level === "high" : trust.level === "high" || trust.level === "medium";
}

export function compareRecommendationTrust(left: RecommendationTrustEvidence | undefined, right: RecommendationTrustEvidence | undefined) {
  if (!left && right) return 1;
  if (left && !right) return -1;
  if (!left || !right) return 0;
  const levelRank: Record<RecommendationTrustEvidence["level"], number> = { high: 0, medium: 1, low: 2 };
  return levelRank[left.level] - levelRank[right.level] || right.score - left.score;
}

const dataQualityPoints: Record<Part["dataQuality"], number> = {
  manual: 12,
  live: 10,
  seed: 5,
  incomplete: 0
};

const freshnessLabels: Record<RecommendationTrustEvidence["freshness"], string> = {
  fresh: "최근 갱신",
  aging: "갱신 권장 시점",
  stale: "오래된 데이터",
  unknown: "갱신 시점 불명"
};

const dataQualityLabels: Record<Part["dataQuality"], string> = {
  manual: "수동 검수 데이터",
  live: "다나와 최신 데이터",
  seed: "프로젝트 기준 데이터",
  incomplete: "필수 스펙 누락 데이터"
};

function comparisonReason(evidence: SimilarityEvidence) {
  if (evidence.comparedDimensions <= 0 || evidence.totalDimensions <= 0) return "성능 유사도를 계산할 비교 스펙이 없습니다.";
  const basis = evidence.basis === "benchmark"
    ? "벤치마크 포함"
    : evidence.basis === "mixed"
      ? "벤치마크·확인 스펙 혼합"
      : "확인 스펙 기반";
  return `비교 가능한 스펙 ${evidence.comparedDimensions}/${evidence.totalDimensions}개 · ${basis}`;
}

export function recommendationTrustFor(input: RecommendationTrustInput): RecommendationTrustEvidence {
  const { candidate, similarityEvidence } = input;
  const freshness = classifyDataFreshness(candidate.updatedAt, input.now);
  const priceKnown = isKnownPrice(candidate.priceWon);
  const sourceAvailable = Boolean(candidate.danawaUrl);
  const benchmarkBacked = similarityEvidence.basis === "benchmark" || similarityEvidence.basis === "mixed";
  const compatibility = input.candidateBlockers === 0 && input.candidateUnknown === 0 ? "verified" : "review";
  const fullBuildStatus = input.remainingBlockers === 0 && input.remainingWarnings === 0 && input.remainingUnknown === 0 ? "clean" : "remaining_issues";
  const reasons: string[] = [];
  let score = 0;

  if (input.resolvesTarget) {
    score += 5;
    reasons.push("현재 문제를 해결하는 후보입니다.");
  } else {
    reasons.push("현재 문제 해결 여부를 추가 확인해야 합니다.");
  }

  if (input.candidateBlockers === 0 && input.candidateUnknown === 0) {
    score += 30;
    reasons.push("후보 자체를 적용해 새 차단 오류와 확인 필요가 없습니다.");
  } else if (input.candidateBlockers === 0) {
    score += 18;
    reasons.push(`후보 자체의 차단 오류는 없지만 확인 필요 ${input.candidateUnknown}개가 남습니다.`);
  } else {
    reasons.push(`후보 자체에 차단 오류 ${input.candidateBlockers}개가 남아 호환을 확정할 수 없습니다.`);
  }

  if (input.candidateWarnings === 0) score += 3;
  else reasons.push(`후보 자체의 주의 ${input.candidateWarnings}개가 남아 구매 전 확인이 필요합니다.`);

  if (fullBuildStatus === "remaining_issues") {
    reasons.push(`전체 견적에는 차단 ${input.remainingBlockers}개·주의 ${input.remainingWarnings}개·확인 필요 ${input.remainingUnknown}개가 남아 이 후보 하나로 전체 해결되지는 않습니다.`);
  }

  if (similarityEvidence.confidence === "high" && similarityEvidence.comparedDimensions >= 2) {
    score += 20;
  } else if (similarityEvidence.comparedDimensions >= 2) {
    score += 12;
  } else if (similarityEvidence.comparedDimensions === 1) {
    score += 6;
  }
  reasons.push(comparisonReason(similarityEvidence));

  if (similarityEvidence.basis === "benchmark") score += 6;
  else if (similarityEvidence.basis === "mixed") score += 4;
  else if (similarityEvidence.basis === "spec") score += 2;
  if (benchmarkBacked) {
    if (input.benchmarkSourceKind === "official") score += 6;
    else if (input.benchmarkSourceKind === "independent_review") score += 4;
    else if (input.benchmarkSourceKind === "community_measurement") score += 2;
    reasons.push(input.benchmarkSourceKind ? `벤치마크 출처: ${BENCHMARK_SOURCE_KIND_LABELS[input.benchmarkSourceKind]}` : "벤치마크 출처 유형이 분류되지 않았습니다.");
  }

  score += dataQualityPoints[candidate.dataQuality];
  reasons.push(dataQualityLabels[candidate.dataQuality]);

  if (candidate.missingFields.length === 0) score += 8;
  else if (candidate.missingFields.length <= 2) score += 4;
  else reasons.push(`누락 스펙 ${candidate.missingFields.length}개가 있어 원문 확인이 필요합니다.`);

  if (freshness === "fresh") score += 5;
  else if (freshness === "aging") score += 2;
  else reasons.push(`${freshnessLabels[freshness]} 상태입니다.`);

  if (priceKnown) score += 4;
  else reasons.push("현재 가격을 확인할 수 없어 총액 비교는 확정하지 않습니다.");

  if (sourceAvailable) score += 3;
  else reasons.push("원문 링크가 없어 구매 전 출처를 별도로 확인해야 합니다.");

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  let level: RecommendationTrustEvidence["level"] = boundedScore >= 80 ? "high" : boundedScore >= 55 ? "medium" : "low";
  if (input.candidateBlockers > 0 || candidate.dataQuality === "incomplete") level = "low";
  else if (input.candidateUnknown > 0 || freshness === "stale" || freshness === "unknown") level = level === "high" ? "medium" : level;

  return {
    level,
    score: boundedScore,
    compatibility,
    candidateBlockerCount: input.candidateBlockers,
    candidateWarningCount: input.candidateWarnings,
    candidateUnknownCount: input.candidateUnknown,
    fullBuildStatus,
    remainingBlockerCount: input.remainingBlockers,
    remainingWarningCount: input.remainingWarnings,
    remainingUnknownCount: input.remainingUnknown,
    freshness,
    dataQuality: candidate.dataQuality,
    comparedDimensions: similarityEvidence.comparedDimensions,
    totalDimensions: similarityEvidence.totalDimensions,
    missingFieldCount: candidate.missingFields.length,
    priceKnown,
    sourceAvailable,
    benchmarkBacked,
    ...(input.benchmarkSourceKind ? { benchmarkSourceKind: input.benchmarkSourceKind } : {}),
    reasons: [...new Set(reasons)]
  };
}
