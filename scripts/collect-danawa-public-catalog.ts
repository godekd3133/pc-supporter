import { setTimeout as sleep } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Part, PartCategory } from "../shared/types";
import { mergeCatalog } from "../server/catalog";
import { parseDanawaListPage, parseDanawaListPageInfo, parseDanawaProductPage, type DanawaListItem } from "../server/danawa";
import { readCatalogRecords, writeCatalogRecords } from "../server/repository";
import { BENCHMARK_OVERRIDES_PATH, DATA_DIR, readJson, writeJson } from "../server/storage";
import { isListingAllowed } from "../server/listing";

type Target = { category: PartCategory; categoryId: string; label: string };
type InventoryTarget = Target & { root?: boolean; applyExcludedReason?: string };
type InventoryItem = DanawaListItem & { category: PartCategory; categoryId: string };
type InventoryProductState = {
  status: "imported" | "rejected" | "retryable" | "abandoned";
  attempts: number;
  reason?: string;
  updatedAt: string;
};
type InventorySnapshot = {
  schemaVersion: 1;
  savedAt: string;
  source: string;
  targets: Array<Pick<InventoryTarget, "category" | "categoryId" | "label">>;
  items: InventoryItem[];
  productStates: Record<string, InventoryProductState>;
};

// Curated core-PC Danawa list categories. One public HTML page per target keeps
// this first catalog expansion bounded and avoids the robots-disallowed AJAX API.
const TARGETS: Target[] = [
  { category: "cpu", categoryId: "112747", label: "CPU" },
  { category: "cooler", categoryId: "11336857", label: "CPU cooler air" },
  { category: "cooler", categoryId: "11336856", label: "CPU cooler liquid" },
  { category: "motherboard", categoryId: "11353758", label: "Motherboard Intel 1700" },
  { category: "motherboard", categoryId: "11353759", label: "Motherboard AMD AM5" },
  { category: "motherboard", categoryId: "11354784", label: "Motherboard Intel 1851" },
  { category: "memory", categoryId: "11341201", label: "Memory DDR5" },
  { category: "memory", categoryId: "1131326", label: "Memory DDR4" },
  { category: "gpu", categoryId: "1131480", label: "GPU Nvidia" },
  { category: "gpu", categoryId: "1131521", label: "GPU AMD" },
  { category: "gpu", categoryId: "11347368", label: "GPU Intel" },
  { category: "gpu", categoryId: "11255541", label: "GPU RTX 50" },
  { category: "gpu", categoryId: "11255542", label: "GPU RX 9000" },
  { category: "ssd", categoryId: "11338854", label: "SSD NVMe Gen4" },
  { category: "ssd", categoryId: "11352133", label: "SSD NVMe Gen5" },
  { category: "ssd", categoryId: "11335283", label: "SSD SATA" },
  { category: "hdd", categoryId: "112763", label: "HDD" },
  { category: "case", categoryId: "112775", label: "Case" },
  { category: "psu", categoryId: "112777", label: "PSU" }
];

const USER_AGENT = "PCSupporterCatalogResearch/1.0 (public product catalog; contact: pc-supporter project)";
const MIN_DELAY_MS = 900;
const MAX_LIST_PAGES = 30;
const MAX_DETAILS = 120;
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const pilot = args.has("--pilot");
const remaining = args.has("--remaining");
const inventory = args.has("--inventory");
const saveInventory = args.has("--save-inventory");
const pc9 = args.has("--pc9") || inventory;
const snapshotApply = args.has("--snapshot");
if (args.has("--dry-run") && apply) throw new Error("Choose either --dry-run or --apply.");
if (inventory && apply) throw new Error("--inventory is read-only and cannot be combined with --apply.");
if (saveInventory && !inventory) throw new Error("--save-inventory requires --inventory.");
if (snapshotApply && (!apply || !pc9 || inventory)) throw new Error("--snapshot requires --apply --pc9.");
if (remaining && pc9) throw new Error("Choose either --remaining or --pc9.");
if ([...args].some((arg) => !["--dry-run", "--apply", "--pilot", "--remaining", "--inventory", "--save-inventory", "--pc9", "--snapshot"].includes(arg) && !arg.startsWith("--chunk=") && !arg.startsWith("--chunk-size="))) throw new Error("Allowed flags: --dry-run (default), --apply, --pilot, --remaining, --inventory, --save-inventory, --pc9, --snapshot, --chunk=N, --chunk-size=N.");

const REMAINING_CATEGORIES = new Set<PartCategory>(["memory", "gpu", "ssd", "hdd", "case", "psu"]);
const MAX_REMAINING_DETAILS = 70;
const MAX_REMAINING_PER_TARGET = 5;
const PC9_INVENTORY_SNAPSHOT_PATH = resolve(DATA_DIR, "danawa-pc9-inventory-snapshot.json");
const MIN_VALIDATED_PC9_UNIQUE_CODES = 1044;
const fetchAttempts = remaining || pc9 ? 2 : 3;
const requestTimeoutMs = remaining || pc9 ? 8000 : 25000;
const httpStatusCounts: Record<string, number> = {};
let transportFailures = 0;

class FatalSourceResponseError extends Error {}

async function readPc9Targets(): Promise<InventoryTarget[]> {
  const value: unknown = JSON.parse(await readFile(resolve(process.cwd(), "scripts/fixtures/danawa-pc9-targets.json"), "utf8"));
  if (!Array.isArray(value)) throw new Error("PC9 target manifest must be an array.");
  const targets = value as InventoryTarget[];
  const seen = new Set<string>();
  for (const target of targets) {
    if (!target || !/^\d+$/.test(target.categoryId) || !target.label || !target.category) throw new Error("Invalid PC9 target in manifest.");
    const key = `${target.category}:${target.categoryId}`;
    if (seen.has(key)) throw new Error(`Duplicate PC9 target: ${key}`);
    seen.add(key);
  }
  return targets;
}

function robotsDisallows(robots: string, path: string) {
  let inWildcardGroup = false;
  let groupHasRules = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (groupHasRules) { inWildcardGroup = false; groupHasRules = false; }
      if (!groupHasRules) inWildcardGroup = value === "*";
      continue;
    }
    if (key === "allow" || key === "disallow") {
      groupHasRules = true;
      if (inWildcardGroup && key === "disallow" && value && path.startsWith(value)) return true;
    }
  }
  return false;
}

let lastRequestAt = 0;
async function getText(url: string) {
  if (!url.startsWith("https://prod.danawa.com/list/?cate=") && !url.startsWith("https://prod.danawa.com/info/?pcode=")) {
    throw new Error(`Blocked non-allowlisted URL: ${url}`);
  }
  for (let attempt = 0; attempt < fetchAttempts; attempt += 1) {
    const wait = Math.max(0, MIN_DELAY_MS - (Date.now() - lastRequestAt));
    if (wait) await sleep(wait);
    lastRequestAt = Date.now();
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(requestTimeoutMs)
      });
      httpStatusCounts[String(response.status)] = (httpStatusCounts[String(response.status)] ?? 0) + 1;
      if (response.status === 403 || response.status === 429) throw new FatalSourceResponseError(`HTTP ${response.status} blocked crawl`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (/접근이 제한|비정상적인 접근|자동입력 방지|보안문자|로봇이 아닙니다|captcha/i.test(html)) throw new FatalSourceResponseError("Challenge or access-denied HTML response");
      if (html.length < 500) throw new Error("Empty HTML response");
      return html;
    } catch (error) {
      if (error instanceof FatalSourceResponseError) throw error;
      if (attempt === fetchAttempts - 1) {
        if (error instanceof TypeError && /fetch failed/i.test(error.message)) transportFailures += 1;
        throw error;
      }
      await sleep(MIN_DELAY_MS * (attempt + 1));
    }
  }
  throw new Error("Request retries exhausted");
}

function eligibleCore(part: Part) {
  return coreRejectionReason(part) === undefined;
}

function integerFlag(name: string, fallback: number, min: number, max: number) {
  const raw = [...args].find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

async function readInventorySnapshot() {
  const snapshot = await readJson<InventorySnapshot | null>(PC9_INVENTORY_SNAPSHOT_PATH, null);
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.targets)) {
    throw new Error(`No valid PC9 inventory snapshot at ${PC9_INVENTORY_SNAPSHOT_PATH}; run --inventory --save-inventory first.`);
  }
  snapshot.productStates ??= {};
  return snapshot;
}

function inventoryStateKey(category: PartCategory, productCode: string) {
  return `${category}:${productCode}`;
}

function inventoryStateTerminal(state: InventoryProductState | undefined) {
  return state?.status === "imported" || state?.status === "rejected" || state?.status === "abandoned";
}

function coreRejectionReason(part: Part) {
  if (!isListingAllowed(part, "all")) return "listing-policy-or-category-identity";
  if (part.listingType === "used" || part.listingType === "overseas") return `listing-type-${part.listingType}`;
  const identity = `${part.name} ${part.rawSpecText ?? ""}`;
  if (/(?:서버\s*용|서버\s*전용|\bserver\b|rackmount|랙마운트|4U\s*(?:서버|케이스|랙))/i.test(identity)) return "server-or-rackmount-identity";
  if (part.category === "cooler" && /(?:써멀|서멀|thermal\s*(?:paste|grease)|쿨링\s*팬|케이스\s*팬|cooling\s*fan|fan\s*only|팬\s*단품|(?:^|\s)P(?:12|14|18)\s+(?:Pro|Max|PWM))/i.test(identity)) return "cooler-accessory-identity";
  return undefined;
}

function currentPageFromHtml(html: string) {
  for (const pattern of [
    /\bcurrentPage\s*[:=]\s*["']?(\d+)/i,
    /\bcurPage\s*[:=]\s*["']?(\d+)/i,
    /\bcurrent_page\s*[:=]\s*["']?(\d+)/i
  ]) {
    const match = html.match(pattern);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function embeddedListStatsFromHtml(html: string) {
  const pattern = /(?:\\?")totalCount(?:\\?")\s*:\s*(\d+)\s*,\s*(?:\\?")currentPage(?:\\?")\s*:\s*(\d+)\s*,\s*(?:\\?")pageSize(?:\\?")\s*:\s*(\d+)\s*,\s*(?:\\?")totalPages(?:\\?")\s*:\s*(\d+)/g;
  for (const match of html.matchAll(pattern)) {
    const totalProductCount = Number(match[1]);
    const currentPage = Number(match[2]);
    const pageSize = Number(match[3]);
    const totalPages = Number(match[4]);
    if ([totalProductCount, currentPage, pageSize, totalPages].every(Number.isSafeInteger) && totalProductCount >= 0 && currentPage >= 1 && pageSize >= 1 && totalPages >= 1) {
      return { totalProductCount, currentPage, pageSize, totalPages };
    }
  }
  return undefined;
}

function decodedFlightChunks(html: string) {
  const chunks: string[] = [];
  const pushMarker = /self\.__next_f\.push\(\[\s*1\s*,\s*/g;
  for (const match of html.matchAll(pushMarker)) {
    const start = match.index! + match[0].length;
    if (html[start] !== '"') continue;
    let end = start + 1;
    let slashCount = 0;
    for (; end < html.length; end += 1) {
      const character = html[end];
      if (character === "\\") { slashCount += 1; continue; }
      if (character === '"' && slashCount % 2 === 0) break;
      slashCount = 0;
    }
    if (end >= html.length) continue;
    try {
      const chunk = JSON.parse(html.slice(start, end + 1));
      if (typeof chunk === "string") chunks.push(chunk);
    } catch {
      // Ignore malformed/nonstandard Flight chunks; regular HTML list parsing remains available.
    }
  }

  return chunks;
}

function matchingJsonEndIndex(text: string, start: number) {
  const opening = text[start];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : undefined;
  if (!closing) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === opening) depth += 1;
    else if (character === closing && --depth === 0) return index + 1;
  }
  return undefined;
}

function productListFromPublicHtml(html: string, target: Target) {
  let query: Record<string, unknown> | undefined;
  for (const chunk of decodedFlightChunks(html)) {
    let offset = 0;
    while (!query) {
      const queryKeyIndex = chunk.indexOf('"queryKey":', offset);
      if (queryKeyIndex < 0) break;
      const keyStart = queryKeyIndex + '"queryKey":'.length;
      const keyEnd = matchingJsonEndIndex(chunk, keyStart);
      if (!keyEnd) { offset = keyStart; continue; }
      offset = keyEnd;
      let key: unknown;
      try { key = JSON.parse(chunk.slice(keyStart, keyEnd)); } catch { continue; }
      if (!Array.isArray(key) || key[0] !== "productList" || String(key[1]) !== target.categoryId || Number(key[2]) !== 1) continue;
      const objectStart = chunk.lastIndexOf('{"dehydratedAt":', queryKeyIndex);
      if (objectStart < 0) continue;
      const objectEnd = matchingJsonEndIndex(chunk, objectStart);
      if (!objectEnd) continue;
      try {
        const candidate = JSON.parse(chunk.slice(objectStart, objectEnd)) as Record<string, unknown>;
        const state = candidate.state as Record<string, unknown> | undefined;
        const data = state?.data as Record<string, unknown> | undefined;
        if (data && Array.isArray(data.products)) query = candidate;
      } catch { /* Keep searching other dehydrated list queries. */ }
    }
    if (query) break;
  }
  if (query) {
    const key = query.queryKey as unknown[];
    const state = query.state as Record<string, unknown>;
    const data = state.data as Record<string, unknown>;
    const rawProducts = data.products as unknown[];
    const items = rawProducts.flatMap((raw): DanawaListItem[] => {
      if (!raw || typeof raw !== "object") return [];
      const product = raw as Record<string, unknown>;
      const code = String(product.id ?? product.productCode ?? "");
      const name = typeof product.productName === "string" ? product.productName.trim() : "";
      if (!/^\d+$/.test(code) || !name) return [];
      const rawUrl = typeof product.productUrl === "string" ? product.productUrl : typeof product.productLink === "string" ? product.productLink : "";
      const url = rawUrl.startsWith("https://prod.danawa.com/info/") && rawUrl.includes(`pcode=${code}`)
        ? rawUrl
        : `https://prod.danawa.com/info/?pcode=${code}`;
      const priceRecord = product.price && typeof product.price === "object" ? product.price as Record<string, unknown> : undefined;
      const rawPrice = priceRecord?.min ?? priceRecord?.lowest ?? product.displayPrice;
      const priceWon = typeof rawPrice === "number" ? rawPrice : typeof rawPrice === "string" ? Number(rawPrice.replace(/[^\d]/g, "")) : undefined;
      const imageRecord = product.image && typeof product.image === "object" ? product.image as Record<string, unknown> : undefined;
      const imageUrl = typeof imageRecord?.url === "string" ? imageRecord.url : typeof product.imageUrl === "string" ? product.imageUrl : undefined;
      const descriptionSegments = Array.isArray(product.descriptionSegments)
        ? product.descriptionSegments.map((segment) => segment && typeof segment === "object" && typeof (segment as Record<string, unknown>).text === "string" ? (segment as Record<string, string>).text : "").filter(Boolean).join(" / ")
        : undefined;
      return [{ name, url, sourceProductCode: code, ...(imageUrl ? { imageUrl } : {}), ...(priceWon && Number.isFinite(priceWon) ? { priceWon } : {}), ...(descriptionSegments ? { rawSpecText: descriptionSegments } : {}) }];
    });
    return {
      items,
      totalProductCount: typeof data.totalCount === "number" ? data.totalCount : undefined,
      currentPage: typeof data.currentPage === "number" ? data.currentPage : Number(key[2]),
      pageSize: typeof data.pageSize === "number" ? data.pageSize : Number(key[3]),
      totalPages: typeof data.totalPages === "number" ? data.totalPages : undefined,
      source: "next-flight-productList-query"
    };
  }

  const items = parseDanawaListPage(html);
  const info = parseDanawaListPageInfo(html);
  const embedded = embeddedListStatsFromHtml(html);
  const currentPage = embedded?.currentPage ?? currentPageFromHtml(html) ?? 1;
  return {
    items,
    totalProductCount: embedded?.totalProductCount ?? info.totalProductCount,
    currentPage,
    pageSize: embedded?.pageSize ?? info.pageSize ?? items.length,
    totalPages: embedded?.totalPages,
    source: "dom-parser-fallback"
  };
}

async function runInventory(targets: InventoryTarget[], existing: Part[]) {
  const existingKeys = new Set(existing.filter((part) => part.source === "danawa").map((part) => `${part.category}:${part.sourceProductCode}`));
  const categoryState = new Map<string, {
    codes: Set<string>;
    existingCodes: Set<string>;
    duplicateOccurrences: number;
    listedRows: number;
    sampledPages: number;
    root?: { categoryId: string; totalProductCount?: number; pageSize?: number; currentPage?: number; currentPageSource: string };
  }>();
  const pages: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  const underfilledPages: Array<{ category: PartCategory; categoryId: string; expectedRows: number; actualRows: number }> = [];
  const snapshotItems = new Map<string, InventoryItem>();

  for (const target of targets) {
    const state = categoryState.get(target.category) ?? {
      codes: new Set<string>(), existingCodes: new Set<string>(), duplicateOccurrences: 0, listedRows: 0, sampledPages: 0
    };
    try {
      let pageResult: ReturnType<typeof productListFromPublicHtml> | undefined;
      let expectedRows: number | undefined;
      for (let pageRetry = 0; pageRetry < 2; pageRetry += 1) {
        const html = await getText(`https://prod.danawa.com/list/?cate=${target.categoryId}`);
        pageResult = productListFromPublicHtml(html, target);
        expectedRows = pageResult.totalProductCount !== undefined && Number.isFinite(pageResult.totalProductCount) && pageResult.pageSize !== undefined && Number.isFinite(pageResult.pageSize)
          ? Math.min(pageResult.pageSize, pageResult.totalProductCount)
          : pageResult.pageSize;
        if (expectedRows === undefined || pageResult.items.length >= expectedRows) break;
        if (pageRetry === 1) {
          underfilledPages.push({ category: target.category, categoryId: target.categoryId, expectedRows, actualRows: pageResult.items.length });
          throw new Error(`underfilled first page after retry: expected ${expectedRows}, found ${pageResult.items.length}`);
        }
      }
      if (!pageResult) throw new Error("public list page returned no parsed result");
      const { items } = pageResult;
      const currentPage = pageResult.currentPage ?? 1;
      const totalProductCount = pageResult.totalProductCount;
      const pageSize = pageResult.pageSize ?? items.length;
      const source = pageResult.source;
      const uniquePageItems = new Map(items.filter((item) => /^\d+$/.test(item.sourceProductCode)).map((item) => [item.sourceProductCode, item]));
      for (const item of uniquePageItems.values()) {
        snapshotItems.set(`${target.category}:${target.categoryId}:${item.sourceProductCode}`, {
          ...item,
          category: target.category,
          categoryId: target.categoryId
        });
      }
      const newPageItems = [...uniquePageItems.values()].filter((item) => !existingKeys.has(`${target.category}:${item.sourceProductCode}`));
      for (const code of uniquePageItems.keys()) {
        if (state.codes.has(code)) state.duplicateOccurrences += 1;
        else state.codes.add(code);
        if (existingKeys.has(`${target.category}:${code}`)) state.existingCodes.add(code);
      }
      state.listedRows += items.length;
      state.sampledPages += 1;
      if (target.root) state.root = {
        categoryId: target.categoryId,
        totalProductCount,
        pageSize,
        currentPage,
        currentPageSource: source
      };
      categoryState.set(target.category, state);
      pages.push({
        category: target.category,
        categoryId: target.categoryId,
        label: target.label,
        root: Boolean(target.root),
        requestedPage: 1,
        currentPage,
        currentPageSource: source,
        listedRows: items.length,
        uniqueProductCodes: uniquePageItems.size,
        expectedRows,
        existingCatalogMatches: [...uniquePageItems.keys()].filter((code) => existingKeys.has(`${target.category}:${code}`)).length,
        newProductCodes: newPageItems.length,
        newSampleNames: newPageItems.slice(0, 3).map((item) => item.name),
        totalProductCount,
        pageSize,
        estimatedTotalPages: totalProductCount && pageSize
          ? Math.ceil(totalProductCount / pageSize)
          : undefined,
        sampledPages: [currentPage]
      });
    } catch (error) {
      if (error instanceof FatalSourceResponseError) throw error;
      errors.push(`${target.label} cate=${target.categoryId}: ${message(error)}`);
      categoryState.set(target.category, state);
      pages.push({ category: target.category, categoryId: target.categoryId, label: target.label, error: message(error), sampledPages: [] });
    }
  }

  const catalogCounts = new Map<string, number>();
  for (const part of existing.filter((item) => item.source === "danawa")) catalogCounts.set(part.category, (catalogCounts.get(part.category) ?? 0) + 1);
  const categories = Object.fromEntries([...categoryState].map(([category, state]) => {
    const root = state.root;
    return [category, {
      selectedListPages: state.sampledPages,
      listedRowsAcrossPages: state.listedRows,
      uniqueObservedProductCodes: state.codes.size,
      duplicateOccurrencesAcrossSelectedPages: state.duplicateOccurrences,
      observedCodesAlreadyInCatalog: state.existingCodes.size,
      observedCodesNewToCatalog: state.codes.size - state.existingCodes.size,
      existingDanawaCatalogRows: catalogCounts.get(category) ?? 0,
      rootCategoryId: root?.categoryId,
      rootTotalProductCount: root?.totalProductCount,
      rootPageSize: root?.pageSize,
      rootCurrentPage: root?.currentPage,
      rootCurrentPageSource: root?.currentPageSource,
      estimatedRootPageCount: root?.totalProductCount !== undefined && root.pageSize ? Math.ceil(root.totalProductCount / root.pageSize) : undefined,
      sampledPagesAreFirstPageOnly: true
    }];
  }));

  return {
    report: {
      mode: "inventory-read-only",
      source: "robots-allowed Danawa HTML GET /list/?cate=<id>",
      detailRequests: 0,
      ajaxRequests: 0,
      robotsPreflightPassed: true,
      pageLimit: targets.length,
      minDelayMs: MIN_DELAY_MS,
      fetchAttempts,
      timeoutMs: requestTimeoutMs,
      httpStatusCounts,
      transportFailures,
      categories,
      pages,
      underfilledPages,
      errors,
      errorCount: errors.length,
      coverageNote: "Only the requested first/list page was sampled for each category ID. Root totals estimate available pages; this inventory does not claim full product coverage."
    },
    snapshotItems: [...snapshotItems.values()]
  };
}

async function persistRawChunk(parts: Part[], benchmarkOverridesBefore: unknown) {
  if (parts.length === 0) return 0;
  const latest = await readCatalogRecords();
  const latestKeys = new Set(latest.map((part) => `${part.category}:${part.sourceProductCode ?? part.id}`));
  const safeChunk = parts.filter((part) => !latestKeys.has(`${part.category}:${part.sourceProductCode ?? part.id}`));
  if (safeChunk.length > 0) await writeCatalogRecords(mergeCatalog(latest, safeChunk));
  const benchmarkOverridesAfter = await readJson<unknown>(BENCHMARK_OVERRIDES_PATH, {});
  if (JSON.stringify(benchmarkOverridesBefore) !== JSON.stringify(benchmarkOverridesAfter)) {
    throw new Error("Benchmark overrides changed during catalog write; inspect persistence immediately.");
  }
  return safeChunk.length;
}

async function main() {
  const robots = await getRobots();
  for (const path of ["/list/", "/info/"]) {
    if (robotsDisallows(robots, path)) throw new Error(`Robots.txt now disallows ${path}; crawl stopped.`);
  }

  const pc9Targets = pc9 ? await readPc9Targets() : undefined;
  const eligibleTargets = pc9Targets
    ? apply ? pc9Targets.filter((target) => !target.applyExcludedReason) : pc9Targets
    : remaining ? TARGETS.filter((target) => REMAINING_CATEGORIES.has(target.category)) : TARGETS;
  const chunkSize = integerFlag("--chunk-size", 5, 1, 20);
  const chunkNumber = integerFlag("--chunk", 1, 1, 1000);
  const chunkTargets = pc9 && apply
    ? eligibleTargets.slice((chunkNumber - 1) * chunkSize, chunkNumber * chunkSize)
    : eligibleTargets;
  if (pc9 && apply && chunkTargets.length === 0) throw new Error(`PC9 apply chunk ${chunkNumber} has no targets (manifest contains ${eligibleTargets.length}).`);
  const inventoryTargets = inventory ? (pilot ? eligibleTargets.slice(0, 3) : eligibleTargets) : undefined;
  const targetsForRun = inventoryTargets ?? chunkTargets;
  const pilotTargets = remaining
    ? eligibleTargets.filter((target, index, all) => all.findIndex((candidate) => candidate.category === target.category) === index).slice(0, 3)
    : eligibleTargets.slice(0, 3);
  const targets = inventory ? targetsForRun : (pc9 && apply ? targetsForRun : pilot ? pilotTargets : eligibleTargets.slice(0, MAX_LIST_PAGES));
  if (targets.length > (inventory ? 100 : MAX_LIST_PAGES) && !inventory) throw new Error(`Run exceeds the ${MAX_LIST_PAGES} list-page bound.`);
  const detailBudget = pilot ? 15 : pc9 ? Math.min(25, targets.length * 5) : remaining ? MAX_REMAINING_DETAILS : MAX_DETAILS;
  const perTargetBudget = pc9 || remaining ? 5 : detailBudget;
  const existing = await readCatalogRecords();
  const existingCodes = new Set(existing.filter((p) => p.source === "danawa").map((p) => `${p.category}:${p.sourceProductCode}`));
  const originalExistingCodes = new Set(existingCodes);
  const benchmarkOverridesBefore = await readJson<unknown>(BENCHMARK_OVERRIDES_PATH, {});
  if (inventory) {
    const result = await runInventory(targets as InventoryTarget[], existing);
    const uniqueSnapshotCodes = new Set(result.snapshotItems.map((item) => `${item.category}:${item.sourceProductCode}`)).size;
    const snapshotSaveBlockReason = result.report.errorCount > 0
      ? "list page errors were reported"
      : result.report.underfilledPages.length > 0
        ? "one or more first pages remained underfilled after retry"
        : result.report.transportFailures > 0 || Object.keys(result.report.httpStatusCounts).some((status) => status !== "200")
          ? "transport failures or non-200 HTTP responses were observed"
          : uniqueSnapshotCodes < MIN_VALIDATED_PC9_UNIQUE_CODES
            ? `only ${uniqueSnapshotCodes} unique category/product codes were parsed; require at least ${MIN_VALIDATED_PC9_UNIQUE_CODES}`
            : undefined;
    let snapshotSaved = false;
    if (saveInventory && !snapshotSaveBlockReason) {
      const snapshot: InventorySnapshot = {
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        source: "robots-allowed Danawa HTML GET /list/?cate=<id>",
        targets: (targets as InventoryTarget[]).map(({ category, categoryId, label }) => ({ category, categoryId, label })),
        items: result.snapshotItems,
        productStates: {}
      };
      await writeJson(PC9_INVENTORY_SNAPSHOT_PATH, snapshot);
      snapshotSaved = true;
    }
    console.log(JSON.stringify({
      ...result.report,
      snapshotSaveRequested: saveInventory,
      snapshotSaved,
      snapshotPath: snapshotSaved ? PC9_INVENTORY_SNAPSHOT_PATH : undefined,
      snapshotSaveBlockReason,
      uniqueSnapshotItems: result.snapshotItems.length,
      uniqueCategoryProductCodes: uniqueSnapshotCodes,
      validatedMinimumUniqueCategoryProductCodes: MIN_VALIDATED_PC9_UNIQUE_CODES
    }, null, 2));
    if (saveInventory && snapshotSaveBlockReason) process.exitCode = 1;
    return;
  }
  const snapshot = snapshotApply ? await readInventorySnapshot() : undefined;
  const seen = new Set<string>();
  const collected: Part[] = [];
  const errors: string[] = [];
  const categoryCounts = new Map<string, {
    listedRows: number;
    uniqueListedCodes: number;
    detailAttempts: number;
    coreProducts: number;
    generatorUsable: number;
    incomplete: number;
    errors: number;
  }>();
  let details = 0;
  let appliedCount = 0;
  let rejectedCount = 0;
  let retryableFailureCount = 0;
  let listPagesFetched = 0;

  for (const target of targets) {
    const collectedAtTargetStart = collected.length;
    const key = `${target.category}:${target.categoryId}`;
    const counts = categoryCounts.get(key) ?? {
      listedRows: 0, uniqueListedCodes: 0, detailAttempts: 0,
      coreProducts: 0, generatorUsable: 0, incomplete: 0, errors: 0
    };
    try {
      let items: DanawaListItem[];
      if (snapshot) {
        items = snapshot.items
          .filter((item) => item.category === target.category && item.categoryId === target.categoryId)
          .map(({ category: _category, categoryId: _categoryId, ...item }) => item);
      } else {
        const html = await getText(`https://prod.danawa.com/list/?cate=${target.categoryId}`);
        listPagesFetched += 1;
        items = productListFromPublicHtml(html, target).items;
      }
      if (!items.length && !snapshot) throw new Error("no valid product rows parsed");
      counts.listedRows = items.length;
      counts.uniqueListedCodes = new Set(items.map((item) => item.sourceProductCode)).size;
      const candidates = items.filter((item) => {
        if (!/^\d+$/.test(item.sourceProductCode)) return true;
        if (seen.has(item.sourceProductCode)) return false;
        if ((remaining || pc9) && existingCodes.has(`${target.category}:${item.sourceProductCode}`)) return false;
        if (snapshot && inventoryStateTerminal(snapshot.productStates[inventoryStateKey(target.category, item.sourceProductCode)])) return false;
        if (snapshot && snapshot.productStates[inventoryStateKey(target.category, item.sourceProductCode)]?.attempts >= 3) return false;
        return true;
      }).slice(0, perTargetBudget);
      for (const item of candidates) {
        if (!/^\d+$/.test(item.sourceProductCode)) {
          counts.errors += 1;
          errors.push(`${target.label}: skipped non-numeric product code`);
          continue;
        }
        if (seen.has(item.sourceProductCode) || details >= detailBudget) continue;
        seen.add(item.sourceProductCode);
        const stateKey = inventoryStateKey(target.category, item.sourceProductCode);
        let detailFetched = false;
        try {
          const detailHtml = await getText(`https://prod.danawa.com/info/?pcode=${item.sourceProductCode}`);
          detailFetched = true;
          const part = parseDanawaProductPage(target.category, item, detailHtml, target.categoryId);
          details += 1;
          counts.detailAttempts += 1;
          if (!part.sourceProductCode || !part.name || part.category !== target.category) throw new Error("invalid parsed product detail");
          if (part.dataQuality === "incomplete") counts.incomplete += 1;
          if (!eligibleCore(part)) {
            rejectedCount += 1;
            if (snapshot) snapshot.productStates[stateKey] = {
              status: "rejected", attempts: 1, reason: coreRejectionReason(part), updatedAt: new Date().toISOString()
            };
            continue;
          }
          counts.coreProducts += 1;
          if (part.dataQuality !== "incomplete" && part.missingFields.length === 0 && isListingAllowed(part, "retail_only")) counts.generatorUsable += 1;
          collected.push(part);
        } catch (error) {
          if (error instanceof FatalSourceResponseError) throw error;
          details += 1;
          counts.detailAttempts += 1;
          counts.errors += 1;
          errors.push(`${target.label} pcode=${item.sourceProductCode}: ${message(error)}`);
          if (snapshot) {
            const priorAttempts = snapshot.productStates[stateKey]?.attempts ?? 0;
            const attempts = priorAttempts + 1;
            const retryable = !detailFetched && attempts < 3;
            snapshot.productStates[stateKey] = {
              status: retryable ? "retryable" : detailFetched ? "rejected" : "abandoned",
              attempts,
              reason: message(error),
              updatedAt: new Date().toISOString()
            };
            if (retryable) retryableFailureCount += 1;
            else rejectedCount += 1;
          }
          if (pc9 && (transportFailures >= 3 || (details >= 10 && transportFailures / details >= 0.1))) {
            throw new FatalSourceResponseError("Stopping PC9 apply after repeated transport failures.");
          }
        }
      }
    } catch (error) {
      if (error instanceof FatalSourceResponseError) throw error;
      counts.errors += 1;
      errors.push(`${target.label} cate=${target.categoryId}: ${message(error)}`);
    }
    categoryCounts.set(key, counts);
    if (apply && pc9) {
      const targetParts = collected.slice(collectedAtTargetStart);
      appliedCount += await persistRawChunk(targetParts, benchmarkOverridesBefore);
      for (const part of targetParts) {
        existingCodes.add(`${part.category}:${part.sourceProductCode}`);
        if (snapshot && part.sourceProductCode) snapshot.productStates[inventoryStateKey(part.category, part.sourceProductCode)] = {
          status: "imported", attempts: 1, updatedAt: new Date().toISOString()
        };
      }
      if (snapshot) await writeJson(PC9_INVENTORY_SNAPSHOT_PATH, { ...snapshot, savedAt: new Date().toISOString() });
    }
  }

  const newParts = collected.filter((p) => !originalExistingCodes.has(`${p.category}:${p.sourceProductCode}`));
  const snapshotPendingCodes = snapshot
    ? new Set(snapshot.items
      .filter((item) => !pc9Targets?.some((target) => target.category === item.category && target.categoryId === item.categoryId && target.applyExcludedReason))
      .filter((item) => !existingCodes.has(`${item.category}:${item.sourceProductCode}`))
      .filter((item) => !inventoryStateTerminal(snapshot.productStates[inventoryStateKey(item.category, item.sourceProductCode)]))
      .filter((item) => (snapshot.productStates[inventoryStateKey(item.category, item.sourceProductCode)]?.attempts ?? 0) < 3)
      .map((item) => inventoryStateKey(item.category, item.sourceProductCode))).size
    : undefined;

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    remaining,
    pc9,
    pc9ApplyExcludedTargets: pc9Targets?.filter((target) => Boolean(target.applyExcludedReason)).map(({ category, categoryId, applyExcludedReason }) => ({ category, categoryId, applyExcludedReason })),
    chunk: pc9 && apply ? { number: chunkNumber, size: chunkSize, startTarget: (chunkNumber - 1) * chunkSize + 1 } : undefined,
    pilot,
    requestsBound: {
      maxListPages: MAX_LIST_PAGES,
      maxUniqueDetailPages: detailBudget,
      maxUniqueDetailsPerTarget: perTargetBudget,
      fetchAttempts,
      timeoutMs: requestTimeoutMs,
      delayMs: MIN_DELAY_MS
    },
    listPages: targets.length,
    listPagesFetched,
    detailAttempts: details,
    httpStatusCounts,
    transportFailures,
    uniqueCoreProductsParsed: collected.length,
    coreProducts: collected.length,
    generatorUsableProducts: collected.filter((p) => p.dataQuality !== "incomplete" && p.missingFields.length === 0 && isListingAllowed(p, "retail_only")).length,
    incompleteProducts: collected.filter((p) => p.dataQuality === "incomplete").length,
    terminalRejectedProducts: rejectedCount,
    retryableFailures: retryableFailureCount,
    snapshotPendingUniqueCodes: snapshotPendingCodes,
    newCoreProducts: newParts.length,
    newGeneratorUsableProducts: newParts.filter((p) => p.dataQuality !== "incomplete" && p.missingFields.length === 0 && isListingAllowed(p, "retail_only")).length,
    categoryCounts: Object.fromEntries(categoryCounts),
    errors: errors.slice(0, 30),
    errorCount: errors.length
  }, null, 2));

  if (apply && pc9) {
    console.log(`Applied ${appliedCount} new products in resumable target chunks${snapshot ? " from inventory snapshot" : ""}; benchmark override file unchanged.`);
  } else if (apply && newParts.length > 0) {
    // Write raw persisted records directly. loadCatalog()/upsertCatalog() return
    // benchmark-enriched rows, so using them here could bake local overlays into
    // the base catalog. This path merges against raw repository rows instead.
    const applied = await persistRawChunk(newParts, benchmarkOverridesBefore);
    console.log(`Applied ${applied} new products; benchmark override file unchanged.`);
  }
}

async function getRobots() {
  // Robots fetch counts as a request and is subject to the same delay policy.
  const wait = Math.max(0, MIN_DELAY_MS - (Date.now() - lastRequestAt));
  if (wait) await sleep(wait);
  lastRequestAt = Date.now();
  const response = await fetch("https://prod.danawa.com/robots.txt", {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(20000)
  });
  if (response.status === 403 || response.status === 429) throw new FatalSourceResponseError(`robots.txt returned HTTP ${response.status}`);
  if (!response.ok) throw new Error(`robots.txt fetch failed: HTTP ${response.status}`);
  return response.text();
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(message(error));
  process.exitCode = 1;
});
