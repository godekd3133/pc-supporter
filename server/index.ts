import "dotenv/config";
import express, { type Request, type RequestHandler, type Response } from "express";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { AccessoryCategory, AccessoryPriceFilter, AccessoryRefreshResponse, AccessorySelection, AlternativeRisk, AlternativeRiskCounts, BuildGenerationRequest, BuildSelection, CatalogChangeKind, CatalogChangeRecord, CompatibilityResult, DataFreshness, DataQuality, Finding, GpuPhysicalOverride, ListingPolicy, M2CoverageFilter, M2MappingStatus, M2SlotCoverage, M2SlotCoverageBucket, M2SlotCoverageItem, M2SlotOverride, M2SlotReviewTemplate, M2SlotReviewTemplateItem, Part, PartCategory, PartRefreshResponse, PartSelection, PriceAvailabilityFilter, RecommendationPreferences, RecommendationProfile, SavedBuild } from "../shared/types";
import { ACCESSORY_CATEGORIES, PART_CATEGORIES } from "../shared/types";
import { catalogMeta, countParts, currentCatalogRuntimeRevision, findPart, invalidateCatalogCache, loadCatalog, parsePartSpecFilter, partMatchesSpecFilter, partSpecFilterDiagnosticsFor, searchParts, upsertCatalog } from "./catalog";
import { countAccessories, findAccessory, loadAccessories, readAccessoryCoverage, searchAccessories, upsertAccessories } from "./accessories";
import { recommendAccessories } from "./accessory-recommendations";
import { summarizeAccessorySelections, validateAccessorySelectionIds, validateAccessoryTargetAccessoryIds, validateRgbControllerAccessoryId } from "./accessory-cart";
import { summarizeSavedBuild } from "./build-summary";
import { classifyDataFreshness, summarizeBuildDataHealth } from "./data-health";
import { isAccessoryCrawlRunning, readAccessoryCrawlManifest, readAccessoryCrawlStatus, runAccessoryCrawlJob } from "./accessory-crawler";
import { BuildGenerationError, ENGINE_VERSION, assessAlternativePart, buildGenerationRecoveryOptionsFor, candidateSimilarityForBuild, compareCandidateSimilarity, compareCandidateValue, evaluateBuild, generateBuildDraft } from "./engine";
import { isCrawlRunning, readCrawlStatus, runCrawlJob } from "./crawler";
import { CATALOG_CHANGE_LOG_PATH, CRAWL_MANIFEST_PATH, ensureDataDirectory, readJson } from "./storage";
import type { CrawlManifest } from "../shared/types";
import { appendSavedBuild, appendSavedBuildCheck, appendSavedBudgetLadder, appendSavedComparison, appendSavedWatchlist, deleteSavedBuild, deleteSavedBudgetLadder, deleteSavedComparison, deleteSavedWatchlist, deleteSavedWatchlistAlertStates, initializePersistence, migrateSavedBuildVersions, persistenceDiagnostics, readLatestSavedBuildVersionBackup, readSavedBuildVersionBackupDetail, readSavedBuildVersionBackups, readSavedBuilds, readSavedBudgetLadders, readSavedComparisons, readSavedWatchlistAlertStates, readSavedWatchlists, rollbackSavedBuildVersions, savedBuildVersionSnapshotFingerprintFor, updateSavedBuildAssemblyVerification, updateSavedBuildMonitorState, updateSavedWatchlist, updateSavedWatchlistAlertStates, withSavedBuildMonitorLease } from "./repository";
import { DEFAULT_SAVED_WATCHLIST_ALERT_PREFERENCES, parseSavedCatalogWatchlistInput, parseSavedCatalogWatchlistUpdateInput, savedCatalogWatchlistExpired, savedWatchlistAlertPreferencesFor } from "./watchlist-store";
import { shareExpired, shareExpiryDaysFrom, shareExpiryValueProvided, shareExpiresAtFor } from "./share-lifecycle";
import { createShareOwnerCredential, publicSavedBuild, shareOwnerOrEnabledAdminCanManage, shareOwnerTokenMatches, type SavedBuildRecord } from "./build-share";
import { createRateLimitMiddleware } from "./rate-limit";
import { publicSavedCatalogWatchlist, type SavedCatalogWatchlistRecord } from "./watchlist-share";
import { parsePublicPriceHistoryIds, parsePublicPriceHistoryWindow } from "./public-price-history";
import { alternativePerformanceFilterFromUnknown, alternativePerformanceMatches } from "./alternative-performance";
import { physicalEvidenceFilterFromUnknown, physicalEvidenceMatches } from "../shared/physical-evidence-filter";
import { alternativeComparisonExpired, alternativeComparisonExpiresAtFor, parseAlternativeComparisonInput, publicAlternativeComparison, type SavedAlternativeComparisonRecord } from "./comparison-share";
import { budgetLadderShareExpired, budgetLadderShareExpiresAtFor, parseBudgetLadderShareInput, publicBudgetLadderShare } from "./budget-ladder-share";
import type { SavedBudgetLadderRecord } from "../shared/budget-ladder-share";
import { budgetLadderShareLineageEntryFor, type BudgetLadderShareLineageResponse } from "../shared/budget-ladder-share";
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
import { appendCatalogChangeRecord, appendCatalogChangeRecords, catalogChangeRecord, meaningfulCatalogChangeFields, readCatalogChangeRecords } from "./catalog-change-log";
import { catalogChangePriceHistoryFor, catalogChangePriceHistoryWithinWindowFor, catalogChangePriceWindowSummaryFor } from "../shared/catalog-change-analytics";
import { alternativeCandidateWithinBudget } from "./alternative-budget";
import { deleteBenchmarkOverride, readBenchmarkOverrides, saveBenchmarkOverrides, sortedBenchmarkOverrides, validateBenchmarkOverrideBatch, type BenchmarkOverrideBatchValidation } from "./benchmark-overrides";
import { caseRgbLoadCoverageFor, caseRgbLoadOverrideListItems, deleteCaseRgbLoadOverride, readCaseRgbLoadOverrides, saveCaseRgbLoadOverrides, validateCaseRgbLoadOverride, validateCaseRgbLoadOverrideBatch, type CaseRgbLoadOverrideBatchValidation } from "./case-rgb-load-overrides";
import { coolingFanLoadCoverageFor, coolingFanLoadOverrideListItems, deleteCoolingFanLoadOverride, readCoolingFanLoadOverrides, saveCoolingFanLoadOverrides, validateCoolingFanLoadOverride, validateCoolingFanLoadOverrideBatch, type CoolingFanLoadOverrideBatchValidation } from "./cooling-fan-load-overrides";
import { recommendationTrustFilterFromUnknown, recommendationTrustFor, recommendationTrustMatchesFilter } from "./recommendation-trust";
import { benchmarkReviewQueueFor } from "./benchmark-review";
import { savedBuildCheckSnapshotFor, savedBuildCheckTransitionSummaryFor } from "../shared/saved-build-check";
import { SAVED_BUILD_VERSION_MIGRATION_CONFIRMATION, SAVED_BUILD_VERSION_ROLLBACK_CONFIRMATION, savedBuildVersionAuditFor, savedBuildVersionGroupIdFor, savedBuildVersionMigrationPreviewFor } from "../shared/saved-build-version";
import type { SavedBuildMonitorItem, SavedBuildMonitorResponse } from "../shared/saved-build-monitor";
import { savedBuildCatalogChangeCausesFor } from "../shared/saved-build-change-causes";
import { parseSavedBuildMonitorRequest } from "./build-monitor";
import { completeSavedBuildMonitorRun, configureSavedBuildMonitorSubscription, defaultSavedBuildMonitorSubscription, failSavedBuildMonitorRun, parseSavedBuildMonitorAlertIds, parseSavedBuildMonitorSettings, SAVED_BUILD_SERVER_MONITOR_SCHEDULER_BATCH_LIMIT, savedBuildMonitorSubscriptionDue, updateSavedBuildMonitorAlertState } from "../shared/saved-build-monitor-subscription";
import type { SavedBuildMonitorSubscriptionResponse } from "../shared/saved-build-monitor-subscription";
import { compatibilityRequestKey, compatibilityResultCache, compatibilityResultCacheKey, InFlightDeduper, TtlLruInFlightCache, type CompatibilityResponseCacheValue } from "./compatibility-cache";
import { accessoryCompatibilityFor } from "./accessory-compatibility";
import { parseCatalogBatchIds, parseCatalogBatchQuery } from "./catalog-batch";
import { entityTagFor, ifNoneMatchMatches } from "./http-cache";
import { upgradeBundlePayloadFor } from "../shared/upgrade-bundle-transport";
import { candidateDecisionSummaryFor } from "../shared/candidate-decision";
import { assemblyVerificationSavedHistoryFor, parseAssemblyVerificationHistoryJson } from "../shared/assembly-verification";
import { buildCompatibilityInputFingerprint } from "../shared/build-fingerprint";

const app = express();
const port = Number(process.env.PORT ?? 4174);

app.use(express.json({ limit: "1mb" }));

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

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const MAX_M2_OVERRIDE_BATCH_SIZE = 500;
const PART_REFRESH_COOLDOWN_MS = 15_000;
const partRefreshJobs = new Map<string, Promise<PartRefreshResponse>>();
const partRefreshLastRunAt = new Map<string, number>();
const accessoryRefreshJobs = new Map<string, Promise<AccessoryRefreshResponse>>();
const accessoryRefreshLastRunAt = new Map<string, number>();
const buildCreateRateLimit = createRateLimitMiddleware("build-create", { limit: 20, windowMs: 60_000 });
const buildShareRateLimit = createRateLimitMiddleware("build-share", { limit: 120, windowMs: 60_000 });
const buildMonitorRateLimit = createRateLimitMiddleware("build-monitor", { limit: 20, windowMs: 60_000 });

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
const budgetLadderCreateRateLimit = createRateLimitMiddleware("budget-ladder-create", { limit: 10, windowMs: 60_000 });
const budgetLadderShareRateLimit = createRateLimitMiddleware("budget-ladder-share", { limit: 120, windowMs: 60_000 });

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
  if (status === "stale") reasons.push("카탈로그 원문이 매핑 이후 갱신됨 · 재검수 필요");
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
  const quantity = Number(candidate.quantity ?? 1);
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    errors.push(`${label}.quantity는 1부터 99 사이의 정수여야 합니다.`);
    return undefined;
  }
  const targetPartId = candidate.targetPartId;
  if (targetPartId !== undefined && (typeof targetPartId !== "string" || targetPartId.trim().length === 0)) {
    errors.push(`${label}.targetPartId는 비어 있지 않은 SSD ID여야 합니다.`);
    return undefined;
  }
  const targetAccessoryId = candidate.targetAccessoryId;
  if (targetAccessoryId !== undefined && (typeof targetAccessoryId !== "string" || targetAccessoryId.trim().length === 0)) {
    errors.push(`${label}.targetAccessoryId는 비어 있지 않은 팬 허브 ID여야 합니다.`);
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
    if (typeof rawPartId !== "string" || rawPartId.trim().length === 0) {
      errors.push(`${slotId}의 SSD ID가 필요합니다.`);
      continue;
    }
    normalized[slotId] = rawPartId.trim();
  }
  if (Object.keys(normalized).length > 8) {
    errors.push("m2SlotSelection은 최대 8개 슬롯까지 지정할 수 있습니다.");
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
  if (rgbControllerAccessoryId !== undefined && (typeof rgbControllerAccessoryId !== "string" || rgbControllerAccessoryId.trim().length === 0)) {
    errors.push("rgbControllerAccessoryId는 비어 있지 않은 팬 허브 ID여야 합니다.");
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

export function validateBuildPartIds(build: BuildSelection, catalog: Awaited<ReturnType<typeof loadCatalog>>) {
  const selections: Array<{ category: PartCategory; selection?: PartSelection }> = [
    { category: "cpu", selection: build.cpu },
    { category: "cooler", selection: build.cooler },
    { category: "motherboard", selection: build.motherboard },
    { category: "gpu", selection: build.gpu },
    { category: "case", selection: build.case },
    { category: "psu", selection: build.psu },
    ...build.memory.map((selection) => ({ category: "memory" as const, selection })),
    ...build.ssd.map((selection) => ({ category: "ssd" as const, selection })),
    ...build.hdd.map((selection) => ({ category: "hdd" as const, selection }))
  ];
  return selections
    .filter((entry) => {
      if (!entry.selection) return false;
      const part = findPart(catalog, entry.selection.partId);
      return !part || part.category !== entry.category;
    })
    .flatMap((entry) => entry.selection ? [entry.selection] : []);
}

export function validateAccessoryTargetPartIds(build: BuildSelection, catalog: Awaited<ReturnType<typeof loadCatalog>>) {
  const selectedSsdIds = new Set(build.ssd.map((selection) => selection.partId).filter((partId) => findPart(catalog, partId)?.category === "ssd"));
  return (build.accessories ?? [])
    .filter((selection) => selection.targetPartId !== undefined && !selectedSsdIds.has(selection.targetPartId))
    .map((selection) => selection.targetPartId as string);
}

export function parseRecommendationPreferences(value: unknown): RecommendationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { priority: "balanced", profile: "general", listingPolicy: "retail_only" };
  const candidate = value as Record<string, unknown>;
  const priority = ["balanced", "budget", "performance"].includes(String(candidate.priority))
    ? candidate.priority as RecommendationPreferences["priority"]
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
  const priority = ["balanced", "budget", "performance"].includes(String(candidate.priority))
    ? candidate.priority as RecommendationPreferences["priority"]
    : "balanced";
  const budgetWon = Number(candidate.budgetWon);
  if (!Number.isFinite(budgetWon) || !Number.isInteger(budgetWon) || budgetWon <= 0 || budgetWon > 100_000_000) {
    errors.push("budgetWon은 1원부터 100,000,000원 사이의 정수여야 합니다.");
  }
  if (candidate.includeGpu !== undefined && typeof candidate.includeGpu !== "boolean") {
    errors.push("includeGpu는 boolean이어야 합니다.");
  }
  if (candidate.priority !== undefined && !["balanced", "budget", "performance"].includes(String(candidate.priority))) {
    errors.push("priority는 balanced, budget, performance 중 하나여야 합니다.");
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
  const [catalog, accessories] = await Promise.all([loadCatalog(), loadAccessories()]);
  return builds.map((build) => ({
    ...publicSavedBuild(build),
    summary: summarizeSavedBuild(build.selection, catalog, accessories)
  }));
}

type SavedBuildMonitorResources = {
  catalog: Awaited<ReturnType<typeof loadCatalog>>;
  accessories: Awaited<ReturnType<typeof loadAccessories>>;
  catalogSnapshotAt: string;
};

async function loadSavedBuildMonitorResources(): Promise<SavedBuildMonitorResources> {
  const [catalog, accessories, meta] = await Promise.all([loadCatalog(), loadAccessories(), catalogMeta()]);
  return { catalog, accessories, catalogSnapshotAt: meta.catalogUpdatedAt };
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
    const preferences = build.recommendationPreferences ?? parseRecommendationPreferences(undefined);
    const snapshot = savedBuildCheckSnapshotFor(evaluateBuildWithAccessories(build.selection, source.catalog, source.accessories, source.catalogSnapshotAt, preferences, false));
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

app.get("/api/meta", async (_request, response) => {
  const [meta, crawler, persistence] = await Promise.all([catalogMeta(), readCrawlStatus(), persistenceDiagnostics()]);
  response.json({ ...meta, crawler, engineVersion: ENGINE_VERSION, storageMode: persistence.storageMode, persistence, adminAuthEnabled: adminAuthEnabled() });
});

app.get("/api/admin/monitor/status", requireAdmin, (_request, response) => {
  response.json({
    scheduler: {
      enabled: process.env.BUILD_MONITOR_SCHEDULER_ENABLED !== "false",
      batchLimit: SAVED_BUILD_SERVER_MONITOR_SCHEDULER_BATCH_LIMIT,
      ...savedBuildMonitorSchedulerStats
    },
    compatibilityCache: compatibilityResultCache.stats(),
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

app.post("/api/admin/build-versions/migrate", requireAdmin, async (request, response) => {
  const expectedFingerprint = typeof request.body?.expectedFingerprint === "string" ? request.body.expectedFingerprint.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
    response.status(400).json({ error: "최신 마이그레이션 프리뷰 fingerprint가 필요합니다.", code: "VERSION_MIGRATION_FINGERPRINT_REQUIRED" });
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

app.post("/api/admin/build-versions/rollback", requireAdmin, async (request, response) => {
  const backupId = typeof request.body?.backupId === "string" ? request.body.backupId.trim() : "";
  const expectedFingerprint = typeof request.body?.expectedFingerprint === "string" ? request.body.expectedFingerprint.trim().toLowerCase() : "";
  if (!backupId || backupId.length > 120 || !/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
    response.status(400).json({ error: "rollback에는 backupId와 최신 적용 fingerprint가 필요합니다.", code: "VERSION_ROLLBACK_INPUT_REQUIRED" });
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

app.get("/api/parts", async (request, response) => {
  const category = isCategory(request.query.category) ? request.query.category : undefined;
  const query = typeof request.query.q === "string" ? request.query.q : undefined;
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
  const rawSort = typeof request.query.sort === "string" ? request.query.sort : "price_asc";
  const sort = ["price_asc", "price_desc", "name", "updated"].includes(rawSort)
    ? rawSort as "price_asc" | "price_desc" | "name" | "updated"
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
  const baseOptions = { quality, sort, listingPolicy };
  const priceOptions = { ...baseOptions, priceAvailability };
  const freshnessOptions = { ...priceOptions, freshness };
  const options = { ...freshnessOptions, specFilter: parsedSpecFilter.filter };
  const baseTotal = countParts(catalog, category, query, baseOptions);
  const priceTotal = countParts(catalog, category, query, priceOptions);
  const freshnessTotal = countParts(catalog, category, query, freshnessOptions);
  const total = countParts(catalog, category, query, options);
  const specFilterApplied = Object.keys(parsedSpecFilter.filter).length > 0;
  const specInputParts = specFilterApplied ? searchParts(catalog, category, query, catalog.length, freshnessOptions, 0) : [];
  response.json({
    items: searchParts(catalog, category, query, limit, options, offset).map((part) => ({ ...part, dataFreshness: classifyDataFreshness(part.updatedAt) })),
    total,
    ...(priceAvailability !== "all" ? { priceStatus: priceAvailability, priceExcludedCount: baseTotal - priceTotal } : {}),
    ...(freshness !== "all" ? { freshness, freshnessExcludedCount: priceTotal - freshnessTotal } : {}),
    ...(specFilterApplied ? { specFilter: parsedSpecFilter.filter, specExcludedCount: freshnessTotal - total, specFilterDiagnostics: partSpecFilterDiagnosticsFor(specInputParts, parsedSpecFilter.filter) } : {}),
    offset,
    limit
  });
});

app.get("/api/parts/batch", async (request, response) => {
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

app.get("/api/parts/:id", async (request, response) => {
  const catalog = await loadCatalog();
  const part = findPart(catalog, request.params.id);
  if (!part) {
    response.status(404).json({ error: "부품을 찾을 수 없습니다." });
    return;
  }
  sendJsonWithEtag(request, response, { ...part, dataFreshness: classifyDataFreshness(part.updatedAt) }, part.updatedAt);
});

app.post("/api/parts/batch", async (request, response) => {
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

app.post("/api/parts/:id/refresh", requirePartRefreshAccess, async (request, response) => {
  const partId = routeParam(request.params.id);
  if (!partId) {
    response.status(400).json({ error: "부품 식별자가 필요합니다." });
    return;
  }
  const catalog = await loadCatalog();
  const current = findPart(catalog, partId);
  if (!current) {
    response.status(404).json({ error: "부품을 찾을 수 없습니다." });
    return;
  }
  const blockReason = partRefreshBlockReason(current);
  if (blockReason) {
    response.status(422).json({ error: blockReason, code: "PART_REFRESH_UNSUPPORTED" });
    return;
  }
  const running = partRefreshJobs.get(partId);
  if (running) {
    response.status(409).json({ error: "이 부품의 원문 재확인이 이미 실행 중입니다.", code: "PART_REFRESH_RUNNING" });
    return;
  }
  const lastRunAt = partRefreshLastRunAt.get(partId);
  if (lastRunAt !== undefined) {
    const remainingMs = PART_REFRESH_COOLDOWN_MS - (Date.now() - lastRunAt);
    if (remainingMs > 0) {
      response.setHeader("Retry-After", String(Math.ceil(remainingMs / 1000)));
      response.status(429).json({ error: `같은 부품은 ${Math.ceil(remainingMs / 1000)}초 후 다시 확인할 수 있습니다.`, code: "PART_REFRESH_COOLDOWN", retryAfterSeconds: Math.ceil(remainingMs / 1000) });
      return;
    }
    partRefreshLastRunAt.delete(partId);
  }

  const job = (async () => {
    const refreshed = await refreshDanawaPart(current);
    const savedCatalog = await upsertCatalog([refreshed]);
    const savedPart = findPart(savedCatalog, current.id);
    if (!savedPart) throw new Error("재확인한 부품을 카탈로그에 반영하지 못했습니다.");
    const result = partRefreshResponse(current, savedPart);
    await appendCatalogChangeRecord(catalogChangeRecord("part", current, savedPart, result.changedFields, { changedAt: result.refreshedAt })).catch((error: unknown) => {
      console.warn(`카탈로그 변경 이력을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    });
    return result;
  })();
  partRefreshJobs.set(partId, job);
  try {
    const result = await job;
    partRefreshLastRunAt.set(partId, Date.now());
    response.json(result);
  } catch (error: unknown) {
    response.status(422).json({ error: error instanceof Error ? error.message : "부품 상세 원문을 다시 확인하지 못했습니다.", code: "PART_REFRESH_FAILED" });
  } finally {
    if (partRefreshJobs.get(partId) === job) partRefreshJobs.delete(partId);
  }
});

app.post("/api/parts/compatible", async (request, response) => {
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body as Record<string, unknown>
    : undefined;
  const category = isCategory(body?.category) ? body.category : undefined;
  if (!category) {
    response.status(400).json({ error: "호환 후보를 찾으려면 부품 카테고리가 필요합니다." });
    return;
  }
  if (!body || body.build === undefined) {
    response.status(400).json({ error: "호환 후보를 찾으려면 현재 견적이 필요합니다." });
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
  const catalogFingerprint = catalog.reduce((latest, part) => part.updatedAt > latest ? part.updatedAt : latest, "");
  const catalogSort = sort === "similarity" || sort === "value" ? "price_asc" : sort;
  const assessmentCacheKey = `compatible-parts:${createHash("sha256").update(JSON.stringify({
    version: 7,
    engineVersion: ENGINE_VERSION,
    catalogRevision: currentCatalogRuntimeRevision(),
    catalogFingerprint,
    catalogCount: catalog.length,
    category,
    build: parsed.build,
    profile,
    gamingResolution,
    gamingRefreshRate,
    findingRuleId: requestedFindingRuleId,
    query,
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
    const baseOptions = { quality, sort: catalogSort, listingPolicy };
    const priceOptions = { ...baseOptions, priceAvailability };
    const options = { ...priceOptions, freshness };
    const baseSearchedParts = searchParts(catalog, category, query, catalog.length, baseOptions, 0);
    const priceFilteredParts = searchParts(catalog, category, query, catalog.length, priceOptions, 0);
    const searchedParts = searchParts(catalog, category, query, catalog.length, options, 0);
    const specFilteredParts = searchedParts.filter((part) => partMatchesSpecFilter(part, parsedSpecFilter.filter));
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
            freshness: recommendationTrust.freshness
          })
        };
      });
    return {
      intentFinding,
      assessedParts,
      priceExcludedCount: baseSearchedParts.length - priceFilteredParts.length,
      freshnessExcludedCount: priceFilteredParts.length - searchedParts.length,
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
  const riskCounts: AlternativeRiskCounts = { safe: 0, review: 0, unsafe: 0 };
  for (const { assessment } of intentParts) riskCounts[assessment.risk] += 1;
  const compatibleParts = intentParts
    .filter(({ assessment }) => mode === "safe" ? assessment.risk === "safe" : mode === "no_blocker" ? assessment.risk !== "unsafe" : true);
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
    intentRuleId: intentFinding?.ruleId,
    intentTitle: intentFinding?.title,
    riskCounts,
    offset,
    limit
  });
});

app.get("/api/accessories", async (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q : undefined;
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
  const baseOptions = { category, quality, sort, priceFilter };
  const freshnessOptions = { ...baseOptions, freshness };
  const baseTotal = countAccessories(accessories, query, baseOptions);
  const freshnessTotal = countAccessories(accessories, query, freshnessOptions);
  const total = freshnessTotal;
  response.json({
    items: searchAccessories(accessories, query, limit, freshnessOptions, offset).map((item) => ({ ...item, dataFreshness: classifyDataFreshness(item.updatedAt) })),
    total,
    category,
    priceFilter,
    ...(freshness !== "all" ? { freshness, freshnessExcludedCount: baseTotal - freshnessTotal } : {}),
    offset,
    limit
  });
});

app.get("/api/accessories/:id", async (request, response) => {
  const accessory = findAccessory(await loadAccessories(), request.params.id);
  if (!accessory) {
    response.status(404).json({ error: "주변 부품을 찾을 수 없습니다." });
    return;
  }
  response.json({ ...accessory, dataFreshness: classifyDataFreshness(accessory.updatedAt) });
});

app.post("/api/accessories/batch", async (request, response) => {
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
  return (await readJson<unknown[]>(CATALOG_CHANGE_LOG_PATH, [])).filter(isUsableCatalogChangeRecord);
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
  response.json({ windowDays, items });
});

app.post("/api/accessories/:id/refresh", requirePartRefreshAccess, async (request, response) => {
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
    response.status(409).json({ error: "이 주변 부품의 원문 재확인이 이미 실행 중입니다.", code: "ACCESSORY_REFRESH_RUNNING" });
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
    response.status(422).json({ error: error instanceof Error ? error.message : "주변 부품 상세 원문을 다시 확인하지 못했습니다.", code: "ACCESSORY_REFRESH_FAILED" });
  } finally {
    if (accessoryRefreshJobs.get(accessoryId) === job) accessoryRefreshJobs.delete(accessoryId);
  }
});

app.post("/api/compatibility/check", async (request, response) => {
  const parsed = parseBuild(request.body);
  if (parsed.errors.length > 0) {
    response.status(400).json({ error: "견적 입력 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const build = parsed.build;
  const recommendationPreferences = parseRecommendationPreferences(request.body?.recommendationPreferences);
  const requestKey = compatibilityRequestKey(build, recommendationPreferences, ENGINE_VERSION);
  const outcome = await compatibilityRequestDeduper.getOrCompute(requestKey, async (): Promise<CompatibilityApiOutcome> => {
    const catalog = await loadCatalog();
    const accessories = await loadAccessories();
    const invalidSelections = validateBuildPartIds(build, catalog);
    if (invalidSelections.length > 0) {
      return { status: "error", statusCode: 400, body: { error: "카탈로그에 존재하지 않는 부품이 포함되어 있습니다.", partIds: invalidSelections.map((selection) => selection.partId) } };
    }
    const invalidAccessories = validateAccessorySelectionIds(build.accessories ?? [], accessories);
    if (invalidAccessories.length > 0) {
      return { status: "error", statusCode: 400, body: { error: "카탈로그에 존재하지 않는 주변 부품이 포함되어 있습니다.", accessoryIds: invalidAccessories.map((selection) => selection.accessoryId) } };
    }
    const invalidAccessoryTargets = validateAccessoryTargetPartIds(build, catalog);
    if (invalidAccessoryTargets.length > 0) {
      return { status: "error", statusCode: 400, body: { error: "주변 부품 연결 대상 SSD가 현재 견적에 없습니다.", targetPartIds: invalidAccessoryTargets } };
    }
    const invalidAccessoryHubTargets = validateAccessoryTargetAccessoryIds(build, accessories);
    if (invalidAccessoryHubTargets.length > 0) {
      return { status: "error", statusCode: 400, body: { error: "주변 부품 연결 대상 팬 허브가 현재 견적에 없습니다.", targetAccessoryIds: invalidAccessoryHubTargets } };
    }
    const invalidRgbControllerAccessoryId = validateRgbControllerAccessoryId(build, accessories);
    if (invalidRgbControllerAccessoryId.length > 0) {
      return { status: "error", statusCode: 400, body: { error: "RGB 연결 컨트롤러가 현재 견적에 선택되어 있지 않습니다.", rgbControllerAccessoryId: invalidRgbControllerAccessoryId[0] } };
    }
    const meta = await catalogMeta();
    const cacheKey = compatibilityResultCacheKey({
      build,
      recommendationPreferences,
      catalogSnapshotAt: meta.catalogUpdatedAt,
      accessoryUpdatedAt: meta.accessoryUpdatedAt,
      catalogRevision: currentCatalogRuntimeRevision(),
      engineVersion: ENGINE_VERSION
    });
    const cached = await compatibilityResultCache.getOrCompute(cacheKey, () => {
      const fullResult = evaluateBuildWithAccessories(build, catalog, accessories, meta.catalogUpdatedAt, recommendationPreferences);
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

app.post("/api/builds/recommend", async (request, response) => {
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

app.post("/api/builds", buildCreateRateLimit, async (request, response) => {
  const expiresInDays = shareExpiryDaysFrom(request.body?.expiresInDays);
  if (shareExpiryValueProvided(request.body?.expiresInDays) && expiresInDays === undefined) {
    response.status(400).json({ error: "공유 링크 유효기간은 무기한, 7일, 30일 중 하나여야 합니다." });
    return;
  }
  const catalog = await loadCatalog();
  const accessories = await loadAccessories();
  const parsed = parseBuild(request.body?.selection ?? request.body);
  if (parsed.errors.length > 0) {
    response.status(400).json({ error: "견적 입력 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const build = parsed.build;
  const invalidSelections = validateBuildPartIds(build, catalog);
  if (invalidSelections.length > 0) {
    response.status(400).json({ error: "유효하지 않은 부품이 포함되어 있습니다." });
    return;
  }
  const invalidAccessories = validateAccessorySelectionIds(build.accessories ?? [], accessories);
  if (invalidAccessories.length > 0) {
    response.status(400).json({ error: "유효하지 않은 주변 부품이 포함되어 있습니다." });
    return;
  }
  const invalidAccessoryTargets = validateAccessoryTargetPartIds(build, catalog);
  if (invalidAccessoryTargets.length > 0) {
    response.status(400).json({ error: "주변 부품 연결 대상 SSD가 현재 견적에 없습니다.", targetPartIds: invalidAccessoryTargets });
    return;
  }
  const invalidAccessoryHubTargets = validateAccessoryTargetAccessoryIds(build, accessories);
  if (invalidAccessoryHubTargets.length > 0) {
    response.status(400).json({ error: "주변 부품 연결 대상 팬 허브가 현재 견적에 없습니다.", targetAccessoryIds: invalidAccessoryHubTargets });
    return;
  }
  const invalidRgbControllerAccessoryId = validateRgbControllerAccessoryId(build, accessories);
  if (invalidRgbControllerAccessoryId.length > 0) {
    response.status(400).json({ error: "RGB 연결 컨트롤러가 현재 견적에 선택되어 있지 않습니다.", rgbControllerAccessoryId: invalidRgbControllerAccessoryId[0] });
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
  const meta = await catalogMeta();
  const checkSnapshot = savedBuildCheckSnapshotFor(
    evaluateBuildWithAccessories(build, catalog, accessories, meta.catalogUpdatedAt, recommendationPreferences, false)
  );
  const saved: SavedBuildRecord = {
    id,
    name: typeof request.body?.name === "string" && request.body.name.trim() ? request.body.name.trim() : "나의 PC 견적",
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
  response.status(201).json({ ...publicSavedBuild(persisted), ownerToken: ownerCredential.token, summary: summarizeSavedBuild(persisted.selection, catalog, accessories) });
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
    response.status(400).json({ error: parsed.errors[0] ?? "후보 비교를 저장할 수 없습니다.", details: parsed.errors });
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
    response.status(404).json({ error: "저장된 후보 비교를 찾을 수 없습니다." });
    return;
  }
  if (alternativeComparisonExpired(comparison)) {
    response.status(404).json({ error: "후보 비교 링크가 만료되었습니다." });
    return;
  }
  response.json(publicAlternativeComparison(comparison));
});

app.delete("/api/comparisons/:id", comparisonShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const comparison = (await readSavedComparisons()).find((item) => item.id === id);
  if (!comparison) {
    response.status(404).json({ error: "저장된 후보 비교를 찾을 수 없습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  // When admin authentication is disabled for local development there is no
  // authenticated admin session to trust. Keep the owner-token boundary
  // enforced for this public bearer-link endpoint in that mode as well.
  const canManageAsAdmin = adminAuthEnabled() && isAdminAuthenticated(request);
  if (!shareOwnerTokenMatches(comparison, ownerToken) && !canManageAsAdmin) {
    response.status(401).json({ error: "이 후보 비교를 취소할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const deleted = await deleteSavedComparison(id ?? "");
  if (!deleted) {
    response.status(404).json({ error: "저장된 후보 비교를 찾을 수 없습니다." });
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
  const meta = await catalogMeta();
  const ownerCredential = createShareOwnerCredential();
  const existingLadders = parsed.parentId ? await readSavedBudgetLadders() : [];
  const parent = parsed.parentId ? existingLadders.find((item) => item.id === parsed.parentId) : undefined;
  if (parsed.parentId && (!parent || budgetLadderShareExpired(parent))) {
    response.status(400).json({ error: "원본 예산 비교 snapshot을 찾을 수 없거나 만료되었습니다." });
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
    catalogSnapshotAt: meta.catalogUpdatedAt,
    createdAt: now,
    updatedAt: now,
    ...(expiresAt ? { expiresAt } : {}),
    ownerTokenHash: ownerCredential.hash
  };
  await appendSavedBudgetLadder(saved);
  response.status(201).json({ ...publicBudgetLadderShare(saved, meta.catalogUpdatedAt), ownerToken: ownerCredential.token });
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
  const meta = await catalogMeta();
  response.json(publicBudgetLadderShare(ladder, meta.catalogUpdatedAt));
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
  const canManageAsAdmin = adminAuthEnabled() && isAdminAuthenticated(request);
  if (!shareOwnerTokenMatches(ladder, ownerToken) && !canManageAsAdmin) {
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
  if (!shareOwnerTokenMatches(watchlist, ownerToken) && !isAdminAuthenticated(request)) {
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
  if (!shareOwnerTokenMatches(watchlist, ownerToken) && !isAdminAuthenticated(request)) {
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
  if (!shareOwnerTokenMatches(watchlist, ownerToken) && !isAdminAuthenticated(request)) {
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

app.delete("/api/watchlists/:id", async (request, response) => {
  const id = routeParam(request.params.id);
  const watchlist = (await readSavedWatchlists()).find((item) => item.id === id);
  if (!watchlist) {
    response.status(404).json({ error: "저장된 관심 가격 목록을 찾을 수 없습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  if (!shareOwnerTokenMatches(watchlist, ownerToken) && !isAdminAuthenticated(request)) {
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

async function ownedSavedBuildForRequest(request: Request, response: Response) {
  const id = routeParam(request.params.id);
  const build = (await loadBuilds()).find((item) => item.id === id);
  if (!build) {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return undefined;
  }
  if (shareExpired(build.expiresAt)) {
    response.status(404).json({ error: "공유 견적 링크가 만료되었습니다." });
    return undefined;
  }
  const ownerToken = request.header("x-share-owner-token");
  if (!shareOwnerOrEnabledAdminCanManage(build, ownerToken, adminAuthEnabled(), isAdminAuthenticated(request))) {
    response.status(401).json({ error: "서버 백그라운드 점검을 관리하려면 견적 소유자 인증이 필요합니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return undefined;
  }
  return build;
}

app.get("/api/builds", async (request, response) => {
  const rawIds = typeof request.query.ids === "string" ? request.query.ids : undefined;
  const requestedIds = rawIds === undefined ? undefined : [...new Set(rawIds.split(",").map((id) => id.trim()).filter(Boolean))].slice(0, 20);
  if (requestedIds === undefined && !isAdminAuthenticated(request)) {
    response.status(401).json({ error: "저장 견적 목록을 조회하려면 관리자 로그인이 필요합니다.", code: "ADMIN_AUTH_REQUIRED" });
    return;
  }
  const builds = (await loadBuilds())
    .filter((build) => requestedIds === undefined || requestedIds.includes(build.id))
    .filter((build) => !shareExpired(build.expiresAt));
  const limit = Math.min(50, Math.max(1, Number(request.query.limit ?? 20)));
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
  const [catalog, accessories, meta] = availableBuilds.length > 0
    ? await Promise.all([loadCatalog(), loadAccessories(), catalogMeta()])
    : [[], [], { catalogUpdatedAt: new Date().toISOString() }];

  const items = parsed.ids.map((id): SavedBuildMonitorItem => {
    const build = buildsById.get(id);
    if (!build || shareExpired(build.expiresAt)) {
      return { id, status: "not_found", message: "저장 견적이 없거나 공유 링크가 만료되었습니다." };
    }
    try {
      const snapshot = savedBuildCheckSnapshotFor(
        evaluateBuildWithAccessories(
          build.selection,
          catalog,
          accessories,
          meta.catalogUpdatedAt,
          build.recommendationPreferences ?? parseRecommendationPreferences(undefined),
          false
        )
      );
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
  });
  const payload: SavedBuildMonitorResponse = {
    requestedCount: parsed.ids.length,
    checkedCount: items.filter((item) => item.status === "ready").length,
    checkedAt: new Date().toISOString(),
    items
  };
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
  const builds = await loadBuilds();
  const build = builds.find((item) => item.id === routeParam(request.params.id));
  if (!build) {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  if (shareExpired(build.expiresAt)) {
    response.status(404).json({ error: "공유 견적 링크가 만료되었습니다." });
    return;
  }
  const [catalog, accessories] = await Promise.all([loadCatalog(), loadAccessories()]);
  response.json({ ...publicSavedBuild(build), summary: summarizeSavedBuild(build.selection, catalog, accessories) });
});

app.post("/api/builds/:id/check", buildShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const build = (await loadBuilds()).find((item) => item.id === id);
  if (!build) {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  if (shareExpired(build.expiresAt)) {
    response.status(404).json({ error: "공유 견적 링크가 만료되었습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  const canManageAsAdmin = adminAuthEnabled() && isAdminAuthenticated(request);
  if (!shareOwnerTokenMatches(build, ownerToken) && !canManageAsAdmin) {
    response.status(401).json({ error: "검사 기록을 추가하려면 견적 소유자 인증이 필요합니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const [catalog, accessories, meta] = await Promise.all([loadCatalog(), loadAccessories(), catalogMeta()]);
  const recommendationPreferences = build.recommendationPreferences ?? parseRecommendationPreferences(undefined);
  const checkSnapshot = savedBuildCheckSnapshotFor(
    evaluateBuildWithAccessories(build.selection, catalog, accessories, meta.catalogUpdatedAt, recommendationPreferences, false)
  );
  const updated = await appendSavedBuildCheck(id ?? "", checkSnapshot);
  if (!updated) {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  response.json({ ...publicSavedBuild(updated), summary: summarizeSavedBuild(updated.selection, catalog, accessories) });
});

app.put("/api/builds/:id/assembly-verification", buildShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const build = (await loadBuilds()).find((item) => item.id === id);
  if (!build) {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  if (shareExpired(build.expiresAt)) {
    response.status(404).json({ error: "공유 견적 링크가 만료되었습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  const canManageAsAdmin = adminAuthEnabled() && isAdminAuthenticated(request);
  if (!shareOwnerTokenMatches(build, ownerToken) && !canManageAsAdmin) {
    response.status(401).json({ error: "조립 검증 기록을 저장하려면 견적 소유자 인증이 필요합니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const rawHistory = request.body?.history ?? request.body?.log;
  if (!rawHistory || typeof rawHistory !== "object" || Array.isArray(rawHistory)) {
    response.status(400).json({ error: "조립 검증 이력 본문이 필요합니다." });
    return;
  }
  const rawFingerprint = typeof rawHistory.buildFingerprint === "string" ? rawHistory.buildFingerprint : "";
  const parsed = parseAssemblyVerificationHistoryJson(JSON.stringify(rawHistory), rawFingerprint);
  if (parsed.errors.length > 0 || !parsed.history) {
    response.status(400).json({ error: "조립 검증 이력 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const recommendationPreferences = build.recommendationPreferences ?? parseRecommendationPreferences(undefined);
  const expectedFingerprint = buildCompatibilityInputFingerprint(build.selection, recommendationPreferences);
  const expectedPrefix = `pc-supporter-assembly-verification:${expectedFingerprint}:`;
  if (!parsed.history.buildFingerprint.startsWith(expectedPrefix)) {
    response.status(409).json({ error: "현재 저장 견적과 다른 조립 검증 로그입니다. 같은 견적에서 생성한 로그만 저장할 수 있습니다.", code: "ASSEMBLY_VERIFICATION_BUILD_MISMATCH" });
    return;
  }
  const verificationHistory = assemblyVerificationSavedHistoryFor(parsed.history);
  const verification = verificationHistory.find((item) => item.runId === parsed.history!.activeRunId) ?? verificationHistory.at(-1);
  if (!verification) {
    response.status(400).json({ error: "조립 검증 이력이 비어 있습니다." });
    return;
  }
  const updated = await updateSavedBuildAssemblyVerification(id ?? "", verification, verificationHistory);
  if (!updated) {
    response.status(409).json({ error: "저장 견적에 먼저 검사 결과를 기록해야 조립 검증 로그를 연결할 수 있습니다.", code: "ASSEMBLY_VERIFICATION_CHECK_REQUIRED" });
    return;
  }
  const [catalog, accessories] = await Promise.all([loadCatalog(), loadAccessories()]);
  response.json({ ...publicSavedBuild(updated), summary: summarizeSavedBuild(updated.selection, catalog, accessories) });
});

app.get("/api/builds/:id/check-causes", buildShareRateLimit, async (request, response) => {
  const id = routeParam(request.params.id);
  const build = (await loadBuilds()).find((item) => item.id === id);
  if (!build) {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  if (shareExpired(build.expiresAt)) {
    response.status(404).json({ error: "공유 견적 링크가 만료되었습니다." });
    return;
  }
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

app.delete("/api/builds/:id", async (request, response) => {
  const id = routeParam(request.params.id);
  const build = (await loadBuilds()).find((item) => item.id === id);
  if (!build) {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  const ownerToken = request.header("x-share-owner-token");
  if (!shareOwnerTokenMatches(build, ownerToken) && !isAdminAuthenticated(request)) {
    response.status(401).json({ error: "이 공유 견적을 취소할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
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

app.get("/api/admin/crawl/status", async (_request, response) => {
  response.json(await readCrawlStatus());
});

app.get("/api/admin/crawl/manifest", async (_request, response) => {
  const manifest = await readJson<CrawlManifest | null>(CRAWL_MANIFEST_PATH, null);
  if (!manifest) {
    response.status(404).json({ error: "아직 생성된 크롤 manifest가 없습니다." });
    return;
  }
  response.json(manifest);
});

app.get("/api/admin/accessories/crawl/status", async (_request, response) => {
  response.json(await readAccessoryCrawlStatus());
});

app.get("/api/admin/accessories/crawl/manifest", async (_request, response) => {
  const manifest = await readAccessoryCrawlManifest();
  if (!manifest) {
    response.status(404).json({ error: "아직 생성된 주변 부품 크롤 manifest가 없습니다." });
    return;
  }
  response.json(manifest);
});

app.get("/api/admin/accessories/coverage", async (_request, response) => {
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

app.post("/api/admin/gpu-physical-overrides/source-check/batch", requireAdmin, async (request, response) => {
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
    .map((partId) => ({ partId, reason: "저장된 HTTPS 근거 URL이 없거나 현재 카탈로그 범주와 일치하지 않습니다." }));
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

app.post("/api/admin/gpu-physical-overrides/:partId/source-check", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const partId = routeParam(request.params.partId);
  if (!partId) {
    response.status(400).json({ error: "물리 근거 점검 대상 식별자가 필요합니다." });
    return;
  }
  const part = findPart(catalog, partId);
  if (!part || (part.category !== "gpu" && part.category !== "case" && part.category !== "psu")) {
    response.status(404).json({ error: "물리 근거를 점검할 GPU·케이스·PSU를 찾을 수 없습니다." });
    return;
  }
  const overrides = await readGpuPhysicalOverrides();
  const override = overrides[partId];
  if (!override) {
    response.status(404).json({ error: "먼저 물리 검수값을 저장해야 근거 URL을 점검할 수 있습니다." });
    return;
  }
  if (!override.sourceUrl) {
    response.status(400).json({ error: "저장된 근거 URL이 없어 점검할 수 없습니다." });
    return;
  }
  const sourceCheck = await checkPhysicalSourceUrl(override.sourceUrl, override.manufacturerModel);
  const persist = request.query.persist !== "false";
  const checkedOverride = persist ? await saveGpuPhysicalSourceCheck(partId, sourceCheck) : override;
  if (!checkedOverride) {
    response.status(404).json({ error: "물리 검수값이 점검 중 사라졌습니다." });
    return;
  }
  const historyEntry = persist && checkedOverride ? await appendPhysicalSourceCheckHistory(partId, sourceCheck).catch(() => undefined) : undefined;
  if (persist) invalidateCatalogCache();
  const refreshedCatalog = persist ? await loadCatalog() : catalog;
  response.json({ persisted: persist, historyRecorded: Boolean(historyEntry), sourceCheck, override: checkedOverride, part: refreshedCatalog.find((candidate) => candidate.id === partId) });
});

app.get("/api/admin/gpu-physical-overrides/:partId/source-check/history", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const partId = routeParam(request.params.partId);
  const part = partId ? findPart(catalog, partId) : undefined;
  if (!part || (part.category !== "gpu" && part.category !== "case" && part.category !== "psu")) {
    response.status(404).json({ error: "근거 점검 이력을 조회할 GPU·케이스·PSU를 찾을 수 없습니다." });
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

app.post("/api/admin/login", (request, response) => {
  loginAdmin(request, response);
});

app.post("/api/admin/logout", (request, response) => {
  logoutAdmin(request, response);
});

app.post("/api/admin/crawl", requireAdmin, async (request, response) => {
  if (isCrawlRunning()) {
    response.status(409).json({ error: "이미 카탈로그 갱신 작업이 실행 중입니다." });
    return;
  }
  const pages = Number(request.body?.pages ?? process.env.DANAWA_CRAWL_PAGES ?? 1);
  const limitPerCategory = Number(request.body?.limitPerCategory ?? process.env.DANAWA_CRAWL_LIMIT ?? 5);
  const details = request.body?.details !== false && process.env.DANAWA_CRAWL_DETAILS !== "false";
  const all = request.body?.all === true || process.env.DANAWA_CRAWL_ALL === "true";
  void runCrawlJob({ pages, limitPerCategory, details, all });
  response.status(202).json({ message: "카탈로그 갱신을 시작했습니다." });
});

app.post("/api/admin/accessories/crawl", requireAdmin, async (request, response) => {
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
    if (request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(resolve(distPath, "index.html"));
  });
}

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
