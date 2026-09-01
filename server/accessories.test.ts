import { describe, expect, it } from "vitest";
import type { AccessoryItem } from "../shared/types";
import { countAccessories, findAccessory, mergeAccessories, searchAccessories } from "./accessories";

function accessory(overrides: Partial<AccessoryItem>): AccessoryItem {
  return {
    id: "accessory-1",
    category: "storage_accessory",
    name: "USB SATA 컨버터",
    source: "danawa",
    listingType: "accessory",
    priceWon: 10000,
    specs: {},
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides
  };
}

describe("accessory catalog", () => {
  it("searches, sorts, paginates, and finds accessories", () => {
    const items = [
      accessory({ id: "a", name: "M.2 방열판", priceWon: 20000 }),
      accessory({ id: "b", name: "USB SATA 컨버터", priceWon: 8000 }),
      accessory({ id: "c", name: "저장장치 브라켓", priceWon: 12000 })
    ];

    expect(countAccessories(items, "저장장치")).toBe(1);
    expect(searchAccessories(items, undefined, 2, { sort: "price_asc" }, 0).map((item) => item.id)).toEqual(["b", "c"]);
    expect(searchAccessories(items, undefined, 2, { sort: "price_asc" }, 2).map((item) => item.id)).toEqual(["a"]);
    expect(findAccessory(items, "c")?.name).toBe("저장장치 브라켓");
  });

  it("puts unknown accessory prices after known prices", () => {
    const items = [accessory({ id: "unknown", name: "가격 확인 필요", priceWon: 0 }), accessory({ id: "known", name: "가격 확인", priceWon: 1000 })];
    expect(searchAccessories(items, undefined, 2, { sort: "price_asc" }).map((item) => item.id)).toEqual(["known", "unknown"]);
  });

  it("filters accessories by known price bands", () => {
    const items = [
      accessory({ id: "cheap", priceWon: 8000 }),
      accessory({ id: "mid", priceWon: 20000 }),
      accessory({ id: "expensive", priceWon: 60000 }),
      accessory({ id: "unknown", priceWon: 0 })
    ];

    expect(searchAccessories(items, undefined, 10, { priceFilter: "priced" }).map((item) => item.id)).toEqual(["cheap", "mid", "expensive"]);
    expect(searchAccessories(items, undefined, 10, { priceFilter: "under_10000" }).map((item) => item.id)).toEqual(["cheap"]);
    expect(searchAccessories(items, undefined, 10, { priceFilter: "10000_50000" }).map((item) => item.id)).toEqual(["mid"]);
    expect(searchAccessories(items, undefined, 10, { priceFilter: "over_50000" }).map((item) => item.id)).toEqual(["expensive"]);
  });

  it("filters the peripheral catalog by category", () => {
    const items = [
      accessory({ id: "fan", category: "cooling_fan", name: "120mm 쿨링팬" }),
      accessory({ id: "ups", category: "ups", name: "UPS 950VA" })
    ];

    expect(countAccessories(items, undefined, { category: "cooling_fan" })).toBe(1);
    expect(searchAccessories(items, undefined, 10, { category: "ups" })[0].name).toBe("UPS 950VA");
  });

  it("filters peripheral catalog results by explicit freshness", () => {
    const now = "2026-09-01T00:00:00.000Z";
    const items = [
      accessory({ id: "fresh", name: "최근 팬", updatedAt: "2026-08-30T00:00:00.000Z" }),
      accessory({ id: "aging", name: "갱신 권장 팬", updatedAt: "2026-08-20T00:00:00.000Z" }),
      accessory({ id: "stale", name: "오래된 팬", updatedAt: "2026-07-01T00:00:00.000Z" }),
      accessory({ id: "unknown", name: "시점 불명 팬", updatedAt: "not-a-date" })
    ];

    expect(searchAccessories(items, undefined, 10, { freshness: "fresh", now }).map((item) => item.id)).toEqual(["fresh"]);
    expect(searchAccessories(items, undefined, 10, { freshness: "aging", now }).map((item) => item.id)).toEqual(["aging"]);
    expect(searchAccessories(items, undefined, 10, { freshness: "stale", now }).map((item) => item.id)).toEqual(["stale"]);
    expect(searchAccessories(items, undefined, 10, { freshness: "unknown", now }).map((item) => item.id)).toEqual(["unknown"]);
  });

  it("upgrades an existing product when a later detail crawl is more complete", () => {
    const incomplete = accessory({
      id: "old",
      sourceProductCode: "same-code",
      dataQuality: "incomplete",
      missingFields: ["detail page"],
      rawSpecText: "목록 정보"
    });
    const live = accessory({
      id: "new",
      sourceProductCode: "same-code",
      dataQuality: "live",
      missingFields: [],
      rawSpecText: "상세 스펙"
    });

    const merged = mergeAccessories([incomplete], [live]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "new", dataQuality: "live", rawSpecText: "상세 스펙" });
  });
});
