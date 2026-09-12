import { purchaseListPriceEvidenceNeedsReviewFor, purchaseListRowKey, type PurchaseListRow } from "./purchase-list";
import { purchaseListCheckedIdsForItemStatuses, purchaseListItemStatusCountsFor, purchaseListItemStatusFor, purchaseListItemStatusesFromUnknown } from "./purchase-list-status";
import type { PurchaseItemStatus, PurchaseListItemStatus } from "./purchase-list-status";
import type { SavedBuildPurchaseProgressSnapshot } from "./types";

export interface PurchaseListProgress {
  total: number;
  checked: number;
  remaining: number;
  percent: number;
}

export interface PurchaseListExecutionProgress extends PurchaseListProgress {
  stageCounts: Record<PurchaseItemStatus, number>;
}

export interface PurchaseListProgressAmountSummary {
  checkedTotalPriceWon: number;
  remainingTotalPriceWon: number;
  checkedPriceComplete: boolean;
  remainingPriceComplete: boolean;
  checkedRowCount: number;
  remainingRowCount: number;
}

export interface PurchaseListBudgetSummary {
  budgetWon: number;
  totalPriceWon: number;
  priceComplete: boolean;
  priceEvidenceReviewCount?: number;
  deltaWon?: number;
  withinBudget?: boolean;
}

export interface PurchaseListProgressTransferEnvelope {
  type: "pc-supporter-purchase-list-progress";
  schemaVersion: 1;
  storageKey: string;
  exportedAt: string;
  rowKeys: string[];
  checkedIds: string[];
  itemStates?: PurchaseListItemStatus[];
}

export interface PurchaseListProgressTransferParseResult {
  checkedIds: string[];
  ignoredIds: string[];
  rowKeys: string[];
  exportedAt?: string;
  itemStates?: PurchaseListItemStatus[];
  errors: string[];
}

export interface PurchaseListProgressTransferDiff {
  currentCheckedCount: number;
  incomingCheckedCount: number;
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
}

export type PurchaseListProgressSyncState = "synced" | "local-only" | "server-only" | "diverged";

export interface PurchaseListProgressSyncComparison {
  state: PurchaseListProgressSyncState;
  currentCheckedIds: string[];
  serverCheckedIds: string[];
  localOnlyIds: string[];
  serverOnlyIds: string[];
  currentCheckedCount: number;
  serverCheckedCount: number;
}

export interface PurchaseListProgressRevisionDiff {
  fromRevision: number;
  toRevision: number;
  addedIds: string[];
  removedIds: string[];
  unchangedIds: string[];
  fromCheckedCount: number;
  toCheckedCount: number;
  statusChanges: Array<{ rowKey: string; from: PurchaseItemStatus; to: PurchaseItemStatus }>;
}

export const PURCHASE_LIST_PROGRESS_MAX_CHECKED_IDS = 100;

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

function normalizedCheckedIds(ids: ReadonlyArray<string>) {
  return uniqueIds(ids.filter((id) => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()));
}

export function purchaseListRowKeysFor(rows: ReadonlyArray<PurchaseListRow>) {
  return rows.map((row, index) => purchaseListRowKey(row, index));
}

export function purchaseListCheckedIdsFromJson(raw: string | null | undefined) {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || parsed.length > PURCHASE_LIST_PROGRESS_MAX_CHECKED_IDS) return [] as string[];
    return uniqueIds(parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 240).map((value) => value.trim())).slice(0, PURCHASE_LIST_PROGRESS_MAX_CHECKED_IDS);
  } catch {
    return [] as string[];
  }
}

export function purchaseListCheckedIdsToJson(ids: ReadonlyArray<string>) {
  return JSON.stringify(uniqueIds(ids.filter((id) => typeof id === "string" && id.trim().length > 0 && id.length <= 240).map((id) => id.trim())).slice(0, PURCHASE_LIST_PROGRESS_MAX_CHECKED_IDS));
}

export function purchaseListProgressFor(rows: ReadonlyArray<PurchaseListRow>, checkedIds: ReadonlySet<string>): PurchaseListProgress {
  const keys = purchaseListRowKeysFor(rows);
  const checked = keys.filter((key) => checkedIds.has(key)).length;
  return { total: keys.length, checked, remaining: Math.max(0, keys.length - checked), percent: keys.length === 0 ? 0 : Math.round((checked / keys.length) * 100) };
}

export function purchaseListExecutionProgressFor(rows: ReadonlyArray<PurchaseListRow>, checkedIds: ReadonlySet<string>, itemStates: ReadonlyArray<PurchaseListItemStatus>): PurchaseListExecutionProgress {
  const progress = purchaseListProgressFor(rows, checkedIds);
  const statusCounts = purchaseListItemStatusCountsFor(purchaseListRowKeysFor(rows), itemStates, checkedIds);
  return {
    ...progress,
    stageCounts: { planned: statusCounts.planned, ordered: statusCounts.ordered, received: statusCounts.received, installed: statusCounts.installed }
  };
}

export function purchaseListProgressAmountsFor(rows: ReadonlyArray<PurchaseListRow>, checkedIds: ReadonlySet<string>): PurchaseListProgressAmountSummary {
  const keys = purchaseListRowKeysFor(rows);
  let checkedTotalPriceWon = 0;
  let remainingTotalPriceWon = 0;
  let checkedPriceComplete = true;
  let remainingPriceComplete = true;
  let checkedRowCount = 0;
  let remainingRowCount = 0;
  rows.forEach((row, index) => {
    const isChecked = checkedIds.has(keys[index]!);
    if (isChecked) checkedRowCount += 1;
    else remainingRowCount += 1;
    if (row.totalPriceWon === undefined) {
      if (isChecked) checkedPriceComplete = false;
      else remainingPriceComplete = false;
      return;
    }
    if (isChecked) checkedTotalPriceWon += row.totalPriceWon;
    else remainingTotalPriceWon += row.totalPriceWon;
  });
  return { checkedTotalPriceWon, remainingTotalPriceWon, checkedPriceComplete, remainingPriceComplete, checkedRowCount, remainingRowCount };
}

export function purchaseListProgressAmountLabelFor(value: number, priceComplete: boolean, rowCount: number) {
  if (!priceComplete) return "가격 확인 필요";
  if (rowCount === 0) return "없음";
  return `${value.toLocaleString("ko-KR")}원`;
}

export function purchaseListBudgetSummaryFor(rows: ReadonlyArray<PurchaseListRow>, budgetWon: number | undefined): PurchaseListBudgetSummary | undefined {
  if (typeof budgetWon !== "number" || !Number.isInteger(budgetWon) || budgetWon <= 0) return undefined;
  const priceComplete = rows.every((row) => row.totalPriceWon !== undefined);
  const totalPriceWon = rows.reduce((total, row) => total + (row.totalPriceWon ?? 0), 0);
  const priceEvidenceReviewCount = rows.filter(purchaseListPriceEvidenceNeedsReviewFor).length;
  if (!priceComplete || priceEvidenceReviewCount > 0) return { budgetWon, totalPriceWon, priceComplete, ...(priceEvidenceReviewCount > 0 ? { priceEvidenceReviewCount } : {}) };
  const deltaWon = totalPriceWon - budgetWon;
  return { budgetWon, totalPriceWon, priceComplete, ...(priceEvidenceReviewCount > 0 ? { priceEvidenceReviewCount } : {}), deltaWon, withinBudget: deltaWon <= 0 };
}

export function purchaseListCheckedIdsToggle(checkedIds: ReadonlyArray<string>, rowKey: string, checked: boolean) {
  const next = new Set(checkedIds);
  if (checked) next.add(rowKey);
  else next.delete(rowKey);
  return Array.from(next).slice(0, PURCHASE_LIST_PROGRESS_MAX_CHECKED_IDS);
}

export function purchaseListProgressJsonFor(storageKey: string, rows: ReadonlyArray<PurchaseListRow>, checkedIds: ReadonlySet<string>, exportedAt = new Date().toISOString(), itemStates: ReadonlyArray<PurchaseListItemStatus> = []) {
  const rowKeys = purchaseListRowKeysFor(rows);
  const rowKeySet = new Set(rowKeys);
  const parsedItemStates = purchaseListItemStatusesFromUnknown(itemStates, rowKeys).items;
  const envelope: PurchaseListProgressTransferEnvelope = {
    type: "pc-supporter-purchase-list-progress",
    schemaVersion: 1,
    storageKey,
    exportedAt,
    rowKeys,
    checkedIds: purchaseListCheckedIdsForItemStatuses(rowKeys, parsedItemStates, Array.from(checkedIds).filter((id) => rowKeySet.has(id))).slice(0, PURCHASE_LIST_PROGRESS_MAX_CHECKED_IDS),
    ...(parsedItemStates.length > 0 ? { itemStates: parsedItemStates } : {})
  };
  return JSON.stringify(envelope, null, 2);
}

export function parsePurchaseListProgressJson(input: string, expectedStorageKey: string, rows: ReadonlyArray<PurchaseListRow>): PurchaseListProgressTransferParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return { checkedIds: [], ignoredIds: [], rowKeys: [], errors: ["구매 목록 진행률 JSON 형식이 올바르지 않습니다."] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { checkedIds: [], ignoredIds: [], rowKeys: [], errors: ["구매 목록 진행률 JSON은 객체여야 합니다."] };
  const candidate = parsed as Partial<PurchaseListProgressTransferEnvelope>;
  if (candidate.type !== "pc-supporter-purchase-list-progress" || candidate.schemaVersion !== 1) return { checkedIds: [], ignoredIds: [], rowKeys: [], errors: ["지원하지 않는 구매 목록 진행률 JSON 버전입니다."] };
  if (typeof candidate.storageKey !== "string" || candidate.storageKey !== expectedStorageKey) return { checkedIds: [], ignoredIds: [], rowKeys: [], errors: ["현재 견적과 다른 구매 목록입니다. 같은 견적에서 내보낸 JSON만 가져올 수 있습니다."] };
  if (typeof candidate.exportedAt !== "string" || candidate.exportedAt.length === 0 || candidate.exportedAt.length > 120 || !Number.isFinite(Date.parse(candidate.exportedAt))) return { checkedIds: [], ignoredIds: [], rowKeys: [], errors: ["구매 목록 진행률 JSON의 내보낸 시각이 올바르지 않습니다."] };
  if (!Array.isArray(candidate.rowKeys) || !Array.isArray(candidate.checkedIds)) return { checkedIds: [], ignoredIds: [], rowKeys: [], errors: ["구매 목록 진행률 JSON의 행 목록 형식이 올바르지 않습니다."] };
  const maxImportedRowKeys = Math.max(PURCHASE_LIST_PROGRESS_MAX_CHECKED_IDS, rows.length);
  if (candidate.rowKeys.length > maxImportedRowKeys) return { checkedIds: [], ignoredIds: [], rowKeys: [], errors: [`구매 목록 진행률 JSON의 행 목록은 현재 목록 기준 최대 ${maxImportedRowKeys}개까지 가져올 수 있습니다.`] };
  if (candidate.checkedIds.length > PURCHASE_LIST_PROGRESS_MAX_CHECKED_IDS) return { checkedIds: [], ignoredIds: [], rowKeys: [], errors: [`구매 목록 진행률 JSON의 완료 상태는 최대 ${PURCHASE_LIST_PROGRESS_MAX_CHECKED_IDS}개까지 가져올 수 있습니다.`] };
  if (!candidate.rowKeys.every((key) => typeof key === "string" && key.length > 0 && key.length <= 240) || !candidate.checkedIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 240)) return { checkedIds: [], ignoredIds: [], rowKeys: [], errors: ["구매 목록 진행률 JSON의 행 목록 형식이 올바르지 않습니다."] };
  const currentKeys = new Set(purchaseListRowKeysFor(rows));
  const rowKeys = uniqueIds(candidate.rowKeys as string[]);
  const incomingCheckedIds = uniqueIds(candidate.checkedIds as string[]);
  const parsedItemStates = purchaseListItemStatusesFromUnknown(candidate.itemStates, rowKeys);
  if (parsedItemStates.errors.length > 0) return { checkedIds: [], ignoredIds: [], rowKeys: [], exportedAt: candidate.exportedAt, errors: parsedItemStates.errors };
  return {
    checkedIds: purchaseListCheckedIdsForItemStatuses(rowKeys.filter((id) => currentKeys.has(id)), parsedItemStates.items.filter((item) => currentKeys.has(item.rowKey)), incomingCheckedIds.filter((id) => currentKeys.has(id))),
    ignoredIds: incomingCheckedIds.filter((id) => !currentKeys.has(id)),
    rowKeys,
    exportedAt: candidate.exportedAt,
    ...(parsedItemStates.items.length > 0 ? { itemStates: parsedItemStates.items.filter((item) => currentKeys.has(item.rowKey)) } : {}),
    errors: []
  };
}

export function purchaseListProgressTransferDiffFor(currentCheckedIds: ReadonlyArray<string>, incomingCheckedIds: ReadonlyArray<string>): PurchaseListProgressTransferDiff {
  const current = new Set(currentCheckedIds);
  const incoming = new Set(incomingCheckedIds);
  return {
    currentCheckedCount: current.size,
    incomingCheckedCount: incoming.size,
    addedCount: Array.from(incoming).filter((id) => !current.has(id)).length,
    removedCount: Array.from(current).filter((id) => !incoming.has(id)).length,
    unchangedCount: Array.from(incoming).filter((id) => current.has(id)).length
  };
}

export function purchaseListProgressTransferMatchesCurrentFor(currentRowKeys: ReadonlyArray<string>, incomingRowKeys: ReadonlyArray<string>) {
  const current = new Set(currentRowKeys);
  const incoming = new Set(incomingRowKeys);
  return current.size === incoming.size && Array.from(current).every((key) => incoming.has(key));
}

export function purchaseListProgressSyncComparisonFor(currentCheckedIds: ReadonlyArray<string>, serverCheckedIds: ReadonlyArray<string>): PurchaseListProgressSyncComparison {
  const currentChecked = normalizedCheckedIds(currentCheckedIds);
  const serverChecked = normalizedCheckedIds(serverCheckedIds);
  const current = new Set(currentChecked);
  const server = new Set(serverChecked);
  const localOnlyIds = currentChecked.filter((id) => !server.has(id));
  const serverOnlyIds = serverChecked.filter((id) => !current.has(id));
  const state: PurchaseListProgressSyncState = localOnlyIds.length === 0 && serverOnlyIds.length === 0
    ? "synced"
    : localOnlyIds.length > 0 && serverOnlyIds.length === 0
      ? "local-only"
      : localOnlyIds.length === 0 && serverOnlyIds.length > 0
        ? "server-only"
        : "diverged";
  return { state, currentCheckedIds: currentChecked, serverCheckedIds: serverChecked, localOnlyIds, serverOnlyIds, currentCheckedCount: currentChecked.length, serverCheckedCount: serverChecked.length };
}

export function purchaseListProgressRevisionDiffFor(from: SavedBuildPurchaseProgressSnapshot, to: SavedBuildPurchaseProgressSnapshot): PurchaseListProgressRevisionDiff {
  const fromIds = normalizedCheckedIds(from.checkedIds);
  const toIds = normalizedCheckedIds(to.checkedIds);
  const fromSet = new Set(fromIds);
  const toSet = new Set(toIds);
  const fromRowKeys = new Set(from.rowKeys);
  const explicitStatusKeys = new Set([...(from.itemStates ?? []).map((item) => item.rowKey), ...(to.itemStates ?? []).map((item) => item.rowKey)]);
  const statusChanges = [...new Set(to.rowKeys)].map((rowKey) => ({ rowKey, from: purchaseListItemStatusFor(from.itemStates ?? [], rowKey, fromSet), to: purchaseListItemStatusFor(to.itemStates ?? [], rowKey, toSet) })).filter(({ rowKey, from: fromStatus, to: toStatus }) => explicitStatusKeys.has(rowKey) && fromStatus !== toStatus);
  return {
    fromRevision: from.revision,
    toRevision: to.revision,
    addedIds: toIds.filter((id) => !fromSet.has(id)),
    removedIds: fromIds.filter((id) => !toSet.has(id)),
    unchangedIds: toIds.filter((id) => fromSet.has(id)),
    fromCheckedCount: fromIds.length,
    toCheckedCount: toIds.length,
    statusChanges: statusChanges.filter(({ rowKey }) => fromRowKeys.has(rowKey))
  };
}
