import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { catalogMissingFieldCountsFor, catalogMissingFieldLabelFor, catalogPcieSlotCoverageDeltaFor, catalogPcieSlotCoverageFor, catalogSpecCoverageFor } from "./catalog-spec-coverage";

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: "part-1",
    category: "cpu",
    name: "테스트 부품",
    source: "danawa",
    priceWon: 100_000,
    specs: {},
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...overrides
  };
}

describe("catalog spec coverage", () => {
  it("summarizes complete and partial records by category", () => {
    const coverage = catalogSpecCoverageFor([
      part({ id: "cpu-complete", dataQuality: "live", missingFields: [] }),
      part({ id: "cpu-partial", dataQuality: "incomplete", missingFields: ["tdpW", "socket"] }),
      part({ id: "gpu-partial", category: "gpu", dataQuality: "incomplete", priceWon: undefined, missingFields: ["powerW", "socket"] })
    ], "2026-09-03T12:00:00.000Z");

    expect(coverage).toMatchObject({ total: 3, complete: 1, partial: 2, coveragePercent: 33.3, priceKnown: 2, priceUnknown: 1 });
    expect(coverage.qualityCounts).toMatchObject({ live: 1, incomplete: 2 });
    expect(coverage.categories.find((category) => category.category === "cpu")).toMatchObject({ total: 2, complete: 1, partial: 1, coveragePercent: 50, priority: "high", missingFields: [{ field: "socket", count: 1 }, { field: "tdpW", count: 1 }] });
    expect(coverage.categories.find((category) => category.category === "gpu")).toMatchObject({ total: 1, complete: 0, partial: 1, priority: "high", priceKnown: 0, priceUnknown: 1, missingFields: [{ field: "powerW", count: 1 }, { field: "socket", count: 1 }] });
  });

  it("tracks unnamed incomplete records instead of pretending a missing field list is complete", () => {
    const coverage = catalogSpecCoverageFor([part({ dataQuality: "incomplete", missingFields: [] })], "2026-09-03T12:00:00.000Z");

    expect(coverage.complete).toBe(0);
    expect(coverage.partial).toBe(1);
    expect(coverage.categories.find((category) => category.category === "cpu")).toMatchObject({ unnamedIncomplete: 1, priority: "high", missingFields: [] });
  });

  it("keeps empty categories explicit and gives an empty catalog full vacuous coverage", () => {
    const coverage = catalogSpecCoverageFor([], "2026-09-03T12:00:00.000Z");

    expect(coverage).toMatchObject({ total: 0, complete: 0, partial: 0, coveragePercent: 100, priceKnown: 0, priceUnknown: 0 });
    expect(coverage.categories).toHaveLength(9);
    expect(coverage.categories.every((category) => category.coveragePercent === 100 && category.total === 0 && category.priority === "none")).toBe(true);
    expect(coverage.pcieSlotCoverage).toBeDefined();
    expect(coverage.pcieSlotCoverage!).toEqual({
      total: 0,
      byRequiredWidth: {
        16: { requiredWidth: 16, total: 0, complete: 0, missing: 0, coveragePercent: 100 },
        8: { requiredWidth: 8, total: 0, complete: 0, missing: 0, coveragePercent: 100 },
        4: { requiredWidth: 4, total: 0, complete: 0, missing: 0, coveragePercent: 100 },
        1: { requiredWidth: 1, total: 0, complete: 0, missing: 0, coveragePercent: 100 }
      }
    });
  });

  it("tracks PCIe evidence completeness separately from generic catalog completeness", () => {
    const boards = [
      part({ id: "board-complete", category: "motherboard", specs: { pcieX16Slots: 1, pcieX8Slots: 1, pcieX4Slots: 1, pcieX1Slots: 2 } }),
      part({ id: "board-x16-only", category: "motherboard", specs: { pcieX16Slots: 1 } }),
      part({ id: "board-x16-x8", category: "motherboard", specs: { pcieX16Slots: 1, pcieX8Slots: 1 } })
    ];

    expect(catalogPcieSlotCoverageFor(boards)).toEqual({
      total: 3,
      byRequiredWidth: {
        16: { requiredWidth: 16, total: 3, complete: 3, missing: 0, coveragePercent: 100 },
        8: { requiredWidth: 8, total: 3, complete: 2, missing: 1, coveragePercent: 66.7 },
        4: { requiredWidth: 4, total: 3, complete: 1, missing: 2, coveragePercent: 33.3 },
        1: { requiredWidth: 1, total: 3, complete: 1, missing: 2, coveragePercent: 33.3 }
      }
    });

    const coverage = catalogSpecCoverageFor(boards, "2026-09-03T12:00:00.000Z");
    expect(coverage.categories.find((category) => category.category === "motherboard")).toMatchObject({ total: 3, complete: 3 });
    expect(coverage.pcieSlotCoverage!.byRequiredWidth[4]).toMatchObject({ total: 3, complete: 1, missing: 2, coveragePercent: 33.3 });
    const beforeBoards = [
      part({ id: "board-complete", category: "motherboard", specs: { pcieX16Slots: 1, pcieX8Slots: 1 } }),
      part({ id: "board-x16-only", category: "motherboard", specs: { pcieX16Slots: 1 } }),
      part({ id: "board-x16-x8", category: "motherboard", specs: { pcieX16Slots: 1, pcieX8Slots: 1 } })
    ];
    expect(catalogPcieSlotCoverageDeltaFor(catalogPcieSlotCoverageFor(beforeBoards), catalogPcieSlotCoverageFor(boards))).toEqual({
      byRequiredWidth: {
        16: { requiredWidth: 16, complete: 0, missing: 0, coveragePercent: 0 },
        8: { requiredWidth: 8, complete: 0, missing: 0, coveragePercent: 0 },
        4: { requiredWidth: 4, complete: 1, missing: -1, coveragePercent: 33.3 },
        1: { requiredWidth: 1, complete: 1, missing: -1, coveragePercent: 33.3 }
      }
    });
  });

  it("excludes high-confidence category mismatches from the PCIe evidence denominator while preserving the raw count", () => {
    const boards = [
      part({ id: "board-complete", category: "motherboard", specs: { pcieX16Slots: 1, pcieX8Slots: 1, pcieX4Slots: 1, pcieX1Slots: 2 } }),
      part({ id: "embedded", category: "motherboard", name: "Raspberry Pi 4", rawSpecText: "임베디드 보드", specs: {} })
    ];

    expect(catalogPcieSlotCoverageFor(boards)).toMatchObject({
      total: 1,
      rawTotal: 2,
      excludedCategoryMismatchCount: 1,
      byRequiredWidth: {
        16: { total: 1, complete: 1, missing: 0, coveragePercent: 100 },
        4: { total: 1, complete: 1, missing: 0, coveragePercent: 100 }
      }
    });
  });

  it("translates common persisted field keys while preserving unknown keys", () => {
    expect(catalogMissingFieldLabelFor("maxGpuLengthMm")).toBe("GPU 허용 길이");
    expect(catalogMissingFieldLabelFor("pcieX4Slots")).toBe("PCIe x4 슬롯");
    expect(catalogMissingFieldLabelFor("futureField")).toBe("futureField");
  });

  it("ranks missing fields deterministically and respects the result limit", () => {
    const parts = [part({ id: "one", dataQuality: "incomplete", missingFields: ["capacityGb", "interface"] }), part({ id: "two", dataQuality: "incomplete", missingFields: ["capacityGb"] }), part({ id: "three", dataQuality: "incomplete", missingFields: ["socket"] })];

    expect(catalogMissingFieldCountsFor(parts, 2)).toEqual([{ field: "capacityGb", count: 2 }, { field: "interface", count: 1 }]);
  });
});
