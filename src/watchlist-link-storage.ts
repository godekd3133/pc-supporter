import { priceAlertPolicyFromUnknown } from "./price-alerts";
import type { PriceAlertPolicy } from "./price-alerts";

export interface SavedWatchlistLink {
  id: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  alertPreferences?: PriceAlertPolicy;
}

export function savedWatchlistLinksFromJson(raw: string | null, max = 20): SavedWatchlistLink[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const candidates = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
    const links = candidates.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const candidate = value as Partial<SavedWatchlistLink>;
      const alertPreferences = candidate.alertPreferences === undefined ? undefined : priceAlertPolicyFromUnknown(candidate.alertPreferences);
      return typeof candidate.id === "string" && candidate.id.trim() ? { id: candidate.id, ...(typeof candidate.name === "string" && candidate.name.trim() ? { name: candidate.name.trim() } : {}), ...(typeof candidate.createdAt === "string" ? { createdAt: candidate.createdAt } : {}), ...(typeof candidate.updatedAt === "string" ? { updatedAt: candidate.updatedAt } : {}), ...(typeof candidate.expiresAt === "string" ? { expiresAt: candidate.expiresAt } : {}), ...(alertPreferences ? { alertPreferences } : {}) } : null;
    }).filter((value): value is SavedWatchlistLink => value !== null);
    return [...new Map(links.map((link) => [link.id, link] as const)).values()].slice(0, Math.min(20, Math.max(1, Math.floor(max))));
  } catch {
    return [];
  }
}

export function savedWatchlistLinksToJson(links: SavedWatchlistLink[], max = 20) {
  return JSON.stringify(links.slice(0, Math.min(20, Math.max(1, Math.floor(max)))));
}
