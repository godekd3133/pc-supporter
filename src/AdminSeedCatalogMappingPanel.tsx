import { useEffect, useMemo, useRef, useState } from "react";
import { FiAlertTriangle, FiCheckCircle, FiDownload, FiExternalLink, FiInfo, FiLoader, FiRefreshCw, FiShield, FiTrash2 } from "react-icons/fi";
import type { CatalogSeedMappingCandidate, CatalogSeedMappingItem, CatalogSeedMappingPreview, CatalogSeedMappingReason } from "../shared/catalog-seed-mapping";
import { CATEGORY_LABELS, DATA_QUALITY_LABELS, type PartCategory } from "../shared/types";
import { api } from "./api";
import { AdminSeedCollectionQueuePanel } from "./AdminSeedCollectionQueuePanel";

type MappingFilter = "candidate" | "high" | "manual" | "approved" | "all";

const REASON_LABELS: Record<CatalogSeedMappingReason, string> = {
  name_exact: "이름 동일",
  model_match: "모델 일치",
  brand_match: "브랜드 일치",
  identity_tokens: "식별 토큰 일치",
  price_near: "가격 근접"
};

const FILTER_LABELS: Record<MappingFilter, string> = {
  candidate: "확인 부품",
  high: "유력 부품",
  manual: "수동 필요",
  approved: "승인됨",
  all: "전체 누락"
};

function numberText(value: number) {
  return value.toLocaleString("ko-KR");
}

function priceText(value: number | undefined) {
  return value === undefined ? "가격 미확인" : `${value.toLocaleString("ko-KR")}원`;
}

function dateText(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : value;
}

function itemMatchesFilter(item: CatalogSeedMappingItem, filter: MappingFilter) {
  if (filter === "candidate") return item.candidates.length > 0 && item.status === "pending";
  if (filter === "high") return item.status === "pending" && item.candidates[0]?.confidence === "high";
  if (filter === "manual") return item.candidates.length === 0 && item.status !== "approved";
  if (filter === "approved") return item.status === "approved";
  return true;
}

function downloadJson(preview: CatalogSeedMappingPreview) {
  const blob = new Blob([JSON.stringify(preview, null, 2)], { type: "application/json" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `catalog-seed-mapping-preview-${new Date(preview.generatedAt).toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function candidateIdentity(candidate: CatalogSeedMappingCandidate) {
  return `${candidate.activePartId}:${candidate.activeSourceProductCode}`;
}

function ManualMappingForm({ item, busy, onSubmit }: { item: CatalogSeedMappingItem; busy: boolean; onSubmit: (item: CatalogSeedMappingItem, sourceProductCode: string, sourceUrl: string) => Promise<void> }) {
  const [sourceProductCode, setSourceProductCode] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  return <form className="admin-seed-mapping-manual-form" onSubmit={(event) => { event.preventDefault(); if (sourceProductCode.trim() && sourceUrl.trim()) void onSubmit(item, sourceProductCode.trim(), sourceUrl.trim()); }}>
    <div className="admin-seed-mapping-manual-copy"><strong>자동 부품이 없는 항목</strong><span>현재 catalog에 수집된 다나와 상품 코드를 입력하면 페이지·범주·핵심 규격을 확인합니다.</span></div>
    <label><span>다나와 상품 코드</span><input value={sourceProductCode} onChange={(event) => setSourceProductCode(event.target.value)} placeholder="예: 62794079" inputMode="numeric" required aria-label={`${item.starter.name} 다나와 상품 코드`} /></label>
    <label><span>다나와 상품 페이지 URL</span><input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://prod.danawa.com/info/?pcode=..." type="url" required aria-label={`${item.starter.name} 다나와 상품 페이지 URL`} /></label>
    <button className="button button-secondary button-small" type="submit" disabled={busy || !sourceProductCode.trim() || !sourceUrl.trim()}>{busy ? <FiLoader className="spin" /> : <FiShield />} 페이지 확인 후 등록</button>
    <small>코드가 현재 catalog에 먼저 수집되어 있어야 하며, 확인 실패 시 기록하지 않습니다.</small>
  </form>;
}

export function AdminSeedCatalogMappingPanel({ onStartCategory, categoryCrawlRunning }: { onStartCategory?: (category: PartCategory) => void; categoryCrawlRunning?: boolean } = {}) {
  const [preview, setPreview] = useState<CatalogSeedMappingPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [filter, setFilter] = useState<MappingFilter>("candidate");
  const [query, setQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const mountedRef = useRef(false);
  const mutationRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mutationRequestRef.current += 1;
    };
  }, []);

  function focusMappingItem(starterPartId: string) {
    setFilter("manual");
    setQuery(starterPartId);
    window.setTimeout(() => {
      document.getElementById(`admin-seed-mapping-item-${starterPartId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api<CatalogSeedMappingPreview>("/api/admin/catalog/seed-mapping-preview")
      .then((next) => { if (!cancelled) setPreview(next); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "상품 코드 매핑 부품을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  useEffect(() => {
    const handleCatalogCrawlCompleted = () => {
      setFeedback("카탈로그 수집이 끝나 매핑 부품과 상품 페이지 수집 목록을 자동으로 다시 계산했습니다.");
      setRefreshKey((current) => current + 1);
    };
    window.addEventListener("pc-supporter:catalog-crawl-completed", handleCatalogCrawlCompleted);
    return () => window.removeEventListener("pc-supporter:catalog-crawl-completed", handleCatalogCrawlCompleted);
  }, []);

  const visibleItems = useMemo(() => {
    if (!preview) return [];
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    return preview.items.filter((item) => itemMatchesFilter(item, filter)).filter((item) => !normalized || [item.starter.id, item.starter.name, item.starter.model, ...item.candidates.flatMap((candidate) => [candidate.activePartId, candidate.activeSourceProductCode, candidate.activeName, candidate.activeModel])].filter((value): value is string => Boolean(value)).some((value) => value.toLocaleLowerCase("ko-KR").includes(normalized))).slice(0, 16);
  }, [filter, preview, query]);

  async function approve(item: CatalogSeedMappingItem, candidate: CatalogSeedMappingCandidate) {
    const key = `${item.starter.id}:${candidateIdentity(candidate)}`;
    const requestVersion = ++mutationRequestRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestRef.current === requestVersion;
    setBusyKey(key);
    setFeedback(null);
    try {
      await api(`/api/admin/catalog/seed-mapping-reviews/${encodeURIComponent(item.starter.id)}`, { method: "PUT", body: JSON.stringify({ activePartId: candidate.activePartId, status: "approved" }) });
      if (!isCurrent()) return;
      setFeedback(`${item.starter.name} → ${candidate.activeName} 매핑을 승인했습니다. catalog 원본은 변경하지 않았습니다.`);
      setRefreshKey((current) => current + 1);
    } catch (reason: unknown) {
      if (isCurrent()) setFeedback(reason instanceof Error ? reason.message : "매핑 승인을 저장하지 못했습니다.");
    } finally {
      if (isCurrent()) setBusyKey(null);
    }
  }

  async function removeApproval(item: CatalogSeedMappingItem) {
    const key = `remove:${item.starter.id}`;
    const requestVersion = ++mutationRequestRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestRef.current === requestVersion;
    setBusyKey(key);
    setFeedback(null);
    try {
      await api(`/api/admin/catalog/seed-mapping-reviews/${encodeURIComponent(item.starter.id)}`, { method: "DELETE" });
      if (!isCurrent()) return;
      setFeedback(`${item.starter.name} 매핑 승인을 취소했습니다.`);
      setRefreshKey((current) => current + 1);
    } catch (reason: unknown) {
      if (isCurrent()) setFeedback(reason instanceof Error ? reason.message : "매핑 승인을 취소하지 못했습니다.");
    } finally {
      if (isCurrent()) setBusyKey(null);
    }
  }

  async function manualVerify(item: CatalogSeedMappingItem, sourceProductCode: string, sourceUrl: string) {
    const key = `manual:${item.starter.id}`;
    const requestVersion = ++mutationRequestRef.current;
    const isCurrent = () => mountedRef.current && mutationRequestRef.current === requestVersion;
    setBusyKey(key);
    setFeedback(null);
    try {
      const result = await api<{ review?: { activeSourceProductCode?: string } }>(`/api/admin/catalog/seed-mapping-reviews/${encodeURIComponent(item.starter.id)}/manual-verify`, { method: "POST", body: JSON.stringify({ sourceProductCode, sourceUrl }) });
      if (!isCurrent()) return;
      setFeedback(`${item.starter.name}의 수동 매핑을 등록했습니다. ${result.review?.activeSourceProductCode ?? sourceProductCode} · catalog 원본은 변경하지 않았습니다.`);
      setRefreshKey((current) => current + 1);
    } catch (reason: unknown) {
      if (isCurrent()) setFeedback(reason instanceof Error ? reason.message : "수동 상품 코드 매핑을 등록하지 못했습니다.");
    } finally {
      if (isCurrent()) setBusyKey(null);
    }
  }

  return <section className="admin-seed-mapping" data-testid="admin-seed-catalog-mapping" aria-label="starter 상품 코드 매핑 확인" aria-busy={loading || Boolean(busyKey)}>
    <div className="admin-seed-mapping-heading">
      <div>
        <p className="eyebrow">PRODUCT ID REVIEW QUEUE</p>
        <h2>starter 상품 코드 매핑 확인</h2>
        <p>이름·모델·브랜드를 기준으로 실제 다나와 상품 코드 부품을 제안합니다. 자동으로 정하는하지 않으며, 관리자가 부품을 승인한 경우에만 별도 mapping registry에 저장합니다.</p>
      </div>
      <div className="admin-seed-mapping-actions">
        <span className="admin-seed-mapping-boundary"><FiShield /> catalog 원본 보호</span>
        <button className="button button-light button-small" type="button" onClick={() => setRefreshKey((current) => current + 1)} disabled={loading || Boolean(busyKey)} data-testid="admin-seed-mapping-refresh"><FiRefreshCw className={loading ? "spin" : undefined} /> 다시 계산</button>
        <button className="icon-button" type="button" aria-label="상품 코드 매핑 JSON 내려받기" title="JSON 내려받기" onClick={() => { if (preview) downloadJson(preview); }} disabled={!preview || loading}><FiDownload /></button>
      </div>
    </div>
    {loading ? <div className="admin-seed-mapping-state" role="status"><FiLoader className="spin" /> 실제 상품 코드 부품을 계산하는 중...</div> : error ? <div className="admin-seed-mapping-state error" role="alert"><FiAlertTriangle /> <span>{error}</span></div> : preview && <>
      <div className="admin-seed-mapping-summary" data-testid="admin-seed-mapping-summary">
        <div><span>누락 starter</span><strong>{numberText(preview.summary.missingStarterCount)}개</strong><small>현재 ID 기준</small></div>
        <div className="good"><span>확인 부품</span><strong>{numberText(preview.summary.candidateCount)}개</strong><small>상품 코드 제안 있음</small></div>
        <div className="high"><span>유력</span><strong>{numberText(preview.summary.highConfidenceCount)}개</strong><small>그래도 수동 승인 필요</small></div>
        <div className="review"><span>부품 없음</span><strong>{numberText(preview.summary.noCandidateCount)}개</strong><small>상품 페이지 검색 필요</small></div>
        <div className="approved"><span>승인됨</span><strong>{numberText(preview.summary.approvedCount)}개</strong><small>{preview.summary.staleCount > 0 ? `${numberText(preview.summary.staleCount)}개 대상 변경` : "mapping registry"}</small></div>
      </div>
      <AdminSeedCollectionQueuePanel refreshKey={refreshKey} onFocusMapping={focusMappingItem} onStartCategory={onStartCategory} categoryCrawlRunning={categoryCrawlRunning} />
      <div className="admin-seed-mapping-toolbar">
        <div className="admin-seed-mapping-filters" role="group" aria-label="상품 코드 매핑 목록 필터">{(Object.keys(FILTER_LABELS) as MappingFilter[]).map((value) => <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{FILTER_LABELS[value]}{value === "candidate" ? ` ${numberText(preview.summary.candidateCount)}` : value === "high" ? ` ${numberText(preview.summary.highConfidenceCount)}` : value === "manual" ? ` ${numberText(preview.summary.noCandidateCount)}` : value === "approved" ? ` ${numberText(preview.summary.approvedCount)}` : ` ${numberText(preview.summary.missingStarterCount)}`}</button>)}</div>
        <label className="admin-seed-mapping-search"><span>매핑 목록 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="starter·모델·상품 코드" aria-label="상품 코드 매핑 목록 검색" /></label>
      </div>
      {feedback && <div className="admin-seed-mapping-feedback" role="status"><FiCheckCircle /> {feedback}</div>}
      {visibleItems.length === 0 ? <div className="admin-seed-mapping-empty"><FiCheckCircle /> 현재 필터에 해당하는 매핑 항목이 없습니다.</div> : <div className="admin-seed-mapping-list">{visibleItems.map((item) => <article id={`admin-seed-mapping-item-${item.starter.id}`} key={item.starter.id} className={`admin-seed-mapping-item ${item.status}`}>
        <div className="admin-seed-mapping-starter"><div><span>{CATEGORY_LABELS[item.starter.category]}</span><strong>{item.starter.name}</strong><small>{item.starter.id} · {priceText(item.starter.priceWon)}</small></div>{item.status === "approved" ? <em className="approved">승인됨</em> : item.status === "stale" ? <em className="stale">대상 변경</em> : <em className="pending">확인 대기</em>}</div>
        {item.status === "approved" && item.approvedMapping && <div className="admin-seed-mapping-approved"><FiCheckCircle /><div><strong>매핑 승인 대상 · {item.approvedMapping.activePartId}</strong><small>다나와 상품 코드 {item.approvedMapping.activeSourceProductCode} · {dateText(item.approvedMapping.reviewedAt)}</small></div><button className="text-button" type="button" onClick={() => void removeApproval(item)} disabled={Boolean(busyKey)}><FiTrash2 /> 승인 취소</button></div>}
        {item.status === "stale" && <div className="admin-seed-mapping-stale"><FiAlertTriangle /> 승인 당시의 상품 코드가 현재 catalog에서 확인되지 않습니다. 새 부품을 다시 확인하세요.</div>}
        {item.candidates.length > 0 ? <div className="admin-seed-mapping-candidates">{item.candidates.map((candidate) => { const actionKey = `${item.starter.id}:${candidateIdentity(candidate)}`; return <div className="admin-seed-mapping-candidate" key={candidateIdentity(candidate)}><div className="admin-seed-mapping-candidate-main"><div><span className={candidate.confidence}>{candidate.confidence === "high" ? "유력" : "직접 확인"} · {(candidate.score * 100).toFixed(0)}%</span><strong>{candidate.activeName}</strong><small>{candidate.activePartId} · 상품 코드 {candidate.activeSourceProductCode} · {DATA_QUALITY_LABELS[candidate.activeDataQuality]} · {priceText(candidate.activePriceWon)}{candidate.priceDeltaPercent !== undefined ? ` · 기준가 대비 ${candidate.priceDeltaPercent.toFixed(1)}%` : ""}</small></div><div className="admin-seed-mapping-candidate-actions">{candidate.activeUrl && <a href={candidate.activeUrl} target="_blank" rel="noreferrer" aria-label={`${candidate.activeName} 다나와 페이지`}><FiExternalLink /></a>}<button className="button button-primary button-small" type="button" onClick={() => void approve(item, candidate)} disabled={Boolean(busyKey)}>{busyKey === actionKey ? <FiLoader className="spin" /> : <FiCheckCircle />} 이 부품 승인</button></div></div><div className="admin-seed-mapping-reasons">{candidate.reasons.map((reason) => <span key={reason}>{REASON_LABELS[reason]}</span>)}</div></div>; })}</div> : <><div className="admin-seed-mapping-no-candidate"><FiInfo /><span>자동 부품 없음 · 실제 다나와 상품 페이지나 다른 상품명으로 수동 검색이 필요합니다.</span></div><ManualMappingForm item={item} busy={busyKey === `manual:${item.starter.id}`} onSubmit={manualVerify} /></>}
      </article>)}</div>}
      {preview.items.length > visibleItems.length && <p className="admin-seed-mapping-more">현재 목록은 최대 16개까지 보여줍니다. 검색어 또는 필터로 나머지 {numberText(Math.max(0, preview.items.length - visibleItems.length))}개를 좁혀 확인하세요.</p>}
      <p className="admin-seed-mapping-note"><FiInfo /> 승인은 `category:id` 기준 누락을 실제 상품 코드로 연결하는 별도 확인 기록만 저장합니다. 승인된 매핑도 catalog의 ID·가격·스펙·source를 바꾸지 않으며, 상품 코드가 변경되면 `대상 변경`으로 다시 확인해야 합니다. 모델 일치가 곧 호환성·재고·최신 가격을 의미하지 않습니다.</p>
    </>}
  </section>;
}
