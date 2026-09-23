import { useEffect, useMemo, useState } from "react";
import { FiDatabase, FiDownload, FiEdit3, FiExternalLink, FiInfo, FiLoader, FiRefreshCw, FiSearch } from "react-icons/fi";
import type { CatalogSeedCollectionQueue, CatalogSeedCollectionQueueAction, CatalogSeedCollectionQueueItem } from "../shared/catalog-seed-collection-queue";
import type { PartCategory } from "../shared/types";
import { CATEGORY_LABELS } from "../shared/types";
import { api } from "./api";

type QueueFilter = "all" | "high";

const ACTION_LABELS: Record<CatalogSeedCollectionQueueAction, string> = {
  collect_category: "범주 수집 필요",
  search_and_collect: "검색 후 수집",
  recheck_mapping: "기존 매핑 재확인"
};

const PRIORITY_LABELS: Record<CatalogSeedCollectionQueueItem["priority"], string> = {
  high: "높은 우선순위",
  medium: "보강 우선순위",
  low: "일반 우선순위"
};

function numberText(value: number) {
  return value.toLocaleString("ko-KR");
}

function csvCell(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadBlob(content: string, fileName: string, type: string) {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function downloadQueueJson(queue: CatalogSeedCollectionQueue) {
  downloadBlob(JSON.stringify(queue, null, 2), `catalog-seed-collection-queue-${new Date(queue.generatedAt).toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8");
}

function downloadQueueCsv(queue: CatalogSeedCollectionQueue) {
  const header = ["starter ID", "범주", "starter 이름", "모델", "작업 유형", "우선순위", "우선순위 점수", "현재 범주 상품 수", "현재 live 상품 수", "권장 검색어", "다나와 검색 URL", "작업 안내"];
  const rows = queue.items.map((item) => [
    item.starter.id,
    CATEGORY_LABELS[item.starter.category],
    item.starter.name,
    item.starter.model,
    ACTION_LABELS[item.action],
    PRIORITY_LABELS[item.priority],
    item.priorityScore,
    item.categoryActiveCount,
    item.categoryLiveCount,
    item.suggestedQueries.join(" / "),
    item.searchUrl,
    item.instructions
  ]);
  downloadBlob(`\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}`, `catalog-seed-collection-queue-${new Date(queue.generatedAt).toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
}

function QueueItem({ item, onFocusMapping, onStartCategory, categoryCrawlRunning }: { item: CatalogSeedCollectionQueueItem; onFocusMapping?: (starterPartId: string) => void; onStartCategory?: (category: PartCategory) => void; categoryCrawlRunning?: boolean }) {
  return <article className={`admin-seed-collection-queue-item ${item.priority}`} data-testid="admin-seed-collection-queue-item">
    <div className="admin-seed-collection-queue-item-heading">
      <div>
        <span className={`admin-seed-collection-queue-action ${item.action}`}>{ACTION_LABELS[item.action]}</span>
        <strong>{item.starter.name}</strong>
        <small>{CATEGORY_LABELS[item.starter.category]} · {item.starter.id} · {item.starter.model ?? "모델 미등록"}</small>
      </div>
      <span className={`admin-seed-collection-queue-priority ${item.priority}`}>{PRIORITY_LABELS[item.priority]}</span>
    </div>
    <div className="admin-seed-collection-queue-item-meta">
      <span>현재 범주 {numberText(item.categoryActiveCount)}개</span>
      <span>live 상품 {numberText(item.categoryLiveCount)}개</span>
      <span>우선순위 {item.priorityScore}점</span>
      <span>검색어 <code>{item.suggestedQueries[0] ?? item.starter.id}</code></span>
    </div>
    <p>{item.instructions}</p>
    <div className="admin-seed-collection-queue-item-actions">
      <a className="button button-light button-small" href={item.searchUrl} target="_blank" rel="noreferrer"><FiSearch /> 다나와에서 찾기 <FiExternalLink /></a>
      {onFocusMapping && <button className="button button-secondary button-small" type="button" data-testid="admin-seed-collection-queue-focus-mapping" data-starter-id={item.starter.id} onClick={() => onFocusMapping(item.starter.id)}><FiEdit3 /> 매핑 입력으로 이동</button>}
      {onStartCategory && <button className="button button-primary button-small" type="button" data-testid="admin-seed-collection-queue-start-category" data-category={item.starter.category} onClick={() => onStartCategory(item.starter.category)} disabled={categoryCrawlRunning}><FiDatabase /> {categoryCrawlRunning ? "수집 중..." : `${CATEGORY_LABELS[item.starter.category]} 빠른 수집`}</button>}
    </div>
  </article>;
}

export function AdminSeedCollectionQueuePanel({ refreshKey, onFocusMapping, onStartCategory, categoryCrawlRunning }: { refreshKey: number; onFocusMapping?: (starterPartId: string) => void; onStartCategory?: (category: PartCategory) => void; categoryCrawlRunning?: boolean }) {
  const [queue, setQueue] = useState<CatalogSeedCollectionQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [category, setCategory] = useState<PartCategory | "all">("all");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api<CatalogSeedCollectionQueue>("/api/admin/catalog/seed-collection-queue")
      .then((next) => { if (!cancelled) setQueue(next); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "상품 페이지 수집 작업 목록을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey, reloadKey]);

  const visibleItems = useMemo(() => {
    if (!queue) return [];
    return queue.items
      .filter((item) => filter === "all" || item.priority === "high")
      .filter((item) => category === "all" || item.starter.category === category)
      .slice(0, 12);
  }, [category, filter, queue]);

  return <section className="admin-seed-collection-queue" data-testid="admin-seed-collection-queue" aria-label="기본 목록 정보 수집 작업 목록" aria-busy={loading}>
    <div className="admin-seed-collection-queue-heading">
      <div>

        <h3>상품 페이지 수집 작업 목록</h3>
        <p>자동 부품이 없는 기본 목록을 범주 수집·검색·재확인 작업으로 나눠 다음 수집 범위를 결정합니다. 목록 계산은 읽기 전용이며, 빠른 수집은 확인 후 해당 범주의 기존 수집기를 실행합니다.</p>
      </div>
      <div className="admin-seed-collection-queue-actions">
        <button className="button button-light button-small" type="button" onClick={() => { if (queue) downloadQueueCsv(queue); }} disabled={!queue || loading}><FiDownload /> CSV</button>
        <button className="button button-light button-small" type="button" onClick={() => { if (queue) downloadQueueJson(queue); }} disabled={!queue || loading}><FiDownload /> JSON</button>
        <button className="icon-button" type="button" aria-label="상품 페이지 수집 작업 목록 새로고침" title="다시 계산" onClick={() => setReloadKey((current) => current + 1)} disabled={loading}><FiRefreshCw className={loading ? "spin" : undefined} /></button>
      </div>
    </div>
    {loading ? <div className="admin-seed-collection-queue-state" role="status"><FiLoader className="spin" /> 수집 작업 범위를 계산하는 중...</div> : error ? <div className="admin-seed-collection-queue-state error" role="alert"><FiInfo /> {error}</div> : queue && <>
      <div className="admin-seed-collection-queue-summary" data-testid="admin-seed-collection-queue-summary">
        <div><span>작업 대상</span><strong>{numberText(queue.summary.queueCount)}개</strong><small>자동 부품 없음·재확인</small></div>
        <div className="high"><span>높은 우선순위</span><strong>{numberText(queue.summary.highPriorityCount)}개</strong><small>CPU·GPU·핵심 전원 우선</small></div>
        <div><span>범주 수집 필요</span><strong>{numberText(queue.summary.collectCategoryCount)}개</strong><small>해당 범주 live 없음</small></div>
        <div className="review"><span>검색 후 수집</span><strong>{numberText(queue.summary.searchAndCollectCount)}개</strong><small>현재 범주에는 live 존재</small></div>
        <div><span>기존 매핑 재확인</span><strong>{numberText(queue.summary.recheckMappingCount)}개</strong><small>승인 대상 변경</small></div>
      </div>
      {queue.categoryRows.length > 0 && <div className="admin-seed-collection-queue-categories" aria-label="범주별 수집 목록"><strong>범주별 작업량</strong>{queue.categoryRows.map((row) => <div key={row.category}><span>{CATEGORY_LABELS[row.category]}</span><b>{numberText(row.queueCount)}개</b><small>수집 {row.collectCategoryCount} · 검색 {row.searchAndCollectCount} · 재확인 {row.recheckMappingCount}</small></div>)}</div>}
      <div className="admin-seed-collection-queue-toolbar">
        <div className="admin-seed-collection-queue-filters" role="group" aria-label="상품 페이지 수집 목록 우선순위 필터"><button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체 {numberText(queue.summary.queueCount)}</button><button type="button" className={filter === "high" ? "active" : ""} onClick={() => setFilter("high")}>높은 우선순위 {numberText(queue.summary.highPriorityCount)}</button></div>
        <label><span>범주</span><select value={category} onChange={(event) => setCategory(event.target.value as PartCategory | "all")}><option value="all">전체 범주</option>{queue.categoryRows.map((row) => <option key={row.category} value={row.category}>{CATEGORY_LABELS[row.category]}</option>)}</select></label>
      </div>
      {visibleItems.length === 0 ? <p className="admin-seed-collection-queue-empty">현재 조건에 해당하는 수집 작업이 없습니다.</p> : <div className="admin-seed-collection-queue-list">{visibleItems.map((item) => <QueueItem key={item.starter.id} item={item} onFocusMapping={onFocusMapping} onStartCategory={onStartCategory} categoryCrawlRunning={categoryCrawlRunning} />)}</div>}
      {queue.items.length > visibleItems.length && <p className="admin-seed-collection-queue-more">현재 화면에는 최대 12개만 표시합니다. CSV·JSON 전체 작업 패키지에는 {numberText(queue.items.length)}개가 포함됩니다.</p>}
      <p className="admin-seed-collection-queue-note"><FiInfo /> 작업 목록 확인값 <code>{queue.queueFingerprint}</code> · 범주 빠른 수집은 최대 16개 상품을 확인하는 샘플 실행이며, 화면에서 시작한 수집은 완료 후 매핑 부품과 목록을 자동으로 다시 계산합니다. 외부 CLI 실행 후에는 `다시 계산`을 눌러 주세요. 수집 전 상품을 이 화면에서 임의로 생성하지 않습니다.</p>
    </>}
  </section>;
}
