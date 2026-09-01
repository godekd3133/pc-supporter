import { describe, expect, it } from "vitest";
import type { CatalogChangeRecord } from "./types";
import { catalogChangeBenchmarkChanged, catalogChangeDashboardSummary, catalogChangeMatches, catalogChangeMissingIncreased, catalogChangeMissingReduced, catalogChangeQualityDegraded, catalogChangeQualityImproved, prioritizedCatalogChanges } from "./catalog-change-filters";

const record = (overrides: Partial<CatalogChangeRecord> = {}): CatalogChangeRecord => ({
  id: "change-1",
  kind: "part",
  itemId: "part-1",
  itemName: "테스트 부품",
  category: "cpu",
  changedAt: "2026-08-28T00:00:00.000Z",
  changedFields: [],
  previousDataQuality: "incomplete",
  nextDataQuality: "incomplete",
  previousMissingFields: ["socket"],
  nextMissingFields: ["socket"],
  ...overrides
});

describe("catalog change filters", () => {
  it("matches price direction and catalog kind without classifying unknown prices", () => {
    const priceUp = record({ id: "up", priceDeltaWon: 1000 });
    const priceDown = record({ id: "down", priceDeltaWon: -1000 });
    const newlyKnown = record({ id: "newly-known", previousPriceWon: undefined, nextPriceWon: 1200 });
    const unknown = record({ id: "unknown", kind: "accessory" });

    expect(catalogChangeMatches(priceUp, "all", "price_up")).toBe(true);
    expect(catalogChangeMatches(priceUp, "all", "price_down")).toBe(false);
    expect(catalogChangeMatches(priceDown, "all", "price_down")).toBe(true);
    expect(catalogChangeMatches(newlyKnown, "all", "price_newly_known")).toBe(true);
    expect(catalogChangeMatches(unknown, "accessory", "all")).toBe(true);
    expect(catalogChangeMatches(unknown, "part", "all")).toBe(false);
    expect(catalogChangeMatches(unknown, "all", "price_up")).toBe(false);
  });

  it("recognizes quality improvement and missing-field reduction", () => {
    const improved = record({
      previousDataQuality: "incomplete",
      nextDataQuality: "live",
      previousMissingFields: ["socket", "tdp"],
      nextMissingFields: ["tdp"]
    });

    expect(catalogChangeQualityImproved(improved)).toBe(true);
    expect(catalogChangeMissingReduced(improved)).toBe(true);
    expect(catalogChangeMatches(improved, "all", "quality_improved")).toBe(true);
    expect(catalogChangeMatches(improved, "all", "missing_reduced")).toBe(true);
    const degraded = record({ previousDataQuality: "live", nextDataQuality: "incomplete", previousMissingFields: [], nextMissingFields: ["socket"] });
    expect(catalogChangeQualityDegraded(degraded)).toBe(true);
    expect(catalogChangeMissingIncreased(degraded)).toBe(true);
    expect(catalogChangeMatches(degraded, "all", "quality_improved")).toBe(false);
    expect(catalogChangeMatches(degraded, "all", "quality_degraded")).toBe(true);
    expect(catalogChangeMatches(degraded, "all", "missing_increased")).toBe(true);
  });

  it("summarizes only known price directions and each change dimension", () => {
    const records = [
      record({ id: "up", priceDeltaWon: 1000, changedFields: ["가격", "원문 스펙"] }),
      record({ id: "down", priceDeltaWon: -500 }),
      record({ id: "newly-known", previousPriceWon: undefined, nextPriceWon: 1000 }),
      record({ id: "quality", previousDataQuality: "seed", nextDataQuality: "live" }),
      record({ id: "missing", previousMissingFields: ["socket"], nextMissingFields: [] }),
      record({ id: "degraded", previousDataQuality: "live", nextDataQuality: "incomplete", previousMissingFields: [], nextMissingFields: ["socket"] }),
      record({ id: "unknown", kind: "accessory", previousPriceWon: undefined, nextPriceWon: undefined })
    ];

    expect(catalogChangeDashboardSummary(records)).toEqual({ total: 7, priceUp: 1, priceDown: 1, priceNewlyKnown: 1, qualityImproved: 1, qualityDegraded: 1, missingReduced: 1, missingIncreased: 1, specChanged: 1, benchmarkChanged: 0 });
  });

  it("isolates benchmark override changes from generic specification changes", () => {
    const benchmark = record({ changedFields: ["벤치마크 보강", "sourceNote"] });

    expect(catalogChangeBenchmarkChanged(benchmark)).toBe(true);
    expect(catalogChangeMatches(benchmark, "all", "benchmark")).toBe(true);
    expect(catalogChangeMatches(benchmark, "all", "spec")).toBe(false);
    expect(catalogChangeDashboardSummary([benchmark]).benchmarkChanged).toBe(1);
  });

  it("builds an actionable priority queue and leaves normal spec-only changes out", () => {
    const priceUp = record({ id: "price-up", changedAt: "2026-08-28T03:00:00.000Z", priceDeltaWon: 1000 });
    const missingIncreased = record({ id: "missing-up", changedAt: "2026-08-28T02:00:00.000Z", previousMissingFields: [], nextMissingFields: ["socket"] });
    const degraded = record({ id: "degraded", changedAt: "2026-08-28T01:00:00.000Z", previousDataQuality: "live", nextDataQuality: "incomplete" });
    const specOnly = record({ id: "spec-only", changedAt: "2026-08-28T04:00:00.000Z", changedFields: ["원문 스펙"] });

    expect(prioritizedCatalogChanges([priceUp, missingIncreased, degraded, specOnly], 3).map((item) => item.record.id)).toEqual(["degraded", "missing-up", "price-up"]);
    expect(prioritizedCatalogChanges([degraded])[0].reasons).toEqual(["품질 저하"]);
    expect(prioritizedCatalogChanges([specOnly])).toEqual([]);
  });
});
