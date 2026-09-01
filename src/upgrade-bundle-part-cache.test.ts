import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { createPartDetailsCache } from "./upgrade-bundle-part-cache";

function part(id: string): Part {
  return { id, category: "cpu", name: id, source: "manual", specs: {}, dataQuality: "manual", missingFields: [], updatedAt: "2026-08-31T00:00:00.000Z" };
}

describe("upgrade bundle part details cache", () => {
  it("shares concurrent requests and reuses the resolved part", async () => {
    let calls = 0;
    const cache = createPartDetailsCache(async (id) => {
      calls += 1;
      return part(id);
    });
    const [first, second] = await Promise.all([cache.get("cpu-1"), cache.get("cpu-1")]);
    expect(calls).toBe(1);
    expect(first).toBe(second);
    expect(await cache.get("cpu-1")).toBe(first);
    expect(calls).toBe(1);
  });

  it("prefetches unique parts in one batch and scopes cached values by catalog snapshot", async () => {
    let singleCalls = 0;
    let batchCalls = 0;
    const cache = createPartDetailsCache(
      async (id) => {
        singleCalls += 1;
        return part(id);
      },
      async (ids) => {
        batchCalls += 1;
        return ids.map(part);
      }
    );
    await cache.prefetch(["cpu-1", "cpu-1", "cpu-2"], "snapshot-a");
    expect(batchCalls).toBe(1);
    expect(singleCalls).toBe(0);
    expect(cache.has("cpu-1", "snapshot-a")).toBe(true);
    await cache.prefetch(["cpu-1", "cpu-2"], "snapshot-a");
    expect(batchCalls).toBe(1);
    await cache.get("cpu-1", "snapshot-b");
    expect(singleCalls).toBe(1);
  });

  it("allows a failed request to be retried", async () => {
    let calls = 0;
    const cache = createPartDetailsCache(async (id) => {
      calls += 1;
      if (calls === 1) throw new Error("temporary failure");
      return part(id);
    });
    await expect(cache.get("cpu-2")).rejects.toThrow("temporary failure");
    await expect(cache.get("cpu-2")).resolves.toMatchObject({ id: "cpu-2" });
    expect(calls).toBe(2);
  });
});
