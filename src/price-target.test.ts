import { describe, expect, it } from "vitest";
import { recommendedTargetPriceFromHistory } from "./price-target";

describe("history-based price target", () => {
  it("recommends the observed low only when at least two samples exist", () => {
    expect(recommendedTargetPriceFromHistory({ sampleCount: 2, minPriceWon: 109000 })).toBe(109000);
    expect(recommendedTargetPriceFromHistory({ sampleCount: 1, minPriceWon: 109000 })).toBeUndefined();
  });

  it("does not invent a target from malformed or missing prices", () => {
    expect(recommendedTargetPriceFromHistory({ sampleCount: 3 })).toBeUndefined();
    expect(recommendedTargetPriceFromHistory({ sampleCount: 3, minPriceWon: 0 })).toBeUndefined();
    expect(recommendedTargetPriceFromHistory({ sampleCount: 3, minPriceWon: Number.NaN })).toBeUndefined();
  });
});
