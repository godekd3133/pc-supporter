import { describe, expect, it } from "vitest";
import { savedBuildPriorityMatches, savedBuildPriorityRowsFor, savedBuildRiskScoreFor } from "./saved-build-priority";
import type { SavedBuildCheckSnapshot } from "./types";

function snapshot(overrides: Partial<SavedBuildCheckSnapshot> = {}): SavedBuildCheckSnapshot {
  return {
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
    analysisScore: 80,
    analysisScoreLabel: "상위권",
    analysisConfidence: "high",
    engineVersion: "2.53.0",
    catalogSnapshotAt: "2026-08-31T00:00:00.000Z",
    checkedAt: "2026-08-31T00:00:00.000Z",
    ...overrides
  };
}

describe("saved build priority board", () => {
  it("weights blockers above warnings and unknown data", () => {
    expect(savedBuildRiskScoreFor(snapshot({ blockerCount: 2, warningCount: 3, unknownCount: 4 }))).toBe(234);
    expect(savedBuildRiskScoreFor(snapshot({ accessoryCompatibility: { status: "needs_review", blockerCount: 1, warningCount: 2, unknownCount: 1, findings: [] } }))).toBe(121);
  });

  it("uses the newest monitor snapshot, preserves a trend, and calculates deltas", () => {
    const first = snapshot({ blockerCount: 1, totalPriceWon: 900_000, checkedAt: "2026-08-29T00:00:00.000Z" });
    const second = snapshot({ blockerCount: 0, warningCount: 1, totalPriceWon: 1_000_000, checkedAt: "2026-08-30T00:00:00.000Z" });
    const current = snapshot({ blockerCount: 0, warningCount: 0, totalPriceWon: 1_050_000, checkedAt: "2026-08-31T00:00:00.000Z" });
    const rows = savedBuildPriorityRowsFor([{ id: "b1", name: "테스트 견적", checkSnapshot: second, checkHistory: [first, second], current: { id: "b1", status: "ready", snapshot: current, transition: undefined } }]);
    expect(rows[0]).toMatchObject({ level: "stable", riskScore: 0, riskDelta: -10, priceDeltaWon: 50_000, priceComplete: true });
    expect(rows[0]?.trend.map((point) => point.checkedAt)).toEqual([first.checkedAt, second.checkedAt, current.checkedAt]);
  });

  it("puts failed and critical builds before stable builds", () => {
    const rows = savedBuildPriorityRowsFor([
      { id: "stable", name: "안정 견적", checkSnapshot: snapshot() },
      { id: "critical", name: "위험 견적", checkSnapshot: snapshot({ status: "incompatible", blockerCount: 1 }) },
      { id: "failed", name: "실패 견적", current: { id: "failed", status: "error", message: "timeout" } }
    ]);
    expect(rows.map((row) => row.id)).toEqual(["critical", "failed", "stable"]);
    expect(savedBuildPriorityMatches(rows[0]!, "attention")).toBe(true);
    expect(savedBuildPriorityMatches(rows[2]!, "stable")).toBe(true);
  });

  it("folds a newer server background snapshot into the same trend", () => {
    const saved = snapshot({ checkedAt: "2026-08-30T00:00:00.000Z" });
    const background = snapshot({ status: "needs_review", warningCount: 1, checkedAt: "2026-08-31T00:00:00.000Z" });
    const rows = savedBuildPriorityRowsFor([{ id: "b1", name: "백그라운드 견적", checkSnapshot: saved, checkHistory: [saved], serverSnapshot: background }]);
    expect(rows[0]).toMatchObject({ level: "review", status: "needs_review", riskScore: 10, trend: [expect.objectContaining({ checkedAt: saved.checkedAt }), expect.objectContaining({ checkedAt: background.checkedAt })] });
  });

  it("exposes the highest-severity finding as the primary action", () => {
    const rows = savedBuildPriorityRowsFor([{ id: "b1", name: "테스트", checkSnapshot: snapshot({ status: "incompatible", blockerCount: 1, findings: [
      { id: "w", ruleId: "warning", severity: "warning", title: "주의", message: "주의", affectedPartIds: [], facts: [] },
      { id: "b", ruleId: "blocker", severity: "blocker", title: "전원 부족", message: "전원 부족", affectedPartIds: [], facts: [] }
    ] }) }]);
    expect(rows[0]?.primaryFinding?.title).toBe("전원 부족");
  });
});
