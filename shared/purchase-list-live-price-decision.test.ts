import { describe, expect, it } from "vitest";
import type { PurchaseListRow } from "./purchase-list";
import { purchaseListLivePriceDecisionFor } from "./purchase-list-live-price-decision";

const rows: PurchaseListRow[] = [
  { id: "cpu", sourceKind: "part", sourceId: "cpu-a", section: "핵심 부품", categoryLabel: "CPU", name: "CPU", quantity: 1, unitPriceWon: 100_000, totalPriceWon: 100_000 },
  { id: "gpu", sourceKind: "part", sourceId: "gpu-a", section: "핵심 부품", categoryLabel: "GPU", name: "GPU", quantity: 2, unitPriceWon: 200_000, totalPriceWon: 400_000 },
  { id: "case", sourceKind: "part", sourceId: "case-a", section: "핵심 부품", categoryLabel: "케이스", name: "케이스", quantity: 1 }
];

describe("purchase list live price decision", () => {
  it("prioritizes incomplete price confirmation while retaining confirmed deltas", () => {
    const result = purchaseListLivePriceDecisionFor(rows, {
      cpu: { status: "available", currentUnitPriceWon: 90_000 },
      gpu: { status: "available", currentUnitPriceWon: 225_000 },
      case: { status: "unavailable", reason: "not-priced" }
    });

    expect(result).toMatchObject({ state: "review", label: "일부 가격 재확인 필요", checkedCount: 3, availableCount: 2, unavailableCount: 1, changedRowCount: 2, decreasedTotalPriceWon: 10_000, increasedTotalPriceWon: 50_000 });
    expect(result.summary).toContain("가격 2/3개 확인");
  });

  it("summarizes a complete decrease or increase without treating it as a purchase guarantee", () => {
    const decreased = purchaseListLivePriceDecisionFor(rows.slice(0, 2), { cpu: { status: "available", currentUnitPriceWon: 90_000 }, gpu: { status: "available", currentUnitPriceWon: 190_000 } });
    const increased = purchaseListLivePriceDecisionFor(rows.slice(0, 2), { cpu: { status: "available", currentUnitPriceWon: 110_000 }, gpu: { status: "available", currentUnitPriceWon: 210_000 } });

    expect(decreased).toMatchObject({ state: "decreased", decreasedRowCount: 2, decreasedTotalPriceWon: 30_000 });
    expect(increased).toMatchObject({ state: "increased", increasedRowCount: 2, increasedTotalPriceWon: 30_000 });
    expect(decreased.summary).not.toContain("구매 완료");
  });

  it("distinguishes a newly discovered baseline from an unchanged known price", () => {
    const discovered = purchaseListLivePriceDecisionFor([rows[2]!], { case: { status: "available", currentUnitPriceWon: 50_000 } });
    const stable = purchaseListLivePriceDecisionFor([rows[0]!], { cpu: { status: "available", currentUnitPriceWon: 100_000 } });
    const notChecked = purchaseListLivePriceDecisionFor([rows[0]!], {});

    expect(discovered).toMatchObject({ state: "discovered", discoveredCount: 1 });
    expect(stable).toMatchObject({ state: "stable", changedRowCount: 0 });
    expect(notChecked).toMatchObject({ state: "not_checked", checkedCount: 0 });
  });
});
