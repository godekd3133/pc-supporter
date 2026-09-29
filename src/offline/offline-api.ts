import { ACCESSORY_CATEGORIES, PART_CATEGORIES } from "../../shared/types";
import type { AccessoryCategory, AccessoryItem, AccessoryPriceFilter, BuildSelection, DataFreshness, DataQuality, ListingPolicy, Part, PartCategory, PriceAvailabilityFilter, RecommendationPreferences, ServiceMeta } from "../../shared/types";
import { assessAlternativePart, candidateSimilarityForBuild, compareCandidateSimilarity, compareCandidateValue, evaluateBuild, generateBuildDraft, ENGINE_VERSION, BuildGenerationError, buildGenerationRecoveryOptionsFor } from "../../shared/domain/engine";
import { parseBuild, parseBuildGenerationRequest, parseRecommendationPreferences } from "../../shared/domain/build-input";
import { validateAccessorySelectionIds, validateAccessoryTargetAccessoryIds, validateRgbControllerAccessoryId } from "../../shared/domain/accessory-cart";
import { classifyDataFreshness } from "../../shared/domain/data-health";
import { compatibilityResultForPublicTransport, evaluateBuildWithAccessories } from "../../shared/domain/compatibility-evaluator";
import { isListingAllowed } from "../../shared/domain/listing";
import { publicApiPayloadProjection } from "../../shared/domain/public-api-projection";
import { catalogMissingFieldCountsFor } from "../../shared/catalog-spec-coverage";
import { pcieCompatibleSlotInventoryFor, pcieSlotWidthFromUnknown } from "../../shared/pcie-slot";
import { isKnownPrice } from "../../shared/types";
import { requireOfflineCatalogSnapshot } from "../../shared/offline-catalog";
import { BUILD_INPUT_MAX_ID_LENGTH, BUILD_INPUT_MAX_SELECTIONS_PER_LIST } from "../../shared/build-input-limits";
import type { OfflineCatalogSnapshot } from "../../shared/offline-catalog";

export type OfflineApiErrorPayload = {
  error: string;
  code: string;
  details?: unknown;
};

export class OfflineApiError extends Error {
  readonly status: number;
  readonly payload: OfflineApiErrorPayload;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "OfflineApiError";
    this.status = status;
    this.payload = { error: message, code, ...(details === undefined ? {} : { details }) };
  }
}

const DATA_QUALITY = ["seed", "live", "manual", "incomplete"] as const satisfies readonly DataQuality[];
const FRESHNESS = ["fresh", "aging", "stale", "unknown"] as const satisfies readonly DataFreshness[];
const FRESHNESS_FILTERS = ["all", ...FRESHNESS] as const;
const LISTING_POLICIES = ["retail_only", "include_bulk", "all"] as const satisfies readonly ListingPolicy[];
const PRICE_STATUSES = ["all", "known", "unknown"] as const satisfies readonly PriceAvailabilityFilter[];
const ACCESSORY_PRICE_FILTERS = ["all", "priced", "under_10000", "10000_50000", "over_50000"] as const satisfies readonly AccessoryPriceFilter[];
const PART_SORTS = ["price_asc", "price_desc", "name", "updated", "benchmark_desc"] as const;
const ACCESSORY_SORTS = ["price_asc", "price_desc", "name", "updated"] as const;
const PART_SPEC_FILTERS = new Set([
  "minVramGb", "minCapacityGb", "minWattageW", "minMemorySpeedMhz", "interface", "socket", "memoryType", "formFactor",
  "minMemorySlots", "minM2Slots", "minSataPorts", "minHddBays", "minMaxGpuLengthMm", "minMaxCoolerHeightMm",
  "minMaxPsuLengthMm", "minCoolingW", "maxLengthMm", "maxPsuDepthMm", "pcieSlotWidth", "minPcieSlotCount", "pcieSlotInfo"
]);
const PART_QUERY_KEYS = new Set(["category", "q", "brand", "limit", "offset", "quality", "freshness", "priceStatus", "sort", "listingPolicy", "partId", "missingField", ...PART_SPEC_FILTERS]);
const ACCESSORY_QUERY_KEYS = new Set(["q", "brand", "limit", "offset", "quality", "freshness", "sort", "category", "priceFilter"]);
const NUMERIC_SPEC_FILTERS = new Set([
  "minVramGb", "minCapacityGb", "minWattageW", "minMemorySpeedMhz", "minMemorySlots", "minM2Slots", "minSataPorts",
  "minPcieSlotCount", "minHddBays", "minMaxGpuLengthMm", "minMaxCoolerHeightMm", "minMaxPsuLengthMm", "minCoolingW",
  "maxLengthMm", "maxPsuDepthMm"
]);

function error(status: number, code: string, message: string, details?: unknown): never {
  throw new OfflineApiError(status, code, message, details === undefined ? undefined : publicApiPayloadProjection(details));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function intParam(params: URLSearchParams, key: string, fallback: number, minimum: number, maximum: number) {
  const raw = params.get(key);
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) error(400, "OFFLINE_QUERY_INVALID", `${key} 값이 올바른 정수가 아닙니다.`);
  return Math.min(maximum, Math.max(minimum, Number(raw)));
}

function enumParam<T extends string>(params: URLSearchParams, key: string, values: readonly T[], fallback: T): T {
  const raw = params.get(key);
  if (raw === null || raw === "") return fallback;
  if (!values.includes(raw as T)) error(400, "OFFLINE_QUERY_INVALID", `${key} 값이 지원되지 않습니다.`);
  return raw as T;
}

function assertSupportedQuery(params: URLSearchParams, allowed: ReadonlySet<string>) {
  for (const key of params.keys()) {
    if (!allowed.has(key)) error(501, "OFFLINE_FILTER_UNAVAILABLE", "이 필터는 로컬 설치 데이터에서 지원되지 않습니다.", { filter: key });
  }
}

function assertValidPartSpecFilters(params: URLSearchParams) {
  for (const key of PART_SPEC_FILTERS) {
    const value = params.get(key);
    if (value === null || value === "") continue;
    if (NUMERIC_SPEC_FILTERS.has(key) && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)) error(400, "OFFLINE_SPEC_FILTER_INVALID", key + "은 1 이상의 정수여야 합니다.");
    if (key === "interface" && value !== "NVMe" && value !== "SATA") error(400, "OFFLINE_SPEC_FILTER_INVALID", "연결 방식은 NVMe 또는 SATA여야 합니다.");
    if (key === "pcieSlotWidth" && pcieSlotWidthFromUnknown(value) === undefined) error(400, "OFFLINE_SPEC_FILTER_INVALID", "PCIe 슬롯 폭은 1, 4, 8 또는 16이어야 합니다.");
    if (key === "pcieSlotInfo" && value !== "complete" && value !== "missing") error(400, "OFFLINE_SPEC_FILTER_INVALID", "PCIe 슬롯 정보 상태는 complete 또는 missing이어야 합니다.");
    if (["socket", "memoryType", "formFactor"].includes(key) && value.trim().length > 80) error(400, "OFFLINE_SPEC_FILTER_INVALID", key + "은 80자 이하로 입력해 주세요.");
  }
}

function freshnessMatches(item: { updatedAt: string }, freshness: DataFreshness, now: number) {
  return freshness === "unknown" ? !Number.isFinite(Date.parse(item.updatedAt)) : classifyDataFreshness(item.updatedAt, now) === freshness;
}

function brandMatches(item: { brand?: string }, brand: string) {
  const needle = brand.trim().toLocaleLowerCase("ko-KR");
  return !needle || (item.brand ?? "").toLocaleLowerCase("ko-KR").includes(needle);
}

function qualityMatches(item: { dataQuality: DataQuality }, quality: DataQuality | "all") {
  return quality === "all" || item.dataQuality === quality;
}

function priceMatches(item: { priceWon?: number }, status: PriceAvailabilityFilter) {
  if (status === "all") return true;
  return status === "known" ? isKnownPrice(item.priceWon) : !isKnownPrice(item.priceWon);
}

function partSpecMatches(part: Part, params: URLSearchParams) {
  const stringFilter = (key: string, candidates: Array<string | undefined>) => {
    const value = params.get(key)?.trim();
    return !value || candidates.some((candidate) => candidate?.toLocaleLowerCase("ko-KR") === value.toLocaleLowerCase("ko-KR"));
  };
  const minFilter = (key: string, value: number | undefined) => {
    const minimum = params.get(key);
    return !minimum || (value !== undefined && value >= Number(minimum));
  };
  const maxFilter = (key: string, value: number | undefined) => {
    const maximum = params.get(key);
    return !maximum || (value !== undefined && value <= Number(maximum));
  };
  const pcieSlotInfo = params.get("pcieSlotInfo");
  const pcieWidthValue = params.get("pcieSlotWidth");
  const pcieCountValue = params.get("minPcieSlotCount");
  if (pcieSlotInfo !== null && pcieSlotInfo !== "" && pcieSlotInfo !== "complete" && pcieSlotInfo !== "missing") return false;
  const requiredWidth = pcieSlotWidthFromUnknown(pcieWidthValue ?? undefined) ?? 1;
  const requiredPcieCount = pcieCountValue ? Number(pcieCountValue) : 1;
  if (pcieSlotWidthFromUnknown(pcieWidthValue ?? undefined) === undefined && pcieWidthValue) return false;
  if (!Number.isSafeInteger(requiredPcieCount) || requiredPcieCount < 1) return false;
  const pcieInventory = part.category === "motherboard" ? pcieCompatibleSlotInventoryFor(part.specs, requiredWidth) : undefined;
  if (pcieSlotInfo === "complete" && (!pcieInventory || !pcieCompatibleSlotInventoryFor(part.specs, 1).complete)) return false;
  if (pcieSlotInfo === "missing" && (!pcieInventory || pcieCompatibleSlotInventoryFor(part.specs, 1).complete)) return false;
  if ((pcieWidthValue || pcieCountValue) && (!pcieInventory?.complete || pcieInventory.knownSlotCount < requiredPcieCount)) return false;
  return stringFilter("interface", [part.specs.interface])
    && stringFilter("socket", [part.specs.socket, ...(part.specs.supportedSockets ?? [])])
    && stringFilter("memoryType", [part.specs.memoryType])
    && stringFilter("formFactor", [part.specs.formFactor, part.specs.psuFormFactor, ...(part.specs.motherboardFormFactors ?? []), ...(part.specs.supportedFormFactors ?? [])])
    && minFilter("minVramGb", part.specs.vramGb)
    && minFilter("minCapacityGb", part.specs.capacityGb)
    && minFilter("minWattageW", part.specs.wattageW)
    && minFilter("minMemorySpeedMhz", part.specs.speedMhz)
    && minFilter("minMemorySlots", part.specs.memorySlots)
    && minFilter("minM2Slots", part.specs.m2Slots)
    && minFilter("minSataPorts", part.specs.sataPorts)
    && minFilter("minHddBays", part.specs.hddBays)
    && minFilter("minMaxGpuLengthMm", part.specs.maxGpuLengthMm)
    && minFilter("minMaxCoolerHeightMm", part.specs.maxCoolerHeightMm)
    && minFilter("minMaxPsuLengthMm", part.specs.maxPsuLengthMm)
    && minFilter("minCoolingW", part.specs.maxCoolingW)
    && maxFilter("maxLengthMm", part.specs.lengthMm)
    && maxFilter("maxPsuDepthMm", part.specs.psuDepthMm);
}

function partMatchesQuery(part: Part, query: string) {
  const needle = query.trim().toLocaleLowerCase("ko-KR");
  if (!needle) return true;
  return [part.name, part.brand, part.model, part.specs.socket, part.specs.memoryType, part.specs.interface, part.specs.formFactor]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ko-KR")
    .includes(needle);
}

function sortParts(items: Part[], category: PartCategory | undefined, sort: typeof PART_SORTS[number]) {
  return items.sort((left, right) => {
    if (sort === "name") return left.name.localeCompare(right.name, "ko-KR");
    if (sort === "updated") return right.updatedAt.localeCompare(left.updatedAt);
    if (sort === "benchmark_desc") {
      if (category !== "cpu" && category !== "gpu") return priceAscending(left, right, true);
      const score = (part: Part) => part.category === "cpu"
        ? [part.specs.cinebenchR23Multi, part.specs.cinebenchR23Single].find((value) => value !== undefined && value > 0)
        : [part.specs.gpu3dmarkTimeSpyScore, part.specs.gpu3dmarkPortRoyalScore].find((value) => value !== undefined && value > 0);
      const leftScore = score(left);
      const rightScore = score(right);
      if (leftScore === undefined) return rightScore === undefined ? left.name.localeCompare(right.name, "ko-KR") : 1;
      if (rightScore === undefined) return -1;
      return rightScore - leftScore || left.name.localeCompare(right.name, "ko-KR");
    }
    if (sort === "price_desc") return priceDescending(left, right);
    return priceAscending(left, right, true);
  });
}

function priceAscending(left: { priceWon?: number; dataQuality?: DataQuality }, right: { priceWon?: number; dataQuality?: DataQuality }, incompleteLast = false) {
  if (incompleteLast && left.dataQuality === "incomplete" && right.dataQuality !== "incomplete") return 1;
  if (incompleteLast && left.dataQuality !== "incomplete" && right.dataQuality === "incomplete") return -1;
  if (!isKnownPrice(left.priceWon)) return isKnownPrice(right.priceWon) ? 1 : 0;
  if (!isKnownPrice(right.priceWon)) return -1;
  return left.priceWon - right.priceWon;
}

function priceDescending(left: { priceWon?: number }, right: { priceWon?: number }) {
  if (!isKnownPrice(left.priceWon)) return isKnownPrice(right.priceWon) ? 1 : 0;
  if (!isKnownPrice(right.priceWon)) return -1;
  return right.priceWon - left.priceWon;
}

function partsResponse(snapshot: OfflineCatalogSnapshot, params: URLSearchParams, now: number) {
  assertSupportedQuery(params, PART_QUERY_KEYS);
  const categoryValue = params.get("category");
  const category = categoryValue && (PART_CATEGORIES as readonly string[]).includes(categoryValue) ? categoryValue as PartCategory : undefined;
  const rawQuality = params.get("quality");
  const quality = rawQuality && (DATA_QUALITY as readonly string[]).includes(rawQuality) ? rawQuality as DataQuality : "all";
  const freshness = enumParam(params, "freshness", FRESHNESS_FILTERS, "all");
  const priceStatus = enumParam(params, "priceStatus", PRICE_STATUSES, "all");
  const listingPolicy = enumParam(params, "listingPolicy", LISTING_POLICIES, "all");
  const sort = enumParam(params, "sort", PART_SORTS, "price_asc");
  const qualityFilter = (quality === "all" || DATA_QUALITY.includes(quality)) ? quality : "all";
  const requestedCategory = categoryValue && !category ? categoryValue : undefined;
  if (requestedCategory) error(400, "OFFLINE_QUERY_INVALID", "category 값이 지원되지 않습니다.");
  const query = params.get("q") ?? "";
  const brand = params.get("brand") ?? "";
  const partId = params.get("partId") ?? "";
  const missingField = params.get("missingField") ?? "";
  const limit = intParam(params, "limit", 40, 1, 100);
  const offset = intParam(params, "offset", 0, 0, Number.MAX_SAFE_INTEGER);
  assertValidPartSpecFilters(params);
  const candidates = snapshot.parts.filter((part) => (!category || part.category === category)
    && (!partId || part.id === partId)
    && qualityMatches(part, qualityFilter)
    && (freshness === "all" || freshnessMatches(part, freshness, now))
    && priceMatches(part, priceStatus)
    && isListingAllowed(part, listingPolicy)
    && (!missingField || part.missingFields.includes(missingField))
    && brandMatches(part, brand)
    && partMatchesQuery(part, query)
    && partSpecMatches(part, params));
  const items = sortParts(candidates, category, sort).slice(offset, offset + limit).map((part) => ({ ...part, dataFreshness: classifyDataFreshness(part.updatedAt, now) }));
  return { items, total: candidates.length, ...(category ? { category } : {}), ...(brand ? { brand } : {}), ...(partId ? { partId } : {}), offset, limit };
}

function compatiblePartsResponse(snapshot: OfflineCatalogSnapshot, body: Record<string, unknown>, now: number) {
  const category = typeof body.category === "string" && (PART_CATEGORIES as readonly string[]).includes(body.category)
    ? body.category as PartCategory
    : undefined;
  if (!category) error(400, "OFFLINE_CANDIDATE_CATEGORY_REQUIRED", "호환 부품을 찾으려면 지원 부품 범주가 필요합니다.");
  if (body.build === undefined) error(400, "OFFLINE_CANDIDATE_BUILD_REQUIRED", "호환 부품을 찾으려면 현재 견적이 필요합니다.");
  const build = validateBuild(body.build, snapshot);
  const riskFilter = ["safe", "review", "unsafe"].includes(String(body.riskFilter)) ? String(body.riskFilter) as "safe" | "review" | "unsafe" : "all";
  for (const key of ["performanceFilter", "physicalEvidenceFilter", "recommendationTrustFilter"] as const) {
    if (body[key] !== undefined && String(body[key]) !== "all") {
      error(501, "OFFLINE_FILTER_UNAVAILABLE", "이 필터는 로컬 설치판에 포함되지 않은 성능·출처 확인 자료가 필요합니다. 전체를 선택해 주세요.", { filter: key });
    }
  }
  const mode = body.mode === "no_blocker" ? "no_blocker" : body.mode === "precision" ? "precision" : "safe";
  const profileValue = body.profile;
  const profile = ["general", "gaming", "creator", "development", "office"].includes(String(profileValue))
    ? String(profileValue) as RecommendationPreferences["profile"]
    : "general";
  const preference = parseRecommendationPreferences({ profile, gamingResolution: body.gamingResolution, gamingRefreshRate: body.gamingRefreshRate });
  const gamingResolution = preference.gamingResolution ?? "1440p";
  const gamingRefreshRate = preference.gamingRefreshRate ?? 144;
  const findingRuleId = typeof body.findingRuleId === "string" ? body.findingRuleId : undefined;
  const intentFinding = findingRuleId
    ? evaluateBuild(build, snapshot.parts, { includeSuggestions: false, now }).findings.find((finding) => finding.ruleId === findingRuleId)
    : undefined;
  if (findingRuleId && !intentFinding) error(400, "OFFLINE_FINDING_RULE_NOT_FOUND", "현재 견적에서 해당 호환 규칙을 찾을 수 없습니다.");

  const rawQuality = typeof body.quality === "string" ? body.quality : "all";
  const quality = (DATA_QUALITY as readonly string[]).includes(rawQuality) ? rawQuality as DataQuality : "all";
  const priceStatus = (PRICE_STATUSES as readonly string[]).includes(String(body.priceStatus)) ? body.priceStatus as PriceAvailabilityFilter : "all";
  const rawFreshness = typeof body.freshness === "string" ? body.freshness : "all";
  const freshness = rawFreshness === "fresh" || rawFreshness === "aging" || rawFreshness === "stale" || rawFreshness === "unknown" ? rawFreshness : "all";
  const listingPolicy = (LISTING_POLICIES as readonly string[]).includes(String(body.listingPolicy)) ? body.listingPolicy as ListingPolicy : "retail_only";
  const rawSort = typeof body.sort === "string" ? body.sort : "price_asc";
  const sort = ["price_asc", "price_desc", "name", "updated", "similarity", "value"].includes(rawSort) ? rawSort as "price_asc" | "price_desc" | "name" | "updated" | "similarity" | "value" : "price_asc";
  const catalogSort = sort === "similarity" || sort === "value" ? "price_asc" : sort;
  const query = typeof body.q === "string" ? body.q : "";
  const brand = typeof body.brand === "string" ? body.brand.trim().slice(0, 80) : "";
  const requestedLimit = Number(body.limit ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 50;
  const requestedOffset = Number(body.offset ?? 0);
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0;
  const budgetProvided = Object.prototype.hasOwnProperty.call(body, "budgetWon");
  const budgetRaw = body.budgetWon;
  const budgetWon = budgetRaw === undefined || budgetRaw === null || budgetRaw === "" ? undefined : Number(budgetRaw);
  if (budgetProvided && budgetWon !== undefined && (!Number.isSafeInteger(budgetWon) || budgetWon <= 0)) error(400, "OFFLINE_CANDIDATE_BUDGET_INVALID", "교체 예산은 1원 이상의 정수여야 합니다.");

  const specParams = new URLSearchParams();
  if (body.specFilter !== undefined && !record(body.specFilter)) error(400, "OFFLINE_SPEC_FILTER_INVALID", "부품 사양 필터 형식이 올바르지 않습니다.");
  for (const [key, value] of Object.entries(record(body.specFilter) ? body.specFilter : {})) {
    if (!PART_SPEC_FILTERS.has(key)) error(501, "OFFLINE_FILTER_UNAVAILABLE", "이 사양 필터는 로컬 설치판에서 지원되지 않습니다.", { filter: key });
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") error(400, "OFFLINE_SPEC_FILTER_INVALID", "부품 사양 필터 형식이 올바르지 않습니다.", { filter: key });
    specParams.set(key, String(value));
  }
  assertValidPartSpecFilters(specParams);
  const categoryParts = snapshot.parts.filter((part) => part.category === category);
  const baseParts = categoryParts.filter((part) => brandMatches(part, brand)
    && qualityMatches(part, quality)
    && isListingAllowed(part, listingPolicy)
    && partMatchesQuery(part, query));
  const priceParts = baseParts.filter((part) => priceMatches(part, priceStatus));
  const freshnessParts = priceParts.filter((part) => freshness === "all" || freshnessMatches(part, freshness, now));
  const searchedParts = sortParts(freshnessParts, category, catalogSort as typeof PART_SORTS[number]);
  const specFilteredParts = searchedParts.filter((part) => partSpecMatches(part, specParams));
  const assessed = specFilteredParts.map((part) => ({
    part,
    assessment: assessAlternativePart(build, snapshot.parts, category, part, intentFinding),
    similarity: candidateSimilarityForBuild(build, snapshot.parts, category, part, profile, gamingResolution, gamingRefreshRate)
  }));
  const intentParts = intentFinding ? assessed.filter(({ assessment }) => assessment.fixesCurrentIssue === true) : assessed;
  const riskCounts = { safe: 0, review: 0, unsafe: 0 };
  for (const candidate of intentParts) riskCounts[candidate.assessment.risk] += 1;
  const selectedPartIds = new Set([
    build.cpu?.partId, build.cooler?.partId, build.motherboard?.partId, build.gpu?.partId, build.case?.partId, build.psu?.partId,
    ...build.memory.map((selection) => selection.partId), ...build.ssd.map((selection) => selection.partId), ...build.hdd.map((selection) => selection.partId)
  ].filter((partId): partId is string => Boolean(partId)));
  const incompleteParts = intentParts.filter(({ part }) => part.dataQuality === "incomplete" && !selectedPartIds.has(part.id));
  const incompleteExcludedCount = mode === "safe" ? incompleteParts.length : 0;
  const compatible = intentParts.filter(({ assessment }) => mode === "safe" ? assessment.risk === "safe" : mode === "no_blocker" ? assessment.risk !== "unsafe" : true);
  const riskFiltered = riskFilter === "all" ? compatible : compatible.filter(({ assessment }) => assessment.risk === riskFilter);
  const riskExcludedCount = compatible.length - riskFiltered.length;
  const budgetExcludedCount = budgetWon === undefined ? 0 : riskFiltered.filter(({ part, assessment }) => !isKnownPrice(part.priceWon) || part.priceWon * (assessment.recommendedQuantity ?? 1) > budgetWon).length;
  const matching = riskFiltered.filter(({ part, assessment }) => budgetWon === undefined || (isKnownPrice(part.priceWon) && part.priceWon * (assessment.recommendedQuantity ?? 1) <= budgetWon));
  if (sort === "similarity") matching.sort((left, right) => compareCandidateSimilarity(left.similarity, right.similarity) || left.part.name.localeCompare(right.part.name, "ko-KR"));
  if (sort === "value") matching.sort((left, right) => compareCandidateValue(left.similarity, right.similarity) || left.part.name.localeCompare(right.part.name, "ko-KR"));
  const payload = {
    items: matching.slice(offset, offset + limit).map(({ part, assessment, similarity }) => ({
      ...part,
      dataFreshness: classifyDataFreshness(part.updatedAt, now),
      candidateRisk: assessment.risk,
      candidateReasons: assessment.reasons,
      remainingBlockers: assessment.remainingBlockers,
      remainingWarnings: assessment.remainingWarnings,
      remainingUnknown: assessment.remainingUnknown,
      ...(assessment.recommendedQuantity !== undefined ? { recommendedQuantity: assessment.recommendedQuantity } : {}),
      ...similarity,
      ...(assessment.physicalEvidence ? { physicalEvidence: assessment.physicalEvidence } : {})
    })),
    total: matching.length,
    category,
    mode,
    ...(brand ? { brand } : {}),
    ...(priceStatus !== "all" ? { priceStatus, priceExcludedCount: baseParts.length - priceParts.length } : {}),
    ...(freshness !== "all" ? { freshness, freshnessExcludedCount: priceParts.length - freshnessParts.length } : {}),
    ...(specParams.size > 0 ? { specFilter: Object.fromEntries(specParams.entries()), specExcludedCount: searchedParts.length - specFilteredParts.length } : {}),
    ...(budgetWon !== undefined ? { budgetWon, budgetExcludedCount } : {}),
    ...(riskFilter !== "all" ? { riskFilter, riskExcludedCount } : {}),
    ...(incompleteExcludedCount > 0 ? { incompleteExcludedCount, incompleteMissingFields: catalogMissingFieldCountsFor(incompleteParts.map(({ part }) => part), 5) } : {}),
    ...(intentFinding ? { intentRuleId: intentFinding.ruleId, intentTitle: intentFinding.title } : {}),
    riskCounts,
    offset,
    limit
  };
  return publicApiPayloadProjection(payload);
}

function accessoryMatchesQuery(item: AccessoryItem, query: string) {
  const needle = query.trim().toLocaleLowerCase("ko-KR");
  if (!needle) return true;
  return [item.name, item.brand, item.model, item.rawSpecText].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR").includes(needle);
}

function accessoriesResponse(snapshot: OfflineCatalogSnapshot, params: URLSearchParams, now: number) {
  assertSupportedQuery(params, ACCESSORY_QUERY_KEYS);
  const categoryValue = params.get("category") ?? "all";
  const category = categoryValue === "all" || (ACCESSORY_CATEGORIES as readonly string[]).includes(categoryValue) ? categoryValue as AccessoryCategory | "all" : undefined;
  if (!category) error(400, "OFFLINE_QUERY_INVALID", "category 값이 지원되지 않습니다.");
  const qualityValue = params.get("quality") ?? "all";
  const quality = qualityValue === "all" || (DATA_QUALITY as readonly string[]).includes(qualityValue) ? qualityValue as DataQuality | "all" : undefined;
  if (!quality) error(400, "OFFLINE_QUERY_INVALID", "quality 값이 지원되지 않습니다.");
  const freshness = enumParam(params, "freshness", FRESHNESS_FILTERS, "all");
  const sort = enumParam(params, "sort", ACCESSORY_SORTS, "price_asc");
  const priceFilter = enumParam(params, "priceFilter", ACCESSORY_PRICE_FILTERS, "all");
  const limit = intParam(params, "limit", 40, 1, 100);
  const offset = intParam(params, "offset", 0, 0, Number.MAX_SAFE_INTEGER);
  const query = params.get("q") ?? "";
  const brand = params.get("brand") ?? "";
  const candidates = snapshot.accessories.filter((item) => (category === "all" || item.category === category)
    && qualityMatches(item, quality)
    && (freshness === "all" || freshnessMatches(item, freshness, now))
    && brandMatches(item, brand)
    && accessoryMatchesQuery(item, query)
    && isAccessoryPriceIncluded(item, priceFilter));
  const sorted = candidates.sort((left, right) => sort === "name"
    ? left.name.localeCompare(right.name, "ko-KR")
    : sort === "updated"
      ? right.updatedAt.localeCompare(left.updatedAt)
      : sort === "price_desc"
        ? priceDescending(left, right)
        : priceAscending(left, right));
  return { items: sorted.slice(offset, offset + limit).map((item) => ({ ...item, dataFreshness: classifyDataFreshness(item.updatedAt, now) })), total: candidates.length, category, priceFilter, offset, limit };
}

function isAccessoryPriceIncluded(item: AccessoryItem, filter: AccessoryPriceFilter) {
  if (filter === "all") return true;
  if (!isKnownPrice(item.priceWon)) return false;
  if (filter === "priced") return true;
  if (filter === "under_10000") return item.priceWon <= 10_000;
  if (filter === "10000_50000") return item.priceWon > 10_000 && item.priceWon <= 50_000;
  return item.priceWon > 50_000;
}

function brandCounts<T extends { brand?: string }>(items: T[]) {
  const counts = new Map<string, number>();
  for (const item of items) if (item.brand?.trim()) counts.set(item.brand.trim(), (counts.get(item.brand.trim()) ?? 0) + 1);
  return [...counts].map(([brand, count]) => ({ brand, count })).sort((left, right) => right.count - left.count || left.brand.localeCompare(right.brand, "ko-KR"));
}

function offlineMeta(snapshot: OfflineCatalogSnapshot) {
  const qualityCounts = Object.fromEntries(DATA_QUALITY.map((quality) => [quality, snapshot.parts.filter((part) => part.dataQuality === quality).length])) as Record<DataQuality, number>;
  const accessoryQualityCounts = Object.fromEntries(DATA_QUALITY.map((quality) => [quality, snapshot.accessories.filter((item) => item.dataQuality === quality).length])) as Record<DataQuality, number>;
  const categoryCounts = Object.fromEntries(PART_CATEGORIES.map((category) => [category, snapshot.parts.filter((part) => part.category === category).length])) as Record<PartCategory, number>;
  const accessoryCategoryCounts = Object.fromEntries(ACCESSORY_CATEGORIES.map((category) => [category, snapshot.accessories.filter((item) => item.category === category).length])) as Record<AccessoryCategory, number>;
  const catalogBrandCounts = Object.fromEntries(PART_CATEGORIES.map((category) => [category, brandCounts(snapshot.parts.filter((part) => part.category === category))])) as Partial<ServiceMeta["catalogBrandCounts"]>;
  const accessoryBrandCounts = Object.fromEntries(ACCESSORY_CATEGORIES.map((category) => [category, brandCounts(snapshot.accessories.filter((item) => item.category === category))])) as Partial<ServiceMeta["accessoryBrandCounts"]>;
  const pricedParts = snapshot.parts.filter((part) => isKnownPrice(part.priceWon)).length;
  const pricedAccessories = snapshot.accessories.filter((item) => isKnownPrice(item.priceWon)).length;
  return {
    mode: "local-offline" as const,
    catalogCount: snapshot.parts.length,
    catalogEligibleCount: snapshot.parts.length,
    catalogBrandCounts,
    categoryCounts,
    qualityCounts,
    priceCoverage: { priced: pricedParts, unpriced: snapshot.parts.length - pricedParts },
    catalogUpdatedAt: snapshot.manifest.snapshotAt,
    accessoryCount: snapshot.accessories.length,
    accessoryCategoryCounts,
    accessoryBrandCounts,
    accessoryQualityCounts,
    accessoryPriceCoverage: { priced: pricedAccessories, unpriced: snapshot.accessories.length - pricedAccessories },
    accessoryUpdatedAt: snapshot.manifest.accessorySnapshotAt,
    engineVersion: ENGINE_VERSION,
    offlineSnapshot: snapshot.manifest
  };
}

function validateBuild(value: unknown, snapshot: OfflineCatalogSnapshot): BuildSelection {
  const parsed = parseBuild(value);
  if (parsed.errors.length > 0) error(400, "OFFLINE_BUILD_INVALID", "견적 입력 형식이 올바르지 않습니다.", parsed.errors);
  const build = parsed.build;
  const partSelections: Array<{ category: PartCategory; partId: string }> = [
    ...(["cpu", "cooler", "motherboard", "gpu", "case", "psu"] as const).flatMap((category) => build[category] ? [{ category, partId: build[category]!.partId }] : []),
    ...build.memory.map((selection) => ({ category: "memory" as const, partId: selection.partId })),
    ...build.ssd.map((selection) => ({ category: "ssd" as const, partId: selection.partId })),
    ...build.hdd.map((selection) => ({ category: "hdd" as const, partId: selection.partId }))
  ];
  for (const selection of partSelections) {
    if (!snapshot.parts.some((part) => part.id === selection.partId && part.category === selection.category)) {
      error(400, "OFFLINE_BUILD_PART_MISSING", "견적에 포함된 부품이 이 로컬 snapshot에 없습니다.", { partId: selection.partId, category: selection.category });
    }
  }
  const accessorySelections = build.accessories ?? [];
  if (validateAccessorySelectionIds(accessorySelections, snapshot.accessories).length > 0) error(400, "OFFLINE_BUILD_ACCESSORY_MISSING", "견적에 포함된 주변 부품이 이 로컬 snapshot에 없습니다.");
  const selectedSsdIds = new Set(build.ssd.filter((selection) => snapshot.parts.some((part) => part.id === selection.partId && part.category === "ssd")).map((selection) => selection.partId));
  if (accessorySelections.some((selection) => selection.targetPartId !== undefined && !selectedSsdIds.has(selection.targetPartId))) error(400, "OFFLINE_BUILD_TARGET_INVALID", "주변 부품 연결 대상 SSD가 현재 견적에 없습니다.");
  if (validateAccessoryTargetAccessoryIds(build, snapshot.accessories).length > 0) error(400, "OFFLINE_BUILD_TARGET_INVALID", "주변 부품 연결 대상 팬 허브가 현재 견적에 없습니다.");
  if (validateRgbControllerAccessoryId(build, snapshot.accessories).length > 0) error(400, "OFFLINE_BUILD_RGB_CONTROLLER_INVALID", "RGB 연결 컨트롤러가 현재 견적에 선택되어 있지 않습니다.");
  const selectedSsdSelectionIds = new Set(build.ssd.map((selection) => selection.partId));
  if (Object.entries(build.m2SlotSelection ?? {}).some(([, partId]) => !selectedSsdSelectionIds.has(partId) || !snapshot.parts.some((part) => part.id === partId && part.category === "ssd"))) error(400, "OFFLINE_BUILD_M2_SLOT_INVALID", "M.2 슬롯에 연결한 SSD가 현재 견적에 없습니다.");
  return build;
}

function parseBody(init?: Pick<RequestInit, "body">): Record<string, unknown> {
  if (typeof init?.body !== "string") error(400, "OFFLINE_BODY_INVALID", "요청 본문이 필요합니다.");
  if (init.body.length > 1_000_000) error(413, "REQUEST_BODY_TOO_LARGE", "요청 본문이 너무 큽니다.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(init.body);
  } catch {
    error(400, "INVALID_JSON", "요청 본문 JSON 형식이 올바르지 않습니다.");
  }
  if (!record(parsed)) error(400, "OFFLINE_BODY_INVALID", "요청 본문은 JSON 객체여야 합니다.");
  return parsed;
}

function compatibilityResult(snapshot: OfflineCatalogSnapshot, body: Record<string, unknown>, now: number) {
  const build = validateBuild(body, snapshot);
  const preferences = parseRecommendationPreferences(body.recommendationPreferences);
  const result = evaluateBuildWithAccessories(build, snapshot.parts, snapshot.accessories, {
    catalogSnapshotAt: snapshot.manifest.snapshotAt,
    recommendationPreferences: preferences,
    gamingPerformanceEvidence: [],
    now
  });
  const projected = compatibilityResultForPublicTransport(result);
  return { ...(record(projected) ? projected : {}), offlineSnapshotRevision: snapshot.manifest.revision, offlineSnapshotAt: snapshot.manifest.snapshotAt };
}

function recommendationResult(snapshot: OfflineCatalogSnapshot, body: Record<string, unknown>, now: number) {
  const parsedRequest = parseBuildGenerationRequest(body);
  if (parsedRequest.errors.length > 0 || !parsedRequest.request) error(400, "OFFLINE_RECOMMENDATION_INVALID", "자동 견적 조건을 다시 확인해 주세요.", parsedRequest.errors);
  const request = parsedRequest.request;
  try {
    const result = generateBuildDraft(snapshot.parts, request, [], { now });
    return publicApiPayloadProjection({ ...result, offlineSnapshotRevision: snapshot.manifest.revision, offlineSnapshotAt: snapshot.manifest.snapshotAt });
  } catch (caught) {
    if (caught instanceof BuildGenerationError) {
      error(422, "OFFLINE_RECOMMENDATION_FAILED", caught.message, { diagnostics: caught.diagnostics, recoveryOptions: buildGenerationRecoveryOptionsFor(snapshot.parts, request) });
    }
    error(422, "OFFLINE_RECOMMENDATION_FAILED", caught instanceof Error ? caught.message : "현재 snapshot으로 자동 구성을 만들지 못했습니다.");
  }
}

function splitIds(value: string | null) {
  if (!value) return [];
  const ids = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (ids.length > BUILD_INPUT_MAX_SELECTIONS_PER_LIST || ids.some((id) => id.length > BUILD_INPUT_MAX_ID_LENGTH)) error(400, "OFFLINE_BATCH_INVALID", "한 번에 부품 100개까지 조회할 수 있습니다.");
  return ids;
}

function batchItems<T extends { id: string }>(items: T[], ids: string[]) {
  const lookup = new Map(items.map((item) => [item.id, item]));
  return { items: ids.map((id) => lookup.get(id)).filter((item): item is T => Boolean(item)), missingIds: ids.filter((id) => !lookup.has(id)) };
}

function batchIdsFromUnknown(value: unknown) {
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string" && id.length > 0 && id.length <= BUILD_INPUT_MAX_ID_LENGTH)) error(400, "OFFLINE_BATCH_INVALID", "ID 목록 형식이 올바르지 않습니다.");
  const ids = [...new Set(value)];
  if (ids.length > BUILD_INPUT_MAX_SELECTIONS_PER_LIST) error(400, "OFFLINE_BATCH_INVALID", "한 번에 100개까지 조회할 수 있습니다.");
  return ids;
}

function assertRequestNotAborted(signal?: AbortSignal | null) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError");
}

export async function offlineApiRequest<T>(path: string, init: RequestInit | undefined, snapshotValue: unknown, now = Date.now()): Promise<T> {
  assertRequestNotAborted(init?.signal);
  const snapshot = (() => {
    try {
      return requireOfflineCatalogSnapshot(snapshotValue);
    } catch {
      error(503, "OFFLINE_SNAPSHOT_UNAVAILABLE", "설치된 로컬 카탈로그를 확인할 수 없습니다. 이 빌드에는 유효한 snapshot이 필요합니다.");
    }
  })();
  let url: URL;
  try {
    url = new URL(path, "https://local.invalid");
  } catch {
    error(501, "OFFLINE_FEATURE_UNAVAILABLE", "이 기능은 로컬 설치 모드에서 사용할 수 없습니다.", { path });
  }
  if (url.origin !== "https://local.invalid") error(501, "OFFLINE_FEATURE_UNAVAILABLE", "외부 서버 요청은 로컬 설치 모드에서 사용할 수 없습니다.", { path });
  const method = (init?.method ?? "GET").toUpperCase();
  if (url.pathname === "/api/health" && method === "GET") return publicApiPayloadProjection({ ok: true, service: "pc-supporter", engineVersion: ENGINE_VERSION, mode: "local-offline", snapshot: snapshot.manifest }) as T;
  if (url.pathname === "/api/meta" && method === "GET") return publicApiPayloadProjection(offlineMeta(snapshot)) as T;
  if (url.pathname === "/api/parts" && method === "GET") return publicApiPayloadProjection(partsResponse(snapshot, url.searchParams, now)) as T;
  if (url.pathname === "/api/parts/batch" && method === "GET") return publicApiPayloadProjection(batchItems(snapshot.parts, splitIds(url.searchParams.get("ids")))) as T;
  if (url.pathname === "/api/parts/batch" && method === "POST") return publicApiPayloadProjection(batchItems(snapshot.parts, batchIdsFromUnknown(parseBody(init).ids))) as T;
  if (url.pathname === "/api/parts/compatible" && method === "POST") return compatiblePartsResponse(snapshot, parseBody(init), now) as T;
  if (url.pathname === "/api/parts" && method !== "GET") error(501, "OFFLINE_FEATURE_UNAVAILABLE", "카탈로그 쓰기는 로컬 설치 모드에서 사용할 수 없습니다.");
  const partMatch = url.pathname.match(/^\/api\/parts\/([^/]+)$/);
  if (partMatch && method === "GET") {
    const id = decodeURIComponent(partMatch[1]!);
    const part = snapshot.parts.find((candidate) => candidate.id === id);
    if (!part) error(404, "PART_NOT_FOUND", "부품을 찾을 수 없습니다.");
    return publicApiPayloadProjection({ ...part, dataFreshness: classifyDataFreshness(part.updatedAt, now) }) as T;
  }
  if (partMatch && url.pathname.endsWith("/refresh")) error(501, "OFFLINE_FEATURE_UNAVAILABLE", "실시간 상품 갱신은 로컬 설치 모드에서 사용할 수 없습니다.");
  if (url.pathname === "/api/accessories" && method === "GET") return publicApiPayloadProjection(accessoriesResponse(snapshot, url.searchParams, now)) as T;
  if (url.pathname === "/api/accessories/batch" && method === "POST") {
    return publicApiPayloadProjection(batchItems(snapshot.accessories, batchIdsFromUnknown(parseBody(init).ids))) as T;
  }
  const accessoryMatch = url.pathname.match(/^\/api\/accessories\/([^/]+)$/);
  if (accessoryMatch && method === "GET") {
    const id = decodeURIComponent(accessoryMatch[1]!);
    const item = snapshot.accessories.find((candidate) => candidate.id === id);
    if (!item) error(404, "ACCESSORY_NOT_FOUND", "주변 부품을 찾을 수 없습니다.");
    return publicApiPayloadProjection({ ...item, dataFreshness: classifyDataFreshness(item.updatedAt, now) }) as T;
  }
  if (url.pathname === "/api/compatibility/check" && method === "POST") return compatibilityResult(snapshot, parseBody(init), now) as T;
  if (url.pathname === "/api/builds/recommend" && method === "POST") return recommendationResult(snapshot, parseBody(init), now) as T;
  error(503, "OFFLINE_FEATURE_UNAVAILABLE", "이 기능은 로컬 설치 모드에서 사용할 수 없습니다.", { path, method });
}
