import type { PurchaseChecklistProgress } from "./purchase-checklist";
import type { PurchaseReadiness } from "./purchase-readiness";
import type { AssemblyVerificationSurfaceSummary } from "./assembly-verification";
import type { PurchaseListExecutionProgress } from "./purchase-list-progress";

export type PurchaseDecisionState = "blocked" | "review" | "pending" | "ready";

export type PurchaseDecision = {
  state: PurchaseDecisionState;
  label: string;
  summary: string;
  checklistProgress?: PurchaseChecklistProgress;
  purchaseProgress?: PurchaseListExecutionProgress;
  assemblyVerification?: AssemblyVerificationSurfaceSummary;
};

export function purchaseDecisionFor(readiness: PurchaseReadiness, checklistProgress?: PurchaseChecklistProgress, assemblyVerification?: AssemblyVerificationSurfaceSummary, purchaseProgress?: PurchaseListExecutionProgress): PurchaseDecision {
  const evidence = { ...(checklistProgress ? { checklistProgress } : {}), ...(purchaseProgress ? { purchaseProgress } : {}), ...(assemblyVerification ? { assemblyVerification } : {}) };
  if (readiness.state === "blocked") return { state: "blocked", label: "구매 보류", summary: readiness.summary, ...evidence };
  if (assemblyVerification?.state === "failed") return { state: "review", label: "조립 기록 확인 필요", summary: "조립 기록에 실패한 항목이 있어요. 원인을 해결한 뒤 다시 확인해 주세요.", ...evidence };
  if (assemblyVerification && assemblyVerification.recheckSignalCount > 0) return { state: "review", label: "조립 상태 다시 확인", summary: `같은 조건에서 다시 살펴볼 항목이 ${assemblyVerification.recheckSignalCount}개 있어요. 원인을 확인한 뒤 다시 측정해 주세요.`, ...evidence };
  if (assemblyVerification?.state === "in_progress") return { state: "review", label: "조립 후 확인 중", summary: "조립 후 기록을 작성하고 있어요. 측정 결과를 확인해 주세요.", ...evidence };
  if (readiness.state === "review") return { state: "review", label: "확인 후 구매", summary: readiness.summary, ...evidence };
  if (!checklistProgress) return { state: "pending", label: "확인 목록 불러오는 중", summary: "호환 결과는 문제없어요. 구매 전 확인 목록을 불러오고 있습니다.", ...evidence };
  if (checklistProgress.remaining > 0) return { state: "review", label: "구매 전 확인 필요", summary: `구매 전에 확인할 항목 ${checklistProgress.remaining}개를 살펴봐 주세요.`, ...evidence };
  return { state: "ready", label: "구매 전 확인 완료", summary: "호환 결과와 가격을 확인했고, 구매 전 확인 목록도 모두 살펴봤어요.", ...evidence };
}
