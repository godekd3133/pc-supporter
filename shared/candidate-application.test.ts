import { describe, expect, it } from "vitest";
import { candidateApplicationBlockedFor, candidateApplicationReviewFor } from "./candidate-application";

describe("candidate application evidence", () => {
  it("keeps review reasons and both candidate and full-build risk counts for the final confirmation", () => {
    const review = candidateApplicationReviewFor({
      risk: "review",
      decision: {
        status: "review",
        label: "확인 후 적용",
        summary: "추가 확인 필요",
        reasons: ["제조사 원문 확인 필요", "제조사 원문 확인 필요"]
      },
      reasons: ["물리 근거 확인 필요"],
      candidateBlockerCount: 0,
      candidateWarningCount: 1,
      candidateUnknownCount: 1,
      remainingBlockers: 0,
      remainingWarnings: 2,
      remainingUnknown: 1
    });

    expect(review).toMatchObject({
      status: "review",
      label: "확인 후 적용",
      candidateBlockerCount: 0,
      candidateWarningCount: 1,
      candidateUnknownCount: 1,
      remainingBlockers: 0,
      remainingWarnings: 2,
      remainingUnknown: 1,
      reasons: ["제조사 원문 확인 필요", "물리 근거 확인 필요"]
    });
  });

  it("does not add a review panel for an ordinary safe candidate", () => {
    expect(candidateApplicationReviewFor({ risk: "safe", remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 0 })).toBeUndefined();
    expect(candidateApplicationBlockedFor({ risk: "safe" })).toBe(false);
  });

  it("blocks unsafe candidates before they can reach the apply confirmation", () => {
    expect(candidateApplicationBlockedFor({ risk: "unsafe" })).toBe(true);
    expect(candidateApplicationReviewFor({ risk: "unsafe", reasons: ["새 차단 오류"] })).toMatchObject({ status: "avoid" });
  });
});
