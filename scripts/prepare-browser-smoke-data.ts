import { ACCESSORY_COVERAGE_PATH, CATALOG_PATH, writeJson } from "../server/storage";
import { starterCatalog } from "../server/seed-catalog-starter";
import type { AccessoryCoverageSnapshot, Part } from "../shared/types";

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

const accessoryCoverage: AccessoryCoverageSnapshot = {
  updatedAt,
  categories: [{
    category: "cooling_fan",
    categoryId: "browser-smoke-cooling-fan",
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

await writeJson(CATALOG_PATH, [...incompleteCases, ...categoryMismatchBoards, unknownPriceMotherboard, ...extraBenchmarkQueueGpus]);
await writeJson(ACCESSORY_COVERAGE_PATH, accessoryCoverage);

console.log(JSON.stringify({
  ok: true,
  starterCatalogCount: starterCatalog.length,
  persistedCatalogFixtureCount: incompleteCases.length + categoryMismatchBoards.length + 1 + extraBenchmarkQueueGpus.length,
  incompleteCaseCount: incompleteCases.length,
  categoryMismatchCount: categoryMismatchBoards.length,
  accessoryCoverageCategories: accessoryCoverage.categories.length
}, null, 2));
