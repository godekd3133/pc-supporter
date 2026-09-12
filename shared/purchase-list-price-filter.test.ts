import { describe, expect, it } from "vitest";
import type { PurchaseListRow } from "./purchase-list";
import { purchaseListDataFreshnessCountsFor, purchaseListPriceFilterCounts, purchaseListPriceFilterMatches, purchaseListRowMatchesQuery } from "./purchase-list-price-filter";

const rows: PurchaseListRow[] = [
  { id: "cpu", sourceKind: "part", sourceId: "cpu-a", section: "핵심 부품", categoryLabel: "CPU", name: "CPU", quantity: 1, unitPriceWon: 100_000, totalPriceWon: 100_000 },
  { id: "gpu", sourceKind: "part", sourceId: "gpu-a", section: "핵심 부품", categoryLabel: "GPU", name: "GPU", quantity: 2, unitPriceWon: 200_000, totalPriceWon: 400_000 },
  { id: "case", sourceKind: "part", sourceId: "case-a", section: "핵심 부품", categoryLabel: "케이스", name: "케이스", quantity: 1 }
];

describe("purchase list price filters", () => {
  it("counts changed and unresolved rows without changing the overall row count", () => {
    const livePrices = {
      cpu: { status: "available" as const, currentUnitPriceWon: 90_000 },
      gpu: { status: "available" as const, currentUnitPriceWon: 225_000 },
      case: { status: "unavailable" as const, reason: "not-priced" as const }
    };
    const counts = purchaseListPriceFilterCounts(rows, livePrices, new Set(["cpu"]));

    expect(counts).toEqual({ all: 3, remaining: 2, changed: 2, decreased: 1, increased: 1, needs_review: 1, data_review: 3 });
  });

  it("matches remaining rows independently from price status", () => {
    const live = { status: "available" as const, currentUnitPriceWon: 100_000 };

    expect(purchaseListPriceFilterMatches("remaining", rows[0]!, live, false)).toBe(true);
    expect(purchaseListPriceFilterMatches("remaining", rows[0]!, live, true)).toBe(false);
    expect(purchaseListPriceFilterMatches("all", rows[0]!, undefined, true)).toBe(true);
  });

  it("does not classify an unavailable or baseline-free row as a price change", () => {
    expect(purchaseListPriceFilterMatches("needs_review", rows[2]!, { status: "unavailable", reason: "not-priced" }, false)).toBe(true);
    expect(purchaseListPriceFilterMatches("changed", rows[2]!, { status: "available", currentUnitPriceWon: 50_000 }, false)).toBe(false);
    expect(purchaseListPriceFilterMatches("data_review", { ...rows[0], dataFreshness: "aging" }, undefined, false)).toBe(true);
    expect(purchaseListPriceFilterMatches("data_review", { ...rows[0], dataFreshness: "fresh" }, undefined, false)).toBe(false);
  });

  it("searches names and categories while keeping filter counts scoped to the query", () => {
    expect(purchaseListRowMatchesQuery(rows[1]!, "gpu")).toBe(true);
    expect(purchaseListRowMatchesQuery({ ...rows[1]!, connectionTarget: "팬 허브 A" }, "허브 A")).toBe(true);
    expect(purchaseListRowMatchesQuery(rows[1]!, "주변")).toBe(false);
    expect(purchaseListPriceFilterCounts(rows, {}, new Set(), "gpu")).toMatchObject({ all: 1, remaining: 1, needs_review: 1, data_review: 1 });
    expect(purchaseListDataFreshnessCountsFor([{ ...rows[0], dataFreshness: "fresh" }, { ...rows[1], dataFreshness: "stale" }, rows[2]])).toEqual({ fresh: 1, aging: 0, stale: 1, unknown: 1, needsReview: 2 });
  });
});
