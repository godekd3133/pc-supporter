import { describe, expect, it } from "vitest";
import { savedBuildRecheckCandidatesFor } from "./saved-build-recheck-recommendation";
import type { CompatibilityResult, Finding, Part, Suggestion } from "./types";

const result = { priceComplete: true } as CompatibilityResult;

function suggestion(id: string, overrides: Partial<Suggestion> = {}): Suggestion {
  const part = { id, category: "motherboard", name: id, priceWon: 100000, source: "seed", specs: {}, dataQuality: "seed", missingFields: [], updatedAt: "2026-09-03T00:00:00.000Z" } as Part;
  return {
    part,
    score: 10,
    reason: "테스트 후보",
    candidateRisk: "safe",
    candidateBlockerCount: 0,
    candidateWarningCount: 0,
    candidateUnknownCount: 0,
    remainingBlockers: 0,
    remainingWarnings: 0,
    remainingUnknown: 0,
    fixesCurrentIssue: true,
    similarityScore: 70,
    similarityLabel: "유사",
    similarityEvidence: { comparedDimensions: 1, totalDimensions: 1, confidence: "high" },
    performanceSummary: "성능 비교",
    profileSummary: "일반형",
    ...overrides
  };
}

describe("saved-build recheck recommendation", () => {
  it("prioritizes a fully compatible safe candidate before residual-risk candidates", () => {
    const finding = { ruleId: "memory-speed", suggestions: [
      suggestion("residual-warning", { remainingWarnings: 1, similarityScore: 99 }),
      suggestion("safe-candidate", { similarityScore: 70 }),
      suggestion("blocked-candidate", { candidateRisk: "unsafe", remainingBlockers: 1 })
    ] } as Finding;

    const candidates = savedBuildRecheckCandidatesFor(finding, result);

    expect(candidates.map((candidate) => candidate.suggestion.part.id)).toEqual(["safe-candidate", "residual-warning", "blocked-candidate"]);
    expect(candidates[0].decision.state).toBe("review");
    expect(candidates[0].decision.reasons).toContain("프로젝트 기준가만 있어 후보 실제 판매 가격을 확정할 수 없습니다.");
    expect(candidates[1].decision.state).toBe("review");
    expect(candidates[2].decision.state).toBe("hold");
  });
});
