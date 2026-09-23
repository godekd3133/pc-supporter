import { FiClock, FiInfo } from "react-icons/fi";
import type { SavedBuild } from "../shared/types";
import { savedBuildPurchasePriceHistoryComparisonRowsFor } from "../shared/saved-build-purchase-price-history";

export function SavedBuildPurchasePriceHistoryComparison({ builds }: { builds: SavedBuild[] }) {
  const rows = savedBuildPurchasePriceHistoryComparisonRowsFor(builds);
  if (rows.length < 2) return null;
  return <section className="saved-build-purchase-price-history-comparison" aria-label="저장 견적 가격 이력 비교" data-testid="saved-build-purchase-price-history-comparison">
    <div className="saved-build-purchase-price-history-comparison-heading"><div><h2>가격 이력 비교</h2><p>선택한 저장 견적의 가격 확인 기록을 비교합니다.</p></div><span><FiClock /> {rows.length}개 선택</span></div>
    <div className="saved-build-purchase-price-history-comparison-grid">{rows.map((row) => {
      const label = row.summary.status === "multi-sample" ? "2회 이상 확인" : row.summary.status === "recorded" ? "가격 이력 있음" : "가격 이력 없음";
      return <article className={`saved-build-purchase-price-history-comparison-card ${row.summary.status}`} data-testid={`saved-build-purchase-price-history-comparison-${row.id}`} key={row.id}>
        <div className="saved-build-purchase-price-history-comparison-card-heading"><strong>{row.name}</strong><span>{label}</span></div>
        <div className="saved-build-purchase-price-history-comparison-count"><strong>{row.summary.status === "unrecorded" ? "기록 없음" : `${row.summary.recordedRowCount}개 행`}</strong><small>{row.summary.status === "unrecorded" ? "가격 확인 기록이 없습니다." : `${row.summary.sampleCount}개 샘플 · 최소 ${row.summary.minSampleCount}회 · 최대 ${row.summary.maxSampleCount}회`}</small></div>
        <small className="saved-build-purchase-price-history-comparison-meta">{row.summary.revision !== undefined ? `기록 번호 ${row.summary.revision}` : "기록 번호 없음"}{row.summary.historyCount > 0 ? ` · 이전 이력 ${row.summary.historyCount}개` : ""}{row.summary.updatedAt ? ` · ${new Date(row.summary.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}` : ""}</small>
      </article>;
    })}</div>
    <p className="saved-build-purchase-price-history-comparison-note"><FiInfo /> 가격 이력은 카탈로그의 현재 판매가나 결제 완료 상태가 아니라, 각 견적에서 확인해 저장한 가격 샘플입니다.</p>
  </section>;
}
