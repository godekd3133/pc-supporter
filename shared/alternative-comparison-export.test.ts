import { describe, expect, it } from "vitest";
import { alternativeComparisonCsvFor, alternativeComparisonJsonFor, alternativeComparisonShareCandidatesFor, alternativeComparisonTextFor } from "./alternative-comparison-export";
import type { AlternativeComparisonCandidate } from "./alternative-comparison-export";

const candidates: AlternativeComparisonCandidate[] = [
  {
    name: "테스트, 부품",
    category: "gpu",
    partId: "gpu-test-1",
    priceWon: 1200000,
    priceEvidence: "live",
    summary: "RTX 5070 · 12GB",
    price: "1,200,000원",
    purchaseCondition: "다나와 수집가 · 신품·정식 유통",
    recommendedQuantity: 1,
    similarity: "대안 43점 · 정보 충분",
    gpuTarget: "QHD · 144Hz · 권장 VRAM 12GB · 현재 8GB → 부품 12GB · 권장 기준 충족",
    recommendationTrust: "높음 92점",
    performance: "VRAM 32GB → 12GB (-62.5%)",
    compatibility: "호환 확인",
    decisionSummary: "추천 부품 · 현재 문제 해결 · 새 차단 없음",
    physicalEvidence: "확인 필요 · GPU·케이스 장착 정보를 구매 전 확인해야 합니다.",
    physicalEvidenceSources: [{ category: "gpu", manufacturerModel: "GPU-TEST-1", manufacturerRevision: "rev-A", updatedAt: "2026-09-01", note: "GPU 제조사 설치 가이드", url: "https://vendor.example/gpu" }],
    dataQuality: "다나와 최신",
    dataFreshness: "aging",
    updatedAt: "2026-08-28",
    sourceUrl: "https://prod.danawa.com/info/?pcode=123"
  },
  {
    name: "미등록 부품\nCPU",
    summary: "스펙 확인 필요",
    price: "가격 확인 필요",
    similarity: "계산 불가",
    recommendationTrust: "낮음 38점",
    performance: "비교 정보 확인",
    compatibility: "확인 필요 · 전원",
    dataQuality: "일부 스펙 부족"
  }
];

describe("alternative comparison export", () => {
  it("allowlists customer-safe fields for comparison share requests", () => {
    const [candidate] = alternativeComparisonShareCandidatesFor([{
      ...candidates[0],
      similarityEvidence: { comparedDimensions: 1, totalDimensions: 1, confidence: "high", basis: "spec", dimensions: [{ key: "memoryType", label: "메모리", currentValue: "DDR4", candidateValue: "DDR5" }] },
      benchmarkEvidence: { partId: "gpu-test-1", category: "gpu", name: "RTX 5070", rows: [], presentCount: 0, totalCount: 0, status: "missing", benchmarkFreshness: "fresh", dataUpdatedAt: "2026-09-01" },
      scenario: {
        status: "compatible",
        blockerCount: 0,
        warningCount: 0,
        unknownCount: 0,
        analysisScore: 91,
        tradeoff: { frontier: true, riskScore: 2, reason: "private analysis" },
        checks: [{ id: "ok", kind: "compatibility", status: "ready", label: "호환", detail: "performance score hidden" }]
      }
    }]);

    expect(candidate).toMatchObject({ name: "테스트, 부품", category: "gpu", partId: "gpu-test-1", priceWon: 1200000, summary: "RTX 5070 · 12GB", price: "1,200,000원", compatibility: "호환 확인" });
    expect(candidate).not.toHaveProperty("similarity");
    expect(candidate).not.toHaveProperty("performance");
    expect(candidate).not.toHaveProperty("gpuTarget");
    expect(candidate).not.toHaveProperty("recommendationTrust");
    expect(candidate).not.toHaveProperty("benchmarkEvidence");
    expect(candidate).not.toHaveProperty("similarityEvidence");
    expect(candidate?.scenario).not.toHaveProperty("analysisScore");
    expect(candidate?.scenario).not.toHaveProperty("tradeoff");
    expect(candidate?.scenario?.checks?.[0]).not.toHaveProperty("detail");
  });

  it("writes a readable text comparison without dropping unknown values", () => {
    const text = alternativeComparisonTextFor(candidates);
    expect(text).toContain("[부품 1] 테스트, 부품");
    expect(text).toContain("가격: 1,200,000원 · 추천 수량 1개");
    expect(text).toContain("가격 확인: 확인됨");
    expect(text).toContain("구매 조건: 다나와 수집가 · 신품·정식 유통");
    expect(text).toContain("가격: -");
    expect(text).not.toContain("성능 유사도");
    expect(text).not.toContain("대안 43점");
    expect(text).not.toContain("QHD · 144Hz");
    expect(text).toContain("사양 차이: VRAM 32GB → 12GB (-62.5%)");
    expect(text).not.toContain("높음 92점");
    expect(text).not.toContain("낮음 38점");
    expect(text).toContain("설치 공간 확인: 확인 필요 · GPU·케이스 장착 정보를 구매 전 확인해야 합니다.");
    expect(text).toContain("비교 결론: 추천 부품 · 현재 문제 해결 · 새 차단 없음");
    expect(text).toContain("설치 안내: GPU · GPU-TEST-1 · rev-A · 확인 2026-09-01: GPU 제조사 설치 가이드 (https://vendor.example/gpu)");
    expect(text).toContain("부품 정보: 다나와 최신 · 확인한 지 오래됨 · 갱신 2026-08-28");
    expect(text).toContain("https://prod.danawa.com/info/?pcode=123");
  });

  it("quotes CSV values with commas and newlines", () => {
    const csv = alternativeComparisonCsvFor(candidates);
    expect(csv.startsWith("\uFEFF부품명,범주,부품 ID,핵심 스펙,가격,공유 당시 가격(원),가격 확인")).toBe(true);
    expect(csv).toContain('"테스트, 부품"');
    expect(csv).toContain('"미등록 부품\nCPU"');
    expect(csv).toContain("\"1,200,000원\",1200000,확인됨,다나와 수집가 · 신품·정식 유통,1,VRAM 32GB → 12GB (-62.5%),호환 확인,추천 부품 · 현재 문제 해결 · 새 차단 없음,,확인 필요 · GPU·케이스 장착 정보를 구매 전 확인해야 합니다.,GPU · GPU-TEST-1 · rev-A · 확인 2026-09-01: GPU 제조사 설치 가이드 (https://vendor.example/gpu),다나와 최신,확인한 지 오래됨,2026-08-28,https://prod.danawa.com/info/?pcode=123");
    expect(csv).not.toContain("성능 유사도");
    expect(csv).not.toContain("144Hz");
    expect(csv).not.toContain("높음 92점");
  });

  it("returns an empty export envelope for no selected candidates", () => {
    expect(alternativeComparisonTextFor([])).toBe("PC Supporter 부품 비교\n");
    expect(alternativeComparisonCsvFor([])).toBe("\uFEFF부품명,범주,부품 ID,핵심 스펙,가격,공유 당시 가격(원),가격 확인,구매 조건,추천 수량,사양 차이,호환 상태,비교 결론,부품 교체 시,설치 공간 확인,설치 안내,부품 정보 상태,갱신 상태,갱신일,상품 페이지");
  });

  it("writes a versioned JSON snapshot with unknown values and source links", () => {
    const parsed = JSON.parse(alternativeComparisonJsonFor(candidates)) as { type: string; version: number; exportedAt: string; items: typeof candidates };
    expect(parsed.type).toBe("pc-supporter-alternative-comparison");
    expect(parsed.version).toBe(1);
    expect(Number.isNaN(Date.parse(parsed.exportedAt))).toBe(false);
    expect(parsed.items[0]).toMatchObject({ name: "테스트, 부품", category: "gpu", partId: "gpu-test-1", priceWon: 1200000, recommendedQuantity: 1, sourceUrl: "https://prod.danawa.com/info/?pcode=123" });
    expect(parsed.items[0]).not.toHaveProperty("recommendationTrust");
    expect(parsed.items[0]).not.toHaveProperty("similarity");
    expect(parsed.items[0]).not.toHaveProperty("similarityEvidence");
    expect(parsed.items[0]).not.toHaveProperty("gpuTarget");
    expect(JSON.stringify(parsed)).not.toContain("144Hz");
    expect(parsed.items[1].price).toBe("-");
    expect(JSON.stringify(parsed)).not.toContain("낮음 38점");
    expect(JSON.stringify(parsed)).not.toContain("높음 92점");
  });

  it("preserves the current comparison baseline in text and JSON context without treating it as a candidate", () => {
    const context = { category: "그래픽카드", currentPartName: "현재 GPU · 수량 1개", currentPartSummary: "PCIe 4.0 · VRAM 8GB · 220W", currentPartPrice: "450,000원" };
    const text = alternativeComparisonTextFor(candidates, context);
    const csv = alternativeComparisonCsvFor(candidates, context);
    const parsed = JSON.parse(alternativeComparisonJsonFor(candidates, context)) as { context?: typeof context; items: typeof candidates };

    expect(text).toContain("비교 범주: 그래픽카드");
    expect(text).toContain("현재 부품: 현재 GPU · 수량 1개");
    expect(text).toContain("현재 부품 정보: PCIe 4.0 · VRAM 8GB · 220W");
    expect(text).toContain("현재 부품 가격: 450,000원");
    expect(csv.startsWith("\uFEFF부품명,범주,부품 ID,핵심 스펙,가격,공유 당시 가격(원),가격 확인,구매 조건,추천 수량,사양 차이,호환 상태,비교 결론,부품 교체 시,설치 공간 확인,설치 안내,부품 정보 상태,갱신 상태,갱신일,상품 페이지,비교 범주,현재 부품,현재 부품 정보,현재 부품 가격")).toBe(true);
    expect(csv).toContain(",그래픽카드,현재 GPU · 수량 1개,PCIe 4.0 · VRAM 8GB · 220W,\"450,000원\"");
    expect(parsed.context).toEqual(context);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items.some((item) => item.name === context.currentPartName)).toBe(false);
  });

  it("omits internal value scores from public exports while retaining prices and specification differences", () => {
    const valuedCandidate: AlternativeComparisonCandidate = { ...candidates[0], valueScore: 181, valueLabel: "가성비 우수", valueScoreScale: 200 };
    const text = alternativeComparisonTextFor([valuedCandidate]);
    const csv = alternativeComparisonCsvFor([valuedCandidate]);
    const jsonText = alternativeComparisonJsonFor([valuedCandidate]);
    const json = JSON.parse(jsonText) as { items: AlternativeComparisonCandidate[] };

    expect(text).not.toContain("가성비 평가");
    expect(text).not.toContain("가성비 우수");
    expect(text).toContain("가격: 1,200,000원");
    expect(text).toContain("VRAM 32GB → 12GB (-62.5%)");
    expect(csv).not.toContain("가성비 평가");
    expect(csv).not.toContain("181/200");
    expect(csv).toContain("1,200,000원");
    expect(csv).toContain("VRAM 32GB → 12GB (-62.5%)");
    expect(json.items[0]).not.toHaveProperty("valueScore");
    expect(json.items[0]).not.toHaveProperty("valueLabel");
    expect(json.items[0]).not.toHaveProperty("valueScoreScale");
    expect(jsonText).not.toContain("가성비 우수");
    expect(jsonText).not.toContain("181");
    expect(json.items[0].priceWon).toBe(1200000);
    expect(json.items[0].summary).toBe("RTX 5070 · 12GB");
  });

  it("keeps selected spec differences while removing similarity ranks, reference judgements, and GPU target fits", () => {
    const evidencedCandidate: AlternativeComparisonCandidate = {
      ...candidates[0],
      similarityEvidence: {
        comparedDimensions: 2,
        totalDimensions: 3,
        confidence: "high",
        basis: "spec",
        dimensions: [
          { key: "vramGb", label: "VRAM", currentValue: "8GB", candidateValue: "12GB", score: 100, weight: 6, source: "selected" },
          { key: "gpuMemoryBandwidthGbps", label: "VRAM 대역폭", currentValue: "224GB/s", candidateValue: "272GB/s", score: 100, weight: 6, source: "model_reference" },
          { key: "gpu3dmarkTimeSpyScore", label: "3DMark Time Spy", currentValue: "21000", candidateValue: "22000", score: 100, weight: 7, source: "model_reference" }
        ],
        reference: { partId: "gpu-reference", partName: "RTX 5070 확인 참조", category: "gpu", dataQuality: "live", updatedAt: "2026-09-01", transferredDimensions: ["gpuMemoryBandwidthGbps"], benchmarkSourceKind: "independent_review" },
        notes: ["선택 부품에 없는 지표를 같은 모델 계열 참조로 보완했습니다."]
      }
    };
    const text = alternativeComparisonTextFor([evidencedCandidate]);
    const csv = alternativeComparisonCsvFor([evidencedCandidate]);
    const json = JSON.parse(alternativeComparisonJsonFor([evidencedCandidate])) as { items: Array<Record<string, unknown>> };

    expect(text).toContain("사양 차이: VRAM 32GB → 12GB (-62.5%) / VRAM 8GB → 12GB");
    expect(text).not.toContain("성능 유사도");
    expect(text).not.toContain("비교 자료 충분");
    expect(text).not.toContain("같은 제품군 참고");
    expect(text).not.toContain("QHD · 144Hz");
    expect(csv).toContain("사양 차이");
    expect(csv).toContain("VRAM 8GB → 12GB");
    expect(csv).not.toContain("성능 비교 정보");
    expect(csv).not.toContain("RTX 5070 확인 참조");
    expect(json.items[0].specDifferences).toEqual([{ key: "vramGb", label: "VRAM", currentValue: "8GB", candidateValue: "12GB" }]);
    expect(json.items[0]).not.toHaveProperty("similarity");
    expect(json.items[0]).not.toHaveProperty("similarityEvidence");
    expect(json.items[0]).not.toHaveProperty("gpuTarget");
    expect(json.items[0].specSummary).toBe("VRAM 32GB → 12GB (-62.5%)");
    expect(JSON.stringify(json)).not.toContain("confidence");
    expect(JSON.stringify(json)).not.toContain("benchmarkSourceKind");
    expect(JSON.stringify(json)).not.toContain("gpu3dmarkTimeSpyScore");
    expect(JSON.stringify(json)).not.toContain("21000");
    expect(JSON.stringify(json)).not.toContain("22000");
    expect(JSON.stringify(json)).not.toContain("144Hz");
  });

  it("keeps CPU/GPU benchmark scores and provenance out of public text, CSV, and JSON exports", () => {
    const sourceCheckCheckedAt = new Date().toISOString();
    const benchmarkEvidence = {
      partId: "gpu-test-1",
      category: "gpu" as const,
      name: "테스트, 부품",
      rows: [
        { key: "gpu3dmarkTimeSpyScore" as const, label: "3DMark Time Spy", value: 21000, unit: "점" as const },
        { key: "gpu3dmarkPortRoyalScore" as const, label: "3DMark Port Royal", unit: "점" as const }
      ],
      presentCount: 1,
      totalCount: 2,
      status: "partial" as const,
      provenance: { sourceKind: "independent_review" as const, sourceNote: "독립 리뷰 측정표", sourceUrl: "https://review.example/gpu", updatedAt: "2026-09-02T00:00:00.000Z" },
      sourceCheck: { requestedUrl: "https://review.example/gpu", checkedAt: sourceCheckCheckedAt, status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0, httpStatus: 200 },
      benchmarkFreshness: "fresh" as const,
      dataUpdatedAt: "2026-09-03T00:00:00.000Z"
    };
    const evidencedCandidate: AlternativeComparisonCandidate = { ...candidates[0], performance: "3DMark Time Spy 21,000점 · 평균 144 FPS 측정", benchmarkEvidence };
    const text = alternativeComparisonTextFor([evidencedCandidate]);
    const csv = alternativeComparisonCsvFor([evidencedCandidate]);
    const json = alternativeComparisonJsonFor([evidencedCandidate]);

    expect(text).not.toContain("21,000");
    expect(text).not.toContain("144 FPS");
    expect(text).not.toContain("독립 리뷰 측정표");
    expect(csv).not.toContain("21,000");
    expect(csv).not.toContain("144 FPS");
    expect(csv).not.toContain("review.example");
    expect(json).not.toContain("benchmarkEvidence");
    expect(json).not.toContain("21000");
    expect(json).not.toContain("144 FPS");
    expect(json).not.toContain("independent_review");
    expect(json).not.toContain("review.example");
  });

  it("exports virtual application and purchase decision facts when present", () => {
    const scenario = { status: "needs_review" as const, blockerCount: 0, warningCount: 1, unknownCount: 2, analysisScore: 74, analysisScoreLabel: "보완 권장" as const, analysisConfidence: "limited" as const, analysisScoreDelta: -8, priceDeltaWon: 45000, purchaseDecision: "확인 후 구매", purchaseDecisionSummary: "주의·확인 필요를 확인한 뒤 구매하세요.", priceHistory: { windowDays: 30 as const, sampleCount: 4, minPriceWon: 100000, currentPositionPercent: 80, hasDropThenRebound: true }, checks: [{ id: "compatibility", kind: "compatibility" as const, status: "review" as const, label: "잔여 위험 확인", detail: "확인 필요 2개" }, { id: "price", kind: "price" as const, status: "ready" as const, label: "가격 확인", detail: "가격 확인 완료" }] };
    const valuedCandidate: AlternativeComparisonCandidate = { ...candidates[0], scenario };
    const text = alternativeComparisonTextFor([valuedCandidate]);
    const csv = alternativeComparisonCsvFor([valuedCandidate]);
    const json = JSON.stringify(JSON.parse(alternativeComparisonJsonFor([valuedCandidate])));

    expect(text).toContain("부품을 교체할 경우: 호환 결과: 구매 전 확인 필요 · 호환 불가 0 · 주의 1 · 확인 필요 2 · 가격 변화 +45,000원 · 구매 안내: 확인 후 구매 · 주의·확인 필요를 확인한 뒤 구매하세요. · 가격 이력 30일 4회 · 최저 100,000원 · 구매 전 확인 항목 2개 · 완료 1 · 추가 확인 1 · 진행 보류 0");
    expect(csv).toContain("부품 교체 시");
    expect(csv).not.toContain("74");
    expect(csv).not.toContain("-8");
    expect(json).not.toContain("analysisScore");
    expect(json).not.toContain("analysisConfidence");
    expect(json).not.toContain("74");
    expect(json).not.toContain("-8");
    expect(json).toContain("45000");
    expect(json).toContain("구매 전 확인");
  });

  it("exports the candidate tradeoff status and its evidence", () => {
    const tradeoff = { frontier: true, eligible: true, riskScore: 1, priceDeltaWon: 20000, analysisScore: 82, evidenceScore: 91, reason: "다른 부품에 일방적으로 대체되지 않습니다." } as const;
    const candidateWithTradeoff: AlternativeComparisonCandidate = { ...candidates[0], scenario: { status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, tradeoff } };
    const text = alternativeComparisonTextFor([candidateWithTradeoff]);
    const json = alternativeComparisonJsonFor([candidateWithTradeoff]);

    expect(text).not.toContain("위험 1점");
    expect(text).not.toContain("분석 82점");
    expect(text).not.toContain("정보 91점");
    expect(text).not.toContain("다른 부품에 일방적으로 대체되지 않습니다.");
    expect(json).not.toContain("tradeoff");
    expect(json).not.toContain("riskScore");
    expect(json).not.toContain("analysisScore");
    expect(json).not.toContain("evidenceScore");
    expect(json).not.toContain("일방적으로 대체");
  });
});
