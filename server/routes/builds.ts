import { type BuildSelection, type RecommendationPreferences, PART_CATEGORIES, type CatalogChangeRecord, type DataQuality, type Part, type AccessoryItem, type BuildGenerationRequest, type BuildGenerationVariantResult, type PartCategory } from "../../shared/types";
import { type CatalogRefreshReport, catalogRefreshReportFromUnknown } from "../../shared/catalog-refresh-report";
import { buildCompatibilityInputFingerprint } from "../../shared/build-fingerprint";
import { type SavedBuildRecord, createShareOwnerCredential, createShareRecoveryCode, normalizeShareRecoveryCode, shareRecoveryCodeMatches } from "../build-share";
import { savedBuildPresentationsFor, loadSavedBuildPresentationContext, savedBuildPresentationFor } from "../saved-build-presentation";
import { type SavedBuildMonitorSubscriptionResponse, defaultSavedBuildMonitorSubscription, parseSavedBuildMonitorAlertIds, updateSavedBuildMonitorAlertState, configureSavedBuildMonitorSubscription, parseSavedBuildMonitorSettings } from "../../shared/saved-build-monitor-subscription";
import { readCatalogChangeLog } from "../catalog-change-log";
import { loadAccessories } from "../accessories";
import { loadGamingPerformanceEvidence } from "../gaming-performance-evidence";
import { loadEngineTargetFiltersConfig } from "../engine-target-filters";
import { engineGenerationVariantPrioritiesFor, loadEngineGenerationOptions, quotationEngineFloorFor, engineGenerationLadderMultipliersFor } from "../engines/quotation-engine";
import { generateBuildDraft, BuildGenerationError, buildGenerationRecoveryOptionsFor } from "../../shared/domain/engine";
import { loadGamingFpsReferences } from "../gaming-fps-reference";
import { noteStaleServedPrices } from "../stale-price-refresh";
import { trackUsageEvent } from "../usage-events";
import { recordGenerationFailure } from "../generation-failure-log";
import { type Request, type Response, type Express } from "express";
import { readSavedWatchlists, updateSavedWatchlistAlertStates, updateSavedBuildMonitorState, readSavedBuilds, appendSavedBuild, deleteSavedBuild, appendSavedWatchlist, deleteSavedWatchlist, appendSavedComparison, deleteSavedComparison, readSavedComparisons, deleteOwnerShareSessionGrantsForResource, appendSavedBuildVersionComparison, deleteSavedBuildVersionComparison, readSavedBuildVersionComparisons, updateSavedWatchlist, readSavedWatchlistAlertStates, deleteSavedWatchlistAlertStates, updateSavedBuildMetadata, updateSavedBuildMyPc, updateSavedBuildPurchaseProgress, updateSavedBuildPurchasePriceHistory, restoreSavedBuildPurchasePriceHistory, restoreSavedBuildPurchaseProgress, appendSavedBuildCheck, updateSavedBuildAssemblyVerification, updateSavedBuildShareCredentials } from "../repository";
import { savedCatalogWatchlistExpired, parseSavedCatalogWatchlistInput, DEFAULT_SAVED_WATCHLIST_ALERT_PREFERENCES, parseSavedCatalogWatchlistUpdateInput, savedWatchlistAlertPreferencesFor } from "../watchlist-store";
import { parseSavedWatchlistAlertIds } from "../watchlist-alert-state";
import { savedWatchlistAlertsFor, type SavedWatchlistAlert } from "../watchlist-alerts";
import { shareExpired, shareExpiryDaysFrom, shareExpiryValueProvided, shareExpiresAtFor } from "../share-lifecycle";
import { eul } from "../../shared/josa";
import { parsePublicPriceHistoryIds, parsePublicPriceHistoryWindow } from "../public-price-history";
import { catalogChangePriceHistoryFor, catalogChangePriceHistoryWithinWindowFor, catalogChangePriceWindowSummaryFor } from "../../shared/catalog-change-analytics";
import { parseBuildGenerationRequest, parseBuild, parseRecommendationPreferences } from "../../shared/domain/build-input";
import { loadCatalog } from "../catalog";
import { ADJUSTABLE_CATEGORIES, suggestPartAdjustment } from "../../shared/part-adjustment";
import { budgetLadderScenariosFor } from "../../shared/budget-ladder";
import { savedBuildDecisionNoteFromUnknown, SAVED_BUILD_DECISION_NOTE_MAX_LENGTH, savedBuildNameFromUnknown, SAVED_BUILD_NAME_MAX_LENGTH } from "../../shared/saved-build-decision-note";
import { savedBuildOriginFromUnknown } from "../../shared/saved-build-origin";
import { loadCatalogSnapshot } from "../catalog-snapshot";
import { validateBuildSelection } from "../build-validation";
import { randomUUID } from "node:crypto";
import { savedBuildVersionGroupIdFor } from "../../shared/saved-build-version";
import { savedBuildCheckSnapshotFor as compactSavedBuildCheckSnapshotFor, savedBuildCheckTransitionSummaryFor } from "../../shared/saved-build-check";
import { ownerManagedShareResponse, ownerSessionModeRequested, attachOwnerSessionGrant } from "../owner-session-routes";
import { type SavedCatalogWatchlistRecord, publicSavedCatalogWatchlist } from "../watchlist-share";
import { parseAlternativeComparisonInput, alternativeComparisonExpiresAtFor, type SavedAlternativeComparisonRecord, publicAlternativeComparison, alternativeComparisonExpired } from "../comparison-share";
import { parseSavedBuildVersionComparisonShareInput, savedBuildVersionComparisonSharePayloadFor, savedBuildVersionComparisonShareExpiresAtFor, type SavedBuildVersionComparisonShareRecord, publicSavedBuildVersionComparisonShare, savedBuildVersionComparisonShareExpired } from "../../shared/saved-build-version-share";
import { savedBuildVersionComparisonExportFor, savedBuildVersionComparisonTextFor } from "../../shared/saved-build-version-export";
import { isAdminAuthenticated } from "../auth";
import { parseSavedBuildMonitorRequest } from "../build-monitor";
import { type SavedBuildMonitorItem, type SavedBuildMonitorResponse } from "../../shared/saved-build-monitor";
import { parseSavedBuildPurchaseProgressExpectedRevision, parseSavedBuildPurchaseProgress, parseSavedBuildPurchaseProgressRevision } from "../purchase-progress";
import { parseSavedBuildPurchasePriceHistoryExpectedRevision, parseSavedBuildPurchasePriceHistory, parseSavedBuildPurchasePriceHistoryRevision } from "../purchase-price-history";
import { parseAssemblyVerificationHistoryJson, assemblyVerificationSavedHistoryFor } from "../../shared/assembly-verification";
import { savedBuildCatalogChangeCausesFor } from "../../shared/saved-build-change-causes";
import { evaluateBuildWithAccessories, sendJsonWithEtag, routeParam, createRateLimitMiddleware, privateNoStore, publicCompatibilityRateLimit, loadBuilds, loadSavedBuildMonitorResources, savedBuildCheckSnapshotForResources, executeSavedBuildMonitorRun, ownerShareCanManageRequest, ownerSessionStoreApi, persistOwnerShareResource } from "./route-support";

function catalogRefreshReportForRequest(value: unknown, build: BuildSelection, preferences: RecommendationPreferences): { report?: CatalogRefreshReport; error?: string } {
  if (value === undefined) return {};
  const report = catalogRefreshReportFromUnknown(value);
  if (!report) return { error: "정보 다시 확인 보고서 형식이 올바르지 않습니다." };
  const expectedFingerprint = buildCompatibilityInputFingerprint(build, preferences);
  if (report.inputFingerprint !== expectedFingerprint) return { error: "정보 다시 확인 보고서가 현재 견적/추천 기준과 일치하지 않습니다." };
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
const buildCreateRateLimit = createRateLimitMiddleware("build-create", { limit: 20, windowMs: 60_000 });
const buildShareRateLimit = createRateLimitMiddleware("build-share", { limit: 120, windowMs: 60_000 });
const buildRecoverRateLimit = createRateLimitMiddleware("build-recover", { limit: 10, windowMs: 60_000 });
const buildListRateLimit = createRateLimitMiddleware("build-list", { limit: 120, windowMs: 60_000 });
const buildMonitorRateLimit = createRateLimitMiddleware("build-monitor", { limit: 20, windowMs: 60_000 });
const publicRecommendationRateLimit = createRateLimitMiddleware("public-recommendation", { limit: 20, windowMs: 60_000 });
const watchlistCreateRateLimit = createRateLimitMiddleware("watchlist-create", { limit: 10, windowMs: 60_000 });
const watchlistShareRateLimit = createRateLimitMiddleware("watchlist-share", { limit: 120, windowMs: 60_000 });
const watchlistUpdateRateLimit = createRateLimitMiddleware("watchlist-update", { limit: 30, windowMs: 60_000 });
const watchlistAlertRateLimit = createRateLimitMiddleware("watchlist-alert", { limit: 60, windowMs: 60_000 });
const publicPriceHistoryRateLimit = createRateLimitMiddleware("public-price-history", { limit: 60, windowMs: 60_000 });
const comparisonCreateRateLimit = createRateLimitMiddleware("comparison-create", { limit: 10, windowMs: 60_000 });
const comparisonShareRateLimit = createRateLimitMiddleware("comparison-share", { limit: 120, windowMs: 60_000 });
const versionComparisonCreateRateLimit = createRateLimitMiddleware("version-comparison-create", { limit: 10, windowMs: 60_000 });
const versionComparisonShareRateLimit = createRateLimitMiddleware("version-comparison-share", { limit: 120, windowMs: 60_000 });

async function addSavedBuildSummaries(builds: SavedBuildRecord[]) {
  return savedBuildPresentationsFor(builds, await loadSavedBuildPresentationContext());
}

function savedBuildMonitorResponseFor(build: SavedBuildRecord): SavedBuildMonitorSubscriptionResponse {
  return {
    buildId: build.id,
    buildName: build.name,
    subscription: build.monitorState ?? defaultSavedBuildMonitorSubscription(build.createdAt)
  };
}

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

async function servedItemsFor(selection: BuildSelection, catalog: Part[]): Promise<(Part | AccessoryItem)[]> {
  const byId = new Map(catalog.map((part) => [part.id, part]));
  const parts = PART_CATEGORIES.flatMap((category) => {
    if (category === "memory" || category === "ssd" || category === "hdd") return selection[category].map((entry) => entry.partId);
    const entry = selection[category];
    return entry ? [entry.partId] : [];
  }).map((id) => byId.get(id)).filter((part): part is Part => part !== undefined);
  const accessoryIds = (selection.accessories ?? []).map((entry) => entry.accessoryId);
  if (accessoryIds.length === 0) return parts;
  const accessoryById = new Map((await loadAccessories()).map((item) => [item.id, item]));
  return [...parts, ...accessoryIds.map((id) => accessoryById.get(id)).filter((item): item is AccessoryItem => item !== undefined)];
}

function buildGenerationVariantResultsFor(catalog: Part[], request: BuildGenerationRequest, requestId?: string): BuildGenerationVariantResult[] {
  const gamingPerformanceEvidence = loadGamingPerformanceEvidence();
  const targetFilters = loadEngineTargetFiltersConfig();
  return engineGenerationVariantPrioritiesFor().map((priority) => {
    try {
      const draft = generateBuildDraft(catalog, { ...request, priority }, gamingPerformanceEvidence, { targetFilters, gamingTestbedPhase1: request.gamingTestbedPhase1, gamingFpsReferences: loadGamingFpsReferences() });
      void servedItemsFor(draft.selection, catalog).then(noteStaleServedPrices).catch(() => undefined);
      return { priority, draft };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "이 기준의 자동 구성을 만들지 못했습니다.";
      const diagnostics = error instanceof BuildGenerationError ? error.diagnostics : [];
      trackUsageEvent("recommend_failed", { path: "/api/builds/recommend/variants" });
      recordGenerationFailure({
        route: "/api/builds/recommend/variants",
        statusCode: 200,
        error,
        request: { ...request, priority },
        diagnostics,
        requestId,
        context: `variant:${priority}`
      });
      return { priority, error: message, ...(diagnostics.length > 0 ? { diagnostics } : {}) };
    }
  });
}

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
  if (!await ownerShareCanManageRequest(request, "watchlist", watchlist, ownerToken)) {
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
  if (!await ownerShareCanManageRequest(request, "build", build, ownerToken)) {
    response.status(401).json({ error: options.unauthorizedMessage ?? `${eul(options.action ?? "서버 백그라운드 점검")} 관리하려면 견적 소유자 인증이 필요합니다.`, code: "SHARE_OWNER_AUTH_REQUIRED" });
    return undefined;
  }
  return build;
}

async function ownedSavedBuildForRequest(request: Request, response: Response, action = "서버 백그라운드 점검", unauthorizedMessage?: string) {
  return savedBuildForRequest(request, response, { requireOwner: true, action, unauthorizedMessage });
}

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

export function registerBuildsRoutes(app: Express) {
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

app.post("/api/builds/recommend", publicRecommendationRateLimit, async (request, response) => {
  const parsed = parseBuildGenerationRequest(request.body);
  if (parsed.errors.length > 0 || !parsed.request) {
    response.status(400).json({ error: "자동 견적 요청 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  let catalog: Part[] | undefined;
  try {
    catalog = await loadCatalog();
    // 관리자 generationDepth(세대 게이트) 설정은 프로세스 전역에 반영되므로
    // 요청마다 로드해 재시작 후에도 저장값과 맞춘다.
    loadEngineGenerationOptions();
    trackUsageEvent("recommend", { path: "/api/builds/recommend" });
    const draft = generateBuildDraft(catalog, parsed.request, loadGamingPerformanceEvidence(), { targetFilters: loadEngineTargetFiltersConfig(), gamingTestbedPhase1: parsed.request.gamingTestbedPhase1, gamingFpsReferences: loadGamingFpsReferences() });
    noteStaleServedPrices(await servedItemsFor(draft.selection, catalog));
    response.json(draft);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "현재 데이터로 자동 견적을 생성하지 못했습니다.";
    const recoveryOptions = catalog ? buildGenerationRecoveryOptionsFor(catalog, parsed.request, { targetFilters: loadEngineTargetFiltersConfig(), gamingFpsReferences: loadGamingFpsReferences() }) : [];
    const diagnostics = error instanceof BuildGenerationError ? error.diagnostics : [];
    trackUsageEvent("recommend_failed", { path: "/api/builds/recommend" });
    recordGenerationFailure({
      route: "/api/builds/recommend",
      statusCode: 422,
      error,
      request: parsed.request,
      diagnostics,
      recoveryOptionIds: recoveryOptions.map((option) => option.id),
      requestId: response.locals.requestId as string | undefined
    });
    response.status(422).json({ error: message, ...(diagnostics.length > 0 ? { diagnostics } : {}), ...(recoveryOptions.length > 0 ? { recoveryOptions } : {}) });
  }
});

// 결과 화면 +/− 버튼: 특정 카테고리 부품을 한 단계 강화/약화한 호환 대안을 제안한다.
app.post("/api/builds/adjust", publicCompatibilityRateLimit, async (request, response) => {
  const parsed = parseBuild(request.body?.build ?? request.body?.selection ?? request.body);
  if (parsed.errors.length > 0) {
    response.status(400).json({ error: "견적 입력 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  const category = request.body?.category;
  const direction = request.body?.direction;
  if (typeof category !== "string" || !(ADJUSTABLE_CATEGORIES as readonly string[]).includes(category)) {
    response.status(400).json({ error: "조정할 부품 카테고리가 올바르지 않습니다." });
    return;
  }
  if (direction !== "upgrade" && direction !== "downgrade") {
    response.status(400).json({ error: "direction은 upgrade 또는 downgrade여야 합니다." });
    return;
  }
  try {
    const catalog = await loadCatalog();
    const result = suggestPartAdjustment(catalog, parsed.build, category as PartCategory, direction);
    trackUsageEvent("adjust", { path: "/api/builds/adjust" });
    if (!result.suggestion) {
      response.status(200).json({ ok: false, reason: result.reason });
      return;
    }
    const { suggestion, alternatives } = result;
    response.json({
      ok: true,
      suggestion: {
        category: suggestion.category,
        direction: suggestion.direction,
        part: suggestion.part,
        selection: suggestion.selection,
        beforePriceWon: suggestion.beforePriceWon,
        afterPriceWon: suggestion.afterPriceWon,
        status: suggestion.status
      },
      alternatives: alternatives.map((part) => ({ id: part.id, name: part.name, priceWon: part.priceWon }))
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "부품 조정을 처리하지 못했습니다.";
    response.status(422).json({ error: message });
  }
});

// 온보딩/복구 제안이 "이 요청 그대로 만들 수 있는 최저 견적"을 표시하도록
// 요청 형태 그대로의 실측 최저가를 반환한다 — 프로필 평균이 아니라 요청과 같은
// 풀/게이트를 적용한 값이어야 다음 예산 제안이 다시 실패하지 않는다.
app.post("/api/builds/recommend/floor", publicRecommendationRateLimit, async (request, response) => {
  const parsed = parseBuildGenerationRequest(request.body);
  if (parsed.errors.length > 0 || !parsed.request) {
    response.status(400).json({ error: "자동 견적 최저가 요청 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  try {
    const catalog = await loadCatalog();
    response.json({ floorWon: quotationEngineFloorFor(catalog, parsed.request) });
  } catch (error: unknown) {
    recordGenerationFailure({
      route: "/api/builds/recommend/floor",
      statusCode: 500,
      error,
      request: parsed.request,
      requestId: response.locals.requestId as string | undefined
    });
    const message = error instanceof Error ? error.message : "자동 견적 최저가를 계산하지 못했습니다.";
    response.status(500).json({ error: message });
  }
});

app.post("/api/builds/recommend/variants", publicRecommendationRateLimit, async (request, response) => {
  const parsed = parseBuildGenerationRequest(request.body);
  if (parsed.errors.length > 0 || !parsed.request) {
    response.status(400).json({ error: "자동 구성 비교 요청 형식이 올바르지 않습니다.", details: parsed.errors });
    return;
  }
  let catalog: Part[] | undefined;
  try {
    catalog = await loadCatalog();
    const variants = buildGenerationVariantResultsFor(catalog, parsed.request, response.locals.requestId as string | undefined);
    trackUsageEvent("recommend", { path: "/api/builds/recommend/variants" });
    response.json({ variants });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "세 가지 자동 구성 결과를 만들지 못했습니다.";
    const recoveryOptions = catalog ? buildGenerationRecoveryOptionsFor(catalog, parsed.request, { targetFilters: loadEngineTargetFiltersConfig(), gamingFpsReferences: loadGamingFpsReferences() }) : [];
    const diagnostics = error instanceof BuildGenerationError ? error.diagnostics : [];
    trackUsageEvent("recommend_failed", { path: "/api/builds/recommend/variants" });
    recordGenerationFailure({
      route: "/api/builds/recommend/variants",
      statusCode: 422,
      error,
      request: parsed.request,
      diagnostics,
      recoveryOptionIds: recoveryOptions.map((option) => option.id),
      requestId: response.locals.requestId as string | undefined
    });
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
    const scenarios = budgetLadderScenariosFor(parsed.request, engineGenerationLadderMultipliersFor());
    const targetFilters = loadEngineTargetFiltersConfig();
    const outcomes = scenarios.map((scenario) => {
      try {
        return { ...scenario, draft: generateBuildDraft(catalog!, scenario.request, loadGamingPerformanceEvidence(), { targetFilters, gamingTestbedPhase1: scenario.request.gamingTestbedPhase1, gamingFpsReferences: loadGamingFpsReferences() }) };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "이 예산 구간의 자동 구성을 만들지 못했습니다.";
        const diagnostics = error instanceof BuildGenerationError ? error.diagnostics : [];
        recordGenerationFailure({
          route: "/api/builds/recommend/budget-ladder",
          statusCode: 200,
          error,
          request: scenario.request,
          diagnostics,
          requestId: response.locals.requestId as string | undefined,
          context: `scenario:${scenario.id}`
        });
        return { ...scenario, error: message, ...(diagnostics.length > 0 ? { diagnostics } : {}) };
      }
    });
    trackUsageEvent("recommend", { path: "/api/builds/recommend/budget-ladder" });
    response.json({ scenarios: outcomes });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "예산 구간 자동 견적을 생성하지 못했습니다.";
    const recoveryOptions = catalog ? buildGenerationRecoveryOptionsFor(catalog, parsed.request, { targetFilters: loadEngineTargetFiltersConfig(), gamingFpsReferences: loadGamingFpsReferences() }) : [];
    const diagnostics = error instanceof BuildGenerationError ? error.diagnostics : [];
    trackUsageEvent("recommend_failed", { path: "/api/builds/recommend/budget-ladder" });
    recordGenerationFailure({
      route: "/api/builds/recommend/budget-ladder",
      statusCode: 422,
      error,
      request: parsed.request,
      diagnostics,
      recoveryOptionIds: recoveryOptions.map((option) => option.id),
      requestId: response.locals.requestId as string | undefined
    });
    response.status(422).json({ error: message, ...(diagnostics.length > 0 ? { diagnostics } : {}), ...(recoveryOptions.length > 0 ? { recoveryOptions } : {}) });
  }
});

app.post("/api/builds", buildCreateRateLimit, privateNoStore, async (request, response) => {
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
  const rawOrigin = request.body?.origin;
  const origin = savedBuildOriginFromUnknown(rawOrigin);
  if (rawOrigin !== undefined && !origin) {
    response.status(400).json({ error: "견적 생성 출처 형식이 올바르지 않습니다.", code: "BUILD_ORIGIN_INVALID" });
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
    if (!await ownerShareCanManageRequest(request, "build", parentBuild, parentOwnerToken, false)) {
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
  const recoveryCredential = createShareRecoveryCode();
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
    ...(origin ? { origin } : {}),
    selection: build,
    recommendationPreferences,
    checkSnapshot,
    createdAt: now,
    updatedAt: now,
    ...(expiresAt ? { expiresAt } : {}),
    ...versionMetadata,
    ownerTokenHash: ownerCredential.hash,
    recoveryCodeHash: recoveryCredential.hash
  };
  const created = await persistOwnerShareResource(request, response, "build", saved, () => appendSavedBuild(saved), () => deleteSavedBuild(id));
  if (!created) return;
  trackUsageEvent("save", { path: "/api/builds" });
  response.status(201).json({
    ...ownerManagedShareResponse(savedBuildPresentationFor(created.persisted, { catalog, accessories }), ownerCredential.token, created.ownerManaged),
    recoveryCode: recoveryCredential.code
  });
});

app.post("/api/watchlists", watchlistCreateRateLimit, privateNoStore, async (request, response) => {
  const parsed = parseSavedCatalogWatchlistInput(request.body);
  if (parsed.errors.length > 0 || !parsed.name || parsed.nearLowThresholdPercent === undefined) {
    response.status(400).json({ error: parsed.errors[0] ?? "관심 가격 목록을 저장할 수 없습니다.", details: parsed.errors });
    return;
  }
  const now = new Date().toISOString();
  const expiresAt = parsed.expiresInDays === undefined ? undefined : new Date(Date.now() + parsed.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const ownerCredential = createShareOwnerCredential();
  const saved: SavedCatalogWatchlistRecord = { id: randomUUID(), name: parsed.name, entries: parsed.entries, nearLowThresholdPercent: parsed.nearLowThresholdPercent, alertPreferences: parsed.alertPreferences ?? DEFAULT_SAVED_WATCHLIST_ALERT_PREFERENCES, createdAt: now, updatedAt: now, ...(expiresAt ? { expiresAt } : {}), ownerTokenHash: ownerCredential.hash };
  const created = await persistOwnerShareResource(request, response, "watchlist", saved, async () => {
    await appendSavedWatchlist(saved);
    return saved;
  }, () => deleteSavedWatchlist(saved.id));
  if (!created) return;
  trackUsageEvent("share", { path: "/api/watchlists" });
  response.status(201).json(ownerManagedShareResponse(publicSavedCatalogWatchlist(created.persisted), ownerCredential.token, created.ownerManaged));
});

app.post("/api/comparisons", comparisonCreateRateLimit, privateNoStore, async (request, response) => {
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
  const created = await persistOwnerShareResource(request, response, "comparison", saved, async () => {
    await appendSavedComparison(saved);
    return saved;
  }, () => deleteSavedComparison(saved.id));
  if (!created) return;
  trackUsageEvent("share", { path: "/api/comparisons" });
  response.status(201).json(ownerManagedShareResponse(publicAlternativeComparison(created.persisted), ownerCredential.token, created.ownerManaged));
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
  if (!await ownerShareCanManageRequest(request, "comparison", comparison, ownerToken)) {
    response.status(401).json({ error: "이 부품 비교를 취소할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const deleted = await deleteSavedComparison(id ?? "");
  if (!deleted) {
    response.status(404).json({ error: "저장된 부품 비교를 찾을 수 없습니다." });
    return;
  }
  await deleteOwnerShareSessionGrantsForResource("comparison", id ?? "");
  response.json({ deleted: true });
});

app.post("/api/version-comparisons", versionComparisonCreateRateLimit, privateNoStore, async (request, response) => {
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
  if (!await ownerShareCanManageRequest(request, "build", after, ownerToken)) {
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
  const created = await persistOwnerShareResource(request, response, "version-comparison", saved, async () => {
    await appendSavedBuildVersionComparison(saved);
    return saved;
  }, () => deleteSavedBuildVersionComparison(saved.id));
  if (!created) return;
  trackUsageEvent("share", { path: "/api/version-comparisons" });
  response.status(201).json(ownerManagedShareResponse(publicSavedBuildVersionComparisonShare(created.persisted), ownerCredential.token, created.ownerManaged));
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
  if (!await ownerShareCanManageRequest(request, "version-comparison", comparison, ownerToken)) {
    response.status(401).json({ error: "이 견적 버전 비교를 취소할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const deleted = await deleteSavedBuildVersionComparison(id ?? "");
  if (!deleted) {
    response.status(404).json({ error: "저장된 견적 버전 비교를 찾을 수 없습니다." });
    return;
  }
  await deleteOwnerShareSessionGrantsForResource("version-comparison", id ?? "");
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
  if (!await ownerShareCanManageRequest(request, "watchlist", watchlist, ownerToken)) {
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

app.get("/api/watchlists/:id/alerts", watchlistAlertRateLimit, privateNoStore, async (request, response) => {
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
  if (!await ownerShareCanManageRequest(request, "watchlist", watchlist, ownerToken)) {
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
  if (!await ownerShareCanManageRequest(request, "watchlist", watchlist, ownerToken)) {
    response.status(401).json({ error: "이 관심 가격 목록을 취소할 권한이 없습니다.", code: "SHARE_OWNER_AUTH_REQUIRED" });
    return;
  }
  const deleted = await deleteSavedWatchlist(id ?? "");
  if (!deleted) {
    response.status(404).json({ error: "저장된 관심 가격 목록을 찾을 수 없습니다." });
    return;
  }
  await deleteOwnerShareSessionGrantsForResource("watchlist", id ?? "");
  await deleteSavedWatchlistAlertStates(id ?? "");
  response.json({ deleted: true });
});

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

app.put("/api/builds/:id/my-pc", buildShareRateLimit, async (request, response) => {
  const build = await ownedSavedBuildForRequest(request, response, "내 PC 등록", "내 PC로 등록하려면 이 견적의 소유자 인증이 필요합니다.");
  if (!build) return;
  const owned = request.body?.owned === true;
  const now = new Date().toISOString();
  if (owned === (build.myPcAt !== undefined)) {
    response.json(savedBuildPresentationFor(build, await loadSavedBuildPresentationContext()));
    return;
  }
  // 승격 시 서버 점검 구독도 함께 켠다 — 대안 알림은 due인 모니터 실행에서만 생성되므로
  // enabled 없이 승격하면 약속한 알림이 영구히 오지 않는다. 정책은 risk로 맞춰
  // all의 구매 단계 잡음을 줄이고 critical에서는 빠져 있던 대안 알림이 오게 한다.
  // 강제하기 전의 enabled/정책은 preMyPc*에 보관해 해제 시 복원한다.
  const current = build.monitorState ?? defaultSavedBuildMonitorSubscription(build.createdAt);
  const monitorState = owned
    ? { ...configureSavedBuildMonitorSubscription(current, { enabled: true, intervalMinutes: current.intervalMinutes, alertPolicy: "risk" }, now), preMyPcEnabled: current.enabled, preMyPcAlertPolicy: current.alertPolicy }
    : current.preMyPcEnabled !== undefined || current.preMyPcAlertPolicy !== undefined
      ? { ...configureSavedBuildMonitorSubscription(current, { enabled: current.preMyPcEnabled ?? current.enabled, intervalMinutes: current.intervalMinutes, alertPolicy: current.preMyPcAlertPolicy ?? current.alertPolicy }, now), preMyPcEnabled: undefined, preMyPcAlertPolicy: undefined }
      : undefined;
  const updated = await updateSavedBuildMyPc(build.id, owned ? now : null, monitorState);
  if (!updated) {
    response.status(404).json({ error: "저장된 견적을 찾을 수 없습니다." });
    return;
  }
  // 승격 직후 첫 점검을 즉시 실행해 등록 시점의 스냅샷과 대안 후보를 채운다.
  // 실패는 모니터 상태의 lastError로 기록되므로 응답을 막지 않는다.
  if (owned) void executeSavedBuildMonitorRun(updated).catch(() => undefined);
  response.json(savedBuildPresentationFor(updated, await loadSavedBuildPresentationContext()));
});

app.get("/api/builds/:id/metadata-history", buildShareRateLimit, privateNoStore, async (request, response) => {
  const build = await ownedSavedBuildForRequest(request, response, "저장 견적 설명 이력");
  if (!build) return;
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
      if (!resources) throw new Error("현재 부품 정보를 불러오지 못했습니다.");
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

app.get("/api/builds/:id/monitor", buildShareRateLimit, privateNoStore, async (request, response) => {
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
    response.status(400).json({ error: targetRevision.error ?? "복원할 가격 이력 버전을 확인해 주세요." });
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
    response.status(400).json({ error: targetRevision.error ?? "복원할 구매 진행률 버전을 확인해 주세요." });
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
  const expectedFingerprintBase = `pc-supporter-assembly-verification:${expectedFingerprint}`;
  const submittedFingerprint = parsed.history.buildFingerprint;
  const fingerprintMatches = submittedFingerprint === expectedFingerprintBase || submittedFingerprint.startsWith(`${expectedFingerprintBase}:`);
  if (!fingerprintMatches) {
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
  await deleteOwnerShareSessionGrantsForResource("build", id ?? "");
  response.json({ deleted: true });
});

// 저장 견적 복구 코드 발급/재발급 — 소유자만 가능하며, 새 코드가 나오면 이전 코드는 폐기된다.
app.post("/api/builds/:id/recovery-code", buildShareRateLimit, privateNoStore, async (request, response) => {
  const build = await ownedSavedBuildForRequest(request, response, "복구 코드 발급", "복구 코드를 만들려면 이 견적의 소유자 인증이 필요합니다.");
  if (!build) return;
  const credential = createShareRecoveryCode();
  // ownerTokenHash가 없는 레거시 견적에는 누구도 평문을 모르는 해시를 쓴다 —
  // 이 경우 발급된 복구 코드 자체가 유일한 소유 증명이 된다.
  const ownerTokenHash = build.ownerTokenHash ?? createShareOwnerCredential().hash;
  const updated = await updateSavedBuildShareCredentials(build.id, ownerTokenHash, credential.hash, build.recoveryCodeHash);
  if (!updated) {
    response.status(409).json({ error: "복구 코드 상태가 변경되었습니다. 다시 시도해 주세요.", code: "RECOVERY_CODE_CONFLICT" });
    return;
  }
  response.status(201).json({ recoveryCode: credential.code });
});

// 복구 코드로 소유권 되찾기 — 코드가 맞으면 새 owner token을 발급하고 이전 토큰은 폐기한다.
// 사용한 복구 코드도 함께 회전한다 — 코드를 아는 사람이 영구적인 재탈취 경로를 갖지 않도록.
app.post("/api/builds/:id/recover", buildRecoverRateLimit, privateNoStore, async (request, response) => {
  const build = await savedBuildForRequest(request, response);
  if (!build) return;
  const code = typeof request.body?.recoveryCode === "string" ? request.body.recoveryCode : undefined;
  if (!normalizeShareRecoveryCode(code)) {
    response.status(400).json({ error: "복구 코드 형식이 올바르지 않습니다.", code: "RECOVERY_CODE_INVALID" });
    return;
  }
  if (!shareRecoveryCodeMatches(build, code)) {
    response.status(401).json({ error: "복구 코드가 이 견적과 일치하지 않습니다.", code: "RECOVERY_CODE_MISMATCH" });
    return;
  }
  const ownerCredential = createShareOwnerCredential();
  const recoveryCredential = createShareRecoveryCode();
  const rollbackOwnerTokenHash = build.ownerTokenHash ?? createShareOwnerCredential().hash;
  const updated = await updateSavedBuildShareCredentials(build.id, ownerCredential.hash, recoveryCredential.hash, build.recoveryCodeHash);
  if (!updated) {
    response.status(401).json({ error: "복구 코드가 이 견적과 일치하지 않습니다.", code: "RECOVERY_CODE_MISMATCH" });
    return;
  }
  const rollbackCredentialRotation = async () => updateSavedBuildShareCredentials(
    build.id,
    rollbackOwnerTokenHash,
    build.recoveryCodeHash ?? "",
    recoveryCredential.hash
  );
  if (ownerSessionModeRequested(request)) {
    const ownerManaged = await attachOwnerSessionGrant(
      request,
      response,
      "build",
      { id: build.id, ownerTokenHash: ownerCredential.hash, ...(build.expiresAt ? { expiresAt: build.expiresAt } : {}) },
      ownerSessionStoreApi,
      rollbackCredentialRotation
    );
    if (ownerManaged === undefined) return;
    response.json(ownerManagedShareResponse({ recoveryCode: recoveryCredential.code }, ownerCredential.token, ownerManaged));
    return;
  }
  response.json({ ownerToken: ownerCredential.token, recoveryCode: recoveryCredential.code });
});
}
