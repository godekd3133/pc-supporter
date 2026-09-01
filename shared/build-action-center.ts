import { gpuPurchaseEvidenceFor } from "./gpu-fit";
import { buildConnectivitySummaryFor } from "./build-connectivity";
import type { BuildSelection, CompatibilityResult, Finding, FindingSeverity, BuildDataHealthItem, Part } from "./types";

export type BuildActionPriority = "blocker" | "review" | "manual";
export type BuildActionSource = "compatibility" | "accessory" | "data" | "physical" | "price" | "assembly";

export interface BuildAction {
  id: string;
  priority: BuildActionPriority;
  source: BuildActionSource;
  title: string;
  summary: string;
  ruleId?: string;
  targetId?: "gpu-fit-summary-panel" | "data-health-panel" | "purchase-list-panel" | "purchase-checklist" | "repair-plan-panel" | "build-connectivity-panel";
}

export interface BuildActionCenter {
  state: "blocked" | "review" | "ready";
  summary: string;
  totalCount: number;
  hiddenCount: number;
  actions: BuildAction[];
}

const priorityRank: Record<BuildActionPriority, number> = { blocker: 0, review: 1, manual: 2 };

function priorityForFinding(severity: Exclude<FindingSeverity, "info">): BuildActionPriority {
  return severity === "blocker" ? "blocker" : "review";
}

function isActionableFinding(finding: Finding): finding is Finding & { severity: Exclude<FindingSeverity, "info"> } {
  return finding.severity !== "info";
}

function addAction(actions: BuildAction[], seen: Set<string>, action: BuildAction) {
  if (seen.has(action.id)) return;
  seen.add(action.id);
  actions.push(action);
}

function dataActionFor(item: BuildDataHealthItem): BuildAction[] {
  const actions: BuildAction[] = [];
  if (item.freshness === "stale" || item.freshness === "unknown") {
    actions.push({ id: `data-freshness:${item.id}`, priority: "review", source: "data", title: `${item.name} 데이터 다시 확인`, summary: item.freshness === "stale" ? "확인 시점이 오래되어 최신 원문을 다시 확인해야 합니다." : "확인 시점이 없어 최신 원문을 확인해야 합니다.", targetId: "data-health-panel" });
  }
  if (item.missingFields.length > 0) {
    actions.push({ id: `data-fields:${item.id}`, priority: "review", source: "data", title: `${item.name} 누락 스펙 보완`, summary: `확인되지 않은 스펙 ${item.missingFields.slice(0, 3).join(", ")}${item.missingFields.length > 3 ? ` 외 ${item.missingFields.length - 3}개` : ""}를 확인해야 합니다.`, targetId: "data-health-panel" });
  }
  if (!item.priceKnown) {
    actions.push({ id: `data-price:${item.id}`, priority: "review", source: "price", title: `${item.name} 가격 확인`, summary: "현재 가격을 확인할 수 없어 전체 구매 금액을 확정할 수 없습니다.", targetId: "purchase-list-panel" });
  }
  return actions;
}

function connectivityActionsFor(result: CompatibilityResult, build: BuildSelection | undefined, partMap: ReadonlyMap<string, Part> | undefined): BuildAction[] {
  if (!build || !partMap) return [];
  const summary = buildConnectivitySummaryFor(
    build.motherboard ? partMap.get(build.motherboard.partId)?.specs : undefined,
    build.case ? partMap.get(build.case.partId)?.specs : undefined
  );
  if (summary.status === "not_applicable") return [];
  const existingFindingRuleIds = new Set(result.findings.map((finding) => finding.ruleId));
  return summary.items
    .filter((item) => item.status !== "pass" && !existingFindingRuleIds.has(item.ruleId))
    .map((item) => ({
      id: `connectivity:${item.id}`,
      priority: "review" as const,
      source: "physical" as const,
      title: `${item.label} ${item.status === "review" ? "여유 부족 확인" : "원문 확인"}`,
      summary: `${item.detail} 케이스 기본 장치와 메인보드 헤더·전압을 대조한 보조 점검입니다.`,
      targetId: "build-connectivity-panel" as const
    }));
}

export function buildActionCenterFor(result: CompatibilityResult, build?: BuildSelection, partMap?: ReadonlyMap<string, Part>): BuildActionCenter {
  const actions: BuildAction[] = [];
  const seen = new Set<string>();
  const firstRepairPlan = result.repairPlans?.[0];
  if (firstRepairPlan && result.blockerCount > 0) {
    addAction(actions, seen, {
      id: "repair:best-plan",
      priority: "blocker",
      source: "compatibility",
      title: "최소 변경 수리 플랜 검토",
      summary: `${firstRepairPlan.resolvedBlockers}개 차단 오류를 줄이는 ${firstRepairPlan.label} 플랜입니다. 적용 전 전체 구성·가격·남는 문제를 확인하세요.`,
      targetId: "repair-plan-panel"
    });
  }
  result.findings
    .filter(isActionableFinding)
    .forEach((finding) => addAction(actions, seen, {
      id: `finding:${finding.ruleId}`,
      priority: priorityForFinding(finding.severity),
      source: "compatibility",
      title: finding.title,
      summary: finding.message,
      ruleId: finding.ruleId
    }));
  result.accessoryCompatibility?.findings
    .forEach((finding) => addAction(actions, seen, {
      id: `accessory:${finding.id}`,
      priority: finding.severity === "blocker" ? "blocker" : "review",
      source: "accessory",
      title: finding.title,
      summary: finding.message,
      targetId: "purchase-checklist"
    }));
  result.dataHealth?.items.flatMap(dataActionFor).forEach((action) => addAction(actions, seen, action));
  connectivityActionsFor(result, build, partMap).forEach((action) => addAction(actions, seen, action));

  if (result.gpuFit) {
    const evidence = gpuPurchaseEvidenceFor(result.gpuFit);
    if (evidence.physical === "incompatible" || evidence.physical === "needs_review") {
      addAction(actions, seen, { id: "physical:gpu-case", priority: evidence.physical === "incompatible" ? "blocker" : "review", source: "physical", title: evidence.physical === "incompatible" ? "GPU·케이스 물리 간섭 해결" : "GPU·케이스 물리 근거 확인", summary: evidence.physical === "incompatible" ? "케이블 요구 여유보다 케이스 측면 공간이 작아 실제 장착 조건을 바꿔야 합니다." : "GPU 슬롯·케이블 굽힘 여유와 케이스 측면 공간을 제조사 근거로 확인해야 합니다.", targetId: "gpu-fit-summary-panel" });
    }
    if (evidence.pcieCableTopology === "incompatible" || evidence.pcieCableTopology === "needs_review") {
      addAction(actions, seen, { id: "physical:psu-cable", priority: evidence.pcieCableTopology === "incompatible" ? "blocker" : "review", source: "physical", title: evidence.pcieCableTopology === "incompatible" ? "PSU PCIe 케이블 경로 변경" : "PSU PCIe 케이블 분배 확인", summary: evidence.pcieCableTopology === "incompatible" ? "현재 PSU의 확인된 케이블 구조로 GPU 연결 요구를 충족할 수 없습니다." : "커넥터 수와 별도로 독립 PCIe 케이블 런·분배 구조를 확인해야 합니다.", targetId: "gpu-fit-summary-panel" });
    }
  }
  if (!result.priceComplete) addAction(actions, seen, { id: "price:total", priority: "review", source: "price", title: "전체 구매 금액 확인", summary: "가격 미확인 부품이 있어 실제 구매 전에 상품 가격과 유통 조건을 다시 확인해야 합니다.", targetId: "purchase-list-panel" });

  actions.sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority]);
  const hasBlocker = result.blockerCount > 0 || result.accessoryCompatibility?.blockerCount !== undefined && result.accessoryCompatibility.blockerCount > 0;
  const hasReview = result.warningCount > 0 || result.unknownCount > 0 || result.accessoryCompatibility?.warningCount !== undefined && result.accessoryCompatibility.warningCount > 0 || result.accessoryCompatibility?.unknownCount !== undefined && result.accessoryCompatibility.unknownCount > 0 || actions.some((action) => action.priority === "review");
  if (actions.length === 0) {
    actions.push({ id: "assembly:final-check", priority: "manual", source: "assembly", title: "실제 조립 전 최종 확인", summary: "제조사 QVL·BIOS, 실제 케이스 여유, 첫 부팅 POST·온도·소음은 별도로 확인하세요.", targetId: "purchase-checklist" });
  }
  const state = hasBlocker ? "blocked" : hasReview ? "review" : "ready";
  const visibleCount = 6;
  return {
    state,
    summary: state === "blocked" ? `구매 전에 해결해야 할 우선 항목 ${actions.filter((action) => action.priority === "blocker").length}개가 있습니다.` : state === "review" ? `호환성은 진행할 수 있지만 구매·조립 전에 확인할 항목 ${actions.length}개가 있습니다.` : "현재 규칙과 데이터 기준의 차단 항목은 없습니다. 실제 조립 전 최종 확인만 남았습니다.",
    totalCount: actions.length,
    hiddenCount: Math.max(0, actions.length - visibleCount),
    actions
  };
}
