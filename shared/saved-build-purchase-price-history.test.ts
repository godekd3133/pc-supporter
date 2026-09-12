import { describe, expect, it } from "vitest";
import { savedBuildPurchasePriceHistoryMatchesFilter, savedBuildPurchasePriceHistorySummaryFor } from "./saved-build-purchase-price-history";

const history = {
  inputFingerprint: "fingerprint",
  rowKeys: ["cpu", "gpu"],
  priceHistory: {
    cpu: [{ checkedAt: "2026-09-01T00:00:00.000Z", unitPriceWon: 100_000 }, { checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 110_000 }],
    gpu: [{ checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 300_000 }]
  },
  revision: 3,
  updatedAt: "2026-09-02T01:00:00.000Z",
  history: [{ inputFingerprint: "fingerprint", rowKeys: ["cpu", "gpu"], priceHistory: {}, revision: 2, updatedAt: "2026-09-01T01:00:00.000Z" }]
};

describe("saved build purchase price history summary", () => {
  it("counts recorded rows and samples without treating an incomplete history as complete", () => {
    expect(savedBuildPurchasePriceHistorySummaryFor(history)).toEqual({ status: "multi-sample", recordedRowCount: 2, sampleCount: 3, minSampleCount: 1, maxSampleCount: 2, revision: 3, historyCount: 1, updatedAt: "2026-09-02T01:00:00.000Z" });
  });

  it("supports history filters", () => {
    const summary = savedBuildPurchasePriceHistorySummaryFor(history);
    expect(savedBuildPurchasePriceHistoryMatchesFilter(summary, "recorded")).toBe(true);
    expect(savedBuildPurchasePriceHistoryMatchesFilter(summary, "multi-sample")).toBe(true);
    expect(savedBuildPurchasePriceHistoryMatchesFilter(summary, "server-history")).toBe(true);
    expect(savedBuildPurchasePriceHistoryMatchesFilter(savedBuildPurchasePriceHistorySummaryFor(undefined), "unrecorded")).toBe(true);
  });
});
