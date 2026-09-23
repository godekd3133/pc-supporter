import { describe, expect, it } from "vitest";
import type { CandidatePurchaseDecisionInput } from "./candidate-purchase-decision";
import { candidatePurchaseDecisionFor } from "./candidate-purchase-decision";

const base: CandidatePurchaseDecisionInput = {
  name: "테스트 부품",
  candidateRisk: "safe",
  decisionStatus: "recommended",
  nextStatus: "compatible",
  remainingBlockers: 0,
  remainingWarnings: 0,
  remainingUnknown: 0,
  priceKnown: true,
  totalPriceKnown: true,
  priceDeltaWon: -10000,
  similarityScore: 82,
  recommendationTrustLevel: "high",
  freshness: "fresh",
  physicalStatus: "verified"
};

describe("candidate purchase decision", () => {
  it("holds a candidate when the engine still reports a blocker", () => {
    const result = candidatePurchaseDecisionFor({ ...base, candidateRisk: "unsafe", remainingBlockers: 1, nextStatus: "incompatible" });

    expect(result).toMatchObject({ state: "hold", label: "적용 보류" });
    expect(result.reasons.join(" ")).toContain("차단");
  });

  it("requires review when any material uncertainty remains", () => {
    const result = candidatePurchaseDecisionFor({ ...base, remainingUnknown: 1 });

    expect(result).toMatchObject({ state: "review", label: "확인 후 구매" });
    expect(result.reasons.join(" ")).toContain("확인할 항목 1개");
  });

  it("does not claim readiness when the candidate or total price is unknown", () => {
    expect(candidatePurchaseDecisionFor({ ...base, priceKnown: false })).toMatchObject({ state: "review", label: "확인 후 구매" });
    expect(candidatePurchaseDecisionFor({ ...base, totalPriceKnown: false })).toMatchObject({ state: "review", label: "확인 후 구매" });
  });

  it("labels a high-performance, more-expensive candidate as performance-first", () => {
    const result = candidatePurchaseDecisionFor({ ...base, similarityScore: 97, priceDeltaWon: 120000 });

    expect(result).toMatchObject({ state: "performance", label: "성능 우선" });
    expect(result.summary).toContain("+120,000원");
  });

  it("does not call a high-similarity candidate performance-first when the full build score drops", () => {
    const result = candidatePurchaseDecisionFor({ ...base, similarityScore: 97, priceDeltaWon: 120000, analysisScoreDelta: -8 });

    expect(result).toMatchObject({ state: "review", label: "확인 후 구매" });
    expect(result.reasons.join(" ")).toContain("전체 성능 점수가 8점 낮아집니다");
  });

  it("keeps a project reference price in review instead of treating it as a purchase-ready price", () => {
    const result = candidatePurchaseDecisionFor({ ...base, priceEvidence: "reference" });

    expect(result).toMatchObject({ state: "review", label: "확인 후 구매" });
    expect(result.reasons).toContain("참고 가격입니다. 판매처에서 현재 가격을 확인하세요.");
  });

  it("requires review when a performance change has unknown analysis evidence", () => {
    const result = candidatePurchaseDecisionFor({ ...base, similarityScore: 97, priceDeltaWon: 120000, analysisScoreDelta: 8, analysisConfidence: "unknown" });

    expect(result).toMatchObject({ state: "review", label: "확인 후 구매" });
    expect(result.reasons.join(" ")).toContain("성능 점수를 계산할 정보가 부족합니다");
  });

  it("requires review when a high similarity score has limited comparison coverage", () => {
    const result = candidatePurchaseDecisionFor({ ...base, similarityScore: 97, similarityConfidence: "limited", priceDeltaWon: 120000 });

    expect(result).toMatchObject({ state: "review", label: "확인 후 구매" });
    expect(result.reasons.join(" ")).toContain("일부 자료만 사용됐습니다");
  });

  it("requires review when a high similarity score relies on stale benchmark data", () => {
    const result = candidatePurchaseDecisionFor({ ...base, similarityScore: 97, similarityConfidence: "high", benchmarkFreshness: "stale", priceDeltaWon: 120000 });

    expect(result).toMatchObject({ state: "review", label: "확인 후 구매" });
    expect(result.reasons.join(" ")).toContain("성능 비교 자료가 오래됐거나 갱신일을 알 수 없습니다");
  });

  it("requires review when the benchmark source check needs review", () => {
    const result = candidatePurchaseDecisionFor({ ...base, similarityScore: 97, similarityConfidence: "high", benchmarkSourceCheckNeedsReview: true, priceDeltaWon: 120000 });

    expect(result).toMatchObject({ state: "review", label: "확인 후 구매" });
    expect(result.reasons.join(" ")).toContain("성능 비교에 사용한 출처를 확인하세요.");
  });

  it("requires review when a manual catalog-spec source check needs review", () => {
    const result = candidatePurchaseDecisionFor({ ...base, catalogSpecSourceCheckNeedsReview: true });

    expect(result).toMatchObject({ state: "review", label: "확인 후 구매" });
    expect(result.reasons.join(" ")).toContain("직접 입력한 스펙과 제조사 모델명이 맞는지 확인하세요.");
  });

  it("suggests waiting when a compatible candidate is more expensive and near its recent high", () => {
    const result = candidatePurchaseDecisionFor({
      ...base,
      similarityScore: 84,
      priceDeltaWon: 20000,
      priceHistory: { sampleCount: 6, minPriceWon: 100000, latestPriceWon: 195000, fromHighPercent: -1.2, currentPositionPercent: 95, hasDropThenRebound: true }
    });

    expect(result).toMatchObject({ state: "wait", label: "가격 하락 대기" });
    expect(result.reasons.join(" ")).toContain("최근 내린 뒤 다시 올랐습니다.");
  });

  it("recommends a clean candidate when the price is known and not at a recent high", () => {
    const result = candidatePurchaseDecisionFor({
      ...base,
      priceDeltaWon: 15000,
      priceHistory: { sampleCount: 5, minPriceWon: 100000, latestPriceWon: 110000, fromHighPercent: -45, currentPositionPercent: 20, hasDropThenRebound: false }
    });

    expect(result).toMatchObject({ state: "buy", label: "구매 추천" });
  });
});
