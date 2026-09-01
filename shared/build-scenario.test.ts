import { describe, expect, it } from "vitest";
import { buildScenarioComparisonFor } from "./build-scenario";
import type { CompatibilityResult } from "./types";

function result(overrides: Partial<CompatibilityResult> = {}): CompatibilityResult {
  return {
    status: "incompatible",
    blockerCount: 2,
    warningCount: 1,
    unknownCount: 1,
    findings: [],
    metrics: {},
    analysis: {
      profile: "general",
      scoreLabel: "계산 불가",
      scoreBasis: "test",
      confidence: "unknown",
      factors: [],
      strengths: [],
      focusAreas: [],
      bottlenecks: [],
      nextActions: []
    },
    links: [],
    totalPriceWon: 1_000_000,
    priceComplete: true,
    engineVersion: "test",
    catalogSnapshotAt: "2026-08-31T00:00:00.000Z",
    checkedAt: "2026-08-31T00:00:00.000Z",
    ...overrides
  };
}

describe("build scenario comparison", () => {
  it("reports a safer candidate and its known price delta", () => {
    const comparison = buildScenarioComparisonFor(result(), result({ status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, totalPriceWon: 1_120_000 }));
    expect(comparison).toMatchObject({ direction: "improved", blockerDelta: -2, warningDelta: -1, unknownDelta: -1, priceDeltaWon: 120_000, priceChanged: true, statusChanged: true });
    expect(comparison.summary).toContain("총액 +120,000원");
  });

  it("does not manufacture a price delta when either result is incomplete", () => {
    const comparison = buildScenarioComparisonFor(result({ priceComplete: false }), result({ status: "needs_review", blockerCount: 0, warningCount: 2, unknownCount: 0, priceComplete: true, totalPriceWon: 800_000 }));
    expect(comparison.direction).toBe("improved");
    expect(comparison.priceDeltaWon).toBeUndefined();
    expect(comparison.priceChanged).toBe(false);
  });

  it("reports a candidate that introduces more risk as worsened", () => {
    const comparison = buildScenarioComparisonFor(result({ status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0 }), result({ status: "needs_review", blockerCount: 0, warningCount: 1, unknownCount: 0 }));
    expect(comparison.direction).toBe("worsened");
    expect(comparison.summary).toContain("주의 +1");
  });

  it("keeps a same-risk, same-price candidate unchanged", () => {
    const comparison = buildScenarioComparisonFor(result(), result());
    expect(comparison).toMatchObject({ direction: "unchanged", statusChanged: false, priceChanged: false });
    expect(comparison.summary).toContain("차단 2 → 2");
  });
});
