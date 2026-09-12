import type { SavedBuildPurchasePriceHistory, SavedBuildPurchasePriceHistorySnapshot } from "../shared/types";
import { isKnownPrice } from "../shared/types";
import { purchaseListPriceHistoryFromJson, PURCHASE_LIST_PRICE_HISTORY_SCHEMA_VERSION, PURCHASE_LIST_PRICE_HISTORY_TYPE } from "../shared/purchase-list-price-history";
import type { PurchaseListPriceHistory } from "../shared/purchase-list-price-history";

const MAX_ROW_KEYS = 100;
const MAX_KEY_LENGTH = 240;
const MAX_FINGERPRINT_LENGTH = 20_000;
const MAX_REVISION = 1_000_000_000;
const MAX_HISTORY = 20;
const MAX_SAMPLES = 20;

function boundedString(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : undefined;
}

function validRowKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_LENGTH && value !== "__proto__" && value !== "constructor" && value !== "prototype";
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function boundedRevision(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX_REVISION ? Number(value) : undefined;
}

function priceHistoryFromUnknown(value: unknown, rowKeySet: ReadonlySet<string>): PurchaseListPriceHistory | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_ROW_KEYS || entries.length === 0) return undefined;
  for (const [rowKey, observations] of entries) {
    if (!validRowKey(rowKey) || !rowKeySet.has(rowKey) || !Array.isArray(observations) || observations.length === 0 || observations.length > MAX_SAMPLES) return undefined;
    for (const observation of observations) {
      if (!observation || typeof observation !== "object" || Array.isArray(observation)) return undefined;
      const candidate = observation as { checkedAt?: unknown; unitPriceWon?: unknown };
      if (!boundedString(candidate.checkedAt, 120) || !Number.isFinite(Date.parse(candidate.checkedAt as string)) || !isKnownPrice(candidate.unitPriceWon as number)) return undefined;
    }
  }
  const parsed = purchaseListPriceHistoryFromJson(JSON.stringify({ type: PURCHASE_LIST_PRICE_HISTORY_TYPE, schemaVersion: PURCHASE_LIST_PRICE_HISTORY_SCHEMA_VERSION, savedAt: new Date(0).toISOString(), entries: entries.map(([rowKey, observations]) => ({ rowKey, observations })) }));
  return Object.keys(parsed).length === entries.length ? parsed : undefined;
}

function snapshotFromUnknown(value: unknown, allowLegacyRevision = true): SavedBuildPurchasePriceHistorySnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const inputFingerprint = boundedString(candidate.inputFingerprint, MAX_FINGERPRINT_LENGTH);
  const updatedAt = boundedString(candidate.updatedAt, 120);
  const revision = candidate.revision === undefined ? allowLegacyRevision ? 1 : undefined : boundedRevision(candidate.revision);
  if (!inputFingerprint || !updatedAt || !Number.isFinite(Date.parse(updatedAt)) || revision === undefined || !Array.isArray(candidate.rowKeys)) return undefined;
  if (candidate.rowKeys.length === 0 || candidate.rowKeys.length > MAX_ROW_KEYS || !candidate.rowKeys.every(validRowKey)) return undefined;
  const rowKeys = uniqueStrings(candidate.rowKeys as string[]);
  if (rowKeys.length !== candidate.rowKeys.length) return undefined;
  const priceHistory = priceHistoryFromUnknown(candidate.priceHistory, new Set(rowKeys));
  if (!priceHistory) return undefined;
  return { inputFingerprint, rowKeys, priceHistory, revision, updatedAt };
}

export function savedBuildPurchasePriceHistoryFromUnknown(value: unknown): SavedBuildPurchasePriceHistory | undefined {
  const snapshot = snapshotFromUnknown(value);
  if (!snapshot) return undefined;
  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.history) && candidate.history.length > MAX_HISTORY) return undefined;
  const history = Array.isArray(candidate.history)
    ? candidate.history
      .map((entry) => snapshotFromUnknown(entry))
      .filter((entry): entry is SavedBuildPurchasePriceHistorySnapshot => Boolean(entry))
      .filter((entry, index, entries) => entry.inputFingerprint === snapshot.inputFingerprint && entry.rowKeys.length === snapshot.rowKeys.length && entry.rowKeys.every((key) => snapshot.rowKeys.includes(key)) && entry.revision !== snapshot.revision && entries.findIndex((item) => item.revision === entry.revision) === index)
      .slice(0, MAX_HISTORY)
    : [];
  return history.length > 0 ? { ...snapshot, history } : snapshot;
}

export interface SavedBuildPurchasePriceHistoryParseResult {
  priceHistory?: SavedBuildPurchasePriceHistorySnapshot;
  errors: string[];
  fingerprintMismatch: boolean;
}

export function parseSavedBuildPurchasePriceHistory(input: unknown, expectedFingerprint: string, updatedAt = new Date().toISOString(), revision = 1): SavedBuildPurchasePriceHistoryParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { errors: ["가격 확인 이력 형식이 올바르지 않습니다."], fingerprintMismatch: false };
  const candidate = input as Record<string, unknown>;
  const inputFingerprint = boundedString(candidate.inputFingerprint, MAX_FINGERPRINT_LENGTH);
  if (!inputFingerprint || inputFingerprint !== expectedFingerprint) return { errors: ["현재 저장 견적과 다른 가격 확인 이력입니다."], fingerprintMismatch: true };
  if (!Array.isArray(candidate.rowKeys) || candidate.rowKeys.length === 0 || candidate.rowKeys.length > MAX_ROW_KEYS || !candidate.rowKeys.every(validRowKey)) return { errors: ["가격 확인 이력의 행 목록 형식이 올바르지 않습니다."], fingerprintMismatch: false };
  const rowKeys = uniqueStrings(candidate.rowKeys as string[]);
  if (rowKeys.length !== candidate.rowKeys.length) return { errors: ["가격 확인 이력에 중복 행 ID가 있습니다."], fingerprintMismatch: false };
  const priceHistory = priceHistoryFromUnknown(candidate.priceHistory, new Set(rowKeys));
  if (!priceHistory) return { errors: ["가격 확인 이력의 가격 샘플 형식이 올바르지 않습니다."], fingerprintMismatch: false };
  return { priceHistory: { inputFingerprint, rowKeys, priceHistory, revision, updatedAt }, errors: [], fingerprintMismatch: false };
}

export function parseSavedBuildPurchasePriceHistoryExpectedRevision(input: unknown) {
  if (input === undefined || input === null) return { revision: null as number | null, error: undefined as string | undefined };
  const revision = boundedRevision(input);
  return revision === undefined
    ? { revision: undefined as number | undefined, error: "expectedRevision이 올바르지 않습니다." }
    : { revision, error: undefined as string | undefined };
}

export function parseSavedBuildPurchasePriceHistoryRevision(input: unknown) {
  const revision = boundedRevision(input);
  return revision === undefined
    ? { revision: undefined as number | undefined, error: "복원할 가격 확인 이력 revision이 올바르지 않습니다." }
    : { revision, error: undefined as string | undefined };
}

export function savedBuildPurchasePriceHistoryRevisionMatchesFor(current: SavedBuildPurchasePriceHistory | undefined, expectedRevision: number | null) {
  return expectedRevision === null ? !current : current?.revision === expectedRevision;
}

export function savedBuildPurchasePriceHistoryHistoryTargetFor(current: SavedBuildPurchasePriceHistory | undefined, targetRevision: number) {
  return current?.history?.find((entry) => entry.revision === targetRevision);
}

function snapshotOnly(value: SavedBuildPurchasePriceHistory): SavedBuildPurchasePriceHistorySnapshot {
  const { history: _history, ...snapshot } = value;
  return snapshot;
}

export function savedBuildPurchasePriceHistoryWithNextRevisionFor(next: SavedBuildPurchasePriceHistorySnapshot, current: SavedBuildPurchasePriceHistory | undefined, updatedAt = new Date().toISOString()): SavedBuildPurchasePriceHistory {
  const nextSnapshot: SavedBuildPurchasePriceHistorySnapshot = { ...next, revision: (current?.revision ?? 0) + 1, updatedAt };
  const history = current ? [snapshotOnly(current), ...(current.history ?? [])].filter((entry, index, entries) => entry.revision !== nextSnapshot.revision && entries.findIndex((item) => item.revision === entry.revision) === index).slice(0, MAX_HISTORY) : [];
  return history.length > 0 ? { ...nextSnapshot, history } : nextSnapshot;
}
