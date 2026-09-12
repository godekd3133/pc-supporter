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
});
