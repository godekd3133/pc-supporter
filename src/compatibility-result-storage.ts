import { publicApiPayloadProjection } from "../shared/public-api-projection";
import type { CompatibilityResult } from "../shared/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Migrate a cached compatibility result through the same public boundary as API responses. */
export function publicCompatibilityResultFromStoredJson(raw: string | null): CompatibilityResult | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const projected = publicApiPayloadProjection(parsed);
    if (!isRecord(projected)) return null;
    if (!("compatible" === projected.status || "needs_review" === projected.status || "incompatible" === projected.status)) return null;
    if (![projected.blockerCount, projected.warningCount, projected.unknownCount].every((count) => typeof count === "number" && Number.isInteger(count) && count >= 0)) return null;
    if (!Array.isArray(projected.findings)) return null;
    return projected as unknown as CompatibilityResult;
  } catch {
    return null;
  }
}
