import { catalogSeedMappingPreviewFor, catalogSeedMappingIdentityCompatibleFor } from "../../shared/catalog-seed-mapping";
import { type BackgroundJob, backgroundJobStore, BackgroundJobIdempotencyConflictError, BackgroundJobActiveConflictError } from "../background-job-store";
import { type M2SlotOverride, type M2MappingStatus, type M2CoverageFilter, type M2SlotCoverage, type M2SlotCoverageItem, type M2SlotCoverageBucket, type M2SlotReviewTemplateItem, type M2SlotReviewTemplate, type Part, PART_CATEGORIES, type PartCategory, type GpuPhysicalOverride, type CrawlStatus, type CatalogChangeKind, type CrawlManifest, type CrawlResumePreview, ACCESSORY_CATEGORIES, type AccessoryCategory } from "../../shared/types";
import { loadCatalog, findPart, catalogUpdatedAtFor, currentCatalogRuntimeRevision, catalogMeta, parseCatalogMissingField, invalidateCatalogCache, catalogEligibilitySummaryFor } from "../catalog";
import { validateM2SlotOverride, m2SlotOverrideCompleteness, readM2SlotOverrides, saveM2SlotOverrides, saveM2SlotOverride, deleteM2SlotOverride } from "../m2-overrides";
import { type BenchmarkOverrideBatchValidation, sortedBenchmarkOverrides, readBenchmarkOverrides, validateBenchmarkOverrideBatch, saveBenchmarkOverrides, saveBenchmarkSourceCheck, deleteBenchmarkOverride } from "../benchmark-overrides";
import { pcieSlotEvidenceMissingFieldsFor } from "../../shared/pcie-slot";
import { type CatalogSpecRefreshBatchFilters, type CatalogSpecReviewAction, type CatalogSpecReviewEvidence, catalogSpecRefreshCoverageSummaryFor, type CatalogSpecRefreshBatchItem, type CatalogSpecRefreshBatchResponse, catalogSpecRefreshCoverageDeltaFor, catalogSpecRefreshImpactFor, catalogPcieRefreshImpactFor, type CatalogSpecReviewPriority, catalogSpecReviewWorkPackageFor, catalogSpecRefreshProgressSummaryFor } from "../../shared/catalog-spec-review";
import { type CatalogSpecOverrideBatchValidation, catalogSpecOverrideListItems, readCatalogSpecOverrides, sortedCatalogSpecOverrides, validateCatalogSpecOverrideBatch, saveCatalogSpecOverrides, deleteCatalogSpecOverride, saveCatalogSpecOverrideSourceCheck } from "../catalog-spec-overrides";
import { type CaseRgbLoadOverrideBatchValidation, caseRgbLoadOverrideListItems, readCaseRgbLoadOverrides, caseRgbLoadCoverageFor, validateCaseRgbLoadOverrideBatch, saveCaseRgbLoadOverrides, validateCaseRgbLoadOverride, deleteCaseRgbLoadOverride } from "../case-rgb-load-overrides";
import { type CoolingFanLoadOverrideBatchValidation, coolingFanLoadOverrideListItems, readCoolingFanLoadOverrides, coolingFanLoadCoverageFor, validateCoolingFanLoadOverrideBatch, saveCoolingFanLoadOverrides, validateCoolingFanLoadOverride, deleteCoolingFanLoadOverride } from "../cooling-fan-load-overrides";
import { validateGpuPhysicalOverrideBatch, readGpuPhysicalOverrides, saveGpuPhysicalSourceCheck, saveGpuPhysicalOverrides, validateGpuPhysicalOverride, saveGpuPhysicalOverride, deleteGpuPhysicalOverride } from "../gpu-physical-overrides";
import { meaningfulCatalogChangeFields, catalogChangeRecord, readCatalogChangeRecords, appendCatalogChangeRecords, appendCatalogChangeRecord } from "../catalog-change-log";
import { readCatalogSeedMappingReviews, validateCatalogSeedMappingReview, catalogSeedMappingReviewConflictFor, saveCatalogSeedMappingReview, validateCatalogSeedMappingManualInput, sourceIdentitiesFor, deleteCatalogSeedMappingReview } from "../catalog-seed-mappings";
import { starterCatalog } from "../seed-catalog-starter";
import { requireAdmin, adminAuthEnabled, adminSession, loginAdmin, logoutAdmin } from "../auth";
import { readCrawlStatus, crawlResumePlanFor, isCrawlRunning, crawlerEngineSnapshot, crawlPageRetryPlanFor, runCrawlPageRetryJob, crawlPageRetryBatchPlanFor, runCrawlPageRetryBatchJob, isCrawlPageRetryBatchRunning, cancelCrawlPageRetryBatch, readAccessoryCrawlStatus, readAccessoryCrawlManifest, runCrawlJob, isAccessoryCrawlRunning, runAccessoryCrawlJob } from "../engines/crawler-engine";
import { persistenceDiagnostics, readSavedBuilds, savedBuildVersionSnapshotFingerprintFor, readLatestSavedBuildVersionBackup, readSavedBuildVersionBackups, readSavedBuildVersionBackupDetail, migrateSavedBuildVersions, rollbackSavedBuildVersions } from "../repository";
import { publicCrawlStatusFor } from "../../shared/public-crawl-status";
import { ENGINE_VERSION } from "../../shared/domain/engine";
import { usageEventSummaryFor, usageAnalyticsFor } from "../usage-events";
import { recentGenerationFailures } from "../generation-failure-log";
import { SAVED_BUILD_SERVER_MONITOR_SCHEDULER_BATCH_LIMIT } from "../../shared/saved-build-monitor-subscription";
import { compatibilityResultCache } from "../compatibility-cache";
import { savedBuildCheckPreviewCache } from "../saved-build-check-cache";
import { compatiblePartAssessmentCache, clearCompatibilityEngineCaches } from "../engines/compatibility-engine";
import { httpMetricsSnapshot } from "../request-metrics";
import { INSTANCE_ID, instanceEventBusReady } from "../instance-events";
import { savedBuildVersionAuditFor, savedBuildVersionMigrationPreviewFor, SAVED_BUILD_VERSION_MIGRATION_CONFIRMATION, SAVED_BUILD_VERSION_ROLLBACK_CONFIRMATION } from "../../shared/saved-build-version";
import { isListingAllowed, quoteGenerationSummaryFor } from "../../shared/domain/listing";
import { newCatalogSpecRefreshRunId, appendCatalogSpecRefreshHistory, catalogSpecRefreshHistoryEntryFor, readCatalogSpecRefreshHistory } from "../catalog-spec-refresh-history";
import { catalogCategoryMismatchFor } from "../../shared/catalog-category-integrity";
import { catalogCategoryIntegrityReviewPackageFor } from "../../shared/catalog-category-integrity-review";
import { catalogSpecSourceCheckBatchFor } from "../catalog-spec-source-check-batch";
import { appendCatalogSpecOverrideSourceCheckHistory, readCatalogSpecOverrideSourceCheckHistory } from "../catalog-spec-override-source-check-history";
import { checkPhysicalSourceUrl } from "../physical-source-check";
import { stalePriceRefreshStatus } from "../stale-price-refresh";
import { readPriceRefreshStatus } from "../price-refresh";
import { priceRefreshOptionsFromEnv } from "../price-refresh-scheduler";
import { createHash } from "node:crypto";
import { readJson, CRAWL_MANIFEST_PATH, fileUpdatedAt } from "../storage";
import { engineModulesStatus } from "../engines";
import { loadEngineGenerationOptions, engineGenerationOptionsPath, ENGINE_GENERATION_OPTION_DEFAULTS, normalizeEngineGenerationOptions, saveEngineGenerationOptions } from "../engines/quotation-engine";
import { existsSync } from "node:fs";
import { startCatalogIngestionJob, CATALOG_INGESTION_BUSY_MESSAGE } from "../catalog-ingestion-coordinator";
import { readAccessoryCoverage, loadAccessories, findAccessory } from "../accessories";
import { physicalReviewQueueFor, physicalReviewCoverageFor, physicalReviewWorkPackageFor } from "../gpu-physical-review";
import { physicalSourceCheckBatchFor } from "../physical-source-check-batch";
import { appendPhysicalSourceCheckHistory, readPhysicalSourceCheckHistory } from "../physical-source-check-history";
import { gamingPerformanceEvidencePath, loadGamingPerformanceEvidence, saveGamingPerformanceEvidence } from "../gaming-performance-evidence";
import { gamingPerformanceEvidenceBatchValidationFor } from "../../shared/gaming-performance-evidence";
import { loadEngineTargetFiltersConfig, engineTargetFiltersPath, engineTargetFilterSummaryFor, engineTargetFilterFacetOptionsFor, normalizeEngineTargetFiltersInput, saveEngineTargetFiltersConfig } from "../engine-target-filters";
import { benchmarkReviewQueueFor, benchmark3DMarkReviewWorkPackageFor } from "../benchmark-review";
import { BENCHMARK_3DMARK_BATCH_MAX_ITEMS, benchmark3DMarkBatchPreviewFor } from "../benchmark-3dmark-batch";
import { import3DMarkResult, Benchmark3DMarkImportError } from "../benchmark-3dmark";
import { benchmarkSourceCheckBatchFor } from "../benchmark-source-check-batch";
import { appendBenchmarkSourceCheckHistory, readBenchmarkSourceCheckHistory } from "../benchmark-source-check-history";
import { requireAdminRequestOrigin } from "../origin-policy";
import { catalogSeedPreviewFor } from "../../shared/catalog-seed-preview";
import { catalogSeedCollectionQueueFor } from "../../shared/catalog-seed-collection-queue";
import { type Express } from "express";
import { priceRefreshSchedulerEnabled, priceRefreshScheduler, sendJsonWithEtag, routeParam, PART_REFRESH_COOLDOWN_MS, createRateLimitMiddleware, privateNoStore, savedBuildMonitorSchedulerStats, PartRefreshRouteError, refreshCatalogPartById } from "./route-support";

let catalogSeedMappingPreviewCache: { key: string; value: ReturnType<typeof catalogSeedMappingPreviewFor> } | undefined;
let catalogSeedMappingPreviewCacheEpoch = 0;
let catalogSeedMappingPreviewInFlight: { key: string; epoch: number; promise: Promise<ReturnType<typeof catalogSeedMappingPreviewFor>> } | undefined;

function safeRefreshResult(job: BackgroundJob) {
  if (!job.result) return null;
  const output: Record<string, unknown> = {};
  for (const key of ["attempted", "succeeded", "changed", "failed"] as const) {
    const value = job.result[key];
    if (Number.isSafeInteger(value) && Number(value) >= 0) output[key] = Number(value);
  }
  if (typeof job.result.dryRun === "boolean") output.dryRun = job.result.dryRun;
  if (job.result.skippedCode === "STALE_SCHEDULE_SLOT") output.skippedCode = "STALE_SCHEDULE_SLOT";
  for (const key of ["startedAt", "completedAt"] as const) {
    const value = job.result[key];
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) output[key] = new Date(value).toISOString();
  }
  return output;
}

function priceRefreshJobProjection(job: BackgroundJob | null) {
  if (!job || job.kind !== "price-refresh") return null;
  return {
    jobId: job.id,
    status: job.status,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    availableAt: job.availableAt,
    progress: job.progress,
    result: safeRefreshResult(job),
    error: job.error ? { code: job.error.code, retryable: job.error.retryable } : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt
  };
}

function boundedCrawlInteger(value: number, minimum: number, maximum: number) {
  return Number.isFinite(value) && Number.isInteger(value) && value >= minimum && value <= maximum;
}

const MAX_M2_OVERRIDE_BATCH_SIZE = 500;
const MAX_CRAWL_PAGES = 1_000;
const MAX_CRAWL_BATCH_SIZE = 1_000;
const MAX_CRAWL_DELAY_MS = 60_000;
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
const adminGamingPerformanceEvidenceRateLimit = createRateLimitMiddleware("admin-gaming-performance-evidence", { limit: 20, windowMs: 60_000 });
const adminEngineFiltersRateLimit = createRateLimitMiddleware("admin-engine-filters", { limit: 20, windowMs: 60_000 });
const catalogSpecSourceCheckJobs = new Map<string, Promise<import("../../shared/types").PhysicalSourceCheck>>();
const catalogSpecSourceCheckLastRunAt = new Map<string, number>();
const gpuPhysicalSourceCheckJobs = new Map<string, Promise<import("../../shared/types").PhysicalSourceCheck>>();
const gpuPhysicalSourceCheckLastRunAt = new Map<string, number>();
const benchmarkSourceCheckJobs = new Map<string, Promise<import("../../shared/types").PhysicalSourceCheck>>();
const benchmarkSourceCheckLastRunAt = new Map<string, number>();
const adminLoginRateLimit = createRateLimitMiddleware("admin-login", { limit: 10, windowMs: 60_000 });

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
  if (status === "stale") reasons.push("카탈로그 정보가 매핑 이후 갱신됨 / 재확인 필요");
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
    reviewReason: reasons.join(" / ")
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
    return { error: "filters의 카테고리/우선순위/작업 유형/정보 범위/검색어/offset/limit을 확인해 주세요." };
  }
  return { filters: { ...(category ? { category } : {}), ...(priority ? { priority } : {}), ...(action ? { action } : {}), ...(evidence ? { evidence } : {}), ...(query ? { query } : {}), ...(missingField ? { missingField } : {}), ...(offset !== undefined ? { offset } : {}), ...(limit !== undefined ? { limit } : {}) } };
}

function catalogSpecOverrideValidationCounts(validation: CatalogSpecOverrideBatchValidation) {
  return {
    validCount: validation.items.filter((item) => item.valid).length,
    invalidCount: validation.items.filter((item) => !item.valid).length
  };
}

function caseRgbLoadValidationCounts(validation: CaseRgbLoadOverrideBatchValidation) {
  return {
    validCount: validation.items.filter((item) => item.valid).length,
    invalidCount: validation.items.filter((item) => !item.valid).length,
    createCount: validation.items.filter((item) => item.operation === "create").length,
    updateCount: validation.items.filter((item) => item.operation === "update").length,
    unchangedCount: validation.items.filter((item) => item.operation === "unchanged").length
  };
}

function coolingFanLoadValidationCounts(validation: CoolingFanLoadOverrideBatchValidation) {
  return {
    validCount: validation.items.filter((item) => item.valid).length,
    invalidCount: validation.items.filter((item) => !item.valid).length,
    createCount: validation.items.filter((item) => item.operation === "create").length,
    updateCount: validation.items.filter((item) => item.operation === "update").length,
    unchangedCount: validation.items.filter((item) => item.operation === "unchanged").length
  };
}

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

function gpuPhysicalBatchValidationCounts(validation: ReturnType<typeof validateGpuPhysicalOverrideBatch>) {
  return {
    validCount: validation.items.filter((item) => item.valid).length,
    invalidCount: validation.items.filter((item) => !item.valid).length
  };
}

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

async function cachedCatalogSeedMappingPreview(catalog: Part[]) {
  const reviews = await readCatalogSeedMappingReviews();
  const catalogDataStamp = await catalogUpdatedAtFor(catalog);
  const key = JSON.stringify([currentCatalogRuntimeRevision(), catalogDataStamp, reviews]);
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

export function registerAdminRoutes(app: Express) {
app.get("/api/admin/meta", requireAdmin, async (request, response) => {
  const [meta, crawler, persistence] = await Promise.all([catalogMeta(), readCrawlStatus(), persistenceDiagnostics()]);
  sendJsonWithEtag(request, response, { ...meta, crawler: publicCrawlStatusFor(crawler as CrawlStatus), engineVersion: ENGINE_VERSION, storageMode: persistence.storageMode, persistence, adminAuthEnabled: adminAuthEnabled() }, undefined, false);
});

app.get("/api/admin/usage-events", requireAdmin, async (_request, response) => {
  response.json(await usageEventSummaryFor());
});

// 퍼널/리텐션/세부 지표 — usage_events 원시 로그를 기간별로 집계한다.
app.get("/api/admin/usage-analytics", requireAdmin, async (request, response) => {
  const rawDays = Number(request.query.days);
  const days = Number.isInteger(rawDays) ? rawDays : 30;
  response.json(await usageAnalyticsFor(days));
});

// 자동 구성 실패는 422 응답만으로는 원인을 알기 어렵다 — 최근 실패를 요청
// 조건/진단과 함께 관리자가 바로 조회할 수 있게 한다.
app.get("/api/admin/generation-failures", requireAdmin, (request, response) => {
  const rawLimit = Number(request.query.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 50;
  response.json({ failures: recentGenerationFailures(limit) });
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
    compatiblePartAssessmentCache: compatiblePartAssessmentCache.stats(),
    httpMetrics: httpMetricsSnapshot(),
    instance: {
      instanceId: INSTANCE_ID,
      eventBusReady: instanceEventBusReady(),
      memory: process.memoryUsage(),
      uptimeSeconds: Math.floor(process.uptime())
    }
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

app.get("/api/admin/prices/refresh/status", requireAdmin, async (request, response) => {
  if (request.query.jobId !== undefined && typeof request.query.jobId !== "string") {
    response.status(400).json({ error: "가격 갱신 작업 ID가 하나만 제공되어야 합니다.", code: "PRICE_REFRESH_JOB_ID_INVALID" });
    return;
  }
  const requestedId = typeof request.query.jobId === "string" ? request.query.jobId : undefined;
  if (requestedId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedId)) {
    response.status(400).json({ error: "가격 갱신 작업 ID가 올바르지 않습니다.", code: "PRICE_REFRESH_JOB_ID_INVALID" });
    return;
  }
  const job = requestedId
    ? await backgroundJobStore.getById(requestedId)
    : await backgroundJobStore.getLatestByKind("price-refresh");
  const projected = priceRefreshJobProjection(job);
  if (requestedId && !projected) {
    response.status(404).json({ error: "가격 갱신 작업을 찾을 수 없습니다.", code: "PRICE_REFRESH_JOB_NOT_FOUND" });
    return;
  }
  response.json({ enabled: priceRefreshSchedulerEnabled(), job: projected, servedPriceRefresh: stalePriceRefreshStatus() });
});

app.post("/api/admin/prices/refresh", requireAdmin, async (request, response) => {
  const conflict = async (error?: unknown) => {
    if (error instanceof Error && error.message.includes("다른 API 인스턴스")) {
      response.status(409).json({ error: error.message, code: "PRICE_REFRESH_RUNNING_ON_ANOTHER_INSTANCE" });
      return;
    }
    const current = await readPriceRefreshStatus();
    response.status(409).json({ error: error instanceof Error ? error.message : "가격 갱신 작업이 이미 실행 중입니다.", status: current });
  };
  if (priceRefreshScheduler.isRunning()) {
    await conflict();
    return;
  }
  const dryRun = request.body?.dryRun === true;
  const configuredLimits = priceRefreshOptionsFromEnv();
  const requestedLimit = (key: "coreLimit" | "accessoryLimit" | "delayMs", maximum: number) => {
    const value = request.body?.[key];
    if (value === undefined) return configuredLimits[key];
    if (!Number.isSafeInteger(value) || Number(value) < (dryRun ? 0 : 1) || Number(value) > maximum) return undefined;
    return Number(value);
  };
  const coreLimit = requestedLimit("coreLimit", 100);
  const accessoryLimit = requestedLimit("accessoryLimit", 1_000);
  const delayMs = requestedLimit("delayMs", 10_000);
  if (coreLimit === undefined || accessoryLimit === undefined || delayMs === undefined) {
    response.status(400).json({ error: "가격 갱신 제한 값이 허용 범위를 벗어났습니다.", code: "PRICE_REFRESH_LIMITS_INVALID" });
    return;
  }
  const limits = { ...configuredLimits, coreLimit, accessoryLimit, delayMs };
  const suppliedKey = request.header("Idempotency-Key");
  if (suppliedKey !== undefined && (suppliedKey.length < 1 || suppliedKey.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(suppliedKey))) {
    response.status(400).json({ error: "Idempotency-Key 헤더 형식이 올바르지 않습니다.", code: "IDEMPOTENCY_KEY_INVALID" });
    return;
  }
  const idempotencyKey = suppliedKey
    ? `price-refresh:manual:${createHash("sha256").update(suppliedKey).digest("hex")}`
    : undefined;
  let job: BackgroundJob;
  try {
    job = await backgroundJobStore.enqueue({
      kind: "price-refresh",
      payload: { ...limits, dryRun },
      ...(idempotencyKey ? { idempotencyKey } : { deduplicateActive: true })
    });
  } catch (error) {
    if (error instanceof BackgroundJobIdempotencyConflictError) {
      response.status(409).json({ error: "같은 Idempotency-Key가 다른 가격 갱신 조건에 이미 사용되었습니다.", code: "IDEMPOTENCY_KEY_REUSED" });
      return;
    }
    if (error instanceof BackgroundJobActiveConflictError) {
      const active = await backgroundJobStore.getActiveByKind("price-refresh");
      response.status(409).json({
        error: "다른 조건의 가격 갱신 작업이 이미 대기 중이거나 실행 중입니다.",
        code: "PRICE_REFRESH_ALREADY_ACTIVE",
        job: priceRefreshJobProjection(active)
      });
      return;
    }
    throw error;
  }
  const statusUrl = `/api/admin/prices/refresh/status?jobId=${encodeURIComponent(job.id)}`;
  response.status(202).json({ accepted: true, dryRun, limits, jobId: job.id, status: job.status, statusUrl });
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

// 크롤링 엔진 화면용 집계 응답 — 실행 중 상태/적용 엔진 파라미터/핵심/주변
// 부품 manifest를 한 번에 묶는다. 집계 자체는 crawler-engine 모듈이 담당한다.
app.get("/api/admin/crawl/engine", requireAdmin, async (_request, response) => {
  response.json(await crawlerEngineSnapshot());
});

// 세 엔진(크롤링/견적 생성/호환성 검사)의 운영 상태를 한 번에 묶는다.
app.get("/api/admin/engines", requireAdmin, async (_request, response) => {
  response.json(await engineModulesStatus());
});

// 견적 생성 엔진 옵션 — variants 우선순위 세트와 예산 사다리 배율을 관리자가
// 조정한다. 저장은 파일 기반 운영 아티팩트(data/engine-generation-options.json).
app.get("/api/admin/engine-options", requireAdmin, async (_request, response) => {
  const options = loadEngineGenerationOptions();
  const updatedAt = existsSync(engineGenerationOptionsPath()) ? await fileUpdatedAt(engineGenerationOptionsPath()) : null;
  response.json({ options, defaults: ENGINE_GENERATION_OPTION_DEFAULTS, updatedAt });
});

app.put("/api/admin/engine-options", adminCatalogCrawlRetryRateLimit, requireAdmin, async (request, response) => {
  const { options, errors } = normalizeEngineGenerationOptions(request.body);
  if (errors.length > 0) {
    response.status(400).json({ error: "견적 생성 옵션 형식이 올바르지 않습니다.", details: errors });
    return;
  }
  const saved = await saveEngineGenerationOptions(options);
  response.json({ options: saved.options, updatedAt: saved.updatedAt });
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
  const job = await startCatalogIngestionJob(() => runCrawlPageRetryJob({
    category,
    page,
    ...(expectedManifestStartedAt ? { expectedManifestStartedAt } : {}),
    details: request.body?.details !== false,
    delayMs: Number(process.env.DANAWA_CRAWL_DELAY_MS ?? 850),
    timeoutMs: Number(process.env.DANAWA_CRAWL_TIMEOUT_MS ?? 20000),
    retries: Number(process.env.DANAWA_CRAWL_RETRIES ?? 2)
  }));
  if (!job.started) {
    response.status(409).json({ error: CATALOG_INGESTION_BUSY_MESSAGE, code: "CRAWL_PAGE_RETRY_RUNNING" });
    return;
  }
  void job.completion.catch((error: unknown) => console.warn("카탈로그 페이지 재시도 실패", error));
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
  const job = await startCatalogIngestionJob(() => runCrawlPageRetryBatchJob({
    ...(expectedManifestStartedAt ? { expectedManifestStartedAt } : {}),
    details: request.body?.details !== false,
    delayMs: Number(process.env.DANAWA_CRAWL_DELAY_MS ?? 850),
    timeoutMs: Number(process.env.DANAWA_CRAWL_TIMEOUT_MS ?? 20000),
    retries: Number(process.env.DANAWA_CRAWL_RETRIES ?? 2)
  }));
  if (!job.started) {
    response.status(409).json({ error: CATALOG_INGESTION_BUSY_MESSAGE, code: "CRAWL_PAGE_RETRY_RUNNING" });
    return;
  }
  void job.completion.catch((error: unknown) => console.warn("실패 페이지 일괄 재시도 실패", error));
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
  clearCompatibilityEngineCaches();
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
  clearCompatibilityEngineCaches();
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
  clearCompatibilityEngineCaches();
  response.json({ deleted: true, accessoryId });
});

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

app.post("/api/admin/gpu-physical-overrides/batch/validate", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const validation = validateGpuPhysicalOverrideBatch(request.body, catalog, await readGpuPhysicalOverrides());
  const counts = gpuPhysicalBatchValidationCounts(validation);
  if (validation.errors.length > 0 && validation.items.length === 0) {
    response.status(400).json({ error: "GPU/케이스/PSU 물리 호환 override 일괄 입력 형식이 올바르지 않습니다.", details: validation.errors, ...counts, items: validation.items });
    return;
  }
  response.json({ ...counts, items: validation.items });
});

app.put("/api/admin/gpu-physical-overrides/batch", requireAdmin, async (request, response) => {
  const catalog = await loadCatalog();
  const validation = validateGpuPhysicalOverrideBatch(request.body, catalog, await readGpuPhysicalOverrides());
  const counts = gpuPhysicalBatchValidationCounts(validation);
  if (validation.errors.length > 0) {
    response.status(400).json({ saved: false, error: "GPU/케이스/PSU 물리 호환 override 일괄 저장을 중단했습니다. 오류가 있는 항목은 하나라도 저장하지 않습니다.", details: validation.errors, ...counts, items: validation.items });
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
    response.status(400).json({ error: "GPU/케이스/PSU 식별자가 필요합니다." });
    return;
  }
  const part = findPart(catalog, partId);
  if (!part || (part.category !== "gpu" && part.category !== "case" && part.category !== "psu")) {
    response.status(404).json({ error: "물리 호환 override를 등록할 GPU/케이스/PSU를 찾을 수 없습니다." });
    return;
  }
  const validation = validateGpuPhysicalOverride(part, request.body);
  if (validation.errors.length > 0 || !validation.value) {
    response.status(400).json({ error: "GPU/케이스/PSU 물리 호환 override 형식이 올바르지 않습니다.", details: validation.errors });
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
    response.status(404).json({ error: "장착 정보를 점검할 GPU/케이스/PSU를 찾을 수 없습니다." });
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
    response.status(404).json({ error: "정보 점검 이력을 조회할 GPU/케이스/PSU를 찾을 수 없습니다." });
    return;
  }
  const requestedLimit = Number(request.query.limit ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.min(20, Math.max(1, Math.floor(requestedLimit))) : 20;
  response.json({ partId, entries: await readPhysicalSourceCheckHistory(partId, limit) });
});

app.delete("/api/admin/gpu-physical-overrides/:partId", requireAdmin, async (request, response) => {
  const partId = routeParam(request.params.partId);
  if (!partId) {
    response.status(400).json({ error: "GPU/케이스/PSU 식별자가 필요합니다." });
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

app.get("/api/admin/gaming-performance-evidence", requireAdmin, async (_request, response) => {
  const path = gamingPerformanceEvidencePath();
  const items = loadGamingPerformanceEvidence();
  response.json({
    items,
    count: items.length,
    pathConfigured: Boolean(process.env.GAMING_PERFORMANCE_EVIDENCE_PATH?.trim()),
    ...(existsSync(path) ? { updatedAt: await fileUpdatedAt(path) } : {})
  });
});

app.post("/api/admin/gaming-performance-evidence/validate", adminGamingPerformanceEvidenceRateLimit, requireAdmin, async (request, response) => {
  const validation = gamingPerformanceEvidenceBatchValidationFor(request.body);
  response.json(validation);
});

app.put("/api/admin/gaming-performance-evidence", adminGamingPerformanceEvidenceRateLimit, requireAdmin, async (request, response) => {
  const validation = gamingPerformanceEvidenceBatchValidationFor(request.body);
  if (!validation.valid) {
    response.status(400).json({ saved: false, error: "FPS 자료 저장을 중단했습니다. 오류가 있는 항목은 하나라도 저장하지 않습니다.", ...validation });
    return;
  }
  const items = await saveGamingPerformanceEvidence(validation.records);
  response.json({ saved: true, count: items.length, items, updatedAt: await fileUpdatedAt(gamingPerformanceEvidencePath()) });
});

// 자동 견적 생성기의 카탈로그 타겟 필터 — 범주별로 허용 브랜드/스펙 값/수치
// 범위/가격대를 관리자가 지정하면 추천 후보 풀에 들어가기 전에 부품을 걸러낸다.
// 설정 파일을 저장하면 다음 추천 요청부터 같은 기준이 적용된다.
app.get("/api/admin/engine-filters", requireAdmin, async (_request, response) => {
  const config = loadEngineTargetFiltersConfig();
  const catalog = await loadCatalog();
  const path = engineTargetFiltersPath();
  const generationDepth = loadEngineGenerationOptions().generationDepth;
  response.json({
    config,
    summary: engineTargetFilterSummaryFor(catalog, config),
    // 크롤러가 수집한 카탈로그에서 계산된 라인별 세대 경계 — 신세대 상품이
    // 판매 중으로 쌓이면 자동으로 올라간다. generationDepth=0이면 게이트 꺼짐.
    generations: generationDepth === 0 ? [] : quoteGenerationSummaryFor(catalog, generationDepth),
    generationGate: { enabled: generationDepth !== 0, depth: generationDepth },
    pathConfigured: Boolean(process.env.ENGINE_TARGET_FILTERS_PATH?.trim()),
    ...(existsSync(path) ? { updatedAt: await fileUpdatedAt(path) } : {})
  });
});

app.get("/api/admin/engine-filters/facets", requireAdmin, async (_request, response) => {
  response.json({ generatedAt: new Date().toISOString(), categories: engineTargetFilterFacetOptionsFor(await loadCatalog()) });
});

app.post("/api/admin/engine-filters/preview", adminEngineFiltersRateLimit, requireAdmin, async (request, response) => {
  const parsed = normalizeEngineTargetFiltersInput(request.body);
  if (!parsed.valid) {
    response.status(400).json({ error: "견적 필터 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  response.json({ config: parsed.config, summary: engineTargetFilterSummaryFor(await loadCatalog(), parsed.config) });
});

app.put("/api/admin/engine-filters", adminEngineFiltersRateLimit, requireAdmin, async (request, response) => {
  const parsed = normalizeEngineTargetFiltersInput(request.body);
  if (!parsed.valid) {
    response.status(400).json({ saved: false, error: "견적 필터 저장을 중단했습니다. 오류가 있는 조건은 하나라도 반영하지 않습니다.", details: parsed.errors });
    return;
  }
  const saved = await saveEngineTargetFiltersConfig(parsed.config);
  response.json({ saved: true, config: saved.config, updatedAt: saved.updatedAt, summary: engineTargetFilterSummaryFor(await loadCatalog(), saved.config) });
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
    .map((partId) => ({ partId, reason: "저장된 HTTPS 벤치마크 정보 URL이 없거나 현재 CPU/GPU 카탈로그와 일치하지 않습니다." }));
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
    response.status(404).json({ error: "벤치마크 출처를 확인할 CPU/GPU를 찾을 수 없습니다." });
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
    response.status(404).json({ error: "벤치마크 출처 확인 이력을 조회할 CPU/GPU를 찾을 수 없습니다." });
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

app.get("/api/admin/session", privateNoStore, (request, response) => {
  response.json(adminSession(request));
});

app.post("/api/admin/login", privateNoStore, requireAdminRequestOrigin, adminLoginRateLimit, (request, response) => {
  loginAdmin(request, response);
});

app.post("/api/admin/logout", privateNoStore, requireAdminRequestOrigin, (request, response) => {
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
    response.status(404).json({ error: "현재 catalog에서 해당 다나와 상품 코드를 찾지 못했습니다. 먼저 해당 상품의 목록/상세 수집을 실행해 주세요.", code: "CATALOG_SEED_MAPPING_SOURCE_NOT_COLLECTED" });
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
  const job = await startCatalogIngestionJob(() => runCrawlJob({ ...(resumeCategory ? { category: resumeCategory } : {}), pages, limitPerCategory, details, all, ...(resume ? { resume: true } : {}) }));
  if (!job.started) {
    response.status(409).json({ error: CATALOG_INGESTION_BUSY_MESSAGE, code: "CRAWL_RUNNING" });
    return;
  }
  void job.completion.catch((error: unknown) => console.warn("카탈로그 수집 실패", error));
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
  const job = await startCatalogIngestionJob(() => runAccessoryCrawlJob({ category, pages, limitPerCategory, offset, onlyIncomplete, details, all, delayMs, dryRun }));
  if (!job.started) {
    response.status(409).json({ error: CATALOG_INGESTION_BUSY_MESSAGE, code: "ACCESSORY_CRAWL_RUNNING" });
    return;
  }
  void job.completion.catch((error: unknown) => console.warn("주변 부품 카탈로그 수집 실패", error));
  response.status(202).json({ message: "주변 부품 카탈로그 갱신을 시작했습니다." });
});
}
