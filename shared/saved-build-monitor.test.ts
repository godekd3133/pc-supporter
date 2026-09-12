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
    expect(savedBuildMonitorAssessmentFor(after, savedBuildCheckTransitionSummaryFor(before, after)).summary).toContain("성능 분석");
  });

  it("surfaces analysis-only changes as non-risk information changes", () => {
    const before = savedBuildCheckSnapshotFor(result());
    const after = savedBuildCheckSnapshotFor(result({ analysis: { ...result().analysis, overallScore: 74, scoreLabel: "보완 권장", confidence: "limited" } }));
    const transition = savedBuildCheckTransitionSummaryFor(before, after);

    expect(transition).toMatchObject({ analysisChanged: true, analysisScoreDelta: -6, hasChanges: true });
    expect(savedBuildMonitorAssessmentFor(after, transition)).toMatchObject({ level: "changed", requiresAttention: false, recordRecommended: true });
    expect(savedBuildMonitorAssessmentFor(after, transition).summary).toContain("성능 분석 -6점");

    const reviewAfter = savedBuildCheckSnapshotFor(result({ status: "needs_review", warningCount: 1, analysis: { ...result().analysis, overallScore: 74, scoreLabel: "보완 권장", confidence: "limited" } }));
    const reviewTransition = savedBuildCheckTransitionSummaryFor(before, reviewAfter);
    expect(savedBuildMonitorAssessmentFor(reviewAfter, reviewTransition).summary).toContain("성능 분석 -6점");

    const labelOnlyAfter = savedBuildCheckSnapshotFor(result({ analysis: { ...result().analysis, scoreLabel: "균형형", confidence: "limited" } }));
    const labelOnlyTransition = savedBuildCheckTransitionSummaryFor(before, labelOnlyAfter);
    expect(labelOnlyTransition).toMatchObject({ analysisChanged: true, analysisScoreDelta: 0 });
    expect(savedBuildMonitorAssessmentFor(labelOnlyAfter, labelOnlyTransition).summary).toContain("성능 분석 라벨·근거 수준");
  });

  it("treats a resource-budget regression as monitor attention even when compatibility counts stay clear", () => {
    const before = savedBuildCheckSnapshotFor(result({ metrics: { powerHeadroomW: 150, psuWattageW: 1000, recommendedPsuW: 850 } }));
    const after = savedBuildCheckSnapshotFor(result({ metrics: { powerHeadroomW: 100, psuWattageW: 950, recommendedPsuW: 850 } }));
    const transition = savedBuildCheckTransitionSummaryFor(before, after);

    expect(transition).toMatchObject({ resourceBudgetChanged: true, resourceRiskIncreased: true, powerHeadroomDeltaW: -50 });
    expect(savedBuildMonitorAssessmentFor(after, transition)).toMatchObject({ level: "review", requiresAttention: true });
    expect(savedBuildMonitorAssessmentFor(after, transition).summary).toContain("전력 여유 -50W");
  });

  it("marks an initially below-zero resource budget as critical", () => {
    const snapshot = savedBuildCheckSnapshotFor(result({ metrics: { powerHeadroomW: -10, psuWattageW: 750, recommendedPsuW: 760 } }));

    expect(savedBuildMonitorAssessmentFor(snapshot)).toMatchObject({ level: "critical", requiresAttention: true });
    expect(savedBuildMonitorAssessmentFor(snapshot).summary).toContain("전력·냉각 예산 기준 미달");
  });

  it("treats peripheral blockers and warnings as saved-build attention signals", () => {
    const blocker = savedBuildCheckSnapshotFor(result({ accessoryCompatibility: { status: "incompatible", blockerCount: 1, warningCount: 0, unknownCount: 0, findings: [] } }));
    expect(savedBuildMonitorAssessmentFor(blocker)).toMatchObject({ level: "critical", requiresAttention: true });
    expect(savedBuildMonitorAssessmentFor(blocker).summary).toContain("주변 부품 1개 차단");

    const review = savedBuildCheckSnapshotFor(result({ accessoryCompatibility: { status: "needs_review", blockerCount: 0, warningCount: 1, unknownCount: 0, findings: [] } }));
    expect(savedBuildMonitorAssessmentFor(review)).toMatchObject({ level: "review", requiresAttention: true });
  });
});
