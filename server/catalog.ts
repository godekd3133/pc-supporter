import type { BenchmarkSourceCoverage, CatalogBenchmarkCoverage, DataFreshness, DataQuality, ListingPolicy, Part, PartCategory, PriceAvailabilityFilter, ServiceMeta } from "../shared/types";
import { isKnownPrice, PART_CATEGORIES } from "../shared/types";
import { seedCatalog } from "./seed-catalog";
import {
  CATALOG_PATH,
  BENCHMARK_OVERRIDES_PATH,
  CASE_RGB_LOAD_OVERRIDES_PATH,
  GPU_PHYSICAL_OVERRIDES_PATH,
  M2_SLOT_OVERRIDES_PATH,
  fileUpdatedAt,
  readJson,
  writeJson
} from "./storage";
import { persistenceMode, readCatalogRecords, writeCatalogRecords } from "./repository";
import { isListingAllowed } from "./listing";
import { accessoryMeta, readAccessoryCoverage } from "./accessories";
import { reparseDanawaPart } from "./danawa";
import { applyM2SlotOverrides, readM2SlotOverrides, stripM2SlotOverride } from "./m2-overrides";
import { applyBenchmarkOverrides, readBenchmarkOverrides } from "./benchmark-overrides";
import { applyGpuPhysicalOverrides, readGpuPhysicalOverrides, stripGpuPhysicalOverrides } from "./gpu-physical-overrides";
import { applyCaseRgbLoadOverrides, readCaseRgbLoadOverrides, stripCaseRgbLoadOverride } from "./case-rgb-load-overrides";
import { classifyDataFreshness } from "../shared/data-freshness";

let catalogCache: Part[] | null = null;
let catalogMtime: string | null = null;
let m2OverrideMtime: string | null = null;
let benchmarkOverrideMtime: string | null = null;
let gpuPhysicalOverrideMtime: string | null = null;
let caseRgbLoadOverrideMtime: string | null = null;
let catalogRuntimeRevision = 0;

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

export async function loadCatalog() {
  const mode = await persistenceMode();
  if (mode === "postgres") {
    const persisted = await readCatalogRecords();
    catalogCache = applyCaseRgbLoadOverrides(
      applyGpuPhysicalOverrides(
      applyM2SlotOverrides(
        applyBenchmarkOverrides(mergeCatalog(seedCatalog, persisted.map((part) => reparseDanawaPart(part))), await readBenchmarkOverrides()),
        await readM2SlotOverrides()
      ),
      await readGpuPhysicalOverrides()
      ),
      await readCaseRgbLoadOverrides()
    );
    return catalogCache;
  }
  const persistedMtime = await fileUpdatedAt(CATALOG_PATH, "");
  const currentM2OverrideMtime = await fileUpdatedAt(M2_SLOT_OVERRIDES_PATH, "");
  const currentBenchmarkOverrideMtime = await fileUpdatedAt(BENCHMARK_OVERRIDES_PATH, "");
  const currentGpuPhysicalOverrideMtime = await fileUpdatedAt(GPU_PHYSICAL_OVERRIDES_PATH, "");
  const currentCaseRgbLoadOverrideMtime = await fileUpdatedAt(CASE_RGB_LOAD_OVERRIDES_PATH, "");
  if (catalogCache && catalogMtime === persistedMtime && m2OverrideMtime === currentM2OverrideMtime && benchmarkOverrideMtime === currentBenchmarkOverrideMtime && gpuPhysicalOverrideMtime === currentGpuPhysicalOverrideMtime && caseRgbLoadOverrideMtime === currentCaseRgbLoadOverrideMtime) return catalogCache;
  const persisted = await readJson<Part[]>(CATALOG_PATH, []);
  const baseCatalog = mergeCatalog(seedCatalog, persisted.map((part) => reparseDanawaPart(part)));
  if (persisted.length === 0) await writeJson(CATALOG_PATH, baseCatalog);
  catalogCache = applyCaseRgbLoadOverrides(applyGpuPhysicalOverrides(applyM2SlotOverrides(applyBenchmarkOverrides(baseCatalog, await readBenchmarkOverrides()), await readM2SlotOverrides()), await readGpuPhysicalOverrides()), await readCaseRgbLoadOverrides());
  catalogMtime = await fileUpdatedAt(CATALOG_PATH, persistedMtime);
  m2OverrideMtime = currentM2OverrideMtime;
  benchmarkOverrideMtime = currentBenchmarkOverrideMtime;
  gpuPhysicalOverrideMtime = currentGpuPhysicalOverrideMtime;
  caseRgbLoadOverrideMtime = currentCaseRgbLoadOverrideMtime;
  return catalogCache;
}

export function invalidateCatalogCache() {
  catalogCache = null;
  catalogMtime = null;
  m2OverrideMtime = null;
  benchmarkOverrideMtime = null;
  gpuPhysicalOverrideMtime = null;
  caseRgbLoadOverrideMtime = null;
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
  const baseCatalog = mergeCatalog([], parts.map((part) => stripCaseRgbLoadOverride(stripGpuPhysicalOverrides(stripM2SlotOverride(part)))));
  await writeCatalogRecords(baseCatalog);
  catalogCache = applyCaseRgbLoadOverrides(applyGpuPhysicalOverrides(applyM2SlotOverrides(applyBenchmarkOverrides(baseCatalog, await readBenchmarkOverrides()), await readM2SlotOverrides()), await readGpuPhysicalOverrides()), await readCaseRgbLoadOverrides());
  catalogRuntimeRevision += 1;
  if (await persistenceMode() === "file") {
    catalogMtime = await fileUpdatedAt(CATALOG_PATH, "");
    m2OverrideMtime = await fileUpdatedAt(M2_SLOT_OVERRIDES_PATH, "");
    benchmarkOverrideMtime = await fileUpdatedAt(BENCHMARK_OVERRIDES_PATH, "");
    gpuPhysicalOverrideMtime = await fileUpdatedAt(GPU_PHYSICAL_OVERRIDES_PATH, "");
    caseRgbLoadOverrideMtime = await fileUpdatedAt(CASE_RGB_LOAD_OVERRIDES_PATH, "");
  }
  return catalogCache;
}

export async function upsertCatalog(
  parts: Part[],
  options: { replaceDanawaCategories?: PartCategory[] } = {}
) {
  const current = (await loadCatalog()).map((part) => stripCaseRgbLoadOverride(stripGpuPhysicalOverrides(stripM2SlotOverride(part))));
  const replaceDanawaCategories = options.replaceDanawaCategories ?? [];
  const baseCatalog = replaceDanawaCategories.length > 0
    ? mergeDanawaSnapshot(current, parts, replaceDanawaCategories)
    : mergeCatalog(current, parts);
  await writeCatalogRecords(baseCatalog, { replaceDanawaCategories });
  catalogCache = applyCaseRgbLoadOverrides(applyGpuPhysicalOverrides(applyM2SlotOverrides(applyBenchmarkOverrides(baseCatalog, await readBenchmarkOverrides()), await readM2SlotOverrides()), await readGpuPhysicalOverrides()), await readCaseRgbLoadOverrides());
  catalogRuntimeRevision += 1;
  if (await persistenceMode() === "file") {
    catalogMtime = await fileUpdatedAt(CATALOG_PATH, "");
    m2OverrideMtime = await fileUpdatedAt(M2_SLOT_OVERRIDES_PATH, "");
    benchmarkOverrideMtime = await fileUpdatedAt(BENCHMARK_OVERRIDES_PATH, "");
    gpuPhysicalOverrideMtime = await fileUpdatedAt(GPU_PHYSICAL_OVERRIDES_PATH, "");
    caseRgbLoadOverrideMtime = await fileUpdatedAt(CASE_RGB_LOAD_OVERRIDES_PATH, "");
  }
  return catalogCache;
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

export function parsePartSpecFilter(input: unknown): ParsedPartSpecFilter {
  if (input === undefined || input === null || input === "") return { filter: {}, errors: [] };
  if (typeof input !== "object" || Array.isArray(input)) return { filter: {}, errors: ["스펙 필터 형식이 올바르지 않습니다."] };
  const candidate = input as Record<string, unknown>;
  const filter: PartSpecFilter = {};
  const errors: string[] = [];
  const numericFields: Array<[keyof Pick<PartSpecFilter, "minVramGb" | "minCapacityGb" | "minWattageW" | "minMemorySpeedMhz" | "minMemorySlots" | "minM2Slots" | "minSataPorts" | "minHddBays" | "minMaxGpuLengthMm" | "minMaxCoolerHeightMm" | "minMaxPsuLengthMm" | "minCoolingW" | "maxLengthMm" | "maxPsuDepthMm">, string]> = [
    ["minVramGb", "최소 VRAM"],
    ["minCapacityGb", "최소 용량"],
    ["minWattageW", "최소 정격 출력"],
    ["minMemorySpeedMhz", "최소 메모리 속도"],
    ["minMemorySlots", "최소 RAM 슬롯"],
    ["minM2Slots", "최소 M.2 슬롯"],
    ["minSataPorts", "최소 SATA 포트"],
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
  return partSpecFilterRulesFor(filter).every((rule) => rule.matches(part));
}

export function partSpecFilterDiagnosticsFor(parts: Part[], filter: PartSpecFilter = {}): PartSpecFilterDiagnostic[] {
  return partSpecFilterRulesFor(filter).map((rule) => ({
    key: rule.key,
    label: rule.label,
    excludedCount: parts.filter((part) => !rule.matches(part)).length,
    missingCount: parts.filter((part) => rule.missing(part)).length
  }));
}

type PartSearchOptions = {
  quality?: DataQuality | "all";
  freshness?: DataFreshness | "all";
  priceAvailability?: PriceAvailabilityFilter;
  now?: string | number;
  sort?: "price_asc" | "price_desc" | "name" | "updated";
  listingPolicy?: ListingPolicy;
  specFilter?: PartSpecFilter;
};

function filterAndSortParts(
  catalog: Part[],
  category: PartCategory | undefined,
  query: string | undefined,
  options: PartSearchOptions = {}
) {
  const normalizedQuery = query?.trim().toLocaleLowerCase("ko-KR") ?? "";
  return catalog
    .filter((part) => !category || part.category === category)
    .filter((part) => !options.quality || options.quality === "all" || part.dataQuality === options.quality)
    .filter((part) => !options.freshness || options.freshness === "all" || classifyDataFreshness(part.updatedAt, options.now) === options.freshness)
    .filter((part) => {
      if (!options.priceAvailability || options.priceAvailability === "all") return true;
      return options.priceAvailability === "known" ? isKnownPrice(part.priceWon) : !isKnownPrice(part.priceWon);
    })
    .filter((part) => !options.listingPolicy || isListingAllowed(part, options.listingPolicy))
    .filter((part) => partMatchesSpecFilter(part, options.specFilter))
    .filter((part) => {
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
    })
    .sort((a, b) => {
      if (options.sort === "name") return a.name.localeCompare(b.name, "ko-KR");
      if (options.sort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
      if (options.sort === "price_desc") {
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
  return filterAndSortParts(catalog, category, query, options)
    .slice(Math.max(0, offset), Math.max(0, offset) + limit);
}

export function countParts(
  catalog: Part[],
  category: PartCategory | undefined,
  query: string | undefined,
  options: PartSearchOptions = {}
) {
  return filterAndSortParts(catalog, category, query, options).length;
}

export async function catalogMeta(): Promise<Pick<ServiceMeta, "catalogCount" | "accessoryCount" | "accessoryCategoryCounts" | "accessoryQualityCounts" | "accessoryPriceCoverage" | "accessoryUpdatedAt" | "accessoryCoverage" | "benchmarkCoverage" | "categoryCounts" | "qualityCounts" | "priceCoverage" | "catalogUpdatedAt">> {
  const catalog = await loadCatalog();
  const { accessoryCount, accessoryCategoryCounts, accessoryQualityCounts, accessoryPriceCoverage, accessoryUpdatedAt } = await accessoryMeta();
  const accessoryCoverage = await readAccessoryCoverage();
  const categoryCounts = Object.fromEntries(
    PART_CATEGORIES.map((category) => [category, catalog.filter((part) => part.category === category).length])
  ) as Record<PartCategory, number>;
  const benchmarkCoverage = benchmarkCoverageForCatalog(catalog);
  const qualityCounts = Object.fromEntries(
    ["seed", "live", "manual", "incomplete"].map((quality) => [quality, catalog.filter((part) => part.dataQuality === quality).length])
  ) as Record<DataQuality, number>;
  const catalogUpdatedAt = [
    catalog.reduce((latest, part) => part.updatedAt > latest ? part.updatedAt : latest, ""),
    ...(await Promise.all([
      fileUpdatedAt(CATALOG_PATH, ""),
      fileUpdatedAt(M2_SLOT_OVERRIDES_PATH, ""),
      fileUpdatedAt(BENCHMARK_OVERRIDES_PATH, ""),
      fileUpdatedAt(GPU_PHYSICAL_OVERRIDES_PATH, "")
    ]))
  ].filter(Boolean).sort().at(-1) ?? new Date().toISOString();
  return {
    catalogCount: catalog.length,
    accessoryCount,
    accessoryCategoryCounts,
    accessoryQualityCounts,
    accessoryPriceCoverage,
    accessoryUpdatedAt,
    accessoryCoverage,
    benchmarkCoverage,
    categoryCounts,
    qualityCounts,
    priceCoverage: {
      priced: catalog.filter((part) => isKnownPrice(part.priceWon)).length,
      unpriced: catalog.filter((part) => !isKnownPrice(part.priceWon)).length
    },
    catalogUpdatedAt
  };
}
