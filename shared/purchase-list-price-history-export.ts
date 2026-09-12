import type { SavedBuildPurchasePriceHistory } from "./types";
import { purchaseListRowKey, type PurchaseListRow } from "./purchase-list";
import { purchaseListPriceHistoryFromJson, purchaseListPriceHistoryToJson, type PurchaseListPriceHistory } from "./purchase-list-price-history";

function escapeCsv(value: string | number | undefined) {
  const raw = value === undefined ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function normalizedHistory(history: PurchaseListPriceHistory) {
  return purchaseListPriceHistoryFromJson(purchaseListPriceHistoryToJson(history));
}

function deltaLabel(current: number, previous: number | undefined) {
  return previous === undefined ? undefined : current - previous;
}

export function purchaseListPriceHistoryCsvFor(rows: ReadonlyArray<PurchaseListRow>, history: PurchaseListPriceHistory) {
  const safeHistory = normalizedHistory(history);
  const header = ["행 key", "구분", "분류", "부품명", "수량", "연결 대상", "확인 시각", "단가(원)", "이전 확인 대비(원)", "기록 상태"];
  const records = rows.flatMap((row, index) => {
    const rowKey = purchaseListRowKey(row, index);
    const observations = safeHistory[rowKey] ?? [];
    return observations.map((observation, observationIndex) => [
      rowKey,
      row.section,
      row.categoryLabel,
      row.name,
      row.quantity,
      row.connectionTarget,
      observation.checkedAt,
      observation.unitPriceWon,
      deltaLabel(observation.unitPriceWon, observations[observationIndex - 1]?.unitPriceWon),
      observationIndex === observations.length - 1 ? "최신" : "이력"
    ]);
  });
  return `\uFEFF${[header, ...records].map((record) => record.map(escapeCsv).join(",")).join("\r\n")}`;
}

export function purchaseListPriceHistorySnapshotsCsvFor(saved: SavedBuildPurchasePriceHistory, rows: ReadonlyArray<PurchaseListRow>) {
  const rowKeys = rows.map((row, index) => purchaseListRowKey(row, index));
  const rowByKey = new Map(rowKeys.map((rowKey, index) => [rowKey, rows[index]]));
  const snapshots = [{ status: "현재", snapshot: saved }, ...(saved.history ?? []).map((snapshot) => ({ status: "이력", snapshot }))];
  const header = ["revision", "상태", "저장 시각", "행 key", "구분", "분류", "부품명", "수량", "연결 대상", "확인 시각", "단가(원)", "이전 확인 대비(원)"];
  const records = snapshots.flatMap(({ status, snapshot }) => Object.entries(normalizedHistory(snapshot.priceHistory)).flatMap(([rowKey, observations]) => {
    const row = rowByKey.get(rowKey);
    return observations.map((observation, observationIndex) => [
      snapshot.revision,
      status,
      snapshot.updatedAt,
      rowKey,
      row?.section,
      row?.categoryLabel,
      row?.name ?? rowKey,
      row?.quantity,
      row?.connectionTarget,
      observation.checkedAt,
      observation.unitPriceWon,
      deltaLabel(observation.unitPriceWon, observations[observationIndex - 1]?.unitPriceWon)
    ]);
  }));
  return `\uFEFF${[header, ...records].map((record) => record.map(escapeCsv).join(",")).join("\r\n")}`;
}
