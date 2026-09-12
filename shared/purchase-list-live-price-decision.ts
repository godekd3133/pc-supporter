import { isKnownPrice } from "./types";
import { purchaseListRowKey, type PurchaseListRow } from "./purchase-list";
import type { PurchaseListLivePrice } from "./purchase-list-live-price";

export type PurchaseListLivePriceDecisionState = "not_checked" | "review" | "decreased" | "increased" | "mixed" | "discovered" | "stable";

export interface PurchaseListLivePriceDecision {
  state: PurchaseListLivePriceDecisionState;
  label: string;
  summary: string;
  checkedCount: number;
  availableCount: number;
  unavailableCount: number;
  errorCount: number;
  changedRowCount: number;
  decreasedRowCount: number;
  increasedRowCount: number;
  discoveredCount: number;
  decreasedTotalPriceWon?: number;
  increasedTotalPriceWon?: number;
}

function money(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function changeSummary(decision: Pick<PurchaseListLivePriceDecision, "decreasedTotalPriceWon" | "increasedTotalPriceWon">) {
  return [
    decision.decreasedTotalPriceWon !== undefined ? `가격 인하 확인 ${money(decision.decreasedTotalPriceWon)}` : undefined,
    decision.increasedTotalPriceWon !== undefined ? `가격 상승 확인 +${money(decision.increasedTotalPriceWon)}` : undefined
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

export function purchaseListLivePriceDecisionFor(rows: ReadonlyArray<PurchaseListRow>, livePrices: Readonly<Record<string, PurchaseListLivePrice>>): PurchaseListLivePriceDecision {
  let checkedCount = 0;
  let availableCount = 0;
  let unavailableCount = 0;
  let errorCount = 0;
  let changedRowCount = 0;
  let decreasedRowCount = 0;
  let increasedRowCount = 0;
  let discoveredCount = 0;
  let decreasedTotalPriceWon = 0;
  let increasedTotalPriceWon = 0;

  rows.forEach((row, index) => {
    const live = livePrices[purchaseListRowKey(row, index)];
    if (!live) return;
    checkedCount += 1;
    if (live.status === "unavailable") {
      unavailableCount += 1;
      return;
    }
    if (live.status === "error") {
      errorCount += 1;
      return;
    }
    if (!isKnownPrice(live.currentUnitPriceWon)) {
      unavailableCount += 1;
      return;
    }
    availableCount += 1;
    const currentTotalPriceWon = live.currentUnitPriceWon * row.quantity;
    if (!isKnownPrice(row.totalPriceWon)) {
      discoveredCount += 1;
      return;
    }
    const deltaTotalPriceWon = currentTotalPriceWon - row.totalPriceWon;
    if (deltaTotalPriceWon < 0) {
      changedRowCount += 1;
      decreasedRowCount += 1;
      decreasedTotalPriceWon += Math.abs(deltaTotalPriceWon);
    } else if (deltaTotalPriceWon > 0) {
      changedRowCount += 1;
      increasedRowCount += 1;
      increasedTotalPriceWon += deltaTotalPriceWon;
    }
  });

  const base: Omit<PurchaseListLivePriceDecision, "state" | "label" | "summary"> = {
    checkedCount,
    availableCount,
    unavailableCount,
    errorCount,
    changedRowCount,
    decreasedRowCount,
    increasedRowCount,
    discoveredCount,
    ...(decreasedTotalPriceWon > 0 ? { decreasedTotalPriceWon } : {}),
    ...(increasedTotalPriceWon > 0 ? { increasedTotalPriceWon } : {})
  };
  if (checkedCount === 0) return { ...base, state: "not_checked", label: "현재 가격 확인 전", summary: "현재 가격을 확인하면 기준 단가와의 변화를 요약합니다." };
  if (unavailableCount > 0 || errorCount > 0 || checkedCount < rows.length) {
    const unavailableText = unavailableCount + errorCount + Math.max(0, rows.length - checkedCount);
    const changes = changeSummary(base);
    return { ...base, state: "review", label: "일부 가격 재확인 필요", summary: `가격 ${availableCount}/${rows.length}개 확인 · ${unavailableText}개는 현재 가격을 확정할 수 없습니다.${changes ? ` ${changes}.` : ""}` };
  }
  if (decreasedRowCount > 0 && increasedRowCount > 0) return { ...base, state: "mixed", label: "가격 변동 혼재", summary: `${changedRowCount}개 행의 단가가 변했습니다. ${changeSummary(base)}.` };
  if (decreasedRowCount > 0) return { ...base, state: "decreased", label: "가격 인하 확인", summary: `${decreasedRowCount}개 행에서 총 ${money(decreasedTotalPriceWon)}의 가격 인하를 확인했습니다.` };
  if (increasedRowCount > 0) return { ...base, state: "increased", label: "가격 상승 확인", summary: `${increasedRowCount}개 행에서 총 +${money(increasedTotalPriceWon)}의 가격 상승을 확인했습니다.` };
  if (discoveredCount > 0) return { ...base, state: "discovered", label: "현재 가격 신규 확인", summary: `${discoveredCount}개 행의 미확인 기준 단가를 현재 가격으로 확인했습니다.` };
  return { ...base, state: "stable", label: "가격 변동 없음", summary: "확인된 모든 행의 현재 단가가 기존 구매 목록 기준과 같습니다." };
}
