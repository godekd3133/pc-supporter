import { ACCESSORIES_PATH, ACCESSORY_COVERAGE_PATH, CATALOG_PATH, writeJson } from "../server/storage";
import { starterCatalog } from "../server/seed-catalog-starter";
import type { AccessoryCoverageSnapshot, AccessoryItem, Part } from "../shared/types";

if (process.env.PC_SUPPORTER_BROWSER_SMOKE_FIXTURE !== "1") {
  throw new Error("PC_SUPPORTER_BROWSER_SMOKE_FIXTURE=1 is required; refusing to modify a normal data directory.");
}

const updatedAt = "2026-09-12T00:00:00.000Z";

const incompleteCases: Part[] = Array.from({ length: 16 }, (_, index) => ({
  id: `browser-smoke-incomplete-case-${index + 1}`,
  category: "case",
  name: `브라우저 smoke 누락 케이스 ${index + 1}`,
  brand: "PC Supporter",
  model: `BROWSER-SMOKE-CASE-${index + 1}`,
  source: "manual",
  listingType: "retail",
  dataQuality: "incomplete",
  missingFields: ["maxGpuLengthMm"],
  updatedAt,
  specs: {}
}));

const categoryMismatchBoards: Part[] = ["A", "B", "C"].map((suffix) => ({
  id: `browser-smoke-raspberry-pi-${suffix.toLowerCase()}`,
  category: "motherboard",
  name: `Raspberry Pi browser smoke board ${suffix}`,
  brand: "browser-smoke",
  model: `RPI-SMOKE-${suffix}`,
  source: "manual",
  listingType: "retail",
  dataQuality: "manual",
  missingFields: [],
  updatedAt,
  rawSpecText: "single-board computer fixture for category integrity review",
  specs: {}
}));

const pcieSlotMotherboard: Part = {
  id: "browser-smoke-pcie-slot-motherboard",
  category: "motherboard",
  name: "브라우저 smoke PCIe 슬롯 메인보드",
  brand: "browser-smoke",
  model: "BROWSER-SMOKE-MB-PCIE",
  source: "manual",
  listingType: "retail",
  dataQuality: "manual",
  missingFields: [],
  updatedAt,
  priceWon: 189000,
  specs: {
    socket: "AM5",
    memoryType: "DDR5",
    formFactor: "ATX",
    maxMemoryGb: 128,
    memorySlots: 4,
    m2Slots: 2,
    m2Interfaces: ["NVMe"],
    m2PcieGenerations: [4],
    sataPorts: 4,
    pcieX16Slots: 1,
    pcieX8Slots: 1,
    pcieX4Slots: 2,
    pcieX1Slots: 2
  }
};

const unknownPriceMotherboard: Part = {
  id: "browser-smoke-unknown-price-motherboard",
  category: "motherboard",
  name: "브라우저 smoke 가격 미확인 메인보드",
  brand: "PC Supporter",
  model: "BROWSER-SMOKE-MB-UNKNOWN-PRICE",
  source: "manual",
  listingType: "retail",
  dataQuality: "incomplete",
  missingFields: ["maxMemoryGb", "memorySlots", "m2Slots", "sataPorts"],
  updatedAt,
  specs: {}
};

const extraBenchmarkQueueGpus: Part[] = Array.from({ length: 34 }, (_, index) => ({
  id: `browser-smoke-benchmark-queue-gpu-${index + 1}`,
  category: "gpu",
  name: `브라우저 smoke benchmark queue GPU ${index + 1}`,
  brand: "PC Supporter",
  model: `BROWSER-SMOKE-GPU-${index + 1}`,
  source: "danawa",
  sourceProductCode: `browser-smoke-gpu-${index + 1}`,
  danawaUrl: `https://example.com/browser-smoke-gpu-${index + 1}`,
  listingType: "retail",
  dataQuality: "incomplete",
  missingFields: ["powerW"],
  updatedAt,
  priceWon: 199000 + index * 1000,
  specs: {}
}));

const asusCoolingFan: AccessoryItem = {
  id: "browser-smoke-asus-cooling-fan",
  category: "cooling_fan",
  name: "ASUS 120mm browser smoke PWM 팬",
  brand: "ASUS",
  model: "BROWSER-SMOKE-FAN-ASUS",
  source: "manual",
  listingType: "accessory",
  dataQuality: "manual",
  missingFields: [],
  updatedAt,
  priceWon: 14900,
  rawSpecText: "120mm · 4핀 PWM · 팬 전류 0.18A · 비RGB",
  specs: { lengthMm: 120, widthMm: 120, fanCount: 1, fanCurrentA: 0.18 }
};

const accessoryCoverage: AccessoryCoverageSnapshot = {
  updatedAt,
  categories: [{
    category: "cooling_fan",
    categoryId: "browser-smoke-cooling-fan",
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
    lastCrawledAt: updatedAt
  }]
};

await writeJson(CATALOG_PATH, [...incompleteCases, ...categoryMismatchBoards, pcieSlotMotherboard, unknownPriceMotherboard, ...extraBenchmarkQueueGpus]);
await writeJson(ACCESSORY_COVERAGE_PATH, accessoryCoverage);
await writeJson(ACCESSORIES_PATH, [asusCoolingFan]);

console.log(JSON.stringify({
  ok: true,
  starterCatalogCount: starterCatalog.length,
  persistedCatalogFixtureCount: incompleteCases.length + categoryMismatchBoards.length + 2 + extraBenchmarkQueueGpus.length,
  incompleteCaseCount: incompleteCases.length,
  categoryMismatchCount: categoryMismatchBoards.length,
  accessoryCoverageCategories: accessoryCoverage.categories.length
}, null, 2));
