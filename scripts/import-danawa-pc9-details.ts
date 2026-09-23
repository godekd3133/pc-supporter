import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Part, PartCategory } from "../shared/types";
import { mergeCatalog } from "../server/catalog";
import { parseDanawaProductPage, type DanawaListItem } from "../server/danawa";
import { isListingAllowed, inferListingType } from "../server/listing";
import { readCatalogRecords, writeCatalogRecords } from "../server/repository";
import { BENCHMARK_OVERRIDES_PATH, DATA_DIR, readJson, writeJson } from "../server/storage";

type EnumeratedProduct = {
  productCode: string | number;
  name: string;
  url: string;
  priceWon?: number;
  spec?: string;
  rawSpecText?: string;
  imageUrl?: string;
};

type EnumeratedPage = {
  page: number;
  pageSize: number;
  totalPages?: number;
  totalCount?: number;
  codes: string[];
  products: EnumeratedProduct[];
  fetchedAt: string;
};

type EnumeratedCategory = {
  category: PartCategory;
  categoryId: string;
  label: string;
  pages: Record<string, EnumeratedPage>;
  status: string;
  error?: string;
};

type AllPagesManifest = {
  schemaVersion: number;
  source: string;
  updatedAt: string;
  categories: Record<string, EnumeratedCategory>;
};

type DetailCheckpointEntry = {
  status: "imported" | "rejected" | "retryable" | "abandoned";
  attempts: number;
  reason?: string;
  sourceCategoryId: string;
  sourceCategoryIds: string[];
  sourcePages: number[];
  updatedAt: string;
};

type DetailCheckpoint = {
  schemaVersion: 1;
  manifestFingerprint: string;
  updatedAt: string;
  entries: Record<string, DetailCheckpointEntry>;
};

type RootCoverage = {
  category: PartCategory;
  categoryId: string;
  label: string;
  status: string;
  expectedPages?: number;
  validatedPages: number;
  expectedProductCount?: number;
  observedProductCount: number;
  uniqueCodes: number;
  issues: string[];
};

type QueueProduct = {
  key: string;
  category: PartCategory;
  sourceCategoryId: string;
  sourceCategoryIds: string[];
  sourcePages: number[];
  productCode: string;
  name: string;
  url: string;
  priceWon?: number;
  rawSpecText?: string;
  imageUrl?: string;
};

const MANIFEST_PATH = resolve(DATA_DIR, "danawa-pc9-all-pages.json");
const CHECKPOINT_PATH = resolve(DATA_DIR, "danawa-pc9-detail-checkpoint.json");
const MIN_DELAY_MS = 900;
const REQUEST_TIMEOUT_MS = 8_000;
const REQUEST_ATTEMPTS = 2;
const MAX_FAILURE_CYCLES = 3;
const MAX_APPLY_PER_RUN = 50;
const WRITE_CHUNK_SIZE = 10;
const USER_AGENT = "PCSupporterCatalogResearch/1.0 (public product catalog; contact: pc-supporter project)";
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const limit = integerFlag("--limit", MAX_APPLY_PER_RUN, 1, MAX_APPLY_PER_RUN);
if ([...args].some((arg) => !["--apply"].includes(arg) && !arg.startsWith("--limit="))) {
  throw new Error("Allowed flags: --dry-run (default), --apply, --limit=N (1-50).");
}

class FatalSourceError extends Error {}

function integerFlag(name: string, fallback: number, min: number, max: number) {
  const raw = [...args].find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

function productKey(category: PartCategory, code: string) {
  return `${category}:${code}`;
}

function manifestFingerprint(manifest: AllPagesManifest) {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

function categoryRootTargets() {
  const raw: unknown = JSON.parse(requireText("scripts/fixtures/danawa-pc9-targets.json"));
  if (!Array.isArray(raw)) throw new Error("PC9 root fixture must be an array.");
  const targets = raw as Array<{ category: PartCategory; categoryId: string; label: string; root?: boolean }>;
  const nonCoolerRoots = targets.filter((target) => target.root && target.category !== "cooler");
  const coolerSubroots = targets.filter((target) => target.category === "cooler" && ["11336857", "11336856"].includes(target.categoryId));
  return [...nonCoolerRoots, ...coolerSubroots];
}

function requireText(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function manifestAndQueueFor(manifest: AllPagesManifest, rawCatalog: Part[]) {
  const rootTargets = categoryRootTargets();
  const rawByCategory = new Map<PartCategory, Set<string>>();
  for (const part of rawCatalog) {
    if (part.source !== "danawa" || !part.sourceProductCode) continue;
    const codes = rawByCategory.get(part.category) ?? new Set<string>();
    codes.add(part.sourceProductCode);
    rawByCategory.set(part.category, codes);
  }

  const rootCoverage: RootCoverage[] = [];
  const productCandidates = new Map<string, QueueProduct>();
  for (const root of rootTargets) {
    const categoryRecord = manifest.categories?.[root.categoryId];
    const issues: string[] = [];
    let expectedPages: number | undefined;
    let expectedProductCount: number | undefined;
    let observedProductCount = 0;
    let validatedPages = 0;
    const rootCodes = new Set<string>();

    if (!categoryRecord) {
      issues.push("root category is absent from manifest");
      rootCoverage.push({ ...root, status: "missing", validatedPages, observedProductCount, uniqueCodes: 0, issues });
      continue;
    }
    if (categoryRecord.category !== root.category || categoryRecord.categoryId !== root.categoryId) {
      issues.push("manifest category identity does not match the curated root");
    }
    if (!categoryRecord.pages || typeof categoryRecord.pages !== "object") {
      issues.push("root has no page checkpoint map");
      rootCoverage.push({ ...root, status: categoryRecord.status, validatedPages, observedProductCount, uniqueCodes: 0, issues });
      continue;
    }

    const pageOne = categoryRecord.pages["1"];
    if (!pageOne || !nonNegativeInteger(pageOne.totalCount) || !nonNegativeInteger(pageOne.pageSize) || pageOne.pageSize < 1) {
      issues.push("page 1 is missing a valid totalCount/pageSize");
    } else {
      expectedProductCount = pageOne.totalCount;
      expectedPages = pageOne.totalPages && pageOne.totalPages > 0
        ? pageOne.totalPages
        : Math.ceil(pageOne.totalCount / pageOne.pageSize);
    }

    if (categoryRecord.status !== "complete") issues.push(`category status is ${categoryRecord.status}, not complete`);
    if (expectedPages === undefined || expectedProductCount === undefined || !pageOne) {
      rootCoverage.push({ ...root, status: categoryRecord.status, validatedPages, observedProductCount, uniqueCodes: 0, issues });
      continue;
    }
    const rootPageSize = pageOne.pageSize;
    const rootTotalCount = expectedProductCount;

    for (let pageNo = 1; pageNo <= expectedPages; pageNo += 1) {
      const page = categoryRecord.pages[String(pageNo)];
      if (!page) { issues.push(`page ${pageNo} is missing`); continue; }
      const expectedRows = Math.max(0, Math.min(rootPageSize, rootTotalCount - (pageNo - 1) * rootPageSize));
      const pageCodes = Array.isArray(page.codes) ? page.codes.map(String) : [];
      const productCodes = Array.isArray(page.products) ? page.products.map((item) => String(item.productCode)) : [];
      const pageValid = page.page === pageNo
        && page.pageSize === expectedRows
        && (page.totalCount === undefined || page.totalCount === rootTotalCount)
        && (page.totalPages === undefined || page.totalPages === expectedPages)
        && pageCodes.length === expectedRows
        && productCodes.length === expectedRows
        && new Set(pageCodes).size === pageCodes.length
        && pageCodes.every((code) => /^\d+$/.test(code))
        && pageCodes.every((code) => productCodes.includes(code))
        && productCodes.every((code) => pageCodes.includes(code));
      if (!pageValid) {
        issues.push(`page ${pageNo} row/code counts do not match expected ${expectedRows}`);
        continue;
      }
      validatedPages += 1;
      observedProductCount += productCodes.length;
      for (const product of page.products) {
        const code = String(product.productCode);
        const key = productKey(root.category, code);
        rootCodes.add(code);
        const current = productCandidates.get(key);
        const sourcePages = new Set([...(current?.sourcePages ?? []), pageNo]);
        const sourceCategoryIds = new Set([...(current?.sourceCategoryIds ?? []), root.categoryId]);
        const sourceUrl = typeof product.url === "string" ? product.url : "";
        const name = typeof product.name === "string" ? product.name.trim() : "";
        if (!name || !sourceUrl) {
          issues.push(`page ${pageNo} product ${code} is missing name or URL`);
          continue;
        }
        const parsedUrl = new URL(sourceUrl);
        if (parsedUrl.hostname !== "prod.danawa.com" || parsedUrl.pathname !== "/info/" || parsedUrl.searchParams.get("pcode") !== code) {
          issues.push(`page ${pageNo} product ${code} has a non-allowlisted detail URL`);
          continue;
        }
        productCandidates.set(key, {
          key,
          category: root.category,
          sourceCategoryId: current?.sourceCategoryId ?? root.categoryId,
          sourceCategoryIds: [...sourceCategoryIds].sort(),
          sourcePages: [...sourcePages].sort((a, b) => a - b),
          productCode: code,
          name,
          url: sourceUrl,
          ...(typeof product.priceWon === "number" && Number.isFinite(product.priceWon) && product.priceWon > 0 ? { priceWon: product.priceWon } : {}),
          ...(typeof product.rawSpecText === "string" ? { rawSpecText: product.rawSpecText } : typeof product.spec === "string" ? { rawSpecText: product.spec } : {})
        });
      }
    }
    if (validatedPages !== expectedPages) issues.push(`validated ${validatedPages}/${expectedPages} expected pages`);
    if (observedProductCount !== expectedProductCount) issues.push(`observed ${observedProductCount}/${expectedProductCount} expected root rows`);
    if (rootCodes.size !== expectedProductCount) issues.push(`unique product codes ${rootCodes.size} do not match totalCount ${expectedProductCount}`);
    rootCoverage.push({
      category: root.category,
      categoryId: root.categoryId,
      label: root.label,
      status: categoryRecord.status,
      expectedPages,
      validatedPages,
      expectedProductCount,
      observedProductCount,
      uniqueCodes: rootCodes.size,
      issues
    });
  }

  const rootsComplete = rootCoverage.length === 10
    && new Set(rootCoverage.map((root) => root.category)).size === 9
    && rootCoverage.every((root) => root.issues.length === 0 && root.status === "complete");
  const uniqueProducts = [...productCandidates.values()];
  const alreadyInCatalog = uniqueProducts.filter((item) => rawByCategory.get(item.category)?.has(item.productCode)).length;
  const pendingProducts = uniqueProducts.filter((item) => !rawByCategory.get(item.category)?.has(item.productCode));
  const logicalCategories = [...new Set(rootTargets.map((root) => root.category))];
  const byCategory = Object.fromEntries(logicalCategories.map((category) => {
    const candidates = uniqueProducts.filter((item) => item.category === category);
    const existing = candidates.filter((item) => rawByCategory.get(item.category)?.has(item.productCode)).length;
    return [category, { uniqueRootProducts: candidates.length, alreadyInRawCatalog: existing, newToCatalog: candidates.length - existing }];
  }));
  return {
    rootsComplete,
    rootCoverage,
    uniqueProducts,
    pendingProducts,
    alreadyInCatalog,
    byCategory
  };
}

function preflightRejectionReason(item: QueueProduct) {
  const listingType = inferListingType({ category: item.category, name: item.name, rawSpecText: item.rawSpecText });
  if (listingType === "accessory" || listingType === "used" || listingType === "overseas") return `listing-type-${listingType}`;
  const identity = `${item.name} ${item.rawSpecText ?? ""}`;
  if (/(?:서버\s*용|서버\s*전용|\bserver\b|rackmount|랙마운트|4U\s*(?:서버|케이스|랙))/i.test(identity)) return "server-or-rackmount-identity";
  if (item.category === "cooler" && /(?:써멀|서멀|thermal\s*(?:paste|grease)|쿨링\s*팬|케이스\s*팬|cooling\s*fan|fan\s*only|팬\s*단품|(?:^|\s)P(?:12|14|18)\s+(?:Pro|Max|PWM))/i.test(identity)) return "cooler-accessory-identity";
  return undefined;
}

function partRejectionReason(part: Part) {
  if (!isListingAllowed(part, "all")) return "listing-policy-or-category-identity";
  if (part.listingType === "used" || part.listingType === "overseas") return `listing-type-${part.listingType}`;
  const identity = `${part.name} ${part.rawSpecText ?? ""}`;
  if (/(?:서버\s*용|서버\s*전용|\bserver\b|rackmount|랙마운트|4U\s*(?:서버|케이스|랙))/i.test(identity)) return "server-or-rackmount-identity";
  if (part.category === "cooler" && /(?:써멀|서멀|thermal\s*(?:paste|grease)|쿨링\s*팬|케이스\s*팬|cooling\s*fan|fan\s*only|팬\s*단품|(?:^|\s)P(?:12|14|18)\s+(?:Pro|Max|PWM))/i.test(identity)) return "cooler-accessory-identity";
  return undefined;
}

async function hashFile(path: string) {
  let raw: Buffer;
  try { raw = await readFile(path); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") raw = Buffer.alloc(0);
    else throw error;
  }
  return createHash("sha256").update(raw).digest("hex");
}

async function persistNewRawParts(parts: Part[], expectedBenchmarkHash: string) {
  if (parts.length > 0) {
    const latest = await readCatalogRecords();
    const keys = new Set(latest.map((part) => `${part.category}:${part.sourceProductCode ?? part.id}`));
    const safe = parts.filter((part) => !keys.has(`${part.category}:${part.sourceProductCode ?? part.id}`));
    if (safe.length > 0) await writeCatalogRecords(mergeCatalog(latest, safe));
  }
  const currentBenchmarkHash = await hashFile(BENCHMARK_OVERRIDES_PATH);
  if (currentBenchmarkHash !== expectedBenchmarkHash) throw new Error("Benchmark overrides changed during detail import; stop and inspect persistence.");
}

let lastDetailRequestAt = 0;

async function robotsPreflight() {
  const response = await fetch("https://prod.danawa.com/robots.txt", {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (response.status === 403 || response.status === 429) throw new FatalSourceError(`robots.txt returned HTTP ${response.status}`);
  if (!response.ok) throw new Error(`robots.txt fetch failed: HTTP ${response.status}`);
  const text = await response.text();
  let wildcard = false;
  let hasRules = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [keyRaw, ...valueParts] = line.split(":");
    const key = keyRaw?.trim().toLowerCase();
    const value = valueParts.join(":").trim();
    if (key === "user-agent") { if (hasRules) { wildcard = false; hasRules = false; } if (!hasRules) wildcard = value === "*"; }
    else if ((key === "allow" || key === "disallow") && wildcard) {
      hasRules = true;
      if (key === "disallow" && value && "/info/".startsWith(value)) throw new FatalSourceError(`robots.txt disallows /info/ via ${value}`);
    }
  }
}

async function fetchDetail(code: string) {
  const url = `https://prod.danawa.com/info/?pcode=${code}`;
  if (!/^\d+$/.test(code) || !url.startsWith("https://prod.danawa.com/info/?pcode=")) throw new Error("Blocked invalid detail pcode.");
  let lastError: unknown;
  for (let attempt = 0; attempt < REQUEST_ATTEMPTS; attempt += 1) {
    const wait = Math.max(0, MIN_DELAY_MS - (Date.now() - lastDetailRequestAt));
    if (wait) await sleep(wait);
    lastDetailRequestAt = Date.now();
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (response.status === 403 || response.status === 429) throw new FatalSourceError(`HTTP ${response.status} blocked detail crawl for pcode=${code}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (/접근이 제한|비정상적인 접근|자동입력 방지|보안문자|로봇이 아닙니다|captcha/i.test(html)) throw new FatalSourceError(`Challenge or access-denied HTML for pcode=${code}`);
      if (html.length < 500) throw new Error(`Empty detail HTML for pcode=${code}`);
      return html;
    } catch (error) {
      if (error instanceof FatalSourceError) throw error;
      lastError = error;
      if (attempt + 1 < REQUEST_ATTEMPTS) await sleep(MIN_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Detail request retries exhausted for pcode=${code}`);
}

async function readManifest(): Promise<AllPagesManifest | null> {
  const manifest = await readJson<AllPagesManifest | null>(MANIFEST_PATH, null);
  if (!manifest) return null;
  if (manifest.schemaVersion !== 1 || !manifest.categories || typeof manifest.categories !== "object") throw new Error("All-pages manifest schema is invalid.");
  return manifest;
}

async function readCheckpoint(fingerprint: string): Promise<DetailCheckpoint> {
  const checkpoint = await readJson<DetailCheckpoint | null>(CHECKPOINT_PATH, null);
  if (!checkpoint) return { schemaVersion: 1, manifestFingerprint: fingerprint, updatedAt: new Date().toISOString(), entries: {} };
  if (checkpoint.schemaVersion !== 1 || checkpoint.manifestFingerprint !== fingerprint) {
    throw new Error("Detail checkpoint does not match the validated all-pages manifest; preserve it and review before resetting.");
  }
  return checkpoint;
}

function stateDone(state: DetailCheckpointEntry | undefined) {
  return state?.status === "imported" || state?.status === "rejected" || state?.status === "abandoned";
}

async function main() {
  const manifest = await readManifest();
  if (!manifest) {
    console.log(JSON.stringify({ mode: apply ? "apply-blocked" : "dry-run", manifestPath: MANIFEST_PATH, rootsComplete: false, issue: "all-pages manifest is not available yet", detailRequests: 0 }, null, 2));
    if (apply) process.exitCode = 1;
    return;
  }

  const catalog = await readCatalogRecords();
  const validation = manifestAndQueueFor(manifest, catalog);
  const fingerprint = manifestFingerprint(manifest);
  const checkpoint = await readCheckpoint(fingerprint);
  const rawCodes = new Set(catalog.filter((part) => part.source === "danawa" && part.sourceProductCode).map((part) => productKey(part.category, part.sourceProductCode!)));
  const queue = validation.pendingProducts.filter((item) => !rawCodes.has(item.key));
  const preflightRejected = queue.filter((item) => preflightRejectionReason(item) !== undefined);
  const newCandidates = queue.filter((item) => preflightRejectionReason(item) === undefined);
  const pendingFromCheckpoint = newCandidates.filter((item) => !stateDone(checkpoint.entries[item.key]) && (checkpoint.entries[item.key]?.attempts ?? 0) < MAX_FAILURE_CYCLES);
  const checkpointSummary = Object.values(checkpoint.entries).reduce((summary, entry) => {
    summary[entry.status] = (summary[entry.status] ?? 0) + 1;
    return summary;
  }, {} as Record<string, number>);

  if (!apply) {
    console.log(JSON.stringify({
      mode: "dry-run",
      manifestPath: MANIFEST_PATH,
      manifestUpdatedAt: manifest.updatedAt,
      manifestFingerprint: fingerprint,
      allNineLogicalCategoriesComplete: validation.rootsComplete,
      rootCoverage: validation.rootCoverage,
      categoryCounts: validation.byCategory,
      uniqueRootProductCodes: validation.uniqueProducts.length,
      alreadyInRawCatalog: validation.alreadyInCatalog,
      newToCatalog: validation.pendingProducts.length,
      obviousListingRejects: preflightRejected.length,
      detailQueuePending: pendingFromCheckpoint.length,
      checkpoint: { path: CHECKPOINT_PATH, entries: Object.keys(checkpoint.entries).length, statuses: checkpointSummary },
      maxDetailCodesPerApply: MAX_APPLY_PER_RUN,
      writeChunkSize: WRITE_CHUNK_SIZE,
      delayMs: MIN_DELAY_MS,
      retries: REQUEST_ATTEMPTS,
      timeoutMs: REQUEST_TIMEOUT_MS,
      detailRequests: 0,
      queueReadiness: validation.rootsComplete ? "ready-after-explicit-apply" : "blocked-until-all-required-source-roots-validate",
      fullCoverageClaim: validation.rootsComplete ? "all nine logical categories validated across ten source roots; quote-catalog semantics still require review" : "not-established"
    }, null, 2));
    return;
  }

  if (!validation.rootsComplete) {
    console.log(JSON.stringify({ mode: "apply-blocked", manifestPath: MANIFEST_PATH, allNineRootsComplete: false, rootCoverage: validation.rootCoverage, detailRequests: 0 }, null, 2));
    process.exitCode = 1;
    return;
  }

  await robotsPreflight();
  lastDetailRequestAt = Date.now();
  const benchmarkHashBefore = await hashFile(BENCHMARK_OVERRIDES_PATH);
  const requestQueue = pendingFromCheckpoint.slice(0, limit);
  let detailsAttempted = 0;
  let imported = 0;
  let rejected = 0;
  let retryable = 0;
  let abandoned = 0;
  let failureCount = 0;
  let blocked = false;

  for (const item of preflightRejected) {
    if (stateDone(checkpoint.entries[item.key])) continue;
    checkpoint.entries[item.key] = {
      status: "rejected",
      attempts: 0,
      reason: preflightRejectionReason(item),
      sourceCategoryId: item.sourceCategoryId,
      sourceCategoryIds: item.sourceCategoryIds,
      sourcePages: item.sourcePages,
      updatedAt: new Date().toISOString()
    };
    rejected += 1;
  }
  checkpoint.updatedAt = new Date().toISOString();
  await writeJson(CHECKPOINT_PATH, checkpoint);

  for (let offset = 0; offset < requestQueue.length; offset += WRITE_CHUNK_SIZE) {
    const batch = requestQueue.slice(offset, offset + WRITE_CHUNK_SIZE);
    const parsedParts: Part[] = [];
    const batchStatuses = new Map<string, DetailCheckpointEntry>();
    for (const item of batch) {
      const reason = preflightRejectionReason(item);
      if (reason) {
        batchStatuses.set(item.key, { status: "rejected", attempts: 1, reason, sourceCategoryId: item.sourceCategoryId, sourceCategoryIds: item.sourceCategoryIds, sourcePages: item.sourcePages, updatedAt: new Date().toISOString() });
        rejected += 1;
        continue;
      }
      let detailFetched = false;
      try {
        const html = await fetchDetail(item.productCode);
        detailFetched = true;
        detailsAttempted += 1;
        const listItem: DanawaListItem = {
          name: item.name,
          url: item.url,
          sourceProductCode: item.productCode,
          ...(item.priceWon ? { priceWon: item.priceWon } : {}),
          ...(item.rawSpecText ? { rawSpecText: item.rawSpecText } : {}),
          ...(item.imageUrl ? { imageUrl: item.imageUrl } : {})
        };
        const part = parseDanawaProductPage(item.category, listItem, html, item.sourceCategoryId);
        if (!part.sourceProductCode || part.sourceProductCode !== item.productCode || !part.name || part.category !== item.category) {
          batchStatuses.set(item.key, { status: "rejected", attempts: 1, reason: "invalid parsed detail identity", sourceCategoryId: item.sourceCategoryId, sourceCategoryIds: item.sourceCategoryIds, sourcePages: item.sourcePages, updatedAt: new Date().toISOString() });
          rejected += 1;
          continue;
        }
        const rejectionReason = partRejectionReason(part);
        if (rejectionReason) {
          batchStatuses.set(item.key, { status: "rejected", attempts: 1, reason: rejectionReason, sourceCategoryId: item.sourceCategoryId, sourceCategoryIds: item.sourceCategoryIds, sourcePages: item.sourcePages, updatedAt: new Date().toISOString() });
          rejected += 1;
          continue;
        }
        parsedParts.push(part);
        batchStatuses.set(item.key, { status: "imported", attempts: 1, sourceCategoryId: item.sourceCategoryId, sourceCategoryIds: item.sourceCategoryIds, sourcePages: item.sourcePages, updatedAt: new Date().toISOString() });
      } catch (error) {
        if (error instanceof FatalSourceError) {
          blocked = true;
          break;
        }
        if (!detailFetched) detailsAttempted += 1;
        const reason = error instanceof Error ? error.message : String(error);
        const attempts = (checkpoint.entries[item.key]?.attempts ?? 0) + 1;
        if (detailFetched) {
          batchStatuses.set(item.key, {
            status: "rejected", attempts, reason: `detail parse failed: ${reason}`,
            sourceCategoryId: item.sourceCategoryId, sourceCategoryIds: item.sourceCategoryIds, sourcePages: item.sourcePages, updatedAt: new Date().toISOString()
          });
          rejected += 1;
        } else {
          failureCount += 1;
          const canRetry = attempts < MAX_FAILURE_CYCLES;
          batchStatuses.set(item.key, {
            status: canRetry ? "retryable" : "abandoned",
            attempts,
            reason,
            sourceCategoryId: item.sourceCategoryId,
            sourceCategoryIds: item.sourceCategoryIds,
            sourcePages: item.sourcePages,
            updatedAt: new Date().toISOString()
          });
          if (canRetry) retryable += 1;
          else abandoned += 1;
          if (failureCount >= 3 || detailsAttempted >= 10 && failureCount / detailsAttempted >= 0.1) {
            blocked = true;
            break;
          }
        }
      }
    }

    const latestCatalog = await readCatalogRecords();
    const latestKeys = new Set(latestCatalog.map((part) => `${part.category}:${part.sourceProductCode ?? part.id}`));
    const safeBatch = parsedParts.filter((part) => !latestKeys.has(`${part.category}:${part.sourceProductCode ?? part.id}`));
    if (safeBatch.length > 0) await writeCatalogRecords(mergeCatalog(latestCatalog, safeBatch));
    const benchmarkHashAfter = await hashFile(BENCHMARK_OVERRIDES_PATH);
    if (benchmarkHashAfter !== benchmarkHashBefore) throw new Error("Benchmark overrides changed during detail import; stop and inspect persistence.");

    for (const [key, state] of batchStatuses) {
      checkpoint.entries[key] = state;
      if (state.status === "imported") imported += 1;
    }
    checkpoint.updatedAt = new Date().toISOString();
    await writeJson(CHECKPOINT_PATH, checkpoint);
    if (blocked) break;
  }

  const updatedRaw = await readCatalogRecords();
  const updatedRawCodes = new Set(updatedRaw.filter((part) => part.source === "danawa" && part.sourceProductCode).map((part) => productKey(part.category, part.sourceProductCode!)));
  const remainingQueue = validation.pendingProducts.filter((item) => {
    if (updatedRawCodes.has(item.key)) return false;
    const state = checkpoint.entries[item.key];
    return !stateDone(state) && (state?.attempts ?? 0) < MAX_FAILURE_CYCLES;
  });
  console.log(JSON.stringify({
    mode: "apply",
    manifestFingerprint: fingerprint,
    rootCoverageValidated: true,
    requestBound: { maxDetailCodes: limit, writeChunkSize: WRITE_CHUNK_SIZE, delayMs: MIN_DELAY_MS, attempts: REQUEST_ATTEMPTS, timeoutMs: REQUEST_TIMEOUT_MS },
    detailRequestsAttempted: detailsAttempted,
    imported,
    rejected,
    retryable,
    abandoned,
    blocked,
    remainingQueue: remainingQueue.length,
    checkpointStatuses: Object.values(checkpoint.entries).reduce((summary, state) => { summary[state.status] = (summary[state.status] ?? 0) + 1; return summary; }, {} as Record<string, number>),
    catalogRows: updatedRaw.length,
    danawaCatalogRows: updatedRaw.filter((part) => part.source === "danawa").length,
    benchmarkOverridesSha256: benchmarkHashBefore
  }, null, 2));
  if (blocked) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
