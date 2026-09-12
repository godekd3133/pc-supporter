import { describe, expect, it, vi } from "vitest";
import type { CrawlCategoryReport, CrawlManifest, CrawlPageFailure, Part } from "../shared/types";

const mocks = vi.hoisted(() => ({
  appendCatalogChangeRecords: vi.fn(),
  crawlDanawaCategory: vi.fn(),
  retryDanawaCategoryPage: vi.fn(),
  createExclusiveFile: vi.fn(),
  ensureDataDirectory: vi.fn(),
  loadCatalog: vi.fn(),
  readJson: vi.fn(),
  removeGeneratedFile: vi.fn(),
  upsertCatalog: vi.fn(),
  writeJson: vi.fn()
}));

vi.mock("./danawa", async () => {
  const actual = await vi.importActual<typeof import("./danawa")>("./danawa");
  return { ...actual, crawlDanawaCategory: mocks.crawlDanawaCategory, retryDanawaCategoryPage: mocks.retryDanawaCategoryPage };
});

vi.mock("./catalog", () => ({ loadCatalog: mocks.loadCatalog, upsertCatalog: mocks.upsertCatalog }));

vi.mock("./storage", async () => {
  const actual = await vi.importActual<typeof import("./storage")>("./storage");
  return {
    ...actual,
    createExclusiveFile: mocks.createExclusiveFile,
    ensureDataDirectory: mocks.ensureDataDirectory,
    readJson: mocks.readJson,
    removeGeneratedFile: mocks.removeGeneratedFile,
    writeJson: mocks.writeJson
  };
});

vi.mock("./catalog-change-log", async () => {
  const actual = await vi.importActual<typeof import("./catalog-change-log")>("./catalog-change-log");
  return { ...actual, appendCatalogChangeRecords: mocks.appendCatalogChangeRecords };
});

import { DANAWA_CATEGORIES } from "./danawa";
import { cancelCrawlPageRetryBatch, runCrawlJob, runCrawlPageRetryBatchJob } from "./crawler";

const part: Part = {
  id: "danawa-psu-resume-1",
  category: "psu",
  name: "재개 테스트 파워",
  source: "danawa",
  sourceProductCode: "resume-1",
  danawaUrl: "https://prod.danawa.com/info/?pcode=resume-1&cate=112777",
  priceWon: 100000,
  rawSpecText: "정격 750W",
  specs: { wattageW: 750 },
  dataQuality: "live",
  missingFields: [],
  updatedAt: "2026-09-06T00:00:00.000Z"
};

function report(category: (typeof DANAWA_CATEGORIES)[number]["category"], complete = true): CrawlCategoryReport {
  const categoryId = DANAWA_CATEGORIES.find((config) => config.category === category)?.categoryId ?? "test";
  return {
    category,
    categoryId,
    pagesExpected: 1,
    pagesVisited: 1,
    listedProducts: 10,
    uniqueProducts: 10,
    detailFetched: 10,
    detailFailed: 0,
    missingProducts: 0,
    incompleteSpecs: complete ? 0 : 1,
    coverage: complete ? "complete" : "partial",
    specCoverage: complete ? "complete" : "partial"
  };
}

function previousManifest(): CrawlManifest {
  const categories = DANAWA_CATEGORIES.map((config) => report(config.category, config.category !== "psu"));
  return {
    mode: "all",
    startedAt: "2026-09-05T23:00:00.000Z",
    generatedAt: "2026-09-05T23:01:00.000Z",
    coverage: "partial",
    specCoverage: "partial",
    totalExpectedProducts: categories.reduce((sum, item) => sum + item.uniqueProducts + item.missingProducts, 0),
    totalUniqueProducts: categories.reduce((sum, item) => sum + item.uniqueProducts, 0),
    totalDetailFetched: categories.reduce((sum, item) => sum + item.detailFetched, 0),
    totalDetailFailed: categories.reduce((sum, item) => sum + item.detailFailed, 0),
    totalMissingProducts: 0,
    totalIncompleteSpecs: 1,
    categories
  };
}

describe("exhaustive crawler execution resume", () => {
  it("carries completed reports, crawls only the remaining category, and replaces only that category", async () => {
    const manifest = previousManifest();
    const resumedPsuReport = { ...report("psu"), listedProducts: 1, uniqueProducts: 1, detailFetched: 1 };
    mocks.appendCatalogChangeRecords.mockReset().mockResolvedValue([]);
    mocks.crawlDanawaCategory.mockReset().mockResolvedValue({
      ...resumedPsuReport,
      parts: [part]
    });
    mocks.createExclusiveFile.mockReset().mockResolvedValue(undefined);
    mocks.ensureDataDirectory.mockReset().mockResolvedValue(undefined);
    mocks.loadCatalog.mockReset().mockResolvedValue([]);
    mocks.readJson.mockReset().mockImplementation(async (path: string, fallback: unknown) => path.endsWith("crawl-manifest.json") ? manifest : fallback);
    mocks.removeGeneratedFile.mockReset().mockResolvedValue(undefined);
    mocks.upsertCatalog.mockReset().mockResolvedValue([part]);
    mocks.writeJson.mockReset().mockResolvedValue(undefined);

    const status = await runCrawlJob({ all: true, resume: true, pages: 1, limitPerCategory: 0, details: true, delayMs: 0 });

    expect(status.status).toBe("completed");
    expect(status.resumed).toBe(true);
    expect(status.skippedCategories).toEqual(["cpu", "cooler", "motherboard", "memory", "gpu", "ssd", "hdd", "case"]);
    expect(status.categoriesCompleted).toBe(DANAWA_CATEGORIES.length);
    expect(status.productsSeen).toBe(81);
    expect(status.productsUpdated).toBe(1);
    expect(mocks.crawlDanawaCategory).toHaveBeenCalledTimes(1);
    expect(mocks.crawlDanawaCategory).toHaveBeenCalledWith("psu", "112777", expect.objectContaining({ all: true, enrichMissingOnly: true }));
    expect(mocks.upsertCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.upsertCatalog).toHaveBeenCalledWith([part], { replaceDanawaCategories: ["psu"] });

    const manifests = mocks.writeJson.mock.calls
      .filter(([path]) => String(path).endsWith("crawl-manifest.json"))
      .map(([, value]) => value as CrawlManifest);
    expect(manifests.at(-1)).toMatchObject({
      resumedFromStartedAt: "2026-09-05T23:00:00.000Z",
      coverage: "complete",
      specCoverage: "complete",
      categories: expect.arrayContaining([expect.objectContaining({ category: "psu", coverage: "complete", specCoverage: "complete" })])
    });
  });

  it("persists the failed category page and retry telemetry before marking the job failed", async () => {
    const failure: CrawlPageFailure = {
      category: "cpu",
      page: 2,
      stage: "list",
      attempts: 3,
      message: "simulated page timeout",
      occurredAt: "2026-09-06T00:02:00.000Z"
    };
    mocks.appendCatalogChangeRecords.mockReset().mockResolvedValue([]);
    mocks.crawlDanawaCategory.mockReset().mockImplementation(async (_category: string, _categoryId: string, options: { onPageProgress?: (progress: unknown) => void | Promise<void> }) => {
      await options.onPageProgress?.({ currentPage: 2, pagesExpected: 4, lastSuccessfulPage: 1, pageRetries: 2, failedPages: [failure] });
      return {
        ...report("cpu", false),
        parts: [],
        pagesExpected: 4,
        pagesVisited: 1,
        lastSuccessfulPage: 1,
        pageRetries: 2,
        failedPages: [failure],
        error: "2페이지 목록 수집 실패: simulated page timeout"
      };
    });
    mocks.createExclusiveFile.mockReset().mockResolvedValue(undefined);
    mocks.ensureDataDirectory.mockReset().mockResolvedValue(undefined);
    mocks.loadCatalog.mockReset().mockResolvedValue([]);
    mocks.readJson.mockReset().mockResolvedValue({});
    mocks.removeGeneratedFile.mockReset().mockResolvedValue(undefined);
    mocks.upsertCatalog.mockReset().mockResolvedValue([]);
    mocks.writeJson.mockReset().mockResolvedValue(undefined);

    const status = await runCrawlJob({ all: true, details: false, delayMs: 0 });

    expect(status.status).toBe("failed");
    expect(status.currentCategory).toBe("cpu");
    expect(status.currentPage).toBe(2);
    expect(status.currentPagesExpected).toBe(4);
    expect(status.lastSuccessfulPage).toBe(1);
    expect(status.pageRetries).toBe(2);
    expect(status.failedPages).toEqual([failure]);
    expect(status.error).toContain("2페이지 목록 수집 실패");
    expect(mocks.crawlDanawaCategory).toHaveBeenCalledTimes(1);

    const manifests = mocks.writeJson.mock.calls
      .filter(([path]) => String(path).endsWith("crawl-manifest.json"))
      .map(([, value]) => value as CrawlManifest);
    expect(manifests.at(-1)).toMatchObject({
      totalPageRetries: 2,
      failedPages: [failure],
      categories: [expect.objectContaining({
        category: "cpu",
        lastSuccessfulPage: 1,
        pageRetries: 2,
        failedPages: [failure],
        error: "2페이지 목록 수집 실패: simulated page timeout"
      })]
    });
  });

  it("retries one failed page, merges only its products, and upgrades a checkpointed category", async () => {
    const failure: CrawlPageFailure = {
      category: "cpu",
      page: 2,
      stage: "list",
      attempts: 3,
      message: "simulated page timeout",
      occurredAt: "2026-09-06T00:03:00.000Z"
    };
    const cpuPart: Part = {
      ...part,
      id: "danawa-cpu-retry-1",
      category: "cpu",
      name: "재시도 테스트 CPU",
      sourceProductCode: "retry-cpu-1",
      danawaUrl: "https://prod.danawa.com/info/?pcode=retry-cpu-1&cate=112747",
      specs: { socket: "AM5", tdpW: 120 }
    };
    const cpuPartial = report("cpu", false);
    cpuPartial.totalProductCount = 4;
    cpuPartial.pageSize = 2;
    cpuPartial.pagesExpected = 2;
    cpuPartial.pagesVisited = 1;
    cpuPartial.listedProducts = 2;
    cpuPartial.uniqueProducts = 2;
    cpuPartial.missingProducts = 2;
    cpuPartial.incompleteSpecs = 0;
    cpuPartial.specCoverage = "complete";
    cpuPartial.successfulPages = [1];
    cpuPartial.pageProductCodes = { "1": ["retry-cpu-0", "retry-cpu-1"] };
    cpuPartial.failedPages = [failure];
    cpuPartial.error = "2페이지 목록 수집 실패: simulated page timeout";
    const manifest = previousManifest();
    manifest.categories = DANAWA_CATEGORIES.map((config) => config.category === "cpu" ? cpuPartial : report(config.category));
    manifest.coverage = "partial";
    manifest.specCoverage = "complete";
    manifest.totalPageRetries = 2;
    manifest.failedPages = [failure];
    mocks.appendCatalogChangeRecords.mockReset().mockResolvedValue([]);
    mocks.createExclusiveFile.mockReset().mockResolvedValue(undefined);
    mocks.ensureDataDirectory.mockReset().mockResolvedValue(undefined);
    mocks.loadCatalog.mockReset().mockResolvedValue([]);
    mocks.readJson.mockReset().mockImplementation(async (path: string, fallback: unknown) => path.endsWith("crawl-manifest.json") ? manifest : fallback);
    mocks.removeGeneratedFile.mockReset().mockResolvedValue(undefined);
    mocks.upsertCatalog.mockReset().mockResolvedValue([cpuPart]);
    mocks.writeJson.mockReset().mockResolvedValue(undefined);
    mocks.retryDanawaCategoryPage.mockReset().mockImplementation(async (_category: string, _categoryId: string, _page: number, options: { onPageProgress?: (progress: unknown) => void | Promise<void> }) => {
      await options.onPageProgress?.({ currentPage: 2, pagesExpected: 2, lastSuccessfulPage: 2, pageRetries: 1, failedPages: [] });
      return {
        category: "cpu",
        categoryId: "112747",
        page: 2,
        parts: [cpuPart],
        listedProducts: 2,
        uniqueProducts: 2,
        detailFetched: 1,
        detailFailed: 0,
        incompleteSpecs: 0,
        pageRetries: 1,
        failedPages: [],
        successfulPages: [2],
        pageProductCodes: { "2": ["retry-cpu-2", "retry-cpu-3"] },
        totalProductCount: 4,
        pageSize: 2
      };
    });

    const status = await (await import("./crawler")).runCrawlPageRetryJob({ category: "cpu", page: 2, expectedManifestStartedAt: manifest.startedAt, details: false, delayMs: 0, retries: 0 });

    expect(status.status).toBe("completed");
    expect(status.operation).toBe("page-retry");
    expect(status.coverage).toBe("complete");
    expect(status.currentCategory).toBe("cpu");
    expect(status.currentPage).toBe(2);
    expect(status.lastSuccessfulPage).toBe(2);
    expect(status.pageRetries).toBe(3);
    expect(status.failedPages).toEqual([]);
    expect(status.productsUpdated).toBe(1);
    expect(mocks.retryDanawaCategoryPage).toHaveBeenCalledTimes(1);
    expect(mocks.upsertCatalog).toHaveBeenCalledWith([cpuPart], { replaceDanawaCategories: [] });
    expect(manifest.categories.find((candidate) => candidate.category === "cpu")).toMatchObject({
      pagesVisited: 2,
      listedProducts: 4,
      uniqueProducts: 4,
      missingProducts: 0,
      coverage: "complete",
      specCoverage: "complete",
      successfulPages: [1, 2],
      pageProductCodes: { "1": ["retry-cpu-0", "retry-cpu-1"], "2": ["retry-cpu-2", "retry-cpu-3"] },
      failedPages: []
    });
    expect(manifest.pageRetryHistory?.at(-1)).toMatchObject({ category: "cpu", page: 2, succeeded: true, attempts: 2 });
    expect(manifest.totalPageRetries).toBe(3);
    expect(manifest.failedPages).toEqual([]);
  });

  it("processes every failed list page in order and keeps failures for the next repair run", async () => {
    const cpuFailure: CrawlPageFailure = {
      category: "cpu",
      page: 2,
      stage: "list",
      attempts: 3,
      message: "simulated cpu page timeout",
      occurredAt: "2026-09-06T00:04:00.000Z"
    };
    const gpuFailure: CrawlPageFailure = {
      category: "gpu",
      page: 1,
      stage: "list",
      attempts: 3,
      message: "simulated gpu page timeout",
      occurredAt: "2026-09-06T00:04:01.000Z"
    };
    const cpuPart: Part = {
      ...part,
      id: "danawa-cpu-batch-retry-1",
      category: "cpu",
      name: "일괄 재시도 테스트 CPU",
      sourceProductCode: "batch-cpu-2",
      danawaUrl: "https://prod.danawa.com/info/?pcode=batch-cpu-2&cate=112747",
      specs: { socket: "AM5", tdpW: 105 }
    };
    const cpuPartial = report("cpu", true);
    cpuPartial.totalProductCount = 4;
    cpuPartial.pageSize = 2;
    cpuPartial.pagesExpected = 2;
    cpuPartial.pagesVisited = 1;
    cpuPartial.listedProducts = 2;
    cpuPartial.uniqueProducts = 2;
    cpuPartial.missingProducts = 2;
    cpuPartial.successfulPages = [1];
    cpuPartial.pageProductCodes = { "1": ["batch-cpu-0", "batch-cpu-1"] };
    cpuPartial.failedPages = [cpuFailure];
    cpuPartial.error = "2페이지 목록 수집 실패: simulated cpu page timeout";
    const gpuPartial = report("gpu", true);
    gpuPartial.coverage = "partial";
    gpuPartial.pagesExpected = 1;
    gpuPartial.pagesVisited = 0;
    gpuPartial.listedProducts = 0;
    gpuPartial.uniqueProducts = 0;
    gpuPartial.missingProducts = 1;
    gpuPartial.failedPages = [gpuFailure];
    gpuPartial.error = "1페이지 목록 수집 실패: simulated gpu page timeout";
    const manifest = previousManifest();
    manifest.categories = DANAWA_CATEGORIES.map((config) => config.category === "cpu" ? cpuPartial : config.category === "gpu" ? gpuPartial : report(config.category));
    manifest.coverage = "partial";
    manifest.specCoverage = "complete";
    manifest.totalPageRetries = 2;
    manifest.failedPages = [cpuFailure, gpuFailure];
    mocks.appendCatalogChangeRecords.mockReset().mockResolvedValue([]);
    mocks.createExclusiveFile.mockReset().mockResolvedValue(undefined);
    mocks.ensureDataDirectory.mockReset().mockResolvedValue(undefined);
    mocks.loadCatalog.mockReset().mockResolvedValue([]);
    mocks.readJson.mockReset().mockImplementation(async (path: string, fallback: unknown) => path.endsWith("crawl-manifest.json") ? manifest : fallback);
    mocks.removeGeneratedFile.mockReset().mockResolvedValue(undefined);
    mocks.upsertCatalog.mockReset().mockResolvedValue([cpuPart]);
    mocks.writeJson.mockReset().mockResolvedValue(undefined);
    mocks.retryDanawaCategoryPage.mockReset().mockImplementation(async (category: string, _categoryId: string, page: number, options: { onPageProgress?: (progress: unknown) => void | Promise<void> }) => {
      if (category === "cpu") {
        await options.onPageProgress?.({ currentPage: page, pagesExpected: 2, lastSuccessfulPage: 2, pageRetries: 1, failedPages: [] });
        return {
          category: "cpu",
          categoryId: "112747",
          page,
          parts: [cpuPart],
          listedProducts: 2,
          uniqueProducts: 2,
          detailFetched: 1,
          detailFailed: 0,
          incompleteSpecs: 0,
          pageRetries: 1,
          failedPages: [],
          successfulPages: [page],
          pageProductCodes: { [String(page)]: ["batch-cpu-2", "batch-cpu-3"] },
          totalProductCount: 4,
          pageSize: 2
        };
      }
      await options.onPageProgress?.({ currentPage: page, pagesExpected: 1, lastSuccessfulPage: 0, pageRetries: 2, failedPages: [gpuFailure] });
      return {
        category: "gpu",
        categoryId: "112753",
        page,
        parts: [],
        listedProducts: 0,
        uniqueProducts: 0,
        detailFetched: 0,
        detailFailed: 0,
        incompleteSpecs: 0,
        pageRetries: 2,
        failedPages: [gpuFailure],
        successfulPages: [],
        pageProductCodes: {},
        error: "1페이지 목록 재시도 실패: simulated gpu page timeout"
      };
    });

    const status = await runCrawlPageRetryBatchJob({ expectedManifestStartedAt: manifest.startedAt, details: false, delayMs: 0, retries: 0 });

    expect(status.status).toBe("failed");
    expect(status.operation).toBe("page-retry-batch");
    expect(status.pageRetryBatch).toEqual({ total: 2, completed: 2, succeeded: 1, failed: 1 });
    expect(status.productsUpdated).toBe(1);
    expect(status.failedPages).toEqual([gpuFailure]);
    expect(mocks.retryDanawaCategoryPage).toHaveBeenCalledTimes(2);
    expect(mocks.retryDanawaCategoryPage.mock.calls.map(([category, , page]) => `${category}:${page}`)).toEqual(["cpu:2", "gpu:1"]);
    expect(mocks.upsertCatalog).toHaveBeenCalledTimes(1);
    expect(manifest.categories.find((candidate) => candidate.category === "cpu")).toMatchObject({
      pagesVisited: 2,
      listedProducts: 4,
      uniqueProducts: 4,
      missingProducts: 0,
      coverage: "complete",
      failedPages: []
    });
    expect(manifest.categories.find((candidate) => candidate.category === "gpu")).toMatchObject({
      failedPages: [gpuFailure],
      coverage: "partial"
    });
    expect(manifest.pageRetryHistory).toHaveLength(2);
    expect(manifest.pageRetryHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "cpu", page: 2, succeeded: true }),
      expect.objectContaining({ category: "gpu", page: 1, succeeded: false })
    ]));
    expect(manifest.totalPageRetries).toBe(5);
    expect(manifest.failedPages).toEqual([gpuFailure]);
  });

  it("cancels an in-flight batch without persisting the page that was interrupted", async () => {
    const failure: CrawlPageFailure = {
      category: "cpu",
      page: 2,
      stage: "list",
      attempts: 3,
      message: "simulated cpu page timeout",
      occurredAt: "2026-09-06T00:05:00.000Z"
    };
    const cpuPartial = report("cpu", true);
    cpuPartial.totalProductCount = 4;
    cpuPartial.pageSize = 2;
    cpuPartial.pagesExpected = 2;
    cpuPartial.pagesVisited = 1;
    cpuPartial.listedProducts = 2;
    cpuPartial.uniqueProducts = 2;
    cpuPartial.missingProducts = 2;
    cpuPartial.successfulPages = [1];
    cpuPartial.pageProductCodes = { "1": ["cancel-cpu-0", "cancel-cpu-1"] };
    cpuPartial.failedPages = [failure];
    cpuPartial.error = "2페이지 목록 수집 실패: simulated cpu page timeout";
    const manifest = previousManifest();
    manifest.categories = DANAWA_CATEGORIES.map((config) => config.category === "cpu" ? cpuPartial : report(config.category));
    manifest.coverage = "partial";
    manifest.totalPageRetries = 2;
    manifest.failedPages = [failure];
    mocks.appendCatalogChangeRecords.mockReset().mockResolvedValue([]);
    mocks.createExclusiveFile.mockReset().mockResolvedValue(undefined);
    mocks.ensureDataDirectory.mockReset().mockResolvedValue(undefined);
    mocks.loadCatalog.mockReset().mockResolvedValue([]);
    mocks.readJson.mockReset().mockImplementation(async (path: string, fallback: unknown) => path.endsWith("crawl-manifest.json") ? manifest : fallback);
    mocks.removeGeneratedFile.mockReset().mockResolvedValue(undefined);
    mocks.upsertCatalog.mockReset().mockResolvedValue([]);
    mocks.writeJson.mockReset().mockResolvedValue(undefined);

    let resolveRetryStarted: (() => void) | undefined;
    const retryStarted = new Promise<void>((resolve) => { resolveRetryStarted = resolve; });
    mocks.retryDanawaCategoryPage.mockReset().mockImplementation(async (_category: string, _categoryId: string, _page: number, options: { signal?: AbortSignal }) => {
      resolveRetryStarted?.();
      await new Promise<never>((_resolve, reject) => {
        if (!options.signal) {
          reject(new Error("batch retry did not receive an abort signal"));
          return;
        }
        if (options.signal.aborted) {
          reject(new Error("Crawler aborted"));
          return;
        }
        options.signal.addEventListener("abort", () => reject(new Error("Crawler aborted")), { once: true });
      });
    });

    const job = runCrawlPageRetryBatchJob({ expectedManifestStartedAt: manifest.startedAt, details: false, delayMs: 0, retries: 0 });
    await retryStarted;
    expect(cancelCrawlPageRetryBatch()).toBe(true);
    const status = await job;

    expect(status.status).toBe("cancelled");
    expect(status.operation).toBe("page-retry-batch");
    expect(status.error).toBeUndefined();
    expect(status.pageRetryBatch).toEqual({ total: 1, completed: 0, succeeded: 0, failed: 0 });
    expect(status.failedPages).toEqual([failure]);
    expect(mocks.retryDanawaCategoryPage).toHaveBeenCalledTimes(1);
    const retryOptions = mocks.retryDanawaCategoryPage.mock.calls[0]?.[3] as { signal?: AbortSignal };
    expect(retryOptions.signal?.aborted).toBe(true);
    expect(manifest.pageRetryHistory ?? []).toEqual([]);
    expect(manifest.failedPages).toEqual([failure]);
    expect(mocks.upsertCatalog).not.toHaveBeenCalled();
    expect(cancelCrawlPageRetryBatch()).toBe(false);
  });
});
