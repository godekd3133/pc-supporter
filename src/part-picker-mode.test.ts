import { describe, expect, it } from "vitest";
import { shouldAutoFallbackToReviewCandidates, shouldOfferReviewCandidates } from "./part-picker-mode";

describe("part picker candidate mode", () => {
  it("falls back only when the initial safe query is empty but review candidates exist", () => {
    expect(shouldAutoFallbackToReviewCandidates({
      findingRuleId: "cpu-motherboard-socket",
      initialCandidateMode: "safe",
      candidateMode: "safe",
      attempted: false,
      total: 0,
      riskCounts: { safe: 0, review: 126, unsafe: 254 }
    })).toBe(true);
  });

  it("does not fall back when safe candidates exist or the query was already retried", () => {
    const base = {
      findingRuleId: "cpu-motherboard-socket",
      initialCandidateMode: "safe" as const,
      candidateMode: "safe" as const,
      attempted: false,
      total: 3,
      riskCounts: { safe: 3, review: 126, unsafe: 254 }
    };
    expect(shouldAutoFallbackToReviewCandidates(base)).toBe(false);
    expect(shouldAutoFallbackToReviewCandidates({ ...base, total: 0, riskCounts: { safe: 0, review: 126, unsafe: 254 }, attempted: true })).toBe(false);
  });

  it("does not change a user-selected mode or a non-finding catalog view", () => {
    expect(shouldAutoFallbackToReviewCandidates({
      findingRuleId: "cpu-motherboard-socket",
      initialCandidateMode: "safe",
      candidateMode: "no_blocker",
      attempted: false,
      total: 0,
      riskCounts: { safe: 0, review: 126, unsafe: 254 }
    })).toBe(false);
    expect(shouldAutoFallbackToReviewCandidates({
      initialCandidateMode: "all",
      candidateMode: "all",
      attempted: false,
      total: 0,
      riskCounts: { safe: 0, review: 126, unsafe: 254 }
    })).toBe(false);
  });

  it("offers an explicit review-candidate action when safe results are visible", () => {
    expect(shouldOfferReviewCandidates({
      candidateMode: "safe",
      riskFilter: "all",
      total: 1,
      riskCounts: { safe: 1, review: 616, unsafe: 13 }
    })).toBe(true);
  });

  it("does not offer the action when the risk filter, result count, or review count blocks it", () => {
    const base = {
      candidateMode: "safe" as const,
      riskFilter: "all" as const,
      total: 1,
      riskCounts: { safe: 1, review: 616, unsafe: 13 }
    };
    expect(shouldOfferReviewCandidates({ ...base, riskFilter: "safe" })).toBe(false);
    expect(shouldOfferReviewCandidates({ ...base, total: 0 })).toBe(false);
    expect(shouldOfferReviewCandidates({ ...base, riskCounts: { safe: 1, review: 0, unsafe: 13 } })).toBe(false);
  });
});
