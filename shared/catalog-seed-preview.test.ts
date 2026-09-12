import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { catalogSeedPreviewFor } from "./catalog-seed-preview";

function part(overrides: Partial<Part>): Part {
  return {
    id: "cpu-a",
    category: "cpu",
    name: "CPU A",
    source: "seed",
    dataQuality: "seed",
    missingFields: [],
    updatedAt: "2026-08-26T00:00:00.000Z",
    specs: { socket: "AM5", cores: 6 },
    ...overrides
  };
}

describe("catalog seed preview", () => {
  it("reports category coverage, missing starter items, and value conflicts without mutating inputs", () => {
    const starter = [
      part({ id: "cpu-a", category: "cpu", name: "CPU A", specs: { socket: "AM5", cores: 6 } }),
      part({ id: "cpu-b", category: "cpu", name: "CPU B", priceWon: 100_000, specs: { socket: "AM5", cores: 8 } }),
      part({ id: "gpu-a", category: "gpu", name: "GPU A", specs: { vramGb: 12 } })
    ];
    const active = [
      part({ id: "cpu-a", category: "cpu", name: "CPU A live", source: "danawa", dataQuality: "live", priceWon: 120_000, specs: { cores: 6, socket: "AM5" } }),
      part({ id: "gpu-a", category: "gpu", name: "GPU A", source: "manual", dataQuality: "manual", specs: { vramGb: 12 } }),
      part({ id: "hdd-a", category: "hdd", name: "HDD A", source: "danawa", dataQuality: "incomplete", specs: { capacityGb: 4000 } })
    ];
    const preview = catalogSeedPreviewFor(starter, active, { generatedAt: "2026-09-03T00:00:00.000Z", coreEligibleCount: 2, excludedNonCoreCount: 1 });

    expect(preview).toMatchObject({
      schemaVersion: 1,
      kind: "catalog-seed-preview",
      generatedAt: "2026-09-03T00:00:00.000Z",
      readOnly: true,
      starter: { total: 3, categoryCounts: { cpu: 2, gpu: 1 } },
      active: {
        total: 3,
        coreEligibleCount: 2,
        excludedNonCoreCount: 1,
        sourceCounts: { seed: 0, danawa: 2, manual: 1 },
        qualityCounts: { seed: 0, live: 1, manual: 1, incomplete: 1 }
      },
      coverage: { matchedCount: 2, missingCount: 1, conflictCount: 1, coveragePercent: 66.7 }
    });
    expect(preview.categoryRows.find((row) => row.category === "cpu")).toMatchObject({ starterCount: 2, activeCount: 1, matchedCount: 1, missingCount: 1, coveragePercent: 50 });
    expect(preview.missingItems).toEqual([{ id: "cpu-b", category: "cpu", name: "CPU B", priceWon: 100_000 }]);
    expect(preview.conflicts).toEqual([{ id: "cpu-a", category: "cpu", starterName: "CPU A", activeName: "CPU A live", activeSource: "danawa", activeDataQuality: "live", differences: ["name", "price"] }]);
    expect(starter[0].name).toBe("CPU A");
    expect(active[0].specs).toEqual({ cores: 6, socket: "AM5" });
  });

  it("does not mark equivalent specs as a conflict when object key order differs", () => {
    const starter = [part({ id: "cpu-a", specs: { socket: "AM5", cores: 6, radiatorSizesMm: [240, 360] } })];
    const active = [part({ id: "cpu-a", source: "manual", dataQuality: "manual", specs: { radiatorSizesMm: [240, 360], cores: 6, socket: "AM5" } })];

    expect(catalogSeedPreviewFor(starter, active).coverage).toMatchObject({ matchedCount: 1, missingCount: 0, conflictCount: 0, coveragePercent: 100 });
  });
});
