import { type PartCategory, PART_CATEGORIES, type DataFreshness, type PriceAvailabilityFilter, type AccessoryRefreshResponse, type CrawlStatus, type DataQuality, type ListingPolicy, type Part, type AlternativeRisk, type RecommendationProfile, type AlternativeRiskCounts, type AccessoryCategory, ACCESSORY_CATEGORIES, type AccessoryPriceFilter } from "../../shared/types";
import { type RequestHandler, type Response, type Express } from "express";
import { adminAuthEnabled, requireAdmin } from "../auth";
import { loadCatalogSnapshot } from "../catalog-snapshot";
import { catalogMeta, parseCatalogMissingField, parsePartSpecFilter, parseCatalogDetailFilterQuery, loadCatalog, catalogSearchTotalsFor, filterParts, partSpecFilterMatcherFor, searchParts, partSpecFilterDiagnosticsFor, findPart, catalogUpdatedAtFor, currentCatalogRuntimeRevision, countParts } from "../catalog";
import { readCrawlStatus } from "../engines/crawler-engine";
import { persistenceDiagnostics } from "../repository";
import { publicCrawlStatusFor } from "../../shared/public-crawl-status";
import { ENGINE_VERSION, evaluateBuild, assessAlternativePart, candidateSimilarityForBuild, compareCandidateSimilarity, compareCandidateValue } from "../../shared/domain/engine";
import { publicCatalogDetailFilterForCategory, PUBLIC_CATALOG_FILTER_FACETS } from "../../shared/public-catalog-filters";
import { noteStaleServedPrices } from "../stale-price-refresh";
import { classifyDataFreshness } from "../../shared/domain/data-health";
import { engineTargetFilterFacetDiagnosticsFor, engineTargetFilterRuleFromUnknown, engineTargetFilterRuleAllowsPart } from "../../shared/engine-target-filters";
import { parseCatalogBatchQuery, parseCatalogBatchIds } from "../catalog-batch";
import { catalogFacetOptionsCachedFor } from "../catalog-facet-options";
import { parseBuild, parseRecommendationPreferences } from "../../shared/domain/build-input";
import { validateBuildPartIds } from "../build-validation";
import { alternativePerformanceFilterFromUnknown, alternativePerformanceMatches } from "../alternative-performance";
import { physicalEvidenceFilterFromUnknown, physicalEvidenceMatches } from "../../shared/physical-evidence-filter";
import { recommendationTrustFilterFromUnknown, recommendationTrustFor, recommendationTrustCountsFor, recommendationTrustMatchesFilter } from "../../shared/domain/recommendation-trust";
import { createHash } from "node:crypto";
import { compatiblePartAssessmentCache } from "../engines/compatibility-engine";
import { isQuoteSelectable } from "../../shared/domain/listing";
import { candidateDecisionSummaryFor } from "../../shared/candidate-decision";
import { catalogMissingFieldCountsFor } from "../../shared/catalog-spec-coverage";
import { alternativeCandidateWithinBudget } from "../alternative-budget";
import { loadAccessories, countAccessories, searchAccessories, findAccessory, upsertAccessories } from "../accessories";
import { accessoryRefreshBlockReason, refreshDanawaAccessory, accessoryRefreshResponse } from "../part-refresh";
import { withCatalogIngestionLease as executeCatalogIngestionJob, CatalogIngestionBusyError } from "../catalog-ingestion-coordinator";
import { appendCatalogChangeRecord, catalogChangeRecord } from "../catalog-change-log";
import { requestCanViewAdminMeta, sendJsonWithEtag, routeParam, PART_REFRESH_COOLDOWN_MS, createRateLimitMiddleware, PartRefreshRouteError, refreshCatalogPartById } from "./route-support";

function isCategory(value: unknown): value is PartCategory {
  return typeof value === "string" && PART_CATEGORIES.includes(value as PartCategory);
}

function dataFreshnessFromUnknown(value: unknown): DataFreshness | "all" {
  const raw = typeof value === "string" ? value : "all";
  return ["all", "fresh", "aging", "stale", "unknown"].includes(raw) ? raw as DataFreshness | "all" : "all";
}

function priceAvailabilityFromUnknown(value: unknown, fallback: PriceAvailabilityFilter = "all"): PriceAvailabilityFilter {
  if (value === "known" || value === "unknown" || value === "all") return value;
  return fallback;
}
const accessoryRefreshJobs = new Map<string, Promise<AccessoryRefreshResponse>>();
const accessoryRefreshLastRunAt = new Map<string, number>();
const catalogRefreshRateLimit = createRateLimitMiddleware("catalog-refresh", { limit: 30, windowMs: 60_000 });
const publicCatalogReadRateLimit = createRateLimitMiddleware("public-catalog-read", { limit: 180, windowMs: 60_000 });
const publicCatalogDetailRateLimit = createRateLimitMiddleware("public-catalog-detail", { limit: 240, windowMs: 60_000 });
const publicCatalogBatchRateLimit = createRateLimitMiddleware("public-catalog-batch", { limit: 60, windowMs: 60_000 });
const publicAccessoryReadRateLimit = createRateLimitMiddleware("public-accessory-read", { limit: 180, windowMs: 60_000 });
const publicAccessoryDetailRateLimit = createRateLimitMiddleware("public-accessory-detail", { limit: 240, windowMs: 60_000 });
const publicAccessoryBatchRateLimit = createRateLimitMiddleware("public-accessory-batch", { limit: 60, windowMs: 60_000 });
const publicCandidateRateLimit = createRateLimitMiddleware("public-candidate", { limit: 60, windowMs: 60_000 });

const requirePartRefreshAccess: RequestHandler = (request, response, next) => {
  if (adminAuthEnabled()) {
    requireAdmin(request, response, next);
    return;
  }
  next();
};

function sendPartRefreshError(response: Response, error: unknown) {
  if (error instanceof PartRefreshRouteError) {
    if (error.retryAfterSeconds !== undefined) response.setHeader("Retry-After", String(error.retryAfterSeconds));
    response.status(error.statusCode).json({ error: error.message, code: error.code, ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}) });
    return;
  }
  response.status(422).json({ error: error instanceof Error ? error.message : "부품 상세 정보를 다시 확인하지 못했습니다.", code: "PART_REFRESH_FAILED" });
}

export function registerCatalogRoutes(app: Express) {
app.get("/api/meta", async (request, response) => {
  const mayReadInternalMeta = requestCanViewAdminMeta(request);
  const [meta, crawler, persistence] = await Promise.all([
    loadCatalogSnapshot().then((snapshot) => catalogMeta(snapshot)),
    readCrawlStatus(),
    persistenceDiagnostics()
  ]);
  sendJsonWithEtag(request, response, {
    ...meta,
    crawler: publicCrawlStatusFor(crawler as CrawlStatus),
    engineVersion: ENGINE_VERSION,
    storageMode: persistence.storageMode,
    persistence,
    adminAuthEnabled: adminAuthEnabled(),
    ...(mayReadInternalMeta ? { adminSessionAuthenticated: true } : {})
  }, undefined, !mayReadInternalMeta);
});

app.get("/api/categories", (_request, response) => {
  response.json({ categories: PART_CATEGORIES });
});

app.get("/api/parts", publicCatalogReadRateLimit, async (request, response) => {
  const category = isCategory(request.query.category) ? request.query.category : undefined;
  const rawQuoteContext = request.query.quoteContext;
  if (rawQuoteContext !== undefined && rawQuoteContext !== "gaming_testbed") {
    response.status(400).json({ error: "견적 부품 목록 조건이 올바르지 않습니다.", code: "INVALID_QUOTE_CONTEXT" });
    return;
  }
  const quoteContext = rawQuoteContext === "gaming_testbed" ? "gaming_testbed" as const : undefined;
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
  const priceAvailability = priceAvailabilityFromUnknown(request.query.priceStatus, "known");
  const freshness = dataFreshnessFromUnknown(request.query.freshness);
  // Benchmark coverage is an internal ranking signal; public listing queries
  // always use the full catalog regardless of a supplied benchmarkStatus.
  const benchmarkAvailability = "all" as const;
  const parsedMissingField = parseCatalogMissingField(request.query.missingField);
  if (parsedMissingField.error) {
    response.status(400).json({ error: "누락 필드 형식이 올바르지 않습니다.", details: [parsedMissingField.error] });
    return;
  }
  const missingField = parsedMissingField.value;
  const rawSort = typeof request.query.sort === "string" ? request.query.sort : "price_asc";
  // Never expose internal benchmark ordering through the public catalog API.
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
  const parsedDetailFilter = parseCatalogDetailFilterQuery(request.query as Record<string, unknown>, category);
  if (parsedDetailFilter.errors.length > 0) {
    response.status(400).json({ error: "세부 조건 형식이 올바르지 않습니다.", details: parsedDetailFilter.errors });
    return;
  }
  const detailRule = category ? publicCatalogDetailFilterForCategory(parsedDetailFilter.filter, category) : parsedDetailFilter.filter;
  const catalog = await loadCatalog();
  // partId 조회는 목록 탐색이 아니라 부품 상세 확인용이라 브랜드 제한을 걸지 않는다.
  // 견적 후보 목록에서는 가격/사양 정보가 없는 부품을 뺀다 — 스펙 미등록 부품을
  // 일부러 찾는 관리용 질의(quality=incomplete/missingField/가격 미확인 모두 보기)는 예외다.
  const quoteSellableOnly = partId === undefined && quality !== "incomplete" && missingField === undefined && priceAvailability === "known";
  const baseOptions = { ...(quoteContext ? { quoteContext } : {}), ...(partId ? { partId } : {}), ...(brand ? { brand } : {}), ...(missingField ? { missingField } : {}), quality, sort, listingPolicy, quoteBrandRestricted: partId === undefined, quoteSellableOnly };
  const priceOptions = { ...baseOptions, priceAvailability };
  const freshnessOptions = { ...priceOptions, freshness };
  const benchmarkOptions = { ...freshnessOptions, benchmarkAvailability };
  const options = { ...benchmarkOptions, specFilter: parsedSpecFilter.filter, ...(detailRule ? { detailRule } : {}) };
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
  const detailApplied = detailRule !== undefined && category !== undefined;
  // 핵심 사양 조건(legacy)과 세부 조건(detailRule)의 제외 개수를 따로 안내하기 위해
  // 두 단계로 나눠 센다 — detailExcludedCount는 legacy 조건까지 통과한 풀 기준이다.
  const specInputParts = (specFilterApplied || detailApplied) ? filterParts(catalog, category, query, benchmarkOptions) : [];
  const detailInputParts = detailApplied ? specInputParts.filter(partSpecFilterMatcherFor(parsedSpecFilter.filter)) : [];
  const servedParts = searchParts(catalog, category, query, limit, options, offset);
  noteStaleServedPrices(servedParts);
  const payload = {
    items: servedParts.map((part) => ({ ...part, dataFreshness: classifyDataFreshness(part.updatedAt) })),
    total,
    ...(brand ? { brand } : {}),
    ...(partId ? { partId } : {}),
    ...(missingField ? { missingField } : {}),
    ...(priceAvailability !== "all" ? { priceStatus: priceAvailability, priceExcludedCount: baseTotal - priceTotal } : {}),
    ...(freshness !== "all" ? { freshness, freshnessExcludedCount: priceTotal - freshnessTotal } : {}),
    ...(unfilteredTotal > coreCandidateTotal ? { nonCoreExcludedCount: unfilteredTotal - coreCandidateTotal } : {}),
    ...(categoryMismatchExcludedCount > 0 ? { categoryMismatchExcludedCount } : {}),
    ...(specFilterApplied ? { specFilter: parsedSpecFilter.filter, specExcludedCount: benchmarkTotal - (detailApplied ? detailInputParts.length : total), specFilterDiagnostics: partSpecFilterDiagnosticsFor(specInputParts, parsedSpecFilter.filter) } : {}),
    ...(detailApplied ? { detailExcludedCount: detailInputParts.length - total, detailFilterDiagnostics: engineTargetFilterFacetDiagnosticsFor(detailInputParts, detailRule, category) } : {}),
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
  noteStaleServedPrices(payload.items);
  const lastModified = payload.items.reduce<string | undefined>((latest, part) => !latest || part.updatedAt > latest ? part.updatedAt : latest, undefined);
  sendJsonWithEtag(request, response, payload, lastModified);
});

// 부품 찾기 세부 조건 패널용 facet 정의 + 실제 선택지 — 탐색 목록과 동일한
// 풀(브랜드 허용/견적 선택 가능 부품) 위에서 개수를 집계해 다나와처럼
// "선택지(N개)"를 보여준다.
app.get("/api/parts/facets", publicCatalogReadRateLimit, async (request, response) => {
  const category = isCategory(request.query.category) ? request.query.category : undefined;
  if (!category) {
    response.status(400).json({ error: "세부 조건을 찾으려면 부품 카테고리가 필요합니다." });
    return;
  }
  const rawQuoteContext = request.query.quoteContext;
  if (rawQuoteContext !== undefined && rawQuoteContext !== "gaming_testbed") {
    response.status(400).json({ error: "견적 부품 목록 조건이 올바르지 않습니다.", code: "INVALID_QUOTE_CONTEXT" });
    return;
  }
  const quoteContext = rawQuoteContext === "gaming_testbed" ? "gaming_testbed" as const : undefined;
  const catalog = await loadCatalog();
  sendJsonWithEtag(request, response, {
    category,
    facets: PUBLIC_CATALOG_FILTER_FACETS[category],
    options: catalogFacetOptionsCachedFor(catalog, category, quoteContext)
  });
});

app.get("/api/parts/:id", publicCatalogDetailRateLimit, async (request, response) => {
  const catalog = await loadCatalog();
  const partId = routeParam(request.params.id);
  const part = partId ? findPart(catalog, partId) : undefined;
  if (!part) {
    response.status(404).json({ error: "부품을 찾을 수 없습니다." });
    return;
  }
  noteStaleServedPrices([part]);
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
  noteStaleServedPrices(items);
  response.json({ items, missingIds: parsed.ids.filter((id) => !byId.has(id)) });
});

app.post("/api/parts/:id/refresh", catalogRefreshRateLimit, requirePartRefreshAccess, async (request, response) => {
  try {
    response.json(await refreshCatalogPartById(routeParam(request.params.id) ?? ""));
  } catch (error: unknown) {
    sendPartRefreshError(response, error);
  }
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
  const priceAvailability = priceAvailabilityFromUnknown(body.priceStatus, "known");
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
  // 다나와식 세부 조건(detailFilter)은 공개 /api/parts와 같은 규칙 형식을 JSON 본문으로 받는다.
  const detailFilterErrors: string[] = [];
  const detailRule = publicCatalogDetailFilterForCategory(engineTargetFilterRuleFromUnknown(body.detailFilter, category, detailFilterErrors), category);
  if (detailFilterErrors.length > 0) {
    response.status(400).json({ error: "세부 조건 형식이 올바르지 않습니다.", details: detailFilterErrors });
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
    version: 10,
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
    specFilter: parsedSpecFilter.filter,
    detailFilter: detailRule
  })).digest("hex")}`;
  const assessedCache = await compatiblePartAssessmentCache.getOrCompute(assessmentCacheKey, () => {
    const intentFinding = requestedFindingRuleId
      ? evaluateBuild(parsed.build, catalog, { includeSuggestions: false }).findings.find((finding) => finding.ruleId === requestedFindingRuleId)
      : undefined;
    if (requestedFindingRuleId && !intentFinding) return { intentFinding, assessedParts: [], policyExcludedParts: [], priceExcludedCount: 0, freshnessExcludedCount: 0, specExcludedCount: 0, detailExcludedCount: 0, specFilterDiagnostics: [] };
    const baseOptions = { ...(brand ? { brand } : {}), quality, sort: catalogSort, listingPolicy, quoteBrandRestricted: true, quoteSellableOnly: true };
    const priceOptions = { ...baseOptions, priceAvailability };
    const options = { ...priceOptions, freshness };
    const baseCount = countParts(catalog, category, query, baseOptions);
    const priceCount = countParts(catalog, category, query, priceOptions);
    const searchedParts = searchParts(catalog, category, query, catalog.length, options, 0);
    const specFilteredParts = searchedParts.filter(partSpecFilterMatcherFor(parsedSpecFilter.filter));
    const specFilterDiagnostics = partSpecFilterDiagnosticsFor(searchedParts, parsedSpecFilter.filter);
    const detailFilteredParts = detailRule ? specFilteredParts.filter((part) => engineTargetFilterRuleAllowsPart(part, detailRule)) : specFilteredParts;
    // 판매 정책으로 빠진 부품(스펙 미등록/가격 미확인)도 안내 문구를 위해 따로 센다.
    const policyExcludedParts = searchParts(catalog, category, query, catalog.length, { ...options, quoteSellableOnly: false }, 0)
      .filter((part) => !isQuoteSelectable(part, catalog));
    const assessedParts = detailFilteredParts
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
      policyExcludedParts,
      priceExcludedCount: baseCount - priceCount,
      freshnessExcludedCount: priceCount - searchedParts.length,
      specExcludedCount: searchedParts.length - specFilteredParts.length,
      detailExcludedCount: specFilteredParts.length - detailFilteredParts.length,
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
  const { priceExcludedCount, freshnessExcludedCount, specExcludedCount, detailExcludedCount, specFilterDiagnostics, policyExcludedParts } = assessedCache.value;
  // 견적에는 현재 구성에서 호환 확인이 끝난 부품만 올린다 — 정보 부족(review)이나
  // 비호환(unsafe) 후보는 위험도 집계에만 남기고 선택 목록에서 제외한다.
  const intentEligibleParts = intentFinding
    ? assessedParts.filter(({ assessment }) => assessment.fixesCurrentIssue === true)
    : assessedParts;
  const intentParts = intentEligibleParts.filter(({ assessment }) => assessment.risk === "safe");
  const recommendationTrustCounts = recommendationTrustCountsFor(intentParts.map(({ recommendationTrust }) => recommendationTrust));
  const riskCounts: AlternativeRiskCounts = { safe: 0, review: 0, unsafe: 0 };
  for (const { assessment } of intentEligibleParts) riskCounts[assessment.risk] += 1;
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
  const incompleteParts = policyExcludedParts.filter((part) => part.dataQuality === "incomplete" && !selectedPartIds.has(part.id));
  const incompleteExcludedCount = incompleteParts.length;
  const incompleteMissingFields = catalogMissingFieldCountsFor(incompleteParts, 5);
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
    ...(detailRule ? { detailExcludedCount } : {}),
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
  const rawPriceFilter = typeof request.query.priceFilter === "string" ? request.query.priceFilter : "priced";
  const priceFilter: AccessoryPriceFilter = ["all", "priced", "under_10000", "10000_50000", "over_50000"].includes(rawPriceFilter)
    ? rawPriceFilter as AccessoryPriceFilter
    : "priced";
  const freshness = dataFreshnessFromUnknown(request.query.freshness);
  const accessories = await loadAccessories();
  const baseOptions = { category, ...(brand ? { brand } : {}), quality, sort, priceFilter };
  const freshnessOptions = { ...baseOptions, freshness };
  const baseTotal = countAccessories(accessories, query, baseOptions);
  const freshnessTotal = countAccessories(accessories, query, freshnessOptions);
  const total = freshnessTotal;
  const servedAccessories = searchAccessories(accessories, query, limit, freshnessOptions, offset);
  noteStaleServedPrices(servedAccessories);
  const payload = {
    items: servedAccessories.map((item) => ({ ...item, dataFreshness: classifyDataFreshness(item.updatedAt) })),
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
  noteStaleServedPrices([accessory]);
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
  noteStaleServedPrices(items);
  response.json({ items, missingIds: parsed.ids.filter((id) => !byId.has(id)) });
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

  const job = executeCatalogIngestionJob(async () => {
    const refreshed = await refreshDanawaAccessory(current);
    const savedAccessories = await upsertAccessories([refreshed]);
    const savedItem = findAccessory(savedAccessories, current.id);
    if (!savedItem) throw new Error("재확인한 주변 부품을 카탈로그에 반영하지 못했습니다.");
    const result = accessoryRefreshResponse(current, savedItem);
    await appendCatalogChangeRecord(catalogChangeRecord("accessory", current, savedItem, result.changedFields, { changedAt: result.refreshedAt })).catch((error: unknown) => {
      console.warn(`주변 부품 변경 이력을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    });
    return result;
  });
  accessoryRefreshJobs.set(accessoryId, job);
  try {
    const result = await job;
    accessoryRefreshLastRunAt.set(accessoryId, Date.now());
    response.json(result);
  } catch (error: unknown) {
    const busy = error instanceof CatalogIngestionBusyError;
    response.status(busy ? 409 : 422).json({ error: error instanceof Error ? error.message : "주변 부품 상세 정보를 다시 확인하지 못했습니다.", code: busy ? "ACCESSORY_REFRESH_RUNNING" : "ACCESSORY_REFRESH_FAILED" });
  } finally {
    if (accessoryRefreshJobs.get(accessoryId) === job) accessoryRefreshJobs.delete(accessoryId);
  }
});
}
