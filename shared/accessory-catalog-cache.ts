import { classifyDataFreshness } from "./data-freshness";
import type { AccessoryCategory, AccessoryItem, AccessoryPriceFilter, DataFreshness, DataQuality, PartSpecs } from "./types";
import { ACCESSORY_CATEGORIES, isKnownPrice } from "./types";

export const ACCESSORY_CATALOG_CACHE_STORAGE_KEY = "pc-supporter-accessory-catalog-cache-v1";
export const ACCESSORY_CATALOG_CACHE_MAX_ITEMS = 600;
export const ACCESSORY_CATALOG_CACHE_SCHEMA_VERSION = 1 as const;
const MAX_CACHE_BYTES = 1_800_000;
const MAX_SPEC_KEYS = 96;
const MAX_TEXT_LENGTH = 20_000;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length <= maxLength ? value : undefined;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : undefined;
}

function cachedAccessoryFromUnknown(value: unknown): AccessoryItem | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id, 180);
  const category = enumValue(value.category, ACCESSORY_CATEGORIES);
  const name = stringValue(value.name, 280);
  const source = enumValue(value.source, ["danawa", "manual"] as const);
  const dataQuality = enumValue(value.dataQuality, ["seed", "live", "manual", "incomplete"] as const);
  const specs = isRecord(value.specs) ? Object.fromEntries(Object.entries(value.specs).slice(0, MAX_SPEC_KEYS)) as PartSpecs : undefined;
  const missingFields = Array.isArray(value.missingFields)
    ? value.missingFields.filter((field): field is string => typeof field === "string" && field.length <= 120).slice(0, 64)
    : undefined;
  const updatedAt = stringValue(value.updatedAt, 100);
  if (!id || !category || !name || !source || !dataQuality || !specs || !missingFields || !updatedAt) return undefined;
  const priceWon = typeof value.priceWon === "number" && Number.isFinite(value.priceWon) && value.priceWon >= 0 && value.priceWon <= 100_000_000
    ? value.priceWon
    : undefined;
  return {
    id,
    category,
    name,
    source,
    listingType: "accessory",
    dataQuality,
    missingFields,
    updatedAt,
    specs,
    ...(stringValue(value.brand, 180) ? { brand: value.brand as string } : {}),
    ...(stringValue(value.model, 180) ? { model: value.model as string } : {}),
    ...(stringValue(value.imageUrl, 1_200) ? { imageUrl: value.imageUrl as string } : {}),
    ...(stringValue(value.danawaUrl, 800) ? { danawaUrl: value.danawaUrl as string } : {}),
    ...(stringValue(value.sourceProductCode, 120) ? { sourceProductCode: value.sourceProductCode as string } : {}),
    ...(stringValue(value.sourceCategoryId, 120) ? { sourceCategoryId: value.sourceCategoryId as string } : {}),
    ...(stringValue(value.rawSpecText, MAX_TEXT_LENGTH) ? { rawSpecText: value.rawSpecText as string } : {}),
    ...(priceWon !== undefined ? { priceWon } : {})
  };
}

function normalizedItems(items: ReadonlyArray<AccessoryItem>) {
  return items.map(cachedAccessoryFromUnknown).filter((item): item is AccessoryItem => Boolean(item));
}

export function accessoryCatalogCacheFromJson(raw: string | null | undefined): AccessoryItem[] {
  return accessoryCatalogCacheSnapshotFromJson(raw).items;
}

export interface AccessoryCatalogCacheSnapshot {
  schemaVersion: typeof ACCESSORY_CATALOG_CACHE_SCHEMA_VERSION;
  items: AccessoryItem[];
  cachedAt?: string;
}

function cachedAtFromUnknown(value: unknown) {
  if (typeof value !== "string" || value.length > 100 || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

export function accessoryCatalogCacheSnapshotFromJson(raw: string | null | undefined): AccessoryCatalogCacheSnapshot {
  if (!raw || raw.length > MAX_CACHE_BYTES) return { schemaVersion: ACCESSORY_CATALOG_CACHE_SCHEMA_VERSION, items: [] };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length > ACCESSORY_CATALOG_CACHE_MAX_ITEMS
      ? { schemaVersion: ACCESSORY_CATALOG_CACHE_SCHEMA_VERSION, items: [] }
      : { schemaVersion: ACCESSORY_CATALOG_CACHE_SCHEMA_VERSION, items: normalizedItems(parsed as AccessoryItem[]).slice(0, ACCESSORY_CATALOG_CACHE_MAX_ITEMS) };
    if (!isRecord(parsed) || parsed.schemaVersion !== ACCESSORY_CATALOG_CACHE_SCHEMA_VERSION || !Array.isArray(parsed.items) || parsed.items.length > ACCESSORY_CATALOG_CACHE_MAX_ITEMS) return { schemaVersion: ACCESSORY_CATALOG_CACHE_SCHEMA_VERSION, items: [] };
    const cachedAt = cachedAtFromUnknown(parsed.cachedAt);
    return { schemaVersion: ACCESSORY_CATALOG_CACHE_SCHEMA_VERSION, items: normalizedItems(parsed.items as AccessoryItem[]).slice(0, ACCESSORY_CATALOG_CACHE_MAX_ITEMS), ...(cachedAt ? { cachedAt } : {}) };
  } catch {
    return { schemaVersion: ACCESSORY_CATALOG_CACHE_SCHEMA_VERSION, items: [] };
  }
}

export function accessoryCatalogCacheToJson(items: ReadonlyArray<AccessoryItem>, cachedAt?: string) {
  const normalized = normalizedItems(items).slice(0, ACCESSORY_CATALOG_CACHE_MAX_ITEMS);
  const envelopeFor = (nextItems: ReadonlyArray<AccessoryItem>) => JSON.stringify({ schemaVersion: ACCESSORY_CATALOG_CACHE_SCHEMA_VERSION, ...(cachedAt ? { cachedAt } : {}), items: nextItems });
  let candidate = envelopeFor(normalized);
  if (candidate.length <= MAX_CACHE_BYTES) return candidate;
  const bounded: AccessoryItem[] = [];
  for (const item of normalized) {
    bounded.push(item);
    candidate = envelopeFor(bounded);
    if (candidate.length > MAX_CACHE_BYTES) {
      bounded.pop();
      break;
    }
  }
  return envelopeFor(bounded);
}

export function mergeAccessoryCatalogCache(current: ReadonlyArray<AccessoryItem>, incoming: ReadonlyArray<AccessoryItem>) {
  const merged = new Map<string, AccessoryItem>();
  for (const item of normalizedItems(incoming)) merged.set(item.id, item);
  for (const item of normalizedItems(current)) if (!merged.has(item.id)) merged.set(item.id, item);
  return [...merged.values()].slice(0, ACCESSORY_CATALOG_CACHE_MAX_ITEMS);
}

export interface AccessoryCatalogCachedQuery {
  category: AccessoryCategory | "all";
  query?: string;
  brand?: string;
  quality?: DataQuality | "all";
  freshness?: DataFreshness | "all";
  priceFilter?: AccessoryPriceFilter;
  sort?: "price_asc" | "price_desc" | "name" | "updated";
  offset?: number;
  limit?: number;
  now?: string | number;
}

export interface AccessoryCatalogCachedResult {
  items: AccessoryItem[];
  total: number;
}

function priceMatches(item: AccessoryItem, filter: AccessoryPriceFilter | undefined) {
  if (!filter || filter === "all") return true;
  if (!isKnownPrice(item.priceWon)) return false;
  if (filter === "priced") return true;
  if (filter === "under_10000") return item.priceWon <= 10_000;
  if (filter === "10000_50000") return item.priceWon > 10_000 && item.priceWon <= 50_000;
  return item.priceWon > 50_000;
}

function sortItems(items: AccessoryItem[], sort: AccessoryCatalogCachedQuery["sort"]) {
  return items.sort((left, right) => {
    if (sort === "name") return left.name.localeCompare(right.name, "ko-KR") || left.id.localeCompare(right.id);
    if (sort === "updated") return right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name, "ko-KR");
    if (sort === "price_desc") {
      if (!isKnownPrice(left.priceWon) && !isKnownPrice(right.priceWon)) return left.name.localeCompare(right.name, "ko-KR");
      if (!isKnownPrice(left.priceWon)) return 1;
      if (!isKnownPrice(right.priceWon)) return -1;
      return (right.priceWon ?? 0) - (left.priceWon ?? 0) || left.name.localeCompare(right.name, "ko-KR");
    }
    if (!isKnownPrice(left.priceWon) && !isKnownPrice(right.priceWon)) return left.name.localeCompare(right.name, "ko-KR");
    if (!isKnownPrice(left.priceWon)) return 1;
    if (!isKnownPrice(right.priceWon)) return -1;
    return (left.priceWon ?? 0) - (right.priceWon ?? 0) || left.name.localeCompare(right.name, "ko-KR");
  });
}

/** Catalog browsing fallback only; it never asserts accessory compatibility. */
export function accessoryCatalogCachedFallbackFor(items: ReadonlyArray<AccessoryItem>, query: AccessoryCatalogCachedQuery): AccessoryCatalogCachedResult {
  const unique = [...new Map(normalizedItems(items).map((item) => [item.id, item])).values()];
  const needle = query.query?.trim().toLocaleLowerCase("ko-KR") ?? "";
  const brandNeedle = query.brand?.trim().toLocaleLowerCase("ko-KR") ?? "";
  const filtered = unique
    .filter((item) => query.category === "all" || item.category === query.category)
    .filter((item) => !brandNeedle || (item.brand ?? "").toLocaleLowerCase("ko-KR").includes(brandNeedle))
    .filter((item) => !query.quality || query.quality === "all" || item.dataQuality === query.quality)
    .filter((item) => !query.freshness || query.freshness === "all" || classifyDataFreshness(item.updatedAt, query.now) === query.freshness)
    .filter((item) => priceMatches(item, query.priceFilter))
    .filter((item) => !needle || [item.name, item.brand, item.model, item.rawSpecText].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR").includes(needle));
  const sorted = sortItems(filtered, query.sort);
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 50)));
  return { items: sorted.slice(offset, offset + limit), total: sorted.length };
}
