import type { SavedBuild, SavedBuildPurchaseProgress } from "./types";
import { purchaseListItemStatusCountsFor } from "./purchase-list-status";
import type { PurchaseItemStatus } from "./purchase-list-status";

export type SavedBuildPurchaseProgressStatus = "unrecorded" | "in-progress" | "completed";
export type SavedBuildPurchaseProgressFilter = "all" | "recorded" | "in-progress" | "completed" | "unrecorded";

export interface SavedBuildPurchaseProgressSummary {
  status: SavedBuildPurchaseProgressStatus;
  checked: number;
  total: number;
  remaining: number;
  percent: number;
  revision?: number;
  updatedAt?: string;
  historyCount: number;
  stageCounts: Record<PurchaseItemStatus, number>;
}

export interface SavedBuildPurchaseProgressComparisonRow {
  id: string;
  name: string;
  summary: SavedBuildPurchaseProgressSummary;
}

export function savedBuildPurchaseProgressSummaryFor(progress: SavedBuildPurchaseProgress | undefined): SavedBuildPurchaseProgressSummary {
  if (!progress) return { status: "unrecorded", checked: 0, total: 0, remaining: 0, percent: 0, historyCount: 0, stageCounts: { planned: 0, ordered: 0, received: 0, installed: 0 } };
  const rowKeys = [...new Set(progress.rowKeys)];
  const rowKeySet = new Set(rowKeys);
  const checkedIds = [...new Set(progress.checkedIds)].filter((id) => rowKeySet.has(id));
  const checked = checkedIds.length;
  const total = rowKeys.length;
  const remaining = Math.max(0, total - checked);
  const stageCounts = purchaseListItemStatusCountsFor(rowKeys, progress.itemStates ?? [], new Set(checkedIds));
  return {
    status: total > 0 && remaining === 0 ? "completed" : "in-progress",
    checked,
    total,
    remaining,
    percent: total === 0 ? 0 : Math.round((checked / total) * 100),
    revision: progress.revision,
    updatedAt: progress.updatedAt,
    historyCount: progress.history?.length ?? 0,
    stageCounts: { planned: stageCounts.planned, ordered: stageCounts.ordered, received: stageCounts.received, installed: stageCounts.installed }
  };
}

export function savedBuildPurchaseProgressMatchesFilter(summary: SavedBuildPurchaseProgressSummary, filter: SavedBuildPurchaseProgressFilter) {
  if (filter === "all") return true;
  if (filter === "recorded") return summary.status !== "unrecorded";
  return summary.status === filter;
}

export function savedBuildPurchaseProgressComparisonRowsFor(builds: ReadonlyArray<Pick<SavedBuild, "id" | "name" | "purchaseProgress">>): SavedBuildPurchaseProgressComparisonRow[] {
  return builds.map((build) => ({ id: build.id, name: build.name, summary: savedBuildPurchaseProgressSummaryFor(build.purchaseProgress) }));
}
