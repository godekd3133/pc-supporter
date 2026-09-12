import { describe, expect, it, vi } from "vitest";
import type { Part } from "../shared/types";
import { benchmarkCoverageForCatalog, catalogEligibilitySummaryFor, catalogSearchTotalsFor, countParts, filterParts, mergeCatalog, mergeDanawaSnapshot, parseCatalogMissingField, parsePartSpecFilter, partMatchesSpecFilter, partSpecFilterDiagnosticsFor, partSpecFilterMatcherFor, searchParts, seedBaseFor } from "./catalog";
import { seedCatalog } from "./seed-catalog";
import { starterCatalog } from "./seed-catalog-starter";

function part(overrides: Partial<Part>): Part {
  return {
    id: "danawa-cpu-1",
    category: "cpu",
    name: "CPU",
    source: "danawa",
    sourceProductCode: "1",
    specs: { socket: "AM5", tdpW: 120 },
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides
  };
}

describe("catalog merge", () => {
  it("retains the expanded starter reference parts after live rows exist", () => {
    const livePart = part({ id: "danawa-cpu-live", sourceProductCode: "live-1" });

    expect(seedBaseFor([livePart])).toBe(starterCatalog);
    expect(seedBaseFor([livePart])).toHaveLength(115);
    expect(seedBaseFor([livePart]).length).toBeGreaterThan(seedCatalog.length);
  });

  it("merges live rows without losing expanded starter reference parts", () => {
    const livePart = part({ id: "danawa-cpu-live", sourceProductCode: "live-1" });
    const merged = mergeCatalog(seedBaseFor([livePart]), [livePart]);

    expect(merged).toHaveLength(starterCatalog.length + 1);
    expect(merged.filter((item) => item.source === "seed")).toHaveLength(starterCatalog.length);
    expect(merged.some((item) => item.id === "cpu-7600")).toBe(true);
    expect(merged.some((item) => item.id === "danawa-cpu-live")).toBe(true);
  });

  it("does not downgrade a verified live item with an incomplete crawl", () => {
    const existing = part({ name: "검증된 CPU", dataQuality: "live" });
    const incomplete = part({ name: "불완전한 CPU", dataQuality: "incomplete", missingFields: ["tdpW"] });

    const merged = mergeCatalog([existing], [incomplete]);

    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("검증된 CPU");
    expect(merged[0].dataQuality).toBe("live");
  });

  it("preserves an existing price when a later live refresh omits it", () => {
    const existing = part({ priceWon: 38450, specs: { socket: "AM5", tdpW: 120 } });
    const refreshed = part({ priceWon: undefined, specs: { socket: "AM5" }, updatedAt: "2026-08-26T01:00:00.000Z" });

    const merged = mergeCatalog([existing], [refreshed]);

    expect(merged[0].priceWon).toBe(38450);
    expect(merged[0].specs.tdpW).toBe(120);
  });

  it("accepts a newer live crawl over a seed item", () => {
    const seeded = part({ source: "seed", dataQuality: "seed", name: "기본 CPU" });
    const live = part({ dataQuality: "live", name: "최신 CPU" });

    const merged = mergeCatalog([seeded], [live]);

    expect(merged.some((item) => item.name === "최신 CPU")).toBe(true);
  });

  it("replaces stale Danawa records only inside the refreshed categories", () => {
    const staleCooler = part({
      id: "danawa-cooler-stale",
      category: "cooler",
      sourceProductCode: "stale",
      name: "이전 쿨러"
    });
    const currentCooler = part({
      id: "danawa-cooler-current",
      category: "cooler",
      sourceProductCode: "current",
      name: "현재 쿨러"
    });
    const unrelatedCpu = part({ name: "유지할 CPU" });

    const merged = mergeDanawaSnapshot(
      [staleCooler, unrelatedCpu],
      [currentCooler],
      ["cooler"]
    );

    expect(merged.map((item) => item.name)).toEqual(["유지할 CPU", "현재 쿨러"]);
  });

  it("returns stable pages for the picker without changing sort order", () => {
    const catalog = [
      part({ sourceProductCode: "1", name: "CPU A", priceWon: 10000 }),
      part({ sourceProductCode: "2", name: "CPU B", priceWon: 20000 }),
      part({ sourceProductCode: "3", name: "CPU C", priceWon: 30000 })
    ];

    expect(countParts(catalog, "cpu", "CPU", { sort: "price_asc" })).toBe(3);
    expect(searchParts(catalog, "cpu", "CPU", 2, { sort: "price_asc" }, 0).map((item) => item.sourceProductCode))
      .toEqual(["1", "2"]);
    expect(searchParts(catalog, "cpu", "CPU", 2, { sort: "price_asc" }, 2).map((item) => item.sourceProductCode))
      .toEqual(["3"]);
  });

  it("computes layered catalog totals with the same predicates as individual counts", () => {
    const catalog = [
      part({ id: "cpu-known", name: "CPU 확인", priceWon: 10000, updatedAt: "2026-09-01T00:00:00.000Z" }),
      part({ id: "cpu-unknown", name: "CPU 미확인", priceWon: 0, dataQuality: "incomplete", updatedAt: "2026-07-01T00:00:00.000Z" }),
      part({ id: "board-embedded", category: "motherboard", name: "Raspberry Pi 임베디드 보드", priceWon: 10000, updatedAt: "2026-09-01T00:00:00.000Z" })
    ];
    const base = { quality: "all" as const, sort: "price_asc" as const, listingPolicy: "all" as const };
    const price = { ...base, priceAvailability: "known" as const };
    const freshness = { ...price, freshness: "fresh" as const, now: "2026-09-02T00:00:00.000Z" };
    const benchmark = { ...freshness, benchmarkAvailability: "all" as const };
    const final = { ...benchmark };
    const { listingPolicy: _listingPolicy, ...unfiltered } = final;
    const coreCandidate = { ...unfiltered, listingPolicy: "all" as const };
    const totals = catalogSearchTotalsFor(catalog, undefined, undefined, { base, price, freshness, benchmark, final, unfiltered, coreCandidate });

    expect(totals.baseTotal).toBe(countParts(catalog, undefined, undefined, base));
    expect(totals.priceTotal).toBe(countParts(catalog, undefined, undefined, price));
    expect(totals.freshnessTotal).toBe(countParts(catalog, undefined, undefined, freshness));
    expect(totals.benchmarkTotal).toBe(countParts(catalog, undefined, undefined, benchmark));
    expect(totals.total).toBe(countParts(catalog, undefined, undefined, final));
    expect(totals.unfilteredTotal).toBe(countParts(catalog, undefined, undefined, unfiltered));
    expect(totals.coreCandidateTotal).toBe(countParts(catalog, undefined, undefined, coreCandidate));
    expect(totals.categoryMismatchExcludedCount).toBe(1);
  });

  it("filters catalog results by a normalized manufacturer condition", () => {
    const catalog = [
      part({ sourceProductCode: "amd", brand: "AMD", name: "라이젠 CPU" }),
      part({ sourceProductCode: "asus", brand: "ASUS", name: "ASUS 보드" }),
      part({ sourceProductCode: "gigabyte", brand: "GIGABYTE", name: "GIGABYTE 보드" })
    ];

    expect(searchParts(catalog, undefined, undefined, 10, { brand: " amd " }).map((item) => item.sourceProductCode)).toEqual(["amd"]);
    expect(searchParts(catalog, undefined, undefined, 10, { brand: "asus" }).map((item) => item.sourceProductCode)).toEqual(["asus"]);
    expect(countParts(catalog, undefined, undefined, { brand: "board" })).toBe(0);
  });

  it("filters catalog results by explicit freshness without changing the source records", () => {
    const now = "2026-09-01T00:00:00.000Z";
    const catalog = [
      part({ sourceProductCode: "fresh", name: "최근 CPU", updatedAt: "2026-08-30T00:00:00.000Z" }),
      part({ sourceProductCode: "aging", name: "갱신 권장 CPU", updatedAt: "2026-08-20T00:00:00.000Z" }),
      part({ sourceProductCode: "stale", name: "오래된 CPU", updatedAt: "2026-07-01T00:00:00.000Z" }),
      part({ sourceProductCode: "unknown", name: "시점 불명 CPU", updatedAt: "not-a-date" })
    ];

    expect(searchParts(catalog, "cpu", undefined, 10, { freshness: "fresh", now }).map((item) => item.name)).toEqual(["최근 CPU"]);
    expect(searchParts(catalog, "cpu", undefined, 10, { freshness: "aging", now }).map((item) => item.name)).toEqual(["갱신 권장 CPU"]);
    expect(searchParts(catalog, "cpu", undefined, 10, { freshness: "stale", now }).map((item) => item.name)).toEqual(["오래된 CPU"]);
    expect(searchParts(catalog, "cpu", undefined, 10, { freshness: "unknown", now }).map((item) => item.name)).toEqual(["시점 불명 CPU"]);
    expect(catalog.map((item) => item.updatedAt)).toEqual([
      "2026-08-30T00:00:00.000Z",
      "2026-08-20T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
      "not-a-date"
    ]);
  });

  it("filters catalog results by explicit price availability", () => {
    const catalog = [
      part({ sourceProductCode: "known", name: "가격 확인 CPU", priceWon: 10000 }),
      part({ sourceProductCode: "zero", name: "0원 CPU", priceWon: 0 }),
      part({ sourceProductCode: "missing", name: "가격 미확인 CPU", priceWon: undefined })
    ];

    expect(searchParts(catalog, "cpu", undefined, 10, { priceAvailability: "known" }).map((item) => item.name)).toEqual(["가격 확인 CPU"]);
    expect(searchParts(catalog, "cpu", undefined, 10, { priceAvailability: "unknown" }).map((item) => item.name)).toEqual(["0원 CPU", "가격 미확인 CPU"]);
  });

  it("filters CPU and GPU catalog rows by complete benchmark sets", () => {
    const catalog = [
      part({ sourceProductCode: "cpu-complete", name: "완전 CPU", specs: { cinebenchR23Single: 2200, cinebenchR23Multi: 12000 } }),
      part({ sourceProductCode: "cpu-partial", name: "일부 CPU", specs: { cinebenchR23Multi: 12000 } }),
      part({ sourceProductCode: "cpu-missing", name: "미확인 CPU", specs: { socket: "AM5" } }),
      part({ category: "gpu", sourceProductCode: "gpu-complete", name: "완전 GPU", specs: { gpu3dmarkTimeSpyScore: 21000, gpu3dmarkPortRoyalScore: 14000 } }),
      part({ category: "gpu", sourceProductCode: "gpu-partial", name: "일부 GPU", specs: { gpu3dmarkTimeSpyScore: 21000 } })
    ];

    expect(searchParts(catalog, "cpu", undefined, 10, { benchmarkAvailability: "complete", sort: "name" }).map((item) => item.sourceProductCode)).toEqual(["cpu-complete"]);
    expect(searchParts(catalog, "cpu", undefined, 10, { benchmarkAvailability: "incomplete", sort: "name" }).map((item) => item.sourceProductCode)).toEqual(["cpu-missing", "cpu-partial"]);
    expect(searchParts(catalog, "gpu", undefined, 10, { benchmarkAvailability: "complete", sort: "name" }).map((item) => item.sourceProductCode)).toEqual(["gpu-complete"]);
    expect(searchParts(catalog, "gpu", undefined, 10, { benchmarkAvailability: "incomplete", sort: "name" }).map((item) => item.sourceProductCode)).toEqual(["gpu-partial"]);
  });

  it("sorts benchmarked CPU and GPU rows ahead of rows without scores", () => {
    const catalog = [
      part({ category: "cpu", sourceProductCode: "cpu-low", name: "CPU 낮은 점수", specs: { cinebenchR23Multi: 8000 } }),
      part({ category: "cpu", sourceProductCode: "cpu-high", name: "CPU 높은 점수", specs: { cinebenchR23Multi: 16000 } }),
      part({ category: "cpu", sourceProductCode: "cpu-none", name: "CPU 점수 없음", specs: { socket: "AM5" } }),
      part({ category: "gpu", sourceProductCode: "gpu-low", name: "GPU 낮은 점수", specs: { gpu3dmarkTimeSpyScore: 12000 } }),
      part({ category: "gpu", sourceProductCode: "gpu-high", name: "GPU 높은 점수", specs: { gpu3dmarkTimeSpyScore: 22000 } }),
      part({ category: "gpu", sourceProductCode: "gpu-none", name: "GPU 점수 없음", specs: { vramGb: 8 } })
    ];

    expect(searchParts(catalog, "cpu", undefined, 10, { sort: "benchmark_desc" }).map((item) => item.sourceProductCode)).toEqual(["cpu-high", "cpu-low", "cpu-none"]);
    expect(searchParts(catalog, "gpu", undefined, 10, { sort: "benchmark_desc" }).map((item) => item.sourceProductCode)).toEqual(["gpu-high", "gpu-low", "gpu-none"]);
  });

  it("treats invalid benchmark values as missing and falls back to the next valid metric", () => {
    const catalog = [
      part({ category: "cpu", sourceProductCode: "cpu-zero", name: "Z 점수 0 CPU", specs: { cinebenchR23Multi: 0 } }),
      part({ category: "cpu", sourceProductCode: "cpu-nan", name: "Y NaN CPU", specs: { cinebenchR23Multi: Number.NaN } }),
      part({ category: "cpu", sourceProductCode: "cpu-missing", name: "A 점수 없음 CPU", specs: { socket: "AM5" } }),
      part({ category: "cpu", sourceProductCode: "cpu-fallback", name: "대체 점수 CPU", specs: { cinebenchR23Multi: 0, cinebenchR23Single: 2400 } })
    ];

    expect(searchParts(catalog, "cpu", undefined, 10, { sort: "benchmark_desc" }).map((item) => item.sourceProductCode)).toEqual(["cpu-fallback", "cpu-missing", "cpu-nan", "cpu-zero"]);
  });

  it("falls back to price ordering when benchmark sort is requested for another category", () => {
    const catalog = [
      part({ category: "memory", sourceProductCode: "memory-expensive", name: "A 고가 RAM", priceWon: 30000 }),
      part({ category: "memory", sourceProductCode: "memory-cheap", name: "Z 저가 RAM", priceWon: 10000 })
    ];

    expect(searchParts(catalog, "memory", undefined, 10, { sort: "benchmark_desc" }).map((item) => item.sourceProductCode)).toEqual(["memory-cheap", "memory-expensive"]);
  });

  it("pushes zero-price records behind known prices", () => {
    const catalog = [
      part({ sourceProductCode: "1", name: "가격 미확인 CPU", priceWon: 0 }),
      part({ sourceProductCode: "2", name: "가격 확인 CPU", priceWon: 10000 })
    ];

    expect(searchParts(catalog, "cpu", "CPU", 2, { sort: "price_asc" }).map((item) => item.sourceProductCode))
      .toEqual(["2", "1"]);
  });

  it("filters picker results by listing policy and excludes core-storage accessories", () => {
    const catalog = [
      part({ sourceProductCode: "retail", name: "정상 CPU", category: "cpu", priceWon: 10000 }),
      part({ sourceProductCode: "used", name: "중고 CPU", category: "cpu", priceWon: 5000 }),
      part({ sourceProductCode: "adapter", name: "USB SATA 컨버터", category: "ssd", priceWon: 5000, specs: { interface: "SATA", formFactor: "2.5인치", capacityGb: 4000 } })
    ];

    expect(searchParts(catalog, undefined, undefined, 10, { listingPolicy: "retail_only" }).map((item) => item.sourceProductCode))
      .toEqual(["retail"]);
    expect(searchParts(catalog, undefined, undefined, 10, { listingPolicy: "all" }).map((item) => item.sourceProductCode))
      .toEqual(["used", "retail"]);
  });

  it("separates raw catalog records from eligible core candidates in metadata", () => {
    const summary = catalogEligibilitySummaryFor([
      part({ id: "cpu-core", name: "정상 CPU", priceWon: 100000 }),
      part({ id: "case-accessory", category: "case", name: "PCI-E 라이저 케이블", rawSpecText: "액세서리 / 라이저 케이블", dataQuality: "incomplete", priceWon: 50000 }),
      part({ id: "ssd-storage-box", category: "ssd", name: "M.2 SSD 보관케이스", rawSpecText: "보관케이스 / SSD전용", dataQuality: "incomplete", priceWon: 10000 })
    ]);

    expect(summary).toEqual({
      eligibleCount: 1,
      excludedNonCoreCount: 2,
      categoryMismatchCount: 0,
      eligibleQualityCounts: { seed: 0, live: 1, manual: 0, incomplete: 0 },
      eligiblePriceCoverage: { priced: 1, unpriced: 0 }
    });
  });

  it("filters the full catalog by category-specific minimum specifications", () => {
    const catalog = [
      part({ category: "gpu", sourceProductCode: "gpu-8", name: "8GB GPU", specs: { vramGb: 8 } }),
      part({ category: "gpu", sourceProductCode: "gpu-16", name: "16GB GPU", specs: { vramGb: 16 } }),
      part({ category: "ssd", sourceProductCode: "ssd-nvme", name: "NVMe 1TB", specs: { interface: "NVMe", capacityGb: 1000 } }),
      part({ category: "ssd", sourceProductCode: "ssd-sata", name: "SATA 2TB", specs: { interface: "SATA", capacityGb: 2000 } }),
      part({ category: "psu", sourceProductCode: "psu-650", name: "650W PSU", specs: { wattageW: 650 } }),
      part({ category: "psu", sourceProductCode: "psu-1000", name: "1000W PSU", specs: { wattageW: 1000 } }),
      part({ category: "memory", sourceProductCode: "memory-6000", name: "6000 RAM", specs: { capacityGb: 32, speedMhz: 6000 } }),
      part({ category: "memory", sourceProductCode: "memory-6400", name: "6400 RAM", specs: { capacityGb: 32, speedMhz: 6400 } })
    ];

    expect(searchParts(catalog, "gpu", undefined, 10, { specFilter: { minVramGb: 12 } }).map((item) => item.sourceProductCode))
      .toEqual(["gpu-16"]);
    expect(searchParts(catalog, "ssd", undefined, 10, { specFilter: { minCapacityGb: 1500, interface: "SATA" } }).map((item) => item.sourceProductCode))
      .toEqual(["ssd-sata"]);
    expect(countParts(catalog, "ssd", undefined, { specFilter: { minCapacityGb: 3000 } })).toBe(0);
    expect(searchParts(catalog, "psu", undefined, 10, { specFilter: { minWattageW: 850 } }).map((item) => item.sourceProductCode))
      .toEqual(["psu-1000"]);
    expect(searchParts(catalog, "memory", undefined, 10, { specFilter: { minCapacityGb: 32, minMemorySpeedMhz: 6400 } }).map((item) => item.sourceProductCode))
      .toEqual(["memory-6400"]);
    const matcher = partSpecFilterMatcherFor({ minVramGb: 12 });
    expect(catalog.filter(matcher).map((item) => item.sourceProductCode)).toEqual(catalog.filter((item) => partMatchesSpecFilter(item, { minVramGb: 12 })).map((item) => item.sourceProductCode));
  });

  it("filters compatibility-critical socket, expansion, clearance, and depth facts", () => {
    const catalog = [
      part({ category: "motherboard", sourceProductCode: "board-good", name: "AM5 확장 보드", specs: { socket: "AM5", memoryType: "DDR5", formFactor: "mATX", memorySlots: 4, m2Slots: 3, sataPorts: 6 } }),
      part({ category: "motherboard", sourceProductCode: "board-small", name: "AM5 소형 보드", specs: { socket: "AM5", memoryType: "DDR4", formFactor: "mATX", memorySlots: 2, m2Slots: 1, sataPorts: 2 } }),
      part({ category: "motherboard", sourceProductCode: "board-pcie", name: "PCIe 확장 보드", specs: { pcieX16Slots: 1, pcieX8Slots: 1, pcieX4Slots: 1, pcieX1Slots: 2 } }),
      part({ category: "motherboard", sourceProductCode: "board-pcie-unknown", name: "PCIe 정보 부족 보드", specs: { pcieX16Slots: 1 } }),
      part({ category: "case", sourceProductCode: "case-good", name: "긴 GPU 지원 케이스", specs: { motherboardFormFactors: ["mATX"], maxGpuLengthMm: 360, maxCoolerHeightMm: 165, maxPsuLengthMm: 200, hddBays: 4 } }),
      part({ category: "case", sourceProductCode: "case-small", name: "짧은 GPU 지원 케이스", specs: { motherboardFormFactors: ["mATX"], maxGpuLengthMm: 300, maxCoolerHeightMm: 155, maxPsuLengthMm: 180, hddBays: 2 } }),
      part({ category: "gpu", sourceProductCode: "gpu-short", name: "짧은 GPU", specs: { lengthMm: 290 } }),
      part({ category: "gpu", sourceProductCode: "gpu-long", name: "긴 GPU", specs: { lengthMm: 360 } }),
      part({ category: "cooler", sourceProductCode: "cooler-good", name: "고성능 AM5 쿨러", specs: { supportedSockets: ["AM5"], maxCoolingW: 220 } }),
      part({ category: "cooler", sourceProductCode: "cooler-small", name: "소형 쿨러", specs: { supportedSockets: ["AM4"], maxCoolingW: 120 } }),
      part({ category: "psu", sourceProductCode: "psu-short", name: "짧은 ATX 파워", specs: { psuFormFactor: "ATX", psuDepthMm: 150 } }),
      part({ category: "psu", sourceProductCode: "psu-long", name: "긴 ATX 파워", specs: { psuFormFactor: "ATX", psuDepthMm: 180 } })
    ];

    expect(parsePartSpecFilter({ socket: " AM5 ", formFactor: " mATX ", minMemorySlots: "4", pcieSlotWidth: "4", minPcieSlotCount: "2", minMaxGpuLengthMm: 330, maxLengthMm: "300", maxPsuDepthMm: 160 })).toEqual({
      filter: { socket: "AM5", formFactor: "mATX", minMemorySlots: 4, pcieSlotWidth: 4, minPcieSlotCount: 2, minMaxGpuLengthMm: 330, maxLengthMm: 300, maxPsuDepthMm: 160 },
      errors: []
    });
    expect(searchParts(catalog, "motherboard", undefined, 10, { specFilter: { socket: "am5", memoryType: "ddr5", formFactor: "MATX", minMemorySlots: 4, minM2Slots: 2, minSataPorts: 4 } }).map((item) => item.sourceProductCode)).toEqual(["board-good"]);
    expect(searchParts(catalog, "motherboard", undefined, 10, { specFilter: { pcieSlotWidth: 4, minPcieSlotCount: 2 } }).map((item) => item.sourceProductCode)).toEqual(["board-pcie"]);
    const missingPcieBoards = searchParts(catalog, "motherboard", undefined, 10, { specFilter: { pcieSlotInfo: "missing" } }).map((item) => item.sourceProductCode);
    expect(missingPcieBoards).toHaveLength(3);
    expect(missingPcieBoards).toEqual(expect.arrayContaining(["board-good", "board-small", "board-pcie-unknown"]));
    expect(searchParts(catalog, "motherboard", undefined, 10, { specFilter: { pcieSlotInfo: "complete" } }).map((item) => item.sourceProductCode)).toEqual(["board-pcie"]);
    expect(searchParts(catalog, "case", undefined, 10, { specFilter: { formFactor: "mATX", minMaxGpuLengthMm: 330, minMaxCoolerHeightMm: 160, minMaxPsuLengthMm: 190, minHddBays: 3 } }).map((item) => item.sourceProductCode)).toEqual(["case-good"]);
    expect(searchParts(catalog, "gpu", undefined, 10, { specFilter: { maxLengthMm: 300 } }).map((item) => item.sourceProductCode)).toEqual(["gpu-short"]);
    expect(searchParts(catalog, "cooler", undefined, 10, { specFilter: { socket: "AM5", minCoolingW: 180 } }).map((item) => item.sourceProductCode)).toEqual(["cooler-good"]);
    expect(searchParts(catalog, "psu", undefined, 10, { specFilter: { formFactor: "ATX", maxPsuDepthMm: 160 } }).map((item) => item.sourceProductCode)).toEqual(["psu-short"]);
  });

  it("supports an exact part ID filter without dropping the category and text constraints", () => {
    const catalog = [
      part({ id: "cpu-exact", sourceProductCode: "exact", name: "같은 이름 CPU" }),
      part({ id: "cpu-other", sourceProductCode: "other", name: "같은 이름 CPU" }),
      part({ id: "gpu-exact", category: "gpu", sourceProductCode: "gpu-exact", name: "같은 이름 GPU" })
    ];

    expect(searchParts(catalog, "cpu", "같은 이름", 10, { partId: "cpu-exact" }).map((item) => item.id)).toEqual(["cpu-exact"]);
    expect(searchParts(catalog, "cpu", "같은 이름", 10, { partId: "gpu-exact" })).toEqual([]);
  });

  it("exposes an unsorted filtered seam for diagnostics without invoking the result sort", () => {
    const catalog = [
      part({ sourceProductCode: "expensive", name: "비싼 CPU", priceWon: 30000 }),
      part({ sourceProductCode: "cheap", name: "싼 CPU", priceWon: 10000 })
    ];
    const sortSpy = vi.spyOn(Array.prototype, "sort");
    try {
      expect(filterParts(catalog, "cpu", undefined, { sort: "price_asc" }).map((item) => item.sourceProductCode)).toEqual(["expensive", "cheap"]);
      expect(sortSpy).not.toHaveBeenCalled();
    } finally {
      sortSpy.mockRestore();
    }
  });

  it("filters records by a persisted missing field and keeps the field query bounded", () => {
    const catalog = [
      part({ sourceProductCode: "missing-tdp", name: "TDP 누락 CPU", dataQuality: "incomplete", missingFields: ["tdpW"] }),
      part({ sourceProductCode: "missing-socket", name: "소켓 누락 CPU", dataQuality: "incomplete", missingFields: ["socket"] }),
      part({ sourceProductCode: "complete", name: "완전 CPU", missingFields: [] })
    ];

    expect(parseCatalogMissingField(" tdpW ")).toEqual({ value: "tdpW" });
    expect(parseCatalogMissingField("x".repeat(121))).toMatchObject({ error: "누락 필드는 120자 이하로 입력해야 합니다." });
    expect(searchParts(catalog, "cpu", undefined, 10, { missingField: "tdpW" }).map((item) => item.sourceProductCode)).toEqual(["missing-tdp"]);
    expect(countParts(catalog, "cpu", undefined, { missingField: "socket" })).toBe(1);
  });

  it("normalizes valid spec filters and rejects unsafe numeric or interface values", () => {
    expect(parsePartSpecFilter({ minWattageW: "850", minMemorySpeedMhz: 6400, minM2Slots: "2", socket: " AM5 ", memoryType: " DDR5 ", interface: "NVMe" })).toEqual({
      filter: { minWattageW: 850, minMemorySpeedMhz: 6400, minM2Slots: 2, socket: "AM5", memoryType: "DDR5", interface: "NVMe" },
      errors: []
    });
    expect(parsePartSpecFilter({ minCapacityGb: "0", interface: "SAS", socket: 4 }).errors).toEqual([
      "최소 용량은 1 이상의 정수여야 합니다.",
      "소켓은 문자열이어야 합니다.",
      "연결 방식은 NVMe 또는 SATA여야 합니다."
    ]);
    expect(parsePartSpecFilter({ pcieSlotWidth: "2", minPcieSlotCount: "0" }).errors).toEqual([
      "최소 PCIe 슬롯 수은 1 이상의 정수여야 합니다.",
      "PCIe 슬롯 폭은 x1, x4, x8 또는 x16이어야 합니다."
    ]);
    expect(parsePartSpecFilter({ pcieSlotInfo: "missing" })).toEqual({ filter: { pcieSlotInfo: "missing" }, errors: [] });
    expect(parsePartSpecFilter({ pcieSlotInfo: "all" }).errors).toEqual(["PCIe 슬롯 정보 상태는 complete 또는 missing이어야 합니다."]);
  });

  it("separates missing facts from values that fail an active spec condition", () => {
    const diagnostics = partSpecFilterDiagnosticsFor([
      part({ category: "gpu", sourceProductCode: "short", specs: { lengthMm: 290 } }),
      part({ category: "gpu", sourceProductCode: "long", specs: { lengthMm: 360 } }),
      part({ category: "gpu", sourceProductCode: "unknown", specs: {} })
    ], { maxLengthMm: 300 });

    expect(diagnostics).toEqual([{ key: "maxLengthMm", label: "최대 GPU 길이", excludedCount: 2, missingCount: 1 }]);
  });

  it("reports complete and partial Cinebench coverage without counting invalid values", () => {
    const coverage = benchmarkCoverageForCatalog([
      part({ id: "cpu-single", sourceProductCode: "single", specs: { cinebenchR23Single: 2000 } }),
      part({ id: "cpu-multi", sourceProductCode: "multi", specs: { cinebenchR23Multi: 18000, benchmarkProvenance: { sourceKind: "independent_review", sourceNote: "리뷰 DB", updatedAt: "2026-08-30T00:00:00.000Z" } } }),
      part({ id: "cpu-complete", sourceProductCode: "complete", specs: { cinebenchR23Single: 2100, cinebenchR23Multi: 19000, benchmarkProvenance: { sourceKind: "official", sourceNote: "공식 표", updatedAt: "2026-08-30T00:00:00.000Z" } } }),
      part({ id: "cpu-invalid", sourceProductCode: "invalid", specs: { cinebenchR23Single: 0, cinebenchR23Multi: Number.NaN } }),
      part({ id: "gpu-ignored", sourceProductCode: "gpu", category: "gpu", specs: { vramGb: 16 } }),
      part({ id: "gpu-community", sourceProductCode: "gpu-community", category: "gpu", specs: { gpu3dmarkTimeSpyScore: 15000, benchmarkProvenance: { sourceKind: "community_measurement", sourceNote: "사용자 실측", updatedAt: "2026-08-30T00:00:00.000Z" } } }),
      part({ id: "gpu-other", sourceProductCode: "gpu-other", category: "gpu", specs: { gpu3dmarkPortRoyalScore: 8000, benchmarkProvenance: { sourceKind: "other", sourceNote: "기타 자료", updatedAt: "2026-08-30T00:00:00.000Z" } } })
    ]);

    expect(coverage).toEqual({
      cpu: {
        total: 4,
        cinebenchR23Single: 2,
        cinebenchR23Multi: 2,
        cinebenchR23Complete: 1
      },
      gpu: {
        total: 3,
        threeDMarkTimeSpy: 1,
        threeDMarkPortRoyal: 1,
        threeDMarkComplete: 0
      },
      sourceCoverage: {
        cpu: {
          benchmarked: 3,
          complete: 1,
          official: 1,
          independent_review: 1,
          community_measurement: 0,
          other: 0,
          unclassified: 1
        },
        gpu: {
          benchmarked: 2,
          complete: 0,
          official: 0,
          independent_review: 0,
          community_measurement: 1,
          other: 1,
          unclassified: 0
        }
      }
    });
  });
});
