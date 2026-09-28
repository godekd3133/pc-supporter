import { describe, expect, it } from "vitest";
import type { SimilarityEvidence } from "../shared/types";
import { suggestionSpecComparisonTextFor } from "./ResultFindings";

describe("suggestionSpecComparisonTextFor", () => {
  it("keeps hardware specifications and omits benchmark score dimensions", () => {
    const similarityEvidence: SimilarityEvidence = {
      comparedDimensions: 2,
      totalDimensions: 2,
      confidence: "high",
      basis: "mixed",
      dimensions: [
        { key: "gpu3dmarkTimeSpyScore", label: "Time Spy", currentValue: "10,000", candidateValue: "15,000", score: 82, weight: 7 },
        { key: "vramGb", label: "VRAM", currentValue: "8GB", candidateValue: "12GB", score: 78, weight: 4 }
      ]
    };

    expect(suggestionSpecComparisonTextFor({ similarityEvidence })).toBe("VRAM 8GB → 12GB");
  });
});
