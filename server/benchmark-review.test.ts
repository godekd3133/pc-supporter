import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { benchmark3DMarkReviewWorkPackageFor, benchmarkReviewQueueFor } from "./benchmark-review";

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: "cpu-default",
    category: "cpu",
    name: "확인 CPU",
    source: "danawa",
    sourceProductCode: "cpu-default",
    priceWon: 120000,
    specs: { cinebenchR23Single: 2000, cinebenchR23Multi: 10000 },
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides
  };
}

describe("benchmark review queue", () => {
  it("counts complete, partial, and missing CPU/GPU benchmark coverage", () => {
    const queue = benchmarkReviewQueueFor([
      part({ id: "cpu-complete" }),
      part({ id: "cpu-partial", specs: { cinebenchR23Single: 2100 } }),
      part({ id: "cpu-missing", specs: {} }),
      part({ id: "gpu-complete", category: "gpu", specs: { gpu3dmarkTimeSpyScore: 15000, gpu3dmarkPortRoyalScore: 11000 } }),
      part({ id: "gpu-partial", category: "gpu", specs: { gpu3dmarkTimeSpyScore: 14000 } }),
      part({ id: "gpu-missing", category: "gpu", specs: {} })
    ], 10, "2026-08-31T00:00:00.000Z");

    expect(queue.totals).toEqual({
      cpu: { total: 3, complete: 1, partial: 1, missing: 1, stale: 0 },
      gpu: { total: 3, complete: 1, partial: 1, missing: 1, stale: 0 }
    });
    expect(queue.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ partId: "cpu-partial", status: "partial", missingScores: ["cinebenchR23Multi"] }),
      expect.objectContaining({ partId: "gpu-missing", status: "missing", missingScores: ["gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore"] })
    ]));
  });

  it("prioritizes partial live products and interleaves CPU and GPU work", () => {
    const queue = benchmarkReviewQueueFor([
      part({ id: "cpu-missing-a", specs: {}, dataQuality: "seed", priceWon: undefined }),
      part({ id: "cpu-partial-live", specs: { cinebenchR23Single: 2100 }, dataQuality: "live", danawaUrl: "https://prod.danawa.com/info/?pcode=1" }),
      part({ id: "gpu-missing-a", category: "gpu", specs: {}, dataQuality: "live", danawaUrl: "https://prod.danawa.com/info/?pcode=2" }),
      part({ id: "gpu-partial", category: "gpu", specs: { gpu3dmarkTimeSpyScore: 14000 }, dataQuality: "manual" })
    ], 4);

    expect(queue.items.map((item) => item.category)).toEqual(["cpu", "gpu", "cpu", "gpu"]);
    expect(queue.items[0].partId).toBe("cpu-partial-live");
    expect(queue.items[1].partId).toBe("gpu-partial");
    expect(queue.items[0].reviewPriorityScore).toBeGreaterThan(queue.items[2].reviewPriorityScore);
  });

  it("does not loop when one category has no review candidates", () => {
    const queue = benchmarkReviewQueueFor([
      part({ id: "cpu-only", specs: { cinebenchR23Single: 2000 } })
    ], 10);

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0].category).toBe("cpu");
  });

  it("returns stale or unknown complete benchmark sets to the review queue", () => {
    const now = "2026-08-31T00:00:00.000Z";
    const queue = benchmarkReviewQueueFor([
      part({ id: "cpu-stale", updatedAt: "2026-07-01T00:00:00.000Z" }),
      part({ id: "cpu-fresh", updatedAt: "2026-08-30T00:00:00.000Z" }),
      part({
        id: "cpu-unknown",
        updatedAt: "2026-08-30T00:00:00.000Z",
        specs: {
          cinebenchR23Single: 2000,
          cinebenchR23Multi: 10000,
          benchmarkProvenance: { sourceKind: "other", sourceNote: "시점 미확인", updatedAt: "not-a-date" }
        }
      })
    ], 10, now);

    expect(queue.totals.cpu).toEqual({ total: 3, complete: 1, partial: 0, missing: 0, stale: 2 });
    expect(queue.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ partId: "cpu-stale", status: "stale", benchmarkFreshness: "stale", missingScores: [] }),
      expect.objectContaining({ partId: "cpu-unknown", status: "stale", benchmarkFreshness: "unknown", benchmarkUpdatedAt: "not-a-date" })
    ]));
  });

  it("separates unclassified benchmark provenance into a source review queue", () => {
    const now = "2026-08-31T00:00:00.000Z";
    const queue = benchmarkReviewQueueFor([
      part({ id: "cpu-complete-unclassified" }),
      part({ id: "cpu-partial-unclassified", specs: { cinebenchR23Single: 2100 } }),
      part({ id: "cpu-complete-official", specs: { cinebenchR23Single: 2200, cinebenchR23Multi: 11000, benchmarkProvenance: { sourceKind: "official", sourceNote: "공식 표", updatedAt: now } } }),
      part({ id: "gpu-no-benchmark", category: "gpu", specs: { vramGb: 8 } })
    ], 10, now);

    expect(queue.sourceTotals).toEqual({
      cpu: { benchmarked: 3, unclassified: 2, sourceCheckNeedsReview: 0 },
      gpu: { benchmarked: 0, unclassified: 0, sourceCheckNeedsReview: 0 }
    });
    expect(queue.sourceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ partId: "cpu-complete-unclassified", missingScores: [], presentScores: { cinebenchR23Single: 2000, cinebenchR23Multi: 10000 } }),
      expect.objectContaining({ partId: "cpu-partial-unclassified", missingScores: ["cinebenchR23Multi"] })
    ]));
    expect(queue.sourceItems.some((item) => item.partId === "cpu-complete-official")).toBe(false);
  });

  it("builds a GPU-only 3DMark work package with stable pagination and fingerprint", () => {
    const now = "2026-09-06T00:00:00.000Z";
    const catalog = [
      part({ id: "gpu-complete", category: "gpu", specs: { gpu3dmarkTimeSpyScore: 15000, gpu3dmarkPortRoyalScore: 11000 } }),
      part({ id: "gpu-partial", category: "gpu", specs: { gpu3dmarkTimeSpyScore: 14000 }, priceWon: 500000 }),
      part({ id: "gpu-missing", category: "gpu", specs: {} }),
      part({ id: "gpu-stale-complete", category: "gpu", specs: { gpu3dmarkTimeSpyScore: 13000, gpu3dmarkPortRoyalScore: 9000 }, updatedAt: "2026-01-01T00:00:00.000Z" }),
      part({ id: "cpu-missing", category: "cpu", specs: {} })
    ];

    const first = benchmark3DMarkReviewWorkPackageFor(catalog, { now, generatedAt: now, limit: 1 });
    expect(first).toMatchObject({
      schemaVersion: 1,
      kind: "3dmark-gpu-review-package",
      readOnly: true,
      category: "gpu",
      offset: 0,
      limit: 1,
      summary: { totalGpu: 4, completeCount: 2, partialCount: 1, missingCount: 1, queueTotal: 2, includedCount: 1, remainingCount: 1 }
    });
    expect(first.items[0]).toMatchObject({ partId: "gpu-partial", status: "partial", missingScores: ["gpu3dmarkPortRoyalScore"], catalogUrl: "/catalog?category=gpu&partId=gpu-partial" });
    expect(first.nextOffset).toBe(1);
    expect(first.queueFingerprint).toMatch(/^b3mr1-/);

    const next = benchmark3DMarkReviewWorkPackageFor(catalog, { now, generatedAt: "2026-09-06T01:00:00.000Z", offset: first.nextOffset, limit: 1 });
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({ partId: "gpu-missing", status: "missing", missingScores: ["gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore"] });
    expect(next.nextOffset).toBeUndefined();
    expect(next.queueFingerprint).toBe(first.queueFingerprint);

    const completedPartial = catalog.map((item) => item.id === "gpu-partial" ? { ...item, specs: { gpu3dmarkTimeSpyScore: 14000, gpu3dmarkPortRoyalScore: 10000 } } : item);
    expect(benchmark3DMarkReviewWorkPackageFor(completedPartial, { now }).queueFingerprint).not.toBe(first.queueFingerprint);
  });

  it("returns classified benchmark sources whose URL has not passed source-check", () => {
    const now = "2026-08-31T00:00:00.000Z";
    const queue = benchmarkReviewQueueFor([
      part({
        id: "cpu-url-unchecked",
        specs: {
          cinebenchR23Single: 2200,
          cinebenchR23Multi: 11000,
          benchmarkProvenance: { sourceKind: "official", sourceNote: "공식 표", sourceUrl: "https://vendor.example/cpu", updatedAt: now }
        }
      }),
      part({
        id: "cpu-url-checked",
        specs: {
          cinebenchR23Single: 2300,
          cinebenchR23Multi: 12000,
          benchmarkProvenance: {
            sourceKind: "official",
            sourceNote: "공식 표",
            sourceUrl: "https://vendor.example/cpu-checked",
            sourceCheck: { requestedUrl: "https://vendor.example/cpu-checked", checkedAt: now, status: "reachable", identityStatus: "matched", redirectCount: 0 },
            updatedAt: now
          }
        }
      })
    ], 10, now);

    expect(queue.sourceTotals.cpu.sourceCheckNeedsReview).toBe(1);
    expect(queue.sourceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ partId: "cpu-url-unchecked", sourceCheckNeedsReview: true, reviewReason: "완전 세트 · 출처 확인 필요" })
    ]));
    expect(queue.sourceItems.some((item) => item.partId === "cpu-url-checked")).toBe(false);
  });
});
