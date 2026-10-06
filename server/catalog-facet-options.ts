// 공개 부품 찾기의 세부 조건 패널 facet 집계 캐시 — 탐색 풀 필터링과
// 범주 facet 옵션 집계를 카탈로그 배열 참조를 키로 묶는다. 카탈로그가
// 재로드돼 새 배열로 교체되면 WeakMap 키가 바뀌어 자동으로 무효화된다.
import { filterParts } from "./catalog";
import { catalogPartFacetOptionsFor } from "./engine-target-filters";
import type { CatalogFacetOptions } from "./engine-target-filters";
import type { Part, PartCategory } from "../shared/types";

const facetOptionsCache = new WeakMap<Part[], Map<PartCategory, CatalogFacetOptions>>();

// /api/parts/facets가 쓰는 탐색 풀(견적 선택 가능 부품) 기준 facet 옵션을
// 카탈로그 revision 단위로 재사용한다 — 범주 전환마다 재집계하지 않는다.
export function catalogFacetOptionsCachedFor(catalog: Part[], category: PartCategory): CatalogFacetOptions {
  let byCategory = facetOptionsCache.get(catalog);
  if (!byCategory) {
    byCategory = new Map();
    facetOptionsCache.set(catalog, byCategory);
  }
  const cached = byCategory.get(category);
  if (cached) return cached;
  const parts = filterParts(catalog, category, undefined, { quoteBrandRestricted: true, quoteSellableOnly: true });
  const options = catalogPartFacetOptionsFor(parts, category);
  byCategory.set(category, options);
  return options;
}
