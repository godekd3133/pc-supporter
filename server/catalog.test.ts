import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { benchmarkCoverageForCatalog, countParts, mergeCatalog, mergeDanawaSnapshot, parsePartSpecFilter, partSpecFilterDiagnosticsFor, searchParts } from "./catalog";

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
  });

  it("filters compatibility-critical socket, expansion, clearance, and depth facts", () => {
    const catalog = [
      part({ category: "motherboard", sourceProductCode: "board-good", name: "AM5 확장 보드", specs: { socket: "AM5", memoryType: "DDR5", formFactor: "mATX", memorySlots: 4, m2Slots: 3, sataPorts: 6 } }),
      part({ category: "motherboard", sourceProductCode: "board-small", name: "AM5 소형 보드", specs: { socket: "AM5", memoryType: "DDR4", formFactor: "mATX", memorySlots: 2, m2Slots: 1, sataPorts: 2 } }),
      part({ category: "case", sourceProductCode: "case-good", name: "긴 GPU 지원 케이스", specs: { motherboardFormFactors: ["mATX"], maxGpuLengthMm: 360, maxCoolerHeightMm: 165, maxPsuLengthMm: 200, hddBays: 4 } }),
      part({ category: "case", sourceProductCode: "case-small", name: "짧은 GPU 지원 케이스", specs: { motherboardFormFactors: ["mATX"], maxGpuLengthMm: 300, maxCoolerHeightMm: 155, maxPsuLengthMm: 180, hddBays: 2 } }),
      part({ category: "gpu", sourceProductCode: "gpu-short", name: "짧은 GPU", specs: { lengthMm: 290 } }),
      part({ category: "gpu", sourceProductCode: "gpu-long", name: "긴 GPU", specs: { lengthMm: 360 } }),
      part({ category: "cooler", sourceProductCode: "cooler-good", name: "고성능 AM5 쿨러", specs: { supportedSockets: ["AM5"], maxCoolingW: 220 } }),
      part({ category: "cooler", sourceProductCode: "cooler-small", name: "소형 쿨러", specs: { supportedSockets: ["AM4"], maxCoolingW: 120 } }),
      part({ category: "psu", sourceProductCode: "psu-short", name: "짧은 ATX 파워", specs: { psuFormFactor: "ATX", psuDepthMm: 150 } }),
      part({ category: "psu", sourceProductCode: "psu-long", name: "긴 ATX 파워", specs: { psuFormFactor: "ATX", psuDepthMm: 180 } })
    ];

    expect(parsePartSpecFilter({ socket: " AM5 ", formFactor: " mATX ", minMemorySlots: "4", minMaxGpuLengthMm: 330, maxLengthMm: "300", maxPsuDepthMm: 160 })).toEqual({
      filter: { socket: "AM5", formFactor: "mATX", minMemorySlots: 4, minMaxGpuLengthMm: 330, maxLengthMm: 300, maxPsuDepthMm: 160 },
      errors: []
    });
    expect(searchParts(catalog, "motherboard", undefined, 10, { specFilter: { socket: "am5", memoryType: "ddr5", formFactor: "MATX", minMemorySlots: 4, minM2Slots: 2, minSataPorts: 4 } }).map((item) => item.sourceProductCode)).toEqual(["board-good"]);
    expect(searchParts(catalog, "case", undefined, 10, { specFilter: { formFactor: "mATX", minMaxGpuLengthMm: 330, minMaxCoolerHeightMm: 160, minMaxPsuLengthMm: 190, minHddBays: 3 } }).map((item) => item.sourceProductCode)).toEqual(["case-good"]);
    expect(searchParts(catalog, "gpu", undefined, 10, { specFilter: { maxLengthMm: 300 } }).map((item) => item.sourceProductCode)).toEqual(["gpu-short"]);
    expect(searchParts(catalog, "cooler", undefined, 10, { specFilter: { socket: "AM5", minCoolingW: 180 } }).map((item) => item.sourceProductCode)).toEqual(["cooler-good"]);
    expect(searchParts(catalog, "psu", undefined, 10, { specFilter: { formFactor: "ATX", maxPsuDepthMm: 160 } }).map((item) => item.sourceProductCode)).toEqual(["psu-short"]);
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
