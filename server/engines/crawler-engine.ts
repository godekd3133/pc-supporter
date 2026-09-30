// 크롤링 엔진 모듈 — 다나와 수집(crawler.ts)과 주변 부품 수집
// (accessory-crawler.ts)을 하나의 운영 표면으로 묶는다. 라우트는 이
// 파사드만 호출하고, env로 주입되는 엔진 파라미터 해석도 여기서 담당한다.
import { isAccessoryCrawlRunning, readAccessoryCrawlManifest, readAccessoryCrawlStatus, runAccessoryCrawlJob } from "../accessory-crawler";
import { cancelCrawlPageRetryBatch, crawlPageRetryBatchPlanFor, crawlPageRetryPlanFor, crawlResumePlanFor, isCrawlPageRetryBatchRunning, isCrawlRunning, readCrawlStatus, runCrawlJob, runCrawlPageRetryBatchJob, runCrawlPageRetryJob } from "../crawler";
import { CRAWL_MANIFEST_PATH, readJson } from "../storage";
import type { CrawlCategoryReport, CrawlManifest } from "../../shared/types";

// 크롤러 재노출 — 라우트/관리자 코드는 이 경계만 임포트한다.
export {
  cancelCrawlPageRetryBatch,
  crawlPageRetryBatchPlanFor,
  crawlPageRetryPlanFor,
  crawlResumePlanFor,
  isAccessoryCrawlRunning,
  isCrawlPageRetryBatchRunning,
  isCrawlRunning,
  readAccessoryCrawlManifest,
  readAccessoryCrawlStatus,
  readCrawlStatus,
  runAccessoryCrawlJob,
  runCrawlJob,
  runCrawlPageRetryBatchJob,
  runCrawlPageRetryJob
};

// 수집 엔진에 실제로 적용되는 파라미터 — 서버 환경 변수로 조정한다.
export function crawlerEngineParametersFor() {
  return {
    delayMs: Number(process.env.DANAWA_CRAWL_DELAY_MS ?? 850),
    timeoutMs: Number(process.env.DANAWA_CRAWL_TIMEOUT_MS ?? 20000),
    retries: Number(process.env.DANAWA_CRAWL_RETRIES ?? 2),
    pages: Number(process.env.DANAWA_CRAWL_PAGES ?? 1),
    limitPerCategory: Number(process.env.DANAWA_CRAWL_LIMIT ?? 5),
    details: process.env.DANAWA_CRAWL_DETAILS !== "false"
  };
}

export type CrawlerEngineParameters = ReturnType<typeof crawlerEngineParametersFor>;

// pageProductCodes는 페이지별 상품 코드 전체 목록이라 화면에 필요 없고
// 응답만 커지므로 범주 리포트에서 제외한다.
function stripPageProductCodes(category: CrawlCategoryReport) {
  const { pageProductCodes: _pageProductCodes, ...rest } = category;
  return rest;
}

// 크롤링 엔진 화면/상태 API용 스냅샷 — 실행 중 상태·엔진 파라미터·
// 핵심/주변 부품 manifest를 한 번에 묶는다.
export async function crawlerEngineSnapshot() {
  const manifest = await readJson<CrawlManifest | null>(CRAWL_MANIFEST_PATH, null);
  const accessoryManifest = await readAccessoryCrawlManifest();
  return {
    parameters: crawlerEngineParametersFor(),
    catalog: {
      status: await readCrawlStatus(),
      manifest: manifest ? { ...manifest, categories: manifest.categories.map(stripPageProductCodes) } : null
    },
    accessories: {
      status: await readAccessoryCrawlStatus(),
      manifest: accessoryManifest
    }
  };
}

// /api/admin/engines용 축약 상태.
export async function crawlerEngineStatus() {
  const status = await readCrawlStatus();
  const accessoryStatus = await readAccessoryCrawlStatus();
  return {
    id: "crawler" as const,
    label: "크롤링 엔진",
    parameters: crawlerEngineParametersFor(),
    catalog: {
      status: status.status,
      mode: status.mode,
      operation: status.operation,
      startedAt: status.startedAt,
      finishedAt: status.finishedAt,
      coverage: status.coverage,
      specCoverage: status.specCoverage,
      pagesVisited: status.pagesVisited,
      pagesExpected: status.pagesExpected,
      failedPages: status.failedPages?.length ?? 0,
      categoriesCompleted: status.categoriesCompleted,
      categoriesTotal: status.categoriesTotal,
      message: status.message,
      error: status.error
    },
    accessories: {
      status: accessoryStatus.status,
      mode: accessoryStatus.mode,
      startedAt: accessoryStatus.startedAt,
      finishedAt: accessoryStatus.finishedAt,
      coverage: accessoryStatus.coverage,
      specCoverage: accessoryStatus.specCoverage,
      pagesVisited: accessoryStatus.pagesVisited,
      pagesExpected: accessoryStatus.pagesExpected,
      categoriesCompleted: accessoryStatus.categoriesCompleted,
      categoriesTotal: accessoryStatus.categoriesTotal,
      message: accessoryStatus.message,
      error: accessoryStatus.error
    }
  };
}
