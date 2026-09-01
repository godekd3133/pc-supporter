import { describe, expect, it } from "vitest";
import type { Part, UpgradeBundleRecommendation } from "./types";
import { upgradeBundlePayloadFor, upgradeBundlePartNeedsHydration, upgradeBundlesFromPayload } from "./upgrade-bundle-transport";

function part(id: string, category: Part["category"]): Part {
  return { id, category, name: id, source: "manual", specs: {}, dataQuality: "manual", missingFields: [], updatedAt: "2026-08-31T00:00:00.000Z" };
}

function recommendation(id: string, category: Part["category"]): UpgradeBundleRecommendation["changes"][number] {
  return {
    category,
    currentPartId: `current-${category}`,
    currentPartName: `현재 ${category}`,
    quantity: 1,
    part: part(id, category),
    upgradeScore: 80,
    improvementPercent: 10,
    improvedDimensions: ["용량"],
    performanceSummary: "현재 → 후보",
    similarityScore: 80,
    similarityLabel: "유사",
    similarityEvidence: { comparedDimensions: 1, totalDimensions: 1, confidence: "high", dimensions: [] },
    compatibilityEvidence: { blockerCount: 0, warningCount: 0, unknownCount: 0 },
    ...(category === "gpu" ? { physicalEvidence: { status: "review" as const, summary: "GPU·케이스 물리 근거 확인 필요", sources: [{ category: "gpu" as const, note: "GPU 제조사 문서" }] } } : {}),
    reason: "테스트",
    expansionEvidence: { baselineScore: 40, candidateScore: 50, scoreDelta: 10, baselineKnownDimensionCount: 3, baselineTotalDimensionCount: 3, candidateKnownDimensionCount: 3, candidateTotalDimensionCount: 3, baselineLevel: "complete", candidateLevel: "complete", baselineSummary: "기준", candidateSummary: "후보" }
  };
}

describe("upgrade bundle transport", () => {
  it("deduplicates candidates and hydrates 2- and 3-part bundles", () => {
    const cpu = recommendation("cpu-candidate", "cpu");
    const memory = recommendation("memory-candidate", "memory");
    const gpu = recommendation("gpu-candidate", "gpu");
    const bundles: UpgradeBundleRecommendation[] = [
      { changes: [cpu, memory], totalUpgradeScore: 160, totalImprovementPercent: 20, compatibilityEvidence: { blockerCount: 0, warningCount: 0, unknownCount: 0 }, reason: "2개" },
      { changes: [cpu, memory, gpu], totalUpgradeScore: 240, totalImprovementPercent: 30, compatibilityEvidence: { blockerCount: 0, warningCount: 0, unknownCount: 0 }, reason: "3개" }
    ];
    const payload = upgradeBundlePayloadFor(bundles);
    expect(payload.candidates).toHaveLength(3);
    expect(payload.bundles).toHaveLength(2);
    expect(payload.bundles[0].changes).toEqual([{ category: "cpu", partId: "cpu-candidate" }, { category: "memory", partId: "memory-candidate" }]);
    expect(upgradeBundlePartNeedsHydration(upgradeBundlesFromPayload(payload)![0].changes[0].part)).toBe(true);
    const hydratedParts = new Map([cpu, memory, gpu].map((change) => [change.part.id, change.part]));
    expect(upgradeBundlesFromPayload(payload, hydratedParts)).toEqual(bundles);
  });

  it("returns undefined instead of silently dropping a broken reference", () => {
    const payload = upgradeBundlePayloadFor([{ changes: [recommendation("cpu-candidate", "cpu")], totalUpgradeScore: 80, totalImprovementPercent: 10, compatibilityEvidence: { blockerCount: 0, warningCount: 0, unknownCount: 0 }, reason: "테스트" }]);
    payload.bundles[0].changes[0].partId = "missing";
    expect(upgradeBundlesFromPayload(payload)).toBeUndefined();
  });
});
