import snapshot from "./reference-data/gaming-fps-reference.json";
import { gamingFpsReferencesFromUnknown, type GamingFpsReference } from "../shared/gaming-target-assessment";

/** Public absolute-FPS observations, kept separate from writable legacy evidence. */
export const gamingFpsReferences: readonly GamingFpsReference[] = Object.freeze(
  gamingFpsReferencesFromUnknown(snapshot).map((record) => Object.freeze(record))
);

export const GAMING_FPS_REFERENCE_REVIEWED_AT = snapshot.reviewedAt;
export const GAMING_FPS_REFERENCE_MAX_AGE_DAYS = snapshot.referenceMaxAgeDays;

export function loadGamingFpsReferences(): readonly GamingFpsReference[] {
  return gamingFpsReferences;
}
