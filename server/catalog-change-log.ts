import { randomUUID } from "node:crypto";
import type { AccessoryItem, CatalogChangeKind, CatalogChangeRecord, CatalogChangeSummary, CatalogChangeValueDiff, Part } from "../shared/types";
import { isKnownPrice } from "../shared/types";
import { CATALOG_CHANGE_LOG_PATH, readJson, writeJson } from "./storage";

const MAX_CHANGE_LOG_SIZE = 1000;
const MAX_VALUE_DIFFS = 8;
const MAX_VALUE_LENGTH = 420;

type CatalogItem = Part | AccessoryItem;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function readableValue(value: unknown, price = false): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (price) return isKnownPrice(value as number) ? `${(value as number).toLocaleString("ko-KR")}원` : "확인 정보 없음";
  if (Array.isArray(value)) return value.length === 0 ? "없음" : value.map((item) => readableValue(item) ?? "확인 정보 없음").join(" · ");
  if (typeof value === "object") return stableJson(value);
  return String(value);
}

function boundedValue(value: string | undefined) {
  if (!value) return undefined;
  return value.length <= MAX_VALUE_LENGTH ? value : `${value.slice(0, MAX_VALUE_LENGTH - 1)}…`;
}

function valueDiff(field: string, previous: unknown, next: unknown, price = false): CatalogChangeValueDiff | undefined {
  if (stableJson(previous) === stableJson(next)) return undefined;
  const previousText = boundedValue(readableValue(previous, price));
  const nextText = boundedValue(readableValue(next, price));
  return { field, ...(previousText ? { previous: previousText } : {}), ...(nextText ? { next: nextText } : {}) };
}

function catalogChangeValueDiffs(before: CatalogItem, after: CatalogItem) {
  return [
    valueDiff("상품명", before.name, after.name),
    valueDiff("가격", before.priceWon, after.priceWon, true),
    valueDiff("원문 스펙", before.rawSpecText, after.rawSpecText),
    valueDiff("정규화 스펙", before.specs, after.specs),
    valueDiff("데이터 품질", before.dataQuality, after.dataQuality),
    valueDiff("누락 필드", before.missingFields, after.missingFields)
  ].filter((diff): diff is CatalogChangeValueDiff => diff !== undefined).slice(0, MAX_VALUE_DIFFS);
}

export function catalogItemKey(item: CatalogItem) {
  return item.sourceProductCode ? `${item.category}:danawa:${item.sourceProductCode}` : `${item.category}:${item.id}`;
}

export function meaningfulCatalogChangeFields(before: CatalogItem, after: CatalogItem) {
  const fields: Array<[string, unknown, unknown]> = [
    ["상품명", before.name, after.name],
    ["가격", before.priceWon, after.priceWon],
    ["원문 스펙", before.rawSpecText, after.rawSpecText],
    ["정규화 스펙", before.specs, after.specs],
    ["데이터 품질", before.dataQuality, after.dataQuality],
    ["누락 필드", before.missingFields, after.missingFields]
  ];
  return fields.filter(([, left, right]) => stableJson(left) !== stableJson(right)).map(([label]) => label);
}

export function catalogChangeRecord(kind: CatalogChangeKind, before: CatalogItem, after: CatalogItem, changedFields: string[], options: { id?: string; changedAt?: string } = {}): CatalogChangeRecord {
  const previousPriceWon = isKnownPrice(before.priceWon) ? before.priceWon : undefined;
  const nextPriceWon = isKnownPrice(after.priceWon) ? after.priceWon : undefined;
  return {
    id: options.id ?? randomUUID(),
    kind,
    itemId: after.id,
    itemName: after.name,
    category: after.category,
    ...(after.sourceProductCode ? { sourceProductCode: after.sourceProductCode } : {}),
    changedAt: options.changedAt ?? new Date().toISOString(),
    changedFields: [...changedFields],
    previousDataQuality: before.dataQuality,
    nextDataQuality: after.dataQuality,
    previousMissingFields: [...before.missingFields],
    nextMissingFields: [...after.missingFields],
    ...(previousPriceWon !== undefined ? { previousPriceWon } : {}),
    ...(nextPriceWon !== undefined ? { nextPriceWon } : {}),
    ...(previousPriceWon !== undefined && nextPriceWon !== undefined ? { priceDeltaWon: nextPriceWon - previousPriceWon } : {}),
    valueDiffs: catalogChangeValueDiffs(before, after)
  };
}

export function filterCatalogChangeRecords(records: CatalogChangeRecord[], options: { kind?: CatalogChangeKind; category?: string; limit?: number; from?: string; to?: string } = {}) {
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 20)));
  const fromTimestamp = options.from ? Date.parse(options.from) : undefined;
  const toTimestamp = options.to ? Date.parse(options.to) : undefined;
  return records
    .filter((record) => !options.kind || record.kind === options.kind)
    .filter((record) => !options.category || record.category === options.category)
    .filter((record) => {
      if (fromTimestamp === undefined && toTimestamp === undefined) return true;
      const changedTimestamp = Date.parse(record.changedAt);
      return Number.isFinite(changedTimestamp) && (fromTimestamp === undefined || changedTimestamp >= fromTimestamp) && (toTimestamp === undefined || changedTimestamp <= toTimestamp);
    })
    .sort((left, right) => right.changedAt.localeCompare(left.changedAt))
    .slice(0, limit);
}

export async function readCatalogChangeRecords(options: { kind?: CatalogChangeKind; category?: string; limit?: number; from?: string; to?: string } = {}) {
  const records = await readJson<CatalogChangeRecord[]>(CATALOG_CHANGE_LOG_PATH, []);
  return filterCatalogChangeRecords(records, options);
}

export async function appendCatalogChangeRecord(record: CatalogChangeRecord) {
  await appendCatalogChangeRecords([record]);
  return record;
}

export async function appendCatalogChangeRecords(newRecords: CatalogChangeRecord[]) {
  if (newRecords.length === 0) return [];
  const records = await readJson<CatalogChangeRecord[]>(CATALOG_CHANGE_LOG_PATH, []);
  const newIds = new Set(newRecords.map((record) => record.id));
  await writeJson(CATALOG_CHANGE_LOG_PATH, [...newRecords, ...records.filter((record) => !newIds.has(record.id))].slice(0, MAX_CHANGE_LOG_SIZE));
  return newRecords;
}

export function catalogChangeSummary(records: CatalogChangeRecord[], inspectedProducts: number): CatalogChangeSummary {
  return {
    inspectedProducts,
    changedProducts: records.length,
    priceChangedProducts: records.filter((record) => record.changedFields.includes("가격") || (record.priceDeltaWon !== undefined && record.priceDeltaWon !== 0)).length,
    qualityChangedProducts: records.filter((record) => record.previousDataQuality !== record.nextDataQuality).length,
    missingFieldChangedProducts: records.filter((record) => record.changedFields.includes("누락 필드")).length,
    specChangedProducts: records.filter((record) => record.changedFields.includes("원문 스펙") || record.changedFields.includes("정규화 스펙")).length
  };
}
