import type { PartCategory } from "./types";
import { ENGINE_TARGET_FILTER_FACETS, engineTargetFilterRuleForCategory } from "./engine-target-filters";
import type { EngineCategoryTargetFilter, EngineTargetFilterFacet } from "./engine-target-filters";

// 공개 검색 조건만 간소화한다. 관리자 생성기 필터와 저장된 설정은 보존한다.
const HIDDEN_PUBLIC_GPU_FACETS = new Set<string>(["gpuMemoryType", "gpuBoostClockMhz", "lowProfileBracket", "powerW", "recommendedPsuW", "lengthMm"]);
export const PUBLIC_CATALOG_FILTER_FACETS: Record<PartCategory, EngineTargetFilterFacet[]> = {
  ...ENGINE_TARGET_FILTER_FACETS,
  gpu: ENGINE_TARGET_FILTER_FACETS.gpu.filter((facet) => !HIDDEN_PUBLIC_GPU_FACETS.has(facet.id)).map((facet) => facet.id === "thicknessMm"
    ? { id: "thicknessMm", kind: "range", label: "그래픽카드 두께", unit: "mm", checkboxOnly: true, buckets: [{ label: "~41mm", max: 41 }, { label: "~51mm", max: 51 }, { label: "~61mm", max: 61 }] }
    : facet)
};
export function publicCatalogDetailFilterForCategory(rule: EngineCategoryTargetFilter | undefined, category: PartCategory) {
  return engineTargetFilterRuleForCategory(rule, category, PUBLIC_CATALOG_FILTER_FACETS[category]);
}
