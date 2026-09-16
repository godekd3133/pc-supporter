import { describe, expect, it } from "vitest";
import { alternativeComparisonExpired, parseAlternativeComparisonInput, publicAlternativeComparison, savedAlternativeComparisonFromUnknown } from "./comparison-share";

const candidate = (overrides: Record<string, unknown> = {}) => ({
  name: "테스트 부품",
  category: "gpu",
  partId: "gpu-test-1",
  summary: "RTX 5070 · 12GB",
  price: "1,200,000원",
  priceWon: 1200000,
  priceEvidence: "live",
  purchaseCondition: "가격 확인 · 신품·정식 유통",
  similarity: "대안 43점 · 정보 충분",
  performance: "VRAM 32GB → 12GB (-62.5%)",
  compatibility: "호환 확인",
  decisionSummary: "추천 부품 · 현재 문제 해결 · 새 차단 없음",
  physicalEvidence: "확인 필요 · 장착 정보",
  physicalEvidenceSources: [{ category: "gpu", manufacturerModel: "GPU-TEST-1", manufacturerRevision: "rev-A", updatedAt: "2026-09-01", note: "GPU 제조사 문서", url: "https://vendor.example/gpu" }, { category: "case", manufacturerModel: "CASE-TEST-1", note: "케이스 설명서", url: "http://unsafe.example/case" }],
  recommendationTrust: "높음 90점",
  dataQuality: "다나와 최신",
  dataFreshness: "stale",
  updatedAt: "2026-08-28",
  sourceUrl: "https://prod.danawa.com/info/?pcode=123",
  ...overrides
});

describe("alternative comparison share", () => {
  it("normalizes a bounded public comparison payload and strips unsafe source URLs", () => {
    const result = parseAlternativeComparisonInput({ name: "  GPU 비교  ", category: "그래픽카드", currentPartName: "RTX 5090", currentPartSummary: "PCIe 5.0 · VRAM 32GB", currentPartPrice: "3,200,000원", catalogSnapshotAt: "2026-09-01T00:00:00.000Z", engineVersion: "engine-test", candidates: [candidate(), candidate({ sourceUrl: "https://example.com/unsafe" })], expiresInDays: 30 });
    expect(result.errors).toEqual([]);
    expect(result.name).toBe("GPU 비교");
    expect(result.currentPartName).toBe("RTX 5090");
    expect(result.currentPartSummary).toBe("PCIe 5.0 · VRAM 32GB");
    expect(result.currentPartPrice).toBe("3,200,000원");
    expect(result.catalogSnapshotAt).toBe("2026-09-01T00:00:00.000Z");
    expect(result.engineVersion).toBe("engine-test");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].sourceUrl).toBe("https://prod.danawa.com/info/?pcode=123");
    expect(result.candidates[0]).toMatchObject({ category: "gpu", partId: "gpu-test-1" });
    expect(result.candidates[0].priceWon).toBe(1200000);
    expect(result.candidates[0].priceEvidence).toBe("live");
    expect(result.candidates[0].purchaseCondition).toBe("가격 확인 · 신품·정식 유통");
    expect(result.candidates[0].recommendationTrust).toBe("높음 90점");
    expect(result.candidates[0].decisionSummary).toBe("추천 부품 · 현재 문제 해결 · 새 차단 없음");
    expect(result.candidates[0].gpuTarget).toBeUndefined();
    expect(result.candidates[0].dataFreshness).toBe("stale");
    expect(result.candidates[0].physicalEvidence).toBe("확인 필요 · 장착 정보");
    expect(result.candidates[0].physicalEvidenceSources).toEqual([{ category: "gpu", manufacturerModel: "GPU-TEST-1", manufacturerRevision: "rev-A", updatedAt: "2026-09-01", note: "GPU 제조사 문서", url: "https://vendor.example/gpu" }, { category: "case", manufacturerModel: "CASE-TEST-1", note: "케이스 설명서" }]);
    expect(result.candidates[1].sourceUrl).toBeUndefined();
    expect(result.expiresInDays).toBe(30);
  });

  it("requires between two and three candidates", () => {
    expect(parseAlternativeComparisonInput({ candidates: [candidate()] }).errors[0]).toContain("2개 이상");
    expect(parseAlternativeComparisonInput({ candidates: [candidate(), candidate(), candidate(), candidate()] }).errors[0]).toContain("3개 이하");
  });

  it("rejects incomplete candidates and unsupported expiry values", () => {
    expect(parseAlternativeComparisonInput({ candidates: [candidate(), { name: "불완전" }] }).errors[0]).toContain("비교 정보가 부족");
    expect(parseAlternativeComparisonInput({ candidates: [candidate(), candidate()], expiresInDays: 14 }).errors[0]).toContain("무기한, 7일, 30일");
    expect(parseAlternativeComparisonInput({ candidates: [candidate({ partId: undefined }), candidate({ partId: "gpu-test-2" })] }).errors[0]).toContain("카탈로그 식별자");
    expect(parseAlternativeComparisonInput({ candidates: [candidate(), candidate()], catalogSnapshotAt: "not-a-date" }).errors[0]).toContain("카탈로그 기준 시점");
  });

  it("keeps a valid value score and rejects an invalid score scale", () => {
    const valued = parseAlternativeComparisonInput({ candidates: [candidate({ valueScore: 150, valueLabel: "가성비 균형", valueScoreScale: 200 }), candidate()] });
    expect(valued.errors).toEqual([]);
    expect(valued.candidates[0]).toMatchObject({ valueScore: 150, valueLabel: "가성비 균형", valueScoreScale: 200 });

    const invalid = parseAlternativeComparisonInput({ candidates: [candidate({ valueScore: 150, valueLabel: "가성비 균형", valueScoreScale: 100 }), candidate()] });
    expect(invalid.errors[0]).toContain("점수 스케일");

    const invalidPrice = parseAlternativeComparisonInput({ candidates: [candidate({ priceWon: 0 }), candidate()] });
    expect(invalidPrice.errors[0]).toContain("현재 가격 값");

    const invalidPriceEvidence = parseAlternativeComparisonInput({ candidates: [candidate({ priceEvidence: "checkout" }), candidate()] });
    expect(invalidPriceEvidence.errors[0]).toContain("가격 출처 값");
  });

  it("preserves optional GPU target evidence in a public comparison", () => {
    const gpuTarget = "QHD · 144Hz · 권장 VRAM 12GB · 현재 8GB → 부품 12GB · 권장 기준 충족";
    const result = parseAlternativeComparisonInput({ candidates: [candidate({ gpuTarget }), candidate()] });

    expect(result.errors).toEqual([]);
    expect(result.candidates[0].gpuTarget).toBe(gpuTarget);
  });

  it("preserves bounded original benchmark evidence and strips unsafe source URLs", () => {
    const sourceCheck = { requestedUrl: "https://review.example/gpu", checkedAt: "2026-09-03T00:00:00.000Z", status: "reachable", identityStatus: "matched", redirectCount: 0, httpStatus: 200 } as const;
    const benchmarkEvidence = {
      partId: "gpu-test-1",
      category: "gpu",
      name: "테스트 부품",
      rows: [
        { key: "gpu3dmarkTimeSpyScore", label: "3DMark Time Spy", value: 21000, unit: "점" },
        { key: "gpu3dmarkPortRoyalScore", label: "3DMark Port Royal", unit: "점" }
      ],
      presentCount: 1,
      totalCount: 2,
      status: "partial",
      provenance: { sourceKind: "independent_review", sourceNote: "독립 리뷰 측정표", sourceUrl: "https://review.example/gpu", updatedAt: "2026-09-02T00:00:00.000Z", sourceCheck },
      benchmarkFreshness: "fresh",
      dataUpdatedAt: "2026-09-03T00:00:00.000Z"
    };
    const result = parseAlternativeComparisonInput({ candidates: [candidate({ benchmarkEvidence }), candidate({ partId: "gpu-test-2" })] });

    expect(result.errors).toEqual([]);
    expect(result.candidates[0].benchmarkEvidence).toMatchObject({
      partId: "gpu-test-1",
      category: "gpu",
      presentCount: 1,
      totalCount: 2,
      status: "partial",
      provenance: { sourceKind: "independent_review", sourceUrl: "https://review.example/gpu" },
      sourceCheck: { requestedUrl: "https://review.example/gpu", status: "reachable", identityStatus: "matched" }
    });
    expect(result.candidates[0].benchmarkEvidence?.rows).toEqual(benchmarkEvidence.rows);

    const unsafe = parseAlternativeComparisonInput({ candidates: [candidate({ benchmarkEvidence: { ...benchmarkEvidence, provenance: { ...benchmarkEvidence.provenance, sourceUrl: "javascript:alert(1)" } } }), candidate({ partId: "gpu-test-2" })] });
    expect(unsafe.errors).toEqual([]);
    expect(unsafe.candidates[0].benchmarkEvidence?.provenance?.sourceUrl).toBeUndefined();
  });

  it("rejects malformed benchmark evidence and mismatched catalog identity", () => {
    const benchmarkEvidence = {
      partId: "gpu-test-1",
      category: "gpu",
      name: "테스트 부품",
      rows: [
        { key: "gpu3dmarkTimeSpyScore", label: "3DMark Time Spy", value: 1000001, unit: "점" },
        { key: "gpu3dmarkPortRoyalScore", label: "3DMark Port Royal", unit: "점" }
      ],
      benchmarkFreshness: "fresh",
      dataUpdatedAt: "2026-09-03T00:00:00.000Z"
    };
    expect(parseAlternativeComparisonInput({ candidates: [candidate({ benchmarkEvidence }), candidate({ partId: "gpu-test-2" })] }).errors[0]).toContain("원본 성능 점수 값");
    const validEvidence = { ...benchmarkEvidence, rows: [{ ...benchmarkEvidence.rows[0], value: 21000 }, benchmarkEvidence.rows[1]] };
    expect(parseAlternativeComparisonInput({ candidates: [candidate({ benchmarkEvidence: { ...validEvidence, partId: "gpu-other" } }), candidate({ partId: "gpu-test-2" })] }).errors[0]).toContain("카탈로그 식별자");
  });

  it("preserves structured similarity evidence while rejecting unsafe values", () => {
    const similarityEvidence = {
      comparedDimensions: 2,
      totalDimensions: 3,
      confidence: "high",
      basis: "spec",
      dimensions: [{ key: "vramGb", label: "VRAM", currentValue: "8GB", candidateValue: "12GB", score: 100, weight: 5, source: "selected" }],
      reference: { partId: "gpu-reference", partName: "확인 참조 GPU", category: "gpu", dataQuality: "live", updatedAt: "2026-09-01", transferredDimensions: ["gpuMemoryBandwidthGbps"], benchmarkSourceKind: "independent_review" },
      notes: ["같은 모델 계열의 카탈로그 참조로 누락값을 보완했습니다."]
    } as const;
    const result = parseAlternativeComparisonInput({ candidates: [candidate({ similarityEvidence }), candidate()] });
    expect(result.errors).toEqual([]);
    expect(result.candidates[0].similarityEvidence).toEqual(similarityEvidence);

    const invalid = parseAlternativeComparisonInput({ candidates: [candidate({ similarityEvidence: { ...similarityEvidence, dimensions: [{ ...similarityEvidence.dimensions[0], score: 101 }] } }), candidate()] });
    expect(invalid.errors[0]).toContain("성능 비교 지표 값");
  });

  it("preserves optional virtual application facts and rejects malformed scenario data", () => {
    const scenario = { status: "needs_review", blockerCount: 0, warningCount: 1, unknownCount: 2, analysisScore: 74, analysisScoreLabel: "보완 권장", analysisConfidence: "limited", analysisScoreDelta: -8, priceDeltaWon: 45000, purchaseDecision: "확인 후 구매", purchaseDecisionSummary: "주의·확인 필요를 확인한 뒤 구매하세요.", priceHistory: { windowDays: 30, sampleCount: 4, minPriceWon: 100000, currentPositionPercent: 80, hasDropThenRebound: true }, checks: [{ id: "compatibility", kind: "compatibility", status: "review", label: "미리 적용 후 잔여 위험 확인", detail: "확인 필요 2개를 확인하세요." }, { id: "price", kind: "price", status: "ready", label: "부품·적용 후 가격 확인", detail: "가격을 확인했습니다." }] };
    const valid = parseAlternativeComparisonInput({ candidates: [candidate({ scenario }), candidate()] });
    expect(valid.errors).toEqual([]);
    expect(valid.candidates[0].scenario).toEqual(scenario);

    const tradeoff = { frontier: false, eligible: true, riskScore: 10, priceDeltaWon: 45000, analysisScore: 74, evidenceScore: 82, dominatedByCandidateId: "gpu-test-2", reason: "다른 부품이 잔여 위험·가격 변화 기준으로 더 유리합니다." };
    const validTradeoff = parseAlternativeComparisonInput({ candidates: [candidate({ scenario: { ...scenario, tradeoff } }), candidate()] });
    expect(validTradeoff.errors).toEqual([]);
    expect(validTradeoff.candidates[0].scenario?.tradeoff).toEqual(tradeoff);

    const invalidTradeoff = parseAlternativeComparisonInput({ candidates: [candidate({ scenario: { ...scenario, tradeoff: { ...tradeoff, riskScore: -1 } } }), candidate()] });
    expect(invalidTradeoff.errors[0]).toContain("비교 우위 값");

    const invalidAnalysis = parseAlternativeComparisonInput({ candidates: [candidate({ scenario: { ...scenario, analysisScore: 101 } }), candidate()] });
    expect(invalidAnalysis.errors[0]).toContain("성능 분석 값");

    const invalid = parseAlternativeComparisonInput({ candidates: [candidate({ scenario: { ...scenario, status: "unknown" } }), candidate()] });
    expect(invalid.errors[0]).toContain("미리 적용 위험 수");

    const invalidChecks = parseAlternativeComparisonInput({ candidates: [candidate({ scenario: { ...scenario, checks: [{ ...scenario.checks[0], id: "duplicate" }, { ...scenario.checks[0], id: "duplicate" }] } }), candidate()] });
    expect(invalidChecks.errors[0]).toContain("구매 전 확인 항목 값");
  });

  it("normalizes persisted records and removes owner credentials from public responses", () => {
    const record = savedAlternativeComparisonFromUnknown({ id: "comparison-1", name: "비교", candidates: [candidate(), candidate()], createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z", ownerTokenHash: "a".repeat(64) });
    expect(record).toBeDefined();
    expect(publicAlternativeComparison(record!)).not.toHaveProperty("ownerTokenHash");
    expect(publicAlternativeComparison(record!)).toMatchObject({ id: "comparison-1", name: "비교", candidates: expect.any(Array) });
  });

  it("treats expired and malformed expiry timestamps as unavailable", () => {
    expect(alternativeComparisonExpired({ expiresAt: "2026-08-27T00:00:00.000Z" }, Date.parse("2026-08-28T00:00:00.000Z"))).toBe(true);
    expect(alternativeComparisonExpired({ expiresAt: "not-a-date" }, Date.parse("2026-08-28T00:00:00.000Z"))).toBe(true);
    expect(alternativeComparisonExpired({}, Date.parse("2026-08-28T00:00:00.000Z"))).toBe(false);
  });
});
