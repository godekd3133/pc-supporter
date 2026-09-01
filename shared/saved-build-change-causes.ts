import type { BuildSelection, CatalogChangeRecord, CatalogChangeValueDiff } from "./types";

function selectedIdsFor(build: BuildSelection) {
  return [
    build.cpu?.partId,
    build.cooler?.partId,
    build.motherboard?.partId,
    build.gpu?.partId,
    build.case?.partId,
    build.psu?.partId,
    ...build.memory.map((selection) => selection.partId),
    ...build.ssd.map((selection) => selection.partId),
    ...build.hdd.map((selection) => selection.partId),
    ...(build.accessories ?? []).map((selection) => selection.accessoryId)
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
}

export function savedBuildCatalogChangeCausesFor(build: BuildSelection, records: CatalogChangeRecord[], from: string, to: string, limit = 50) {
  const fromTimestamp = Date.parse(from);
  const toTimestamp = Date.parse(to);
  if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp)) return [];
  const lower = Math.min(fromTimestamp, toTimestamp);
  const upper = Math.max(fromTimestamp, toTimestamp);
  const selectedIds = new Set(selectedIdsFor(build));
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 50;
  return records
    .filter((record) => selectedIds.has(record.itemId))
    .filter((record) => {
      const changedAt = Date.parse(record.changedAt);
      return Number.isFinite(changedAt) && changedAt > lower && changedAt <= upper;
    })
    .sort((left, right) => left.changedAt.localeCompare(right.changedAt) || left.id.localeCompare(right.id))
    .slice(0, safeLimit);
}

function fallbackValueDiff(field: string, previous: string | undefined, next: string | undefined): CatalogChangeValueDiff {
  return { field, previous: previous ?? "확인 정보 없음", next: next ?? "확인 정보 없음" };
}

export function savedBuildCatalogChangeValueDiffsFor(record: CatalogChangeRecord): CatalogChangeValueDiff[] {
  if (record.valueDiffs && record.valueDiffs.length > 0) return record.valueDiffs;
  const diffs: CatalogChangeValueDiff[] = [];
  if (record.changedFields.includes("상품명")) diffs.push(fallbackValueDiff("상품명", undefined, record.itemName));
  if (record.changedFields.includes("가격") || record.priceDeltaWon !== undefined) {
    const previous = record.previousPriceWon === undefined ? undefined : `${record.previousPriceWon.toLocaleString("ko-KR")}원`;
    const next = record.nextPriceWon === undefined ? undefined : `${record.nextPriceWon.toLocaleString("ko-KR")}원`;
    diffs.push(fallbackValueDiff("가격", previous, next));
  }
  if (record.changedFields.includes("원문 스펙")) diffs.push(fallbackValueDiff("원문 스펙", undefined, undefined));
  if (record.changedFields.includes("정규화 스펙")) diffs.push(fallbackValueDiff("정규화 스펙", undefined, undefined));
  if (record.changedFields.includes("데이터 품질")) diffs.push(fallbackValueDiff("데이터 품질", record.previousDataQuality, record.nextDataQuality));
  if (record.changedFields.includes("누락 필드")) {
    const previous = record.previousMissingFields.length === 0 ? "없음" : record.previousMissingFields.join(" · ");
    const next = record.nextMissingFields.length === 0 ? "없음" : record.nextMissingFields.join(" · ");
    diffs.push(fallbackValueDiff("누락 필드", previous, next));
  }
  return diffs;
}
