import { describe, expect, it } from "vitest";
import { PART_CATEGORIES } from "../shared/types";
import { seedCatalog } from "./seed-catalog";
import { extendedSeedCatalog, starterCatalog } from "./seed-catalog-starter";

describe("starter catalog", () => {
  it("expands a clean checkout without changing the legacy seed contract", () => {
    expect(extendedSeedCatalog.length).toBeGreaterThanOrEqual(90);
    expect(starterCatalog.length).toBeGreaterThanOrEqual(115);
    expect(starterCatalog.length).toBe(seedCatalog.length + extendedSeedCatalog.length);
    expect(new Set(starterCatalog.map((part) => part.id)).size).toBe(starterCatalog.length);
    expect(new Set(starterCatalog.map((part) => part.category))).toEqual(new Set(PART_CATEGORIES));
    expect(extendedSeedCatalog.every((part) => part.source === "seed" && part.dataQuality === "seed" && part.listingType === "retail" && part.missingFields.length === 0)).toBe(true);

    const minimumPartsByCategory: Record<string, number> = {
      cpu: 15,
      cooler: 10,
      motherboard: 15,
      memory: 14,
      gpu: 15,
      ssd: 12,
      hdd: 5,
      case: 12,
      psu: 15
    };

    for (const category of PART_CATEGORIES) {
      expect(starterCatalog.filter((part) => part.category === category).length).toBeGreaterThanOrEqual(minimumPartsByCategory[category]);
    }
  });

  it("does not assign benchmark scores to synthetic GPU reference parts", () => {
    const referenceGpuIds = ["gpu-mainstream-8gb-ref", "gpu-performance-12gb-ref", "gpu-creator-16gb-ref"];
    const referenceGpus = referenceGpuIds.map((id) => starterCatalog.find((part) => part.id === id));

    expect(referenceGpus.every(Boolean)).toBe(true);
    for (const referenceGpu of referenceGpus) {
      expect(referenceGpu?.specs.gpu3dmarkTimeSpyScore).toBeUndefined();
      expect(referenceGpu?.specs.gpu3dmarkPortRoyalScore).toBeUndefined();
    }
    expect(referenceGpus.map((part) => part?.specs.vramGb)).toEqual([8, 12, 16]);
  });
});
