import { gpuPurchaseEvidenceFor } from "./gpu-fit";
import { buildResourceSummaryFor } from "./build-resource-summary";
import type { CompatibilityResult } from "./types";

export type PurchaseReadinessState = "ready" | "review" | "blocked";
export type PurchaseReadinessItemState = "pass" | "review" | "blocked" | "neutral";

export type PurchaseReadinessItem = {
  id: string;
  label: string;
  state: PurchaseReadinessItemState;
  summary: string;
};

export type PurchaseReadiness = {
  state: PurchaseReadinessState;
  label: string;
  summary: string;
  items: PurchaseReadinessItem[];
};

export function readinessStateLabel(state: PurchaseReadinessItemState) {
  return state === "pass" ? "통과" : state === "review" ? "확인 필요" : state === "neutral" ? "미설정" : "구매 보류";
}

export function purchaseReadinessFor(result: CompatibilityResult): PurchaseReadiness {
  const compatibilityState: PurchaseReadinessItemState = result.blockerCount > 0 ? "blocked" : result.warningCount > 0 || result.unknownCount > 0 ? "review" : "pass";
  const accessoryCompatibility = result.accessoryCompatibility;
  const accessoryState: PurchaseReadinessItemState = !accessoryCompatibility ? "neutral" : accessoryCompatibility.blockerCount > 0 ? "blocked" : accessoryCompatibility.warningCount > 0 || accessoryCompatibility.unknownCount > 0 ? "review" : "pass";
  const priceState: PurchaseReadinessItemState = result.priceComplete ? "pass" : "review";
  const health = result.dataHealth;
  const healthState: PurchaseReadinessItemState = !health || health.overall !== "verified" || health.unpricedCount > 0 ? "review" : "pass";
  const budgetWon = result.recommendationPreferences?.budgetWon;
  const budgetState: PurchaseReadinessItemState = budgetWon === undefined ? "neutral" : !result.priceComplete ? "review" : result.totalPriceWon > budgetWon ? "review" : "pass";
  const physicalRuleIds = new Set(["gpu-case-length", "gpu-thickness", "gpu-cable-clearance", "gpu-psu-power", "gpu-psu-connector", "gpu-psu-cable-topology", "case-cooler-height", "case-radiator-support", "psu-case-length", "psu-case-form-factor", "m2-lane-sharing", "m2-pcie-lane-sharing", "case-fan-headers", "case-rgb-headers", "case-rgb-voltage"]);
  const physicalFindings = result.findings.filter((finding) => physicalRuleIds.has(finding.ruleId));
  const gpuPurchaseEvidence = result.gpuFit ? gpuPurchaseEvidenceFor(result.gpuFit) : undefined;
  const resourceSummary = buildResourceSummaryFor(result.metrics);
  const resourceBlocked = resourceSummary.state === "danger";
  const resourceNeedsReview = resourceSummary.state === "warning" || resourceSummary.state === "unknown";
  const physicalState: PurchaseReadinessItemState = physicalFindings.some((finding) => finding.severity === "blocker") || gpuPurchaseEvidence?.status === "incompatible" || resourceBlocked
    ? "blocked"
    : physicalFindings.some((finding) => finding.severity === "warning" || finding.severity === "unknown") || gpuPurchaseEvidence?.status === "needs_review" || resourceNeedsReview
      ? "review"
      : "pass";
  const items: PurchaseReadinessItem[] = [
    { id: "compatibility", label: "호환성", state: compatibilityState, summary: compatibilityState === "blocked" ? `호환 문제 ${result.blockerCount}개를 해결하세요.` : compatibilityState === "review" ? `주의 ${result.warningCount}개 · 정보 확인 ${result.unknownCount}개가 필요합니다.` : "차단·주의·추가 확인 항목이 없습니다." },
    ...(accessoryCompatibility ? [{ id: "accessory-compatibility", label: "주변 부품", state: accessoryState, summary: accessoryState === "blocked" ? `주변 부품 문제 ${accessoryCompatibility.blockerCount}개를 해결하세요.` : accessoryState === "review" ? `주의 ${accessoryCompatibility.warningCount}개 · 확인할 항목 ${accessoryCompatibility.unknownCount}개가 있습니다.` : "확인한 주변 부품 규격에 문제없습니다." }] : []),
    { id: "price", label: "가격", state: priceState, summary: priceState === "pass" ? "선택한 부품의 가격을 모두 확인했습니다." : "가격을 확인하지 못한 부품이 있어 전체 금액을 계산할 수 없습니다." },
    { id: "data", label: "부품 정보", state: healthState, summary: healthState === "pass" ? "선택한 부품의 주요 정보와 가격을 확인했습니다." : health ? `정보 부족 ${health.incompleteCount}개 · 갱신 필요 ${health.agingCount + health.staleCount + health.unknownFreshnessCount}개 · 가격 미확인 ${health.unpricedCount}개` : "선택한 부품 정보를 불러오지 못했습니다." },
    { id: "physical", label: "장착·전력·냉각", state: physicalState, summary: physicalState === "blocked" ? resourceBlocked ? "계산된 전력·냉각 여유가 부족합니다. 관련 부품을 확인하세요." : "케이스 공간, 파워 용량, 커넥터 문제를 해결하세요." : physicalState === "review" ? resourceNeedsReview ? "케이스 공간과 파워·쿨러 정보를 확인하세요." : "부품이 들어가는지, 전원 단자가 맞는지 확인하세요." : "검사에서 장착·전력·냉각 문제를 찾지 못했습니다." },
    { id: "budget", label: "목표 예산", state: budgetState, summary: budgetWon === undefined ? "목표 예산을 입력하면 예산에 맞는지 확인할 수 있습니다." : !result.priceComplete ? "가격을 확인한 뒤 예산에 맞는지 계산합니다." : result.totalPriceWon > budgetWon ? `전체 금액이 목표보다 ${(result.totalPriceWon - budgetWon).toLocaleString("ko-KR")}원 많습니다.` : `목표 예산보다 ${(budgetWon - result.totalPriceWon).toLocaleString("ko-KR")}원 남았습니다.` }
  ];
  const state: PurchaseReadinessState = items.some((item) => item.state === "blocked") ? "blocked" : items.some((item) => item.state === "review") ? "review" : "ready";
  const accessoryBlocked = accessoryCompatibility?.blockerCount ? accessoryCompatibility.blockerCount > 0 : false;
  const accessoryNeedsReview = accessoryCompatibility ? accessoryCompatibility.warningCount > 0 || accessoryCompatibility.unknownCount > 0 : false;
  return {
    state,
    label: state === "blocked" ? "구매 보류" : state === "review" ? "확인 후 구매" : "구매 준비 완료",
    summary: state === "blocked" ? accessoryBlocked && result.blockerCount === 0 ? "주변 부품의 수량과 장착 규격을 고친 뒤 다시 검사하세요." : "위에 표시된 차단 항목을 해결한 뒤 다시 검사하세요." : state === "review" ? accessoryNeedsReview && result.warningCount === 0 && result.unknownCount === 0 ? "주변 부품의 수량과 장착 규격도 확인한 뒤 구매하세요." : "위에 표시된 확인 항목을 살펴본 뒤 구매하세요." : "현재 확인된 호환성·가격 정보로는 구매할 수 있습니다. 상품 페이지에서 실제 규격도 확인하세요.",
    items
  };
}
