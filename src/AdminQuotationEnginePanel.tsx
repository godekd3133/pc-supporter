import { useCallback, useEffect, useMemo, useState } from "react";
import { FiAlertTriangle, FiCheck, FiClock, FiCpu, FiDatabase, FiLoader, FiRefreshCw, FiRotateCcw, FiSave, FiSearch, FiZap } from "react-icons/fi";
import { RECOMMENDATION_PRIORITY_LABELS, RECOMMENDATION_PRIORITY_VALUES } from "../shared/types";
import type { RecommendationPriority } from "../shared/types";
import { api } from "./api";

type EngineGenerationOptions = {
  variantPriorities: RecommendationPriority[];
  budgetLadderDownMultiplier: number;
  budgetLadderUpMultiplier: number;
};

type EngineOptionsResponse = {
  options: EngineGenerationOptions;
  defaults: EngineGenerationOptions;
  updatedAt?: string;
};

type EnginesStatusResponse = {
  crawler: { label: string; catalog: { status: string; failedPages: number; finishedAt?: string }; accessories: { status: string } };
  quotation: { label: string; engineVersion: string; options: EngineGenerationOptions; targetFilters: { enabled: boolean; activeFacets: number }; recentFailures: number; lastFailureAt: string | null };
  compatibility: { label: string; engineVersion: string; caches: { compatibilityResult: { size: number; hits: number; misses: number }; compatiblePartAssessment: { size: number; hits: number; misses: number } } };
};

function engineStateDot(status: string) {
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  return "idle";
}

function optionsEqual(left: EngineGenerationOptions, right: EngineGenerationOptions) {
  return left.budgetLadderDownMultiplier === right.budgetLadderDownMultiplier
    && left.budgetLadderUpMultiplier === right.budgetLadderUpMultiplier
    && left.variantPriorities.length === right.variantPriorities.length
    && left.variantPriorities.every((priority, index) => priority === right.variantPriorities[index]);
}

function multiplierToPercent(multiplier: number) {
  return Math.round(multiplier * 100);
}

export function AdminQuotationEnginePanel({ onToast }: { onToast: (message: string) => void }) {
  const [engines, setEngines] = useState<EnginesStatusResponse | null>(null);
  const [savedOptions, setSavedOptions] = useState<EngineGenerationOptions | null>(null);
  const [defaults, setDefaults] = useState<EngineGenerationOptions | null>(null);
  const [draft, setDraft] = useState<EngineGenerationOptions | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [optionsPayload, enginesPayload] = await Promise.all([
        api<EngineOptionsResponse>("/api/admin/engine-options"),
        api<EnginesStatusResponse>("/api/admin/engines")
      ]);
      setEngines(enginesPayload);
      setSavedOptions(optionsPayload.options);
      setDefaults(optionsPayload.defaults);
      setDraft(optionsPayload.options);
      setUpdatedAt(optionsPayload.updatedAt ?? null);
      setError(null);
      return true;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "견적 엔진 상태를 불러오지 못했습니다.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refreshManually = () => {
    setLoading(true);
    void load().then((ok) => { if (!ok) onToast("견적 엔진 상태를 불러오지 못했습니다. 서버 연결을 확인해 주세요."); });
  };

  const dirty = useMemo(() => savedOptions !== null && draft !== null && !optionsEqual(savedOptions, draft), [savedOptions, draft]);
  const validationErrors = useMemo(() => {
    if (!draft) return [] as string[];
    const errors: string[] = [];
    if (draft.variantPriorities.length === 0) errors.push("비교 기준은 하나 이상 선택해야 합니다.");
    if (draft.budgetLadderDownMultiplier < 0.5 || draft.budgetLadderDownMultiplier >= 1) errors.push("절약형 배율은 50~99% 사이여야 합니다.");
    if (draft.budgetLadderUpMultiplier <= 1 || draft.budgetLadderUpMultiplier > 2) errors.push("여유형 배율은 101~200% 사이여야 합니다.");
    return errors;
  }, [draft]);

  const togglePriority = (priority: RecommendationPriority) => {
    if (!draft) return;
    const next = draft.variantPriorities.includes(priority)
      ? draft.variantPriorities.filter((entry) => entry !== priority)
      : RECOMMENDATION_PRIORITY_VALUES.filter((entry) => entry === priority || draft.variantPriorities.includes(entry));
    setDraft({ ...draft, variantPriorities: next });
  };

  const save = async () => {
    if (!draft || saving || validationErrors.length > 0) return;
    setSaving(true);
    try {
      const payload = await api<{ options: EngineGenerationOptions; updatedAt?: string }>("/api/admin/engine-options", {
        method: "PUT",
        body: JSON.stringify({
          variantPriorities: draft.variantPriorities,
          budgetLadderDownMultiplier: draft.budgetLadderDownMultiplier,
          budgetLadderUpMultiplier: draft.budgetLadderUpMultiplier
        })
      });
      setSavedOptions(payload.options);
      setDraft(payload.options);
      setUpdatedAt(payload.updatedAt ?? null);
      onToast("견적 생성 엔진 옵션을 저장했습니다. 다음 자동 구성부터 반영됩니다.");
      void api<EnginesStatusResponse>("/api/admin/engines").then(setEngines).catch(() => undefined);
    } catch (saveError) {
      onToast(saveError instanceof Error ? saveError.message : "견적 생성 옵션을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const quotation = engines?.quotation;
  const crawler = engines?.crawler;
  const compatibility = engines?.compatibility;
  const cacheHitRate = (stats?: { hits: number; misses: number }) => {
    if (!stats) return "-";
    const total = stats.hits + stats.misses;
    return total > 0 ? `${Math.round((stats.hits / total) * 100)}%` : "-";
  };

  return <section className="admin-card quotation-engine-card" data-testid="admin-quotation-engine">
    <div className="admin-card-heading">
      <div><p className="eyebrow">견적 생성 엔진</p><h3>생성 옵션과 엔진 운영 상태</h3></div>
      <button className="button button-light button-small" type="button" onClick={refreshManually} disabled={loading}>{loading ? <FiLoader className="spin" /> : <FiRefreshCw />} 새로고침</button>
    </div>
    <p className="admin-card-description">서버의 세 엔진(크롤링·견적 생성·호환성 검사) 상태와 견적 생성 엔진의 운영 옵션을 관리합니다.</p>

    {loading && !engines
      ? <p className="quotation-engine-state"><FiLoader className="spin" /> 엔진 상태를 불러오는 중...</p>
      : error && !engines
        ? <div className="quotation-engine-state error" role="alert"><FiAlertTriangle /><span>{error}</span><button className="button button-light button-small" type="button" onClick={refreshManually}>다시 불러오기</button></div>
        : engines && <>
          <div className="quotation-engine-registry" aria-label="엔진 레지스트리">
            <div className="quotation-engine-module" data-testid="engine-module-crawler">
              <i className={`engine-state-dot ${engineStateDot(crawler!.catalog.status)}`} />
              <div><strong>{crawler!.label}</strong><small>{crawler!.catalog.status === "running" ? "실행 중" : crawler!.catalog.status === "failed" ? "실패" : "대기"} · 주변 {crawler!.accessories.status === "running" ? "실행 중" : "대기"}{crawler!.catalog.failedPages > 0 ? ` · 실패 페이지 ${crawler!.catalog.failedPages}개` : ""}</small></div>
              <FiDatabase />
            </div>
            <div className="quotation-engine-module" data-testid="engine-module-quotation">
              <i className={`engine-state-dot ${quotation!.targetFilters.enabled && quotation!.targetFilters.activeFacets > 0 ? "filtered" : "idle"}`} />
              <div><strong>{quotation!.label}</strong><small>v{quotation!.engineVersion} · 필터 {quotation!.targetFilters.enabled && quotation!.targetFilters.activeFacets > 0 ? `${quotation!.targetFilters.activeFacets}개 조건` : "해제"}{quotation!.recentFailures > 0 ? ` · 실패 ${quotation!.recentFailures}건` : ""}</small></div>
              <FiZap />
            </div>
            <div className="quotation-engine-module" data-testid="engine-module-compatibility">
              <i className="engine-state-dot idle" />
              <div><strong>{compatibility!.label}</strong><small>v{compatibility!.engineVersion} · 평가 캐시 {compatibility!.caches.compatiblePartAssessment.size}개 · 적중률 {cacheHitRate(compatibility!.caches.compatiblePartAssessment)}</small></div>
              <FiCpu />
            </div>
          </div>

          {draft && <div className="quotation-engine-options" data-testid="quotation-engine-options">
            <div className="quotation-engine-option-group">
              <div className="quotation-engine-option-label"><FiSearch /> 자동 구성 비교 기준<small>견적 비교 화면이 순서대로 만드는 우선순위 세트입니다.</small></div>
              <div className="quotation-engine-priorities">
                {RECOMMENDATION_PRIORITY_VALUES.map((priority) => {
                  const checked = draft.variantPriorities.includes(priority);
                  return <label key={priority} className={checked ? "quotation-engine-priority checked" : "quotation-engine-priority"} data-testid={`engine-variant-priority-${priority}`}>
                    <input type="checkbox" checked={checked} onChange={() => togglePriority(priority)} />
                    {checked && <FiCheck />}{RECOMMENDATION_PRIORITY_LABELS[priority]}
                  </label>;
                })}
              </div>
            </div>
            <div className="quotation-engine-option-group">
              <div className="quotation-engine-option-label"><FiClock /> 예산 사다리 배율<small>목표 예산 대비 절약형·여유형 견적의 예산 비율입니다.</small></div>
              <div className="quotation-engine-ladder">
                <label>절약형<div className="quotation-engine-input-with-unit"><input type="number" min={50} max={99} step={1} value={multiplierToPercent(draft.budgetLadderDownMultiplier)} onChange={(event) => setDraft({ ...draft, budgetLadderDownMultiplier: Number(event.target.value) / 100 })} /><em>%</em></div></label>
                <label>목표 예산<div className="quotation-engine-input-with-unit fixed"><input type="number" value={100} disabled /><em>%</em></div></label>
                <label>여유형<div className="quotation-engine-input-with-unit"><input type="number" min={101} max={200} step={1} value={multiplierToPercent(draft.budgetLadderUpMultiplier)} onChange={(event) => setDraft({ ...draft, budgetLadderUpMultiplier: Number(event.target.value) / 100 })} /><em>%</em></div></label>
              </div>
            </div>
            {validationErrors.length > 0 && <ul className="quotation-engine-validation">{validationErrors.map((message) => <li key={message}><FiAlertTriangle /> {message}</li>)}</ul>}
            <div className="quotation-engine-toolbar">
              <span>{updatedAt ? `마지막 저장 ${new Date(updatedAt).toLocaleString("ko-KR")}` : "아직 저장된 옵션이 없습니다 — 기본값으로 동작 중입니다."}</span>
              <div>
                {defaults && <button className="button button-light button-small" type="button" onClick={() => setDraft({ ...defaults, variantPriorities: [...defaults.variantPriorities] })} disabled={saving}>기본값으로</button>}
                <button className="button button-light button-small" type="button" onClick={() => setDraft(savedOptions ? { ...savedOptions, variantPriorities: [...savedOptions.variantPriorities] } : null)} disabled={!dirty || saving}><FiRotateCcw /> 되돌리기</button>
                <button className="button button-primary button-small" type="button" data-testid="engine-options-save" onClick={() => void save()} disabled={!dirty || saving || validationErrors.length > 0}>{saving ? <FiLoader className="spin" /> : <FiSave />} 저장</button>
              </div>
            </div>
          </div>}
        </>}
  </section>;
}
