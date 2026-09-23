import type { BenchmarkSourceKind, DataFreshness, Part, PhysicalSourceCheck, RecommendationTrustCounts, RecommendationTrustEvidence, RecommendationTrustFilter, SimilarityEvidence } from "../shared/types";
import { BENCHMARK_SOURCE_KIND_LABELS, isKnownPrice } from "../shared/types";
import { catalogPriceEvidenceFor } from "../shared/catalog-price-evidence";
import { classifyDataFreshness } from "./data-health";
import { physicalSourceCheckNeedsReview } from "../shared/physical-source-check";

export type RecommendationTrustInput = {
  candidate: Pick<Part, "dataQuality" | "missingFields" | "priceWon" | "updatedAt" | "danawaUrl" | "specs">;
  similarityEvidence: SimilarityEvidence;
  resolvesTarget: boolean;
  candidateBlockers: number;
  candidateWarnings: number;
  candidateUnknown: number;
  benchmarkSourceKind?: BenchmarkSourceKind;
  benchmarkFreshness?: DataFreshness;
  benchmarkSourceCheck?: PhysicalSourceCheck;
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

export function recommendationTrustCountsFor(trusts: ReadonlyArray<Pick<RecommendationTrustEvidence, "level">>): RecommendationTrustCounts {
  return trusts.reduce<RecommendationTrustCounts>((counts, trust) => {
    counts[trust.level] += 1;
    return counts;
  }, { high: 0, medium: 0, low: 0 });
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
  manual: "직접 입력한 정보",
  live: "다나와에서 확인한 정보",
  seed: "기본 부품 정보",
  incomplete: "필수 정보 누락"
};

function comparisonReason(evidence: SimilarityEvidence) {
  if (evidence.comparedDimensions <= 0 || evidence.totalDimensions <= 0) return "성능을 비교할 부품 정보가 없습니다.";
  const basis = evidence.basis === "benchmark"
    ? "성능 측정 자료 포함"
    : evidence.basis === "mixed"
      ? "성능 측정·부품 정보"
      : "부품 정보";
  return `비교 정보 ${evidence.comparedDimensions}/${evidence.totalDimensions}개 · ${basis}`;
}

function catalogSpecSourceCheckNeedsReviewFor(provenance: Part["specs"]["catalogSpecProvenance"], now: string | number | undefined) {
  if (!provenance) return undefined;
  if (!provenance.sourceCheck) return true;
  if (provenance.sourceCheck.requestedUrl.trim() !== provenance.sourceUrl.trim()) return true;
  return physicalSourceCheckNeedsReview(provenance.sourceCheck, true, now);
}

export function recommendationTrustFor(input: RecommendationTrustInput): RecommendationTrustEvidence {
  const { candidate, similarityEvidence } = input;
  const freshness = classifyDataFreshness(candidate.updatedAt, input.now);
  const priceKnown = isKnownPrice(candidate.priceWon);
  const priceEvidence = catalogPriceEvidenceFor(candidate);
  const sourceAvailable = Boolean(candidate.danawaUrl);
  const benchmarkBacked = similarityEvidence.basis === "benchmark" || similarityEvidence.basis === "mixed";
  const benchmarkFreshness = benchmarkBacked ? input.benchmarkFreshness ?? freshness : undefined;
  const benchmarkSourceCheckNeedsReview = benchmarkBacked && input.benchmarkSourceCheck ? physicalSourceCheckNeedsReview(input.benchmarkSourceCheck, true, input.now) : undefined;
  const catalogSpecProvenance = candidate.specs.catalogSpecProvenance;
  const catalogSpecSourceCheckNeedsReview = catalogSpecSourceCheckNeedsReviewFor(catalogSpecProvenance, input.now);
  const compatibility = input.candidateBlockers === 0 && input.candidateUnknown === 0 ? "verified" : "review";
  const fullBuildStatus = input.remainingBlockers === 0 && input.remainingWarnings === 0 && input.remainingUnknown === 0 ? "clean" : "remaining_issues";
  const reasons: string[] = [];
  let score = 0;

  if (input.resolvesTarget) {
    score += 5;
    reasons.push("현재 문제를 해결하는 부품입니다.");
  } else {
    reasons.push("현재 문제 해결 여부를 추가 확인해야 합니다.");
  }

  if (input.candidateBlockers === 0 && input.candidateUnknown === 0) {
    score += 30;
    reasons.push("부품 자체를 적용해 새 차단 오류와 확인 필요가 없습니다.");
  } else if (input.candidateBlockers === 0) {
    score += 18;
    reasons.push(`부품 자체의 차단 오류는 없지만 확인 필요 ${input.candidateUnknown}개가 남습니다.`);
  } else {
    reasons.push(`부품 자체에 차단 오류 ${input.candidateBlockers}개가 남아 호환을 알 수 없어요.`);
  }

  if (input.candidateWarnings === 0) score += 3;
  else reasons.push(`부품 자체의 주의 ${input.candidateWarnings}개가 남아 구매 전 확인이 필요합니다.`);

  if (fullBuildStatus === "remaining_issues") {
    reasons.push(`전체 견적에는 차단 ${input.remainingBlockers}개·주의 ${input.remainingWarnings}개·확인 필요 ${input.remainingUnknown}개가 남아 이 부품 하나로 전체 해결되지는 않습니다.`);
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
    reasons.push(input.benchmarkSourceKind ? `벤치마크 출처: ${BENCHMARK_SOURCE_KIND_LABELS[input.benchmarkSourceKind]}` : "벤치마크 출처가 분류되지 않았습니다.");
    if (benchmarkFreshness === "fresh") score += 3;
    else if (benchmarkFreshness === "aging") reasons.push("벤치마크 자료 갱신을 권장합니다.");
    else if (benchmarkFreshness === "stale") {
      score -= 5;
      reasons.push("성능 측정 자료가 오래됐습니다. 최신 자료를 확인하세요.");
    } else if (benchmarkFreshness === "unknown") {
      score -= 7;
      reasons.push("성능 측정 자료의 갱신일을 알 수 없습니다.");
    }
    if (benchmarkSourceCheckNeedsReview === false) {
      score += 4;
      reasons.push("성능 자료의 출처와 부품 모델을 확인했습니다.");
    } else if (benchmarkSourceCheckNeedsReview === true) {
      score -= 8;
      reasons.push("성능 자료의 출처와 부품 모델을 확인하세요.");
    }
  }

  if (catalogSpecProvenance) {
    reasons.push("제조사 정보 수동 보강값");
    if (catalogSpecSourceCheckNeedsReview === false) {
      score += 4;
      reasons.push("제조사 정보와 부품 모델을 확인했습니다.");
    } else {
      score -= 8;
      reasons.push(catalogSpecProvenance.sourceCheck
        ? "제조사 정보와 부품 모델을 확인하세요."
        : "제조사 정보와 부품 모델을 아직 확인하지 않았습니다.");
    }
  }

  score += dataQualityPoints[candidate.dataQuality];
    reasons.push(dataQualityLabels[candidate.dataQuality]);

  if (candidate.missingFields.length === 0) score += 8;
  else if (candidate.missingFields.length <= 2) score += 4;
    else reasons.push(`확인되지 않은 부품 정보가 ${candidate.missingFields.length}개 있습니다.`);

  if (freshness === "fresh") score += 5;
  else if (freshness === "aging") score += 2;
  else reasons.push(`${freshnessLabels[freshness]} 상태입니다.`);

  if (priceEvidence === "live" || priceEvidence === "manual") {
    score += 4;
  } else if (priceEvidence === "reference") {
    reasons.push("참고 가격만 있어 현재 판매 가격은 판매처에서 확인하세요.");
  } else if (priceEvidence === "recorded") {
    reasons.push("기록된 가격입니다. 현재 판매 가격은 판매처에서 확인하세요.");
  } else {
    reasons.push("현재 가격을 알 수 없어 총액을 비교하지 않았습니다.");
  }

  if (sourceAvailable) score += 3;
  else reasons.push("상품 링크가 없어 구매 전 출처를 따로 확인해야 해요.");

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  let level: RecommendationTrustEvidence["level"] = boundedScore >= 80 ? "high" : boundedScore >= 55 ? "medium" : "low";
  if (input.candidateBlockers > 0 || candidate.dataQuality === "incomplete") level = "low";
  else if (input.candidateUnknown > 0 || freshness === "stale" || freshness === "unknown") level = level === "high" ? "medium" : level;
  if (benchmarkBacked && (benchmarkFreshness === "stale" || benchmarkFreshness === "unknown")) level = level === "high" ? "medium" : "low";
  if (benchmarkSourceCheckNeedsReview === true) level = level === "high" ? "medium" : "low";
  if (catalogSpecSourceCheckNeedsReview === true) level = level === "high" ? "medium" : "low";

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
    priceEvidence,
    sourceAvailable,
    benchmarkBacked,
    ...(benchmarkFreshness ? { benchmarkFreshness } : {}),
    ...(benchmarkSourceCheckNeedsReview !== undefined ? { benchmarkSourceCheckNeedsReview } : {}),
    ...(catalogSpecSourceCheckNeedsReview !== undefined ? { catalogSpecSourceCheckNeedsReview } : {}),
    ...(input.benchmarkSourceKind ? { benchmarkSourceKind: input.benchmarkSourceKind } : {}),
    reasons: [...new Set(reasons)]
  };
}
