import { describe, expect, it } from "vitest";
import { similarityBasisLabelFor, similarityDimensionLabelFor, similarityReferenceCategoryFor, similarityReferenceTextFor, similarityReferenceUsedCategoryFor } from "./similarity-evidence";
import type { SimilarityEvidence } from "./types";

describe("similarity evidence presentation helpers", () => {
  it("uses structured reference metadata before dimension or legacy-note fallbacks", () => {
    const evidence: SimilarityEvidence = {
      comparedDimensions: 2,
      totalDimensions: 3,
      confidence: "high",
      basis: "benchmark",
      reference: {
        partId: "gpu-reference",
        partName: "RTX 5070 검증 참조",
        category: "gpu",
        dataQuality: "live",
        updatedAt: "2026-09-05T00:00:00.000Z",
        transferredDimensions: ["gpu3dmarkTimeSpyScore", "vramGb"]
      },
      dimensions: [{ key: "gpu3dmarkTimeSpyScore", label: "3DMark Time Spy", currentValue: "20,000", candidateValue: "21,000", score: 95, weight: 7 }],
      notes: ["동일 CPU 모델 계열이라는 오래된 문구"]
    };

    expect(similarityReferenceCategoryFor(evidence)).toBe("gpu");
    expect(similarityReferenceUsedCategoryFor(evidence)).toBe("gpu");
    expect(similarityBasisLabelFor(evidence)).toBe("3DMark 기반");
    expect(similarityReferenceTextFor(evidence)).toBe("동일 GPU 모델 계열 참조 · RTX 5070 검증 참조 · 보완 지표 3DMark Time Spy · VRAM");
  });

  it("identifies CPU and GPU benchmark labels without inventing a score", () => {
    expect(similarityReferenceCategoryFor({ comparedDimensions: 1, totalDimensions: 2, confidence: "limited", dimensions: [{ key: "cinebenchR23Multi", label: "R23 멀티", currentValue: "12,000", candidateValue: "13,000", score: 92, weight: 7 }] })).toBe("cpu");
    expect(similarityReferenceUsedCategoryFor({ comparedDimensions: 1, totalDimensions: 2, confidence: "limited", dimensions: [{ key: "cinebenchR23Multi", label: "R23 멀티", currentValue: "12,000", candidateValue: "13,000", score: 92, weight: 7 }] })).toBeUndefined();
    expect(similarityBasisLabelFor({ comparedDimensions: 1, totalDimensions: 2, confidence: "limited", basis: "benchmark", dimensions: [{ key: "gpu3dmarkPortRoyalScore", label: "Port Royal", currentValue: "10,000", candidateValue: "11,000", score: 91, weight: 6 }] })).toBe("3DMark 기반");
    expect(similarityBasisLabelFor({ comparedDimensions: 1, totalDimensions: 2, confidence: "limited", dimensions: [{ key: "gpu3dmarkPortRoyalScore", label: "Port Royal", currentValue: "10,000", candidateValue: "11,000", score: 91, weight: 6 }] })).toBe("3DMark 기반");
    expect(similarityDimensionLabelFor("unknownDimension")).toBe("unknownDimension");
    expect(similarityBasisLabelFor(undefined)).toBe("비교 근거 확인 필요");
  });

  it("keeps legacy reference notes readable", () => {
    expect(similarityReferenceCategoryFor({ comparedDimensions: 2, totalDimensions: 2, confidence: "high", notes: ["현재 선택 부품에 없는 값은 동일 GPU 모델 계열의 검증된 카탈로그 참조에서 보완했습니다."] })).toBe("gpu");
  });
});
