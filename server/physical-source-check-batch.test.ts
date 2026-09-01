import { describe, expect, it } from "vitest";
import type { PhysicalSourceCheck } from "../shared/types";
import { physicalSourceCheckBatchFor } from "./physical-source-check-batch";

const checkedAt = "2026-09-01T00:00:00.000Z";

function passedCheck(sourceUrl: string): PhysicalSourceCheck {
  return { requestedUrl: sourceUrl, checkedAt, status: "reachable", identityStatus: "matched", redirectCount: 0, httpStatus: 200 };
}

const targets = [
  { partId: "gpu-1", partName: "GPU 1", category: "gpu" as const, sourceUrl: "https://vendor.example/1", manufacturerModel: "GPU-1" },
  { partId: "gpu-2", partName: "GPU 2", category: "gpu" as const, sourceUrl: "https://vendor.example/2", manufacturerModel: "GPU-2" },
  { partId: "gpu-3", partName: "GPU 3", category: "gpu" as const, sourceUrl: "https://vendor.example/3", manufacturerModel: "GPU-3" }
];

describe("physical source check batch", () => {
  it("respects the concurrency limit while preserving target order", async () => {
    let active = 0;
    let maxActive = 0;
    const result = await physicalSourceCheckBatchFor(targets, {
      now: () => checkedAt,
      concurrency: 2,
      check: async (sourceUrl) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return passedCheck(sourceUrl);
      }
    });

    expect(maxActive).toBe(2);
    expect(result.items.map((item) => item.partId)).toEqual(["gpu-1", "gpu-2", "gpu-3"]);
    expect(result).toMatchObject({ totalCandidates: 3, checkedCount: 3, passedCount: 3, reviewCount: 0, persisted: false, persistedCount: 0, persistFailureCount: 0 });
  });

  it("continues after one check failure and reports that item for review", async () => {
    const result = await physicalSourceCheckBatchFor(targets, {
      now: () => checkedAt,
      check: async (sourceUrl) => {
        if (sourceUrl.endsWith("/2")) throw new Error("network failure");
        return passedCheck(sourceUrl);
      }
    });

    expect(result).toMatchObject({ checkedCount: 3, passedCount: 2, reviewCount: 1 });
    expect(result.items[1].sourceCheck).toMatchObject({ status: "unreachable", identityStatus: "not_checked" });
    expect(result.items[2].sourceCheck.status).toBe("reachable");
  });

  it("does not persist results during preview and preserves skipped targets", async () => {
    let persistCalls = 0;
    const result = await physicalSourceCheckBatchFor(targets, {
      now: () => checkedAt,
      limit: 2,
      persist: false,
      persistCheck: async () => { persistCalls += 1; return true; },
      skipped: [{ partId: "missing", reason: "근거 URL 없음" }],
      check: async (sourceUrl) => passedCheck(sourceUrl)
    });

    expect(result).toMatchObject({ persisted: false, totalCandidates: 3, checkedCount: 2, passedCount: 2, persistedCount: 0, persistFailureCount: 0, skipped: [{ partId: "missing", reason: "근거 URL 없음" }] });
    expect(persistCalls).toBe(0);
  });

  it("continues reporting item results when one persistence write fails", async () => {
    const persistedIds: string[] = [];
    const result = await physicalSourceCheckBatchFor(targets.slice(0, 2), {
      now: () => checkedAt,
      persist: true,
      persistCheck: async (partId) => {
        if (partId === "gpu-2") throw new Error("write failure");
        persistedIds.push(partId);
        return true;
      },
      check: async (sourceUrl) => passedCheck(sourceUrl)
    });

    expect(result).toMatchObject({ persisted: true, checkedCount: 2, passedCount: 2, reviewCount: 0, persistedCount: 1, persistFailureCount: 1 });
    expect(persistedIds).toEqual(["gpu-1"]);
    expect(result.items.map((item) => item.persisted)).toEqual([true, false]);
  });
});
