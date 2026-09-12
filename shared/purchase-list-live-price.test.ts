import { describe, expect, it } from "vitest";
import { purchaseListLivePriceDisplayFor, purchaseListLivePriceSummaryFor, purchaseListRowsWithLivePricesFor, type PurchaseListLivePrice } from "./purchase-list-live-price";
import type { PurchaseListRow } from "./purchase-list";

const rows: PurchaseListRow[] = [
  { id: "cpu", sourceKind: "part", sourceId: "cpu-a", section: "핵심 부품", categoryLabel: "CPU", name: "CPU A", quantity: 1, unitPriceWon: 100_000, totalPriceWon: 100_000, priceEvidence: "reference" as const },
  { id: "gpu", sourceKind: "part", sourceId: "gpu-a", section: "핵심 부품", categoryLabel: "GPU", name: "GPU A", quantity: 2, unitPriceWon: 200_000, totalPriceWon: 400_000 },
  { id: "case", sourceKind: "part", sourceId: "case-a", section: "핵심 부품", categoryLabel: "케이스", name: "케이스 A", quantity: 1 }
];

describe("purchase list live prices", () => {
  it("overlays confirmed prices, exposes deltas, and preserves incomplete prices", () => {
    const livePrices: Record<string, PurchaseListLivePrice> = {
      cpu: { status: "available", currentUnitPriceWon: 120_000 },
      gpu: { status: "available", currentUnitPriceWon: 150_000 },
      case: { status: "unavailable", reason: "not-priced" }
    };
    const effective = purchaseListRowsWithLivePricesFor(rows, livePrices);
    expect(effective.map((row) => row.totalPriceWon)).toEqual([120_000, 300_000, undefined]);
    expect(effective.map((row) => row.priceEvidence)).toEqual(["live", "live", undefined]);
    expect(purchaseListLivePriceDisplayFor(rows[0]!, livePrices.cpu)).toMatchObject({ tone: "increased", deltaTotalPriceWon: 20_000 });
    expect(purchaseListLivePriceDisplayFor(rows[1]!, livePrices.gpu)).toMatchObject({ tone: "decreased", deltaTotalPriceWon: -100_000 });
    expect(purchaseListLivePriceDisplayFor(rows[2]!, livePrices.case)).toMatchObject({ tone: "unavailable" });
    expect(purchaseListLivePriceSummaryFor(rows, livePrices)).toMatchObject({ checkedCount: 3, availableCount: 2, unavailableCount: 1, changedCount: 2, increasedCount: 1, decreasedCount: 1 });
  });

  it("keeps source-refresh and stored-catalog provenance visible", () => {
    const sourceRow = { ...rows[0]!, refreshable: true };
    const catalogRow = { ...rows[1]!, priceEvidence: "reference" as const };
    const livePrices: Record<string, PurchaseListLivePrice> = {
      [sourceRow.id!]: { status: "available", currentUnitPriceWon: 125_000, source: "source-refresh" },
      [catalogRow.id!]: { status: "available", currentUnitPriceWon: 210_000, source: "catalog" }
    };

    const effective = purchaseListRowsWithLivePricesFor([sourceRow, catalogRow], livePrices);
    expect(effective.map((row) => row.priceEvidence)).toEqual(["live", "reference"]);
    expect(purchaseListLivePriceDisplayFor(sourceRow, livePrices[sourceRow.id!])).toMatchObject({ tone: "increased", source: "source-refresh", sourceLabel: "원문 확인 가격" });
    expect(purchaseListLivePriceDisplayFor(catalogRow, livePrices[catalogRow.id!])).toMatchObject({ tone: "increased", source: "catalog", sourceLabel: "저장 카탈로그 가격" });
    expect(purchaseListLivePriceDisplayFor(catalogRow, livePrices[catalogRow.id!])?.label).toContain("저장 카탈로그 가격");
    expect(purchaseListLivePriceSummaryFor([sourceRow, catalogRow], livePrices)).toMatchObject({ sourceConfirmedCount: 1, catalogConfirmedCount: 1 });
  });

  it("does not present source refresh failures as confirmed prices", () => {
    const sourceRow = { ...rows[0]!, refreshable: true };
    const live: PurchaseListLivePrice = { status: "unavailable", source: "source-refresh", reason: "source-refresh-blocked", retryAfterSeconds: 7 };
    expect(purchaseListRowsWithLivePricesFor([sourceRow], { [sourceRow.id!]: live })[0]).toEqual(sourceRow);
    expect(purchaseListLivePriceDisplayFor(sourceRow, live)).toMatchObject({ tone: "unavailable", label: "원문 재확인 대기 중 · 7초 후 다시 시도 · 기존 가격 유지" });
  });
});
