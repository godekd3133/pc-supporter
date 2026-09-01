import "dotenv/config";
import * as cheerio from "cheerio";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { AccessoryCategory, AccessoryCrawlCategoryReport, AccessoryCrawlManifest, AccessoryCrawlStatus, AccessoryItem, PartSpecs } from "../shared/types";
import { ACCESSORY_CATEGORY_LABELS } from "../shared/types";
import {
  buildDanawaListAjaxParams,
  fetchDanawaHtml,
  parseDanawaListPage,
  parseDanawaListPageInfo,
  parseDanawaListRequestContext,
  parseM2FormFactors,
  isAllowedSourceUrl,
  type DanawaCrawlerOptions,
  type DanawaListItem,
  type DanawaListRequestContext
} from "./danawa";
import { loadAccessories, recordAccessoryCoverage, upsertAccessories } from "./accessories";
import { fanCurrentAFromText } from "../shared/fan-connectivity";
import { appendCatalogChangeRecords, catalogChangeRecord, catalogChangeSummary, catalogItemKey, meaningfulCatalogChangeFields } from "./catalog-change-log";
import {
  ACCESSORY_CRAWL_LOCK_PATH,
  ACCESSORY_CRAWL_MANIFEST_PATH,
  ACCESSORY_CRAWL_STATE_PATH,
  createExclusiveFile,
  ensureDataDirectory,
  fileUpdatedAt,
  readJson,
  removeGeneratedFile,
  writeJson
} from "./storage";

export type DanawaAccessoryCategoryConfig = {
  category: AccessoryCategory;
  categoryId: string;
};

export const DANAWA_ACCESSORY_CATEGORIES: DanawaAccessoryCategoryConfig[] = [
  { category: "storage_accessory", categoryId: "112760" },
  { category: "cooling_fan", categoryId: "11336858" },
  { category: "thermal_grease", categoryId: "11336859" },
  { category: "m2_heatsink", categoryId: "11336860" },
  { category: "gpu_support", categoryId: "11336861" },
  { category: "gpu_cooler", categoryId: "11336862" },
  { category: "memory_cooler", categoryId: "11336863" },
  { category: "thermal_pad", categoryId: "11341554" },
  { category: "fan_hub", categoryId: "11341556" },
  { category: "ups", categoryId: "11324022" }
];

export type AccessoryCrawlOptions = DanawaCrawlerOptions & {
  category?: AccessoryCategory;
  offset?: number;
  onlyIncomplete?: boolean;
  excludeProductCodes?: ReadonlySet<string>;
  dryRun?: boolean;
  onCategory?: (result: AccessoryCategoryCrawlResult) => void | Promise<void>;
  onProgress?: (progress: AccessoryCrawlProgress) => void | Promise<void>;
  onDetailProgress?: (progress: AccessoryDetailProgress) => void | Promise<void>;
};

export type AccessoryCrawlProgress = {
  category: AccessoryCategory;
  totalProductCount?: number;
  pagesVisited: number;
  pagesExpected: number;
  listedProducts: number;
  uniqueProducts: number;
};

export type AccessoryDetailProgress = {
  category: AccessoryCategory;
  total: number;
  processed: number;
  fetched: number;
  failed: number;
  incomplete: number;
};

export function selectAccessoryListWindow(pages: DanawaListItem[][], offset = 0, limit = 30, excludedProductCodes: ReadonlySet<string> = new Set()) {
  const normalizedOffset = Math.max(0, Math.floor(offset));
  const normalizedLimit = Math.max(0, Math.floor(limit));
  const seen = new Set<string>();
  const selected: DanawaListItem[] = [];
  for (const page of pages) {
    for (const item of page) {
      if (seen.has(item.sourceProductCode)) continue;
      seen.add(item.sourceProductCode);
      if (excludedProductCodes.has(item.sourceProductCode)) continue;
      if (seen.size <= normalizedOffset) continue;
      if (selected.length >= normalizedLimit) return selected;
      selected.push(item);
    }
  }
  return selected;
}

export type AccessoryCategoryCrawlResult = {
  category: AccessoryCategory;
  categoryId: string;
  totalProductCount?: number;
  offset: number;
  requestedLimit: number;
  pagesExpected: number;
  pagesVisited: number;
  listedProducts: number;
  uniqueProducts: number;
  detailFetched: number;
  detailFailed: number;
  missingProducts: number;
  incompleteSpecs: number;
  listCoverage: "partial" | "complete";
  coverage: "partial" | "complete";
  specCoverage: "partial" | "complete";
  items: AccessoryItem[];
};

export type AccessoryCrawlJobResult = {
  mode: "sample" | "all";
  categories: AccessoryCategoryCrawlResult[];
  collected: number;
  totalAfterMerge: number;
};

let activeAccessoryJob: Promise<AccessoryCrawlStatus> | null = null;

function accessoryConfigs(category?: AccessoryCategory) {
  return category
    ? DANAWA_ACCESSORY_CATEGORIES.filter((config) => config.category === category)
    : DANAWA_ACCESSORY_CATEGORIES;
}

function defaultAccessoryCrawlStatus(category?: AccessoryCategory, mode: "sample" | "all" = "sample"): AccessoryCrawlStatus {
  return {
    status: "idle",
    mode,
    details: true,
    onlyIncomplete: false,
    category,
    categoriesCompleted: 0,
    categoriesTotal: accessoryConfigs(category).length,
    pagesVisited: 0,
    pagesExpected: 0,
    listedProducts: 0,
    productsSeen: 0,
    expectedProducts: 0,
    productsUpdated: 0,
    detailFetched: 0,
    detailFailed: 0,
    missingProducts: 0,
    incompleteSpecs: 0,
    coverage: "partial",
    specCoverage: "partial",
    manifestPath: "data/accessory-crawl-manifest.json"
  };
}

async function accessoryLockOwnerPid() {
  try {
    const raw = await readFile(ACCESSORY_CRAWL_LOCK_PATH, "utf8");
    const pid = Number(raw.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number | undefined) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireAccessoryCrawlLock() {
  await ensureDataDirectory();
  try {
    await createExclusiveFile(ACCESSORY_CRAWL_LOCK_PATH, `${process.pid}\n`);
  } catch {
    const ownerPid = await accessoryLockOwnerPid();
    if (processIsAlive(ownerPid)) throw new Error(`이미 다른 주변 부품 크롤러 프로세스(${ownerPid})가 실행 중입니다.`);
    await removeGeneratedFile(ACCESSORY_CRAWL_LOCK_PATH);
    await createExclusiveFile(ACCESSORY_CRAWL_LOCK_PATH, `${process.pid}\n`);
  }
  return () => removeGeneratedFile(ACCESSORY_CRAWL_LOCK_PATH);
}

async function publishAccessoryCrawlStatus(status: AccessoryCrawlStatus, onUpdate?: (status: AccessoryCrawlStatus) => void) {
  await ensureDataDirectory();
  await writeJson(ACCESSORY_CRAWL_STATE_PATH, status);
  onUpdate?.(status);
}

async function publishAccessoryCrawlManifest(manifest: AccessoryCrawlManifest) {
  await ensureDataDirectory();
  await writeJson(ACCESSORY_CRAWL_MANIFEST_PATH, manifest);
}

export async function readAccessoryCrawlStatus() {
  const stored = await readJson<Partial<AccessoryCrawlStatus>>(ACCESSORY_CRAWL_STATE_PATH, {});
  const manifest = await readJson<AccessoryCrawlManifest | null>(ACCESSORY_CRAWL_MANIFEST_PATH, null);
  const normalized: AccessoryCrawlStatus = {
    ...defaultAccessoryCrawlStatus(stored.category, stored.mode ?? "sample"),
    ...stored,
    details: stored.details ?? true,
    onlyIncomplete: stored.onlyIncomplete ?? false,
    categoriesCompleted: stored.categoriesCompleted ?? 0,
    categoriesTotal: stored.categoriesTotal ?? accessoryConfigs(stored.category).length,
    pagesVisited: stored.pagesVisited ?? 0,
    pagesExpected: stored.pagesExpected ?? 0,
    listedProducts: stored.listedProducts ?? 0,
    productsSeen: stored.productsSeen ?? 0,
    expectedProducts: stored.expectedProducts ?? manifest?.totalExpectedProducts ?? 0,
    productsUpdated: stored.productsUpdated ?? 0,
    detailFetched: stored.detailFetched ?? 0,
    detailFailed: stored.detailFailed ?? 0,
    missingProducts: stored.missingProducts ?? 0,
    incompleteSpecs: stored.incompleteSpecs ?? 0,
    coverage: stored.coverage ?? "partial",
    specCoverage: stored.specCoverage ?? "partial"
  };
  if (normalized.status === "running" && !activeAccessoryJob) {
    const ownerPid = await accessoryLockOwnerPid();
    if (!processIsAlive(ownerPid)) {
      const stale: AccessoryCrawlStatus = {
        ...normalized,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: "이전 주변 부품 크롤러 프로세스가 중단되어 작업이 완료되지 않았습니다.",
        message: "중단된 주변 부품 크롤 작업을 복구했습니다. 다시 실행해 주세요.",
        workerPid: ownerPid
      };
      await publishAccessoryCrawlStatus(stale);
      return stale;
    }
  }
  return normalized;
}

export async function readAccessoryCrawlManifest() {
  return readJson<AccessoryCrawlManifest | null>(ACCESSORY_CRAWL_MANIFEST_PATH, null);
}

function normalizeSpace(value: string | undefined | null) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function absoluteUrl(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.startsWith("//") ? `https:${value}` : value;
  return isAllowedSourceUrl(normalized) ? normalized : undefined;
}

function parseNumber(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match) return undefined;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

function parseLowestPrice(text: string | undefined) {
  if (!text) return undefined;
  const value = Number(text.match(/최저가\s*([\d,]+)\s*원/i)?.[1]?.replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseCapacityGb(text: string) {
  const match = text.match(/(?:최대\s*)?(?:지원|호환)[^\d]{0,18}([\d,.]+)\s*(TB|GB)\b/i);
  if (!match) return undefined;
  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return undefined;
  return match[2].toUpperCase() === "TB" ? value * 1000 : value;
}

export function parseAccessorySpecs(category: AccessoryCategory, text: string): PartSpecs {
  const specs: PartSpecs = {};
  if (category === "storage_accessory") {
    specs.interface = /NVMe/i.test(text) ? "NVMe" : /SATA/i.test(text) ? "SATA" : undefined;
    const m2FormFactors = parseM2FormFactors(text);
    specs.formFactor = m2FormFactors[0] ?? (/2\.5(?:인치|형)|2\.5\"|6\.4cm/i.test(text) ? "2.5인치" : undefined);
    if (m2FormFactors.length > 0) specs.supportedFormFactors = m2FormFactors;
    specs.capacityGb = parseCapacityGb(text);
  }
  if (category === "cooling_fan") {
    specs.fanCount = parseNumber(text, /팬\s*개수\s*[:：]?\s*(\d+)\s*개/i);
    const fanCurrentA = fanCurrentAFromText(text);
    if (fanCurrentA !== undefined) specs.fanCurrentA = fanCurrentA;
    const dimension = text.match(/(?:팬\s*크기|크기)\s*[:：]?\s*(\d{2,3})\s*[x×]\s*(\d{2,3})(?:\s*[x×]\s*(\d{1,3}))?\s*mm/i);
    if (dimension) {
      specs.lengthMm = Number(dimension[1]);
      specs.widthMm = Number(dimension[2]);
      specs.thicknessMm = dimension[3] ? Number(dimension[3]) : undefined;
    } else {
      const fanSize = text.match(/팬\s*크기\s*[:：]?\s*(\d{2,3})\s*mm/i)?.[1];
      if (fanSize) {
        specs.lengthMm = Number(fanSize);
        specs.widthMm = Number(fanSize);
      }
      specs.thicknessMm = parseNumber(text, /(?:^|[\s/])([\d,.]+)T(?:\s|\/|$)/i);
    }
  }
  if (category === "m2_heatsink") {
    const m2FormFactors = parseM2FormFactors(text);
    specs.formFactor = m2FormFactors[0];
    if (m2FormFactors.length > 0) specs.supportedFormFactors = m2FormFactors;
    specs.thicknessMm = parseNumber(text, /(?:두께|높이)\s*[:：]?\s*([\d,.]+)\s*mm/i);
  }
  if (category === "thermal_pad") {
    specs.thicknessMm = parseNumber(text, /(?:두께|높이)\s*[:：]?\s*([\d,.]+)\s*mm/i);
  }
  if (category === "thermal_grease") {
    specs.capacityG = parseNumber(text, /용량\s*[:：]?\s*([\d,.]+)\s*g/i);
    specs.thermalConductivityWmK = parseNumber(text, /열전도율\s*[:：]?\s*([\d,.]+)\s*W\s*\/\s*\(?(?:m|m·K)\)?/i);
  }
  if (category === "fan_hub") {
    specs.fanPortCount = parseNumber(text, /팬\s*분배\s*[:：]?\s*(\d+)\s*개/i);
    specs.rgbPortCount = parseNumber(text, /RGB\s*분배\s*[:：]?\s*(\d+)\s*개/i);
  }
  if (category === "ups") {
    specs.outputW = parseNumber(text, /출력\s*용량\s*\(W\)\s*[:：]?\s*([\d,]+)\s*W/i);
    specs.wattageW = specs.outputW ?? parseNumber(text, /(?:정격\s*출력|출력)\s*[:：]?\s*([\d,]+)\s*W/i);
    specs.capacityVa = parseNumber(text, /출력\s*용량\s*\(VA\)\s*[:：]?\s*([\d,]+)\s*VA/i);
    specs.outletCount = parseNumber(text, /콘센트\s*[:：]?\s*(\d+)\s*개/i);
  }
  return specs;
}

function itemFromList(category: AccessoryCategory, categoryId: string, item: DanawaListItem): AccessoryItem {
  const rawSpecText = normalizeSpace(item.rawSpecText);
  return {
    id: `accessory-${category}-${item.sourceProductCode}`,
    category,
    name: item.name,
    model: item.name,
    imageUrl: item.imageUrl,
    danawaUrl: item.url,
    source: "danawa",
    sourceProductCode: item.sourceProductCode,
    sourceCategoryId: categoryId,
    listingType: "accessory",
    priceWon: item.priceWon,
    rawSpecText,
    specs: parseAccessorySpecs(category, rawSpecText),
    dataQuality: "incomplete",
    missingFields: ["detail page"],
    updatedAt: new Date().toISOString()
  };
}

function itemFromDetail(category: AccessoryCategory, categoryId: string, item: DanawaListItem, html: string): AccessoryItem {
  const $ = cheerio.load(html);
  const title = normalizeSpace($("title").text()).replace(/\s*:\s*다나와.*$/, "");
  const description = normalizeSpace($("meta[name='description']").attr("content"));
  const priceDescription = normalizeSpace($("meta[property='og:description']").attr("content"));
  const detailSpecText = normalizeSpace($(".spec_set_wrap .spec_list .items").first().text());
  const effectiveName = title || item.name;
  const rawSpecText = normalizeSpace(`${description} ${detailSpecText}`) || normalizeSpace(item.rawSpecText);
  const missingFields = rawSpecText ? [] : ["specification"];
  return {
    ...itemFromList(category, categoryId, item),
    name: effectiveName,
    brand: effectiveName.split(" ")[0],
    model: effectiveName,
    imageUrl: absoluteUrl($("meta[property='og:image']").attr("content")) ?? item.imageUrl,
    priceWon: item.priceWon ?? parseLowestPrice(priceDescription),
    rawSpecText,
    specs: parseAccessorySpecs(category, `${effectiveName} ${rawSpecText}`),
    dataQuality: missingFields.length === 0 ? "live" : "incomplete",
    missingFields
  };
}

export function parseDanawaAccessoryPage(category: AccessoryCategory, item: DanawaListItem, html: string, categoryId: string) {
  return itemFromDetail(category, categoryId, item, html);
}

function sleep(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(resolvePromise, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Crawler aborted"));
      },
      { once: true }
    );
  });
}

export async function crawlDanawaAccessoryCategory(
  category: AccessoryCategory,
  categoryId: string,
  options: AccessoryCrawlOptions = {}
): Promise<AccessoryCategoryCrawlResult> {
  const exhaustive = options.all === true;
  const limit = Math.max(1, options.limitPerCategory ?? 30);
  const offset = exhaustive || options.onlyIncomplete ? 0 : Math.max(0, Math.floor(options.offset ?? 0));
  const minimumPagesForBatch = Math.ceil((offset + limit) / 30);
  const configuredPages = exhaustive ? Number.POSITIVE_INFINITY : Math.max(1, options.pages ?? minimumPagesForBatch);
  const details = options.details ?? true;
  const delayMs = Math.max(0, options.delayMs ?? 850);
  const maxSafePages = 1000;
  const listItems = new Map<string, DanawaListItem>();
  let pageLimit = configuredPages;
  let totalProductCount: number | undefined;
  let pageSize: number | undefined;
  let pagesVisited = 0;
  let listedProducts = 0;
  const pages: DanawaListItem[][] = [];
  const firstPageUrl = `https://prod.danawa.com/list/?cate=${categoryId}`;
  let requestContext: DanawaListRequestContext | undefined;

  for (let page = 1; page <= pageLimit && page <= maxSafePages; page += 1) {
    const html = page === 1
      ? await fetchDanawaHtml(firstPageUrl, options)
      : requestContext
        ? await fetchDanawaHtml("https://prod.danawa.com/list/ajax/getProductList.ajax.php", options, {
            method: "POST",
            referer: firstPageUrl,
            body: new URLSearchParams(Object.entries(buildDanawaListAjaxParams(page, requestContext)))
          })
        : await fetchDanawaHtml(`${firstPageUrl}&page=${page}`, options);
    pagesVisited += 1;
    const pageItems = parseDanawaListPage(html);
    const pageInfo = parseDanawaListPageInfo(html);
    if (page === 1) {
      requestContext = parseDanawaListRequestContext(html);
      totalProductCount = pageInfo.totalProductCount;
      pageSize = pageInfo.pageSize ?? pageItems.length;
      if ((exhaustive || (options.onlyIncomplete && options.pages === undefined)) && totalProductCount !== undefined && pageSize) {
        pageLimit = Math.ceil(totalProductCount / pageSize);
      }
    }
    listedProducts += pageItems.length;
    pages.push(pageItems);
    const selectedItems = selectAccessoryListWindow(
      pages,
      offset,
      exhaustive ? Number.MAX_SAFE_INTEGER : limit,
      options.onlyIncomplete ? options.excludeProductCodes : undefined
    );
    listItems.clear();
    for (const item of selectedItems) listItems.set(item.sourceProductCode, item);
    if (!exhaustive && listItems.size >= limit) break;
    if (pageItems.length === 0) break;
    if (exhaustive && totalProductCount !== undefined && listItems.size >= totalProductCount) break;
    const pagesExpectedSoFar = totalProductCount !== undefined && pageSize
      ? Math.ceil(totalProductCount / pageSize)
      : Number.isFinite(pageLimit)
        ? pageLimit
        : pagesVisited;
    await options.onProgress?.({
      category,
      totalProductCount,
      pagesVisited,
      pagesExpected: pagesExpectedSoFar,
      listedProducts,
      uniqueProducts: listItems.size
    });
    // Some Danawa categories return a duplicate page from the AJAX endpoint near the end.
    // Keep visiting the expected pages so the manifest records the missing-product gap instead of
    // mistaking one repeated response for a complete crawl.
    if (page < pageLimit) await sleep(delayMs, options.signal);
  }

  const items: AccessoryItem[] = [];
  let detailFetched = 0;
  let detailFailed = 0;
  let detailProcessed = 0;
  let incompleteSpecs = 0;
  for (const item of listItems.values()) {
    if (options.signal?.aborted) throw new Error("Crawler aborted");
    const listItem = itemFromList(category, categoryId, item);
    if (!details) {
      items.push(listItem);
      continue;
    }
    await sleep(delayMs, options.signal);
    try {
      const detailItem = itemFromDetail(category, categoryId, item, await fetchDanawaHtml(item.url, options));
      items.push(detailItem);
      if (detailItem.missingFields.length > 0) incompleteSpecs += 1;
      detailFetched += 1;
    } catch {
      detailFailed += 1;
      items.push(listItem);
      incompleteSpecs += 1;
    }
    detailProcessed += 1;
    await options.onDetailProgress?.({
      category,
      total: listItems.size,
      processed: detailProcessed,
      fetched: detailFetched,
      failed: detailFailed,
      incomplete: incompleteSpecs
    });
  }
  const pagesExpected = totalProductCount !== undefined && pageSize
    ? Math.ceil(totalProductCount / pageSize)
    : Number.isFinite(pageLimit)
      ? pageLimit
      : pagesVisited;
  const missingProducts = exhaustive && totalProductCount !== undefined
    ? Math.max(0, totalProductCount - listItems.size)
    : 0;
  const listComplete = exhaustive
    && totalProductCount !== undefined
    && listItems.size >= totalProductCount
    && pagesVisited >= pagesExpected;
  const detailsComplete = details && detailFailed === 0 && items.length === listItems.size;
  const specComplete = items.every((item) => item.missingFields.length === 0);
  return {
    category,
    categoryId,
    totalProductCount,
    offset,
    requestedLimit: limit,
    pagesExpected,
    pagesVisited,
    listedProducts,
    uniqueProducts: listItems.size,
    detailFetched,
    detailFailed,
    missingProducts,
    incompleteSpecs: items.filter((item) => item.missingFields.length > 0).length,
    listCoverage: listComplete ? "complete" : "partial",
    coverage: listComplete && detailsComplete ? "complete" : "partial",
    specCoverage: specComplete ? "complete" : "partial",
    items
  };
}

export async function runAccessoryCrawl(options: AccessoryCrawlOptions = {}): Promise<AccessoryCrawlJobResult> {
  const configs = accessoryConfigs(options.category);
  if (configs.length === 0) throw new Error(`알 수 없는 주변 부품 카테고리입니다: ${options.category}`);
  const categories: AccessoryCategoryCrawlResult[] = [];
  const collected: AccessoryItem[] = [];
  const currentAccessories = options.onlyIncomplete ? await loadAccessories() : [];
  for (const config of configs) {
    const excludeProductCodes = options.onlyIncomplete
      ? new Set(currentAccessories.filter((item) => item.category === config.category && item.dataQuality === "live" && item.sourceProductCode).map((item) => item.sourceProductCode!))
      : undefined;
    const result = await crawlDanawaAccessoryCategory(config.category, config.categoryId, { ...options, excludeProductCodes });
    categories.push(result);
    collected.push(...result.items);
    console.log(`${ACCESSORY_CATEGORY_LABELS[config.category]}: ${result.uniqueProducts}개 확인, 상세 ${result.detailFetched}건, 실패 ${result.detailFailed}건`);
    await options.onCategory?.(result);
  }
  const totalAfterMerge = options.dryRun ? (await loadAccessories()).length : (await upsertAccessories(collected)).length;
  return {
    mode: options.all === true ? "all" : "sample",
    categories,
    collected: collected.length,
    totalAfterMerge
  };
}

function accessoryCrawlReport(result: AccessoryCategoryCrawlResult): AccessoryCrawlCategoryReport {
  const { items: _items, ...report } = result;
  return report;
}

export function crawlAccessoryChangeRecords(beforeAccessories: AccessoryItem[], afterAccessories: AccessoryItem[], collected: AccessoryItem[], changedAt: string) {
  const beforeByKey = new Map(beforeAccessories.map((item) => [catalogItemKey(item), item]));
  const afterByKey = new Map(afterAccessories.map((item) => [catalogItemKey(item), item]));
  const collectedByKey = new Map(collected.map((item) => [catalogItemKey(item), item]));
  return [...collectedByKey.keys()].flatMap((key) => {
    const before = beforeByKey.get(key);
    const after = afterByKey.get(key);
    if (!before || !after) return [];
    const changedFields = meaningfulCatalogChangeFields(before, after);
    return changedFields.length > 0 ? [catalogChangeRecord("accessory", before, after, changedFields, { changedAt })] : [];
  });
}

function accessoryReportTotals(reports: AccessoryCrawlCategoryReport[]) {
  return {
    pagesVisited: reports.reduce((total, report) => total + report.pagesVisited, 0),
    pagesExpected: reports.reduce((total, report) => total + report.pagesExpected, 0),
    listedProducts: reports.reduce((total, report) => total + report.listedProducts, 0),
    uniqueProducts: reports.reduce((total, report) => total + report.uniqueProducts, 0),
    expectedProducts: reports.reduce((total, report) => total + (report.totalProductCount ?? report.uniqueProducts), 0),
    detailFetched: reports.reduce((total, report) => total + report.detailFetched, 0),
    detailFailed: reports.reduce((total, report) => total + report.detailFailed, 0),
    missingProducts: reports.reduce((total, report) => total + report.missingProducts, 0),
    incompleteSpecs: reports.reduce((total, report) => total + report.incompleteSpecs, 0)
  };
}

export function isAccessoryCrawlRunning() {
  return activeAccessoryJob !== null;
}

export function runAccessoryCrawlJob(options: AccessoryCrawlOptions = {}) {
  if (activeAccessoryJob) return activeAccessoryJob;
  const configs = accessoryConfigs(options.category);
  if (configs.length === 0) return Promise.reject(new Error(`알 수 없는 주변 부품 카테고리입니다: ${options.category}`));
  const mode = options.all === true ? "all" : "sample";
  const job = (async (): Promise<AccessoryCrawlStatus> => {
    const startedAt = new Date().toISOString();
    const status: AccessoryCrawlStatus = {
      ...defaultAccessoryCrawlStatus(options.category, mode),
      status: "running",
      details: options.details !== false,
      onlyIncomplete: options.onlyIncomplete === true,
      startedAt,
      workerPid: process.pid,
      message: "주변 부품 카탈로그를 수집하고 있습니다."
    };
    const manifest: AccessoryCrawlManifest = {
      mode,
      details: options.details !== false,
      onlyIncomplete: options.onlyIncomplete === true,
      category: options.category,
      startedAt,
      generatedAt: new Date().toISOString(),
      coverage: "partial",
      specCoverage: "partial",
      totalExpectedProducts: 0,
      totalUniqueProducts: 0,
      totalDetailFetched: 0,
      totalDetailFailed: 0,
      totalMissingProducts: 0,
      totalIncompleteSpecs: 0,
      categories: []
    };
    let releaseLock: (() => Promise<void>) | undefined;
    try {
      releaseLock = await acquireAccessoryCrawlLock();
      await publishAccessoryCrawlStatus(status);
      await publishAccessoryCrawlManifest(manifest);
      const beforeAccessories = options.dryRun ? [] : await loadAccessories();
      const { onCategory: _onCategory, ...crawlOptions } = options;
      const result = await runAccessoryCrawl({
        ...crawlOptions,
        onProgress: async (progress) => {
          const totals = accessoryReportTotals(manifest.categories);
          status.categoriesCompleted = manifest.categories.length;
          status.pagesVisited = totals.pagesVisited + progress.pagesVisited;
          status.pagesExpected = totals.pagesExpected + progress.pagesExpected;
          status.listedProducts = totals.listedProducts + progress.listedProducts;
          status.productsSeen = totals.uniqueProducts + progress.uniqueProducts;
          status.expectedProducts = totals.expectedProducts + (progress.totalProductCount ?? progress.uniqueProducts);
          status.detailFetched = totals.detailFetched;
          status.detailFailed = totals.detailFailed;
          status.missingProducts = totals.missingProducts;
          status.incompleteSpecs = totals.incompleteSpecs;
          status.message = `${ACCESSORY_CATEGORY_LABELS[progress.category]} 목록 수집 중: ${progress.pagesVisited} / ${progress.pagesExpected}페이지, ${progress.uniqueProducts}개 확인`;
          await publishAccessoryCrawlStatus(status);
        },
        onDetailProgress: async (progress) => {
          const totals = accessoryReportTotals(manifest.categories);
          status.detailFetched = totals.detailFetched + progress.fetched;
          status.detailFailed = totals.detailFailed + progress.failed;
          status.incompleteSpecs = totals.incompleteSpecs + progress.incomplete;
          status.message = `${ACCESSORY_CATEGORY_LABELS[progress.category]} 상세 보강 중: ${progress.processed} / ${progress.total}건, 성공 ${progress.fetched}건`;
          await publishAccessoryCrawlStatus(status);
        },
        onCategory: async (categoryResult) => {
          const report = accessoryCrawlReport(categoryResult);
          manifest.categories.push(report);
          manifest.totalExpectedProducts += categoryResult.totalProductCount ?? categoryResult.uniqueProducts;
          manifest.totalUniqueProducts += categoryResult.uniqueProducts;
          manifest.totalDetailFetched += categoryResult.detailFetched;
          manifest.totalDetailFailed += categoryResult.detailFailed;
          manifest.totalMissingProducts += categoryResult.missingProducts;
          manifest.totalIncompleteSpecs += categoryResult.incompleteSpecs;
          const totals = accessoryReportTotals(manifest.categories);
          status.categoriesCompleted = manifest.categories.length;
          status.pagesVisited = totals.pagesVisited;
          status.pagesExpected = totals.pagesExpected;
          status.listedProducts = totals.listedProducts;
          status.productsSeen = totals.uniqueProducts;
          status.expectedProducts = manifest.totalExpectedProducts;
          status.detailFetched = totals.detailFetched;
          status.detailFailed = totals.detailFailed;
          status.missingProducts = totals.missingProducts;
          status.incompleteSpecs = totals.incompleteSpecs;
          status.message = `${ACCESSORY_CATEGORY_LABELS[categoryResult.category]} 주변 부품 수집 완료`;
          await publishAccessoryCrawlManifest(manifest);
          await publishAccessoryCrawlStatus(status);
        }
      });
      if (!options.dryRun) {
        await recordAccessoryCoverage(manifest.categories, {
          mode,
          details: options.details !== false,
          onlyIncomplete: options.onlyIncomplete === true,
          lastCrawledAt: new Date().toISOString()
        });
      }
      const afterAccessories = options.dryRun ? beforeAccessories : await loadAccessories();
      const collectedAccessories = result.categories.flatMap((category) => category.items);
      const crawlChangedAt = new Date().toISOString();
      const changeRecords = options.dryRun ? [] : crawlAccessoryChangeRecords(beforeAccessories, afterAccessories, collectedAccessories, crawlChangedAt);
      if (changeRecords.length > 0) await appendCatalogChangeRecords(changeRecords);
      const changeSummary = catalogChangeSummary(changeRecords, collectedAccessories.length);
      status.changeSummary = changeSummary;
      manifest.changeSummary = changeSummary;
      status.productsUpdated = options.dryRun ? 0 : result.collected;
      status.finishedAt = new Date().toISOString();
      manifest.finishedAt = status.finishedAt;
      manifest.coverage = options.all === true
        && manifest.categories.length === configs.length
        && manifest.categories.every((categoryResult) => categoryResult.coverage === "complete")
        ? "complete"
        : "partial";
      manifest.specCoverage = manifest.categories.length === configs.length
        && manifest.categories.every((categoryResult) => categoryResult.specCoverage === "complete")
        ? "complete"
        : "partial";
      status.coverage = manifest.coverage;
      status.specCoverage = manifest.specCoverage;
      status.status = options.all === true && options.details !== false && manifest.coverage !== "complete" ? "failed" : "completed";
      const changeNote = changeSummary.changedProducts > 0 ? ` 의미 있는 변경 ${changeSummary.changedProducts}개` : " 의미 있는 변경 없음";
      status.message = status.status === "failed"
        ? `전체 주변 부품 수집은 끝났지만 coverage를 증명하지 못했습니다. 누락 상품 ${manifest.totalMissingProducts}개, 상세 실패 ${manifest.totalDetailFailed}개입니다.`
        : options.dryRun
          ? `드라이런 완료: ${result.collected}개 주변 부품을 확인했습니다. 실제 파일은 변경하지 않았습니다.${changeNote}`
          : options.all === true && options.details === false
          ? `목록 전체 수집 완료: ${result.collected}개 상품을 반영했습니다. 상세 페이지 보강은 실행하지 않았습니다.${changeNote}`
          : `주변 부품 카탈로그 갱신 완료: ${result.collected}개 상품을 반영했습니다.${changeNote}`;
      if (status.status === "failed") status.error = "전체 목록 또는 주변 부품 상세 수집이 완전하지 않습니다.";
      await publishAccessoryCrawlManifest(manifest);
      await publishAccessoryCrawlStatus(status);
      return status;
    } catch (error: unknown) {
      status.status = "failed";
      status.finishedAt = new Date().toISOString();
      status.error = error instanceof Error ? error.message : String(error);
      status.message = "주변 부품 카탈로그 수집에 실패했습니다.";
      manifest.finishedAt = status.finishedAt;
      await publishAccessoryCrawlManifest(manifest);
      await publishAccessoryCrawlStatus(status);
      return status;
    } finally {
      await releaseLock?.();
      activeAccessoryJob = null;
    }
  })();
  activeAccessoryJob = job;
  return job;
}

async function main() {
  const { values } = parseArgs({
    options: {
      category: { type: "string" },
      all: { type: "boolean" },
      pages: { type: "string" },
      limit: { type: "string" },
      offset: { type: "string" },
      details: { type: "boolean" },
      "no-details": { type: "boolean", default: false },
      delay: { type: "string" },
      "only-incomplete": { type: "boolean" },
      "dry-run": { type: "boolean" }
    },
    allowPositionals: true
  });
  const category = typeof values.category === "string" ? values.category as AccessoryCategory : undefined;
  const pages = typeof values.pages === "string" ? Number(values.pages) : undefined;
  const limitPerCategory = typeof values.limit === "string" ? Number(values.limit) : undefined;
  const offset = typeof values.offset === "string" ? Number(values.offset) : undefined;
  const delayMs = typeof values.delay === "string" ? Number(values.delay) : undefined;
  const details = values["no-details"] === true ? false : typeof values.details === "boolean" ? values.details : process.env.DANAWA_CRAWL_DETAILS !== "false";
  const result = await runAccessoryCrawlJob({
    category,
    all: values.all === true,
    pages,
    limitPerCategory,
    offset,
    delayMs,
    details,
    onlyIncomplete: values["only-incomplete"] === true,
    dryRun: values["dry-run"] === true,
    timeoutMs: Number(process.env.DANAWA_CRAWL_TIMEOUT_MS ?? 20000),
    retries: Number(process.env.DANAWA_CRAWL_RETRIES ?? 2)
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
