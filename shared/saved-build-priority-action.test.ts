import { describe, expect, it } from "vitest";
import { savedBuildNextActionFor } from "./saved-build-priority-action";
import type { CompatibilityResult, RecommendationPlan } from "./types";

function result(overrides: Partial<CompatibilityResult> = {}): CompatibilityResult {
  return {
    status: "incompatible",
    blockerCount: 2,
    warningCount: 1,
    unknownCount: 0,
    findings: [],
    metrics: {},
    analysis: { profile: "general", scoreLabel: "보완 권장", overallScore: 55, scoreBasis: "test", confidence: "limited", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: ["메인보드 바꾸기"] },
    links: [],
    totalPriceWon: 1_000_000,
    priceComplete: true,
    engineVersion: "2.53.0",
    catalogSnapshotAt: "2026-08-31T00:00:00.000Z",
    checkedAt: "2026-08-31T00:00:00.000Z",
    ...overrides
  };
}

function plan(overrides: Partial<RecommendationPlan> = {}): RecommendationPlan {
  return {
    title: "1개 항목으로 해결하는 플랜",
    label: "최소 변경",
    changes: [{ kind: "replace_part", category: "motherboard", fromPartName: "기존 보드", toPart: { id: "mb-new", category: "motherboard", name: "새 보드", source: "danawa", dataQuality: "seed", priceWon: 120_000, specs: {}, missingFields: [], updatedAt: "2026-08-31T00:00:00.000Z" }, priceDeltaWon: 20_000, similarityScore: 90, similarityLabel: "유사", performanceSummary: "동일", recommendationTrust: undefined }],
    resolvedFindings: 1,
    resolvedFindingTitles: ["소켓"],
    resolvedBlockers: 2,
    resolvedUnknown: 0,
    remainingBlockers: 0,
    remainingWarnings: 1,
    remainingUnknown: 0,
    afterTotalPriceWon: 1_020_000,
    priceDeltaWon: 20_000,
    priceComplete: true,
    similarityScore: 90,
    similarityLabel: "유사",
    reason: "차단 오류를 줄입니다.",
    profileSummary: "일반형",
    ...overrides
  };
}

describe("saved build priority action", () => {
  it("extracts the first repair change and remaining risk from the engine plan", () => {
    const action = savedBuildNextActionFor(result({ repairPlans: [plan()] }));
    expect(action).toMatchObject({ kind: "repair_plan", title: "추천 수리 플랜", nextAction: "메인보드 후보 새 보드 확인", resolvedBlockers: 2, remainingBlockers: 0, priceDeltaWon: 20_000, afterTotalPriceWon: 1_020_000 });
    expect(action.changes[0]).toMatchObject({ category: "motherboard", fromPartName: "기존 보드", toPartName: "새 보드" });
  });

  it("falls back to the analysis next action when no safe repair plan exists", () => {
    const action = savedBuildNextActionFor(result({ repairPlans: [] }));
    expect(action).toMatchObject({ kind: "analysis", nextAction: "메인보드 바꾸기", remainingBlockers: 2 });
  });

  it("reports no action when the analysis has no next action", () => {
    const action = savedBuildNextActionFor(result({ repairPlans: [], analysis: { ...result().analysis, nextActions: [] } }));
    expect(action).toMatchObject({ kind: "none", title: "추가 조치 없음", remainingBlockers: 2 });
  });
});
