import { classifyDataFreshness } from "./data-freshness";
import { ACCESSORY_CATALOG_CACHE_STORAGE_KEY, accessoryCatalogCacheSnapshotFromJson } from "./accessory-catalog-cache";
import { CATALOG_PICKER_CACHE_STORAGE_KEY, catalogPickerCacheSnapshotFromJson } from "./catalog-picker-cache";
import type { DataFreshness } from "./types";

export const CATALOG_CACHE_CHANGED_EVENT = "pc-supporter-catalog-cache-changed";
export type CatalogCacheKind = "parts" | "accessories";

export interface CatalogCacheStatusItem {
  kind: CatalogCacheKind;
  label: string;
  count: number;
  cachedAt?: string;
  freshness: DataFreshness;
}

export interface CatalogCacheStatus {
  parts: CatalogCacheStatusItem;
  accessories: CatalogCacheStatusItem;
  totalCount: number;
  hasAny: boolean;
}

function cacheItem(kind: CatalogCacheKind, cachedAt: string | undefined, count: number): CatalogCacheStatusItem {
  return {
    kind,
    label: kind === "parts" ? "핵심 부품" : "주변 부품",
    count,
    ...(cachedAt ? { cachedAt } : {}),
    freshness: cachedAt ? classifyDataFreshness(cachedAt) : "unknown"
  };
}

export function catalogCacheStatusFromStorage(getItem: (key: string) => string | null | undefined, now: string | number = Date.now()): CatalogCacheStatus {
  const partsSnapshot = catalogPickerCacheSnapshotFromJson(getItem(CATALOG_PICKER_CACHE_STORAGE_KEY));
  const accessoriesSnapshot = accessoryCatalogCacheSnapshotFromJson(getItem(ACCESSORY_CATALOG_CACHE_STORAGE_KEY));
  const parts = cacheItem("parts", partsSnapshot.cachedAt, partsSnapshot.items.length);
  const accessories = cacheItem("accessories", accessoriesSnapshot.cachedAt, accessoriesSnapshot.items.length);
  return {
    parts: { ...parts, freshness: parts.cachedAt ? classifyDataFreshness(parts.cachedAt, now) : "unknown" },
    accessories: { ...accessories, freshness: accessories.cachedAt ? classifyDataFreshness(accessories.cachedAt, now) : "unknown" },
    totalCount: parts.count + accessories.count,
    hasAny: parts.count > 0 || accessories.count > 0
  };
}
