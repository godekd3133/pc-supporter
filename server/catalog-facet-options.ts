// 공개 부품 찾기의 세부 조건 패널 facet 집계 캐시 — 탐색 풀 필터링과
// 범주 facet 옵션 집계를 카탈로그 배열 참조를 키로 묶는다. 카탈로그가
// 재로드돼 새 배열로 교체되면 WeakMap 키가 바뀌어 자동으로 무효화된다.
import { filterParts } from "./catalog";
import { catalogPartFacetOptionsFor } from "./engine-target-filters";
import type { CatalogFacetOptions } from "./engine-target-filters";
import type { GamingPickerQuoteContext } from "../shared/gaming-picker-policy";
import type { Part, PartCategory } from "../shared/types";
import { PUBLIC_CATALOG_FILTER_FACETS } from "../shared/public-catalog-filters";

const facetOptionsCache = new WeakMap<Part[], Map<string, CatalogFacetOptions>>();

// /api/parts/facets가 쓰는 탐색 풀(견적 선택 가능 부품) 기준 facet 옵션을
// 카탈로그 revision 단위로 재사용한다 — 범주 전환마다 재집계하지 않는다.
// searchAllParts는 부품 선택기 검색 풀(브랜드/세대 제한 해제)의 선택지를 센다.
export function catalogFacetOptionsCachedFor(catalog: Part[], category: PartCategory, quoteContext?: GamingPickerQuoteContext, searchAllParts = false): CatalogFacetOptions {
  let byCategory = facetOptionsCache.get(catalog);
  if (!byCategory) {
    byCategory = new Map();
    facetOptionsCache.set(catalog, byCategory);
  }
  const key = `${category}:${quoteContext ?? (searchAllParts ? "search-all" : "general")}`;
  const cached = byCategory.get(key);
  if (cached) return cached;
  const parts = filterParts(catalog, category, undefined, { quoteBrandRestricted: true, quoteSellableOnly: true, ...(quoteContext ? { quoteContext } : searchAllParts ? { searchAllParts: true } : {}) });
  const options = catalogPartFacetOptionsFor(parts, category, PUBLIC_CATALOG_FILTER_FACETS[category]);
  byCategory.set(key, options);
  return options;
}
