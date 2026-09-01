import { describe, expect, it } from "vitest";
import type { CatalogChangeRecord } from "./types";
import { catalogChangeKstDateFor, catalogChangePriceHistoryFor, catalogChangePriceHistorySummaryFor, catalogChangePriceHistoryWithinWindowFor, catalogChangePriceNearLowRankingsFor, catalogChangePriceOpportunitiesFor, catalogChangePriceVolatilityRankingsFor, catalogChangePriceWatchSignalsFor, catalogChangePriceWindowSummaryFor, catalogChangeTrendFor } from "./catalog-change-analytics";

const record = (overrides: Partial<CatalogChangeRecord> = {}): CatalogChangeRecord => ({
  id: "change-1",
  kind: "part",
  itemId: "part-1",
  itemName: "테스트 부품",
  category: "cpu",
  changedAt: "2026-08-28T00:00:00.000Z",
  changedFields: ["가격"],
  previousDataQuality: "live",
  nextDataQuality: "live",
  previousMissingFields: [],
  nextMissingFields: [],
  previousPriceWon: 100000,
  nextPriceWon: 100000,
  priceDeltaWon: 0,
  ...overrides
});

describe("catalog change analytics", () => {
  it("uses the Korean timezone date for a UTC boundary", () => {
    expect(catalogChangeKstDateFor("2026-08-27T23:25:53.000Z")).toBe("2026-08-28");
  });

  it("aggregates known non-zero price deltas by day and leaves unknown prices out", () => {
    const trend = catalogChangeTrendFor([
      record({ id: "up", changedAt: "2026-08-27T01:30:00.000Z", priceDeltaWon: 2000, previousPriceWon: 100000, nextPriceWon: 102000 }),
      record({ id: "down", changedAt: "2026-08-28T01:00:00.000Z", priceDeltaWon: -500, previousPriceWon: 102000, nextPriceWon: 101500 }),
      record({ id: "derived", changedAt: "2026-08-28T03:00:00.000Z", priceDeltaWon: undefined, previousPriceWon: 101500, nextPriceWon: 101000 }),
      record({ id: "unknown", changedAt: "2026-08-28T04:00:00.000Z", priceDeltaWon: undefined, previousPriceWon: undefined, nextPriceWon: 1000 }),
      record({ id: "zero", changedAt: "2026-08-28T05:00:00.000Z", priceDeltaWon: 0 })
    ], { days: 3, anchor: "2026-08-28T12:00:00+09:00" });

    expect(trend.points.map((point) => point.date)).toEqual(["2026-08-26", "2026-08-27", "2026-08-28"]);
    expect(trend.priceChangeCount).toBe(3);
    expect(trend.priceUpCount).toBe(1);
    expect(trend.priceDownCount).toBe(2);
    expect(trend.priceUpWon).toBe(2000);
    expect(trend.priceDownWon).toBe(1000);
    expect(trend.netDeltaWon).toBe(1000);
    expect(trend.points[1]).toMatchObject({ priceChangeCount: 1, priceUpWon: 2000, netDeltaWon: 2000 });
    expect(trend.points[2]).toMatchObject({ priceChangeCount: 2, priceDownWon: 1000, netDeltaWon: -1000 });
  });

  it("returns an explicit zero-filled window when there are no comparable changes", () => {
    const trend = catalogChangeTrendFor([record({ priceDeltaWon: 0 })], { days: 4, anchor: "2026-08-28T00:00:00Z" });

    expect(trend.points).toHaveLength(4);
    expect(trend.priceChangeCount).toBe(0);
    expect(trend.points.every((point) => point.priceChangeCount === 0 && point.netDeltaWon === 0)).toBe(true);
  });

  it("keeps a single part's known next-price samples in chronological order", () => {
    const history = catalogChangePriceHistoryFor([
      record({ id: "later", changedAt: "2026-08-28T02:00:00Z", previousPriceWon: 101000, nextPriceWon: 102000, priceDeltaWon: 1000 }),
      record({ id: "earlier", changedAt: "2026-08-27T02:00:00Z", previousPriceWon: 100000, nextPriceWon: 101000, priceDeltaWon: 1000 }),
      record({ id: "unknown", changedAt: "2026-08-29T02:00:00Z", previousPriceWon: undefined, nextPriceWon: undefined, priceDeltaWon: undefined }),
      record({ id: "zero", changedAt: "2026-08-29T03:00:00Z", previousPriceWon: 102000, nextPriceWon: 0, priceDeltaWon: -102000 })
    ]);

    expect(history.map((point) => point.changeId)).toEqual(["earlier", "later"]);
    expect(history.map((point) => point.priceWon)).toEqual([101000, 102000]);
    expect(history[1].deltaWon).toBe(1000);
  });

  it("calculates first-to-latest and high-to-latest percentage changes from known samples", () => {
    const points = catalogChangePriceHistoryFor([
      record({ id: "first", changedAt: "2026-08-27T00:00:00Z", nextPriceWon: 100000 }),
      record({ id: "high", changedAt: "2026-08-28T00:00:00Z", nextPriceWon: 120000 }),
      record({ id: "latest", changedAt: "2026-08-29T00:00:00Z", nextPriceWon: 110000 })
    ]);
    const summary = catalogChangePriceHistorySummaryFor(points);

    expect(summary).toMatchObject({ sampleCount: 3, firstPriceWon: 100000, latestPriceWon: 110000, minPriceWon: 100000, maxPriceWon: 120000, netDeltaWon: 10000, fromHighDeltaWon: -10000 });
    expect(summary.netChangePercent).toBeCloseTo(10, 8);
    expect(summary.fromHighPercent).toBeCloseTo(-8.333333, 5);
    expect(catalogChangePriceHistorySummaryFor([])).toEqual({ sampleCount: 0 });
  });

  it("limits price metrics to the requested recent window and detects a drop followed by rebound", () => {
    const points = catalogChangePriceHistoryFor([
      record({ id: "old", changedAt: "2026-06-01T00:00:00Z", nextPriceWon: 90000 }),
      record({ id: "first", changedAt: "2026-08-01T00:00:00Z", nextPriceWon: 100000 }),
      record({ id: "low", changedAt: "2026-08-15T00:00:00Z", nextPriceWon: 80000 }),
      record({ id: "rebound", changedAt: "2026-08-20T00:00:00Z", nextPriceWon: 90000 })
    ]);
    const sevenDayPoints = catalogChangePriceHistoryWithinWindowFor(points, { days: 7, anchor: "2026-08-29T00:00:00Z" });
    const windowPoints = catalogChangePriceHistoryWithinWindowFor(points, { days: 30, anchor: "2026-08-29T00:00:00Z" });
    const ninetyDaySummary = catalogChangePriceWindowSummaryFor(points, { days: 90, anchor: "2026-08-29T00:00:00Z" });
    const summary = catalogChangePriceWindowSummaryFor(points, { days: 30, anchor: "2026-08-29T00:00:00Z" });

    expect(sevenDayPoints).toEqual([]);
    expect(windowPoints.map((point) => point.changeId)).toEqual(["first", "low", "rebound"]);
    expect(summary).toMatchObject({ windowDays: 30, sampleCount: 3, minPriceWon: 80000, maxPriceWon: 100000, latestPriceWon: 90000, rangeWon: 20000, currentPositionPercent: 50, hasDropThenRebound: true });
    expect(summary.rangePercent).toBeCloseTo(25, 8);
    expect(ninetyDaySummary).toMatchObject({ windowDays: 90, sampleCount: 4, minPriceWon: 80000, maxPriceWon: 100000, latestPriceWon: 90000, hasDropThenRebound: true });
  });

  it("returns only multi-sample items below their historical high, ordered by percentage drop", () => {
    const opportunities = catalogChangePriceOpportunitiesFor([
      record({ id: "memory-first", itemId: "memory", itemName: "메모리", changedAt: "2026-08-27T00:00:00Z", nextPriceWon: 100000 }),
      record({ id: "memory-latest", itemId: "memory", itemName: "메모리", changedAt: "2026-08-28T00:00:00Z", previousPriceWon: 100000, nextPriceWon: 90000, priceDeltaWon: -10000 }),
      record({ id: "hdd-first", itemId: "hdd", itemName: "HDD", changedAt: "2026-08-27T00:00:00Z", nextPriceWon: 200000 }),
      record({ id: "hdd-low", itemId: "hdd", itemName: "HDD", changedAt: "2026-08-28T00:00:00Z", previousPriceWon: 200000, nextPriceWon: 100000, priceDeltaWon: -100000 }),
      record({ id: "hdd-latest", itemId: "hdd", itemName: "HDD", changedAt: "2026-08-29T00:00:00Z", previousPriceWon: 100000, nextPriceWon: 150000, priceDeltaWon: 50000 }),
      record({ id: "flat-first", itemId: "flat", itemName: "동일 가격", changedAt: "2026-08-27T00:00:00Z", nextPriceWon: 50000 }),
      record({ id: "flat-latest", itemId: "flat", itemName: "동일 가격", changedAt: "2026-08-28T00:00:00Z", nextPriceWon: 50000, priceDeltaWon: 0 }),
      record({ id: "unknown", itemId: "unknown", itemName: "미확인", changedAt: "2026-08-28T00:00:00Z", previousPriceWon: undefined, nextPriceWon: undefined, priceDeltaWon: undefined })
    ]);

    expect(opportunities.map((item) => item.itemId)).toEqual(["hdd", "memory"]);
    expect(opportunities[0]).toMatchObject({ latestChangeId: "hdd-latest", latestPriceWon: 150000, maxPriceWon: 200000, fromHighDeltaWon: -50000, rangeWon: 100000, currentPositionPercent: 50, hasDropThenRebound: true });
    expect(opportunities[0].fromHighPercent).toBeCloseTo(-25, 8);
    expect(opportunities[1].fromHighPercent).toBeCloseTo(-10, 8);
  });

  it("ranks price volatility independently from near-low position", () => {
    const records = [
      record({ id: "memory-first", itemId: "memory", itemName: "메모리", changedAt: "2026-08-27T00:00:00Z", nextPriceWon: 100000 }),
      record({ id: "memory-latest", itemId: "memory", itemName: "메모리", changedAt: "2026-08-28T00:00:00Z", previousPriceWon: 100000, nextPriceWon: 90000, priceDeltaWon: -10000 }),
      record({ id: "hdd-first", itemId: "hdd", itemName: "HDD", changedAt: "2026-08-27T00:00:00Z", nextPriceWon: 200000 }),
      record({ id: "hdd-low", itemId: "hdd", itemName: "HDD", changedAt: "2026-08-28T00:00:00Z", previousPriceWon: 200000, nextPriceWon: 100000, priceDeltaWon: -100000 }),
      record({ id: "hdd-latest", itemId: "hdd", itemName: "HDD", changedAt: "2026-08-29T00:00:00Z", previousPriceWon: 100000, nextPriceWon: 150000, priceDeltaWon: 50000 }),
      record({ id: "rising-first", itemId: "rising", itemName: "상승 부품", changedAt: "2026-08-27T00:00:00Z", nextPriceWon: 100000 }),
      record({ id: "rising-latest", itemId: "rising", itemName: "상승 부품", changedAt: "2026-08-28T00:00:00Z", previousPriceWon: 100000, nextPriceWon: 150000, priceDeltaWon: 50000 })
    ];

    expect(catalogChangePriceVolatilityRankingsFor(records, 2).map((item) => item.itemId)).toEqual(["hdd", "rising"]);
    expect(catalogChangePriceNearLowRankingsFor(records, 2).map((item) => item.itemId)).toEqual(["memory", "hdd"]);
  });

  it("emits inclusive price watch signals only when there are at least two samples", () => {
    const points = catalogChangePriceHistoryFor([
      record({ id: "first", changedAt: "2026-08-27T00:00:00Z", nextPriceWon: 100000 }),
      record({ id: "low", changedAt: "2026-08-28T00:00:00Z", nextPriceWon: 80000 }),
      record({ id: "rebound", changedAt: "2026-08-29T00:00:00Z", nextPriceWon: 90000 })
    ]);
    const summary = catalogChangePriceWindowSummaryFor(points, { days: 30, anchor: "2026-08-29T00:00:00Z" });

    expect(catalogChangePriceWatchSignalsFor(summary, 50, 90000)).toEqual(["near_low", "below_high", "rebound", "target_reached"]);
    expect(catalogChangePriceWatchSignalsFor(summary, 49)).toEqual(["below_high", "rebound"]);
    expect(catalogChangePriceWatchSignalsFor({ ...summary, sampleCount: 1 }, 100)).toEqual([]);
    expect(catalogChangePriceWatchSignalsFor({ ...summary, sampleCount: 1 }, 100, 90000)).toEqual(["target_reached"]);
  });
});
