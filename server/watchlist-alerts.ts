import type { CatalogChangeRecord } from "../shared/types";
import type { SavedCatalogWatchlistRecord } from "./watchlist-share";
import { savedWatchlistAlertPreferencesFor } from "./watchlist-store";

export interface SavedWatchlistAlert {
  id: string;
  itemKey: string;
  message: string;
  kind: "drop" | "target" | "availability";
  createdAt: string;
  readAt?: string;
}

function isKnownPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function savedWatchlistAlertsFor(watchlist: SavedCatalogWatchlistRecord, records: CatalogChangeRecord[], now = Date.now()): SavedWatchlistAlert[] {
  const createdAt = Date.parse(watchlist.createdAt);
  if (!Number.isFinite(createdAt)) return [];
  const preferences = savedWatchlistAlertPreferencesFor(watchlist);
  const entriesByKey = new Map(watchlist.entries.map((entry) => [entry.kind + ":" + entry.itemId, entry]));
  const alerts: SavedWatchlistAlert[] = [];
  records
    .filter((record) => Date.parse(record.changedAt) >= createdAt && Date.parse(record.changedAt) <= now)
    .sort((left, right) => Date.parse(left.changedAt) - Date.parse(right.changedAt) || left.id.localeCompare(right.id))
    .forEach((record) => {
      const itemKey = record.kind + ":" + record.itemId;
      const entry = entriesByKey.get(itemKey);
      if (!entry) return;
      const previousPriceWon = isKnownPrice(record.previousPriceWon) ? record.previousPriceWon : undefined;
      const nextPriceWon = isKnownPrice(record.nextPriceWon) ? record.nextPriceWon : undefined;
      const previousAvailable = previousPriceWon !== undefined;
      const nextAvailable = nextPriceWon !== undefined;
      if (preferences.priceAvailability && record.changedFields.includes("가격") && previousAvailable !== nextAvailable) {
        alerts.push({ id: record.id + ":availability", itemKey, kind: "availability", message: nextAvailable ? entry.itemName + "의 가격을 다시 확인할 수 있습니다." : entry.itemName + "의 가격을 확인할 수 없습니다.", createdAt: record.changedAt });
        return;
      }
      if (!previousAvailable || !nextAvailable || previousPriceWon === undefined || nextPriceWon === undefined) return;
      const reachedTarget = preferences.targetReached && entry.targetPriceWon !== undefined && previousPriceWon > entry.targetPriceWon && nextPriceWon <= entry.targetPriceWon;
      const dropPercent = ((previousPriceWon - nextPriceWon) / previousPriceWon) * 100;
      if (reachedTarget) {
        alerts.push({ id: record.id + ":target", itemKey, kind: "target", message: entry.itemName + "이 목표가에 도달했습니다.", createdAt: record.changedAt });
      } else if (preferences.priceDrop && nextPriceWon < previousPriceWon && dropPercent >= preferences.minimumDropPercent) {
        alerts.push({ id: record.id + ":drop", itemKey, kind: "drop", message: entry.itemName + " 가격이 " + (previousPriceWon - nextPriceWon).toLocaleString("ko-KR") + "원 하락했습니다.", createdAt: record.changedAt });
      }
    });
  return alerts.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)).slice(0, 20);
}
