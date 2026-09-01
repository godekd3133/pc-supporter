import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { catalogChangeRecord, catalogChangeSummary, filterCatalogChangeRecords, meaningfulCatalogChangeFields } from "./catalog-change-log";

const part = (overrides: Partial<Part> = {}): Part => ({
  id: "part-1", category: "cpu", name: "테스트 CPU", source: "danawa", sourceProductCode: "1", priceWon: 100000, specs: {}, dataQuality: "incomplete", missingFields: ["socket"], updatedAt: "2026-08-28T00:00:00.000Z", ...overrides
});

describe("catalog change log", () => {
  it("records quality, missing fields, and price delta before and after refresh", () => {
    const record = catalogChangeRecord("part", part(), part({ dataQuality: "live", missingFields: [], priceWon: 120000 }), ["가격", "데이터 품질"], { id: "change-1", changedAt: "2026-08-28T01:00:00.000Z" });

    expect(record).toMatchObject({ id: "change-1", previousDataQuality: "incomplete", nextDataQuality: "live", previousPriceWon: 100000, nextPriceWon: 120000, priceDeltaWon: 20000 });
    expect(record.previousMissingFields).toEqual(["socket"]);
    expect(record.nextMissingFields).toEqual([]);
    expect(record.valueDiffs).toEqual(expect.arrayContaining([
      { field: "가격", previous: "100,000원", next: "120,000원" },
      { field: "데이터 품질", previous: "incomplete", next: "live" },
      { field: "누락 필드", previous: "socket", next: "없음" }
    ]));
  });

  it("does not invent a price delta when either side is unknown", () => {
    const record = catalogChangeRecord("part", part({ priceWon: undefined }), part({ priceWon: 120000 }), []);

    expect(record.previousPriceWon).toBeUndefined();
    expect(record.priceDeltaWon).toBeUndefined();
  });

  it("filters by catalog kind/category and caps the requested page", () => {
    const records = [
      catalogChangeRecord("part", part(), part({ id: "part-1", category: "cpu" }), [], { changedAt: "2026-08-28T03:00:00.000Z" }),
      catalogChangeRecord("part", part(), part({ id: "part-2", category: "gpu" }), [], { changedAt: "2026-08-28T02:00:00.000Z" }),
      catalogChangeRecord("accessory", { ...part(), id: "accessory-1", category: "cpu" } as never, { ...part(), id: "accessory-1", category: "cpu" } as never, [], { changedAt: "2026-08-28T01:00:00.000Z" })
    ];

    expect(filterCatalogChangeRecords(records, { kind: "part", category: "cpu", limit: 1 })).toHaveLength(1);
    expect(filterCatalogChangeRecords(records, { kind: "part", category: "cpu", limit: 1 })[0].id).toBe(records[0].id);
  });

  it("filters the change log by an inclusive timestamp range before applying the limit", () => {
    const records = [
      catalogChangeRecord("part", part(), part({ id: "part-1" }), [], { id: "old", changedAt: "2026-08-27T23:59:59.000Z" }),
      catalogChangeRecord("part", part(), part({ id: "part-2" }), [], { id: "start", changedAt: "2026-08-28T00:00:00.000Z" }),
      catalogChangeRecord("part", part(), part({ id: "part-3" }), [], { id: "end", changedAt: "2026-08-28T01:00:00.000Z" }),
      catalogChangeRecord("part", part(), part({ id: "part-4" }), [], { id: "new", changedAt: "2026-08-28T01:00:01.000Z" })
    ];

    expect(filterCatalogChangeRecords(records, { from: "2026-08-28T00:00:00.000Z", to: "2026-08-28T01:00:00.000Z" }).map((record) => record.id)).toEqual(["end", "start"]);
  });

  it("ignores image-only churn but keeps price, quality, missing-field, and spec changes", () => {
    const imageOnly = meaningfulCatalogChangeFields(part(), part({ imageUrl: "https://img.danawa.com/new.jpg" }));
    const meaningful = meaningfulCatalogChangeFields(part(), part({ priceWon: 120000, dataQuality: "live", missingFields: [], specs: { socket: "AM5" }, rawSpecText: "AMD AM5" }));

    expect(imageOnly).toEqual([]);
    expect(meaningful).toEqual(expect.arrayContaining(["가격", "원문 스펙", "정규화 스펙", "데이터 품질", "누락 필드"]));
  });

  it("summarizes only the relevant change dimensions", () => {
    const records = [
      catalogChangeRecord("part", part(), part({ priceWon: 120000 }), ["가격"], { changedAt: "2026-08-28T03:00:00.000Z" }),
      catalogChangeRecord("accessory", part(), part({ dataQuality: "live", missingFields: [] }), ["데이터 품질", "누락 필드", "정규화 스펙"], { changedAt: "2026-08-28T02:00:00.000Z" })
    ];

    expect(catalogChangeSummary(records, 5)).toEqual({ inspectedProducts: 5, changedProducts: 2, priceChangedProducts: 1, qualityChangedProducts: 1, missingFieldChangedProducts: 1, specChangedProducts: 1 });
  });
});
