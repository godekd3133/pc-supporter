import { describe, expect, it } from "vitest";
import type { CrawlCategoryReport, CrawlManifest, PartCategory } from "../shared/types";
import { DANAWA_CATEGORIES } from "./danawa";
import { crawlResumePlanFor } from "./crawler";

function report(category: PartCategory, overrides: Partial<CrawlCategoryReport> = {}): CrawlCategoryReport {
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
    incompleteSpecs: 0,
    coverage: "complete",
    specCoverage: "complete",
    ...overrides
  };
}

function manifest(reports: CrawlCategoryReport[], overrides: Partial<CrawlManifest> = {}): CrawlManifest {
  return {
    mode: "all",
    startedAt: "2026-09-06T00:00:00.000Z",
    generatedAt: "2026-09-06T00:01:00.000Z",
    coverage: "partial",
    specCoverage: "partial",
    totalExpectedProducts: reports.reduce((sum, item) => sum + item.uniqueProducts + item.missingProducts, 0),
    totalUniqueProducts: reports.reduce((sum, item) => sum + item.uniqueProducts, 0),
    totalDetailFetched: reports.reduce((sum, item) => sum + item.detailFetched, 0),
    totalDetailFailed: reports.reduce((sum, item) => sum + item.detailFailed, 0),
    totalMissingProducts: reports.reduce((sum, item) => sum + item.missingProducts, 0),
    totalIncompleteSpecs: reports.reduce((sum, item) => sum + item.incompleteSpecs, 0),
    categories: reports,
    ...overrides
  };
}

describe("exhaustive crawler resume plan", () => {
  it("skips only categories with both complete listing and complete specs", () => {
    const plan = crawlResumePlanFor(manifest([
      report("gpu"),
      report("ssd", { specCoverage: "partial", incompleteSpecs: 2 })
    ]));

    expect(plan.available).toBe(true);
    expect(plan.completedCategories).toEqual(["gpu"]);
    expect(plan.remainingCategories).toEqual(["cpu", "cooler", "motherboard", "memory", "ssd", "hdd", "case", "psu"]);
    expect(plan.remainingConfigs.map((config) => config.category)).toEqual(plan.remainingCategories);
  });

  it("supports a matching selected-category repair and rejects a different scope", () => {
    const partialGpuManifest = manifest([report("gpu", { coverage: "partial", missingProducts: 3 })], { category: "gpu" });
    const selected = crawlResumePlanFor(partialGpuManifest, "gpu");
    expect(selected.available).toBe(true);
    expect(selected.completedCategories).toEqual([]);
    expect(selected.remainingCategories).toEqual(["gpu"]);

    const mismatched = crawlResumePlanFor(partialGpuManifest);
    expect(mismatched.available).toBe(false);
    expect(mismatched.reason).toContain("수집 범위");
  });

  it("does not offer resume for missing, sample, or already complete manifests", () => {
    expect(crawlResumePlanFor(null).reason).toContain("manifest");
    expect(crawlResumePlanFor(manifest([], { mode: "sample" })).reason).toContain("샘플");
    const complete = manifest(DANAWA_CATEGORIES.map((config) => report(config.category)), { coverage: "complete", specCoverage: "complete" });
    const plan = crawlResumePlanFor(complete);
    expect(plan.available).toBe(false);
    expect(plan.reason).toContain("미완료");
    expect(plan.completedCategories).toHaveLength(DANAWA_CATEGORIES.length);
  });
});
