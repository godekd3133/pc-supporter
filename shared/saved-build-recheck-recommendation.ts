import { candidatePurchaseDecisionFor } from "./candidate-purchase-decision";
import type { CandidatePurchaseDecision, CandidatePurchaseDecisionInput } from "./candidate-purchase-decision";
import type { CompatibilityResult, Finding, Suggestion } from "./types";
import { isKnownPrice } from "./types";
import { catalogPriceEvidenceFor } from "./catalog-price-evidence";

export interface SavedBuildRecheckCandidate {
  suggestion: Suggestion;
  decision: CandidatePurchaseDecision;
}

const decisionRank: Record<CandidatePurchaseDecision["state"], number> = { buy: 0, performance: 1, wait: 2, review: 3, hold: 4 };
const riskRank = { safe: 0, review: 1, unsafe: 2 } as const;

function decisionFor(suggestion: Suggestion, result: CompatibilityResult) {
  const nextStatus: CandidatePurchaseDecisionInput["nextStatus"] = suggestion.remainingBlockers > 0
    ? "incompatible"
    : suggestion.remainingWarnings > 0 || suggestion.remainingUnknown > 0
      ? "needs_review"
      : "compatible";
  return candidatePurchaseDecisionFor({
    name: suggestion.part.name,
    candidateRisk: suggestion.candidateRisk,
    nextStatus,
    remainingBlockers: suggestion.remainingBlockers,
    remainingWarnings: suggestion.remainingWarnings,
    remainingUnknown: suggestion.remainingUnknown,
    priceKnown: isKnownPrice(suggestion.part.priceWon),
    priceEvidence: catalogPriceEvidenceFor(suggestion.part),
    totalPriceKnown: result.priceComplete,
    priceDeltaWon: suggestion.priceDeltaWon,
    similarityScore: suggestion.similarityScore,
    recommendationTrustScore: suggestion.recommendationTrust?.score,
    recommendationTrustLevel: suggestion.recommendationTrust?.level,
    catalogSpecSourceCheckNeedsReview: suggestion.recommendationTrust?.catalogSpecSourceCheckNeedsReview,
    freshness: suggestion.recommendationTrust?.freshness,
    physicalStatus: suggestion.physicalEvidence?.status
  });
}

function remainingRiskScore(suggestion: Suggestion) {
  return suggestion.remainingBlockers * 10_000 + suggestion.remainingUnknown * 100 + suggestion.remainingWarnings * 10;
}

export function savedBuildRecheckCandidatesFor(finding: Finding, result: CompatibilityResult): SavedBuildRecheckCandidate[] {
  return (finding.suggestions ?? [])
    .filter((suggestion) => suggestion.fixesCurrentIssue)
    .map((suggestion) => ({ suggestion, decision: decisionFor(suggestion, result) }))
    .sort((left, right) => decisionRank[left.decision.state] - decisionRank[right.decision.state]
      || (riskRank[left.suggestion.candidateRisk ?? "review"] ?? 1) - (riskRank[right.suggestion.candidateRisk ?? "review"] ?? 1)
      || remainingRiskScore(left.suggestion) - remainingRiskScore(right.suggestion)
      || (right.suggestion.recommendationTrust?.score ?? -1) - (left.suggestion.recommendationTrust?.score ?? -1)
      || right.suggestion.similarityScore - left.suggestion.similarityScore
      || (right.suggestion.valueScore ?? -1) - (left.suggestion.valueScore ?? -1)
      || Math.abs(left.suggestion.priceDeltaWon ?? 0) - Math.abs(right.suggestion.priceDeltaWon ?? 0)
      || left.suggestion.part.name.localeCompare(right.suggestion.part.name, "ko-KR"));
}
