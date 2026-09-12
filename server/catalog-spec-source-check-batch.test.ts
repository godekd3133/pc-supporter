import { describe, expect, it } from "vitest";
import { catalogSpecSourceCheckBatchFor } from "./catalog-spec-source-check-batch";

const targets = [
  { partId: "gpu-1", partName: "GPU 1", category: "gpu" as const, sourceUrl: "https://vendor.example/gpu-1", manufacturerModel: "GPU-1" },
  { partId: "case-1", partName: "Case 1", category: "case" as const, sourceUrl: "https://vendor.example/case-1", manufacturerModel: "CASE-1" },
  { partId: "cpu-1", partName: "CPU 1", category: "cpu" as const, sourceUrl: "https://vendor.example/cpu-1", manufacturerModel: "CPU-1" }
];

describe("catalog spec source-check batch", () => {
  it("bounds work, keeps target order, and reports per-item failures", async () => {
    let active = 0;
    let maxActive = 0;
    const result = await catalogSpecSourceCheckBatchFor(targets, {
      limit: 2,
      concurrency: 2,
      now: () => "2026-09-03T00:00:00.000Z",
      check: async (sourceUrl) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (sourceUrl.includes("case-1")) throw new Error("offline");
        return { requestedUrl: sourceUrl, checkedAt: "2026-09-03T00:00:00.000Z", status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0, httpStatus: 200 };
      }
    });

    expect(maxActive).toBe(2);
    expect(result).toMatchObject({ totalCandidates: 3, offset: 0, nextOffset: 2, checkedCount: 2, passedCount: 1, reviewCount: 1, persisted: false, persistedCount: 0, persistFailureCount: 0 });
    expect(result.items.map((item) => item.partId)).toEqual(["gpu-1", "case-1"]);
    expect(result.items[1].sourceCheck).toMatchObject({ status: "unreachable", identityStatus: "not_checked" });
  });

  it("persists only when requested and keeps persistence failures visible", async () => {
    const persistedIds: string[] = [];
    const result = await catalogSpecSourceCheckBatchFor(targets.slice(0, 2), {
      persist: true,
      now: () => "2026-09-03T00:00:00.000Z",
      check: async (sourceUrl) => ({ requestedUrl: sourceUrl, checkedAt: "2026-09-03T00:00:00.000Z", status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0 }),
      persistCheck: async (partId) => {
        if (partId === "case-1") throw new Error("write failure");
        persistedIds.push(partId);
        return true;
      }
    });

    expect(result).toMatchObject({ persisted: true, checkedCount: 2, passedCount: 2, persistedCount: 1, persistFailureCount: 1 });
    expect(persistedIds).toEqual(["gpu-1"]);
  });

  it("resumes from the requested offset and omits nextOffset on the final page", async () => {
    const result = await catalogSpecSourceCheckBatchFor(targets, {
      offset: 2,
      limit: 2,
      now: () => "2026-09-03T00:00:00.000Z",
      check: async (sourceUrl) => ({ requestedUrl: sourceUrl, checkedAt: "2026-09-03T00:00:00.000Z", status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0 })
    });

    expect(result).toMatchObject({ totalCandidates: 3, offset: 2, checkedCount: 1, passedCount: 1 });
    expect(result).not.toHaveProperty("nextOffset");
    expect(result.items.map((item) => item.partId)).toEqual(["cpu-1"]);
  });
});
