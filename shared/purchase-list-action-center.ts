import type { PurchaseItemStatus } from "./purchase-list-status";

export type PurchaseListActionKind = "data-review" | "price-review" | "order" | "receive" | "install";

export interface PurchaseListAction {
  kind: PurchaseListActionKind;
  priority: number;
  count: number;
  title: string;
  summary: string;
  targetStatus?: PurchaseItemStatus;
}

export interface PurchaseListActionCenterInput {
  total: number;
  statusCounts: Record<PurchaseItemStatus, number>;
  dataReviewCount: number;
  priceReviewCount: number;
}

export function purchaseListActionCenterFor(input: PurchaseListActionCenterInput): PurchaseListAction[] {
  const actions: PurchaseListAction[] = [];
  if (input.dataReviewCount > 0) actions.push({ kind: "data-review", priority: 100, count: input.dataReviewCount, title: "스펙·원문 먼저 확인", summary: `오래됐거나 정보가 부족한 구매 항목 ${input.dataReviewCount}개를 주문 전에 다시 확인하세요.` });
  if (input.priceReviewCount > 0) actions.push({ kind: "price-review", priority: 90, count: input.priceReviewCount, title: "가격 먼저 재확인", summary: `현재 가격을 확정하지 못한 항목 ${input.priceReviewCount}개가 있습니다.` });
  if (input.statusCounts.planned > 0) actions.push({ kind: "order", priority: 80, count: input.statusCounts.planned, title: "구매 예정 항목 주문", summary: `아직 주문하지 않은 항목 ${input.statusCounts.planned}개를 확인하고 주문하세요.`, targetStatus: "planned" });
  if (input.statusCounts.ordered > 0) actions.push({ kind: "receive", priority: 70, count: input.statusCounts.ordered, title: "주문 항목 수령 확인", summary: `주문은 완료됐지만 수령 전인 항목 ${input.statusCounts.ordered}개를 확인하세요.`, targetStatus: "ordered" });
  if (input.statusCounts.received > 0) actions.push({ kind: "install", priority: 60, count: input.statusCounts.received, title: "수령 항목 조립", summary: `수령했지만 아직 조립 완료로 기록하지 않은 항목 ${input.statusCounts.received}개가 있습니다.`, targetStatus: "received" });
  return actions.sort((left, right) => right.priority - left.priority).slice(0, 5);
}
