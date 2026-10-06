import type { BuildGenerationResult, BuildSelection, RecommendationPreferences } from "../shared/types";
import type { SavedBuildOrigin } from "../shared/saved-build-origin";
import { RECOMMENDATION_PRIORITY_LABELS } from "../shared/types";
import { recommendationPreferencesForGeneratedDraft } from "./generated-draft-context";

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
    preferences: recommendationPreferencesForGeneratedDraft(draft),
    label: `${RECOMMENDATION_PRIORITY_LABELS[draft.priority]} 자동 구성 견적`,
    kind: "generated",
    origin: savedOrigin,
    ...(parentBuildId ? { parentBuildId } : {})
  };
}
