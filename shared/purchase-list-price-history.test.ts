import { describe, expect, it } from "vitest";
import { purchaseListPriceHistoryDisplayFor, purchaseListPriceHistoryFromJson, purchaseListPriceHistoryRecordFor, purchaseListPriceHistorySummaryFor, purchaseListPriceHistoryToJson, type PurchaseListPriceHistory } from "./purchase-list-price-history";

describe("purchase list price history", () => {
  it("records only confirmed prices and summarizes the latest movement", () => {
    let history: PurchaseListPriceHistory = {};
    history = purchaseListPriceHistoryRecordFor(history, { cpu: 100_000, gpu: undefined }, "2026-09-02T00:00:00.000Z");
    history = purchaseListPriceHistoryRecordFor(history, { cpu: 110_000, gpu: 300_000, broken: 0 }, "2026-09-03T00:00:00.000Z");

    expect(history.gpu).toHaveLength(1);
    expect(history.broken).toBeUndefined();
    expect(purchaseListPriceHistorySummaryFor(history, "cpu")).toMatchObject({ sampleCount: 2, latestUnitPriceWon: 110_000, previousUnitPriceWon: 100_000, deltaFromPreviousWon: 10_000 });
    expect(purchaseListPriceHistoryDisplayFor(purchaseListPriceHistorySummaryFor(history, "cpu"))).toEqual({ tone: "increased", label: "이전 확인 대비 +10,000원" });
  });

  it("round-trips valid history and ignores malformed entries", () => {
    const history: PurchaseListPriceHistory = { cpu: [{ checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 100_000 }] };
    const parsed = purchaseListPriceHistoryFromJson(JSON.stringify({ ...JSON.parse(purchaseListPriceHistoryToJson(history, "2026-09-02T01:00:00.000Z")), entries: [...JSON.parse(purchaseListPriceHistoryToJson(history)).entries, { rowKey: "bad", observations: [{ checkedAt: "not-a-date", unitPriceWon: 100 }] }] }));
    expect(parsed).toEqual(history);
    expect(purchaseListPriceHistoryFromJson("not-json")).toEqual({});
  });

  it("keeps only the newest bounded samples", () => {
    const recorded = [1, 2, 3].reduce((current, price, index) => purchaseListPriceHistoryRecordFor(current, { cpu: price * 1000 }, `2026-09-0${index + 1}T00:00:00.000Z`, 2), {} as PurchaseListPriceHistory);
    expect(recorded.cpu).toEqual([
      { checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 2000 },
      { checkedAt: "2026-09-03T00:00:00.000Z", unitPriceWon: 3000 }
    ]);
  });

  it("rejects oversized local history rows before normalizing every raw entry", () => {
    const oversized = JSON.stringify({
      type: "pc-supporter-purchase-price-history",
      schemaVersion: 1,
      savedAt: "2026-09-02T00:00:00.000Z",
      entries: Array.from({ length: 101 }, (_, index) => ({ rowKey: `row-${index}`, observations: [{ checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 10_000 }] }))
    });

    expect(purchaseListPriceHistoryFromJson(oversized)).toEqual({});
  });
});
