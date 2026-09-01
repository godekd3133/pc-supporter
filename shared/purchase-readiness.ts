import { gpuPurchaseEvidenceFor } from "./gpu-fit";
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
  const physicalState: PurchaseReadinessItemState = physicalFindings.some((finding) => finding.severity === "blocker") || gpuPurchaseEvidence?.status === "incompatible"
    ? "blocked"
    : physicalFindings.some((finding) => finding.severity === "warning" || finding.severity === "unknown") || gpuPurchaseEvidence?.status === "needs_review"
      ? "review"
      : "pass";
  const items: PurchaseReadinessItem[] = [
    { id: "compatibility", label: "호환성", state: compatibilityState, summary: compatibilityState === "blocked" ? `차단 오류 ${result.blockerCount}개를 먼저 해결해야 합니다.` : compatibilityState === "review" ? `주의 ${result.warningCount}개 · 확인 필요 ${result.unknownCount}개를 구매 전에 확인하세요.` : "현재 규칙 기준의 차단 오류·주의·확인 필요가 없습니다." },
    ...(accessoryCompatibility ? [{ id: "accessory-compatibility", label: "주변 부품", state: accessoryState, summary: accessoryState === "blocked" ? `주변 부품 차단 ${accessoryCompatibility.blockerCount}개를 먼저 수정해야 합니다.` : accessoryState === "review" ? `주변 부품 주의 ${accessoryCompatibility.warningCount}개 · 확인 필요 ${accessoryCompatibility.unknownCount}개를 구매 전에 확인하세요.` : "선택한 주변 부품의 확인 가능한 규격을 통과했습니다." }] : []),
    { id: "price", label: "가격", state: priceState, summary: priceState === "pass" ? "선택한 핵심·주변 부품의 가격이 모두 확인됐습니다." : "가격 미확인 항목이 있어 전체 구매 금액을 확정할 수 없습니다." },
    { id: "data", label: "데이터 신뢰도", state: healthState, summary: healthState === "pass" ? "선택 부품의 스펙·갱신 시점·가격 상태가 구매 기준을 충족합니다." : health ? `부분 정보 ${health.incompleteCount}개 · 재확인 ${health.agingCount + health.staleCount + health.unknownFreshnessCount}개 · 가격 미확인 ${health.unpricedCount}개` : "선택 부품의 데이터 상태를 확인해야 합니다." },
    { id: "physical", label: "장착·전력", state: physicalState, summary: physicalState === "blocked" ? "케이스·전력·커넥터 관련 차단 오류를 먼저 해결해야 합니다." : physicalState === "review" ? "장착 공간·전력·커넥터 또는 물리 검수 근거를 구매 전에 확인해야 합니다." : "확인된 장착·전력 기준을 통과했고 추가 물리 근거가 필요한 항목이 없습니다." },
    { id: "budget", label: "목표 예산", state: budgetState, summary: budgetWon === undefined ? "목표 예산이 설정되지 않았습니다." : !result.priceComplete ? "가격 확인 후 목표 예산 적합 여부를 계산합니다." : result.totalPriceWon > budgetWon ? `현재 전체 합계가 목표보다 ${(result.totalPriceWon - budgetWon).toLocaleString("ko-KR")}원 초과합니다.` : `목표 예산보다 ${(budgetWon - result.totalPriceWon).toLocaleString("ko-KR")}원 여유가 있습니다.` }
  ];
  const state: PurchaseReadinessState = items.some((item) => item.state === "blocked") ? "blocked" : items.some((item) => item.state === "review") ? "review" : "ready";
  const accessoryBlocked = accessoryCompatibility?.blockerCount ? accessoryCompatibility.blockerCount > 0 : false;
  const accessoryNeedsReview = accessoryCompatibility ? accessoryCompatibility.warningCount > 0 || accessoryCompatibility.unknownCount > 0 : false;
  return {
    state,
    label: state === "blocked" ? "구매 보류" : state === "review" ? "확인 후 구매" : "구매 준비 완료",
    summary: state === "blocked" ? accessoryBlocked && result.blockerCount === 0 ? "주변 부품의 장착 규격을 해결한 뒤 다시 검사해야 합니다." : "차단 오류와 장착·전력 문제를 해결한 뒤 다시 검사해야 합니다." : state === "review" ? accessoryNeedsReview && result.warningCount === 0 && result.unknownCount === 0 ? "핵심 부품은 진행할 수 있지만 주변 부품의 규격·수량을 확인한 뒤 구매하세요." : "호환성은 진행할 수 있지만 가격·데이터·장착 근거를 확인한 뒤 구매하세요." : "현재 검사·가격·데이터 기준에서 구매 전 확인할 차단 항목이 없습니다.",
    items
  };
}
