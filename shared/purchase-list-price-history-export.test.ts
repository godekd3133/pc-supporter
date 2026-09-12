import { describe, expect, it } from "vitest";
import type { PurchaseListRow } from "./purchase-list";
import { purchaseListPriceHistoryCsvFor, purchaseListPriceHistorySnapshotsCsvFor } from "./purchase-list-price-history-export";
import type { PurchaseListPriceHistory } from "./purchase-list-price-history";
import type { SavedBuildPurchasePriceHistory } from "./types";

const rows: PurchaseListRow[] = [
  { id: "cpu", section: "핵심 부품", categoryLabel: "CPU", name: "테스트, CPU", quantity: 2 },
  { id: "gpu", section: "핵심 부품", categoryLabel: "GPU", name: "테스트 GPU", quantity: 1 }
];

const history: PurchaseListPriceHistory = {
  cpu: [{ checkedAt: "2026-09-01T00:00:00.000Z", unitPriceWon: 100_000 }, { checkedAt: "2026-09-02T00:00:00.000Z", unitPriceWon: 110_000 }]
};

describe("purchase list price history export", () => {
  it("exports row-level observations with quantity and previous-price delta", () => {
    const csv = purchaseListPriceHistoryCsvFor(rows, history);
    expect(csv.startsWith("\uFEFF행 key,구분")).toBe(true);
    expect(csv).toContain('"테스트, CPU"');
    expect(csv).toContain("100000");
    expect(csv).toContain("110000");
    expect(csv).toContain("10000");
    expect(csv).toContain("최신");
    const targetedCsv = purchaseListPriceHistoryCsvFor([{ ...rows[0]!, connectionTarget: "SSD 대상" }], history);
    expect(targetedCsv).toContain("\"테스트, CPU\",2,SSD 대상");
  });

  it("exports current and historical server revisions with row-level samples", () => {
    const saved: SavedBuildPurchasePriceHistory = { inputFingerprint: "fingerprint", rowKeys: ["cpu", "gpu"], priceHistory: history, revision: 2, updatedAt: "2026-09-02T01:00:00.000Z", history: [{ inputFingerprint: "fingerprint", rowKeys: ["cpu", "gpu"], priceHistory: { cpu: [{ checkedAt: "2026-08-31T00:00:00.000Z", unitPriceWon: 90_000 }], gpu: [{ checkedAt: "2026-08-31T00:00:00.000Z", unitPriceWon: 300_000 }] }, revision: 1, updatedAt: "2026-09-01T01:00:00.000Z" }] };
    const csv = purchaseListPriceHistorySnapshotsCsvFor(saved, rows);
    expect(csv).toContain("revision,상태,저장 시각");
    expect(csv).toContain("2,현재");
    expect(csv).toContain("1,이력");
    expect(csv).toContain("90000");
    expect(csv).toContain("테스트 GPU");
  });
});
