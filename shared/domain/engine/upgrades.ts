import { type BuildSelection, type Part, type RecommendationProfile, type ListingPolicy, type RecommendationPreferences, type GamingResolution, type GamingRefreshRate, type UpgradeRecommendation, type CompatibilityResult, type PartCategory, isKnownPrice, type GpuTargetFit, type UpgradeBundleRecommendation, type UpgradeBundleSearchSummary, CATEGORY_LABELS } from "../../types";
import { DEFAULT_GAMING_RESOLUTION, type EvaluationCache, type UpgradeRecommendationLimits, DEFAULT_GAMING_REFRESH_RATE, limitUpgradeRecommendations, buildPriceInfo, selectedCorePartIds, categorySelections, currentCategoryPart, upgradeAssessmentFor, type UpgradeAssessment, type SimilarityComparison, replaceSelection, performanceComparisonFor, similarityFor, gpuTargetEvidenceFor, upgradeBudgetEvidenceFor, candidateCompatibilityDeltaFindings, benchmarkFreshnessFor, upgradeExpansionEvidenceFor, physicalEvidenceSummaryFor, performanceSummaryFor, upgradeCompatibilityEvidenceFor } from "./core";
import { evaluateBuild } from "./evaluate";
import { isQuoteBrandAllowed, isListingAllowed } from "../listing";
import { recommendationTrustFor, compareRecommendationTrust } from "../recommendation-trust";
import { compareCandidateSimilarity } from "./alternatives";

const BUNDLE_BEAM_WIDTH = 24;

export function buildUpgradeRecommendations(
  build: BuildSelection,
  catalog: Part[],
  profile: RecommendationProfile = "general",
  listingPolicy: ListingPolicy = "retail_only",
  priority: RecommendationPreferences["priority"] = "balanced",
  gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION,
  budgetWon?: number,
  evaluationCache?: EvaluationCache,
  limits: UpgradeRecommendationLimits = {},
  gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE
): UpgradeRecommendation[] {
  return limitUpgradeRecommendations(
    rankedUpgradeRecommendations(build, catalog, profile, listingPolicy, priority, gamingResolution, budgetWon, evaluationCache, gamingRefreshRate),
    limits
  );
}

export function rankedUpgradeRecommendations(
  build: BuildSelection,
  catalog: Part[],
  profile: RecommendationProfile,
  listingPolicy: ListingPolicy,
  priority: RecommendationPreferences["priority"],
  gamingResolution: GamingResolution,
  budgetWon: number | undefined,
  evaluationCache: EvaluationCache | undefined,
  gamingRefreshRate: GamingRefreshRate
): UpgradeRecommendation[] {
  const cache = evaluationCache ?? new Map<string, CompatibilityResult>();
  const baseline = evaluateBuild(build, catalog, { includeSuggestions: false, evaluationCache: cache });
  if (baseline.blockerCount > 0 || baseline.unknownCount > 0) return [];
  const baselinePrice = buildPriceInfo(catalog, build);
  const categories: PartCategory[] = ["cpu", "gpu", "memory", "ssd", "hdd", "cooler", "psu", "case", "motherboard"];
  const currentPartIds = selectedCorePartIds(build);
  const recommendations: UpgradeRecommendation[] = [];
  for (const category of categories) {
    const selections = categorySelections(build, category);
    if (selections.length !== 1) continue;
    const current = currentCategoryPart(catalog, build, category);
    if (!current || current.dataQuality === "incomplete") continue;
    const quantity = selections[0].quantity;
    const assessedCandidates = catalog
      .filter((candidate) => candidate.category === category
        && !currentPartIds.has(candidate.id)
        && candidate.dataQuality !== "incomplete"
        && isKnownPrice(candidate.priceWon)
        && isQuoteBrandAllowed(category, candidate.brand, candidate.name))
      .filter((candidate) => isListingAllowed(candidate, listingPolicy))
      .map((candidate) => ({ candidate, assessment: upgradeAssessmentFor(current, candidate, profile, gamingResolution, gamingRefreshRate) }))
      .filter((entry): entry is { candidate: Part; assessment: UpgradeAssessment } => Boolean(entry.assessment))
      .sort((left, right) => right.assessment.improvementPercent - left.assessment.improvementPercent || right.assessment.upgradeScore - left.assessment.upgradeScore)
      .slice(0, 60);
    // 비교 기준은 현재 부품에만 달려 있다 — 후보마다 카탈로그를 다시 훑지 않는다.
    let comparison: SimilarityComparison | undefined;
    let comparisonResolved = false;
    for (const { candidate, assessment } of assessedCandidates) {
      const nextBuild = replaceSelection(build, category, candidate.id);
      const evaluation = evaluateBuild(nextBuild, catalog, { includeSuggestions: false, evaluationCache: cache });
      if (evaluation.blockerCount > 0 || evaluation.unknownCount > 0 || evaluation.warningCount > baseline.warningCount) continue;
      if (!comparisonResolved) {
        comparison = performanceComparisonFor(current, catalog);
        comparisonResolved = true;
      }
      const similarity = similarityFor(current, candidate, profile, gamingResolution, comparison, gamingRefreshRate);
      const gpuTarget = profile === "gaming" && category === "gpu"
        ? gpuTargetEvidenceFor(current, candidate, gamingResolution, gamingRefreshRate)
        : undefined;
      const budgetEvidence = budgetWon === undefined
        ? undefined
        : upgradeBudgetEvidenceFor(budgetWon, baselinePrice, evaluation);
      const priceDeltaWon = isKnownPrice(current.priceWon) && isKnownPrice(candidate.priceWon)
        ? (candidate.priceWon - current.priceWon) * quantity
        : undefined;
      const candidateDeltaFindings = candidateCompatibilityDeltaFindings(baseline, evaluation, candidate.id);
      const recommendationTrust = recommendationTrustFor({
        candidate,
        similarityEvidence: similarity.evidence,
        resolvesTarget: true,
        benchmarkSourceKind: candidate.specs.benchmarkProvenance?.sourceKind,
        benchmarkFreshness: benchmarkFreshnessFor(candidate),
        benchmarkSourceCheck: candidate.specs.benchmarkProvenance?.sourceCheck,
        candidateBlockers: candidateDeltaFindings.filter((item) => item.severity === "blocker").length,
        candidateWarnings: candidateDeltaFindings.filter((item) => item.severity === "warning").length,
        candidateUnknown: candidateDeltaFindings.filter((item) => item.severity === "unknown").length,
        remainingBlockers: evaluation.blockerCount,
        remainingWarnings: evaluation.warningCount,
        remainingUnknown: evaluation.unknownCount
      });
      const expansionEvidence = upgradeExpansionEvidenceFor(baseline, evaluation);
      const physicalEvidence = physicalEvidenceSummaryFor(category, evaluation);
      recommendations.push({
        category,
        currentPartId: current.id,
        currentPartName: current.name,
        quantity,
        part: candidate,
        upgradeScore: assessment.upgradeScore,
        improvementPercent: assessment.improvementPercent,
        improvedDimensions: assessment.improvedDimensions,
        performanceSummary: performanceSummaryFor(current, candidate, comparison),
        similarityScore: similarity.score,
        similarityLabel: similarity.label,
        similarityEvidence: similarity.evidence,
        ...(isKnownPrice(current.priceWon) ? { currentPriceWon: current.priceWon } : {}),
        ...(priceDeltaWon !== undefined ? { priceDeltaWon } : {}),
        ...(gpuTarget ? { gpuTarget } : {}),
        compatibilityEvidence: upgradeCompatibilityEvidenceFor(category, evaluation),
        expansionEvidence,
        ...(budgetEvidence ? { budgetEvidence } : {}),
        recommendationTrust,
        ...(physicalEvidence ? { physicalEvidence } : {}),
        reason: `${assessment.improvedDimensions.join("/")} 기준으로 비교한 사양이 약 ${assessment.improvementPercent}% 나아져요.${gpuTarget ? ` ${gpuTarget.summary}.` : ""} 교체 후 새 호환 불가/확인 필요/주의 항목이 없어 현재 호환 상태를 유지합니다.`
      });
    }
  }
  return recommendations
    .sort((left, right) => {
      const priorityComparison = priority === "reliability"
        ? compareRecommendationTrust(left.recommendationTrust, right.recommendationTrust)
        : priority === "performance"
          ? right.improvementPercent - left.improvementPercent
          : priority === "budget"
            ? Number(right.budgetEvidence?.withinBudget === true) - Number(left.budgetEvidence?.withinBudget === true)
              || (left.budgetEvidence?.afterCoreTotalPriceWon ?? Number.MAX_SAFE_INTEGER) - (right.budgetEvidence?.afterCoreTotalPriceWon ?? Number.MAX_SAFE_INTEGER)
              || (left.priceDeltaWon ?? Number.MAX_SAFE_INTEGER) - (right.priceDeltaWon ?? Number.MAX_SAFE_INTEGER)
            : right.upgradeScore - left.upgradeScore;
      const targetFitRank = (fit: GpuTargetFit | undefined) => fit === "met" ? 0 : fit === "partial" ? 1 : 2;
      const targetFitComparison = left.gpuTarget && right.gpuTarget
        ? targetFitRank(left.gpuTarget.candidateFit) - targetFitRank(right.gpuTarget.candidateFit)
        : 0;
      return priorityComparison
        || targetFitComparison
        || compareRecommendationTrust(left.recommendationTrust, right.recommendationTrust)
        || compareCandidateSimilarity(left, right)
        || (left.priceDeltaWon ?? 0) - (right.priceDeltaWon ?? 0);
    });
}

export type UpgradeBundleSearchResult = {
  bundles: UpgradeBundleRecommendation[];
  summary: UpgradeBundleSearchSummary;
};

function emptyUpgradeBundleSearchResult(recommendations: UpgradeRecommendation[]): UpgradeBundleSearchResult {
  return {
    bundles: [],
    summary: {
      candidateCount: recommendations.length,
      candidateCategoryCount: new Set(recommendations.map((recommendation) => recommendation.category)).size,
      candidatePairCount: 0,
      evaluatedPairCount: 0,
      candidateTripleCount: 0,
      evaluatedTripleCount: 0,
      beamWidth: BUNDLE_BEAM_WIDTH,
      safeBundleCount: 0,
      returnedBundleCount: 0
    }
  };
}

type UpgradeBundleSortMode = "recommended" | "performance" | "budget" | "reliability" | "expansion" | "saving";

function upgradeBundleReliabilityScoreFor(bundle: UpgradeBundleRecommendation) {
  return bundle.changes.reduce((total, recommendation) => total + (recommendation.recommendationTrust?.score ?? 0), 0);
}

function upgradeBundleSortComparisonFor(left: UpgradeBundleRecommendation, right: UpgradeBundleRecommendation, mode: UpgradeBundleSortMode) {
  const priorityComparison = mode === "reliability"
    ? upgradeBundleReliabilityScoreFor(right) - upgradeBundleReliabilityScoreFor(left)
    : mode === "performance"
      ? right.totalImprovementPercent - left.totalImprovementPercent
      : mode === "budget"
        ? Number(right.budgetEvidence?.withinBudget === true) - Number(left.budgetEvidence?.withinBudget === true)
          || (left.budgetEvidence?.afterCoreTotalPriceWon ?? Number.MAX_SAFE_INTEGER) - (right.budgetEvidence?.afterCoreTotalPriceWon ?? Number.MAX_SAFE_INTEGER)
          || (left.totalPriceDeltaWon ?? Number.MAX_SAFE_INTEGER) - (right.totalPriceDeltaWon ?? Number.MAX_SAFE_INTEGER)
        : mode === "expansion"
          ? (right.expansionEvidence?.scoreDelta ?? Number.NEGATIVE_INFINITY) - (left.expansionEvidence?.scoreDelta ?? Number.NEGATIVE_INFINITY)
            || (right.expansionEvidence?.candidateScore ?? Number.NEGATIVE_INFINITY) - (left.expansionEvidence?.candidateScore ?? Number.NEGATIVE_INFINITY)
          : mode === "saving"
            ? (left.totalPriceDeltaWon ?? Number.MAX_SAFE_INTEGER) - (right.totalPriceDeltaWon ?? Number.MAX_SAFE_INTEGER)
            : right.totalUpgradeScore - left.totalUpgradeScore;
  return priorityComparison
    || right.totalImprovementPercent - left.totalImprovementPercent
    || (left.totalPriceDeltaWon ?? 0) - (right.totalPriceDeltaWon ?? 0)
    || upgradeBundleKeyFor(left).localeCompare(upgradeBundleKeyFor(right));
}

function upgradeBundleSortModeForPriority(priority: RecommendationPreferences["priority"]): UpgradeBundleSortMode {
  return priority === "performance" ? "performance" : priority === "budget" ? "budget" : priority === "reliability" ? "reliability" : "recommended";
}

function upgradeBundleKeyFor(bundle: UpgradeBundleRecommendation) {
  return bundle.changes.map((change) => `${change.category}:${change.part.id}`).sort().join("|");
}

export function buildUpgradeBundlesWithSummary(
  build: BuildSelection,
  catalog: Part[],
  recommendations: UpgradeRecommendation[],
  priority: RecommendationPreferences["priority"] = "balanced",
  budgetWon?: number,
  evaluationCache?: EvaluationCache
): UpgradeBundleSearchResult {
  if (recommendations.length < 2) return emptyUpgradeBundleSearchResult(recommendations);
  const cache = evaluationCache ?? new Map<string, CompatibilityResult>();
  const baseline = evaluateBuild(build, catalog, { includeSuggestions: false, evaluationCache: cache });
  if (baseline.blockerCount > 0 || baseline.unknownCount > 0) return emptyUpgradeBundleSearchResult(recommendations);
  const baselinePrice = buildPriceInfo(catalog, build);
  const safePairBundles: UpgradeBundleRecommendation[] = [];
  let candidatePairCount = 0;
  let evaluatedPairCount = 0;
  let candidateTripleCount = 0;
  let evaluatedTripleCount = 0;

  function bundleFor(changes: UpgradeRecommendation[], evaluation: CompatibilityResult): UpgradeBundleRecommendation {
    const totalPriceDeltaWon = changes.every((recommendation) => recommendation.priceDeltaWon !== undefined)
      ? changes.reduce((total, recommendation) => total + (recommendation.priceDeltaWon ?? 0), 0)
      : undefined;
    const budgetEvidence = budgetWon === undefined
      ? undefined
      : upgradeBudgetEvidenceFor(budgetWon, baselinePrice, evaluation);
    const expansionEvidence = upgradeExpansionEvidenceFor(baseline, evaluation);
    const totalImprovementPercent = Number(changes.reduce((total, recommendation) => total + recommendation.improvementPercent, 0).toFixed(1));
    return {
      changes,
      totalUpgradeScore: changes.reduce((total, recommendation) => total + recommendation.upgradeScore, 0),
      totalImprovementPercent,
      ...(totalPriceDeltaWon !== undefined ? { totalPriceDeltaWon } : {}),
      expansionEvidence,
      ...(budgetEvidence ? { budgetEvidence } : {}),
      compatibilityEvidence: {
        blockerCount: evaluation.blockerCount,
        warningCount: evaluation.warningCount,
        unknownCount: evaluation.unknownCount
      },
      reason: `${changes.map((recommendation) => CATEGORY_LABELS[recommendation.category]).join("/")}를 함께 바꾸는 조합입니다. 부품별 비교 변화가 합산 ${totalImprovementPercent}%이며, ${changes.length}개 부품을 함께 적용한 최종 구성도 현재 호환 수준을 유지합니다.`
    };
  }

  for (let leftIndex = 0; leftIndex < recommendations.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < recommendations.length; rightIndex += 1) {
      const changes = [recommendations[leftIndex], recommendations[rightIndex]];
      if (changes[0].category === changes[1].category) continue;
      candidatePairCount += 1;
      const nextBuild = changes.reduce(
        (current, recommendation) => replaceSelection(current, recommendation.category, recommendation.part.id),
        build
      );
      evaluatedPairCount += 1;
      const evaluation = evaluateBuild(nextBuild, catalog, { includeSuggestions: false, evaluationCache: cache });
      if (evaluation.blockerCount > 0 || evaluation.unknownCount > 0 || evaluation.warningCount > baseline.warningCount) continue;
      safePairBundles.push(bundleFor(changes, evaluation));
    }
  }

  const primaryBeamMode = upgradeBundleSortModeForPriority(priority);
  const beamModes: UpgradeBundleSortMode[] = primaryBeamMode === "performance"
    ? ["performance", "expansion", "recommended"]
    : primaryBeamMode === "budget"
      ? ["budget", "saving", "expansion"]
      : primaryBeamMode === "reliability"
        ? ["reliability", "recommended", "expansion"]
      : ["recommended", "expansion", "performance"];
  const beamPairLimitPerMode = Math.max(1, Math.ceil(BUNDLE_BEAM_WIDTH / beamModes.length));
  const beamPairMap = new Map<string, UpgradeBundleRecommendation>();
  for (const mode of beamModes) {
    [...safePairBundles]
      .sort((left, right) => upgradeBundleSortComparisonFor(left, right, mode))
      .slice(0, beamPairLimitPerMode)
      .forEach((bundle) => beamPairMap.set(upgradeBundleKeyFor(bundle), bundle));
  }
  const beamPairs = [...beamPairMap.values()].slice(0, BUNDLE_BEAM_WIDTH);
  const safeTripleBundles: UpgradeBundleRecommendation[] = [];
  const tripleKeys = new Set<string>();
  for (const pair of beamPairs) {
    for (const recommendation of recommendations) {
      if (pair.changes.some((change) => change.category === recommendation.category)) continue;
      const changes = [...pair.changes, recommendation];
      const key = changes.map((change) => `${change.category}:${change.part.id}`).sort().join("|");
      if (tripleKeys.has(key)) continue;
      tripleKeys.add(key);
      candidateTripleCount += 1;
      const nextBuild = changes.reduce(
        (current, change) => replaceSelection(current, change.category, change.part.id),
        build
      );
      evaluatedTripleCount += 1;
      const evaluation = evaluateBuild(nextBuild, catalog, { includeSuggestions: false, evaluationCache: cache });
      if (evaluation.blockerCount > 0 || evaluation.unknownCount > 0 || evaluation.warningCount > baseline.warningCount) continue;
      safeTripleBundles.push(bundleFor(changes, evaluation));
    }
  }

  const safeBundles = [...safePairBundles, ...safeTripleBundles];
  const returnedBundles = [...safeBundles]
    .sort((left, right) => upgradeBundleSortComparisonFor(left, right, primaryBeamMode));
  return {
    bundles: returnedBundles,
    summary: {
      candidateCount: recommendations.length,
      candidateCategoryCount: new Set(recommendations.map((recommendation) => recommendation.category)).size,
      candidatePairCount,
      evaluatedPairCount,
      candidateTripleCount,
      evaluatedTripleCount,
      beamWidth: BUNDLE_BEAM_WIDTH,
      safeBundleCount: safeBundles.length,
      returnedBundleCount: returnedBundles.length
    }
  };
}

export function buildUpgradeBundles(
  build: BuildSelection,
  catalog: Part[],
  recommendations: UpgradeRecommendation[],
  priority: RecommendationPreferences["priority"] = "balanced",
  budgetWon?: number,
  evaluationCache?: EvaluationCache
): UpgradeBundleRecommendation[] {
  return buildUpgradeBundlesWithSummary(build, catalog, recommendations, priority, budgetWon, evaluationCache).bundles;
}
