import type { CatalogChangeKind, CatalogChangeRecord } from "./types";

export interface CatalogWatchEntry {
  itemId: string;
  itemName: string;
  category: CatalogChangeRecord["category"];
  kind: CatalogChangeKind;
  addedAt: string;
  targetPriceWon?: number;
}

export function catalogWatchEntryKey(entry: Pick<CatalogWatchEntry, "kind" | "itemId">) {
  return `${entry.kind}:${entry.itemId}`;
}

export function catalogWatchlistContains(entries: CatalogWatchEntry[], target: Pick<CatalogWatchEntry, "kind" | "itemId">) {
  return entries.some((entry) => catalogWatchEntryKey(entry) === catalogWatchEntryKey(target));
}

export function addCatalogWatchEntry(entries: CatalogWatchEntry[], entry: CatalogWatchEntry, limit = 50) {
  const existing = entries.find((candidate) => catalogWatchEntryKey(candidate) === catalogWatchEntryKey(entry));
  const targetPatch = entry.targetPriceWon !== undefined ? { targetPriceWon: entry.targetPriceWon } : {};
  const next = existing ? entries.map((candidate) => candidate === existing ? { ...candidate, itemName: entry.itemName, category: entry.category, ...targetPatch } : candidate) : [entry, ...entries];
  return next.slice(0, Math.min(50, Math.max(1, Math.floor(limit))));
}

export function mergeCatalogWatchEntries(entries: CatalogWatchEntry[], importedEntries: CatalogWatchEntry[], limit = 50) {
  return importedEntries.slice().reverse().reduce((current, entry) => addCatalogWatchEntry(current, entry, limit), entries);
}

export function removeCatalogWatchEntry(entries: CatalogWatchEntry[], target: Pick<CatalogWatchEntry, "kind" | "itemId">) {
  return entries.filter((entry) => catalogWatchEntryKey(entry) !== catalogWatchEntryKey(target));
}

export function updateCatalogWatchEntry(entries: CatalogWatchEntry[], target: Pick<CatalogWatchEntry, "kind" | "itemId">, patch: Partial<Pick<CatalogWatchEntry, "itemName" | "category" | "targetPriceWon">>) {
  return entries.map((entry) => catalogWatchEntryKey(entry) === catalogWatchEntryKey(target) ? { ...entry, ...patch } : entry);
}

function isCatalogWatchEntry(value: unknown): value is CatalogWatchEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CatalogWatchEntry>;
  return typeof entry.itemId === "string" && entry.itemId.length > 0
    && typeof entry.itemName === "string" && entry.itemName.length > 0
    && typeof entry.category === "string" && entry.category.length > 0
    && (entry.kind === "part" || entry.kind === "accessory")
    && typeof entry.addedAt === "string" && entry.addedAt.length > 0
    && (entry.targetPriceWon === undefined || (typeof entry.targetPriceWon === "number" && Number.isFinite(entry.targetPriceWon) && entry.targetPriceWon > 0));
}

export function catalogWatchlistFromJson(raw: string | null, limit = 50): CatalogWatchEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const normalized: CatalogWatchEntry[] = [];
    const seen = new Set<string>();
    for (const value of parsed) {
      if (!isCatalogWatchEntry(value)) continue;
      const key = catalogWatchEntryKey(value);
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(value);
      if (normalized.length >= Math.min(50, Math.max(1, Math.floor(limit)))) break;
    }
    return normalized;
  } catch {
    return [];
  }
}

export function catalogWatchlistToJson(entries: CatalogWatchEntry[]) {
  return JSON.stringify(entries);
}
