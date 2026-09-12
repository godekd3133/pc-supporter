import { purchaseListRowKeysFor } from "./purchase-list-progress";
import type { PurchaseListRow } from "./purchase-list";
import { purchaseListPriceHistoryFromJson, purchaseListPriceHistoryRecordFor, purchaseListPriceHistoryToJson, PURCHASE_LIST_PRICE_HISTORY_MAX_ROWS, PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES, PURCHASE_LIST_PRICE_HISTORY_SCHEMA_VERSION, PURCHASE_LIST_PRICE_HISTORY_TYPE } from "./purchase-list-price-history";
import type { PurchaseListPriceHistory, PurchaseListPriceHistoryEntry } from "./purchase-list-price-history";

export const PURCHASE_LIST_PRICE_HISTORY_TRANSFER_TYPE = "pc-supporter-purchase-list-price-history" as const;
export const PURCHASE_LIST_PRICE_HISTORY_TRANSFER_SCHEMA_VERSION = 1 as const;

export interface PurchaseListPriceHistoryTransferEnvelope {
  type: typeof PURCHASE_LIST_PRICE_HISTORY_TRANSFER_TYPE;
  schemaVersion: typeof PURCHASE_LIST_PRICE_HISTORY_TRANSFER_SCHEMA_VERSION;
  storageKey: string;
  exportedAt: string;
  rowKeys: string[];
  history: PurchaseListPriceHistoryEntry[];
}

export interface PurchaseListPriceHistoryTransferParseResult {
  history: PurchaseListPriceHistory;
  rowKeys: string[];
  ignoredRowKeys: string[];
  exportedAt?: string;
  errors: string[];
}

export interface PurchaseListPriceHistoryTransferDiff {
  currentRowCount: number;
  incomingRowCount: number;
  sharedRowCount: number;
  incomingOnlyRowCount: number;
  currentObservationCount: number;
  incomingObservationCount: number;
  newObservationCount: number;
  mergedObservationCount: number;
}

function uniqueStrings(values: unknown) {
  return Array.from(new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 240) : []));
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && Number.isFinite(Date.parse(value));
}

function emptyParseResult(errors: string[]): PurchaseListPriceHistoryTransferParseResult {
  return { history: {}, rowKeys: [], ignoredRowKeys: [], errors };
}

function historyEntriesFromJson(history: PurchaseListPriceHistory, exportedAt: string) {
  const local = JSON.parse(purchaseListPriceHistoryToJson(history, exportedAt)) as { entries?: unknown };
  return Array.isArray(local.entries) ? local.entries as PurchaseListPriceHistoryEntry[] : [];
}

export function purchaseListPriceHistoryTransferJsonFor(storageKey: string, rows: ReadonlyArray<PurchaseListRow>, history: PurchaseListPriceHistory, exportedAt = new Date().toISOString()) {
  const envelope: PurchaseListPriceHistoryTransferEnvelope = {
    type: PURCHASE_LIST_PRICE_HISTORY_TRANSFER_TYPE,
    schemaVersion: PURCHASE_LIST_PRICE_HISTORY_TRANSFER_SCHEMA_VERSION,
    storageKey,
    exportedAt,
    rowKeys: purchaseListRowKeysFor(rows),
    history: historyEntriesFromJson(history, exportedAt)
  };
  return JSON.stringify(envelope, null, 2);
}

export function parsePurchaseListPriceHistoryTransferJson(input: string, expectedStorageKey: string, rows: ReadonlyArray<PurchaseListRow>): PurchaseListPriceHistoryTransferParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return emptyParseResult(["가격 확인 기록 JSON 형식이 올바르지 않습니다."]);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyParseResult(["가격 확인 기록 JSON은 객체여야 합니다."]);
  const candidate = parsed as Partial<PurchaseListPriceHistoryTransferEnvelope>;
  if (candidate.type !== PURCHASE_LIST_PRICE_HISTORY_TRANSFER_TYPE || candidate.schemaVersion !== PURCHASE_LIST_PRICE_HISTORY_TRANSFER_SCHEMA_VERSION) return emptyParseResult(["지원하지 않는 가격 확인 기록 JSON 버전입니다."]);
  if (typeof candidate.storageKey !== "string" || candidate.storageKey !== expectedStorageKey) return emptyParseResult(["현재 견적과 다른 가격 확인 기록입니다. 같은 견적에서 내보낸 JSON만 가져올 수 있습니다."]);
  if (!validDate(candidate.exportedAt)) return emptyParseResult(["가격 확인 기록 JSON의 내보낸 시각이 올바르지 않습니다."]);
  if (!Array.isArray(candidate.rowKeys) || !Array.isArray(candidate.history)) return emptyParseResult(["가격 확인 기록 JSON의 행 목록 형식이 올바르지 않습니다."]);
  if (candidate.rowKeys.length > PURCHASE_LIST_PRICE_HISTORY_MAX_ROWS || candidate.history.length > PURCHASE_LIST_PRICE_HISTORY_MAX_ROWS) return emptyParseResult([`가격 확인 기록 JSON은 최대 ${PURCHASE_LIST_PRICE_HISTORY_MAX_ROWS}개 행과 각 행 ${PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES}개 관측값까지 지원합니다.`]);
  if (!candidate.rowKeys.every((key) => typeof key === "string" && key.length > 0 && key.length <= 240)) return emptyParseResult(["가격 확인 기록 JSON의 행 목록 형식이 올바르지 않습니다."]);
  const rowKeys = uniqueStrings(candidate.rowKeys);
  const rawHistory = candidate.history as unknown[];
  if (!rawHistory.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const candidateEntry = entry as { rowKey?: unknown; observations?: unknown };
    return typeof candidateEntry.rowKey === "string"
      && candidateEntry.rowKey.length > 0
      && Array.isArray(candidateEntry.observations)
      && candidateEntry.observations.length <= PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES;
  })) return emptyParseResult(["가격 확인 기록 JSON의 기록 항목 형식이 올바르지 않습니다."]);
  const localPayload = { type: PURCHASE_LIST_PRICE_HISTORY_TYPE, schemaVersion: PURCHASE_LIST_PRICE_HISTORY_SCHEMA_VERSION, savedAt: candidate.exportedAt, entries: rawHistory };
  const parsedHistory = purchaseListPriceHistoryFromJson(JSON.stringify(localPayload));
  const currentKeys = new Set(purchaseListRowKeysFor(rows));
  const ignoredRowKeys = Object.keys(parsedHistory).filter((rowKey) => !currentKeys.has(rowKey));
  const history = Object.fromEntries(Object.entries(parsedHistory).filter(([rowKey]) => currentKeys.has(rowKey)));
  return { history, rowKeys, ignoredRowKeys, exportedAt: candidate.exportedAt, errors: [] };
}

export function purchaseListPriceHistoryTransferMatchesCurrentFor(currentRowKeys: ReadonlyArray<string>, incomingRowKeys: ReadonlyArray<string>) {
  const current = new Set(currentRowKeys);
  const incoming = new Set(incomingRowKeys);
  return current.size === incoming.size && [...current].every((rowKey) => incoming.has(rowKey));
}

export function purchaseListPriceHistoryMergeFor(current: PurchaseListPriceHistory, incoming: PurchaseListPriceHistory, maxSamples = PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES) {
  let merged: PurchaseListPriceHistory = Object.fromEntries(Object.entries(current).map(([rowKey, observations]) => [rowKey, observations.slice()]));
  Object.entries(incoming).forEach(([rowKey, observations]) => {
    observations.forEach((observation) => {
      merged = purchaseListPriceHistoryRecordFor(merged, { [rowKey]: observation.unitPriceWon }, observation.checkedAt, maxSamples);
    });
  });
  return merged;
}

function observationIdentity(rowKey: string, checkedAt: string, unitPriceWon: number) {
  return `${rowKey}\u0000${checkedAt}\u0000${unitPriceWon}`;
}

function observationCount(history: PurchaseListPriceHistory) {
  return Object.values(history).reduce((total, observations) => total + observations.length, 0);
}

export function purchaseListPriceHistoryTransferDiffFor(current: PurchaseListPriceHistory, incoming: PurchaseListPriceHistory, maxSamples = PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES): PurchaseListPriceHistoryTransferDiff {
  const currentKeys = new Set(Object.keys(current));
  const incomingKeys = new Set(Object.keys(incoming));
  const currentObservations = new Set(Object.entries(current).flatMap(([rowKey, observations]) => observations.map((observation) => observationIdentity(rowKey, observation.checkedAt, observation.unitPriceWon))));
  const incomingObservationCount = observationCount(incoming);
  const merged = purchaseListPriceHistoryMergeFor(current, incoming, maxSamples);
  return {
    currentRowCount: currentKeys.size,
    incomingRowCount: incomingKeys.size,
    sharedRowCount: [...incomingKeys].filter((rowKey) => currentKeys.has(rowKey)).length,
    incomingOnlyRowCount: [...incomingKeys].filter((rowKey) => !currentKeys.has(rowKey)).length,
    currentObservationCount: observationCount(current),
    incomingObservationCount,
    newObservationCount: Object.entries(incoming).reduce((total, [rowKey, observations]) => total + observations.filter((observation) => !currentObservations.has(observationIdentity(rowKey, observation.checkedAt, observation.unitPriceWon))).length, 0),
    mergedObservationCount: observationCount(merged)
  };
}
