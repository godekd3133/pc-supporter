import { describe, expect, it } from "vitest";
import type { SavedBuild } from "./types";
import { savedBuildVersionDeltaFor } from "./saved-build-version-delta";

function build(id: string, overrides: Partial<SavedBuild> = {}): SavedBuild {
  return {
    id,
    name: id,
    selection: { cpu: { partId: "cpu-1", quantity: 1 }, memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false },
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

describe("saved build version delta", () => {
  it("counts changed component groups and reuses saved-check transition deltas", () => {
    const before = build("v1");
    const after = build("v2", {
      selection: { cpu: { partId: "cpu-2", quantity: 1 }, memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: false },
      checkSnapshot: { ...before.checkSnapshot!, status: "needs_review", warningCount: 1, totalPriceWon: 1_080_000, analysisScore: 82, analysisScoreLabel: "상위권", analysisConfidence: "high", checkedAt: "2026-09-07T01:00:00.000Z" }
    });
    const delta = savedBuildVersionDeltaFor(before, after);
    expect(delta.selectionChangedCategoryCount).toBe(1);
    expect(delta.transition).toMatchObject({ direction: "regressed", warningDelta: 1, priceDeltaWon: 80_000, analysisScoreDelta: 12 });
    expect(delta).toMatchObject({ resolvedFindingCount: 0, newFindingCount: 0, changedFindingCount: 0 });
  });

  it("keeps the comparison unknown when one version has no saved check snapshot", () => {
    const delta = savedBuildVersionDeltaFor(build("v1"), build("v2", { checkSnapshot: undefined, checkHistory: undefined }));
    expect(delta.selectionChangedCategoryCount).toBe(0);
    expect(delta.transition).toBeUndefined();
  });
});
