import { describe, expect, it } from "vitest";
import { accessoryCatalogCacheToJson } from "./accessory-catalog-cache";
import { catalogPickerCacheToJson } from "./catalog-picker-cache";
import { catalogCacheStatusFromStorage } from "./catalog-cache-status";
import type { AccessoryItem, Part } from "./types";

const part = { id: "cpu-1", category: "cpu", name: "CPU", source: "seed", dataQuality: "seed", missingFields: [], updatedAt: "2026-09-04T00:00:00.000Z", specs: {} } as Part;
const accessory = { id: "fan-1", category: "cooling_fan", name: "팬", source: "manual", listingType: "accessory", dataQuality: "seed", missingFields: [], updatedAt: "2026-09-04T00:00:00.000Z", specs: {} } as AccessoryItem;

describe("catalog cache status", () => {
  it("reports counts and freshness independently for core and accessory caches", () => {
    const values = new Map([
      ["pc-supporter-catalog-picker-cache-v1", catalogPickerCacheToJson([part], "2026-09-04T00:00:00.000Z")],
      ["pc-supporter-accessory-catalog-cache-v1", accessoryCatalogCacheToJson([accessory], "2026-08-01T00:00:00.000Z")]
    ]);
    const status = catalogCacheStatusFromStorage((key) => values.get(key), "2026-09-04T00:00:00.000Z");
    expect(status).toMatchObject({ totalCount: 2, hasAny: true, parts: { count: 1, freshness: "fresh" }, accessories: { count: 1, freshness: "stale" } });
  });

  it("keeps legacy array cache time unknown and treats invalid storage as empty", () => {
    const status = catalogCacheStatusFromStorage((key) => key.includes("picker") ? JSON.stringify([part]) : "{broken", "2026-09-04T00:00:00.000Z");
    expect(status.parts).toMatchObject({ count: 1, freshness: "unknown" });
    expect(status.accessories).toMatchObject({ count: 0, freshness: "unknown" });
  });
});
