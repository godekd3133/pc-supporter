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
  return value > 0 ? `${formatWon(value)} · 일부 가격 미확인` : "가격 미확인";
}

function budgetSummary(snapshot: BuildPriceSnapshot, budgetWon: number | undefined, hasSelection: boolean) {
  if (budgetWon === undefined) return { tone: "neutral", label: "목표 예산 미설정" } as const;
  if (!hasSelection) return { tone: "neutral", label: "부품 선택 후 계산" } as const;
  if (!snapshot.priceComplete || (snapshot.priceEvidenceReviewCount ?? 0) > 0) return { tone: "unknown", label: "예산과 비교할 가격이 부족해요" } as const;
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
  const StatusIcon = state === "complete" ? FiCheckCircle : state === "partial" ? FiAlertTriangle : FiTag;
  const statusLabel = state === "complete" ? "가격 합산 가능" : state === "partial" ? "일부 가격 미등록" : "부품 선택 전";
  const totalLabel = state === "empty" ? "예상 금액" : state === "complete" ? "전체 예상 금액" : "가격이 확인된 부품 합계";
  const totalText = state === "empty" ? "부품을 선택해 주세요" : state === "complete" ? formatWon(snapshot.totalPriceWon) : snapshot.totalPriceWon > 0 ? formatWon(snapshot.totalPriceWon) : "가격 미확인";

  return <section className={`build-price-summary-panel ${state}${compact ? " compact" : ""}`} aria-label="구매 금액 요약" data-testid={testId}>
    <div className="build-price-summary-heading"><div><h2>견적 금액</h2></div><span className={`build-price-summary-status ${state}`}><StatusIcon /> {statusLabel}</span></div>
    <div className="build-price-summary-total"><div><span>{totalLabel}</span><strong>{totalText}</strong></div></div>
    <div className="build-price-summary-breakdown"><div><span>핵심 부품</span><strong>{sectionPriceText(snapshot.coreTotalPriceWon, snapshot.corePriceComplete)}</strong></div><div><span>주변 부품</span><strong>{sectionPriceText(snapshot.accessoryTotalPriceWon, snapshot.accessoryPriceComplete)}</strong></div></div>
    {state === "partial" && <div className="build-price-summary-warning"><FiAlertTriangle /><div><strong>가격이 없는 부품은 합계에 포함되지 않았어요.</strong></div></div>}
    {state === "partial" && unknownItems.length > 0 && <div className="build-price-summary-unknown" data-testid={`${testId}-unknown-items`}><div className="build-price-summary-unknown-heading"><strong>가격 미확인 부품</strong><span>{unknownPriceCount}종</span></div><div className="build-price-summary-unknown-list">{unknownItems.slice(0, 4).map((item) => { const sourceUrl = safeExternalUrl(item.sourceUrl); const refreshing = refreshingItemId === item.id; return <div className="build-price-summary-unknown-item" key={`${item.kind}-${item.id}`}><div><strong>{item.name}</strong><small>{item.kind === "accessory" ? "주변 부품" : "핵심 부품"} · 가격 미확인</small></div><div className="build-price-summary-unknown-actions">{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a>}{item.refreshTarget && onRefresh && <button className="text-button" type="button" onClick={() => onRefresh(item.refreshTarget!)} disabled={refreshingItemId !== null}>{refreshing ? <><FiRefreshCw className="spin" /> 가격 불러오는 중...</> : <><FiRefreshCw /> 가격 다시 불러오기</>}</button>}</div></div>; })}</div>{unknownItems.length > 4 && <small className="build-price-summary-unknown-more">그 외 {unknownItems.length - 4}종도 가격이 확인되지 않았어요.</small>}</div>}
    {budgetWon !== undefined && <div className={`build-price-summary-budget ${budget.tone}`}><span><FiTag /> 목표 예산 {formatWon(budgetWon)}</span><strong>{budget.label}</strong></div>}
  </section>;
}
