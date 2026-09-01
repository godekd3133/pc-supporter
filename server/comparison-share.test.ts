import { describe, expect, it } from "vitest";
import { alternativeComparisonExpired, parseAlternativeComparisonInput, publicAlternativeComparison, savedAlternativeComparisonFromUnknown } from "./comparison-share";

const candidate = (overrides: Record<string, unknown> = {}) => ({
  name: "테스트 후보",
  summary: "RTX 5070 · 12GB",
  price: "1,200,000원",
  purchaseCondition: "가격 확인 · 신품·정식 유통",
  similarity: "대안 43점 · 근거 충분",
  performance: "VRAM 32GB → 12GB (-62.5%)",
  compatibility: "호환 확인",
  decisionSummary: "추천 후보 · 현재 문제 해결 · 새 차단 없음",
  physicalEvidence: "확인 필요 · 물리 근거",
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
    const result = parseAlternativeComparisonInput({ name: "  GPU 비교  ", category: "그래픽카드", currentPartName: "RTX 5090", candidates: [candidate(), candidate({ sourceUrl: "https://example.com/unsafe" })], expiresInDays: 30 });
    expect(result.errors).toEqual([]);
    expect(result.name).toBe("GPU 비교");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].sourceUrl).toBe("https://prod.danawa.com/info/?pcode=123");
    expect(result.candidates[0].purchaseCondition).toBe("가격 확인 · 신품·정식 유통");
    expect(result.candidates[0].recommendationTrust).toBe("높음 90점");
    expect(result.candidates[0].decisionSummary).toBe("추천 후보 · 현재 문제 해결 · 새 차단 없음");
    expect(result.candidates[0].dataFreshness).toBe("stale");
    expect(result.candidates[0].physicalEvidence).toBe("확인 필요 · 물리 근거");
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
  });

  it("keeps a valid value score and rejects an invalid score scale", () => {
    const valued = parseAlternativeComparisonInput({ candidates: [candidate({ valueScore: 150, valueLabel: "가성비 균형", valueScoreScale: 200 }), candidate()] });
    expect(valued.errors).toEqual([]);
    expect(valued.candidates[0]).toMatchObject({ valueScore: 150, valueLabel: "가성비 균형", valueScoreScale: 200 });

    const invalid = parseAlternativeComparisonInput({ candidates: [candidate({ valueScore: 150, valueLabel: "가성비 균형", valueScoreScale: 100 }), candidate()] });
    expect(invalid.errors[0]).toContain("점수 스케일");
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
