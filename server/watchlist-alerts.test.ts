import { describe, expect, it } from "vitest";
import { savedWatchlistAlertsFor } from "./watchlist-alerts";

const watchlist = {
  id: "watch-1",
  name: "관심 목록",
  entries: [{ itemId: "cpu-1", itemName: "테스트 CPU", category: "cpu" as const, kind: "part" as const, addedAt: "2026-08-28T00:00:00.000Z", targetPriceWon: 100000 }],
  nearLowThresholdPercent: 10 as const,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z"
};

const record = (overrides: Record<string, unknown> = {}) => ({
  id: "change-1",
  kind: "part" as const,
  itemId: "cpu-1",
  itemName: "테스트 CPU",
  category: "cpu" as const,
  changedAt: "2026-08-28T01:00:00.000Z",
  changedFields: ["가격"],
  previousDataQuality: "live" as const,
  nextDataQuality: "live" as const,
  previousMissingFields: [],
  nextMissingFields: [],
  previousPriceWon: 120000,
  nextPriceWon: 110000,
  priceDeltaWon: -10000,
  ...overrides
});

describe("saved watchlist alerts", () => {
  it("creates a drop alert only after the watchlist was created", () => {
    expect(savedWatchlistAlertsFor(watchlist, [record(), record({ id: "old", changedAt: "2026-08-27T23:00:00.000Z" })])).toMatchObject([{ kind: "drop", message: "테스트 CPU 가격이 10,000원 하락했습니다." }]);
  });

  it("prioritizes target reached and limits returned history", () => {
    const records = Array.from({ length: 25 }, (_value, index) => record({ id: "change-" + index, changedAt: "2026-08-28T01:" + String(index).padStart(2, "0") + ":00.000Z", previousPriceWon: 105000, nextPriceWon: index === 24 ? 99000 : 104000 }));
    const alerts = savedWatchlistAlertsFor(watchlist, records);
    expect(alerts).toHaveLength(20);
    expect(alerts[0]).toMatchObject({ kind: "target", id: "change-24:target" });
  });

  it("ignores unknown prices, other items, and future changes", () => {
    const now = Date.parse("2026-08-28T12:00:00.000Z");
    expect(savedWatchlistAlertsFor(watchlist, [record({ previousPriceWon: undefined, changedFields: ["원문 스펙"] }), record({ id: "other", itemId: "cpu-2" }), record({ id: "future", changedAt: "2026-08-29T01:00:00.000Z" })], now)).toEqual([]);
  });

  it("applies the saved alert policy to target and percentage-drop signals", () => {
    const disabled = { ...watchlist, alertPreferences: { targetReached: false, priceDrop: false, priceAvailability: true, minimumDropPercent: 0 as const } };
    expect(savedWatchlistAlertsFor(disabled, [record({ previousPriceWon: 105000, nextPriceWon: 99000 })])).toEqual([]);

    const fivePercent = { ...watchlist, alertPreferences: { targetReached: true, priceDrop: true, priceAvailability: true, minimumDropPercent: 5 as const } };
    expect(savedWatchlistAlertsFor(fivePercent, [record({ previousPriceWon: 120000, nextPriceWon: 115000 })])).toEqual([]);
    expect(savedWatchlistAlertsFor(fivePercent, [record({ previousPriceWon: 120000, nextPriceWon: 110000 })])).toMatchObject([{ kind: "drop" }]);
  });

  it("creates availability alerts only for price field transitions", () => {
    const policyWatchlist = { ...watchlist, alertPreferences: { targetReached: true, priceDrop: true, priceAvailability: true, minimumDropPercent: 0 as const } };
    expect(savedWatchlistAlertsFor(policyWatchlist, [record({ previousPriceWon: undefined, nextPriceWon: 110000, changedFields: ["가격"] })])).toMatchObject([{ kind: "availability", message: "테스트 CPU의 가격을 다시 확인할 수 있습니다." }]);
    expect(savedWatchlistAlertsFor(policyWatchlist, [record({ previousPriceWon: 110000, nextPriceWon: undefined, changedFields: ["가격"] })])).toMatchObject([{ kind: "availability", message: "테스트 CPU의 가격을 확인할 수 없습니다." }]);
    expect(savedWatchlistAlertsFor(policyWatchlist, [record({ previousPriceWon: undefined, nextPriceWon: 110000, changedFields: ["원문 스펙"] })])).toEqual([]);
  });
});
