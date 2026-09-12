import type { BuildGenerationResult, BuildSelection, RecommendationPreferences } from "../shared/types";
import { RECOMMENDATION_PRIORITY_LABELS } from "../shared/types";

export type GeneratedDraftSaveTarget = {
  build: BuildSelection;
  preferences: RecommendationPreferences;
  label: string;
  kind: "generated";
  parentBuildId?: string;
};

export function generatedDraftSaveTargetFor(draft: BuildGenerationResult, parentBuildId?: string): GeneratedDraftSaveTarget {
  return {
    build: draft.selection,
    preferences: {
      profile: draft.profile,
      priority: draft.priority,
      budgetWon: draft.budgetWon,
      gamingResolution: draft.gamingResolution,
      gamingRefreshRate: draft.gamingRefreshRate,
      listingPolicy: draft.listingPolicy
    },
    label: `${RECOMMENDATION_PRIORITY_LABELS[draft.priority]} 자동 구성 견적`,
    kind: "generated",
    ...(parentBuildId ? { parentBuildId } : {})
  };
}
