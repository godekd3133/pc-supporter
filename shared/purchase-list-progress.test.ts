import { describe, expect, it } from "vitest";
import { parsePurchaseListProgressJson, purchaseListBudgetSummaryFor, purchaseListCheckedIdsFromJson, purchaseListCheckedIdsToJson, purchaseListCheckedIdsToggle, purchaseListExecutionProgressFor, purchaseListProgressAmountLabelFor, purchaseListProgressAmountsFor, purchaseListProgressFor, purchaseListProgressJsonFor, purchaseListProgressRevisionDiffFor, purchaseListProgressSyncComparisonFor, purchaseListProgressTransferDiffFor, purchaseListProgressTransferMatchesCurrentFor, purchaseListRowKeysFor } from "./purchase-list-progress";
import { purchaseListProgressHistoryCsvFor, purchaseListProgressHistoryJsonFor, purchaseListProgressHistorySnapshotsFor } from "./purchase-list-progress-history";
import type { PurchaseListRow } from "./purchase-list";

const rows: PurchaseListRow[] = [
  { id: "part:cpu:cpu-a", section: "핵심 부품", categoryLabel: "CPU", name: "CPU A", quantity: 1 },
  { section: "주변 부품", categoryLabel: "쿨링팬", name: "팬 A", quantity: 2 }
];

describe("purchase list progress", () => {
  it("creates stable explicit and fallback row keys", () => {
    expect(purchaseListRowKeysFor(rows)).toEqual(["part:cpu:cpu-a", "주변 부품:쿨링팬:팬 A:1"]);
  });

  it("normalizes checked IDs and calculates progress", () => {
    const ids = purchaseListCheckedIdsFromJson(JSON.stringify(["part:cpu:cpu-a", "part:cpu:cpu-a", "", 2]));
    expect(ids).toEqual(["part:cpu:cpu-a"]);
    expect(purchaseListProgressFor(rows, new Set(ids))).toEqual({ total: 2, checked: 1, remaining: 1, percent: 50 });
    expect(JSON.parse(purchaseListCheckedIdsToJson(ids))).toEqual(ids);
    expect(purchaseListCheckedIdsFromJson(JSON.stringify(Array.from({ length: 101 }, (_, index) => `row-${index}`)))).toEqual([]);
  });

  it("combines checked completion with explicit purchase stages", () => {
    const rowKeys = purchaseListRowKeysFor(rows);
    expect(purchaseListExecutionProgressFor(rows, new Set([rowKeys[1]]), [
      { rowKey: rowKeys[0], status: "ordered", updatedAt: "2026-09-02T00:00:00.000Z" },
      { rowKey: rowKeys[1], status: "installed", updatedAt: "2026-09-02T00:01:00.000Z" }
    ])).toEqual({ total: 2, checked: 1, remaining: 1, percent: 50, stageCounts: { planned: 0, ordered: 1, received: 0, installed: 1 } });
  });

  it("separates completed and remaining money without masking unknown prices", () => {
    const pricedRows: PurchaseListRow[] = [
      { id: "cpu", section: "핵심 부품", categoryLabel: "CPU", name: "CPU", quantity: 1, totalPriceWon: 300_000 },
      { id: "gpu", section: "핵심 부품", categoryLabel: "GPU", name: "GPU", quantity: 1, totalPriceWon: 700_000 },
      { id: "case", section: "핵심 부품", categoryLabel: "케이스", name: "케이스", quantity: 1 }
    ];
    expect(purchaseListProgressAmountsFor(pricedRows, new Set(["cpu"]))).toEqual({ checkedTotalPriceWon: 300_000, remainingTotalPriceWon: 700_000, checkedPriceComplete: true, remainingPriceComplete: false, checkedRowCount: 1, remainingRowCount: 2 });
    expect(purchaseListProgressAmountLabelFor(0, true, 0)).toBe("없음");
    expect(purchaseListProgressAmountLabelFor(300_000, true, 1)).toBe("300,000원");
    expect(purchaseListProgressAmountLabelFor(0, false, 1)).toBe("가격 확인 필요");
    expect(purchaseListBudgetSummaryFor(pricedRows, 1_500_000)).toMatchObject({ budgetWon: 1_500_000, priceComplete: false });
    expect(purchaseListBudgetSummaryFor(pricedRows.slice(0, 2), 1_500_000)).toMatchObject({ totalPriceWon: 1_000_000, priceComplete: true, deltaWon: -500_000, withinBudget: true });
    const referenceSummary = purchaseListBudgetSummaryFor(pricedRows.slice(0, 2).map((row, index) => ({ ...row, priceEvidence: index === 0 ? "reference" as const : "live" as const })), 1_500_000);
    expect(referenceSummary).toMatchObject({ totalPriceWon: 1_000_000, priceComplete: true, priceEvidenceReviewCount: 1 });
    expect(referenceSummary?.deltaWon).toBeUndefined();
    expect(referenceSummary?.withinBudget).toBeUndefined();
    expect(purchaseListBudgetSummaryFor(pricedRows, undefined)).toBeUndefined();
  });

  it("toggles only the requested row", () => {
    const secondKey = purchaseListRowKeysFor(rows)[1];
    expect(purchaseListCheckedIdsToggle(["part:cpu:cpu-a"], secondKey, true)).toEqual(["part:cpu:cpu-a", secondKey]);
    expect(purchaseListCheckedIdsToggle(["part:cpu:cpu-a", secondKey], "part:cpu:cpu-a", false)).toEqual([secondKey]);
  });

  it("exports progress and previews only the same storage key", () => {
    const rowKeys = purchaseListRowKeysFor(rows);
    const json = purchaseListProgressJsonFor("build-key-1", rows, new Set([rowKeys[0]]), "2026-09-02T00:00:00.000Z", [{ rowKey: rowKeys[1], status: "ordered", updatedAt: "2026-09-02T00:01:00.000Z" }]);
    const parsed = parsePurchaseListProgressJson(json, "build-key-1", rows);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rowKeys).toEqual(rowKeys);
    expect(parsed.checkedIds).toEqual([rowKeys[0]]);
    expect(parsed.itemStates).toMatchObject([{ rowKey: rowKeys[1], status: "ordered" }]);
    expect(parsePurchaseListProgressJson(json, "build-key-2", rows).errors[0]).toContain("다른 구매 목록");
    expect(purchaseListProgressTransferMatchesCurrentFor(rowKeys, parsed.rowKeys)).toBe(true);
    expect(purchaseListProgressTransferDiffFor([rowKeys[1]], parsed.checkedIds)).toMatchObject({ currentCheckedCount: 1, incomingCheckedCount: 1, addedCount: 1, removedCount: 1, unchangedCount: 0 });
  });

  it("ignores checked rows that no longer exist in the current build", () => {
    const rowKeys = purchaseListRowKeysFor(rows);
    const envelope = JSON.parse(purchaseListProgressJsonFor("build-key-1", rows, new Set(), "2026-09-02T00:00:00.000Z")) as { checkedIds: string[] };
    envelope.checkedIds = ["removed-row"];
    const parsed = parsePurchaseListProgressJson(JSON.stringify(envelope), "build-key-1", rows);
    expect(parsed.checkedIds).toEqual([]);
    expect(parsed.ignoredIds).toEqual(["removed-row"]);
    expect(purchaseListProgressTransferMatchesCurrentFor(rowKeys, [rowKeys[0]])).toBe(false);
  });

  it("rejects oversized imported progress arrays before expanding them", () => {
    const result = parsePurchaseListProgressJson(JSON.stringify({
      type: "pc-supporter-purchase-list-progress",
      schemaVersion: 1,
      storageKey: "build-key-1",
      exportedAt: "2026-09-02T00:00:00.000Z",
      rowKeys: Array.from({ length: 101 }, (_, index) => `row-${index}`),
      checkedIds: Array.from({ length: 101 }, (_, index) => `row-${index}`)
    }), "build-key-1", rows);

    expect(result).toEqual({ checkedIds: [], ignoredIds: [], rowKeys: [], errors: ["구매 목록 진행률 JSON의 행 목록은 현재 목록 기준 최대 100개까지 가져올 수 있습니다."] });
  });

  it("keeps large current purchase lists importable while preserving the 100 checked-state cap", () => {
    const largeRows = Array.from({ length: 101 }, (_, index): PurchaseListRow => ({ id: `part:gpu:gpu-${index}`, section: "핵심 부품", categoryLabel: "GPU", name: `GPU ${index}`, quantity: 1 }));
    const rowKeys = purchaseListRowKeysFor(largeRows);
    const json = purchaseListProgressJsonFor("build-key-large", largeRows, new Set(rowKeys), "2026-09-02T00:00:00.000Z");
    const parsed = parsePurchaseListProgressJson(json, "build-key-large", largeRows);

    expect(parsed.errors).toEqual([]);
    expect(parsed.rowKeys).toHaveLength(101);
    expect(parsed.checkedIds).toHaveLength(100);
  });

  it("classifies local and server purchase states without auto-merging them", () => {
    expect(purchaseListProgressSyncComparisonFor(["cpu", "gpu"], ["cpu"])).toMatchObject({ state: "local-only", localOnlyIds: ["gpu"], serverOnlyIds: [], currentCheckedCount: 2, serverCheckedCount: 1 });
    expect(purchaseListProgressSyncComparisonFor(["cpu"], ["cpu", "gpu"])).toMatchObject({ state: "server-only", localOnlyIds: [], serverOnlyIds: ["gpu"] });
    expect(purchaseListProgressSyncComparisonFor(["cpu", "ram"], ["cpu", "gpu"])).toMatchObject({ state: "diverged", localOnlyIds: ["ram"], serverOnlyIds: ["gpu"] });
    expect(purchaseListProgressSyncComparisonFor(["cpu", "cpu"], ["cpu", " "])).toMatchObject({ state: "synced", currentCheckedIds: ["cpu"], serverCheckedIds: ["cpu"] });
  });

  it("shows which purchase rows change between two revisions", () => {
    const from = { revision: 4, inputFingerprint: "fingerprint", rowKeys: ["cpu", "gpu", "ram"], checkedIds: ["cpu", "gpu"], updatedAt: "2026-09-02T00:00:00.000Z" };
    const to = { revision: 2, inputFingerprint: "fingerprint", rowKeys: ["cpu", "gpu", "ram"], checkedIds: ["cpu", "ram", "ram"], updatedAt: "2026-09-02T00:00:00.000Z" };
    expect(purchaseListProgressRevisionDiffFor(from, to)).toEqual({ fromRevision: 4, toRevision: 2, addedIds: ["ram"], removedIds: ["gpu"], unchangedIds: ["cpu"], fromCheckedCount: 2, toCheckedCount: 2, statusChanges: [] });
  });

  it("shows staged purchase changes even when the checked count is unchanged", () => {
    const from = { revision: 2, inputFingerprint: "fingerprint", rowKeys: ["cpu"], checkedIds: [], itemStates: [{ rowKey: "cpu", status: "ordered" as const, updatedAt: "2026-09-02T00:00:00.000Z" }], updatedAt: "2026-09-02T00:00:00.000Z" };
    const to = { revision: 3, inputFingerprint: "fingerprint", rowKeys: ["cpu"], checkedIds: ["cpu"], itemStates: [{ rowKey: "cpu", status: "received" as const, updatedAt: "2026-09-02T01:00:00.000Z" }], updatedAt: "2026-09-02T01:00:00.000Z" };
    expect(purchaseListProgressRevisionDiffFor(from, to).statusChanges).toEqual([{ rowKey: "cpu", from: "ordered", to: "received" }]);
  });

  it("exports current and historical purchase states as JSON and row-level CSV", () => {
    const progress = { inputFingerprint: "fingerprint", rowKeys: ["cpu", "gpu"], checkedIds: ["cpu"], revision: 4, updatedAt: "2026-09-02T04:00:00.000Z", history: [{ inputFingerprint: "fingerprint", rowKeys: ["cpu", "gpu"], checkedIds: ["cpu", "gpu"], revision: 3, updatedAt: "2026-09-02T03:00:00.000Z" }] };
    const json = JSON.parse(purchaseListProgressHistoryJsonFor(progress, "2026-09-02T05:00:00.000Z")) as { type: string; schemaVersion: number; inputFingerprint: string; current: { revision: number }; history: Array<{ revision: number }> };
    expect(json).toMatchObject({ type: "pc-supporter-purchase-progress-history", schemaVersion: 1, inputFingerprint: "fingerprint", current: { revision: 4 } });
    expect(json.history.map((entry) => entry.revision)).toEqual([3]);
    expect(purchaseListProgressHistorySnapshotsFor(progress).map((entry) => entry.revision)).toEqual([4, 3]);
    const csv = purchaseListProgressHistoryCsvFor(progress, [{ id: "cpu", section: "핵심 부품", categoryLabel: "CPU", name: "CPU, A", quantity: 1 }, { id: "gpu", section: "핵심 부품", categoryLabel: "GPU", name: "GPU A", quantity: 1, connectionTarget: "팬 허브 A" }]);
    expect(csv.startsWith("\uFEFFrevision,상태")).toBe(true);
    expect(csv).toContain('"CPU, A"');
    expect(csv).toContain("4,현재");
    expect(csv).toContain("3,이력");
    expect(csv).toContain("구매 예정");
    expect(csv).toContain("GPU A,팬 허브 A,핵심 부품");
  });
});
