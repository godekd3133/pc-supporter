import { FiAlertTriangle, FiCheckCircle, FiClock, FiDatabase, FiShoppingCart, FiTool } from "react-icons/fi";
import type { PurchaseListAction, PurchaseListActionKind } from "../shared/purchase-list-action-center";

const ACTION_ICONS: Record<PurchaseListActionKind, typeof FiClock> = {
  "data-review": FiDatabase,
  "price-review": FiClock,
  order: FiShoppingCart,
  receive: FiAlertTriangle,
  install: FiTool
};

export function PurchaseListActionCenter({ actions, total, onAction }: { actions: PurchaseListAction[]; total: number; onAction: (kind: PurchaseListActionKind) => void }) {
  return <section className={`purchase-list-action-center ${actions.length === 0 ? "clear" : ""}`} aria-label="구매 다음 행동" data-testid="purchase-list-action-center"><div className="purchase-list-action-center-heading"><div><p className="eyebrow">NEXT PURCHASE ACTION</p><h3>다음 구매 행동</h3><small>{actions.length > 0 ? `전체 ${total}개 항목에서 현재 데이터와 구매 단계를 기준으로 먼저 처리할 일을 정리했습니다.` : "모든 항목이 조립 완료로 기록되었습니다."}</small></div><span>{actions.length > 0 ? `${actions.length}개 우선 행동` : <FiCheckCircle />}</span></div>{actions.length === 0 ? <p className="purchase-list-action-center-clear"><FiCheckCircle /> 구매·수령·조립 단계가 모두 완료됐습니다. 실제 부하·BIOS·온도 확인은 별도 실측 기록으로 확인하세요.</p> : <div className="purchase-list-action-center-list">{actions.map((action) => { const Icon = ACTION_ICONS[action.kind]; return <button className={`purchase-list-action-center-item ${action.kind}`} type="button" data-testid={`purchase-list-action-${action.kind}`} onClick={() => onAction(action.kind)} key={action.kind}><span className="purchase-list-action-center-icon"><Icon /></span><span><strong>{action.title}</strong><small>{action.summary}</small></span><b>{action.count}개</b></button>; })}</div>}<p className="purchase-list-action-center-note"><FiAlertTriangle /> 이 카드는 주문·배송·조립을 자동 실행하지 않습니다. 현재 목록의 표시 범위만 해당 단계로 좁혀 다음 행동을 확인합니다. 전체 구매·호환성 판단은 원래 gate와 정보를 따릅니다.</p></section>;
}
