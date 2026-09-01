import { describe, expect, it } from "vitest";
import type { PurchaseChecklistItem } from "./purchase-checklist";
import { parsePurchaseChecklistJson, purchaseChecklistJsonFor, purchaseChecklistTransferDiffFor, purchaseChecklistTransferMatchesCurrentFor } from "./purchase-checklist";

const items: PurchaseChecklistItem[] = [
  { id: "finding:socket", kind: "finding", severity: "blocker", title: "소켓", detail: "확인" },
  { id: "manual:post-build-test", kind: "manual", severity: "manual", title: "POST", detail: "확인" }
];
const storageKey = "pc-supporter-purchase-checklist:test-build";

describe("purchase checklist transfer", () => {
  it("exports a versioned envelope with only current item IDs", () => {
    const payload = JSON.parse(purchaseChecklistJsonFor(storageKey, items, new Set(["finding:socket", "not-in-this-build"]), "2026-09-01T00:00:00.000Z"));

    expect(payload).toEqual({ type: "pc-supporter-purchase-checklist", schemaVersion: 1, storageKey, exportedAt: "2026-09-01T00:00:00.000Z", itemIds: ["finding:socket", "manual:post-build-test"], checkedIds: ["finding:socket"] });
  });

  it("imports only checked IDs that exist in the current checklist", () => {
    const result = parsePurchaseChecklistJson(JSON.stringify({ type: "pc-supporter-purchase-checklist", schemaVersion: 1, storageKey, exportedAt: "2026-09-01T00:00:00.000Z", itemIds: ["finding:socket", "old-item"], checkedIds: ["finding:socket", "old-item", "finding:socket"] }), storageKey, items);

    expect(result).toEqual({ checkedIds: ["finding:socket"], ignoredIds: ["old-item"], itemIds: ["finding:socket", "old-item"], exportedAt: "2026-09-01T00:00:00.000Z", errors: [] });
  });

  it("rejects another build, malformed JSON, and unsupported versions", () => {
    expect(parsePurchaseChecklistJson("{bad", storageKey, items).errors).toContain("체크리스트 JSON 형식이 올바르지 않습니다.");
    expect(parsePurchaseChecklistJson(JSON.stringify({ type: "pc-supporter-purchase-checklist", schemaVersion: 1, storageKey: "other-build", exportedAt: "now", itemIds: [], checkedIds: [] }), storageKey, items).errors.some((error) => error.includes("현재 견적과 다른 체크리스트입니다."))).toBe(true);
    expect(parsePurchaseChecklistJson(JSON.stringify({ type: "pc-supporter-purchase-checklist", schemaVersion: 2, storageKey, exportedAt: "now", itemIds: [], checkedIds: [] }), storageKey, items).errors).toContain("지원하지 않는 체크리스트 JSON 버전입니다.");
  });

  it("rejects invalid item list shapes instead of applying partial state", () => {
    const result = parsePurchaseChecklistJson(JSON.stringify({ type: "pc-supporter-purchase-checklist", schemaVersion: 1, storageKey, exportedAt: "now", itemIds: ["finding:socket"], checkedIds: ["finding:socket", 3] }), storageKey, items);

    expect(result).toEqual({ checkedIds: [], ignoredIds: [], itemIds: [], errors: ["체크리스트 JSON의 항목 목록 형식이 올바르지 않습니다."] });
  });

  it("calculates the import diff without counting duplicate IDs twice", () => {
    expect(purchaseChecklistTransferDiffFor(["a", "b", "b"], ["b", "c", "c"])).toEqual({ currentCheckedCount: 2, incomingCheckedCount: 2, addedCount: 1, removedCount: 1, unchangedCount: 1 });
  });

  it("rejects a preview when the current checklist item set changed", () => {
    expect(purchaseChecklistTransferMatchesCurrentFor(["a", "b"], ["b", "a", "a"])).toBe(true);
    expect(purchaseChecklistTransferMatchesCurrentFor(["a", "b"], ["a", "c"])).toBe(false);
    expect(purchaseChecklistTransferMatchesCurrentFor(["a", "b"], ["a"])).toBe(false);
  });
});
