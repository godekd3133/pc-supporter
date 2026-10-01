import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FiAlertTriangle, FiFilter, FiLoader, FiRefreshCw, FiRotateCcw, FiSave, FiXCircle } from "react-icons/fi";
import { emptyEngineTargetFiltersConfig, engineCategoryTargetFilterIsEmpty, engineFilterOptionLabelFor, engineFilterRangeEqual, engineTargetFilterActiveFacetCount, ENGINE_TARGET_FILTER_FACETS } from "../shared/engine-target-filters";
import type { EngineCategoryTargetFilter, EngineFilterRange, EngineTargetFiltersConfig, EngineTargetFilterFacet } from "../shared/engine-target-filters";
import { CATEGORY_LABELS, PART_CATEGORIES } from "../shared/types";
import type { PartCategory } from "../shared/types";
import { api } from "./api";

type EngineFilterCategorySummary = {
  totalCount: number;
  eligibleCount: number;
  matchingCount: number;
  activeFacets: number;
};

type EngineFilterSummary = Partial<Record<PartCategory, EngineFilterCategorySummary>>;

type EngineFilterValueOption = { value: string; count: number };

type EngineFilterCategoryFacetOptions = {
  partCount: number;
  brandOptions: EngineFilterValueOption[];
  facetOptions: Partial<Record<string, { options: EngineFilterValueOption[]; missingCount: number }>>;
  parts?: EngineFilterPartOption[];
};

type EngineFilterPartOption = { id: string; name: string; brand?: string; priceWon?: number };

type EngineGenerationBoundarySummary = {
  line: string;
  topRank: number;
  topLabel: string;
  topCount: number;
  thresholdRank: number;
  thresholdLabel: string;
  activeGenerations: number;
};

type EngineFiltersResponse = {
  config: EngineTargetFiltersConfig;
  summary: EngineFilterSummary;
  generations?: EngineGenerationBoundarySummary[];
  generationGate?: { enabled: boolean; depth: number };
  updatedAt?: string;
};

type EngineFilterFacetsResponse = {
  generatedAt: string;
  categories: Partial<Record<PartCategory, EngineFilterCategoryFacetOptions>>;
};

function cloneConfig(config: EngineTargetFiltersConfig): EngineTargetFiltersConfig {
  return JSON.parse(JSON.stringify(config)) as EngineTargetFiltersConfig;
}

// 저장값과 비교할 수 있도록 빈 규칙·빈 배열을 걷어낸 정규화된 사본.
function compactRule(rule: EngineCategoryTargetFilter | undefined): EngineCategoryTargetFilter | undefined {
  if (!rule) return undefined;
  const next: EngineCategoryTargetFilter = {};
  if (rule.brands && rule.brands.length > 0) next.brands = rule.brands;
  if (rule.specValues) {
    const entries = Object.entries(rule.specValues).filter(([, values]) => Array.isArray(values) && values.length > 0);
    if (entries.length > 0) next.specValues = Object.fromEntries(entries) as EngineCategoryTargetFilter["specValues"];
  }
  if (rule.numericRanges) {
    const entries = Object.entries(rule.numericRanges).filter((entry) => Array.isArray(entry[1]) && entry[1].length > 0 && entry[1].some((range) => range.min !== undefined || range.max !== undefined));
    if (entries.length > 0) next.numericRanges = Object.fromEntries(entries) as EngineCategoryTargetFilter["numericRanges"];
  }
  if (rule.flags) {
    const entries = Object.entries(rule.flags).filter((entry) => entry[1] !== undefined);
    if (entries.length > 0) next.flags = Object.fromEntries(entries) as EngineCategoryTargetFilter["flags"];
  }
  if (rule.priceWon && (rule.priceWon.min !== undefined || rule.priceWon.max !== undefined)) next.priceWon = rule.priceWon;
  if (rule.excludePartIds && rule.excludePartIds.length > 0) next.excludePartIds = rule.excludePartIds;
  return engineCategoryTargetFilterIsEmpty(next) ? undefined : next;
}

function compactConfig(config: EngineTargetFiltersConfig): EngineTargetFiltersConfig {
  const categories: EngineTargetFiltersConfig["categories"] = {};
  for (const [category, rule] of Object.entries(config.categories)) {
    const compacted = compactRule(rule);
    if (compacted) categories[category as PartCategory] = compacted;
  }
  return { schemaVersion: 1, enabled: config.enabled, categories };
}

function withUpdatedRule(config: EngineTargetFiltersConfig, category: PartCategory, rule: EngineCategoryTargetFilter | undefined) {
  const next = cloneConfig(config);
  const compacted = compactRule(rule);
  if (compacted) next.categories[category] = compacted;
  else delete next.categories[category];
  return next;
}

function toggleStringList(list: string[] | undefined, value: string) {
  const next = new Set(list ?? []);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return [...next];
}

function toggleRangeList(list: EngineFilterRange[] | undefined, range: EngineFilterRange) {
  const current = list ?? [];
  const index = current.findIndex((existing) => engineFilterRangeEqual(existing, range));
  if (index >= 0) return current.filter((_, itemIndex) => itemIndex !== index);
  return [...current, range];
}

function updateNumericRangeInput(ranges: EngineFilterRange[] | undefined, bound: "min" | "max", raw: string) {
  const value = raw.trim() === "" ? undefined : Number(raw);
  const first = { ...(ranges?.[0] ?? {}) };
  if (value === undefined) delete first[bound];
  else if (Number.isFinite(value) && value >= 0) first[bound] = value;
  else return ranges;
  return first.min === undefined && first.max === undefined ? [] : [first];
}

export function AdminEngineFiltersPanel({ onToast }: { onToast: (message: string) => void }) {
  const [config, setConfig] = useState<EngineTargetFiltersConfig | null>(null);
  const [savedConfigJson, setSavedConfigJson] = useState("");
  const [summary, setSummary] = useState<EngineFilterSummary>({});
  const [generations, setGenerations] = useState<EngineGenerationBoundarySummary[]>([]);
  const [generationGate, setGenerationGate] = useState<{ enabled: boolean; depth: number } | null>(null);
  const [previewSummary, setPreviewSummary] = useState<EngineFilterSummary | null>(null);
  const [facetOptions, setFacetOptions] = useState<EngineFilterFacetsResponse["categories"]>({});
  const [selectedCategory, setSelectedCategory] = useState<PartCategory>("ssd");
  const [partSearch, setPartSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    const requestVersion = ++requestVersionRef.current;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api<EngineFiltersResponse>("/api/admin/engine-filters"),
      api<EngineFilterFacetsResponse>("/api/admin/engine-filters/facets")
    ])
      .then(([filtersResponse, facetsResponse]) => {
        if (cancelled || requestVersionRef.current !== requestVersion) return;
        const normalized = compactConfig(filtersResponse.config ?? emptyEngineTargetFiltersConfig());
        setConfig(normalized);
        setSavedConfigJson(JSON.stringify(normalized));
        setSummary(filtersResponse.summary ?? {});
        setGenerations(filtersResponse.generations ?? []);
        setGenerationGate(filtersResponse.generationGate ?? null);
        setPreviewSummary(null);
        setUpdatedAt(filtersResponse.updatedAt ?? null);
        setFacetOptions(facetsResponse.categories ?? {});
      })
      .catch((loadError: unknown) => {
        if (cancelled || requestVersionRef.current !== requestVersion) return;
        setError(loadError instanceof Error ? loadError.message : "견적 필터 설정을 불러오지 못했습니다.");
        setConfig(emptyEngineTargetFiltersConfig());
      })
      .finally(() => {
        if (!cancelled && requestVersionRef.current === requestVersion) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  useEffect(() => {
    setPartSearch("");
  }, [selectedCategory]);

  const dirty = useMemo(() => config !== null && JSON.stringify(compactConfig(config)) !== savedConfigJson, [config, savedConfigJson]);
  const displaySummary = previewSummary ?? summary;
  const selectedRule = config?.categories[selectedCategory];
  const selectedSummary = displaySummary[selectedCategory];
  const selectedFacetOptions = facetOptions[selectedCategory];
  const filterDisabled = config ? !config.enabled : false;

  const updateRule = (category: PartCategory, update: (rule: EngineCategoryTargetFilter) => EngineCategoryTargetFilter | undefined) => {
    setConfig((current) => current ? withUpdatedRule(current, category, update(current.categories[category] ?? {})) : current);
    setPreviewSummary(null);
  };

  const saveConfig = async () => {
    if (!config || saving) return;
    setSaving(true);
    try {
      const response = await api<{ saved: boolean; config: EngineTargetFiltersConfig; summary: EngineFilterSummary; updatedAt?: string }>("/api/admin/engine-filters", {
        method: "PUT",
        body: JSON.stringify({ config: compactConfig(config) })
      });
      const normalized = compactConfig(response.config);
      setConfig(normalized);
      setSavedConfigJson(JSON.stringify(normalized));
      setSummary(response.summary ?? {});
      setPreviewSummary(null);
      setUpdatedAt(response.updatedAt ?? null);
      onToast("견적 생성 타겟 필터를 저장했습니다. 다음 자동 견적부터 적용됩니다.");
    } catch (saveError: unknown) {
      onToast(saveError instanceof Error ? saveError.message : "견적 필터 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const previewConfig = async () => {
    if (!config || previewing) return;
    setPreviewing(true);
    try {
      const response = await api<{ summary: EngineFilterSummary }>("/api/admin/engine-filters/preview", {
        method: "POST",
        body: JSON.stringify({ config: compactConfig(config) }),
        retryOnRateLimit: true
      });
      setPreviewSummary(response.summary ?? {});
    } catch (previewError: unknown) {
      onToast(previewError instanceof Error ? previewError.message : "필터 미리보기에 실패했습니다.");
    } finally {
      setPreviewing(false);
    }
  };

  const resetDraft = () => {
    setConfig(savedConfigJson ? JSON.parse(savedConfigJson) as EngineTargetFiltersConfig : emptyEngineTargetFiltersConfig());
    setPreviewSummary(null);
  };

  const renderValueOptions = (facet: Extract<EngineTargetFilterFacet, { kind: "values" }>, rule: EngineCategoryTargetFilter) => {
    const facetOption = selectedFacetOptions?.facetOptions?.[facet.id];
    const selected = new Set(rule.specValues?.[facet.id] ?? []);
    if (!facetOption || facetOption.options.length === 0) {
      return <p className="engine-filter-empty">카탈로그에 값이 등록된 부품이 없습니다.</p>;
    }
    return <>
      <div className="engine-filter-options">
        {facetOption.options.map((option) => {
          const checked = selected.has(option.value);
          return <label key={option.value} className={`engine-filter-option${checked ? " checked" : ""}`}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => updateRule(selectedCategory, (current) => ({
                ...current,
                specValues: { ...current.specValues, [facet.id]: toggleStringList(current.specValues?.[facet.id], option.value) }
              }))}
            />
            <span>{engineFilterOptionLabelFor(facet.id, option.value)}</span>
            <em>{option.count}</em>
          </label>;
        })}
      </div>
      {facetOption.missingCount > 0 && <p className="engine-filter-missing">값 미등록 {facetOption.missingCount}개 — 선택하면 자동으로 제외됩니다.</p>}
    </>;
  };

  const renderRangeFacet = (facet: Extract<EngineTargetFilterFacet, { kind: "range" }>, rule: EngineCategoryTargetFilter) => {
    const ranges = rule.numericRanges?.[facet.id] ?? [];
    const first = ranges[0] ?? {};
    return <div className="engine-filter-range">
      {facet.buckets && facet.buckets.length > 0 && (
        <div className="engine-filter-options">
          {facet.buckets.map((bucket) => {
            const checked = ranges.some((range) => engineFilterRangeEqual(range, { min: bucket.min, max: bucket.max }));
            return <label key={bucket.label} className={`engine-filter-option${checked ? " checked" : ""}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => updateRule(selectedCategory, (current) => ({
                  ...current,
                  numericRanges: { ...current.numericRanges, [facet.id]: toggleRangeList(current.numericRanges?.[facet.id], { min: bucket.min, max: bucket.max }) }
                }))}
              />
              <span>{bucket.label}</span>
            </label>;
          })}
        </div>
      )}
      {!facet.buckets && (
        <div className="engine-filter-range-inputs">
          <input type="number" min="0" inputMode="numeric" placeholder="최소" value={first.min ?? ""} onChange={(event) => updateRule(selectedCategory, (current) => ({ ...current, numericRanges: { ...current.numericRanges, [facet.id]: updateNumericRangeInput(current.numericRanges?.[facet.id], "min", event.target.value) } }))} />
          <span>~</span>
          <input type="number" min="0" inputMode="numeric" placeholder="최대" value={first.max ?? ""} onChange={(event) => updateRule(selectedCategory, (current) => ({ ...current, numericRanges: { ...current.numericRanges, [facet.id]: updateNumericRangeInput(current.numericRanges?.[facet.id], "max", event.target.value) } }))} />
          {facet.unit && <em>{facet.unit}</em>}
        </div>
      )}
    </div>;
  };

  const renderFacetRow = (facet: EngineTargetFilterFacet) => {
    const rule = selectedRule ?? {};
    let body: ReactNode = null;
    if (facet.kind === "brands") {
      const options = selectedFacetOptions?.brandOptions ?? [];
      const selected = new Set(rule.brands ?? []);
      body = options.length === 0
        ? <p className="engine-filter-empty">카탈로그에 브랜드가 없습니다.</p>
        : <div className="engine-filter-options">
            {options.map((option) => {
              const checked = selected.has(option.value);
              return <label key={option.value} className={`engine-filter-option${checked ? " checked" : ""}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => updateRule(selectedCategory, (current) => ({ ...current, brands: toggleStringList(current.brands, option.value) }))}
                />
                <span>{option.value}</span>
                <em>{option.count}</em>
              </label>;
            })}
          </div>;
    } else if (facet.kind === "values") {
      body = renderValueOptions(facet, rule);
    } else if (facet.kind === "range") {
      body = renderRangeFacet(facet, rule);
    } else if (facet.kind === "flag") {
      const checked = rule.flags?.[facet.id] === true;
      body = <label className={`engine-filter-option${checked ? " checked" : ""}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => updateRule(selectedCategory, (current) => {
            const flags = { ...current.flags };
            if (event.target.checked) flags[facet.id] = true;
            else delete flags[facet.id];
            return { ...current, flags };
          })}
        />
        <span>{facet.optionLabel}</span>
      </label>;
    } else if (facet.kind === "price") {
      const price = rule.priceWon ?? {};
      const setBound = (bound: "min" | "max", raw: string) => updateRule(selectedCategory, (current) => {
        const next = { ...(current.priceWon ?? {}) };
        const value = raw.trim() === "" ? undefined : Number(raw);
        if (value === undefined) delete next[bound];
        else if (Number.isFinite(value) && value >= 0) next[bound] = value;
        else return current;
        return { ...current, priceWon: next.min === undefined && next.max === undefined ? undefined : next };
      });
      body = <div className="engine-filter-range-inputs">
        <input type="number" min="0" inputMode="numeric" placeholder="최소 가격" value={price.min ?? ""} onChange={(event) => setBound("min", event.target.value)} />
        <span>~</span>
        <input type="number" min="0" inputMode="numeric" placeholder="최대 가격" value={price.max ?? ""} onChange={(event) => setBound("max", event.target.value)} />
        <em>원</em>
      </div>;
    }
    return <div key={facet.id} className="engine-filter-row">
      <div className="engine-filter-row-label"><FiFilter /><span>{facet.label}</span></div>
      <div className="engine-filter-row-body">{body}</div>
    </div>;
  };

  // 부품 단위 제외 — 허용 조건과 무관하게 체크된 부품 id는 항상 후보에서 빠진다.
  // 선택된 항목은 검색 결과 위로 고정하고, 카탈로그에서 사라진 id(단종·수집 중단)도
  // 목록에 남겨 해제할 수 있게 한다.
  const renderExcludedPartsRow = () => {
    const rule = selectedRule ?? {};
    const partOptions = selectedFacetOptions?.parts ?? [];
    const excluded = new Set(rule.excludePartIds ?? []);
    const query = partSearch.trim().toLocaleLowerCase("ko-KR");
    const matched = query === ""
      ? partOptions
      : partOptions.filter((option) => `${option.brand ?? ""} ${option.name} ${option.id}`.toLocaleLowerCase("ko-KR").includes(query));
    const pinned = matched.filter((option) => excluded.has(option.id));
    const rest = matched.filter((option) => !excluded.has(option.id));
    const visible = [...pinned, ...rest].slice(0, 200);
    const missingExcluded = [...excluded].filter((id) => !partOptions.some((option) => option.id === id));
    const toggleExcluded = (id: string) => updateRule(selectedCategory, (current) => ({ ...current, excludePartIds: toggleStringList(current.excludePartIds, id) }));
    return <div className="engine-filter-row">
      <div className="engine-filter-row-label"><FiXCircle /><span>부품 직접 제외</span></div>
      <div className="engine-filter-row-body">
        <input type="search" className="engine-filter-part-search" placeholder="부품 이름·제조사·id 검색" value={partSearch} onChange={(event) => setPartSearch(event.target.value)} />
        <div className="engine-filter-options">
          {missingExcluded.map((id) => (
            <label key={id} className="engine-filter-option excluded checked">
              <input type="checkbox" checked onChange={() => toggleExcluded(id)} />
              <span>{id} · 카탈로그에 없음</span>
            </label>
          ))}
          {visible.map((option) => {
            const checked = excluded.has(option.id);
            return <label key={option.id} className={`engine-filter-option excluded${checked ? " checked" : ""}`} title={option.id}>
              <input type="checkbox" checked={checked} onChange={() => toggleExcluded(option.id)} />
              <span>{option.brand ? `${option.brand} ` : ""}{option.name}</span>
              {option.priceWon !== undefined && <em>{Math.round(option.priceWon / 10_000)}만</em>}
            </label>;
          })}
        </div>
        {matched.length > visible.length && <p className="engine-filter-missing">검색 결과가 많아 일부만 표시합니다 — 검색어를 더 입력해 좁혀 주세요.</p>}
        {excluded.size > 0 && <p className="engine-filter-missing">이 범주에서 {excluded.size}개 부품을 견적 후보에서 제외합니다.</p>}
      </div>
    </div>;
  };

  return <section className="admin-card engine-filters-card" aria-busy={loading}>
    <div className="admin-card-heading">
      <div><p className="eyebrow">견적 생성 엔진</p><h3>자동 견적 타겟 필터</h3></div>
      <span className={`job-status ${config?.enabled ? "completed" : "idle"}`}>{config?.enabled ? "필터 사용 중" : "필터 해제됨"}</span>
    </div>
    <p className="admin-card-description">자동 견적 생성에 쓸 부품 후보를 범주별로 제한합니다. 같은 조건 안의 선택값은 OR, 서로 다른 조건은 AND로 적용되고, 선택하지 않은 조건은 제한하지 않습니다.</p>
    {generationGate && !generationGate.enabled && <p className="engine-filter-preview-note"><FiAlertTriangle /> 세대 게이트가 해제되어 있어 CPU·GPU의 구세대 부품도 견적 후보에 포함됩니다.</p>}
    {generations.length > 0 && (
      <p className="engine-filter-generation-note" title="카탈로그에 판매 중인 상품으로 자동 계산된 견적 허용 세대입니다. 신세대가 수집되면 자동으로 올라갑니다.">
        세대 경계(자동): {generations.map((entry) => (
          <span key={entry.line} className="engine-filter-generation-chip">
            {entry.thresholdRank === entry.topRank ? `${entry.topLabel}+` : `${entry.thresholdLabel}~${entry.topLabel}`}
            <em>{entry.topCount.toLocaleString("ko-KR")}</em>
          </span>
        ))}
      </p>
    )}
    <div className="engine-filter-toolbar">
      <label className="engine-filter-master">
        <input type="checkbox" checked={config?.enabled ?? true} disabled={!config || loading} onChange={(event) => { setConfig((current) => current ? { ...current, enabled: event.target.checked } : current); setPreviewSummary(null); }} />
        <span>타겟 필터 사용</span>
      </label>
      <span className={`engine-filter-dirty${dirty ? " visible" : ""}`}>{dirty ? "저장되지 않은 변경이 있습니다" : updatedAt ? `마지막 저장 ${new Date(updatedAt).toLocaleString("ko-KR")}` : "저장된 필터가 없습니다"}</span>
      <div className="engine-filter-actions">
        <button className="button button-light" type="button" onClick={() => void previewConfig()} disabled={!config || previewing || saving}>{previewing ? <><FiLoader className="spin" /> 계산 중...</> : <><FiRefreshCw /> 후보 수 미리보기</>}</button>
        <button className="button button-light" type="button" onClick={resetDraft} disabled={!dirty || saving}><FiRotateCcw /> 되돌리기</button>
        <button className="button button-primary" type="button" onClick={() => void saveConfig()} disabled={!dirty || saving || loading}>{saving ? <><FiLoader className="spin" /> 저장 중...</> : <><FiSave /> 저장</>}</button>
      </div>
    </div>
    {error && <p className="crawl-error"><FiAlertTriangle /> {error} <button type="button" className="text-button" onClick={() => setRefreshKey((current) => current + 1)}>다시 불러오기</button></p>}
    {previewSummary && <p className="engine-filter-preview-note"><FiRefreshCw /> 미리보기 결과 — 저장하지 않으면 실제 견적에 적용되지 않습니다.</p>}
    <div className="engine-filter-layout">
      <nav className="engine-filter-nav" aria-label="부품 범주">
        <div className="engine-filter-nav-title">주요부품</div>
        {PART_CATEGORIES.map((category) => {
          const categorySummary = displaySummary[category];
          const activeCount = engineTargetFilterActiveFacetCount(config?.categories[category]);
          return <button key={category} type="button" className={`engine-filter-nav-item${selectedCategory === category ? " active" : ""}`} onClick={() => setSelectedCategory(category)}>
            <span>{CATEGORY_LABELS[category]}</span>
            <span className="engine-filter-nav-meta">
              {activeCount > 0 && <em>{activeCount}개 조건</em>}
              {categorySummary && <small>{categorySummary.matchingCount.toLocaleString("ko-KR")}/{categorySummary.eligibleCount.toLocaleString("ko-KR")}</small>}
            </span>
          </button>;
        })}
      </nav>
      <div className="engine-filter-main">
        <div className="engine-filter-main-heading">
          <div>
            <strong>{CATEGORY_LABELS[selectedCategory]}</strong>
            {selectedSummary && (
              <span className={selectedSummary.matchingCount === 0 && selectedSummary.activeFacets > 0 ? "engine-filter-count empty" : "engine-filter-count"}>
                필터 통과 {selectedSummary.matchingCount.toLocaleString("ko-KR")}개 / 후보 {selectedSummary.eligibleCount.toLocaleString("ko-KR")}개 / 전체 {selectedSummary.totalCount.toLocaleString("ko-KR")}개
              </span>
            )}
          </div>
          {selectedRule && engineTargetFilterActiveFacetCount(selectedRule) > 0 && (
            <button type="button" className="text-button" onClick={() => updateRule(selectedCategory, () => undefined)}>이 범주 조건 초기화</button>
          )}
        </div>
        {selectedSummary && selectedSummary.matchingCount === 0 && selectedSummary.activeFacets > 0 && (
          <p className="engine-filter-warning" role="alert"><FiAlertTriangle /> 현재 조건을 통과하는 부품이 없습니다. 저장하면 이 범주가 필요한 자동 견적이 항상 실패합니다.</p>
        )}
        {filterDisabled && <p className="engine-filter-warning muted"><FiAlertTriangle /> 타겟 필터가 해제되어 있어 조건을 저장해도 견적에는 적용되지 않습니다.</p>}
        <div className="engine-filter-rows">
          {ENGINE_TARGET_FILTER_FACETS[selectedCategory].map(renderFacetRow)}
          {renderExcludedPartsRow()}
        </div>
      </div>
    </div>
  </section>;
}
