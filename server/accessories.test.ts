import { describe, expect, it } from "vitest";
import { ACCESSORY_CATEGORIES } from "../shared/types";
import type { AccessoryCrawlCategoryReport, AccessoryItem, AccessoryCategoryCoverage } from "../shared/types";
import { accessoryCategoryQualityCountsFor, accessoryCoverageSnapshotFor, accessoryListEvidenceFor, accessorySpecProfileCountsFor, countAccessories, findAccessory, mergeAccessories, mergeDanawaAccessorySnapshot, searchAccessories } from "./accessories";
import { assessAccessorySpecProfile } from "./accessory-spec-coverage";
import { seedAccessories } from "./seed-accessories";

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
  it("prefers a more complete public list page sample over an older underfilled sample", () => {
    const previous: AccessoryCategoryCoverage = {
      category: "storage_accessory",
      categoryId: "11329818",
      evidenceSource: "danawa-public-crawl",
      hasCrawlHistory: true,
      totalProductCount: 524,
      storedProductCount: 20,
      liveProducts: 20,
      incompleteProducts: 0,
      incompleteSpecs: 0,
      pricedProducts: 20,
      pagesExpected: 18,
      pagesVisited: 1,
      listedProducts: 6,
      uniqueProducts: 6,
      detailFetched: 6,
      detailFailed: 0,
      missingProducts: 518,
      listCoverage: "partial",
      coverage: "partial",
      specCoverage: "partial",
      storedSpecCoverage: "partial",
      mode: "sample",
      details: true,
      onlyIncomplete: false,
      lastCrawledAt: "2026-09-20T00:00:00.000Z"
    };
    const report: AccessoryCrawlCategoryReport = {
      category: "storage_accessory",
      categoryId: "11329818",
      totalProductCount: 524,
      offset: 0,
      requestedLimit: 30,
      pagesExpected: 18,
      pagesVisited: 1,
      listedProducts: 30,
      uniqueProducts: 30,
      detailFetched: 30,
      detailFailed: 0,
      missingProducts: 0,
      incompleteSpecs: 0,
      listCoverage: "partial",
      coverage: "partial",
      specCoverage: "complete"
    };

    expect(accessoryListEvidenceFor(previous, report, { mode: "sample", onlyIncomplete: false })).toMatchObject({
      totalProductCount: 524,
      pagesExpected: 18,
      pagesVisited: 1,
      listedProducts: 30,
      uniqueProducts: 30
    });
  });

  it("provides a deterministic starter item for every peripheral category", () => {
    expect(seedAccessories.length).toBeGreaterThanOrEqual(40);
    expect(new Set(seedAccessories.map((item) => item.category))).toEqual(new Set(ACCESSORY_CATEGORIES));
    expect(seedAccessories.every((item) => item.source === "manual" && item.dataQuality === "seed" && item.listingType === "accessory" && item.missingFields.length === 0)).toBe(true);
    expect(mergeAccessories([], seedAccessories)).toHaveLength(seedAccessories.length);
  });

  it("keeps seed quality counts separate for each peripheral category", () => {
    const counts = accessoryCategoryQualityCountsFor([
      accessory({ id: "seed-fan", category: "cooling_fan", dataQuality: "seed" }),
      accessory({ id: "live-fan", category: "cooling_fan", dataQuality: "live" }),
      accessory({ id: "incomplete-ups", category: "ups", dataQuality: "incomplete" })
    ]);

    expect(counts.cooling_fan).toEqual({ seed: 1, live: 1, manual: 0, incomplete: 0 });
    expect(counts.ups).toEqual({ seed: 0, live: 0, manual: 0, incomplete: 1 });
    expect(counts.fan_hub).toEqual({ seed: 0, live: 0, manual: 0, incomplete: 0 });
  });

  it("does not treat raw text as normalized M.2 adapter-fit evidence or rewrite crawl quality", () => {
    const rawTextOnly = accessory({
      category: "storage_accessory",
      name: "M.2 PCIe x4 어댑터",
      rawSpecText: "M.2 2280 · NVMe → PCIe x4",
      specs: {},
      dataQuality: "live",
      missingFields: []
    });
    const assessment = assessAccessorySpecProfile(rawTextOnly);
    const storedCoverage = accessoryCoverageSnapshotFor({ updatedAt: "", categories: [] }, [rawTextOnly]);
    const storageCoverage = storedCoverage.categories.find((item) => item.category === "storage_accessory");

    expect(assessment).toEqual([{
      profile: "m2_pcie_adapter_fit",
      status: "partial",
      missingFields: ["supportedFormFactors", "interface", "adapterPcieSlotWidth"]
    }]);
    expect(storageCoverage?.specProfileCounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ profile: "m2_pcie_adapter_fit", total: 1, assessed: 1, complete: 0, partial: 1, notAssessed: 0 }),
      expect.objectContaining({ profile: "m2_sata_adapter_fit", total: 0 }),
      expect.objectContaining({ profile: "storage_other_not_assessed", total: 0 })
    ]));
    expect(storageCoverage).toMatchObject({ incompleteProducts: 0, incompleteSpecs: 0, storedSpecCoverage: "partial" });
    expect(rawTextOnly).toMatchObject({ dataQuality: "live", missingFields: [], specs: {} });
  });

  it("assesses PCIe and SATA M.2 adapters against distinct required fields", () => {
    const pcie = accessory({
      id: "pcie-m2-adapter",
      name: "M.2 PCIe adapter",
      specs: { interface: "NVMe", formFactor: "M.2 2280", supportedFormFactors: ["M.2 2280"], adapterPcieSlotWidth: 4 }
    });
    const sata = accessory({
      id: "sata-m2-adapter",
      name: "M.2 SATA adapter",
      specs: { interface: "SATA", formFactor: "M.2 2280", supportedFormFactors: ["M.2 2280"] }
    });

    expect(assessAccessorySpecProfile(pcie)).toEqual([{ profile: "m2_pcie_adapter_fit", status: "complete" }]);
    expect(assessAccessorySpecProfile(sata)).toEqual([{ profile: "m2_sata_adapter_fit", status: "complete" }]);
  });

  it("assesses only the cooling-fan mount width and height", () => {
    const parsedFanSize = accessory({ category: "cooling_fan", specs: { lengthMm: 120, widthMm: 120 } });
    const unparsedRawText = accessory({ category: "cooling_fan", rawSpecText: "팬 크기: 120mm", specs: {} });

    expect(assessAccessorySpecProfile(parsedFanSize)).toEqual([{ profile: "cooling_fan_mount_size", status: "complete" }]);
    expect(assessAccessorySpecProfile(unparsedRawText)).toEqual([{
      profile: "cooling_fan_mount_size",
      status: "partial",
      missingFields: ["lengthMm", "widthMm"]
    }]);
  });

  it("keeps fan and RGB hub connectivity profiles separate from load limits", () => {
    const hub = accessory({
      category: "fan_hub",
      rawSpecText: "팬컨트롤러 / 입력단자: PWM, ARGB 3핀, SATA전원 / 분배단자: PWM 4핀, ARGB 3핀 / 팬분배: 4개 / RGB분배: 4개 / 최대 허용전력: 1A",
      specs: { fanPortCount: 4, rgbPortCount: 4 }
    });

    expect(assessAccessorySpecProfile(hub)).toEqual([
      { profile: "fan_hub_fan_connectivity", status: "complete" },
      { profile: "fan_hub_rgb_connectivity", status: "complete" }
    ]);
    expect(accessorySpecProfileCountsFor([hub], "fan_hub")).toEqual([
      expect.objectContaining({ profile: "fan_hub_fan_connectivity", total: 1, complete: 1, partial: 0, notAssessed: 0 }),
      expect.objectContaining({ profile: "fan_hub_rgb_connectivity", total: 1, complete: 1, partial: 0, notAssessed: 0 })
    ]);
  });

  it("does not infer UPS output watts from VA", () => {
    const vaOnlyUps = accessory({ category: "ups", name: "UPS 700VA", rawSpecText: "출력 용량 (VA): 700VA", specs: { capacityVa: 700 } });

    expect(assessAccessorySpecProfile(vaOnlyUps)).toEqual([{
      profile: "ups_output_w",
      status: "partial",
      missingFields: ["outputW"]
    }]);
  });

  it("marks unvalidated fit-oriented accessory types as not assessed", () => {
    const items = (["gpu_support", "gpu_cooler", "memory_cooler", "thermal_pad"] as const).map((category) => accessory({
      id: `not-assessed-${category}`,
      category,
      specs: {},
      dataQuality: "incomplete",
      missingFields: ["source detail"]
    }));

    for (const item of items) {
      expect(assessAccessorySpecProfile(item)).toEqual([{ profile: "fit_not_assessed", status: "not_assessed" }]);
      expect(accessorySpecProfileCountsFor([item], item.category)).toEqual([
        { profile: "fit_not_assessed", total: 1, assessed: 0, complete: 0, partial: 0, notAssessed: 1 }
      ]);
      expect(item).toMatchObject({ dataQuality: "incomplete", missingFields: ["source detail"] });
    }
  });

  it("joins stale crawl history to every category's current saved accessory status", () => {
    const storedCoverage = {
      updatedAt: "2026-09-12T00:00:00.000Z",
      categories: [{
        category: "cooling_fan" as const,
        categoryId: "old-fan-list",
        evidenceSource: "danawa-public-crawl" as const,
        totalProductCount: 6,
        storedProductCount: 6,
        liveProducts: 0,
        incompleteProducts: 0,
        pricedProducts: 6,
        pagesExpected: 1,
        pagesVisited: 1,
        listedProducts: 6,
        uniqueProducts: 6,
        detailFetched: 6,
        detailFailed: 0,
        missingProducts: 0,
        incompleteSpecs: 1,
        listCoverage: "complete" as const,
        coverage: "partial" as const,
        specCoverage: "partial" as const,
        storedSpecCoverage: "partial" as const,
        mode: "sample" as const,
        details: true,
        onlyIncomplete: false,
        lastCrawledAt: "2026-09-12T00:00:00.000Z"
      }]
    };
    const snapshot = accessoryCoverageSnapshotFor(storedCoverage, [
      accessory({ id: "current-fan", category: "cooling_fan", dataQuality: "live", missingFields: [] }),
      accessory({ id: "current-ups", category: "ups", dataQuality: "incomplete", missingFields: ["detail page"] })
    ]);
    const coolingFan = snapshot.categories.find((entry) => entry.category === "cooling_fan");
    const ups = snapshot.categories.find((entry) => entry.category === "ups");

    expect(snapshot.categories).toHaveLength(ACCESSORY_CATEGORIES.length);
    expect(coolingFan).toMatchObject({ storedProductCount: 1, liveProducts: 1, incompleteProducts: 0, incompleteSpecs: 0, pricedProducts: 1, hasCrawlHistory: true, listCoverage: "complete" });
    expect(ups).toMatchObject({ storedProductCount: 1, liveProducts: 0, incompleteProducts: 1, incompleteSpecs: 1, pricedProducts: 1, hasCrawlHistory: false, pagesVisited: 0, listCoverage: "partial" });
  });

  it("does not expose test-fixture counters as public crawl history", () => {
    const snapshot = accessoryCoverageSnapshotFor({
      updatedAt: "2026-09-12T00:00:00.000Z",
      categories: [{
        category: "cooling_fan",
        categoryId: "browser-smoke-cooling-fan",
        evidenceSource: "browser-smoke-fixture",
        totalProductCount: 7,
        storedProductCount: 7,
        liveProducts: 0,
        incompleteProducts: 0,
        pricedProducts: 7,
        pagesExpected: 1,
        pagesVisited: 1,
        listedProducts: 7,
        uniqueProducts: 7,
        detailFetched: 7,
        detailFailed: 0,
        missingProducts: 0,
        incompleteSpecs: 1,
        listCoverage: "complete",
        coverage: "partial",
        specCoverage: "partial",
        storedSpecCoverage: "partial",
        mode: "sample",
        details: true,
        onlyIncomplete: false,
        lastCrawledAt: "2026-09-12T00:00:00.000Z"
      }]
    }, [accessory({ id: "fixture-fan", category: "cooling_fan" })]);
    const coolingFan = snapshot.categories.find((entry) => entry.category === "cooling_fan");

    expect(coolingFan).toMatchObject({
      categoryId: "crawl-history-unavailable",
      hasCrawlHistory: false,
      pagesExpected: 0,
      pagesVisited: 0,
      listCoverage: "partial",
      lastCrawledAt: ""
    });
  });

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

  it("filters peripheral catalog results by a normalized manufacturer condition", () => {
    const items = [
      accessory({ id: "asus", brand: "ASUS", name: "ASUS 팬" }),
      accessory({ id: "corsair", brand: "CORSAIR", name: "CORSAIR 팬" })
    ];

    expect(searchAccessories(items, undefined, 10, { brand: " asus " }).map((item) => item.id)).toEqual(["asus"]);
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

  it("replaces stale Danawa rows only inside the selected accessory categories", () => {
    const staleFan = accessory({ id: "stale-fan", category: "cooling_fan", sourceProductCode: "fan-old", name: "이전 팬" });
    const currentFan = accessory({ id: "current-fan", category: "cooling_fan", sourceProductCode: "fan-new", name: "현재 팬" });
    const unrelatedUps = accessory({ id: "keep-ups", category: "ups", sourceProductCode: "ups-keep", name: "유지할 UPS" });

    const merged = mergeDanawaAccessorySnapshot([staleFan, unrelatedUps], [currentFan], ["cooling_fan"]);

    expect(merged.map((item) => item.name)).toEqual(["유지할 UPS", "현재 팬"]);
  });
});
