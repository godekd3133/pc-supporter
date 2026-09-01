import { describe, expect, it } from "vitest";
import { alternativeComparisonCsvFor, alternativeComparisonJsonFor, alternativeComparisonTextFor } from "./alternative-comparison-export";
import type { AlternativeComparisonCandidate } from "./alternative-comparison-export";

const candidates: AlternativeComparisonCandidate[] = [
  {
    name: "테스트, 후보",
    summary: "RTX 5070 · 12GB",
    price: "1,200,000원",
    purchaseCondition: "가격 확인 · 신품·정식 유통",
    recommendedQuantity: 1,
    similarity: "대안 43점 · 근거 충분",
    recommendationTrust: "높음 92점",
    performance: "VRAM 32GB → 12GB (-62.5%)",
    compatibility: "호환 확인",
    decisionSummary: "추천 후보 · 현재 문제 해결 · 새 차단 없음",
    physicalEvidence: "확인 필요 · GPU·케이스 물리 근거를 구매 전 확인해야 합니다.",
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
    performance: "비교 근거 확인",
    compatibility: "확인 필요 · 전원",
    dataQuality: "일부 스펙 부족"
  }
];

describe("alternative comparison export", () => {
  it("writes a readable text comparison without dropping unknown values", () => {
    const text = alternativeComparisonTextFor(candidates);
    expect(text).toContain("[후보 1] 테스트, 후보");
    expect(text).toContain("가격: 1,200,000원 · 추천 킷 1개");
    expect(text).toContain("구매 조건: 가격 확인 · 신품·정식 유통");
    expect(text).toContain("가격 확인 필요");
    expect(text).toContain("추천 근거 신뢰도: 높음 92점");
    expect(text).toContain("물리 근거: 확인 필요 · GPU·케이스 물리 근거를 구매 전 확인해야 합니다.");
    expect(text).toContain("판단 요약: 추천 후보 · 현재 문제 해결 · 새 차단 없음");
    expect(text).toContain("물리 근거 출처: GPU · GPU-TEST-1 · rev-A · 검수 2026-09-01: GPU 제조사 설치 가이드 (https://vendor.example/gpu)");
    expect(text).toContain("데이터: 다나와 최신 · 갱신 권장 · 갱신 2026-08-28");
    expect(text).toContain("https://prod.danawa.com/info/?pcode=123");
  });

  it("quotes CSV values with commas and newlines", () => {
    const csv = alternativeComparisonCsvFor(candidates);
    expect(csv.startsWith("\uFEFF후보명,핵심 스펙")).toBe(true);
    expect(csv).toContain('"테스트, 후보"');
    expect(csv).toContain('"가격 확인 필요\n후보"');
    expect(csv).toContain("\"1,200,000원\",가격 확인 · 신품·정식 유통,1,대안 43점 · 근거 충분,,높음 92점,VRAM 32GB → 12GB (-62.5%),호환 확인,추천 후보 · 현재 문제 해결 · 새 차단 없음,확인 필요 · GPU·케이스 물리 근거를 구매 전 확인해야 합니다.,GPU · GPU-TEST-1 · rev-A · 검수 2026-09-01: GPU 제조사 설치 가이드 (https://vendor.example/gpu),다나와 최신,갱신 권장,2026-08-28,https://prod.danawa.com/info/?pcode=123");
  });

  it("returns an empty export envelope for no selected candidates", () => {
    expect(alternativeComparisonTextFor([])).toBe("PC Supporter 후보 비교\n");
    expect(alternativeComparisonCsvFor([])).toBe("\uFEFF후보명,핵심 스펙,가격,구매 조건,추천 킷 수량,성능 유사도,가격 대비 유사도,추천 근거 신뢰도,성능 변화,호환 상태,판단 요약,물리 근거,물리 근거 출처,데이터 품질,갱신 상태,갱신일,원문 링크");
  });

  it("writes a versioned JSON snapshot with unknown values and source links", () => {
    const parsed = JSON.parse(alternativeComparisonJsonFor(candidates)) as { type: string; version: number; exportedAt: string; items: typeof candidates };
    expect(parsed.type).toBe("pc-supporter-alternative-comparison");
    expect(parsed.version).toBe(1);
    expect(Number.isNaN(Date.parse(parsed.exportedAt))).toBe(false);
    expect(parsed.items[0]).toMatchObject({ name: "테스트, 후보", recommendedQuantity: 1, sourceUrl: "https://prod.danawa.com/info/?pcode=123" });
    expect(parsed.items[1].price).toBe("가격 확인 필요");
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
});
