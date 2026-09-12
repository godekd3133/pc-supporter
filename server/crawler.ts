import "dotenv/config";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { CrawlCategoryReport, CrawlManifest, CrawlPageFailure, CrawlPageRetryBatchProgress, CrawlPageRetryRecord, CrawlStatus, Part, PartCategory } from "../shared/types";
import { DANAWA_CATEGORIES, crawlDanawaCategory, retryDanawaCategoryPage, type DanawaPageRetryResult } from "./danawa";
import { loadCatalog, upsertCatalog } from "./catalog";
import { CRAWL_LOCK_PATH, CRAWL_MANIFEST_PATH, CRAWL_STATE_PATH, createExclusiveFile, ensureDataDirectory, readJson, removeGeneratedFile, writeJson } from "./storage";
import { appendCatalogChangeRecords, catalogChangeRecord, catalogChangeSummary, catalogItemKey, meaningfulCatalogChangeFields } from "./catalog-change-log";

export type CrawlJobOptions = {
  category?: PartCategory;
  all?: boolean;
  pages?: number;
  limitPerCategory?: number;
  details?: boolean;
  delayMs?: number;
  dryRun?: boolean;
  resume?: boolean;
  onUpdate?: (status: CrawlStatus) => void;
};

export type CrawlPageRetryOptions = {
  category: PartCategory;
  page: number;
  expectedManifestStartedAt?: string;
  details?: boolean;
  delayMs?: number;
  timeoutMs?: number;
  retries?: number;
  onUpdate?: (status: CrawlStatus) => void;
};

export type CrawlPageRetryBatchOptions = {
  expectedManifestStartedAt?: string;
  details?: boolean;
  delayMs?: number;
  timeoutMs?: number;
  retries?: number;
  onUpdate?: (status: CrawlStatus) => void;
};

let activeJob: Promise<CrawlStatus> | null = null;
let activeJobAbortController: AbortController | null = null;
let activeJobOperation: CrawlStatus["operation"] | null = null;

async function lockOwnerPid() {
  try {
    const raw = await readFile(CRAWL_LOCK_PATH, "utf8");
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

async function acquireCrawlLock() {
  await ensureDataDirectory();
  try {
    await createExclusiveFile(CRAWL_LOCK_PATH, `${process.pid}\n`);
  } catch (error) {
    const ownerPid = await lockOwnerPid();
    if (processIsAlive(ownerPid)) throw new Error(`이미 다른 크롤러 프로세스(${ownerPid})가 실행 중입니다.`);
    await removeGeneratedFile(CRAWL_LOCK_PATH);
    await createExclusiveFile(CRAWL_LOCK_PATH, `${process.pid}\n`);
  }
  return () => removeGeneratedFile(CRAWL_LOCK_PATH);
}

function defaultStatus(): CrawlStatus {
  return {
    status: "idle",
    mode: "sample",
    categoriesCompleted: 0,
    categoriesTotal: DANAWA_CATEGORIES.length,
    pagesVisited: 0,
    pagesExpected: 0,
    listedProducts: 0,
    productsSeen: 0,
    productsUpdated: 0,
    detailFetched: 0,
    detailFailed: 0,
    failedProducts: 0,
    missingProducts: 0,
    incompleteSpecs: 0,
    coverage: "partial",
    specCoverage: "partial",
    pageRetries: 0,
    failedPages: [],
    manifestPath: "data/crawl-manifest.json"
  };
}

export async function readCrawlStatus() {
  const stored = await (await import("./storage")).readJson<Partial<CrawlStatus>>(CRAWL_STATE_PATH, {});
  const normalized = {
    ...defaultStatus(),
    ...stored,
    failedProducts: stored.failedProducts ?? 0,
    pagesVisited: stored.pagesVisited ?? 0,
    pagesExpected: stored.pagesExpected ?? 0,
    listedProducts: stored.listedProducts ?? 0,
    detailFetched: stored.detailFetched ?? 0,
    detailFailed: stored.detailFailed ?? 0,
    missingProducts: stored.missingProducts ?? 0,
    incompleteSpecs: stored.incompleteSpecs ?? 0,
    coverage: stored.coverage ?? "partial",
    specCoverage: stored.specCoverage ?? "partial",
    pageRetries: stored.pageRetries ?? 0,
    failedPages: stored.failedPages ?? []
  };
  if (normalized.status === "running" && !activeJob) {
    const ownerPid = await lockOwnerPid();
    if (!processIsAlive(ownerPid)) {
      const stale: CrawlStatus = {
        ...normalized,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: "이전 크롤러 프로세스가 중단되어 작업이 완료되지 않았습니다.",
        message: "중단된 크롤 작업을 복구했습니다. 다시 실행해 주세요.",
        workerPid: ownerPid
      };
      await publish(stale);
      return stale;
    }
  }
  return normalized;
}

async function publish(status: CrawlStatus, onUpdate?: (status: CrawlStatus) => void) {
  await ensureDataDirectory();
  await writeJson(CRAWL_STATE_PATH, status);
  onUpdate?.(status);
}

async function publishManifest(manifest: CrawlManifest) {
  await ensureDataDirectory();
  await writeJson(CRAWL_MANIFEST_PATH, manifest);
}

export function crawlPartChangeRecords(beforeCatalog: Part[], afterCatalog: Part[], collected: Part[], changedAt: string) {
  const beforeByKey = new Map(beforeCatalog.map((part) => [catalogItemKey(part), part]));
  const afterByKey = new Map(afterCatalog.map((part) => [catalogItemKey(part), part]));
  const collectedByKey = new Map(collected.map((part) => [catalogItemKey(part), part]));
  return [...collectedByKey.keys()].flatMap((key) => {
    const before = beforeByKey.get(key);
    const after = afterByKey.get(key);
    if (!before || !after) return [];
    const changedFields = meaningfulCatalogChangeFields(before, after);
    return changedFields.length > 0 ? [catalogChangeRecord("part", before, after, changedFields, { changedAt })] : [];
  });
}

type DanawaCategoryConfig = (typeof DANAWA_CATEGORIES)[number];

export type CrawlResumePlan = {
  available: boolean;
  reason?: string;
  completedReports: CrawlCategoryReport[];
  completedCategories: PartCategory[];
  remainingCategories: PartCategory[];
  remainingConfigs: DanawaCategoryConfig[];
};

function categoryConfigsFor(category?: PartCategory) {
  return category
    ? DANAWA_CATEGORIES.filter((config) => config.category === category)
    : DANAWA_CATEGORIES;
}

export function crawlResumePlanFor(previousManifest: CrawlManifest | null, category?: PartCategory): CrawlResumePlan {
  const scopeConfigs = categoryConfigsFor(category);
  const unavailable = (reason: string): CrawlResumePlan => ({
    available: false,
    reason,
    completedReports: [],
    completedCategories: [],
    remainingCategories: scopeConfigs.map((config) => config.category),
    remainingConfigs: scopeConfigs
  });

  if (!previousManifest) return unavailable("재개할 exhaustive manifest가 없습니다.");
  if (previousManifest.mode !== "all") return unavailable("샘플 수집은 재개할 수 없습니다. 전체 수집을 먼저 실행해 주세요.");
  if (previousManifest.category !== category) {
    const previousScope = previousManifest.category ? `${previousManifest.category} 범주` : "전체 핵심 부품";
    const requestedScope = category ? `${category} 범주` : "전체 핵심 부품";
    return unavailable(`이전 수집 범위(${previousScope})와 재개 범위(${requestedScope})가 다릅니다.`);
  }

  const reportsByCategory = new Map(previousManifest.categories.map((report) => [report.category, report]));
  const completedReports = scopeConfigs
    .map((config) => reportsByCategory.get(config.category))
    .filter((report): report is CrawlCategoryReport => Boolean(report && report.coverage === "complete" && report.specCoverage === "complete"));
  const completedCategories = completedReports.map((report) => report.category);
  const completedSet = new Set(completedCategories);
  const remainingConfigs = scopeConfigs.filter((config) => !completedSet.has(config.category));
  return {
    available: remainingConfigs.length > 0,
    ...(remainingConfigs.length === 0 ? { reason: "재개할 미완료 범주가 없습니다." } : {}),
    completedReports,
    completedCategories,
    remainingCategories: remainingConfigs.map((config) => config.category),
    remainingConfigs
  };
}

function addCategoryReportToStatus(status: CrawlStatus, report: CrawlCategoryReport) {
  status.categoriesCompleted += 1;
  status.pagesVisited += report.pagesVisited;
  status.pagesExpected += report.pagesExpected;
  status.listedProducts += report.listedProducts;
  status.productsSeen += report.uniqueProducts;
  status.detailFetched += report.detailFetched;
  status.detailFailed += report.detailFailed;
  status.failedProducts += report.detailFailed;
  status.missingProducts += report.missingProducts;
  status.incompleteSpecs += report.incompleteSpecs;
}

function addCategoryTelemetryToStatus(status: CrawlStatus, report: CrawlCategoryReport) {
  status.pageRetries = (status.pageRetries ?? 0) + (report.pageRetries ?? 0);
  status.failedPages = [...(status.failedPages ?? []), ...(report.failedPages ?? [])];
}

function addCategoryReportToManifest(manifest: CrawlManifest, report: CrawlCategoryReport) {
  manifest.categories.push(report);
  manifest.totalExpectedProducts += report.totalProductCount ?? report.uniqueProducts + report.missingProducts;
  manifest.totalUniqueProducts += report.uniqueProducts;
  manifest.totalDetailFetched += report.detailFetched;
  manifest.totalDetailFailed += report.detailFailed;
  manifest.totalMissingProducts += report.missingProducts;
  manifest.totalIncompleteSpecs += report.incompleteSpecs;
  manifest.totalPageRetries = (manifest.totalPageRetries ?? 0) + (report.pageRetries ?? 0);
  manifest.failedPages = [...(manifest.failedPages ?? []), ...(report.failedPages ?? [])];
}

export type CrawlPageRetryPlan = {
  available: boolean;
  reason?: string;
  report?: CrawlCategoryReport;
  failure?: CrawlPageFailure;
};

export type CrawlPageRetryBatchPlan = {
  available: boolean;
  reason?: string;
  failures: CrawlPageFailure[];
};

function retryablePageFailuresFor(previousManifest: CrawlManifest) {
  const seen = new Set<string>();
  return previousManifest.categories.flatMap((report) => (report.failedPages ?? []).filter((failure) => {
    if (failure.stage !== "list") return false;
    const key = `${failure.category}:${failure.page}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

export function crawlPageRetryPlanFor(previousManifest: CrawlManifest | null, category: PartCategory, page: number): CrawlPageRetryPlan {
  if (!previousManifest) return { available: false, reason: "재시도할 exhaustive manifest가 없습니다." };
  if (previousManifest.mode !== "all") return { available: false, reason: "샘플 수집 페이지는 단독 재시도할 수 없습니다. 전체 수집을 먼저 실행해 주세요." };
  if (previousManifest.category !== undefined && previousManifest.category !== category) {
    return { available: false, reason: `이전 수집 범위(${previousManifest.category})에 ${category} 페이지가 없습니다.` };
  }
  const report = previousManifest.categories.find((candidate) => candidate.category === category);
  if (!report) return { available: false, reason: `${category} 카테고리의 수집 report가 없습니다.` };
  const failure = (report.failedPages ?? []).find((candidate) => candidate.category === category && candidate.page === page && candidate.stage === "list");
  if (!failure) return { available: false, reason: `${category} ${page}페이지에 재시도할 목록 실패 기록이 없습니다.` };
  return { available: true, report, failure };
}

export function crawlPageRetryBatchPlanFor(previousManifest: CrawlManifest | null): CrawlPageRetryBatchPlan {
  if (!previousManifest) return { available: false, reason: "재시도할 exhaustive manifest가 없습니다.", failures: [] };
  if (previousManifest.mode !== "all") return { available: false, reason: "샘플 수집 페이지는 일괄 재시도할 수 없습니다. 전체 수집을 먼저 실행해 주세요.", failures: [] };
  const failures = retryablePageFailuresFor(previousManifest);
  if (failures.length === 0) return { available: false, reason: "재시도할 목록 실패 페이지가 없습니다.", failures: [] };
  return { available: true, failures };
}

function manifestReportTotals(manifest: CrawlManifest) {
  return manifest.categories.reduce((totals, report) => ({
    pagesVisited: totals.pagesVisited + report.pagesVisited,
    pagesExpected: totals.pagesExpected + report.pagesExpected,
    listedProducts: totals.listedProducts + report.listedProducts,
    uniqueProducts: totals.uniqueProducts + report.uniqueProducts,
    detailFetched: totals.detailFetched + report.detailFetched,
    detailFailed: totals.detailFailed + report.detailFailed,
    missingProducts: totals.missingProducts + report.missingProducts,
    incompleteSpecs: totals.incompleteSpecs + report.incompleteSpecs,
    pageRetries: totals.pageRetries + (report.pageRetries ?? 0),
    failedPages: [...totals.failedPages, ...(report.failedPages ?? [])]
  }), {
    pagesVisited: 0,
    pagesExpected: 0,
    listedProducts: 0,
    uniqueProducts: 0,
    detailFetched: 0,
    detailFailed: 0,
    missingProducts: 0,
    incompleteSpecs: 0,
    pageRetries: 0,
    failedPages: [] as CrawlPageFailure[]
  });
}

function recalculateManifestTotals(manifest: CrawlManifest) {
  const totals = manifestReportTotals(manifest);
  manifest.totalExpectedProducts = manifest.categories.reduce((sum, report) => sum + (report.totalProductCount ?? report.uniqueProducts + report.missingProducts), 0);
  manifest.totalUniqueProducts = totals.uniqueProducts;
  manifest.totalDetailFetched = totals.detailFetched;
  manifest.totalDetailFailed = totals.detailFailed;
  manifest.totalMissingProducts = totals.missingProducts;
  manifest.totalIncompleteSpecs = totals.incompleteSpecs;
  manifest.totalPageRetries = totals.pageRetries;
  manifest.failedPages = totals.failedPages;
  const expectedCategoryCount = categoryConfigsFor(manifest.category).length;
  manifest.coverage = manifest.mode === "all"
    && manifest.categories.length === expectedCategoryCount
    && manifest.categories.every((report) => report.coverage === "complete")
    ? "complete"
    : "partial";
  manifest.specCoverage = manifest.mode === "all"
    && manifest.categories.length === expectedCategoryCount
    && manifest.categories.every((report) => report.specCoverage === "complete")
    ? "complete"
    : "partial";
}

function statusFromManifest(manifest: CrawlManifest, startedAt: string, operation: CrawlStatus["operation"] = "page-retry", pageRetryBatch?: CrawlPageRetryBatchProgress): CrawlStatus {
  const totals = manifestReportTotals(manifest);
  const scopeCount = categoryConfigsFor(manifest.category).length;
  return {
    status: "running",
    mode: manifest.mode,
    operation,
    ...(manifest.category ? { category: manifest.category } : {}),
    startedAt,
    manifestStartedAt: manifest.startedAt,
    categoriesCompleted: manifest.categories.length,
    categoriesTotal: scopeCount,
    pagesVisited: totals.pagesVisited,
    pagesExpected: totals.pagesExpected,
    listedProducts: totals.listedProducts,
    productsSeen: totals.uniqueProducts,
    productsUpdated: 0,
    detailFetched: totals.detailFetched,
    detailFailed: totals.detailFailed,
    failedProducts: totals.detailFailed,
    missingProducts: totals.missingProducts,
    incompleteSpecs: totals.incompleteSpecs,
    coverage: manifest.coverage,
    specCoverage: manifest.specCoverage,
    ...(manifest.changeSummary ? { changeSummary: manifest.changeSummary } : {}),
    pageRetries: manifest.totalPageRetries ?? totals.pageRetries,
    failedPages: totals.failedPages,
    ...(pageRetryBatch ? { pageRetryBatch } : {}),
    manifestPath: "data/crawl-manifest.json",
    workerPid: process.pid,
    message: "실패 페이지를 다시 수집하고 있습니다."
  };
}

function replaceFailedPage(report: CrawlCategoryReport, category: PartCategory, page: number, result: DanawaPageRetryResult) {
  const previousFailures = report.failedPages ?? [];
  report.failedPages = previousFailures
    .filter((failure) => !(failure.category === category && failure.page === page && failure.stage === "list"))
    .concat(result.failedPages);
  report.pageRetries = (report.pageRetries ?? 0) + result.pageRetries;
  if (result.error) {
    report.error = result.error;
    report.coverage = "partial";
    return;
  }

  report.error = undefined;
  report.lastSuccessfulPage = Math.max(report.lastSuccessfulPage ?? 0, page);
  report.pageRetries = (report.pageRetries ?? 0);
  report.detailFetched += result.detailFetched;
  report.detailFailed += result.detailFailed;
  report.incompleteSpecs += result.incompleteSpecs;
  report.totalProductCount ??= result.totalProductCount;
  report.pageSize ??= result.pageSize;
  const hasPageCheckpoint = report.pageProductCodes !== undefined;
  if (hasPageCheckpoint) {
    report.successfulPages = [...new Set([...(report.successfulPages ?? []), ...result.successfulPages])].sort((left, right) => left - right);
    report.pageProductCodes = { ...(report.pageProductCodes ?? {}), ...result.pageProductCodes };
    const pageCodes = Object.values(report.pageProductCodes).flat();
    report.listedProducts = pageCodes.length;
    report.uniqueProducts = new Set(pageCodes).size;
    report.pagesVisited = report.successfulPages.length;
    report.missingProducts = report.totalProductCount === undefined
      ? report.missingProducts
      : Math.max(0, report.totalProductCount - report.uniqueProducts);
  } else {
    report.pagesVisited = Math.min(report.pagesExpected, report.pagesVisited + 1);
    report.listedProducts += result.listedProducts;
    report.uniqueProducts += result.uniqueProducts;
    report.missingProducts = Math.max(0, report.missingProducts - result.uniqueProducts);
  }
  const listComplete = report.totalProductCount !== undefined
    && report.failedPages.length === 0
    && report.pagesVisited >= report.pagesExpected
    && report.uniqueProducts >= report.totalProductCount;
  report.coverage = listComplete && report.detailFailed === 0 ? "complete" : "partial";
  report.specCoverage = report.incompleteSpecs === 0 ? "complete" : "partial";
}

function mergeCatalogChangeSummary(manifest: CrawlManifest, records: ReturnType<typeof crawlPartChangeRecords>, inspectedProducts: number) {
  const next = catalogChangeSummary(records, inspectedProducts);
  const previous = manifest.changeSummary;
  manifest.changeSummary = previous
    ? {
        inspectedProducts: previous.inspectedProducts + next.inspectedProducts,
        changedProducts: previous.changedProducts + next.changedProducts,
        priceChangedProducts: previous.priceChangedProducts + next.priceChangedProducts,
        qualityChangedProducts: previous.qualityChangedProducts + next.qualityChangedProducts,
        missingFieldChangedProducts: previous.missingFieldChangedProducts + next.missingFieldChangedProducts,
        specChangedProducts: previous.specChangedProducts + next.specChangedProducts
      }
    : next;
}

async function persistPageRetryResult(manifest: CrawlManifest, category: PartCategory, page: number, result: DanawaPageRetryResult, retryStartedAt: string, finalizeManifest: boolean) {
  const report = manifest.categories.find((candidate) => candidate.category === category);
  if (!report) throw new Error(`${category} 카테고리의 수집 report가 없습니다.`);
  const manifestTotalsBefore = manifestReportTotals(manifest);
  const pageRetriesBefore = manifest.totalPageRetries ?? manifestTotalsBefore.pageRetries;
  let changedProducts = 0;
  if (!result.error && result.parts.length > 0) {
    const beforeCatalog = await loadCatalog();
    const afterCatalog = await upsertCatalog(result.parts, { replaceDanawaCategories: [] });
    const changes = crawlPartChangeRecords(beforeCatalog, afterCatalog, result.parts, new Date().toISOString());
    changedProducts = changes.length;
    if (changes.length > 0) await appendCatalogChangeRecords(changes);
    mergeCatalogChangeSummary(manifest, changes, result.parts.length);
  } else if (!result.error) {
    mergeCatalogChangeSummary(manifest, [], 0);
  }

  replaceFailedPage(report, category, page, result);
  recalculateManifestTotals(manifest);
  // Keep the aggregate monotonic even when an older manifest has the
  // total retry count but no per-category retry fields yet.
  manifest.totalPageRetries = pageRetriesBefore + result.pageRetries;
  const finishedAt = new Date().toISOString();
  const retryRecord: CrawlPageRetryRecord = {
    category,
    page,
    startedAt: retryStartedAt,
    finishedAt,
    attempts: result.failedPages.at(-1)?.attempts ?? Math.max(1, result.pageRetries + 1),
    succeeded: !result.error,
    ...(result.error ? { error: result.error } : {})
  };
  manifest.pageRetryHistory = [...(manifest.pageRetryHistory ?? []), retryRecord].slice(-100);
  manifest.lastPageRetryAt = finishedAt;
  manifest.generatedAt = finishedAt;
  if (finalizeManifest) manifest.finishedAt = finishedAt;
  await publishManifest(manifest);
  return { changedProducts, finishedAt };
}

export async function runCrawlJob(options: CrawlJobOptions = {}) {
  if (activeJob) return activeJob;
  activeJob = (async () => {
    const scopeConfigs = categoryConfigsFor(options.category);
    let configs = scopeConfigs;
    const exhaustive = options.all === true;
    const startedAt = new Date().toISOString();
    const status: CrawlStatus = {
      status: "running",
      mode: exhaustive ? "all" : "sample",
      ...(options.category ? { category: options.category } : {}),
      ...(options.resume ? { resumed: true } : {}),
      startedAt,
      manifestStartedAt: startedAt,
      categoriesCompleted: 0,
      categoriesTotal: scopeConfigs.length,
      pagesVisited: 0,
      pagesExpected: 0,
      listedProducts: 0,
      productsSeen: 0,
      productsUpdated: 0,
      detailFetched: 0,
      detailFailed: 0,
      failedProducts: 0,
      missingProducts: 0,
      incompleteSpecs: 0,
      coverage: "partial",
      specCoverage: "partial",
      pageRetries: 0,
      failedPages: [],
      manifestPath: "data/crawl-manifest.json",
      workerPid: process.pid,
      message: "다나와 카탈로그를 수집하고 있습니다."
    };
    const collected: Part[] = [];
    const manifest: CrawlManifest = {
      mode: exhaustive ? "all" : "sample",
      ...(options.category ? { category: options.category } : {}),
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
      totalPageRetries: 0,
      failedPages: [],
      categories: []
    };
    let releaseLock: (() => Promise<void>) | undefined;
    let manifestPublished = false;
    const changeRecords: ReturnType<typeof crawlPartChangeRecords> = [];

    try {
      releaseLock = await acquireCrawlLock();
      if (options.resume) {
        if (!exhaustive) throw new Error("재개는 전체 수집 모드에서만 사용할 수 있습니다.");
        const previousManifest = await readJson<CrawlManifest | null>(CRAWL_MANIFEST_PATH, null);
        const plan = crawlResumePlanFor(previousManifest, options.category);
        if (!plan.available) throw new Error(plan.reason ?? "재개할 미완료 범주가 없습니다.");
        configs = plan.remainingConfigs;
        status.resumed = true;
        status.skippedCategories = plan.completedCategories;
        status.message = `이전 전체 수집에서 완료된 ${plan.completedCategories.length}개 범주는 건너뛰고 ${configs.length}개 범주를 재개합니다.`;
        if (previousManifest) manifest.resumedFromStartedAt = previousManifest.startedAt;
        for (const report of plan.completedReports) {
          addCategoryReportToStatus(status, report);
          addCategoryTelemetryToStatus(status, report);
          addCategoryReportToManifest(manifest, report);
        }
      }
      await publish(status, options.onUpdate);
      await publishManifest(manifest);
      manifestPublished = true;
      const beforeCatalog = options.dryRun ? [] : await loadCatalog();
      for (const config of configs) {
        const pageRetriesBeforeCategory = status.pageRetries ?? 0;
        const failedPagesBeforeCategory = [...(status.failedPages ?? [])];
        status.currentCategory = config.category;
        status.currentPage = 1;
        status.currentPagesExpected = undefined;
        status.lastSuccessfulPage = 0;
        await publish(status, options.onUpdate);
        const categoryResult = await crawlDanawaCategory(config.category, config.categoryId, {
          all: exhaustive,
          enrichMissingOnly: exhaustive,
          pages: options.pages ?? Number(process.env.DANAWA_CRAWL_PAGES ?? 1),
          limitPerCategory: options.limitPerCategory ?? Number(process.env.DANAWA_CRAWL_LIMIT ?? 5),
          details: options.details ?? process.env.DANAWA_CRAWL_DETAILS !== "false",
          delayMs: options.delayMs ?? Number(process.env.DANAWA_CRAWL_DELAY_MS ?? 850),
          timeoutMs: Number(process.env.DANAWA_CRAWL_TIMEOUT_MS ?? 20000),
          retries: Number(process.env.DANAWA_CRAWL_RETRIES ?? 2),
          onPageProgress: async (progress) => {
            status.currentCategory = config.category;
            status.currentPage = progress.currentPage;
            status.currentPagesExpected = progress.pagesExpected;
            status.lastSuccessfulPage = progress.lastSuccessfulPage;
            status.pageRetries = pageRetriesBeforeCategory + progress.pageRetries;
            status.failedPages = [...failedPagesBeforeCategory, ...progress.failedPages];
            await publish(status, options.onUpdate);
          }
        });
        const categoryFailedPages = categoryResult.failedPages ?? [];
        status.currentCategory = config.category;
        status.currentPage = categoryFailedPages.at(-1)?.page ?? categoryResult.lastSuccessfulPage ?? categoryResult.pagesVisited;
        status.currentPagesExpected = categoryResult.pagesExpected;
        status.lastSuccessfulPage = categoryResult.lastSuccessfulPage ?? categoryResult.pagesVisited;
        status.pageRetries = pageRetriesBeforeCategory + (categoryResult.pageRetries ?? 0);
        status.failedPages = [...failedPagesBeforeCategory, ...categoryFailedPages];
        collected.push(...categoryResult.parts);
        const categoryReport: CrawlCategoryReport = {
          category: categoryResult.category,
          categoryId: categoryResult.categoryId,
          pagesExpected: categoryResult.pagesExpected,
          pagesVisited: categoryResult.pagesVisited,
          listedProducts: categoryResult.listedProducts,
          uniqueProducts: categoryResult.uniqueProducts,
          detailFetched: categoryResult.detailFetched,
          detailFailed: categoryResult.detailFailed,
          missingProducts: categoryResult.missingProducts,
          incompleteSpecs: categoryResult.incompleteSpecs,
          coverage: categoryResult.coverage,
          specCoverage: categoryResult.specCoverage,
          ...(categoryResult.totalProductCount !== undefined ? { totalProductCount: categoryResult.totalProductCount } : {}),
          ...(categoryResult.pageSize !== undefined ? { pageSize: categoryResult.pageSize } : {}),
          lastSuccessfulPage: categoryResult.lastSuccessfulPage ?? categoryResult.pagesVisited,
          pageRetries: categoryResult.pageRetries ?? 0,
          failedPages: categoryFailedPages,
          successfulPages: categoryResult.successfulPages,
          pageProductCodes: categoryResult.pageProductCodes,
          ...(categoryResult.error ? { error: categoryResult.error } : {})
        };
        if (!options.dryRun && exhaustive) {
          const categoryBeforeCatalog = await loadCatalog();
          const categoryAfterCatalog = await upsertCatalog(categoryResult.parts, {
            // A partial exhaustive response is merged so an interrupted or
            // incomplete repair never deletes the existing live snapshot.
            replaceDanawaCategories: categoryResult.coverage === "complete" ? [config.category] : []
          });
          const categoryChanges = crawlPartChangeRecords(categoryBeforeCatalog, categoryAfterCatalog, categoryResult.parts, new Date().toISOString());
          changeRecords.push(...categoryChanges);
          if (categoryChanges.length > 0) await appendCatalogChangeRecords(categoryChanges);
        }
        addCategoryReportToStatus(status, categoryReport);
        status.productsUpdated += categoryResult.parts.length;
        addCategoryReportToManifest(manifest, categoryReport);
        await publishManifest(manifest);
        status.message = categoryResult.error
          ? `${config.category} 카테고리 ${categoryFailedPages.at(-1)?.page ?? ""}페이지에서 수집을 중단했습니다.`
          : `${config.category} 카테고리 수집 완료`;
        await publish(status, options.onUpdate);
        if (categoryResult.error) throw new Error(categoryResult.error);
      }

      let afterCatalog = beforeCatalog;
      if (!options.dryRun && !exhaustive) {
        afterCatalog = await upsertCatalog(collected, {
          replaceDanawaCategories: []
        });
      }
      if (!options.dryRun && exhaustive) afterCatalog = await loadCatalog();
      if (!options.dryRun && !exhaustive) {
        const crawlChangedAt = new Date().toISOString();
        const finalChangeRecords = crawlPartChangeRecords(beforeCatalog, afterCatalog, collected, crawlChangedAt);
        changeRecords.push(...finalChangeRecords);
        if (finalChangeRecords.length > 0) await appendCatalogChangeRecords(finalChangeRecords);
      }
      const changeSummary = catalogChangeSummary(changeRecords, collected.length);
      status.changeSummary = changeSummary;
      manifest.changeSummary = changeSummary;
      status.finishedAt = new Date().toISOString();
      if (options.dryRun) status.productsUpdated = collected.length;
      manifest.finishedAt = status.finishedAt;
      manifest.coverage = exhaustive && manifest.categories.length === scopeConfigs.length && manifest.categories.every((category) => category.coverage === "complete")
        ? "complete"
        : "partial";
      manifest.specCoverage = exhaustive && manifest.categories.length === scopeConfigs.length && manifest.categories.every((category) => category.specCoverage === "complete")
        ? "complete"
        : "partial";
      status.coverage = manifest.coverage;
      status.specCoverage = manifest.specCoverage;
      status.status = exhaustive && manifest.coverage !== "complete" ? "failed" : "completed";
      const changeNote = changeSummary.changedProducts > 0 ? ` 의미 있는 변경 ${changeSummary.changedProducts}개` : " 의미 있는 변경 없음";
      status.message = status.status === "failed"
        ? `전체 수집은 끝났지만 coverage를 증명하지 못했습니다. 누락 상품 ${manifest.totalMissingProducts}개, 상세 실패 ${manifest.totalDetailFailed}개입니다.`
        : options.dryRun
          ? `드라이런 완료: ${collected.length}개 상품을 확인했습니다.${changeNote}`
          : `카탈로그 갱신 완료: ${collected.length}개 상품을 반영했습니다.${changeNote}`;
      if (status.status === "failed") status.error = "전체 목록 또는 상품 상세 수집이 완전하지 않습니다.";
      await publishManifest(manifest);
      await publish(status, options.onUpdate);
      return status;
    } catch (error) {
      status.status = "failed";
      status.finishedAt = new Date().toISOString();
      status.error = error instanceof Error ? error.message : String(error);
      status.message = "카탈로그 수집에 실패했습니다.";
      manifest.finishedAt = status.finishedAt;
      manifest.coverage = "partial";
      manifest.specCoverage = "partial";
      if (manifestPublished) await publishManifest(manifest);
      await publish(status, options.onUpdate);
      return status;
    } finally {
      await releaseLock?.();
      activeJob = null;
    }
  })();
  return activeJob;
}

export function runCrawlPageRetryJob(options: CrawlPageRetryOptions) {
  if (activeJob) return activeJob;
  activeJob = (async () => {
    const startedAt = new Date().toISOString();
    let releaseLock: (() => Promise<void>) | undefined;
    let manifest: CrawlManifest | null = null;
    let status: CrawlStatus = {
      ...defaultStatus(),
      status: "running",
      mode: "all",
      operation: "page-retry",
      category: options.category,
      currentCategory: options.category,
      currentPage: options.page,
      startedAt,
      workerPid: process.pid,
      message: "실패 페이지를 다시 수집하고 있습니다."
    };
    try {
      releaseLock = await acquireCrawlLock();
      manifest = await readJson<CrawlManifest | null>(CRAWL_MANIFEST_PATH, null);
      const plan = crawlPageRetryPlanFor(manifest, options.category, options.page);
      if (!plan.available || !plan.report || !plan.failure || !manifest) {
        throw new Error(plan.reason ?? "재시도할 실패 페이지를 찾을 수 없습니다.");
      }
      if (options.expectedManifestStartedAt && options.expectedManifestStartedAt !== manifest.startedAt) {
        throw new Error("수집 manifest가 변경되었습니다. 최신 실패 페이지 목록을 다시 확인해 주세요.");
      }

      const report = plan.report;
      const config = DANAWA_CATEGORIES.find((candidate) => candidate.category === options.category);
      if (!config) throw new Error("유효하지 않은 핵심 부품 카테고리입니다.");
      status = statusFromManifest(manifest, startedAt);
      status.currentCategory = options.category;
      status.currentPage = options.page;
      status.currentPagesExpected = report.pagesExpected;
      status.lastSuccessfulPage = report.lastSuccessfulPage ?? 0;
      status.message = `${options.category} ${options.page}페이지를 다시 수집하고 있습니다.`;
      await publish(status, options.onUpdate);

      const manifestTotalsBefore = manifestReportTotals(manifest);
      const pageRetriesBefore = manifest.totalPageRetries ?? manifestTotalsBefore.pageRetries;
      const failedPagesBefore = manifest.failedPages ?? manifestTotalsBefore.failedPages;
      const otherFailedPages = failedPagesBefore.filter((failure) => !(failure.category === options.category && failure.page === options.page && failure.stage === "list"));
      const result = await retryDanawaCategoryPage(options.category, config.categoryId, options.page, {
        details: options.details ?? true,
        delayMs: options.delayMs ?? Number(process.env.DANAWA_CRAWL_DELAY_MS ?? 850),
        timeoutMs: options.timeoutMs ?? Number(process.env.DANAWA_CRAWL_TIMEOUT_MS ?? 20000),
        retries: options.retries ?? Number(process.env.DANAWA_CRAWL_RETRIES ?? 2),
        expectedPages: report.pagesExpected,
        onPageProgress: async (progress) => {
          status.currentCategory = options.category;
          status.currentPage = progress.currentPage;
          status.currentPagesExpected = progress.pagesExpected ?? report.pagesExpected;
          status.lastSuccessfulPage = progress.lastSuccessfulPage || report.lastSuccessfulPage || 0;
          status.pageRetries = pageRetriesBefore + progress.pageRetries;
          status.failedPages = [...otherFailedPages, ...progress.failedPages];
          await publish(status, options.onUpdate);
        }
      });

      const { changedProducts, finishedAt } = await persistPageRetryResult(manifest, options.category, options.page, result, startedAt, true);

      status = statusFromManifest(manifest, startedAt);
      status.status = result.error ? "failed" : "completed";
      status.operation = "page-retry";
      status.currentCategory = options.category;
      status.currentPage = options.page;
      status.currentPagesExpected = report.pagesExpected;
      status.lastSuccessfulPage = report.lastSuccessfulPage ?? 0;
      status.productsUpdated = result.parts.length;
      status.message = result.error
        ? `${options.category} ${options.page}페이지 재시도에 실패했습니다.`
        : `${options.category} ${options.page}페이지 재시도를 완료했습니다. 변경 ${changedProducts}개, 전체 coverage ${manifest.coverage === "complete" ? "완전" : "부분"}입니다.`;
      if (result.error) status.error = result.error;
      status.finishedAt = finishedAt;
      await publish(status, options.onUpdate);
      return status;
    } catch (error) {
      status.status = "failed";
      status.finishedAt = new Date().toISOString();
      status.error = error instanceof Error ? error.message : String(error);
      status.message = "실패 페이지 재시도에 실패했습니다.";
      if (manifest) {
        manifest.generatedAt = status.finishedAt;
        await publishManifest(manifest);
      }
      await publish(status, options.onUpdate);
      return status;
    } finally {
      await releaseLock?.();
      activeJob = null;
    }
  })();
  return activeJob;
}

export function runCrawlPageRetryBatchJob(options: CrawlPageRetryBatchOptions = {}) {
  if (activeJob) return activeJob;
  const abortController = new AbortController();
  activeJobAbortController = abortController;
  activeJobOperation = "page-retry-batch";
  activeJob = (async () => {
    const startedAt = new Date().toISOString();
    let releaseLock: (() => Promise<void>) | undefined;
    let manifest: CrawlManifest | null = null;
    let status: CrawlStatus = {
      ...defaultStatus(),
      status: "running",
      mode: "all",
      operation: "page-retry-batch",
      startedAt,
      workerPid: process.pid,
      message: "실패 페이지를 순차적으로 다시 수집하고 있습니다."
    };
    let batchProgress: CrawlPageRetryBatchProgress = { total: 0, completed: 0, succeeded: 0, failed: 0 };
    let productsUpdated = 0;
    try {
      releaseLock = await acquireCrawlLock();
      manifest = await readJson<CrawlManifest | null>(CRAWL_MANIFEST_PATH, null);
      if (options.expectedManifestStartedAt && options.expectedManifestStartedAt !== manifest?.startedAt) {
        throw new Error("수집 manifest가 변경되었습니다. 최신 실패 페이지 목록을 다시 확인해 주세요.");
      }
      const plan = crawlPageRetryBatchPlanFor(manifest);
      if (!plan.available || !manifest) throw new Error(plan.reason ?? "재시도할 실패 페이지를 찾을 수 없습니다.");
      const failures = plan.failures;
      batchProgress = { total: failures.length, completed: 0, succeeded: 0, failed: 0 };
      delete manifest.finishedAt;
      status = statusFromManifest(manifest, startedAt, "page-retry-batch", batchProgress);
      status.currentCategory = failures[0]?.category;
      status.currentPage = failures[0]?.page;
      status.currentPagesExpected = manifest.categories.find((report) => report.category === failures[0]?.category)?.pagesExpected;
      status.message = `실패 페이지 ${failures.length}개를 순차적으로 다시 수집합니다.`;
      await publish(status, options.onUpdate);

      for (const failure of failures) {
        if (abortController.signal.aborted) throw new Error("Crawler aborted");
        const pagePlan = crawlPageRetryPlanFor(manifest, failure.category, failure.page);
        if (!pagePlan.available || !pagePlan.report) throw new Error(pagePlan.reason ?? `${failure.category} ${failure.page}페이지 재시도 계획이 사라졌습니다.`);
        const config = DANAWA_CATEGORIES.find((candidate) => candidate.category === failure.category);
        if (!config) throw new Error("유효하지 않은 핵심 부품 카테고리입니다.");
        const report = pagePlan.report;
        const manifestTotalsBefore = manifestReportTotals(manifest);
        const pageRetriesBefore = manifest.totalPageRetries ?? manifestTotalsBefore.pageRetries;
        const failedPagesBefore = manifest.failedPages ?? manifestTotalsBefore.failedPages;
        const otherFailedPages = failedPagesBefore.filter((candidate) => !(candidate.category === failure.category && candidate.page === failure.page && candidate.stage === "list"));
        const pageStartedAt = new Date().toISOString();
        status.currentCategory = failure.category;
        status.currentPage = failure.page;
        status.currentPagesExpected = report.pagesExpected;
        status.lastSuccessfulPage = report.lastSuccessfulPage ?? 0;
        status.error = undefined;
        status.pageRetryBatch = { ...batchProgress };
        status.message = `${failure.category} ${failure.page}페이지를 다시 수집하고 있습니다. (${batchProgress.completed + 1}/${batchProgress.total})`;
        await publish(status, options.onUpdate);
        const result = await retryDanawaCategoryPage(failure.category, config.categoryId, failure.page, {
          details: options.details ?? true,
          delayMs: options.delayMs ?? Number(process.env.DANAWA_CRAWL_DELAY_MS ?? 850),
          timeoutMs: options.timeoutMs ?? Number(process.env.DANAWA_CRAWL_TIMEOUT_MS ?? 20000),
          retries: options.retries ?? Number(process.env.DANAWA_CRAWL_RETRIES ?? 2),
          signal: abortController.signal,
          expectedPages: report.pagesExpected,
          onPageProgress: async (progress) => {
            status.currentCategory = failure.category;
            status.currentPage = progress.currentPage;
            status.currentPagesExpected = progress.pagesExpected ?? report.pagesExpected;
            status.lastSuccessfulPage = progress.lastSuccessfulPage || report.lastSuccessfulPage || 0;
            status.pageRetries = pageRetriesBefore + progress.pageRetries;
            status.failedPages = [...otherFailedPages, ...progress.failedPages];
            status.error = undefined;
            status.pageRetryBatch = { ...batchProgress };
            await publish(status, options.onUpdate);
          }
        });
        if (abortController.signal.aborted) throw new Error("Crawler aborted");
        await persistPageRetryResult(manifest, failure.category, failure.page, result, pageStartedAt, false);
        productsUpdated += result.parts.length;
        batchProgress = {
          total: batchProgress.total,
          completed: batchProgress.completed + 1,
          succeeded: batchProgress.succeeded + (result.error ? 0 : 1),
          failed: batchProgress.failed + (result.error ? 1 : 0)
        };
        status = statusFromManifest(manifest, startedAt, "page-retry-batch", batchProgress);
        status.currentCategory = failure.category;
        status.currentPage = failure.page;
        status.currentPagesExpected = report.pagesExpected;
        status.lastSuccessfulPage = report.lastSuccessfulPage ?? 0;
        status.productsUpdated = productsUpdated;
        status.message = result.error
          ? `${failure.category} ${failure.page}페이지 재시도에 실패했습니다. 다음 실패 페이지를 계속 처리합니다.`
          : `${failure.category} ${failure.page}페이지 재시도 완료 (${batchProgress.completed}/${batchProgress.total})`;
        if (result.error) status.error = result.error;
        await publish(status, options.onUpdate);
      }

      if (abortController.signal.aborted) throw new Error("Crawler aborted");
      const finishedAt = new Date().toISOString();
      manifest.generatedAt = finishedAt;
      manifest.finishedAt = finishedAt;
      await publishManifest(manifest);
      status = statusFromManifest(manifest, startedAt, "page-retry-batch", batchProgress);
      status.status = batchProgress.failed > 0 ? "failed" : "completed";
      status.currentCategory = failures.at(-1)?.category;
      status.currentPage = failures.at(-1)?.page;
      status.currentPagesExpected = failures.at(-1) ? manifest.categories.find((report) => report.category === failures.at(-1)?.category)?.pagesExpected : undefined;
      status.lastSuccessfulPage = failures.at(-1) ? manifest.categories.find((report) => report.category === failures.at(-1)?.category)?.lastSuccessfulPage : undefined;
      status.productsUpdated = productsUpdated;
      status.message = batchProgress.failed > 0
        ? `실패 페이지 일괄 재시도 완료: ${batchProgress.succeeded}개 성공, ${batchProgress.failed}개 실패. 전체 coverage는 ${manifest.coverage === "complete" ? "완전" : "부분"}입니다.`
        : `실패 페이지 ${batchProgress.total}개 일괄 재시도 완료. 전체 coverage는 ${manifest.coverage === "complete" ? "완전" : "부분"}입니다.`;
      if (batchProgress.failed > 0) status.error = "일부 실패 페이지를 복구하지 못했습니다.";
      status.finishedAt = finishedAt;
      await publish(status, options.onUpdate);
      return status;
    } catch (error) {
      const cancelled = abortController.signal.aborted;
      status.status = cancelled ? "cancelled" : "failed";
      status.finishedAt = new Date().toISOString();
      status.error = cancelled ? undefined : error instanceof Error ? error.message : String(error);
      status.message = cancelled
        ? "일괄 재시도를 중단했습니다. 이미 처리된 페이지는 manifest에 저장되어 다음 실행에서 제외됩니다."
        : "실패 페이지 일괄 재시도에 실패했습니다.";
      status.pageRetryBatch = { ...batchProgress };
      status.productsUpdated = productsUpdated;
      if (manifest) {
        manifest.generatedAt = status.finishedAt;
        manifest.finishedAt = status.finishedAt;
        await publishManifest(manifest);
      }
      await publish(status, options.onUpdate);
      return status;
    } finally {
      await releaseLock?.();
      if (activeJobAbortController === abortController) activeJobAbortController = null;
      if (activeJobOperation === "page-retry-batch") activeJobOperation = null;
      activeJob = null;
    }
  })();
  return activeJob;
}

export function isCrawlRunning() {
  return Boolean(activeJob);
}

export function isCrawlPageRetryBatchRunning() {
  return Boolean(activeJob && activeJobOperation === "page-retry-batch");
}

export function cancelCrawlPageRetryBatch() {
  if (!isCrawlPageRetryBatchRunning() || !activeJobAbortController) return false;
  activeJobAbortController.abort();
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      pages: { type: "string", short: "p" },
      limit: { type: "string", short: "l" },
      delay: { type: "string" },
      category: { type: "string", short: "c" },
      all: { type: "boolean", default: false },
      details: { type: "boolean", default: true },
      "no-details": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      resume: { type: "boolean", default: false }
    }
  });
  const status = await runCrawlJob({
    category: typeof values.category === "string" && DANAWA_CATEGORIES.some((config) => config.category === values.category)
      ? values.category as PartCategory
      : undefined,
    all: values.all === true,
    pages: Number(values.pages ?? process.env.DANAWA_CRAWL_PAGES ?? 1),
    limitPerCategory: Number(values.limit ?? process.env.DANAWA_CRAWL_LIMIT ?? 5),
    delayMs: Number(values.delay ?? process.env.DANAWA_CRAWL_DELAY_MS ?? 850),
    details: values["no-details"] === true ? false : values.details,
    dryRun: values["dry-run"],
    resume: values.resume
  });
  console.log(JSON.stringify(status, null, 2));
  process.exitCode = status.status === "failed" ? 1 : 0;
}
