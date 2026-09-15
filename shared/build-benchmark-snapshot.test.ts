import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { seedCatalog } from "../server/seed-catalog";
import { buildBenchmarkImpactFor, buildBenchmarkSnapshotFor, buildBenchmarkSnapshotFromUnknown } from "./build-benchmark-snapshot";

const NOW = "2026-09-05T00:00:00.000Z";

function benchmarkPart(category: "cpu" | "gpu", scores: { first: number; second: number }, overrides: Partial<Part> = {}): Part {
  const base = seedCatalog.find((part) => part.category === category)!;
  const scoreSpecs = category === "cpu"
    ? { cinebenchR23Single: scores.first, cinebenchR23Multi: scores.second }
    : { gpu3dmarkTimeSpyScore: scores.first, gpu3dmarkPortRoyalScore: scores.second };
  return {
    ...base,
    id: `${category}-benchmark-fixture`,
    name: `${category.toUpperCase()} benchmark fixture`,
    updatedAt: NOW,
    specs: {
      ...base.specs,
      ...scoreSpecs,
      benchmarkProvenance: {
        sourceKind: "independent_review",
        sourceNote: "결정론적 테스트용 벤치마크 정보",
        sourceUrl: "https://example.com/benchmark-fixture",
        sourceCheck: {
          requestedUrl: "https://example.com/benchmark-fixture",
          checkedAt: NOW,
          status: "reachable",
          identityStatus: "matched",
          redirectCount: 0
        },
        updatedAt: NOW
      }
    },
    ...overrides
  };
}

describe("full build benchmark snapshots", () => {
  it("classifies the selected CPU and GPU as one complete build-level evidence snapshot", () => {
    const snapshot = buildBenchmarkSnapshotFor(benchmarkPart("cpu", { first: 1800, second: 18000 }), benchmarkPart("gpu", { first: 12000, second: 8000 }), NOW);

    expect(snapshot.status).toBe("complete");
    expect(snapshot.expectedScoreCount).toBe(4);
    expect(snapshot.presentScoreCount).toBe(4);
    expect(snapshot.parts.map((part) => part.category)).toEqual(["cpu", "gpu"]);
    expect(buildBenchmarkSnapshotFromUnknown(snapshot)).toEqual(snapshot);
  });

  it("does not treat an absent CPU/GPU as missing evidence", () => {
    const snapshot = buildBenchmarkSnapshotFor(undefined, undefined, NOW);

    expect(snapshot).toMatchObject({ status: "not_applicable", expectedScoreCount: 0, presentScoreCount: 0, parts: [] });
    expect(buildBenchmarkSnapshotFromUnknown(snapshot)).toEqual(snapshot);
  });

  it("preserves partial coverage and rejects inconsistent persisted counts", () => {
    const snapshot = buildBenchmarkSnapshotFor(benchmarkPart("cpu", { first: 1800, second: Number.NaN }), undefined, NOW);

    expect(snapshot).toMatchObject({ status: "partial", expectedScoreCount: 2, presentScoreCount: 1 });
    expect(buildBenchmarkSnapshotFromUnknown({ ...snapshot, presentScoreCount: 2 })).toBeUndefined();
    expect(buildBenchmarkSnapshotFromUnknown({ ...snapshot, parts: snapshot.parts.map((part) => ({ ...part, status: "complete" })) })).toBeUndefined();
    expect(buildBenchmarkSnapshotFromUnknown({ ...snapshot, fingerprint: "tampered" })).toBeUndefined();
  });

  it("reports a stable full-build comparison only when values and evidence metadata stay stable", () => {
    const before = buildBenchmarkSnapshotFor(benchmarkPart("cpu", { first: 1800, second: 18000 }), benchmarkPart("gpu", { first: 12000, second: 8000 }), NOW);
    const after = buildBenchmarkSnapshotFor(benchmarkPart("cpu", { first: 1800, second: 18000 }), benchmarkPart("gpu", { first: 12000, second: 8000 }), NOW);

    expect(buildBenchmarkImpactFor(before, after, NOW)).toMatchObject({ status: "same", decisionImpact: "stable", changedScoreCount: 0, changedPartCount: 0, coverageChanged: false });
  });

  it("separates a changed score from an unverified partial baseline", () => {
    const before = buildBenchmarkSnapshotFor(benchmarkPart("cpu", { first: 1800, second: 18000 }), benchmarkPart("gpu", { first: 12000, second: 8000 }), NOW);
    const changed = buildBenchmarkSnapshotFor(benchmarkPart("cpu", { first: 1800, second: 18500 }), benchmarkPart("gpu", { first: 12000, second: 8000 }), NOW);
    const partial = buildBenchmarkSnapshotFor(benchmarkPart("cpu", { first: 1800, second: Number.NaN }), benchmarkPart("gpu", { first: 12000, second: 8000 }), NOW);

    expect(buildBenchmarkImpactFor(before, changed, NOW)).toMatchObject({ status: "changed", decisionImpact: "changed", changedScoreCount: 1, changedPartCount: 1 });
    expect(buildBenchmarkImpactFor(partial, partial, NOW)).toMatchObject({ status: "unverified", decisionImpact: "unverified", changedScoreCount: 0, changedPartCount: 0 });
    expect(buildBenchmarkImpactFor(undefined, changed, NOW)).toMatchObject({ status: "unverified", decisionImpact: "unverified" });
  });
});
