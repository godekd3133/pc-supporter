import { FiAlertTriangle, FiCheckCircle, FiChevronDown, FiShoppingCart, FiTool, FiXCircle } from "react-icons/fi";
import { purchaseDecisionFor } from "../shared/purchase-decision";
import type { PurchaseChecklistProgress } from "../shared/purchase-checklist";
import type { PurchaseReadiness } from "../shared/purchase-readiness";
import type { AssemblyVerificationSurfaceSummary } from "../shared/assembly-verification";
import type { PurchaseListExecutionProgress } from "../shared/purchase-list-progress";
import type { PurchaseItemStatus } from "../shared/purchase-list-status";

export function PurchaseDecisionGatePanel({ readiness, checklistProgress, purchaseProgress, assemblyVerification, onFocusChecklist, onFocusPurchaseList, onFocusAssemblyVerification }: { readiness: PurchaseReadiness; checklistProgress?: PurchaseChecklistProgress; purchaseProgress?: PurchaseListExecutionProgress; assemblyVerification?: AssemblyVerificationSurfaceSummary; onFocusChecklist: () => void; onFocusPurchaseList: (status?: PurchaseItemStatus) => void; onFocusAssemblyVerification: () => void }) {
  const decision = purchaseDecisionFor(readiness, checklistProgress, assemblyVerification, purchaseProgress);
  const DecisionIcon = decision.state === "blocked" ? FiXCircle : decision.state === "ready" ? FiCheckCircle : FiAlertTriangle;
  const checklist = decision.checklistProgress;
  const checklistText = !checklist ? "불러오는 중" : checklist.total === 0 ? "확인 항목 없음" : `${checklist.checked}/${checklist.total}개 완료`;
  const purchase = decision.purchaseProgress;
  const purchaseText = !purchase
    ? "불러오는 중"
    : purchase.total === 0
      ? "항목 없음"
      : `${purchase.percent}% · ${purchase.checked}/${purchase.total}개 · 주문 ${purchase.stageCounts.ordered} · 수령 ${purchase.stageCounts.received} · 조립 ${purchase.stageCounts.installed}`;
  const purchaseActionStatus: PurchaseItemStatus | undefined = !purchase || purchase.total === 0 ? undefined : purchase.stageCounts.planned > 0 ? "planned" : purchase.stageCounts.ordered > 0 ? "ordered" : purchase.stageCounts.received > 0 && purchase.stageCounts.installed < purchase.total ? "received" : "installed";
  const purchaseActionText = purchaseActionStatus === "planned" ? "구매 예정 항목으로 이동" : purchaseActionStatus === "ordered" ? "수령 대기 항목으로 이동" : purchaseActionStatus === "received" ? "조립 대상 항목으로 이동" : "구매 기록 보기";
  const assembly = decision.assemblyVerification;
  const assemblyText = !assembly || assembly.state === "not_started" ? "기록 없음" : assembly.state === "failed" ? `실패 기록 ${assembly.failed}개` : assembly.state === "in_progress" ? `${assembly.checked}/${assembly.total}개 진행 중` : assembly.recheckSignalCount > 0 ? `통과 · 재확인 ${assembly.recheckSignalCount}개` : `통과 · ${assembly.checked}/${assembly.total}개`;
  return <section className={`purchase-decision-gate ${decision.state}`} aria-label="최종 구매 판단" data-testid="purchase-decision-gate" tabIndex={-1}>
    <div className="purchase-decision-gate-heading"><div><p className="eyebrow">FINAL PURCHASE GATE</p><h2><DecisionIcon /> 최종 구매 판단</h2><p>{decision.summary}</p></div><strong>{decision.label}</strong></div>
    <div className="purchase-decision-gate-facts"><div><span>규칙·가격·데이터</span><strong>{decision.state === "blocked" ? "해결 필요" : decision.state === "review" ? "추가 확인" : "통과"}</strong></div><div><span>구매 전 체크리스트</span><strong>{checklistText}</strong></div><div><span>구매 목록 단계</span><strong>{purchaseText}</strong></div><div><span>실제 조립 확인</span><strong>{assemblyText}</strong></div></div>
    {purchase && purchase.total > 0 && <button className="button button-light purchase-decision-gate-purchase-action" type="button" data-testid="purchase-decision-gate-purchase-action" onClick={() => onFocusPurchaseList(purchaseActionStatus)}><FiShoppingCart /> {purchaseActionText}</button>}
    {decision.state !== "ready" && <button className="button button-light purchase-decision-gate-action" type="button" onClick={onFocusChecklist}><FiChevronDown /> 확인 항목으로 이동</button>}
    {assembly && assembly.state !== "not_started" && <button className="button button-light purchase-decision-gate-assembly-action" type="button" onClick={onFocusAssemblyVerification}><FiTool /> 실측 기록으로 이동</button>}
  </section>;
}
