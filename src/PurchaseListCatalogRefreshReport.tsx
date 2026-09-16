import { FiAlertTriangle, FiCheckCircle, FiInfo, FiRefreshCw, FiXCircle } from "react-icons/fi";
import { DATA_QUALITY_LABELS, isKnownPrice } from "../shared/types";
import type { CatalogRefreshReport, CatalogRefreshReportItem } from "../shared/catalog-refresh-report";
import { catalogRefreshValueText } from "../shared/catalog-refresh-report";
import { catalogChangeFieldLabelFor } from "../shared/catalog-spec-coverage";
import type { RefreshTarget } from "../shared/refresh-targets";

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function priceTransition(item: CatalogRefreshReportItem) {
  const beforeKnown = isKnownPrice(item.previousPriceWon);
  const afterKnown = isKnownPrice(item.nextPriceWon);
  if (!beforeKnown && !afterKnown) return "확인 필요 → 확인 필요";
  if (!beforeKnown && afterKnown) return `확인 필요 → ${formatWon(item.nextPriceWon!)}`;
  if (beforeKnown && !afterKnown) return `${formatWon(item.previousPriceWon!)} → 확인 필요`;
  if (item.previousPriceWon === item.nextPriceWon) return `${formatWon(item.nextPriceWon!)} · 변화 없음`;
  const delta = item.nextPriceWon! - item.previousPriceWon!;
  return `${formatWon(item.previousPriceWon!)} → ${formatWon(item.nextPriceWon!)} · ${delta > 0 ? "+" : ""}${formatWon(delta)} 변화`;
}

function dataQualityTransition(item: CatalogRefreshReportItem) {
  return item.previousDataQuality === item.nextDataQuality
    ? DATA_QUALITY_LABELS[item.nextDataQuality]
    : `${DATA_QUALITY_LABELS[item.previousDataQuality]} → ${DATA_QUALITY_LABELS[item.nextDataQuality]}`;
}

function RefreshValueDiffs({ item }: { item: CatalogRefreshReportItem }) {
  if (!item.valueDiffs || item.valueDiffs.length === 0) return null;
  return <details className="purchase-list-catalog-refresh-report-values" data-testid={`purchase-list-catalog-refresh-values-${item.target.kind}-${item.target.id}`}><summary>실제 값 변화 {item.valueDiffs.length}건</summary><div>{item.valueDiffs.map((diff) => <div className="purchase-list-catalog-refresh-report-value" key={diff.field}><span>{diff.field}</span><small><em>{catalogRefreshValueText(diff.previous)}</em><b>→</b><em>{catalogRefreshValueText(diff.next)}</em></small></div>)}</div></details>;
}

export function PurchaseListCatalogRefreshReport({ report, onRetryFailed, retrying = false }: { report: CatalogRefreshReport; onRetryFailed?: (targets: RefreshTarget[]) => void; retrying?: boolean }) {
  const statusLabel = report.status === "success" ? "정보 확인 완료" : report.status === "partial" ? "일부 정보 확인 완료" : "정보 확인 실패";
  const StatusIcon = report.status === "success" ? FiCheckCircle : report.status === "partial" ? FiAlertTriangle : FiXCircle;
  return <section className={`purchase-list-catalog-refresh-report ${report.status}`} aria-label="구매 목록 정보 다시 확인 결과" data-testid="purchase-list-catalog-refresh-report"><div className="purchase-list-catalog-refresh-report-heading"><div><p className="eyebrow">CATALOG REFRESH RESULT</p><h3>{statusLabel}</h3><small>{formatDate(report.completedAt)} · 요청 {report.requestedCount}개 · 성공 {report.successCount}개 · 실패 {report.failureCount}개</small></div><span><StatusIcon /> {report.status === "success" ? "검토 완료" : report.status === "partial" ? "부분 확인" : "다시 확인"}</span></div><div className="purchase-list-catalog-refresh-report-list">{report.items.slice(0, 6).map((item) => <article key={`${item.target.kind}-${item.target.id}`}><div className="purchase-list-catalog-refresh-report-item-heading"><strong>{item.name}</strong><small>{item.target.kind === "part" ? "핵심 부품" : "주변 부품"} · {formatDate(item.refreshedAt)}</small></div><div className="purchase-list-catalog-refresh-report-facts"><span><b>가격</b>{priceTransition(item)}</span><span><b>데이터</b>{dataQualityTransition(item)}</span><span><b>누락</b>{item.previousMissingCount}개 → {item.nextMissingCount}개</span></div><small className="purchase-list-catalog-refresh-report-changes">{item.changedFields.length > 0 ? `변경 영역 · ${item.changedFields.map((field) => catalogChangeFieldLabelFor(field)).join(" · ")}` : "변경된 영역 없음"}</small><RefreshValueDiffs item={item} /></article>)}</div>{report.items.length > 6 && <small className="purchase-list-catalog-refresh-report-more">그 외 성공 항목 {report.items.length - 6}개는 현재 카탈로그 상세에서 확인할 수 있습니다.</small>}{report.failures.length > 0 && <div className="purchase-list-catalog-refresh-report-failures"><div className="purchase-list-catalog-refresh-report-failures-heading"><strong>확인하지 못한 항목</strong>{onRetryFailed && <button className="text-button" type="button" data-testid="purchase-list-catalog-refresh-retry-failed" onClick={() => onRetryFailed(report.failures.map((failure) => failure.target))} disabled={retrying}><FiRefreshCw className={retrying ? "spin" : undefined} /> {retrying ? "실패 항목 다시 확인 중..." : "실패 항목만 다시 확인"}</button>}</div>{report.failures.slice(0, 4).map((failure) => <p key={`${failure.target.kind}-${failure.target.id}`}><b>{failure.target.kind === "part" ? "핵심 부품" : "주변 부품"}</b> · {failure.message}</p>)}{report.failures.length > 4 && <small>그 외 실패 {report.failures.length - 4}개</small>}</div>}<p className="purchase-list-catalog-refresh-report-note"><FiInfo /> 정보 다시 확인 결과는 현재 카탈로그 기준으로 표시됩니다. 실제 판매가·재고·배송 조건은 상품 페이지에서 다시 확인하세요.</p></section>;
}
