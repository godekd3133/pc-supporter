import "dotenv/config";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { AccessoryCategory, AccessoryPriceFilter, AccessoryRefreshResponse, AccessorySelection, AlternativeRisk, AlternativeRiskCounts, BenchmarkAvailabilityFilter, BuildGenerationRequest, BuildSelection, CatalogChangeKind, CatalogChangeRecord, CompatibilityResult, CrawlResumePreview, CrawlStatus, DataFreshness, DataQuality, Finding, GpuPhysicalOverride, ListingPolicy, M2CoverageFilter, M2MappingStatus, M2SlotCoverage, M2SlotCoverageBucket, M2SlotCoverageItem, M2SlotOverride, M2SlotReviewTemplate, M2SlotReviewTemplateItem, Part, PartCategory, PartRefreshResponse, PriceAvailabilityFilter, RecommendationPreferences, RecommendationProfile, SavedBuild, SavedBuildCheckSnapshot } from "../shared/types";
import { ACCESSORY_CATEGORIES, isRecommendationPriority, PART_CATEGORIES } from "../shared/types";
import { catalogEligibilitySummaryFor, catalogMeta, catalogSearchTotalsFor, catalogUpdatedAtFor, countParts, currentCatalogRuntimeRevision, filterParts, findPart, invalidateCatalogCache, loadCatalog, parseCatalogMissingField, parsePartSpecFilter, partSpecFilterDiagnosticsFor, partSpecFilterMatcherFor, searchParts, upsertCatalog } from "./catalog";
import { countAccessories, currentAccessoryUpdatedAt, findAccessory, loadAccessories, readAccessoryCoverage, searchAccessories, upsertAccessories } from "./accessories";
import { loadCatalogSnapshot, loadCatalogSnapshotTimestamp } from "./catalog-snapshot";
import { validateAccessoryTargetPartIds, validateBuildPartIds, validateBuildSelection } from "./build-validation";
export { validateAccessoryTargetPartIds, validateBuildPartIds, validateBuildSelection } from "./build-validation";
import { prepareCompatibilityRequest } from "./compatibility-request";
import { recommendAccessories } from "./accessory-recommendations";
import { summarizeAccessorySelections } from "./accessory-cart";
import { loadSavedBuildPresentationContext, savedBuildPresentationFor, savedBuildPresentationsFor } from "./saved-build-presentation";
import { classifyDataFreshness, summarizeBuildDataHealth } from "./data-health";
import { isAccessoryCrawlRunning, readAccessoryCrawlManifest, readAccessoryCrawlStatus, runAccessoryCrawlJob } from "./accessory-crawler";
import { BuildGenerationError, ENGINE_VERSION, assessAlternativePart, buildGenerationRecoveryOptionsFor, candidateSimilarityForBuild, compareCandidateSimilarity, compareCandidateValue, evaluateBuild, generateBuildDraft } from "./engine";
import { cancelCrawlPageRetryBatch, crawlPageRetryBatchPlanFor, crawlPageRetryPlanFor, crawlResumePlanFor, isCrawlPageRetryBatchRunning, isCrawlRunning, readCrawlStatus, runCrawlJob, runCrawlPageRetryBatchJob, runCrawlPageRetryJob } from "./crawler";
import { CATALOG_PATH, CRAWL_MANIFEST_PATH, ensureDataDirectory, fileUpdatedAt, readJson } from "./storage";
import type { CrawlManifest } from "../shared/types";
import { appendSavedBuild, appendSavedBuildCheck, appendSavedBuildVersionComparison, appendSavedBudgetLadder, appendSavedComparison, appendSavedWatchlist, deleteSavedBuild, deleteSavedBuildVersionComparison, deleteSavedBudgetLadder, deleteSavedComparison, deleteSavedWatchlist, deleteSavedWatchlistAlertStates, initializePersistence, migrateSavedBuildVersions, persistenceDiagnostics, readLatestSavedBuildVersionBackup, readSavedBuildVersionBackupDetail, readSavedBuildVersionBackups, readSavedBuilds, readSavedBuildVersionComparisons, readSavedBudgetLadders, readSavedComparisons, readSavedWatchlistAlertStates, readSavedWatchlists, restoreSavedBuildPurchasePriceHistory, restoreSavedBuildPurchaseProgress, rollbackSavedBuildVersions, savedBuildVersionSnapshotFingerprintFor, updateSavedBuildAssemblyVerification, updateSavedBuildMetadata, updateSavedBuildMonitorState, updateSavedBuildPurchasePriceHistory, updateSavedBuildPurchaseProgress, updateSavedWatchlist, updateSavedWatchlistAlertStates, withSavedBuildMonitorLease } from "./repository";
import { DEFAULT_SAVED_WATCHLIST_ALERT_PREFERENCES, parseSavedCatalogWatchlistInput, parseSavedCatalogWatchlistUpdateInput, savedCatalogWatchlistExpired, savedWatchlistAlertPreferencesFor } from "./watchlist-store";
import { shareExpired, shareExpiryDaysFrom, shareExpiryValueProvided, shareExpiresAtFor } from "./share-lifecycle";
import { createShareOwnerCredential, shareOwnerOrEnabledAdminCanManage, shareOwnerTokenMatches, type SavedBuildRecord } from "./build-share";
import { createRateLimitMiddleware } from "./rate-limit";
import { publicSavedCatalogWatchlist, type SavedCatalogWatchlistRecord } from "./watchlist-share";
import { parsePublicPriceHistoryIds, parsePublicPriceHistoryWindow } from "./public-price-history";
import { alternativePerformanceFilterFromUnknown, alternativePerformanceMatches } from "./alternative-performance";
import { physicalEvidenceFilterFromUnknown, physicalEvidenceMatches } from "../shared/physical-evidence-filter";
import { alternativeComparisonExpired, alternativeComparisonExpiresAtFor, parseAlternativeComparisonInput, publicAlternativeComparison, type SavedAlternativeComparisonRecord } from "./comparison-share";
import { budgetLadderShareExpired, budgetLadderShareExpiresAtFor, parseBudgetLadderShareInput, publicBudgetLadderShare } from "./budget-ladder-share";
import type { SavedBudgetLadderRecord } from "../shared/budget-ladder-share";
import { budgetLadderShareLineageEntryFor, type BudgetLadderShareLineageResponse } from "../shared/budget-ladder-share";
import { budgetLadderScenariosFor } from "../shared/budget-ladder";
import { savedWatchlistAlertsFor, type SavedWatchlistAlert } from "./watchlist-alerts";
import { parseSavedWatchlistAlertIds } from "./watchlist-alert-state";
import { adminAuthEnabled, adminSession, isAdminAuthenticated, loginAdmin, logoutAdmin, requireAdmin } from "./auth";
import { deleteM2SlotOverride, m2SlotOverrideCompleteness, normalizeM2SlotId, readM2SlotOverrides, saveM2SlotOverride, saveM2SlotOverrides, validateM2SlotOverride } from "./m2-overrides";
import { deleteGpuPhysicalOverride, readGpuPhysicalOverrides, saveGpuPhysicalOverride, saveGpuPhysicalOverrides, saveGpuPhysicalSourceCheck, validateGpuPhysicalOverride, validateGpuPhysicalOverrideBatch } from "./gpu-physical-overrides";
import { physicalReviewCoverageFor, physicalReviewQueueFor, physicalReviewWorkPackageFor } from "./gpu-physical-review";
import { checkPhysicalSourceUrl } from "./physical-source-check";
import { physicalSourceCheckBatchFor } from "./physical-source-check-batch";
import { appendPhysicalSourceCheckHistory, readPhysicalSourceCheckHistory } from "./physical-source-check-history";
import { accessoryRefreshBlockReason, accessoryRefreshResponse, partRefreshBlockReason, partRefreshResponse, refreshDanawaAccessory, refreshDanawaPart } from "./part-refresh";
import { appendCatalogChangeRecord, appendCatalogChangeRecords, catalogChangeRecord, meaningfulCatalogChangeFields, readCatalogChangeLog, readCatalogChangeRecords } from "./catalog-change-log";
import { catalogChangePriceHistoryFor, catalogChangePriceHistoryWithinWindowFor, catalogChangePriceWindowSummaryFor } from "../shared/catalog-change-analytics";
import { catalogMissingFieldCountsFor } from "../shared/catalog-spec-coverage";
import { catalogCategoryMismatchFor } from "../shared/catalog-category-integrity";
import { catalogCategoryIntegrityReviewPackageFor } from "../shared/catalog-category-integrity-review";
import { catalogPcieRefreshImpactFor, catalogSpecRefreshCoverageDeltaFor, catalogSpecRefreshCoverageSummaryFor, catalogSpecRefreshImpactFor, catalogSpecRefreshProgressSummaryFor, catalogSpecReviewWorkPackageFor, type CatalogSpecReviewAction, type CatalogSpecReviewEvidence, type CatalogSpecReviewPriority } from "../shared/catalog-spec-review";
import { pcieSlotEvidenceMissingFieldsFor } from "../shared/pcie-slot";
import { catalogSpecOverrideListItems, deleteCatalogSpecOverride, readCatalogSpecOverrides, saveCatalogSpecOverrideSourceCheck, saveCatalogSpecOverrides, sortedCatalogSpecOverrides, validateCatalogSpecOverrideBatch, type CatalogSpecOverrideBatchValidation } from "./catalog-spec-overrides";
import { appendCatalogSpecOverrideSourceCheckHistory, readCatalogSpecOverrideSourceCheckHistory } from "./catalog-spec-override-source-check-history";
import { catalogSpecSourceCheckBatchFor } from "./catalog-spec-source-check-batch";
import type { CatalogSpecRefreshBatchFilters, CatalogSpecRefreshBatchItem, CatalogSpecRefreshBatchResponse } from "../shared/catalog-spec-review";
import { appendCatalogSpecRefreshHistory, catalogSpecRefreshHistoryEntryFor, newCatalogSpecRefreshRunId, readCatalogSpecRefreshHistory } from "./catalog-spec-refresh-history";
import { alternativeCandidateWithinBudget } from "./alternative-budget";
import { deleteBenchmarkOverride, readBenchmarkOverrides, saveBenchmarkOverrides, saveBenchmarkSourceCheck, sortedBenchmarkOverrides, validateBenchmarkOverrideBatch, type BenchmarkOverrideBatchValidation } from "./benchmark-overrides";
import { appendBenchmarkSourceCheckHistory, readBenchmarkSourceCheckHistory } from "./benchmark-source-check-history";
import { benchmarkSourceCheckBatchFor } from "./benchmark-source-check-batch";
import { Benchmark3DMarkImportError, import3DMarkResult } from "./benchmark-3dmark";
import { BENCHMARK_3DMARK_BATCH_MAX_ITEMS, benchmark3DMarkBatchPreviewFor } from "./benchmark-3dmark-batch";
import { caseRgbLoadCoverageFor, caseRgbLoadOverrideListItems, deleteCaseRgbLoadOverride, readCaseRgbLoadOverrides, saveCaseRgbLoadOverrides, validateCaseRgbLoadOverride, validateCaseRgbLoadOverrideBatch, type CaseRgbLoadOverrideBatchValidation } from "./case-rgb-load-overrides";
import { coolingFanLoadCoverageFor, coolingFanLoadOverrideListItems, deleteCoolingFanLoadOverride, readCoolingFanLoadOverrides, saveCoolingFanLoadOverrides, validateCoolingFanLoadOverride, validateCoolingFanLoadOverrideBatch, type CoolingFanLoadOverrideBatchValidation } from "./cooling-fan-load-overrides";
import { recommendationTrustCountsFor, recommendationTrustFilterFromUnknown, recommendationTrustFor, recommendationTrustMatchesFilter } from "./recommendation-trust";
import { benchmark3DMarkReviewWorkPackageFor, benchmarkReviewQueueFor } from "./benchmark-review";
import { savedBuildCheckSnapshotFor as compactSavedBuildCheckSnapshotFor, savedBuildCheckTransitionSummaryFor } from "../shared/saved-build-check";
import { SAVED_BUILD_VERSION_MIGRATION_CONFIRMATION, SAVED_BUILD_VERSION_ROLLBACK_CONFIRMATION, savedBuildVersionAuditFor, savedBuildVersionGroupIdFor, savedBuildVersionMigrationPreviewFor } from "../shared/saved-build-version";
import type { SavedBuildMonitorItem, SavedBuildMonitorResponse } from "../shared/saved-build-monitor";
import { savedBuildCatalogChangeCausesFor } from "../shared/saved-build-change-causes";
import { parseSavedBuildMonitorRequest } from "./build-monitor";
import { completeSavedBuildMonitorRun, configureSavedBuildMonitorSubscription, defaultSavedBuildMonitorSubscription, failSavedBuildMonitorRun, parseSavedBuildMonitorAlertIds, parseSavedBuildMonitorSettings, SAVED_BUILD_SERVER_MONITOR_SCHEDULER_BATCH_LIMIT, savedBuildMonitorSubscriptionDue, updateSavedBuildMonitorAlertState } from "../shared/saved-build-monitor-subscription";
import type { SavedBuildMonitorSubscriptionResponse } from "../shared/saved-build-monitor-subscription";
import { compatibilityRequestKey, compatibilityResultCache, compatibilityResultCacheKey, InFlightDeduper, TtlLruInFlightCache, type CompatibilityResponseCacheValue } from "./compatibility-cache";
import { savedBuildCheckPreviewCache, savedBuildCheckPreviewCacheKey } from "./saved-build-check-cache";
import { accessoryCompatibilityFor } from "./accessory-compatibility";
import { parseCatalogBatchIds, parseCatalogBatchQuery } from "./catalog-batch";
import { entityTagFor, ifNoneMatchMatches } from "./http-cache";
import { upgradeBundlePayloadFor } from "../shared/upgrade-bundle-transport";
import { candidateDecisionSummaryFor } from "../shared/candidate-decision";
import { assemblyVerificationSavedHistoryFor, parseAssemblyVerificationHistoryJson } from "../shared/assembly-verification";
import { buildCompatibilityInputFingerprint } from "../shared/build-fingerprint";
import { catalogRefreshReportFromUnknown } from "../shared/catalog-refresh-report";
import type { CatalogRefreshReport } from "../shared/catalog-refresh-report";
import { savedBuildDecisionNoteFromUnknown, savedBuildNameFromUnknown, SAVED_BUILD_DECISION_NOTE_MAX_LENGTH, SAVED_BUILD_NAME_MAX_LENGTH } from "../shared/saved-build-decision-note";
import { parseSavedBuildPurchaseProgress, parseSavedBuildPurchaseProgressExpectedRevision, parseSavedBuildPurchaseProgressRevision } from "./purchase-progress";
import { parseSavedBuildPurchasePriceHistory, parseSavedBuildPurchasePriceHistoryExpectedRevision, parseSavedBuildPurchasePriceHistoryRevision } from "./purchase-price-history";
import { isListingAllowed } from "./listing";
import { catalogSeedPreviewFor } from "../shared/catalog-seed-preview";
import { catalogSeedMappingIdentityCompatibleFor, catalogSeedMappingPreviewFor } from "../shared/catalog-seed-mapping";
import { catalogSeedCollectionQueueFor } from "../shared/catalog-seed-collection-queue";
import { starterCatalog } from "./seed-catalog-starter";
import { catalogSeedMappingReviewConflictFor, deleteCatalogSeedMappingReview, readCatalogSeedMappingReviews, saveCatalogSeedMappingReview, sourceIdentitiesFor, validateCatalogSeedMappingManualInput, validateCatalogSeedMappingReview } from "./catalog-seed-mappings";
import { publicCrawlStatusFor } from "../shared/public-crawl-status";
import { savedBuildVersionComparisonExportFor, savedBuildVersionComparisonTextFor } from "../shared/saved-build-version-export";
import { publicSavedBuildVersionComparisonShare, parseSavedBuildVersionComparisonShareInput, savedBuildVersionComparisonShareExpired, savedBuildVersionComparisonShareExpiresAtFor, savedBuildVersionComparisonSharePayloadFor, type SavedBuildVersionComparisonShareRecord } from "../shared/saved-build-version-share";
import { BUILD_INPUT_MAX_ID_LENGTH, BUILD_INPUT_MAX_M2_SLOTS, BUILD_INPUT_MAX_SELECTIONS_PER_LIST } from "../shared/build-input-limits";

const app = express();
const port = Number(process.env.PORT ?? 4174);
let catalogSeedMappingPreviewCache: { key: string; value: ReturnType<typeof catalogSeedMappingPreviewFor> } | undefined;
let catalogSeedMappingPreviewCacheEpoch = 0;
let catalogSeedMappingPreviewInFlight: { key: string; epoch: number; promise: Promise<ReturnType<typeof catalogSeedMappingPreviewFor>> } | undefined;

function isLoopbackProxyAddress(address: string) {
  const normalized = address.replace(/^::ffff:/i, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

// Caddy runs on the same host; trust only loopback so direct clients cannot spoof X-Forwarded-For.
app.set("trust proxy", isLoopbackProxyAddress);

function isApiPath(path: string) {
  return path === "/api" || path.startsWith("/api/");
}

const defaultCorsOrigins = new Set(["capacitor://localhost", "https://localhost", "http://localhost"]);
const configuredCorsOrigins = new Set((process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean));
const allowedCorsOrigins = new Set([...defaultCorsOrigins, ...configuredCorsOrigins]);

app.use((request, response, next) => {
  const origin = request.header("Origin");
  if (origin && allowedCorsOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type, If-Modified-Since, If-None-Match, X-Share-Owner-Token");
    response.setHeader("Access-Control-Expose-Headers", "ETag, Last-Modified, Retry-After");
    response.setHeader("Access-Control-Max-Age", "600");
    response.vary("Origin");
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
  }
  next();
});

app.use(express.json({ limit: "1mb" }));

type JsonBodyParserError = Error & {
  type?: string;
  status?: number;
  statusCode?: number;
};

function jsonBodyErrorHandler(error: unknown, _request: Request, response: Response, next: NextFunction) {
  const parserError = error as JsonBodyParserError;
  const status = parserError.status ?? parserError.statusCode;
  if (parserError.type === "entity.parse.failed" || error instanceof SyntaxError && status === 400) {
    response.status(400).json({ error: "요청 본문 JSON 형식이 올바르지 않습니다.", code: "INVALID_JSON" });
    return;
  }
  if (parserError.type === "entity.too.large" || status === 413) {
    response.status(413).json({ error: "요청 본문이 너무 큽니다.", code: "REQUEST_BODY_TOO_LARGE" });
    return;
  }
  next(error);
}

// Keep parser failures in the JSON API contract without swallowing unrelated route errors.
app.use(jsonBodyErrorHandler);

const emptyBuild = (): BuildSelection => ({
  memory: [],
  ssd: [],
  hdd: [],
  accessories: [],
  useIntegratedGraphics: true
});

function evaluateBuildWithAccessories(
  build: BuildSelection,
  catalog: Part[],
  accessories: Awaited<ReturnType<typeof loadAccessories>>,
  catalogSnapshotAt: string,
  recommendationPreferences: RecommendationPreferences,
  includeSuggestions = true
): CompatibilityResult {
  const result = evaluateBuild(build, catalog, {
    catalogSnapshotAt,
    recommendationPreferences,
    ...(includeSuggestions ? {} : { includeSuggestions: false, includeAnalysis: true })
  });
  result.coreTotalPriceWon = result.totalPriceWon;
  result.corePriceComplete = result.priceComplete;
  result.dataHealth = summarizeBuildDataHealth(build, catalog, accessories);
  if (includeSuggestions) result.accessoryRecommendations = recommendAccessories(build, catalog, accessories).map((recommendation) => ({
    ...recommendation,
    item: { ...recommendation.item, dataFreshness: classifyDataFreshness(recommendation.item.updatedAt) }
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

function compatibilityResponseFor(result: CompatibilityResult): CompatibilityResult {
  if (!result.upgradeBundles) return result;
  const { upgradeBundles: _fullBundles, ...withoutFullBundles } = result;
  return { ...withoutFullBundles, upgradeBundlePayload: upgradeBundlePayloadFor(result.upgradeBundles) };
}

function catalogRefreshReportForRequest(value: unknown, build: BuildSelection, preferences: RecommendationPreferences): { report?: CatalogRefreshReport; error?: string } {
  if (value === undefined) return {};
  const report = catalogRefreshReportFromUnknown(value);
  if (!report) return { error: "정보 다시 확인 보고서 형식이 올바르지 않습니다." };
  const expectedFingerprint = buildCompatibilityInputFingerprint(build, preferences);
  if (report.inputFingerprint !== expectedFingerprint) return { error: "정보 다시 확인 보고서가 현재 견적·추천 기준과 일치하지 않습니다." };
  const selectedPartIds = PART_CATEGORIES.flatMap((category) => {
    if (category === "memory") return build.memory.map((selection) => selection.partId);
    if (category === "ssd") return build.ssd.map((selection) => selection.partId);
    if (category === "hdd") return build.hdd.map((selection) => selection.partId);
    const selection = build[category];
    return selection ? [selection.partId] : [];
  });
  const selectedAccessoryIds = (build.accessories ?? []).map((selection) => selection.accessoryId);
  const allTargets = [...report.items.map((item) => item.target), ...report.failures.map((failure) => failure.target)];
  if (allTargets.some((target) => target.kind === "part" ? !selectedPartIds.includes(target.id) : !selectedAccessoryIds.includes(target.id))) return { error: "정보 다시 확인 보고서의 대상이 현재 견적에 포함되어 있지 않습니다." };
  return { report };
}

function sendJsonWithEtag(request: Request, response: Response, payload: unknown, lastModified?: string) {
  const entityTag = entityTagFor(payload);
  response.setHeader("ETag", entityTag);
  response.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  const lastModifiedMs = lastModified ? Date.parse(lastModified) : Number.NaN;
  if (Number.isFinite(lastModifiedMs)) response.setHeader("Last-Modified", new Date(Math.floor(lastModifiedMs / 1_000) * 1_000).toUTCString());
  const ifNoneMatch = request.header("if-none-match");
  const ifModifiedSinceMs = Date.parse(request.header("if-modified-since") ?? "");
  const notModifiedByDate = !ifNoneMatch && Number.isFinite(lastModifiedMs) && Number.isFinite(ifModifiedSinceMs) && Math.floor(lastModifiedMs / 1_000) * 1_000 <= ifModifiedSinceMs;
  if (ifNoneMatchMatches(ifNoneMatch, entityTag) || notModifiedByDate) {
    response.status(304).end();
    return;
  }
  response.json(payload);
}

function isCategory(value: unknown): value is PartCategory {
  return typeof value === "string" && PART_CATEGORIES.includes(value as PartCategory);
}

function dataFreshnessFromUnknown(value: unknown): DataFreshness | "all" {
  const raw = typeof value === "string" ? value : "all";
  return ["all", "fresh", "aging", "stale", "unknown"].includes(raw) ? raw as DataFreshness | "all" : "all";
}

function priceAvailabilityFromUnknown(value: unknown): PriceAvailabilityFilter {
  return value === "known" || value === "unknown" ? value : "all";
}

function benchmarkAvailabilityFromUnknown(value: unknown, category: PartCategory | undefined): BenchmarkAvailabilityFilter {
  if (category !== "cpu" && category !== "gpu") return "all";
  return value === "complete" || value === "incomplete" ? value : "all";
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function boundedCrawlInteger(value: number, minimum: number, maximum: number) {
  return Number.isFinite(value) && Number.isInteger(value) && value >= minimum && value <= maximum;
}

const MAX_M2_OVERRIDE_BATCH_SIZE = 500;
const PART_REFRESH_COOLDOWN_MS = 15_000;
const MAX_CRAWL_PAGES = 1_000;
const MAX_CRAWL_BATCH_SIZE = 1_000;
const MAX_CRAWL_DELAY_MS = 60_000;
const partRefreshJobs = new Map<string, Promise<PartRefreshResponse>>();
const partRefreshLastRunAt = new Map<string, number>();
const accessoryRefreshJobs = new Map<string, Promise<AccessoryRefreshResponse>>();
const accessoryRefreshLastRunAt = new Map<string, number>();
const buildCreateRateLimit = createRateLimitMiddleware("build-create", { limit: 20, windowMs: 60_000 });
const buildShareRateLimit = createRateLimitMiddleware("build-share", { limit: 120, windowMs: 60_000 });
const buildListRateLimit = createRateLimitMiddleware("build-list", { limit: 120, windowMs: 60_000 });
const buildMonitorRateLimit = createRateLimitMiddleware("build-monitor", { limit: 20, windowMs: 60_000 });
const catalogRefreshRateLimit = createRateLimitMiddleware("catalog-refresh", { limit: 30, windowMs: 60_000 });
const publicCatalogReadRateLimit = createRateLimitMiddleware("public-catalog-read", { limit: 180, windowMs: 60_000 });
const publicCatalogDetailRateLimit = createRateLimitMiddleware("public-catalog-detail", { limit: 240, windowMs: 60_000 });
const publicCatalogBatchRateLimit = createRateLimitMiddleware("public-catalog-batch", { limit: 60, windowMs: 60_000 });
const publicAccessoryReadRateLimit = createRateLimitMiddleware("public-accessory-read", { limit: 180, windowMs: 60_000 });
const publicAccessoryDetailRateLimit = createRateLimitMiddleware("public-accessory-detail", { limit: 240, windowMs: 60_000 });
const publicAccessoryBatchRateLimit = createRateLimitMiddleware("public-accessory-batch", { limit: 60, windowMs: 60_000 });
const publicCandidateRateLimit = createRateLimitMiddleware("public-candidate", { limit: 60, windowMs: 60_000 });
const publicCompatibilityRateLimit = createRateLimitMiddleware("public-compatibility", { limit: 60, windowMs: 60_000 });
const publicRecommendationRateLimit = createRateLimitMiddleware("public-recommendation", { limit: 20, windowMs: 60_000 });
const catalogSpecRefreshBatchRateLimit = createRateLimitMiddleware("catalog-spec-refresh-batch", { limit: 5, windowMs: 60_000 });
const catalogSpecSourceCheckBatchRateLimit = createRateLimitMiddleware("catalog-spec-source-check-batch", { limit: 5, windowMs: 60_000 });
const catalogSeedMappingManualRateLimit = createRateLimitMiddleware("catalog-seed-mapping-manual", { limit: 10, windowMs: 60_000 });
const benchmark3DMarkImportRateLimit = createRateLimitMiddleware("benchmark-3dmark-import", { limit: 20, windowMs: 60_000 });
const benchmark3DMarkBatchImportRateLimit = createRateLimitMiddleware("benchmark-3dmark-import-batch", { limit: 4, windowMs: 60_000 });
const adminCatalogCrawlRateLimit = createRateLimitMiddleware("admin-catalog-crawl", { limit: 10, windowMs: 60_000 });
const adminAccessoryCrawlRateLimit = createRateLimitMiddleware("admin-accessory-crawl", { limit: 10, windowMs: 60_000 });
const adminCatalogCrawlRetryRateLimit = createRateLimitMiddleware("admin-catalog-crawl-retry", { limit: 10, windowMs: 60_000 });
const adminCatalogCrawlRetryBatchRateLimit = createRateLimitMiddleware("admin-catalog-crawl-retry-batch", { limit: 5, windowMs: 60_000 });
const adminVersionMigrationRateLimit = createRateLimitMiddleware("admin-version-migration", { limit: 5, windowMs: 60_000 });
const adminVersionRollbackRateLimit = createRateLimitMiddleware("admin-version-rollback", { limit: 5, windowMs: 60_000 });
const gpuPhysicalSourceCheckBatchRateLimit = createRateLimitMiddleware("gpu-physical-source-check-batch", { limit: 5, windowMs: 60_000 });
const benchmarkSourceCheckBatchRateLimit = createRateLimitMiddleware("benchmark-source-check-batch", { limit: 5, windowMs: 60_000 });
const catalogSpecSourceCheckRateLimit = createRateLimitMiddleware("catalog-spec-source-check", { limit: 30, windowMs: 60_000 });
const gpuPhysicalSourceCheckRateLimit = createRateLimitMiddleware("gpu-physical-source-check", { limit: 30, windowMs: 60_000 });
const benchmarkSourceCheckRateLimit = createRateLimitMiddleware("benchmark-source-check", { limit: 30, windowMs: 60_000 });
const catalogSpecSourceCheckJobs = new Map<string, Promise<import("../shared/types").PhysicalSourceCheck>>();
const catalogSpecSourceCheckLastRunAt = new Map<string, number>();
const gpuPhysicalSourceCheckJobs = new Map<string, Promise<import("../shared/types").PhysicalSourceCheck>>();
const gpuPhysicalSourceCheckLastRunAt = new Map<string, number>();
const benchmarkSourceCheckJobs = new Map<string, Promise<import("../shared/types").PhysicalSourceCheck>>();
const benchmarkSourceCheckLastRunAt = new Map<string, number>();

type CompatibilityApiOutcome =
  | { status: "ok"; result: CompatibilityResult; body: string; cacheLookup: "HIT" | "MISS" }
  | { status: "error"; statusCode: number; body: Record<string, unknown> };

const compatibilityRequestDeduper = new InFlightDeduper<CompatibilityApiOutcome>();
type CompatiblePartAssessmentRow = {
  part: Part;
  assessment: ReturnType<typeof assessAlternativePart>;
  similarity: ReturnType<typeof candidateSimilarityForBuild>;
  recommendationTrust: ReturnType<typeof recommendationTrustFor>;
  decision: ReturnType<typeof candidateDecisionSummaryFor>;
};
type CompatiblePartAssessmentCacheValue = {
  intentFinding?: Finding;
  assessedParts: CompatiblePartAssessmentRow[];
  priceExcludedCount: number;
  freshnessExcludedCount: number;
  specExcludedCount: number;
  specFilterDiagnostics: ReturnType<typeof partSpecFilterDiagnosticsFor>;
};
const compatiblePartAssessmentCache = new TtlLruInFlightCache<CompatiblePartAssessmentCacheValue>({ ttlMs: 2 * 60 * 1000, maxEntries: 40 });
const watchlistCreateRateLimit = createRateLimitMiddleware("watchlist-create", { limit: 10, windowMs: 60_000 });
const watchlistShareRateLimit = createRateLimitMiddleware("watchlist-share", { limit: 120, windowMs: 60_000 });
const watchlistUpdateRateLimit = createRateLimitMiddleware("watchlist-update", { limit: 30, windowMs: 60_000 });
const watchlistAlertRateLimit = createRateLimitMiddleware("watchlist-alert", { limit: 60, windowMs: 60_000 });
const publicPriceHistoryRateLimit = createRateLimitMiddleware("public-price-history", { limit: 60, windowMs: 60_000 });
const comparisonCreateRateLimit = createRateLimitMiddleware("comparison-create", { limit: 10, windowMs: 60_000 });
const comparisonShareRateLimit = createRateLimitMiddleware("comparison-share", { limit: 120, windowMs: 60_000 });
const versionComparisonCreateRateLimit = createRateLimitMiddleware("version-comparison-create", { limit: 10, windowMs: 60_000 });
const versionComparisonShareRateLimit = createRateLimitMiddleware("version-comparison-share", { limit: 120, windowMs: 60_000 });
const budgetLadderCreateRateLimit = createRateLimitMiddleware("budget-ladder-create", { limit: 10, windowMs: 60_000 });
const budgetLadderShareRateLimit = createRateLimitMiddleware("budget-ladder-share", { limit: 120, windowMs: 60_000 });
const adminLoginRateLimit = createRateLimitMiddleware("admin-login", { limit: 10, windowMs: 60_000 });

const requirePartRefreshAccess: RequestHandler = (request, response, next) => {
  if (adminAuthEnabled()) {
    requireAdmin(request, response, next);
    return;
  }
  next();
};

type M2SlotBatchValidationItem = {
  partId: string;
  partName?: string;
  valid: boolean;
  complete: boolean;
  errors: string[];
  override?: M2SlotOverride;
};

type M2SlotBatchValidation = {
  items: M2SlotBatchValidationItem[];
  validOverrides: M2SlotOverride[];
  errors: string[];
};

function sortM2SlotOverrides(overrides: Record<string, M2SlotOverride>) {
  return Object.values(overrides).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function validateM2SlotOverrideForPart(partId: string, part: Awaited<ReturnType<typeof loadCatalog>>[number], input: unknown) {
  const validation = validateM2SlotOverride(partId, input);
  const errors = [...validation.errors];
  if (validation.value) {
    const expectedSlotCount = part.specs.m2Slots;
    if (expectedSlotCount !== undefined && validation.value.slots.length !== expectedSlotCount) {
      errors.push(`등록한 슬롯 수가 메인보드의 M.2 슬롯 수(${expectedSlotCount}개)와 다릅니다.`);
    }
    const expectedSlotIds = new Set(Array.from({ length: expectedSlotCount ?? validation.value.slots.length }, (_value, index) => `M2_${index + 1}`));
    if (validation.value.slots.some((slot) => !expectedSlotIds.has(slot.slotId)) || validation.value.slots.length !== expectedSlotIds.size) {
      errors.push(`M2_1부터 M2_${expectedSlotCount ?? validation.value.slots.length}까지 슬롯을 빠짐없이 등록해 주세요.`);
    }
  }
  return {
    value: errors.length === 0 ? validation.value : undefined,
    errors
  };
}

export function validateM2SlotOverrideBatch(input: unknown, catalog: Awaited<ReturnType<typeof loadCatalog>>): M2SlotBatchValidation {
  const errors: string[] = [];
  const rawItems: unknown[] | undefined = Array.isArray(input)
    ? input
    : input && typeof input === "object" && !Array.isArray(input) && Array.isArray((input as Record<string, unknown>).items)
      ? (input as Record<string, unknown>).items as unknown[]
      : undefined;
  if (!rawItems) return { items: [], validOverrides: [], errors: ["items는 M.2 override 배열이어야 합니다."] };
  if (rawItems.length < 1) return { items: [], validOverrides: [], errors: ["items는 최소 1개가 필요합니다."] };
  if (rawItems.length > MAX_M2_OVERRIDE_BATCH_SIZE) {
    return { items: [], validOverrides: [], errors: [`한 번에 최대 ${MAX_M2_OVERRIDE_BATCH_SIZE}개 메인보드까지 처리할 수 있습니다.`] };
  }

  const seenPartIds = new Set<string>();
  const items: M2SlotBatchValidationItem[] = [];
  const validOverrides: M2SlotOverride[] = [];
  rawItems.forEach((rawItem, index) => {
    const itemErrors: string[] = [];
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      items.push({ partId: `items[${index}]`, valid: false, complete: false, errors: ["항목은 객체여야 합니다."] });
      return;
    }
    const candidate = rawItem as Record<string, unknown>;
    const partId = typeof candidate.partId === "string" ? candidate.partId.trim() : "";
    if (!partId) {
      items.push({ partId: `items[${index}]`, valid: false, complete: false, errors: ["partId가 필요합니다."] });
      return;
    }
    if (seenPartIds.has(partId)) itemErrors.push("같은 partId가 일괄 입력에서 중복되었습니다.");
    seenPartIds.add(partId);
    const part = findPart(catalog, partId);
    if (!part || part.category !== "motherboard") {
      itemErrors.push("카탈로그에서 메인보드를 찾을 수 없습니다.");
    }
    if (part && part.category === "motherboard") {
      const validation = validateM2SlotOverrideForPart(partId, part, candidate);
      itemErrors.push(...validation.errors);
      const complete = validation.value ? m2SlotOverrideCompleteness(part, validation.value).complete : false;
      if (itemErrors.length === 0 && validation.value) validOverrides.push(validation.value);
      items.push({
        partId,
        partName: part.name,
        valid: itemErrors.length === 0,
        complete,
        errors: itemErrors,
        ...(itemErrors.length === 0 && validation.value ? { override: validation.value } : {})
      });
      return;
    }
    items.push({ partId, valid: false, complete: false, errors: itemErrors });
  });
  errors.push(...items.flatMap((item) => item.errors.map((error) => `${item.partId}: ${error}`)));
  return { items, validOverrides: errors.length === 0 ? validOverrides : [], errors };
}

function m2BatchValidationCounts(validation: M2SlotBatchValidation) {
  const validItems = validation.items.filter((item) => item.valid);
  return {
    validCount: validItems.length,
    invalidCount: validation.items.length - validItems.length,
    completeCount: validItems.filter((item) => item.complete).length,
    incompleteCount: validItems.filter((item) => !item.complete).length
  };
}

function benchmarkOverrideValidationCounts(validation: BenchmarkOverrideBatchValidation) {
  const validCount = validation.items.filter((item) => item.valid).length;
  return {
    validCount,
    invalidCount: validation.items.length - validCount
  };
}

function m2CoveragePriority(part: Awaited<ReturnType<typeof loadCatalog>>[number], status: M2MappingStatus) {
  const slotCount = part.specs.m2Slots ?? 0;
  const generations = part.specs.m2PcieGenerations;
  const hasMixedGenerations = generations !== undefined && new Set(generations).size > 1;
  if (status === "mapped") {
    return { reviewPriority: "low" as const, reviewPriorityScore: 0, reviewReason: "슬롯별 매핑 완료" };
  }
  const reasons: string[] = [];
  let score = status === "stale" ? 65 : status === "incomplete" ? 35 : 25;
  if (status === "stale") reasons.push("카탈로그 정보가 매핑 이후 갱신됨 · 재확인 필요");
  else if (status === "incomplete") reasons.push("기존 매핑의 필수 정보 보완");
  else reasons.push("슬롯별 매핑 미등록");
  if (slotCount >= 2) {
    score += Math.min(25, slotCount * 5);
    reasons.push(`M.2 슬롯 ${slotCount}개`);
  }
  if (hasMixedGenerations) {
    score += 25;
    reasons.push("PCIe 세대가 복수로 집계됨");
  }
  if (part.specs.m2Interfaces === undefined) {
    score += 10;
    reasons.push("M.2 연결 정보 확인 필요");
  }
  if (part.specs.m2PcieGenerations === undefined) {
    score += 8;
    reasons.push("M.2 PCIe 세대 확인 필요");
  }
  if (part.dataQuality === "live") score += 5;
  const normalizedScore = Math.min(100, score);
  return {
    reviewPriority: normalizedScore >= 80 ? "high" as const : normalizedScore >= 55 ? "medium" as const : "low" as const,
    reviewPriorityScore: normalizedScore,
    reviewReason: reasons.join(" · ")
  };
}

function m2CoverageStatus(part: Awaited<ReturnType<typeof loadCatalog>>[number], override: M2SlotOverride | undefined): M2MappingStatus {
  if (!override) return "unmapped";
  if (!m2SlotOverrideCompleteness(part, override).complete) return "incomplete";
  const catalogUpdatedAt = Date.parse(part.updatedAt);
  const mappingUpdatedAt = Date.parse(override.updatedAt);
  return Number.isFinite(catalogUpdatedAt) && Number.isFinite(mappingUpdatedAt) && catalogUpdatedAt > mappingUpdatedAt
    ? "stale"
    : "mapped";
}

export function buildM2SlotCoverage(
  catalog: Awaited<ReturnType<typeof loadCatalog>>,
  overrides: Record<string, M2SlotOverride>,
  options: { filter?: M2CoverageFilter; query?: string; offset?: number; limit?: number } = {}
): M2SlotCoverage {
  const filter = options.filter ?? "needs_review";
  const query = options.query?.trim().toLocaleLowerCase();
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 20)));
  const eligibleParts = catalog.filter((part) => part.category === "motherboard" && (part.specs.m2Slots ?? 0) > 0);
  const items = eligibleParts.map((part): M2SlotCoverageItem => {
    const mappingStatus = m2CoverageStatus(part, overrides[part.id]);
    const priority = m2CoveragePriority(part, mappingStatus);
    return {
      partId: part.id,
      name: part.name,
      ...(part.brand ? { brand: part.brand } : {}),
      ...(part.specs.m2Slots !== undefined ? { m2Slots: part.specs.m2Slots } : {}),
      ...(part.specs.m2Interfaces ? { m2Interfaces: part.specs.m2Interfaces } : {}),
      ...(part.specs.m2PcieGenerations ? { m2PcieGenerations: part.specs.m2PcieGenerations } : {}),
      dataQuality: part.dataQuality,
      ...(part.priceWon !== undefined ? { priceWon: part.priceWon } : {}),
      ...(part.updatedAt ? { updatedAt: part.updatedAt } : {}),
      mappingStatus,
      ...priority
    };
  });
  const filtered = items
    .filter((item) => {
      if (filter === "all") return true;
      if (filter === "needs_review") return item.mappingStatus !== "mapped";
      return item.mappingStatus === filter;
    })
    .filter((item) => !query || `${item.partId} ${item.name} ${item.brand ?? ""}`.toLocaleLowerCase().includes(query))
    .sort((left, right) => right.reviewPriorityScore - left.reviewPriorityScore || left.name.localeCompare(right.name));
  const countByStatus = (status: M2MappingStatus) => items.filter((item) => item.mappingStatus === status).length;
  const mixedGenerationItems = items.filter((item) => item.m2PcieGenerations && new Set(item.m2PcieGenerations).size > 1);
  const buckets = new Map<number, M2SlotCoverageBucket>();
  for (const item of items) {
    if (item.m2Slots === undefined) continue;
    const bucket = buckets.get(item.m2Slots) ?? { slotCount: item.m2Slots, total: 0, mapped: 0, stale: 0, incomplete: 0, unmapped: 0 };
    bucket.total += 1;
    bucket[item.mappingStatus] += 1;
    buckets.set(item.m2Slots, bucket);
  }
  const mapped = countByStatus("mapped");
  return {
    generatedAt: new Date().toISOString(),
    filter,
    ...(options.query?.trim() ? { query: options.query.trim() } : {}),
    offset,
    limit,
    totals: {
      eligibleMotherboards: items.length,
      multiSlotMotherboards: items.filter((item) => (item.m2Slots ?? 0) > 1).length,
      mapped,
      stale: countByStatus("stale"),
      incomplete: countByStatus("incomplete"),
      unmapped: countByStatus("unmapped"),
      coveragePercent: items.length === 0 ? 100 : Math.round((mapped / items.length) * 1000) / 10,
      mixedGenerationMotherboards: mixedGenerationItems.length,
      unmappedMixedGenerationMotherboards: mixedGenerationItems.filter((item) => item.mappingStatus !== "mapped").length
    },
    bySlotCount: [...buckets.values()].sort((left, right) => left.slotCount - right.slotCount),
    items: filtered.slice(offset, offset + limit)
  };
}

function buildM2ReviewTemplateItem(part: Awaited<ReturnType<typeof loadCatalog>>[number], override: M2SlotOverride | undefined): M2SlotReviewTemplateItem {
  const slotCount = part.specs.m2Slots ?? 0;
  const existingSlots = Array.isArray(override?.slots) ? override.slots : [];
  const slots = Array.from({ length: slotCount }, (_value, index) => {
    const slotId = `M2_${index + 1}`;
    const existing = existingSlots.find((slot) => slot.slotId === slotId);
    return {
      slotId,
      ...(existing?.interfaces !== undefined ? { interfaces: [...existing.interfaces] } : {}),
      ...(existing?.pcieGeneration !== undefined ? { pcieGeneration: existing.pcieGeneration } : {}),
      ...(existing?.connection !== undefined ? { connection: existing.connection } : {}),
      ...(existing?.sharedWith !== undefined ? { sharedWith: [...existing.sharedWith] } : {})
    } satisfies M2SlotReviewTemplateItem["slots"][number];
  });
  return {
    partId: part.id,
    partName: part.name,
    slots,
    ...(override?.sourceNote ? { sourceNote: override.sourceNote } : {}),
    ...(override?.sourceUrl ? { sourceUrl: override.sourceUrl } : {})
  };
}

export function buildM2SlotReviewTemplate(
  catalog: Awaited<ReturnType<typeof loadCatalog>>,
  overrides: Record<string, M2SlotOverride>,
  options: { filter?: M2CoverageFilter; query?: string; offset?: number; limit?: number } = {}
): M2SlotReviewTemplate {
  const coverage = buildM2SlotCoverage(catalog, overrides, {
    filter: options.filter ?? "needs_review",
    query: options.query,
    offset: options.offset,
    limit: options.limit
  });
  const partsById = new Map(catalog.map((part) => [part.id, part]));
  return {
    generatedAt: new Date().toISOString(),
    filter: coverage.filter,
    offset: coverage.offset,
    limit: coverage.limit,
    items: coverage.items
      .map((item) => {
        const part = partsById.get(item.partId);
        return part ? buildM2ReviewTemplateItem(part, overrides[item.partId]) : undefined;
      })
      .filter((item): item is M2SlotReviewTemplateItem => Boolean(item))
  };
}

type BuildParseResult = {
  build: BuildSelection;
  errors: string[];
};

export const MAX_BUILD_SELECTIONS_PER_LIST = BUILD_INPUT_MAX_SELECTIONS_PER_LIST;
export const MAX_BUILD_ID_LENGTH = BUILD_INPUT_MAX_ID_LENGTH;
export const MAX_BUILD_M2_SLOTS = BUILD_INPUT_MAX_M2_SLOTS;

function parseSelection(value: unknown, label: string, errors: string[]) {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label}은 객체여야 합니다.`);
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.partId !== "string" || candidate.partId.trim().length === 0) {
    errors.push(`${label}.partId가 필요합니다.`);
    return undefined;
  }
  if (candidate.partId.trim().length > MAX_BUILD_ID_LENGTH) {
    errors.push(`${label}.partId는 ${MAX_BUILD_ID_LENGTH}자 이하의 ID여야 합니다.`);
    return undefined;
  }
  const rawQuantity = candidate.quantity ?? 1;
  const quantity = Number(rawQuantity);
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    errors.push(`${label}.quantity는 1부터 99 사이의 정수여야 합니다.`);
    return undefined;
  }
  return { partId: candidate.partId.trim(), quantity };
}

function parseSelectionList(value: unknown, label: string, errors: string[]) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${label}은 배열이어야 합니다.`);
    return [];
  }
  if (value.length > MAX_BUILD_SELECTIONS_PER_LIST) {
    errors.push(`${label}은 한 번에 최대 ${MAX_BUILD_SELECTIONS_PER_LIST}개까지 선택할 수 있습니다.`);
    return [];
  }
  return value
    .map((item, index) => parseSelection(item, `${label}[${index}]`, errors))
    .filter((selection): selection is NonNullable<ReturnType<typeof parseSelection>> => Boolean(selection));
}

function parseAccessorySelection(value: unknown, label: string, errors: string[]): AccessorySelection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label}은 객체여야 합니다.`);
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.accessoryId !== "string" || candidate.accessoryId.trim().length === 0) {
    errors.push(`${label}.accessoryId가 필요합니다.`);
    return undefined;
  }
  if (candidate.accessoryId.trim().length > MAX_BUILD_ID_LENGTH) {
    errors.push(`${label}.accessoryId는 ${MAX_BUILD_ID_LENGTH}자 이하의 ID여야 합니다.`);
    return undefined;
  }
  const quantity = Number(candidate.quantity ?? 1);
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    errors.push(`${label}.quantity는 1부터 99 사이의 정수여야 합니다.`);
    return undefined;
  }
  const targetPartId = candidate.targetPartId;
  if (targetPartId !== undefined && (typeof targetPartId !== "string" || targetPartId.trim().length === 0 || targetPartId.trim().length > MAX_BUILD_ID_LENGTH)) {
    errors.push(`${label}.targetPartId는 비어 있지 않은 ${MAX_BUILD_ID_LENGTH}자 이하 SSD ID여야 합니다.`);
    return undefined;
  }
  const targetAccessoryId = candidate.targetAccessoryId;
  if (targetAccessoryId !== undefined && (typeof targetAccessoryId !== "string" || targetAccessoryId.trim().length === 0 || targetAccessoryId.trim().length > MAX_BUILD_ID_LENGTH)) {
    errors.push(`${label}.targetAccessoryId는 비어 있지 않은 ${MAX_BUILD_ID_LENGTH}자 이하 팬 허브 ID여야 합니다.`);
    return undefined;
  }
  return { accessoryId: candidate.accessoryId.trim(), quantity, ...(typeof targetPartId === "string" ? { targetPartId: targetPartId.trim() } : {}), ...(typeof targetAccessoryId === "string" ? { targetAccessoryId: targetAccessoryId.trim() } : {}) };
}

function parseAccessorySelectionList(value: unknown, label: string, errors: string[]) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`${label}은 배열이어야 합니다.`);
    return [];
  }
  if (value.length > MAX_BUILD_SELECTIONS_PER_LIST) {
    errors.push(`${label}은 한 번에 최대 ${MAX_BUILD_SELECTIONS_PER_LIST}개까지 선택할 수 있습니다.`);
    return [];
  }
  return value
    .map((item, index) => parseAccessorySelection(item, `${label}[${index}]`, errors))
    .filter((selection): selection is AccessorySelection => Boolean(selection));
}

function parseM2SlotSelection(value: unknown, errors: string[]) {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("m2SlotSelection은 슬롯 ID와 SSD ID를 담은 객체여야 합니다.");
    return undefined;
  }
  const rawSlotKeys = Object.keys(value as Record<string, unknown>);
  if (rawSlotKeys.length > MAX_BUILD_M2_SLOTS) {
    errors.push(`m2SlotSelection은 최대 ${MAX_BUILD_M2_SLOTS}개 슬롯까지 지정할 수 있습니다.`);
    return undefined;
  }
  const normalized: Record<string, string> = {};
  for (const [rawSlotId, rawPartId] of Object.entries(value as Record<string, unknown>)) {
    const slotId = normalizeM2SlotId(rawSlotId);
    if (!slotId) {
      errors.push(`m2SlotSelection의 슬롯 ID ${rawSlotId}가 M2_1부터 M2_8 형식이 아닙니다.`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(normalized, slotId)) {
      errors.push(`${slotId} 슬롯이 m2SlotSelection에서 중복되었습니다.`);
      continue;
    }
    if (typeof rawPartId !== "string" || rawPartId.trim().length === 0 || rawPartId.trim().length > MAX_BUILD_ID_LENGTH) {
      errors.push(`${slotId}의 SSD ID는 ${MAX_BUILD_ID_LENGTH}자 이하이어야 합니다.`);
      continue;
    }
    normalized[slotId] = rawPartId.trim();
  }
  if (Object.keys(normalized).length > MAX_BUILD_M2_SLOTS) {
    errors.push(`m2SlotSelection은 최대 ${MAX_BUILD_M2_SLOTS}개 슬롯까지 지정할 수 있습니다.`);
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function parseBuild(value: unknown): BuildParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { build: emptyBuild(), errors: ["견적 본문은 객체여야 합니다."] };
  }
  const candidate = value as Record<string, unknown>;
  const errors: string[] = [];
  if (candidate.useIntegratedGraphics !== undefined && typeof candidate.useIntegratedGraphics !== "boolean") {
    errors.push("useIntegratedGraphics는 boolean이어야 합니다.");
  }
  const rgbControllerAccessoryId = candidate.rgbControllerAccessoryId;
  if (rgbControllerAccessoryId !== undefined && (typeof rgbControllerAccessoryId !== "string" || rgbControllerAccessoryId.trim().length === 0 || rgbControllerAccessoryId.trim().length > MAX_BUILD_ID_LENGTH)) {
    errors.push(`rgbControllerAccessoryId는 비어 있지 않은 ${MAX_BUILD_ID_LENGTH}자 이하 팬 허브 ID여야 합니다.`);
    }
  return {
    build: {
      cpu: parseSelection(candidate.cpu, "cpu", errors),
      cooler: parseSelection(candidate.cooler, "cooler", errors),
      motherboard: parseSelection(candidate.motherboard, "motherboard", errors),
      memory: parseSelectionList(candidate.memory, "memory", errors),
      gpu: parseSelection(candidate.gpu, "gpu", errors),
      ssd: parseSelectionList(candidate.ssd, "ssd", errors),
      hdd: parseSelectionList(candidate.hdd, "hdd", errors),
      case: parseSelection(candidate.case, "case", errors),
      psu: parseSelection(candidate.psu, "psu", errors),
      accessories: parseAccessorySelectionList(candidate.accessories, "accessories", errors),
      m2SlotSelection: parseM2SlotSelection(candidate.m2SlotSelection, errors),
      ...(typeof rgbControllerAccessoryId === "string" ? { rgbControllerAccessoryId: rgbControllerAccessoryId.trim() } : {}),
      useIntegratedGraphics: candidate.useIntegratedGraphics !== false
    },
    errors
  };
}

export function parseRecommendationPreferences(value: unknown): RecommendationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { priority: "balanced", profile: "general", listingPolicy: "retail_only" };
  const candidate = value as Record<string, unknown>;
  const priority = isRecommendationPriority(candidate.priority)
    ? candidate.priority
    : "balanced";
  const rawBudget = Number(candidate.budgetWon);
  const budgetWon = Number.isFinite(rawBudget) && Number.isInteger(rawBudget) && rawBudget > 0 && rawBudget <= 100_000_000
    ? rawBudget
    : undefined;
  const profile = ["general", "gaming", "creator", "development", "office"].includes(String(candidate.profile))
    ? candidate.profile as RecommendationProfile
    : "general";
  const listingPolicy = ["retail_only", "include_bulk", "all"].includes(String(candidate.listingPolicy))
    ? candidate.listingPolicy as ListingPolicy
    : "retail_only";
  const gamingResolution = ["1080p", "1440p", "4k"].includes(String(candidate.gamingResolution))
    ? candidate.gamingResolution as RecommendationPreferences["gamingResolution"]
    : undefined;
  const gamingRefreshRate = [60, 144, 240].includes(Number(candidate.gamingRefreshRate))
    ? Number(candidate.gamingRefreshRate) as RecommendationPreferences["gamingRefreshRate"]
    : undefined;
  return gamingResolution === undefined && gamingRefreshRate === undefined
    ? { priority, profile, budgetWon, listingPolicy }
    : { priority, profile, budgetWon, listingPolicy, ...(gamingResolution ? { gamingResolution } : {}), ...(profile === "gaming" && gamingRefreshRate ? { gamingRefreshRate } : {}) };
}

export function parseBuildGenerationRequest(value: unknown): { request?: BuildGenerationRequest; errors: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: ["자동 견적 요청은 객체여야 합니다."] };
  }
  const candidate = value as Record<string, unknown>;
  const errors: string[] = [];
  const profile = ["general", "gaming", "creator", "development", "office"].includes(String(candidate.profile))
    ? candidate.profile as RecommendationProfile
    : "general";
  const priority = isRecommendationPriority(candidate.priority)
    ? candidate.priority
    : "balanced";
  const budgetWon = Number(candidate.budgetWon);
  if (!Number.isFinite(budgetWon) || !Number.isInteger(budgetWon) || budgetWon <= 0 || budgetWon > 100_000_000) {
    errors.push("budgetWon은 1원부터 100,000,000원 사이의 정수여야 합니다.");
  }
  if (candidate.includeGpu !== undefined && typeof candidate.includeGpu !== "boolean") {
    errors.push("includeGpu는 boolean이어야 합니다.");
  }
  if (candidate.priority !== undefined && !isRecommendationPriority(candidate.priority)) {
    errors.push("priority는 balanced, budget, performance, reliability 중 하나여야 합니다.");
  }
  if (candidate.includeNonRetail !== undefined && typeof candidate.includeNonRetail !== "boolean") {
    errors.push("includeNonRetail은 boolean이어야 합니다.");
  }
  if (candidate.gamingResolution !== undefined && !["1080p", "1440p", "4k"].includes(String(candidate.gamingResolution))) {
    errors.push("gamingResolution은 1080p, 1440p, 4k 중 하나여야 합니다.");
  }
  if (candidate.gamingRefreshRate !== undefined && ![60, 144, 240].includes(Number(candidate.gamingRefreshRate))) {
    errors.push("gamingRefreshRate는 60, 144, 240 중 하나여야 합니다.");
  }
  const memoryCapacityGb = Number(candidate.memoryCapacityGb ?? 32);
  if (![16, 32, 64, 128].includes(memoryCapacityGb)) {
    errors.push("memoryCapacityGb는 16, 32, 64, 128 중 하나여야 합니다.");
  }
  const rawListingPolicy = candidate.listingPolicy === undefined
    ? candidate.includeNonRetail === true ? "all" : "retail_only"
    : String(candidate.listingPolicy);
  if (!["retail_only", "include_bulk", "all"].includes(rawListingPolicy)) {
    errors.push("listingPolicy는 retail_only, include_bulk, all 중 하나여야 합니다.");
  }
  const storageCapacityGb = Number(candidate.storageCapacityGb ?? 1000);
  if (!Number.isInteger(storageCapacityGb) || storageCapacityGb <= 0 || storageCapacityGb > 100_000) {
    errors.push("storageCapacityGb는 1부터 100,000 사이의 정수여야 합니다.");
  }
  const hddCount = Number(candidate.hddCount ?? 0);
  if (!Number.isInteger(hddCount) || hddCount < 0 || hddCount > 8) {
    errors.push("hddCount는 0부터 8 사이의 정수여야 합니다.");
  }
  const hddCapacityGb = Number(candidate.hddCapacityGb ?? 4000);
  if (!Number.isInteger(hddCapacityGb) || hddCapacityGb <= 0 || hddCapacityGb > 100_000) {
    errors.push("hddCapacityGb는 1부터 100,000 사이의 정수여야 합니다.");
  }
  if (errors.length > 0) return { errors };
  return {
    request: {
      profile,
      budgetWon,
      includeGpu: typeof candidate.includeGpu === "boolean" ? candidate.includeGpu : profile === "gaming",
      priority,
      gamingResolution: ["1080p", "1440p", "4k"].includes(String(candidate.gamingResolution))
        ? candidate.gamingResolution as BuildGenerationRequest["gamingResolution"]
        : "1440p",
      gamingRefreshRate: [60, 144, 240].includes(Number(candidate.gamingRefreshRate))
        ? Number(candidate.gamingRefreshRate) as BuildGenerationRequest["gamingRefreshRate"]
        : 144,
      memoryCapacityGb,
      storageCapacityGb,
      hddCapacityGb,
      hddCount,
      includeNonRetail: rawListingPolicy === "all",
      listingPolicy: rawListingPolicy as ListingPolicy
    },
    errors
  };
}

async function loadBuilds() {
  return readSavedBuilds();
}

async function addSavedBuildSummaries(builds: SavedBuildRecord[]) {
  return savedBuildPresentationsFor(builds, await loadSavedBuildPresentationContext());
}

type SavedBuildMonitorResources = {
  catalog: Awaited<ReturnType<typeof loadCatalog>>;
  accessories: Awaited<ReturnType<typeof loadAccessories>>;
  catalogSnapshotAt: string;
  accessoryUpdatedAt: string;
  catalogRevision: number;
};

async function loadSavedBuildMonitorResources(): Promise<SavedBuildMonitorResources> {
  const snapshot = await loadCatalogSnapshot();
  return { catalog: snapshot.catalog, accessories: snapshot.accessories, catalogSnapshotAt: snapshot.catalogUpdatedAt, accessoryUpdatedAt: snapshot.accessoryUpdatedAt, catalogRevision: snapshot.catalogRevision };
}

async function savedBuildCheckSnapshotForResources(build: SavedBuildRecord, resources: SavedBuildMonitorResources) {
  const recommendationPreferences = build.recommendationPreferences ?? parseRecommendationPreferences(undefined);
  const cacheKey = savedBuildCheckPreviewCacheKey({
    build: build.selection,
    recommendationPreferences,
    dependencies: {
      catalogSnapshotAt: resources.catalogSnapshotAt,
      accessoryUpdatedAt: resources.accessoryUpdatedAt,
      catalogRevision: resources.catalogRevision,
      engineVersion: ENGINE_VERSION
    }
  });
  return savedBuildCheckPreviewCache.getOrCompute(cacheKey, () => compactSavedBuildCheckSnapshotFor(evaluateBuildWithAccessories(build.selection, resources.catalog, resources.accessories, resources.catalogSnapshotAt, recommendationPreferences, false)));
}

function savedBuildMonitorResponseFor(build: SavedBuildRecord): SavedBuildMonitorSubscriptionResponse {
  return {
    buildId: build.id,
    buildName: build.name,
    subscription: build.monitorState ?? defaultSavedBuildMonitorSubscription(build.createdAt)
  };
}

async function performSavedBuildMonitorRun(build: SavedBuildRecord, resources?: SavedBuildMonitorResources, checkedAt = new Date().toISOString()) {
  try {
    const source = resources ?? await loadSavedBuildMonitorResources();
    const snapshot = (await savedBuildCheckSnapshotForResources(build, source)).value;
    const monitorState = completeSavedBuildMonitorRun(build, build.monitorState, snapshot, snapshot.checkedAt, build.checkSnapshot);
    const updated = await updateSavedBuildMonitorState(build.id, monitorState);
    if (!updated) throw new Error("저장 견적이 점검 중 삭제되었습니다.");
    return updated;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "저장 견적 자동 점검에 실패했습니다.";
    const failedState = failSavedBuildMonitorRun(build.monitorState, message, checkedAt, build);
    await updateSavedBuildMonitorState(build.id, failedState).catch(() => undefined);
    throw error;
  }
}

const savedBuildMonitorRunJobs = new Map<string, Promise<SavedBuildRecord>>();

async function executeSavedBuildMonitorRun(build: SavedBuildRecord, resources?: SavedBuildMonitorResources, checkedAt = new Date().toISOString()) {
  const existing = savedBuildMonitorRunJobs.get(build.id);
  if (existing) return existing;
  const job = performSavedBuildMonitorRun(build, resources, checkedAt);
  savedBuildMonitorRunJobs.set(build.id, job);
  try {
    return await job;
  } finally {
    if (savedBuildMonitorRunJobs.get(build.id) === job) savedBuildMonitorRunJobs.delete(build.id);
  }
}

let savedBuildMonitorSchedulerRunning = false;
const savedBuildMonitorSchedulerStats: {
  lastAttemptedAt?: string;
  lastAcquiredAt?: string;
  lastSkippedAt?: string;
  lastFinishedAt?: string;
  lastBackend?: "postgres" | "file";
  lastProcessedCount: number;
  skippedCount: number;
  lastError?: string;
} = { lastProcessedCount: 0, skippedCount: 0 };

async function runDueSavedBuildMonitorsUnlocked(now: string) {
  const dueBuilds = (await loadBuilds())
    .filter((build) => !shareExpired(build.expiresAt) && savedBuildMonitorSubscriptionDue(build.monitorState, now))
    .slice(0, SAVED_BUILD_SERVER_MONITOR_SCHEDULER_BATCH_LIMIT);
  if (dueBuilds.length === 0) return 0;
  const resources = await loadSavedBuildMonitorResources();
  for (const build of dueBuilds) {
    await executeSavedBuildMonitorRun(build, resources, now).catch((error: unknown) => {
      console.warn(`저장 견적 백그라운드 점검 실패 (${build.id}): ${error instanceof Error ? error.message : String(error)}`);
      });
  }
  return dueBuilds.length;
}

async function runDueSavedBuildMonitors(now = new Date().toISOString()) {
  if (savedBuildMonitorSchedulerRunning) return;
  savedBuildMonitorSchedulerRunning = true;
  try {
    savedBuildMonitorSchedulerStats.lastAttemptedAt = now;
    const lease = await withSavedBuildMonitorLease(() => runDueSavedBuildMonitorsUnlocked(now));
    savedBuildMonitorSchedulerStats.lastBackend = lease.backend;
    if (!lease.acquired) {
      savedBuildMonitorSchedulerStats.lastSkippedAt = now;
      savedBuildMonitorSchedulerStats.skippedCount += 1;
      return;
    }
    savedBuildMonitorSchedulerStats.lastAcquiredAt = now;
    savedBuildMonitorSchedulerStats.lastProcessedCount = lease.value;
    savedBuildMonitorSchedulerStats.lastFinishedAt = new Date().toISOString();
    savedBuildMonitorSchedulerStats.lastError = undefined;
  } catch (error: unknown) {
    savedBuildMonitorSchedulerStats.lastError = error instanceof Error ? error.message : "scheduler 실행에 실패했습니다.";
    console.warn(`저장 견적 scheduler 실행 실패: ${savedBuildMonitorSchedulerStats.lastError}`);
  } finally {
    savedBuildMonitorSchedulerRunning = false;
  }
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "pc-supporter", engineVersion: ENGINE_VERSION });
});

app.get("/api/meta", async (request, response) => {
  const [meta, crawler, persistence] = await Promise.all([catalogMeta(), readCrawlStatus(), persistenceDiagnostics()]);
  sendJsonWithEtag(request, response, { ...meta, crawler: publicCrawlStatusFor(crawler as CrawlStatus), engineVersion: ENGINE_VERSION, storageMode: persistence.storageMode, persistence, adminAuthEnabled: adminAuthEnabled() });
});

app.get("/api/admin/monitor/status", requireAdmin, (_request, response) => {
  response.json({
    scheduler: {
      enabled: process.env.BUILD_MONITOR_SCHEDULER_ENABLED !== "false",
      batchLimit: SAVED_BUILD_SERVER_MONITOR_SCHEDULER_BATCH_LIMIT,
      ...savedBuildMonitorSchedulerStats
    },
    compatibilityCache: compatibilityResultCache.stats(),
    savedBuildCheckPreviewCache: savedBuildCheckPreviewCache.stats(),
    compatiblePartAssessmentCache: compatiblePartAssessmentCache.stats()
  });
});

app.get("/api/admin/build-versions/status", requireAdmin, async (_request, response) => {
  response.json(savedBuildVersionAuditFor(await readSavedBuilds()));
});

app.get("/api/admin/build-versions/migration-preview", requireAdmin, async (_request, response) => {
  const builds = await readSavedBuilds();
  response.json({ ...savedBuildVersionMigrationPreviewFor(builds), snapshotFingerprint: savedBuildVersionSnapshotFingerprintFor(builds) });
});

app.get("/api/admin/build-versions/last-backup", requireAdmin, async (_request, response) => {
  response.json(await readLatestSavedBuildVersionBackup() ?? null);
});

app.get("/api/admin/build-versions/backups", requireAdmin, async (_request, response) => {
  response.json({ items: await readSavedBuildVersionBackups() });
});

app.get("/api/admin/build-versions/backups/:id", requireAdmin, async (request, response) => {
  const backupId = routeParam(request.params.id)?.trim() ?? "";
  if (!backupId || backupId.length > 120) {
    response.status(400).json({ error: "backup ID가 올바르지 않습니다.", code: "VERSION_BACKUP_ID_INVALID" });
    return;
  }
  const detail = await readSavedBuildVersionBackupDetail(backupId);
  if (!detail) {
    response.status(404).json({ error: "버전 backup을 찾을 수 없습니다.", code: "VERSION_BACKUP_NOT_FOUND" });
    return;
  }
  response.json(detail);
});

app.post("/api/admin/build-versions/migrate", adminVersionMigrationRateLimit, requireAdmin, async (request, response) => {
  const expectedFingerprint = typeof request.body?.expectedFingerprint === "string" ? request.body.expectedFingerprint.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
    response.status(400).json({ error: "최신 마이그레이션 프리뷰 식별자가 필요합니다.", code: "VERSION_MIGRATION_FINGERPRINT_REQUIRED" });
    return;
  }
  if (request.body?.confirmation !== SAVED_BUILD_VERSION_MIGRATION_CONFIRMATION) {
    response.status(400).json({ error: "마이그레이션 확인 문구가 일치하지 않습니다.", code: "VERSION_MIGRATION_CONFIRMATION_REQUIRED" });
    return;
  }
  try {
    const result = await migrateSavedBuildVersions(expectedFingerprint);
    if (result.status === "conflict") {
      response.status(409).json({ ...result, error: "프리뷰 이후 저장 견적이 변경되었습니다. 최신 프리뷰를 다시 계산해 주세요.", code: "VERSION_MIGRATION_PREVIEW_STALE" });
      return;
    }
    if (result.status === "blocked") {
      response.status(409).json({ ...result, error: "버전 데이터 오류가 남아 있어 마이그레이션을 적용할 수 없습니다.", code: "VERSION_MIGRATION_BLOCKED" });
      return;
    }
    response.json(result);
  } catch (error: unknown) {
    response.status(503).json({ error: error instanceof Error ? error.message : "마이그레이션을 적용하지 못했습니다.", code: "VERSION_MIGRATION_UNAVAILABLE" });
  }
});

app.post("/api/admin/build-versions/rollback", adminVersionRollbackRateLimit, requireAdmin, async (request, response) => {
  const backupId = typeof request.body?.backupId === "string" ? request.body.backupId.trim() : "";
  const expectedFingerprint = typeof request.body?.expectedFingerprint === "string" ? request.body.expectedFingerprint.trim().toLowerCase() : "";
  if (!backupId || backupId.length > 120 || !/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
    response.status(400).json({ error: "rollback에는 backupId와 최신 적용 식별자가 필요합니다.", code: "VERSION_ROLLBACK_INPUT_REQUIRED" });
    return;
  }
  if (request.body?.confirmation !== SAVED_BUILD_VERSION_ROLLBACK_CONFIRMATION) {
    response.status(400).json({ error: "rollback 확인 문구가 일치하지 않습니다.", code: "VERSION_ROLLBACK_CONFIRMATION_REQUIRED" });
    return;
  }
  try {
    const result = await rollbackSavedBuildVersions(backupId, expectedFingerprint);
    if (result.status === "not_found") {
      response.status(404).json({ ...result, error: "복구할 버전 백업을 찾을 수 없습니다.", code: "VERSION_BACKUP_NOT_FOUND" });
      return;
    }
    if (result.status === "conflict") {
      response.status(409).json({ ...result, error: "적용 후 저장 견적이 변경되어 rollback을 중단했습니다.", code: "VERSION_ROLLBACK_STALE" });
      return;
    }
    response.json(result);
  } catch (error: unknown) {
    response.status(503).json({ error: error instanceof Error ? error.message : "rollback을 실행하지 못했습니다.", code: "VERSION_ROLLBACK_UNAVAILABLE" });
  }
});

app.get("/api/categories", (_request, response) => {
  response.json({ categories: PART_CATEGORIES });
});

app.get("/api/parts", publicCatalogReadRateLimit, async (request, response) => {
  const category = isCategory(request.query.category) ? request.query.category : undefined;
  const query = typeof request.query.q === "string" ? request.query.q : undefined;
  const rawBrand = typeof request.query.brand === "string" ? request.query.brand.trim().slice(0, 80) : "";
  const brand = rawBrand || undefined;
  const partId = typeof request.query.partId === "string" && request.query.partId.trim() ? request.query.partId.trim().slice(0, 160) : undefined;
  const requestedLimit = Number(request.query.limit ?? 40);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 40;
  const requestedOffset = Number(request.query.offset ?? 0);
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0;
  const rawQuality = typeof request.query.quality === "string" ? request.query.quality : "all";
  const quality = ["all", "seed", "live", "manual", "incomplete"].includes(rawQuality)
    ? rawQuality as DataQuality | "all"
    : "all";
  const priceAvailability = priceAvailabilityFromUnknown(request.query.priceStatus);
  const freshness = dataFreshnessFromUnknown(request.query.freshness);
  const benchmarkAvailability = benchmarkAvailabilityFromUnknown(request.query.benchmarkStatus, category);
  const parsedMissingField = parseCatalogMissingField(request.query.missingField);
  if (parsedMissingField.error) {
    response.status(400).json({ error: "누락 필드 형식이 올바르지 않습니다.", details: [parsedMissingField.error] });
    return;
  }
  const missingField = parsedMissingField.value;
  const rawSort = typeof request.query.sort === "string" ? request.query.sort : "price_asc";
  const sort = ["price_asc", "price_desc", "name", "updated", "benchmark_desc"].includes(rawSort)
    ? rawSort as "price_asc" | "price_desc" | "name" | "updated" | "benchmark_desc"
    : "price_asc";
  const rawListingPolicy = typeof request.query.listingPolicy === "string" ? request.query.listingPolicy : "all";
  const listingPolicy = ["retail_only", "include_bulk", "all"].includes(rawListingPolicy)
    ? rawListingPolicy as ListingPolicy
    : "all";
  const parsedSpecFilter = parsePartSpecFilter({
    minVramGb: request.query.minVramGb,
    minCapacityGb: request.query.minCapacityGb,
    minWattageW: request.query.minWattageW,
    minMemorySpeedMhz: request.query.minMemorySpeedMhz,
    interface: request.query.interface,
    socket: request.query.socket,
    memoryType: request.query.memoryType,
    formFactor: request.query.formFactor,
    minMemorySlots: request.query.minMemorySlots,
    minM2Slots: request.query.minM2Slots,
    minSataPorts: request.query.minSataPorts,
    pcieSlotWidth: request.query.pcieSlotWidth,
    minPcieSlotCount: request.query.minPcieSlotCount,
    pcieSlotInfo: request.query.pcieSlotInfo,
    minHddBays: request.query.minHddBays,
    minMaxGpuLengthMm: request.query.minMaxGpuLengthMm,
    minMaxCoolerHeightMm: request.query.minMaxCoolerHeightMm,
    minMaxPsuLengthMm: request.query.minMaxPsuLengthMm,
    minCoolingW: request.query.minCoolingW,
    maxLengthMm: request.query.maxLengthMm,
    maxPsuDepthMm: request.query.maxPsuDepthMm
  });
  if (parsedSpecFilter.errors.length > 0) {
    response.status(400).json({ error: "스펙 필터 형식이 올바르지 않습니다.", details: parsedSpecFilter.errors });
    return;
  }
  const catalog = await loadCatalog();
  const baseOptions = { ...(partId ? { partId } : {}), ...(brand ? { brand } : {}), ...(missingField ? { missingField } : {}), quality, sort, listingPolicy };
  const priceOptions = { ...baseOptions, priceAvailability };
  const freshnessOptions = { ...priceOptions, freshness };
  const benchmarkOptions = { ...freshnessOptions, benchmarkAvailability };
  const options = { ...benchmarkOptions, specFilter: parsedSpecFilter.filter };
  const unfilteredOptions = { ...(partId ? { partId } : {}), ...(brand ? { brand } : {}), ...(missingField ? { missingField } : {}), quality, sort, priceAvailability, freshness, benchmarkAvailability, specFilter: parsedSpecFilter.filter };
  const coreCandidateOptions = { ...unfilteredOptions, listingPolicy: "all" as const };
  const { baseTotal, priceTotal, freshnessTotal, benchmarkTotal, total, unfilteredTotal, coreCandidateTotal, categoryMismatchExcludedCount } = catalogSearchTotalsFor(catalog, category, query, {
    base: baseOptions,
    price: priceOptions,
    freshness: freshnessOptions,
    benchmark: benchmarkOptions,
    final: options,
    unfiltered: unfilteredOptions,
    coreCandidate: coreCandidateOptions
  });
  const specFilterApplied = Object.keys(parsedSpecFilter.filter).length > 0;
  const specInputParts = specFilterApplied ? filterParts(catalog, category, query, benchmarkOptions) : [];
  const payload = {
    items: searchParts(catalog, category, query, limit, options, offset).map((part) => ({ ...part, dataFreshness: classifyDataFreshness(part.updatedAt) })),
    total,
    ...(brand ? { brand } : {}),
    ...(partId ? { partId } : {}),
    ...(missingField ? { missingField } : {}),
    ...(priceAvailability !== "all" ? { priceStatus: priceAvailability, priceExcludedCount: baseTotal - priceTotal } : {}),
    ...(freshness !== "all" ? { freshness, freshnessExcludedCount: priceTotal - freshnessTotal } : {}),
    ...(benchmarkAvailability !== "all" ? { benchmarkStatus: benchmarkAvailability, benchmarkExcludedCount: freshnessTotal - benchmarkTotal } : {}),
    ...(unfilteredTotal > coreCandidateTotal ? { nonCoreExcludedCount: unfilteredTotal - coreCandidateTotal } : {}),
    ...(categoryMismatchExcludedCount > 0 ? { categoryMismatchExcludedCount } : {}),
    ...(specFilterApplied ? { specFilter: parsedSpecFilter.filter, specExcludedCount: benchmarkTotal - total, specFilterDiagnostics: partSpecFilterDiagnosticsFor(specInputParts, parsedSpecFilter.filter) } : {}),
    offset,
    limit
  };
  sendJsonWithEtag(request, response, payload);
});

app.get("/api/parts/batch", publicCatalogBatchRateLimit, async (request, response) => {
  const parsed = parseCatalogBatchQuery(request.query.ids);
  if (parsed.errors.length > 0) {
    response.status(400).json({ error: "부품 일괄 조회 요청 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const catalog = await loadCatalog();
  const byId = new Map(catalog.map((part) => [part.id, part]));
  const payload = { items: parsed.ids.map((id) => byId.get(id)).filter((part): part is Part => part !== undefined).map((part) => ({ ...part, dataFreshness: classifyDataFreshness(part.updatedAt) })), missingIds: parsed.ids.filter((id) => !byId.has(id)) };
  const lastModified = payload.items.reduce<string | undefined>((latest, part) => !latest || part.updatedAt > latest ? part.updatedAt : latest, undefined);
  sendJsonWithEtag(request, response, payload, lastModified);
});

app.get("/api/parts/:id", publicCatalogDetailRateLimit, async (request, response) => {
  const catalog = await loadCatalog();
  const partId = routeParam(request.params.id);
  const part = partId ? findPart(catalog, partId) : undefined;
  if (!part) {
    response.status(404).json({ error: "부품을 찾을 수 없습니다." });
    return;
  }
  sendJsonWithEtag(request, response, { ...part, dataFreshness: classifyDataFreshness(part.updatedAt) }, part.updatedAt);
});

app.post("/api/parts/batch", publicCatalogBatchRateLimit, async (request, response) => {
  const parsed = parseCatalogBatchIds(request.body);
  if (parsed.errors.length > 0) {
    response.status(400).json({ error: "부품 일괄 조회 요청 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const catalog = await loadCatalog();
  const byId = new Map(catalog.map((part) => [part.id, part]));
  const items = parsed.ids.map((id) => byId.get(id)).filter((part): part is Part => part !== undefined).map((part) => ({ ...part, dataFreshness: classifyDataFreshness(part.updatedAt) }));
  response.json({ items, missingIds: parsed.ids.filter((id) => !byId.has(id)) });
});

class PartRefreshRouteError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "PartRefreshRouteError";
  }
}

async function refreshCatalogPartById(partId: string) {
  if (!partId) throw new PartRefreshRouteError(400, "PART_REFRESH_ID_REQUIRED", "부품 식별자가 필요합니다.");
  const catalog = await loadCatalog();
  const current = findPart(catalog, partId);
  if (!current) throw new PartRefreshRouteError(404, "PART_REFRESH_NOT_FOUND", "부품을 찾을 수 없습니다.");
  const blockReason = partRefreshBlockReason(current);
  if (blockReason) throw new PartRefreshRouteError(422, "PART_REFRESH_UNSUPPORTED", blockReason);
  if (partRefreshJobs.has(partId)) throw new PartRefreshRouteError(409, "PART_REFRESH_RUNNING", "이 부품의 정보 다시 확인이 이미 실행 중입니다.");
  const lastRunAt = partRefreshLastRunAt.get(partId);
  if (lastRunAt !== undefined) {
    const remainingMs = PART_REFRESH_COOLDOWN_MS - (Date.now() - lastRunAt);
    if (remainingMs > 0) {
      const retryAfterSeconds = Math.ceil(remainingMs / 1000);
      throw new PartRefreshRouteError(429, "PART_REFRESH_COOLDOWN", `같은 부품은 ${retryAfterSeconds}초 후 다시 확인할 수 있습니다.`, retryAfterSeconds);
    }
    partRefreshLastRunAt.delete(partId);
  }
  const job = (async () => {
    try {
      const refreshed = await refreshDanawaPart(current);
      const savedCatalog = await upsertCatalog([refreshed]);
      const savedPart = findPart(savedCatalog, current.id);
      if (!savedPart) throw new Error("재확인한 부품을 카탈로그에 반영하지 못했습니다.");
      const result = partRefreshResponse(current, savedPart);
      await appendCatalogChangeRecord(catalogChangeRecord("part", current, savedPart, result.changedFields, { changedAt: result.refreshedAt })).catch((error: unknown) => {
        console.warn(`카탈로그 변경 이력을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
      });
      return result;
    } catch (error: unknown) {
      if (error instanceof PartRefreshRouteError) throw error;
      throw new PartRefreshRouteError(422, "PART_REFRESH_FAILED", error instanceof Error ? error.message : "부품 상세 정보를 다시 확인하지 못했습니다.");
    }
  })();
  partRefreshJobs.set(partId, job);
  try {
    const result = await job;
    partRefreshLastRunAt.set(partId, Date.now());
    return result;
  } finally {
    if (partRefreshJobs.get(partId) === job) partRefreshJobs.delete(partId);
  }
}

function sendPartRefreshError(response: Response, error: unknown) {
  if (error instanceof PartRefreshRouteError) {
    if (error.retryAfterSeconds !== undefined) response.setHeader("Retry-After", String(error.retryAfterSeconds));
    response.status(error.statusCode).json({ error: error.message, code: error.code, ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}) });
    return;
  }
  response.status(422).json({ error: error instanceof Error ? error.message : "부품 상세 정보를 다시 확인하지 못했습니다.", code: "PART_REFRESH_FAILED" });
}

function pcieMissingFieldsForPart(part: Part) {
  return part.category === "motherboard" ? pcieSlotEvidenceMissingFieldsFor(part.specs) : [];
}

function parseCatalogSpecRefreshBatchFilters(value: unknown): { filters?: CatalogSpecRefreshBatchFilters; error?: string } {
  if (value === undefined) return { filters: undefined };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "filters는 객체여야 합니다." };
  const candidate = value as Record<string, unknown>;
  const category = typeof candidate.category === "string" && PART_CATEGORIES.includes(candidate.category as PartCategory) ? candidate.category as PartCategory : undefined;
  const priority = candidate.priority === "high" || candidate.priority === "medium" || candidate.priority === "low" ? candidate.priority : undefined;
  const action = candidate.action === "refresh_source" || candidate.action === "review_source" || candidate.action === "inspect_catalog" ? candidate.action as CatalogSpecReviewAction : undefined;
  const evidence = candidate.evidence === "all" || candidate.evidence === "spec" || candidate.evidence === "pcie" ? candidate.evidence as CatalogSpecReviewEvidence : undefined;
  const query = candidate.query === undefined ? undefined : typeof candidate.query === "string" && candidate.query.trim().length <= 120 ? candidate.query.trim() : undefined;
  const missingField = candidate.missingField === undefined ? undefined : typeof candidate.missingField === "string" && candidate.missingField.trim().length <= 120 ? candidate.missingField.trim() : undefined;
  const offset = candidate.offset === undefined ? undefined : Number(candidate.offset);
  const limit = candidate.limit === undefined ? undefined : Number(candidate.limit);
  const offsetInvalid = offset !== undefined && (!Number.isInteger(offset) || offset < 0 || offset > 100_000);
  const limitInvalid = limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100);
  if (candidate.category !== undefined && !category || candidate.priority !== undefined && !priority || candidate.action !== undefined && !action || candidate.evidence !== undefined && !evidence || candidate.query !== undefined && query === undefined || candidate.missingField !== undefined && missingField === undefined || offsetInvalid || limitInvalid) {
    return { error: "filters의 카테고리·우선순위·작업 유형·정보 범위·검색어·offset·limit을 확인해 주세요." };
  }
  return { filters: { ...(category ? { category } : {}), ...(priority ? { priority } : {}), ...(action ? { action } : {}), ...(evidence ? { evidence } : {}), ...(query ? { query } : {}), ...(missingField ? { missingField } : {}), ...(offset !== undefined ? { offset } : {}), ...(limit !== undefined ? { limit } : {}) } };
}

app.post("/api/parts/:id/refresh", catalogRefreshRateLimit, requirePartRefreshAccess, async (request, response) => {
  try {
    response.json(await refreshCatalogPartById(routeParam(request.params.id) ?? ""));
  } catch (error: unknown) {
    sendPartRefreshError(response, error);
  }
});

app.post("/api/admin/catalog-spec/refresh-batch", catalogSpecRefreshBatchRateLimit, requireAdmin, async (request, response) => {
  const parsedFilters = parseCatalogSpecRefreshBatchFilters(request.body?.filters);
  if (parsedFilters.error) {
    response.status(400).json({ error: parsedFilters.error, code: "PART_REFRESH_BATCH_FILTERS_INVALID" });
    return;
  }
  const rawPartIds = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body.partIds : undefined;
  if (!Array.isArray(rawPartIds) || rawPartIds.length < 1 || rawPartIds.length > 12 || !rawPartIds.every((value: unknown) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 160)) {
    response.status(400).json({ error: "partIds는 1개 이상 12개 이하의 유효한 부품 ID 배열이어야 합니다.", code: "PART_REFRESH_BATCH_INPUT_INVALID" });
    return;
  }
  const partIds = rawPartIds.map((value: string) => value.trim());
  if (new Set(partIds).size !== partIds.length) {
    response.status(400).json({ error: "일괄 정보 다시 확인에는 중복 부품 ID를 넣을 수 없습니다.", code: "PART_REFRESH_BATCH_DUPLICATE_ID" });
    return;
  }
  const catalog = await loadCatalog();
  const byId = new Map(catalog.map((part) => [part.id, part]));
  const coverageBefore = catalogSpecRefreshCoverageSummaryFor(catalog);
  const startedAt = new Date().toISOString();
  const items: CatalogSpecRefreshBatchItem[] = [];
  for (let index = 0; index < partIds.length; index += 1) {
    const chunk = partIds.slice(index, index + 1);
    const chunkResults = await Promise.all(chunk.map(async (partId) => {
      const current = byId.get(partId);
      if (!current) return { partId, partName: partId, status: "skipped" as const, code: "PART_REFRESH_NOT_FOUND", error: "부품을 찾을 수 없습니다." };
      if (!isListingAllowed(current, "all")) return { partId, partName: current.name, category: current.category, status: "skipped" as const, code: "PART_REFRESH_NON_CORE", error: "핵심 호환 부품이 아닌 항목은 이 작업 패키지에서 제외합니다." };
      try {
        const result = await refreshCatalogPartById(partId);
        return {
          partId,
          partName: result.part.name,
          category: result.part.category,
          status: "refreshed" as const,
          changedFields: result.changedFields,
          previousMissingFields: result.previousMissingFields,
          nextMissingFields: result.part.missingFields,
          ...(current.category === "motherboard" ? { previousPcieMissingFields: pcieMissingFieldsForPart(current), nextPcieMissingFields: pcieMissingFieldsForPart(result.part) } : {}),
          refreshedAt: result.refreshedAt
        };
      } catch (error: unknown) {
        const routeError = error instanceof PartRefreshRouteError ? error : undefined;
        return { partId, partName: current.name, category: current.category, status: routeError?.code === "PART_REFRESH_UNSUPPORTED" || routeError?.code === "PART_REFRESH_COOLDOWN" || routeError?.code === "PART_REFRESH_RUNNING" ? "skipped" as const : "failed" as const, ...(routeError?.code ? { code: routeError.code } : { code: "PART_REFRESH_FAILED" }), error: routeError?.message ?? (error instanceof Error ? error.message : "정보 다시 확인 실패"), ...(routeError?.retryAfterSeconds !== undefined ? { retryAfterSeconds: routeError.retryAfterSeconds } : {}) };
      }
    }));
    items.push(...chunkResults);
  }
  const finishedAt = new Date().toISOString();
  const coverageAfter = catalogSpecRefreshCoverageSummaryFor(await loadCatalog(), finishedAt);
  const batchResponse: CatalogSpecRefreshBatchResponse = {
    schemaVersion: 1,
    kind: "catalog-spec-refresh-batch",
    runId: newCatalogSpecRefreshRunId(),
    startedAt,
    finishedAt,
    ...(parsedFilters.filters ? { filters: parsedFilters.filters } : {}),
    requestedCount: partIds.length,
    processedCount: items.length,
    refreshedCount: items.filter((item) => item.status === "refreshed").length,
    skippedCount: items.filter((item) => item.status === "skipped").length,
    failedCount: items.filter((item) => item.status === "failed").length,
    changedFieldCount: items.reduce((total, item) => total + (item.changedFields?.length ?? 0), 0),
    coverageBefore,
    coverageAfter,
    coverageDelta: catalogSpecRefreshCoverageDeltaFor(coverageBefore, coverageAfter),
    impact: catalogSpecRefreshImpactFor(items),
    pcieImpact: catalogPcieRefreshImpactFor(items),
    items
  };
  let historyPersisted = true;
  try {
    await appendCatalogSpecRefreshHistory(catalogSpecRefreshHistoryEntryFor(batchResponse));
  } catch (error: unknown) {
    historyPersisted = false;
    console.warn(`카탈로그 스펙 보강 실행 이력을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
  response.json({ ...batchResponse, historyPersisted });
});

app.post("/api/parts/compatible", publicCandidateRateLimit, async (request, response) => {
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : undefined;
  const category = isCategory(body?.category) ? body.category : undefined;
  if (!category) {
    response.status(400).json({ error: "호환 부품을 찾으려면 부품 카테고리가 필요합니다." });
    return;
  }
  if (!body || body.build === undefined) {
    response.status(400).json({ error: "호환 부품을 찾으려면 현재 견적이 필요합니다." });
    return;
  }
  const parsed = parseBuild(body.build);
  if (parsed.errors.length > 0) {
    response.status(400).json({ error: "현재 견적 입력 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const catalog = await loadCatalog();
  const invalidSelections = validateBuildPartIds(parsed.build, catalog);
  if (invalidSelections.length > 0) {
    response.status(400).json({
      error: "현재 견적에 카탈로그에 존재하지 않는 부품이 포함되어 있습니다.",
      partIds: invalidSelections.map((selection) => selection.partId)
    });
    return;
  }
  const query = typeof body.q === "string" ? body.q : undefined;
  const rawBrand = typeof body.brand === "string" ? body.brand.trim().slice(0, 80) : "";
  const brand = rawBrand || undefined;
  const requestedLimit = Number(body.limit ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 50;
  const requestedOffset = Number(body.offset ?? 0);
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0;
  const rawQuality = typeof body.quality === "string" ? body.quality : "all";
  const quality = ["all", "seed", "live", "manual", "incomplete"].includes(rawQuality)
    ? rawQuality as DataQuality | "all"
    : "all";
  const priceAvailability = priceAvailabilityFromUnknown(body.priceStatus);
  const freshness = dataFreshnessFromUnknown(body.freshness);
  const rawSort = typeof body.sort === "string" ? body.sort : "price_asc";
  const sort = ["price_asc", "price_desc", "name", "updated", "similarity", "value"].includes(rawSort)
    ? rawSort as "price_asc" | "price_desc" | "name" | "updated" | "similarity" | "value"
    : "price_asc";
  const rawListingPolicy = typeof body.listingPolicy === "string" ? body.listingPolicy : "retail_only";
  const listingPolicy = ["retail_only", "include_bulk", "all"].includes(rawListingPolicy)
    ? rawListingPolicy as ListingPolicy
    : "retail_only";
  const parsedSpecFilter = parsePartSpecFilter(body.specFilter);
  if (parsedSpecFilter.errors.length > 0) {
    response.status(400).json({ error: "스펙 필터 형식이 올바르지 않습니다.", details: parsedSpecFilter.errors });
    return;
  }
  const performanceFilter = alternativePerformanceFilterFromUnknown(body.performanceFilter);
  const physicalEvidenceFilter = physicalEvidenceFilterFromUnknown(body.physicalEvidenceFilter);
  const recommendationTrustFilter = recommendationTrustFilterFromUnknown(body.recommendationTrustFilter);
  const riskFilter: AlternativeRisk | "all" = ["all", "safe", "review", "unsafe"].includes(String(body.riskFilter))
    ? body.riskFilter as AlternativeRisk | "all"
    : "all";
  const budgetProvided = Object.prototype.hasOwnProperty.call(body ?? {}, "budgetWon");
  const rawBudget = body?.budgetWon;
  const budgetWon = rawBudget === undefined || rawBudget === null || rawBudget === ""
    ? undefined
    : Number(rawBudget);
  if (budgetProvided && budgetWon !== undefined && (!Number.isFinite(budgetWon) || !Number.isInteger(budgetWon) || budgetWon <= 0)) {
    response.status(400).json({ error: "교체 예산은 1원 이상의 정수여야 합니다." });
    return;
  }
  const mode = body.mode === "no_blocker" ? "no_blocker" : body.mode === "precision" ? "precision" : "safe";
  const profile = ["general", "gaming", "creator", "development", "office"].includes(String(body.profile))
    ? body.profile as RecommendationProfile
    : "general";
  const parsedRecommendationPreferences = parseRecommendationPreferences({ profile, gamingResolution: body.gamingResolution, gamingRefreshRate: body.gamingRefreshRate });
  const gamingResolution = parsedRecommendationPreferences.gamingResolution;
  const gamingRefreshRate = parsedRecommendationPreferences.gamingRefreshRate;
  const requestedFindingRuleId = typeof body.findingRuleId === "string" ? body.findingRuleId : undefined;
  const catalogSnapshotAt = await catalogUpdatedAtFor(catalog);
  const catalogFingerprint = catalog.reduce((latest, part) => part.updatedAt > latest ? part.updatedAt : latest, "");
  const catalogSort = sort === "similarity" || sort === "value" ? "price_asc" : sort;
  const assessmentCacheKey = `compatible-parts:${createHash("sha256").update(JSON.stringify({
    version: 9,
    engineVersion: ENGINE_VERSION,
    catalogRevision: currentCatalogRuntimeRevision(),
    catalogSnapshotAt,
    catalogFingerprint,
    catalogCount: catalog.length,
    category,
    build: parsed.build,
    profile,
    gamingResolution,
    gamingRefreshRate,
    findingRuleId: requestedFindingRuleId,
    query,
    brand,
    quality,
    priceStatus: priceAvailability,
    freshness,
    sort: catalogSort,
    listingPolicy,
    specFilter: parsedSpecFilter.filter
  })).digest("hex")}`;
  const assessedCache = await compatiblePartAssessmentCache.getOrCompute(assessmentCacheKey, () => {
    const intentFinding = requestedFindingRuleId
      ? evaluateBuild(parsed.build, catalog, { includeSuggestions: false }).findings.find((finding) => finding.ruleId === requestedFindingRuleId)
      : undefined;
    if (requestedFindingRuleId && !intentFinding) return { intentFinding, assessedParts: [], priceExcludedCount: 0, freshnessExcludedCount: 0, specExcludedCount: 0, specFilterDiagnostics: [] };
    const baseOptions = { ...(brand ? { brand } : {}), quality, sort: catalogSort, listingPolicy };
    const priceOptions = { ...baseOptions, priceAvailability };
    const options = { ...priceOptions, freshness };
    const baseCount = countParts(catalog, category, query, baseOptions);
    const priceCount = countParts(catalog, category, query, priceOptions);
    const searchedParts = searchParts(catalog, category, query, catalog.length, options, 0);
    const specFilteredParts = searchedParts.filter(partSpecFilterMatcherFor(parsedSpecFilter.filter));
    const specFilterDiagnostics = partSpecFilterDiagnosticsFor(searchedParts, parsedSpecFilter.filter);
    const assessedParts = specFilteredParts
      .map((part) => {
        const assessment = assessAlternativePart(parsed.build, catalog, category, part, intentFinding);
        const similarity = candidateSimilarityForBuild(parsed.build, catalog, category, part, profile, gamingResolution, gamingRefreshRate);
        const recommendationTrust = recommendationTrustFor({
          candidate: part,
          similarityEvidence: similarity.similarityEvidence,
          resolvesTarget: assessment.fixesCurrentIssue ?? assessment.risk === "safe",
          benchmarkSourceKind: part.specs.benchmarkProvenance?.sourceKind,
          benchmarkFreshness: classifyDataFreshness(part.specs.benchmarkProvenance?.updatedAt ?? part.updatedAt),
          benchmarkSourceCheck: part.specs.benchmarkProvenance?.sourceCheck,
          candidateBlockers: assessment.candidateBlockerCount,
          candidateWarnings: assessment.candidateWarningCount,
          candidateUnknown: assessment.candidateUnknownCount,
          remainingBlockers: assessment.remainingBlockers,
          remainingWarnings: assessment.remainingWarnings,
          remainingUnknown: assessment.remainingUnknown
        });
        return {
          part,
          assessment,
          similarity,
          recommendationTrust,
          decision: candidateDecisionSummaryFor({
            risk: assessment.risk,
            reasons: assessment.reasons,
            resolvesTarget: assessment.fixesCurrentIssue ?? assessment.risk === "safe",
            physicalStatus: assessment.physicalEvidence?.status,
            recommendationTrustLevel: recommendationTrust.level,
            catalogSpecSourceCheckNeedsReview: recommendationTrust.catalogSpecSourceCheckNeedsReview,
            freshness: recommendationTrust.freshness
          })
        };
      });
    return {
      intentFinding,
      assessedParts,
      priceExcludedCount: baseCount - priceCount,
      freshnessExcludedCount: priceCount - searchedParts.length,
      specExcludedCount: searchedParts.length - specFilteredParts.length,
      specFilterDiagnostics
    };
  });
  const intentFinding = assessedCache.value.intentFinding;
  const assessedParts = assessedCache.value.assessedParts;
  if (requestedFindingRuleId && !intentFinding) {
    response.status(400).json({ error: "현재 견적에서 해당 호환 규칙을 찾을 수 없습니다." });
    return;
  }
  response.setHeader("X-PC-Supporter-Compatible-Cache", assessedCache.lookup === "COALESCED" ? "COALESCED" : assessedCache.lookup);
  const { priceExcludedCount, freshnessExcludedCount, specExcludedCount, specFilterDiagnostics } = assessedCache.value;
  const intentParts = intentFinding
    ? assessedParts.filter(({ assessment }) => assessment.fixesCurrentIssue === true)
    : assessedParts;
  const recommendationTrustCounts = recommendationTrustCountsFor(intentParts.map(({ recommendationTrust }) => recommendationTrust));
  const riskCounts: AlternativeRiskCounts = { safe: 0, review: 0, unsafe: 0 };
  for (const { assessment } of intentParts) riskCounts[assessment.risk] += 1;
  const compatibleParts = intentParts
    .filter(({ assessment }) => mode === "safe" ? assessment.risk === "safe" : mode === "no_blocker" ? assessment.risk !== "unsafe" : true);
  const selectedPartIds = new Set([
    parsed.build.cpu?.partId,
    parsed.build.cooler?.partId,
    parsed.build.motherboard?.partId,
    parsed.build.gpu?.partId,
    parsed.build.case?.partId,
    parsed.build.psu?.partId,
    ...parsed.build.memory.map((selection) => selection.partId),
    ...parsed.build.ssd.map((selection) => selection.partId),
    ...parsed.build.hdd.map((selection) => selection.partId)
  ].filter((partId): partId is string => Boolean(partId)));
  const incompleteCandidateCount = intentParts.filter(({ part }) => part.dataQuality === "incomplete" && !selectedPartIds.has(part.id)).length;
  const incompleteExcludedCount = mode === "safe" ? incompleteCandidateCount : 0;
  const incompleteMissingFields = catalogMissingFieldCountsFor(intentParts.filter(({ part }) => part.dataQuality === "incomplete" && !selectedPartIds.has(part.id)).map(({ part }) => part), 5);
  const riskFilteredParts = riskFilter === "all" ? compatibleParts : compatibleParts.filter(({ assessment }) => assessment.risk === riskFilter);
  const riskExcludedCount = compatibleParts.length - riskFilteredParts.length;
  const performanceFilteredParts = riskFilteredParts.filter(({ similarity }) => alternativePerformanceMatches(performanceFilter, similarity));
  const performanceExcludedCount = riskFilteredParts.length - performanceFilteredParts.length;
  const trustFilteredParts = performanceFilteredParts.filter(({ recommendationTrust }) => recommendationTrustMatchesFilter(recommendationTrustFilter, recommendationTrust));
  const trustExcludedCount = performanceFilteredParts.length - trustFilteredParts.length;
  const physicalEvidenceFilteredParts = physicalEvidenceFilter === "all"
    ? trustFilteredParts
    : trustFilteredParts.filter(({ assessment }) => physicalEvidenceMatches(physicalEvidenceFilter, assessment.physicalEvidence));
  const physicalEvidenceExcludedCount = trustFilteredParts.length - physicalEvidenceFilteredParts.length;
  const budgetExcludedCount = budgetWon === undefined
    ? 0
    : physicalEvidenceFilteredParts.filter(({ part, assessment }) => !alternativeCandidateWithinBudget(part.priceWon, assessment.recommendedQuantity, budgetWon)).length;
  const matchingParts = physicalEvidenceFilteredParts.filter(({ part, assessment }) => alternativeCandidateWithinBudget(part.priceWon, assessment.recommendedQuantity, budgetWon));
  if (sort === "similarity") {
    matchingParts.sort((a, b) => compareCandidateSimilarity(a.similarity, b.similarity) || a.part.name.localeCompare(b.part.name, "ko-KR"));
  }
  if (sort === "value") {
    matchingParts.sort((a, b) => compareCandidateValue(a.similarity, b.similarity) || a.part.name.localeCompare(b.part.name, "ko-KR"));
  }
  response.json({
    items: matchingParts.slice(offset, offset + limit).map(({ part, assessment, similarity, recommendationTrust, decision }) => ({
      ...part,
      dataFreshness: recommendationTrust.freshness,
      decision,
      candidateRisk: assessment.risk,
      candidateReasons: assessment.reasons,
      remainingBlockers: assessment.remainingBlockers,
      remainingWarnings: assessment.remainingWarnings,
      remainingUnknown: assessment.remainingUnknown,
      ...(assessment.recommendedQuantity !== undefined ? { recommendedQuantity: assessment.recommendedQuantity } : {}),
      ...similarity,
      recommendationTrust,
      ...(assessment.physicalEvidence ? { physicalEvidence: assessment.physicalEvidence } : {})
    })),
    total: matchingParts.length,
    category,
    mode,
    ...(brand ? { brand } : {}),
    ...(priceAvailability !== "all" ? { priceStatus: priceAvailability, priceExcludedCount } : {}),
    ...(freshness !== "all" ? { freshness, freshnessExcludedCount } : {}),
    ...(Object.keys(parsedSpecFilter.filter).length > 0 ? { specFilter: parsedSpecFilter.filter, specExcludedCount, specFilterDiagnostics } : {}),
    ...(budgetWon !== undefined ? { budgetWon, budgetExcludedCount } : {}),
    performanceFilter,
    ...(performanceFilter !== "all" ? { performanceExcludedCount } : {}),
    riskFilter,
    ...(riskFilter !== "all" ? { riskExcludedCount } : {}),
    ...(recommendationTrustFilter !== "all" ? { recommendationTrustFilter, trustExcludedCount } : {}),
    ...(physicalEvidenceFilter !== "all" ? { physicalEvidenceFilter, physicalEvidenceExcludedCount } : {}),
    ...(incompleteExcludedCount > 0 ? { incompleteExcludedCount } : {}),
    ...(incompleteExcludedCount > 0 && incompleteMissingFields.length > 0 ? { incompleteMissingFields } : {}),
    intentRuleId: intentFinding?.ruleId,
    intentTitle: intentFinding?.title,
    riskCounts,
    recommendationTrustCounts,
    offset,
    limit
  });
});

app.get("/api/accessories", publicAccessoryReadRateLimit, async (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q : undefined;
  const rawBrand = typeof request.query.brand === "string" ? request.query.brand.trim().slice(0, 80) : "";
  const brand = rawBrand || undefined;
  const requestedLimit = Number(request.query.limit ?? 40);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 40;
  const requestedOffset = Number(request.query.offset ?? 0);
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0;
  const rawQuality = typeof request.query.quality === "string" ? request.query.quality : "all";
  const quality = ["all", "seed", "live", "manual", "incomplete"].includes(rawQuality)
    ? rawQuality as DataQuality | "all"
    : "all";
  const rawSort = typeof request.query.sort === "string" ? request.query.sort : "price_asc";
  const sort = ["price_asc", "price_desc", "name", "updated"].includes(rawSort)
    ? rawSort as "price_asc" | "price_desc" | "name" | "updated"
    : "price_asc";
  const rawCategory = typeof request.query.category === "string" ? request.query.category : "all";
  const category: AccessoryCategory | "all" = ACCESSORY_CATEGORIES.includes(rawCategory as AccessoryCategory)
    ? rawCategory as AccessoryCategory
    : "all";
  const rawPriceFilter = typeof request.query.priceFilter === "string" ? request.query.priceFilter : "all";
  const priceFilter: AccessoryPriceFilter = ["all", "priced", "under_10000", "10000_50000", "over_50000"].includes(rawPriceFilter)
    ? rawPriceFilter as AccessoryPriceFilter
    : "all";
  const freshness = dataFreshnessFromUnknown(request.query.freshness);
  const accessories = await loadAccessories();
  const baseOptions = { category, ...(brand ? { brand } : {}), quality, sort, priceFilter };
  const freshnessOptions = { ...baseOptions, freshness };
  const baseTotal = countAccessories(accessories, query, baseOptions);
  const freshnessTotal = countAccessories(accessories, query, freshnessOptions);
  const total = freshnessTotal;
  const payload = {
    items: searchAccessories(accessories, query, limit, freshnessOptions, offset).map((item) => ({ ...item, dataFreshness: classifyDataFreshness(item.updatedAt) })),
    total,
    category,
    ...(brand ? { brand } : {}),
    priceFilter,
    ...(freshness !== "all" ? { freshness, freshnessExcludedCount: baseTotal - freshnessTotal } : {}),
    offset,
    limit
  };
  sendJsonWithEtag(request, response, payload);
});

app.get("/api/accessories/:id", publicAccessoryDetailRateLimit, async (request, response) => {
  const accessoryId = routeParam(request.params.id);
  const accessory = accessoryId ? findAccessory(await loadAccessories(), accessoryId) : undefined;
  if (!accessory) {
    response.status(404).json({ error: "주변 부품을 찾을 수 없습니다." });
    return;
  }
  response.json({ ...accessory, dataFreshness: classifyDataFreshness(accessory.updatedAt) });
});

app.post("/api/accessories/batch", publicAccessoryBatchRateLimit, async (request, response) => {
  const parsed = parseCatalogBatchIds(request.body);
  if (parsed.errors.length > 0) {
    response.status(400).json({ error: "주변 부품 일괄 조회 요청 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const accessories = await loadAccessories();
  const byId = new Map(accessories.map((item) => [item.id, item]));
  const items = parsed.ids.map((id) => byId.get(id)).filter((item): item is Awaited<ReturnType<typeof loadAccessories>>[number] => item !== undefined).map((item) => ({ ...item, dataFreshness: classifyDataFreshness(item.updatedAt) }));
  response.json({ items, missingIds: parsed.ids.filter((id) => !byId.has(id)) });
});

function isUsableCatalogChangeRecord(value: unknown): value is CatalogChangeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CatalogChangeRecord>;
  const qualityValues: DataQuality[] = ["seed", "live", "manual", "incomplete"];
  return typeof candidate.id === "string"
    && (candidate.kind === "part" || candidate.kind === "accessory")
    && typeof candidate.itemId === "string"
    && typeof candidate.itemName === "string"
    && typeof candidate.category === "string"
    && typeof candidate.changedAt === "string"
    && Array.isArray(candidate.changedFields)
    && candidate.changedFields.every((field) => typeof field === "string")
    && qualityValues.includes(candidate.previousDataQuality as DataQuality)
    && qualityValues.includes(candidate.nextDataQuality as DataQuality)
    && Array.isArray(candidate.previousMissingFields)
    && candidate.previousMissingFields.every((field) => typeof field === "string")
    && Array.isArray(candidate.nextMissingFields)
    && candidate.nextMissingFields.every((field) => typeof field === "string")
    && (candidate.valueDiffs === undefined || (Array.isArray(candidate.valueDiffs) && candidate.valueDiffs.every((diff) => Boolean(diff) && typeof diff === "object" && typeof diff.field === "string" && (diff.previous === undefined || typeof diff.previous === "string") && (diff.next === undefined || typeof diff.next === "string"))))
    && (candidate.previousPriceWon === undefined || (typeof candidate.previousPriceWon === "number" && Number.isFinite(candidate.previousPriceWon)))
    && (candidate.nextPriceWon === undefined || (typeof candidate.nextPriceWon === "number" && Number.isFinite(candidate.nextPriceWon)))
    && (candidate.priceDeltaWon === undefined || (typeof candidate.priceDeltaWon === "number" && Number.isFinite(candidate.priceDeltaWon)));
}

async function readUsableCatalogChangeRecords() {
  return (await readCatalogChangeLog()).filter(isUsableCatalogChangeRecord);
}

app.get("/api/price-history", publicPriceHistoryRateLimit, async (request, response) => {
  const parsedRequest = parsePublicPriceHistoryIds(request.query.ids);
  if (parsedRequest.error) {
    response.status(400).json({ error: parsedRequest.error });
    return;
  }
  const parsedWindow = parsePublicPriceHistoryWindow(request.query.days);
  if (parsedWindow.error) {
    response.status(400).json({ error: parsedWindow.error });
    return;
  }
  const windowDays = parsedWindow.days;
  const uniqueRequested = parsedRequest.items;
  const records = await readUsableCatalogChangeRecords();
  const lastModified = records.reduce<string | undefined>((latest, record) => !latest || record.changedAt > latest ? record.changedAt : latest, undefined);
  const items = uniqueRequested.map((requestedItem) => {
    const itemRecords = records.filter((record) => record.kind === requestedItem.kind && record.itemId === requestedItem.itemId);
    const history = catalogChangePriceHistoryFor(itemRecords);
    const windowHistory = catalogChangePriceHistoryWithinWindowFor(history, { days: windowDays });
    const summary = catalogChangePriceWindowSummaryFor(history, { days: windowDays });
    const latestRecord = itemRecords.slice().sort((left, right) => right.changedAt.localeCompare(left.changedAt) || right.id.localeCompare(left.id))[0];
    return {
      ...requestedItem,
      ...(latestRecord ? { itemName: latestRecord.itemName, category: latestRecord.category } : {}),
      windowDays,
      points: windowHistory.slice(-12),
      summary: {
        sampleCount: windowHistory.length,
        ...(summary.latestPriceWon !== undefined ? { latestPriceWon: summary.latestPriceWon } : {}),
        ...(summary.minPriceWon !== undefined ? { minPriceWon: summary.minPriceWon } : {}),
        ...(summary.maxPriceWon !== undefined ? { maxPriceWon: summary.maxPriceWon } : {}),
        ...(summary.fromHighPercent !== undefined ? { fromHighPercent: summary.fromHighPercent } : {}),
        ...(summary.currentPositionPercent !== undefined ? { currentPositionPercent: summary.currentPositionPercent } : {}),
        hasDropThenRebound: summary.hasDropThenRebound
      }
    };
  });
  sendJsonWithEtag(request, response, { windowDays, items }, lastModified);
});

app.post("/api/accessories/:id/refresh", catalogRefreshRateLimit, requirePartRefreshAccess, async (request, response) => {
  const accessoryId = routeParam(request.params.id);
  if (!accessoryId) {
    response.status(400).json({ error: "주변 부품 식별자가 필요합니다." });
    return;
  }
  const accessories = await loadAccessories();
  const current = findAccessory(accessories, accessoryId);
  if (!current) {
    response.status(404).json({ error: "주변 부품을 찾을 수 없습니다." });
    return;
  }
  const blockReason = accessoryRefreshBlockReason(current);
  if (blockReason) {
    response.status(422).json({ error: blockReason, code: "ACCESSORY_REFRESH_UNSUPPORTED" });
    return;
  }
  const running = accessoryRefreshJobs.get(accessoryId);
  if (running) {
    response.status(409).json({ error: "이 주변 부품의 정보 다시 확인이 이미 실행 중입니다.", code: "ACCESSORY_REFRESH_RUNNING" });
    return;
  }
  const lastRunAt = accessoryRefreshLastRunAt.get(accessoryId);
  if (lastRunAt !== undefined) {
    const remainingMs = PART_REFRESH_COOLDOWN_MS - (Date.now() - lastRunAt);
    if (remainingMs > 0) {
      response.setHeader("Retry-After", String(Math.ceil(remainingMs / 1000)));
      response.status(429).json({ error: `같은 주변 부품은 ${Math.ceil(remainingMs / 1000)}초 후 다시 확인할 수 있습니다.`, code: "ACCESSORY_REFRESH_COOLDOWN", retryAfterSeconds: Math.ceil(remainingMs / 1000) });
      return;
    }
    accessoryRefreshLastRunAt.delete(accessoryId);
  }

  const job = (async () => {
    const refreshed = await refreshDanawaAccessory(current);
    const savedAccessories = await upsertAccessories([refreshed]);
    const savedItem = findAccessory(savedAccessories, current.id);
    if (!savedItem) throw new Error("재확인한 주변 부품을 카탈로그에 반영하지 못했습니다.");
    const result = accessoryRefreshResponse(current, savedItem);
    await appendCatalogChangeRecord(catalogChangeRecord("accessory", current, savedItem, result.changedFields, { changedAt: result.refreshedAt })).catch((error: unknown) => {
      console.warn(`주변 부품 변경 이력을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    });
    return result;
  })();
  accessoryRefreshJobs.set(accessoryId, job);
  try {
    const result = await job;
    accessoryRefreshLastRunAt.set(accessoryId, Date.now());
    response.json(result);
  } catch (error: unknown) {
    response.status(422).json({ error: error instanceof Error ? error.message : "주변 부품 상세 정보를 다시 확인하지 못했습니다.", code: "ACCESSORY_REFRESH_FAILED" });
  } finally {
    if (accessoryRefreshJobs.get(accessoryId) === job) accessoryRefreshJobs.delete(accessoryId);
  }
});

app.post("/api/compatibility/check", publicCompatibilityRateLimit, async (request, response) => {
  const parsed = parseBuild(request.body);
  if (parsed.errors.length > 0) {
    response.status(400).json({ error: "견적 입력 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const build = parsed.build;
  const recommendationPreferences = parseRecommendationPreferences(request.body?.recommendationPreferences);
  const preparation = await prepareCompatibilityRequest(build, recommendationPreferences, ENGINE_VERSION);
  const { catalog, accessories, catalogUpdatedAt: catalogSnapshotAt, accessoryUpdatedAt, catalogRevision } = preparation.snapshot;
  const requestKey = preparation.requestKey;
  const outcome = await compatibilityRequestDeduper.getOrCompute(requestKey, async (): Promise<CompatibilityApiOutcome> => {
    if (preparation.error) return { status: "error", statusCode: preparation.error.statusCode, body: preparation.error.body };
    const cacheKey = compatibilityResultCacheKey({
      build,
      recommendationPreferences,
      catalogSnapshotAt,
      accessoryUpdatedAt,
      catalogRevision,
      engineVersion: ENGINE_VERSION
    });
    const cached = await compatibilityResultCache.getOrCompute(cacheKey, () => {
      const fullResult = evaluateBuildWithAccessories(build, catalog, accessories, catalogSnapshotAt, recommendationPreferences);
      const result = compatibilityResponseFor(fullResult);
      return { result, body: JSON.stringify(result) } satisfies CompatibilityResponseCacheValue;
    });
    return { status: "ok", result: cached.value.result, body: cached.value.body, cacheLookup: cached.lookup === "COALESCED" ? "HIT" : cached.lookup };
  });
  if (outcome.value.status === "error") {
    response.status(outcome.value.statusCode).json(outcome.value.body);
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-PC-Supporter-Compatibility-Cache", outcome.lookup === "COALESCED" ? "COALESCED" : outcome.value.cacheLookup);
  response.setHeader("X-PC-Supporter-Compatibility-Checked-At", outcome.value.result.checkedAt);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", String(Buffer.byteLength(outcome.value.body)));
  response.end(outcome.value.body);
});

app.post("/api/builds/recommend", publicRecommendationRateLimit, async (request, response) => {
  const parsed = parseBuildGenerationRequest(request.body);
  if (parsed.errors.length > 0 || !parsed.request) {
    response.status(400).json({ error: "자동 견적 요청 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  let catalog: Part[] | undefined;
  try {
    catalog = await loadCatalog();
    response.json(generateBuildDraft(catalog, parsed.request));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "현재 데이터로 자동 견적을 생성하지 못했습니다.";
    const recoveryOptions = catalog ? buildGenerationRecoveryOptionsFor(catalog, parsed.request) : [];
    const diagnostics = error instanceof BuildGenerationError ? error.diagnostics : [];
    response.status(422).json({ error: message, ...(diagnostics.length > 0 ? { diagnostics } : {}), ...(recoveryOptions.length > 0 ? { recoveryOptions } : {}) });
  }
});

app.post("/api/builds/recommend/budget-ladder", publicRecommendationRateLimit, async (request, response) => {
  const parsed = parseBuildGenerationRequest(request.body);
  if (parsed.errors.length > 0 || !parsed.request) {
    response.status(400).json({ error: "예산 구간 자동 견적 요청 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  let catalog: Part[] | undefined;
  try {
    catalog = await loadCatalog();
    const scenarios = budgetLadderScenariosFor(parsed.request);
    const outcomes = scenarios.map((scenario) => {
      try {
        return { ...scenario, draft: generateBuildDraft(catalog!, scenario.request) };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "이 예산 구간의 자동 구성을 만들지 못했습니다.";
        const diagnostics = error instanceof BuildGenerationError ? error.diagnostics : [];
        return { ...scenario, error: message, ...(diagnostics.length > 0 ? { diagnostics } : {}) };
      }
    });
    response.json({ scenarios: outcomes });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "예산 구간 자동 견적을 생성하지 못했습니다.";
    const recoveryOptions = catalog ? buildGenerationRecoveryOptionsFor(catalog, parsed.request) : [];
    const diagnostics = error instanceof BuildGenerationError ? error.diagnostics : [];
    response.status(422).json({ error: message, ...(diagnostics.length > 0 ? { diagnostics } : {}), ...(recoveryOptions.length > 0 ? { recoveryOptions } : {}) });
  }
});

app.post("/api/builds", buildCreateRateLimit, async (request, response) => {
  const expiresInDays = shareExpiryDaysFrom(request.body?.expiresInDays);
  if (shareExpiryValueProvided(request.body?.expiresInDays) && expiresInDays === undefined) {
    response.status(400).json({ error: "공유 링크 유효기간은 무기한, 7일, 30일 중 하나여야 합니다." });
    return;
  }
  const rawDecisionNote = request.body?.decisionNote;
  const decisionNote = savedBuildDecisionNoteFromUnknown(rawDecisionNote);
  if (rawDecisionNote !== undefined && rawDecisionNote !== null && decisionNote === undefined && !(typeof rawDecisionNote === "string" && rawDecisionNote.trim().length === 0)) {
    response.status(400).json({ error: "결정 메모는 " + SAVED_BUILD_DECISION_NOTE_MAX_LENGTH + "자 이하의 문자열이어야 합니다.", code: "DECISION_NOTE_INVALID" });
    return;
  }
  const catalogSnapshot = await loadCatalogSnapshot();
  const { catalog, accessories } = catalogSnapshot;
  const parsed = parseBuild(request.body?.selection ?? request.body);
  if (parsed.errors.length > 0) {
    response.status(400).json({ error: "견적 입력 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const build = parsed.build;
  const validation = validateBuildSelection(build, catalog, accessories);
  if (validation.invalidSelections.length > 0) {
    response.status(400).json({ error: "유효하지 않은 부품이 포함되어 있습니다." });
    return;
  }
  if (validation.invalidAccessories.length > 0) {
    response.status(400).json({ error: "유효하지 않은 주변 부품이 포함되어 있습니다." });
    return;
  }
  if (validation.invalidAccessoryTargets.length > 0) {
    response.status(400).json({ error: "주변 부품 연결 대상 SSD가 현재 견적에 없습니다.", targetPartIds: validation.invalidAccessoryTargets });
    return;
  }
  if (validation.invalidAccessoryHubTargets.length > 0) {
    response.status(400).json({ error: "주변 부품 연결 대상 팬 허브가 현재 견적에 없습니다.", targetAccessoryIds: validation.invalidAccessoryHubTargets });
    return;
  }
  if (validation.invalidRgbControllerAccessoryIds.length > 0) {
    response.status(400).json({ error: "RGB 연결 컨트롤러가 현재 견적에 선택되어 있지 않습니다.", rgbControllerAccessoryId: validation.invalidRgbControllerAccessoryIds[0] });
    return;
  }
  if (request.body?.parentBuildId !== undefined && (typeof request.body.parentBuildId !== "string" || request.body.parentBuildId.trim().length === 0 || request.body.parentBuildId.trim().length > 120)) {
    response.status(400).json({ error: "parentBuildId는 올바른 원본 견적 ID여야 합니다." });
    return;
  }
  const parentBuildId = typeof request.body?.parentBuildId === "string" ? request.body.parentBuildId.trim() : undefined;
  const existingBuilds = parentBuildId ? await readSavedBuilds() : [];
  const parentBuild = parentBuildId ? existingBuilds.find((item) => item.id === parentBuildId) : undefined;
  if (parentBuildId && (!parentBuild || shareExpired(parentBuild.expiresAt))) {
    response.status(404).json({ error: "원본 견적을 찾을 수 없거나 링크가 만료되었습니다." });
    return;
  }
  if (parentBuild) {
    const parentOwnerToken = request.header("x-share-owner-token");
    if (!shareOwnerTokenMatches(parentBuild, parentOwnerToken)) {
      response.status(401).json({ error: "견적 버전을 연결하려면 원본 견적 소유자 인증이 필요합니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
      return;
    }
  }
  const now = new Date().toISOString();
  const expiresAt = shareExpiresAtFor(expiresInDays, Date.parse(now));
  const id = randomUUID();
  const versionMetadata = {
    versionGroupId: parentBuild ? savedBuildVersionGroupIdFor(parentBuild) : id,
    ...(parentBuild ? { derivedFromBuildId: parentBuild.id } : {})
  };
  const ownerCredential = createShareOwnerCredential();
  const recommendationPreferences = parseRecommendationPreferences(request.body?.recommendationPreferences);
  const refreshReportParse = catalogRefreshReportForRequest(request.body?.catalogRefreshReport, build, recommendationPreferences);
  if (refreshReportParse.error) {
    response.status(400).json({ error: refreshReportParse.error, code: "CATALOG_REFRESH_REPORT_INVALID" });
    return;
  }
  const catalogSnapshotAt = catalogSnapshot.catalogUpdatedAt;
  const checkSnapshotBase = compactSavedBuildCheckSnapshotFor(
    evaluateBuildWithAccessories(build, catalog, accessories, catalogSnapshotAt, recommendationPreferences, false)
  );
  const checkSnapshot = refreshReportParse.report ? { ...checkSnapshotBase, catalogRefreshReport: refreshReportParse.report } : checkSnapshotBase;
  const saved: SavedBuildRecord = {
    id,
    name: typeof request.body?.name === "string" && request.body.name.trim() ? request.body.name.trim() : "나의 PC 견적",
    ...(decisionNote ? { decisionNote } : {}),
    selection: build,
    recommendationPreferences,
    checkSnapshot,
    createdAt: now,
    updatedAt: now,
    ...(expiresAt ? { expiresAt } : {}),
    ...versionMetadata,
    ownerTokenHash: ownerCredential.hash
  };
  const persisted = await appendSavedBuild(saved);
  response.status(201).json({ ...savedBuildPresentationFor(persisted, { catalog, accessories }), ownerToken: ownerCredential.token });
});

app.post("/api/watchlists", watchlistCreateRateLimit, async (request, response) => {
  const parsed = parseSavedCatalogWatchlistInput(request.body);
  if (parsed.errors.length > 0 || !parsed.name || parsed.nearLowThresholdPercent === undefined) {
    response.status(400).json({ error: parsed.errors[0] ?? "관심 가격 목록을 저장할 수 없습니다.", details: parsed.errors });
    return;
  }
  const now = new Date().toISOString();
  const expiresAt = parsed.expiresInDays === undefined ? undefined : new Date(Date.now() + parsed.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const ownerCredential = createShareOwnerCredential();
  const saved: SavedCatalogWatchlistRecord = { id: randomUUID(), name: parsed.name, entries: parsed.entries, nearLowThresholdPercent: parsed.nearLowThresholdPercent, alertPreferences: parsed.alertPreferences ?? DEFAULT_SAVED_WATCHLIST_ALERT_PREFERENCES, createdAt: now, updatedAt: now, ...(expiresAt ? { expiresAt } : {}), ownerTokenHash: ownerCredential.hash };
  await appendSavedWatchlist(saved);
  response.status(201).json({ ...publicSavedCatalogWatchlist(saved), ownerToken: ownerCredential.token });
});

app.post("/api/comparisons", comparisonCreateRateLimit, async (request, response) => {
  const parsed = parseAlternativeComparisonInput(request.body);
  if (parsed.errors.length > 0 || !parsed.name || parsed.candidates.length < 2) {
    response.status(400).json({ error: parsed.errors[0] ?? "부품 비교를 저장할 수 없습니다.", details: parsed.errors });
    return;
  }
  const now = new Date().toISOString();
  const expiresAt = alternativeComparisonExpiresAtFor(parsed.expiresInDays, Date.parse(now));
  const ownerCredential = createShareOwnerCredential();
  const saved: SavedAlternativeComparisonRecord = {
    id: randomUUID(),
    name: parsed.name,
    ...(parsed.category ? { category: parsed.category } : {}),
    ...(parsed.currentPartName ? { currentPartName: parsed.currentPartName } : {}),
    ...(parsed.currentPartSummary ? { currentPartSummary: parsed.currentPartSummary } : {}),
    ...(parsed.currentPartPrice ? { currentPartPrice: parsed.currentPartPrice } : {}),
    ...(parsed.catalogSnapshotAt ? { catalogSnapshotAt: parsed.catalogSnapshotAt } : {}),
    ...(parsed.engineVersion ? { engineVersion: parsed.engineVersion } : {}),
    candidates: parsed.candidates,
    createdAt: now,
    updatedAt: now,
    ...(expiresAt ? { expiresAt } : {}),
    ownerTokenHash: ownerCredential.hash
  };
  await appendSavedComparison(saved);
  response.status(201).json({ ...publicAlternativeComparison(saved), ownerToken: ownerCredential.token });
});

app.get("/api/comparisons/:id", comparisonShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const comparison = (await readSavedComparisons()).find((item) => item.id === id);
  if (!comparison) {
    response.status(404).json({ error: "저장된 부품 비교를 찾을 수 없습니다." });
    return;
  }
  if (alternativeComparisonExpired(comparison)) {
    response.status(404).json({ error: "부품 비교 링크가 만료되었습니다." });
    return;
  }
  sendJsonWithEtag(request, response, publicAlternativeComparison(comparison), comparison.updatedAt);
});

app.delete("/api/comparisons/:id", comparisonShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const comparison = (await readSavedComparisons()).find((item) => item.id === id);
  if (!comparison) {
    response.status(404).json({ error: "저장된 부품 비교를 찾을 수 없습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  // When admin authentication is disabled for local development there is no
  // authenticated admin session to trust. Keep the owner-token boundary
  // enforced for this public bearer-link endpoint in that mode as well.
  if (!shareOwnerOrEnabledAdminCanManage(comparison, ownerToken, adminAuthEnabled(), isAdminAuthenticated(request))) {
    response.status(401).json({ error: "이 부품 비교를 취소할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const deleted = await deleteSavedComparison(id ?? "");
  if (!deleted) {
    response.status(404).json({ error: "저장된 부품 비교를 찾을 수 없습니다." });
    return;
  }
  response.json({ deleted: true });
});

app.post("/api/version-comparisons", versionComparisonCreateRateLimit, async (request, response) => {
  const parsed = parseSavedBuildVersionComparisonShareInput(request.body ?? {});
  if (parsed.errors.length > 0 || !parsed.beforeBuildId || !parsed.afterBuildId) {
    response.status(400).json({ error: parsed.errors[0] ?? "저장 견적 버전 비교를 만들 수 없습니다.", details: parsed.errors });
    return;
  }
  const builds = await loadBuilds();
  const before = builds.find((build) => build.id === parsed.beforeBuildId);
  const after = builds.find((build) => build.id === parsed.afterBuildId);
  if (!before || !after || shareExpired(before.expiresAt) || shareExpired(after.expiresAt)) {
    response.status(404).json({ error: "비교할 저장 견적 버전을 찾을 수 없거나 링크가 만료되었습니다." });
    return;
  }
  if (savedBuildVersionGroupIdFor(before) !== savedBuildVersionGroupIdFor(after)) {
    response.status(400).json({ error: "같은 version lineage에 속한 두 버전만 공유할 수 있습니다.", code: "VERSION_COMPARISON_LINEAGE_MISMATCH" });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  if (!shareOwnerOrEnabledAdminCanManage(after, ownerToken, adminAuthEnabled(), isAdminAuthenticated(request))) {
    response.status(401).json({ error: "버전 비교를 공유하려면 이후 버전 견적의 소유자 인증이 필요합니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const { catalog, accessories } = await loadCatalogSnapshot();
  const generatedAt = new Date().toISOString();
  const comparisonInput = {
    before,
    after,
    partMap: new Map(catalog.map((part) => [part.id, part])),
    accessoryMap: new Map(accessories.map((item) => [item.id, item])),
    fallbackPreferences: after.recommendationPreferences ?? parseRecommendationPreferences(undefined)
  };
  const exported = savedBuildVersionComparisonExportFor(comparisonInput, generatedAt);
  const payload = savedBuildVersionComparisonSharePayloadFor(exported, savedBuildVersionComparisonTextFor(comparisonInput, generatedAt));
  const now = generatedAt;
  const expiresAt = savedBuildVersionComparisonShareExpiresAtFor(parsed.expiresInDays, Date.parse(now));
  const ownerCredential = createShareOwnerCredential();
  const saved: SavedBuildVersionComparisonShareRecord = {
    id: randomUUID(),
    name: parsed.name ?? "PC Supporter 저장 견적 버전 비교",
    payload,
    sourceBeforeBuildId: before.id,
    sourceAfterBuildId: after.id,
    createdAt: now,
    updatedAt: now,
    ...(expiresAt ? { expiresAt } : {}),
    ownerTokenHash: ownerCredential.hash
  };
  await appendSavedBuildVersionComparison(saved);
  response.status(201).json({ ...publicSavedBuildVersionComparisonShare(saved), ownerToken: ownerCredential.token });
});

app.get("/api/version-comparisons/:id", versionComparisonShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const comparison = (await readSavedBuildVersionComparisons()).find((item) => item.id === id);
  if (!comparison) {
    response.status(404).json({ error: "저장된 견적 버전 비교를 찾을 수 없습니다." });
    return;
  }
  if (savedBuildVersionComparisonShareExpired(comparison)) {
    response.status(404).json({ error: "견적 버전 비교 링크가 만료되었습니다." });
    return;
  }
  sendJsonWithEtag(request, response, publicSavedBuildVersionComparisonShare(comparison), comparison.updatedAt);
});

app.delete("/api/version-comparisons/:id", versionComparisonShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const comparison = (await readSavedBuildVersionComparisons()).find((item) => item.id === id);
  if (!comparison) {
    response.status(404).json({ error: "저장된 견적 버전 비교를 찾을 수 없습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  if (!shareOwnerOrEnabledAdminCanManage(comparison, ownerToken, adminAuthEnabled(), isAdminAuthenticated(request))) {
    response.status(401).json({ error: "이 견적 버전 비교를 취소할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const deleted = await deleteSavedBuildVersionComparison(id ?? "");
  if (!deleted) {
    response.status(404).json({ error: "저장된 견적 버전 비교를 찾을 수 없습니다." });
    return;
  }
  response.json({ deleted: true });
});

app.post("/api/budget-ladders", budgetLadderCreateRateLimit, async (request, response) => {
  const parsed = parseBudgetLadderShareInput(request.body);
  if (parsed.errors.length > 0 || !parsed.name || !parsed.payload) {
    response.status(400).json({ error: parsed.errors[0] ?? "예산 구간 비교를 저장할 수 없습니다.", details: parsed.errors });
    return;
  }
  const now = new Date().toISOString();
  const { catalogUpdatedAt: catalogSnapshotAt } = await loadCatalogSnapshotTimestamp();
  const ownerCredential = createShareOwnerCredential();
  const existingLadders = parsed.parentId ? await readSavedBudgetLadders() : [];
  const parent = parsed.parentId ? existingLadders.find((item) => item.id === parsed.parentId) : undefined;
  if (parsed.parentId && (!parent || budgetLadderShareExpired(parent))) {
    response.status(400).json({ error: "원본 예산 비교 저장본을 찾을 수 없거나 만료되었습니다." });
    return;
  }
  const id = randomUUID();
  const lineageId = parent?.lineageId ?? parent?.id ?? id;
  const versionNumber = parent ? Math.max(...existingLadders.filter((item) => (item.lineageId ?? item.id) === lineageId).map((item) => item.versionNumber ?? 1), parent.versionNumber ?? 1) + 1 : 1;
  const expiresAt = budgetLadderShareExpiresAtFor(parsed.expiresInDays, Date.parse(now));
  const saved: SavedBudgetLadderRecord = {
    id,
    name: parsed.name,
    payload: parsed.payload,
    ...(parsed.parentId ? { parentId: parsed.parentId } : {}),
    lineageId,
    versionNumber,
    ...(parsed.request ? { request: parsed.request } : {}),
    catalogSnapshotAt,
    createdAt: now,
    updatedAt: now,
    ...(expiresAt ? { expiresAt } : {}),
    ownerTokenHash: ownerCredential.hash
  };
  await appendSavedBudgetLadder(saved);
  response.status(201).json({ ...publicBudgetLadderShare(saved, catalogSnapshotAt), ownerToken: ownerCredential.token });
});

app.get("/api/budget-ladders/:id", budgetLadderShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const ladder = (await readSavedBudgetLadders()).find((item) => item.id === id);
  if (!ladder) {
    response.status(404).json({ error: "저장된 예산 구간 비교를 찾을 수 없습니다." });
    return;
  }
  if (budgetLadderShareExpired(ladder)) {
    response.status(404).json({ error: "예산 구간 비교 링크가 만료되었습니다." });
    return;
  }
  const { catalogUpdatedAt: catalogSnapshotAt } = await loadCatalogSnapshotTimestamp();
  response.json(publicBudgetLadderShare(ladder, catalogSnapshotAt));
});

app.get("/api/budget-ladders/:id/lineage", budgetLadderShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const ladders = await readSavedBudgetLadders();
  const current = ladders.find((item) => item.id === id);
  if (!current) {
    response.status(404).json({ error: "저장된 예산 구간 비교를 찾을 수 없습니다." });
    return;
  }
  if (budgetLadderShareExpired(current)) {
    response.status(404).json({ error: "예산 구간 비교 링크가 만료되었습니다." });
    return;
  }
  const lineageId = current.lineageId ?? current.id;
  const entries = ladders
    .filter((item) => (item.lineageId ?? item.id) === lineageId)
    .map((item) => budgetLadderShareLineageEntryFor(item))
    .sort((left, right) => left.versionNumber - right.versionNumber || left.createdAt.localeCompare(right.createdAt));
  const payload: BudgetLadderShareLineageResponse = { lineageId, currentId: current.id, entries };
  response.json(payload);
});

app.delete("/api/budget-ladders/:id", budgetLadderShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const ladder = (await readSavedBudgetLadders()).find((item) => item.id === id);
  if (!ladder) {
    response.status(404).json({ error: "저장된 예산 구간 비교를 찾을 수 없습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  if (!shareOwnerOrEnabledAdminCanManage(ladder, ownerToken, adminAuthEnabled(), isAdminAuthenticated(request))) {
    response.status(401).json({ error: "이 예산 구간 비교를 취소할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const deleted = await deleteSavedBudgetLadder(id ?? "");
  if (!deleted) {
    response.status(404).json({ error: "저장된 예산 구간 비교를 찾을 수 없습니다." });
    return;
  }
  response.json({ deleted: true });
});

app.get("/api/watchlists/:id", watchlistShareRateLimit, async (request, response) => {
  const watchlists = await readSavedWatchlists();
  const watchlist = watchlists.find((item) => item.id === request.params.id);
  if (!watchlist) {
    response.status(404).json({ error: "저장된 관심 가격 목록을 찾을 수 없습니다." });
    return;
  }
  if (savedCatalogWatchlistExpired(watchlist)) {
    response.status(404).json({ error: "공유 관심 가격 목록이 만료되었습니다." });
    return;
  }
  response.json(publicSavedCatalogWatchlist(watchlist));
});

app.patch("/api/watchlists/:id", watchlistUpdateRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const watchlist = (await readSavedWatchlists()).find((item) => item.id === id);
  if (!watchlist) {
    response.status(404).json({ error: "저장된 관심 가격 목록을 찾을 수 없습니다." });
    return;
  }
  if (savedCatalogWatchlistExpired(watchlist)) {
    response.status(404).json({ error: "공유 관심 가격 목록이 만료되었습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  if (!shareOwnerOrEnabledAdminCanManage(watchlist, ownerToken, adminAuthEnabled(), isAdminAuthenticated(request))) {
    response.status(401).json({ error: "이 관심 가격 목록을 수정할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    response.status(400).json({ error: "관심 가격 목록 수정 형식이 올바르지 않습니다." });
    return;
  }
  const parsed = parseSavedCatalogWatchlistUpdateInput(watchlist, request.body);
  if (parsed.errors.length > 0 || !parsed.name || parsed.nearLowThresholdPercent === undefined) {
    response.status(400).json({ error: parsed.errors[0] ?? "관심 가격 목록을 수정할 수 없습니다.", details: parsed.errors });
    return;
  }
  const now = new Date().toISOString();
  const expiresAt = parsed.expiresInDaysProvided ? shareExpiresAtFor(parsed.expiresInDays, Date.parse(now)) : watchlist.expiresAt;
  const { expiresAt: _currentExpiresAt, ...watchlistWithoutExpiry } = watchlist;
  const next: SavedCatalogWatchlistRecord = {
    ...watchlistWithoutExpiry,
    name: parsed.name,
    entries: parsed.entries,
    nearLowThresholdPercent: parsed.nearLowThresholdPercent,
    alertPreferences: parsed.alertPreferences ?? DEFAULT_SAVED_WATCHLIST_ALERT_PREFERENCES,
    updatedAt: now,
    ...(expiresAt ? { expiresAt } : {})
  };
  if (!(await updateSavedWatchlist(next))) {
    response.status(409).json({ error: "관심 가격 목록이 동시에 변경되었습니다. 다시 불러온 뒤 재시도해 주세요." });
    return;
  }
  response.json(publicSavedCatalogWatchlist(next));
});

app.get("/api/watchlists/:id/alerts", watchlistAlertRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const watchlist = (await readSavedWatchlists()).find((item) => item.id === id);
  if (!watchlist) {
    response.status(404).json({ error: "저장된 관심 가격 목록을 찾을 수 없습니다." });
    return;
  }
  if (savedCatalogWatchlistExpired(watchlist)) {
    response.status(404).json({ error: "공유 관심 가격 목록이 만료되었습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  if (!shareOwnerOrEnabledAdminCanManage(watchlist, ownerToken, adminAuthEnabled(), isAdminAuthenticated(request))) {
    response.status(401).json({ error: "이 관심 가격 목록의 알림을 조회할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const rawAlerts = savedWatchlistAlertsFor(watchlist, await readUsableCatalogChangeRecords());
  const states = (await readSavedWatchlistAlertStates()).filter((state) => state.watchlistId === watchlist.id);
  const stateByAlertId = new Map(states.map((state) => [state.alertId, state]));
  const alerts: SavedWatchlistAlert[] = rawAlerts
    .filter((alert) => !stateByAlertId.get(alert.id)?.dismissedAt)
    .map((alert) => {
      const state = stateByAlertId.get(alert.id);
      return state?.readAt ? { ...alert, readAt: state.readAt } : alert;
    });
  response.json({ items: alerts, unreadCount: alerts.filter((alert) => !alert.readAt).length, alertPreferences: savedWatchlistAlertPreferencesFor(watchlist) });
});

async function updateWatchlistAlertAction(request: import("express").Request, response: import("express").Response, action: "read" | "dismiss") {
  const id = routeParam(request.params.id);
  const watchlist = (await readSavedWatchlists()).find((item) => item.id === id);
  if (!watchlist) {
    response.status(404).json({ error: "저장된 관심 가격 목록을 찾을 수 없습니다." });
    return;
  }
  if (savedCatalogWatchlistExpired(watchlist)) {
    response.status(404).json({ error: "공유 관심 가격 목록이 만료되었습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  if (!shareOwnerOrEnabledAdminCanManage(watchlist, ownerToken, adminAuthEnabled(), isAdminAuthenticated(request))) {
    response.status(401).json({ error: "이 관심 가격 목록의 알림을 변경할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const parsed = parseSavedWatchlistAlertIds(request.body);
  if (parsed.error) {
    response.status(400).json({ error: parsed.error });
    return;
  }
  const knownAlertIds = new Set(savedWatchlistAlertsFor(watchlist, await readUsableCatalogChangeRecords()).map((alert) => alert.id));
  const alertIds = parsed.alertIds.filter((alertId) => knownAlertIds.has(alertId));
  const states = await updateSavedWatchlistAlertStates(watchlist.id, alertIds, action, new Date().toISOString());
  response.json({ updated: alertIds.length, states });
}

app.post("/api/watchlists/:id/alerts/read", watchlistAlertRateLimit, async (request, response) => {
  await updateWatchlistAlertAction(request, response, "read");
});

app.post("/api/watchlists/:id/alerts/dismiss", watchlistAlertRateLimit, async (request, response) => {
  await updateWatchlistAlertAction(request, response, "dismiss");
});

app.delete("/api/watchlists/:id", watchlistShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const watchlist = (await readSavedWatchlists()).find((item) => item.id === id);
  if (!watchlist) {
    response.status(404).json({ error: "저장된 관심 가격 목록을 찾을 수 없습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  if (!shareOwnerOrEnabledAdminCanManage(watchlist, ownerToken, adminAuthEnabled(), isAdminAuthenticated(request))) {
    response.status(401).json({ error: "이 관심 가격 목록을 취소할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const deleted = await deleteSavedWatchlist(id ?? "");
  if (!deleted) {
    response.status(404).json({ error: "저장된 관심 가격 목록을 찾을 수 없습니다." });
    return;
  }
  await deleteSavedWatchlistAlertStates(id ?? "");
  response.json({ deleted: true });
});

type SavedBuildRequestOptions = {
  requireOwner?: boolean;
  allowExpired?: boolean;
  action?: string;
  unauthorizedMessage?: string;
};

async function savedBuildForRequest(request: Request, response: Response, options: SavedBuildRequestOptions = {}) {
  const id = routeParam(request.params.id);
  const build = (await loadBuilds()).find((item) => item.id === id);
  if (!build) {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return undefined;
  }
  if (!options.allowExpired && shareExpired(build.expiresAt)) {
    response.status(404).json({ error: "공유 견적 링크가 만료되었습니다." });
    return undefined;
  }
  if (!options.requireOwner) return build;
  const ownerToken = request.header("x-share-owner-token");
  if (!shareOwnerOrEnabledAdminCanManage(build, ownerToken, adminAuthEnabled(), isAdminAuthenticated(request))) {
    response.status(401).json({ error: options.unauthorizedMessage ?? `${options.action ?? "서버 백그라운드 점검"}을(를) 관리하려면 견적 소유자 인증이 필요합니다.`, code: "SHARE_OWNER_AUTH_REQUIRED" });
    return undefined;
  }
  return build;
}

async function ownedSavedBuildForRequest(request: Request, response: Response, action = "서버 백그라운드 점검", unauthorizedMessage?: string) {
  return savedBuildForRequest(request, response, { requireOwner: true, action, unauthorizedMessage });
}

app.patch("/api/builds/:id", buildShareRateLimit, async (request, response) => {
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : undefined;
  const hasName = Boolean(body && Object.prototype.hasOwnProperty.call(body, "name"));
  const hasDecisionNote = Boolean(body && Object.prototype.hasOwnProperty.call(body, "decisionNote"));
  if (!body || (!hasName && !hasDecisionNote)) {
    response.status(400).json({ error: "수정할 견적 이름 또는 선택 이유가 필요합니다.", code: "SAVED_BUILD_METADATA_PATCH_EMPTY" });
    return;
  }
  const build = await ownedSavedBuildForRequest(request, response, "저장 견적 설명 수정");
  if (!build) return;

  let name = build.name;
  if (hasName) {
    const parsedName = savedBuildNameFromUnknown(body.name);
    if (!parsedName) {
      response.status(400).json({ error: `견적 이름은 1자 이상 ${SAVED_BUILD_NAME_MAX_LENGTH}자 이하의 문자열이어야 합니다.`, code: "SAVED_BUILD_NAME_INVALID" });
      return;
    }
    name = parsedName;
  }

  let decisionNote = build.decisionNote;
  if (hasDecisionNote) {
    if (body.decisionNote === null || (typeof body.decisionNote === "string" && body.decisionNote.trim().length === 0)) {
      decisionNote = undefined;
    } else {
      const parsedDecisionNote = savedBuildDecisionNoteFromUnknown(body.decisionNote);
      if (!parsedDecisionNote) {
        response.status(400).json({ error: "결정 메모는 " + SAVED_BUILD_DECISION_NOTE_MAX_LENGTH + "자 이하의 문자열이어야 합니다.", code: "DECISION_NOTE_INVALID" });
        return;
      }
      decisionNote = parsedDecisionNote;
    }
  }

  if (name === build.name && decisionNote === build.decisionNote) {
    response.json(savedBuildPresentationFor(build, await loadSavedBuildPresentationContext()));
    return;
  }
  const updated = await updateSavedBuildMetadata(build.id, name, decisionNote);
  if (updated.status === "not-found") {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  response.json(savedBuildPresentationFor(updated.build, await loadSavedBuildPresentationContext()));
});

app.get("/api/builds/:id/metadata-history", buildShareRateLimit, async (request, response) => {
  const build = await ownedSavedBuildForRequest(request, response, "저장 견적 설명 이력");
  if (!build) return;
  response.setHeader("Cache-Control", "no-store");
  response.json({
    buildId: build.id,
    current: { name: build.name, ...(build.decisionNote ? { decisionNote: build.decisionNote } : {}) },
    total: build.metadataHistory?.length ?? 0,
    items: (build.metadataHistory ?? []).slice().reverse()
  });
});

app.get("/api/builds", buildListRateLimit, async (request, response) => {
  const rawIds = typeof request.query.ids === "string" ? request.query.ids : undefined;
  const requestedIds = rawIds === undefined ? undefined : [...new Set(rawIds.split(",").map((id) => id.trim()).filter(Boolean))].slice(0, 20);
  if (requestedIds === undefined && !isAdminAuthenticated(request)) {
    response.status(401).json({ error: "저장 견적 목록을 조회하려면 관리자 로그인이 필요합니다.", code: "ADMIN_AUTH_REQUIRED" });
    return;
  }
  const builds = (await loadBuilds())
    .filter((build) => requestedIds === undefined || requestedIds.includes(build.id))
    .filter((build) => !shareExpired(build.expiresAt));
  const requestedLimit = Number(request.query.limit ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, Math.floor(requestedLimit))) : 20;
  response.json({ items: await addSavedBuildSummaries(builds.slice(0, limit)) });
});

app.post("/api/builds/check-preview", buildMonitorRateLimit, async (request, response) => {
  const parsed = parseSavedBuildMonitorRequest(request.body);
  if (parsed.errors.length > 0) {
    response.status(400).json({ error: "저장 견적 점검 요청 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }

  const buildsById = new Map((await loadBuilds()).map((build) => [build.id, build]));
  const availableBuilds = parsed.ids
    .map((id) => buildsById.get(id))
    .filter((build): build is SavedBuildRecord => build !== undefined && !shareExpired(build.expiresAt));
  const resources = availableBuilds.length > 0 ? await loadSavedBuildMonitorResources() : undefined;
  const cacheLookups = new Set<string>();
  const items = await Promise.all(parsed.ids.map(async (id): Promise<SavedBuildMonitorItem> => {
    const build = buildsById.get(id);
    if (!build || shareExpired(build.expiresAt)) {
      return { id, status: "not_found", message: "저장 견적이 없거나 공유 링크가 만료되었습니다." };
    }
    try {
      if (!resources) throw new Error("현재 카탈로그 기준을 확보하지 못했습니다.");
      const cached = await savedBuildCheckSnapshotForResources(build, resources);
      cacheLookups.add(cached.lookup);
      const snapshot = cached.value;
      const baseline = build.checkSnapshot ?? build.checkHistory?.at(-1);
      return {
        id,
        status: "ready",
        snapshot,
        ...(baseline ? { transition: savedBuildCheckTransitionSummaryFor(baseline, snapshot) } : {})
      };
    } catch (error: unknown) {
      return { id, status: "error", message: error instanceof Error ? error.message : "현재 기준 점검에 실패했습니다." };
    }
  }));
  const payload: SavedBuildMonitorResponse = {
    requestedCount: parsed.ids.length,
    checkedCount: items.filter((item) => item.status === "ready").length,
    checkedAt: new Date().toISOString(),
    items
  };
  if (cacheLookups.size > 0) response.setHeader("X-PC-Supporter-Check-Preview-Cache", cacheLookups.size === 1 ? [...cacheLookups][0] : "MIXED");
  response.json(payload);
});

app.get("/api/builds/:id/monitor", buildShareRateLimit, async (request, response) => {
  const build = await ownedSavedBuildForRequest(request, response);
  if (!build) return;
  response.json(savedBuildMonitorResponseFor(build));
});

app.put("/api/builds/:id/monitor", buildShareRateLimit, async (request, response) => {
  const build = await ownedSavedBuildForRequest(request, response);
  if (!build) return;
  const current = build.monitorState ?? defaultSavedBuildMonitorSubscription(build.createdAt);
  const parsed = parseSavedBuildMonitorSettings(request.body, current.intervalMinutes, current.alertPolicy);
  if (!parsed.settings || parsed.errors.length > 0) {
    response.status(400).json({ error: "저장 견적 서버 모니터링 설정이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const monitorState = configureSavedBuildMonitorSubscription(current, parsed.settings, new Date().toISOString());
  const updated = await updateSavedBuildMonitorState(build.id, monitorState);
  if (!updated) {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  response.json(savedBuildMonitorResponseFor(updated));
});

app.post("/api/builds/:id/monitor/run", buildMonitorRateLimit, async (request, response) => {
  const build = await ownedSavedBuildForRequest(request, response);
  if (!build) return;
  try {
    const updated = await executeSavedBuildMonitorRun(build);
    response.json(savedBuildMonitorResponseFor(updated));
  } catch (error: unknown) {
    const latest = (await loadBuilds()).find((item) => item.id === build.id) ?? build;
    response.status(422).json({ error: error instanceof Error ? error.message : "저장 견적 서버 점검에 실패했습니다.", ...savedBuildMonitorResponseFor(latest) });
  }
});

async function updateBuildMonitorAlertAction(request: Request, response: Response, action: "read" | "dismiss") {
  const build = await ownedSavedBuildForRequest(request, response);
  if (!build) return;
  const parsed = parseSavedBuildMonitorAlertIds(request.body);
  if (parsed.errors.length > 0) {
    response.status(400).json({ error: "서버 모니터 알림 요청 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const current = build.monitorState ?? defaultSavedBuildMonitorSubscription(build.createdAt);
  const knownIds = new Set(current.alerts.map((alert) => alert.id));
  const alertIds = parsed.ids.filter((id) => knownIds.has(id));
  const monitorState = updateSavedBuildMonitorAlertState(current, alertIds, action, new Date().toISOString());
  const updated = await updateSavedBuildMonitorState(build.id, monitorState);
  if (!updated) {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  response.json({ updated: alertIds.length, ...savedBuildMonitorResponseFor(updated) });
}

app.post("/api/builds/:id/monitor/alerts/read", buildShareRateLimit, async (request, response) => {
  await updateBuildMonitorAlertAction(request, response, "read");
});

app.post("/api/builds/:id/monitor/alerts/dismiss", buildShareRateLimit, async (request, response) => {
  await updateBuildMonitorAlertAction(request, response, "dismiss");
});

app.get("/api/builds/:id", buildShareRateLimit, async (request, response) => {
  const build = await savedBuildForRequest(request, response);
  if (!build) return;
  response.json(savedBuildPresentationFor(build, await loadSavedBuildPresentationContext()));
});

app.put("/api/builds/:id/purchase-progress", buildShareRateLimit, async (request, response) => {
  const build = await ownedSavedBuildForRequest(request, response, "구매 진행률 저장", "구매 진행률을 저장하려면 견적 소유자 인증이 필요합니다.");
  if (!build) return;
  const id = build.id;
  const recommendationPreferences = build.recommendationPreferences ?? parseRecommendationPreferences(undefined);
  const expectedFingerprint = buildCompatibilityInputFingerprint(build.selection, recommendationPreferences);
  const expectedRevision = parseSavedBuildPurchaseProgressExpectedRevision(request.body?.expectedRevision);
  if (expectedRevision.error) {
    response.status(400).json({ error: expectedRevision.error });
    return;
  }
  const parsed = parseSavedBuildPurchaseProgress(request.body?.progress ?? request.body, expectedFingerprint);
  if (parsed.fingerprintMismatch) {
    response.status(409).json({ error: parsed.errors[0] ?? "현재 저장 견적과 다른 구매 진행률입니다.", code: "PURCHASE_PROGRESS_BUILD_MISMATCH" });
    return;
  }
  if (parsed.errors.length > 0 || !parsed.progress) {
    response.status(400).json({ error: parsed.errors[0] ?? "구매 진행률을 저장할 수 없습니다.", details: parsed.errors });
    return;
  }
  const updated = await updateSavedBuildPurchaseProgress(id ?? "", parsed.progress, expectedRevision.revision);
  if (updated.status === "not-found") {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  if (updated.status === "conflict") {
    response.status(409).json({ error: "서버 구매 진행률이 먼저 변경되었습니다. 서버 상태를 다시 확인한 후 저장하세요.", code: "PURCHASE_PROGRESS_CONFLICT", purchaseProgress: updated.currentProgress ?? null });
    return;
  }
  response.json(savedBuildPresentationFor(updated.build, await loadSavedBuildPresentationContext()));
});

app.put("/api/builds/:id/purchase-price-history", buildShareRateLimit, async (request, response) => {
  const build = await ownedSavedBuildForRequest(request, response, "가격 확인 이력 저장", "가격 확인 이력을 저장하려면 견적 소유자 인증이 필요합니다.");
  if (!build) return;
  const id = build.id;
  const recommendationPreferences = build.recommendationPreferences ?? parseRecommendationPreferences(undefined);
  const expectedFingerprint = buildCompatibilityInputFingerprint(build.selection, recommendationPreferences);
  const expectedRevision = parseSavedBuildPurchasePriceHistoryExpectedRevision(request.body?.expectedRevision);
  if (expectedRevision.error) {
    response.status(400).json({ error: expectedRevision.error });
    return;
  }
  const parsed = parseSavedBuildPurchasePriceHistory(request.body?.priceHistory ?? request.body, expectedFingerprint);
  if (parsed.fingerprintMismatch) {
    response.status(409).json({ error: parsed.errors[0] ?? "현재 저장 견적과 다른 가격 확인 이력입니다.", code: "PURCHASE_PRICE_HISTORY_BUILD_MISMATCH" });
    return;
  }
  if (parsed.errors.length > 0 || !parsed.priceHistory) {
    response.status(400).json({ error: parsed.errors[0] ?? "가격 확인 이력을 저장할 수 없습니다.", details: parsed.errors });
    return;
  }
  const updated = await updateSavedBuildPurchasePriceHistory(id ?? "", parsed.priceHistory, expectedRevision.revision);
  if (updated.status === "not-found") {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  if (updated.status === "conflict") {
    response.status(409).json({ error: "서버 가격 확인 이력이 먼저 변경되었습니다. 서버 상태를 다시 확인한 후 저장하세요.", code: "PURCHASE_PRICE_HISTORY_CONFLICT", purchasePriceHistory: updated.currentPriceHistory ?? null });
    return;
  }
  response.json(savedBuildPresentationFor(updated.build, await loadSavedBuildPresentationContext()));
});

app.post("/api/builds/:id/purchase-price-history/restore", buildShareRateLimit, async (request, response) => {
  const build = await ownedSavedBuildForRequest(request, response, "가격 확인 이력 복원", "가격 확인 이력을 복원하려면 견적 소유자 인증이 필요합니다.");
  if (!build) return;
  const id = build.id;
  const recommendationPreferences = build.recommendationPreferences ?? parseRecommendationPreferences(undefined);
  const expectedFingerprint = buildCompatibilityInputFingerprint(build.selection, recommendationPreferences);
  const expectedRevision = parseSavedBuildPurchasePriceHistoryExpectedRevision(request.body?.expectedRevision);
  if (expectedRevision.error) {
    response.status(400).json({ error: expectedRevision.error });
    return;
  }
  const targetRevision = parseSavedBuildPurchasePriceHistoryRevision(request.body?.revision);
  if (targetRevision.error || targetRevision.revision === undefined) {
    response.status(400).json({ error: targetRevision.error ?? "복원할 가격 확인 이력 revision이 올바르지 않습니다." });
    return;
  }
  const rowKeys = request.body?.rowKeys;
  if (!Array.isArray(rowKeys) || rowKeys.length === 0 || rowKeys.length > 100 || !rowKeys.every((key: unknown) => typeof key === "string" && key.length > 0 && key.length <= 240) || new Set(rowKeys).size !== rowKeys.length) {
    response.status(400).json({ error: "현재 구매 목록 행 key가 올바르지 않습니다." });
    return;
  }
  const updated = await restoreSavedBuildPurchasePriceHistory(id ?? "", targetRevision.revision, expectedRevision.revision, expectedFingerprint, rowKeys as string[]);
  if (updated.status === "not-found") {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  if (updated.status === "conflict") {
    response.status(409).json({ error: "서버 가격 확인 이력이 먼저 변경되었습니다. 서버 상태를 다시 확인한 후 복원하세요.", code: "PURCHASE_PRICE_HISTORY_CONFLICT", purchasePriceHistory: updated.currentPriceHistory ?? null });
    return;
  }
  if (updated.status === "history-unavailable") {
    response.status(409).json({ error: "선택한 가격 확인 이력이 현재 견적과 맞지 않거나 이미 변경되었습니다. 서버 상태를 다시 확인하세요.", code: "PURCHASE_PRICE_HISTORY_HISTORY_UNAVAILABLE", purchasePriceHistory: updated.currentPriceHistory ?? null });
    return;
  }
  response.json(savedBuildPresentationFor(updated.build, await loadSavedBuildPresentationContext()));
});

app.post("/api/builds/:id/purchase-progress/restore", buildShareRateLimit, async (request, response) => {
  const build = await ownedSavedBuildForRequest(request, response, "구매 진행률 복원", "구매 진행률을 복원하려면 견적 소유자 인증이 필요합니다.");
  if (!build) return;
  const id = build.id;
  const recommendationPreferences = build.recommendationPreferences ?? parseRecommendationPreferences(undefined);
  const expectedFingerprint = buildCompatibilityInputFingerprint(build.selection, recommendationPreferences);
  const expectedRevision = parseSavedBuildPurchaseProgressExpectedRevision(request.body?.expectedRevision);
  if (expectedRevision.error) {
    response.status(400).json({ error: expectedRevision.error });
    return;
  }
  const targetRevision = parseSavedBuildPurchaseProgressRevision(request.body?.revision);
  if (targetRevision.error || targetRevision.revision === undefined) {
    response.status(400).json({ error: targetRevision.error ?? "복원할 구매 진행률 revision이 올바르지 않습니다." });
    return;
  }
  const rowKeys = request.body?.rowKeys;
  if (!Array.isArray(rowKeys) || rowKeys.length === 0 || rowKeys.length > 100 || !rowKeys.every((key: unknown) => typeof key === "string" && key.length > 0 && key.length <= 240) || new Set(rowKeys).size !== rowKeys.length) {
    response.status(400).json({ error: "현재 구매 목록 행 key가 올바르지 않습니다." });
    return;
  }
  const updated = await restoreSavedBuildPurchaseProgress(id ?? "", targetRevision.revision, expectedRevision.revision, expectedFingerprint, rowKeys as string[]);
  if (updated.status === "not-found") {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  if (updated.status === "conflict") {
    response.status(409).json({ error: "서버 구매 진행률이 먼저 변경되었습니다. 서버 상태를 다시 확인한 후 복원하세요.", code: "PURCHASE_PROGRESS_CONFLICT", purchaseProgress: updated.currentProgress ?? null });
    return;
  }
  if (updated.status === "history-unavailable") {
    response.status(409).json({ error: "선택한 구매 진행률 이력이 현재 견적과 맞지 않거나 이미 변경되었습니다. 서버 상태를 다시 확인하세요.", code: "PURCHASE_PROGRESS_HISTORY_UNAVAILABLE", purchaseProgress: updated.currentProgress ?? null });
    return;
  }
  response.json(savedBuildPresentationFor(updated.build, await loadSavedBuildPresentationContext()));
});

app.post("/api/builds/:id/check", buildShareRateLimit, async (request, response) => {
  const build = await ownedSavedBuildForRequest(request, response, "검사 기록 추가", "검사 기록을 추가하려면 견적 소유자 인증이 필요합니다.");
  if (!build) return;
  const id = build.id;
  const { catalog, accessories, catalogUpdatedAt: catalogSnapshotAt } = await loadCatalogSnapshot();
  const recommendationPreferences = build.recommendationPreferences ?? parseRecommendationPreferences(undefined);
  const refreshReportParse = catalogRefreshReportForRequest(request.body?.catalogRefreshReport, build.selection, recommendationPreferences);
  if (refreshReportParse.error) {
    response.status(400).json({ error: refreshReportParse.error, code: "CATALOG_REFRESH_REPORT_INVALID" });
    return;
  }
  const checkSnapshotBase = compactSavedBuildCheckSnapshotFor(
    evaluateBuildWithAccessories(build.selection, catalog, accessories, catalogSnapshotAt, recommendationPreferences, false)
  );
  const checkSnapshot = refreshReportParse.report ? { ...checkSnapshotBase, catalogRefreshReport: refreshReportParse.report } : checkSnapshotBase;
  const updated = await appendSavedBuildCheck(id ?? "", checkSnapshot);
  if (!updated) {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  response.json(savedBuildPresentationFor(updated, { catalog, accessories }));
});

app.put("/api/builds/:id/assembly-verification", buildShareRateLimit, async (request, response) => {
  const build = await ownedSavedBuildForRequest(request, response, "조립 확인 기록 저장", "조립 확인 기록을 저장하려면 견적 소유자 인증이 필요합니다.");
  if (!build) return;
  const id = build.id;
  const rawHistory = request.body?.history ?? request.body?.log;
  if (!rawHistory || typeof rawHistory !== "object" || Array.isArray(rawHistory)) {
    response.status(400).json({ error: "조립 확인 이력 본문이 필요합니다." });
    return;
  }
  const rawFingerprint = typeof rawHistory.buildFingerprint === "string" ? rawHistory.buildFingerprint : "";
  const parsed = parseAssemblyVerificationHistoryJson(JSON.stringify(rawHistory), rawFingerprint);
  if (parsed.errors.length > 0 || !parsed.history) {
    response.status(400).json({ error: "조립 확인 이력 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const recommendationPreferences = build.recommendationPreferences ?? parseRecommendationPreferences(undefined);
  const expectedFingerprint = buildCompatibilityInputFingerprint(build.selection, recommendationPreferences);
  const expectedPrefix = `pc-supporter-assembly-verification:${expectedFingerprint}:`;
  if (!parsed.history.buildFingerprint.startsWith(expectedPrefix)) {
    response.status(409).json({ error: "현재 저장 견적과 다른 조립 확인 로그입니다. 같은 견적에서 생성한 로그만 저장할 수 있습니다.", code: "ASSEMBLY_VERIFICATION_BUILD_MISMATCH" });
    return;
  }
  const verificationHistory = assemblyVerificationSavedHistoryFor(parsed.history);
  const verification = verificationHistory.find((item) => item.runId === parsed.history!.activeRunId) ?? verificationHistory.at(-1);
  if (!verification) {
    response.status(400).json({ error: "조립 확인 이력이 비어 있습니다." });
    return;
  }
  const updated = await updateSavedBuildAssemblyVerification(id ?? "", verification, verificationHistory);
  if (!updated) {
    response.status(409).json({ error: "저장 견적에 먼저 검사 결과를 기록해야 조립 확인 로그를 연결할 수 있습니다.", code: "ASSEMBLY_VERIFICATION_CHECK_REQUIRED" });
    return;
  }
  response.json(savedBuildPresentationFor(updated, await loadSavedBuildPresentationContext()));
});

app.get("/api/builds/:id/check-causes", buildShareRateLimit, async (request, response) => {
  const build = await savedBuildForRequest(request, response);
  if (!build) return;
  const from = typeof request.query.from === "string" ? request.query.from.slice(0, 120) : undefined;
  const to = typeof request.query.to === "string" ? request.query.to.slice(0, 120) : undefined;
  const fromTimestamp = from ? Date.parse(from) : NaN;
  const toTimestamp = to ? Date.parse(to) : NaN;
  if (!from || !to || !Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp)) {
    response.status(400).json({ error: "검사 원인 조회 시점이 올바르지 않습니다." });
    return;
  }
  const records = await readUsableCatalogChangeRecords();
  response.json({ from, to, items: savedBuildCatalogChangeCausesFor(build.selection, records, from, to, 50) });
});

app.delete("/api/builds/:id", buildShareRateLimit, async (request, response) => {
  const build = await savedBuildForRequest(request, response, { requireOwner: true, allowExpired: true, unauthorizedMessage: "이 공유 견적을 취소할 권한이 없습니다." });
  if (!build) return;
  const id = build.id;
  const deleted = await deleteSavedBuild(id ?? "");
  if (!deleted) {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  response.json({ deleted: true });
});

app.get("/api/admin/catalog-changes", requireAdmin, async (request, response) => {
  const rawKind = typeof request.query.kind === "string" ? request.query.kind : undefined;
  const kind: CatalogChangeKind | undefined = rawKind === "part" || rawKind === "accessory" ? rawKind : undefined;
  const category = typeof request.query.category === "string" ? request.query.category.slice(0, 80) : undefined;
  const rawLimit = Number(request.query.limit ?? 20);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 20;
  const from = typeof request.query.from === "string" ? request.query.from.slice(0, 80) : undefined;
  const to = typeof request.query.to === "string" ? request.query.to.slice(0, 80) : undefined;
  const fromTimestamp = from ? Date.parse(from) : undefined;
  const toTimestamp = to ? Date.parse(to) : undefined;
  if ((from !== undefined && !Number.isFinite(fromTimestamp)) || (to !== undefined && !Number.isFinite(toTimestamp))) {
    response.status(400).json({ error: "변경 로그 날짜 범위를 확인해 주세요." });
    return;
  }
  if (fromTimestamp !== undefined && toTimestamp !== undefined && fromTimestamp > toTimestamp) {
    response.status(400).json({ error: "변경 로그 시작일은 종료일보다 빠르거나 같아야 합니다." });
    return;
  }
  response.json({ items: await readCatalogChangeRecords({ kind, category, limit, from, to }) });
});

app.get("/api/admin/catalog-spec/review-package", requireAdmin, async (request, response) => {
  const rawCategory = typeof request.query.category === "string" ? request.query.category : undefined;
  const category = rawCategory && PART_CATEGORIES.includes(rawCategory as PartCategory) ? rawCategory as PartCategory : undefined;
  const rawPriority = typeof request.query.priority === "string" ? request.query.priority : undefined;
  const priority: CatalogSpecReviewPriority | undefined = rawPriority === "high" || rawPriority === "medium" || rawPriority === "low" ? rawPriority : undefined;
  const rawAction = typeof request.query.action === "string" ? request.query.action : undefined;
  const action: CatalogSpecReviewAction | undefined = rawAction === "refresh_source" || rawAction === "review_source" || rawAction === "inspect_catalog" ? rawAction : undefined;
  const rawEvidence = typeof request.query.evidence === "string" ? request.query.evidence : undefined;
  const evidence: CatalogSpecReviewEvidence | undefined = rawEvidence === "all" || rawEvidence === "spec" || rawEvidence === "pcie" ? rawEvidence : undefined;
  if (rawEvidence !== undefined && evidence === undefined) {
    response.status(400).json({ error: "스펙 보강 목록 정보 범위가 올바르지 않습니다.", details: ["evidence는 all, spec, pcie 중 하나여야 합니다."] });
    return;
  }
  const query = typeof request.query.q === "string" ? request.query.q.slice(0, 120) : undefined;
  const missingField = parseCatalogMissingField(request.query.missingField);
  if (missingField.error) {
    response.status(400).json({ error: "스펙 보강 목록 누락 필드 형식이 올바르지 않습니다.", details: [missingField.error] });
    return;
  }
  const requestedLimit = Number(request.query.limit ?? 24);
  const requestedOffset = Number(request.query.offset ?? 0);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 24;
  const offset = Number.isFinite(requestedOffset) ? Math.min(100_000, Math.max(0, Math.floor(requestedOffset))) : 0;
  const expectedQueueFingerprint = typeof request.query.queueFingerprint === "string" && request.query.queueFingerprint.trim().length > 0
    ? request.query.queueFingerprint.trim().slice(0, 120)
    : undefined;
  const catalog = await loadCatalog();
  const eligibleCatalog = catalog.filter((part) => isListingAllowed(part, "all"));
  const refreshHistory = await readCatalogSpecRefreshHistory(20);
  const workPackage = catalogSpecReviewWorkPackageFor(eligibleCatalog, { category, priority, action, evidence, query, missingField: missingField.value, offset, limit, refreshHistory });
  response.json({
    ...workPackage,
    ...(expectedQueueFingerprint && offset > 0 && expectedQueueFingerprint !== workPackage.queueFingerprint ? { queueChanged: true } : {}),
    excludedNonCoreCount: catalog.length - eligibleCatalog.length,
    categoryMismatchExcludedCount: catalog.filter((part) => catalogCategoryMismatchFor(part) !== undefined).length
  });
});

app.get("/api/admin/catalog-category-integrity/review-package", requireAdmin, async (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 6);
  const requestedOffset = Number(request.query.offset ?? 0);
  const limit = Number.isFinite(requestedLimit) ? Math.min(24, Math.max(1, Math.floor(requestedLimit))) : 6;
  const offset = Number.isFinite(requestedOffset) ? Math.min(100_000, Math.max(0, Math.floor(requestedOffset))) : 0;
  const expectedQueueFingerprint = typeof request.query.queueFingerprint === "string" && request.query.queueFingerprint.trim().length > 0
    ? request.query.queueFingerprint.trim().slice(0, 120)
    : undefined;
  const catalog = await loadCatalog();
  const reviewPackage = catalogCategoryIntegrityReviewPackageFor(catalog, { offset, limit });
  response.json({
    ...reviewPackage,
    ...(expectedQueueFingerprint && offset > 0 && expectedQueueFingerprint !== reviewPackage.queueFingerprint ? { queueChanged: true } : {})
  });
});

app.get("/api/admin/catalog-spec/refresh-history", requireAdmin, async (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(20, Math.max(1, Math.floor(requestedLimit))) : 10;
  response.json({ items: await readCatalogSpecRefreshHistory(limit) });
});

app.get("/api/admin/catalog-spec/refresh-progress", requireAdmin, async (_request, response) => {
  response.json(catalogSpecRefreshProgressSummaryFor(await readCatalogSpecRefreshHistory(20)));
});

function catalogSpecOverrideValidationCounts(validation: CatalogSpecOverrideBatchValidation) {
  return {
    validCount: validation.items.filter((item) => item.valid).length,
    invalidCount: validation.items.filter((item) => !item.valid).length
  };
}

app.get("/api/admin/catalog-spec-overrides", requireAdmin, async (_request, response) => {
  const catalog = await loadCatalog();
  response.json({ items: catalogSpecOverrideListItems(catalog, await readCatalogSpecOverrides()) });
});

app.get("/api/admin/catalog-spec-overrides/export", requireAdmin, async (_request, response) => {
  response.json({ exportedAt: new Date().toISOString(), items: sortedCatalogSpecOverrides(await readCatalogSpecOverrides()) });
});

app.post("/api/admin/catalog-spec-overrides/batch/validate", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const validation = validateCatalogSpecOverrideBatch(request.body, catalog, await readCatalogSpecOverrides());
  if (validation.errors.length > 0 && validation.items.length === 0) {
    response.status(400).json({ error: "카탈로그 스펙 override 입력 형식이 올바르지 않습니다.", details: validation.errors });
    return;
  }
  response.json({ ...catalogSpecOverrideValidationCounts(validation), items: validation.items });
});

app.put("/api/admin/catalog-spec-overrides/batch", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const validation = validateCatalogSpecOverrideBatch(request.body, catalog, await readCatalogSpecOverrides());
  if (validation.errors.length > 0) {
    response.status(400).json({ saved: false, error: "카탈로그 스펙 override 저장을 중단했습니다. 오류가 있는 항목은 하나라도 저장하지 않습니다.", details: validation.errors, ...catalogSpecOverrideValidationCounts(validation), items: validation.items });
    return;
  }
  await saveCatalogSpecOverrides(validation.validOverrides);
  invalidateCatalogCache();
  const updatedCatalog = await loadCatalog();
  const changeRecords = validation.items
    .filter((item) => item.valid && item.operation !== "unchanged" && item.override)
    .flatMap((item) => {
      const before = findPart(catalog, item.partId);
      const after = findPart(updatedCatalog, item.partId);
      if (!before || !after) return [];
      const changedFields = [...new Set(["수동 스펙 override", ...meaningfulCatalogChangeFields(before, after)])];
      return changedFields.length > 0 ? [catalogChangeRecord("part", before, after, changedFields, { changedAt: item.override?.updatedAt })] : [];
    });
  await appendCatalogChangeRecords(changeRecords).catch((error: unknown) => {
    console.warn(`카탈로그 스펙 override 변경 이력을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  });
  response.json({ saved: true, count: validation.validOverrides.length, items: catalogSpecOverrideListItems(updatedCatalog, await readCatalogSpecOverrides()) });
});

app.delete("/api/admin/catalog-spec-overrides/:partId", requireAdmin, async (request, response) => {
  const partId = routeParam(request.params.partId);
  if (!partId) {
    response.status(400).json({ error: "부품 식별자가 필요합니다." });
    return;
  }
  const beforeCatalog = await loadCatalog();
  const deleted = await deleteCatalogSpecOverride(partId);
  if (!deleted) {
    response.status(404).json({ error: "카탈로그 스펙 override를 찾을 수 없습니다." });
    return;
  }
  invalidateCatalogCache();
  const afterCatalog = await loadCatalog();
  const before = findPart(beforeCatalog, partId);
  const after = findPart(afterCatalog, partId);
  if (before && after) {
    const changedFields = [...new Set(["수동 스펙 override 제거", ...meaningfulCatalogChangeFields(before, after)])];
    await appendCatalogChangeRecord(catalogChangeRecord("part", before, after, changedFields)).catch((error: unknown) => {
      console.warn(`카탈로그 스펙 override 삭제 이력을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  response.json({ deleted: true, partId, part: after });
});

app.post("/api/admin/catalog-spec-overrides/source-check/batch", catalogSpecSourceCheckBatchRateLimit, requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  const rawCategory = typeof body.category === "string" ? body.category : undefined;
  const category = PART_CATEGORIES.includes(rawCategory as PartCategory) ? rawCategory as PartCategory : undefined;
  const requestedPartIds = Array.isArray(body.partIds)
    ? [...new Set(body.partIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))].slice(0, 50)
    : undefined;
  const requestedLimit = Number(body.limit ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, Math.floor(requestedLimit))) : 20;
  const requestedOffset = Number(body.offset ?? 0);
  const offset = Number.isFinite(requestedOffset) ? Math.min(100_000, Math.max(0, Math.floor(requestedOffset))) : 0;
  const persist = body.persist !== false;
  const overrides = await readCatalogSpecOverrides();
  const candidates = Object.values(overrides)
    .filter((override) => Boolean(override.sourceUrl))
    .map((override) => {
      const part = findPart(catalog, override.partId);
      return part && override.category === part.category ? { part, override } : undefined;
    })
    .filter((item): item is { part: Part; override: (typeof overrides)[string] & { sourceUrl: string } } => Boolean(item))
    .filter(({ part }) => !category || part.category === category)
    .filter(({ part }) => !requestedPartIds || requestedPartIds.includes(part.id))
    .sort((left, right) => left.part.name.localeCompare(right.part.name, "ko-KR"));
  const candidateIds = new Set(candidates.map(({ part }) => part.id));
  const skipped = offset === 0 ? (requestedPartIds ?? [])
    .filter((partId) => !candidateIds.has(partId))
    .map((partId) => ({ partId, reason: "저장된 HTTPS 카탈로그 스펙 정보 URL이 없거나 현재 카탈로그와 일치하지 않습니다." })) : [];
  const result = await catalogSpecSourceCheckBatchFor(candidates.map(({ part, override }) => ({
    partId: part.id,
    partName: part.name,
    category: part.category,
    sourceUrl: override.sourceUrl,
    manufacturerModel: override.manufacturerModel
  })), {
    limit,
    offset,
    concurrency: 2,
    persist,
    persistCheck: async (partId, sourceCheck) => {
      const stored = await saveCatalogSpecOverrideSourceCheck(partId, sourceCheck);
      if (stored) await appendCatalogSpecOverrideSourceCheckHistory(partId, sourceCheck).catch(() => undefined);
      return stored;
    },
    skipped
  });
  if (result.persistedCount > 0) invalidateCatalogCache();
  response.json(result);
});

app.post("/api/admin/catalog-spec-overrides/:partId/source-check", catalogSpecSourceCheckRateLimit, requireAdmin, async (request, response) => {
  const partId = routeParam(request.params.partId);
  if (!partId) {
    response.status(400).json({ error: "스펙 override 페이지 확인 대상 식별자가 필요합니다." });
    return;
  }
  const catalog = await loadCatalog();
  const part = findPart(catalog, partId);
  if (!part || !isListingAllowed(part, "all")) {
    response.status(404).json({ error: "스펙 override 페이지를 확인할 핵심 부품을 찾을 수 없습니다." });
    return;
  }
  const override = (await readCatalogSpecOverrides())[partId];
  if (!override) {
    response.status(404).json({ error: "먼저 수동 스펙 override를 저장해야 페이지를 확인할 수 있습니다." });
    return;
  }
  if (catalogSpecSourceCheckJobs.has(partId)) {
    response.status(409).json({ error: "이 스펙 override의 페이지 확인이 이미 실행 중입니다.", code: "CATALOG_SPEC_SOURCE_CHECK_RUNNING" });
    return;
  }
  const lastRunAt = catalogSpecSourceCheckLastRunAt.get(partId);
  if (lastRunAt !== undefined) {
    const remainingMs = PART_REFRESH_COOLDOWN_MS - (Date.now() - lastRunAt);
    if (remainingMs > 0) {
      const retryAfterSeconds = Math.ceil(remainingMs / 1000);
      response.setHeader("Retry-After", String(retryAfterSeconds));
      response.status(429).json({ error: `같은 정보는 ${retryAfterSeconds}초 후 다시 점검할 수 있습니다.`, code: "CATALOG_SPEC_SOURCE_CHECK_COOLDOWN", retryAfterSeconds });
      return;
    }
    catalogSpecSourceCheckLastRunAt.delete(partId);
  }
  const job = checkPhysicalSourceUrl(override.sourceUrl, override.manufacturerModel);
  catalogSpecSourceCheckJobs.set(partId, job);
  const persist = request.query.persist !== "false";
  try {
    const sourceCheck = await job;
    catalogSpecSourceCheckLastRunAt.set(partId, Date.now());
    const checkedOverride = persist ? await saveCatalogSpecOverrideSourceCheck(partId, sourceCheck) : override;
    if (!checkedOverride) {
      response.status(404).json({ error: "스펙 override가 점검 중 사라졌습니다." });
      return;
    }
    const historyEntry = persist ? await appendCatalogSpecOverrideSourceCheckHistory(partId, sourceCheck).catch(() => undefined) : undefined;
    if (persist) invalidateCatalogCache();
    const refreshedCatalog = persist ? await loadCatalog() : catalog;
    response.json({ persisted: persist, historyRecorded: Boolean(historyEntry), sourceCheck, override: checkedOverride, part: refreshedCatalog.find((candidate) => candidate.id === partId) });
  } catch (error: unknown) {
    response.status(422).json({ error: error instanceof Error ? error.message : "수동 스펙 정보를 점검하지 못했습니다.", code: "CATALOG_SPEC_SOURCE_CHECK_FAILED" });
  } finally {
    if (catalogSpecSourceCheckJobs.get(partId) === job) catalogSpecSourceCheckJobs.delete(partId);
  }
});

app.get("/api/admin/catalog-spec-overrides/:partId/source-check/history", requireAdmin, async (request, response) => {
  const partId = routeParam(request.params.partId);
  if (!partId || !(await readCatalogSpecOverrides())[partId]) {
    response.status(404).json({ error: "스펙 override 페이지 확인 이력을 조회할 항목을 찾을 수 없습니다." });
    return;
  }
  const requestedLimit = Number(request.query.limit ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.min(20, Math.max(1, Math.floor(requestedLimit))) : 20;
  response.json({ partId, entries: await readCatalogSpecOverrideSourceCheckHistory(partId, limit) });
});

app.get("/api/admin/crawl/status", requireAdmin, async (_request, response) => {
  response.json(await readCrawlStatus());
});

app.get("/api/admin/crawl/resume-preview", requireAdmin, async (request, response) => {
  const rawCategory = typeof request.query.category === "string" ? request.query.category : undefined;
  if (rawCategory !== undefined && rawCategory !== "all" && !PART_CATEGORIES.includes(rawCategory as PartCategory)) {
    response.status(400).json({ error: "유효하지 않은 핵심 부품 카테고리입니다." });
    return;
  }
  const manifest = await readJson<CrawlManifest | null>(CRAWL_MANIFEST_PATH, null);
  const requestedCategory = rawCategory === undefined || rawCategory === "all" ? undefined : rawCategory as PartCategory;
  const category = rawCategory === undefined ? manifest?.category : requestedCategory;
  const plan = crawlResumePlanFor(manifest, category);
  const running = isCrawlRunning();
  const preview: CrawlResumePreview = {
    schemaVersion: 1,
    kind: "crawl-resume-preview",
    readOnly: true,
    running,
    available: !running && plan.available,
    ...(manifest?.mode ? { mode: manifest.mode } : {}),
    ...(category ? { category } : {}),
    ...(manifest?.startedAt ? { manifestStartedAt: manifest.startedAt } : {}),
    ...(manifest?.finishedAt ? { manifestFinishedAt: manifest.finishedAt } : {}),
    completedCategories: plan.completedCategories,
    remainingCategories: plan.remainingCategories,
    ...(running ? { reason: "현재 카탈로그 수집 작업이 실행 중입니다." } : plan.reason ? { reason: plan.reason } : {})
  };
  response.json(preview);
});

app.get("/api/admin/crawl/manifest", requireAdmin, async (_request, response) => {
  const manifest = await readJson<CrawlManifest | null>(CRAWL_MANIFEST_PATH, null);
  if (!manifest) {
    response.status(404).json({ error: "아직 생성된 크롤 manifest가 없습니다." });
    return;
  }
  response.json(manifest);
});

app.post("/api/admin/crawl/retry-page", adminCatalogCrawlRetryRateLimit, requireAdmin, async (request, response) => {
  if (isCrawlRunning()) {
    response.status(409).json({ error: "이미 카탈로그 수집 작업이 실행 중입니다.", code: "CRAWL_PAGE_RETRY_RUNNING" });
    return;
  }
  const rawCategory = request.body?.category;
  if (!PART_CATEGORIES.includes(rawCategory as PartCategory)) {
    response.status(400).json({ error: "유효한 핵심 부품 카테고리가 필요합니다." });
    return;
  }
  const category = rawCategory as PartCategory;
  const page = Number(request.body?.page);
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    response.status(400).json({ error: "재시도할 페이지는 1부터 1000 사이의 정수여야 합니다." });
    return;
  }
  const expectedManifestStartedAt = typeof request.body?.expectedManifestStartedAt === "string" ? request.body.expectedManifestStartedAt : undefined;
  const manifest = await readJson<CrawlManifest | null>(CRAWL_MANIFEST_PATH, null);
  if (expectedManifestStartedAt && manifest?.startedAt !== expectedManifestStartedAt) {
    response.status(409).json({ error: "수집 manifest가 변경되었습니다. 최신 실패 페이지 목록을 다시 확인해 주세요.", code: "CRAWL_PAGE_RETRY_STALE" });
    return;
  }
  const plan = crawlPageRetryPlanFor(manifest, category, page);
  if (!plan.available) {
    response.status(409).json({ error: plan.reason ?? "재시도할 실패 페이지를 찾을 수 없습니다.", code: "CRAWL_PAGE_RETRY_UNAVAILABLE" });
    return;
  }
  void runCrawlPageRetryJob({
    category,
    page,
    ...(expectedManifestStartedAt ? { expectedManifestStartedAt } : {}),
    details: request.body?.details !== false,
    delayMs: Number(process.env.DANAWA_CRAWL_DELAY_MS ?? 850),
    timeoutMs: Number(process.env.DANAWA_CRAWL_TIMEOUT_MS ?? 20000),
    retries: Number(process.env.DANAWA_CRAWL_RETRIES ?? 2)
  });
  response.status(202).json({ message: `${category} ${page}페이지 재시도를 시작했습니다.`, mode: "page-retry", category, page, ...(manifest?.startedAt ? { manifestStartedAt: manifest.startedAt } : {}) });
});

app.post("/api/admin/crawl/retry-failed-pages", adminCatalogCrawlRetryBatchRateLimit, requireAdmin, async (request, response) => {
  if (isCrawlRunning()) {
    response.status(409).json({ error: "이미 카탈로그 수집 작업이 실행 중입니다.", code: "CRAWL_PAGE_RETRY_RUNNING" });
    return;
  }
  const expectedManifestStartedAt = typeof request.body?.expectedManifestStartedAt === "string" ? request.body.expectedManifestStartedAt : undefined;
  const manifest = await readJson<CrawlManifest | null>(CRAWL_MANIFEST_PATH, null);
  if (expectedManifestStartedAt && manifest?.startedAt !== expectedManifestStartedAt) {
    response.status(409).json({ error: "수집 manifest가 변경되었습니다. 최신 실패 페이지 목록을 다시 확인해 주세요.", code: "CRAWL_PAGE_RETRY_STALE" });
    return;
  }
  const plan = crawlPageRetryBatchPlanFor(manifest);
  if (!plan.available) {
    response.status(409).json({ error: plan.reason ?? "재시도할 실패 페이지를 찾을 수 없습니다.", code: "CRAWL_PAGE_RETRY_UNAVAILABLE" });
    return;
  }
  void runCrawlPageRetryBatchJob({
    ...(expectedManifestStartedAt ? { expectedManifestStartedAt } : {}),
    details: request.body?.details !== false,
    delayMs: Number(process.env.DANAWA_CRAWL_DELAY_MS ?? 850),
    timeoutMs: Number(process.env.DANAWA_CRAWL_TIMEOUT_MS ?? 20000),
    retries: Number(process.env.DANAWA_CRAWL_RETRIES ?? 2)
  });
  response.status(202).json({ message: `실패 페이지 ${plan.failures.length}개 일괄 재시도를 시작했습니다.`, mode: "page-retry-batch", total: plan.failures.length, ...(manifest?.startedAt ? { manifestStartedAt: manifest.startedAt } : {}) });
});

app.post("/api/admin/crawl/retry-failed-pages/cancel", requireAdmin, (_request, response) => {
  if (!isCrawlPageRetryBatchRunning()) {
    response.status(409).json({
      error: isCrawlRunning() ? "현재 실행 중인 작업은 실패 페이지 일괄 재시도가 아닙니다." : "실행 중인 실패 페이지 일괄 재시도가 없습니다.",
      code: isCrawlRunning() ? "CRAWL_PAGE_RETRY_RUNNING" : "CRAWL_PAGE_RETRY_BATCH_NOT_RUNNING"
    });
    return;
  }
  cancelCrawlPageRetryBatch();
  response.status(202).json({ message: "실패 페이지 일괄 재시도 중단을 요청했습니다.", mode: "page-retry-batch", status: "cancelling" });
});

app.get("/api/admin/accessories/crawl/status", requireAdmin, async (_request, response) => {
  response.json(await readAccessoryCrawlStatus());
});

app.get("/api/admin/accessories/crawl/manifest", requireAdmin, async (_request, response) => {
  const manifest = await readAccessoryCrawlManifest();
  if (!manifest) {
    response.status(404).json({ error: "아직 생성된 주변 부품 크롤 manifest가 없습니다." });
    return;
  }
  response.json(manifest);
});

app.get("/api/admin/accessories/coverage", requireAdmin, async (_request, response) => {
  response.json(await readAccessoryCoverage());
});

app.get("/api/admin/m2-overrides", requireAdmin, async (_request, response) => {
  const overrides = await readM2SlotOverrides();
  response.json({ items: sortM2SlotOverrides(overrides) });
});

app.get("/api/admin/m2-overrides/coverage", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const overrides = await readM2SlotOverrides();
  const rawFilter = typeof request.query.status === "string" ? request.query.status : "needs_review";
  const filter: M2CoverageFilter = ["mapped", "stale", "incomplete", "unmapped", "all", "needs_review"].includes(rawFilter)
    ? rawFilter as M2CoverageFilter
    : "needs_review";
  const rawLimit = Number(request.query.limit ?? 20);
  const rawOffset = Number(request.query.offset ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 20;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const query = typeof request.query.q === "string" ? request.query.q.slice(0, 120) : undefined;
  response.json(buildM2SlotCoverage(catalog, overrides, { filter, query, offset, limit }));
});

app.get("/api/admin/m2-overrides/review-template", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const overrides = await readM2SlotOverrides();
  const rawFilter = typeof request.query.status === "string" ? request.query.status : "needs_review";
  const filter: M2CoverageFilter = ["mapped", "stale", "incomplete", "unmapped", "all", "needs_review"].includes(rawFilter)
    ? rawFilter as M2CoverageFilter
    : "needs_review";
  const rawLimit = Number(request.query.limit ?? 100);
  const rawOffset = Number(request.query.offset ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 100;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  const query = typeof request.query.q === "string" ? request.query.q.slice(0, 120) : undefined;
  response.json(buildM2SlotReviewTemplate(catalog, overrides, { filter, query, offset, limit }));
});

app.get("/api/admin/m2-overrides/export", requireAdmin, async (_request, response) => {
  const overrides = await readM2SlotOverrides();
  response.json({ exportedAt: new Date().toISOString(), items: sortM2SlotOverrides(overrides) });
});

app.post("/api/admin/m2-overrides/batch/validate", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const validation = validateM2SlotOverrideBatch(request.body, catalog);
  if (validation.errors.length > 0 && validation.items.length === 0) {
    response.status(400).json({ error: "M.2 override 일괄 입력 형식이 올바르지 않습니다.", details: validation.errors });
    return;
  }
  const counts = m2BatchValidationCounts(validation);
  response.json({
    ...counts,
    items: validation.items
  });
});

app.put("/api/admin/m2-overrides/batch", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const validation = validateM2SlotOverrideBatch(request.body, catalog);
  if (validation.errors.length > 0) {
    const counts = m2BatchValidationCounts(validation);
    response.status(400).json({
      saved: false,
      error: "M.2 override 일괄 저장을 중단했습니다. 오류가 있는 항목은 하나라도 저장하지 않습니다.",
      details: validation.errors,
      ...counts,
      items: validation.items
    });
    return;
  }
  await saveM2SlotOverrides(validation.validOverrides);
  invalidateCatalogCache();
  const savedOverrides = await readM2SlotOverrides();
  response.json({ saved: true, count: validation.validOverrides.length, items: sortM2SlotOverrides(savedOverrides) });
});

app.put("/api/admin/m2-overrides/:partId", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const partId = routeParam(request.params.partId);
  if (!partId) {
    response.status(400).json({ error: "메인보드 식별자가 필요합니다." });
    return;
  }
  const part = findPart(catalog, partId);
  if (!part || part.category !== "motherboard") {
    response.status(404).json({ error: "M.2 슬롯 정보를 등록할 메인보드를 찾을 수 없습니다." });
    return;
  }
  const validation = validateM2SlotOverrideForPart(partId, part, request.body);
  if (validation.errors.length > 0 || !validation.value) {
    response.status(400).json({ error: "M.2 슬롯 정보 형식이 올바르지 않습니다.", details: validation.errors });
    return;
  }
  const override = await saveM2SlotOverride(validation.value);
  invalidateCatalogCache();
  const refreshedCatalog = await loadCatalog();
  response.json({ override, part: refreshedCatalog.find((candidate) => candidate.id === partId) });
});

app.delete("/api/admin/m2-overrides/:partId", requireAdmin, async (request, response) => {
  const partId = routeParam(request.params.partId);
  if (!partId) {
    response.status(400).json({ error: "메인보드 식별자가 필요합니다." });
    return;
  }
  const deleted = await deleteM2SlotOverride(partId);
  if (!deleted) {
    response.status(404).json({ error: "삭제할 M.2 슬롯 override를 찾을 수 없습니다." });
    return;
  }
  invalidateCatalogCache();
  response.json({ deleted: true, partId });
});

function caseRgbLoadValidationCounts(validation: CaseRgbLoadOverrideBatchValidation) {
  return {
    validCount: validation.items.filter((item) => item.valid).length,
    invalidCount: validation.items.filter((item) => !item.valid).length,
    createCount: validation.items.filter((item) => item.operation === "create").length,
    updateCount: validation.items.filter((item) => item.operation === "update").length,
    unchangedCount: validation.items.filter((item) => item.operation === "unchanged").length
  };
}

app.get("/api/admin/case-rgb-load-overrides", requireAdmin, async (_request, response) => {
  const catalog = await loadCatalog();
  response.json({ items: caseRgbLoadOverrideListItems(catalog, await readCaseRgbLoadOverrides()) });
});

app.get("/api/admin/case-rgb-load-overrides/export", requireAdmin, async (_request, response) => {
  const catalog = await loadCatalog();
  response.json({ exportedAt: new Date().toISOString(), items: caseRgbLoadOverrideListItems(catalog, await readCaseRgbLoadOverrides()) });
});

app.get("/api/admin/case-rgb-load-overrides/coverage", requireAdmin, async (_request, response) => {
  const catalog = await loadCatalog();
  response.json(caseRgbLoadCoverageFor(catalog, await readCaseRgbLoadOverrides()));
});

app.post("/api/admin/case-rgb-load-overrides/batch/validate", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const validation = validateCaseRgbLoadOverrideBatch(request.body, catalog, await readCaseRgbLoadOverrides());
  const counts = caseRgbLoadValidationCounts(validation);
  if (validation.errors.length > 0 && validation.items.length === 0) {
    response.status(400).json({ error: "케이스 RGB 부하 보강 입력 형식이 올바르지 않습니다.", details: validation.errors, ...counts, items: validation.items });
    return;
  }
  response.json({ ...counts, items: validation.items });
});

app.put("/api/admin/case-rgb-load-overrides/batch", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const validation = validateCaseRgbLoadOverrideBatch(request.body, catalog, await readCaseRgbLoadOverrides());
  const counts = caseRgbLoadValidationCounts(validation);
  if (validation.errors.length > 0) {
    response.status(400).json({ saved: false, error: "케이스 RGB 부하 보강 저장을 중단했습니다. 오류가 있는 항목은 하나라도 저장하지 않습니다.", details: validation.errors, ...counts, items: validation.items });
    return;
  }
  await saveCaseRgbLoadOverrides(validation.validOverrides);
  invalidateCatalogCache();
  const refreshedCatalog = await loadCatalog();
  response.json({ saved: true, count: validation.validOverrides.length, items: caseRgbLoadOverrideListItems(refreshedCatalog, await readCaseRgbLoadOverrides()) });
});

app.put("/api/admin/case-rgb-load-overrides/:partId", requireAdmin, async (request, response) => {
  const partId = routeParam(request.params.partId);
  if (!partId) {
    response.status(400).json({ error: "케이스 식별자가 필요합니다." });
    return;
  }
  const catalog = await loadCatalog();
  const part = findPart(catalog, partId);
  if (!part || part.category !== "case") {
    response.status(404).json({ error: "RGB 부하를 등록할 케이스를 찾을 수 없습니다." });
    return;
  }
  const validation = validateCaseRgbLoadOverride(part, request.body);
  if (validation.errors.length > 0 || !validation.value) {
    response.status(400).json({ error: "케이스 RGB 부하 보강 형식이 올바르지 않습니다.", details: validation.errors });
    return;
  }
  await saveCaseRgbLoadOverrides([validation.value]);
  invalidateCatalogCache();
  const refreshedCatalog = await loadCatalog();
  response.json({ override: validation.value, part: refreshedCatalog.find((candidate) => candidate.id === partId) });
});

app.delete("/api/admin/case-rgb-load-overrides/:partId", requireAdmin, async (request, response) => {
  const partId = routeParam(request.params.partId);
  if (!partId) {
    response.status(400).json({ error: "케이스 식별자가 필요합니다." });
    return;
  }
  const deleted = await deleteCaseRgbLoadOverride(partId);
  if (!deleted) {
    response.status(404).json({ error: "삭제할 케이스 RGB 부하 보강을 찾을 수 없습니다." });
    return;
  }
  invalidateCatalogCache();
  response.json({ deleted: true, partId });
});

function coolingFanLoadValidationCounts(validation: CoolingFanLoadOverrideBatchValidation) {
  return {
    validCount: validation.items.filter((item) => item.valid).length,
    invalidCount: validation.items.filter((item) => !item.valid).length,
    createCount: validation.items.filter((item) => item.operation === "create").length,
    updateCount: validation.items.filter((item) => item.operation === "update").length,
    unchangedCount: validation.items.filter((item) => item.operation === "unchanged").length
  };
}

app.get("/api/admin/cooling-fan-load-overrides", requireAdmin, async (_request, response) => {
  const accessories = await loadAccessories();
  response.json({ items: coolingFanLoadOverrideListItems(accessories, await readCoolingFanLoadOverrides()) });
});

app.get("/api/admin/cooling-fan-load-overrides/export", requireAdmin, async (_request, response) => {
  const accessories = await loadAccessories();
  response.json({ exportedAt: new Date().toISOString(), items: coolingFanLoadOverrideListItems(accessories, await readCoolingFanLoadOverrides()) });
});

app.get("/api/admin/cooling-fan-load-overrides/coverage", requireAdmin, async (_request, response) => {
  const accessories = await loadAccessories();
  response.json(coolingFanLoadCoverageFor(accessories, await readCoolingFanLoadOverrides()));
});

app.post("/api/admin/cooling-fan-load-overrides/batch/validate", requireAdmin, async (request, response) => {
  const accessories = await loadAccessories();
  const validation = validateCoolingFanLoadOverrideBatch(request.body, accessories, await readCoolingFanLoadOverrides());
  const counts = coolingFanLoadValidationCounts(validation);
  if (validation.errors.length > 0 && validation.items.length === 0) {
    response.status(400).json({ error: "쿨링팬 소비전류 보강 입력 형식이 올바르지 않습니다.", details: validation.errors, ...counts, items: validation.items });
    return;
  }
  response.json({ ...counts, items: validation.items });
});

app.put("/api/admin/cooling-fan-load-overrides/batch", requireAdmin, async (request, response) => {
  const accessories = await loadAccessories();
  const validation = validateCoolingFanLoadOverrideBatch(request.body, accessories, await readCoolingFanLoadOverrides());
  const counts = coolingFanLoadValidationCounts(validation);
  if (validation.errors.length > 0) {
    response.status(400).json({ saved: false, error: "쿨링팬 소비전류 보강 저장을 중단했습니다. 오류가 있는 항목은 하나라도 저장하지 않습니다.", details: validation.errors, ...counts, items: validation.items });
    return;
  }
  await saveCoolingFanLoadOverrides(validation.validOverrides);
  compatibilityResultCache.clear();
  savedBuildCheckPreviewCache.clear();
  const refreshedAccessories = await loadAccessories();
  response.json({ saved: true, count: validation.validOverrides.length, items: coolingFanLoadOverrideListItems(refreshedAccessories, await readCoolingFanLoadOverrides()) });
});

app.put("/api/admin/cooling-fan-load-overrides/:accessoryId", requireAdmin, async (request, response) => {
  const accessoryId = routeParam(request.params.accessoryId);
  if (!accessoryId) {
    response.status(400).json({ error: "쿨링팬 식별자가 필요합니다." });
    return;
  }
  const accessories = await loadAccessories();
  const accessory = findAccessory(accessories, accessoryId);
  if (!accessory || accessory.category !== "cooling_fan") {
    response.status(404).json({ error: "소비전류를 등록할 쿨링팬을 찾을 수 없습니다." });
    return;
  }
  const validation = validateCoolingFanLoadOverride(accessory, request.body);
  if (validation.errors.length > 0 || !validation.value) {
    response.status(400).json({ error: "쿨링팬 소비전류 보강 형식이 올바르지 않습니다.", details: validation.errors });
    return;
  }
  await saveCoolingFanLoadOverrides([validation.value]);
  compatibilityResultCache.clear();
  savedBuildCheckPreviewCache.clear();
  const refreshedAccessories = await loadAccessories();
  response.json({ override: validation.value, accessory: refreshedAccessories.find((candidate) => candidate.id === accessoryId) });
});

app.delete("/api/admin/cooling-fan-load-overrides/:accessoryId", requireAdmin, async (request, response) => {
  const accessoryId = routeParam(request.params.accessoryId);
  if (!accessoryId) {
    response.status(400).json({ error: "쿨링팬 식별자가 필요합니다." });
    return;
  }
  const deleted = await deleteCoolingFanLoadOverride(accessoryId);
  if (!deleted) {
    response.status(404).json({ error: "삭제할 쿨링팬 소비전류 보강을 찾을 수 없습니다." });
    return;
  }
  compatibilityResultCache.clear();
  savedBuildCheckPreviewCache.clear();
  response.json({ deleted: true, accessoryId });
});

function gpuPhysicalOverrideListItems(catalog: Part[], overrides: Record<string, GpuPhysicalOverride>) {
  return Object.values(overrides)
    .map((override) => {
      const part = findPart(catalog, override.partId);
      if (!part || (part.category !== "gpu" && part.category !== "case" && part.category !== "psu")) return undefined;
      return { ...override, partName: part.name, category: part.category };
    })
    .filter((item): item is GpuPhysicalOverride & { partName: string; category: "gpu" | "case" | "psu" } => Boolean(item))
    .sort((left, right) => left.partName.localeCompare(right.partName, "ko-KR"));
}

app.get("/api/admin/gpu-physical-overrides", requireAdmin, async (_request, response) => {
  const catalog = await loadCatalog();
  response.json({ items: gpuPhysicalOverrideListItems(catalog, await readGpuPhysicalOverrides()) });
});

app.get("/api/admin/gpu-physical-overrides/export", requireAdmin, async (_request, response) => {
  const catalog = await loadCatalog();
  response.json({ exportedAt: new Date().toISOString(), items: gpuPhysicalOverrideListItems(catalog, await readGpuPhysicalOverrides()) });
});

app.get("/api/admin/gpu-physical-overrides/review-template", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const rawCategory = typeof request.query.category === "string" ? request.query.category : undefined;
  const category = rawCategory === "gpu" || rawCategory === "case" || rawCategory === "psu" ? rawCategory : undefined;
  const query = typeof request.query.q === "string" ? request.query.q.trim().toLocaleLowerCase("ko-KR") : "";
  const requestedLimit = Number(request.query.limit ?? 100);
  const requestedOffset = Number(request.query.offset ?? 0);
  const limit = Number.isFinite(requestedLimit) ? Math.min(500, Math.max(1, Math.floor(requestedLimit))) : 100;
  const offset = Number.isFinite(requestedOffset) ? Math.min(100_000, Math.max(0, Math.floor(requestedOffset))) : 0;
  const overrides = await readGpuPhysicalOverrides();
  const candidates = catalog
    .filter((part): part is Part & { category: "gpu" | "case" | "psu" } => part.category === "gpu" || part.category === "case" || part.category === "psu")
    .filter((part) => !category || part.category === category)
    .filter((part) => !query || [part.id, part.name, part.brand, part.model].filter((value): value is string => Boolean(value)).some((value) => value.toLocaleLowerCase("ko-KR").includes(query)))
    .sort((left, right) => left.name.localeCompare(right.name, "ko-KR"));
  const items = candidates.slice(offset, offset + limit).map((part) => {
    const override = overrides[part.id];
    return {
      partId: part.id,
      partName: part.name,
      category: part.category,
      manufacturerModel: override?.manufacturerModel ?? "",
      ...(override?.manufacturerRevision ? { manufacturerRevision: override.manufacturerRevision } : {}),
      ...(override?.gpuSlotOccupancy !== undefined ? { gpuSlotOccupancy: override.gpuSlotOccupancy } : {}),
      ...(override?.gpuCableBendClearanceMm !== undefined ? { gpuCableBendClearanceMm: override.gpuCableBendClearanceMm } : {}),
      ...(override?.caseSidePanelClearanceMm !== undefined ? { caseSidePanelClearanceMm: override.caseSidePanelClearanceMm } : {}),
      ...(override?.psuIndependentPcieCableRuns !== undefined ? { psuIndependentPcieCableRuns: override.psuIndependentPcieCableRuns } : {}),
      ...(override?.psuPcieCableTopology !== undefined ? { psuPcieCableTopology: override.psuPcieCableTopology } : {}),
      sourceNote: override?.sourceNote ?? "",
      ...(override?.sourceUrl ? { sourceUrl: override.sourceUrl } : {}),
      updatedAt: override?.updatedAt ?? ""
    };
  });
  response.json({ generatedAt: new Date().toISOString(), ...(category ? { category } : {}), ...(query ? { query } : {}), offset, limit, total: candidates.length, items });
});

app.get("/api/admin/gpu-physical-overrides/review-queue", requireAdmin, async (request, response) => {
  const rawCategory = typeof request.query.category === "string" ? request.query.category : undefined;
  const category = rawCategory === "gpu" || rawCategory === "case" || rawCategory === "psu" ? rawCategory : undefined;
  const query = typeof request.query.q === "string" ? request.query.q : undefined;
  const rawPriority = typeof request.query.priority === "string" ? request.query.priority : undefined;
  const priority = rawPriority === "high" || rawPriority === "medium" || rawPriority === "low" ? rawPriority : undefined;
  const requestedLimit = Number(request.query.limit ?? 12);
  const requestedOffset = Number(request.query.offset ?? 0);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 12;
  const offset = Number.isFinite(requestedOffset) ? Math.min(100_000, Math.max(0, Math.floor(requestedOffset))) : 0;
  response.json(physicalReviewQueueFor(await loadCatalog(), await readGpuPhysicalOverrides(), { category, query, priority, offset, limit }));
});

app.get("/api/admin/gpu-physical-overrides/coverage", requireAdmin, async (_request, response) => {
  response.json(physicalReviewCoverageFor(await loadCatalog(), await readGpuPhysicalOverrides()));
});

app.get("/api/admin/gpu-physical-overrides/review-package", requireAdmin, async (request, response) => {
  const rawCategory = typeof request.query.category === "string" ? request.query.category : undefined;
  const category = rawCategory === "gpu" || rawCategory === "case" || rawCategory === "psu" ? rawCategory : undefined;
  const query = typeof request.query.q === "string" ? request.query.q : undefined;
  const rawPriority = typeof request.query.priority === "string" ? request.query.priority : undefined;
  const priority = rawPriority === "high" || rawPriority === "medium" || rawPriority === "low" ? rawPriority : undefined;
  const requestedLimit = Number(request.query.limit ?? 100);
  const requestedOffset = Number(request.query.offset ?? 0);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 100;
  const offset = Number.isFinite(requestedOffset) ? Math.min(100_000, Math.max(0, Math.floor(requestedOffset))) : 0;
  response.json(physicalReviewWorkPackageFor(await loadCatalog(), await readGpuPhysicalOverrides(), { category, query, priority, offset, limit }));
});

app.post("/api/admin/gpu-physical-overrides/source-check/batch", gpuPhysicalSourceCheckBatchRateLimit, requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  const rawCategory = typeof body.category === "string" ? body.category : undefined;
  const category = rawCategory === "gpu" || rawCategory === "case" || rawCategory === "psu" ? rawCategory : undefined;
  const requestedPartIds = Array.isArray(body.partIds) ? body.partIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()).slice(0, 50) : undefined;
  const requestedLimit = Number(body.limit ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, Math.floor(requestedLimit))) : 20;
  const persist = body.persist !== false;
  const overrides = await readGpuPhysicalOverrides();
  const candidates = Object.values(overrides)
    .filter((override) => Boolean(override.sourceUrl))
    .map((override) => {
      const part = findPart(catalog, override.partId);
      return part && (part.category === "gpu" || part.category === "case" || part.category === "psu") ? { part, override } : undefined;
    })
    .filter((item): item is { part: Part & { category: "gpu" | "case" | "psu" }; override: GpuPhysicalOverride & { sourceUrl: string } } => Boolean(item))
    .filter(({ part }) => !category || part.category === category)
    .filter(({ part }) => !requestedPartIds || requestedPartIds.includes(part.id))
    .sort((left, right) => left.part.name.localeCompare(right.part.name, "ko-KR"));
  const candidateIds = new Set(candidates.map(({ part }) => part.id));
  const skipped = (requestedPartIds ?? [])
    .filter((partId) => !candidateIds.has(partId))
    .map((partId) => ({ partId, reason: "저장된 HTTPS 정보 URL이 없거나 현재 카탈로그 범주와 일치하지 않습니다." }));
  response.json(await physicalSourceCheckBatchFor(candidates.map(({ part, override }) => ({ partId: part.id, partName: part.name, category: part.category, sourceUrl: override.sourceUrl, manufacturerModel: override.manufacturerModel })), {
    limit,
    concurrency: 2,
    persist,
    persistCheck: async (partId, sourceCheck) => {
      const stored = await saveGpuPhysicalSourceCheck(partId, sourceCheck);
      if (stored) await appendPhysicalSourceCheckHistory(partId, sourceCheck).catch(() => undefined);
      return stored;
    },
    skipped
  }));
});

function gpuPhysicalBatchValidationCounts(validation: ReturnType<typeof validateGpuPhysicalOverrideBatch>) {
  return {
    validCount: validation.items.filter((item) => item.valid).length,
    invalidCount: validation.items.filter((item) => !item.valid).length
  };
}

app.post("/api/admin/gpu-physical-overrides/batch/validate", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const validation = validateGpuPhysicalOverrideBatch(request.body, catalog, await readGpuPhysicalOverrides());
  const counts = gpuPhysicalBatchValidationCounts(validation);
  if (validation.errors.length > 0 && validation.items.length === 0) {
    response.status(400).json({ error: "GPU·케이스·PSU 물리 호환 override 일괄 입력 형식이 올바르지 않습니다.", details: validation.errors, ...counts, items: validation.items });
    return;
  }
  response.json({ ...counts, items: validation.items });
});

app.put("/api/admin/gpu-physical-overrides/batch", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const validation = validateGpuPhysicalOverrideBatch(request.body, catalog, await readGpuPhysicalOverrides());
  const counts = gpuPhysicalBatchValidationCounts(validation);
  if (validation.errors.length > 0) {
    response.status(400).json({ saved: false, error: "GPU·케이스·PSU 물리 호환 override 일괄 저장을 중단했습니다. 오류가 있는 항목은 하나라도 저장하지 않습니다.", details: validation.errors, ...counts, items: validation.items });
    return;
  }
  await saveGpuPhysicalOverrides(validation.validOverrides);
  invalidateCatalogCache();
  const refreshedCatalog = await loadCatalog();
  response.json({ saved: true, count: validation.validOverrides.length, items: gpuPhysicalOverrideListItems(refreshedCatalog, await readGpuPhysicalOverrides()) });
});

app.put("/api/admin/gpu-physical-overrides/:partId", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const partId = routeParam(request.params.partId);
  if (!partId) {
    response.status(400).json({ error: "GPU·케이스·PSU 식별자가 필요합니다." });
    return;
  }
  const part = findPart(catalog, partId);
  if (!part || (part.category !== "gpu" && part.category !== "case" && part.category !== "psu")) {
    response.status(404).json({ error: "물리 호환 override를 등록할 GPU·케이스·PSU를 찾을 수 없습니다." });
    return;
  }
  const validation = validateGpuPhysicalOverride(part, request.body);
  if (validation.errors.length > 0 || !validation.value) {
    response.status(400).json({ error: "GPU·케이스·PSU 물리 호환 override 형식이 올바르지 않습니다.", details: validation.errors });
    return;
  }
  const override = await saveGpuPhysicalOverride(validation.value);
  invalidateCatalogCache();
  const refreshedCatalog = await loadCatalog();
  response.json({ override, part: refreshedCatalog.find((candidate) => candidate.id === partId) });
});

app.post("/api/admin/gpu-physical-overrides/:partId/source-check", gpuPhysicalSourceCheckRateLimit, requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const partId = routeParam(request.params.partId);
  if (!partId) {
    response.status(400).json({ error: "장착 정보 점검 대상 식별자가 필요합니다." });
    return;
  }
  const part = findPart(catalog, partId);
  if (!part || (part.category !== "gpu" && part.category !== "case" && part.category !== "psu")) {
    response.status(404).json({ error: "장착 정보를 점검할 GPU·케이스·PSU를 찾을 수 없습니다." });
    return;
  }
  const overrides = await readGpuPhysicalOverrides();
  const override = overrides[partId];
  if (!override) {
    response.status(404).json({ error: "먼저 물리 확인값을 저장해야 정보 URL을 점검할 수 있습니다." });
    return;
  }
  if (!override.sourceUrl) {
    response.status(400).json({ error: "저장된 정보 URL이 없어 점검할 수 없습니다." });
    return;
  }
  const persist = request.query.persist !== "false";
  if (gpuPhysicalSourceCheckJobs.has(partId)) {
    response.status(409).json({ error: "이 장착 정보의 페이지 확인이 이미 실행 중입니다.", code: "GPU_PHYSICAL_SOURCE_CHECK_RUNNING" });
    return;
  }
  const lastRunAt = gpuPhysicalSourceCheckLastRunAt.get(partId);
  if (lastRunAt !== undefined) {
    const remainingMs = PART_REFRESH_COOLDOWN_MS - (Date.now() - lastRunAt);
    if (remainingMs > 0) {
      const retryAfterSeconds = Math.ceil(remainingMs / 1000);
      response.setHeader("Retry-After", String(retryAfterSeconds));
      response.status(429).json({ error: `같은 장착 정보는 ${retryAfterSeconds}초 후 다시 점검할 수 있습니다.`, code: "GPU_PHYSICAL_SOURCE_CHECK_COOLDOWN", retryAfterSeconds });
      return;
    }
    gpuPhysicalSourceCheckLastRunAt.delete(partId);
  }
  const sourceCheckJob = checkPhysicalSourceUrl(override.sourceUrl, override.manufacturerModel);
  gpuPhysicalSourceCheckJobs.set(partId, sourceCheckJob);
  try {
    const sourceCheck = await sourceCheckJob;
    gpuPhysicalSourceCheckLastRunAt.set(partId, Date.now());
    const checkedOverride = persist ? await saveGpuPhysicalSourceCheck(partId, sourceCheck) : override;
    if (!checkedOverride) {
      response.status(404).json({ error: "물리 확인값이 점검 중 사라졌습니다." });
      return;
    }
    const historyEntry = persist && checkedOverride ? await appendPhysicalSourceCheckHistory(partId, sourceCheck).catch(() => undefined) : undefined;
    if (persist) invalidateCatalogCache();
    const refreshedCatalog = persist ? await loadCatalog() : catalog;
    response.json({ persisted: persist, historyRecorded: Boolean(historyEntry), sourceCheck, override: checkedOverride, part: refreshedCatalog.find((candidate) => candidate.id === partId) });
  } finally {
    if (gpuPhysicalSourceCheckJobs.get(partId) === sourceCheckJob) gpuPhysicalSourceCheckJobs.delete(partId);
  }
});

app.get("/api/admin/gpu-physical-overrides/:partId/source-check/history", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const partId = routeParam(request.params.partId);
  const part = partId ? findPart(catalog, partId) : undefined;
  if (!part || (part.category !== "gpu" && part.category !== "case" && part.category !== "psu")) {
    response.status(404).json({ error: "정보 점검 이력을 조회할 GPU·케이스·PSU를 찾을 수 없습니다." });
    return;
  }
  const requestedLimit = Number(request.query.limit ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.min(20, Math.max(1, Math.floor(requestedLimit))) : 20;
  response.json({ partId, entries: await readPhysicalSourceCheckHistory(partId, limit) });
});

app.delete("/api/admin/gpu-physical-overrides/:partId", requireAdmin, async (request, response) => {
  const partId = routeParam(request.params.partId);
  if (!partId) {
    response.status(400).json({ error: "GPU·케이스·PSU 식별자가 필요합니다." });
    return;
  }
  const deleted = await deleteGpuPhysicalOverride(partId);
  if (!deleted) {
    response.status(404).json({ error: "삭제할 물리 호환 override를 찾을 수 없습니다." });
    return;
  }
  invalidateCatalogCache();
  response.json({ deleted: true, partId });
});

app.get("/api/admin/benchmark-overrides", requireAdmin, async (_request, response) => {
  const catalog = await loadCatalog();
  response.json({ items: benchmarkOverrideListItems(catalog, sortedBenchmarkOverrides(await readBenchmarkOverrides())) });
});

app.get("/api/admin/benchmark-overrides/export", requireAdmin, async (_request, response) => {
  const catalog = await loadCatalog();
  response.json({ exportedAt: new Date().toISOString(), items: benchmarkOverrideListItems(catalog, sortedBenchmarkOverrides(await readBenchmarkOverrides())) });
});

app.get("/api/admin/benchmark-review", requireAdmin, async (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.min(500, Math.max(1, Math.floor(requestedLimit))) : 100;
  response.json(benchmarkReviewQueueFor(await loadCatalog(), limit));
});

app.get("/api/admin/benchmark-review/work-package", requireAdmin, async (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 24);
  const requestedOffset = Number(request.query.offset ?? 0);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 24;
  const offset = Number.isFinite(requestedOffset) ? Math.min(100_000, Math.max(0, Math.floor(requestedOffset))) : 0;
  const expectedQueueFingerprint = typeof request.query.queueFingerprint === "string" && request.query.queueFingerprint.trim().length > 0
    ? request.query.queueFingerprint.trim().slice(0, 120)
    : undefined;
  const workPackage = benchmark3DMarkReviewWorkPackageFor(await loadCatalog(), { offset, limit });
  response.json({
    ...workPackage,
    ...(expectedQueueFingerprint && offset > 0 && expectedQueueFingerprint !== workPackage.queueFingerprint ? { queueChanged: true } : {})
  });
});

app.post("/api/admin/benchmark-import/3dmark/batch", benchmark3DMarkBatchImportRateLimit, requireAdmin, async (request, response) => {
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  const items = Array.isArray(body.items) ? body.items : undefined;
  if (!items) {
    response.status(400).json({ error: "items 배열이 필요합니다.", code: "BENCHMARK_3DMARK_BATCH_INPUT_INVALID" });
    return;
  }
  if (items.length < 1) {
    response.status(400).json({ error: "최소 1개의 GPU 결과 URL이 필요합니다.", code: "BENCHMARK_3DMARK_BATCH_INPUT_EMPTY" });
    return;
  }
  if (items.length > BENCHMARK_3DMARK_BATCH_MAX_ITEMS) {
    response.status(400).json({ error: `한 번에 최대 ${BENCHMARK_3DMARK_BATCH_MAX_ITEMS}개 GPU 결과까지 미리 볼 수 있습니다.`, code: "BENCHMARK_3DMARK_BATCH_LIMIT_EXCEEDED", maxItems: BENCHMARK_3DMARK_BATCH_MAX_ITEMS });
    return;
  }
  const result = await benchmark3DMarkBatchPreviewFor(items, await loadCatalog());
  response.json(result);
});

app.post("/api/admin/benchmark-import/3dmark", benchmark3DMarkImportRateLimit, requireAdmin, async (request, response) => {
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  const partId = typeof body.partId === "string" ? body.partId.trim() : "";
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  if (!partId || !sourceUrl) {
    response.status(400).json({ error: "GPU 식별자와 3DMark 결과 URL이 필요합니다.", code: "BENCHMARK_3DMARK_INPUT_INVALID" });
    return;
  }
  const catalog = await loadCatalog();
  const part = findPart(catalog, partId);
  if (!part || part.category !== "gpu") {
    response.status(404).json({ error: "3DMark 결과를 연결할 GPU를 찾을 수 없습니다.", code: "BENCHMARK_3DMARK_GPU_NOT_FOUND" });
    return;
  }
  try {
    const preview = await import3DMarkResult(sourceUrl, part.name, part.model, {});
    response.json({ partId: part.id, partName: part.name, ...preview });
  } catch (error: unknown) {
    const message = error instanceof Benchmark3DMarkImportError ? error.message : "3DMark 결과를 미리 읽지 못했습니다.";
    response.status(422).json({ error: message, code: "BENCHMARK_3DMARK_PREVIEW_FAILED" });
  }
});

function benchmarkOverrideChangeRecords(beforeCatalog: Awaited<ReturnType<typeof loadCatalog>>, afterCatalog: Awaited<ReturnType<typeof loadCatalog>>, overrides: Array<{ partId: string; updatedAt?: string; changedFields?: string[] }>) {
  return overrides.flatMap((override) => {
    const before = findPart(beforeCatalog, override.partId);
    const after = findPart(afterCatalog, override.partId);
    if (!before || !after) return [];
    const changedFields = [...new Set([...meaningfulCatalogChangeFields(before, after), ...(override.changedFields ?? []).filter((field) => field === "sourceNote" || field === "sourceUrl")])];
    if (changedFields.length === 0) return [];
    return [catalogChangeRecord("part", before, after, ["벤치마크 보강", ...changedFields], override.updatedAt ? { changedAt: override.updatedAt } : {})];
  });
}

function benchmarkOverrideListItems(catalog: Awaited<ReturnType<typeof loadCatalog>>, overrides: Awaited<ReturnType<typeof sortedBenchmarkOverrides>>) {
  return overrides.map((override) => {
    const part = findPart(catalog, override.partId);
    return {
      ...override,
      ...(part ? { partName: part.name, category: part.category } : {})
    };
  });
}

app.post("/api/admin/benchmark-overrides/validate", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const validation = validateBenchmarkOverrideBatch(request.body, catalog, await readBenchmarkOverrides());
  if (validation.errors.length > 0 && validation.items.length === 0) {
    response.status(400).json({ error: "벤치마크 보강 입력 형식이 올바르지 않습니다.", details: validation.errors });
    return;
  }
  response.json({ ...benchmarkOverrideValidationCounts(validation), items: validation.items });
});

app.put("/api/admin/benchmark-overrides", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const validation = validateBenchmarkOverrideBatch(request.body, catalog, await readBenchmarkOverrides());
  if (validation.errors.length > 0) {
    response.status(400).json({
      saved: false,
      error: "벤치마크 보강 저장을 중단했습니다. 오류가 있는 항목은 하나라도 저장하지 않습니다.",
      details: validation.errors,
      ...benchmarkOverrideValidationCounts(validation),
      items: validation.items
    });
    return;
  }
  await saveBenchmarkOverrides(validation.validOverrides);
  invalidateCatalogCache();
  const updatedCatalog = await loadCatalog();
  const changeRecords = benchmarkOverrideChangeRecords(catalog, updatedCatalog, validation.items
    .filter((item) => item.valid && item.override)
    .map((item) => ({ partId: item.partId, updatedAt: item.override?.updatedAt, changedFields: item.changedFields })));
  await appendCatalogChangeRecords(changeRecords).catch((error: unknown) => {
    console.warn(`벤치마크 보강 변경 이력을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  });
  response.json({ saved: true, count: validation.validOverrides.length, items: benchmarkOverrideListItems(updatedCatalog, sortedBenchmarkOverrides(await readBenchmarkOverrides())) });
});

app.post("/api/admin/benchmark-overrides/source-check/batch", benchmarkSourceCheckBatchRateLimit, requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  const rawCategory = typeof body.category === "string" ? body.category : undefined;
  const category = rawCategory === "cpu" || rawCategory === "gpu" ? rawCategory : undefined;
  const requestedPartIds = Array.isArray(body.partIds) ? [...new Set(body.partIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))].slice(0, 50) : undefined;
  const requestedLimit = Number(body.limit ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, Math.floor(requestedLimit))) : 20;
  const persist = body.persist !== false;
  const overrides = await readBenchmarkOverrides();
  const candidates = Object.values(overrides)
    .filter((override) => Boolean(override.sourceUrl))
    .map((override) => {
      const part = findPart(catalog, override.partId);
      return part && (part.category === "cpu" || part.category === "gpu") ? { part, override } : undefined;
    })
    .filter((item): item is { part: Part & { category: "cpu" | "gpu" }; override: Awaited<ReturnType<typeof readBenchmarkOverrides>>[string] & { sourceUrl: string } } => Boolean(item))
    .filter(({ part }) => !category || part.category === category)
    .filter(({ part }) => !requestedPartIds || requestedPartIds.includes(part.id))
    .sort((left, right) => left.part.name.localeCompare(right.part.name, "ko-KR"));
  const candidateIds = new Set(candidates.map(({ part }) => part.id));
  const skipped = (requestedPartIds ?? [])
    .filter((partId) => !candidateIds.has(partId))
    .map((partId) => ({ partId, reason: "저장된 HTTPS 벤치마크 정보 URL이 없거나 현재 CPU·GPU 카탈로그와 일치하지 않습니다." }));
  response.json(await benchmarkSourceCheckBatchFor(candidates.map(({ part, override }) => ({ partId: part.id, partName: part.name, category: part.category, sourceUrl: override.sourceUrl, manufacturerModel: part.model?.trim() || part.name })), {
    limit,
    concurrency: 2,
    persist,
    persistCheck: async (partId, sourceCheck) => {
      const stored = await saveBenchmarkSourceCheck(partId, sourceCheck);
      if (stored) await appendBenchmarkSourceCheckHistory(partId, sourceCheck).catch(() => undefined);
      return stored;
    },
    skipped
  }));
});

app.post("/api/admin/benchmark-overrides/:partId/source-check", benchmarkSourceCheckRateLimit, requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const partId = routeParam(request.params.partId);
  if (!partId) {
    response.status(400).json({ error: "벤치마크 출처 확인 대상 식별자가 필요합니다." });
    return;
  }
  const part = findPart(catalog, partId);
  if (!part || (part.category !== "cpu" && part.category !== "gpu")) {
    response.status(404).json({ error: "벤치마크 출처를 확인할 CPU·GPU를 찾을 수 없습니다." });
    return;
  }
  const override = (await readBenchmarkOverrides())[partId];
  if (!override) {
    response.status(404).json({ error: "먼저 벤치마크 보강 데이터를 저장해야 출처를 확인할 수 있습니다." });
    return;
  }
  if (!override.sourceUrl) {
    response.status(400).json({ error: "저장된 벤치마크 정보 URL이 없어 점검할 수 없습니다." });
    return;
  }
  const persist = request.query.persist !== "false";
  if (benchmarkSourceCheckJobs.has(partId)) {
    response.status(409).json({ error: "이 벤치마크 정보의 출처 확인이 이미 실행 중입니다.", code: "BENCHMARK_SOURCE_CHECK_RUNNING" });
    return;
  }
  const lastRunAt = benchmarkSourceCheckLastRunAt.get(partId);
  if (lastRunAt !== undefined) {
    const remainingMs = PART_REFRESH_COOLDOWN_MS - (Date.now() - lastRunAt);
    if (remainingMs > 0) {
      const retryAfterSeconds = Math.ceil(remainingMs / 1000);
      response.setHeader("Retry-After", String(retryAfterSeconds));
      response.status(429).json({ error: `같은 벤치마크 정보는 ${retryAfterSeconds}초 후 다시 점검할 수 있습니다.`, code: "BENCHMARK_SOURCE_CHECK_COOLDOWN", retryAfterSeconds });
      return;
    }
    benchmarkSourceCheckLastRunAt.delete(partId);
  }
  const sourceCheckJob = checkPhysicalSourceUrl(override.sourceUrl, part.model?.trim() || part.name);
  benchmarkSourceCheckJobs.set(partId, sourceCheckJob);
  try {
    const sourceCheck = await sourceCheckJob;
    benchmarkSourceCheckLastRunAt.set(partId, Date.now());
    const checkedOverride = persist ? await saveBenchmarkSourceCheck(partId, sourceCheck) : override;
    if (!checkedOverride) {
      response.status(404).json({ error: "벤치마크 보강 데이터가 점검 중 사라졌습니다." });
      return;
    }
    const historyEntry = persist ? await appendBenchmarkSourceCheckHistory(partId, sourceCheck).catch(() => undefined) : undefined;
    if (persist) invalidateCatalogCache();
    const refreshedCatalog = persist ? await loadCatalog() : catalog;
    response.json({ persisted: persist, historyRecorded: Boolean(historyEntry), sourceCheck, override: checkedOverride, part: refreshedCatalog.find((candidate) => candidate.id === partId) });
  } finally {
    if (benchmarkSourceCheckJobs.get(partId) === sourceCheckJob) benchmarkSourceCheckJobs.delete(partId);
  }
});

app.get("/api/admin/benchmark-overrides/:partId/source-check/history", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const partId = routeParam(request.params.partId);
  const part = partId ? findPart(catalog, partId) : undefined;
  if (!part || (part.category !== "cpu" && part.category !== "gpu")) {
    response.status(404).json({ error: "벤치마크 출처 확인 이력을 조회할 CPU·GPU를 찾을 수 없습니다." });
    return;
  }
  const requestedLimit = Number(request.query.limit ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.min(20, Math.max(1, Math.floor(requestedLimit))) : 20;
  response.json({ partId, entries: await readBenchmarkSourceCheckHistory(partId, limit) });
});

app.delete("/api/admin/benchmark-overrides/:partId", requireAdmin, async (request, response) => {
  const partId = routeParam(request.params.partId);
  if (!partId) {
    response.status(400).json({ error: "벤치마크 보강 부품 식별자가 필요합니다." });
    return;
  }
  const beforeCatalog = await loadCatalog();
  const deleted = await deleteBenchmarkOverride(partId);
  if (!deleted) {
    response.status(404).json({ error: "삭제할 벤치마크 보강 데이터를 찾을 수 없습니다." });
    return;
  }
  invalidateCatalogCache();
  const afterCatalog = await loadCatalog();
  const changeRecords = benchmarkOverrideChangeRecords(beforeCatalog, afterCatalog, [{ partId }]);
  await appendCatalogChangeRecords(changeRecords).catch((error: unknown) => {
    console.warn(`벤치마크 보강 삭제 이력을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
  });
  response.json({ deleted: true, partId });
});

app.get("/api/admin/session", (request, response) => {
  response.json(adminSession(request));
});

app.post("/api/admin/login", adminLoginRateLimit, (request, response) => {
  loginAdmin(request, response);
});

app.post("/api/admin/logout", (request, response) => {
  logoutAdmin(request, response);
});

app.get("/api/admin/catalog/seed-preview", requireAdmin, async (_request, response) => {
  const catalog = await loadCatalog();
  const eligibility = catalogEligibilitySummaryFor(catalog);
  response.json(catalogSeedPreviewFor(starterCatalog, catalog, {
    generatedAt: new Date().toISOString(),
    coreEligibleCount: eligibility.eligibleCount,
    excludedNonCoreCount: eligibility.excludedNonCoreCount
  }));
});

async function cachedCatalogSeedMappingPreview(catalog: Part[]) {
  const reviews = await readCatalogSeedMappingReviews();
  const catalogSourceMtime = await fileUpdatedAt(CATALOG_PATH, "");
  const key = JSON.stringify([currentCatalogRuntimeRevision(), catalogSourceMtime, reviews]);
  if (catalogSeedMappingPreviewCache?.key === key) return catalogSeedMappingPreviewCache.value;
  const epoch = catalogSeedMappingPreviewCacheEpoch;
  if (catalogSeedMappingPreviewInFlight?.key === key && catalogSeedMappingPreviewInFlight.epoch === epoch) return catalogSeedMappingPreviewInFlight.promise;
  const promise = (async () => {
    const value = catalogSeedMappingPreviewFor(starterCatalog, catalog, {
      generatedAt: new Date().toISOString(),
      reviews
    });
    if (catalogSeedMappingPreviewCacheEpoch === epoch) catalogSeedMappingPreviewCache = { key, value };
    return value;
  })();
  catalogSeedMappingPreviewInFlight = { key, epoch, promise };
  try {
    return await promise;
  } finally {
    if (catalogSeedMappingPreviewInFlight?.promise === promise) catalogSeedMappingPreviewInFlight = undefined;
  }
}

app.get("/api/admin/catalog/seed-mapping-preview", requireAdmin, async (_request, response) => {
  const catalog = await loadCatalog();
  response.json(await cachedCatalogSeedMappingPreview(catalog));
});

app.get("/api/admin/catalog/seed-collection-queue", requireAdmin, async (_request, response) => {
  const catalog = await loadCatalog();
  const mappingPreview = await cachedCatalogSeedMappingPreview(catalog);
  response.json(catalogSeedCollectionQueueFor(starterCatalog, catalog, { generatedAt: mappingPreview.generatedAt, mappingPreview }));
});

app.put("/api/admin/catalog/seed-mapping-reviews/:starterPartId", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const starterPartId = routeParam(request.params.starterPartId) ?? "";
  const validation = validateCatalogSeedMappingReview(starterPartId, request.body, starterCatalog, catalog);
  if (!validation.valid || !validation.review) {
    response.status(400).json({ error: "starter 상품 코드 매핑을 저장할 수 없습니다.", details: validation.errors, code: "CATALOG_SEED_MAPPING_INVALID" });
    return;
  }
  const existingReviews = await readCatalogSeedMappingReviews();
  const conflict = catalogSeedMappingReviewConflictFor(existingReviews, validation.review.starterPartId, validation.review.activePartId);
  if (conflict) {
    response.status(409).json({ error: `이 다나와 상품은 이미 ${conflict.starterPartId} starter에 매핑되어 있습니다.`, code: "CATALOG_SEED_MAPPING_TARGET_ALREADY_MAPPED", conflict });
    return;
  }
  const review = await saveCatalogSeedMappingReview(validation.review);
  catalogSeedMappingPreviewCache = undefined;
  catalogSeedMappingPreviewCacheEpoch += 1;
  catalogSeedMappingPreviewInFlight = undefined;
  response.json({ saved: true, review });
});

app.post("/api/admin/catalog/seed-mapping-reviews/:starterPartId/manual-verify", catalogSeedMappingManualRateLimit, requireAdmin, async (request, response) => {
  const starterPartId = routeParam(request.params.starterPartId) ?? "";
  const starter = starterCatalog.find((part) => part.id === starterPartId);
  if (!starter) {
    response.status(404).json({ error: "기본 목록 부품을 찾을 수 없습니다.", code: "CATALOG_SEED_MAPPING_STARTER_NOT_FOUND" });
    return;
  }
  const inputValidation = validateCatalogSeedMappingManualInput(request.body, starter.category);
  if (!inputValidation.valid || !inputValidation.input) {
    response.status(400).json({ error: "수동 상품 코드 매핑 입력을 확인해 주세요.", details: inputValidation.errors, code: "CATALOG_SEED_MAPPING_MANUAL_INPUT_INVALID" });
    return;
  }
  const catalog = await loadCatalog();
  const codeMatches = catalog.filter((part) => part.source === "danawa" && part.sourceProductCode === inputValidation.input!.sourceProductCode);
  const active = codeMatches.find((part) => part.category === starter.category);
  if (!active) {
    if (codeMatches.length > 0) {
      response.status(422).json({ error: "입력한 상품 코드가 starter와 다른 다나와 범주에 있습니다.", code: "CATALOG_SEED_MAPPING_CATEGORY_MISMATCH", categories: codeMatches.map((part) => part.category) });
      return;
    }
    response.status(404).json({ error: "현재 catalog에서 해당 다나와 상품 코드를 찾지 못했습니다. 먼저 해당 상품의 목록·상세 수집을 실행해 주세요.", code: "CATALOG_SEED_MAPPING_SOURCE_NOT_COLLECTED" });
    return;
  }
  if (!catalogSeedMappingIdentityCompatibleFor(starter, active)) {
    response.status(422).json({ error: "starter와 입력한 상품의 제조사 계열 또는 핵심 규격이 충돌합니다. 다른 상품 코드를 확인해 주세요.", code: "CATALOG_SEED_MAPPING_IDENTITY_CONFLICT", activePartId: active.id });
    return;
  }

  let sourceCheck;
  try {
    sourceCheck = await checkPhysicalSourceUrl(inputValidation.input.sourceUrl, sourceIdentitiesFor(starter, active, inputValidation.input.sourceProductCode));
  } catch (error: unknown) {
    response.status(422).json({ error: error instanceof Error ? error.message : "다나와 페이지를 확인하지 못했습니다.", code: "CATALOG_SEED_MAPPING_SOURCE_CHECK_FAILED" });
    return;
  }
  if (sourceCheck.identityStatus !== "matched" || (sourceCheck.status !== "reachable" && sourceCheck.status !== "redirected")) {
    response.status(422).json({ error: "다나와 페이지 접근 또는 상품 식별이 확인되지 않아 매핑을 저장하지 않았습니다.", code: "CATALOG_SEED_MAPPING_SOURCE_CHECK_REVIEW", sourceCheck });
    return;
  }

  const existingReviews = await readCatalogSeedMappingReviews();
  const conflict = catalogSeedMappingReviewConflictFor(existingReviews, starter.id, active.id);
  if (conflict) {
    response.status(409).json({ error: `이 다나와 상품은 이미 ${conflict.starterPartId} starter에 매핑되어 있습니다.`, code: "CATALOG_SEED_MAPPING_TARGET_ALREADY_MAPPED", conflict });
    return;
  }
  const review = await saveCatalogSeedMappingReview({
    starterPartId: starter.id,
    category: starter.category,
    activePartId: active.id,
    activeSourceProductCode: active.sourceProductCode!,
    status: "approved",
    reviewedAt: sourceCheck.checkedAt,
    sourceUrl: inputValidation.input.sourceUrl,
    verification: {
      sourceCheck,
      identityStatus: sourceCheck.identityStatus,
      categoryMatched: true,
      coreSpecsMatched: true
    }
  });
  catalogSeedMappingPreviewCache = undefined;
  catalogSeedMappingPreviewCacheEpoch += 1;
  catalogSeedMappingPreviewInFlight = undefined;
  response.json({ saved: true, review, sourceCheck });
});

app.delete("/api/admin/catalog/seed-mapping-reviews/:starterPartId", requireAdmin, async (request, response) => {
  const starterPartId = routeParam(request.params.starterPartId) ?? "";
  const deleted = await deleteCatalogSeedMappingReview(starterPartId);
  catalogSeedMappingPreviewCache = undefined;
  catalogSeedMappingPreviewCacheEpoch += 1;
  catalogSeedMappingPreviewInFlight = undefined;
  response.json({ deleted, starterPartId });
});

app.post("/api/admin/crawl", adminCatalogCrawlRateLimit, requireAdmin, async (request, response) => {
  if (isCrawlRunning()) {
    response.status(409).json({ error: "이미 카탈로그 갱신 작업이 실행 중입니다." });
    return;
  }
  const rawCategory = request.body?.category;
  if (rawCategory !== undefined && rawCategory !== "all" && !PART_CATEGORIES.includes(rawCategory as PartCategory)) {
    response.status(400).json({ error: "유효하지 않은 핵심 부품 카테고리입니다." });
    return;
  }
  const category = rawCategory === undefined || rawCategory === "all" ? undefined : rawCategory as PartCategory;
  // `all:true` from the existing admin UI uses limitPerCategory=0 as an ignored sentinel.
  const all = request.body?.all === true || (!category && process.env.DANAWA_CRAWL_ALL === "true");
  const pages = Number(request.body?.pages ?? process.env.DANAWA_CRAWL_PAGES ?? 1);
  const limitPerCategory = Number(request.body?.limitPerCategory ?? process.env.DANAWA_CRAWL_LIMIT ?? 5);
  if (!boundedCrawlInteger(pages, 1, MAX_CRAWL_PAGES) || !boundedCrawlInteger(limitPerCategory, all ? 0 : 1, MAX_CRAWL_BATCH_SIZE)) {
    response.status(400).json({ error: `pages는 1-${MAX_CRAWL_PAGES}, limitPerCategory는 ${all ? 0 : 1}-${MAX_CRAWL_BATCH_SIZE} 범위의 정수여야 합니다.`, code: "CRAWL_INPUT_INVALID" });
    return;
  }
  const details = request.body?.details !== false && process.env.DANAWA_CRAWL_DETAILS !== "false";
  // `all:true` is also valid for a selected category. This lets operators
  // exhaustively repair one coverage gap without replacing every category.
  const resume = request.body?.resume === true;
  if (resume && !all) {
    response.status(400).json({ error: "재개는 전체 수집 모드에서만 사용할 수 있습니다." });
    return;
  }
  let resumeCategory = category;
  if (resume) {
    const previousManifest = await readJson<CrawlManifest | null>(CRAWL_MANIFEST_PATH, null);
    resumeCategory = category ?? previousManifest?.category;
    const plan = crawlResumePlanFor(previousManifest, resumeCategory);
    if (!plan.available) {
      response.status(409).json({ error: plan.reason ?? "재개할 미완료 범주가 없습니다.", code: "CRAWL_RESUME_UNAVAILABLE" });
      return;
    }
  }
  void runCrawlJob({ ...(resumeCategory ? { category: resumeCategory } : {}), pages, limitPerCategory, details, all, ...(resume ? { resume: true } : {}) });
  response.status(202).json({ message: resume ? "중단된 전체 카탈로그 수집을 미완료 범주부터 재개했습니다." : category ? `${category} 카테고리 ${all ? "전체" : "샘플"} 카탈로그 갱신을 시작했습니다.` : "카탈로그 갱신을 시작했습니다.", mode: all ? "all" : "sample", ...(resumeCategory ? { category: resumeCategory } : {}), ...(resume ? { resumed: true } : {}) });
});

app.post("/api/admin/accessories/crawl", adminAccessoryCrawlRateLimit, requireAdmin, async (request, response) => {
  if (isAccessoryCrawlRunning() || (await readAccessoryCrawlStatus()).status === "running") {
    response.status(409).json({ error: "이미 주변 부품 카탈로그 갱신 작업이 실행 중입니다." });
    return;
  }
  const rawCategory = request.body?.category;
  if (rawCategory !== undefined && rawCategory !== "all" && !ACCESSORY_CATEGORIES.includes(rawCategory as AccessoryCategory)) {
    response.status(400).json({ error: "유효하지 않은 주변 부품 카테고리입니다." });
    return;
  }
  const category = rawCategory === undefined || rawCategory === "all" ? undefined : rawCategory as AccessoryCategory;
  const rawPages = request.body?.pages ?? process.env.DANAWA_ACCESSORY_CRAWL_PAGES ?? process.env.DANAWA_CRAWL_PAGES;
  const pages = rawPages === undefined ? undefined : Number(rawPages);
  const limitPerCategory = Number(request.body?.limitPerCategory ?? process.env.DANAWA_ACCESSORY_CRAWL_LIMIT ?? 30);
  const details = request.body?.details !== false && process.env.DANAWA_CRAWL_DETAILS !== "false";
  const all = request.body?.all === true || process.env.DANAWA_ACCESSORY_CRAWL_ALL === "true";
  const delayMs = Number(request.body?.delayMs ?? process.env.DANAWA_CRAWL_DELAY_MS ?? 850);
  if (pages !== undefined && !boundedCrawlInteger(pages, 1, MAX_CRAWL_PAGES) || !boundedCrawlInteger(limitPerCategory, 1, MAX_CRAWL_BATCH_SIZE) || !boundedCrawlInteger(delayMs, 0, MAX_CRAWL_DELAY_MS)) {
    response.status(400).json({ error: `pages는 1-${MAX_CRAWL_PAGES}, limitPerCategory는 1-${MAX_CRAWL_BATCH_SIZE}, delayMs는 0-${MAX_CRAWL_DELAY_MS} 범위의 정수여야 합니다.`, code: "ACCESSORY_CRAWL_INPUT_INVALID" });
    return;
  }
  const offset = Number(request.body?.offset ?? 0);
  if (!Number.isFinite(offset) || !Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    response.status(400).json({ error: "offset은 0부터 100,000 사이의 정수여야 합니다." });
    return;
  }
  if (request.body?.onlyIncomplete !== undefined && typeof request.body.onlyIncomplete !== "boolean") {
    response.status(400).json({ error: "onlyIncomplete은 boolean이어야 합니다." });
    return;
  }
  const onlyIncomplete = request.body?.onlyIncomplete === true;
  const dryRun = request.body?.dryRun === true;
  void runAccessoryCrawlJob({ category, pages, limitPerCategory, offset, onlyIncomplete, details, all, delayMs, dryRun });
  response.status(202).json({ message: "주변 부품 카탈로그 갱신을 시작했습니다." });
});

const distPath = resolve(process.cwd(), "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((request, response, next) => {
    if (isApiPath(request.path)) {
      next();
      return;
    }
    response.sendFile(resolve(distPath, "index.html"));
  });
}

app.use((request, response, next) => {
  if (!isApiPath(request.path)) {
    next();
    return;
  }
  response.status(404).json({ error: "요청한 API 경로를 찾을 수 없습니다.", code: "API_NOT_FOUND" });
});

function apiErrorHandler(error: unknown, request: Request, response: Response, next: NextFunction) {
  if (!isApiPath(request.path) || response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof URIError) {
    response.status(400).json({ error: "API 요청 경로 형식이 올바르지 않습니다.", code: "API_INVALID_PATH" });
    return;
  }
  response.status(500).json({ error: "서버에서 API 요청을 처리하지 못했습니다.", code: "INTERNAL_SERVER_ERROR" });
}

app.use(apiErrorHandler);

export { app };

async function start() {
  await ensureDataDirectory();
  await initializePersistence();
  await loadCatalog();
  app.listen(port, "0.0.0.0", () => {
    console.log(`PC Supporter API listening on http://127.0.0.1:${port}`);
  });

  if (process.env.BUILD_MONITOR_SCHEDULER_ENABLED !== "false") {
    const initialMonitorRun = setTimeout(() => void runDueSavedBuildMonitors(), 5_000);
    initialMonitorRun.unref();
    const monitorInterval = setInterval(() => void runDueSavedBuildMonitors(), 60_000);
    monitorInterval.unref();
  }

  const intervalHours = Number(process.env.DANAWA_CRAWL_INTERVAL_HOURS ?? 24);
  if (process.env.DANAWA_CRAWL_ON_START !== "false") {
    void runCrawlJob({ all: process.env.DANAWA_CRAWL_ALL === "true" });
  }
  if (Number.isFinite(intervalHours) && intervalHours > 0) {
    setInterval(() => {
      if (!isCrawlRunning()) void runCrawlJob({ all: process.env.DANAWA_CRAWL_ALL === "true" });
    }, intervalHours * 60 * 60 * 1000);
  }
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  void start();
}
