import type { CatalogChangeKind, CatalogChangeRecord, DataQuality } from "./types";

export type CatalogChangeKindFilter = "all" | CatalogChangeKind;

export type CatalogChangeFilter = "all" | "price_up" | "price_down" | "price_newly_known" | "quality_improved" | "quality_degraded" | "missing_reduced" | "missing_increased" | "spec" | "benchmark";

export interface CatalogChangeDashboardSummary {
  total: number;
  priceUp: number;
  priceDown: number;
  priceNewlyKnown: number;
  qualityImproved: number;
  qualityDegraded: number;
  missingReduced: number;
  missingIncreased: number;
  specChanged: number;
  benchmarkChanged: number;
}

export interface CatalogChangePriorityRecord {
  record: CatalogChangeRecord;
  score: number;
  reasons: string[];
}

const DATA_QUALITY_RANK: Record<DataQuality, number> = {
  incomplete: 0,
  seed: 1,
  live: 2,
  manual: 3
};

export function catalogChangePriceDirection(record: CatalogChangeRecord, direction: "up" | "down") {
  if (record.priceDeltaWon === undefined) return false;
  return direction === "up" ? record.priceDeltaWon > 0 : record.priceDeltaWon < 0;
}

export function catalogChangePriceNewlyKnown(record: CatalogChangeRecord) {
  return record.previousPriceWon === undefined && record.nextPriceWon !== undefined;
}

export function catalogChangeQualityImproved(record: CatalogChangeRecord) {
  return DATA_QUALITY_RANK[record.nextDataQuality] > DATA_QUALITY_RANK[record.previousDataQuality];
}

export function catalogChangeQualityDegraded(record: CatalogChangeRecord) {
  return DATA_QUALITY_RANK[record.nextDataQuality] < DATA_QUALITY_RANK[record.previousDataQuality];
}

export function catalogChangeMissingReduced(record: CatalogChangeRecord) {
  return record.nextMissingFields.length < record.previousMissingFields.length;
}

export function catalogChangeMissingIncreased(record: CatalogChangeRecord) {
  return record.nextMissingFields.length > record.previousMissingFields.length;
}

export function catalogChangeSpecChanged(record: CatalogChangeRecord) {
  return record.changedFields.includes("원문 스펙") || record.changedFields.includes("정규화 스펙");
}

export function catalogChangeBenchmarkChanged(record: CatalogChangeRecord) {
  return record.changedFields.includes("벤치마크 보강");
}

export function catalogChangePriorityReasons(record: CatalogChangeRecord) {
  return [
    ...(catalogChangeQualityDegraded(record) ? ["품질 저하"] : []),
    ...(catalogChangeMissingIncreased(record) ? ["누락 증가"] : []),
    ...(catalogChangePriceDirection(record, "up") ? ["가격 상승"] : []),
    ...(catalogChangePriceNewlyKnown(record) ? ["가격 신규 확인"] : [])
  ];
}

export function catalogChangePriorityScore(record: CatalogChangeRecord) {
  return (catalogChangeQualityDegraded(record) ? 100 : 0)
    + (catalogChangeMissingIncreased(record) ? 90 : 0)
    + (catalogChangePriceDirection(record, "up") ? 50 : 0)
    + (catalogChangePriceNewlyKnown(record) ? 20 : 0);
}

export function prioritizedCatalogChanges(records: CatalogChangeRecord[], limit = 6): CatalogChangePriorityRecord[] {
  const safeLimit = Math.min(12, Math.max(1, Math.floor(limit)));
  return records
    .map((record) => ({ record, score: catalogChangePriorityScore(record), reasons: catalogChangePriorityReasons(record) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.record.changedAt.localeCompare(left.record.changedAt) || left.record.id.localeCompare(right.record.id))
    .slice(0, safeLimit);
}

export function catalogChangeMatches(record: CatalogChangeRecord, kindFilter: CatalogChangeKindFilter = "all", changeFilter: CatalogChangeFilter = "all") {
  if (kindFilter !== "all" && record.kind !== kindFilter) return false;
  switch (changeFilter) {
    case "price_up":
      return catalogChangePriceDirection(record, "up");
    case "price_down":
      return catalogChangePriceDirection(record, "down");
    case "price_newly_known":
      return catalogChangePriceNewlyKnown(record);
    case "quality_improved":
      return catalogChangeQualityImproved(record);
    case "quality_degraded":
      return catalogChangeQualityDegraded(record);
    case "missing_reduced":
      return catalogChangeMissingReduced(record);
    case "missing_increased":
      return catalogChangeMissingIncreased(record);
    case "spec":
      return catalogChangeSpecChanged(record);
    case "benchmark":
      return catalogChangeBenchmarkChanged(record);
    case "all":
      return true;
  }
}

export function catalogChangeDashboardSummary(records: CatalogChangeRecord[]): CatalogChangeDashboardSummary {
  return records.reduce<CatalogChangeDashboardSummary>((summary, record) => ({
    total: summary.total + 1,
    priceUp: summary.priceUp + (catalogChangePriceDirection(record, "up") ? 1 : 0),
    priceDown: summary.priceDown + (catalogChangePriceDirection(record, "down") ? 1 : 0),
    priceNewlyKnown: summary.priceNewlyKnown + (catalogChangePriceNewlyKnown(record) ? 1 : 0),
    qualityImproved: summary.qualityImproved + (catalogChangeQualityImproved(record) ? 1 : 0),
    qualityDegraded: summary.qualityDegraded + (catalogChangeQualityDegraded(record) ? 1 : 0),
    missingReduced: summary.missingReduced + (catalogChangeMissingReduced(record) ? 1 : 0),
    missingIncreased: summary.missingIncreased + (catalogChangeMissingIncreased(record) ? 1 : 0),
    specChanged: summary.specChanged + (catalogChangeSpecChanged(record) ? 1 : 0),
    benchmarkChanged: summary.benchmarkChanged + (catalogChangeBenchmarkChanged(record) ? 1 : 0)
  }), { total: 0, priceUp: 0, priceDown: 0, priceNewlyKnown: 0, qualityImproved: 0, qualityDegraded: 0, missingReduced: 0, missingIncreased: 0, specChanged: 0, benchmarkChanged: 0 });
}
