import { isKnownPrice, type DataFreshness } from "./types";
import { purchaseListRowKey, type PurchaseListRow } from "./purchase-list";
import { purchaseListLivePriceDisplayFor, type PurchaseListLivePrice } from "./purchase-list-live-price";

export type PurchaseListPriceFilter = "all" | "remaining" | "changed" | "decreased" | "increased" | "needs_review" | "data_review";

export interface PurchaseListPriceFilterCounts {
  all: number;
  remaining: number;
  changed: number;
  decreased: number;
  increased: number;
  needs_review: number;
  data_review: number;
}

export interface PurchaseListDataFreshnessCounts {
  fresh: number;
  aging: number;
  stale: number;
  unknown: number;
  needsReview: number;
}

function livePriceNeedsReview(live: PurchaseListLivePrice | undefined) {
  return !live || live.status !== "available" || !isKnownPrice(live.currentUnitPriceWon);
}

function dataFreshnessNeedsReview(freshness: DataFreshness | undefined) {
  return freshness !== "fresh";
}

export function purchaseListDataFreshnessCountsFor(rows: ReadonlyArray<PurchaseListRow>): PurchaseListDataFreshnessCounts {
  const counts: PurchaseListDataFreshnessCounts = { fresh: 0, aging: 0, stale: 0, unknown: 0, needsReview: 0 };
  rows.forEach((row) => {
    const freshness = row.dataFreshness ?? "unknown";
    counts[freshness] += 1;
    if (dataFreshnessNeedsReview(row.dataFreshness)) counts.needsReview += 1;
  });
  return counts;
}

export function purchaseListRowMatchesQuery(row: PurchaseListRow, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  if (!normalizedQuery) return true;
  return [row.name, row.connectionTarget, row.categoryLabel, row.section, row.id, row.sourceId]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLocaleLowerCase("ko-KR").includes(normalizedQuery));
}

export function purchaseListPriceFilterMatches(filter: PurchaseListPriceFilter, row: PurchaseListRow, live: PurchaseListLivePrice | undefined, checked: boolean) {
  if (filter === "all") return true;
  if (filter === "remaining") return !checked;
  if (filter === "needs_review") return livePriceNeedsReview(live);
  if (filter === "data_review") return dataFreshnessNeedsReview(row.dataFreshness);
  const display = purchaseListLivePriceDisplayFor(row, live);
  if (filter === "changed") return display?.tone === "decreased" || display?.tone === "increased";
  if (filter === "decreased") return display?.tone === "decreased";
  return display?.tone === "increased";
}

export function purchaseListPriceFilterCounts(rows: ReadonlyArray<PurchaseListRow>, livePrices: Readonly<Record<string, PurchaseListLivePrice>>, checkedIds: ReadonlySet<string>, query = ""): PurchaseListPriceFilterCounts {
  const counts: PurchaseListPriceFilterCounts = { all: 0, remaining: 0, changed: 0, decreased: 0, increased: 0, needs_review: 0, data_review: 0 };
  rows.forEach((row, index) => {
    if (!purchaseListRowMatchesQuery(row, query)) return;
    counts.all += 1;
    const rowKey = purchaseListRowKey(row, index);
    const live = livePrices[rowKey];
    const checked = checkedIds.has(rowKey);
    if (!checked) counts.remaining += 1;
    if (livePriceNeedsReview(live)) counts.needs_review += 1;
    if (dataFreshnessNeedsReview(row.dataFreshness)) counts.data_review += 1;
    const display = purchaseListLivePriceDisplayFor(row, live);
    if (display?.tone === "decreased") {
      counts.changed += 1;
      counts.decreased += 1;
    } else if (display?.tone === "increased") {
      counts.changed += 1;
      counts.increased += 1;
    }
  });
  return counts;
}
