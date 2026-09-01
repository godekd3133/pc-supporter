import type { DataFreshness } from "./types";

const FRESH_MAX_AGE_DAYS = 3;
const AGING_MAX_AGE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export function classifyDataFreshness(updatedAt: string | undefined, now: string | number = Date.now()): DataFreshness {
  const updatedTimestamp = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const nowTimestamp = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(updatedTimestamp) || !Number.isFinite(nowTimestamp)) return "unknown";
  const ageDays = Math.max(0, nowTimestamp - updatedTimestamp) / DAY_MS;
  if (ageDays <= FRESH_MAX_AGE_DAYS) return "fresh";
  if (ageDays <= AGING_MAX_AGE_DAYS) return "aging";
  return "stale";
}
