import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { emptyEngineTargetFiltersConfig, engineTargetFilterActiveFacetCount, engineTargetFilterConfigFromUnknown, engineTargetFiltersAllowPart, ENGINE_TARGET_FILTER_FACETS } from "../shared/engine-target-filters";
import type { EngineTargetFiltersConfig } from "../shared/engine-target-filters";
import { isKnownPrice, PART_CATEGORIES } from "../shared/types";
import type { Part, PartCategory } from "../shared/types";
import { isQuoteBrandAllowed, isQuoteSelectable } from "./listing";
import { DATA_DIR, fileUpdatedAt, withSerializedFileMutation, writeJson } from "./storage";
import { publishInstanceEvent } from "./instance-events";
import { pushRuntimeConfigToDatabase } from "./runtime-config-store";

export type EngineTargetFilterCategorySummary = {
  totalCount: number;
  eligibleCount: number;
  matchingCount: number;
  activeFacets: number;
};

export type EngineTargetFilterSummary = Partial<Record<PartCategory, EngineTargetFilterCategorySummary>>;

export type EngineTargetFilterValueOption = {
  value: string;
  count: number;
};

export type EngineTargetFilterCategoryFacetOptions = {
  partCount: number;
  brandOptions: EngineTargetFilterValueOption[];
  facetOptions: Partial<Record<string, { options: EngineTargetFilterValueOption[]; missingCount: number }>>;
};

type EngineTargetFiltersCache = { path: string; mtimeMs: number; config: EngineTargetFiltersConfig } | undefined;
let cache: EngineTargetFiltersCache;

export function engineTargetFiltersPath() {
  return process.env.ENGINE_TARGET_FILTERS_PATH?.trim() || resolve(DATA_DIR, "engine-target-filters.json");
}

export function loadEngineTargetFiltersConfig(): EngineTargetFiltersConfig {
  const path = engineTargetFiltersPath();
  if (!existsSync(path)) return emptyEngineTargetFiltersConfig();
  try {
    const mtimeMs = statSync(path).mtimeMs;
    if (cache?.path === path && cache.mtimeMs === mtimeMs) return cache.config;
    const parsed = engineTargetFilterConfigFromUnknown(JSON.parse(readFileSync(path, "utf8")));
    const config = parsed.config;
    cache = { path, mtimeMs, config };
    return config;
  } catch {
    return emptyEngineTargetFiltersConfig();
  }
}

export function invalidateEngineTargetFiltersCache() {
  cache = undefined;
}

async function persistEngineTargetFiltersConfig(config: EngineTargetFiltersConfig) {
  const path = engineTargetFiltersPath();
  await withSerializedFileMutation(path, async () => {
    await writeJson(path, config);
    invalidateEngineTargetFiltersCache();
  });
}

export async function saveEngineTargetFiltersConfig(config: EngineTargetFiltersConfig) {
  const path = engineTargetFiltersPath();
  await persistEngineTargetFiltersConfig(config);
  // 공유 원본(runtime_configs)에 올리고 다른 인스턴스에 무효화만 알린다.
  await pushRuntimeConfigToDatabase("engine-target-filters", config);
  void publishInstanceEvent("config:file", { name: "engine-target-filters" });
  return { config: loadEngineTargetFiltersConfig(), updatedAt: await fileUpdatedAt(path) };
}

// 다른 인스턴스가 버스로 복제해온 설정 — 로컬 파일에만 기록하고 재발행하지 않는다.
export async function applyReceivedEngineTargetFiltersConfig(config: EngineTargetFiltersConfig) {
  await persistEngineTargetFiltersConfig(config);
}

// 생성기 후보 풀의 기준 게이트(범주·비핵심 상품·견적 브랜드·가격/스펙 완결)와
// 동일한 선행 조건으로 미리보기 수를 계산해, 저장 전 영향이 실제와 다르지 않게 한다.
function enginePoolBaseAllowsPart(part: Part, category: PartCategory) {
  return part.category === category
    && part.listingType !== "accessory"
    && isQuoteBrandAllowed(category, part.brand)
    && isQuoteSelectable(part);
}

export function engineTargetFilterSummaryFor(catalog: Part[], config: EngineTargetFiltersConfig): EngineTargetFilterSummary {
  const summary: EngineTargetFilterSummary = {};
  for (const category of PART_CATEGORIES) {
    const parts = catalog.filter((part) => part.category === category && part.listingType !== "accessory");
    const eligible = parts.filter((part) => enginePoolBaseAllowsPart(part, category));
    const rule = config.categories[category];
    const matching = eligible.filter((part) => engineTargetFiltersAllowPart(part, config));
    summary[category] = {
      totalCount: parts.length,
      eligibleCount: eligible.length,
      matchingCount: matching.length,
      activeFacets: engineTargetFilterActiveFacetCount(rule)
    };
  }
  return summary;
}

function pushOption(options: Map<string, { value: string; count: number }>, raw: unknown) {
  if (typeof raw !== "string" && typeof raw !== "number") return;
  const value = String(raw).trim();
  if (!value) return;
  const key = value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
  const existing = options.get(key);
  if (existing) existing.count += 1;
  else options.set(key, { value, count: 1 });
}

function sortedOptions(options: Map<string, { value: string; count: number }>, limit = 60) {
  return [...options.values()].sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "ko-KR")).slice(0, limit);
}

export function engineTargetFilterFacetOptionsFor(catalog: Part[]): Record<PartCategory, EngineTargetFilterCategoryFacetOptions> {
  const result = {} as Record<PartCategory, EngineTargetFilterCategoryFacetOptions>;
  for (const category of PART_CATEGORIES) {
    const parts = catalog.filter((part) => part.category === category && part.listingType !== "accessory");
    result[category] = facetOptionsForParts(parts, category);
  }
  return result;
}

// 공개 부품 찾기 화면의 세부 조건 패널이 쓰는 facet 옵션 집계 — 이미 사용자가
// 탐색 가능한 풀(가격·사양 확인된 부품)을 인자로 받아 범주 facet별 선택지와
// 개수, 실제 가격 범위를 돌려준다.
export type CatalogFacetOptions = EngineTargetFilterCategoryFacetOptions & {
  priceRange: { min: number; max: number } | null;
};

export function catalogPartFacetOptionsFor(parts: Part[], category: PartCategory): CatalogFacetOptions {
  const base = facetOptionsForParts(parts, category);
  const prices = parts.map((part) => part.priceWon).filter(isKnownPrice);
  return {
    ...base,
    priceRange: prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices) } : null
  };
}

function facetOptionsForParts(parts: Part[], category: PartCategory): EngineTargetFilterCategoryFacetOptions {
  const brands = new Map<string, { value: string; count: number }>();
  const facetOptions: EngineTargetFilterCategoryFacetOptions["facetOptions"] = {};
  const facets = ENGINE_TARGET_FILTER_FACETS[category];
  const collectors = new Map<string, { options: Map<string, { value: string; count: number }>; missingCount: number }>();
  for (const facet of facets) {
    if (facet.kind === "values") collectors.set(facet.id, { options: new Map(), missingCount: 0 });
  }
  for (const part of parts) {
    if (part.brand?.trim()) pushOption(brands, part.brand);
    for (const facet of facets) {
      if (facet.kind !== "values") continue;
      const collector = collectors.get(facet.id)!;
      const raw = part.specs[facet.id as keyof Part["specs"]];
      const values = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
      if (values.length === 0) {
        collector.missingCount += 1;
        continue;
      }
      for (const value of values) pushOption(collector.options, value);
    }
  }
  for (const [facetId, collector] of collectors) {
    facetOptions[facetId] = { options: sortedOptions(collector.options), missingCount: collector.missingCount };
  }
  return {
    partCount: parts.length,
    brandOptions: sortedOptions(brands),
    facetOptions
  };
}

export function normalizeEngineTargetFiltersInput(raw: unknown) {
  const candidate = raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).config !== undefined
    ? (raw as Record<string, unknown>).config
    : raw;
  return engineTargetFilterConfigFromUnknown(candidate);
}
