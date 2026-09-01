import type { BuildGenerationResult, BuildSelection, RecommendationPreferences } from "../shared/types";

const priorityLabels: Record<BuildGenerationResult["priority"], string> = {
  balanced: "균형형",
  budget: "가성비 우선",
  performance: "성능 유지"
};

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
    label: `${priorityLabels[draft.priority]} 자동 구성 견적`,
    kind: "generated",
    ...(parentBuildId ? { parentBuildId } : {})
  };
}
