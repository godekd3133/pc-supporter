import type { PurchaseChecklistProgress } from "./purchase-checklist";
import type { PurchaseReadiness } from "./purchase-readiness";
import type { AssemblyVerificationSurfaceSummary } from "./assembly-verification";

export type PurchaseDecisionState = "blocked" | "review" | "pending" | "ready";

export type PurchaseDecision = {
  state: PurchaseDecisionState;
  label: string;
  summary: string;
  checklistProgress?: PurchaseChecklistProgress;
  assemblyVerification?: AssemblyVerificationSurfaceSummary;
};

export function purchaseDecisionFor(readiness: PurchaseReadiness, checklistProgress?: PurchaseChecklistProgress, assemblyVerification?: AssemblyVerificationSurfaceSummary): PurchaseDecision {
  const evidence = { ...(checklistProgress ? { checklistProgress } : {}), ...(assemblyVerification ? { assemblyVerification } : {}) };
  if (readiness.state === "blocked") return { state: "blocked", label: "구매 보류", summary: readiness.summary, ...evidence };
  if (assemblyVerification?.state === "failed") return { state: "review", label: "실측 확인 후 진행", summary: "실제 조립 검증에 실패 기록이 있어 원인을 확인한 뒤 진행하세요.", ...evidence };
  if (assemblyVerification && assemblyVerification.recheckSignalCount > 0) return { state: "review", label: "실측 재확인 필요", summary: `동일 조건 실측에서 재확인 신호 ${assemblyVerification.recheckSignalCount}개가 감지되었습니다. 원인을 확인한 뒤 진행하세요.`, ...evidence };
  if (assemblyVerification?.state === "in_progress") return { state: "review", label: "실측 기록 진행 중", summary: "실제 조립 검증이 진행 중이므로 측정 결과를 확인한 뒤 최종 결정을 내리세요.", ...evidence };
  if (readiness.state === "review") return { state: "review", label: "확인 후 구매", summary: readiness.summary, ...evidence };
  if (!checklistProgress) return { state: "pending", label: "체크리스트 확인 중", summary: "엔진 기준은 통과했지만 구매 전 실행 체크리스트를 불러오는 중이라 최종 결정을 아직 확정하지 않습니다.", ...evidence };
  if (checklistProgress.remaining > 0) return { state: "review", label: "체크리스트 확인 후 구매", summary: `구매 전 실행 체크리스트 ${checklistProgress.remaining}개를 확인한 뒤 구매하세요.`, ...evidence };
  return { state: "ready", label: "구매 준비 완료", summary: "호환성·가격·데이터 기준을 통과했고 구매 전 실행 체크리스트도 완료했습니다.", ...evidence };
}
