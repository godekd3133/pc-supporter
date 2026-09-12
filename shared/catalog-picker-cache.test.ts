import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { CATALOG_PICKER_CACHE_MAX_ITEMS, catalogPickerCacheFromJson, catalogPickerCacheSnapshotFromJson, catalogPickerCacheToJson, catalogPickerCachedFallbackFor, mergeCatalogPickerCache } from "./catalog-picker-cache";

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: "cpu-1",
    category: "cpu",
    name: "AMD Ryzen 5 7600",
    brand: "AMD",
    model: "7600",
    source: "seed",
    listingType: "retail",
    priceWon: 235_000,
    dataQuality: "seed",
    missingFields: [],
    updatedAt: "2026-09-04T00:00:00.000Z",
    specs: { socket: "AM5", memoryType: "DDR5", cores: 6, threads: 12 },
    ...overrides
  };
}

describe("catalog picker cache and offline fallback", () => {
  it("bounds and validates browser cache records while allowing fresh entries to replace old IDs", () => {
    const cached = catalogPickerCacheFromJson(JSON.stringify([part(), { id: "broken" }, { ...part(), id: "cpu-2", category: "not-a-category" }]));
    expect(cached).toHaveLength(1);
    const merged = mergeCatalogPickerCache(cached, [part({ priceWon: 199_000 })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].priceWon).toBe(199_000);
    const serialized = catalogPickerCacheToJson(merged, "2026-09-04T01:00:00.000Z");
    expect(catalogPickerCacheFromJson(serialized)).toEqual(merged);
    expect(catalogPickerCacheSnapshotFromJson(serialized)).toMatchObject({ schemaVersion: 1, cachedAt: "2026-09-04T01:00:00.000Z", items: merged });
    expect(catalogPickerCacheSnapshotFromJson(JSON.stringify(merged)).cachedAt).toBeUndefined();
  });

  it("rejects raw cache arrays above the persisted item contract before normalizing them", () => {
    const oversized = Array.from({ length: CATALOG_PICKER_CACHE_MAX_ITEMS + 1 }, (_, index) => part({ id: `cpu-${index}` }));
    expect(catalogPickerCacheSnapshotFromJson(JSON.stringify(oversized)).items).toEqual([]);
    expect(catalogPickerCacheSnapshotFromJson(JSON.stringify({ schemaVersion: 1, items: oversized })).items).toEqual([]);
  });

  it("filters the cached catalog with the same visible catalog constraints and paginates deterministically", () => {
    const result = catalogPickerCachedFallbackFor([
      part(),
      part({ id: "cpu-2", name: "Intel Core i5", model: "14600K", specs: { socket: "LGA1700", memoryType: "DDR5", cores: 14 }, priceWon: 359_000 }),
      part({ id: "cpu-3", name: "AMD Ryzen bulk", model: "7600 bulk", listingType: "bulk", priceWon: 180_000 }),
      part({ id: "gpu-1", category: "gpu", name: "GPU", specs: { vramGb: 12 }, priceWon: 500_000 })
    ], {
      category: "cpu",
      query: "AMD",
      priceStatus: "known",
      listingPolicy: "retail_only",
      specFilter: { socket: "AM5", memoryType: "DDR5" },
      sort: "price_asc",
      offset: 0,
      limit: 1,
      now: "2026-09-04T00:00:00.000Z"
    });
    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(["cpu-1"]);
  });

  it("keeps the manufacturer filter in the offline picker fallback", () => {
    const result = catalogPickerCachedFallbackFor([
      part(),
      part({ id: "cpu-asus", brand: "ASUS", name: "ASUS CPU" }),
      part({ id: "cpu-amd-2", brand: "AMD", name: "AMD 다른 CPU" })
    ], { category: "cpu", brand: " amd ", sort: "name" });

    expect(result.total).toBe(2);
    expect(result.items.every((item) => item.brand === "AMD")).toBe(true);
  });

  it("keeps benchmark evidence filters consistent while the picker is offline", () => {
    const result = catalogPickerCachedFallbackFor([
      part({ id: "cpu-complete", specs: { cinebenchR23Single: 2200, cinebenchR23Multi: 12000 } }),
      part({ id: "cpu-partial", specs: { cinebenchR23Multi: 12000 } }),
      part({ id: "cpu-missing", specs: { socket: "AM5" } })
    ], { category: "cpu", benchmarkStatus: "incomplete", sort: "name" });

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual(["cpu-missing", "cpu-partial"]);
  });

  it("does not claim compatibility or candidate safety in the cached result", () => {
    const result = catalogPickerCachedFallbackFor([part()], { category: "cpu", sort: "name" });
    expect(result.items[0]).not.toHaveProperty("candidateRisk");
    expect(result.items[0]).not.toHaveProperty("similarityScore");
  });

  it("keeps PCIe evidence filters consistent while the picker is offline", () => {
    const result = catalogPickerCachedFallbackFor([
      part({ id: "board-complete", category: "motherboard", name: "완전 PCIe 보드", specs: { pcieX16Slots: 1, pcieX8Slots: 1, pcieX4Slots: 1, pcieX1Slots: 2 } }),
      part({ id: "board-missing", category: "motherboard", name: "PCIe 정보 부족 보드", specs: { pcieX16Slots: 1 } }),
      part({ id: "board-other", category: "motherboard", name: "다른 PCIe 보드", specs: { pcieX16Slots: 1, pcieX8Slots: 1, pcieX4Slots: 1, pcieX1Slots: 1 } })
    ], {
      category: "motherboard",
      specFilter: { pcieSlotInfo: "missing" },
      sort: "name"
    });

    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(["board-missing"]);
  });
});
