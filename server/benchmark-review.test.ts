import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { benchmarkReviewQueueFor } from "./benchmark-review";

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: "cpu-default",
    category: "cpu",
    name: "검수 CPU",
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
    ], 10);

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
      cpu: { benchmarked: 3, unclassified: 2 },
      gpu: { benchmarked: 0, unclassified: 0 }
    });
    expect(queue.sourceItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ partId: "cpu-complete-unclassified", missingScores: [], presentScores: { cinebenchR23Single: 2000, cinebenchR23Multi: 10000 } }),
      expect.objectContaining({ partId: "cpu-partial-unclassified", missingScores: ["cinebenchR23Multi"] })
    ]));
    expect(queue.sourceItems.some((item) => item.partId === "cpu-complete-official")).toBe(false);
  });
});
