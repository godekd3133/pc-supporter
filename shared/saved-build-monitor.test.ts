import { describe, expect, it } from "vitest";
import { savedBuildCheckSnapshotFor, savedBuildCheckTransitionSummaryFor } from "./saved-build-check";
import { savedBuildMonitorAssessmentFor } from "./saved-build-monitor";
import type { CompatibilityResult } from "./types";

function result(overrides: Partial<CompatibilityResult> = {}): CompatibilityResult {
  return {
    status: "compatible",
    blockerCount: 0,
    warningCount: 0,
    unknownCount: 0,
    findings: [],
    metrics: {} as CompatibilityResult["metrics"],
    analysis: {
      profile: "general",
      overallScore: 80,
      scoreLabel: "상위권",
      scoreBasis: "테스트",
      confidence: "high",
      factors: [],
      strengths: [],
      focusAreas: [],
      bottlenecks: [],
      nextActions: []
    },
    links: [],
    totalPriceWon: 1_000_000,
    priceComplete: true,
    engineVersion: "2.53.0",
    catalogSnapshotAt: "2026-08-31T00:00:00.000Z",
    checkedAt: "2026-08-31T00:01:00.000Z",
    ...overrides
  };
}

describe("saved build monitor assessment", () => {
  it("prioritizes a currently incompatible build even without a baseline", () => {
    const snapshot = savedBuildCheckSnapshotFor(result({ status: "incompatible", blockerCount: 2 }));
    expect(savedBuildMonitorAssessmentFor(snapshot)).toMatchObject({ level: "critical", requiresAttention: true, recordRecommended: true });
  });

  it("flags newly increased review risk without overstating it as a blocker", () => {
    const before = savedBuildCheckSnapshotFor(result());
    const after = savedBuildCheckSnapshotFor(result({ status: "needs_review", unknownCount: 1 }));
    const transition = savedBuildCheckTransitionSummaryFor(before, after);
    expect(savedBuildMonitorAssessmentFor(after, transition)).toMatchObject({ level: "review", label: "검토 항목 증가", requiresAttention: true });
  });

  it("separates improvements and non-risk information changes", () => {
    const risky = savedBuildCheckSnapshotFor(result({ status: "incompatible", blockerCount: 1, totalPriceWon: 1_100_000 }));
    const healthy = savedBuildCheckSnapshotFor(result());
    expect(savedBuildMonitorAssessmentFor(healthy, savedBuildCheckTransitionSummaryFor(risky, healthy))).toMatchObject({ level: "improved", recordRecommended: true });

    const repriced = savedBuildCheckSnapshotFor(result({ totalPriceWon: 950_000, checkedAt: "2026-08-31T00:02:00.000Z" }));
    expect(savedBuildMonitorAssessmentFor(repriced, savedBuildCheckTransitionSummaryFor(healthy, repriced))).toMatchObject({ level: "changed", requiresAttention: false });
  });

  it("marks an identical current check as stable", () => {
    const before = savedBuildCheckSnapshotFor(result());
    const after = savedBuildCheckSnapshotFor(result());
    expect(savedBuildMonitorAssessmentFor(after, savedBuildCheckTransitionSummaryFor(before, after))).toMatchObject({ level: "stable", recordRecommended: false });
  });

  it("treats peripheral blockers and warnings as saved-build attention signals", () => {
    const blocker = savedBuildCheckSnapshotFor(result({ accessoryCompatibility: { status: "incompatible", blockerCount: 1, warningCount: 0, unknownCount: 0, findings: [] } }));
    expect(savedBuildMonitorAssessmentFor(blocker)).toMatchObject({ level: "critical", requiresAttention: true });
    expect(savedBuildMonitorAssessmentFor(blocker).summary).toContain("주변 부품 1개 차단");

    const review = savedBuildCheckSnapshotFor(result({ accessoryCompatibility: { status: "needs_review", blockerCount: 0, warningCount: 1, unknownCount: 0, findings: [] } }));
    expect(savedBuildMonitorAssessmentFor(review)).toMatchObject({ level: "review", requiresAttention: true });
  });
});
