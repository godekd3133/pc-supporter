import { catalogWatchlistFromJson } from "./catalog-watchlist";
import type { CatalogWatchEntry } from "./catalog-watchlist";

export interface CatalogWatchlistShareBuild {
  hash: string;
  sharedEntries: CatalogWatchEntry[];
  truncatedCount: number;
}

export interface CatalogWatchlistShareReadResult {
  entries: CatalogWatchEntry[];
  nearLowThresholdPercent?: 5 | 10 | 20;
  errors: string[];
}

const SHARE_VERSION = 1;
export const CATALOG_WATCHLIST_SHARE_MAX_ENTRIES = 12;

function thresholdFrom(value: unknown) {
  return value === 5 || value === 10 || value === 20 ? value : undefined;
}

function validEntry(value: unknown): value is CatalogWatchEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CatalogWatchEntry>;
  return typeof entry.itemId === "string" && entry.itemId.length > 0
    && typeof entry.itemName === "string" && entry.itemName.length > 0
    && typeof entry.category === "string" && entry.category.length > 0
    && (entry.kind === "part" || entry.kind === "accessory")
    && typeof entry.addedAt === "string" && entry.addedAt.length > 0
    && (entry.targetPriceWon === undefined || (typeof entry.targetPriceWon === "number" && Number.isFinite(entry.targetPriceWon) && entry.targetPriceWon > 0));
}

export function catalogWatchlistShareHashFor(entries: CatalogWatchEntry[], nearLowThresholdPercent: 5 | 10 | 20, limit = 12): CatalogWatchlistShareBuild {
  const safeLimit = Math.min(CATALOG_WATCHLIST_SHARE_MAX_ENTRIES, Math.max(1, Math.floor(limit)));
  const sharedEntries = entries.slice(0, safeLimit);
  const payload = { version: SHARE_VERSION, nearLowThresholdPercent, entries: sharedEntries };
  return { hash: `#watchlist=${encodeURIComponent(JSON.stringify(payload))}`, sharedEntries, truncatedCount: Math.max(0, entries.length - sharedEntries.length) };
}

export function catalogWatchlistSharePayloadFromHash(hash: string): CatalogWatchlistShareReadResult {
  const match = hash.match(/(?:^#|&)watchlist=([^&]+)/);
  if (!match) return { entries: [], errors: [] };
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(match[1]));
    if (!parsed || typeof parsed !== "object") return { entries: [], errors: ["관심 목록 공유 링크 형식이 올바르지 않습니다."] };
    const payload = parsed as { version?: unknown; nearLowThresholdPercent?: unknown; entries?: unknown };
    if (payload.version !== SHARE_VERSION) return { entries: [], errors: ["지원하지 않는 관심 목록 공유 링크 버전입니다."] };
    if (!Array.isArray(payload.entries) || payload.entries.length === 0) return { entries: [], errors: ["공유 링크에 관심 가격 항목이 없습니다."] };
    if (payload.entries.length > CATALOG_WATCHLIST_SHARE_MAX_ENTRIES) return { entries: [], errors: [`공유 링크는 최대 ${CATALOG_WATCHLIST_SHARE_MAX_ENTRIES}개 관심 항목만 포함할 수 있습니다.`] };
    const invalidIndex = payload.entries.findIndex((entry) => !validEntry(entry));
    if (invalidIndex >= 0) return { entries: [], errors: [`공유 링크의 ${invalidIndex + 1}번째 항목을 확인할 수 없습니다.`] };
    const threshold = thresholdFrom(payload.nearLowThresholdPercent);
    if (threshold === undefined) return { entries: [], errors: ["공유 링크의 최저가 근접 기준이 올바르지 않습니다."] };
    return { entries: catalogWatchlistFromJson(JSON.stringify(payload.entries), CATALOG_WATCHLIST_SHARE_MAX_ENTRIES), nearLowThresholdPercent: threshold, errors: [] };
  } catch {
    return { entries: [], errors: ["관심 목록 공유 링크를 읽을 수 없습니다."] };
  }
}
