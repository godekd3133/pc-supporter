import { describe, expect, it } from "vitest";
import type { RecommendationPlan } from "./types";
import { repairPlanTradeoffFor } from "./repair-plan-tradeoff";

function plan(overrides: Partial<RecommendationPlan>): RecommendationPlan {
  return {
    title: "테스트 플랜",
    label: "최소 변경",
    changes: [],
    resolvedFindings: 0,
    resolvedFindingTitles: [],
    resolvedBlockers: 0,
    resolvedUnknown: 0,
    remainingBlockers: 0,
    remainingWarnings: 0,
    remainingUnknown: 0,
    afterTotalPriceWon: 1_000_000,
    priceComplete: true,
    similarityScore: 100,
    similarityLabel: "동급",
    reason: "테스트",
    profileSummary: "테스트",
    ...overrides
  };
}

describe("repair plan tradeoff frontier", () => {
  it("keeps cost-risk-change tradeoffs on the frontier and marks a dominated plan", () => {
    const summaries = repairPlanTradeoffFor([
      plan({ label: "최소 변경", changes: [{} as RecommendationPlan["changes"][number]], priceDeltaWon: 100_000 }),
      plan({ label: "가성비", remainingUnknown: 1, priceDeltaWon: 0 }),
      plan({ label: "성능 유지", remainingWarnings: 1, changes: [{}, {}, {}] as RecommendationPlan["changes"], priceDeltaWon: 150_000 })
    ]);

    expect(summaries[0]).toMatchObject({ frontier: true, riskScore: 0, changeCount: 1 });
    expect(summaries[1]).toMatchObject({ frontier: true, riskScore: 1, changeCount: 0 });
    expect(summaries[2]).toMatchObject({ frontier: false, dominatedByPlanIndex: 0, riskScore: 10, changeCount: 3 });
    expect(summaries[2].reason).toContain("최소 변경");
  });

  it("does not claim dominance across a known and an unknown price", () => {
    const summaries = repairPlanTradeoffFor([
      plan({ label: "최소 변경", priceDeltaWon: 100_000 }),
      plan({ label: "가성비", remainingWarnings: 1, changes: [{} as RecommendationPlan["changes"][number]] })
    ]);

    expect(summaries.every((summary) => summary.frontier)).toBe(true);
  });

  it("can compare risk and change size when both prices are unknown", () => {
    const summaries = repairPlanTradeoffFor([
      plan({ label: "최소 변경", remainingWarnings: 0, changes: [{} as RecommendationPlan["changes"][number]], priceDeltaWon: undefined }),
      plan({ label: "가성비", remainingWarnings: 1, changes: [{}, {}] as RecommendationPlan["changes"], priceDeltaWon: undefined })
    ]);

    expect(summaries[0].frontier).toBe(true);
    expect(summaries[1]).toMatchObject({ frontier: false, dominatedByPlanIndex: 0 });
  });
});
