import { describe, expect, it } from "vitest";
import type { SimilarityEvidence } from "../shared/types";
import { upgradeBundleSpecComparisonTextFor } from "./UpgradeBundleChangeCard";
import { upgradeSpecComparisonTextFor } from "./ResultPanels";

describe("upgradeSpecComparisonTextFor", () => {
  it("retains hardware specs and excludes benchmark score dimensions", () => {
    const similarityEvidence: SimilarityEvidence = {
      comparedDimensions: 2,
      totalDimensions: 2,
      confidence: "high",
      basis: "mixed",
      dimensions: [
        { key: "cinebenchR23Multi", label: "Cinebench R23 멀티", currentValue: "12,000", candidateValue: "18,000", score: 86, weight: 7 },
        { key: "cores", label: "코어", currentValue: "8", candidateValue: "12", score: 80, weight: 4 }
      ]
    };

    expect(upgradeSpecComparisonTextFor({ similarityEvidence })).toBe("코어 8 → 12");
  });
});

describe("upgradeBundleSpecComparisonTextFor", () => {
  it("keeps bundle hardware spec changes without benchmark score dimensions", () => {
    const similarityEvidence: SimilarityEvidence = {
      comparedDimensions: 2,
      totalDimensions: 2,
      confidence: "high",
      basis: "mixed",
      dimensions: [
        { key: "gpu3dmarkTimeSpyScore", label: "Time Spy", currentValue: "18,000", candidateValue: "22,000", score: 81, weight: 7 },
        { key: "vramGb", label: "VRAM", currentValue: "8GB", candidateValue: "16GB", score: 75, weight: 4 }
      ]
    };

    expect(upgradeBundleSpecComparisonTextFor({ similarityEvidence })).toBe("VRAM 8GB → 16GB");
  });

  it("accepts bundle payloads where public projection omitted similarity evidence", () => {
    expect(upgradeBundleSpecComparisonTextFor({})).toBeUndefined();
    expect(upgradeBundleSpecComparisonTextFor({ similarityEvidence: undefined })).toBeUndefined();
  });
});
