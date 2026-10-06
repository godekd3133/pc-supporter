import { describe, expect, it } from "vitest";
import type { AccessoryItem, Part } from "../shared/types";
import { crawlAccessoryChangeRecords } from "./accessory-crawler";
import { crawlPartChangeRecords, crawlPresenceChangeRecords } from "./crawler";
import { isQuoteSelectable } from "./listing";

const part = (sourceProductCode: string, overrides: Partial<Part> = {}): Part => ({
  id: `danawa-cpu-${sourceProductCode}`,
  category: "cpu",
  name: `테스트 CPU ${sourceProductCode}`,
  source: "danawa",
  sourceProductCode,
  danawaUrl: `https://prod.danawa.com/info/?pcode=${sourceProductCode}&cate=112747`,
  priceWon: 100000,
  rawSpecText: "AMD(소켓AM5) / TDP: 65W",
  specs: { socket: "AM5", tdpW: 65, cpuSeries: "Ryzen 9000" },
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
    expect(records[0].changedFields).toEqual(["데이터 상태", "누락 필드"]);
    expect(records[0].changedFields).not.toContain("이미지");
  });

  it("records new listings, delistings, and relistings with a quote eligibility note", () => {
    const before = [
      part("ghost-1", { delistedAt: "2026-09-01T00:00:00.000Z" }),
      part("gone-1"),
      part("keep-1")
    ];
    const collected = [part("ghost-1"), part("new-1"), part("keep-1")];
    const delisted = [part("gone-1", { delistedAt: "2026-10-01T00:00:00.000Z" })];

    const records = crawlPresenceChangeRecords(before, collected, delisted, "2026-10-01T01:00:00.000Z");

    expect(records).toHaveLength(3);
    const added = records.find((record) => record.itemId === "danawa-cpu-new-1");
    expect(added?.changedFields).toEqual(["신규 등록"]);
    expect(added?.nextPriceWon).toBe(100000);
    expect(added?.valueDiffs).toEqual(expect.arrayContaining([{ field: "견적 후보", next: "견적 포함" }]));
    const stopped = records.find((record) => record.itemId === "danawa-cpu-gone-1");
    expect(stopped?.changedFields).toEqual(["판매 중단"]);
    expect(stopped?.valueDiffs).toEqual(expect.arrayContaining([{ field: "판매 상태", previous: "판매 중", next: "판매 중단" }]));
    const relisted = records.find((record) => record.itemId === "danawa-cpu-ghost-1");
    expect(relisted?.changedFields).toEqual(["판매 재개"]);
  });

  it("keeps absent products unmarked when the category coverage is partial", () => {
    const before = [part("gone-1")];

    const records = crawlPresenceChangeRecords(before, [], [], "2026-10-01T01:00:00.000Z");

    expect(records).toHaveLength(0);
  });

  it("notes quote exclusion reasons for new listings without a price or retail status", () => {
    const unpriced = part("no-price", { priceWon: undefined });
    const bulk = part("bulk-1", { name: "테스트 CPU bulk-1 벌크", listingType: "bulk" });
    const accessoryType = part("bracket-1", { name: "테스트 CPU bracket-1 세이버 체결 브라켓", listingType: "accessory" });
    const foreign = part("import-1", { name: "테스트 CPU import-1 해외구매", listingType: "overseas" });

    const records = crawlPresenceChangeRecords([], [unpriced, bulk, accessoryType, foreign], [], "2026-10-01T01:00:00.000Z");

    const note = (id: string) => records.find((record) => record.itemId === `danawa-cpu-${id}`)?.valueDiffs?.find((diff) => diff.field === "견적 후보")?.next;
    expect(note("no-price")).toBe("견적 제외 · 가격 미확인");
    expect(note("bulk-1")).toBe("견적 제외 · 벌크");
    expect(note("bracket-1")).toBe("견적 제외 · 액세서리");
    expect(note("import-1")).toBe("견적 제외 · 해외구매");
  });

  it("excludes delisted parts from the quote candidate pool", () => {
    expect(isQuoteSelectable(part("1"))).toBe(true);
    expect(isQuoteSelectable(part("1", { delistedAt: "2026-10-01T00:00:00.000Z" }))).toBe(false);
    expect(isQuoteSelectable(part("2", { priceWon: undefined }))).toBe(false);
  });
});
