import { describe, expect, it } from "vitest";
import type { AlternativeComparisonBenchmarkEvidence, AlternativeComparisonCandidate } from "./alternative-comparison-export";
import { alternativeComparisonBenchmarkDecisionImpactText, alternativeComparisonBenchmarkRecheckFor, alternativeComparisonBenchmarkRecheckRowText, alternativeComparisonBenchmarkRecheckStatusText } from "./alternative-comparison-benchmark-recheck";
import type { Part, PhysicalSourceCheck } from "./types";

const NOW = "2026-09-05T00:00:00.000Z";

const sourceCheck = (overrides: Partial<PhysicalSourceCheck> = {}): PhysicalSourceCheck => ({
  requestedUrl: "https://vendor.example/cpu",
  checkedAt: "2026-09-04T00:00:00.000Z",
  status: "reachable",
  identityStatus: "matched",
  redirectCount: 0,
  ...overrides
});

const benchmarkEvidence = (overrides: Partial<AlternativeComparisonBenchmarkEvidence> = {}): AlternativeComparisonBenchmarkEvidence => ({
  partId: "cpu-a",
  category: "cpu",
  name: "공유 CPU",
  rows: [
    { key: "cinebenchR23Single", label: "Cinebench R23 싱글", value: 2100, unit: "점" },
    { key: "cinebenchR23Multi", label: "Cinebench R23 멀티", value: 12000, unit: "점" }
  ],
  presentCount: 2,
  totalCount: 2,
  status: "complete",
  provenance: {
    sourceKind: "official",
    sourceNote: "공식 측정표",
    sourceUrl: "https://vendor.example/cpu",
    updatedAt: "2026-09-04T00:00:00.000Z"
  },
  sourceCheck: sourceCheck(),
  benchmarkFreshness: "fresh",
  dataUpdatedAt: "2026-09-04T00:00:00.000Z",
  ...overrides
});

const candidate = (overrides: Partial<AlternativeComparisonCandidate> = {}): AlternativeComparisonCandidate => ({
  name: "부품",
  summary: "요약",
  price: "100,000원",
  priceWon: 100000,
  category: "cpu",
  partId: "cpu-a",
  similarity: "유사",
  performance: "성능",
  compatibility: "호환",
  dataQuality: "다나와 최신",
  benchmarkEvidence: benchmarkEvidence(),
  ...overrides
});

const currentPart = (specs: Part["specs"], overrides: Partial<Part> = {}): Part => ({
  id: "cpu-a",
  category: "cpu",
  name: "현재 CPU",
  source: "danawa",
  priceWon: 100000,
  specs,
  dataQuality: "live",
  missingFields: [],
  updatedAt: "2026-09-04T00:00:00.000Z",
  ...overrides
});

const currentCompleteSpecs = (overrides: Partial<Part["specs"]> = {}): Part["specs"] => ({
  cinebenchR23Single: 2100,
  cinebenchR23Multi: 12000,
  benchmarkProvenance: {
    sourceKind: "official",
    sourceNote: "공식 측정표",
    sourceUrl: "https://vendor.example/cpu",
    sourceCheck: sourceCheck(),
    updatedAt: "2026-09-04T00:00:00.000Z"
  },
  ...overrides
});

describe("alternative comparison benchmark recheck", () => {
  it("does not claim a benchmark change when the shared snapshot has no benchmark record", () => {
    const result = alternativeComparisonBenchmarkRecheckFor(candidate({ benchmarkEvidence: undefined }), currentPart(currentCompleteSpecs()), NOW);

    expect(result).toMatchObject({ status: "not_recorded", benchmarkDecisionImpact: "not_recorded", changedRowCount: 0, needsRecheck: false });
    expect(alternativeComparisonBenchmarkRecheckStatusText(result.status)).toBe("공유 당시 기록 없음");
    expect(alternativeComparisonBenchmarkDecisionImpactText(result.benchmarkDecisionImpact)).toBe("벤치마크 판단 정보 없음");
  });

  it("classifies equal complete evidence as stable", () => {
    const result = alternativeComparisonBenchmarkRecheckFor(candidate(), currentPart(currentCompleteSpecs()), NOW);

    expect(result).toMatchObject({ status: "same", benchmarkDecisionImpact: "stable", currentStatus: "complete", changedRowCount: 0, sourceChanged: false, benchmarkDateChanged: false, needsRecheck: false });
    expect(result.rows.every((row) => row.changed)).toBe(false);
    expect(alternativeComparisonBenchmarkRecheckStatusText(result.status)).toBe("공유 당시와 동일");
    expect(alternativeComparisonBenchmarkDecisionImpactText(result.benchmarkDecisionImpact)).toBe("벤치마크 판단 영향 없음");
  });

  it("separates score, source, and date drift from the shared snapshot", () => {
    const result = alternativeComparisonBenchmarkRecheckFor(
      candidate(),
      currentPart({
        cinebenchR23Single: 2200,
        cinebenchR23Multi: 12000,
        benchmarkProvenance: {
          sourceKind: "independent_review",
          sourceNote: "새 측정표",
          sourceUrl: "https://review.example/cpu",
          sourceCheck: sourceCheck({ requestedUrl: "https://review.example/cpu", checkedAt: NOW }),
          updatedAt: NOW
        }
      }, { updatedAt: NOW }),
      NOW
    );

    expect(result).toMatchObject({ status: "changed", benchmarkDecisionImpact: "changed", changedRowCount: 1, sourceChanged: true, benchmarkDateChanged: true, needsRecheck: true });
    expect(result.rows[0]).toMatchObject({ sharedValue: 2100, currentValue: 2200, delta: 100, changed: true });
    expect(result.rows[1]).toMatchObject({ sharedValue: 12000, currentValue: 12000, delta: 0, changed: false });
    expect(alternativeComparisonBenchmarkRecheckRowText(result.rows[0])).toContain("공유 2,100점 → 현재 2,200점 (+100점)");
  });

  it("keeps current partial and missing evidence distinct from a score-change claim", () => {
    const partial = alternativeComparisonBenchmarkRecheckFor(
      candidate(),
      currentPart({
        cinebenchR23Single: 2100,
        benchmarkProvenance: {
          sourceKind: "official",
          sourceNote: "공식 측정표",
          sourceUrl: "https://vendor.example/cpu",
          sourceCheck: sourceCheck(),
          updatedAt: "2026-09-04T00:00:00.000Z"
        }
      }),
      NOW
    );
    const missing = alternativeComparisonBenchmarkRecheckFor(candidate(), currentPart({}), NOW);

    expect(partial).toMatchObject({ status: "current_incomplete", benchmarkDecisionImpact: "unverified", currentStatus: "partial", changedRowCount: 1, needsRecheck: true });
    expect(missing).toMatchObject({ status: "current_missing", benchmarkDecisionImpact: "unverified", currentStatus: "missing", changedRowCount: 2, needsRecheck: true });
    expect(alternativeComparisonBenchmarkRecheckStatusText(partial.status)).toBe("현재 점수 일부");
    expect(alternativeComparisonBenchmarkRecheckStatusText(missing.status)).toBe("현재 점수 없음");
  });

  it("reports unavailable current candidates without fabricating current scores", () => {
    const result = alternativeComparisonBenchmarkRecheckFor(candidate(), undefined, NOW);

    expect(result).toMatchObject({ status: "current_unavailable", benchmarkDecisionImpact: "unverified", changedRowCount: 0, needsRecheck: true });
    expect(result.rows).toEqual([
      { key: "cinebenchR23Single", label: "Cinebench R23 싱글", sharedValue: 2100, changed: false },
      { key: "cinebenchR23Multi", label: "Cinebench R23 멀티", sharedValue: 12000, changed: false }
    ]);
  });

  it("requires review when otherwise equal evidence is aging or its source check is not trusted", () => {
    const result = alternativeComparisonBenchmarkRecheckFor(
      candidate({
        benchmarkEvidence: benchmarkEvidence({
          provenance: {
            sourceKind: "official",
            sourceNote: "공식 측정표",
            sourceUrl: "https://vendor.example/cpu",
            updatedAt: "2026-08-01T00:00:00.000Z"
          },
          sourceCheck: sourceCheck({ status: "identity_mismatch", identityStatus: "not_found", checkedAt: "2026-08-01T00:00:00.000Z" }),
          benchmarkFreshness: "stale",
          dataUpdatedAt: "2026-08-01T00:00:00.000Z"
        })
      }),
      currentPart({
        cinebenchR23Single: 2100,
        cinebenchR23Multi: 12000,
        benchmarkProvenance: {
          sourceKind: "official",
          sourceNote: "공식 측정표",
          sourceUrl: "https://vendor.example/cpu",
          sourceCheck: sourceCheck({ status: "identity_mismatch", identityStatus: "not_found", checkedAt: "2026-08-01T00:00:00.000Z" }),
          updatedAt: "2026-08-01T00:00:00.000Z"
        }
      }, { updatedAt: "2026-08-01T00:00:00.000Z" }),
      NOW
    );

    expect(result).toMatchObject({ status: "needs_review", benchmarkDecisionImpact: "unverified", sourceCheckNeedsReview: true, freshnessNeedsReview: true, needsRecheck: true });
  });
});
