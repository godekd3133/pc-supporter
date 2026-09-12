import type { PurchaseListRow } from "./purchase-list";
import { purchaseListRowKeysFor } from "./purchase-list-progress";
import { PURCHASE_ITEM_STATUS_LABELS, purchaseListItemStatusFor } from "./purchase-list-status";
import type { SavedBuildPurchaseProgress, SavedBuildPurchaseProgressSnapshot } from "./types";

export interface PurchaseListProgressHistoryExportEnvelope {
  type: "pc-supporter-purchase-progress-history";
  schemaVersion: 1;
  exportedAt: string;
  inputFingerprint: string;
  current: SavedBuildPurchaseProgressSnapshot;
  history: SavedBuildPurchaseProgressSnapshot[];
}

function snapshotOnly(progress: SavedBuildPurchaseProgress): SavedBuildPurchaseProgressSnapshot {
  const { history: _history, ...snapshot } = progress;
  return snapshot;
}

export function purchaseListProgressHistorySnapshotsFor(progress: SavedBuildPurchaseProgress) {
  return [snapshotOnly(progress), ...(progress.history ?? [])];
}

export function purchaseListProgressHistoryJsonFor(progress: SavedBuildPurchaseProgress, exportedAt = new Date().toISOString()) {
  const snapshots = purchaseListProgressHistorySnapshotsFor(progress);
  const envelope: PurchaseListProgressHistoryExportEnvelope = {
    type: "pc-supporter-purchase-progress-history",
    schemaVersion: 1,
    exportedAt,
    inputFingerprint: progress.inputFingerprint,
    current: snapshots[0],
    history: snapshots.slice(1)
  };
  return JSON.stringify(envelope, null, 2);
}

function escapeCsv(value: string | number | undefined) {
  const raw = value === undefined ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function purchaseListProgressHistoryCsvFor(progress: SavedBuildPurchaseProgress, rows: ReadonlyArray<PurchaseListRow>) {
  const rowKeys = purchaseListRowKeysFor(rows);
  const rowByKey = new Map(rowKeys.map((key, index) => [key, rows[index]]));
  const snapshots = purchaseListProgressHistorySnapshotsFor(progress);
  const header = ["revision", "상태", "저장 시각", "행 key", "부품명", "연결 대상", "구분", "구매 상태"];
  const records = snapshots.flatMap((snapshot, index) => {
    const checkedIds = new Set(snapshot.checkedIds);
    return snapshot.rowKeys.map((rowKey) => {
      const row = rowByKey.get(rowKey);
      const itemStatus = purchaseListItemStatusFor(snapshot.itemStates ?? [], rowKey, checkedIds);
      return [
        snapshot.revision,
        index === 0 ? "현재" : "이력",
        snapshot.updatedAt,
        rowKey,
        row?.name ?? rowKey,
        row?.connectionTarget,
        row?.section ?? "현재 목록에 없음",
        PURCHASE_ITEM_STATUS_LABELS[itemStatus]
      ];
    });
  });
  return `\uFEFF${[header, ...records].map((record) => record.map(escapeCsv).join(",")).join("\r\n")}`;
}
