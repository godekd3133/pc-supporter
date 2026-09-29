import { describe, expect, it } from "vitest";
import { publicCompatibilityResultFromStoredJson } from "./compatibility-result-storage";

describe("cached compatibility result public boundary", () => {
  it("normalizes legacy session data while retaining buyer facts and removing internal evidence", () => {
    const raw = JSON.stringify({
      status: "needs_review",
      blockerCount: 0,
      warningCount: 1,
      unknownCount: 1,
      totalPriceWon: 650000,
      priceComplete: true,
      engineVersion: "2.58.0",
      catalogSnapshotAt: "2026-09-20T00:00:00.000Z",
      checkedAt: "2026-09-20T00:01:00.000Z",
      analysis: { overallScore: 82, scoreLabel: "상위권", nextActions: ["3DMark Time Spy 기준 82점"] },
      benchmarkSnapshot: { status: "complete", score: 24680, provenance: { sourceUrl: "https://review.example/private" } },
      findings: [{
        id: "gpu-fit-review",
        ruleId: "gpu-case-length",
        severity: "unknown",
        title: "케이스 공간 확인",
        message: "GPU 길이와 케이스 공간을 제품 안내에서 확인하세요.",
        affectedPartIds: ["gpu-private"],
        facts: [{ label: "GPU 길이", actual: "265mm", expected: "270mm 이하" }],
        actions: [],
        suggestions: [{
          part: {
            id: "gpu-private",
            category: "gpu",
            name: "테스트 GPU",
            priceWon: 650000,
            specs: { lengthMm: 265, vramGb: 12, gpu3dmarkTimeSpyScore: 24680, benchmarkProvenance: { sourceUrl: "https://review.example/private" } }
          },
          candidateRisk: "review",
          recommendationTrust: { score: 94, level: "high", reasons: ["공식 벤치마크"] },
          similarityScore: 92,
          analysisScore: 82,
          performanceSummary: "3DMark Time Spy 24680점 · 실제 FPS 144",
          benchmarkEvidence: [{ score: 24680, sourceUrl: "https://review.example/private" }],
          gpuTarget: { summary: "QHD · 144Hz · 권장 VRAM 12GB" },
          physicalEvidence: { status: "review", summary: "GPU 길이 265mm · 케이스 허용 길이 270mm · 구매 전 확인 필요" },
          remainingBlockers: 0,
          remainingWarnings: 0,
          remainingUnknown: 1
        }]
      }]
    });

    const result = publicCompatibilityResultFromStoredJson(raw);
    expect(result).toMatchObject({
      status: "needs_review",
      blockerCount: 0,
      warningCount: 1,
      unknownCount: 1,
      totalPriceWon: 650000,
      findings: [{ facts: [{ actual: "265mm" }], suggestions: [{
        part: { name: "테스트 GPU", priceWon: 650000, specs: { lengthMm: 265, vramGb: 12 } },
        candidateRisk: "review",
        physicalEvidence: { status: "review", summary: "GPU 길이 265mm · 케이스 허용 길이 270mm · 구매 전 확인 필요" }
      }] }]
    });
    expect(result).not.toHaveProperty("analysis");
    expect(result).not.toHaveProperty("benchmarkSnapshot");
    expect(JSON.stringify(result)).not.toMatch(/24680|3DMark|recommendationTrust|performanceSummary|gpuTarget|benchmarkProvenance|review\.example\/private/);
  });

  it("rejects malformed cached JSON", () => {
    expect(publicCompatibilityResultFromStoredJson(null)).toBeNull();
    expect(publicCompatibilityResultFromStoredJson("not-json")).toBeNull();
    expect(publicCompatibilityResultFromStoredJson(JSON.stringify({ status: "invalid" }))).toBeNull();
  });
});
