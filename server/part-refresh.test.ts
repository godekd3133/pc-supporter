import { describe, expect, it } from "vitest";
import type { AccessoryItem, Part } from "../shared/types";
import { accessoryRefreshBlockReason, accessoryRefreshResponse, changedAccessoryFields, changedPartFields, partRefreshBlockReason, partRefreshResponse, reconcileRefreshedAccessory, reconcileRefreshedPart, refreshDanawaAccessory, refreshDanawaPart } from "./part-refresh";

const danawaPart: Part = {
  id: "danawa-case-1",
  category: "case",
  name: "테스트 케이스",
  danawaUrl: "https://prod.danawa.com/info/?pcode=1&cate=112775",
  source: "danawa",
  sourceProductCode: "1",
  priceWon: 50000,
  rawSpecText: "ATX 케이스 / VGA 길이: 400mm / CPU쿨러 높이: 170mm / 3.5인치 베이: 2개",
  specs: { maxGpuLengthMm: 400, maxCoolerHeightMm: 170, hddBays: 2 },
  dataQuality: "live",
  missingFields: [],
  updatedAt: "2026-08-28T00:00:00.000Z"
};

const danawaAccessory: AccessoryItem = {
  id: "accessory-thermal_grease-2",
  category: "thermal_grease",
  name: "테스트 써멀그리스",
  danawaUrl: "https://prod.danawa.com/info/?pcode=2&cate=11336859",
  source: "danawa",
  sourceProductCode: "2",
  listingType: "accessory",
  priceWon: 500,
  rawSpecText: "써멀그리스 / 용량: 1g",
  specs: { capacityG: 1 },
  dataQuality: "live",
  missingFields: [],
  updatedAt: "2026-08-28T00:00:00.000Z"
};

describe("part detail refresh", () => {
  it("rejects non-Danawa, malformed, and mismatched source boundaries", () => {
    expect(partRefreshBlockReason({ ...danawaPart, source: "seed" })).toContain("다나와 상품 페이지 재확인 대상");
    expect(partRefreshBlockReason({ ...danawaPart, danawaUrl: "https://evil.example/info/?pcode=1" })).toContain("허용된 다나와 상품 페이지");
    expect(partRefreshBlockReason({ ...danawaPart, sourceProductCode: "2" })).toContain("상품 코드가 일치");
    expect(partRefreshBlockReason(danawaPart)).toBeUndefined();
  });

  it("keeps the old known price when the refreshed detail has no price", () => {
    const before = { ...danawaPart, priceCheckedAt: "2026-08-20T00:00:00.000Z" };
    const refreshed = reconcileRefreshedPart(before, { ...before, priceWon: undefined, specs: { ...before.specs, hddBays: 4 }, missingFields: [] });

    expect(refreshed.priceWon).toBe(50000);
    expect(refreshed.priceCheckedAt).toBe(before.priceCheckedAt);
    expect(refreshed.specs.hddBays).toBe(4);
  });

  it("does not overwrite a live record with a degraded incomplete refresh", () => {
    expect(() => reconcileRefreshedPart(danawaPart, { ...danawaPart, dataQuality: "incomplete", missingFields: ["hddBays"] })).toThrow("기존 데이터보다 부족");
  });

  it("refreshes through the shared Danawa parser and reports changed fields", async () => {
    const html = `<title>테스트 케이스 : 다나와 가격비교</title><link rel="canonical" href="https://prod.danawa.com/info/?pcode=1"><meta property="og:description" content="최저가 58,900원" /><meta name="description" content="ATX 케이스 / 지원보드규격: ATX / VGA 길이: 410mm / CPU쿨러 높이: 180mm / 3.5인치 베이: 4개 / 지원파워규격: 표준-ATX / 파워 장착 길이: 220mm" />`;
    let observedPrice: number | undefined;
    const refreshed = await refreshDanawaPart(danawaPart, { fetchHtml: async () => html, onPriceObserved: (price) => { observedPrice = price; } });
    const response = partRefreshResponse(danawaPart, refreshed, "2026-08-28T01:00:00.000Z");

    expect(refreshed.name).toBe("테스트 케이스");
    expect(observedPrice).toBe(58900);
    expect(refreshed.specs.maxGpuLengthMm).toBe(410);
    expect(refreshed.specs.hddBays).toBe(4);
    expect(Date.parse(refreshed.priceCheckedAt ?? "")).toBeGreaterThan(Date.now() - 5000);
    expect(changedPartFields(danawaPart, refreshed)).toEqual(expect.arrayContaining(["원문 스펙", "정규화 스펙"]));
    expect(response.previousMissingFields).toEqual([]);
    expect(response.changedFields).toContain("정규화 스펙");
    expect(response.valueDiffs).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "원문 스펙" }),
      expect.objectContaining({ field: "정규화 스펙" })
    ]));
  });

  it("refreshes an accessory through the accessory parser and preserves the old price when needed", async () => {
    const html = `<title>테스트 써멀그리스 : 다나와 가격비교</title><meta property="og:description" content="최저가 650원" /><meta name="description" content="써멀그리스 / 용량: 2g / 열전도율: 8.5W/(m·K)" />`;
    const refreshed = await refreshDanawaAccessory(danawaAccessory, { fetchHtml: async () => html });
    const response = accessoryRefreshResponse(danawaAccessory, refreshed, "2026-08-28T01:00:00.000Z");

    expect(refreshed.priceWon).toBe(650);
    expect(Date.parse(refreshed.priceCheckedAt ?? "")).toBeGreaterThan(Date.now() - 5000);
    expect(refreshed.specs.capacityG).toBe(2);
    expect(refreshed.specs.thermalConductivityWmK).toBe(8.5);
    expect(changedAccessoryFields(danawaAccessory, refreshed)).toEqual(expect.arrayContaining(["가격", "원문 스펙", "정규화 스펙"]));
    expect(response.previousDataQuality).toBe("live");
    expect(response.changedFields).toContain("가격");
    expect(reconcileRefreshedAccessory(danawaAccessory, { ...refreshed, priceWon: undefined }).priceWon).toBe(500);
  });

  it("preserves the category ID of the stored accessory detail URL after a source mapping change", async () => {
    const oldStorageAccessory: AccessoryItem = {
      ...danawaAccessory,
      id: "accessory-storage_accessory-old-source",
      category: "storage_accessory",
      sourceCategoryId: "112760",
      sourceProductCode: "270200",
      danawaUrl: "https://prod.danawa.com/info/?pcode=270200&cate=112760",
      name: "M.2 SSD to PCIe adapter",
      rawSpecText: "변환 컨버터 / M.2→PCIe 카드",
      specs: { adapterPcieSlotWidth: 4 }
    };
    const html = `<title>M.2 SSD to PCIe adapter : 다나와 가격비교</title><meta name="description" content="변환 컨버터 / M.2→PCIe 카드 / PCIe x4" />`;
    const refreshed = await refreshDanawaAccessory(oldStorageAccessory, { fetchHtml: async () => html });

    expect(refreshed.sourceCategoryId).toBe("112760");
  });

  it("rejects accessory refresh links that do not match the stored product code", () => {
    expect(accessoryRefreshBlockReason({ ...danawaAccessory, sourceProductCode: "3" })).toContain("상품 코드가 일치");
    expect(accessoryRefreshBlockReason(danawaAccessory)).toBeUndefined();
  });
});
