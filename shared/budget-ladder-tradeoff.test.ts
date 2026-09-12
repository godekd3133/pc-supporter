import { describe, expect, it } from "vitest";
import type { BudgetLadderOutcome } from "./budget-ladder";
import type { BuildGenerationResult } from "./types";
import { budgetLadderTradeoffFor } from "./budget-ladder-tradeoff";

function outcome(id: BudgetLadderOutcome["id"], label: string, overrides: Partial<BuildGenerationResult> = {}): BudgetLadderOutcome {
  return {
    id,
    label,
    description: "테스트",
    budgetWon: 1_000_000,
    draft: {
      blockerCount: 0,
      warningCount: 0,
      unknownCount: 0,
      totalPriceWon: 900_000,
      priceComplete: true,
      analysis: { overallScore: 60 } as BuildGenerationResult["analysis"],
      ...overrides
    } as BuildGenerationResult
  };
}

describe("budget ladder tradeoff frontier", () => {
  it("keeps real budget tradeoffs and removes a more expensive equal-outcome scenario", () => {
    const summaries = budgetLadderTradeoffFor([
      outcome("economy", "절약형", { totalPriceWon: 900_000, analysis: { overallScore: 60 } as BuildGenerationResult["analysis"] }),
      outcome("target", "목표 예산", { warningCount: 1, totalPriceWon: 950_000, analysis: { overallScore: 75 } as BuildGenerationResult["analysis"] }),
      outcome("headroom", "여유형", { warningCount: 1, totalPriceWon: 1_000_000, analysis: { overallScore: 75 } as BuildGenerationResult["analysis"] })
    ]);

    expect(summaries[0].frontier).toBe(true);
    expect(summaries[1].frontier).toBe(true);
    expect(summaries[2]).toMatchObject({ frontier: false, dominatedByScenarioIndex: 1, riskScore: 10, totalPriceWon: 1_000_000, analysisScore: 75 });
    expect(summaries[2].reason).toContain("목표 예산");
  });

  it("does not compare a confirmed price or score against an unknown value", () => {
    const summaries = budgetLadderTradeoffFor([
      outcome("economy", "절약형", { totalPriceWon: 900_000, analysis: { overallScore: 80 } as BuildGenerationResult["analysis"] }),
      outcome("target", "목표 예산", { priceComplete: false, totalPriceWon: 700_000, analysis: undefined })
    ]);

    expect(summaries.every((summary) => summary.frontier)).toBe(true);
  });

  it("keeps failed scenarios out of dominance comparisons", () => {
    const summaries = budgetLadderTradeoffFor([
      outcome("economy", "절약형"),
      { id: "target", label: "목표 예산", description: "실패", budgetWon: 1_000_000, error: "조건 부족" }
    ]);

    expect(summaries[1]).toMatchObject({ frontier: true, reason: "생성 실패로 다른 예산 구간과 비교하지 않았습니다." });
  });
});
