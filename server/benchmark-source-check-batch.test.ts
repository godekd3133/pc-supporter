import { describe, expect, it, vi } from "vitest";
import { benchmarkSourceCheckBatchFor } from "./benchmark-source-check-batch";

const targets = [
  { partId: "cpu-1", partName: "CPU 1", category: "cpu" as const, sourceUrl: "https://vendor.example/cpu-1", manufacturerModel: "CPU-1" },
  { partId: "gpu-1", partName: "GPU 1", category: "gpu" as const, sourceUrl: "https://vendor.example/gpu-1", manufacturerModel: "GPU-1" },
  { partId: "cpu-2", partName: "CPU 2", category: "cpu" as const, sourceUrl: "https://vendor.example/cpu-2", manufacturerModel: "CPU-2" }
];

describe("benchmark source-check batch", () => {
  it("bounds work, preserves per-item failures, and reports persistence counts", async () => {
    const persistCheck = vi.fn(async (partId: string) => partId === "cpu-1");
    const result = await benchmarkSourceCheckBatchFor(targets, {
      limit: 2,
      concurrency: 1,
      persist: true,
      now: () => "2026-09-03T00:00:00.000Z",
      check: vi.fn(async (sourceUrl: string) => {
        if (sourceUrl.includes("gpu-1")) throw new Error("offline");
        return { requestedUrl: sourceUrl, checkedAt: "2026-09-03T00:00:00.000Z", status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0, httpStatus: 200 };
      }),
      persistCheck
    });

    expect(result).toMatchObject({ totalCandidates: 3, checkedCount: 2, passedCount: 1, reviewCount: 1, persistedCount: 1, persistFailureCount: 1 });
    expect(result.items[0]).toMatchObject({ partId: "cpu-1", sourceCheck: { status: "reachable" }, persisted: true });
    expect(result.items[1]).toMatchObject({ partId: "gpu-1", sourceCheck: { status: "unreachable", identityStatus: "not_checked" }, persisted: false });
    expect(persistCheck).toHaveBeenCalledTimes(2);
  });

  it("does not persist during preview checks", async () => {
    const persistCheck = vi.fn();
    const result = await benchmarkSourceCheckBatchFor(targets.slice(0, 1), {
      persist: false,
      check: async (sourceUrl) => ({ requestedUrl: sourceUrl, checkedAt: "2026-09-03T00:00:00.000Z", status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0 }),
      persistCheck
    });

    expect(result.persisted).toBe(false);
    expect(result.persistedCount).toBe(0);
    expect(persistCheck).not.toHaveBeenCalled();
  });
});
