import type { CatalogWatchEntry } from "../shared/catalog-watchlist";
import type { AccessoryItem, Part } from "../shared/types";
import { isKnownPrice } from "../shared/types";
import { ApiError } from "./api";
import { safeExternalUrl } from "./safe-source-url";
import type { PriceWatchDecisionState } from "../shared/price-watch-decision";
export { priceWatchDecisionCountsFor } from "../shared/price-watch-decision";
export type { PriceWatchDecisionCounts } from "../shared/price-watch-decision";
export { catalogWatchlistImportDiffFor } from "../shared/catalog-watchlist-view";
export type { CatalogWatchlistImportDiff } from "../shared/catalog-watchlist-view";

export type PriceWatchStatusFilter = "all" | "alerts" | "target" | "buy" | "wait" | "observe" | "tracking" | "available" | "unavailable" | "error";
export type PriceWatchSort = "added_desc" | "price_asc" | "price_desc" | "target_gap_asc";
export interface PriceWatchlistCapabilities {
  catalogSearch: true;
  catalogSnapshotPrices: true;
  browserLocalWatchlist: true;
  priceHistory: boolean;
  automaticRefresh: boolean;
  alerts: boolean;
  serverSharing: boolean;
}

export function priceWatchlistCapabilitiesFor(): PriceWatchlistCapabilities {
  return {
    catalogSearch: true,
    catalogSnapshotPrices: true,
    browserLocalWatchlist: true,
    priceHistory: true,
    automaticRefresh: true,
    alerts: true,
    serverSharing: true
  };
}

export function priceWatchlistStatusForMode(status: PriceWatchStatusFilter, capabilities: PriceWatchlistCapabilities): PriceWatchStatusFilter {
  if (status === "alerts" && !capabilities.alerts) return "all";
  if (["buy", "wait", "observe"].includes(status) && !capabilities.priceHistory) return "all";
  return status;
}

export interface PriceWatchViewObservation {
  priceWon?: number;
  status: "available" | "unavailable" | "error";
}

type CatalogPriceItem = Part | AccessoryItem;

export type PriceWatchLivePrice = PriceWatchViewObservation & {
  source?: CatalogPriceItem["source"];
  dataQuality?: CatalogPriceItem["dataQuality"];
  dataFreshness?: CatalogPriceItem["dataFreshness"];
  updatedAt?: string;
  priceCheckedAt?: string;
  sourceUrl?: string;
};

export async function readPriceWatchCatalogPrices(
  entries: readonly CatalogWatchEntry[],
  readCatalogItem: (entry: CatalogWatchEntry, signal: AbortSignal) => Promise<CatalogPriceItem>,
  signal: AbortSignal
): Promise<Record<string, PriceWatchLivePrice>> {
  const prices: Record<string, PriceWatchLivePrice> = {};
  for (let offset = 0; offset < entries.length; offset += 6) {
    if (signal.aborted) return {};
    const batch = await Promise.all(entries.slice(offset, offset + 6).map(async (entry) => {
      try {
        const item = await readCatalogItem(entry, signal);
        if (signal.aborted) return undefined;
        const sourceUrl = safeExternalUrl(item.danawaUrl);
        return [entry.kind + ":" + entry.itemId, {
          priceWon: item.priceWon,
          status: isKnownPrice(item.priceWon) ? "available" : "unavailable",
          source: item.source,
          dataQuality: item.dataQuality,
          dataFreshness: item.dataFreshness,
          updatedAt: item.updatedAt,
          priceCheckedAt: item.priceCheckedAt,
          ...(sourceUrl ? { sourceUrl } : {})
        }] as const;
      } catch (error: unknown) {
        if (signal.aborted) return undefined;
        const status = error instanceof ApiError && error.status === 404 ? "unavailable" : "error";
        return [entry.kind + ":" + entry.itemId, { status }] as const;
      }
    }));
    if (signal.aborted) return {};
    for (const result of batch) {
      if (result) prices[result[0]] = result[1];
    }
  }
  return prices;
}

export interface PriceWatchViewOptions {
  query?: string;
  status?: PriceWatchStatusFilter;
  sort?: PriceWatchSort;
  alertKeys?: ReadonlySet<string>;
  decisionStates?: Readonly<Record<string, PriceWatchDecisionState>>;
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
    if (["target", "buy", "wait", "observe", "tracking"].includes(status)) return options.decisionStates?.[entryKeyValue] === status;
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
