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

  it("keeps affected part ids for changed finding summaries", () => {
    const before = build("v1", {
      checkSnapshot: {
        ...build("before").checkSnapshot!,
        findings: [{ id: "gpu-power-before", ruleId: "gpu-power", severity: "warning", title: "파워 용량을 확인해 주세요.", message: "기존 메시지", affectedPartIds: ["gpu-1"], facts: [] }]
      }
    });
    const after = build("v2", {
      checkSnapshot: {
        ...build("after").checkSnapshot!,
        findings: [{ id: "gpu-power-after", ruleId: "gpu-power", severity: "blocker", title: "파워 용량이 부족합니다.", message: "현재 메시지", affectedPartIds: ["gpu-1", "psu-1"], facts: [] }]
      }
    });
    const delta = savedBuildVersionDeltaFor(before, after);
    expect(delta.findingChanges).toMatchObject([{ change: "severity_changed", title: "파워 용량이 부족합니다.", affectedPartIds: ["gpu-1", "psu-1"] }]);
  });

  it("keeps accessory finding changes with related parts", () => {
    const before = build("v1", {
      checkSnapshot: {
        ...build("before").checkSnapshot!,
        accessoryCompatibility: { status: "needs_review", blockerCount: 0, warningCount: 1, unknownCount: 0, findings: [{ id: "fan-power-before", ruleId: "fan-power", severity: "warning", accessoryId: "fan-hub", accessoryName: "팬 허브", relatedPartIds: ["case-1"], title: "팬 허브 연결을 확인해 주세요.", message: "기존 메시지", facts: [] }] }
      }
    });
    const after = build("v2", {
      checkSnapshot: {
        ...build("after").checkSnapshot!,
        accessoryCompatibility: { status: "incompatible", blockerCount: 1, warningCount: 0, unknownCount: 0, findings: [{ id: "fan-power-after", ruleId: "fan-power", severity: "blocker", accessoryId: "fan-hub", accessoryName: "팬 허브", relatedPartIds: ["case-1", "mb-1"], title: "팬 허브 전원 연결이 부족합니다.", message: "현재 메시지", facts: [] }] }
      }
    });
    const delta = savedBuildVersionDeltaFor(before, after);
    expect(delta.accessoryFindingChanges).toMatchObject([{ change: "severity_changed", accessoryName: "팬 허브", relatedPartIds: ["case-1", "mb-1"], title: "팬 허브 전원 연결이 부족합니다." }]);
  });
});
