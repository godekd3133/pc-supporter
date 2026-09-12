import { isKnownPrice, type Part } from "./types";
import type { AlternativeComparisonCandidate } from "./alternative-comparison-export";
import { alternativeComparisonBenchmarkRecheckFor } from "./alternative-comparison-benchmark-recheck";
import type { AlternativeComparisonBenchmarkRecheck } from "./alternative-comparison-benchmark-recheck";

export type AlternativeComparisonLiveCandidateStatus = "loading" | "available" | "missing" | "mismatch" | "error" | "legacy";
export type AlternativeComparisonPriceChange = "increased" | "decreased" | "same" | "unknown";

export interface AlternativeComparisonLiveCandidate {
  candidate: AlternativeComparisonCandidate;
  status: AlternativeComparisonLiveCandidateStatus;
  currentPart?: Part;
  priceChange: AlternativeComparisonPriceChange;
  priceDeltaWon?: number;
  benchmarkRecheck?: AlternativeComparisonBenchmarkRecheck;
}

export interface AlternativeComparisonLiveSummary {
  total: number;
  identifiable: number;
  available: number;
  missing: number;
  mismatch: number;
  error: number;
  legacy: number;
  priceChanged: number;
  priceIncreased: number;
  priceDecreased: number;
  priceUnknown: number;
  benchmarkSame: number;
  benchmarkChanged: number;
  benchmarkUnavailable: number;
  benchmarkMissing: number;
  benchmarkIncomplete: number;
  benchmarkNeedsReview: number;
  benchmarkNotRecorded: number;
  needsRecheck: boolean;
}

export function alternativeComparisonLiveCandidateFor(candidate: AlternativeComparisonCandidate, liveParts: Readonly<Record<string, Part>>, missingIds: ReadonlyArray<string>, loading: boolean, error: string | null): AlternativeComparisonLiveCandidate {
  if (!candidate.partId) return { candidate, status: "legacy", priceChange: "unknown", benchmarkRecheck: alternativeComparisonBenchmarkRecheckFor(candidate, undefined) };
  if (loading && !liveParts[candidate.partId] && !missingIds.includes(candidate.partId)) return { candidate, status: "loading", priceChange: "unknown" };
  if (missingIds.includes(candidate.partId)) return { candidate, status: "missing", priceChange: "unknown", benchmarkRecheck: alternativeComparisonBenchmarkRecheckFor(candidate, undefined) };
  const currentPart = liveParts[candidate.partId];
  if (!currentPart) return { candidate, status: error ? "error" : "missing", priceChange: "unknown", benchmarkRecheck: alternativeComparisonBenchmarkRecheckFor(candidate, undefined) };
  const benchmarkRecheck = alternativeComparisonBenchmarkRecheckFor(candidate, currentPart);
  if (candidate.category && currentPart.category !== candidate.category) return { candidate, status: "mismatch", currentPart, priceChange: "unknown", benchmarkRecheck };
  const sharedPrice = candidate.priceWon;
  const currentPrice = currentPart.priceWon;
  if (!isKnownPrice(sharedPrice) || !isKnownPrice(currentPrice)) return { candidate, status: "available", currentPart, priceChange: "unknown", benchmarkRecheck };
  const priceDeltaWon = currentPrice - sharedPrice;
  return { candidate, status: "available", currentPart, priceDeltaWon, priceChange: priceDeltaWon > 0 ? "increased" : priceDeltaWon < 0 ? "decreased" : "same", benchmarkRecheck };
}

export function alternativeComparisonLiveSummaryFor(rows: ReadonlyArray<AlternativeComparisonLiveCandidate>): AlternativeComparisonLiveSummary {
  const summary = {
    total: rows.length,
    identifiable: rows.filter((row) => row.status !== "legacy").length,
    available: rows.filter((row) => row.status === "available").length,
    missing: rows.filter((row) => row.status === "missing").length,
    mismatch: rows.filter((row) => row.status === "mismatch").length,
    error: rows.filter((row) => row.status === "error").length,
    legacy: rows.filter((row) => row.status === "legacy").length,
    priceChanged: rows.filter((row) => row.priceChange === "increased" || row.priceChange === "decreased").length,
    priceIncreased: rows.filter((row) => row.priceChange === "increased").length,
    priceDecreased: rows.filter((row) => row.priceChange === "decreased").length,
    priceUnknown: rows.filter((row) => row.priceChange === "unknown").length,
    benchmarkSame: rows.filter((row) => row.benchmarkRecheck?.status === "same").length,
    benchmarkChanged: rows.filter((row) => row.benchmarkRecheck?.status === "changed").length,
    benchmarkUnavailable: rows.filter((row) => row.benchmarkRecheck?.status === "current_unavailable").length,
    benchmarkMissing: rows.filter((row) => row.benchmarkRecheck?.status === "current_missing").length,
    benchmarkIncomplete: rows.filter((row) => row.benchmarkRecheck?.status === "current_incomplete").length,
    benchmarkNeedsReview: rows.filter((row) => row.benchmarkRecheck?.status === "needs_review").length,
    benchmarkNotRecorded: rows.filter((row) => row.benchmarkRecheck?.status === "not_recorded").length,
    needsRecheck: false
  };
  summary.needsRecheck = summary.missing > 0 || summary.mismatch > 0 || summary.error > 0 || summary.legacy > 0 || summary.priceChanged > 0 || summary.priceUnknown > 0 || rows.some((row) => row.benchmarkRecheck?.needsRecheck);
  return summary;
}
