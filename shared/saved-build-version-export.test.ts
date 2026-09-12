import { describe, expect, it } from "vitest";
import type { SavedBuild } from "./types";
import { savedBuildVersionComparisonExportFor, savedBuildVersionComparisonTextFor } from "./saved-build-version-export";

function build(id: string, overrides: Partial<SavedBuild> = {}): SavedBuild {
  return {
    id,
    name: id,
    selection: { cpu: { partId: "cpu-1", quantity: 1 }, memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false },
    recommendationPreferences: { profile: "general", priority: "balanced", listingPolicy: "retail_only" },
    checkSnapshot: {
      status: "compatible",
      blockerCount: 0,
      warningCount: 0,
      unknownCount: 0,
      totalPriceWon: 1_000_000,
      priceComplete: true,
      coreTotalPriceWon: 1_000_000,
      corePriceComplete: true,
      accessoryTotalPriceWon: 0,
      accessoryPriceComplete: true,
      findings: [],
      analysisScore: 70,
      analysisScoreLabel: "보완 권장",
      analysisConfidence: "limited",
      engineVersion: "test",
      catalogSnapshotAt: "2026-09-07T00:00:00.000Z",
      checkedAt: "2026-09-07T00:00:00.000Z"
    },
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
    ...overrides
  };
}

describe("saved build version export", () => {
  it("exports changed selection, saved checks, finding changes, and decision notes without owner data", () => {
    const before = build("build-v1", { name: "원본 견적", decisionNote: "기존 호환성을 우선", versionGroupId: "group-1", versionNumber: 1 });
    const after = build("build-v2", {
      name: "수정 견적",
      decisionNote: "차단을 줄이고 가격을 확인",
      versionGroupId: "group-1",
      versionNumber: 2,
      selection: { cpu: { partId: "cpu-2", quantity: 1 }, memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false },
      checkSnapshot: {
        ...before.checkSnapshot!,
        status: "needs_review",
        warningCount: 1,
        totalPriceWon: 1_080_000,
        analysisScore: 82,
        analysisScoreLabel: "상위권",
        analysisConfidence: "high",
        checkedAt: "2026-09-07T01:00:00.000Z",
        findings: [{ id: "finding-new", ruleId: "rule-new", severity: "warning", title: "새 확인 항목", message: "확인이 필요합니다.", affectedPartIds: ["cpu-2"], facts: [] }]
      }
    });
    const exported = savedBuildVersionComparisonExportFor({ before, after, fallbackPreferences: before.recommendationPreferences! }, "2026-09-07T02:00:00.000Z");
    expect(exported).toMatchObject({
      schemaVersion: 1,
      kind: "pc-supporter.saved-build-version-comparison",
      generatedAt: "2026-09-07T02:00:00.000Z",
      before: { id: "build-v1", label: "v1", decisionNote: "기존 호환성을 우선" },
      after: { id: "build-v2", label: "v2", decisionNote: "차단을 줄이고 가격을 확인" },
      summary: { selectionChangedCategoryCount: 1, direction: "regressed", priceDeltaWon: 80_000, analysisScoreDelta: 12, newFindingCount: 1 },
      changes: [{ id: "category-cpu", label: "CPU", before: "cpu-1", after: "cpu-2" }]
    });
    expect(exported.findingChanges).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toContain("ownerToken");
    const text = savedBuildVersionComparisonTextFor({ before, after, fallbackPreferences: before.recommendationPreferences! }, "2026-09-07T02:00:00.000Z");
    expect(text).toContain("원본 견적");
    expect(text).toContain("새 확인 항목");
    expect(text).toContain("데이터 경계");
  });

  it("keeps selection and snapshot boundaries explicit when checks are missing", () => {
    const before = build("build-v1");
    const after = build("build-v2", { checkSnapshot: undefined, checkHistory: undefined, selection: { cpu: { partId: "cpu-2", quantity: 1 }, memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false } });
    const exported = savedBuildVersionComparisonExportFor({ before, after, fallbackPreferences: before.recommendationPreferences! });
    expect(exported.transition).toBeUndefined();
    expect(exported.findingChanges).toEqual([]);
    expect(exported.summary.selectionChangedCategoryCount).toBe(1);
    expect(savedBuildVersionComparisonTextFor({ before, after, fallbackPreferences: before.recommendationPreferences! })).toContain("저장된 검사 snapshot이 한쪽 이상 없어");
  });
});
