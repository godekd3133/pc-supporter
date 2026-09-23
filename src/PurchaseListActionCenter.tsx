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
  return <section className={`purchase-list-action-center ${actions.length === 0 ? "clear" : ""}`} aria-label="구매 진행" data-testid="purchase-list-action-center"><div className="purchase-list-action-center-heading"><div><p className="eyebrow">구매 목록</p><h3>먼저 진행할 항목</h3><small>{actions.length > 0 ? `전체 ${total}개 중 지금 할 일을 모았어요.` : "모든 구매 단계를 마쳤어요."}</small></div><span>{actions.length > 0 ? `${actions.length}개 항목` : <FiCheckCircle />}</span></div>{actions.length === 0 ? <p className="purchase-list-action-center-clear"><FiCheckCircle /> 구매·수령·조립이 모두 끝났어요.</p> : <div className="purchase-list-action-center-list">{actions.map((action) => { const Icon = ACTION_ICONS[action.kind]; return <button className={`purchase-list-action-center-item ${action.kind}`} type="button" data-testid={`purchase-list-action-${action.kind}`} onClick={() => onAction(action.kind)} key={action.kind}><span className="purchase-list-action-center-icon"><Icon /></span><span><strong>{action.title}</strong><small>{action.summary}</small></span><b>{action.count}개</b></button>; })}</div>}</section>;
}
