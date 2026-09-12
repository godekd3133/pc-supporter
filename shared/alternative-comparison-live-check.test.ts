import { afterEach, describe, expect, it, vi } from "vitest";
import { alternativeComparisonBenchmarkEvidenceFor } from "./alternative-comparison-export";
import type { AlternativeComparisonCandidate } from "./alternative-comparison-export";
import { benchmarkEvidenceForPart } from "./benchmark-evidence";
import { alternativeComparisonLiveCandidateFor, alternativeComparisonLiveSummaryFor } from "./alternative-comparison-live-check";
import type { Part } from "./types";

const candidate = (overrides: Partial<AlternativeComparisonCandidate> = {}): AlternativeComparisonCandidate => ({ name: "후보", summary: "요약", price: "100,000원", priceWon: 100000, category: "cpu", partId: "cpu-a", similarity: "유사", performance: "성능", compatibility: "호환", dataQuality: "다나와 최신", ...overrides });
const part = (overrides: Partial<Part> = {}): Part => ({ id: "cpu-a", category: "cpu", name: "현재 CPU", source: "danawa", priceWon: 110000, specs: {}, dataQuality: "live", missingFields: [], updatedAt: "2026-09-02T00:00:00.000Z", ...overrides });

afterEach(() => {
  vi.useRealTimers();
});

describe("alternative comparison live check", () => {
  it("classifies loading, available, missing, mismatch, error, and legacy candidates", () => {
    expect(alternativeComparisonLiveCandidateFor(candidate(), {}, [], true, null).status).toBe("loading");
    expect(alternativeComparisonLiveCandidateFor(candidate(), { "cpu-a": part() }, [], false, null)).toMatchObject({ status: "available", priceChange: "increased", priceDeltaWon: 10000 });
    expect(alternativeComparisonLiveCandidateFor(candidate({ partId: "missing" }), {}, ["missing"], false, null).status).toBe("missing");
    expect(alternativeComparisonLiveCandidateFor(candidate({ category: "gpu" }), { "cpu-a": part() }, [], false, null).status).toBe("mismatch");
    expect(alternativeComparisonLiveCandidateFor(candidate({ partId: "error" }), {}, [], false, "조회 실패").status).toBe("error");
    expect(alternativeComparisonLiveCandidateFor(candidate({ category: undefined, partId: undefined }), {}, [], false, null).status).toBe("legacy");
  });

  it("distinguishes price directions and unknown prices", () => {
    const base = candidate();
    expect(alternativeComparisonLiveCandidateFor({ ...base, priceWon: 110000 }, { "cpu-a": part() }, [], false, null).priceChange).toBe("same");
    expect(alternativeComparisonLiveCandidateFor({ ...base, priceWon: 120000 }, { "cpu-a": part() }, [], false, null).priceChange).toBe("decreased");
    expect(alternativeComparisonLiveCandidateFor({ ...base, priceWon: undefined }, { "cpu-a": part() }, [], false, null).priceChange).toBe("unknown");
  });

  it("summarizes drift and requires recheck when any candidate is incomplete or changed", () => {
    const rows = [
      alternativeComparisonLiveCandidateFor(candidate(), { "cpu-a": part() }, [], false, null),
      alternativeComparisonLiveCandidateFor(candidate({ partId: "missing" }), {}, ["missing"], false, null),
      alternativeComparisonLiveCandidateFor(candidate({ category: undefined, partId: undefined }), {}, [], false, null)
    ];
    expect(alternativeComparisonLiveSummaryFor(rows)).toMatchObject({ total: 3, identifiable: 2, available: 1, missing: 1, legacy: 1, priceChanged: 1, priceIncreased: 1, needsRecheck: true });
  });

  it("summarizes benchmark stability and current missing evidence separately", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    const complete = part({ priceWon: 100000, updatedAt: "2026-09-05T00:00:00.000Z", specs: { cinebenchR23Single: 2100, cinebenchR23Multi: 12000 } });
    const evidence = alternativeComparisonBenchmarkEvidenceFor(benchmarkEvidenceForPart(complete, "2026-09-05T00:00:00.000Z"));
    expect(evidence).toBeDefined();
    const stable = alternativeComparisonLiveCandidateFor(candidate({ benchmarkEvidence: evidence }), { "cpu-a": complete }, [], false, null);
    const missing = alternativeComparisonLiveCandidateFor(candidate({ benchmarkEvidence: evidence }), { "cpu-a": part({ priceWon: 100000, updatedAt: "2026-09-05T00:00:00.000Z" }) }, [], false, null);

    expect(stable.benchmarkRecheck).toMatchObject({ status: "same", needsRecheck: false });
    expect(missing.benchmarkRecheck).toMatchObject({ status: "current_missing", needsRecheck: true });
    expect(alternativeComparisonLiveSummaryFor([stable, missing])).toMatchObject({ benchmarkSame: 1, benchmarkMissing: 1, benchmarkChanged: 0, needsRecheck: true });
  });
});
