// Shared app-level types used across entry and lazy chunks.
import type { CandidateApplicationEvidence } from "../shared/candidate-application";
import type { BuildSelection, CompatibilityResult, Part, PartCategory } from "../shared/types";

export type SavedBuildOpenFocus = "purchase-list" | { type: "finding"; ruleId: string };

export type BuildScenarioPreviewState = {
  status: "loading" | "ready" | "error";
  title: string;
  summary: string;
  category: PartCategory;
  part: Part;
  quantity?: number;
  affectedPartIds: string[];
  nextBuild: BuildSelection;
  candidateEvidence?: CandidateApplicationEvidence;
  result?: CompatibilityResult;
  error?: string;
};
