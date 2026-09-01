import type { PriceObservation, PriceWatchAlert } from "./price-alerts";

const MAX_PERSISTED_ALERTS = 20;

function isFinitePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function priceBaselineFromJson(raw: string | null): Record<string, PriceObservation> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, PriceObservation> = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const candidate = value as Partial<PriceObservation>;
      if (candidate.status !== "available" && candidate.status !== "unavailable") return;
      result[key] = { status: candidate.status, ...(isFinitePrice(candidate.priceWon) ? { priceWon: candidate.priceWon } : {}) };
    });
    return result;
  } catch {
    return {};
  }
}

export function priceBaselineToJson(value: Record<string, PriceObservation>) {
  return JSON.stringify(value);
}

export function priceAlertsFromJson(raw: string | null): PriceWatchAlert[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is PriceWatchAlert => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const candidate = value as Partial<PriceWatchAlert>;
      return typeof candidate.id === "string" && candidate.id.length > 0
        && typeof candidate.itemKey === "string" && candidate.itemKey.length > 0
        && typeof candidate.message === "string" && candidate.message.length > 0
        && (candidate.kind === "drop" || candidate.kind === "target" || candidate.kind === "availability")
        && typeof candidate.createdAt === "string" && candidate.createdAt.length > 0
        && (candidate.readAt === undefined || typeof candidate.readAt === "string");
    }).slice(0, MAX_PERSISTED_ALERTS);
  } catch {
    return [];
  }
}

export function priceAlertsToJson(value: PriceWatchAlert[]) {
  return JSON.stringify(value.slice(0, MAX_PERSISTED_ALERTS));
}

export function autoRefreshMinutesFromStorage(raw: string | null, fallback: 5 | 15 | 30 = 15): 5 | 15 | 30 {
  const value = Number(raw);
  return value === 5 || value === 15 || value === 30 ? value : fallback;
}

export function autoRefreshEnabledFromStorage(raw: string | null) {
  return raw === "true";
}
