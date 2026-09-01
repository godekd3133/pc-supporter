import type { CatalogWatchEntry } from "./catalog-watchlist";

export interface CatalogWatchSnapshot {
  entry: CatalogWatchEntry;
  currentDataStatus: "available" | "price_unavailable" | "out_of_scope";
  targetPriceWon?: number;
  sampleCount: number;
  latestPriceWon?: number;
  minPriceWon?: number;
  maxPriceWon?: number;
  fromHighDeltaWon?: number;
  fromHighPercent?: number;
  currentPositionPercent?: number;
  signals: string[];
}

export interface CatalogWatchExportOptions {
  nearLowThresholdPercent: number;
}

function csvCell(value: string | number | undefined) {
  const raw = value === undefined ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function catalogWatchlistCsvFor(snapshots: CatalogWatchSnapshot[]) {
  const header = ["구분", "분류", "부품명", "부품 ID", "추가 시각", "목표가(원)", "가격 샘플 수", "최근 가격(원)", "최저가(원)", "최고가(원)", "최고가 대비(원)", "최고가 대비(%)", "현재 가격 위치(%)", "가격 신호", "현재 조회 상태"];
  const rows = snapshots.map((snapshot) => [
    snapshot.entry.kind === "accessory" ? "주변 부품" : "핵심 부품",
    snapshot.entry.category,
    snapshot.entry.itemName,
    snapshot.entry.itemId,
    snapshot.entry.addedAt,
    snapshot.targetPriceWon,
    snapshot.sampleCount,
    snapshot.latestPriceWon,
    snapshot.minPriceWon,
    snapshot.maxPriceWon,
    snapshot.fromHighDeltaWon,
    snapshot.fromHighPercent,
    snapshot.currentPositionPercent,
    snapshot.signals.join(" | "),
    snapshot.currentDataStatus === "out_of_scope" ? "현재 조회 범위에 가격 이력 없음" : snapshot.currentDataStatus === "price_unavailable" ? "현재 조회 범위에 가격 미확인" : "가격 이력 확인"
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map((value) => csvCell(value)).join(",")).join("\r\n")}`;
}

export function catalogWatchlistJsonFor(snapshots: CatalogWatchSnapshot[], options: CatalogWatchExportOptions) {
  return JSON.stringify({
    type: "pc-supporter-catalog-watchlist",
    version: 1,
    exportedAt: new Date().toISOString(),
    filters: options,
    items: snapshots
  }, null, 2);
}
