import { FiInfo, FiLoader, FiTrash2 } from "react-icons/fi";
import type { PartCategory } from "../shared/types";
import { engineFilterOptionLabelFor, engineFilterRangeEqual, engineTargetFilterRuleForCategory, ENGINE_TARGET_FILTER_FACETS } from "../shared/engine-target-filters";
import type { EngineCategoryTargetFilter, EngineFilterRange, EngineTargetFilterFacet } from "../shared/engine-target-filters";

// 다나와식 세부 사양 조건 — 범주 facet 레지스트리(ENGINE_TARGET_FILTER_FACETS)를
// 그대로 쓰고, 선택값은 쿼리 파라미터 dv./dr./df./db/dprice로 주고받는다.
// 카탈로그 페이지(/catalog)와 부품 선택 모달(PartPicker)이 같은 패널을 쓴다.
export type CatalogDetailFilterDiagnostic = { id: string; label: string; excludedCount: number; missingCount: number };
export type CatalogFacetOption = { value: string; count: number };
export type CatalogFacetOptions = {
  partCount: number;
  brandOptions: CatalogFacetOption[];
  facetOptions: Partial<Record<string, { options: CatalogFacetOption[]; missingCount: number }>>;
  priceRange: { min: number; max: number } | null;
};
export type CatalogFacetsResponse = { category: PartCategory; facets: EngineTargetFilterFacet[]; options: CatalogFacetOptions };
const CATALOG_DETAIL_VALUE_PREFIX = "dv.";
const CATALOG_DETAIL_RANGE_PREFIX = "dr.";
const CATALOG_DETAIL_FLAG_PREFIX = "df.";
const CATALOG_DETAIL_BRANDS_PARAM = "db";
const CATALOG_DETAIL_PRICE_PARAM = "dprice";

function detailRangeFromText(raw: string): EngineFilterRange {
  const boundary = raw.indexOf("-");
  const minRaw = (boundary < 0 ? raw : raw.slice(0, boundary)).trim();
  const maxRaw = boundary < 0 ? "" : raw.slice(boundary + 1).trim();
  const range: EngineFilterRange = {};
  if (minRaw !== "") {
    const min = Number(minRaw);
    if (Number.isFinite(min)) range.min = min;
  }
  if (maxRaw !== "") {
    const max = Number(maxRaw);
    if (Number.isFinite(max)) range.max = max;
  }
  return range;
}

function detailRangeTextFor(range: EngineFilterRange) {
  return `${range.min ?? ""}-${range.max ?? ""}`;
}

export function initialCatalogDetailFilter(): EngineCategoryTargetFilter {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const filter: EngineCategoryTargetFilter = {};
  const specValues: Record<string, string[]> = {};
  const numericRanges: Record<string, EngineFilterRange[]> = {};
  const flags: Record<string, boolean> = {};
  for (const [key, raw] of params.entries()) {
    if (key === CATALOG_DETAIL_BRANDS_PARAM) {
      const brands = raw.split(",").map((value) => value.trim()).filter(Boolean);
      if (brands.length > 0) filter.brands = brands;
      continue;
    }
    if (key === CATALOG_DETAIL_PRICE_PARAM) {
      const range = detailRangeFromText(raw);
      if (range.min !== undefined || range.max !== undefined) filter.priceWon = range;
      continue;
    }
    if (key.startsWith(CATALOG_DETAIL_VALUE_PREFIX)) {
      const field = key.slice(CATALOG_DETAIL_VALUE_PREFIX.length);
      const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
      if (values.length > 0) specValues[field] = [...(specValues[field] ?? []), ...values];
      continue;
    }
    if (key.startsWith(CATALOG_DETAIL_RANGE_PREFIX)) {
      const field = key.slice(CATALOG_DETAIL_RANGE_PREFIX.length);
      const ranges = raw.split(";").map((token) => token.trim()).filter(Boolean).map(detailRangeFromText).filter((range) => range.min !== undefined || range.max !== undefined);
      if (ranges.length > 0) numericRanges[field] = [...(numericRanges[field] ?? []), ...ranges];
      continue;
    }
    if (key.startsWith(CATALOG_DETAIL_FLAG_PREFIX)) {
      const field = key.slice(CATALOG_DETAIL_FLAG_PREFIX.length);
      const normalized = raw.trim().toLowerCase();
      if (normalized === "1" || normalized === "true") flags[field] = true;
      else if (normalized === "0" || normalized === "false") flags[field] = false;
    }
  }
  if (Object.keys(specValues).length > 0) filter.specValues = specValues as EngineCategoryTargetFilter["specValues"];
  if (Object.keys(numericRanges).length > 0) filter.numericRanges = numericRanges as EngineCategoryTargetFilter["numericRanges"];
  if (Object.keys(flags).length > 0) filter.flags = flags as EngineCategoryTargetFilter["flags"];
  return filter;
}

// 현재 범주 facet에 선언된 필드만 남긴다 — 다른 범주의 공유 링크가 열려도
// 선언되지 않은 조건은 보내지 않는다(서버도 같은 규칙으로 걸러낸다).
export function catalogDetailFilterScopedFor(category: PartCategory, filter: EngineCategoryTargetFilter): EngineCategoryTargetFilter | undefined {
  return engineTargetFilterRuleForCategory(filter, category);
}

export function catalogDetailFilterParamsFor(category: PartCategory, filter: EngineCategoryTargetFilter): Record<string, string> {
  const scoped = catalogDetailFilterScopedFor(category, filter);
  const params: Record<string, string> = {};
  if (!scoped) return params;
  if (scoped.brands?.length) params[CATALOG_DETAIL_BRANDS_PARAM] = scoped.brands.join(",");
  for (const [field, values] of Object.entries(scoped.specValues ?? {})) {
    if (values && values.length > 0) params[`${CATALOG_DETAIL_VALUE_PREFIX}${field}`] = values.join(",");
  }
  for (const [field, ranges] of Object.entries(scoped.numericRanges ?? {})) {
    if (ranges && ranges.length > 0) params[`${CATALOG_DETAIL_RANGE_PREFIX}${field}`] = ranges.map(detailRangeTextFor).join(";");
  }
  for (const [field, expected] of Object.entries(scoped.flags ?? {})) {
    if (expected !== undefined) params[`${CATALOG_DETAIL_FLAG_PREFIX}${field}`] = expected ? "1" : "0";
  }
  if (scoped.priceWon && (scoped.priceWon.min !== undefined || scoped.priceWon.max !== undefined)) params[CATALOG_DETAIL_PRICE_PARAM] = detailRangeTextFor(scoped.priceWon);
  return params;
}

type CatalogDetailFilterChip = { key: string; label: string; remove: (rule: EngineCategoryTargetFilter) => EngineCategoryTargetFilter };

function toggleDetailString(list: string[] | undefined, value: string) {
  const next = new Set(list ?? []);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return [...next];
}

function toggleDetailRange(list: EngineFilterRange[] | undefined, range: EngineFilterRange) {
  const current = list ?? [];
  return current.some((existing) => engineFilterRangeEqual(existing, range)) ? current.filter((existing) => !engineFilterRangeEqual(existing, range)) : [...current, range];
}

function catalogDetailFilterChipsFor(category: PartCategory, filter: EngineCategoryTargetFilter): CatalogDetailFilterChip[] {
  const scoped = catalogDetailFilterScopedFor(category, filter) ?? {};
  const chips: CatalogDetailFilterChip[] = [];
  const facetById = new Map<string, EngineTargetFilterFacet>(ENGINE_TARGET_FILTER_FACETS[category].map((facet) => [facet.id, facet]));
  for (const brand of scoped.brands ?? []) {
    chips.push({ key: `brand:${brand}`, label: brand, remove: (rule) => ({ ...rule, brands: (rule.brands ?? []).filter((value) => value !== brand) }) });
  }
  for (const [field, values] of Object.entries(scoped.specValues ?? {})) {
    for (const value of values ?? []) {
      chips.push({ key: `value:${field}:${value}`, label: `${facetById.get(field as EngineTargetFilterFacet["id"])?.label ?? field} · ${engineFilterOptionLabelFor(field, value)}`, remove: (rule) => ({ ...rule, specValues: { ...rule.specValues, [field]: ((rule.specValues?.[field as keyof NonNullable<typeof rule.specValues>] ?? []) as string[]).filter((item) => item !== value) } }) });
    }
  }
  for (const [field, ranges] of Object.entries(scoped.numericRanges ?? {})) {
    const facet = facetById.get(field as EngineTargetFilterFacet["id"]);
    const unit = facet?.kind === "range" ? facet.unit ?? "" : "";
    for (const range of ranges ?? []) {
      const bounds = `${range.min ?? ""}~${range.max ?? ""}${unit ? ` ${unit}` : ""}`;
      chips.push({ key: `range:${field}:${bounds}`, label: `${facet?.label ?? field} ${bounds}`, remove: (rule) => ({ ...rule, numericRanges: { ...rule.numericRanges, [field]: ((rule.numericRanges?.[field as keyof NonNullable<typeof rule.numericRanges>] ?? []) as EngineFilterRange[]).filter((item) => !engineFilterRangeEqual(item, range)) } }) });
    }
  }
  for (const [field, expected] of Object.entries(scoped.flags ?? {})) {
    if (expected === undefined) continue;
    const facet = facetById.get(field as EngineTargetFilterFacet["id"]);
    chips.push({ key: `flag:${field}`, label: facet?.kind === "flag" ? facet.optionLabel : facet?.label ?? field, remove: (rule) => ({ ...rule, flags: { ...rule.flags, [field]: undefined } }) });
  }
  if (scoped.priceWon && (scoped.priceWon.min !== undefined || scoped.priceWon.max !== undefined)) {
    const label = `가격대 ${scoped.priceWon.min?.toLocaleString("ko-KR") ?? ""}~${scoped.priceWon.max?.toLocaleString("ko-KR") ?? ""}원`;
    chips.push({ key: "price", label, remove: (rule) => ({ ...rule, priceWon: undefined }) });
  }
  return chips;
}

// 다나와 스타일의 범주별 세부 사양 필터 패널 — 서버가 범주 facet과 실제
// 카탈로그 선택지(개수 포함)를 내려주면 체크박스/버킷/범위 입력으로 고른다.
export function CatalogDetailFilterPanel({ category, filter, facetOptions, loading, error, detailExcludedCount, detailDiagnostics, onChange, onReset, onRetry }: {
  category: PartCategory;
  filter: EngineCategoryTargetFilter;
  facetOptions: CatalogFacetOptions | null;
  loading: boolean;
  error: string | null;
  detailExcludedCount: number;
  detailDiagnostics: CatalogDetailFilterDiagnostic[];
  onChange: (next: EngineCategoryTargetFilter) => void;
  onReset: () => void;
  onRetry: () => void;
}) {
  const facets = ENGINE_TARGET_FILTER_FACETS[category];
  const rule = catalogDetailFilterScopedFor(category, filter) ?? {};
  const chips = catalogDetailFilterChipsFor(category, filter);
  const apply = (next: EngineCategoryTargetFilter) => onChange(catalogDetailFilterScopedFor(category, next) ?? {});
  const missingNotes = detailDiagnostics.filter((diagnostic) => diagnostic.missingCount > 0).slice(0, 4);

  const renderValuesFacet = (facet: Extract<EngineTargetFilterFacet, { kind: "values" }>) => {
    const selected = rule.specValues?.[facet.id] ?? [];
    const optionSet = facetOptions?.facetOptions?.[facet.id];
    const knownValues = new Set((optionSet?.options ?? []).map((option) => option.value));
    const extraValues = selected.filter((value) => !knownValues.has(value));
    const options = [...(optionSet?.options ?? []), ...extraValues.map((value) => ({ value, count: 0 }))];
    if (options.length === 0) return <p className="catalog-detail-facet-empty">등록된 값이 없는 조건입니다.</p>;
    return <>
      <div className="catalog-detail-facet-options">
        {options.map((option) => {
          const checked = selected.includes(option.value);
          return <label key={option.value} className={`catalog-facet-option${checked ? " checked" : ""}`}>
            <input
              type="checkbox"
              checked={checked}
              data-testid={`catalog-detail-facet-${facet.id}-${option.value}`}
              onChange={() => apply({ ...rule, specValues: { ...rule.specValues, [facet.id]: toggleDetailString(selected, option.value) } })}
            />
            <span>{engineFilterOptionLabelFor(facet.id, option.value)}</span>
            {option.count > 0 && <em>{option.count.toLocaleString("ko-KR")}</em>}
          </label>;
        })}
      </div>
      {(optionSet?.missingCount ?? 0) > 0 && <small className="catalog-detail-facet-missing">값 미등록 {optionSet!.missingCount.toLocaleString("ko-KR")}개 — 선택하면 자동으로 제외됩니다.</small>}
    </>;
  };

  const renderRangeFacet = (facet: Extract<EngineTargetFilterFacet, { kind: "range" }>) => {
    const ranges = rule.numericRanges?.[facet.id] ?? [];
    const first = ranges[0] ?? {};
    const setBound = (bound: "min" | "max", raw: string) => {
      const value = raw.trim() === "" ? undefined : Number(raw);
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) return;
      const next = { ...first };
      if (value === undefined) delete next[bound];
      else next[bound] = value;
      apply({ ...rule, numericRanges: { ...rule.numericRanges, [facet.id]: next.min === undefined && next.max === undefined ? [] : [next] } });
    };
    return <>
      {facet.buckets && facet.buckets.length > 0 && (
        <div className="catalog-detail-facet-options">
          {facet.buckets.map((bucket) => {
            const checked = ranges.some((range) => engineFilterRangeEqual(range, { min: bucket.min, max: bucket.max }));
            return <label key={bucket.label} className={`catalog-facet-option${checked ? " checked" : ""}`}>
              <input
                type="checkbox"
                checked={checked}
                data-testid={`catalog-detail-facet-${facet.id}-${bucket.label}`}
                onChange={() => apply({ ...rule, numericRanges: { ...rule.numericRanges, [facet.id]: toggleDetailRange(ranges, { min: bucket.min, max: bucket.max }) } })}
              />
              <span>{bucket.label}</span>
            </label>;
          })}
        </div>
      )}
      <div className="catalog-detail-facet-range-inputs">
        <input type="number" min="0" inputMode="numeric" aria-label={`${facet.label} 최소`} placeholder="최소" value={first.min ?? ""} onChange={(event) => setBound("min", event.target.value)} />
        <span>~</span>
        <input type="number" min="0" inputMode="numeric" aria-label={`${facet.label} 최대`} placeholder="최대" value={first.max ?? ""} onChange={(event) => setBound("max", event.target.value)} />
        {facet.unit && <em>{facet.unit}</em>}
      </div>
    </>;
  };

  const renderFacetBody = (facet: EngineTargetFilterFacet) => {
    if (facet.kind === "brands") {
      const options = facetOptions?.brandOptions ?? [];
      const selected = new Set(rule.brands ?? []);
      const extraBrands = (rule.brands ?? []).filter((brand) => !options.some((option) => option.value === brand));
      const rows = [...options, ...extraBrands.map((value) => ({ value, count: 0 }))];
      if (rows.length === 0) return <p className="catalog-detail-facet-empty">등록된 제조사가 없습니다.</p>;
      return <div className="catalog-detail-facet-options">
        {rows.map((option) => {
          const checked = selected.has(option.value);
          return <label key={option.value} className={`catalog-facet-option${checked ? " checked" : ""}`}>
            <input
              type="checkbox"
              checked={checked}
              data-testid={`catalog-detail-facet-brand-${option.value}`}
              onChange={() => apply({ ...rule, brands: toggleDetailString(rule.brands, option.value) })}
            />
            <span>{option.value}</span>
            {option.count > 0 && <em>{option.count.toLocaleString("ko-KR")}</em>}
          </label>;
        })}
      </div>;
    }
    if (facet.kind === "values") return renderValuesFacet(facet);
    if (facet.kind === "range") return renderRangeFacet(facet);
    if (facet.kind === "flag") {
      const checked = rule.flags?.[facet.id] === true;
      return <label className={`catalog-facet-option flag${checked ? " checked" : ""}`}>
        <input
          type="checkbox"
          checked={checked}
          data-testid={`catalog-detail-facet-${facet.id}`}
          onChange={(event) => apply({ ...rule, flags: { ...rule.flags, [facet.id]: event.target.checked ? true : undefined } })}
        />
        <span>{facet.optionLabel}</span>
      </label>;
    }
    const price = rule.priceWon ?? {};
    const priceRange = facetOptions?.priceRange;
    const setPriceBound = (bound: "min" | "max", raw: string) => {
      const value = raw.trim() === "" ? undefined : Number(raw);
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) return;
      const next = { ...price };
      if (value === undefined) delete next[bound];
      else next[bound] = value;
      apply({ ...rule, priceWon: next.min === undefined && next.max === undefined ? undefined : next });
    };
    return <div className="catalog-detail-facet-range-inputs">
      <input type="number" min="0" inputMode="numeric" aria-label="가격대 최소" placeholder={priceRange ? `최소 ${priceRange.min.toLocaleString("ko-KR")}` : "최소 가격"} value={price.min ?? ""} onChange={(event) => setPriceBound("min", event.target.value)} />
      <span>~</span>
      <input type="number" min="0" inputMode="numeric" aria-label="가격대 최대" placeholder={priceRange ? `최대 ${priceRange.max.toLocaleString("ko-KR")}` : "최대 가격"} value={price.max ?? ""} onChange={(event) => setPriceBound("max", event.target.value)} />
      <em>원</em>
    </div>;
  };

  return <section className="catalog-detail-filter-panel" aria-label="카탈로그 세부 사양 필터" data-testid="catalog-detail-filters">
    <div className="catalog-spec-filter-heading">
      <div><strong>세부 사양 조건</strong><small>다나와처럼 범주별 세부 스펙을 골라요. 같은 조건 안의 선택지는 OR, 다른 조건끼리는 AND로 적용돼요.</small></div>
      <button className="text-button" type="button" data-testid="catalog-clear-detail-filters" onClick={onReset} disabled={chips.length === 0}>조건 초기화</button>
    </div>
    {loading && !facetOptions
      ? <p className="catalog-detail-facet-state" role="status"><FiLoader className="spin" /> 세부 조건을 불러오는 중...</p>
      : error && !facetOptions
        ? <p className="catalog-detail-facet-state error" role="alert"><FiInfo /> {error} <button className="text-button" type="button" onClick={onRetry}>다시 불러오기</button></p>
        : <div className="catalog-detail-facet-list">
            {facets.map((facet) => <div className="catalog-detail-facet" key={facet.id}>
              <div className="catalog-detail-facet-label"><span>{facet.label}</span></div>
              <div className="catalog-detail-facet-body">{renderFacetBody(facet)}</div>
            </div>)}
          </div>}
    {chips.length > 0 && <div className="catalog-detail-filter-chips" data-testid="catalog-detail-filter-chips">
      <span className="catalog-detail-filter-chips-label">선택 조건 {chips.length}개{detailExcludedCount > 0 ? ` · ${detailExcludedCount.toLocaleString("ko-KR")}개 제외` : ""}</span>
      {chips.map((chip) => <button key={chip.key} type="button" className="catalog-detail-filter-chip" data-testid={`catalog-detail-chip-${chip.key}`} onClick={() => apply(chip.remove(rule))} aria-label={`${chip.label} 조건 해제`}>{chip.label}<FiTrash2 aria-hidden="true" /></button>)}
    </div>}
    {missingNotes.length > 0 && <p className="catalog-spec-filter-missing" role="status"><FiInfo /> 비교 값이 없어 제외된 부품 {missingNotes.map((item) => `${item.label} ${item.missingCount.toLocaleString("ko-KR")}개`).join(" · ")}</p>}
  </section>;
}
