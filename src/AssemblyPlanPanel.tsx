import { useMemo } from "react";
import { FiActivity, FiAlertTriangle, FiArrowRight, FiCheckCircle, FiInfo, FiLoader, FiMonitor, FiSearch, FiShield, FiShoppingCart, FiTool, FiXCircle, FiZap } from "react-icons/fi";
import type { BuildSelection, CompatibilityResult } from "../shared/types";
import { assemblyPlanFor, assemblyPlanNextStepFor, type AssemblyPlanStep, type AssemblyPlanTargetId } from "../shared/assembly-plan";
import type { PurchaseChecklistProgress } from "../shared/purchase-checklist";
import type { PurchaseListExecutionProgress } from "../shared/purchase-list-progress";
import type { AssemblyVerificationSurfaceSummary } from "../shared/assembly-verification";

function statusLabel(status: AssemblyPlanStep["status"]) {
  return status === "blocked" ? "구매 보류" : status === "review" ? "확인 필요" : status === "pending" ? "앞 단계 대기" : "진행 가능";
}

function statusIcon(status: AssemblyPlanStep["status"]) {
  return status === "blocked" ? FiXCircle : status === "review" ? FiAlertTriangle : status === "pending" ? FiLoader : FiCheckCircle;
}

function targetLabel(targetId: AssemblyPlanTargetId) {
  return targetId === "repair-plan-panel" ? "수리 플랜 보기" : targetId === "gpu-fit-summary-panel" ? "GPU 장착 보기" : targetId === "build-resource-summary" ? "전력·냉각 보기" : targetId === "data-health-panel" ? "데이터 보기" : targetId === "purchase-list-panel" ? "구매 목록 보기" : targetId === "build-connectivity-panel" ? "연결 자원 보기" : targetId === "accessory-compatibility-panel" ? "주변 부품 보기" : targetId === "assembly-verification-panel" ? "실측 로그 보기" : "체크리스트 보기";
}

function targetIcon(targetId: AssemblyPlanTargetId) {
  return targetId === "repair-plan-panel" ? FiZap : targetId === "gpu-fit-summary-panel" ? FiMonitor : targetId === "build-resource-summary" ? FiZap : targetId === "data-health-panel" ? FiShield : targetId === "purchase-list-panel" ? FiShoppingCart : targetId === "accessory-compatibility-panel" || targetId === "build-connectivity-panel" ? FiTool : targetId === "assembly-verification-panel" ? FiActivity : FiSearch;
}

export function AssemblyPlanPanel({ build, result, checklistProgress, purchaseProgress, assemblyVerification, onFocusSection, onFocusRepairPlans }: { build: BuildSelection; result: CompatibilityResult; checklistProgress?: PurchaseChecklistProgress; purchaseProgress?: PurchaseListExecutionProgress; assemblyVerification?: AssemblyVerificationSurfaceSummary; onFocusSection: (targetId: string) => void; onFocusRepairPlans: () => void }) {
  const plan = useMemo(() => assemblyPlanFor(build, result, { checklistProgress, purchaseProgress, assemblyVerification }), [assemblyVerification, build, checklistProgress, purchaseProgress, result]);
  const resumeStep = assemblyPlanNextStepFor(plan);
  function focusTarget(targetId: AssemblyPlanTargetId) {
    if (targetId === "repair-plan-panel") {
      onFocusRepairPlans();
      return;
    }
    onFocusSection(targetId);
  }

  const resumeLabel = !resumeStep ? "실행 순서 확인" : resumeStep.status === "blocked" ? "차단 해결로 이동" : resumeStep.status === "review" ? "확인 필요로 이동" : resumeStep.status === "pending" ? "선행 단계로 이동" : "실측 로그 열기";
  return <section className={`assembly-plan-panel ${plan.state}`} aria-label="구매·조립 실행 순서" data-testid="assembly-plan-panel">
    <div className="assembly-plan-heading"><div><h2>구매·조립 실행 순서</h2><p>{plan.summary}</p></div><div className="assembly-plan-heading-actions"><span className={`assembly-plan-state ${plan.state}`}>{plan.state === "blocked" ? <FiXCircle /> : plan.state === "review" ? <FiAlertTriangle /> : <FiCheckCircle />} {plan.state === "blocked" ? "구매 보류" : plan.state === "review" ? "확인 후 진행" : "순서대로 진행"}</span>{resumeStep && <button className="button button-small button-light assembly-plan-resume" type="button" data-testid="assembly-plan-resume" onClick={() => resumeStep.targetId && focusTarget(resumeStep.targetId)}><FiArrowRight /> {resumeLabel}</button>}</div></div>
    <ol className="assembly-plan-list">{plan.steps.map((step) => { const Icon = statusIcon(step.status); const TargetIcon = step.targetId ? targetIcon(step.targetId) : undefined; return <li className={`assembly-plan-step ${step.status}`} data-testid={`assembly-plan-step-${step.id}`} key={step.id}><div className="assembly-plan-step-number">{step.order}</div><div className="assembly-plan-step-body"><div className="assembly-plan-step-top"><strong>{step.title}</strong><span><Icon className={step.status === "pending" ? "spin" : undefined} /> {statusLabel(step.status)}</span></div><p>{step.summary}</p><small>{step.detail}</small>{step.progress && <span className="assembly-plan-step-progress">{step.progress.label} · {step.progress.percent}%</span>}{step.dependsOn.length > 0 && <em>선행 단계: {step.dependsOn.map((id) => plan.steps.find((candidate) => candidate.id === id)?.order).filter((order): order is number => order !== undefined).map((order) => `${order}단계`).join(" · ")}</em>}</div>{step.targetId && <button className="text-button assembly-plan-target" type="button" onClick={() => focusTarget(step.targetId!)}>{TargetIcon && <TargetIcon />} {targetLabel(step.targetId)}</button>}</li>; })}</ol>
    <p className="assembly-plan-note"><FiInfo /> `진행 가능`은 현재 카탈로그·호환성 기준의 상태입니다. 실제 조립 후 POST·BIOS·온도·소음 테스트는 반드시 마지막 단계에서 직접 확인해야 하며, `앞 단계 대기`는 구매·조립 순서를 자동으로 건너뛰지 않도록 표시합니다.</p>
  </section>;
}
