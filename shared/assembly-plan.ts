import { gpuPurchaseEvidenceFor } from "./gpu-fit";
import { purchaseReadinessFor } from "./purchase-readiness";
import { buildResourceSummaryFor } from "./build-resource-summary";
import type { BuildSelection, CompatibilityResult } from "./types";
import type { PurchaseChecklistProgress } from "./purchase-checklist";
import type { PurchaseListExecutionProgress } from "./purchase-list-progress";
import type { AssemblyVerificationSurfaceSummary } from "./assembly-verification";

export type AssemblyPlanStepStatus = "blocked" | "review" | "ready" | "pending";
export type AssemblyPlanTargetId = "gpu-fit-summary-panel" | "build-resource-summary" | "data-health-panel" | "purchase-list-panel" | "purchase-checklist" | "repair-plan-panel" | "build-connectivity-panel" | "accessory-compatibility-panel" | "assembly-verification-panel";

export type AssemblyPlanStep = {
  id: "resolve-conflicts" | "confirm-evidence" | "confirm-purchase" | "bench-assemble" | "wire-peripherals" | "post-build-test";
  order: number;
  title: string;
  status: AssemblyPlanStepStatus;
  summary: string;
  detail: string;
  dependsOn: string[];
  targetId?: AssemblyPlanTargetId;
  progress?: { label: string; percent: number };
};

export type AssemblyPlanExecutionContext = {
  checklistProgress?: PurchaseChecklistProgress;
  purchaseProgress?: PurchaseListExecutionProgress;
  assemblyVerification?: AssemblyVerificationSurfaceSummary;
};

export type AssemblyPlan = {
  state: "blocked" | "review" | "ready";
  summary: string;
  steps: AssemblyPlanStep[];
};

export function assemblyPlanNextStepFor(plan: AssemblyPlan) {
  return plan.steps.find((step) => step.status !== "ready") ?? plan.steps.at(-1);
}

function hasBlocked(status: AssemblyPlanStepStatus) {
  return status === "blocked";
}

function hasReview(status: AssemblyPlanStepStatus) {
  return status === "review";
}

function resultReviewCount(result: CompatibilityResult) {
  const accessory = result.accessoryCompatibility;
  return result.warningCount + result.unknownCount + (accessory?.warningCount ?? 0) + (accessory?.unknownCount ?? 0);
}

function readinessItemState(result: CompatibilityResult, id: string) {
  return purchaseReadinessFor(result).items.find((item) => item.id === id)?.state;
}

function targetForEvidence(result: CompatibilityResult): AssemblyPlanTargetId {
  if (result.blockerCount > 0 || (result.accessoryCompatibility?.blockerCount ?? 0) > 0) return "repair-plan-panel";
  const physicalState = readinessItemState(result, "physical");
  if (physicalState === "blocked" || physicalState === "review") {
    if (result.gpuFit) return "gpu-fit-summary-panel";
    const resourceState = buildResourceSummaryFor(result.metrics).state;
    if (resourceState === "danger" || resourceState === "warning" || resourceState === "unknown") return "build-resource-summary";
    return "purchase-checklist";
  }
  const dataState = readinessItemState(result, "data");
  if (dataState === "blocked" || dataState === "review") return "data-health-panel";
  return "purchase-list-panel";
}

function evidenceDetailFor(result: CompatibilityResult) {
  const readiness = purchaseReadinessFor(result);
  const labels = readiness.items
    .filter((item) => item.state === "blocked" || item.state === "review")
    .map((item) => item.label);
  const health = result.dataHealth;
  const details = [
    labels.length > 0 ? `추가 확인: ${labels.join("·")}` : undefined,
    health && health.incompleteCount > 0 ? `부분 정보 ${health.incompleteCount}개` : undefined,
    health && health.unpricedCount > 0 ? `가격 미확인 ${health.unpricedCount}개` : undefined,
    result.gpuFit && gpuPurchaseEvidenceFor(result.gpuFit).status === "needs_review" ? "GPU·케이스 장착 정보" : undefined
  ].filter(Boolean);
  return details.length > 0 ? details.join(" · ") : "선택한 부품의 가격과 장착 정보를 확인했습니다.";
}

export function assemblyPlanFor(build: BuildSelection, result: CompatibilityResult, execution: AssemblyPlanExecutionContext = {}): AssemblyPlan {
  const accessory = result.accessoryCompatibility;
  const blockerCount = result.blockerCount + (accessory?.blockerCount ?? 0);
  const reviewCount = resultReviewCount(result);
  const resolutionStatus: AssemblyPlanStepStatus = blockerCount > 0 ? "blocked" : reviewCount > 0 ? "review" : "ready";

  const readiness = purchaseReadinessFor(result);
  const physicalState = readiness.items.find((item) => item.id === "physical")?.state;
  const dataState = readiness.items.find((item) => item.id === "data")?.state;
  const priceState = readiness.items.find((item) => item.id === "price")?.state;
  const budgetState = readiness.items.find((item) => item.id === "budget")?.state;
  const evidenceBlocked = physicalState === "blocked";
  const evidenceReview = evidenceBlocked || physicalState === "review" || dataState === "review" || priceState === "review" || budgetState === "review" || !result.priceComplete;
  const evidenceStatusBeforeDependency: AssemblyPlanStepStatus = evidenceBlocked ? "blocked" : evidenceReview ? "review" : "ready";
  const evidenceStatus: AssemblyPlanStepStatus = resolutionStatus === "blocked" ? "pending" : evidenceStatusBeforeDependency;

  const purchaseStatus: AssemblyPlanStepStatus = blockerCount > 0 || evidenceBlocked
    ? "blocked"
    : resolutionStatus === "review" || evidenceStatus === "review"
      ? "review"
      : "ready";
  const benchStatus: AssemblyPlanStepStatus = purchaseStatus === "ready" ? "ready" : "pending";
  const accessoryReview = Boolean(accessory && (accessory.warningCount > 0 || accessory.unknownCount > 0));
  const accessoryBlocked = Boolean(accessory && accessory.blockerCount > 0);
  const wiringStatus: AssemblyPlanStepStatus = benchStatus !== "ready"
    ? "pending"
    : accessoryBlocked
      ? "blocked"
      : accessoryReview
        ? "review"
        : "ready";
  const postBuildStatus: AssemblyPlanStepStatus = wiringStatus === "ready" ? "ready" : "pending";

  const steps: AssemblyPlanStep[] = [
    {
      id: "resolve-conflicts",
      order: 1,
      title: "호환 문제 해결",
      status: resolutionStatus,
      summary: blockerCount > 0 ? `호환 문제 ${blockerCount}개를 먼저 해결하세요.` : reviewCount > 0 ? `구매 전 확인 항목 ${reviewCount}개를 살펴보세요.` : "선택한 부품에서 호환 문제를 찾지 못했습니다.",
      detail: blockerCount > 0 ? "부품을 바꾼 뒤 현재 구성으로 호환 결과를 다시 확인해 주세요." : reviewCount > 0 ? "확인하지 못한 사양과 조건을 살펴본 뒤 구매해 주세요." : "부품 사양과 연결 조건을 살펴봐 주세요.",
      dependsOn: [],
      targetId: blockerCount > 0 ? "repair-plan-panel" : "purchase-checklist"
    },
    {
      id: "confirm-evidence",
      order: 2,
      title: "부품 정보·장착·가격 확인",
      status: evidenceStatus,
      summary: evidenceStatus === "blocked" ? "장착이나 전력 문제를 먼저 해결하세요." : evidenceStatus === "review" ? "부품 사양과 장착 공간, 가격을 확인하세요." : "구매에 필요한 부품 정보가 확인되었습니다.",
      detail: evidenceDetailFor(result),
      dependsOn: ["resolve-conflicts"],
      targetId: targetForEvidence(result)
    },
    {
      id: "confirm-purchase",
      order: 3,
      title: "구매 목록과 예산 정리",
      status: purchaseStatus,
      summary: purchaseStatus === "blocked" ? "호환이나 장착 문제가 남아 있습니다. 해결한 뒤 구매하세요." : purchaseStatus === "review" ? "가격과 부품 정보를 확인한 뒤 구매하세요." : "현재 부품 정보 기준으로 구매할 수 있습니다.",
      detail: result.priceComplete ? "부품 수량·가격·판매 조건을 확인해 주세요." : "가격을 모르는 부품은 결제 전에 판매 페이지에서 확인해 주세요.",
      dependsOn: ["resolve-conflicts", "confirm-evidence"],
      targetId: "purchase-list-panel"
    },
    {
      id: "bench-assemble",
      order: 4,
      title: "메인보드 사전 조립",
      status: benchStatus,
      summary: benchStatus === "ready" ? "케이스에 넣기 전에 CPU·RAM·M.2를 먼저 조립하세요." : "부품 구매 후 진행하세요.",
      detail: "CPU 장착, 쿨러 백플레이트, 메모리 킷, M.2 슬롯 위치·방열판 간섭을 케이스 밖에서 확인하세요.",
      dependsOn: ["confirm-purchase"],
      targetId: "purchase-checklist"
    },
    {
      id: "wire-peripherals",
      order: 5,
      title: "케이스 장착·케이블·주변부품 연결",
      status: wiringStatus,
      summary: wiringStatus === "blocked" ? "주변 부품 연결 문제를 먼저 해결하세요." : wiringStatus === "review" ? "팬·RGB·전원 케이블 규격을 확인한 뒤 연결하세요." : "케이스 장착과 주변 부품 연결을 진행할 수 있습니다.",
      detail: build.accessories && build.accessories.length > 0 ? "팬 허브 포트·허용전류, RGB 전압·출력, PSU 보조전원 케이블 경로를 연결 계획과 실물 케이블에 대조하세요." : "메인보드·PSU·GPU 케이블을 연결하고 케이스 팬·헤더 위치를 실물과 비교해 주세요.",
      dependsOn: ["bench-assemble"],
      targetId: accessory ? "accessory-compatibility-panel" : "build-connectivity-panel"
    },
    {
      id: "post-build-test",
      order: 6,
      title: "POST·BIOS·온도·소음 테스트",
      status: postBuildStatus,
      summary: postBuildStatus === "ready" ? "첫 부팅과 작동 상태를 확인하세요." : "앞선 조립을 마친 뒤 진행하세요.",
      detail: "POST 성공, BIOS에서 메모리 프로파일·팬 제어를 확인하고, OS 진입 후 온도·팬 회전·소음·부하 테스트를 기록하세요.",
      dependsOn: ["wire-peripherals"],
      targetId: "assembly-verification-panel"
    }
  ];

  const purchase = execution.purchaseProgress;
  const checklist = execution.checklistProgress;
  const assembly = execution.assemblyVerification;
  const purchasedCount = purchase ? purchase.stageCounts.received + purchase.stageCounts.installed : 0;
  const purchaseComplete = !purchase || purchase.total === 0 || purchasedCount >= purchase.total;
  const checklistComplete = !checklist || checklist.total === 0 || checklist.remaining === 0;
  let executionSteps = steps.map((step) => {
    if (step.id === "confirm-evidence" && checklist && checklist.total > 0 && !checklistComplete) {
      return { ...step, status: step.status === "blocked" ? step.status : "review" as const, summary: "구매 전 확인할 내용이 남았습니다.", progress: { label: `확인 완료 ${checklist.checked}/${checklist.total}개`, percent: checklist.percent } };
    }
    if (step.id === "confirm-purchase" && purchase && purchase.total > 0) {
      return { ...step, status: step.status === "blocked" ? step.status : purchaseComplete ? step.status : "review" as const, summary: purchaseComplete ? step.summary : `구매 목록 ${purchase.total - purchasedCount}개가 아직 수령 전입니다.`, progress: { label: `수령·조립 ${purchasedCount}/${purchase.total}개`, percent: purchase.percent } };
    }
    if (step.id === "confirm-purchase" && checklist && checklist.total > 0 && !checklistComplete && step.status === "ready") {
      return { ...step, status: "review" as const, summary: `구매 전에 확인할 항목 ${checklist.remaining}개를 살펴봐 주세요.`, progress: { label: `체크리스트 ${checklist.checked}/${checklist.total}개`, percent: checklist.percent } };
    }
    if (["bench-assemble", "wire-peripherals", "post-build-test"].includes(step.id) && ((purchase && !purchaseComplete) || (checklist && !checklistComplete)) && step.status === "ready") {
      return { ...step, status: "pending" as const, summary: purchase && !purchaseComplete ? "구매한 부품을 모두 받은 뒤 조립해 주세요." : "구매 전에 확인할 목록을 모두 살펴본 뒤 조립해 주세요." };
    }
    if (step.id === "post-build-test" && ((purchase && !purchaseComplete) || (checklist && !checklistComplete))) return step;
    if (step.id === "post-build-test" && assembly && assembly.state !== "not_started") {
      const measurementReview = assembly.state === "failed" || assembly.state === "in_progress" || assembly.recheckSignalCount > 0;
      return { ...step, status: measurementReview ? "review" as const : step.status, summary: assembly.state === "failed" ? "조립 기록에서 실패한 항목의 원인을 살펴본 뒤 다시 확인해 주세요." : assembly.state === "in_progress" ? "조립 후 확인 기록을 마무리해 주세요." : assembly.recheckSignalCount > 0 ? `조립 기록에서 다시 볼 항목 ${assembly.recheckSignalCount}개를 살펴봐 주세요.` : "조립 후 확인 기록을 마쳤어요.", progress: { label: `조립 확인 ${assembly.checked}/${assembly.total}개`, percent: assembly.percent } };
    }
    return step;
  });
  const state = executionSteps.some((step) => hasBlocked(step.status)) ? "blocked" : executionSteps.some((step) => hasReview(step.status)) ? "review" : "ready";
  return {
    state,
    summary: state === "blocked" ? "호환 문제를 해결한 뒤 구매와 조립을 진행해 주세요." : !purchaseComplete ? `구매 항목 ${purchase!.total - purchasedCount}개를 받은 뒤 조립해 주세요.` : !checklistComplete ? `구매 전에 확인할 항목 ${checklist!.remaining}개를 살펴봐 주세요.` : assembly?.state === "failed" || (assembly?.recheckSignalCount ?? 0) > 0 ? "조립 기록을 다시 확인한 뒤 구매와 조립을 마무리해 주세요." : state === "review" ? "구매 전에 상품 페이지와 가격, 연결 정보를 확인해 주세요." : "호환 문제는 없어요. 제조사 안내와 실제 연결 상태를 확인한 뒤 구매·조립해 주세요.",
    steps: executionSteps
  };
}
