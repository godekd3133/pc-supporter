// Helpers shared by several route modules and the server entrypoint.
import { startPriceRefreshScheduler } from "../price-refresh-scheduler";
import { withCatalogIngestionLease as executeCatalogIngestionJob, CatalogIngestionBusyError } from "../catalog-ingestion-coordinator";
import { runPriceRefreshJob } from "../price-refresh";
import { type Request, type Response, type RequestHandler } from "express";
import { adminAuthEnabled, isAdminAuthenticated } from "../auth";
import { type BuildSelection, type Part, type RecommendationPreferences, type CompatibilityResult, type PartRefreshResponse } from "../../shared/types";
import { loadAccessories } from "../accessories";
import { evaluateBuildWithAccessories as evaluateBuildWithSharedDomain } from "../../shared/domain/compatibility-evaluator";
import { loadGamingPerformanceEvidence } from "../gaming-performance-evidence";
import { gamingTargetAssessmentForBuild } from "../../shared/gaming-target-build";
import { loadGamingFpsReferences } from "../gaming-fps-reference";
import { gamingTierAssessmentFor } from "../../shared/gaming-part-tiers";
import { checkedPartPriceSnapshotFor } from "../../shared/checked-part-price-snapshot";
import { publicApiPayloadProjection } from "../public-api-projection";
import { entityTagFor, ifNoneMatchMatches } from "../http-cache";
import { type RateLimitPolicy, createRateLimitMiddleware as createBaseRateLimitMiddleware } from "../rate-limit";
import { consumeRateLimitWindow, readSavedBuilds, updateSavedBuildMonitorState, createOwnerShareSession, ownerShareSessionIsActive, deleteOwnerShareSession, pruneExpiredOwnerShareSessions, pruneExpiredOwnerShareSessionGrants, upsertOwnerShareSessionGrant, ownerShareSessionGrantMatches, listOwnerShareSessionGrants } from "../repository";
import { BUILD_INPUT_MAX_SELECTIONS_PER_LIST, BUILD_INPUT_MAX_ID_LENGTH, BUILD_INPUT_MAX_M2_SLOTS } from "../../shared/build-input-limits";
import { loadCatalog, findPart, upsertCatalog } from "../catalog";
import { loadCatalogSnapshot } from "../catalog-snapshot";
import { type SavedBuildRecord } from "../build-share";
import { parseRecommendationPreferences } from "../../shared/domain/build-input";
import { savedBuildCheckPreviewCacheKey, savedBuildCheckPreviewCache } from "../saved-build-check-cache";
import { ENGINE_VERSION } from "../../shared/domain/engine";
import { savedBuildCheckSnapshotFor as compactSavedBuildCheckSnapshotFor } from "../../shared/saved-build-check";
import { completeSavedBuildMonitorRun, savedBuildMonitorAlertAllowed, failSavedBuildMonitorRun } from "../../shared/saved-build-monitor-subscription";
import { savedBuildAlternativeAlertsFor } from "../saved-build-alternatives";
import { mergeSavedBuildMonitorAlerts } from "../../shared/saved-build-monitor-alerts";
import { partRefreshBlockReason, refreshDanawaPart, partRefreshResponse } from "../part-refresh";
import { appendCatalogChangeRecord, catalogChangeRecord } from "../catalog-change-log";
import { type OwnerSessionResourceType } from "../../shared/owner-session-contract";
import { type OwnerSessionResource, ownerSessionOrLegacyTokenOrAdminCanManage, attachOwnerSessionGrant } from "../owner-session-routes";

export function priceRefreshSchedulerEnabled() {
  return process.env.PRICE_REFRESH_SCHEDULER_ENABLED === "true"
    || process.env.PRICE_REFRESH_SCHEDULER_ENABLED !== "false" && process.env.NODE_ENV === "production";
}

export const priceRefreshScheduler = startPriceRefreshScheduler({
  run: (options) => executeCatalogIngestionJob(() => runPriceRefreshJob(options))
});

export function requestCanViewAdminMeta(request: Request) {
  return adminAuthEnabled() && isAdminAuthenticated(request);
}

export function evaluateBuildWithAccessories(
  build: BuildSelection,
  catalog: Part[],
  accessories: Awaited<ReturnType<typeof loadAccessories>>,
  catalogSnapshotAt: string,
  recommendationPreferences: RecommendationPreferences,
  includeSuggestions = true
): CompatibilityResult {
  const result = evaluateBuildWithSharedDomain(build, catalog, accessories, {
    catalogSnapshotAt,
    recommendationPreferences,
    gamingPerformanceEvidence: loadGamingPerformanceEvidence(),
    includeSuggestions,
    now: new Date().toISOString()
  });
  const gamingTargetAssessment = gamingTargetAssessmentForBuild(build, catalog, recommendationPreferences, loadGamingFpsReferences());
  const selected = Object.fromEntries(catalog.filter((part) => Object.values(build).flat().some((item) => item && typeof item === "object" && "partId" in item && item.partId === part.id)).map((part) => [part.category, part]));
  const tierAssessment = recommendationPreferences.gamingMode ? gamingTierAssessmentFor(selected, { memoryCapacityGb: 16, actualMemoryCapacityGb: build.memory.reduce((sum, item) => sum + (catalog.find((part) => part.id === item.partId)?.specs.capacityGb ?? 0) * item.quantity, 0), actualMemoryModuleCount: build.memory.every((item) => catalog.find((part) => part.id === item.partId)?.specs.memoryModuleCountPerKit !== undefined) ? build.memory.reduce((sum,item) => sum+(catalog.find((part) => part.id === item.partId)!.specs.memoryModuleCountPerKit!) * item.quantity,0) : undefined, memoryQuantity: build.memory.reduce((sum,item) => sum+item.quantity,0), hddCount: build.hdd.reduce((sum,item) => sum+item.quantity,0) }) : undefined;
  return { ...result, partPriceSnapshot: checkedPartPriceSnapshotFor(build, catalog), ...(gamingTargetAssessment ? { gamingTargetAssessment } : {}), ...(tierAssessment ? { gamingSupportRequirements: tierAssessment.requirements, partTierSuitability: tierAssessment.categories } : {}) };
}

export function sendJsonWithEtag(request: Request, response: Response, payload: unknown, lastModified?: string, projectPublicPayload = true) {
  const projectedPayload = projectPublicPayload ? publicApiPayloadProjection(payload) : payload;
  const entityTag = entityTagFor(projectedPayload);
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
  response.json(projectedPayload);
}

export function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
export const PART_REFRESH_COOLDOWN_MS = 15_000;
export const partRefreshJobs = new Map<string, Promise<PartRefreshResponse>>();
export const partRefreshLastRunAt = new Map<string, number>();
export const configuredRateLimitScale = Number(process.env.PC_SUPPORTER_RATE_LIMIT_SCALE ?? "1");
export const rateLimitScale = Number.isFinite(configuredRateLimitScale) && configuredRateLimitScale > 0 ? configuredRateLimitScale : 1;
export const scaledRateLimitPolicy = (policy: RateLimitPolicy): RateLimitPolicy => rateLimitScale === 1 ? policy : { limit: Math.max(1, Math.ceil(policy.limit * rateLimitScale)), windowMs: policy.windowMs };
export const createRateLimitMiddleware = (name: string, policy: RateLimitPolicy) => createBaseRateLimitMiddleware(name, scaledRateLimitPolicy(policy), { consume: consumeRateLimitWindow });
export const privateNoStore: RequestHandler = (_request, response, next) => {
  response.setHeader("Cache-Control", "private, no-store");
  next();
};
export const publicCompatibilityRateLimit = createRateLimitMiddleware("public-compatibility", { limit: 60, windowMs: 60_000 });

export const MAX_BUILD_SELECTIONS_PER_LIST = BUILD_INPUT_MAX_SELECTIONS_PER_LIST;
export const MAX_BUILD_ID_LENGTH = BUILD_INPUT_MAX_ID_LENGTH;
export const MAX_BUILD_M2_SLOTS = BUILD_INPUT_MAX_M2_SLOTS;

export async function loadBuilds() {
  return readSavedBuilds();
}

export type SavedBuildMonitorResources = {
  catalog: Awaited<ReturnType<typeof loadCatalog>>;
  accessories: Awaited<ReturnType<typeof loadAccessories>>;
  catalogSnapshotAt: string;
  accessoryUpdatedAt: string;
  catalogRevision: number;
};

export async function loadSavedBuildMonitorResources(): Promise<SavedBuildMonitorResources> {
  const snapshot = await loadCatalogSnapshot();
  return { catalog: snapshot.catalog, accessories: snapshot.accessories, catalogSnapshotAt: snapshot.catalogUpdatedAt, accessoryUpdatedAt: snapshot.accessoryUpdatedAt, catalogRevision: snapshot.catalogRevision };
}

export async function savedBuildCheckSnapshotForResources(build: SavedBuildRecord, resources: SavedBuildMonitorResources) {
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

export async function performSavedBuildMonitorRun(build: SavedBuildRecord, resources?: SavedBuildMonitorResources, checkedAt = new Date().toISOString()) {
  try {
    const source = resources ?? await loadSavedBuildMonitorResources();
    const snapshot = (await savedBuildCheckSnapshotForResources(build, source)).value;
    const monitorState = completeSavedBuildMonitorRun(build, build.monitorState, snapshot, snapshot.checkedAt, build.checkSnapshot);
    const updated = await updateSavedBuildMonitorState(build.id, monitorState);
    if (!updated) throw new Error("저장 견적이 점검 중 삭제되었습니다.");
    // 서버 점검을 사용하는 저장 견적은 대안 감시도 수행 — 벤치 근거가 있는 cpu/gpu에서 더 나은 조건의 후보가 카탈로그에 들어오면 알림을 남긴다.
    if (updated.monitorState) {
      const base = updated.monitorState;
      const alternatives = savedBuildAlternativeAlertsFor(updated, source.catalog, snapshot.checkedAt)
        .filter((alert) => savedBuildMonitorAlertAllowed(base.alertPolicy, alert.kind));
      if (alternatives.length > 0) {
        const merged = { ...base, alerts: mergeSavedBuildMonitorAlerts(base.alerts, alternatives), updatedAt: snapshot.checkedAt };
        return await updateSavedBuildMonitorState(build.id, merged) ?? updated;
      }
    }
    return updated;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "저장 견적 자동 점검에 실패했습니다.";
    const failedState = failSavedBuildMonitorRun(build.monitorState, message, checkedAt, build);
    await updateSavedBuildMonitorState(build.id, failedState).catch(() => undefined);
    throw error;
  }
}

export const savedBuildMonitorRunJobs = new Map<string, Promise<SavedBuildRecord>>();

export async function executeSavedBuildMonitorRun(build: SavedBuildRecord, resources?: SavedBuildMonitorResources, checkedAt = new Date().toISOString()) {
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
export const savedBuildMonitorSchedulerStats: {
  lastAttemptedAt?: string;
  lastAcquiredAt?: string;
  lastSkippedAt?: string;
  lastFinishedAt?: string;
  lastBackend?: "postgres";
  lastProcessedCount: number;
  skippedCount: number;
  lastError?: string;
} = { lastProcessedCount: 0, skippedCount: 0 };

export class PartRefreshRouteError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "PartRefreshRouteError";
  }
}

export async function refreshCatalogPartById(partId: string) {
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
  const job = executeCatalogIngestionJob(async () => {
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
  }).catch((error: unknown) => {
    if (error instanceof CatalogIngestionBusyError) throw new PartRefreshRouteError(409, "PART_REFRESH_RUNNING", error.message);
    throw error;
  });
  partRefreshJobs.set(partId, job);
  try {
    const result = await job;
    partRefreshLastRunAt.set(partId, Date.now());
    return result;
  } finally {
    if (partRefreshJobs.get(partId) === job) partRefreshJobs.delete(partId);
  }
}

export async function ownerShareCanManageRequest(
  request: Request,
  resourceType: OwnerSessionResourceType,
  resource: OwnerSessionResource,
  ownerToken: string | undefined,
  allowAdmin = true
) {
  return ownerSessionOrLegacyTokenOrAdminCanManage(
    request,
    resourceType,
    resource,
    ownerToken,
    adminAuthEnabled(),
    isAdminAuthenticated(request),
    ownerSessionStoreApi,
    allowAdmin
  );
}

export const ownerSessionStoreApi = {
  createOwnerShareSession,
  ownerShareSessionIsActive,
  deleteOwnerShareSession,
  pruneExpiredOwnerShareSessions,
  pruneExpiredOwnerShareSessionGrants,
  upsertOwnerShareSessionGrant,
  ownerShareSessionGrantMatches,
  listOwnerShareSessionGrants
};

export async function persistOwnerShareResource<T extends OwnerSessionResource>(
  request: Request,
  response: Response,
  resourceType: OwnerSessionResourceType,
  resource: T,
  persist: () => Promise<T>,
  rollback: () => Promise<unknown>
) {
  const persisted = await persist();
  const ownerManaged = await attachOwnerSessionGrant(request, response, resourceType, resource, ownerSessionStoreApi, rollback);
  if (ownerManaged === undefined) return undefined;
  return { persisted, ownerManaged };
}
