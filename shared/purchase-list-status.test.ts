import { describe, expect, it } from "vitest";
import { purchaseListCheckedIdsForItemStatuses, purchaseListItemStatusCountsFor, purchaseListItemStatusFor, purchaseListItemStatusIsPurchased, purchaseListItemStatusesFromJson, purchaseListItemStatusesFromUnknown, purchaseListItemStatusesJsonFor, purchaseListItemStatusesWithNextFor } from "./purchase-list-status";

describe("purchase list item statuses", () => {
  it("supports staged status transitions and preserves legacy checked rows as received", () => {
    const planned = purchaseListItemStatusFor([], "row-a", new Set(["row-a"]));
    const next = purchaseListItemStatusesWithNextFor([], "row-b", "ordered", "2026-09-04T00:00:00.000Z");
    expect(planned).toBe("received");
    expect(purchaseListItemStatusIsPurchased("ordered")).toBe(false);
    expect(purchaseListItemStatusIsPurchased("installed")).toBe(true);
    expect(purchaseListCheckedIdsForItemStatuses(["row-a", "row-b"], [{ rowKey: "row-a", status: "ordered", updatedAt: "2026-09-04T00:00:00.000Z" }], ["row-a", "row-b"])).toEqual(["row-b"]);
    expect(purchaseListItemStatusCountsFor(["row-a", "row-b"], next, new Set(["row-a"]))).toMatchObject({ planned: 0, ordered: 1, received: 1, installed: 0, total: 2 });
  });

  it("round-trips a storage envelope and rejects a wrong storage key", () => {
    const items = [{ rowKey: "row-a", status: "installed" as const, updatedAt: "2026-09-04T00:00:00.000Z" }];
    const json = purchaseListItemStatusesJsonFor("purchase-key", items, "2026-09-04T01:00:00.000Z");
    expect(purchaseListItemStatusesFromJson(json, "purchase-key")).toEqual(items);
    expect(purchaseListItemStatusesFromJson(json, "other-key")).toEqual([]);
  });

  it("rejects duplicate or unknown rows in strict server parsing", () => {
    const parsed = purchaseListItemStatusesFromUnknown([
      { rowKey: "row-a", status: "ordered", updatedAt: "2026-09-04T00:00:00.000Z" },
      { rowKey: "row-a", status: "received", updatedAt: "2026-09-04T00:01:00.000Z" }
    ], ["row-a"]);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.errors).toHaveLength(1);
  });
});
