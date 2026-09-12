import { describe, expect, it } from "vitest";
import type { PurchaseListRow } from "./purchase-list";
import { purchaseListPriceHistoryTransferDiffFor, purchaseListPriceHistoryMergeFor, parsePurchaseListPriceHistoryTransferJson, purchaseListPriceHistoryTransferJsonFor, purchaseListPriceHistoryTransferMatchesCurrentFor } from "./purchase-list-price-history-transfer";
import type { PurchaseListPriceHistory } from "./purchase-list-price-history";

const rows: PurchaseListRow[] = [
  { id: "cpu", section: "핵심 부품", categoryLabel: "CPU", name: "CPU", quantity: 1 },
  { id: "gpu", section: "핵심 부품", categoryLabel: "GPU", name: "GPU", quantity: 1 }
];

const history: PurchaseListPriceHistory = {
  cpu: [{ checkedAt: "2026-09-01T00:00:00.000Z", unitPriceWon: 100_000 }, { checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 110_000 }],
  gpu: [{ checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 300_000 }]
};

describe("purchase list price history transfer", () => {
  it("round-trips a history only for the same storage key", () => {
    const json = purchaseListPriceHistoryTransferJsonFor("build-key", rows, history, "2026-09-03T00:00:00.000Z");
    expect(parsePurchaseListPriceHistoryTransferJson(json, "build-key", rows)).toMatchObject({ history, rowKeys: ["cpu", "gpu"], errors: [] });
    expect(parsePurchaseListPriceHistoryTransferJson(json, "other-build", rows).errors[0]).toContain("다른 가격 확인 기록");
  });

  it("reports row mismatch before an import can be applied", () => {
    expect(purchaseListPriceHistoryTransferMatchesCurrentFor(["cpu", "gpu"], ["gpu", "cpu"])).toBe(true);
    expect(purchaseListPriceHistoryTransferMatchesCurrentFor(["cpu", "gpu"], ["cpu"])).toBe(false);
  });

  it("merges duplicate observations and preserves the newest bounded samples", () => {
    const incoming: PurchaseListPriceHistory = { cpu: [{ checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 110_000 }, { checkedAt: "2026-09-04T00:00:00.000Z", unitPriceWon: 120_000 }] };
    const merged = purchaseListPriceHistoryMergeFor(history, incoming, 2);
    expect(merged.cpu).toEqual([{ checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 110_000 }, { checkedAt: "2026-09-04T00:00:00.000Z", unitPriceWon: 120_000 }]);
    expect(purchaseListPriceHistoryTransferDiffFor(history, incoming, 2)).toMatchObject({ currentRowCount: 2, incomingRowCount: 1, sharedRowCount: 1, incomingOnlyRowCount: 0, currentObservationCount: 3, incomingObservationCount: 2, newObservationCount: 1, mergedObservationCount: 3 });
  });

  it("does not import history belonging to an unknown current row", () => {
    const json = purchaseListPriceHistoryTransferJsonFor("build-key", rows, { unknown: [{ checkedAt: "2026-09-01T00:00:00.000Z", unitPriceWon: 10_000 }] }, "2026-09-03T00:00:00.000Z");
    const parsed = parsePurchaseListPriceHistoryTransferJson(json, "build-key", rows);
    expect(parsed.history).toEqual({});
    expect(parsed.ignoredRowKeys).toEqual(["unknown"]);
  });

  it("rejects oversized transfer rows and observation arrays before normalization", () => {
    const oversizedRows = Array.from({ length: 101 }, (_, index) => `row-${index}`);
    const oversizedHistory = oversizedRows.map((rowKey) => ({ rowKey, observations: [{ checkedAt: "2026-09-01T00:00:00.000Z", unitPriceWon: 10_000 }] }));
    const parsed = parsePurchaseListPriceHistoryTransferJson(JSON.stringify({
      type: "pc-supporter-purchase-list-price-history",
      schemaVersion: 1,
      storageKey: "build-key",
      exportedAt: "2026-09-03T00:00:00.000Z",
      rowKeys: oversizedRows,
      history: oversizedHistory
    }), "build-key", rows);

    expect(parsed.history).toEqual({});
    expect(parsed.rowKeys).toEqual([]);
    expect(parsed.errors).toEqual(["가격 확인 기록 JSON은 최대 100개 행과 각 행 20개 관측값까지 지원합니다."]);
  });
});
