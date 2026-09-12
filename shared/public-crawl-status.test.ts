import { describe, expect, it } from "vitest";
import type { CrawlStatus } from "./types";
import { publicCrawlStatusFor } from "./public-crawl-status";

describe("public crawl status", () => {
  it("keeps progress fields while removing worker and manifest details", () => {
    const status: CrawlStatus = {
      status: "failed",
      mode: "all",
      category: "gpu",
      startedAt: "2026-09-05T00:00:00.000Z",
      finishedAt: "2026-09-05T00:01:00.000Z",
      categoriesCompleted: 2,
      categoriesTotal: 9,
      pagesVisited: 4,
      pagesExpected: 12,
      listedProducts: 90,
      productsSeen: 80,
      productsUpdated: 70,
      detailFetched: 60,
      detailFailed: 5,
      failedProducts: 5,
      missingProducts: 3,
      incompleteSpecs: 7,
      coverage: "partial",
      specCoverage: "partial",
      manifestPath: "/private/data/crawl-manifest.json",
      workerPid: 1234,
      message: "private diagnostic",
      error: "private error"
    };

    const publicStatus = publicCrawlStatusFor(status);

    expect(publicStatus).toMatchObject({ status: "failed", mode: "all", category: "gpu", categoriesCompleted: 2, listedProducts: 90, coverage: "partial" });
    expect(publicStatus).not.toHaveProperty("startedAt");
    expect(publicStatus).not.toHaveProperty("finishedAt");
    expect(publicStatus).not.toHaveProperty("manifestPath");
    expect(publicStatus).not.toHaveProperty("workerPid");
    expect(publicStatus).not.toHaveProperty("message");
    expect(publicStatus).not.toHaveProperty("error");
  });
});
