import "dotenv/config";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { CrawlCategoryReport, CrawlManifest, CrawlStatus, Part, PartCategory } from "../shared/types";
import { DANAWA_CATEGORIES, crawlDanawaCategory } from "./danawa";
import { loadCatalog, upsertCatalog } from "./catalog";
import { CRAWL_LOCK_PATH, CRAWL_MANIFEST_PATH, CRAWL_STATE_PATH, createExclusiveFile, ensureDataDirectory, removeGeneratedFile, writeJson } from "./storage";
import { appendCatalogChangeRecords, catalogChangeRecord, catalogChangeSummary, catalogItemKey, meaningfulCatalogChangeFields } from "./catalog-change-log";

export type CrawlJobOptions = {
  category?: PartCategory;
  all?: boolean;
  pages?: number;
  limitPerCategory?: number;
  details?: boolean;
  delayMs?: number;
  dryRun?: boolean;
  onUpdate?: (status: CrawlStatus) => void;
};

let activeJob: Promise<CrawlStatus> | null = null;

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
    specCoverage: stored.specCoverage ?? "partial"
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

export async function runCrawlJob(options: CrawlJobOptions = {}) {
  if (activeJob) return activeJob;
  activeJob = (async () => {
    const configs = options.category
      ? DANAWA_CATEGORIES.filter((config) => config.category === options.category)
      : DANAWA_CATEGORIES;
    const exhaustive = options.all === true;
    const startedAt = new Date().toISOString();
    const status: CrawlStatus = {
      status: "running",
      mode: exhaustive ? "all" : "sample",
      startedAt,
      categoriesCompleted: 0,
      categoriesTotal: configs.length,
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
      manifestPath: "data/crawl-manifest.json",
      workerPid: process.pid,
      message: "다나와 카탈로그를 수집하고 있습니다."
    };
    const collected: Part[] = [];
    const manifest: CrawlManifest = {
      mode: exhaustive ? "all" : "sample",
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
      releaseLock = await acquireCrawlLock();
      await publish(status, options.onUpdate);
      await publishManifest(manifest);
      const beforeCatalog = options.dryRun ? [] : await loadCatalog();
      for (const config of configs) {
        const categoryResult = await crawlDanawaCategory(config.category, config.categoryId, {
          all: exhaustive,
          enrichMissingOnly: exhaustive,
          pages: options.pages ?? Number(process.env.DANAWA_CRAWL_PAGES ?? 1),
          limitPerCategory: options.limitPerCategory ?? Number(process.env.DANAWA_CRAWL_LIMIT ?? 5),
          details: options.details ?? process.env.DANAWA_CRAWL_DETAILS !== "false",
          delayMs: options.delayMs ?? Number(process.env.DANAWA_CRAWL_DELAY_MS ?? 850),
          timeoutMs: Number(process.env.DANAWA_CRAWL_TIMEOUT_MS ?? 20000),
          retries: Number(process.env.DANAWA_CRAWL_RETRIES ?? 2)
        });
        collected.push(...categoryResult.parts);
        status.categoriesCompleted += 1;
        status.productsSeen = collected.length;
        status.pagesVisited += categoryResult.pagesVisited;
        status.pagesExpected += categoryResult.pagesExpected;
        status.listedProducts += categoryResult.listedProducts;
        status.detailFetched += categoryResult.detailFetched;
        status.detailFailed += categoryResult.detailFailed;
        status.failedProducts += categoryResult.detailFailed;
        status.missingProducts += categoryResult.missingProducts;
        status.incompleteSpecs += categoryResult.incompleteSpecs;
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
          specCoverage: categoryResult.specCoverage
        };
        manifest.categories.push(categoryReport);
        manifest.totalExpectedProducts += categoryResult.uniqueProducts + categoryResult.missingProducts;
        manifest.totalUniqueProducts += categoryResult.uniqueProducts;
        manifest.totalDetailFetched += categoryResult.detailFetched;
        manifest.totalDetailFailed += categoryResult.detailFailed;
        manifest.totalMissingProducts += categoryResult.missingProducts;
        manifest.totalIncompleteSpecs += categoryResult.incompleteSpecs;
        await publishManifest(manifest);
        status.message = `${config.category} 카테고리 수집 완료`;
        await publish(status, options.onUpdate);
      }

      let afterCatalog = beforeCatalog;
      if (!options.dryRun) {
        afterCatalog = await upsertCatalog(collected, {
          replaceDanawaCategories: exhaustive ? configs.map((config) => config.category) : []
        });
      }
      const crawlChangedAt = new Date().toISOString();
      const changeRecords = options.dryRun ? [] : crawlPartChangeRecords(beforeCatalog, afterCatalog, collected, crawlChangedAt);
      if (changeRecords.length > 0) await appendCatalogChangeRecords(changeRecords);
      const changeSummary = catalogChangeSummary(changeRecords, collected.length);
      status.changeSummary = changeSummary;
      manifest.changeSummary = changeSummary;
      status.finishedAt = new Date().toISOString();
      status.productsUpdated = collected.length;
      manifest.finishedAt = status.finishedAt;
      manifest.coverage = exhaustive && manifest.categories.length === configs.length && manifest.categories.every((category) => category.coverage === "complete")
        ? "complete"
        : "partial";
      manifest.specCoverage = exhaustive && manifest.categories.length === configs.length && manifest.categories.every((category) => category.specCoverage === "complete")
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
      manifest.specCoverage = "partial";
      await publishManifest(manifest);
      await publish(status, options.onUpdate);
      return status;
    } finally {
      await releaseLock?.();
      activeJob = null;
    }
  })();
  return activeJob;
}

export function isCrawlRunning() {
  return Boolean(activeJob);
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
      "dry-run": { type: "boolean", default: false }
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
    dryRun: values["dry-run"]
  });
  console.log(JSON.stringify(status, null, 2));
  process.exitCode = status.status === "failed" ? 1 : 0;
}
