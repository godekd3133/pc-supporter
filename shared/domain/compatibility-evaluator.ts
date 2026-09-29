import type { AccessoryItem, BuildSelection, CompatibilityResult, Part, RecommendationPreferences } from "../types";
import { accessoryCompatibilityFor } from "./accessory-compatibility";
import { recommendAccessories } from "./accessory-recommendations";
import { summarizeAccessorySelections } from "./accessory-cart";
import { summarizeBuildDataHealth, classifyDataFreshness } from "./data-health";
import { evaluateBuild } from "./engine";
import { gamingPerformanceAssessmentFor } from "../gaming-performance-evidence";
import type { GamingPerformanceEvidenceRecord } from "../gaming-performance-evidence";
import { upgradeBundlePayloadFor } from "../upgrade-bundle-transport";
import { publicApiPayloadProjection } from "./public-api-projection";

export interface CompatibilityEvaluatorOptions {
  catalogSnapshotAt: string;
  recommendationPreferences: RecommendationPreferences;
  gamingPerformanceEvidence: readonly GamingPerformanceEvidenceRecord[];
  includeSuggestions?: boolean;
  now?: string | number;
}

function compatibilityGamingPerformanceAssessmentFor(
  build: BuildSelection,
  catalog: Part[],
  preferences: RecommendationPreferences,
  evidence: readonly GamingPerformanceEvidenceRecord[],
  now: string | number
) {
  const hasGamingOptionAdvisory = preferences.profile === "gaming" && (
    (preferences.gamingGameIds?.length ?? 0) > 0
    || preferences.gamingGraphicsPreset !== undefined
    || preferences.gamingRayTracing !== undefined
    || preferences.gamingUpscaling !== undefined
  );
  if (!hasGamingOptionAdvisory) return undefined;
  const selectedGpu = build.gpu ? catalog.find((part) => part.id === build.gpu?.partId && part.category === "gpu") : undefined;
  return gamingPerformanceAssessmentFor(evidence, {
    gameIds: preferences.gamingGameIds ?? [],
    resolution: preferences.gamingResolution ?? "1440p",
    refreshRate: preferences.gamingRefreshRate ?? 144,
    graphicsPreset: preferences.gamingGraphicsPreset,
    rayTracing: preferences.gamingRayTracing,
    upscaling: preferences.gamingUpscaling,
    ...(selectedGpu ? { gpuPartId: selectedGpu.id, gpuName: selectedGpu.name } : {})
  }, now);
}

/**
 * Shared compatibility calculation for server and installed-local modes.
 * All variable evidence is passed explicitly so each caller can enforce its
 * own data boundary without changing the result calculation.
 */
export function evaluateBuildWithAccessories(
  build: BuildSelection,
  catalog: Part[],
  accessories: AccessoryItem[],
  options: CompatibilityEvaluatorOptions
): CompatibilityResult {
  const now = options.now ?? Date.now();
  const includeSuggestions = options.includeSuggestions ?? true;
  const result = evaluateBuild(build, catalog, {
    catalogSnapshotAt: options.catalogSnapshotAt,
    recommendationPreferences: options.recommendationPreferences,
    now,
    ...(includeSuggestions ? {} : { includeSuggestions: false, includeAnalysis: true })
  });
  const gamingPerformanceAssessment = compatibilityGamingPerformanceAssessmentFor(
    build,
    catalog,
    options.recommendationPreferences,
    options.gamingPerformanceEvidence,
    now
  );
  if (gamingPerformanceAssessment) result.gamingPerformanceAssessment = gamingPerformanceAssessment;
  result.coreTotalPriceWon = result.totalPriceWon;
  result.corePriceComplete = result.priceComplete;
  result.dataHealth = summarizeBuildDataHealth(build, catalog, accessories, now);
  if (includeSuggestions) result.accessoryRecommendations = recommendAccessories(build, catalog, accessories).map((recommendation) => ({
    ...recommendation,
    item: { ...recommendation.item, dataFreshness: classifyDataFreshness(recommendation.item.updatedAt, now) }
  }));
  const accessorySummary = summarizeAccessorySelections(build.accessories ?? [], accessories);
  if ((build.accessories ?? []).length > 0) result.accessoryCompatibility = accessoryCompatibilityFor(build, catalog, accessories);
  result.accessoryTotalPriceWon = accessorySummary.totalPriceWon;
  result.accessoryPriceComplete = accessorySummary.priceComplete;
  result.totalPriceWon += accessorySummary.totalPriceWon;
  result.priceComplete = result.priceComplete && accessorySummary.priceComplete;
  for (const plan of result.repairPlans ?? []) {
    plan.afterTotalPriceWon += accessorySummary.totalPriceWon;
    plan.priceComplete = plan.priceComplete && accessorySummary.priceComplete;
    if (plan.budgetWon !== undefined && plan.priceComplete) {
      plan.budgetDeltaWon = plan.afterTotalPriceWon - plan.budgetWon;
      plan.withinBudget = plan.budgetDeltaWon <= 0;
    }
  }
  return result;
}

/** Preserve the server's customer-facing compatibility response contract. */
export function compatibilityResultForPublicTransport(result: CompatibilityResult): CompatibilityResult {
  const transport = result.upgradeBundles
    ? (() => {
      const { upgradeBundles: _fullBundles, ...withoutFullBundles } = result;
      return { ...withoutFullBundles, upgradeBundlePayload: upgradeBundlePayloadFor(result.upgradeBundles) };
    })()
    : result;
  return publicApiPayloadProjection(transport) as CompatibilityResult;
}
