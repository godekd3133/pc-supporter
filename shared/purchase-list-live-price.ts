import { isKnownPrice } from "./types";
import { purchaseListRowKey, type PurchaseListRow } from "./purchase-list";

export type PurchaseListLivePriceStatus = "available" | "unavailable" | "error";
export type PurchaseListLivePriceDisplayTone = "increased" | "decreased" | "same" | "discovered" | "unavailable" | "error";
export type PurchaseListLivePriceSource = "source-refresh" | "catalog";

export interface PurchaseListLivePrice {
  status: PurchaseListLivePriceStatus;
  currentUnitPriceWon?: number;
  checkedAt?: string;
  source?: PurchaseListLivePriceSource;
  retryAfterSeconds?: number;
  reason?: "source-missing" | "source-not-found" | "source-not-priced" | "source-refresh-blocked" | "source-refresh-failed" | "not-priced";
}

export interface PurchaseListLivePriceSummary {
  checkedCount: number;
  availableCount: number;
  unavailableCount: number;
  errorCount: number;
  changedCount: number;
  increasedCount: number;
  decreasedCount: number;
  sameCount: number;
  discoveredCount: number;
  sourceConfirmedCount: number;
  catalogConfirmedCount: number;
}

export interface PurchaseListLivePriceDisplay {
  tone: PurchaseListLivePriceDisplayTone;
  label: string;
  currentTotalPriceWon?: number;
  deltaTotalPriceWon?: number;
  source?: PurchaseListLivePriceSource;
  sourceLabel?: string;
}

function sourceLabelFor(live: PurchaseListLivePrice) {
  if (live.source === "source-refresh") return "원문 확인 가격";
  if (live.source === "catalog") return "저장 카탈로그 가격";
  return undefined;
}

function withSourceLabel(label: string, live: PurchaseListLivePrice): Pick<PurchaseListLivePriceDisplay, "label" | "source" | "sourceLabel"> {
  const sourceLabel = sourceLabelFor(live);
  if (!sourceLabel) return { label };
  return { label: `${label} · ${sourceLabel}`, source: live.source, sourceLabel };
}

export function purchaseListRowsWithLivePricesFor(rows: ReadonlyArray<PurchaseListRow>, livePrices: Readonly<Record<string, PurchaseListLivePrice>>) {
  return rows.map((row, index) => {
    const live = livePrices[purchaseListRowKey(row, index)];
    if (!live || live.status !== "available" || !isKnownPrice(live.currentUnitPriceWon)) return row;
    return { ...row, unitPriceWon: live.currentUnitPriceWon, totalPriceWon: live.currentUnitPriceWon * row.quantity, ...(live.source === "catalog" ? {} : { priceEvidence: "live" as const }) };
  });
}

export function purchaseListLivePriceDisplayFor(row: PurchaseListRow, live: PurchaseListLivePrice | undefined): PurchaseListLivePriceDisplay | undefined {
  if (!live) return undefined;
  if (live.status === "unavailable") {
    if (live.reason === "source-refresh-blocked") return { tone: "unavailable", label: `원문 재확인 대기 중${live.retryAfterSeconds && live.retryAfterSeconds > 0 ? ` · ${live.retryAfterSeconds}초 후 다시 시도` : ""} · 기존 가격 유지`, source: live.source, sourceLabel: sourceLabelFor(live) };
    if (live.reason === "source-not-found") return { tone: "unavailable", label: "원문 상품 없음 · 기존 가격 유지", source: live.source, sourceLabel: sourceLabelFor(live) };
    if (live.reason === "source-not-priced") return { tone: "unavailable", label: "원문 가격 미확인 · 기존 가격 유지", source: live.source, sourceLabel: sourceLabelFor(live) };
    return { tone: "unavailable", label: live.reason === "not-priced" ? "저장 카탈로그 가격 미확인 · 기존 가격 유지" : "현재 가격 확인 불가 · 기존 가격 유지", source: live.source, sourceLabel: sourceLabelFor(live) };
  }
  if (live.status === "error") return { tone: "error", label: live.reason === "source-missing" ? "가격 조회 식별자 없음 · 기존 가격 유지" : live.reason === "source-refresh-failed" ? "원문 가격 확인 실패 · 기존 가격 유지" : "현재 가격 확인 실패 · 기존 가격 유지", source: live.source, sourceLabel: sourceLabelFor(live) };
  if (!isKnownPrice(live.currentUnitPriceWon)) return { tone: "unavailable", label: "현재 가격 미확인 · 기존 가격 유지", source: live.source, sourceLabel: sourceLabelFor(live) };
  const currentTotalPriceWon = live.currentUnitPriceWon * row.quantity;
  if (row.totalPriceWon === undefined) return { tone: "discovered", ...withSourceLabel(`현재가 확인됨 · ${currentTotalPriceWon.toLocaleString("ko-KR")}원`, live), currentTotalPriceWon };
  const deltaTotalPriceWon = currentTotalPriceWon - row.totalPriceWon;
  if (deltaTotalPriceWon > 0) return { tone: "increased", ...withSourceLabel(`현재가 +${deltaTotalPriceWon.toLocaleString("ko-KR")}원`, live), currentTotalPriceWon, deltaTotalPriceWon };
  if (deltaTotalPriceWon < 0) return { tone: "decreased", ...withSourceLabel(`현재가 ${deltaTotalPriceWon.toLocaleString("ko-KR")}원`, live), currentTotalPriceWon, deltaTotalPriceWon };
  return { tone: "same", ...withSourceLabel("현재가 동일", live), currentTotalPriceWon, deltaTotalPriceWon };
}

export function purchaseListLivePriceSummaryFor(rows: ReadonlyArray<PurchaseListRow>, livePrices: Readonly<Record<string, PurchaseListLivePrice>>): PurchaseListLivePriceSummary {
  const summary: PurchaseListLivePriceSummary = { checkedCount: 0, availableCount: 0, unavailableCount: 0, errorCount: 0, changedCount: 0, increasedCount: 0, decreasedCount: 0, sameCount: 0, discoveredCount: 0, sourceConfirmedCount: 0, catalogConfirmedCount: 0 };
  rows.forEach((row, index) => {
    const live = livePrices[purchaseListRowKey(row, index)];
    if (!live) return;
    summary.checkedCount += 1;
    if (live.status === "unavailable") {
      summary.unavailableCount += 1;
      return;
    }
    if (live.status === "error") {
      summary.errorCount += 1;
      return;
    }
    summary.availableCount += 1;
    if (live.source === "source-refresh") summary.sourceConfirmedCount += 1;
    if (live.source === "catalog") summary.catalogConfirmedCount += 1;
    const display = purchaseListLivePriceDisplayFor(row, live);
    if (!display) return;
    if (display.tone === "increased") {
      summary.changedCount += 1;
      summary.increasedCount += 1;
    } else if (display.tone === "decreased") {
      summary.changedCount += 1;
      summary.decreasedCount += 1;
    } else if (display.tone === "same") {
      summary.sameCount += 1;
    } else if (display.tone === "discovered") {
      summary.discoveredCount += 1;
    }
  });
  return summary;
}
