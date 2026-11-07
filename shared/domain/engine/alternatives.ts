import { type AlternativeRisk, type PhysicalEvidenceSummary, type BuildSelection, type Part, type PartCategory, type Finding, type RecommendationProfile, type GamingResolution, type GamingRefreshRate, type SimilarityEvidence, type SimilarityConfidence } from "../../types";
import { selectedCorePartIds, recommendedMemoryKitQuantity, selectedPart, replaceSelection, candidateIsPlausible, candidateCompatibilityDeltaFindings, candidateDataQualityReasonsFor, physicalEvidenceSummaryFor, DEFAULT_GAMING_RESOLUTION, DEFAULT_GAMING_REFRESH_RATE, currentCategoryPart, performanceComparisonFor, similarityFor, valueForPrices, performanceSummaryFor, similarityScoreForSort } from "./core";
import { evaluateBuild } from "./evaluate";

export type AlternativeAssessment = {
  risk: AlternativeRisk;
  reasons: string[];
  recommendedQuantity?: number;
  fixesCurrentIssue?: boolean;
  candidateBlockerCount: number;
  candidateWarningCount: number;
  candidateUnknownCount: number;
  remainingBlockers: number;
  remainingWarnings: number;
  remainingUnknown: number;
  physicalEvidence?: PhysicalEvidenceSummary;
};

export function assessAlternativePart(build: BuildSelection, catalog: Part[], category: PartCategory, candidate: Part, intentFinding?: Finding): AlternativeAssessment {
  const intentDetails = (fixesCurrentIssue: boolean) => intentFinding ? { fixesCurrentIssue } : {};
  if (candidate.category !== category) return { risk: "unsafe", reasons: ["부품 카테고리가 다릅니다."], candidateBlockerCount: 1, candidateWarningCount: 0, candidateUnknownCount: 0, remainingBlockers: 1, remainingWarnings: 0, remainingUnknown: 0, ...intentDetails(false) };
  if (selectedCorePartIds(build).has(candidate.id)) return { risk: "unsafe", reasons: ["이미 선택된 부품입니다."], candidateBlockerCount: 1, candidateWarningCount: 0, candidateUnknownCount: 0, remainingBlockers: 1, remainingWarnings: 0, remainingUnknown: 0, ...intentDetails(false) };
  const recommendedQuantity = category === "memory" && build.memory.length > 1
    ? recommendedMemoryKitQuantity(build, catalog, candidate)
    : undefined;
  if (category === "memory" && build.memory.length > 1 && recommendedQuantity === undefined) {
    return { risk: "review", reasons: ["혼용 RAM 전체 용량과 슬롯을 보존할 추천 킷 수량을 계산할 수 없습니다."], candidateBlockerCount: 0, candidateWarningCount: 0, candidateUnknownCount: 1, remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 1, ...intentDetails(false) };
  }
  const motherboard = selectedPart(catalog, build.motherboard);
  const motherboardM2PcieGenerations = motherboard?.specs.m2PcieGenerations;
  const motherboardMaxM2PcieGeneration = motherboardM2PcieGenerations && motherboardM2PcieGenerations.length > 0
    ? Math.max(...motherboardM2PcieGenerations)
    : undefined;
  if (category === "ssd"
    && candidate.specs.interface === "NVMe"
    && candidate.specs.formFactor?.toLowerCase().includes("m.2")
    && motherboardMaxM2PcieGeneration !== undefined
    && candidate.specs.m2PcieGeneration === undefined) {
    return {
      risk: "review",
      reasons: ["부품 NVMe M.2 SSD의 PCIe 세대가 확인되지 않습니다."],
      recommendedQuantity,
      candidateBlockerCount: 0,
      candidateWarningCount: 0,
      candidateUnknownCount: 1,
      remainingBlockers: 0,
      remainingWarnings: 0,
      remainingUnknown: 1,
      ...intentDetails(false)
    };
  }
  const baseline = evaluateBuild(build, catalog, { includeSuggestions: false });
  const evaluation = evaluateBuild(replaceSelection(build, category, candidate.id, recommendedQuantity), catalog, { includeSuggestions: false });
  const intentEligible = intentFinding === undefined || candidateIsPlausible(intentFinding, build, candidate, catalog, category);
  const fixesCurrentIssue = intentFinding === undefined
    ? undefined
    : intentEligible && !evaluation.findings.some((item) => item.ruleId === intentFinding.ruleId);
  // 후보 교체 전부터 존재하던 동일 규칙의 항목은 후보가 새로 만든
  // 위험이 아니다. 후보 위험은 baseline 대비 신규/악화된 항목만 센다.
  const candidateFindings = candidateCompatibilityDeltaFindings(baseline, evaluation, candidate.id);
  const reasons = [...new Set([
    ...candidateDataQualityReasonsFor(candidate),
    ...candidateFindings
      .filter((finding) => finding.severity === "blocker" || finding.severity === "unknown")
      .map((finding) => finding.title)
  ])];
  const candidateBlockerCount = candidateFindings.filter((finding) => finding.severity === "blocker").length;
  const candidateWarningCount = candidateFindings.filter((finding) => finding.severity === "warning").length;
  const candidateUnknownCount = candidateFindings.filter((finding) => finding.severity === "unknown").length;
  const physicalEvidence = physicalEvidenceSummaryFor(category, evaluation);
  const physicalEvidenceDetails = physicalEvidence ? { physicalEvidence } : {};
  if (candidateBlockerCount > 0) return { risk: "unsafe", reasons, recommendedQuantity, candidateBlockerCount, candidateWarningCount, candidateUnknownCount, remainingBlockers: evaluation.blockerCount, remainingWarnings: evaluation.warningCount, remainingUnknown: evaluation.unknownCount, ...physicalEvidenceDetails, ...intentDetails(fixesCurrentIssue ?? false) };
  if (candidateUnknownCount > 0 || candidateDataQualityReasonsFor(candidate).length > 0) return { risk: "review", reasons, recommendedQuantity, candidateBlockerCount, candidateWarningCount, candidateUnknownCount, remainingBlockers: evaluation.blockerCount, remainingWarnings: evaluation.warningCount, remainingUnknown: evaluation.unknownCount, ...physicalEvidenceDetails, ...intentDetails(fixesCurrentIssue ?? false) };
  return { risk: "safe", reasons: [], recommendedQuantity, candidateBlockerCount, candidateWarningCount, candidateUnknownCount, remainingBlockers: evaluation.blockerCount, remainingWarnings: evaluation.warningCount, remainingUnknown: evaluation.unknownCount, ...physicalEvidenceDetails, ...intentDetails(fixesCurrentIssue ?? false) };
}

export function alternativeRiskForPart(build: BuildSelection, catalog: Part[], category: PartCategory, candidate: Part): AlternativeRisk {
  return assessAlternativePart(build, catalog, category, candidate).risk;
}

export function isSafeAlternativePart(build: BuildSelection, catalog: Part[], category: PartCategory, candidate: Part) {
  return alternativeRiskForPart(build, catalog, category, candidate) === "safe";
}

export function candidateFixesFinding(finding: Finding, build: BuildSelection, catalog: Part[], targetCategory: PartCategory, candidate: Part) {
  return assessAlternativePart(build, catalog, targetCategory, candidate, finding).fixesCurrentIssue === true;
}

export function candidateSimilarityForBuild(
  build: BuildSelection,
  catalog: Part[],
  category: PartCategory,
  candidate: Part,
  profile: RecommendationProfile = "general",
  gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION,
  gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE
) {
  const current = currentCategoryPart(catalog, build, category);
  const comparison = performanceComparisonFor(current, catalog);
  const similarity = similarityFor(current, candidate, profile, gamingResolution, comparison, gamingRefreshRate);
  const value = valueForPrices(current?.priceWon, candidate.priceWon, similarity.score, similarity.evidence);
  return {
    similarityScore: similarity.score,
    similarityLabel: similarity.label,
    similarityEvidence: similarity.evidence,
    performanceSummary: performanceSummaryFor(current, candidate, comparison),
    ...(value ?? {})
  };
}

export function compareCandidateSimilarity(
  left: { similarityScore: number; similarityEvidence: SimilarityEvidence },
  right: { similarityScore: number; similarityEvidence: SimilarityEvidence }
) {
  const confidenceRank: Record<SimilarityConfidence, number> = { high: 0, limited: 1, unknown: 2 };
  const leftCoverage = left.similarityEvidence.totalDimensions > 0
    ? left.similarityEvidence.comparedDimensions / left.similarityEvidence.totalDimensions
    : 0;
  const rightCoverage = right.similarityEvidence.totalDimensions > 0
    ? right.similarityEvidence.comparedDimensions / right.similarityEvidence.totalDimensions
    : 0;
  return similarityScoreForSort(right) - similarityScoreForSort(left)
    || confidenceRank[left.similarityEvidence.confidence] - confidenceRank[right.similarityEvidence.confidence]
    || rightCoverage - leftCoverage
    || right.similarityEvidence.comparedDimensions - left.similarityEvidence.comparedDimensions;
}

export function compareCandidateValue(
  left: { valueScore?: number; similarityScore: number; similarityEvidence: SimilarityEvidence },
  right: { valueScore?: number; similarityScore: number; similarityEvidence: SimilarityEvidence }
) {
  if (left.valueScore === undefined && right.valueScore !== undefined) return 1;
  if (left.valueScore !== undefined && right.valueScore === undefined) return -1;
  return (right.valueScore ?? 0) - (left.valueScore ?? 0)
    || compareCandidateSimilarity(left, right);
}
