import { describe, expect, it } from "vitest";
import { candidateComparisonDecisionFor, candidateComparisonTradeoffsFor } from "./candidate-comparison";

const candidates = [
  {
    id: "safe-balanced",
    name: "균형 부품",
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
    name: "저가 확인 부품",
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
    name: "차단 부품",
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
    expect(result.top).toMatchObject({ id: "safe-balanced", name: "균형 부품" });
    expect(result.excludedIds).toEqual(["unsafe"]);
    expect(result.summary).toContain("적용하지 않음 1개 제외");
  });

  it("lets price win only when the candidate remains eligible", () => {
    const result = candidateComparisonDecisionFor(candidates, "price");

    expect(result.top?.id).toBe("cheap-review");
    expect(result.top?.reason).toContain("50,000원");
  });

  it("does not rank a project reference price as a confirmed price", () => {
    const result = candidateComparisonDecisionFor([
      ...candidates,
      { id: "reference", name: "참고 가격 부품", priceWon: 1000, priceEvidence: "reference" as const }
    ], "price");

    expect(result.top?.id).toBe("cheap-review");
    expect(result.ranking.find((item) => item.id === "reference")?.reason).toContain("실판매가가 아니어서 가격 점수를 산정하지 않음");
  });

  it("uses similarity for performance but never recommends an unsafe top candidate", () => {
    const result = candidateComparisonDecisionFor(candidates, "performance");

    expect(result.ranking[0].id).toBe("unsafe");
    expect(result.top?.id).toBe("safe-balanced");
    expect(result.top?.reason).toContain("성능 종합 82점 · 부품 유사도 82점");
  });

  it("shows performance comparison coverage and basis in the ranking reason", () => {
    const result = candidateComparisonDecisionFor([{
      id: "mixed-evidence",
      name: "혼합 정보 부품",
      similarityScore: 84,
      similarityEvidence: { comparedDimensions: 3, totalDimensions: 5, confidence: "limited", basis: "mixed" },
      candidateRisk: "safe"
    }], "performance");

    expect(result.top?.reason).toContain("비교 3/5 · 성능 측정·부품 정보 · 일부 정보로 비교");
  });

  it("blends component similarity with the full-build result when available", () => {
    const result = candidateComparisonDecisionFor([
      { ...candidates[0], id: "component-strong", name: "부품 유사도 우수", similarityScore: 88, analysisScore: 40, analysisScoreDelta: -40 },
      { ...candidates[0], id: "build-balanced", name: "적용 후 균형 부품", similarityScore: 82, analysisScore: 90, analysisScoreDelta: 10 }
    ], "performance");

    expect(result.top?.id).toBe("build-balanced");
    expect(result.top?.reason).toContain("성능 종합 84점");
    expect(result.top?.reason).toContain("현재 대비 +10점");
    expect(result.summary).toContain("교체 후 전체 성능");
  });

  it("reduces the influence of limited analysis and ignores unknown analysis evidence", () => {
    const result = candidateComparisonDecisionFor([
      { id: "high", name: "완전 자료", similarityScore: 80, analysisScore: 100, analysisConfidence: "high" },
      { id: "limited", name: "부분 자료", similarityScore: 80, analysisScore: 100, analysisConfidence: "limited" },
      { id: "unknown", name: "정보 미확인", similarityScore: 80, analysisScore: 100, analysisConfidence: "unknown" }
    ], "performance");

    expect(result.ranking.map((item) => item.id)).toEqual(["high", "limited", "unknown"]);
    expect(result.ranking[0].score).toBe(85);
    expect(result.ranking[1].score).toBe(82);
    expect(result.ranking[2].score).toBe(80);
    expect(result.ranking[1].reason).toContain("일부 정보로 계산");
    expect(result.ranking[2].reason).toContain("정보 확인 필요");
  });

  it("downgrades stale or physically unverified evidence in the evidence and balanced scores", () => {
    const stale = { ...candidates[0], id: "stale", name: "오래된 고성능 부품", freshness: "stale" as const, physicalStatus: "review" as const, recommendationTrustScore: 98, similarityScore: 99 };
    const fresh = { ...candidates[0], id: "fresh", name: "최근 확인 부품", recommendationTrustScore: 90 };
    const result = candidateComparisonDecisionFor([stale, fresh], "evidence");
    const balanced = candidateComparisonDecisionFor([stale, fresh], "balanced");

    expect(result.top?.id).toBe("fresh");
    expect(balanced.top?.id).toBe("fresh");
  });

  it("keeps genuine candidate tradeoffs and marks a fully dominated scenario", () => {
    const result = candidateComparisonTradeoffsFor([
      { id: "cheap", name: "저렴한 부품", priceDeltaWon: 0, analysisScore: 70, analysisConfidence: "high", recommendationTrustScore: 80, remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 0 },
      { id: "performance", name: "성능 부품", priceDeltaWon: 100000, analysisScore: 90, analysisConfidence: "high", recommendationTrustScore: 90, remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 0 },
      { id: "dominated", name: "밀림 부품", priceDeltaWon: 150000, analysisScore: 80, analysisConfidence: "high", recommendationTrustScore: 70, remainingBlockers: 0, remainingWarnings: 1, remainingUnknown: 0 },
      { id: "unsafe", name: "차단 부품", priceDeltaWon: -100000, analysisScore: 100, analysisConfidence: "high", recommendationTrustScore: 100, candidateRisk: "unsafe", remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 0 }
    ]);

    expect(result.find((item) => item.id === "cheap")?.frontier).toBe(true);
    expect(result.find((item) => item.id === "performance")?.frontier).toBe(true);
    expect(result.find((item) => item.id === "dominated")).toMatchObject({ frontier: false, dominatedByCandidateId: "performance", riskScore: 10 });
    expect(result.find((item) => item.id === "unsafe")).toMatchObject({ frontier: false, eligible: false });
  });

  it("does not order candidates when only one candidate has a confirmed scenario price", () => {
    const result = candidateComparisonTradeoffsFor([
      { id: "known", name: "가격 확인", priceDeltaWon: 0, remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 0 },
      { id: "unknown", name: "가격 확인 필요", remainingBlockers: 1, remainingWarnings: 0, remainingUnknown: 0 }
    ]);

    expect(result.every((item) => item.frontier)).toBe(true);
  });
});
