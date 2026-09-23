import { useState } from "react";
import { FiClock, FiInfo } from "react-icons/fi";
import type { SavedBuild } from "../shared/types";
import { savedBuildPurchasePriceHistoryMatchesFilter, savedBuildPurchasePriceHistorySummaryFor } from "../shared/saved-build-purchase-price-history";
import type { SavedBuildPurchasePriceHistoryFilter } from "../shared/saved-build-purchase-price-history";

export function SavedBuildPurchasePriceHistoryPanel({ builds }: { builds: SavedBuild[] }) {
  const [filter, setFilter] = useState<SavedBuildPurchasePriceHistoryFilter>("all");
  if (builds.length === 0) return null;
  const rows = builds.map((build) => ({ build, summary: savedBuildPurchasePriceHistorySummaryFor(build.purchasePriceHistory) }));
  const options: Array<{ id: SavedBuildPurchasePriceHistoryFilter; label: string; count: number }> = [
    { id: "all", label: "전체", count: rows.length },
    { id: "recorded", label: "가격 이력 있음", count: rows.filter(({ summary }) => savedBuildPurchasePriceHistoryMatchesFilter(summary, "recorded")).length },
    { id: "multi-sample", label: "2회 이상 확인", count: rows.filter(({ summary }) => savedBuildPurchasePriceHistoryMatchesFilter(summary, "multi-sample")).length },
    { id: "server-history", label: "이전 가격 이력 있음", count: rows.filter(({ summary }) => savedBuildPurchasePriceHistoryMatchesFilter(summary, "server-history")).length },
    { id: "unrecorded", label: "가격 이력 기록 없음", count: rows.filter(({ summary }) => savedBuildPurchasePriceHistoryMatchesFilter(summary, "unrecorded")).length }
  ];
  const visibleRows = rows.filter(({ summary }) => savedBuildPurchasePriceHistoryMatchesFilter(summary, filter));

  return <section className="saved-build-purchase-price-history-panel" aria-label="저장 견적 가격 이력 관리" data-testid="saved-build-purchase-price-history-panel">
    <div className="saved-build-purchase-price-history-panel-heading"><div><h2>가격 이력 보기</h2><p>결과 화면을 열지 않아도 저장 견적별 가격 확인 기록을 볼 수 있습니다.</p></div><span><FiClock /> {visibleRows.length} / {rows.length}개</span></div>
    <div className="history-purchase-price-history-filter-options" role="group" aria-label="가격 이력 필터">{options.map((option) => <button className={filter === option.id ? "selected" : ""} type="button" aria-pressed={filter === option.id} data-testid={`saved-build-purchase-price-history-filter-${option.id}`} onClick={() => setFilter(option.id)} key={option.id}>{option.label}<span>{option.count}</span></button>)}</div>
    {visibleRows.length === 0 ? <div className="saved-build-purchase-price-history-panel-empty" data-testid="saved-build-purchase-price-history-panel-empty"><FiInfo /><span>선택한 조건의 가격 이력 견적이 없습니다.</span><button className="text-button" type="button" onClick={() => setFilter("all")}>전체 견적 보기</button></div> : <div className="saved-build-purchase-price-history-panel-grid">{visibleRows.map(({ build, summary }) => {
      const label = summary.status === "multi-sample" ? "2회 이상 확인" : summary.status === "recorded" ? "가격 이력 있음" : "가격 이력 기록 없음";
      return <article className={`history-card-purchase-price-history ${summary.status}`} data-testid={`saved-build-purchase-price-history-card-${build.id}`} key={build.id}><div className="history-card-purchase-price-history-heading"><span>{build.name}</span><strong>{summary.status === "unrecorded" ? "기록 없음" : `${summary.recordedRowCount}개 행`}</strong></div><small>{label}{summary.status !== "unrecorded" ? ` · ${summary.sampleCount}개 샘플 · 최소 ${summary.minSampleCount}회 · 최대 ${summary.maxSampleCount}회` : ""}{summary.revision !== undefined ? ` · 기록 번호 ${summary.revision}` : ""}{summary.historyCount > 0 ? ` · 이전 이력 ${summary.historyCount}개` : ""}{summary.updatedAt ? ` · ${new Date(summary.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}` : ""}</small><a className="history-card-purchase-price-history-open" href={`/share/${encodeURIComponent(build.id)}#purchase-list`} data-testid={`saved-build-purchase-price-history-open-${build.id}`}>구매 목록 보기</a></article>;
    })}</div>}
    <p className="saved-build-purchase-price-history-panel-note"><FiInfo /> 가격 이력은 각 견적에서 확인해 저장한 참고 샘플이며, 현재 쇼핑몰 가격이나 주문 완료 상태를 의미하지 않습니다.</p>
  </section>;
}
