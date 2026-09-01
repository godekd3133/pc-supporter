import type { SimilarityEvidence } from "../shared/types";

export const ALTERNATIVE_PERFORMANCE_FILTERS = ["all", "similar", "verified", "benchmark"] as const;
export type AlternativePerformanceFilter = (typeof ALTERNATIVE_PERFORMANCE_FILTERS)[number];

export type AlternativePerformanceSimilarity = {
  similarityLabel?: "동급" | "유사" | "대안";
  similarityEvidence?: SimilarityEvidence;
};

export function alternativePerformanceFilterFromUnknown(value: unknown): AlternativePerformanceFilter {
  return value === "similar" || value === "verified" || value === "benchmark" ? value : "all";
}

export function alternativePerformanceMatches(filter: AlternativePerformanceFilter, similarity: AlternativePerformanceSimilarity) {
  if (filter === "all") return true;
  const evidence = similarity.similarityEvidence;
  if (!evidence || evidence.comparedDimensions < 2) return false;
  if (filter === "similar") return similarity.similarityLabel === "동급" || similarity.similarityLabel === "유사";
  if (filter === "verified") return evidence.confidence === "high";
  return evidence.basis === "benchmark" || evidence.basis === "mixed";
}
