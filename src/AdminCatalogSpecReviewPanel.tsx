import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { FiAlertTriangle, FiDownload, FiExternalLink, FiInfo, FiLoader, FiRefreshCw, FiSearch } from "react-icons/fi";
import type { CatalogSpecRefreshBatchFilters, CatalogSpecRefreshBatchResponse, CatalogSpecRefreshHistoryEntry, CatalogSpecReviewAction, CatalogSpecReviewEvidence, CatalogSpecReviewPriority, CatalogSpecReviewWorkPackage, CatalogSpecReviewItem } from "../shared/catalog-spec-review";
import { catalogSpecRefreshProgressSummaryFor } from "../shared/catalog-spec-review";
import { catalogMissingFieldLabelFor } from "../shared/catalog-spec-coverage";
import { CATEGORY_LABELS, DATA_FRESHNESS_LABELS, DATA_QUALITY_LABELS, PART_CATEGORIES, type PartCategory } from "../shared/types";
import { api } from "./api";
import { safeExternalUrl } from "./safe-source-url";

const PRIORITY_LABELS: Record<CatalogSpecReviewPriority, string> = { high: "우선 보강", medium: "보강 권장", low: "일반 보강" };
const ACTION_LABELS: Record<CatalogSpecReviewAction, string> = { refresh_source: "자동 정보 재확인", review_source: "수동 페이지 확인", inspect_catalog: "카탈로그 상세 확인" };
const EVIDENCE_LABELS: Record<CatalogSpecReviewEvidence, string> = { all: "전체 정보", spec: "일반 스펙", pcie: "PCIe 슬롯 evidence" };
const REVIEW_PAGE_SIZE_OPTIONS = [12, 24, 50, 100] as const;
const PCIE_SLOT_WIDTHS = [16, 8, 4, 1] as const;

function initialReviewEvidence(): CatalogSpecReviewEvidence {
  if (typeof window === "undefined") return "all";
  const value = new URLSearchParams(window.location.search).get("reviewEvidence");
  return value === "spec" || value === "pcie" ? value : "all";
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function reviewItemQualityLabel(item: CatalogSpecReviewItem) {
  return DATA_QUALITY_LABELS[item.dataQuality] ?? item.dataQuality;
}

function historyDateText(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : value;
}

function historyFilterText(filters: CatalogSpecRefreshBatchFilters | undefined) {
  if (!filters) return "전체 목록";
  const values = [
    filters.category ? CATEGORY_LABELS[filters.category] : undefined,
    filters.priority ? PRIORITY_LABELS[filters.priority] : undefined,
    filters.action ? ACTION_LABELS[filters.action] : undefined,
    filters.evidence ? EVIDENCE_LABELS[filters.evidence] : undefined,
    filters.query ? `검색 ${filters.query}` : undefined,
    filters.missingField ? `누락 ${filters.missingField}` : undefined
  ].filter((value): value is string => Boolean(value));
  return values.join(" · ") || "전체 목록";
}

function refreshBatchItemStatusText(status: CatalogSpecRefreshHistoryEntry["items"][number]["status"]) {
  return status === "refreshed" ? "반영" : status === "skipped" ? "건너뜀" : "실패";
}

function refreshOutcomeText(item: CatalogSpecReviewItem) {
  if (item.refreshOutcome === "repeated_failure") return `페이지 자동 확인 연속 ${item.refreshFailureStreakCount ?? item.refreshFailureCount ?? 0}회 실패 · 직접 확인 필요`;
  if (item.refreshOutcome === "retryable_failure") return `페이지 자동 확인 연속 ${item.refreshFailureStreakCount ?? item.refreshFailureCount ?? 0}회 실패 · 재시도 권장`;
  if (item.refreshOutcome === "succeeded") return `페이지 자동 확인 ${item.refreshAttemptCount ?? 0}회 · 최근 반영`;
  return "자동 페이지 확인 전";
}

function signedCount(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function refreshCoverageProgressText(result: CatalogSpecRefreshBatchResponse | CatalogSpecRefreshHistoryEntry) {
  if (!result.coverageBefore || !result.coverageAfter) return undefined;
  const delta = result.coverageDelta;
  const completeDelta = delta ? ` · 완성 ${signedCount(delta.complete)}개` : "";
  const incompleteDelta = delta ? ` · incomplete ${signedCount(delta.incompleteCount)}개` : "";
  const impact = result.impact ? ` · 완성 전환 ${result.impact.newlyCompletedCount}개 · 해소 필드 ${result.impact.newlyResolvedFieldCount}개` : "";
  const pcieBefore = result.coverageBefore.pcieSlotCoverage?.byRequiredWidth[4];
  const pcieAfter = result.coverageAfter.pcieSlotCoverage?.byRequiredWidth[4];
  const pcieImpact = result.pcieImpact && result.pcieImpact.newlyResolvedFieldCount > 0 ? ` · PCIe 해소 ${result.pcieImpact.newlyResolvedFieldCount}개` : "";
  const pcieCoverage = pcieBefore && pcieAfter ? ` · PCIe x4 evidence ${pcieBefore.coveragePercent.toFixed(1)}% → ${pcieAfter.coveragePercent.toFixed(1)}%` : "";
  return `스펙 완성도 ${result.coverageBefore.coveragePercent.toFixed(1)}% → ${result.coverageAfter.coveragePercent.toFixed(1)}%${completeDelta}${incompleteDelta}${impact}${pcieCoverage}${pcieImpact}`;
}

function CatalogSpecRefreshCategoryCoverageList({ progress }: { progress: ReturnType<typeof catalogSpecRefreshProgressSummaryFor> }) {
  const categories = progress.latestCoverageAfter?.categories;
  const deltas = new Map((progress.coverageDelta?.categories ?? []).map((category) => [category.category, category]));
  if (!categories || categories.length === 0) return <div className="catalog-spec-refresh-progress-category-coverage" data-testid="catalog-spec-refresh-category-coverage"><strong>카테고리 coverage</strong><small>coverage 저장본이 기록된 실행이 생기면 카테고리별 완성도가 표시됩니다.</small></div>;
  return <div className="catalog-spec-refresh-progress-category-coverage" data-testid="catalog-spec-refresh-category-coverage"><strong>카테고리 coverage</strong>{categories.map((category) => { const delta = deltas.get(category.category); return <span key={category.category}>{CATEGORY_LABELS[category.category]} {category.coveragePercent.toFixed(1)}%{delta ? ` · ${signedCount(delta.coveragePercent)}%p` : ""} · incomplete {category.incompleteCount}개</span>; })}</div>;
}

function CatalogSpecRefreshPcieProgressPanel({ progress }: { progress: ReturnType<typeof catalogSpecRefreshProgressSummaryFor> }) {
  const firstCoverage = progress.firstCoverageBefore?.pcieSlotCoverage;
  const latestCoverage = progress.latestCoverageAfter?.pcieSlotCoverage;
  const firstX4 = firstCoverage?.byRequiredWidth[4];
  const latestX4 = latestCoverage?.byRequiredWidth[4];
  const x4Delta = progress.coverageDelta?.pcieSlotCoverage?.byRequiredWidth[4];
  const x4Text = firstX4 && latestX4
    ? `${firstX4.coveragePercent.toFixed(1)}% → ${latestX4.coveragePercent.toFixed(1)}%${x4Delta ? ` · ${signedCount(x4Delta.coveragePercent)}%p` : ""}`
    : latestX4
      ? `${latestX4.coveragePercent.toFixed(1)}% · 현재 snapshot`
      : "기록 대기";
  return <div className="catalog-spec-refresh-pcie-progress" data-testid="catalog-spec-refresh-pcie-progress" aria-label="PCIe evidence 보강 추이">
    <div className="catalog-spec-refresh-pcie-progress-heading"><div><strong>PCIe 슬롯 보강 추이</strong><small>일반 스펙과 분리해 확인한 PCIe 슬롯 정보를 누적합니다.</small></div><span>{latestCoverage ? "저장본 연결" : "기록 대기"}</span></div>
    <div className="catalog-spec-refresh-pcie-progress-stats"><div><span>PCIe 완성 전환 누적</span><strong>{progress.pcieNewlyCompleteCount}개</strong></div><div><span>슬롯 필드 해소 누적</span><strong>{progress.pcieResolvedFieldCount}개</strong></div><div><span>x4 coverage</span><strong>{x4Text}</strong></div></div>
    {latestCoverage ? <div className="catalog-spec-refresh-pcie-coverage-list"><strong>최신 폭별 evidence coverage</strong>{PCIE_SLOT_WIDTHS.map((width) => { const entry = latestCoverage.byRequiredWidth[width]; return <span key={width}>x{width} {entry.coveragePercent.toFixed(1)}% · 부족 {entry.missing}개</span>; })}</div> : <p className="catalog-spec-refresh-pcie-empty"><FiInfo /> PCIe evidence가 포함된 refresh 저장본이 저장되면 폭별 coverage와 해소 field가 표시됩니다.</p>}
    <div className="catalog-spec-refresh-pcie-field-list"><strong>PCIe 슬롯 field progress</strong>{progress.pcieFieldProgress.length > 0 ? progress.pcieFieldProgress.slice(0, 6).map((field) => <span key={field.field}>{catalogMissingFieldLabelFor(field.field)} {field.resolved}/{field.observed} · {field.successPercent.toFixed(1)}%</span>) : <small>아직 기록된 PCIe 슬롯 해소 field가 없습니다.</small>}</div>
  </div>;
}

function CatalogSpecRefreshProgressPanel({ progress }: { progress: ReturnType<typeof catalogSpecRefreshProgressSummaryFor> }) {
  const latest = progress.latestCoverageAfter;
  const first = progress.firstCoverageBefore;
  const delta = progress.coverageDelta;
  return <section className="catalog-spec-refresh-progress" data-testid="catalog-spec-refresh-progress" aria-label="카탈로그 스펙 보강 품질 추이"><div className="catalog-spec-refresh-progress-heading"><div><strong>보강 품질 추이</strong><small>기록된 batch의 실제 카탈로그 coverage 저장본 기준입니다.</small></div><span>{progress.coverageRunCount > 0 ? `coverage ${progress.coverageRunCount}회` : "coverage 기록 대기"}</span></div><div className="catalog-spec-refresh-progress-stats"><div><span>실행</span><strong>{progress.runCount}회</strong></div><div><span>반영 누적</span><strong>{progress.totalRefreshedCount}개</strong></div><div><span>실패 누적</span><strong>{progress.totalFailedCount}개</strong></div><div><span>최신 incomplete</span><strong>{latest ? `${latest.incompleteCount}개` : "확인 전"}</strong></div><div><span>완성 전환 누적</span><strong>{progress.newlyCompletedCount}개</strong></div></div>{first && latest && <div className="catalog-spec-refresh-progress-summary"><span>완성도 <strong>{first.coveragePercent.toFixed(1)}% → {latest.coveragePercent.toFixed(1)}%</strong></span><span>완성 항목 <strong>{delta ? signedCount(delta.complete) : "변화 기록 없음"}</strong></span><span>incomplete <strong>{delta ? signedCount(delta.incompleteCount) : "변화 기록 없음"}</strong></span><span>해소 필드 <strong>{progress.resolvedFieldCount}개</strong></span></div>}<CatalogSpecRefreshPcieProgressPanel progress={progress} /><div className="catalog-spec-refresh-progress-field-list" data-testid="catalog-spec-refresh-field-progress"><strong>실제 해소된 누락 필드</strong>{progress.fieldProgress.length > 0 ? progress.fieldProgress.slice(0, 6).map((field) => <span key={field.field}>{catalogMissingFieldLabelFor(field.field)} {field.resolved}/{field.observed} · {field.successPercent.toFixed(1)}%</span>) : <small>coverage가 기록된 실행에서 실제 해소 필드가 생기면 표시됩니다.</small>}</div><div className="catalog-spec-refresh-progress-category-list" data-testid="catalog-spec-refresh-category-progress"><strong>카테고리 자동 처리 성공률</strong>{progress.categoryProgress.length > 0 ? progress.categoryProgress.slice(0, 6).map((category) => <span key={category.category}>{CATEGORY_LABELS[category.category]} {category.succeeded}/{category.attempted} · {category.successPercent.toFixed(1)}%{category.failed > 0 ? ` · 실패 ${category.failed}` : ""}</span>) : <small>기록된 자동 처리 결과가 없습니다.</small>}</div><CatalogSpecRefreshCategoryCoverageList progress={progress} />{progress.points.length > 0 ? <div className="catalog-spec-refresh-progress-chart" role="img" aria-label="최근 카탈로그 스펙 완성도 추이">{progress.points.map((point) => <span key={point.runId} style={{ height: `${Math.max(8, Math.min(100, point.coveragePercent))}%` }} title={`${historyDateText(point.finishedAt)} · 완성도 ${point.coveragePercent.toFixed(1)}% · incomplete ${point.incompleteCount}개`} />)}</div> : <p className="catalog-spec-refresh-progress-empty"><FiInfo /> coverage가 저장된 실행이 생기면 추이가 표시됩니다. 구버전 실행 이력은 처리 건수만 표시될 수 있습니다.</p>}</section>;
}

function CatalogSpecRefreshHistoryPanel({ history, loading, error, onRefresh, expandedRunId, onToggle }: { history: CatalogSpecRefreshHistoryEntry[]; loading: boolean; error: string | null; onRefresh: () => void; expandedRunId: string | null; onToggle: (runId: string) => void }) {
  return <section className="catalog-spec-refresh-history" data-testid="catalog-spec-refresh-history" aria-label="카탈로그 스펙 보강 실행 이력"><div className="catalog-spec-refresh-history-heading"><div><strong>최근 보강 실행 이력</strong><small>일괄 정보 재확인의 결과와 필터를 서버에 보존합니다.</small></div><button className="text-button" type="button" onClick={onRefresh} disabled={loading}><FiRefreshCw className={loading ? "spin" : undefined} /> 다시 확인</button></div>{loading && history.length === 0 ? <p className="catalog-spec-refresh-history-state"><FiLoader className="spin" /> 실행 이력을 불러오는 중...</p> : error && history.length === 0 ? <p className="catalog-spec-refresh-history-state error"><FiAlertTriangle /> {error}</p> : history.length === 0 ? <p className="catalog-spec-refresh-history-state"><FiInfo /> 아직 저장된 일괄 보강 실행이 없습니다.</p> : <div className="catalog-spec-refresh-history-list">{history.map((entry) => { const expanded = expandedRunId === entry.runId; return <article key={entry.runId}><button className="catalog-spec-refresh-history-row" type="button" aria-expanded={expanded} onClick={() => onToggle(entry.runId)}><span><strong>{historyDateText(entry.finishedAt)}</strong><small>run {entry.runId.slice(0, 10)} · {historyFilterText(entry.filters)}</small></span><span><strong>반영 {entry.refreshedCount} · 건너뜀 {entry.skippedCount} · 실패 {entry.failedCount}</strong><small>변경 영역 {entry.changedFieldCount}개</small>{refreshCoverageProgressText(entry) && <small>{refreshCoverageProgressText(entry)}</small>}</span></button>{expanded && <div className="catalog-spec-refresh-history-detail">{entry.items.map((item) => <div key={item.partId}><span className={`catalog-spec-refresh-history-status ${item.status}`}>{refreshBatchItemStatusText(item.status)}</span><strong>{item.partName}</strong><small>{item.category ? CATEGORY_LABELS[item.category] : "범주 확인 필요"} · {item.partId}{item.changedFields?.length ? ` · ${item.changedFields.join(" · ")}` : item.error ? ` · ${item.error}` : ""}</small>{item.category && <a href={`/catalog?category=${encodeURIComponent(item.category)}&partId=${encodeURIComponent(item.partId)}`}>카탈로그에서 열기</a>}</div>)}</div>}</article>; })}</div>}</section>;
}

function CatalogSpecReviewItemCard({ item, selected, onToggle, disabled }: { item: CatalogSpecReviewItem; selected: boolean; onToggle: () => void; disabled: boolean }) {
  const sourceUrl = safeExternalUrl(item.sourceUrl);
  const selectable = item.nextAction === "refresh_source";
  const evidenceLabel = item.evidenceKind === "pcie" ? "PCIe evidence" : item.evidenceKind === "mixed" ? "스펙 + PCIe" : "일반 스펙";
  return <article className={selected ? "catalog-spec-review-item selected" : "catalog-spec-review-item"} data-testid="catalog-spec-review-item">
    <div className="catalog-spec-review-selection"><input type="checkbox" aria-label={`${item.partName} 정보 재확인 대상`} checked={selected} disabled={!selectable || disabled} onChange={onToggle} /><span>{selectable ? "일괄 확인 가능" : "직접 확인 필요"}</span></div>
    <div className="catalog-spec-review-item-main">
      <div className="catalog-spec-review-item-top"><span className={`catalog-spec-review-priority ${item.priority}`}>{PRIORITY_LABELS[item.priority]}</span><strong>{item.priorityScore}점</strong><span>{CATEGORY_LABELS[item.category]}</span><span className={`catalog-spec-review-evidence ${item.evidenceKind}`}>{evidenceLabel}</span><span className={`catalog-spec-review-refresh-outcome ${item.refreshOutcome ?? "untried"}`}>{refreshOutcomeText(item)}</span></div>
      <strong className="catalog-spec-review-item-name">{item.partName}</strong>
      <small className="catalog-spec-review-item-id">{item.partId}{item.sourceProductCode ? ` · 상품코드 ${item.sourceProductCode}` : ""} · {reviewItemQualityLabel(item)} · 정보 {DATA_FRESHNESS_LABELS[item.freshness]}{item.priceWon !== undefined ? ` · ${item.priceWon.toLocaleString("ko-KR")}원` : " · 가격 확인 필요"}</small>
      <small className="catalog-spec-review-item-reason">{item.reviewReason}</small>
      <div className="catalog-spec-review-focus-fields">{item.focusFields.length > 0 ? item.focusFields.map((field) => <span key={`${field.category}:${field.field}`} title={field.instruction}>{field.label}</span>) : <span>누락 필드 기록 없음 · 페이지 확인 필요</span>}</div>
    </div>
    <div className="catalog-spec-review-item-actions"><a className="button button-small button-secondary" data-testid="catalog-spec-review-open" href={item.catalogUrl}><FiSearch /> {item.nextActionLabel}</a>{sourceUrl && <a className="text-button" href={sourceUrl} target="_blank" rel="noreferrer"><FiExternalLink /> 페이지</a>}</div>
  </article>;
}

export function AdminCatalogSpecReviewPanel({ onToast }: { onToast: (message: string) => void }) {
  const [category, setCategory] = useState<PartCategory | "all">("all");
  const [priority, setPriority] = useState<CatalogSpecReviewPriority | "all">("all");
  const [action, setAction] = useState<CatalogSpecReviewAction | "all">("all");
  const [evidence, setEvidence] = useState<CatalogSpecReviewEvidence>(initialReviewEvidence);
  const [query, setQuery] = useState("");
  const [missingField, setMissingField] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [activeMissingField, setActiveMissingField] = useState("");
  const [activeAction, setActiveAction] = useState<CatalogSpecReviewAction | undefined>(undefined);
  const [limit, setLimit] = useState(24);
  const [offset, setOffset] = useState(0);
  const [reviewPackage, setReviewPackage] = useState<CatalogSpecReviewWorkPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<CatalogSpecRefreshBatchResponse | null>(null);
  const [refreshHistory, setRefreshHistory] = useState<CatalogSpecRefreshHistoryEntry[]>([]);
  const [refreshHistoryLoading, setRefreshHistoryLoading] = useState(true);
  const [refreshHistoryError, setRefreshHistoryError] = useState<string | null>(null);
  const [refreshHistoryNonce, setRefreshHistoryNonce] = useState(0);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const queueFingerprintRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const mutationRequestVersionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mutationRequestVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (category !== "all") params.set("category", category);
    if (priority !== "all") params.set("priority", priority);
    if (activeAction) params.set("action", activeAction);
    if (evidence !== "all") params.set("evidence", evidence);
    if (activeQuery) params.set("q", activeQuery);
    if (activeMissingField) params.set("missingField", activeMissingField);
    if (offset > 0 && queueFingerprintRef.current) params.set("queueFingerprint", queueFingerprintRef.current);
    setLoading(true);
    setError(null);
    setReviewPackage(null);
    setSelectedIds([]);
    setBatchResult(null);
    void api<CatalogSpecReviewWorkPackage>(`/api/admin/catalog-spec/review-package?${params.toString()}`)
      .then((value) => {
        if (cancelled) return;
        if (value.queueChanged && offset > 0) {
          queueFingerprintRef.current = value.queueFingerprint;
          setOffset(0);
          setSelectedIds([]);
          setBatchResult(null);
          onToast("카탈로그 스펙 보강 목록이 갱신되어 첫 묶음부터 다시 표시합니다.");
          return;
        }
        queueFingerprintRef.current = value.queueFingerprint;
        setReviewPackage(value);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "카탈로그 스펙 보강 목록을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeAction, activeMissingField, activeQuery, category, evidence, limit, offset, priority, retryNonce]);

  useEffect(() => {
    let cancelled = false;
    setRefreshHistoryLoading(true);
    setRefreshHistoryError(null);
    void api<{ items: CatalogSpecRefreshHistoryEntry[] }>("/api/admin/catalog-spec/refresh-history?limit=10")
      .then((value) => { if (!cancelled) setRefreshHistory(value.items); })
      .catch((reason: unknown) => { if (!cancelled) setRefreshHistoryError(reason instanceof Error ? reason.message : "보강 실행 이력을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setRefreshHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [refreshHistoryNonce]);

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    queueFingerprintRef.current = null;
    setActiveQuery(query.trim().slice(0, 120));
    setActiveMissingField(missingField.trim().slice(0, 120));
    setActiveAction(action === "all" ? undefined : action);
    setOffset(0);
    setSelectedIds([]);
    setBatchResult(null);
  }

  function resetFilters() {
    queueFingerprintRef.current = null;
    setQuery("");
    setMissingField("");
    setActiveQuery("");
    setActiveMissingField("");
    setAction("all");
    setActiveAction(undefined);
    setEvidence("all");
    setCategory("all");
    setPriority("all");
    setOffset(0);
    setSelectedIds([]);
    setBatchResult(null);
  }

  function toggleSelected(partId: string) {
    setSelectedIds((current) => current.includes(partId) ? current.filter((id) => id !== partId) : current.length >= 12 ? current : [...current, partId]);
  }

  async function refreshSelected() {
    if (selectedIds.length === 0 || batchBusy) return;
    if (!window.confirm(`선택한 ${selectedIds.length}개 부품의 다나와 페이지를 순차적으로 다시 확인할까요? 각 항목은 개별적으로 성공·건너뜀·실패가 기록됩니다.`)) return;
    const requestVersion = ++mutationRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestVersionRef.current === requestVersion;
    setBatchBusy(true);
    setBatchResult(null);
    try {
      const filters: CatalogSpecRefreshBatchFilters = {
        ...(category !== "all" ? { category } : {}),
        ...(priority !== "all" ? { priority } : {}),
        ...(activeAction ? { action: activeAction } : {}),
        ...(evidence !== "all" ? { evidence } : {}),
        ...(activeQuery ? { query: activeQuery } : {}),
        ...(activeMissingField ? { missingField: activeMissingField } : {}),
        offset,
        limit
      };
      const result = await api<CatalogSpecRefreshBatchResponse>("/api/admin/catalog-spec/refresh-batch", { method: "POST", body: JSON.stringify({ partIds: selectedIds, filters }) });
      if (!isCurrent()) return;
      setBatchResult(result);
      setSelectedIds([]);
      setOffset(0);
      queueFingerprintRef.current = null;
      setRetryNonce((current) => current + 1);
      setRefreshHistoryNonce((current) => current + 1);
      window.dispatchEvent(new Event("pc-supporter:catalog-meta-refresh"));
      onToast(`${result.refreshedCount}개 페이지 반영 · 건너뜀 ${result.skippedCount}개 · 실패 ${result.failedCount}개`);
    } catch (reason: unknown) {
      if (isCurrent()) onToast(reason instanceof Error ? reason.message : "선택한 부품 페이지 일괄 재확인에 실패했습니다.");
    } finally {
      if (isCurrent()) setBatchBusy(false);
    }
  }

  function downloadPackage() {
    if (!reviewPackage) return;
    const date = reviewPackage.generatedAt.slice(0, 10);
    const categoryName = reviewPackage.category ?? "all";
    downloadText(`catalog-spec-review-package-${categoryName}-${date}-offset-${reviewPackage.offset}.json`, `${JSON.stringify(reviewPackage, null, 2)}\n`, "application/json;charset=utf-8");
    onToast(`${reviewPackage.items.length}개 카탈로그 스펙 보강 작업 패키지를 저장했습니다.`);
  }

  const refreshProgress = catalogSpecRefreshProgressSummaryFor(refreshHistory);

  return <section className="admin-card catalog-spec-review-card" data-testid="admin-catalog-spec-review" aria-label="카탈로그 스펙 보강 작업 목록">
    <div className="admin-card-heading catalog-spec-review-heading"><div><h3>카탈로그 스펙 보강 작업 패키지</h3><p>누락률과 호환 영향도가 높은 필드부터 페이지 확인 작업을 묶어 내보냅니다. 이 목록은 안전 부품 결과를 우회하지 않습니다.</p></div><FiToolIcon /></div>
    <form className="catalog-spec-review-controls" onSubmit={submitFilters}>
      <label><span>정보 범위</span><select aria-label="스펙 보강 목록 정보 범위" value={evidence} onChange={(event) => { queueFingerprintRef.current = null; setEvidence(event.target.value as CatalogSpecReviewEvidence); setOffset(0); setSelectedIds([]); setBatchResult(null); }}><option value="all">전체 정보</option><option value="spec">일반 스펙</option><option value="pcie">PCIe 슬롯 evidence</option></select></label>
      <label><span>범주</span><select aria-label="스펙 보강 목록 범주" value={category} onChange={(event) => { queueFingerprintRef.current = null; setCategory(event.target.value as PartCategory | "all"); setOffset(0); setSelectedIds([]); setBatchResult(null); }}><option value="all">전체 카테고리</option>{PART_CATEGORIES.map((item) => <option value={item} key={item}>{CATEGORY_LABELS[item]}</option>)}</select></label>
      <label><span>우선순위</span><select aria-label="스펙 보강 목록 우선순위" value={priority} onChange={(event) => { queueFingerprintRef.current = null; setPriority(event.target.value as CatalogSpecReviewPriority | "all"); setOffset(0); setSelectedIds([]); setBatchResult(null); }}><option value="all">전체 우선순위</option><option value="high">우선 보강</option><option value="medium">보강 권장</option><option value="low">일반 보강</option></select></label>
      <label><span>작업 유형</span><select aria-label="스펙 보강 목록 작업 유형" value={action} onChange={(event) => { queueFingerprintRef.current = null; setAction(event.target.value as CatalogSpecReviewAction | "all"); setOffset(0); setSelectedIds([]); setBatchResult(null); }}><option value="all">전체 작업</option><option value="refresh_source">자동 정보 재확인</option><option value="review_source">수동 페이지 확인</option><option value="inspect_catalog">카탈로그 상세 확인</option></select></label>
      <label className="catalog-spec-review-query"><span>검색</span><input aria-label="스펙 보강 목록 검색" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="부품명·브랜드·상품코드" /></label>
      <label className="catalog-spec-review-query"><span>누락 필드</span><input aria-label="스펙 보강 목록 누락 필드" value={missingField} onChange={(event) => setMissingField(event.target.value)} placeholder="예: maxGpuLengthMm" /></label>
      <label><span>패키지 크기</span><select aria-label="스펙 보강 작업 패키지 크기" value={limit} onChange={(event) => { queueFingerprintRef.current = null; setLimit(Number(event.target.value)); setOffset(0); setSelectedIds([]); setBatchResult(null); }}>{REVIEW_PAGE_SIZE_OPTIONS.map((size) => <option value={size} key={size}>{size}개</option>)}</select></label>
      <div className="catalog-spec-review-filter-actions"><button className="button button-secondary button-small" type="submit"><FiSearch /> 목록 검색</button>{(activeQuery || activeMissingField || activeAction || evidence !== "all" || category !== "all" || priority !== "all") && <button className="text-button" type="button" onClick={resetFilters}>필터 초기화</button>}</div>
    </form>
    {loading && !reviewPackage ? <div className="catalog-spec-review-state" role="status"><FiLoader className="spin" /> 보강 목록을 계산하는 중...</div> : error && !reviewPackage ? <div className="catalog-spec-review-state error" role="alert"><FiAlertTriangle /> <span>{error}</span><button className="text-button" type="button" onClick={() => setRetryNonce((current) => current + 1)}>다시 시도</button></div> : reviewPackage && <>
      <div className="catalog-spec-review-summary"><div><span>대상</span><strong>{reviewPackage.summary.total.toLocaleString("ko-KR")}개</strong></div><div><span>현재 목록</span><strong>{reviewPackage.summary.queueTotal.toLocaleString("ko-KR")}개</strong></div><div><span>이번 패키지</span><strong>{reviewPackage.summary.includedCount.toLocaleString("ko-KR")}개</strong></div><div><span>남은 작업</span><strong>{reviewPackage.summary.remainingCount.toLocaleString("ko-KR")}개</strong></div></div>
      <div className="catalog-spec-review-breakdown"><span className="high">우선 보강 <b>{reviewPackage.summary.highCount}</b></span><span className="medium">보강 권장 <b>{reviewPackage.summary.mediumCount}</b></span><span className="low">일반 보강 <b>{reviewPackage.summary.lowCount}</b></span><span>정보 신선도 · 최근 {reviewPackage.summary.freshCount} · 권장 {reviewPackage.summary.agingCount} · 오래됨 {reviewPackage.summary.staleCount} · 시점 확인 {reviewPackage.summary.unknownCount}</span>{reviewPackage.excludedNonCoreCount !== undefined && reviewPackage.excludedNonCoreCount > 0 && <span data-testid="catalog-spec-review-non-core">핵심 부품에서 제외 <b>{reviewPackage.excludedNonCoreCount}</b></span>}{reviewPackage.categoryMismatchExcludedCount !== undefined && reviewPackage.categoryMismatchExcludedCount > 0 && <span data-testid="catalog-spec-review-category-mismatch">카테고리 불일치 분리 <b>{reviewPackage.categoryMismatchExcludedCount}</b></span>}</div>
      <div className="catalog-spec-review-actions"><div><strong>{reviewPackage.offset + 1}–{reviewPackage.offset + reviewPackage.items.length}번 작업</strong><small>{reviewPackage.nextOffset !== undefined ? `다음 패키지는 ${reviewPackage.nextOffset}번부터 시작합니다.` : "현재 조건의 작업을 모두 확인했습니다."}</small></div><div className="catalog-spec-review-action-buttons"><button className="button button-light button-small" type="button" data-testid="catalog-spec-review-download" onClick={downloadPackage} disabled={reviewPackage.items.length === 0}><FiDownload /> JSON 패키지 저장</button><button className="button button-secondary button-small" type="button" data-testid="catalog-spec-review-refresh-batch" onClick={() => void refreshSelected()} disabled={selectedIds.length === 0 || batchBusy}>{batchBusy ? <><FiLoader className="spin" /> 순차 확인 중...</> : <><FiRefreshCw /> 선택 페이지 재확인 {selectedIds.length > 0 ? `(${selectedIds.length})` : ""}</>}</button></div></div>
      {batchResult && <div className="catalog-spec-refresh-batch-result" data-testid="catalog-spec-refresh-batch-result" role="status"><strong>일괄 정보 재확인 완료</strong><span>반영 {batchResult.refreshedCount}개 · 건너뜀 {batchResult.skippedCount}개 · 실패 {batchResult.failedCount}개 · 변경 영역 {batchResult.changedFieldCount}개</span>{refreshCoverageProgressText(batchResult) && <small data-testid="catalog-spec-refresh-coverage-progress">{refreshCoverageProgressText(batchResult)}</small>}{batchResult.items.some((item) => item.status !== "refreshed") && <small>{batchResult.items.filter((item) => item.status !== "refreshed").slice(0, 4).map((item) => `${item.partName}: ${item.error ?? item.code ?? "확인 필요"}`).join(" · ")}</small>}</div>}
      {batchResult?.historyPersisted === false && <p className="catalog-spec-refresh-history-warning" role="alert"><FiAlertTriangle /> 실행 결과는 반영됐지만 실행 이력을 저장하지 못했습니다. 서버 저장소 상태를 확인해 주세요.</p>}
      {error && <p className="catalog-spec-review-inline-error" role="alert"><FiAlertTriangle /> {error}</p>}
      {reviewPackage.items.length === 0 ? <p className="catalog-spec-review-empty"><FiInfo /> 현재 조건에 맞는 스펙 보강 대상이 없습니다.</p> : <div className="catalog-spec-review-list">{reviewPackage.items.map((item) => <CatalogSpecReviewItemCard item={item} selected={selectedIds.includes(item.partId)} onToggle={() => toggleSelected(item.partId)} disabled={batchBusy || (!selectedIds.includes(item.partId) && selectedIds.length >= 12)} key={item.partId} />)}</div>}
      <div className="catalog-spec-review-pagination"><button className="button button-light button-small" type="button" onClick={() => setOffset((current) => Math.max(0, current - limit))} disabled={offset === 0 || loading}>이전 패키지</button><span>{reviewPackage.summary.queueTotal === 0 ? "0 / 0" : `${reviewPackage.offset + 1}–${reviewPackage.offset + reviewPackage.items.length} / ${reviewPackage.summary.queueTotal}`}</span><button className="button button-light button-small" type="button" onClick={() => setOffset(reviewPackage.nextOffset ?? offset)} disabled={reviewPackage.nextOffset === undefined || loading}>다음 패키지</button></div>
      <p className="catalog-spec-review-note"><FiInfo /> 작업 패키지는 현재 catalog 저장본의 누락 정보를 읽기 전용으로 묶습니다. 실제 값 반영은 부품 상세의 정보 재확인 또는 관리자 수집 작업 후 coverage를 다시 확인해야 합니다.</p>
      <CatalogSpecRefreshProgressPanel progress={refreshProgress} />
      <CatalogSpecRefreshHistoryPanel history={refreshHistory} loading={refreshHistoryLoading} error={refreshHistoryError} onRefresh={() => setRefreshHistoryNonce((current) => current + 1)} expandedRunId={expandedRunId} onToggle={(runId) => setExpandedRunId((current) => current === runId ? null : runId)} />
    </>}
  </section>;
}

function FiToolIcon() {
  return <span className="catalog-spec-review-icon" aria-hidden="true"><FiRefreshCw /></span>;
}
