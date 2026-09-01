import { describe, expect, it } from "vitest";
import { alternativeCandidatePriceWon, alternativeCandidateWithinBudget } from "./alternative-budget";

describe("alternative candidate budget", () => {
  it("multiplies a candidate unit price by its recommended quantity", () => {
    expect(alternativeCandidatePriceWon(169000, 2)).toBe(338000);
    expect(alternativeCandidateWithinBudget(169000, 2, 338000)).toBe(true);
    expect(alternativeCandidateWithinBudget(169000, 2, 337999)).toBe(false);
  });

  it("excludes unknown prices only when a budget filter is active", () => {
    expect(alternativeCandidateWithinBudget(undefined, undefined, undefined)).toBe(true);
    expect(alternativeCandidateWithinBudget(undefined, undefined, 300000)).toBe(false);
    expect(alternativeCandidatePriceWon(100000, 0)).toBeUndefined();
  });
});
