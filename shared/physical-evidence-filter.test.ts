import { describe, expect, it } from "vitest";
import { physicalEvidenceFilterFromUnknown, physicalEvidenceFilterLabel, physicalEvidenceMatches } from "./physical-evidence-filter";

describe("physical evidence filter", () => {
  it("normalizes supported filters and falls back to all", () => {
    expect(physicalEvidenceFilterFromUnknown("verified")).toBe("verified");
    expect(physicalEvidenceFilterFromUnknown("review")).toBe("review");
    expect(physicalEvidenceFilterFromUnknown("not-applicable")).toBe("all");
    expect(physicalEvidenceFilterLabel("verified")).toBe("물리 근거 확인됨");
  });

  it("matches only the requested evidence status", () => {
    expect(physicalEvidenceMatches("all", undefined)).toBe(true);
    expect(physicalEvidenceMatches("verified", { status: "verified", summary: "확인" })).toBe(true);
    expect(physicalEvidenceMatches("verified", { status: "review", summary: "확인 필요" })).toBe(false);
    expect(physicalEvidenceMatches("review", { status: "not_applicable", summary: "미적용" })).toBe(false);
  });
});
