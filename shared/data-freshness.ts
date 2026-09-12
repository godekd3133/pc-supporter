import type { DataFreshness } from "./types";

const FRESH_MAX_AGE_DAYS = 3;
const AGING_MAX_AGE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_MAX_AGE_MS = FRESH_MAX_AGE_DAYS * DAY_MS;
const AGING_MAX_AGE_MS = AGING_MAX_AGE_DAYS * DAY_MS;

export function classifyDataFreshness(updatedAt: string | undefined, now: string | number = Date.now()): DataFreshness {
  const updatedTimestamp = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const nowTimestamp = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(updatedTimestamp) || !Number.isFinite(nowTimestamp)) return "unknown";
  const ageDays = Math.max(0, nowTimestamp - updatedTimestamp) / DAY_MS;
  if (ageDays <= FRESH_MAX_AGE_DAYS) return "fresh";
  if (ageDays <= AGING_MAX_AGE_DAYS) return "aging";
  return "stale";
}

/** Returns the first timestamp at which this item's freshness class can change. */
export function nextDataFreshnessChangeAt(updatedAt: string | undefined, now: string | number = Date.now()): number | undefined {
  const updatedTimestamp = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const nowTimestamp = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(updatedTimestamp) || !Number.isFinite(nowTimestamp)) return undefined;
  const ageMs = Math.max(0, nowTimestamp - updatedTimestamp);
  if (ageMs <= FRESH_MAX_AGE_MS) return updatedTimestamp + FRESH_MAX_AGE_MS + 1;
  if (ageMs <= AGING_MAX_AGE_MS) return updatedTimestamp + AGING_MAX_AGE_MS + 1;
  return undefined;
}
