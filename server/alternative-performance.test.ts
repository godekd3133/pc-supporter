import { describe, expect, it } from "vitest";
import { alternativePerformanceFilterFromUnknown, alternativePerformanceMatches } from "./alternative-performance";

const similarity = (similarityLabel: "동급" | "유사" | "대안", comparedDimensions: number, totalDimensions: number, confidence: "high" | "limited" | "unknown", basis?: "benchmark" | "spec" | "mixed") => ({
  similarityLabel,
  similarityEvidence: { comparedDimensions, totalDimensions, confidence, ...(basis ? { basis } : {}) }
});

describe("alternative performance filters", () => {
  it("normalizes unsupported filter values to all", () => {
    expect(alternativePerformanceFilterFromUnknown(undefined)).toBe("all");
    expect(alternativePerformanceFilterFromUnknown("similar")).toBe("similar");
    expect(alternativePerformanceFilterFromUnknown("verified")).toBe("verified");
    expect(alternativePerformanceFilterFromUnknown("benchmark")).toBe("benchmark");
    expect(alternativePerformanceFilterFromUnknown("unknown")).toBe("all");
  });

  it("keeps only 동급·유사 candidates with at least two compared dimensions", () => {
    expect(alternativePerformanceMatches("similar", similarity("동급", 4, 4, "high"))).toBe(true);
    expect(alternativePerformanceMatches("similar", similarity("유사", 2, 4, "limited"))).toBe(true);
    expect(alternativePerformanceMatches("similar", similarity("유사", 1, 4, "limited"))).toBe(false);
    expect(alternativePerformanceMatches("similar", similarity("대안", 4, 4, "high"))).toBe(false);
    expect(alternativePerformanceMatches("similar", {})).toBe(false);
  });

  it("keeps only high-confidence candidates for the verified filter", () => {
    expect(alternativePerformanceMatches("verified", similarity("동급", 4, 4, "high"))).toBe(true);
    expect(alternativePerformanceMatches("verified", similarity("대안", 4, 4, "high"))).toBe(true);
    expect(alternativePerformanceMatches("verified", similarity("유사", 3, 4, "limited"))).toBe(false);
    expect(alternativePerformanceMatches("verified", similarity("동급", 1, 4, "high"))).toBe(false);
  });

  it("keeps candidates whose comparison includes benchmark evidence", () => {
    expect(alternativePerformanceMatches("benchmark", similarity("동급", 4, 4, "high", "benchmark"))).toBe(true);
    expect(alternativePerformanceMatches("benchmark", similarity("유사", 3, 4, "limited", "mixed"))).toBe(true);
    expect(alternativePerformanceMatches("benchmark", similarity("유사", 4, 4, "high", "spec"))).toBe(false);
    expect(alternativePerformanceMatches("benchmark", similarity("동급", 4, 4, "high"))).toBe(false);
  });

  it("does not filter the default all mode", () => {
    expect(alternativePerformanceMatches("all", {})).toBe(true);
  });
});
