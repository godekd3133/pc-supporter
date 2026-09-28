import { describe, expect, it } from "vitest";
import { sharedCustomerPartSummaryForDisplay } from "./SharedAlternativeComparisonView";

describe("sharedCustomerPartSummaryForDisplay", () => {
  it("removes benchmark score segments while preserving other specifications", () => {
    expect(sharedCustomerPartSummaryForDisplay("AM5 · R23 멀티 18,000 / DDR5 · Cinebench R23 싱글 1,700"))
      .toBe("AM5 · DDR5");
  });
});
