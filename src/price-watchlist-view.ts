import type { CatalogWatchEntry } from "../shared/catalog-watchlist";

export type PriceWatchStatusFilter = "all" | "alerts" | "available" | "unavailable" | "error";
export type PriceWatchSort = "added_desc" | "price_asc" | "price_desc" | "target_gap_asc";

export interface PriceWatchViewObservation {
  priceWon?: number;
  status: "available" | "unavailable" | "error";
}

export interface PriceWatchViewOptions {
  query?: string;
  status?: PriceWatchStatusFilter;
  sort?: PriceWatchSort;
  alertKeys?: ReadonlySet<string>;
  entryKey?: (entry: Pick<CatalogWatchEntry, "kind" | "itemId">) => string;
}

function keyFor(entry: Pick<CatalogWatchEntry, "kind" | "itemId">) {
  return entry.kind + ":" + entry.itemId;
}

function compareNumbers(left: number | undefined, right: number | undefined, direction: "asc" | "desc") {
  if (left === undefined && right !== undefined) return 1;
  if (left !== undefined && right === undefined) return -1;
  if (left === undefined && right === undefined) return 0;
  return direction === "asc" ? left! - right! : right! - left!;
}

export function priceWatchEntriesFor(entries: CatalogWatchEntry[], observations: Record<string, PriceWatchViewObservation>, options: PriceWatchViewOptions = {}) {
  const query = options.query?.trim().toLocaleLowerCase("ko-KR") ?? "";
  const status = options.status ?? "all";
  const sort = options.sort ?? "added_desc";
  const entryKey = options.entryKey ?? keyFor;
  const filtered = entries.filter((entry) => {
    const entryKeyValue = entryKey(entry);
    const observation = observations[entryKeyValue];
    if (query && ![entry.itemName, entry.itemId, entry.category].some((value) => value.toLocaleLowerCase("ko-KR").includes(query))) return false;
    if (status === "alerts") return options.alertKeys?.has(entryKeyValue) === true;
    if (status === "all") return true;
    return observation?.status === status;
  });
  return filtered.slice().sort((left, right) => {
    const leftKey = entryKey(left);
    const rightKey = entryKey(right);
    const leftObservation = observations[leftKey];
    const rightObservation = observations[rightKey];
    if (sort === "price_asc" || sort === "price_desc") {
      const priceOrder = compareNumbers(leftObservation?.priceWon, rightObservation?.priceWon, sort === "price_asc" ? "asc" : "desc");
      if (priceOrder !== 0) return priceOrder;
    } else if (sort === "target_gap_asc") {
      const leftGap = leftObservation?.priceWon !== undefined && left.targetPriceWon !== undefined ? leftObservation.priceWon - left.targetPriceWon : undefined;
      const rightGap = rightObservation?.priceWon !== undefined && right.targetPriceWon !== undefined ? rightObservation.priceWon - right.targetPriceWon : undefined;
      const gapOrder = compareNumbers(leftGap, rightGap, "asc");
      if (gapOrder !== 0) return gapOrder;
    } else {
      const addedOrder = right.addedAt.localeCompare(left.addedAt);
      if (addedOrder !== 0) return addedOrder;
    }
    return 0;
  });
}
