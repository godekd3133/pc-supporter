import { describe, expect, it } from "vitest";
import type { CompatibilityResult } from "./types";
import { savedBuildComparisonDecisionFor, savedBuildComparisonExpansionFor, savedBuildComparisonRankingsFor, savedBuildComparisonRiskScoreFor, type SavedBuildComparisonEntry } from "./saved-build-comparison";
import { savedBuildComparisonRowDiffFor } from "./saved-build-comparison-diff";

function result(overrides: Partial<CompatibilityResult> = {}) {
  return {
    status: "incompatible",
    blockerCount: 1,
    warningCount: 1,
    unknownCount: 0,
    findings: [],
    links: [],
    totalPriceWon: 1_000_000,
    priceComplete: true,
    analysis: { overallScore: 50 },
    ...overrides
  } as CompatibilityResult;
}

function entry(id: string, name: string, overrides: Partial<CompatibilityResult> = {}): SavedBuildComparisonEntry {
  return { id, name, result: result(overrides) };
}

function expansionMetrics(overrides: Partial<CompatibilityResult["metrics"]> = {}): CompatibilityResult["metrics"] {
  return {
    totalMemoryGb: 32,
    memoryHeadroomGb: 96,
    memorySlotsUsed: 2,
    memorySlotsTotal: 4,
    memorySlotHeadroom: 2,
    m2Used: 1,
    m2SlotsTotal: 4,
    m2Headroom: 3,
    sataUsed: 2,
    sataPortsTotal: 6,
    sataHeadroom: 4,
    hddUsed: 1,
    hddBaysTotal: 4,
    hddBayHeadroom: 3,
    powerHeadroomW: 400,
    psuWattageW: 850,
    coolerHeadroomW: 180,
    coolerCapacityW: 250,
    gpuLengthMm: 300,
    maxGpuLengthMm: 400,
    gpuClearanceMm: 100,
    psuDepthMm: 140,
    maxPsuLengthMm: 180,
    psuClearanceMm: 40,
    coolerHeightMm: 160,
    maxCoolerHeightMm: 190,
    coolerClearanceMm: 30,
    ...overrides
  };
}

describe("saved build comparison decisions", () => {
  it("uses the first selected build as the comparison baseline", () => {
    expect(savedBuildComparisonRowDiffFor(["같음", "같음", "같음"])).toEqual({ changed: false, changedIndexes: [] });
    expect(savedBuildComparisonRowDiffFor(["기준", "변경", "기준"])).toEqual({ changed: true, changedIndexes: [1] });
    expect(savedBuildComparisonRowDiffFor(["기준", "변경 1", "변경 2"])).toEqual({ changed: true, changedIndexes: [1, 2] });
  });

  it("calculates the same risk score used for the compatibility decision", () => {
    expect(savedBuildComparisonRiskScoreFor(result({ blockerCount: 2, warningCount: 3, unknownCount: 4 }))).toBe(234);
  });

  it("returns every ranking and keeps unavailable criteria out of the ranked set", () => {
    const rankings = savedBuildComparisonRankingsFor([
      entry("expensive", "비싼 견적", { totalPriceWon: 1_200_000 }),
      entry("unknown", "가격 미확인 견적", { totalPriceWon: 1, priceComplete: false }),
      entry("zero", "가격 0원 견적", { totalPriceWon: 0, priceComplete: true }),
      entry("cheap", "저렴한 견적", { totalPriceWon: 800_000 })
    ], "price");
    expect(rankings.map((ranking) => ({ id: ranking.entry.id, rank: ranking.rank, eligible: ranking.eligible, reason: ranking.reason }))).toEqual([
      { id: "cheap", rank: 1, eligible: true, reason: undefined },
      { id: "expensive", rank: 2, eligible: true, reason: undefined },
      { id: "unknown", rank: undefined, eligible: false, reason: "현재 총액 확인 필요" },
      { id: "zero", rank: undefined, eligible: false, reason: "현재 총액 확인 필요" }
    ]);
  });

  it("scores expansion from confirmed headroom and excludes incomplete builds", () => {
    const spacious = savedBuildComparisonExpansionFor(expansionMetrics());
    const tight = savedBuildComparisonExpansionFor(expansionMetrics({ memoryHeadroomGb: 0, memorySlotHeadroom: 0, m2Headroom: 0, sataHeadroom: 0, hddBayHeadroom: 0, powerHeadroomW: 0, coolerHeadroomW: 0, gpuClearanceMm: 0, psuClearanceMm: 0, coolerClearanceMm: 0 }));
    expect(spacious).toMatchObject({ level: "complete", knownDimensionCount: 10, totalDimensionCount: 10 });
    expect(spacious.score).toBeGreaterThan(tight.score ?? -1);
    const rankings = savedBuildComparisonRankingsFor([
      entry("tight", "여유 작은 견적", { metrics: tight ? expansionMetrics({ memoryHeadroomGb: 0, memorySlotHeadroom: 0, m2Headroom: 0, sataHeadroom: 0, hddBayHeadroom: 0, powerHeadroomW: 0, coolerHeadroomW: 0, gpuClearanceMm: 0, psuClearanceMm: 0, coolerClearanceMm: 0 }) : undefined }),
      entry("spacious", "확장 넓은 견적", { metrics: expansionMetrics() }),
      entry("missing", "확장성 미확인 견적", { metrics: undefined })
    ], "expansion");
    expect(rankings[0]).toMatchObject({ entry: { id: "spacious" }, rank: 1, eligible: true });
    expect(rankings.at(-1)).toMatchObject({ entry: { id: "missing" }, eligible: false });
  });

  it("chooses the lowest-risk build for compatibility-first decisions", () => {
    const decision = savedBuildComparisonDecisionFor([
      entry("unsafe", "위험한 견적", { blockerCount: 0, warningCount: 3, unknownCount: 0 }),
      entry("safe", "안전한 견적", { blockerCount: 0, warningCount: 0, unknownCount: 1 })
    ], "compatibility");
    expect(decision).toMatchObject({ kind: "compatibility", entry: { id: "safe" }, metric: 1 });
  });

  it("ignores incomplete prices and chooses the cheapest confirmed total", () => {
    const decision = savedBuildComparisonDecisionFor([
      entry("unknown-price", "가격 미확인", { totalPriceWon: 10, priceComplete: false }),
      entry("cheaper", "확인된 저가", { totalPriceWon: 800_000, priceComplete: true }),
      entry("expensive", "확인된 고가", { totalPriceWon: 1_200_000, priceComplete: true })
    ], "price");
    expect(decision).toMatchObject({ kind: "price", entry: { id: "cheaper" }, metric: 800_000 });
  });

  it("returns no analysis decision when every score is unavailable", () => {
    expect(savedBuildComparisonDecisionFor([entry("a", "A", { analysis: { overallScore: undefined } as CompatibilityResult["analysis"] })], "analysis")).toBeUndefined();
  });
});
