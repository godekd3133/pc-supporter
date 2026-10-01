import type { BenchmarkAvailabilityFilter, BenchmarkSourceCoverage, CatalogBenchmarkCoverage, BrandCountOption, DataFreshness, DataQuality, ListingPolicy, Part, PartCategory, PriceAvailabilityFilter, ServiceMeta } from "../shared/types";
import type { CatalogSnapshot } from "./catalog-snapshot";
import { catalogCategoryIntegritySummaryFor, catalogCategoryMismatchFor } from "../shared/catalog-category-integrity";
import { catalogSpecCoverageFor } from "../shared/catalog-spec-coverage";
import { isKnownPrice, PART_CATEGORIES } from "../shared/types";
import { starterCatalog } from "./seed-catalog-starter";
import {
  CASE_RGB_LOAD_OVERRIDES_PATH,
  GPU_PHYSICAL_OVERRIDES_PATH,
  fileUpdatedAt
} from "./storage";
import { patchCatalogPriceRecords, readAccessoryCoverageRecord, readCatalogOverrideMapUpdatedAtRecords, readCatalogRecords, readCatalogVersionStamp, readBenchmarkOverrideRecords, writeCatalogRecords } from "./repository";
import { inferListingType, isListingAllowed, isQuoteBrandAllowed, isQuoteSelectable } from "./listing";
import { recommendationFloorWonFor } from "../shared/domain/engine";
import { accessoryMeta, loadAccessories, readAccessoryCoverage } from "./accessories";
import { reparseDanawaPart } from "./danawa";
import { applyM2SlotOverrides, readM2SlotOverrides, stripM2SlotOverride } from "./m2-overrides";
import { applyBenchmarkOverrides, readBenchmarkOverrides } from "./benchmark-overrides";
import { applyGpuPhysicalOverrides, readGpuPhysicalOverrides, stripGpuPhysicalOverrides } from "./gpu-physical-overrides";
import { applyCaseRgbLoadOverrides, readCaseRgbLoadOverrides, stripCaseRgbLoadOverride } from "./case-rgb-load-overrides";
import { applyCatalogSpecOverrides, readCatalogSpecOverrides, stripCatalogSpecOverride } from "./catalog-spec-overrides";
import { loadEngineTargetFiltersConfig } from "./engine-target-filters";
import { engineTargetFilterRuleAllowsPart, engineTargetFilterRuleForCategory, engineTargetFilterRuleFromUnknown } from "../shared/engine-target-filters";
import type { EngineCategoryTargetFilter } from "../shared/engine-target-filters";
import { classifyDataFreshness, nextDataFreshnessChangeAt } from "../shared/data-freshness";
import { benchmarkAvailabilityMatchesFilter } from "../shared/benchmark-evidence";
import { pcieCompatibleSlotInventoryFor, pcieSlotWidthFromUnknown, type PcieSlotWidth } from "../shared/pcie-slot";
import { brandCountsFor } from "../shared/brand-counts";

let catalogCache: Part[] | null = null;
let catalogCacheStamp: string | null = null;
let catalogRuntimeRevision = 0;
let catalogLoadInFlight: Promise<Part[]> | null = null;

type CatalogMeta = Pick<ServiceMeta, "catalogCount" | "catalogEligibleCount" | "catalogExcludedNonCoreCount" | "catalogCategoryIntegrity" | "catalogBrandCounts" | "catalogEligibleQualityCounts" | "catalogEligiblePriceCoverage" | "accessoryCount" | "accessoryCategoryCounts" | "accessoryBrandCounts" | "accessoryCategoryQualityCounts" | "accessoryQualityCounts" | "accessoryPriceCoverage" | "accessoryUpdatedAt" | "accessoryCoverage" | "benchmarkCoverage" | "catalogSpecCoverage" | "categoryCounts" | "qualityCounts" | "priceCoverage" | "catalogUpdatedAt" | "recommendationFloorWon">;

let catalogMetaCache: {
  catalog: Part[];
  accessories: Awaited<ReturnType<typeof loadAccessories>>;
  accessoryCoverageUpdatedAt: string;
  catalogSpecCoverageValidUntil: number;
  catalogUpdatedAt: string;
  accessoryUpdatedAt: string;
  value: CatalogMeta;
} | null = null;
let catalogMetaInFlight: Promise<CatalogMeta> | null = null;
let catalogUpdatedAtCache: { catalog: Part[]; value: string } | null = null;

export function seedBaseFor(_persisted: Part[]) {
  // The curated starter catalog is a stable fallback, not a bootstrap-only
  // snapshot. Keep all 90 reference parts available after live Danawa rows
  // have been persisted; live rows use their source-product key and remain
  // separate from these seed records in mergeCatalog().
  return starterCatalog;
}

async function readCatalogOverrideMaps() {
  return Promise.all([
    readCatalogSpecOverrides(),
    readBenchmarkOverrides(),
    readM2SlotOverrides(),
    readGpuPhysicalOverrides(),
    readCaseRgbLoadOverrides()
  ]);
}

type CatalogOverrideMaps = Awaited<ReturnType<typeof readCatalogOverrideMaps>>;

function applyCatalogOverrideMaps(baseCatalog: Part[], [catalogSpecOverrides, benchmarkOverrides, m2Overrides, gpuPhysicalOverrides, caseRgbLoadOverrides]: CatalogOverrideMaps) {
  return applyCaseRgbLoadOverrides(
    applyGpuPhysicalOverrides(
      applyM2SlotOverrides(
        applyBenchmarkOverrides(applyCatalogSpecOverrides(baseCatalog, catalogSpecOverrides), benchmarkOverrides),
        m2Overrides
      ),
      gpuPhysicalOverrides
    ),
    caseRgbLoadOverrides
  );
}

function catalogKey(part: Part) {
  return part.sourceProductCode
    ? `${part.category}:danawa:${part.sourceProductCode}`
    : `${part.category}:${part.id}`;
}

function dataQualityRank(part: Part) {
  if (part.dataQuality === "manual") return 4;
  if (part.dataQuality === "live") return 3;
  if (part.dataQuality === "seed") return 2;
  return 1;
}

export function mergeCatalog(base: Part[], incoming: Part[]) {
  const merged = new Map<string, Part>();
  for (const part of base) merged.set(catalogKey(part), part);
  for (const part of incoming) {
    const key = catalogKey(part);
    const existing = merged.get(key);
    if (!existing || dataQualityRank(part) >= dataQualityRank(existing)) {
      merged.set(key, existing ? {
        ...existing,
        ...part,
        imageUrl: part.imageUrl ?? existing.imageUrl,
        priceWon: isKnownPrice(part.priceWon) ? part.priceWon : isKnownPrice(existing.priceWon) ? existing.priceWon : undefined,
        rawSpecText: part.rawSpecText || existing.rawSpecText,
        specs: { ...existing.specs, ...part.specs }
      } : part);
    }
  }
  return [...merged.values()];
}

export function mergeDanawaSnapshot(base: Part[], incoming: Part[], categories: PartCategory[]) {
  const categorySet = new Set(categories);
  const retained = base.filter((part) => !(part.source === "danawa" && categorySet.has(part.category)));
  return mergeCatalog(retained, incoming);
}

async function loadCatalogUncoalesced() {
  // DB가 진짜 소스다 — 다만 전체 행 재구성은 요청마다 수 초를 쓰므로
  // 건수+최신 updated_at 스탬프가 같으면 캐시를 그대로 돌려준다. 파일 기반
  // 오버라이드(GPU 물리·RGB 부하)는 인프로세스 쓰기라 invalidateCatalogCache로
  // 무효화된다. 스탬프는 읽기 전에 잡아 읽기 도중 끼어든 쓰기를 놓치지 않는다.
  try {
    const stampBefore = await readCatalogVersionStamp();
    if (catalogCache && catalogCacheStamp === stampBefore) return catalogCache;
    const persisted = await readCatalogRecords();
    const overrideMaps = await readCatalogOverrideMaps();
    catalogCache = applyCatalogOverrideMaps(
      mergeCatalog(seedBaseFor(persisted), persisted.map((part) => reparseDanawaPart(part))),
      overrideMaps
    );
    catalogCacheStamp = stampBefore;
    return catalogCache;
  } catch (error) {
    // DB 일시 실패에도 마지막 카탈로그로 추천을 이어간다.
    if (catalogCache) return catalogCache;
    throw error;
  }
}

export async function loadCatalog() {
  if (catalogLoadInFlight) return catalogLoadInFlight;
  const promise = loadCatalogUncoalesced();
  catalogLoadInFlight = promise;
  try {
    return await promise;
  } finally {
    if (catalogLoadInFlight === promise) catalogLoadInFlight = null;
  }
}

export function invalidateCatalogCache() {
  catalogLoadInFlight = null;
  catalogCache = null;
  catalogCacheStamp = null;
  catalogRuntimeRevision += 1;
}

export function currentCatalogRuntimeRevision() {
  return catalogRuntimeRevision;
}

export function getCatalogSync() {
  if (!catalogCache) throw new Error("Catalog has not been loaded yet");
  return catalogCache;
}

export async function saveCatalog(parts: Part[]) {
  const baseCatalog = mergeCatalog([], parts.map((part) => stripCatalogSpecOverride(stripCaseRgbLoadOverride(stripGpuPhysicalOverrides(stripM2SlotOverride(part))))));
  await writeCatalogRecords(baseCatalog);
  const overrideMaps = await readCatalogOverrideMaps();
  catalogCache = applyCatalogOverrideMaps(baseCatalog, overrideMaps);
  catalogCacheStamp = null;
  catalogRuntimeRevision += 1;
  return catalogCache;
}

async function upsertCatalogUnlocked(
  parts: Part[],
  options: { replaceDanawaCategories?: PartCategory[] } = {}
) {
  const current = (await loadCatalog()).map((part) => stripCatalogSpecOverride(stripCaseRgbLoadOverride(stripGpuPhysicalOverrides(stripM2SlotOverride(part)))));
  const incoming = parts.map((part) => stripCatalogSpecOverride(stripCaseRgbLoadOverride(stripGpuPhysicalOverrides(stripM2SlotOverride(part)))));
  const replaceDanawaCategories = options.replaceDanawaCategories ?? [];
  const baseCatalog = replaceDanawaCategories.length > 0
    ? mergeDanawaSnapshot(current, incoming, replaceDanawaCategories)
    : mergeCatalog(current, incoming);
  await writeCatalogRecords(baseCatalog, { replaceDanawaCategories });
  const overrideMaps = await readCatalogOverrideMaps();
  catalogCache = applyCatalogOverrideMaps(baseCatalog, overrideMaps);
  catalogCacheStamp = null;
  catalogRuntimeRevision += 1;
  return catalogCache;
}

export async function upsertCatalog(
  parts: Part[],
  options: { replaceDanawaCategories?: PartCategory[] } = {}
) {
  return upsertCatalogUnlocked(parts, options);
}

export interface CatalogPricePatch {
  id: string;
  sourceProductCode: string;
  danawaUrl: string;
  priceWon: number;
  priceCheckedAt: string;
}

export async function patchCatalogPrices(patches: CatalogPricePatch[]) {
  if (patches.length === 0) return [];
  const patched = await patchCatalogPriceRecords(patches);
  if (!patched) return [];
  invalidateCatalogCache();
  await loadCatalog();
  return patched;
}

export function findPart(catalog: Part[], partId: string) {
  return catalog.find((part) => part.id === partId);
}

function validBenchmarkValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function benchmarkSourceCoverageFor(parts: Part[], scoreKeys: readonly string[]): BenchmarkSourceCoverage {
  const coverage: BenchmarkSourceCoverage = {
    benchmarked: 0,
    complete: 0,
    official: 0,
    independent_review: 0,
    community_measurement: 0,
    other: 0,
    unclassified: 0
  };
  for (const part of parts) {
    const validScores = scoreKeys.filter((key) => validBenchmarkValue(part.specs[key as keyof Part["specs"]]));
    const hasBenchmark = validScores.length > 0;
    if (!hasBenchmark) continue;
    coverage.benchmarked += 1;
    if (validScores.length === scoreKeys.length) coverage.complete += 1;
    const sourceKind = part.specs.benchmarkProvenance?.sourceKind;
    if (sourceKind) coverage[sourceKind] += 1;
    else coverage.unclassified += 1;
  }
  return coverage;
}

export function benchmarkCoverageForCatalog(catalog: Part[]): CatalogBenchmarkCoverage {
  const cpu = catalog.filter((part) => part.category === "cpu");
  const cinebenchR23Single = cpu.filter((part) => validBenchmarkValue(part.specs.cinebenchR23Single)).length;
  const cinebenchR23Multi = cpu.filter((part) => validBenchmarkValue(part.specs.cinebenchR23Multi)).length;
  const cinebenchR23Complete = cpu.filter((part) => validBenchmarkValue(part.specs.cinebenchR23Single) && validBenchmarkValue(part.specs.cinebenchR23Multi)).length;
  const gpu = catalog.filter((part) => part.category === "gpu");
  const threeDMarkTimeSpy = gpu.filter((part) => validBenchmarkValue(part.specs.gpu3dmarkTimeSpyScore)).length;
  const threeDMarkPortRoyal = gpu.filter((part) => validBenchmarkValue(part.specs.gpu3dmarkPortRoyalScore)).length;
  const threeDMarkComplete = gpu.filter((part) => validBenchmarkValue(part.specs.gpu3dmarkTimeSpyScore) && validBenchmarkValue(part.specs.gpu3dmarkPortRoyalScore)).length;
  return {
    cpu: {
      total: cpu.length,
      cinebenchR23Single,
      cinebenchR23Multi,
      cinebenchR23Complete
    },
    gpu: {
      total: gpu.length,
      threeDMarkTimeSpy,
      threeDMarkPortRoyal,
      threeDMarkComplete
    },
    sourceCoverage: {
      cpu: benchmarkSourceCoverageFor(cpu, ["cinebenchR23Single", "cinebenchR23Multi"]),
      gpu: benchmarkSourceCoverageFor(gpu, ["gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore"])
    }
  };
}

export interface PartSpecFilter {
  minVramGb?: number;
  minCapacityGb?: number;
  minWattageW?: number;
  minMemorySpeedMhz?: number;
  interface?: "NVMe" | "SATA";
  socket?: string;
  memoryType?: string;
  formFactor?: string;
  minMemorySlots?: number;
  minM2Slots?: number;
  minSataPorts?: number;
  pcieSlotWidth?: PcieSlotWidth;
  minPcieSlotCount?: number;
  pcieSlotInfo?: "complete" | "missing";
  minHddBays?: number;
  minMaxGpuLengthMm?: number;
  minMaxCoolerHeightMm?: number;
  minMaxPsuLengthMm?: number;
  minCoolingW?: number;
  maxLengthMm?: number;
  maxPsuDepthMm?: number;
}

export interface PartSpecFilterDiagnostic {
  key: keyof PartSpecFilter;
  label: string;
  excludedCount: number;
  missingCount: number;
}

export interface ParsedPartSpecFilter {
  filter: PartSpecFilter;
  errors: string[];
}

export interface ParsedCatalogMissingField {
  value?: string;
  error?: string;
}

// 공개 부품 찾기의 다나와식 세부 조건 — 쿼리 파라미터로 주고받는다.
//   db=제조사1,제조사2           제조사 다중 선택(정확 일치 OR)
//   dv.<스펙필드>=값1,값2         스펙 값 다중 선택(필드 안 OR, 필드 사이 AND)
//   dr.<스펙필드>=최소-최대;...   수치 범위 다중 선택
//   df.<플래그필드>=1             부울 플래그(내장 그래픽·Wi-Fi 등)
//   dprice=최소-최대            가격대
// 허용 필드는 범주별 ENGINE_TARGET_FILTER_FACETS 선언으로 제한한다.
export const CATALOG_DETAIL_FILTER_PREFIXES = { values: "dv.", ranges: "dr.", flags: "df." } as const;
const CATALOG_DETAIL_BRANDS_PARAM = "db";
const CATALOG_DETAIL_PRICE_PARAM = "dprice";

function detailFilterValueList(raw: unknown): unknown[] {
  const items = Array.isArray(raw) ? raw : [raw];
  return items.flatMap((item) => String(item ?? "").split(",")).map((item) => item.trim()).filter((item) => item.length > 0);
}

function detailFilterRangeFromText(raw: string) {
  const boundary = raw.indexOf("-");
  const minRaw = (boundary < 0 ? raw : raw.slice(0, boundary)).trim();
  const maxRaw = boundary < 0 ? "" : raw.slice(boundary + 1).trim();
  const range: { min?: number; max?: number } = {};
  if (minRaw !== "") range.min = Number(minRaw);
  if (maxRaw !== "") range.max = Number(maxRaw);
  return range;
}

export function parseCatalogDetailFilterQuery(query: Record<string, unknown>, category: PartCategory | undefined): { filter: EngineCategoryTargetFilter | undefined; errors: string[] } {
  if (!category) return { filter: undefined, errors: [] };
  const errors: string[] = [];
  const candidate: Record<string, unknown> = {};
  const specValues: Record<string, unknown> = {};
  const numericRanges: Record<string, unknown> = {};
  const flags: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(query)) {
    if (key === CATALOG_DETAIL_BRANDS_PARAM) {
      const values = detailFilterValueList(raw);
      if (values.length > 0) candidate.brands = values;
      continue;
    }
    if (key === CATALOG_DETAIL_PRICE_PARAM) {
      const text = String(raw ?? "").trim();
      if (text) candidate.priceWon = detailFilterRangeFromText(text);
      continue;
    }
    if (key.startsWith(CATALOG_DETAIL_FILTER_PREFIXES.values)) {
      const field = key.slice(CATALOG_DETAIL_FILTER_PREFIXES.values.length);
      const values = detailFilterValueList(raw);
      if (values.length > 0) specValues[field] = values;
      continue;
    }
    if (key.startsWith(CATALOG_DETAIL_FILTER_PREFIXES.ranges)) {
      const field = key.slice(CATALOG_DETAIL_FILTER_PREFIXES.ranges.length);
      const ranges = String(raw ?? "").split(";").map((token) => token.trim()).filter(Boolean).map(detailFilterRangeFromText);
      if (ranges.length > 0) numericRanges[field] = ranges;
      continue;
    }
    if (key.startsWith(CATALOG_DETAIL_FILTER_PREFIXES.flags)) {
      const field = key.slice(CATALOG_DETAIL_FILTER_PREFIXES.flags.length);
      const normalized = String(raw ?? "").trim().toLowerCase();
      if (normalized === "1" || normalized === "true") flags[field] = true;
      else if (normalized === "0" || normalized === "false") flags[field] = false;
      else errors.push(`세부 조건 ${field}은 1 또는 0이어야 합니다.`);
    }
  }
  if (Object.keys(specValues).length > 0) candidate.specValues = specValues;
  if (Object.keys(numericRanges).length > 0) candidate.numericRanges = numericRanges;
  if (Object.keys(flags).length > 0) candidate.flags = flags;
  const rule = engineTargetFilterRuleFromUnknown(Object.keys(candidate).length > 0 ? candidate : undefined, category, errors);
  return { filter: engineTargetFilterRuleForCategory(rule, category), errors };
}

export function parseCatalogMissingField(input: unknown): ParsedCatalogMissingField {
  if (input === undefined || input === null || input === "") return {};
  if (typeof input !== "string") return { error: "누락 필드는 문자열이어야 합니다." };
  const value = input.trim();
  if (value.length === 0) return {};
  if (value.length > 120) return { error: "누락 필드는 120자 이하로 입력해야 합니다." };
  return { value };
}

export function parsePartSpecFilter(input: unknown): ParsedPartSpecFilter {
  if (input === undefined || input === null || input === "") return { filter: {}, errors: [] };
  if (typeof input !== "object" || Array.isArray(input)) return { filter: {}, errors: ["스펙 필터 형식이 올바르지 않습니다."] };
  const candidate = input as Record<string, unknown>;
  const filter: PartSpecFilter = {};
  const errors: string[] = [];
  const numericFields: Array<[keyof Pick<PartSpecFilter, "minVramGb" | "minCapacityGb" | "minWattageW" | "minMemorySpeedMhz" | "minMemorySlots" | "minM2Slots" | "minSataPorts" | "minPcieSlotCount" | "minHddBays" | "minMaxGpuLengthMm" | "minMaxCoolerHeightMm" | "minMaxPsuLengthMm" | "minCoolingW" | "maxLengthMm" | "maxPsuDepthMm">, string]> = [
    ["minVramGb", "최소 VRAM"],
    ["minCapacityGb", "최소 용량"],
    ["minWattageW", "최소 정격 출력"],
    ["minMemorySpeedMhz", "최소 메모리 속도"],
    ["minMemorySlots", "최소 RAM 슬롯"],
    ["minM2Slots", "최소 M.2 슬롯"],
    ["minSataPorts", "최소 SATA 포트"],
    ["minPcieSlotCount", "최소 PCIe 슬롯 수"],
    ["minHddBays", "최소 HDD 베이"],
    ["minMaxGpuLengthMm", "최소 GPU 허용 길이"],
    ["minMaxCoolerHeightMm", "최소 쿨러 허용 높이"],
    ["minMaxPsuLengthMm", "최소 PSU 허용 길이"],
    ["minCoolingW", "최소 냉각 용량"],
    ["maxLengthMm", "최대 GPU 길이"],
    ["maxPsuDepthMm", "최대 PSU 깊이"]
  ];
  for (const [key, label] of numericFields) {
    const raw = candidate[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      errors.push(`${label}은 1 이상의 정수여야 합니다.`);
      continue;
    }
    filter[key] = value;
  }
  if (candidate.pcieSlotWidth !== undefined && candidate.pcieSlotWidth !== null && candidate.pcieSlotWidth !== "") {
    const value = pcieSlotWidthFromUnknown(candidate.pcieSlotWidth);
    if (value === undefined) errors.push("PCIe 슬롯 폭은 x1, x4, x8 또는 x16이어야 합니다.");
    else filter.pcieSlotWidth = value;
  }
  if (candidate.pcieSlotInfo !== undefined && candidate.pcieSlotInfo !== null && candidate.pcieSlotInfo !== "") {
    if (candidate.pcieSlotInfo !== "complete" && candidate.pcieSlotInfo !== "missing") errors.push("PCIe 슬롯 정보 상태는 complete 또는 missing이어야 합니다.");
    else filter.pcieSlotInfo = candidate.pcieSlotInfo;
  }
  const textFields: Array<[keyof Pick<PartSpecFilter, "socket" | "memoryType" | "formFactor">, string]> = [
    ["socket", "소켓"],
    ["memoryType", "메모리 세대"],
    ["formFactor", "폼팩터"]
  ];
  for (const [key, label] of textFields) {
    const raw = candidate[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string") {
      errors.push(`${label}은 문자열이어야 합니다.`);
      continue;
    }
    const value = raw.trim();
    if (value.length === 0) continue;
    if (value.length > 80) {
      errors.push(`${label}은 80자 이하로 입력해야 합니다.`);
      continue;
    }
    filter[key] = value;
  }
  const rawInterface = candidate.interface;
  if (rawInterface !== undefined && rawInterface !== null && rawInterface !== "") {
    if (rawInterface !== "NVMe" && rawInterface !== "SATA") errors.push("연결 방식은 NVMe 또는 SATA여야 합니다.");
    else filter.interface = rawInterface;
  }
  return { filter, errors };
}

type PartSpecFilterRule = {
  key: keyof PartSpecFilter;
  label: string;
  missing: (part: Part) => boolean;
  matches: (part: Part) => boolean;
};

function partFormFactorsFor(part: Part) {
  return [
    part.specs.formFactor,
    part.specs.psuFormFactor,
    ...(part.specs.motherboardFormFactors ?? []),
    ...(part.specs.supportedFormFactors ?? [])
  ].filter((value): value is string => Boolean(value));
}

function partSpecFilterRulesFor(filter: PartSpecFilter): PartSpecFilterRule[] {
  const rules: PartSpecFilterRule[] = [];
  if (filter.minVramGb !== undefined) rules.push({ key: "minVramGb", label: "최소 VRAM", missing: (part) => part.specs.vramGb === undefined, matches: (part) => part.specs.vramGb !== undefined && part.specs.vramGb >= filter.minVramGb! });
  if (filter.minCapacityGb !== undefined) rules.push({ key: "minCapacityGb", label: "최소 용량", missing: (part) => part.specs.capacityGb === undefined, matches: (part) => part.specs.capacityGb !== undefined && part.specs.capacityGb >= filter.minCapacityGb! });
  if (filter.minWattageW !== undefined) rules.push({ key: "minWattageW", label: "최소 정격 출력", missing: (part) => part.specs.wattageW === undefined, matches: (part) => part.specs.wattageW !== undefined && part.specs.wattageW >= filter.minWattageW! });
  if (filter.minMemorySpeedMhz !== undefined) rules.push({ key: "minMemorySpeedMhz", label: "최소 메모리 속도", missing: (part) => part.specs.speedMhz === undefined, matches: (part) => part.specs.speedMhz !== undefined && part.specs.speedMhz >= filter.minMemorySpeedMhz! });
  if (filter.interface !== undefined) rules.push({ key: "interface", label: "연결 방식", missing: (part) => part.specs.interface === undefined, matches: (part) => part.specs.interface === filter.interface });
  if (filter.socket !== undefined) rules.push({ key: "socket", label: "소켓", missing: (part) => [part.specs.socket, ...(part.specs.supportedSockets ?? [])].filter(Boolean).length === 0, matches: (part) => [part.specs.socket, ...(part.specs.supportedSockets ?? [])].filter((value): value is string => Boolean(value)).some((value) => value.toLocaleLowerCase("ko-KR") === filter.socket!.toLocaleLowerCase("ko-KR")) });
  if (filter.memoryType !== undefined) rules.push({ key: "memoryType", label: "메모리 세대", missing: (part) => part.specs.memoryType === undefined, matches: (part) => part.specs.memoryType !== undefined && part.specs.memoryType.toLocaleLowerCase("ko-KR") === filter.memoryType!.toLocaleLowerCase("ko-KR") });
  if (filter.formFactor !== undefined) rules.push({ key: "formFactor", label: "폼팩터", missing: (part) => partFormFactorsFor(part).length === 0, matches: (part) => partFormFactorsFor(part).some((value) => value.toLocaleLowerCase("ko-KR") === filter.formFactor!.toLocaleLowerCase("ko-KR")) });
  if (filter.minMemorySlots !== undefined) rules.push({ key: "minMemorySlots", label: "최소 RAM 슬롯", missing: (part) => part.specs.memorySlots === undefined, matches: (part) => part.specs.memorySlots !== undefined && part.specs.memorySlots >= filter.minMemorySlots! });
  if (filter.minM2Slots !== undefined) rules.push({ key: "minM2Slots", label: "최소 M.2 슬롯", missing: (part) => part.specs.m2Slots === undefined, matches: (part) => part.specs.m2Slots !== undefined && part.specs.m2Slots >= filter.minM2Slots! });
  if (filter.minSataPorts !== undefined) rules.push({ key: "minSataPorts", label: "최소 SATA 포트", missing: (part) => part.specs.sataPorts === undefined, matches: (part) => part.specs.sataPorts !== undefined && part.specs.sataPorts >= filter.minSataPorts! });
  if (filter.pcieSlotInfo !== undefined) {
    const pcieInfoComplete = (part: Part) => part.category === "motherboard" && pcieCompatibleSlotInventoryFor(part.specs, 1).complete;
    rules.push({
      key: "pcieSlotInfo",
      label: "PCIe 슬롯 정보",
      missing: filter.pcieSlotInfo === "complete" ? (part) => part.category === "motherboard" && !pcieInfoComplete(part) : () => false,
      matches: (part) => filter.pcieSlotInfo === "complete" ? pcieInfoComplete(part) : part.category === "motherboard" && !pcieInfoComplete(part)
    });
  }
  if (filter.pcieSlotWidth !== undefined || filter.minPcieSlotCount !== undefined) {
    const requiredWidth = filter.pcieSlotWidth ?? 1;
    const requiredCount = filter.minPcieSlotCount ?? 1;
    rules.push({
      key: "minPcieSlotCount",
      label: filter.pcieSlotWidth === undefined ? "PCIe 슬롯 총합" : `PCIe x${requiredWidth} 이상 슬롯`,
      missing: (part) => !pcieCompatibleSlotInventoryFor(part.specs, requiredWidth).complete,
      matches: (part) => pcieCompatibleSlotInventoryFor(part.specs, requiredWidth).complete
        && pcieCompatibleSlotInventoryFor(part.specs, requiredWidth).knownSlotCount >= requiredCount
    });
  }
  if (filter.minHddBays !== undefined) rules.push({ key: "minHddBays", label: "최소 HDD 베이", missing: (part) => part.specs.hddBays === undefined, matches: (part) => part.specs.hddBays !== undefined && part.specs.hddBays >= filter.minHddBays! });
  if (filter.minMaxGpuLengthMm !== undefined) rules.push({ key: "minMaxGpuLengthMm", label: "최소 GPU 허용 길이", missing: (part) => part.specs.maxGpuLengthMm === undefined, matches: (part) => part.specs.maxGpuLengthMm !== undefined && part.specs.maxGpuLengthMm >= filter.minMaxGpuLengthMm! });
  if (filter.minMaxCoolerHeightMm !== undefined) rules.push({ key: "minMaxCoolerHeightMm", label: "최소 쿨러 허용 높이", missing: (part) => part.specs.maxCoolerHeightMm === undefined, matches: (part) => part.specs.maxCoolerHeightMm !== undefined && part.specs.maxCoolerHeightMm >= filter.minMaxCoolerHeightMm! });
  if (filter.minMaxPsuLengthMm !== undefined) rules.push({ key: "minMaxPsuLengthMm", label: "최소 PSU 허용 길이", missing: (part) => part.specs.maxPsuLengthMm === undefined, matches: (part) => part.specs.maxPsuLengthMm !== undefined && part.specs.maxPsuLengthMm >= filter.minMaxPsuLengthMm! });
  if (filter.minCoolingW !== undefined) rules.push({ key: "minCoolingW", label: "최소 냉각 용량", missing: (part) => part.specs.maxCoolingW === undefined, matches: (part) => part.specs.maxCoolingW !== undefined && part.specs.maxCoolingW >= filter.minCoolingW! });
  if (filter.maxLengthMm !== undefined) rules.push({ key: "maxLengthMm", label: "최대 GPU 길이", missing: (part) => part.specs.lengthMm === undefined, matches: (part) => part.specs.lengthMm !== undefined && part.specs.lengthMm <= filter.maxLengthMm! });
  if (filter.maxPsuDepthMm !== undefined) rules.push({ key: "maxPsuDepthMm", label: "최대 PSU 깊이", missing: (part) => part.specs.psuDepthMm === undefined, matches: (part) => part.specs.psuDepthMm !== undefined && part.specs.psuDepthMm <= filter.maxPsuDepthMm! });
  return rules;
}

export function partMatchesSpecFilter(part: Part, filter: PartSpecFilter = {}) {
  return partSpecFilterMatcherFor(filter)(part);
}

export function partSpecFilterMatcherFor(filter: PartSpecFilter = {}) {
  const rules = partSpecFilterRulesFor(filter);
  return (part: Part) => rules.every((rule) => rule.matches(part));
}

export function partSpecFilterDiagnosticsFor(parts: Part[], filter: PartSpecFilter = {}): PartSpecFilterDiagnostic[] {
  return partSpecFilterRulesFor(filter).map((rule) => ({
    key: rule.key,
    label: rule.label,
    excludedCount: parts.filter((part) => !rule.matches(part)).length,
    missingCount: parts.filter((part) => rule.missing(part)).length
  }));
}

export type PartSearchOptions = {
  partId?: string;
  brand?: string;
  quality?: DataQuality | "all";
  freshness?: DataFreshness | "all";
  priceAvailability?: PriceAvailabilityFilter;
  benchmarkAvailability?: BenchmarkAvailabilityFilter;
  now?: string | number;
  sort?: "price_asc" | "price_desc" | "name" | "updated" | "benchmark_desc";
  listingPolicy?: ListingPolicy;
  missingField?: string;
  specFilter?: PartSpecFilter;
  detailRule?: EngineCategoryTargetFilter;
  quoteBrandRestricted?: boolean;
  quoteSellableOnly?: boolean;
};

function partSearchPredicateFor(
  catalog: Part[],
  category: PartCategory | undefined,
  query: string | undefined,
  options: PartSearchOptions = {}
) {
  const normalizedQuery = query?.trim().toLocaleLowerCase("ko-KR") ?? "";
  const normalizedBrand = options.brand?.trim().toLocaleLowerCase("ko-KR") ?? "";
  const specRules = partSpecFilterRulesFor(options.specFilter ?? {});
  return (part: Part) => {
    if (options.partId && part.id !== options.partId) return false;
    if (category && part.category !== category) return false;
    if (options.quoteBrandRestricted && !isQuoteBrandAllowed(part.category, part.brand)) return false;
    if (options.quoteSellableOnly && !isQuoteSelectable(part, catalog)) return false;
    if (normalizedBrand && !(part.brand ?? "").toLocaleLowerCase("ko-KR").includes(normalizedBrand)) return false;
    if (options.quality && options.quality !== "all" && part.dataQuality !== options.quality) return false;
    if (options.freshness && options.freshness !== "all" && classifyDataFreshness(part.updatedAt, options.now) !== options.freshness) return false;
    if (options.priceAvailability && options.priceAvailability !== "all") {
      const matchesPrice = options.priceAvailability === "known" ? isKnownPrice(part.priceWon) : !isKnownPrice(part.priceWon);
      if (!matchesPrice) return false;
    }
    if (options.benchmarkAvailability && options.benchmarkAvailability !== "all" && !benchmarkAvailabilityMatchesFilter(part, options.benchmarkAvailability)) return false;
    if (options.listingPolicy && !isListingAllowed(part, options.listingPolicy)) return false;
    if (options.missingField && !part.missingFields.includes(options.missingField)) return false;
    if (!specRules.every((rule) => rule.matches(part))) return false;
    if (options.detailRule && !engineTargetFilterRuleAllowsPart(part, options.detailRule)) return false;
    if (!normalizedQuery) return true;
    const haystack = [
      part.name,
      part.brand,
      part.model,
      part.specs.socket,
      part.specs.memoryType,
      part.specs.interface,
      part.specs.formFactor
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("ko-KR");
    return haystack.includes(normalizedQuery);
  };
}

// 요청 핫패스용 카탈로그 인덱스 — 배열 참조를 키로 한 WeakMap이라 카탈로그가
// 재로드돼 새 배열로 교체되면 자동으로 무효화된다. 범주 버킷으로 전수 스캔을
// 범주 슬라이스 스캔으로 줄인다.
type CatalogIndex = {
  byCategory: Map<PartCategory, Part[]>;
};

const catalogIndexCache = new WeakMap<Part[], CatalogIndex>();

function catalogIndexFor(catalog: Part[]): CatalogIndex {
  const cached = catalogIndexCache.get(catalog);
  if (cached) return cached;
  const byCategory = new Map<PartCategory, Part[]>();
  for (const part of catalog) {
    const bucket = byCategory.get(part.category);
    if (bucket) bucket.push(part);
    else byCategory.set(part.category, [part]);
  }
  const index: CatalogIndex = { byCategory };
  catalogIndexCache.set(catalog, index);
  return index;
}

// 범주가 주어지면 인덱스의 범주 버킷만 평가한다 — 범주 조건은 버킷 구성 시
// 이미 적용됐으므로 predicate의 범주 검사는 버킷 안에서 항상 참이다.
export function catalogCandidatesFor(catalog: Part[], category: PartCategory | undefined): Part[] {
  if (!category) return catalog;
  return catalogIndexFor(catalog).byCategory.get(category) ?? [];
}

export function filterParts(
  catalog: Part[],
  category: PartCategory | undefined,
  query: string | undefined,
  options: PartSearchOptions = {}
) {
  return catalogCandidatesFor(catalog, category).filter(partSearchPredicateFor(catalog, category, query, options));
}

function sortParts(parts: Part[], category: PartCategory | undefined, sort: PartSearchOptions["sort"]) {
  const effectiveSort = sort === "benchmark_desc" && category !== "cpu" && category !== "gpu" ? "price_asc" : sort;
  return parts.sort((a, b) => {
    if (effectiveSort === "name") return a.name.localeCompare(b.name, "ko-KR");
    if (effectiveSort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
    if (effectiveSort === "benchmark_desc") {
      const benchmarkValueFor = (part: Part) => {
        if (part.category === "cpu") return [part.specs.cinebenchR23Multi, part.specs.cinebenchR23Single].find(validBenchmarkValue);
        if (part.category === "gpu") return [part.specs.gpu3dmarkTimeSpyScore, part.specs.gpu3dmarkPortRoyalScore].find(validBenchmarkValue);
        return undefined;
      };
      const left = benchmarkValueFor(a);
      const right = benchmarkValueFor(b);
      if (left === undefined && right === undefined) return a.name.localeCompare(b.name, "ko-KR");
      if (left === undefined) return 1;
      if (right === undefined) return -1;
      return right - left || a.name.localeCompare(b.name, "ko-KR");
    }
    if (effectiveSort === "price_desc") {
      if (!isKnownPrice(a.priceWon) && !isKnownPrice(b.priceWon)) return 0;
      if (!isKnownPrice(a.priceWon)) return 1;
      if (!isKnownPrice(b.priceWon)) return -1;
      return b.priceWon - a.priceWon;
    }
    if (a.dataQuality === "incomplete" && b.dataQuality !== "incomplete") return 1;
    if (a.dataQuality !== "incomplete" && b.dataQuality === "incomplete") return -1;
    if (!isKnownPrice(a.priceWon) && !isKnownPrice(b.priceWon)) return 0;
    if (!isKnownPrice(a.priceWon)) return 1;
    if (!isKnownPrice(b.priceWon)) return -1;
    return a.priceWon - b.priceWon;
  });
}

export function searchParts(
  catalog: Part[],
  category: PartCategory | undefined,
  query: string | undefined,
  limit = 40,
  options: PartSearchOptions = {},
  offset = 0
) {
  return sortParts(filterParts(catalog, category, query, options), category, options.sort)
    .slice(Math.max(0, offset), Math.max(0, offset) + limit);
}

export function countParts(
  catalog: Part[],
  category: PartCategory | undefined,
  query: string | undefined,
  options: PartSearchOptions = {}
) {
  return filterParts(catalog, category, query, options).length;
}

export interface CatalogSearchTotals {
  baseTotal: number;
  priceTotal: number;
  freshnessTotal: number;
  benchmarkTotal: number;
  total: number;
  unfilteredTotal: number;
  coreCandidateTotal: number;
  categoryMismatchExcludedCount: number;
}

export function catalogSearchTotalsFor(
  catalog: Part[],
  category: PartCategory | undefined,
  query: string | undefined,
  optionSets: {
    base: PartSearchOptions;
    price: PartSearchOptions;
    freshness: PartSearchOptions;
    benchmark: PartSearchOptions;
    final: PartSearchOptions;
    unfiltered: PartSearchOptions;
    coreCandidate: PartSearchOptions;
  }
): CatalogSearchTotals {
  const predicates = {
    base: partSearchPredicateFor(catalog, category, query, optionSets.base),
    price: partSearchPredicateFor(catalog, category, query, optionSets.price),
    freshness: partSearchPredicateFor(catalog, category, query, optionSets.freshness),
    benchmark: partSearchPredicateFor(catalog, category, query, optionSets.benchmark),
    final: partSearchPredicateFor(catalog, category, query, optionSets.final),
    unfiltered: partSearchPredicateFor(catalog, category, query, optionSets.unfiltered),
    coreCandidate: partSearchPredicateFor(catalog, category, query, optionSets.coreCandidate)
  };
  const totals: CatalogSearchTotals = {
    baseTotal: 0,
    priceTotal: 0,
    freshnessTotal: 0,
    benchmarkTotal: 0,
    total: 0,
    unfilteredTotal: 0,
    coreCandidateTotal: 0,
    categoryMismatchExcludedCount: 0
  };
  for (const part of catalogCandidatesFor(catalog, category)) {
    if (predicates.base(part)) totals.baseTotal += 1;
    if (predicates.price(part)) totals.priceTotal += 1;
    if (predicates.freshness(part)) totals.freshnessTotal += 1;
    if (predicates.benchmark(part)) totals.benchmarkTotal += 1;
    if (predicates.final(part)) totals.total += 1;
    if (predicates.unfiltered(part)) {
      totals.unfilteredTotal += 1;
      if (predicates.coreCandidate(part)) totals.coreCandidateTotal += 1;
      if (catalogCategoryMismatchFor(part) !== undefined) totals.categoryMismatchExcludedCount += 1;
    }
  }
  return totals;
}

export interface CatalogEligibilitySummary {
  eligibleCount: number;
  excludedNonCoreCount: number;
  categoryMismatchCount: number;
  eligibleQualityCounts: Record<DataQuality, number>;
  eligiblePriceCoverage: {
    priced: number;
    unpriced: number;
  };
}

export function catalogEligibilitySummaryFor(catalog: Part[]): CatalogEligibilitySummary {
  const eligibleQualityCounts = { seed: 0, live: 0, manual: 0, incomplete: 0 } satisfies Record<DataQuality, number>;
  let eligibleCount = 0;
  let categoryMismatchCount = 0;
  let priced = 0;
  for (const part of catalog) {
    const categoryMismatch = catalogCategoryMismatchFor(part);
    if (categoryMismatch) categoryMismatchCount += 1;
    if (categoryMismatch || inferListingType(part) === "accessory") continue;
    eligibleCount += 1;
    eligibleQualityCounts[part.dataQuality] += 1;
    if (isKnownPrice(part.priceWon)) priced += 1;
  }
  return {
    eligibleCount,
    excludedNonCoreCount: catalog.length - eligibleCount,
    categoryMismatchCount,
    eligibleQualityCounts,
    eligiblePriceCoverage: {
      priced,
      unpriced: eligibleCount - priced
    }
  };
}

export async function catalogUpdatedAtFor(catalog: Part[]) {
  if (catalogUpdatedAtCache?.catalog === catalog) return catalogUpdatedAtCache.value;
  const [overrideTimes, benchmarkOverrides] = await Promise.all([
    readCatalogOverrideMapUpdatedAtRecords(),
    readBenchmarkOverrideRecords()
  ]);
  const fileBackedTimes = await Promise.all([
    fileUpdatedAt(GPU_PHYSICAL_OVERRIDES_PATH, ""),
    fileUpdatedAt(CASE_RGB_LOAD_OVERRIDES_PATH, "")
  ]);
  // GPU physical and case RGB overrides remain file-backed artifacts; benchmark,
  // catalog-spec, and M.2 override timestamps come from their shared DB rows.
  const benchmarkUpdatedAt = Object.values(benchmarkOverrides).reduce((latest, override) => override.updatedAt > latest ? override.updatedAt : latest, "");
  const value = [
    catalog.reduce((latest, part) => part.updatedAt > latest ? part.updatedAt : latest, ""),
    ...fileBackedTimes,
    benchmarkUpdatedAt,
    ...Object.values(overrideTimes)
  ].filter(Boolean).sort().at(-1) ?? new Date().toISOString();
  catalogUpdatedAtCache = { catalog, value };
  return value;
}

async function buildCatalogMeta(snapshot?: CatalogSnapshot): Promise<CatalogMeta> {
  const now = Date.now();
  let catalog: Part[];
  let accessories: Awaited<ReturnType<typeof loadAccessories>>;
  let accessoryCoverageUpdatedAt: string;
  if (snapshot) {
    catalog = snapshot.catalog;
    accessories = snapshot.accessories;
    accessoryCoverageUpdatedAt = (await readAccessoryCoverageRecord()).updatedAt;
  } else {
    const coverage = await Promise.all([loadCatalog(), loadAccessories(), readAccessoryCoverageRecord()]);
    catalog = coverage[0];
    accessories = coverage[1];
    accessoryCoverageUpdatedAt = coverage[2].updatedAt;
  }
  if (catalogMetaCache
    && catalogMetaCache.catalog === catalog
    && catalogMetaCache.accessories === accessories
    && catalogMetaCache.accessoryCoverageUpdatedAt === accessoryCoverageUpdatedAt
    && (!snapshot || (catalogMetaCache.catalogUpdatedAt === snapshot.catalogUpdatedAt && catalogMetaCache.accessoryUpdatedAt === snapshot.accessoryUpdatedAt))
    && now < catalogMetaCache.catalogSpecCoverageValidUntil) {
    return catalogMetaCache.value;
  }

  const accessoryMetadata = await accessoryMeta(accessories, snapshot?.accessoryUpdatedAt);
  const {
    accessoryCount,
    accessoryCategoryCounts,
    accessoryBrandCounts,
    accessoryCategoryQualityCounts,
    accessoryQualityCounts,
    accessoryPriceCoverage,
    accessoryUpdatedAt
  } = accessoryMetadata;
  const accessoryCoverage = await readAccessoryCoverage(accessories);
  const eligibility = catalogEligibilitySummaryFor(catalog);
  const catalogPartsByCategory = new Map<PartCategory, Part[]>(PART_CATEGORIES.map((category) => [category, []]));
  for (const part of catalog) catalogPartsByCategory.get(part.category)?.push(part);
  const categoryCounts = Object.fromEntries(
    PART_CATEGORIES.map((category) => [category, catalogPartsByCategory.get(category)?.length ?? 0])
  ) as Record<PartCategory, number>;
  const catalogBrandCounts = Object.fromEntries(PART_CATEGORIES.map((category) => [category, brandCountsFor(catalogPartsByCategory.get(category) ?? [])])) as Partial<Record<PartCategory, BrandCountOption[]>>;
  const benchmarkCoverage = benchmarkCoverageForCatalog(catalog);
  const catalogSpecCoverage = catalogSpecCoverageFor(catalog, now);
  const catalogSpecCoverageValidUntil = catalog.reduce((next, part) => {
    const candidate = nextDataFreshnessChangeAt(part.updatedAt, now);
    return candidate !== undefined && candidate < next ? candidate : next;
  }, Number.POSITIVE_INFINITY);
  const catalogCategoryIntegrity = catalogSpecCoverage.categoryIntegrity ?? catalogCategoryIntegritySummaryFor(catalog);
  const qualityCounts = Object.fromEntries(
    ["seed", "live", "manual", "incomplete"].map((quality) => [quality, catalog.filter((part) => part.dataQuality === quality).length])
  ) as Record<DataQuality, number>;
  const catalogUpdatedAt = snapshot?.catalogUpdatedAt ?? await catalogUpdatedAtFor(catalog);
  const value: CatalogMeta = {
    catalogCount: catalog.length,
    catalogEligibleCount: eligibility.eligibleCount,
    catalogExcludedNonCoreCount: eligibility.excludedNonCoreCount,
    catalogCategoryIntegrity,
    catalogBrandCounts,
    catalogEligibleQualityCounts: eligibility.eligibleQualityCounts,
    catalogEligiblePriceCoverage: eligibility.eligiblePriceCoverage,
    accessoryCount,
    accessoryCategoryCounts,
    accessoryBrandCounts,
    accessoryCategoryQualityCounts,
    accessoryQualityCounts,
    accessoryPriceCoverage,
    accessoryUpdatedAt,
    accessoryCoverage,
    benchmarkCoverage,
    catalogSpecCoverage,
    categoryCounts,
    qualityCounts,
    priceCoverage: {
      priced: catalog.filter((part) => isKnownPrice(part.priceWon)).length,
      unpriced: catalog.filter((part) => !isKnownPrice(part.priceWon)).length
    },
    catalogUpdatedAt,
    recommendationFloorWon: recommendationFloorWonFor(catalog, { targetFilters: loadEngineTargetFiltersConfig() })
  };
  catalogMetaCache = {
    catalog,
    accessories,
    accessoryCoverageUpdatedAt,
    catalogSpecCoverageValidUntil,
    catalogUpdatedAt,
    accessoryUpdatedAt,
    value
  };
  return value;
}

export async function catalogMeta(snapshot?: CatalogSnapshot): Promise<CatalogMeta> {
  // Request-owned snapshots must keep their own freshness and metadata result.
  // Only legacy callers without a captured snapshot may share in-flight work.
  if (snapshot) return buildCatalogMeta(snapshot);
  if (catalogMetaInFlight) return catalogMetaInFlight;
  const promise = buildCatalogMeta();
  catalogMetaInFlight = promise;
  try {
    return await promise;
  } finally {
    if (catalogMetaInFlight === promise) catalogMetaInFlight = null;
  }
}
