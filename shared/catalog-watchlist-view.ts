import { catalogWatchEntryKey } from "./catalog-watchlist";
import type { CatalogWatchSnapshot } from "./catalog-watchlist-export";

export type CatalogWatchlistStatusFilter = "all" | "signals" | "target_reached" | "available" | "price_unavailable" | "out_of_scope";

export type CatalogWatchlistSort = "added_desc" | "signal_desc" | "price_asc" | "target_gap_asc";

export function catalogWatchSnapshotTargetGap(snapshot: CatalogWatchSnapshot) {
  return snapshot.targetPriceWon !== undefined && snapshot.latestPriceWon !== undefined ? snapshot.latestPriceWon - snapshot.targetPriceWon : undefined;
}

export function catalogWatchSnapshotMatches(snapshot: CatalogWatchSnapshot, query = "", status: CatalogWatchlistStatusFilter = "all") {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = normalizedQuery.length === 0 || [snapshot.entry.itemName, snapshot.entry.itemId, snapshot.entry.category].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  if (!matchesQuery) return false;
  switch (status) {
    case "signals":
      return snapshot.signals.length > 0;
    case "target_reached":
      return snapshot.signals.includes("목표가 도달");
    case "available":
    case "price_unavailable":
    case "out_of_scope":
      return snapshot.currentDataStatus === status;
    case "all":
      return true;
  }
}

function timestampFor(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sortCatalogWatchSnapshots(snapshots: CatalogWatchSnapshot[], sort: CatalogWatchlistSort = "added_desc") {
  return snapshots.slice().sort((left, right) => {
    if (sort === "signal_desc") return right.signals.length - left.signals.length || timestampFor(right.entry.addedAt) - timestampFor(left.entry.addedAt) || catalogWatchEntryKey(left.entry).localeCompare(catalogWatchEntryKey(right.entry));
    if (sort === "price_asc") {
      const leftPrice = left.latestPriceWon ?? Number.POSITIVE_INFINITY;
      const rightPrice = right.latestPriceWon ?? Number.POSITIVE_INFINITY;
      return leftPrice - rightPrice || timestampFor(right.entry.addedAt) - timestampFor(left.entry.addedAt) || catalogWatchEntryKey(left.entry).localeCompare(catalogWatchEntryKey(right.entry));
    }
    if (sort === "target_gap_asc") {
      const leftGap = catalogWatchSnapshotTargetGap(left) ?? Number.POSITIVE_INFINITY;
      const rightGap = catalogWatchSnapshotTargetGap(right) ?? Number.POSITIVE_INFINITY;
      return leftGap - rightGap || timestampFor(right.entry.addedAt) - timestampFor(left.entry.addedAt) || catalogWatchEntryKey(left.entry).localeCompare(catalogWatchEntryKey(right.entry));
    }
    return timestampFor(right.entry.addedAt) - timestampFor(left.entry.addedAt) || catalogWatchEntryKey(left.entry).localeCompare(catalogWatchEntryKey(right.entry));
  });
}
