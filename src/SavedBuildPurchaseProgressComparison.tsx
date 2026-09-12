import { FiInfo } from "react-icons/fi";
import type { SavedBuild } from "../shared/types";
import { savedBuildPurchaseProgressComparisonRowsFor } from "../shared/saved-build-purchase-progress";

export function SavedBuildPurchaseProgressComparison({ builds }: { builds: SavedBuild[] }) {
  const rows = savedBuildPurchaseProgressComparisonRowsFor(builds);
  if (rows.length < 2) return null;
  return <section className="saved-build-purchase-progress-comparison" aria-label="저장 견적 구매 진행률 비교" data-testid="saved-build-purchase-progress-comparison">
    <div className="saved-build-purchase-progress-comparison-heading"><div><p className="eyebrow">PROGRESS COMPARE</p><h2>구매 진행률 비교</h2><p>위의 견적 비교 선택과 같은 견적을 기준으로 구매 상태를 나란히 확인합니다.</p></div><span>{rows.length}개 선택</span></div>
    <div className="saved-build-purchase-progress-comparison-grid">{rows.map((row) => {
      const label = row.summary.status === "completed" ? "모두 구매 완료" : row.summary.status === "in-progress" ? "구매 진행 중" : "서버 기록 없음";
      return <article className={`saved-build-purchase-progress-comparison-card ${row.summary.status}`} data-testid={`saved-build-purchase-progress-comparison-${row.id}`} key={row.id}>
        <div className="saved-build-purchase-progress-comparison-card-heading"><strong>{row.name}</strong><span>{label}</span></div>
        <div className="saved-build-purchase-progress-comparison-count"><strong>{row.summary.status === "unrecorded" ? "미기록" : `${row.summary.checked} / ${row.summary.total}개`}</strong><small>{row.summary.status === "unrecorded" ? "구매 완료 상태가 서버에 없습니다." : `${row.summary.remaining}개 남음 · ${row.summary.percent}%`}</small></div>
        {row.summary.status !== "unrecorded" && <div className="saved-build-purchase-progress-comparison-bar" role="progressbar" aria-label={`${row.name} 구매 진행률 ${row.summary.percent}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.summary.percent}><span style={{ width: `${row.summary.percent}%` }} /></div>}
        <small className="saved-build-purchase-progress-comparison-meta">주문 {row.summary.stageCounts.ordered} · 수령 {row.summary.stageCounts.received} · 조립 {row.summary.stageCounts.installed} · {row.summary.revision !== undefined ? `revision ${row.summary.revision}` : "revision 없음"}{row.summary.historyCount > 0 ? ` · 이전 이력 ${row.summary.historyCount}개` : ""}{row.summary.updatedAt ? ` · ${new Date(row.summary.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}` : ""}</small>
      </article>;
    })}</div>
    <p className="saved-build-purchase-progress-comparison-note"><FiInfo /> 구매 진행률은 브라우저·서버에 기록된 체크 상태이며, 실제 주문·배송·결제 완료를 의미하지 않습니다.</p>
  </section>;
}
