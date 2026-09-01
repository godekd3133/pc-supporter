import { describe, expect, it } from "vitest";
import type { AccessoryItem, Part } from "../shared/types";
import { crawlAccessoryChangeRecords } from "./accessory-crawler";
import { crawlPartChangeRecords } from "./crawler";

const part = (sourceProductCode: string, overrides: Partial<Part> = {}): Part => ({
  id: `danawa-cpu-${sourceProductCode}`,
  category: "cpu",
  name: `테스트 CPU ${sourceProductCode}`,
  source: "danawa",
  sourceProductCode,
  danawaUrl: `https://prod.danawa.com/info/?pcode=${sourceProductCode}&cate=112747`,
  priceWon: 100000,
  rawSpecText: "AMD(소켓AM5) / TDP: 65W",
  specs: { socket: "AM5", tdpW: 65 },
  dataQuality: "live",
  missingFields: [],
  updatedAt: "2026-08-28T00:00:00.000Z",
  ...overrides
});

const accessory = (sourceProductCode: string, overrides: Partial<AccessoryItem> = {}): AccessoryItem => ({
  id: `accessory-thermal_grease-${sourceProductCode}`,
  category: "thermal_grease",
  name: `테스트 써멀 ${sourceProductCode}`,
  source: "danawa",
  sourceProductCode,
  danawaUrl: `https://prod.danawa.com/info/?pcode=${sourceProductCode}&cate=11336859`,
  listingType: "accessory",
  priceWon: 500,
  rawSpecText: "써멀그리스 / 용량: 1g",
  specs: { capacityG: 1 },
  dataQuality: "incomplete",
  missingFields: ["detail page"],
  updatedAt: "2026-08-28T00:00:00.000Z",
  ...overrides
});

describe("crawler change log selection", () => {
  it("records only existing core products with meaningful changes and deduplicates a batch", () => {
    const before = [part("1")];
    const after = [part("1", { priceWon: 120000 }), part("2")];

    const records = crawlPartChangeRecords(before, after, [after[0], after[0], after[1]], "2026-08-28T01:00:00.000Z");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ itemId: after[0].id, priceDeltaWon: 20000, changedAt: "2026-08-28T01:00:00.000Z" });
    expect(records[0].changedFields).toEqual(["가격"]);
  });

  it("records an accessory quality improvement while ignoring image-only churn", () => {
    const before = [accessory("1")];
    const after = [accessory("1", { dataQuality: "live", missingFields: [], imageUrl: "https://img.danawa.com/new.jpg" })];

    const records = crawlAccessoryChangeRecords(before, after, after, "2026-08-28T01:00:00.000Z");

    expect(records).toHaveLength(1);
    expect(records[0].changedFields).toEqual(["데이터 품질", "누락 필드"]);
    expect(records[0].changedFields).not.toContain("이미지");
  });
});
