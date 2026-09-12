import type { AlternativeRiskCounts } from "../shared/types";

export type PickerCandidateMode = "all" | "no_blocker" | "safe" | "precision";
export type PickerRiskFilter = "all" | "safe" | "review" | "unsafe";

export function shouldAutoFallbackToReviewCandidates(input: {
  findingRuleId?: string;
  initialCandidateMode: PickerCandidateMode;
  candidateMode: PickerCandidateMode;
  attempted: boolean;
  total: number;
  riskCounts?: AlternativeRiskCounts;
}) {
  return input.findingRuleId !== undefined
    && input.initialCandidateMode === "safe"
    && input.candidateMode === "safe"
    && !input.attempted
    && input.total === 0
    && input.riskCounts?.safe === 0
    && (input.riskCounts?.review ?? 0) > 0;
}

export function shouldOfferReviewCandidates(input: {
  candidateMode: PickerCandidateMode;
  riskFilter: PickerRiskFilter;
  total: number;
  riskCounts?: AlternativeRiskCounts;
}) {
  return input.candidateMode === "safe"
    && input.riskFilter === "all"
    && input.total > 0
    && (input.riskCounts?.review ?? 0) > 0;
}
