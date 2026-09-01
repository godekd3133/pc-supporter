import { describe, expect, it } from "vitest";
import { candidateComparisonDecisionFor } from "./candidate-comparison";

const candidates = [
  {
    id: "safe-balanced",
    name: "균형 후보",
    priceWon: 100000,
    similarityScore: 82,
    recommendationTrustScore: 86,
    candidateRisk: "safe" as const,
    decisionStatus: "recommended" as const,
    freshness: "fresh" as const,
    physicalStatus: "verified" as const
  },
  {
    id: "cheap-review",
    name: "저가 확인 후보",
    priceWon: 50000,
    similarityScore: 55,
    recommendationTrustScore: 62,
    candidateRisk: "review" as const,
    decisionStatus: "review" as const,
    freshness: "aging" as const,
    physicalStatus: "review" as const,
    remainingUnknown: 1
  },
  {
    id: "unsafe",
    name: "차단 후보",
    priceWon: 20000,
    similarityScore: 99,
    recommendationTrustScore: 95,
    candidateRisk: "unsafe" as const,
    decisionStatus: "avoid" as const,
    freshness: "fresh" as const
  }
];

describe("candidate comparison decision", () => {
  it("chooses the best eligible candidate for the compatibility criterion", () => {
    const result = candidateComparisonDecisionFor(candidates, "compatibility");

    expect(result.label).toBe("호환 우선");
    expect(result.top).toMatchObject({ id: "safe-balanced", name: "균형 후보" });
    expect(result.excludedIds).toEqual(["unsafe"]);
    expect(result.summary).toContain("적용하지 않음 1개 제외");
  });

  it("lets price win only when the candidate remains eligible", () => {
    const result = candidateComparisonDecisionFor(candidates, "price");

    expect(result.top?.id).toBe("cheap-review");
    expect(result.top?.reason).toContain("50,000원");
  });

  it("uses similarity for performance but never recommends an unsafe top candidate", () => {
    const result = candidateComparisonDecisionFor(candidates, "performance");

    expect(result.ranking[0].id).toBe("unsafe");
    expect(result.top?.id).toBe("safe-balanced");
    expect(result.top?.reason).toContain("성능 유사도 82점");
  });

  it("downgrades stale or physically unverified evidence in the evidence and balanced scores", () => {
    const stale = { ...candidates[0], id: "stale", name: "오래된 고성능 후보", freshness: "stale" as const, physicalStatus: "review" as const, recommendationTrustScore: 98, similarityScore: 99 };
    const fresh = { ...candidates[0], id: "fresh", name: "최근 확인 후보", recommendationTrustScore: 90 };
    const result = candidateComparisonDecisionFor([stale, fresh], "evidence");
    const balanced = candidateComparisonDecisionFor([stale, fresh], "balanced");

    expect(result.top?.id).toBe("fresh");
    expect(balanced.top?.id).toBe("fresh");
  });
});
