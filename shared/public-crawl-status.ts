import type { CrawlStatus } from "./types";

const PUBLIC_CRAWL_STATUS_KEYS = [
  "status",
  "mode",
  "category",
  "categoriesCompleted",
  "categoriesTotal",
  "pagesVisited",
  "pagesExpected",
  "listedProducts",
  "productsSeen",
  "productsUpdated",
  "detailFetched",
  "detailFailed",
  "failedProducts",
  "missingProducts",
  "incompleteSpecs",
  "coverage",
  "specCoverage"
] as const satisfies readonly (keyof CrawlStatus)[];

export function publicCrawlStatusFor(status: CrawlStatus): CrawlStatus {
  const publicStatus = Object.fromEntries(PUBLIC_CRAWL_STATUS_KEYS.flatMap((key) => status[key] === undefined ? [] : [[key, status[key]]])) as Partial<CrawlStatus>;
  return publicStatus as CrawlStatus;
}
