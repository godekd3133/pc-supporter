import { FiAlertTriangle, FiCheckCircle, FiChevronDown, FiInfo, FiTool, FiXCircle } from "react-icons/fi";
import { purchaseDecisionFor } from "../shared/purchase-decision";
import type { PurchaseChecklistProgress } from "../shared/purchase-checklist";
import type { PurchaseReadiness } from "../shared/purchase-readiness";
import type { AssemblyVerificationSurfaceSummary } from "../shared/assembly-verification";

export function PurchaseDecisionGatePanel({ readiness, checklistProgress, assemblyVerification, onFocusChecklist, onFocusAssemblyVerification }: { readiness: PurchaseReadiness; checklistProgress?: PurchaseChecklistProgress; assemblyVerification?: AssemblyVerificationSurfaceSummary; onFocusChecklist: () => void; onFocusAssemblyVerification: () => void }) {
  const decision = purchaseDecisionFor(readiness, checklistProgress, assemblyVerification);
  const DecisionIcon = decision.state === "blocked" ? FiXCircle : decision.state === "ready" ? FiCheckCircle : FiAlertTriangle;
  const checklist = decision.checklistProgress;
  const checklistText = !checklist ? "불러오는 중" : checklist.total === 0 ? "확인 항목 없음" : `${checklist.checked}/${checklist.total}개 완료`;
  const assembly = decision.assemblyVerification;
  const assemblyText = !assembly || assembly.state === "not_started" ? "미기록" : assembly.state === "failed" ? `실패 기록 ${assembly.failed}개` : assembly.state === "in_progress" ? `${assembly.checked}/${assembly.total}개 진행 중` : assembly.recheckSignalCount > 0 ? `통과 · 재확인 ${assembly.recheckSignalCount}개` : `통과 · ${assembly.checked}/${assembly.total}개`;
  return <section className={`purchase-decision-gate ${decision.state}`} aria-label="최종 구매 판단" data-testid="purchase-decision-gate">
    <div className="purchase-decision-gate-heading"><div><p className="eyebrow">FINAL PURCHASE GATE</p><h2><DecisionIcon /> 최종 구매 판단</h2><p>{decision.summary}</p></div><strong>{decision.label}</strong></div>
    <div className="purchase-decision-gate-facts"><div><span>규칙·가격·데이터</span><strong>{decision.state === "blocked" ? "해결 필요" : decision.state === "review" ? "추가 확인" : "통과"}</strong></div><div><span>구매 전 체크리스트</span><strong>{checklistText}</strong></div><div><span>실제 조립 검증</span><strong>{assemblyText}</strong></div></div>
    {decision.state !== "ready" && <button className="button button-light purchase-decision-gate-action" type="button" onClick={onFocusChecklist}><FiChevronDown /> 확인 항목으로 이동</button>}
    {assembly && assembly.state !== "not_started" && <button className="button button-light purchase-decision-gate-assembly-action" type="button" onClick={onFocusAssemblyVerification}><FiTool /> 실측 기록으로 이동</button>}
    <p className="purchase-decision-gate-note"><FiInfo /> 이 배지는 실제 주문·배송·BIOS·QVL·조립 환경을 대신하지 않으며, 현재 입력과 확인된 근거를 기준으로 구매 전 다음 행동을 안내합니다.</p>
  </section>;
}
