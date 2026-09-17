import type { BuildGenerationResult, BuildSelection, RecommendationPreferences } from "../shared/types";
import type { SavedBuildOrigin } from "../shared/saved-build-origin";
import { RECOMMENDATION_PRIORITY_LABELS } from "../shared/types";

export type GeneratedDraftSaveTarget = {
  build: BuildSelection;
  preferences: RecommendationPreferences;
  label: string;
  kind: "generated";
  parentBuildId?: string;
  origin: SavedBuildOrigin;
};

export function generatedDraftSaveTargetFor(draft: BuildGenerationResult, parentBuildId?: string, origin?: SavedBuildOrigin): GeneratedDraftSaveTarget {
  const savedOrigin: SavedBuildOrigin = origin ?? { kind: "generated", sourcePriority: draft.priority, generatedAt: new Date().toISOString() };
  return {
    build: draft.selection,
    preferences: {
      profile: draft.profile,
      priority: draft.priority,
      budgetWon: draft.budgetWon,
      performanceTier: draft.performanceTier,
      gamingResolution: draft.profile === "gaming" ? draft.gamingResolution : undefined,
      gamingRefreshRate: draft.profile === "gaming" ? draft.gamingRefreshRate : undefined,
      gamingGameIds: draft.profile === "gaming" ? draft.gamingGameIds : undefined,
      gamingGraphicsPreset: draft.profile === "gaming" ? draft.gamingGraphicsPreset : undefined,
      gamingRayTracing: draft.profile === "gaming" ? draft.gamingRayTracing : undefined,
      gamingUpscaling: draft.profile === "gaming" ? draft.gamingUpscaling : undefined,
      listingPolicy: draft.listingPolicy
    },
    label: `${RECOMMENDATION_PRIORITY_LABELS[draft.priority]} 자동 구성 견적`,
    kind: "generated",
    origin: savedOrigin,
    ...(parentBuildId ? { parentBuildId } : {})
  };
}
