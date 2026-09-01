import { describe, expect, it } from "vitest";
import type { CatalogWatchEntry } from "./catalog-watchlist";
import { addCatalogWatchEntry, catalogWatchEntryKey, catalogWatchlistContains, catalogWatchlistFromJson, catalogWatchlistToJson, mergeCatalogWatchEntries, removeCatalogWatchEntry, updateCatalogWatchEntry } from "./catalog-watchlist";

const entry = (overrides: Partial<CatalogWatchEntry> = {}): CatalogWatchEntry => ({ itemId: "part-1", itemName: "테스트 CPU", category: "cpu", kind: "part", addedAt: "2026-08-28T00:00:00.000Z", ...overrides });

describe("catalog watchlist", () => {
  it("uses kind and item id as a stable identity", () => {
    expect(catalogWatchEntryKey(entry())).toBe("part:part-1");
    expect(catalogWatchlistContains([entry()], { kind: "part", itemId: "part-1" })).toBe(true);
    expect(catalogWatchlistContains([entry()], { kind: "accessory", itemId: "part-1" })).toBe(false);
  });

  it("deduplicates additions, refreshes labels, and does not mutate input", () => {
    const original = [entry()];
    const next = addCatalogWatchEntry(original, entry({ itemName: "새 이름", targetPriceWon: 95000 }));

    expect(original[0].itemName).toBe("테스트 CPU");
    expect(next).toHaveLength(1);
    expect(next[0].itemName).toBe("새 이름");
    expect(next[0].targetPriceWon).toBe(95000);
  });

  it("prepends new entries and enforces the safe maximum", () => {
    const original = [entry({ itemId: "part-1" }), entry({ itemId: "part-2" })];
    const next = addCatalogWatchEntry(original, entry({ itemId: "part-3" }), 2);

    expect(next.map((item) => item.itemId)).toEqual(["part-3", "part-1"]);
  });

  it("removes only the requested identity and safely restores malformed JSON", () => {
    const entries = [entry(), entry({ itemId: "accessory-1", kind: "accessory", category: "ups" })];

    expect(removeCatalogWatchEntry(entries, { kind: "part", itemId: "part-1" })).toEqual([entries[1]]);
    expect(catalogWatchlistFromJson("not-json")).toEqual([]);
    expect(catalogWatchlistFromJson(JSON.stringify([entry(), entry(), { itemId: "" }, { kind: "wrong" }]))).toHaveLength(1);
    expect(JSON.parse(catalogWatchlistToJson(entries))).toEqual(entries);
  });

  it("updates a target price without changing another watch entry", () => {
    const entries = [entry(), entry({ itemId: "part-2" })];
    const updated = updateCatalogWatchEntry(entries, { kind: "part", itemId: "part-1" }, { targetPriceWon: 95000 });

    expect(updated[0].targetPriceWon).toBe(95000);
    expect(updated[1]).toEqual(entries[1]);
    expect(catalogWatchlistFromJson(JSON.stringify([entry({ targetPriceWon: 0 })]))).toEqual([]);
  });

  it("merges imported entries in file order while preserving existing order and deduplicating", () => {
    const existing = [entry({ itemId: "existing" })];
    const imported = [entry({ itemId: "part-1", itemName: "갱신 CPU", targetPriceWon: 90000 }), entry({ itemId: "new" })];
    const merged = mergeCatalogWatchEntries(existing, imported, 50);

    expect(merged.map((item) => item.itemId)).toEqual(["part-1", "new", "existing"]);
    expect(merged[0].itemName).toBe("갱신 CPU");
    expect(merged[0].targetPriceWon).toBe(90000);
  });
});
