import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { benchmarkAvailabilityForPart, benchmarkAvailabilityMatchesFilter, benchmarkComparisonRowsFor, benchmarkEvidenceForBuild, benchmarkEvidenceForPart } from "./benchmark-evidence";

function part(category: Part["category"], specs: Part["specs"]): Part {
  return {
    id: `${category}-benchmark`,
    category,
    name: `${category} 테스트 부품`,
    source: "seed",
    specs,
    dataQuality: "seed",
    missingFields: [],
    updatedAt: "2026-09-03T00:00:00.000Z"
  };
}

describe("benchmark evidence", () => {
  const NOW = "2026-09-05T00:00:00.000Z";

  it("normalizes a complete CPU benchmark set", () => {
    const evidence = benchmarkEvidenceForPart(part("cpu", { cinebenchR23Single: 2200, cinebenchR23Multi: 12000 }), NOW);
    expect(evidence).toMatchObject({ category: "cpu", presentCount: 2, totalCount: 2, status: "complete", benchmarkFreshness: "fresh" });
    expect(evidence?.rows).toEqual([
      { key: "cinebenchR23Single", label: "Cinebench R23 싱글", value: 2200, unit: "점" },
      { key: "cinebenchR23Multi", label: "Cinebench R23 멀티", value: 12000, unit: "점" }
    ]);
  });

  it("keeps partial and missing scores explicit", () => {
    expect(benchmarkEvidenceForPart(part("cpu", { cinebenchR23Multi: 12000 }), NOW)).toMatchObject({ presentCount: 1, totalCount: 2, status: "partial" });
    expect(benchmarkEvidenceForPart(part("gpu", { vramGb: 16 }), NOW)).toMatchObject({ presentCount: 0, totalCount: 2, status: "missing" });
  });

  it("maps partial and missing score sets to the public incomplete filter", () => {
    const complete = part("cpu", { cinebenchR23Single: 2200, cinebenchR23Multi: 12000 });
    const partial = part("cpu", { cinebenchR23Multi: 12000 });
    const missing = part("gpu", { vramGb: 16 });

    expect(benchmarkAvailabilityForPart(complete)).toBe("complete");
    expect(benchmarkAvailabilityForPart(partial)).toBe("incomplete");
    expect(benchmarkAvailabilityForPart(missing)).toBe("incomplete");
    expect(benchmarkAvailabilityMatchesFilter(complete, "complete")).toBe(true);
    expect(benchmarkAvailabilityMatchesFilter(partial, "complete")).toBe(false);
    expect(benchmarkAvailabilityMatchesFilter(missing, "incomplete")).toBe(true);
  });

  it("preserves benchmark provenance without treating it as a score", () => {
    const evidence = benchmarkEvidenceForPart(part("gpu", { gpu3dmarkTimeSpyScore: 21000, benchmarkProvenance: { sourceKind: "independent_review", sourceNote: "고정 드라이버 측정", sourceUrl: "https://example.com/review", updatedAt: "2026-09-02T00:00:00.000Z" } }), NOW);
    expect(evidence?.provenance).toMatchObject({ sourceKind: "independent_review", sourceNote: "고정 드라이버 측정" });
    expect(evidence?.status).toBe("partial");
    expect(evidence?.benchmarkFreshness).toBe("fresh");
  });

  it("marks benchmark data separately from the part freshness when the source is old", () => {
    const evidence = benchmarkEvidenceForPart(part("cpu", { cinebenchR23Single: 2200, cinebenchR23Multi: 12000, benchmarkProvenance: { sourceKind: "official", sourceNote: "공식 측정표", updatedAt: "2026-07-01T00:00:00.000Z" } }), NOW);

    expect(evidence).toMatchObject({ status: "complete", benchmarkFreshness: "stale", dataUpdatedAt: "2026-09-03T00:00:00.000Z" });
  });

  it("returns only CPU and GPU evidence for a build", () => {
    const result = benchmarkEvidenceForBuild(part("cpu", { cinebenchR23Single: 2000, cinebenchR23Multi: 10000 }), part("gpu", { gpu3dmarkTimeSpyScore: 20000, gpu3dmarkPortRoyalScore: 14000 }), NOW);
    expect(result.map((item) => item.category)).toEqual(["cpu", "gpu"]);
  });

  it("compares original score rows without filling missing values or crossing categories", () => {
    const current = benchmarkEvidenceForPart(part("cpu", { cinebenchR23Single: 2000, cinebenchR23Multi: 10000 }), NOW)!;
    const candidate = benchmarkEvidenceForPart(part("cpu", { cinebenchR23Single: 2100 }), NOW)!;
    const rows = benchmarkComparisonRowsFor(current, candidate);

    expect(rows).toEqual([
      { key: "cinebenchR23Single", label: "Cinebench R23 싱글", currentValue: 2000, candidateValue: 2100, delta: 100, deltaPercent: 5 },
      { key: "cinebenchR23Multi", label: "Cinebench R23 멀티", currentValue: 10000 }
    ]);
    const gpu = benchmarkEvidenceForPart(part("gpu", { gpu3dmarkTimeSpyScore: 20000, gpu3dmarkPortRoyalScore: 14000 }), NOW)!;
    expect(benchmarkComparisonRowsFor(current, gpu).every((row) => row.currentValue === undefined && row.delta === undefined)).toBe(true);
  });
});
