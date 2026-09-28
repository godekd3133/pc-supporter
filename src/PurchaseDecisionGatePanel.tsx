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
  const purchaseActionText = purchaseActionStatus === "planned" ? "구매 예정 항목 보기" : purchaseActionStatus === "ordered" ? "주문한 부품 보기" : purchaseActionStatus === "received" ? "받은 부품 보기" : "구매 기록 보기";
  const assembly = decision.assemblyVerification;
  const assemblyText = !assembly || assembly.state === "not_started" ? "기록 없음" : assembly.state === "failed" ? `실패 ${assembly.failed}개` : assembly.state === "in_progress" ? `${assembly.checked}/${assembly.total}개 기록 중` : assembly.recheckSignalCount > 0 ? `다시 볼 항목 ${assembly.recheckSignalCount}개` : `완료 · ${assembly.checked}/${assembly.total}개`;
  return <section className={`purchase-decision-gate ${decision.state}`} aria-label="구매 전 확인" data-testid="purchase-decision-gate" tabIndex={-1}>
    <div className="purchase-decision-gate-heading"><div><h2><DecisionIcon /> 구매 전 확인</h2><p>{decision.summary}</p></div><strong>{decision.label}</strong></div>
    <div className="purchase-decision-gate-facts"><div><span>호환·장착 정보</span><strong>{decision.state === "blocked" ? "해결할 문제 있음" : decision.state === "review" ? "확인할 내용 있음" : "문제 없음"}</strong></div><div><span>구매 전 확인 목록</span><strong>{checklistText}</strong></div><div><span>구매 기록</span><strong>{purchaseText}</strong></div><div><span>조립 후 기록</span><strong>{assemblyText}</strong></div></div>
    {purchase && purchase.total > 0 && <button className="button button-light purchase-decision-gate-purchase-action" type="button" data-testid="purchase-decision-gate-purchase-action" onClick={() => onFocusPurchaseList(purchaseActionStatus)}><FiShoppingCart /> {purchaseActionText}</button>}
    {decision.state !== "ready" && <button className="button button-light purchase-decision-gate-action" type="button" onClick={onFocusChecklist}><FiChevronDown /> 구매 전 확인 목록 보기</button>}
    {assembly && assembly.state !== "not_started" && <button className="button button-light purchase-decision-gate-assembly-action" type="button" onClick={onFocusAssemblyVerification}><FiTool /> 조립 후 기록 보기</button>}
  </section>;
}
