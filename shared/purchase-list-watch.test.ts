import { describe, expect, it } from "vitest";
import { purchaseListWatchTargetFor } from "./purchase-list-watch";
import type { PurchaseListRow } from "./purchase-list";

describe("purchase list watch target", () => {
  it("converts core and accessory rows to the existing watchlist identity", () => {
    const part: PurchaseListRow = {
      id: "part:cpu:cpu-1",
      sourceKind: "part",
      sourceId: "cpu-1",
      sourceCategory: "cpu",
      section: "핵심 부품",
      categoryLabel: "CPU",
      name: "테스트 CPU",
      quantity: 1
    };
    const accessory: PurchaseListRow = {
      id: "accessory:fan-1",
      sourceKind: "accessory",
      sourceId: "fan-1",
      sourceCategory: "cooling_fan",
      section: "주변 부품",
      categoryLabel: "쿨링팬",
      name: "테스트 팬",
      quantity: 2
    };

    expect(purchaseListWatchTargetFor(part)).toEqual({ itemId: "cpu-1", itemName: "테스트 CPU", category: "cpu", kind: "part" });
    expect(purchaseListWatchTargetFor(accessory)).toEqual({ itemId: "fan-1", itemName: "테스트 팬", category: "cooling_fan", kind: "accessory" });
  });

  it("does not create a watch target for legacy rows without catalog metadata", () => {
    expect(purchaseListWatchTargetFor({ section: "핵심 부품", categoryLabel: "CPU", name: "legacy", quantity: 1 })).toBeUndefined();
  });
});
