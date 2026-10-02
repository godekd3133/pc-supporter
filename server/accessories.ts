import type { AccessoryCategory, AccessoryCategoryCoverage, AccessoryCoverageSnapshot, AccessoryCrawlCategoryReport, AccessoryItem, AccessoryPriceFilter, AccessorySpecProfileCount, BrandCountOption, DataFreshness, DataQuality } from "../shared/types";
import { ACCESSORY_CATEGORIES, isKnownPrice } from "../shared/types";
import { mutateAccessoryCatalogRecords, mutateAccessoryCoverageRecord, patchAccessoryCatalogPriceRecords, readAccessoryCatalogRecords, readAccessoryCoverageRecord, readAccessoryVersionStamp } from "./repository";
import { parseM2FormFactors } from "./danawa";
import { classifyDataFreshness } from "./data-health";
import { applyCoolingFanLoadOverrides, readCoolingFanLoadOverrideSnapshot, readCoolingFanLoadOverrides, stripCoolingFanLoadOverride } from "./cooling-fan-load-overrides";
import { fanCurrentAFromText } from "../shared/fan-connectivity";
import { parseAdapterPcieSlotWidth, parseAdapterStorageDeviceCount } from "../shared/storage-adapter";
import { seedAccessories } from "./seed-accessories";
import { brandCountsFor } from "../shared/brand-counts";
import { accessorySpecProfileIdsFor, assessAccessorySpecProfile } from "./accessory-spec-coverage";

let accessoryCache: AccessoryItem[] | null = null;
let accessoryCacheStamp: string | null = null;
let accessoryMtime: string | null = null;
let coolingFanOverrideMtime: string | null = null;
let accessoryLoadInFlight: Promise<AccessoryItem[]> | null = null;
let accessoryStateRevision = 0;

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

async function loadBaseAccessoriesFromDatabase() {
  let snapshot = await readAccessoryCatalogRecords();
  if (snapshot.items.length === 0) {
    // The first API replica seeds PostgreSQL atomically. If another replica or
    // crawler writes first, retain that authoritative snapshot instead.
    snapshot = await mutateAccessoryCatalogRecords((current) => ({ items: current.length === 0 ? seedAccessories : current }));
  }
  const merged = mergeAccessories(seedAccessories, snapshot.items);
  return {
    items: reparseCoolingFanAccessories(reparseM2Accessories(merged)),
    updatedAt: snapshot.updatedAt
  };
}

async function loadAccessoriesUncoalesced() {
  const revisionAtReadStart = accessoryStateRevision;
  // DB가 진짜 소스다 — 전체 행 재구성은 요청마다 수 초를 쓰므로 건수+최신
  // updated_at 스탬프가 같으면 캐시를 그대로 돌려준다. 스탬프는 읽기 전에
  // 잡아서, 읽는 도중 다른 쓰기가 끼어들면 다음 요청이 다시 읽도록 한다.
  let stampBefore: string | null = null;
  try {
    stampBefore = await readAccessoryVersionStamp();
  } catch (error) {
    // DB 일시 실패에도 마지막 액세서리 목록으로 이어간다.
    if (accessoryCache) return accessoryCache;
    throw error;
  }
  if (accessoryCache && accessoryCacheStamp === stampBefore) return accessoryCache;
  const { items, updatedAt } = await loadBaseAccessoriesFromDatabase();
  const coolingFanOverrideSnapshot = await readCoolingFanLoadOverrideSnapshot();
  const runtimeItems = applyCoolingFanLoadOverrides(items, coolingFanOverrideSnapshot.overrides);
  // Never serve the process cache as the PostgreSQL catalog source. The
  // revision check only prevents an older in-flight read from replacing the
  // timestamp/runtime snapshot produced by a more recent local write.
  if (revisionAtReadStart === accessoryStateRevision) {
    accessoryCache = runtimeItems;
    accessoryCacheStamp = stampBefore;
    accessoryMtime = updatedAt;
    coolingFanOverrideMtime = coolingFanOverrideSnapshot.updatedAt;
  }
  return runtimeItems;
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

// 인스턴스 이벤트 버스가 다른 노드의 주변 부품 쓰기를 알릴 때 로컬 캐시를
// 비운다 — 다음 loadAccessories()가 스탬프와 함께 최신 상태를 다시 읽는다.
export function invalidateAccessoryCache() {
  accessoryLoadInFlight = null;
  accessoryCache = null;
  accessoryCacheStamp = null;
  accessoryStateRevision += 1;
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

export function accessorySpecProfileCountsFor(items: AccessoryItem[], category: AccessoryCategory): AccessorySpecProfileCount[] {
  const categoryItems = items.filter((item) => item.category === category);
  const assessments = categoryItems.flatMap(assessAccessorySpecProfile);
  return accessorySpecProfileIdsFor(category).map((profile) => {
    const profileAssessments = assessments.filter((assessment) => assessment.profile === profile);
    const complete = profileAssessments.filter((assessment) => assessment.status === "complete").length;
    const partial = profileAssessments.filter((assessment) => assessment.status === "partial").length;
    const notAssessed = profileAssessments.filter((assessment) => assessment.status === "not_assessed").length;
    return {
      profile,
      total: profileAssessments.length,
      assessed: complete + partial,
      complete,
      partial,
      notAssessed
    };
  });
}

function accessorySpecProfilesCompleteFor(items: AccessoryItem[], category: AccessoryCategory) {
  return accessorySpecProfileCountsFor(items, category).every((profile) => profile.total === 0
    || (profile.complete === profile.total && profile.partial === 0 && profile.notAssessed === 0));
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
  // seed 주변 부품은 실제 판매 상품이 아니라 범주 플레이스홀더다 — 다나와 매물이
  // 잡히는 범주에서는 카탈로그 표기에서 빼고, live가 전혀 없는 범주에서만
  // 채워넣기용으로 남긴다. quality=seed를 명시한 관리자 조회는 그대로 본다.
  const categoriesWithLive = new Set(items.filter((item) => item.source === "danawa").map((item) => item.category));
  const hidePlaceholderSeed = options.quality !== "seed";
  return items
    .filter((item) => !options.category || options.category === "all" || item.category === options.category)
    .filter((item) => !hidePlaceholderSeed || item.dataQuality !== "seed" || !categoriesWithLive.has(item.category))
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

export async function accessoryMeta(snapshotItems?: AccessoryItem[], snapshotUpdatedAt?: string) {
  const items = snapshotItems ?? await loadAccessories();
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
    accessoryUpdatedAt: snapshotUpdatedAt ?? currentAccessoryUpdatedAt()
  };
}

export function currentAccessoryUpdatedAt() {
  return [accessoryMtime, coolingFanOverrideMtime]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? "";
}

export function accessoryCoverageSnapshotFor(stored: AccessoryCoverageSnapshot, items: AccessoryItem[]): AccessoryCoverageSnapshot {
  const savedByCategory = new Map(stored.categories.map((coverage) => [coverage.category, coverage]));
  return {
    ...stored,
    categories: ACCESSORY_CATEGORIES.map((category) => {
      const categoryItems = items.filter((item) => item.category === category);
      const coverage = savedByCategory.get(category);
      const specProfileCounts = accessorySpecProfileCountsFor(categoryItems, category);
      const storedSpecCoverage: AccessoryCategoryCoverage["storedSpecCoverage"] = accessorySpecProfilesCompleteFor(categoryItems, category) ? "complete" : "partial";
      const currentCatalogStatus = {
        storedProductCount: categoryItems.length,
        liveProducts: categoryItems.filter((item) => item.dataQuality === "live").length,
        incompleteProducts: categoryItems.filter((item) => item.dataQuality === "incomplete").length,
        pricedProducts: categoryItems.filter((item) => isKnownPrice(item.priceWon)).length,
        incompleteSpecs: categoryItems.filter((item) => item.missingFields.length > 0).length,
        storedSpecCoverage,
        specProfileCounts
      };
      if (!coverage || coverage.evidenceSource !== "danawa-public-crawl") {
        return {
          category,
          categoryId: "crawl-history-unavailable",
          ...currentCatalogStatus,
          pagesExpected: 0,
          pagesVisited: 0,
          listedProducts: 0,
          uniqueProducts: 0,
          detailFetched: 0,
          detailFailed: 0,
          missingProducts: 0,
          listCoverage: "partial" as const,
          coverage: "partial" as const,
          specCoverage: storedSpecCoverage,
          mode: "sample" as const,
          details: false,
          onlyIncomplete: false,
          lastCrawledAt: "",
          hasCrawlHistory: false
        };
      }
      const hasCrawlHistory = Boolean(coverage.lastCrawledAt || coverage.lastRun);
      return {
        ...coverage,
        ...currentCatalogStatus,
        coverage: coverage.listCoverage === "complete" && storedSpecCoverage === "complete" ? "complete" : "partial",
        specCoverage: storedSpecCoverage,
        hasCrawlHistory,
        listCoverage: coverage.listCoverage ?? (coverage.missingProducts === 0 && coverage.pagesVisited >= coverage.pagesExpected ? "complete" : "partial"),
        onlyIncomplete: coverage.onlyIncomplete ?? false,
        lastRun: coverage.lastRun
          ? { ...coverage.lastRun, onlyIncomplete: coverage.lastRun.onlyIncomplete ?? false }
          : undefined
      };
    })
  };
}

export async function readAccessoryCoverage(snapshotItems?: AccessoryItem[]): Promise<AccessoryCoverageSnapshot> {
  const [stored, items] = await Promise.all([
    readAccessoryCoverageRecord(),
    snapshotItems ? Promise.resolve(snapshotItems) : loadAccessories()
  ]);
  return accessoryCoverageSnapshotFor(stored, items);
}

function accessoryCoverageAfterReports(
  current: AccessoryCoverageSnapshot,
  items: AccessoryItem[],
  reports: AccessoryCrawlCategoryReport[],
  context: { mode: "sample" | "all"; details: boolean; onlyIncomplete: boolean; lastCrawledAt: string }
) {
  const byCategory = new Map(current.categories.map((coverage) => [coverage.category, coverage]));
  for (const report of reports) {
    const categoryItems = items.filter((item) => item.category === report.category);
    const previous = byCategory.get(report.category);
    const listEvidence = accessoryListEvidenceFor(previous, report, context);
    const storedSpecCoverage = accessorySpecProfilesCompleteFor(categoryItems, report.category) ? "complete" : "partial";
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
      evidenceSource: "danawa-public-crawl",
      storedSpecCoverage,
      specProfileCounts: accessorySpecProfileCountsFor(categoryItems, report.category),
      coverage: listEvidence.listCoverage === "complete" && storedSpecCoverage === "complete" ? "complete" : "partial",
      specCoverage: storedSpecCoverage,
      lastCrawledAt: context.lastCrawledAt,
      hasCrawlHistory: true,
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
  return {
    updatedAt: context.lastCrawledAt,
    categories: ACCESSORY_CATEGORIES
      .map((category) => byCategory.get(category))
      .filter((coverage): coverage is AccessoryCategoryCoverage => Boolean(coverage))
  } satisfies AccessoryCoverageSnapshot;
}

export async function recordAccessoryCoverage(
  reports: AccessoryCrawlCategoryReport[],
  context: { mode: "sample" | "all"; details: boolean; onlyIncomplete: boolean; lastCrawledAt: string }
) {
  const items = await loadAccessories();
  return mutateAccessoryCoverageRecord((stored) => {
    const current = accessoryCoverageSnapshotFor(stored, items);
    return accessoryCoverageAfterReports(current, items, reports, context);
  });
}

export function accessoryListEvidenceFor(
  previous: AccessoryCategoryCoverage | undefined,
  report: AccessoryCrawlCategoryReport,
  context: { mode: "sample" | "all"; onlyIncomplete: boolean }
) {
  const current = {
    totalProductCount: report.totalProductCount,
    pagesExpected: report.pagesExpected,
    pagesVisited: report.pagesVisited,
    listedProducts: report.listedProducts,
    uniqueProducts: report.uniqueProducts,
    missingProducts: report.missingProducts,
    listCoverage: report.listCoverage
  };
  if (!previous?.hasCrawlHistory || previous.evidenceSource !== "danawa-public-crawl" || previous.categoryId !== report.categoryId || context.mode === "all" || report.listCoverage === "complete") {
    return current;
  }

  const prior = {
    totalProductCount: previous.totalProductCount,
    pagesExpected: previous.pagesExpected,
    pagesVisited: previous.pagesVisited,
    listedProducts: previous.listedProducts,
    uniqueProducts: previous.uniqueProducts,
    missingProducts: previous.missingProducts,
    listCoverage: previous.listCoverage
  };
  if (context.onlyIncomplete) {
    return {
      ...prior,
      totalProductCount: report.totalProductCount ?? prior.totalProductCount,
      pagesExpected: report.pagesExpected || prior.pagesExpected
    };
  }
  const sourceCountChanged = report.totalProductCount !== undefined && report.totalProductCount !== previous.totalProductCount;
  const observedMoreRows = report.pagesVisited > previous.pagesVisited
    || report.listedProducts > previous.listedProducts
    || report.uniqueProducts > previous.uniqueProducts;
  return sourceCountChanged || observedMoreRows ? current : prior;
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

export async function upsertAccessories(
  items: AccessoryItem[],
  options: { replaceDanawaCategories?: AccessoryCategory[] } = {}
) {
  accessoryLoadInFlight = null;
  const incoming = items.map(stripCoolingFanLoadOverride);
  const snapshot = await mutateAccessoryCatalogRecords((persisted) => {
    const current = reparseCoolingFanAccessories(reparseM2Accessories(mergeAccessories(seedAccessories, persisted)));
    const replaceDanawaCategories = options.replaceDanawaCategories ?? [];
    const merged = replaceDanawaCategories.length > 0
      ? mergeDanawaAccessorySnapshot(current, incoming, replaceDanawaCategories)
      : mergeAccessories(current, incoming);
    const incomingKeys = new Set(incoming.map(accessoryKey));
    const replacementCategorySet = new Set(replaceDanawaCategories);
    const writeItems = persisted.length === 0
      ? merged
      : merged.filter((item) => incomingKeys.has(accessoryKey(item)) || replacementCategorySet.has(item.category));
    return { items: merged, writeItems, replaceDanawaCategories };
  });
  const baseAccessories = reparseCoolingFanAccessories(reparseM2Accessories(snapshot.items));
  const coolingFanOverrideSnapshot = await readCoolingFanLoadOverrideSnapshot();
  accessoryStateRevision += 1;
  accessoryCache = applyCoolingFanLoadOverrides(baseAccessories, coolingFanOverrideSnapshot.overrides);
  accessoryCacheStamp = null;
  accessoryMtime = snapshot.updatedAt;
  coolingFanOverrideMtime = coolingFanOverrideSnapshot.updatedAt;
  return snapshot.items;
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
  const result = await patchAccessoryCatalogPriceRecords(patches);
  const coolingFanOverrideSnapshot = await readCoolingFanLoadOverrideSnapshot();
  accessoryStateRevision += 1;
  accessoryLoadInFlight = null;
  accessoryCache = null;
  accessoryCacheStamp = null;
  accessoryMtime = result.updatedAt;
  coolingFanOverrideMtime = coolingFanOverrideSnapshot.updatedAt;
  return result.updates;
}
