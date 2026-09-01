import type { CatalogChangeRecord } from "./types";

export interface CatalogChangeExportFilters {
  kind?: string;
  change?: string;
  from?: string;
  to?: string;
  limit?: number;
}

function csvCell(value: string | number | undefined) {
  const raw = value === undefined ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function catalogChangeCsvFor(records: CatalogChangeRecord[]) {
  const header = ["변경 시각", "구분", "분류", "부품명", "부품 ID", "상품 코드", "이전 품질", "현재 품질", "이전 누락 수", "현재 누락 수", "이전 가격(원)", "현재 가격(원)", "가격 차이(원)", "변경 필드"];
  const rows = records.map((record) => [
    record.changedAt,
    record.kind === "accessory" ? "주변 부품" : "핵심 부품",
    record.category,
    record.itemName,
    record.itemId,
    record.sourceProductCode,
    record.previousDataQuality,
    record.nextDataQuality,
    record.previousMissingFields.length,
    record.nextMissingFields.length,
    record.previousPriceWon,
    record.nextPriceWon,
    record.priceDeltaWon,
    record.changedFields.join(" | ")
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map((value) => csvCell(value)).join(",")).join("\r\n")}`;
}

export function catalogChangeJsonFor(records: CatalogChangeRecord[], filters: CatalogChangeExportFilters = {}) {
  return JSON.stringify({
    type: "pc-supporter-catalog-change-log",
    version: 1,
    exportedAt: new Date().toISOString(),
    filters,
    items: records
  }, null, 2);
}
