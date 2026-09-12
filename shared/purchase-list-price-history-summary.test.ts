import { describe, expect, it } from "vitest";
import type { PurchaseListRow } from "./purchase-list";
import { purchaseListPriceHistoryOverviewFor } from "./purchase-list-price-history-summary";
import type { PurchaseListPriceHistory } from "./purchase-list-price-history";

const rows: PurchaseListRow[] = [
  { id: "cpu", section: "핵심 부품", categoryLabel: "CPU", name: "CPU", quantity: 1 },
  { id: "gpu", section: "핵심 부품", categoryLabel: "GPU", name: "GPU", quantity: 2 },
  { id: "case", section: "핵심 부품", categoryLabel: "케이스", name: "케이스", quantity: 1 }
];

describe("purchase list price history overview", () => {
  it("does not confirm a total while any row is missing a sample", () => {
    const history: PurchaseListPriceHistory = {
      cpu: [{ checkedAt: "2026-09-01T00:00:00.000Z", unitPriceWon: 100_000 }],
      gpu: [{ checkedAt: "2026-09-01T00:00:00.000Z", unitPriceWon: 200_000 }, { checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 180_000 }]
    };
    expect(purchaseListPriceHistoryOverviewFor(rows, history)).toMatchObject({ rowCount: 3, latestKnownRowCount: 2, previousKnownRowCount: 1, latestPriceComplete: false, previousPriceComplete: false, changedRowCount: 1 });
  });

  it("calculates latest and previous totals with row quantities", () => {
    const history: PurchaseListPriceHistory = {
      cpu: [{ checkedAt: "2026-09-01T00:00:00.000Z", unitPriceWon: 100_000 }, { checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 110_000 }],
      gpu: [{ checkedAt: "2026-09-01T00:00:00.000Z", unitPriceWon: 200_000 }, { checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 180_000 }],
      case: [{ checkedAt: "2026-09-01T00:00:00.000Z", unitPriceWon: 50_000 }, { checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 50_000 }]
    };
    expect(purchaseListPriceHistoryOverviewFor(rows, history)).toEqual({ rowCount: 3, latestKnownRowCount: 3, previousKnownRowCount: 3, latestPriceComplete: true, previousPriceComplete: true, changedRowCount: 2, minSampleCount: 2, maxSampleCount: 2, latestTotalPriceWon: 520_000, previousTotalPriceWon: 550_000, deltaFromPreviousTotalPriceWon: -30_000 });
  });
});
