import { FiAlertTriangle, FiCheckCircle, FiExternalLink, FiInfo, FiRefreshCw, FiTag } from "react-icons/fi";
import type { BuildPriceSnapshot } from "../shared/build-price-summary";
import type { RefreshTarget } from "../shared/refresh-targets";
import { safeExternalUrl } from "./safe-source-url";

export type UnknownPriceItem = {
  id: string;
  name: string;
  kind: RefreshTarget["kind"];
  sourceUrl?: string;
  refreshTarget?: RefreshTarget;
};

type BuildPriceSummaryPanelProps = {
  snapshot: BuildPriceSnapshot;
  budgetWon?: number;
  compact?: boolean;
  testId?: string;
  unknownItems?: UnknownPriceItem[];
  onRefresh?: (target: RefreshTarget) => void;
  refreshingItemId?: string | null;
};

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function sectionPriceText(value: number, complete: boolean) {
  if (complete) return value > 0 ? formatWon(value) : "없음";
  return value > 0 ? `확인분 ${formatWon(value)}` : "일부 확인 필요";
}

function budgetSummary(snapshot: BuildPriceSnapshot, budgetWon: number | undefined, hasSelection: boolean) {
  if (budgetWon === undefined) return { tone: "neutral", label: "목표 예산 미설정" } as const;
  if (!hasSelection) return { tone: "neutral", label: "부품 선택 후 계산" } as const;
  if (!snapshot.priceComplete || (snapshot.priceEvidenceReviewCount ?? 0) > 0) return { tone: "unknown", label: "예산 결과 보류" } as const;
  const delta = budgetWon - snapshot.totalPriceWon;
  return delta >= 0
    ? { tone: "within", label: `${formatWon(delta)} 여유` } as const
    : { tone: "over", label: `${formatWon(Math.abs(delta))} 초과` } as const;
}

export function BuildPriceSummaryPanel({ snapshot, budgetWon, compact = false, testId = "build-price-summary", unknownItems = [], onRefresh, refreshingItemId = null }: BuildPriceSummaryPanelProps) {
  const unknownPriceCount = snapshot.unknownPriceCount > 0 ? snapshot.unknownPriceCount : snapshot.priceComplete ? 0 : 1;
  const priceEvidenceReviewCount = snapshot.priceEvidenceReviewCount ?? 0;
  const hasSelection = snapshot.totalPriceWon > 0 || unknownPriceCount > 0;
  const state = !hasSelection ? "empty" : snapshot.priceComplete ? "complete" : "partial";
  const budget = budgetSummary(snapshot, budgetWon, hasSelection);
  const StatusIcon = state === "complete" ? priceEvidenceReviewCount > 0 ? FiInfo : FiCheckCircle : state === "partial" ? FiAlertTriangle : FiTag;
  const statusLabel = state === "complete" ? priceEvidenceReviewCount > 0 ? "가격 확인 완료 · 실제가 재확인" : "가격 확인 완료" : state === "partial" ? "가격 일부 확인" : "선택 대기";
  const totalLabel = state === "empty" ? "구성 선택 후 계산" : state === "complete" ? priceEvidenceReviewCount > 0 ? "카탈로그 기준 전체 합계 · 실제가 재확인" : "카탈로그 기준 전체 합계" : "현재 확인된 부품 소계";
  const totalText = state === "empty" ? "선택 대기" : state === "complete" ? formatWon(snapshot.totalPriceWon) : snapshot.totalPriceWon > 0 ? formatWon(snapshot.totalPriceWon) : "확인 필요";

  return <section className={`build-price-summary-panel ${state}${compact ? " compact" : ""}`} aria-label="구매 금액 요약" data-testid={testId}>
    <div className="build-price-summary-heading"><div><p className="eyebrow">PRICE CONFIDENCE</p><h2>구매 금액 요약</h2></div><span className={`build-price-summary-status ${state}`}><StatusIcon /> {statusLabel}</span></div>
    <div className="build-price-summary-total"><div><span>{totalLabel}</span><strong>{totalText}</strong></div>{state === "partial" && <small>가격 미확인 {unknownPriceCount}종 때문에 전체 합계를 확정하지 않았습니다.</small>}{state === "empty" && <small>부품을 선택하면 확인된 카탈로그 가격을 계산합니다.</small>}</div>
    <div className="build-price-summary-breakdown"><div><span>핵심 부품</span><strong>{sectionPriceText(snapshot.coreTotalPriceWon, snapshot.corePriceComplete)}</strong></div><div><span>주변 부품</span><strong>{sectionPriceText(snapshot.accessoryTotalPriceWon, snapshot.accessoryPriceComplete)}</strong></div></div>
    {state === "partial" && <div className="build-price-summary-warning"><FiAlertTriangle /><div><strong>결제 전 가격 확인 필요</strong><span>미확인 항목은 상품 원문에서 가격·유통 조건을 다시 확인해 주세요.</span></div></div>}
    {state === "complete" && priceEvidenceReviewCount > 0 && <div className="build-price-summary-warning evidence-review" data-testid={`${testId}-price-evidence-review`}><FiInfo /><div><strong>실제 판매가 재확인 필요 · {priceEvidenceReviewCount}종</strong><span>숫자는 있지만 참고 가격·예전 가격일 수 있습니다. 예산 결과와 결제 전 상품 원문에서 현재 가격을 확인해 주세요.</span></div></div>}
    {state === "partial" && unknownItems.length > 0 && <div className="build-price-summary-unknown" data-testid={`${testId}-unknown-items`}><div className="build-price-summary-unknown-heading"><strong>가격 확인이 필요한 항목</strong><span>{unknownPriceCount}종</span></div><div className="build-price-summary-unknown-list">{unknownItems.slice(0, 4).map((item) => { const sourceUrl = safeExternalUrl(item.sourceUrl); const refreshing = refreshingItemId === item.id; return <div className="build-price-summary-unknown-item" key={`${item.kind}-${item.id}`}><div><strong>{item.name}</strong><small>{item.kind === "accessory" ? "주변 부품" : "핵심 부품"} · 가격 미확인</small></div><div className="build-price-summary-unknown-actions">{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">원문 <FiExternalLink /></a>}{item.refreshTarget && onRefresh && <button className="text-button" type="button" onClick={() => onRefresh(item.refreshTarget!)} disabled={refreshingItemId !== null}>{refreshing ? <><FiRefreshCw className="spin" /> 확인 중...</> : <><FiRefreshCw /> 원문 재확인</>}</button>}</div></div>; })}</div>{unknownItems.length > 4 && <small className="build-price-summary-unknown-more">그 외 {unknownItems.length - 4}종은 데이터 상태 패널에서 확인할 수 있습니다.</small>}</div>}
    {budgetWon !== undefined && <div className={`build-price-summary-budget ${budget.tone}`}><span><FiTag /> 목표 예산 {formatWon(budgetWon)}</span><strong>{budget.label}</strong></div>}
    <p className="build-price-summary-note"><FiInfo /> {priceEvidenceReviewCount > 0 ? "가격 숫자는 참고 가격·예전 가격일 수 있으며 배송비·쿠폰·시점별 판매가는 포함되지 않을 수 있습니다. 구매 전 실제 판매가를 확인하세요." : "기록된 카탈로그 가격 기준이며 배송비·쿠폰·시점별 판매가는 포함되지 않을 수 있습니다."}</p>
  </section>;
}
