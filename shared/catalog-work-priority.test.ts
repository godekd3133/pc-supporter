import { describe, expect, it } from "vitest";
import { catalogWorkPriorityFor } from "./catalog-work-priority";

const coverage = {
  total: 100,
  complete: 20,
  partial: 80,
  coveragePercent: 20,
  priceKnown: 100,
  priceUnknown: 0,
  qualityCounts: { seed: 0, live: 100, manual: 0, incomplete: 0 },
  freshnessCounts: { fresh: 0, aging: 100, stale: 0, unknown: 0 },
  categories: [
    { category: "gpu" as const, total: 50, complete: 5, partial: 45, coveragePercent: 10, priority: "high" as const, priceKnown: 50, priceUnknown: 0, qualityCounts: { seed: 0, live: 50, manual: 0, incomplete: 0 }, freshnessCounts: { fresh: 0, aging: 50, stale: 0, unknown: 0 }, missingFields: [{ field: "powerW", count: 30 }], unnamedIncomplete: 0 },
    { category: "cpu" as const, total: 50, complete: 15, partial: 35, coveragePercent: 30, priority: "medium" as const, priceKnown: 50, priceUnknown: 0, qualityCounts: { seed: 0, live: 50, manual: 0, incomplete: 0 }, freshnessCounts: { fresh: 0, aging: 50, stale: 0, unknown: 0 }, missingFields: [{ field: "tdpW", count: 12 }], unnamedIncomplete: 0 }
  ]
};

const benchmarkCoverage = {
  cpu: { total: 50, cinebenchR23Single: 20, cinebenchR23Multi: 20, cinebenchR23Complete: 20 },
  gpu: { total: 50, threeDMarkTimeSpy: 0, threeDMarkPortRoyal: 0, threeDMarkComplete: 0 },
  sourceCoverage: {
    cpu: { benchmarked: 20, complete: 20, official: 0, independent_review: 0, community_measurement: 0, other: 0, unclassified: 20 },
    gpu: { benchmarked: 0, complete: 0, official: 0, independent_review: 0, community_measurement: 0, other: 0, unclassified: 0 }
  }
};

describe("catalog work priority", () => {
  it("prioritizes missing GPU benchmark evidence and severe spec gaps", () => {
    const actions = catalogWorkPriorityFor(coverage, benchmarkCoverage, 4);
    expect(actions.map((action) => action.id)).toEqual(["benchmark:gpu", "spec:gpu", "spec:cpu", "benchmark:cpu"]);
    expect(actions[0]).toMatchObject({ kind: "benchmark", category: "gpu", gapCount: 50, coveragePercent: 0 });
    expect(actions[1]).toMatchObject({ kind: "spec", category: "gpu", missingField: "powerW", missingFieldCount: 30 });
  });

  it("keeps the result bounded and omits empty categories", () => {
    expect(catalogWorkPriorityFor(coverage, undefined, 0)).toHaveLength(1);
    expect(catalogWorkPriorityFor({ ...coverage, categories: [{ ...coverage.categories[0], partial: 0, complete: 50, coveragePercent: 100, priority: "none" as const }] }, undefined, 0)).toHaveLength(0);
    expect(catalogWorkPriorityFor(undefined, undefined, 4)).toEqual([]);
  });

  it("adds a separate motherboard PCIe evidence action when width facts are incomplete", () => {
    const actions = catalogWorkPriorityFor({
      ...coverage,
      pcieSlotCoverage: {
        total: 100,
        byRequiredWidth: {
          16: { requiredWidth: 16, total: 100, complete: 100, missing: 0, coveragePercent: 100 },
          8: { requiredWidth: 8, total: 100, complete: 90, missing: 10, coveragePercent: 90 },
          4: { requiredWidth: 4, total: 100, complete: 60, missing: 40, coveragePercent: 60 },
          1: { requiredWidth: 1, total: 100, complete: 40, missing: 60, coveragePercent: 40 }
        }
      }
    }, undefined, 8);

    expect(actions.find((action) => action.id === "pcie:motherboard")).toMatchObject({
      kind: "pcie",
      category: "motherboard",
      total: 100,
      complete: 60,
      gapCount: 40,
      coveragePercent: 60,
      pcieRequiredWidth: 4
    });
  });
});
