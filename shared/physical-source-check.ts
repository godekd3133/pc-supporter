import type { DataFreshness, PhysicalSourceCheck } from "./types";
import { classifyDataFreshness } from "./data-freshness";

export function physicalSourceCheckFreshness(check: PhysicalSourceCheck | undefined, now: string | number = Date.now()): DataFreshness {
  return classifyDataFreshness(check?.checkedAt, now);
}

export function physicalSourceCheckNeedsReview(check: PhysicalSourceCheck | undefined, required = false, now: string | number = Date.now()) {
  if (!check) return required;
  return !["reachable", "redirected"].includes(check.status)
    || check.identityStatus !== "matched"
    || ["stale", "unknown"].includes(physicalSourceCheckFreshness(check, now));
}
