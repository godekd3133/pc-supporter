import { classifyDataFreshness } from "./data-freshness";
import { benchmarkAvailabilityMatchesFilter } from "./benchmark-evidence";
import type { BenchmarkAvailabilityFilter, DataFreshness, DataQuality, ListingPolicy, Part, PartCategory, PriceAvailabilityFilter } from "./types";
import { isKnownPrice, PART_CATEGORIES } from "./types";
import { pcieCompatibleSlotInventoryFor, pcieSlotWidthFromUnknown } from "./pcie-slot";

export const CATALOG_PICKER_CACHE_STORAGE_KEY = "pc-supporter-catalog-picker-cache-v1";
export const CATALOG_PICKER_CACHE_MAX_ITEMS = 600;
export const CATALOG_PICKER_CACHE_SCHEMA_VERSION = 1 as const;
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

function cachedPartFromUnknown(value: unknown): Part | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id, 180);
  const category = enumValue(value.category, PART_CATEGORIES);
  const name = stringValue(value.name, 280);
  const source = enumValue(value.source, ["seed", "danawa", "manual"] as const);
  const dataQuality = enumValue(value.dataQuality, ["seed", "live", "manual", "incomplete"] as const);
  const listingType = enumValue(value.listingType, ["retail", "bulk", "parallel_import", "overseas", "used", "accessory", "unknown"] as const);
  const specs = isRecord(value.specs)
    ? Object.fromEntries(Object.entries(value.specs).slice(0, MAX_SPEC_KEYS))
    : undefined;
  const missingFields = Array.isArray(value.missingFields)
    ? value.missingFields.filter((field): field is string => typeof field === "string" && field.length <= 120).slice(0, 64)
    : undefined;
  const updatedAt = stringValue(value.updatedAt, 100);
  if (!id || !category || !name || !source || !dataQuality || !specs || !missingFields || !updatedAt) return undefined;
  const priceWon = typeof value.priceWon === "number" && Number.isFinite(value.priceWon) && value.priceWon >= 0 && value.priceWon <= 100_000_000
    ? value.priceWon
    : undefined;
  const part: Part = {
    id,
    category,
    name,
    source,
    dataQuality,
    missingFields,
    updatedAt,
    specs: specs as Part["specs"],
    ...(stringValue(value.brand, 180) ? { brand: value.brand as string } : {}),
    ...(stringValue(value.model, 180) ? { model: value.model as string } : {}),
    ...(stringValue(value.imageUrl, 1_200) ? { imageUrl: value.imageUrl as string } : {}),
    ...(stringValue(value.danawaUrl, 800) ? { danawaUrl: value.danawaUrl as string } : {}),
    ...(stringValue(value.sourceProductCode, 120) ? { sourceProductCode: value.sourceProductCode as string } : {}),
    ...(stringValue(value.sourceCategoryId, 120) ? { sourceCategoryId: value.sourceCategoryId as string } : {}),
    ...(stringValue(value.rawSpecText, MAX_TEXT_LENGTH) ? { rawSpecText: value.rawSpecText as string } : {}),
    ...(priceWon !== undefined ? { priceWon } : {}),
    ...(listingType ? { listingType } : {})
  };
  return part;
}

function normalizedParts(parts: ReadonlyArray<Part>) {
  return parts.map(cachedPartFromUnknown).filter((part): part is Part => Boolean(part));
}

/**
 * Reads only bounded, base catalog records from browser storage. Candidate
 * evaluation fields are intentionally discarded by cachedPartFromUnknown.
 */
export function catalogPickerCacheFromJson(raw: string | null | undefined): Part[] {
  return catalogPickerCacheSnapshotFromJson(raw).items;
}

export interface CatalogPickerCacheSnapshot {
  schemaVersion: typeof CATALOG_PICKER_CACHE_SCHEMA_VERSION;
  items: Part[];
  cachedAt?: string;
}

function cachedAtFromUnknown(value: unknown) {
  if (typeof value !== "string" || value.length > 100 || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

export function catalogPickerCacheSnapshotFromJson(raw: string | null | undefined): CatalogPickerCacheSnapshot {
  if (!raw || raw.length > MAX_CACHE_BYTES) return { schemaVersion: CATALOG_PICKER_CACHE_SCHEMA_VERSION, items: [] };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length > CATALOG_PICKER_CACHE_MAX_ITEMS
      ? { schemaVersion: CATALOG_PICKER_CACHE_SCHEMA_VERSION, items: [] }
      : { schemaVersion: CATALOG_PICKER_CACHE_SCHEMA_VERSION, items: normalizedParts(parsed).slice(0, CATALOG_PICKER_CACHE_MAX_ITEMS) };
    if (!isRecord(parsed) || parsed.schemaVersion !== CATALOG_PICKER_CACHE_SCHEMA_VERSION || !Array.isArray(parsed.items) || parsed.items.length > CATALOG_PICKER_CACHE_MAX_ITEMS) return { schemaVersion: CATALOG_PICKER_CACHE_SCHEMA_VERSION, items: [] };
    const cachedAt = cachedAtFromUnknown(parsed.cachedAt);
    return { schemaVersion: CATALOG_PICKER_CACHE_SCHEMA_VERSION, items: normalizedParts(parsed.items).slice(0, CATALOG_PICKER_CACHE_MAX_ITEMS), ...(cachedAt ? { cachedAt } : {}) };
  } catch {
    return { schemaVersion: CATALOG_PICKER_CACHE_SCHEMA_VERSION, items: [] };
  }
}

export function catalogPickerCacheToJson(parts: ReadonlyArray<Part>, cachedAt?: string) {
  const normalized = normalizedParts(parts).slice(0, CATALOG_PICKER_CACHE_MAX_ITEMS);
  const envelopeFor = (items: ReadonlyArray<Part>) => JSON.stringify({ schemaVersion: CATALOG_PICKER_CACHE_SCHEMA_VERSION, ...(cachedAt ? { cachedAt } : {}), items });
  let candidate = envelopeFor(normalized);
  if (candidate.length <= MAX_CACHE_BYTES) return candidate;
  const bounded: Part[] = [];
  for (const part of normalized) {
    bounded.push(part);
    candidate = envelopeFor(bounded);
    if (candidate.length > MAX_CACHE_BYTES) {
      bounded.pop();
      break;
    }
  }
  return envelopeFor(bounded);
}

/** Incoming successful responses win over older cached records with the same ID. */
export function mergeCatalogPickerCache(current: ReadonlyArray<Part>, incoming: ReadonlyArray<Part>) {
  const merged = new Map<string, Part>();
  for (const part of normalizedParts(incoming)) merged.set(part.id, part);
  for (const part of normalizedParts(current)) if (!merged.has(part.id)) merged.set(part.id, part);
  return [...merged.values()].slice(0, CATALOG_PICKER_CACHE_MAX_ITEMS);
}

export type CatalogPickerCachedSort = "price_asc" | "price_desc" | "name" | "updated";

export type CatalogPickerCachedSpecFilter = Readonly<Record<string, string>>;

export interface CatalogPickerCachedQuery {
  category: PartCategory;
  query?: string;
  brand?: string;
  quality?: DataQuality | "all";
  freshness?: DataFreshness | "all";
  priceStatus?: PriceAvailabilityFilter;
  benchmarkStatus?: BenchmarkAvailabilityFilter;
  listingPolicy?: ListingPolicy;
  sort?: CatalogPickerCachedSort;
  specFilter?: CatalogPickerCachedSpecFilter;
  offset?: number;
  limit?: number;
  now?: string | number;
}

export interface CatalogPickerCachedResult {
  items: Part[];
  total: number;
}

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("ko-KR") : "";
}

function numberValue(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formFactorsFor(part: Part) {
  return [
    part.specs.formFactor,
    part.specs.psuFormFactor,
    ...(part.specs.motherboardFormFactors ?? []),
    ...(part.specs.supportedPsuFormFactors ?? []),
    ...(part.specs.supportedFormFactors ?? [])
  ].filter((value): value is string => Boolean(value));
}

function listingAllowedFor(part: Part, policy: ListingPolicy) {
  const listingType = part.listingType ?? "retail";
  if (listingType === "accessory") return false;
  if (policy === "all") return true;
  if (policy === "include_bulk") return listingType === "retail" || listingType === "bulk";
  return listingType === "retail";
}

function exactMatch(value: string | undefined, expected: string) {
  if (!value) return false;
  return value.toLocaleLowerCase("ko-KR") === expected.toLocaleLowerCase("ko-KR");
}

function matchesSpecFilter(part: Part, filter: CatalogPickerCachedSpecFilter) {
  const specs = part.specs;
  const socket = filter.socket?.trim();
  if (socket && ![specs.socket, ...(specs.supportedSockets ?? [])].some((value) => exactMatch(value, socket))) return false;
  const memoryType = filter.memoryType?.trim();
  if (memoryType && !exactMatch(specs.memoryType, memoryType)) return false;
  const formFactor = filter.formFactor?.trim();
  if (formFactor && !formFactorsFor(part).some((value) => exactMatch(value, formFactor))) return false;
  const numericRules: Array<[number | null | undefined, number | undefined, "min" | "max"]> = [
    [numberValue(filter.minVramGb), specs.vramGb, "min"],
    [numberValue(filter.minCapacityGb), specs.capacityGb, "min"],
    [numberValue(filter.minWattageW), specs.wattageW, "min"],
    [numberValue(filter.minMemorySpeedMhz), specs.speedMhz, "min"],
    [numberValue(filter.minMemorySlots), specs.memorySlots, "min"],
    [numberValue(filter.minM2Slots), specs.m2Slots, "min"],
    [numberValue(filter.minSataPorts), specs.sataPorts, "min"],
    [numberValue(filter.minHddBays), specs.hddBays, "min"],
    [numberValue(filter.minMaxGpuLengthMm), specs.maxGpuLengthMm, "min"],
    [numberValue(filter.minMaxCoolerHeightMm), specs.maxCoolerHeightMm, "min"],
    [numberValue(filter.minMaxPsuLengthMm), specs.maxPsuLengthMm, "min"],
    [numberValue(filter.minCoolingW), specs.maxCoolingW, "min"],
    [numberValue(filter.maxLengthMm), specs.lengthMm, "max"],
    [numberValue(filter.maxPsuDepthMm), specs.psuDepthMm, "max"]
  ];
  for (const [expected, actual, comparison] of numericRules) {
    if (expected === undefined) continue;
    if (expected === null || actual === undefined) return false;
    if (comparison === "min" ? actual < expected : actual > expected) return false;
  }
  const storageInterface = filter.interface?.trim();
  if (storageInterface && !exactMatch(specs.interface, storageInterface)) return false;
  const pcieSlotInfo = filter.pcieSlotInfo?.trim();
  if (pcieSlotInfo === "complete" || pcieSlotInfo === "missing") {
    const complete = part.category === "motherboard" && pcieCompatibleSlotInventoryFor(specs, 1).complete;
    if (pcieSlotInfo === "complete" ? !complete : complete) return false;
  }
  const pcieSlotWidth = filter.pcieSlotWidth?.trim();
  if (pcieSlotWidth) {
    const requiredWidth = pcieSlotWidthFromUnknown(pcieSlotWidth);
    const requiredCount = numberValue(filter.minPcieSlotCount) ?? 1;
    if (requiredWidth === undefined || requiredCount === null) return false;
    const inventory = pcieCompatibleSlotInventoryFor(specs, requiredWidth);
    if (part.category !== "motherboard" || !inventory.complete || inventory.knownSlotCount < requiredCount) return false;
  } else if (filter.minPcieSlotCount?.trim()) {
    const requiredCount = numberValue(filter.minPcieSlotCount);
    if (requiredCount === null || requiredCount === undefined) return false;
    const inventory = pcieCompatibleSlotInventoryFor(specs, 1);
    if (part.category !== "motherboard" || !inventory.complete || inventory.knownSlotCount < requiredCount) return false;
  }
  return true;
}

function sortCachedParts(parts: Part[], sort: CatalogPickerCachedSort | undefined) {
  return parts.sort((left, right) => {
    if (sort === "name") return left.name.localeCompare(right.name, "ko-KR") || left.id.localeCompare(right.id);
    if (sort === "updated") return right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name, "ko-KR");
    if (sort === "price_desc") {
      if (!isKnownPrice(left.priceWon) && !isKnownPrice(right.priceWon)) return left.name.localeCompare(right.name, "ko-KR");
      if (!isKnownPrice(left.priceWon)) return 1;
      if (!isKnownPrice(right.priceWon)) return -1;
      return (right.priceWon ?? 0) - (left.priceWon ?? 0) || left.name.localeCompare(right.name, "ko-KR");
    }
    if (left.dataQuality === "incomplete" && right.dataQuality !== "incomplete") return 1;
    if (left.dataQuality !== "incomplete" && right.dataQuality === "incomplete") return -1;
    if (!isKnownPrice(left.priceWon) && !isKnownPrice(right.priceWon)) return left.name.localeCompare(right.name, "ko-KR");
    if (!isKnownPrice(left.priceWon)) return 1;
    if (!isKnownPrice(right.priceWon)) return -1;
    return (left.priceWon ?? 0) - (right.priceWon ?? 0) || left.name.localeCompare(right.name, "ko-KR");
  });
}

/**
 * Cached fallback is a catalog browser only. It never calculates candidate
 * safety, similarity, or full-build compatibility.
 */
export function catalogPickerCachedFallbackFor(parts: ReadonlyArray<Part>, query: CatalogPickerCachedQuery): CatalogPickerCachedResult {
  const unique = [...new Map(normalizedParts(parts).map((part) => [part.id, part])).values()];
  const needle = normalizedText(query.query);
  const brandNeedle = normalizedText(query.brand);
  const filtered = unique
    .filter((part) => part.category === query.category)
    .filter((part) => !brandNeedle || normalizedText(part.brand).includes(brandNeedle))
    .filter((part) => !query.quality || query.quality === "all" || part.dataQuality === query.quality)
    .filter((part) => !query.freshness || query.freshness === "all" || classifyDataFreshness(part.updatedAt, query.now) === query.freshness)
    .filter((part) => !query.priceStatus || query.priceStatus === "all" || (query.priceStatus === "known" ? isKnownPrice(part.priceWon) : !isKnownPrice(part.priceWon)))
    .filter((part) => !query.benchmarkStatus || query.benchmarkStatus === "all" || benchmarkAvailabilityMatchesFilter(part, query.benchmarkStatus))
    .filter((part) => !query.listingPolicy || listingAllowedFor(part, query.listingPolicy))
    .filter((part) => matchesSpecFilter(part, query.specFilter ?? {}))
    .filter((part) => {
      if (!needle) return true;
      const haystack = [part.name, part.brand, part.model, part.specs.socket, part.specs.memoryType, part.specs.interface, part.specs.formFactor].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR");
      return haystack.includes(needle);
    });
  const sorted = sortCachedParts(filtered, query.sort);
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 50)));
  return { items: sorted.slice(offset, offset + limit), total: sorted.length };
}
