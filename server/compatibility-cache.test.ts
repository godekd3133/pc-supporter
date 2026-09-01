import { describe, expect, it } from "vitest";
import { InFlightDeduper, TtlLruInFlightCache, compatibilityRequestKey, compatibilityResultCacheKey, type CompatibilityResponseCacheValue } from "./compatibility-cache";

describe("compatibility result cache", () => {
  it("returns a cached value within TTL and expires it afterwards", async () => {
    const cache = new TtlLruInFlightCache<string>({ ttlMs: 100, maxEntries: 3 });
    let computes = 0;
    const first = await cache.getOrCompute("a", () => { computes += 1; return "one"; }, 1_000);
    const hit = await cache.getOrCompute("a", () => { computes += 1; return "two"; }, 1_050);
    const expired = await cache.getOrCompute("a", () => { computes += 1; return "three"; }, 1_101);
    expect(first.lookup).toBe("MISS");
    expect(hit).toMatchObject({ value: "one", lookup: "HIT" });
    expect(expired).toMatchObject({ value: "three", lookup: "MISS" });
    expect(computes).toBe(2);
  });

  it("coalesces concurrent computations and does not cache failures", async () => {
    const cache = new TtlLruInFlightCache<number>({ ttlMs: 1_000, maxEntries: 3 });
    let resolve: (value: number) => void = () => undefined;
    const pending = new Promise<number>((nextResolve) => { resolve = nextResolve; });
    const firstPromise = cache.getOrCompute("same", () => pending);
    const secondPromise = cache.getOrCompute("same", () => 99);
    resolve(42);
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toMatchObject({ value: 42, lookup: "MISS" });
    expect(second).toMatchObject({ value: 42, lookup: "COALESCED" });
    await expect(cache.getOrCompute("failed", () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(cache.getOrCompute("failed", () => 7)).resolves.toMatchObject({ value: 7, lookup: "MISS" });
  });

  it("keeps the serialized response body alongside the compact result on cache hits", async () => {
    const cache = new TtlLruInFlightCache<CompatibilityResponseCacheValue>({ ttlMs: 1_000, maxEntries: 2 });
    const result = { status: "compatible", checkedAt: "2026-08-31T00:00:00.000Z" } as CompatibilityResponseCacheValue["result"];
    let computes = 0;
    const first = await cache.getOrCompute("response", () => {
      computes += 1;
      return { result, body: JSON.stringify(result) };
    });
    const hit = await cache.getOrCompute("response", () => {
      computes += 1;
      return { result, body: "should-not-be-used" };
    });
    expect(first.lookup).toBe("MISS");
    expect(hit.lookup).toBe("HIT");
    expect(hit.value.result).toBe(result);
    expect(hit.value.body).toBe(first.value.body);
    expect(computes).toBe(1);
  });

  it("evicts the least recently used entry and exposes useful counters", async () => {
    const cache = new TtlLruInFlightCache<string>({ ttlMs: 1_000, maxEntries: 2 });
    await cache.getOrCompute("a", () => "a");
    await cache.getOrCompute("b", () => "b");
    await cache.getOrCompute("a", () => "new-a");
    await cache.getOrCompute("c", () => "c");
    expect(await cache.getOrCompute("a", () => "wrong")).toMatchObject({ value: "a", lookup: "HIT" });
    expect(await cache.getOrCompute("b", () => "new-b")).toMatchObject({ value: "new-b", lookup: "MISS" });
    expect(cache.stats()).toMatchObject({ size: 2, evictions: 2 });
  });

  it("changes the key when an input or catalog dependency changes", () => {
    const base = { build: { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true }, recommendationPreferences: { profile: "general" as const, priority: "balanced" as const }, catalogSnapshotAt: "catalog-a", accessoryUpdatedAt: "accessory-a", catalogRevision: 1, engineVersion: "2.53.0" };
    expect(compatibilityResultCacheKey(base)).toBe(compatibilityResultCacheKey(base));
    expect(compatibilityResultCacheKey({ ...base, catalogRevision: 2 })).not.toBe(compatibilityResultCacheKey(base));
    expect(compatibilityResultCacheKey({ ...base, accessoryUpdatedAt: "accessory-b" })).not.toBe(compatibilityResultCacheKey(base));
  });

  it("coalesces the whole request pipeline before catalog validation finishes", async () => {
    const deduper = new InFlightDeduper<string>();
    let resolve: (value: string) => void = () => undefined;
    const pending = new Promise<string>((nextResolve) => { resolve = nextResolve; });
    const firstPromise = deduper.getOrCompute("request", () => pending);
    const secondPromise = deduper.getOrCompute("request", () => "wrong");
    expect(deduper.size()).toBe(1);
    resolve("computed once");
    await expect(firstPromise).resolves.toMatchObject({ value: "computed once", lookup: "MISS" });
    await expect(secondPromise).resolves.toMatchObject({ value: "computed once", lookup: "COALESCED" });
    expect(deduper.size()).toBe(0);
  });

  it("separates request keys by input and engine version", () => {
    const build = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };
    const preferences = { profile: "general" as const, priority: "balanced" as const };
    expect(compatibilityRequestKey(build, preferences, "2.53.0")).toBe(compatibilityRequestKey(build, preferences, "2.53.0"));
    expect(compatibilityRequestKey(build, preferences, "2.54.0")).not.toBe(compatibilityRequestKey(build, preferences, "2.53.0"));
  });
});
