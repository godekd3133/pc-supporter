import { gpuPurchaseEvidenceFor } from "./gpu-fit";
import { purchaseReadinessFor } from "./purchase-readiness";
import type { BuildSelection, CompatibilityResult } from "./types";

export type AssemblyPlanStepStatus = "blocked" | "review" | "ready" | "pending";
export type AssemblyPlanTargetId = "gpu-fit-summary-panel" | "data-health-panel" | "purchase-list-panel" | "purchase-checklist" | "repair-plan-panel" | "build-connectivity-panel" | "accessory-compatibility-panel" | "assembly-verification-panel";

export type AssemblyPlanStep = {
  id: "resolve-conflicts" | "confirm-evidence" | "confirm-purchase" | "bench-assemble" | "wire-peripherals" | "post-build-test";
  order: number;
  title: string;
  status: AssemblyPlanStepStatus;
  summary: string;
  detail: string;
  dependsOn: string[];
  targetId?: AssemblyPlanTargetId;
};

export type AssemblyPlan = {
  state: "blocked" | "review" | "ready";
  summary: string;
  steps: AssemblyPlanStep[];
};

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
    return result.gpuFit ? "gpu-fit-summary-panel" : "purchase-checklist";
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
    labels.length > 0 ? `${labels.join("·")} 상태를 확인해야 합니다.` : undefined,
    health && health.incompleteCount > 0 ? `부분 정보 ${health.incompleteCount}개` : undefined,
    health && health.unpricedCount > 0 ? `가격 미확인 ${health.unpricedCount}개` : undefined,
    result.gpuFit && gpuPurchaseEvidenceFor(result.gpuFit).status === "needs_review" ? "GPU·케이스 물리 근거" : undefined
  ].filter(Boolean);
  return details.length > 0 ? details.join(" · ") : "선택 부품의 스펙·가격·장착 근거가 구매 기준을 충족합니다.";
}

export function assemblyPlanFor(build: BuildSelection, result: CompatibilityResult): AssemblyPlan {
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
      title: "해결해야 할 충돌 제거",
      status: resolutionStatus,
      summary: blockerCount > 0 ? `차단 오류 ${blockerCount}개를 먼저 해결합니다.` : reviewCount > 0 ? `주의·확인 필요 ${reviewCount}개를 구매 전에 확인합니다.` : "현재 규칙 기준의 충돌이 없습니다.",
      detail: blockerCount > 0 ? "대체 부품 또는 수리 플랜을 적용한 뒤 같은 구성으로 다시 검사해야 합니다." : reviewCount > 0 ? "호환성 판정은 진행할 수 있지만 확인되지 않은 조건을 해소하기 전에는 구매를 확정하지 않습니다." : "다음 단계의 근거 확인으로 이동할 수 있습니다.",
      dependsOn: [],
      targetId: blockerCount > 0 ? "repair-plan-panel" : "purchase-checklist"
    },
    {
      id: "confirm-evidence",
      order: 2,
      title: "원문·물리·가격 근거 확정",
      status: evidenceStatus,
      summary: evidenceStatus === "blocked" ? "물리·전력 조건의 차단 항목을 먼저 해결합니다." : evidenceStatus === "review" ? "스펙·장착·가격 근거를 추가로 확인합니다." : "구매에 필요한 데이터 근거가 확인됐습니다.",
      detail: evidenceDetailFor(result),
      dependsOn: ["resolve-conflicts"],
      targetId: targetForEvidence(result)
    },
    {
      id: "confirm-purchase",
      order: 3,
      title: "구매 목록과 예산 확정",
      status: purchaseStatus,
      summary: purchaseStatus === "blocked" ? "충돌·물리 차단을 해결하기 전에는 구매하지 않습니다." : purchaseStatus === "review" ? "가격·데이터·확인 필요 항목을 검토한 뒤 구매합니다." : "현재 구매 목록과 검사 상태를 기준으로 구매할 수 있습니다.",
      detail: result.priceComplete ? "핵심 부품과 주변 부품의 수량·가격·유통 조건을 확인하세요." : "가격이 확인되지 않은 항목이 있어 실제 결제 전 판매 페이지를 다시 확인하세요.",
      dependsOn: ["resolve-conflicts", "confirm-evidence"],
      targetId: "purchase-list-panel"
    },
    {
      id: "bench-assemble",
      order: 4,
      title: "메인보드 사전 조립",
      status: benchStatus,
      summary: benchStatus === "ready" ? "케이스에 넣기 전에 CPU·RAM·M.2를 먼저 조립합니다." : "구매 단계가 확인되면 진행합니다.",
      detail: "CPU 장착, 쿨러 백플레이트, 메모리 킷, M.2 슬롯 위치·방열판 간섭을 케이스 밖에서 확인하세요.",
      dependsOn: ["confirm-purchase"],
      targetId: "purchase-checklist"
    },
    {
      id: "wire-peripherals",
      order: 5,
      title: "케이스 장착·케이블·주변부품 연결",
      status: wiringStatus,
      summary: wiringStatus === "blocked" ? "주변 부품 연결 차단을 먼저 수정합니다." : wiringStatus === "review" ? "팬·RGB·전원 케이블 경로를 확인한 뒤 연결합니다." : "케이스 장착과 주변부품 연결을 진행할 수 있습니다.",
      detail: build.accessories && build.accessories.length > 0 ? "팬 허브 포트·허용전류, RGB 전압·출력, PSU 보조전원 케이블 경로를 연결 계획과 실물 케이블에 대조하세요." : "메인보드·PSU·GPU 케이블을 연결하고 케이스 팬·헤더 위치를 실물과 대조하세요.",
      dependsOn: ["bench-assemble"],
      targetId: accessory ? "accessory-compatibility-panel" : "build-connectivity-panel"
    },
    {
      id: "post-build-test",
      order: 6,
      title: "POST·BIOS·온도·소음 테스트",
      status: postBuildStatus,
      summary: postBuildStatus === "ready" ? "첫 부팅과 안정성 확인을 진행합니다." : "앞 단계 확인이 끝나면 진행합니다.",
      detail: "POST 성공, BIOS에서 메모리 프로파일·팬 제어를 확인하고, OS 진입 후 온도·팬 회전·소음·부하 테스트를 기록하세요.",
      dependsOn: ["wire-peripherals"],
      targetId: "assembly-verification-panel"
    }
  ];

  const state = steps.some((step) => hasBlocked(step.status)) ? "blocked" : steps.some((step) => hasReview(step.status)) ? "review" : "ready";
  return {
    state,
    summary: state === "blocked" ? "차단 항목을 해결한 뒤 다음 구매·조립 단계로 이동하세요." : state === "review" ? "구매는 가능하지만 원문·가격·연결 근거를 확인한 뒤 조립하세요." : "검사·근거 기준을 통과했습니다. 아래 순서대로 구매와 조립을 진행하세요.",
    steps
  };
}
