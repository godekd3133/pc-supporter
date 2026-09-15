import { describe, expect, it } from "vitest";
import { alternativeComparisonCsvFor, alternativeComparisonJsonFor, alternativeComparisonTextFor } from "./alternative-comparison-export";
import type { AlternativeComparisonCandidate } from "./alternative-comparison-export";

const candidates: AlternativeComparisonCandidate[] = [
  {
    name: "테스트, 후보",
    category: "gpu",
    partId: "gpu-test-1",
    priceWon: 1200000,
    priceEvidence: "live",
    summary: "RTX 5070 · 12GB",
    price: "1,200,000원",
    purchaseCondition: "다나와 수집가 · 신품·정식 유통",
    recommendedQuantity: 1,
    similarity: "대안 43점 · 정보 충분",
    gpuTarget: "QHD · 144Hz · 권장 VRAM 12GB · 현재 8GB → 후보 12GB · 권장 기준 충족",
    recommendationTrust: "높음 92점",
    performance: "VRAM 32GB → 12GB (-62.5%)",
    compatibility: "호환 확인",
    decisionSummary: "추천 후보 · 현재 문제 해결 · 새 차단 없음",
    physicalEvidence: "확인 필요 · GPU·케이스 장착 정보를 구매 전 확인해야 합니다.",
    physicalEvidenceSources: [{ category: "gpu", manufacturerModel: "GPU-TEST-1", manufacturerRevision: "rev-A", updatedAt: "2026-09-01", note: "GPU 제조사 설치 가이드", url: "https://vendor.example/gpu" }],
    dataQuality: "다나와 최신",
    dataFreshness: "aging",
    updatedAt: "2026-08-28",
    sourceUrl: "https://prod.danawa.com/info/?pcode=123"
  },
  {
    name: "가격 확인 필요\n후보",
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
  it("writes a readable text comparison without dropping unknown values", () => {
    const text = alternativeComparisonTextFor(candidates);
    expect(text).toContain("[후보 1] 테스트, 후보");
    expect(text).toContain("가격: 1,200,000원 · 추천 킷 1개");
    expect(text).toContain("가격 출처: 다나와 가격");
    expect(text).toContain("구매 조건: 다나와 수집가 · 신품·정식 유통");
    expect(text).toContain("가격 확인 필요");
    expect(text).toContain("게이밍 목표 정보: QHD · 144Hz · 권장 VRAM 12GB · 현재 8GB → 후보 12GB · 권장 기준 충족");
    expect(text).toContain("추천 점수: 높음 92점");
    expect(text).toContain("장착 정보: 확인 필요 · GPU·케이스 장착 정보를 구매 전 확인해야 합니다.");
    expect(text).toContain("판단 요약: 추천 후보 · 현재 문제 해결 · 새 차단 없음");
    expect(text).toContain("장착 정보 출처: GPU · GPU-TEST-1 · rev-A · 확인 2026-09-01: GPU 제조사 설치 가이드 (https://vendor.example/gpu)");
    expect(text).toContain("데이터: 다나와 최신 · 확인한 지 오래됨 · 갱신 2026-08-28");
    expect(text).toContain("https://prod.danawa.com/info/?pcode=123");
  });

  it("quotes CSV values with commas and newlines", () => {
    const csv = alternativeComparisonCsvFor(candidates);
    expect(csv.startsWith("\uFEFF후보명,범주,부품 ID,핵심 스펙,가격,공유 당시 가격(원),가격 출처")).toBe(true);
    expect(csv).toContain('"테스트, 후보"');
    expect(csv).toContain('"가격 확인 필요\n후보"');
    expect(csv).toContain("\"1,200,000원\",1200000,다나와 가격,다나와 수집가 · 신품·정식 유통,1,대안 43점 · 정보 충분,,QHD · 144Hz · 권장 VRAM 12GB · 현재 8GB → 후보 12GB · 권장 기준 충족,,높음 92점,VRAM 32GB → 12GB (-62.5%),호환 확인,추천 후보 · 현재 문제 해결 · 새 차단 없음,,확인 필요 · GPU·케이스 장착 정보를 구매 전 확인해야 합니다.,GPU · GPU-TEST-1 · rev-A · 확인 2026-09-01: GPU 제조사 설치 가이드 (https://vendor.example/gpu),다나와 최신,확인한 지 오래됨,2026-08-28,https://prod.danawa.com/info/?pcode=123");
  });

  it("returns an empty export envelope for no selected candidates", () => {
    expect(alternativeComparisonTextFor([])).toBe("PC Supporter 후보 비교\n");
    expect(alternativeComparisonCsvFor([])).toBe("\uFEFF후보명,범주,부품 ID,핵심 스펙,가격,공유 당시 가격(원),가격 출처,구매 조건,추천 킷 수량,성능 유사도,성능 비교 정보,게이밍 목표 정보,가격 대비 유사도,추천 점수,성능 변화,호환 상태,판단 요약,미리 적용 판단,장착 정보,장착 정보 출처,데이터 상태,갱신 상태,갱신일,원문 링크,성능 정보");
  });

  it("writes a versioned JSON snapshot with unknown values and source links", () => {
    const parsed = JSON.parse(alternativeComparisonJsonFor(candidates)) as { type: string; version: number; exportedAt: string; items: typeof candidates };
    expect(parsed.type).toBe("pc-supporter-alternative-comparison");
    expect(parsed.version).toBe(1);
    expect(Number.isNaN(Date.parse(parsed.exportedAt))).toBe(false);
    expect(parsed.items[0]).toMatchObject({ name: "테스트, 후보", category: "gpu", partId: "gpu-test-1", priceWon: 1200000, recommendedQuantity: 1, gpuTarget: "QHD · 144Hz · 권장 VRAM 12GB · 현재 8GB → 후보 12GB · 권장 기준 충족", sourceUrl: "https://prod.danawa.com/info/?pcode=123" });
    expect(parsed.items[1].price).toBe("가격 확인 필요");
  });

  it("preserves the current comparison baseline in text and JSON context without treating it as a candidate", () => {
    const context = { category: "그래픽카드", currentPartName: "현재 GPU · 수량 1개", currentPartSummary: "PCIe 4.0 · VRAM 8GB · 220W", currentPartPrice: "450,000원" };
    const text = alternativeComparisonTextFor(candidates, context);
    const csv = alternativeComparisonCsvFor(candidates, context);
    const parsed = JSON.parse(alternativeComparisonJsonFor(candidates, context)) as { context?: typeof context; items: typeof candidates };

    expect(text).toContain("비교 범주: 그래픽카드");
    expect(text).toContain("현재 기준선: 현재 GPU · 수량 1개");
    expect(text).toContain("현재 기준선 스펙: PCIe 4.0 · VRAM 8GB · 220W");
    expect(text).toContain("현재 기준선 가격: 450,000원");
    expect(csv.startsWith("\uFEFF후보명,범주,부품 ID,핵심 스펙,가격,공유 당시 가격(원),가격 출처,구매 조건,추천 킷 수량,성능 유사도,성능 비교 정보,게이밍 목표 정보,가격 대비 유사도,추천 점수,성능 변화,호환 상태,판단 요약,미리 적용 판단,장착 정보,장착 정보 출처,데이터 상태,갱신 상태,갱신일,원문 링크,성능 정보,비교 범주,현재 기준선,현재 기준선 스펙,현재 기준선 가격")).toBe(true);
    expect(csv).toContain(",그래픽카드,현재 GPU · 수량 1개,PCIe 4.0 · VRAM 8GB · 220W,\"450,000원\"");
    expect(parsed.context).toEqual(context);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items.some((item) => item.name === context.currentPartName)).toBe(false);
  });

  it("preserves the value score and its explicit scale in shared exports", () => {
    const valuedCandidate: AlternativeComparisonCandidate = { ...candidates[0], valueScore: 181, valueLabel: "가성비 우수", valueScoreScale: 200 };
    const text = alternativeComparisonTextFor([valuedCandidate]);
    const csv = alternativeComparisonCsvFor([valuedCandidate]);
    const json = JSON.parse(alternativeComparisonJsonFor([valuedCandidate])) as { items: AlternativeComparisonCandidate[] };

    expect(text).toContain("가격 대비 유사도: 가성비 우수 181/200점");
    expect(csv).toContain("가성비 우수 181/200점");
    expect(json.items[0]).toMatchObject({ valueScore: 181, valueLabel: "가성비 우수", valueScoreScale: 200 });
  });

  it("preserves structured similarity evidence and model-reference dimensions in shared exports", () => {
    const evidencedCandidate: AlternativeComparisonCandidate = {
      ...candidates[0],
      similarityEvidence: {
        comparedDimensions: 2,
        totalDimensions: 3,
        confidence: "high",
        basis: "spec",
        dimensions: [{ key: "gpuMemoryBandwidthGbps", label: "VRAM 대역폭", currentValue: "224GB/s", candidateValue: "272GB/s", score: 100, weight: 6, source: "model_reference" }],
        reference: { partId: "gpu-reference", partName: "RTX 5070 확인 참조", category: "gpu", dataQuality: "live", updatedAt: "2026-09-01", transferredDimensions: ["gpuMemoryBandwidthGbps"], benchmarkSourceKind: "independent_review" },
        notes: ["선택 부품에 없는 지표를 같은 모델 계열 참조로 보완했습니다."]
      }
    };
    const text = alternativeComparisonTextFor([evidencedCandidate]);
    const csv = alternativeComparisonCsvFor([evidencedCandidate]);
    const json = JSON.parse(alternativeComparisonJsonFor([evidencedCandidate])) as { items: AlternativeComparisonCandidate[] };

    expect(text).toContain("성능 비교 정보: 정보 충분 · 확인 스펙 기반 · 비교 지표 2/3개 · 모델 참조 RTX 5070 확인 참조 · 보완 gpuMemoryBandwidthGbps · 지표별 VRAM 대역폭 224GB/s → 272GB/s (모델 참조)");
    expect(csv).toContain("성능 비교 정보");
    expect(csv).toContain("모델 참조 RTX 5070 확인 참조");
    expect(json.items[0].similarityEvidence).toEqual(evidencedCandidate.similarityEvidence);
  });

  it("preserves original CPU/GPU benchmark evidence across text, CSV, and JSON exports", () => {
    const benchmarkEvidence = {
      partId: "gpu-test-1",
      category: "gpu" as const,
      name: "테스트, 후보",
      rows: [
        { key: "gpu3dmarkTimeSpyScore" as const, label: "3DMark Time Spy", value: 21000, unit: "점" as const },
        { key: "gpu3dmarkPortRoyalScore" as const, label: "3DMark Port Royal", unit: "점" as const }
      ],
      presentCount: 1,
      totalCount: 2,
      status: "partial" as const,
      provenance: { sourceKind: "independent_review" as const, sourceNote: "독립 리뷰 측정표", sourceUrl: "https://review.example/gpu", updatedAt: "2026-09-02T00:00:00.000Z" },
      sourceCheck: { requestedUrl: "https://review.example/gpu", checkedAt: "2026-09-03T00:00:00.000Z", status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0, httpStatus: 200 },
      benchmarkFreshness: "fresh" as const,
      dataUpdatedAt: "2026-09-03T00:00:00.000Z"
    };
    const evidencedCandidate: AlternativeComparisonCandidate = { ...candidates[0], benchmarkEvidence };
    const text = alternativeComparisonTextFor([evidencedCandidate]);
    const csv = alternativeComparisonCsvFor([evidencedCandidate]);
    const json = JSON.parse(alternativeComparisonJsonFor([evidencedCandidate])) as { items: AlternativeComparisonCandidate[] };

    expect(text).toContain("성능 정보: 부분 자료 · 1/2개 · 3DMark Time Spy 21,000점 · 3DMark Port Royal 확인 필요 · 출처 독립 리뷰·벤치마크 DB · 독립 리뷰 측정표 · 원문 https://review.example/gpu · 점검 원문 확인됨");
    expect(csv).toContain("성능 정보");
    expect(csv).toContain("3DMark Time Spy 21,000점");
    expect(json.items[0].benchmarkEvidence).toEqual(benchmarkEvidence);
  });

  it("exports virtual application and purchase decision facts when present", () => {
    const scenario = { status: "needs_review" as const, blockerCount: 0, warningCount: 1, unknownCount: 2, analysisScore: 74, analysisScoreLabel: "보완 권장" as const, analysisConfidence: "limited" as const, analysisScoreDelta: -8, priceDeltaWon: 45000, purchaseDecision: "확인 후 구매", purchaseDecisionSummary: "주의·확인 필요를 확인한 뒤 구매하세요.", priceHistory: { windowDays: 30 as const, sampleCount: 4, minPriceWon: 100000, currentPositionPercent: 80, hasDropThenRebound: true }, checks: [{ id: "compatibility", kind: "compatibility" as const, status: "review" as const, label: "잔여 위험 확인", detail: "확인 필요 2개" }, { id: "price", kind: "price" as const, status: "ready" as const, label: "가격 확인", detail: "가격 확인 완료" }] };
    const valuedCandidate: AlternativeComparisonCandidate = { ...candidates[0], scenario };
    const text = alternativeComparisonTextFor([valuedCandidate]);
    const csv = alternativeComparisonCsvFor([valuedCandidate]);
    const json = JSON.parse(alternativeComparisonJsonFor([valuedCandidate])) as { items: AlternativeComparisonCandidate[] };

    expect(text).toContain("미리 적용 판단: 확인 필요 · 차단 0 · 주의 1 · 확인 필요 2 · 성능 분석 74점 · 보완 권장 · 현재 대비 -8점 · 일부 스펙 기준 · 가격 변화 +45,000원 · 확인 후 구매 · 가격 이력 30일 4회 · 최저 100,000원 · 구매 전 확인 2개 · 확인됨 1 · 확인 필요 1 · 차단 0 · 주의·확인 필요를 확인한 뒤 구매하세요.");
    expect(csv).toContain("미리 적용 판단");
    expect(csv).toContain("확인 필요 · 차단 0 · 주의 1 · 확인 필요 2 · 성능 분석 74점 · 보완 권장 · 현재 대비 -8점 · 일부 스펙 기준 · 가격 변화 +45,000원");
    expect(json.items[0].scenario).toEqual(scenario);
  });

  it("exports the candidate tradeoff status and its evidence", () => {
    const tradeoff = { frontier: true, eligible: true, riskScore: 1, priceDeltaWon: 20000, analysisScore: 82, evidenceScore: 91, reason: "다른 후보에 일방적으로 대체되지 않습니다." } as const;
    const candidateWithTradeoff: AlternativeComparisonCandidate = { ...candidates[0], scenario: { status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, tradeoff } };
    const text = alternativeComparisonTextFor([candidateWithTradeoff]);
    const json = JSON.parse(alternativeComparisonJsonFor([candidateWithTradeoff])) as { items: AlternativeComparisonCandidate[] };

    expect(text).toContain("비교 우위 · 위험 1점 · 가격 변화 +20,000원 · 분석 82점 · 정보 91점 · 다른 후보에 일방적으로 대체되지 않습니다.");
    expect(json.items[0].scenario?.tradeoff).toEqual(tradeoff);
  });
});
