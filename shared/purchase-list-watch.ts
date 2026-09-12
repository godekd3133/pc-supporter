import type { CatalogWatchEntry } from "./catalog-watchlist";
import type { PurchaseListRow } from "./purchase-list";

export type PurchaseListWatchTarget = Pick<CatalogWatchEntry, "itemId" | "itemName" | "category" | "kind">;

export function purchaseListWatchTargetFor(row: PurchaseListRow): PurchaseListWatchTarget | undefined {
  if (!row.sourceKind || !row.sourceId || !row.sourceCategory) return undefined;
  return {
    itemId: row.sourceId,
    itemName: row.name,
    category: row.sourceCategory,
    kind: row.sourceKind
  };
}
