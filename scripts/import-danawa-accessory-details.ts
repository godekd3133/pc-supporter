import "dotenv/config";
import { copyFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { AccessoryCategory, AccessoryCrawlCategoryReport, AccessoryItem, AccessoryCrawlManifest } from "../shared/types";
import { DANAWA_ACCESSORY_CATEGORIES, parseDanawaAccessoryPage } from "../server/accessory-crawler";
import { recordAccessoryCoverage, upsertAccessories } from "../server/accessories";
import { appendCatalogChangeRecords, catalogChangeRecord, meaningfulCatalogChangeFields } from "../server/catalog-change-log";
import { fetchDanawaHtml, isAllowedSourceUrl, type DanawaCrawlerOptions, type DanawaListItem } from "../server/danawa";
import {
  ACCESSORIES_PATH,
  ACCESSORY_COVERAGE_PATH,
  CATALOG_CHANGE_LOG_PATH,
  DATA_DIR,
  readJson,
  removeGeneratedFile,
  writeJson
} from "../server/storage";

type ListedProduct = {
  productCode: string;
  name: string;
  url: string;
  priceWon?: number;
  spec?: string;
};

type SnapshotPage = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  products: ListedProduct[];
  fetchedAt: string;
};

type Snapshot = {
  schemaVersion: number;
  source: string;
  updatedAt: string;
  categories: Record<string, {
    category: AccessoryCategory;
    categoryId: string;
    pages: Record<string, SnapshotPage>;
    status: string;
    listedProductCount: number;
    uniqueProductCount: number;
  }>;
};

type Candidate = {
  category: AccessoryCategory;
  categoryId: string;
  product: ListedProduct;
  current: AccessoryItem;
};

type ImportFailure = { productCode: string; category: AccessoryCategory; failedAt: string; reason: string };
type ImportState = {
  schemaVersion: 1;
  status: "running" | "complete" | "partial" | "source-blocked";
  manifestUpdatedAt: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  planned: number;
  attemptedThisRun: number;
  detailFetchedThisRun: number;
  failedThisRun: number;
  incompleteAfterFetchThisRun: number;
  detailFetchedProductCodes: string[];
  failures: ImportFailure[];
  activeCategory?: AccessoryCategory;
  stoppedReason?: string;
  backupDirectory?: string;
};

const { values, positionals } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    category: { type: "string" },
    limit: { type: "string" }
  },
  strict: true,
  allowPositionals: true
});

if (positionals.length > 0) throw new Error("Use only --apply, --all, --category=ACCESSORY_CATEGORY, and --limit=N.");
if (process.env.DATABASE_URL?.trim()) throw new Error("Accessory detail import is file-backed only; unset DATABASE_URL before running it.");
if (DATA_DIR !== resolve(process.cwd(), "data")) throw new Error("This importer writes only this checkout's data folder; unset PC_SUPPORTER_DATA_DIR.");
if (values.all && values.limit) throw new Error("Choose either --all or --limit=N.");

const categoryFilter = values.category as AccessoryCategory | undefined;
if (categoryFilter && !DANAWA_ACCESSORY_CATEGORIES.some((entry) => entry.category === categoryFilter)) {
  throw new Error(`Unknown accessory category: ${categoryFilter}`);
}
const configuredLimit = values.limit === undefined ? 50 : Number(values.limit);
if (!values.all && (!Number.isSafeInteger(configuredLimit) || configuredLimit < 1 || configuredLimit > 500)) {
  throw new Error("--limit must be an integer from 1 to 500.");
}

const manifestPath = join(DATA_DIR, "danawa-accessory-all-pages.json");
const statePath = join(DATA_DIR, "accessory-detail-import-state.json");
const MIN_DELAY_MS = 900;
const BATCH_SIZE = 25;
const USER_AGENT = "PCSupporterAccessoryDetails/1.0 (public Danawa product detail pages)";
let lastSourceRequestAt = 0;

async function readRequiredJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function robotsDisallows(robots: string, path: string) {
  let wildcardGroup = false;
  let groupHasRules = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (groupHasRules) { wildcardGroup = false; groupHasRules = false; }
      if (!groupHasRules) wildcardGroup = value === "*";
      continue;
    }
    if (key === "allow" || key === "disallow") {
      groupHasRules = true;
      if (wildcardGroup && key === "disallow" && value && path.startsWith(value)) return true;
    }
  }
  return false;
}

async function preflightInfoRobots() {
  const response = await fetch("https://prod.danawa.com/robots.txt", {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(8000)
  });
  if (response.status === 403 || response.status === 429) throw new Error(`STOP: robots.txt returned HTTP ${response.status}.`);
  if (!response.ok) throw new Error(`Could not verify Danawa robots.txt: HTTP ${response.status}.`);
  const robots = await response.text();
  if (robotsDisallows(robots, "/info/")) throw new Error("STOP: robots.txt disallows public product detail pages.");
  if (robotsDisallows(robots, "/info/ajax/")) {
    // The importer uses /info/ only. Confirm the AJAX route remains separately blocked as expected.
    if (!robots.split(/\r?\n/).some((line) => /^\s*Disallow:\s*\/info\/ajax\//i.test(line))) {
      throw new Error("Could not independently confirm the robots rule for the blocked info AJAX route.");
    }
  }
  lastSourceRequestAt = Date.now();
}

function canonicalDetailUrl(product: ListedProduct, categoryId: string) {
  const url = new URL(product.url);
  if (!isAllowedSourceUrl(url.href) || url.origin !== "https://prod.danawa.com" || url.pathname !== "/info/" || url.searchParams.get("pcode") !== product.productCode) {
    throw new Error(`Invalid public detail URL identity for ${product.productCode}.`);
  }
  url.searchParams.set("cate", categoryId);
  return url.toString();
}

function blockedSourceResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:403|429)\b|STOP:/i.test(message);
}

function challengePage(html: string) {
  return /접근이 제한|비정상적인 접근|자동입력 방지|보안문자|로봇이 아닙니다|captcha/i.test(html);
}

function safeFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/g, "[source URL]").slice(0, 240);
}

function listItem(categoryId: string, product: ListedProduct): DanawaListItem {
  return {
    name: product.name,
    url: canonicalDetailUrl(product, categoryId),
    sourceProductCode: product.productCode,
    ...(product.priceWon !== undefined ? { priceWon: product.priceWon } : {}),
    ...(product.spec ? { rawSpecText: product.spec } : {})
  };
}

function uniqueListedProducts(snapshotCategory: Snapshot["categories"][string]) {
  const pages = Object.entries(snapshotCategory.pages)
    .map(([pageKey, page]) => ({ pageKey: Number(pageKey), page }))
    .sort((left, right) => left.pageKey - right.pageKey);
  const seen = new Set<string>();
  const products: Array<{ product: ListedProduct; fetchedAt: string }> = [];
  for (const { pageKey, page } of pages) {
    if (pageKey !== page.page) throw new Error(`${snapshotCategory.category}: manifest page key mismatch at ${pageKey}.`);
    for (const product of page.products) {
      if (!/^\d+$/.test(product.productCode) || !product.name.trim()) throw new Error(`${snapshotCategory.category}: invalid product on page ${page.page}.`);
      if (seen.has(product.productCode)) continue;
      seen.add(product.productCode);
      products.push({ product, fetchedAt: page.fetchedAt });
    }
  }
  return { pages, products };
}

const [manifest, accessories] = await Promise.all([
  readRequiredJson<Snapshot>(manifestPath),
  readJson<AccessoryItem[]>(ACCESSORIES_PATH, [])
]);
if (manifest.schemaVersion !== 1 || !manifest.source.includes("Danawa public accessory list pages")) {
  throw new Error("Unsupported public accessory list manifest.");
}

const accessoryByCode = new Map<string, AccessoryItem[]>();
for (const item of accessories) {
  if (!item.sourceProductCode) continue;
  const rows = accessoryByCode.get(item.sourceProductCode) ?? [];
  rows.push(item);
  accessoryByCode.set(item.sourceProductCode, rows);
}

const candidates: Candidate[] = [];
const manifestCodesByCategory = new Map<AccessoryCategory, Set<string>>();
for (const config of DANAWA_ACCESSORY_CATEGORIES.filter((entry) => !categoryFilter || entry.category === categoryFilter)) {
  const sourceCategory = manifest.categories[config.categoryId];
  if (!sourceCategory || sourceCategory.category !== config.category || sourceCategory.categoryId !== config.categoryId) {
    throw new Error(`Missing or mismatched list manifest for ${config.category}.`);
  }
  const unique = uniqueListedProducts(sourceCategory);
  const manifestCodes = new Set(unique.products.map(({ product }) => product.productCode));
  manifestCodesByCategory.set(config.category, manifestCodes);
  for (const { product } of unique.products) {
    canonicalDetailUrl(product, config.categoryId);
    const matches = accessoryByCode.get(product.productCode) ?? [];
    if (matches.length > 1) throw new Error(`Accessory catalog contains duplicate PCode ${product.productCode}.`);
    const current = matches[0];
    if (!current || current.source !== "danawa" || current.category !== config.category) continue;
    if (current.dataQuality !== "incomplete") continue;
    candidates.push({ category: config.category, categoryId: config.categoryId, product, current });
  }
}

const planned = values.all ? candidates : candidates.slice(0, configuredLimit);
const byCategoryPlan = Object.fromEntries(DANAWA_ACCESSORY_CATEGORIES
  .filter((config) => !categoryFilter || config.category === categoryFilter)
  .map((config) => [config.category, planned.filter((candidate) => candidate.category === config.category).length]));
if (!values.apply) {
  console.log(JSON.stringify({
    mode: "dry-run",
    dataDirectory: DATA_DIR,
    manifestUpdatedAt: manifest.updatedAt,
    pendingListedDetailRows: candidates.length,
    plannedRequests: planned.length,
    selection: values.all ? "all listed incomplete accessories" : `first ${configuredLimit} incomplete accessories`,
    byCategory: byCategoryPlan,
    delaysBetweenRequestsMs: MIN_DELAY_MS,
    endpoint: "https://prod.danawa.com/info/?pcode=<verified-list-PCode>&cate=<source-category>",
    persistedFields: ["detail text", "parsed accessory specs", "detail quality", "updatedAt"],
    preservedFields: ["catalog price", "priceCheckedAt", "category identity"],
    detailCoverage: "The run will not claim compatibility merely because a detail page is available."
  }, null, 2));
} else {
  if (planned.length === 0) throw new Error("No listed incomplete accessory details are pending.");

  const backupDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-accessory-details-"));
  const backupPaths = [ACCESSORIES_PATH, ACCESSORY_COVERAGE_PATH, CATALOG_CHANGE_LOG_PATH, statePath];
  const backedUp = new Set<string>();
  for (const path of backupPaths) {
    try { await copyFile(path, join(backupDirectory, path.split("/").at(-1)!)); backedUp.add(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }

  const priorState = await readJson<ImportState | null>(statePath, null);
  const priorCodes = priorState?.manifestUpdatedAt === manifest.updatedAt ? priorState.detailFetchedProductCodes : [];
  const priorFailures = priorState?.manifestUpdatedAt === manifest.updatedAt ? priorState.failures : [];
  const state: ImportState = {
    schemaVersion: 1,
    status: "running",
    manifestUpdatedAt: manifest.updatedAt,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    planned: planned.length,
    attemptedThisRun: 0,
    detailFetchedThisRun: 0,
    failedThisRun: 0,
    incompleteAfterFetchThisRun: 0,
    detailFetchedProductCodes: [...new Set(priorCodes)],
    failures: priorFailures.slice(-500),
    backupDirectory
  };
  await writeJson(statePath, state);
  const mutableByCode = new Map(accessories.filter((item) => item.sourceProductCode).map((item) => [item.sourceProductCode!, item]));
  const categoryStats = new Map<AccessoryCategory, { detailFetched: number; detailFailed: number; attempted: number }>();
  let pending: Array<{ before: AccessoryItem; after: AccessoryItem }> = [];
  let stopReason: string | undefined;
  let consecutiveFailures = 0;

  const checkpoint = async () => {
    const merged = await upsertAccessories(pending.map(({ after }) => after));
    const mergedByCode = new Map(merged.filter((item) => item.sourceProductCode).map((item) => [item.sourceProductCode!, item]));
    const changes = pending.flatMap(({ before }) => {
      const code = before.sourceProductCode;
      const after = code ? mergedByCode.get(code) : undefined;
      if (!after) return [];
      const changedFields = meaningfulCatalogChangeFields(before, after);
      return changedFields.length > 0 ? [catalogChangeRecord("accessory", before, after, changedFields)] : [];
    });
    if (changes.length > 0) await appendCatalogChangeRecords(changes.sort((left, right) => right.changedAt.localeCompare(left.changedAt)));
    for (const { after } of pending) {
      const code = after.sourceProductCode;
      if (!code) continue;
      const mergedItem = mergedByCode.get(code);
      if (mergedItem) mutableByCode.set(code, mergedItem);
    }
    pending = [];
    state.updatedAt = new Date().toISOString();
    await writeJson(statePath, state);
  };

  await preflightInfoRobots();
  const categories = DANAWA_ACCESSORY_CATEGORIES.filter((config) => planned.some((candidate) => candidate.category === config.category));
  for (const config of categories) {
    state.activeCategory = config.category;
    const categoryCandidates = planned.filter((candidate) => candidate.category === config.category);
    const stats = { detailFetched: 0, detailFailed: 0, attempted: 0 };
    categoryStats.set(config.category, stats);
    for (const candidate of categoryCandidates) {
      const current = mutableByCode.get(candidate.product.productCode) ?? candidate.current;
      if (current.dataQuality !== "incomplete") continue;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(0, MIN_DELAY_MS - (Date.now() - lastSourceRequestAt))));
      lastSourceRequestAt = Date.now();
      state.attemptedThisRun += 1;
      stats.attempted += 1;
      try {
        const sourceUrl = canonicalDetailUrl(candidate.product, candidate.categoryId);
        const html = await fetchDanawaHtml(sourceUrl, { timeoutMs: 20000, retries: 2, userAgent: USER_AGENT } satisfies DanawaCrawlerOptions);
        if (challengePage(html)) throw new Error("STOP: product detail returned an access challenge.");
        const parsed = parseDanawaAccessoryPage(candidate.category, listItem(candidate.categoryId, candidate.product), html, candidate.categoryId);
        if (parsed.sourceProductCode !== candidate.product.productCode || parsed.category !== candidate.category || parsed.sourceCategoryId !== candidate.categoryId) {
          throw new Error("Detail parser returned a mismatched product identity.");
        }
        const after: AccessoryItem = {
          ...parsed,
          id: current.id,
          priceWon: current.priceWon ?? parsed.priceWon,
          priceCheckedAt: current.priceCheckedAt,
          imageUrl: parsed.imageUrl ?? current.imageUrl,
          specs: { ...current.specs, ...parsed.specs },
          updatedAt: new Date().toISOString()
        };
        pending.push({ before: current, after });
        state.detailFetchedThisRun += 1;
        stats.detailFetched += 1;
        if (after.dataQuality === "incomplete") state.incompleteAfterFetchThisRun += 1;
        state.detailFetchedProductCodes.push(candidate.product.productCode);
        consecutiveFailures = 0;
      } catch (error) {
        const reason = safeFailureMessage(error);
        state.failedThisRun += 1;
        stats.detailFailed += 1;
        state.failures.push({ productCode: candidate.product.productCode, category: candidate.category, failedAt: new Date().toISOString(), reason });
        consecutiveFailures += 1;
        if (blockedSourceResponse(error)) stopReason = reason;
        else if (consecutiveFailures >= 10) stopReason = "Stopped after 10 consecutive detail failures to avoid repeated source load.";
      }

      if (pending.length >= BATCH_SIZE || state.attemptedThisRun % BATCH_SIZE === 0 || stopReason) {
        await checkpoint();
        console.log(JSON.stringify({ status: stopReason ? "stopping" : "running", category: config.category, attempted: state.attemptedThisRun, detailFetched: state.detailFetchedThisRun, failed: state.failedThisRun, incompleteAfterFetch: state.incompleteAfterFetchThisRun, remainingInCategory: Math.max(0, categoryCandidates.length - stats.attempted) }));
      }
      if (stopReason) break;
    }
    if (pending.length > 0) await checkpoint();

    const sourceCategory = manifest.categories[config.categoryId];
    const sourcePages = Object.values(sourceCategory.pages);
    const expectedProductCount = sourcePages.at(-1)?.totalCount ?? sourceCategory.uniqueProductCount;
    const pagesExpected = sourcePages.at(-1)?.totalPages ?? sourcePages.length;
    const uniqueProductCount = new Set(sourcePages.flatMap((page) => page.products.map((product) => product.productCode))).size;
    const storedCategoryItems = [...mutableByCode.values()].filter((item) => item.category === config.category);
    const incompleteSpecs = storedCategoryItems.filter((item) => item.missingFields.length > 0).length;
    const listCoverage: AccessoryCrawlCategoryReport["listCoverage"] = sourceCategory.status === "complete" ? "complete" : "partial";
    const report: AccessoryCrawlCategoryReport = {
      category: config.category,
      categoryId: config.categoryId,
      totalProductCount: expectedProductCount,
      offset: 0,
      requestedLimit: uniqueProductCount,
      pagesExpected,
      pagesVisited: sourcePages.length,
      listedProducts: sourcePages.reduce((total, page) => total + page.products.length, 0),
      uniqueProducts: uniqueProductCount,
      detailFetched: stats.detailFetched,
      detailFailed: stats.detailFailed,
      missingProducts: Math.max(0, expectedProductCount - uniqueProductCount),
      incompleteSpecs,
      listCoverage,
      coverage: "partial",
      specCoverage: storedCategoryItems.every((item) => item.missingFields.length === 0) ? "complete" : "partial"
    };
    await recordAccessoryCoverage([report], {
      mode: values.all ? "all" : "sample",
      details: true,
      onlyIncomplete: true,
      lastCrawledAt: new Date().toISOString()
    });
    state.updatedAt = new Date().toISOString();
    await writeJson(statePath, state);
    if (stopReason) break;
  }

  state.status = stopReason ? (/\b(?:403|429)\b|STOP:/i.test(stopReason) ? "source-blocked" : "partial") : state.failedThisRun > 0 || state.incompleteAfterFetchThisRun > 0 ? "partial" : "complete";
  state.stoppedReason = stopReason;
  state.completedAt = new Date().toISOString();
  state.activeCategory = undefined;
  state.updatedAt = state.completedAt;
  await writeJson(statePath, state);
  console.log(JSON.stringify({
    mode: "apply",
    status: state.status,
    planned: state.planned,
    attempted: state.attemptedThisRun,
    detailFetched: state.detailFetchedThisRun,
    failed: state.failedThisRun,
    stillIncompleteAfterFetch: state.incompleteAfterFetchThisRun,
    remainingCandidates: Math.max(0, planned.length - state.attemptedThisRun),
    backupDirectory,
    stateFile: statePath,
    stoppedReason: stopReason
  }, null, 2));
}
