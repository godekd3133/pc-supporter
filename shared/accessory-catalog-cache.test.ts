import { describe, expect, it } from "vitest";
import type { AccessoryItem } from "./types";
import { ACCESSORY_CATALOG_CACHE_MAX_ITEMS, accessoryCatalogCacheFromJson, accessoryCatalogCacheSnapshotFromJson, accessoryCatalogCacheToJson, accessoryCatalogCachedFallbackFor, mergeAccessoryCatalogCache } from "./accessory-catalog-cache";

function item(overrides: Partial<AccessoryItem> = {}): AccessoryItem {
  return {
    id: "fan-1",
    category: "cooling_fan",
    name: "120mm PWM 시스템 팬",
    brand: "PC Supporter",
    model: "FAN-120",
    source: "manual",
    listingType: "accessory",
    priceWon: 7900,
    rawSpecText: "120mm · 4핀 PWM",
    specs: { fanCount: 1, fanCurrentA: 0.2 },
    dataQuality: "seed",
    missingFields: [],
    updatedAt: "2026-09-04T00:00:00.000Z",
    ...overrides
  };
}

describe("accessory catalog cache and offline fallback", () => {
  it("validates and bounds cached accessory records while replacing duplicate IDs", () => {
    const cached = accessoryCatalogCacheFromJson(JSON.stringify([item(), { id: "broken" }, { ...item(), id: "cpu-like", category: "cpu" }]));
    expect(cached).toHaveLength(1);
    const merged = mergeAccessoryCatalogCache(cached, [item({ priceWon: 6900 })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].priceWon).toBe(6900);
    const serialized = accessoryCatalogCacheToJson(merged, "2026-09-04T01:00:00.000Z");
    expect(accessoryCatalogCacheFromJson(serialized)).toEqual(merged);
    expect(accessoryCatalogCacheSnapshotFromJson(serialized)).toMatchObject({ schemaVersion: 1, cachedAt: "2026-09-04T01:00:00.000Z", items: merged });
    expect(accessoryCatalogCacheSnapshotFromJson(JSON.stringify(merged)).cachedAt).toBeUndefined();
  });

  it("rejects raw cache arrays above the persisted item contract before normalizing them", () => {
    const oversized = Array.from({ length: ACCESSORY_CATALOG_CACHE_MAX_ITEMS + 1 }, (_, index) => item({ id: `fan-${index}` }));
    expect(accessoryCatalogCacheSnapshotFromJson(JSON.stringify(oversized)).items).toEqual([]);
    expect(accessoryCatalogCacheSnapshotFromJson(JSON.stringify({ schemaVersion: 1, items: oversized })).items).toEqual([]);
  });

  it("keeps accessory category, quality, freshness, price, search and pagination filters deterministic", () => {
    const result = accessoryCatalogCachedFallbackFor([
      item(),
      item({ id: "fan-2", name: "140mm ARGB 팬", model: "FAN-140", priceWon: 14900 }),
      item({ id: "paste-1", category: "thermal_grease", name: "고열전도 써멀그리스", model: "TG-4G", priceWon: 12900 })
    ], {
      category: "cooling_fan",
      query: "ARGB",
      priceFilter: "10000_50000",
      sort: "price_desc",
      offset: 0,
      limit: 1,
      now: "2026-09-04T00:00:00.000Z"
    });
    expect(result.total).toBe(1);
    expect(result.items.map((candidate) => candidate.id)).toEqual(["fan-2"]);
  });

  it("keeps the manufacturer filter in the offline accessory fallback", () => {
    const result = accessoryCatalogCachedFallbackFor([
      item({ brand: "PC Supporter" }),
      item({ id: "fan-asus", brand: "ASUS", name: "ASUS 팬" }),
      item({ id: "fan-corsair", brand: "CORSAIR", name: "CORSAIR 팬" })
    ], { category: "cooling_fan", brand: " asus ", sort: "name" });

    expect(result.total).toBe(1);
    expect(result.items[0].brand).toBe("ASUS");
  });

  it("does not attach compatibility or recommendation claims to cached accessories", () => {
    const result = accessoryCatalogCachedFallbackFor([item()], { category: "all" });
    expect(result.items[0]).not.toHaveProperty("candidateRisk");
    expect(result.items[0]).not.toHaveProperty("recommendationTrust");
  });
});
