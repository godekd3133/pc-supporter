import { catalogWatchlistEntriesFromJson } from "../shared/catalog-watchlist-import";
import type { CatalogWatchEntry } from "../shared/catalog-watchlist";
import { normalizeShareExpiryAt, shareExpired, shareExpiryDaysFrom, shareExpiryValueProvided } from "./share-lifecycle";

export const SAVED_WATCHLIST_ALERT_DROP_THRESHOLDS = [0, 1, 5] as const;
export type SavedWatchlistAlertDropThreshold = (typeof SAVED_WATCHLIST_ALERT_DROP_THRESHOLDS)[number];
export interface SavedWatchlistAlertPreferences {
  targetReached: boolean;
  priceDrop: boolean;
  priceAvailability: boolean;
  minimumDropPercent: SavedWatchlistAlertDropThreshold;
}

export const DEFAULT_SAVED_WATCHLIST_ALERT_PREFERENCES: SavedWatchlistAlertPreferences = {
  targetReached: true,
  priceDrop: true,
  priceAvailability: true,
  minimumDropPercent: 0
};

export interface SavedCatalogWatchlist {
  id: string;
  name: string;
  entries: CatalogWatchEntry[];
  nearLowThresholdPercent: 5 | 10 | 20;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  alertPreferences?: SavedWatchlistAlertPreferences;
}

export interface SavedCatalogWatchlistInput {
  name?: unknown;
  entries?: unknown;
  nearLowThresholdPercent?: unknown;
  expiresInDays?: unknown;
  alertPreferences?: unknown;
}

export interface SavedCatalogWatchlistInputResult {
  name?: string;
  entries: CatalogWatchEntry[];
  nearLowThresholdPercent?: 5 | 10 | 20;
  expiresInDays?: 7 | 30;
  alertPreferences?: SavedWatchlistAlertPreferences;
  errors: string[];
}

function thresholdFrom(value: unknown) {
  return value === 5 || value === 10 || value === 20 ? value : undefined;
}

function alertPreferencesFrom(value: unknown): { value?: SavedWatchlistAlertPreferences; valid: boolean } {
  if (value === undefined || value === null) return { valid: true };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false };
  const candidate = value as Partial<SavedWatchlistAlertPreferences>;
  const targetReached = candidate.targetReached === undefined ? true : candidate.targetReached;
  const priceDrop = candidate.priceDrop === undefined ? true : candidate.priceDrop;
  const priceAvailability = candidate.priceAvailability === undefined ? true : candidate.priceAvailability;
  const minimumDropPercent = candidate.minimumDropPercent === undefined ? 0 : candidate.minimumDropPercent;
  if (typeof targetReached !== "boolean" || typeof priceDrop !== "boolean" || typeof priceAvailability !== "boolean" || !SAVED_WATCHLIST_ALERT_DROP_THRESHOLDS.includes(minimumDropPercent as SavedWatchlistAlertDropThreshold)) return { valid: false };
  return { value: { targetReached, priceDrop, priceAvailability, minimumDropPercent: minimumDropPercent as SavedWatchlistAlertDropThreshold }, valid: true };
}

export function savedWatchlistAlertPreferencesFromUnknown(value: unknown): SavedWatchlistAlertPreferences {
  return alertPreferencesFrom(value).value ?? DEFAULT_SAVED_WATCHLIST_ALERT_PREFERENCES;
}

export function savedWatchlistAlertPreferencesFor(watchlist: Pick<SavedCatalogWatchlist, "alertPreferences">): SavedWatchlistAlertPreferences {
  return savedWatchlistAlertPreferencesFromUnknown(watchlist.alertPreferences);
}

export function parseSavedCatalogWatchlistInput(input: unknown): SavedCatalogWatchlistInputResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { entries: [], errors: ["관심 가격 목록 저장 형식이 올바르지 않습니다."] };
  const candidate = input as SavedCatalogWatchlistInput;
  const name = typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim().slice(0, 60) : "관심 가격 목록";
  const expiresInDays = shareExpiryDaysFrom(candidate.expiresInDays);
  if (shareExpiryValueProvided(candidate.expiresInDays) && expiresInDays === undefined) return { name, entries: [], errors: ["공유 링크 유효기간은 무기한, 7일, 30일 중 하나여야 합니다."] };
  const alertPreferences = alertPreferencesFrom(candidate.alertPreferences);
  if (!alertPreferences.valid) return { name, entries: [], errors: ["가격 알림 설정 형식이 올바르지 않습니다."] };
  if (!Array.isArray(candidate.entries) || candidate.entries.length === 0) return { name, entries: [], errors: ["저장할 관심 가격 항목이 없습니다."] };
  const parsedEntries = catalogWatchlistEntriesFromJson(JSON.stringify(candidate.entries));
  if (parsedEntries.errors.length > 0 || parsedEntries.entries.length === 0) return { name, entries: [], errors: parsedEntries.errors.length > 0 ? parsedEntries.errors : ["관심 가격 항목을 확인할 수 없습니다."] };
  const threshold = thresholdFrom(candidate.nearLowThresholdPercent);
  if (threshold === undefined) return { name, entries: [], errors: ["최저가 근접 기준은 5, 10, 20 중 하나여야 합니다."] };
  return { name, entries: parsedEntries.entries, nearLowThresholdPercent: threshold, ...(expiresInDays !== undefined ? { expiresInDays } : {}), ...(alertPreferences.value ? { alertPreferences: alertPreferences.value } : {}), errors: [] };
}

export function parseSavedCatalogWatchlistUpdateInput(watchlist: SavedCatalogWatchlist, input: unknown): SavedCatalogWatchlistInputResult & { expiresInDaysProvided: boolean } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { entries: [], expiresInDaysProvided: false, errors: ["관심 가격 목록 수정 형식이 올바르지 않습니다."] };
  const candidate = input as Record<string, unknown>;
  const expiresInDaysProvided = Object.prototype.hasOwnProperty.call(candidate, "expiresInDays");
  const updateInput: SavedCatalogWatchlistInput = {
    name: Object.prototype.hasOwnProperty.call(candidate, "name") ? candidate.name : watchlist.name,
    entries: Object.prototype.hasOwnProperty.call(candidate, "entries") ? candidate.entries : watchlist.entries,
    nearLowThresholdPercent: Object.prototype.hasOwnProperty.call(candidate, "nearLowThresholdPercent") ? candidate.nearLowThresholdPercent : watchlist.nearLowThresholdPercent,
    alertPreferences: Object.prototype.hasOwnProperty.call(candidate, "alertPreferences") ? candidate.alertPreferences : savedWatchlistAlertPreferencesFor(watchlist)
  };
  if (expiresInDaysProvided) updateInput.expiresInDays = candidate.expiresInDays;
  return { ...parseSavedCatalogWatchlistInput(updateInput), expiresInDaysProvided };
}

export function savedCatalogWatchlistFromUnknown(value: unknown): SavedCatalogWatchlist | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<SavedCatalogWatchlist>;
  const parsed = parseSavedCatalogWatchlistInput(candidate);
  const expiresAt = normalizeShareExpiryAt(candidate.expiresAt);
  if (parsed.errors.length > 0 || !candidate.id || typeof candidate.id !== "string" || !candidate.createdAt || typeof candidate.createdAt !== "string" || !candidate.updatedAt || typeof candidate.updatedAt !== "string" || !parsed.name || parsed.nearLowThresholdPercent === undefined || !expiresAt.valid) return undefined;
  return { id: candidate.id, name: parsed.name, entries: parsed.entries, nearLowThresholdPercent: parsed.nearLowThresholdPercent, createdAt: candidate.createdAt, updatedAt: candidate.updatedAt, ...(expiresAt.value !== undefined ? { expiresAt: expiresAt.value } : {}), ...(parsed.alertPreferences ? { alertPreferences: parsed.alertPreferences } : {}) };
}

export function savedCatalogWatchlistExpired(watchlist: Pick<SavedCatalogWatchlist, "expiresAt">, now = Date.now()) {
  return shareExpired(watchlist.expiresAt, now);
}
