import { describe, expect, it } from "vitest";
import { savedBuildCheckPreviewCache, savedBuildCheckPreviewCacheKey } from "./saved-build-check-cache";

const build = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };
const recommendationPreferences = { profile: "general" as const, priority: "balanced" as const };
const dependencies = { catalogSnapshotAt: "catalog-a", accessoryUpdatedAt: "accessory-a", catalogRevision: 1, engineVersion: "2.58.0" };

describe("saved build check preview cache", () => {
  it("uses the exact compatibility inputs and snapshot dependencies as its key", () => {
    const base = savedBuildCheckPreviewCacheKey({ build, recommendationPreferences, dependencies });
    expect(savedBuildCheckPreviewCacheKey({ build, recommendationPreferences, dependencies })).toBe(base);
    expect(savedBuildCheckPreviewCacheKey({ build: { ...build, useIntegratedGraphics: false }, recommendationPreferences, dependencies })).not.toBe(base);
    expect(savedBuildCheckPreviewCacheKey({ build, recommendationPreferences, dependencies: { ...dependencies, catalogRevision: 2 } })).not.toBe(base);
    expect(savedBuildCheckPreviewCacheKey({ build, recommendationPreferences, dependencies: { ...dependencies, accessoryUpdatedAt: "accessory-b" } })).not.toBe(base);
    expect(savedBuildCheckPreviewCacheKey({ build, recommendationPreferences, dependencies: { ...dependencies, engineVersion: "2.59.0" } })).not.toBe(base);
  });

  it("coalesces identical preview computations without changing the compact value", async () => {
    savedBuildCheckPreviewCache.clear();
    const key = savedBuildCheckPreviewCacheKey({ build, recommendationPreferences, dependencies });
    const value = { status: "compatible", blockerCount: 0, warningCount: 0, unknownCount: 0, totalPriceWon: 0, priceComplete: true, coreTotalPriceWon: 0, corePriceComplete: true, accessoryTotalPriceWon: 0, accessoryPriceComplete: true, analysisScoreLabel: "상위권", analysisConfidence: "high", engineVersion: dependencies.engineVersion, catalogSnapshotAt: dependencies.catalogSnapshotAt, checkedAt: "2026-09-10T00:00:00.000Z" } as const;
    let resolve!: (next: typeof value) => void;
    const pending = new Promise<typeof value>((nextResolve) => { resolve = nextResolve; });
    const first = savedBuildCheckPreviewCache.getOrCompute(key, () => pending);
    const second = savedBuildCheckPreviewCache.getOrCompute(key, () => value);
    resolve(value);
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toMatchObject({ value, lookup: "MISS" });
    expect(secondResult).toMatchObject({ value, lookup: "COALESCED" });
  });
});
