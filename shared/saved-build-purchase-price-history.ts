import type { SavedBuild, SavedBuildPurchasePriceHistory } from "./types";

export type SavedBuildPurchasePriceHistoryFilter = "all" | "recorded" | "multi-sample" | "server-history" | "unrecorded";
export type SavedBuildPurchasePriceHistoryStatus = "unrecorded" | "recorded" | "multi-sample";

export interface SavedBuildPurchasePriceHistorySummary {
  status: SavedBuildPurchasePriceHistoryStatus;
  recordedRowCount: number;
  sampleCount: number;
  minSampleCount: number;
  maxSampleCount: number;
  revision?: number;
  historyCount: number;
  updatedAt?: string;
}

export interface SavedBuildPurchasePriceHistoryComparisonRow {
  id: string;
  name: string;
  summary: SavedBuildPurchasePriceHistorySummary;
}

export function savedBuildPurchasePriceHistorySummaryFor(history: SavedBuildPurchasePriceHistory | undefined): SavedBuildPurchasePriceHistorySummary {
  if (!history) return { status: "unrecorded", recordedRowCount: 0, sampleCount: 0, minSampleCount: 0, maxSampleCount: 0, historyCount: 0 };
  const sampleCounts = Object.values(history.priceHistory).map((observations) => observations.length).filter((count) => count > 0);
  const sampleCount = sampleCounts.reduce((total, count) => total + count, 0);
  const maxSampleCount = sampleCounts.length > 0 ? Math.max(...sampleCounts) : 0;
  return {
    status: sampleCount === 0 ? "unrecorded" : maxSampleCount >= 2 ? "multi-sample" : "recorded",
    recordedRowCount: sampleCounts.length,
    sampleCount,
    minSampleCount: sampleCounts.length > 0 ? Math.min(...sampleCounts) : 0,
    maxSampleCount,
    revision: history.revision,
    historyCount: history.history?.length ?? 0,
    updatedAt: history.updatedAt
  };
}

export function savedBuildPurchasePriceHistoryMatchesFilter(summary: SavedBuildPurchasePriceHistorySummary, filter: SavedBuildPurchasePriceHistoryFilter) {
  if (filter === "all") return true;
  if (filter === "recorded") return summary.status !== "unrecorded";
  if (filter === "multi-sample") return summary.status === "multi-sample";
  if (filter === "server-history") return summary.historyCount > 0;
  return summary.status === "unrecorded";
}

export function savedBuildPurchasePriceHistoryComparisonRowsFor(builds: SavedBuild[]): SavedBuildPurchasePriceHistoryComparisonRow[] {
  return builds.map((build) => ({ id: build.id, name: build.name, summary: savedBuildPurchasePriceHistorySummaryFor(build.purchasePriceHistory) }));
}
