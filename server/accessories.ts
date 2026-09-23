import type { AccessoryCategory, AccessoryCategoryCoverage, AccessoryCoverageSnapshot, AccessoryCrawlCategoryReport, AccessoryItem, AccessoryPriceFilter, BrandCountOption, DataFreshness, DataQuality } from "../shared/types";
import { ACCESSORY_CATEGORIES, isKnownPrice } from "../shared/types";
import { ACCESSORIES_PATH, ACCESSORY_COVERAGE_PATH, COOLING_FAN_LOAD_OVERRIDES_PATH, fileUpdatedAt, readJson, writeJson, withSerializedFileMutation } from "./storage";
import { parseM2FormFactors } from "./danawa";
import { classifyDataFreshness } from "./data-health";
import { applyCoolingFanLoadOverrides, readCoolingFanLoadOverrides, stripCoolingFanLoadOverride } from "./cooling-fan-load-overrides";
import { fanCurrentAFromText } from "../shared/fan-connectivity";
import { parseAdapterPcieSlotWidth, parseAdapterStorageDeviceCount } from "../shared/storage-adapter";
import { seedAccessories } from "./seed-accessories";
import { brandCountsFor } from "../shared/brand-counts";

let accessoryCache: AccessoryItem[] | null = null;
let accessoryMtime: string | null = null;
let coolingFanOverrideMtime: string | null = null;
let accessoryLoadInFlight: Promise<AccessoryItem[]> | null = null;
let baseAccessoriesCache: { mtime: string; value: AccessoryItem[] } | null = null;

function reparseM2Accessories(items: AccessoryItem[]) {
  return items.map((item) => {
    if (item.category !== "storage_accessory" && item.category !== "m2_heatsink") return item;
    const formFactors = parseM2FormFactors(`${item.name} ${item.rawSpecText ?? ""}`);
    const adapterStorageDeviceCount = item.category === "storage_accessory"
      ? parseAdapterStorageDeviceCount(`${item.name} ${item.rawSpecText ?? ""}`)
      : undefined;
    const adapterPcieSlotWidth = item.category === "storage_accessory"
      ? parseAdapterPcieSlotWidth(`${item.name} ${item.rawSpecText ?? ""}`)
      : undefined;
    const hasStoredAdapterEvidence = item.category === "storage_accessory"
      && (item.specs.adapterStorageDeviceCount !== undefined || item.specs.adapterPcieSlotWidth !== undefined);
    if (formFactors.length === 0 && adapterStorageDeviceCount === undefined && adapterPcieSlotWidth === undefined && !hasStoredAdapterEvidence) return item;
    const specs = { ...item.specs };
    if (item.category === "storage_accessory") {
      if (adapterStorageDeviceCount !== undefined) specs.adapterStorageDeviceCount = adapterStorageDeviceCount;
      else delete specs.adapterStorageDeviceCount;
      if (adapterPcieSlotWidth !== undefined) specs.adapterPcieSlotWidth = adapterPcieSlotWidth;
      else delete specs.adapterPcieSlotWidth;
    }
    return {
      ...item,
      specs: {
        ...specs,
        ...(formFactors.length > 0 ? { formFactor: formFactors[0], supportedFormFactors: formFactors } : {})
      }
    };
  });
}

function reparseCoolingFanAccessories(items: AccessoryItem[]) {
  return items.map((item) => {
    if (item.category !== "cooling_fan" || item.specs.fanCurrentA !== undefined) return item;
    const fanCurrentA = fanCurrentAFromText(`${item.name} ${item.rawSpecText ?? ""}`);
    return fanCurrentA === undefined ? item : { ...item, specs: { ...item.specs, fanCurrentA } };
  });
}

async function loadBaseAccessoriesFromDisk() {
  const persisted = await readJson<AccessoryItem[]>(ACCESSORIES_PATH, []);
  const merged = mergeAccessories(seedAccessories, persisted);
  if (persisted.length === 0) await writeJson(ACCESSORIES_PATH, merged);
  return reparseCoolingFanAccessories(reparseM2Accessories(merged));
}

async function loadAccessoriesUncoalesced() {
  const persistedMtime = await fileUpdatedAt(ACCESSORIES_PATH, "");
  const persistedCoolingFanOverrideMtime = await fileUpdatedAt(COOLING_FAN_LOAD_OVERRIDES_PATH, "");
  if (accessoryCache && accessoryMtime === persistedMtime && coolingFanOverrideMtime === persistedCoolingFanOverrideMtime) return accessoryCache;
  let baseAccessories = baseAccessoriesCache?.mtime === persistedMtime ? baseAccessoriesCache.value : undefined;
  if (!baseAccessories) baseAccessories = await loadBaseAccessoriesFromDisk();
  const effectiveAccessoryMtime = await fileUpdatedAt(ACCESSORIES_PATH, persistedMtime);
  baseAccessoriesCache = { mtime: effectiveAccessoryMtime, value: baseAccessories };
  accessoryCache = applyCoolingFanLoadOverrides(baseAccessories, await readCoolingFanLoadOverrides());
  accessoryMtime = effectiveAccessoryMtime;
  coolingFanOverrideMtime = persistedCoolingFanOverrideMtime;
  return accessoryCache;
}

export async function loadAccessories() {
  if (accessoryLoadInFlight) return accessoryLoadInFlight;
  const promise = loadAccessoriesUncoalesced();
  accessoryLoadInFlight = promise;
  try {
    return await promise;
  } finally {
    if (accessoryLoadInFlight === promise) accessoryLoadInFlight = null;
  }
}

export function findAccessory(items: AccessoryItem[], id: string) {
  return items.find((item) => item.id === id);
}

const DATA_QUALITY_VALUES: DataQuality[] = ["seed", "live", "manual", "incomplete"];

export function accessoryCategoryQualityCountsFor(items: AccessoryItem[]) {
  return Object.fromEntries(
    ACCESSORY_CATEGORIES.map((category) => [
      category,
      Object.fromEntries(DATA_QUALITY_VALUES.map((quality) => [quality, items.filter((item) => item.category === category && item.dataQuality === quality).length])) as Record<DataQuality, number>
    ])
  ) as Record<AccessoryCategory, Record<DataQuality, number>>;
}

type AccessorySearchOptions = {
  category?: AccessoryCategory | "all";
  brand?: string;
  quality?: DataQuality | "all";
  freshness?: DataFreshness | "all";
  now?: string | number;
  sort?: "price_asc" | "price_desc" | "name" | "updated";
  priceFilter?: AccessoryPriceFilter;
};

function isPriceInFilter(item: AccessoryItem, priceFilter: AccessoryPriceFilter | undefined) {
  if (!priceFilter || priceFilter === "all") return true;
  if (!isKnownPrice(item.priceWon)) return false;
  if (priceFilter === "priced") return true;
  if (priceFilter === "under_10000") return item.priceWon <= 10_000;
  if (priceFilter === "10000_50000") return item.priceWon > 10_000 && item.priceWon <= 50_000;
  return item.priceWon > 50_000;
}

function filterAccessories(items: AccessoryItem[], query: string | undefined, options: AccessorySearchOptions = {}) {
  const normalizedQuery = query?.trim().toLocaleLowerCase("ko-KR") ?? "";
  const normalizedBrand = options.brand?.trim().toLocaleLowerCase("ko-KR") ?? "";
  return items
    .filter((item) => !options.category || options.category === "all" || item.category === options.category)
    .filter((item) => !normalizedBrand || (item.brand ?? "").toLocaleLowerCase("ko-KR").includes(normalizedBrand))
    .filter((item) => !options.quality || options.quality === "all" || item.dataQuality === options.quality)
    .filter((item) => !options.freshness || options.freshness === "all" || classifyDataFreshness(item.updatedAt, options.now) === options.freshness)
    .filter((item) => isPriceInFilter(item, options.priceFilter))
    .filter((item) => {
      if (!normalizedQuery) return true;
      return [item.name, item.brand, item.model, item.rawSpecText]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ko-KR")
        .includes(normalizedQuery);
    });
}

function sortAccessories(items: AccessoryItem[], sort: AccessorySearchOptions["sort"]) {
  return items.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "ko-KR");
    if (sort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
    if (sort === "price_desc") {
      if (!isKnownPrice(a.priceWon) && !isKnownPrice(b.priceWon)) return 0;
      if (!isKnownPrice(a.priceWon)) return 1;
      if (!isKnownPrice(b.priceWon)) return -1;
      return b.priceWon - a.priceWon;
    }
    if (!isKnownPrice(a.priceWon) && !isKnownPrice(b.priceWon)) return 0;
    if (!isKnownPrice(a.priceWon)) return 1;
    if (!isKnownPrice(b.priceWon)) return -1;
    return a.priceWon - b.priceWon;
  });
}

export function searchAccessories(items: AccessoryItem[], query: string | undefined, limit = 40, options: AccessorySearchOptions = {}, offset = 0) {
  return sortAccessories(filterAccessories(items, query, options), options.sort).slice(Math.max(0, offset), Math.max(0, offset) + limit);
}

export function countAccessories(items: AccessoryItem[], query: string | undefined, options: AccessorySearchOptions = {}) {
  return filterAccessories(items, query, options).length;
}

export async function accessoryMeta() {
  const items = await loadAccessories();
  const itemsByCategory = new Map(ACCESSORY_CATEGORIES.map((category) => [category, [] as AccessoryItem[]]));
  const accessoryCategoryQualityCounts = Object.fromEntries(
    ACCESSORY_CATEGORIES.map((category) => [category, Object.fromEntries(DATA_QUALITY_VALUES.map((quality) => [quality, 0])) as Record<DataQuality, number>])
  ) as Record<AccessoryCategory, Record<DataQuality, number>>;
  const accessoryQualityCounts = Object.fromEntries(DATA_QUALITY_VALUES.map((quality) => [quality, 0])) as Record<DataQuality, number>;
  let priced = 0;
  for (const item of items) {
    const knownQuality = DATA_QUALITY_VALUES.includes(item.dataQuality);
    if (knownQuality) accessoryQualityCounts[item.dataQuality] += 1;
    if (isKnownPrice(item.priceWon)) priced += 1;
    const categoryItems = itemsByCategory.get(item.category);
    if (!categoryItems) continue;
    categoryItems.push(item);
    if (knownQuality) accessoryCategoryQualityCounts[item.category][item.dataQuality] += 1;
  }
  const accessoryBrandCounts = Object.fromEntries(ACCESSORY_CATEGORIES.map((category) => [category, brandCountsFor(itemsByCategory.get(category) ?? [])])) as Partial<Record<AccessoryCategory, BrandCountOption[]>>;
  return {
    accessoryCount: items.length,
    accessoryCategoryCounts: Object.fromEntries(ACCESSORY_CATEGORIES.map((category) => [category, itemsByCategory.get(category)?.length ?? 0])) as Record<AccessoryCategory, number>,
    accessoryBrandCounts,
    accessoryCategoryQualityCounts,
    accessoryQualityCounts,
    accessoryPriceCoverage: {
      priced,
      unpriced: items.length - priced
    },
    accessoryUpdatedAt: currentAccessoryUpdatedAt()
  };
}

export function currentAccessoryUpdatedAt() {
  return [accessoryMtime, coolingFanOverrideMtime]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? "";
}

export async function readAccessoryCoverage(): Promise<AccessoryCoverageSnapshot> {
  const stored = await readJson<AccessoryCoverageSnapshot>(ACCESSORY_COVERAGE_PATH, { updatedAt: "", categories: [] });
  const items = await loadAccessories();
  return {
    ...stored,
    categories: stored.categories.map((coverage) => {
      const categoryItems = items.filter((item) => item.category === coverage.category);
      return {
        ...coverage,
        listCoverage: coverage.listCoverage ?? (coverage.missingProducts === 0 && coverage.pagesVisited >= coverage.pagesExpected ? "complete" : "partial"),
        storedSpecCoverage: coverage.storedSpecCoverage ?? (categoryItems.every((item) => item.missingFields.length === 0) ? "complete" : "partial"),
        onlyIncomplete: coverage.onlyIncomplete ?? false,
        lastRun: coverage.lastRun
          ? { ...coverage.lastRun, onlyIncomplete: coverage.lastRun.onlyIncomplete ?? false }
          : undefined
      };
    })
  };
}

export async function recordAccessoryCoverage(
  reports: AccessoryCrawlCategoryReport[],
  context: { mode: "sample" | "all"; details: boolean; onlyIncomplete: boolean; lastCrawledAt: string }
) {
  const current = await readAccessoryCoverage();
  const items = await loadAccessories();
  const byCategory = new Map(current.categories.map((coverage) => [coverage.category, coverage]));
  for (const report of reports) {
    const categoryItems = items.filter((item) => item.category === report.category);
    const previous = byCategory.get(report.category);
    const listEvidence = context.mode === "sample" && previous
      ? {
          totalProductCount: previous.totalProductCount,
          pagesExpected: previous.pagesExpected,
          pagesVisited: previous.pagesVisited,
          listedProducts: previous.listedProducts,
          uniqueProducts: previous.uniqueProducts,
          missingProducts: previous.missingProducts,
          listCoverage: previous.listCoverage
        }
      : {
          totalProductCount: report.totalProductCount,
          pagesExpected: report.pagesExpected,
          pagesVisited: report.pagesVisited,
          listedProducts: report.listedProducts,
          uniqueProducts: report.uniqueProducts,
          missingProducts: report.missingProducts,
          listCoverage: report.listCoverage
        };
    const storedSpecCoverage = categoryItems.every((item) => item.missingFields.length === 0) ? "complete" : "partial";
    const coverage: AccessoryCategoryCoverage = {
      ...report,
      ...listEvidence,
      storedProductCount: categoryItems.length,
      liveProducts: categoryItems.filter((item) => item.dataQuality === "live").length,
      incompleteProducts: categoryItems.filter((item) => item.dataQuality === "incomplete").length,
      pricedProducts: categoryItems.filter((item) => isKnownPrice(item.priceWon)).length,
      mode: context.mode,
      details: context.details,
      onlyIncomplete: context.onlyIncomplete,
      storedSpecCoverage,
      coverage: listEvidence.listCoverage === "complete" && storedSpecCoverage === "complete" ? "complete" : "partial",
      specCoverage: storedSpecCoverage,
      lastCrawledAt: context.lastCrawledAt,
      lastRun: {
        mode: context.mode,
        details: context.details,
        onlyIncomplete: context.onlyIncomplete,
        offset: report.offset,
        requestedLimit: report.requestedLimit,
        pagesExpected: report.pagesExpected,
        pagesVisited: report.pagesVisited,
        listedProducts: report.listedProducts,
        uniqueProducts: report.uniqueProducts,
        detailFetched: report.detailFetched,
        detailFailed: report.detailFailed,
        missingProducts: report.missingProducts,
        incompleteSpecs: report.incompleteSpecs,
        listCoverage: report.listCoverage,
        coverage: report.coverage,
        specCoverage: report.specCoverage,
        completedAt: context.lastCrawledAt
      }
    };
    byCategory.set(report.category, coverage);
  }
  const snapshot: AccessoryCoverageSnapshot = {
    updatedAt: context.lastCrawledAt,
    categories: ACCESSORY_CATEGORIES
      .map((category) => byCategory.get(category))
      .filter((coverage): coverage is AccessoryCategoryCoverage => Boolean(coverage))
  };
  await writeJson(ACCESSORY_COVERAGE_PATH, snapshot);
  return snapshot;
}

function accessoryKey(item: AccessoryItem) {
  return item.sourceProductCode ? `danawa:${item.sourceProductCode}` : `id:${item.id}`;
}

function dataQualityRank(item: AccessoryItem) {
  if (item.dataQuality === "manual") return 3;
  if (item.dataQuality === "live") return 2;
  if (item.dataQuality === "seed") return 1;
  return 0;
}

export function mergeAccessories(base: AccessoryItem[], incoming: AccessoryItem[]) {
  const merged = new Map<string, AccessoryItem>();
  for (const item of base) merged.set(accessoryKey(item), item);
  for (const item of incoming) {
    const key = accessoryKey(item);
    const existing = merged.get(key);
    if (!existing || dataQualityRank(item) >= dataQualityRank(existing)) {
      merged.set(key, existing ? {
        ...existing,
        ...item,
        imageUrl: item.imageUrl ?? existing.imageUrl,
        priceWon: isKnownPrice(item.priceWon) ? item.priceWon : isKnownPrice(existing.priceWon) ? existing.priceWon : undefined,
        rawSpecText: item.rawSpecText || existing.rawSpecText,
        specs: { ...existing.specs, ...item.specs }
      } : item);
    }
  }
  return [...merged.values()];
}

export function mergeDanawaAccessorySnapshot(base: AccessoryItem[], incoming: AccessoryItem[], categories: AccessoryCategory[]) {
  const categorySet = new Set(categories);
  const retained = base.filter((item) => !(item.source === "danawa" && categorySet.has(item.category)));
  return mergeAccessories(retained, incoming);
}

async function upsertAccessoriesUnlocked(
  items: AccessoryItem[],
  options: { replaceDanawaCategories?: AccessoryCategory[] } = {}
) {
  accessoryLoadInFlight = null;
  // 크롤러 저장은 override가 적용된 런타임 목록이 아니라 원본 파일을
  // 기준으로 병합해야 구조화된 원문 전류가 유실되지 않는다.
  const current = await loadBaseAccessoriesFromDisk();
  const incoming = items.map(stripCoolingFanLoadOverride);
  const replaceDanawaCategories = options.replaceDanawaCategories ?? [];
  const merged = replaceDanawaCategories.length > 0
    ? mergeDanawaAccessorySnapshot(current, incoming, replaceDanawaCategories)
    : mergeAccessories(current, incoming);
  await writeJson(ACCESSORIES_PATH, merged);
  const baseAccessories = reparseCoolingFanAccessories(reparseM2Accessories(merged));
  baseAccessoriesCache = { mtime: await fileUpdatedAt(ACCESSORIES_PATH, ""), value: baseAccessories };
  accessoryCache = applyCoolingFanLoadOverrides(baseAccessories, await readCoolingFanLoadOverrides());
  accessoryMtime = await fileUpdatedAt(ACCESSORIES_PATH, "");
  coolingFanOverrideMtime = await fileUpdatedAt(COOLING_FAN_LOAD_OVERRIDES_PATH, "");
  return merged;
}

export async function upsertAccessories(
  items: AccessoryItem[],
  options: { replaceDanawaCategories?: AccessoryCategory[] } = {}
) {
  return withSerializedFileMutation(ACCESSORIES_PATH, () => upsertAccessoriesUnlocked(items, options));
}

export interface AccessoryPricePatch {
  id: string;
  sourceProductCode: string;
  danawaUrl: string;
  priceWon: number;
  priceCheckedAt: string;
}

export async function patchAccessoryPrices(patches: AccessoryPricePatch[]) {
  if (patches.length === 0) return [];
  return withSerializedFileMutation(ACCESSORIES_PATH, async () => {
    const current = await loadBaseAccessoriesFromDisk();
    const beforeById = new Map<string, AccessoryItem>();
    const afterItems: AccessoryItem[] = [];
    for (const patch of patches) {
      const before = current.find((item) => item.id === patch.id);
      if (!before || before.source !== "danawa" || before.sourceProductCode !== patch.sourceProductCode || before.danawaUrl !== patch.danawaUrl) continue;
      const after = { ...before, priceWon: patch.priceWon, priceCheckedAt: patch.priceCheckedAt };
      beforeById.set(patch.id, before);
      afterItems.push(after);
    }
    if (afterItems.length === 0) return [];
    await upsertAccessoriesUnlocked(afterItems);
    return afterItems.flatMap((after) => {
      const before = beforeById.get(after.id);
      return before ? [{ before, after }] : [];
    });
  });
}
