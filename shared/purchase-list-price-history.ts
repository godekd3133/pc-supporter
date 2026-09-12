import { isKnownPrice } from "./types";

export const PURCHASE_LIST_PRICE_HISTORY_TYPE = "pc-supporter-purchase-price-history" as const;
export const PURCHASE_LIST_PRICE_HISTORY_SCHEMA_VERSION = 1 as const;
export const PURCHASE_LIST_PRICE_HISTORY_MAX_ROWS = 100;
export const PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES = 20;

export interface PurchaseListPriceObservation {
  checkedAt: string;
  unitPriceWon: number;
}

export type PurchaseListPriceHistory = Record<string, PurchaseListPriceObservation[]>;

export interface PurchaseListPriceHistoryEntry {
  rowKey: string;
  observations: PurchaseListPriceObservation[];
}

export interface PurchaseListPriceHistoryExportEnvelope {
  type: typeof PURCHASE_LIST_PRICE_HISTORY_TYPE;
  schemaVersion: typeof PURCHASE_LIST_PRICE_HISTORY_SCHEMA_VERSION;
  savedAt: string;
  entries: PurchaseListPriceHistoryEntry[];
}

export interface PurchaseListPriceHistorySummary {
  sampleCount: number;
  latestUnitPriceWon?: number;
  previousUnitPriceWon?: number;
  deltaFromPreviousWon?: number;
  minUnitPriceWon?: number;
  maxUnitPriceWon?: number;
  firstCheckedAt?: string;
  lastCheckedAt?: string;
}

export type PurchaseListPriceHistoryDisplayTone = "single" | "increased" | "decreased" | "same";

export interface PurchaseListPriceHistoryDisplay {
  tone: PurchaseListPriceHistoryDisplayTone;
  label: string;
}

function validCheckedAt(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function normalizeObservations(value: unknown, maxSamples: number) {
  if (!Array.isArray(value)) return [];
  const byTimestamp = new Map<string, PurchaseListPriceObservation>();
  const boundedCandidates = value.length > maxSamples ? value.slice(-maxSamples) : value;
  boundedCandidates.forEach((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
    const observation = candidate as Partial<PurchaseListPriceObservation>;
    if (!validCheckedAt(observation.checkedAt) || !isKnownPrice(observation.unitPriceWon)) return;
    byTimestamp.set(observation.checkedAt, { checkedAt: observation.checkedAt, unitPriceWon: observation.unitPriceWon });
  });
  return [...byTimestamp.values()].sort((left, right) => left.checkedAt.localeCompare(right.checkedAt)).slice(-maxSamples);
}

function safeLimit(value: number | undefined, fallback: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(value!)));
}

export function purchaseListPriceHistoryFromJson(raw: string | null, maxRows = PURCHASE_LIST_PRICE_HISTORY_MAX_ROWS, maxSamples = PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES): PurchaseListPriceHistory {
  if (!raw) return {};
  const rowLimit = safeLimit(maxRows, PURCHASE_LIST_PRICE_HISTORY_MAX_ROWS, PURCHASE_LIST_PRICE_HISTORY_MAX_ROWS);
  const sampleLimit = safeLimit(maxSamples, PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES, PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const envelope = parsed as Partial<PurchaseListPriceHistoryExportEnvelope>;
    if (envelope.type !== PURCHASE_LIST_PRICE_HISTORY_TYPE || envelope.schemaVersion !== PURCHASE_LIST_PRICE_HISTORY_SCHEMA_VERSION || !Array.isArray(envelope.entries) || envelope.entries.length > rowLimit) return {};
    const history: PurchaseListPriceHistory = {};
    envelope.entries.forEach((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.rowKey !== "string" || entry.rowKey.length === 0 || history[entry.rowKey]) return;
      const observations = normalizeObservations(entry.observations, sampleLimit);
      if (observations.length > 0) history[entry.rowKey] = observations;
      if (Object.keys(history).length >= rowLimit) return;
    });
    return history;
  } catch {
    return {};
  }
}

export function purchaseListPriceHistoryToJson(history: PurchaseListPriceHistory, savedAt = new Date().toISOString()): string {
  const entries = Object.entries(history).slice(0, PURCHASE_LIST_PRICE_HISTORY_MAX_ROWS).map(([rowKey, observations]) => ({
    rowKey,
    observations: normalizeObservations(observations, PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES)
  })).filter((entry) => entry.observations.length > 0);
  const envelope: PurchaseListPriceHistoryExportEnvelope = {
    type: PURCHASE_LIST_PRICE_HISTORY_TYPE,
    schemaVersion: PURCHASE_LIST_PRICE_HISTORY_SCHEMA_VERSION,
    savedAt,
    entries
  };
  return JSON.stringify(envelope);
}

export function purchaseListPriceHistoryRecordFor(history: PurchaseListPriceHistory, prices: Readonly<Record<string, number | undefined>>, checkedAt: string, maxSamples = PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES): PurchaseListPriceHistory {
  if (!validCheckedAt(checkedAt)) return history;
  const sampleLimit = safeLimit(maxSamples, PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES, PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES);
  const next: PurchaseListPriceHistory = Object.fromEntries(Object.entries(history).map(([rowKey, observations]) => [rowKey, observations.slice()]));
  for (const [rowKey, unitPriceWon] of Object.entries(prices)) {
    if (!rowKey || !isKnownPrice(unitPriceWon)) continue;
    const observations = normalizeObservations(next[rowKey] ?? [], sampleLimit).filter((observation) => observation.checkedAt !== checkedAt);
    next[rowKey] = [...observations, { checkedAt, unitPriceWon }].sort((left, right) => left.checkedAt.localeCompare(right.checkedAt)).slice(-sampleLimit);
  }
  return next;
}

export function purchaseListPriceHistorySummaryFor(history: PurchaseListPriceHistory, rowKey: string): PurchaseListPriceHistorySummary {
  const observations = normalizeObservations(history[rowKey], PURCHASE_LIST_PRICE_HISTORY_MAX_SAMPLES);
  const latest = observations.at(-1);
  const previous = observations.at(-2);
  const values = observations.map((observation) => observation.unitPriceWon);
  return {
    sampleCount: observations.length,
    ...(latest ? { latestUnitPriceWon: latest.unitPriceWon, lastCheckedAt: latest.checkedAt } : {}),
    ...(previous ? { previousUnitPriceWon: previous.unitPriceWon, deltaFromPreviousWon: latest!.unitPriceWon - previous.unitPriceWon } : {}),
    ...(values.length > 0 ? { minUnitPriceWon: Math.min(...values), maxUnitPriceWon: Math.max(...values), firstCheckedAt: observations[0]!.checkedAt } : {})
  };
}

export function purchaseListPriceHistoryDisplayFor(summary: PurchaseListPriceHistorySummary): PurchaseListPriceHistoryDisplay | undefined {
  if (summary.sampleCount === 0) return undefined;
  if (summary.sampleCount < 2 || summary.deltaFromPreviousWon === undefined) return { tone: "single", label: `내 확인 ${summary.sampleCount}회` };
  if (summary.deltaFromPreviousWon > 0) return { tone: "increased", label: `이전 확인 대비 +${summary.deltaFromPreviousWon.toLocaleString("ko-KR")}원` };
  if (summary.deltaFromPreviousWon < 0) return { tone: "decreased", label: `이전 확인 대비 ${summary.deltaFromPreviousWon.toLocaleString("ko-KR")}원` };
  return { tone: "same", label: "이전 확인과 동일" };
}
