import type { SavedBuildPurchaseProgress, SavedBuildPurchaseProgressSnapshot } from "../shared/types";
import { purchaseListItemStatusesFromUnknown, purchaseListItemStatusIsPurchased } from "../shared/purchase-list-status";

const MAX_ROW_KEYS = 100;
const MAX_KEY_LENGTH = 240;
const MAX_FINGERPRINT_LENGTH = 20_000;
const MAX_REVISION = 1_000_000_000;
const MAX_HISTORY = 20;

function boundedString(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : undefined;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function boundedRevision(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX_REVISION ? Number(value) : undefined;
}

function snapshotFromUnknown(value: unknown, allowLegacyRevision = true): SavedBuildPurchaseProgressSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const inputFingerprint = boundedString(candidate.inputFingerprint, MAX_FINGERPRINT_LENGTH);
  const updatedAt = boundedString(candidate.updatedAt, 120);
  const revision = candidate.revision === undefined ? allowLegacyRevision ? 1 : undefined : boundedRevision(candidate.revision);
  if (!inputFingerprint || !updatedAt || !Number.isFinite(Date.parse(updatedAt)) || revision === undefined || !Array.isArray(candidate.rowKeys) || !Array.isArray(candidate.checkedIds)) return undefined;
  if (candidate.rowKeys.length > MAX_ROW_KEYS || candidate.checkedIds.length > MAX_ROW_KEYS) return undefined;
  if (!candidate.rowKeys.every((key) => typeof key === "string" && key.length > 0 && key.length <= MAX_KEY_LENGTH) || !candidate.checkedIds.every((key) => typeof key === "string" && key.length > 0 && key.length <= MAX_KEY_LENGTH)) return undefined;
  const rowKeys = uniqueStrings(candidate.rowKeys as string[]);
  const incomingCheckedIds = uniqueStrings(candidate.checkedIds as string[]);
  const rowKeySet = new Set(rowKeys);
  if (incomingCheckedIds.some((id) => !rowKeySet.has(id))) return undefined;
  const parsedItemStates = purchaseListItemStatusesFromUnknown(candidate.itemStates, rowKeys);
  if (parsedItemStates.errors.length > 0) return undefined;
  const incomingCheckedSet = new Set(incomingCheckedIds);
  const stateByRowKey = new Map(parsedItemStates.items.map((item) => [item.rowKey, item.status]));
  const checkedIds = rowKeys.filter((rowKey) => stateByRowKey.has(rowKey) ? purchaseListItemStatusIsPurchased(stateByRowKey.get(rowKey)!) : incomingCheckedSet.has(rowKey));
  return { inputFingerprint, rowKeys, checkedIds, revision, updatedAt, ...(parsedItemStates.items.length > 0 ? { itemStates: parsedItemStates.items } : {}) };
}

export function savedBuildPurchaseProgressFromUnknown(value: unknown): SavedBuildPurchaseProgress | undefined {
  const snapshot = snapshotFromUnknown(value);
  if (!snapshot) return undefined;
  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.history) && candidate.history.length > MAX_HISTORY) return undefined;
  const history = Array.isArray(candidate.history)
    ? candidate.history
      .map((entry) => snapshotFromUnknown(entry))
      .filter((entry): entry is SavedBuildPurchaseProgressSnapshot => Boolean(entry))
      .filter((entry, index, entries) => entry.revision !== snapshot.revision && entries.findIndex((item) => item.revision === entry.revision) === index)
      .slice(0, MAX_HISTORY)
    : [];
  return history.length > 0 ? { ...snapshot, history } : snapshot;
}

export interface SavedBuildPurchaseProgressParseResult {
  progress?: SavedBuildPurchaseProgress;
  errors: string[];
  fingerprintMismatch: boolean;
}

export function parseSavedBuildPurchaseProgress(input: unknown, expectedFingerprint: string, updatedAt = new Date().toISOString(), revision = 1): SavedBuildPurchaseProgressParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { errors: ["구매 진행률 형식이 올바르지 않습니다."], fingerprintMismatch: false };
  const candidate = input as Record<string, unknown>;
  const inputFingerprint = boundedString(candidate.inputFingerprint, MAX_FINGERPRINT_LENGTH);
  if (!inputFingerprint || inputFingerprint !== expectedFingerprint) return { errors: ["현재 저장 견적과 다른 구매 진행률입니다."], fingerprintMismatch: true };
  if (!Array.isArray(candidate.rowKeys) || !Array.isArray(candidate.checkedIds)) return { errors: ["구매 진행률의 행 목록 형식이 올바르지 않습니다."], fingerprintMismatch: false };
  if (candidate.rowKeys.length === 0 || candidate.rowKeys.length > MAX_ROW_KEYS || candidate.checkedIds.length > MAX_ROW_KEYS) return { errors: ["구매 진행률 행 수가 올바르지 않습니다."], fingerprintMismatch: false };
  if (!candidate.rowKeys.every((key) => typeof key === "string" && key.length > 0 && key.length <= MAX_KEY_LENGTH) || !candidate.checkedIds.every((key) => typeof key === "string" && key.length > 0 && key.length <= MAX_KEY_LENGTH)) return { errors: ["구매 진행률의 행 ID 형식이 올바르지 않습니다."], fingerprintMismatch: false };
  const rowKeys = uniqueStrings(candidate.rowKeys as string[]);
  const incomingCheckedIds = uniqueStrings(candidate.checkedIds as string[]);
  if (rowKeys.length !== candidate.rowKeys.length || incomingCheckedIds.length !== candidate.checkedIds.length) return { errors: ["구매 진행률에 중복 행 ID가 있습니다."], fingerprintMismatch: false };
  const rowKeySet = new Set(rowKeys);
  if (incomingCheckedIds.some((id) => !rowKeySet.has(id))) return { errors: ["구매 완료 행이 현재 구매 목록에 없습니다."], fingerprintMismatch: false };
  const parsedItemStates = purchaseListItemStatusesFromUnknown(candidate.itemStates, rowKeys);
  if (parsedItemStates.errors.length > 0) return { errors: parsedItemStates.errors, fingerprintMismatch: false };
  const incomingCheckedSet = new Set(incomingCheckedIds);
  const stateByRowKey = new Map(parsedItemStates.items.map((item) => [item.rowKey, item.status]));
  const checkedIds = rowKeys.filter((rowKey) => stateByRowKey.has(rowKey) ? purchaseListItemStatusIsPurchased(stateByRowKey.get(rowKey)!) : incomingCheckedSet.has(rowKey));
  return { progress: { inputFingerprint, rowKeys, checkedIds, revision, updatedAt, ...(parsedItemStates.items.length > 0 ? { itemStates: parsedItemStates.items } : {}) }, errors: [], fingerprintMismatch: false };
}

export function parseSavedBuildPurchaseProgressRevision(input: unknown) {
  const revision = boundedRevision(input);
  return revision === undefined
    ? { revision: undefined as number | undefined, error: "복원할 구매 진행률 revision이 올바르지 않습니다." }
    : { revision, error: undefined as string | undefined };
}

export function parseSavedBuildPurchaseProgressExpectedRevision(input: unknown) {
  if (input === undefined || input === null) return { revision: null as number | null, error: undefined as string | undefined };
  const revision = Number.isInteger(input) && Number(input) >= 0 && Number(input) <= MAX_REVISION ? Number(input) : undefined;
  return revision === undefined
    ? { revision: null as number | null, error: "구매 진행률의 expectedRevision이 올바르지 않습니다." }
    : { revision, error: undefined as string | undefined };
}

export function savedBuildPurchaseProgressRevisionFor(progress: SavedBuildPurchaseProgress | undefined) {
  return progress?.revision ?? 0;
}

export function savedBuildPurchaseProgressRevisionMatchesFor(progress: SavedBuildPurchaseProgress | undefined, expectedRevision: number | null | undefined) {
  return savedBuildPurchaseProgressRevisionFor(progress) === (expectedRevision ?? 0);
}

export function savedBuildPurchaseProgressHistoryTargetFor(progress: SavedBuildPurchaseProgress | undefined, revision: number) {
  return progress?.history?.find((entry) => entry.revision === revision);
}

function snapshotOnly(progress: SavedBuildPurchaseProgress): SavedBuildPurchaseProgressSnapshot {
  const { history: _history, ...snapshot } = progress;
  return snapshot;
}

export function savedBuildPurchaseProgressWithNextRevisionFor(progress: SavedBuildPurchaseProgressSnapshot, current: SavedBuildPurchaseProgress | undefined, updatedAt = new Date().toISOString()): SavedBuildPurchaseProgress {
  const nextRevision = Math.min(MAX_REVISION, savedBuildPurchaseProgressRevisionFor(current) + 1);
  const history = current
    ? [snapshotOnly(current), ...(current.history ?? [])]
      .filter((entry, index, entries) => entries.findIndex((item) => item.revision === entry.revision) === index)
      .slice(0, MAX_HISTORY)
    : [];
  return history.length > 0 ? { ...progress, revision: nextRevision, updatedAt, history } : { ...progress, revision: nextRevision, updatedAt };
}
