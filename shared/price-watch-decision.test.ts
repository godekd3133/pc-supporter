import { describe, expect, it } from "vitest";
import { priceWatchDecisionCountsFor, priceWatchDecisionFor } from "./price-watch-decision";

describe("price watch decision", () => {
  it("prioritizes errors and unavailable prices over optimistic actions", () => {
    expect(priceWatchDecisionFor({ currentStatus: "error" })).toMatchObject({ state: "error", label: "일시 확인 오류" });
    expect(priceWatchDecisionFor({ currentStatus: "unavailable" })).toMatchObject({ state: "unavailable", label: "가격 확인 필요" });
    expect(priceWatchDecisionFor({ currentStatus: "available" })).toMatchObject({ state: "unavailable", label: "가격 확인 필요" });
  });

  it("prioritizes a reached target price", () => {
    const result = priceWatchDecisionFor({ currentStatus: "available", currentPriceWon: 99000, targetPriceWon: 100000, history: { sampleCount: 5, currentPositionPercent: 90, hasDropThenRebound: false } });

    expect(result).toMatchObject({ state: "target", label: "목표가 도달" });
    expect(result.summary).toContain("99,000원");
  });

  it("marks a price near the recent low as a purchase review signal", () => {
    const result = priceWatchDecisionFor({ currentStatus: "available", currentPriceWon: 105000, nearLowThresholdPercent: 10, history: { sampleCount: 4, minPriceWon: 100000, currentPositionPercent: 8, hasDropThenRebound: false } });

    expect(result).toMatchObject({ state: "buy", label: "구매 검토" });
  });

  it("suggests waiting near a recent high and observes a rebound otherwise", () => {
    const wait = priceWatchDecisionFor({ currentStatus: "available", currentPriceWon: 195000, history: { sampleCount: 6, currentPositionPercent: 95, fromHighPercent: -1, hasDropThenRebound: false } });
    const observe = priceWatchDecisionFor({ currentStatus: "available", currentPriceWon: 150000, history: { sampleCount: 6, currentPositionPercent: 50, fromHighPercent: -23, hasDropThenRebound: true } });

    expect(wait).toMatchObject({ state: "wait", label: "가격 하락 대기" });
    expect(observe).toMatchObject({ state: "observe", label: "재상승 관찰" });
  });

  it("keeps tracking when the target is not reached and history is inconclusive", () => {
    const result = priceWatchDecisionFor({ currentStatus: "available", currentPriceWon: 120000, targetPriceWon: 100000, history: { sampleCount: 1, hasDropThenRebound: false } });

    expect(result).toMatchObject({ state: "tracking", label: "목표가 관찰 중" });
    expect(result.summary).toContain("20,000원");
  });

  it("counts the shared decision distribution without dropping unavailable states", () => {
    expect(priceWatchDecisionCountsFor({ first: "target", second: "buy", third: "unavailable", fourth: "error", fifth: "unavailable" })).toEqual({ target: 1, buy: 1, wait: 0, observe: 0, tracking: 0, unavailable: 2, error: 1 });
  });
});
