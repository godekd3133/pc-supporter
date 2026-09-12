import { describe, expect, it } from "vitest";
import { accessoryCoverageGapFor, accessoryCoveragePercentFor, accessoryWorkPriorityFor } from "./accessory-work-priority";

const snapshot = {
  updatedAt: "2026-09-04T00:00:00.000Z",
  categories: [
    { category: "cooling_fan" as const, categoryId: "fan", storedProductCount: 100, liveProducts: 10, incompleteProducts: 90, pricedProducts: 100, pagesExpected: 1, pagesVisited: 1, listedProducts: 100, uniqueProducts: 100, detailFetched: 10, detailFailed: 0, missingProducts: 0, incompleteSpecs: 0, listCoverage: "complete" as const, coverage: "complete" as const, specCoverage: "partial" as const, storedSpecCoverage: "partial" as const, mode: "sample" as const, details: true, onlyIncomplete: false, lastCrawledAt: "2026-09-04T00:00:00.000Z" },
    { category: "m2_heatsink" as const, categoryId: "heatsink", storedProductCount: 50, liveProducts: 50, incompleteProducts: 0, pricedProducts: 50, pagesExpected: 1, pagesVisited: 1, listedProducts: 50, uniqueProducts: 50, detailFetched: 0, detailFailed: 0, missingProducts: 0, incompleteSpecs: 50, listCoverage: "complete" as const, coverage: "complete" as const, specCoverage: "partial" as const, storedSpecCoverage: "partial" as const, mode: "all" as const, details: false, onlyIncomplete: false, lastCrawledAt: "2026-09-04T00:00:00.000Z" },
    { category: "thermal_grease" as const, categoryId: "grease", storedProductCount: 25, liveProducts: 25, incompleteProducts: 0, pricedProducts: 25, pagesExpected: 1, pagesVisited: 1, listedProducts: 25, uniqueProducts: 25, detailFetched: 25, detailFailed: 0, missingProducts: 0, incompleteSpecs: 0, listCoverage: "complete" as const, coverage: "complete" as const, specCoverage: "complete" as const, storedSpecCoverage: "complete" as const, mode: "sample" as const, details: true, onlyIncomplete: true, lastCrawledAt: "2026-09-04T00:00:00.000Z" }
  ]
};

describe("accessory work priority", () => {
  it("prioritizes categories that need detailed accessory enrichment", () => {
    const actions = accessoryWorkPriorityFor(snapshot);
    expect(actions.map((action) => action.id)).toEqual(["accessory:cooling_fan", "accessory:m2_heatsink"]);
    expect(actions[1]).toMatchObject({ gapCount: 50, incompleteProductCount: 0, incompleteSpecCount: 50, coveragePercent: 0, details: false });
    expect(accessoryCoverageGapFor(snapshot.categories[1])).toBe(50);
    expect(accessoryCoveragePercentFor(snapshot.categories[1])).toBe(0);
  });

  it("omits complete categories and bounds the result", () => {
    expect(accessoryWorkPriorityFor(snapshot, 1)).toHaveLength(1);
    expect(accessoryWorkPriorityFor(undefined)).toEqual([]);
  });
});
