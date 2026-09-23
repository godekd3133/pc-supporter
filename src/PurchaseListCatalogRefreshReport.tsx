import { FiAlertTriangle, FiCheckCircle, FiRefreshCw, FiXCircle } from "react-icons/fi";
import { isKnownPrice } from "../shared/types";
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
  if (!beforeKnown && !afterKnown) return "가격 정보 없음 → 가격 정보 없음";
  if (!beforeKnown && afterKnown) return `가격 정보 없음 → ${formatWon(item.nextPriceWon!)}`;
  if (beforeKnown && !afterKnown) return `${formatWon(item.previousPriceWon!)} → 가격 정보 없음`;
  if (item.previousPriceWon === item.nextPriceWon) return `${formatWon(item.nextPriceWon!)} · 변화 없음`;
  const delta = item.nextPriceWon! - item.previousPriceWon!;
  return `${formatWon(item.previousPriceWon!)} → ${formatWon(item.nextPriceWon!)} · ${delta > 0 ? "+" : ""}${formatWon(delta)} 변화`;
}


function RefreshValueDiffs({ item }: { item: CatalogRefreshReportItem }) {
  if (!item.valueDiffs || item.valueDiffs.length === 0) return null;
  return <details className="purchase-list-catalog-refresh-report-values" data-testid={`purchase-list-catalog-refresh-values-${item.target.kind}-${item.target.id}`}><summary>사양 변화 {item.valueDiffs.length}건</summary><div>{item.valueDiffs.map((diff) => <div className="purchase-list-catalog-refresh-report-value" key={diff.field}><span>{diff.field}</span><small><em>{catalogRefreshValueText(diff.previous)}</em><b>→</b><em>{catalogRefreshValueText(diff.next)}</em></small></div>)}</div></details>;
}

export function PurchaseListCatalogRefreshReport({ report, onRetryFailed, retrying = false }: { report: CatalogRefreshReport; onRetryFailed?: (targets: RefreshTarget[]) => void; retrying?: boolean }) {
  const statusLabel = report.status === "success" ? "정보 업데이트 완료" : report.status === "partial" ? "일부 정보 업데이트" : "정보를 불러오지 못했어요.";
  const StatusIcon = report.status === "success" ? FiCheckCircle : report.status === "partial" ? FiAlertTriangle : FiXCircle;
  return <section className={`purchase-list-catalog-refresh-report ${report.status}`} aria-label="구매 목록 정보 다시 확인 결과" data-testid="purchase-list-catalog-refresh-report"><div className="purchase-list-catalog-refresh-report-heading"><div><p className="eyebrow">부품 정보 업데이트</p><h3>{statusLabel}</h3><small>{formatDate(report.completedAt)} · {report.successCount}개 업데이트 · {report.failureCount}개 누락</small></div><span><StatusIcon /> {report.status === "success" ? "완료" : report.status === "partial" ? "일부 완료" : "다시 불러오기"}</span></div><div className="purchase-list-catalog-refresh-report-list">{report.items.slice(0, 6).map((item) => <article key={`${item.target.kind}-${item.target.id}`}><div className="purchase-list-catalog-refresh-report-item-heading"><strong>{item.name}</strong><small>{item.target.kind === "part" ? "핵심 부품" : "주변 부품"} · {formatDate(item.refreshedAt)}</small></div><div className="purchase-list-catalog-refresh-report-facts"><span><b>가격</b>{priceTransition(item)}</span><span><b>빠진 정보</b>{item.previousMissingCount}개 → {item.nextMissingCount}개</span></div><small className="purchase-list-catalog-refresh-report-changes">{item.changedFields.length > 0 ? `달라진 사양 · ${item.changedFields.map((field) => catalogChangeFieldLabelFor(field)).join(" · ")}` : "변경된 사양 없음"}</small><RefreshValueDiffs item={item} /></article>)}</div>{report.items.length > 6 && <small className="purchase-list-catalog-refresh-report-more">그 외 업데이트한 항목 {report.items.length - 6}개도 부품 정보에서 확인할 수 있습니다.</small>}{report.failures.length > 0 && <div className="purchase-list-catalog-refresh-report-failures"><div className="purchase-list-catalog-refresh-report-failures-heading"><strong>업데이트하지 못한 부품</strong>{onRetryFailed && <button className="text-button" type="button" data-testid="purchase-list-catalog-refresh-retry-failed" onClick={() => onRetryFailed(report.failures.map((failure) => failure.target))} disabled={retrying}><FiRefreshCw className={retrying ? "spin" : undefined} /> {retrying ? "부품 정보를 불러오는 중..." : "다시 불러오기"}</button>}</div>{report.failures.slice(0, 4).map((failure) => <p key={`${failure.target.kind}-${failure.target.id}`}><b>{failure.target.kind === "part" ? "핵심 부품" : "주변 부품"}</b> · 부품 정보를 불러오지 못했어요.</p>)}{report.failures.length > 4 && <small>그 외 실패 {report.failures.length - 4}개</small>}</div>}</section>;
}
