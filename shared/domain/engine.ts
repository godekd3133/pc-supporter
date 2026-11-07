// Public engine surface. Implementation lives in ./engine/*.ts.
export { ENGINE_VERSION, BuildGenerationError } from "./engine/core";
export type { EngineClockOptions, EngineGenerationOptions } from "./engine/core";
export { evaluateBuild } from "./engine/evaluate";
export { assessAlternativePart, alternativeRiskForPart, isSafeAlternativePart, candidateFixesFinding, candidateSimilarityForBuild, compareCandidateSimilarity, compareCandidateValue } from "./engine/alternatives";
export type { AlternativeAssessment } from "./engine/alternatives";
export { buildUpgradeRecommendations, buildUpgradeBundlesWithSummary, buildUpgradeBundles } from "./engine/upgrades";
export type { UpgradeBundleSearchResult } from "./engine/upgrades";
export { generateBuildDraft, minimumFeasibleBuildPriceFor, recommendationFloorWonFor, buildGenerationRecoveryOptionsFor } from "./engine/generate";
export { selectionFromCatalog, selectedPartSummary, formatBuildPrice } from "./engine/selection";
