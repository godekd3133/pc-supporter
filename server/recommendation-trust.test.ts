import { describe, expect, it } from "vitest";
import type { Part, SimilarityEvidence } from "../shared/types";
import { compareRecommendationTrust, recommendationTrustCountsFor, recommendationTrustFilterFromUnknown, recommendationTrustFor, recommendationTrustMatchesFilter } from "./recommendation-trust";

function candidate(overrides: Partial<Part> = {}): Pick<Part, "dataQuality" | "missingFields" | "priceWon" | "updatedAt" | "danawaUrl" | "specs"> {
  return {
    dataQuality: "live",
    missingFields: [],
    priceWon: 120000,
    updatedAt: "2026-08-31T00:00:00.000Z",
    danawaUrl: "https://prod.danawa.com/info/?pcode=123",
    specs: {},
    ...overrides
  };
}

const benchmarkEvidence: SimilarityEvidence = {
  comparedDimensions: 4,
  totalDimensions: 4,
  confidence: "high",
  basis: "benchmark"
};

describe("recommendation trust", () => {
  it("counts the trust distribution without changing candidate ordering", () => {
    expect(recommendationTrustCountsFor([{ level: "high" }, { level: "medium" }, { level: "medium" }, { level: "low" }])).toEqual({ high: 1, medium: 2, low: 1 });
  });

  it("orders higher trust before lower trust and keeps missing evidence last", () => {
    const high = recommendationTrustFor({ candidate: candidate(), similarityEvidence: benchmarkEvidence, resolvesTarget: true, candidateBlockers: 0, candidateWarnings: 0, candidateUnknown: 0, remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 0, now: "2026-08-31T12:00:00.000Z" });
    const highLowerScore = { ...high, score: high.score - 1 };
    const medium = { ...high, level: "medium" as const, score: 100 };
    expect(compareRecommendationTrust(high, medium)).toBeLessThan(0);
    expect(compareRecommendationTrust(highLowerScore, high)).toBeGreaterThan(0);
    expect(compareRecommendationTrust(undefined, high)).toBeGreaterThan(0);
  });

  it("normalizes and applies the selectable trust filters", () => {
    const high = recommendationTrustFor({ candidate: candidate(), similarityEvidence: benchmarkEvidence, resolvesTarget: true, candidateBlockers: 0, candidateWarnings: 0, candidateUnknown: 0, remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 0, now: "2026-08-31T12:00:00.000Z" });
    const medium = { ...high, level: "medium" as const };
    expect(recommendationTrustFilterFromUnknown(undefined)).toBe("all");
    expect(recommendationTrustFilterFromUnknown("medium_plus")).toBe("medium_plus");
    expect(recommendationTrustFilterFromUnknown("high")).toBe("high");
    expect(recommendationTrustFilterFromUnknown("unsupported")).toBe("all");
    expect(recommendationTrustMatchesFilter("all", undefined)).toBe(true);
    expect(recommendationTrustMatchesFilter("medium_plus", medium)).toBe(true);
    expect(recommendationTrustMatchesFilter("high", medium)).toBe(false);
    expect(recommendationTrustMatchesFilter("high", high)).toBe(true);
    expect(recommendationTrustMatchesFilter("medium_plus", undefined)).toBe(false);
  });

  it("marks a fully compatible, fresh, benchmark-backed candidate as high trust", () => {
    const result = recommendationTrustFor({
      candidate: candidate(),
      similarityEvidence: benchmarkEvidence,
      resolvesTarget: true,
      benchmarkSourceKind: "official",
      candidateBlockers: 0,
      candidateWarnings: 0,
      candidateUnknown: 0,
      remainingBlockers: 0,
      remainingWarnings: 0,
      remainingUnknown: 0,
      now: "2026-08-31T12:00:00.000Z"
    });

    expect(result).toMatchObject({
      level: "high",
      compatibility: "verified",
      candidateBlockerCount: 0,
      candidateWarningCount: 0,
      candidateUnknownCount: 0,
      fullBuildStatus: "clean",
      freshness: "fresh",
      comparedDimensions: 4,
      totalDimensions: 4,
      priceKnown: true,
      sourceAvailable: true,
      benchmarkBacked: true,
      benchmarkSourceKind: "official"
    });
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.reasons).toEqual(expect.arrayContaining([
      "현재 문제를 해결하는 부품입니다.",
      "부품 자체를 적용해 새 차단 오류와 확인 필요가 없습니다."
    ]));
  });

  it("keeps a numeric project reference price out of the confirmed-price trust bonus", () => {
    const live = recommendationTrustFor({ candidate: candidate(), similarityEvidence: benchmarkEvidence, resolvesTarget: true, candidateBlockers: 0, candidateWarnings: 0, candidateUnknown: 0, remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 0, now: "2026-08-31T12:00:00.000Z" });
    const reference = recommendationTrustFor({ candidate: candidate({ dataQuality: "seed" }), similarityEvidence: benchmarkEvidence, resolvesTarget: true, candidateBlockers: 0, candidateWarnings: 0, candidateUnknown: 0, remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 0, now: "2026-08-31T12:00:00.000Z" });

    expect(reference).toMatchObject({ priceKnown: true, priceEvidence: "reference" });
    expect(reference.score).toBeLessThan(live.score);
    expect(reference.reasons).toContain("참고 가격가 있어 총액 비교에 참고할 수 있지만 실제 판매가로 정하지 않아요.");
  });

  it("keeps a safe candidate highly rated while reporting unrelated build issues separately", () => {
    const result = recommendationTrustFor({
      candidate: candidate(),
      similarityEvidence: benchmarkEvidence,
      resolvesTarget: true,
      candidateBlockers: 0,
      candidateWarnings: 0,
      candidateUnknown: 0,
      remainingBlockers: 4,
      remainingWarnings: 2,
      remainingUnknown: 1,
      now: "2026-08-31T12:00:00.000Z"
    });

    expect(result).toMatchObject({
      level: "high",
      compatibility: "verified",
      fullBuildStatus: "remaining_issues",
      candidateBlockerCount: 0,
      remainingBlockerCount: 4,
      remainingWarningCount: 2,
      remainingUnknownCount: 1
    });
    expect(result.reasons).toContain("전체 견적에는 차단 4개·주의 2개·확인 필요 1개가 남아 이 부품 하나로 전체 해결되지는 않습니다.");
  });

  it("gives structured official benchmark provenance more weight than an unclassified score", () => {
    const official = recommendationTrustFor({ candidate: candidate(), similarityEvidence: benchmarkEvidence, resolvesTarget: true, benchmarkSourceKind: "official", candidateBlockers: 0, candidateWarnings: 0, candidateUnknown: 0, remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 0, now: "2026-08-31T12:00:00.000Z" });
    const unclassified = recommendationTrustFor({ candidate: candidate(), similarityEvidence: benchmarkEvidence, resolvesTarget: true, candidateBlockers: 0, candidateWarnings: 0, candidateUnknown: 0, remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 0, now: "2026-08-31T12:00:00.000Z" });

    expect(official.score).toBeGreaterThan(unclassified.score);
    expect(official.reasons).toContain("벤치마크 출처: 제조사·공식 측정표");
    expect(unclassified.reasons).toContain("벤치마크 출처가 분류되지 않았습니다.");
  });

  it("downgrades trust and exposes stale benchmark freshness", () => {
    const result = recommendationTrustFor({
      candidate: candidate(),
      similarityEvidence: benchmarkEvidence,
      resolvesTarget: true,
      benchmarkSourceKind: "official",
      benchmarkFreshness: "stale",
      candidateBlockers: 0,
      candidateWarnings: 0,
      candidateUnknown: 0,
      remainingBlockers: 0,
      remainingWarnings: 0,
      remainingUnknown: 0,
      now: "2026-08-31T12:00:00.000Z"
    });

    expect(result).toMatchObject({ level: "medium", benchmarkBacked: true, benchmarkFreshness: "stale" });
    expect(result.reasons).toContain("벤치마크 자료가 오래되어 최신 측정값을 다시 확인해야 합니다.");
  });

  it("downgrades trust when the benchmark source check cannot verify the registered model", () => {
    const result = recommendationTrustFor({
      candidate: candidate(),
      similarityEvidence: benchmarkEvidence,
      resolvesTarget: true,
      benchmarkSourceKind: "official",
      benchmarkFreshness: "fresh",
      benchmarkSourceCheck: { requestedUrl: "https://vendor.example/wrong", checkedAt: "2026-08-31T11:59:00.000Z", status: "identity_mismatch", identityStatus: "not_found", redirectCount: 0, httpStatus: 200 },
      candidateBlockers: 0,
      candidateWarnings: 0,
      candidateUnknown: 0,
      remainingBlockers: 0,
      remainingWarnings: 0,
      remainingUnknown: 0,
      now: "2026-08-31T12:00:00.000Z"
    });

    expect(result).toMatchObject({ level: "medium", benchmarkSourceCheckNeedsReview: true });
    expect(result.reasons).toContain("벤치마크 출처 페이지 접근·모델 식별을 다시 확인해야 해요.");
  });

  it("downgrades trust before a manual catalog-spec source has been checked", () => {
    const result = recommendationTrustFor({
      candidate: candidate({
        dataQuality: "manual",
        specs: {
          catalogSpecProvenance: {
            manufacturerModel: "MANUAL-GPU-16",
            sourceNote: "제조사 데이터시트",
            sourceUrl: "https://vendor.example/manual-gpu-16",
            updatedAt: "2026-08-31T00:00:00.000Z",
            fields: ["powerW"],
            baseSpecValues: {},
            baseDataQuality: "incomplete",
            baseMissingFields: ["powerW"],
            baseUpdatedAt: "2026-08-01T00:00:00.000Z"
          }
        }
      }),
      similarityEvidence: benchmarkEvidence,
      resolvesTarget: true,
      benchmarkSourceKind: "official",
      benchmarkFreshness: "fresh",
      candidateBlockers: 0,
      candidateWarnings: 0,
      candidateUnknown: 0,
      remainingBlockers: 0,
      remainingWarnings: 0,
      remainingUnknown: 0,
      now: "2026-08-31T12:00:00.000Z"
    });

    expect(result).toMatchObject({ level: "medium", catalogSpecSourceCheckNeedsReview: true });
    expect(result.reasons).toEqual(expect.arrayContaining([
      "제조사 정보 수동 보강값",
      "제조사 정보 페이지 접근·모델 식별을 확인하기 전이에요."
    ]));
  });

  it("restores trust only when a manual catalog-spec source is reachable and model-matched", () => {
    const result = recommendationTrustFor({
      candidate: candidate({
        dataQuality: "manual",
        specs: {
          catalogSpecProvenance: {
            manufacturerModel: "MANUAL-GPU-16",
            sourceNote: "제조사 데이터시트",
            sourceUrl: "https://vendor.example/manual-gpu-16",
            updatedAt: "2026-08-31T00:00:00.000Z",
            sourceCheck: {
              requestedUrl: "https://vendor.example/manual-gpu-16",
              checkedAt: "2026-08-31T11:59:00.000Z",
              status: "reachable",
              identityStatus: "matched",
              redirectCount: 0,
              httpStatus: 200
            },
            fields: ["powerW"],
            baseSpecValues: {},
            baseDataQuality: "incomplete",
            baseMissingFields: ["powerW"],
            baseUpdatedAt: "2026-08-01T00:00:00.000Z"
          }
        }
      }),
      similarityEvidence: benchmarkEvidence,
      resolvesTarget: true,
      benchmarkSourceKind: "official",
      benchmarkFreshness: "fresh",
      candidateBlockers: 0,
      candidateWarnings: 0,
      candidateUnknown: 0,
      remainingBlockers: 0,
      remainingWarnings: 0,
      remainingUnknown: 0,
      now: "2026-08-31T12:00:00.000Z"
    });

    expect(result).toMatchObject({ level: "high", catalogSpecSourceCheckNeedsReview: false });
    expect(result.reasons).toContain("제조사 정보 페이지 접근과 모델 식별을 확인했어요.");
  });

  it.each([
    ["identity mismatch", { status: "identity_mismatch" as const, identityStatus: "not_found" as const, checkedAt: "2026-08-31T11:59:00.000Z" }],
    ["stale", { status: "reachable" as const, identityStatus: "matched" as const, checkedAt: "2026-08-01T11:59:00.000Z" }],
    ["requested URL mismatch", { requestedUrl: "https://vendor.example/another-source", status: "reachable" as const, identityStatus: "matched" as const, checkedAt: "2026-08-31T11:59:00.000Z" }]
  ])("downgrades trust when a manual catalog-spec source check is %s", (_label, check) => {
    const result = recommendationTrustFor({
      candidate: candidate({
        dataQuality: "manual",
        specs: {
          catalogSpecProvenance: {
            manufacturerModel: "MANUAL-GPU-16",
            sourceNote: "제조사 데이터시트",
            sourceUrl: "https://vendor.example/manual-gpu-16",
            updatedAt: "2026-08-31T00:00:00.000Z",
            sourceCheck: {
              requestedUrl: "https://vendor.example/manual-gpu-16",
              redirectCount: 0,
              httpStatus: 200,
              ...check
            },
            fields: ["powerW"],
            baseSpecValues: {},
            baseDataQuality: "incomplete",
            baseMissingFields: ["powerW"],
            baseUpdatedAt: "2026-08-01T00:00:00.000Z"
          }
        }
      }),
      similarityEvidence: benchmarkEvidence,
      resolvesTarget: true,
      benchmarkSourceKind: "official",
      benchmarkFreshness: "fresh",
      candidateBlockers: 0,
      candidateWarnings: 0,
      candidateUnknown: 0,
      remainingBlockers: 0,
      remainingWarnings: 0,
      remainingUnknown: 0,
      now: "2026-08-31T12:00:00.000Z"
    });

    expect(result).toMatchObject({ level: "medium", catalogSpecSourceCheckNeedsReview: true });
    expect(result.reasons).toContain("제조사 정보 페이지 접근·모델 식별을 다시 확인해야 해요.");
  });

  it("downgrades trust when a candidate leaves unknowns or has stale incomplete data", () => {
    const result = recommendationTrustFor({
      candidate: candidate({ dataQuality: "incomplete", missingFields: ["socket", "powerW", "lengthMm"], priceWon: undefined, updatedAt: "2026-07-01T00:00:00.000Z", danawaUrl: undefined }),
      similarityEvidence: { comparedDimensions: 1, totalDimensions: 4, confidence: "limited", basis: "spec" },
      resolvesTarget: true,
      candidateBlockers: 0,
      candidateWarnings: 1,
      candidateUnknown: 1,
      remainingBlockers: 0,
      remainingWarnings: 1,
      remainingUnknown: 1,
      now: "2026-08-31T12:00:00.000Z"
    });

    expect(result.level).toBe("low");
    expect(result.compatibility).toBe("review");
    expect(result.candidateUnknownCount).toBe(1);
    expect(result.fullBuildStatus).toBe("remaining_issues");
    expect(result.freshness).toBe("stale");
    expect(result.priceKnown).toBe(false);
    expect(result.sourceAvailable).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      "부품 자체의 차단 오류는 없지만 확인 필요 1개가 남습니다.",
      "누락 스펙 3개가 있어 실제 정보 확인이 필요해요.",
      "현재 가격을 확인할 수 없어 총액 비교는 정하지 않아요."
    ]));
  });

  it("does not call an exact quantity adjustment a performance comparison", () => {
    const result = recommendationTrustFor({
      candidate: candidate(),
      similarityEvidence: { comparedDimensions: 0, totalDimensions: 0, confidence: "unknown" },
      resolvesTarget: true,
      candidateBlockers: 0,
      candidateWarnings: 0,
      candidateUnknown: 0,
      remainingBlockers: 0,
      remainingWarnings: 0,
      remainingUnknown: 0,
      now: "2026-08-31T12:00:00.000Z"
    });

    expect(result.reasons).toContain("성능 유사도를 계산할 비교 스펙이 없습니다.");
    expect(result.comparedDimensions).toBe(0);
    expect(result.totalDimensions).toBe(0);
  });
});
