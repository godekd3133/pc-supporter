import type { Part, PartCategory, PartSpecs } from "./types";
import { isKnownPrice, PART_CATEGORIES } from "./types";

// 자동 견적 생성기의 카탈로그 타겟 필터 — 관리자가 범주별로 허용 브랜드·스펙 값·
// 수치 범위·플래그·가격대를 지정하면, 생성기 후보 풀에 들어가기 전에 부품을 걸러낸다.
// 같은 facet 안의 선택값은 OR, 서로 다른 facet은 AND로 결합한다.
// 설정하지 않은 facet은 제한하지 않는다.

export const ENGINE_FILTER_SPEC_VALUE_FIELDS = [
  "socket",
  "supportedSockets",
  "memoryType",
  "memoryProfiles",
  "memoryFormFactor",
  "memoryTiming",
  "memoryModuleCountPerKit",
  "formFactor",
  "interface",
  "m2Interfaces",
  "m2PcieGeneration",
  "m2PcieGenerations",
  "ssdNandType",
  "ssdController",
  "coolerType",
  "radiatorSizeMm",
  "radiatorSizesMm",
  "radiatorPosition",
  "motherboardFormFactors",
  "supportedFormFactors",
  "supportedPsuFormFactors",
  "gpuVendor",
  "gpuArchitectureFamily",
  "gpuMemoryType",
  "efficiency",
  "psuCableType",
  "psuRailType",
  "psuFormFactor"
] as const;

export const ENGINE_FILTER_NUMERIC_FIELDS = [
  "capacityGb",
  "speedMhz",
  "memoryCasLatency",
  "memoryEffectiveLatencyNs",
  "memoryVoltageV",
  "cores",
  "threads",
  "boostClockGhz",
  "tdpW",
  "pptW",
  "cinebenchR23Single",
  "cinebenchR23Multi",
  "sequentialReadMbps",
  "sequentialWriteMbps",
  "ssdTbwTb",
  "ssdReadIops",
  "ssdWriteIops",
  "maxMemoryGb",
  "memorySlots",
  "maxMemorySpeedMhz",
  "m2Slots",
  "sataPorts",
  "pcieX16Slots",
  "pcieX8Slots",
  "pcieX4Slots",
  "pcieX1Slots",
  "vrmCapacityW",
  "vramGb",
  "gpuBoostClockMhz",
  "gpuStreamProcessors",
  "gpuMemoryBandwidthGbps",
  "gpu3dmarkTimeSpyScore",
  "gpu3dmarkPortRoyalScore",
  "lengthMm",
  "widthMm",
  "thicknessMm",
  "gpuSlotOccupancy",
  "maxGpuLengthMm",
  "maxCoolerHeightMm",
  "maxPsuLengthMm",
  "maxCoolingW",
  "hddBays",
  "ssdBays",
  "wattageW",
  "psuDepthMm",
  "powerW",
  "recommendedPsuW",
  "fanCount"
] as const;

export const ENGINE_FILTER_FLAG_FIELDS = [
  "integratedGraphics",
  "wifi",
  "m2LaneSharing",
  "coolerIncluded",
  "rgbControllerIncluded"
] as const;

export type EngineFilterSpecValueField = (typeof ENGINE_FILTER_SPEC_VALUE_FIELDS)[number];
export type EngineFilterNumericField = (typeof ENGINE_FILTER_NUMERIC_FIELDS)[number];
export type EngineFilterFlagField = (typeof ENGINE_FILTER_FLAG_FIELDS)[number];

const ENGINE_FILTER_SPEC_VALUE_FIELD_SET = new Set<string>(ENGINE_FILTER_SPEC_VALUE_FIELDS);
const ENGINE_FILTER_NUMERIC_FIELD_SET = new Set<string>(ENGINE_FILTER_NUMERIC_FIELDS);
const ENGINE_FILTER_FLAG_FIELD_SET = new Set<string>(ENGINE_FILTER_FLAG_FIELDS);
const PART_CATEGORY_SET = new Set<string>(PART_CATEGORIES);

export interface EngineFilterRange {
  min?: number;
  max?: number;
}

export interface EngineCategoryTargetFilter {
  brands?: string[];
  specValues?: Partial<Record<EngineFilterSpecValueField, string[]>>;
  numericRanges?: Partial<Record<EngineFilterNumericField, EngineFilterRange[]>>;
  flags?: Partial<Record<EngineFilterFlagField, boolean>>;
  priceWon?: EngineFilterRange;
}

export type EngineTargetFilters = Partial<Record<PartCategory, EngineCategoryTargetFilter>>;

export interface EngineTargetFiltersConfig {
  schemaVersion: 1;
  enabled: boolean;
  categories: EngineTargetFilters;
}

export const ENGINE_TARGET_FILTER_LIMITS = {
  maxBrands: 100,
  maxBrandLength: 80,
  maxValuesPerField: 200,
  maxValueLength: 120,
  maxRangesPerField: 20,
  maxPriceWon: 1_000_000_000
} as const;

export function emptyEngineTargetFiltersConfig(): EngineTargetFiltersConfig {
  return { schemaVersion: 1, enabled: true, categories: {} };
}

function normalizedFilterText(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, "") : "";
}

function specFilterValuesFor(part: Part, field: string): Array<string | number> {
  const raw = part.specs[field as keyof PartSpecs];
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.filter((item): item is string | number => typeof item === "string" || typeof item === "number");
  if (typeof raw === "string" || typeof raw === "number") return [raw];
  return [];
}

function specOptionMatches(raw: string | number, option: string) {
  if (typeof raw === "number") {
    const numericOption = Number(option);
    if (Number.isFinite(numericOption)) return raw === numericOption;
  }
  return normalizedFilterText(String(raw)) === normalizedFilterText(option);
}

function numericRangeMatches(value: number, ranges: EngineFilterRange[]) {
  return ranges.some((range) => {
    if (range.min !== undefined && value < range.min) return false;
    if (range.max !== undefined && value > range.max) return false;
    return range.min !== undefined || range.max !== undefined;
  });
}

// 한 범주 규칙이 실제로 조건을 담고 있는지 — 모두 비어 있으면 규칙이 없는 것과 같다.
export function engineCategoryTargetFilterIsEmpty(rule: EngineCategoryTargetFilter | undefined) {
  if (!rule) return true;
  if (rule.brands && rule.brands.length > 0) return false;
  if (rule.priceWon && (rule.priceWon.min !== undefined || rule.priceWon.max !== undefined)) return false;
  if (rule.specValues && Object.values(rule.specValues).some((values) => values !== undefined && values.length > 0)) return false;
  if (rule.numericRanges && Object.values(rule.numericRanges).some((ranges) => ranges !== undefined && ranges.length > 0)) return false;
  if (rule.flags && Object.values(rule.flags).some((value) => value !== undefined)) return false;
  return true;
}

export function engineTargetFilterActiveFacetCount(rule: EngineCategoryTargetFilter | undefined) {
  if (!rule) return 0;
  let count = 0;
  if (rule.brands && rule.brands.length > 0) count += 1;
  if (rule.priceWon && (rule.priceWon.min !== undefined || rule.priceWon.max !== undefined)) count += 1;
  if (rule.specValues) count += Object.values(rule.specValues).filter((values) => values !== undefined && values.length > 0).length;
  if (rule.numericRanges) count += Object.values(rule.numericRanges).filter((ranges) => ranges !== undefined && ranges.length > 0).length;
  if (rule.flags) count += Object.values(rule.flags).filter((value) => value !== undefined).length;
  return count;
}

export function engineTargetFiltersActiveCategories(config: EngineTargetFiltersConfig | undefined) {
  if (!config?.enabled) return [];
  return PART_CATEGORIES.filter((category) => !engineCategoryTargetFilterIsEmpty(config.categories[category]));
}

export function engineTargetFilterRuleAllowsPart(part: Part, rule: EngineCategoryTargetFilter | undefined) {
  if (!rule || engineCategoryTargetFilterIsEmpty(rule)) return true;
  if (rule.brands && rule.brands.length > 0) {
    const brand = normalizedFilterText(part.brand);
    if (!brand || !rule.brands.some((option) => normalizedFilterText(option) === brand)) return false;
  }
  if (rule.specValues) {
    for (const [field, options] of Object.entries(rule.specValues)) {
      if (!options || options.length === 0) continue;
      const rawValues = specFilterValuesFor(part, field);
      if (rawValues.length === 0) return false;
      if (!options.some((option) => rawValues.some((raw) => specOptionMatches(raw, option)))) return false;
    }
  }
  if (rule.numericRanges) {
    for (const [field, ranges] of Object.entries(rule.numericRanges)) {
      if (!ranges || ranges.length === 0) continue;
      const raw = part.specs[field as keyof PartSpecs];
      if (typeof raw !== "number" || !Number.isFinite(raw)) return false;
      if (!numericRangeMatches(raw, ranges)) return false;
    }
  }
  if (rule.flags) {
    for (const [field, expected] of Object.entries(rule.flags)) {
      if (expected === undefined) continue;
      if (part.specs[field as keyof PartSpecs] !== expected) return false;
    }
  }
  if (rule.priceWon && (rule.priceWon.min !== undefined || rule.priceWon.max !== undefined)) {
    if (!isKnownPrice(part.priceWon)) return false;
    if (rule.priceWon.min !== undefined && part.priceWon < rule.priceWon.min) return false;
    if (rule.priceWon.max !== undefined && part.priceWon > rule.priceWon.max) return false;
  }
  return true;
}

export function engineTargetFiltersAllowPart(part: Part, config: EngineTargetFiltersConfig | undefined) {
  if (!config || config.enabled !== true) return true;
  return engineTargetFilterRuleAllowsPart(part, config.categories[part.category]);
}

// 범주 facet에 선언된 필드만 남긴다 — 다른 범주 링크를 재사용해도 선언되지
// 않은 조건이 결과를 좁히지 않는다.
export function engineTargetFilterRuleForCategory(rule: EngineCategoryTargetFilter | undefined, category: PartCategory): EngineCategoryTargetFilter | undefined {
  if (!rule) return undefined;
  const facets = ENGINE_TARGET_FILTER_FACETS[category];
  const valueIds = new Set<string>(facets.filter((facet) => facet.kind === "values").map((facet) => facet.id));
  const rangeIds = new Set<string>(facets.filter((facet) => facet.kind === "range").map((facet) => facet.id));
  const flagIds = new Set<string>(facets.filter((facet) => facet.kind === "flag").map((facet) => facet.id));
  const scoped: EngineCategoryTargetFilter = {};
  if (rule.brands && rule.brands.length > 0 && facets.some((facet) => facet.kind === "brands")) scoped.brands = rule.brands;
  if (rule.specValues) {
    const entries = Object.entries(rule.specValues).filter(([field]) => valueIds.has(field));
    if (entries.length > 0) scoped.specValues = Object.fromEntries(entries) as EngineCategoryTargetFilter["specValues"];
  }
  if (rule.numericRanges) {
    const entries = Object.entries(rule.numericRanges).filter(([field]) => rangeIds.has(field));
    if (entries.length > 0) scoped.numericRanges = Object.fromEntries(entries) as EngineCategoryTargetFilter["numericRanges"];
  }
  if (rule.flags) {
    const entries = Object.entries(rule.flags).filter(([field]) => flagIds.has(field));
    if (entries.length > 0) scoped.flags = Object.fromEntries(entries) as EngineCategoryTargetFilter["flags"];
  }
  if (rule.priceWon && facets.some((facet) => facet.kind === "price")) scoped.priceWon = rule.priceWon;
  return engineCategoryTargetFilterIsEmpty(scoped) ? undefined : scoped;
}

export type EngineTargetFilterFacetDiagnostic = {
  id: string;
  label: string;
  excludedCount: number;
  missingCount: number;
};

// 공개 카탈로그의 세부 조건 패널 안내용 — 적용된 facet을 하나씩만 걸어 보면서
// "이 조건이 후보를 몇 개 제외하는지", "비교 값이 없어 자동 제외된 부품이 몇 개인지"를 돌려준다.
export function engineTargetFilterFacetDiagnosticsFor(parts: Part[], rule: EngineCategoryTargetFilter | undefined, category: PartCategory): EngineTargetFilterFacetDiagnostic[] {
  if (!rule || engineCategoryTargetFilterIsEmpty(rule)) return [];
  const diagnostics: EngineTargetFilterFacetDiagnostic[] = [];
  for (const facet of ENGINE_TARGET_FILTER_FACETS[category]) {
    let facetRule: EngineCategoryTargetFilter | undefined;
    let missing: (part: Part) => boolean = () => false;
    if (facet.kind === "brands") {
      if (!rule.brands || rule.brands.length === 0) continue;
      facetRule = { brands: rule.brands };
      missing = (part) => !part.brand?.trim();
    } else if (facet.kind === "values") {
      const values = rule.specValues?.[facet.id];
      if (!values || values.length === 0) continue;
      facetRule = { specValues: { [facet.id]: values } };
      missing = (part) => specFilterValuesFor(part, facet.id).length === 0;
    } else if (facet.kind === "range") {
      const ranges = rule.numericRanges?.[facet.id];
      if (!ranges || ranges.length === 0) continue;
      facetRule = { numericRanges: { [facet.id]: ranges } };
      missing = (part) => typeof part.specs[facet.id as keyof PartSpecs] !== "number";
    } else if (facet.kind === "flag") {
      const expected = rule.flags?.[facet.id];
      if (expected === undefined) continue;
      facetRule = { flags: { [facet.id]: expected } };
      missing = (part) => typeof part.specs[facet.id as keyof PartSpecs] !== "boolean";
    } else if (facet.kind === "price") {
      if (!rule.priceWon || (rule.priceWon.min === undefined && rule.priceWon.max === undefined)) continue;
      facetRule = { priceWon: rule.priceWon };
      missing = (part) => !isKnownPrice(part.priceWon);
    }
    if (!facetRule) continue;
    diagnostics.push({
      id: facet.id,
      label: facet.label,
      excludedCount: parts.filter((part) => !engineTargetFilterRuleAllowsPart(part, facetRule)).length,
      missingCount: parts.filter(missing).length
    });
  }
  return diagnostics;
}

// ---------- 정규화 ----------

export type EngineTargetFiltersParseResult = {
  valid: boolean;
  config: EngineTargetFiltersConfig;
  errors: string[];
};

function normalizedBrandList(raw: unknown, label: string, errors: string[]) {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    errors.push(`${label}의 제조사 목록은 배열이어야 합니다.`);
    return undefined;
  }
  if (raw.length > ENGINE_TARGET_FILTER_LIMITS.maxBrands) {
    errors.push(`${label}의 제조사는 최대 ${ENGINE_TARGET_FILTER_LIMITS.maxBrands}개까지 선택할 수 있습니다.`);
    return undefined;
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      errors.push(`${label}의 제조사 값은 문자열이어야 합니다.`);
      return undefined;
    }
    const value = item.trim();
    if (!value) continue;
    if (value.length > ENGINE_TARGET_FILTER_LIMITS.maxBrandLength) {
      errors.push(`${label}의 제조사 이름은 ${ENGINE_TARGET_FILTER_LIMITS.maxBrandLength}자 이하여야 합니다.`);
      return undefined;
    }
    const key = normalizedFilterText(value);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values.length > 0 ? values : undefined;
}

function normalizedRangeValue(raw: unknown, label: string, errors: string[]) {
  if (raw === undefined || raw === null || raw === "") return { skip: true as const };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > ENGINE_TARGET_FILTER_LIMITS.maxPriceWon) {
    errors.push(`${label}은 0 이상 ${ENGINE_TARGET_FILTER_LIMITS.maxPriceWon.toLocaleString("ko-KR")} 이하의 숫자여야 합니다.`);
    return { skip: true as const };
  }
  return { value };
}

function normalizedRange(raw: unknown, label: string, errors: string[]) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${label} 범위는 객체여야 합니다.`);
    return undefined;
  }
  const candidate = raw as Record<string, unknown>;
  const min = normalizedRangeValue(candidate.min, `${label} 최소값`, errors);
  const max = normalizedRangeValue(candidate.max, `${label} 최대값`, errors);
  if (min.value === undefined && max.value === undefined) return undefined;
  if (min.value !== undefined && max.value !== undefined && min.value > max.value) {
    errors.push(`${label}의 최소값이 최대값보다 큽니다.`);
    return undefined;
  }
  const range: EngineFilterRange = {};
  if (min.value !== undefined) range.min = min.value;
  if (max.value !== undefined) range.max = max.value;
  return range;
}

function normalizedSpecValues(raw: unknown, label: string, errors: string[]) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${label}의 스펙 값 조건은 객체여야 합니다.`);
    return undefined;
  }
  const result: Partial<Record<EngineFilterSpecValueField, string[]>> = {};
  for (const [field, rawOptions] of Object.entries(raw as Record<string, unknown>)) {
    if (!ENGINE_FILTER_SPEC_VALUE_FIELD_SET.has(field)) {
      errors.push(`${label}에서 지원하지 않는 스펙 조건 필드입니다: ${field}`);
      continue;
    }
    if (!Array.isArray(rawOptions)) {
      errors.push(`${label}의 ${field} 조건은 배열이어야 합니다.`);
      continue;
    }
    if (rawOptions.length > ENGINE_TARGET_FILTER_LIMITS.maxValuesPerField) {
      errors.push(`${label}의 ${field} 조건은 최대 ${ENGINE_TARGET_FILTER_LIMITS.maxValuesPerField}개까지 선택할 수 있습니다.`);
      continue;
    }
    const values: string[] = [];
    const seen = new Set<string>();
    let fieldFailed = false;
    for (const item of rawOptions) {
      if (typeof item !== "string" && typeof item !== "number") {
        errors.push(`${label}의 ${field} 조건 값은 문자열이어야 합니다.`);
        fieldFailed = true;
        break;
      }
      const value = String(item).trim();
      if (!value) continue;
      if (value.length > ENGINE_TARGET_FILTER_LIMITS.maxValueLength) {
        errors.push(`${label}의 ${field} 조건 값은 ${ENGINE_TARGET_FILTER_LIMITS.maxValueLength}자 이하여야 합니다.`);
        fieldFailed = true;
        break;
      }
      const key = normalizedFilterText(value);
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(value);
    }
    if (fieldFailed) continue;
    if (values.length > 0) result[field as EngineFilterSpecValueField] = values;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizedNumericRanges(raw: unknown, label: string, errors: string[]) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${label}의 수치 범위 조건은 객체여야 합니다.`);
    return undefined;
  }
  const result: Partial<Record<EngineFilterNumericField, EngineFilterRange[]>> = {};
  for (const [field, rawRanges] of Object.entries(raw as Record<string, unknown>)) {
    if (!ENGINE_FILTER_NUMERIC_FIELD_SET.has(field)) {
      errors.push(`${label}에서 지원하지 않는 수치 필드입니다: ${field}`);
      continue;
    }
    const rangeInputs = Array.isArray(rawRanges) ? rawRanges : rawRanges && typeof rawRanges === "object" ? [rawRanges] : undefined;
    if (!rangeInputs) {
      errors.push(`${label}의 ${field} 조건은 범위 배열이어야 합니다.`);
      continue;
    }
    if (rangeInputs.length > ENGINE_TARGET_FILTER_LIMITS.maxRangesPerField) {
      errors.push(`${label}의 ${field} 범위는 최대 ${ENGINE_TARGET_FILTER_LIMITS.maxRangesPerField}개까지 지정할 수 있습니다.`);
      continue;
    }
    const ranges: EngineFilterRange[] = [];
    for (const rawRange of rangeInputs) {
      const range = normalizedRange(rawRange, `${label}의 ${field}`, errors);
      if (range) ranges.push(range);
    }
    if (ranges.length > 0) result[field as EngineFilterNumericField] = ranges;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizedFlags(raw: unknown, label: string, errors: string[]) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${label}의 플래그 조건은 객체여야 합니다.`);
    return undefined;
  }
  const result: Partial<Record<EngineFilterFlagField, boolean>> = {};
  for (const [field, rawExpected] of Object.entries(raw as Record<string, unknown>)) {
    if (!ENGINE_FILTER_FLAG_FIELD_SET.has(field)) {
      errors.push(`${label}에서 지원하지 않는 플래그 필드입니다: ${field}`);
      continue;
    }
    if (typeof rawExpected !== "boolean") {
      errors.push(`${label}의 ${field} 조건은 참/거짓이어야 합니다.`);
      continue;
    }
    result[field as EngineFilterFlagField] = rawExpected;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function engineTargetFilterRuleFromUnknown(raw: unknown, category: PartCategory, errors: string[]): EngineCategoryTargetFilter | undefined {
  if (raw === undefined || raw === null) return undefined;
  const label = `견적 필터 ${category}`;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${label}은 객체여야 합니다.`);
    return undefined;
  }
  const candidate = raw as Record<string, unknown>;
  const rule: EngineCategoryTargetFilter = {};
  const brands = normalizedBrandList(candidate.brands, label, errors);
  if (brands) rule.brands = brands;
  const specValues = normalizedSpecValues(candidate.specValues, label, errors);
  if (specValues) rule.specValues = specValues;
  const numericRanges = normalizedNumericRanges(candidate.numericRanges, label, errors);
  if (numericRanges) rule.numericRanges = numericRanges;
  const flags = normalizedFlags(candidate.flags, label, errors);
  if (flags) rule.flags = flags;
  const priceWon = normalizedRange(candidate.priceWon, `${label} 가격대`, errors);
  if (priceWon) rule.priceWon = priceWon;
  return engineCategoryTargetFilterIsEmpty(rule) ? undefined : rule;
}

export function engineTargetFilterConfigFromUnknown(raw: unknown): EngineTargetFiltersParseResult {
  const errors: string[] = [];
  if (raw === undefined || raw === null) return { valid: true, config: emptyEngineTargetFiltersConfig(), errors };
  if (typeof raw !== "object" || Array.isArray(raw)) return { valid: false, config: emptyEngineTargetFiltersConfig(), errors: ["견적 필터 설정은 객체여야 합니다."] };
  const candidate = raw as Record<string, unknown>;
  let enabled = true;
  if (candidate.enabled !== undefined) {
    if (typeof candidate.enabled === "boolean") enabled = candidate.enabled;
    else errors.push("enabled는 참/거짓이어야 합니다.");
  }
  const rawCategories = candidate.categories ?? {};
  if (typeof rawCategories !== "object" || Array.isArray(rawCategories) || rawCategories === null) {
    errors.push("categories는 범주별 조건 객체여야 합니다.");
    return { valid: false, config: emptyEngineTargetFiltersConfig(), errors };
  }
  const categories: EngineTargetFilters = {};
  for (const [category, rawRule] of Object.entries(rawCategories as Record<string, unknown>)) {
    if (!PART_CATEGORY_SET.has(category)) {
      errors.push(`지원하지 않는 부품 범주입니다: ${category}`);
      continue;
    }
    const rule = engineTargetFilterRuleFromUnknown(rawRule, category as PartCategory, errors);
    if (rule) categories[category as PartCategory] = rule;
  }
  return { valid: errors.length === 0, config: { schemaVersion: 1, enabled, categories }, errors };
}

// ---------- 관리자 facet 정의 ----------

export type EngineFilterBucket = { label: string; min?: number; max?: number };

export type EngineTargetFilterFacet =
  | { id: "brands"; kind: "brands"; label: string }
  | { id: EngineFilterSpecValueField; kind: "values"; label: string }
  | { id: EngineFilterNumericField; kind: "range"; label: string; unit?: string; buckets?: EngineFilterBucket[] }
  | { id: EngineFilterFlagField; kind: "flag"; label: string; optionLabel: string }
  | { id: "price"; kind: "price"; label: string };

const BRAND_FACET: EngineTargetFilterFacet = { id: "brands", kind: "brands", label: "제조사별" };
const PRICE_FACET: EngineTargetFilterFacet = { id: "price", kind: "price", label: "가격대" };

export const ENGINE_TARGET_FILTER_FACETS: Record<PartCategory, EngineTargetFilterFacet[]> = {
  cpu: [
    BRAND_FACET,
    { id: "socket", kind: "values", label: "소켓" },
    { id: "memoryType", kind: "values", label: "메모리 타입" },
    { id: "cores", kind: "range", label: "코어 수", unit: "코어", buckets: [{ label: "16코어~", min: 16 }, { label: "12~15코어", min: 12, max: 15 }, { label: "8~11코어", min: 8, max: 11 }, { label: "6~7코어", min: 6, max: 7 }, { label: "~5코어", max: 5 }] },
    { id: "tdpW", kind: "range", label: "TDP", unit: "W" },
    { id: "integratedGraphics", kind: "flag", label: "내장 그래픽", optionLabel: "내장 그래픽 탑재만" },
    { id: "cinebenchR23Multi", kind: "range", label: "R23 멀티 점수", unit: "점" },
    PRICE_FACET
  ],
  cooler: [
    BRAND_FACET,
    { id: "coolerType", kind: "values", label: "쿨링 방식" },
    { id: "supportedSockets", kind: "values", label: "지원 소켓" },
    { id: "maxCoolingW", kind: "range", label: "최대 냉각 용량", unit: "W" },
    { id: "radiatorSizesMm", kind: "values", label: "라디에이터" },
    { id: "maxCoolerHeightMm", kind: "range", label: "쿨러 높이", unit: "mm" },
    PRICE_FACET
  ],
  motherboard: [
    BRAND_FACET,
    { id: "socket", kind: "values", label: "소켓" },
    { id: "formFactor", kind: "values", label: "폼팩터" },
    { id: "memoryType", kind: "values", label: "메모리 타입" },
    { id: "m2Slots", kind: "range", label: "M.2 슬롯", unit: "개" },
    { id: "sataPorts", kind: "range", label: "SATA 포트", unit: "개" },
    { id: "wifi", kind: "flag", label: "무선 네트워크", optionLabel: "Wi-Fi 탑재만" },
    { id: "vrmCapacityW", kind: "range", label: "전원부 용량", unit: "W" },
    PRICE_FACET
  ],
  memory: [
    BRAND_FACET,
    { id: "memoryType", kind: "values", label: "메모리 타입" },
    { id: "capacityGb", kind: "range", label: "모듈 용량", unit: "GB", buckets: [{ label: "64GB~", min: 64 }, { label: "32~63GB", min: 32, max: 63 }, { label: "16~31GB", min: 16, max: 31 }, { label: "~15GB", max: 15 }] },
    { id: "speedMhz", kind: "range", label: "동작 속도", unit: "MHz", buckets: [{ label: "7200MHz~", min: 7200 }, { label: "6000~7199MHz", min: 6000, max: 7199 }, { label: "5600~5999MHz", min: 5600, max: 5999 }, { label: "3200~5599MHz", min: 3200, max: 5599 }, { label: "~3199MHz", max: 3199 }] },
    { id: "formFactor", kind: "values", label: "폼팩터" },
    { id: "memoryModuleCountPerKit", kind: "values", label: "킷 모듈 수" },
    { id: "memoryCasLatency", kind: "range", label: "CL 레이턴시", unit: "CL" },
    PRICE_FACET
  ],
  gpu: [
    BRAND_FACET,
    { id: "gpuVendor", kind: "values", label: "칩 벤더" },
    { id: "vramGb", kind: "range", label: "VRAM", unit: "GB", buckets: [{ label: "20GB~", min: 20 }, { label: "16~19GB", min: 16, max: 19 }, { label: "12~15GB", min: 12, max: 15 }, { label: "8~11GB", min: 8, max: 11 }, { label: "~7GB", max: 7 }] },
    { id: "gpuMemoryType", kind: "values", label: "메모리 타입" },
    { id: "gpuBoostClockMhz", kind: "range", label: "부스트 클럭", unit: "MHz" },
    { id: "lengthMm", kind: "range", label: "카드 길이", unit: "mm" },
    { id: "powerW", kind: "range", label: "소비 전력", unit: "W" },
    { id: "recommendedPsuW", kind: "range", label: "권장 파워", unit: "W" },
    PRICE_FACET
  ],
  ssd: [
    BRAND_FACET,
    { id: "formFactor", kind: "values", label: "폼팩터" },
    { id: "interface", kind: "values", label: "인터페이스" },
    { id: "m2PcieGeneration", kind: "values", label: "PCIe 세대" },
    { id: "capacityGb", kind: "range", label: "용량", unit: "GB", buckets: [{ label: "3TB~", min: 3000 }, { label: "1~2.9TB", min: 1000, max: 2999 }, { label: "600~999GB", min: 600, max: 999 }, { label: "270~599GB", min: 270, max: 599 }, { label: "~269GB", max: 269 }] },
    { id: "ssdNandType", kind: "values", label: "메모리 타입" },
    { id: "sequentialReadMbps", kind: "range", label: "순차읽기", unit: "MB/s", buckets: [{ label: "12,000MB/s~", min: 12000 }, { label: "8,000~11,999", min: 8000, max: 11999 }, { label: "6,000~7,999", min: 6000, max: 7999 }, { label: "4,000~5,999", min: 4000, max: 5999 }, { label: "2,500~3,999", min: 2500, max: 3999 }, { label: "~2,499", max: 2499 }] },
    { id: "sequentialWriteMbps", kind: "range", label: "순차쓰기", unit: "MB/s", buckets: [{ label: "9,000MB/s~", min: 9000 }, { label: "7,000~8,999", min: 7000, max: 8999 }, { label: "6,000~6,999", min: 6000, max: 6999 }, { label: "5,000~5,999", min: 5000, max: 5999 }, { label: "4,000~4,999", min: 4000, max: 4999 }, { label: "~3,999", max: 3999 }] },
    { id: "ssdTbwTb", kind: "range", label: "TBW", unit: "TB" },
    PRICE_FACET
  ],
  hdd: [
    BRAND_FACET,
    { id: "formFactor", kind: "values", label: "폼팩터" },
    { id: "interface", kind: "values", label: "인터페이스" },
    { id: "capacityGb", kind: "range", label: "용량", unit: "GB", buckets: [{ label: "8TB~", min: 8000 }, { label: "4~7.9TB", min: 4000, max: 7999 }, { label: "2~3.9TB", min: 2000, max: 3999 }, { label: "~1.9TB", max: 1999 }] },
    PRICE_FACET
  ],
  case: [
    BRAND_FACET,
    { id: "motherboardFormFactors", kind: "values", label: "메인보드 규격" },
    { id: "supportedPsuFormFactors", kind: "values", label: "파워 규격" },
    { id: "maxGpuLengthMm", kind: "range", label: "GPU 허용 길이", unit: "mm" },
    { id: "maxCoolerHeightMm", kind: "range", label: "쿨러 허용 높이", unit: "mm" },
    { id: "maxPsuLengthMm", kind: "range", label: "파워 허용 길이", unit: "mm" },
    { id: "hddBays", kind: "range", label: "HDD 베이", unit: "개" },
    PRICE_FACET
  ],
  psu: [
    BRAND_FACET,
    { id: "wattageW", kind: "range", label: "정격 출력", unit: "W", buckets: [{ label: "1,200W~", min: 1200 }, { label: "1,000~1,199W", min: 1000, max: 1199 }, { label: "800~999W", min: 800, max: 999 }, { label: "600~799W", min: 600, max: 799 }, { label: "400~599W", min: 400, max: 599 }, { label: "~399W", max: 399 }] },
    { id: "efficiency", kind: "values", label: "효율 인증" },
    { id: "psuFormFactor", kind: "values", label: "규격" },
    { id: "psuCableType", kind: "values", label: "케이블 타입" },
    { id: "psuRailType", kind: "values", label: "12V 레일" },
    { id: "psuDepthMm", kind: "range", label: "파워 깊이", unit: "mm" },
    PRICE_FACET
  ]
};

export function engineFilterRangeEqual(left: EngineFilterRange | undefined, right: EngineFilterRange | undefined) {
  return left?.min === right?.min && left?.max === right?.max;
}

const ENGINE_FILTER_OPTION_LABEL_OVERRIDES: Record<string, Record<string, string>> = {
  coolerType: { air: "공랭", liquid: "수랭" },
  gpuVendor: { nvidia: "NVIDIA", amd: "AMD", intel: "Intel" },
  psuCableType: { fully_modular: "풀모듈러", semi_modular: "세미모듈러", non_modular: "케이블 일체형" },
  psuRailType: { single: "싱글 레일", multi: "멀티 레일" },
  radiatorPosition: { front: "전면", top: "상단", rear: "후면", bottom: "하단" }
};

export function engineFilterOptionLabelFor(field: string, value: string) {
  const override = ENGINE_FILTER_OPTION_LABEL_OVERRIDES[field]?.[normalizedFilterText(value)];
  if (override) return override;
  if (field === "m2PcieGeneration" || field === "m2PcieGenerations") {
    const generation = Number(value);
    return Number.isFinite(generation) ? `PCIe ${generation.toFixed(1)}` : value;
  }
  if (field === "memoryModuleCountPerKit") return `${value}개 모듈`;
  if (field === "radiatorSizeMm" || field === "radiatorSizesMm") return `${value}mm`;
  return value;
}
