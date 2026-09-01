import type { BuildSelection, CompatibilityResult, Finding, FindingSeverity, Part } from "./types";
import { gpuPurchaseEvidenceFor } from "./gpu-fit";
import { buildConnectivitySummaryFor } from "./build-connectivity";

export type PurchaseChecklistItemKind = "finding" | "manual";
export type PurchaseChecklistItemSeverity = Exclude<FindingSeverity, "info"> | "manual";

export const PURCHASE_CHECKLIST_CHANGE_EVENT = "pc-supporter-purchase-checklist-change";
export const PURCHASE_CHECKLIST_ACTION_EVENT = "pc-supporter-purchase-checklist-action";

export type PurchaseChecklistItem = {
  id: string;
  kind: PurchaseChecklistItemKind;
  severity: PurchaseChecklistItemSeverity;
  title: string;
  detail: string;
  ruleId?: string;
  targetId?: "gpu-fit-summary-panel" | "accessory-compatibility-panel" | "data-health-panel" | "purchase-list-panel" | "repair-plan-panel" | "build-connectivity-panel";
  actionLabel?: string;
};

export type PurchaseChecklistProgress = {
  total: number;
  checked: number;
  remaining: number;
  percent: number;
};

export interface PurchaseChecklistTransferEnvelope {
  type: "pc-supporter-purchase-checklist";
  schemaVersion: 1;
  storageKey: string;
  exportedAt: string;
  itemIds: string[];
  checkedIds: string[];
}

export interface PurchaseChecklistTransferParseResult {
  checkedIds: string[];
  ignoredIds: string[];
  itemIds: string[];
  exportedAt?: string;
  errors: string[];
}

export interface PurchaseChecklistTransferDiff {
  currentCheckedCount: number;
  incomingCheckedCount: number;
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
}

type ActionableFinding = Finding & { severity: Exclude<FindingSeverity, "info"> };

function isActionableFinding(finding: Finding): finding is ActionableFinding {
  return finding.severity !== "info";
}

function findingTitleFor(severity: Exclude<FindingSeverity, "info">, title: string) {
  return severity === "blocker" ? `해결: ${title}` : severity === "warning" ? `확인: ${title}` : `원문 확인: ${title}`;
}

function findingDetailFor(severity: Exclude<FindingSeverity, "info">, message: string) {
  return severity === "blocker" ? `${message} 이 항목은 구매 전에 해결해야 합니다.` : severity === "warning" ? `${message} 구매·조립 전에 실제 조건을 확인하세요.` : `${message} 카탈로그만으로 확정할 수 없어 제조사 원문을 확인해야 합니다.`;
}

export function purchaseChecklistItemsFor(build: BuildSelection, result: CompatibilityResult, partMap?: ReadonlyMap<string, Part>): PurchaseChecklistItem[] {
  const findingItems = result.findings
    .filter(isActionableFinding)
    .map((finding): PurchaseChecklistItem => ({
      id: `finding:${finding.ruleId}`,
      kind: "finding",
      severity: finding.severity,
      title: findingTitleFor(finding.severity, finding.title),
      detail: findingDetailFor(finding.severity, finding.message),
      ruleId: finding.ruleId
    }));

  const accessoryFindingItems: PurchaseChecklistItem[] = result.accessoryCompatibility?.findings.map((finding) => ({
    id: `accessory:${finding.id}`,
    kind: "finding",
    severity: finding.severity,
    title: findingTitleFor(finding.severity, finding.title),
    detail: findingDetailFor(finding.severity, `${finding.accessoryName}: ${finding.message}`),
    targetId: "accessory-compatibility-panel",
    actionLabel: "주변 부품 보기"
  })) ?? [];

  const dataItems: PurchaseChecklistItem[] = result.dataHealth?.items.flatMap((item) => [
    ...(item.freshness === "stale" || item.freshness === "unknown" ? [{
      id: `data-freshness:${item.id}`,
      kind: "manual" as const,
      severity: "manual" as const,
      title: `${item.name} 데이터 다시 확인`,
      detail: item.freshness === "stale" ? "확인 시점이 오래되어 최신 원문을 다시 확인해야 합니다." : "확인 시점이 없어 최신 원문을 확인해야 합니다.",
      targetId: "data-health-panel" as const,
      actionLabel: "데이터 보기"
    }] : []),
    ...(item.missingFields.length > 0 ? [{
      id: `data-fields:${item.id}`,
      kind: "manual" as const,
      severity: "manual" as const,
      title: `${item.name} 누락 스펙 보완`,
      detail: `확인되지 않은 스펙 ${item.missingFields.slice(0, 3).join(", ")}${item.missingFields.length > 3 ? ` 외 ${item.missingFields.length - 3}개` : ""}를 확인해야 합니다.`,
      targetId: "data-health-panel" as const,
      actionLabel: "데이터 보기"
    }] : []),
    ...(!item.priceKnown ? [{
      id: `data-price:${item.id}`,
      kind: "manual" as const,
      severity: "manual" as const,
      title: `${item.name} 가격 확인`,
      detail: "현재 가격을 확인할 수 없어 전체 구매 금액을 확정할 수 없습니다.",
      targetId: "purchase-list-panel" as const,
      actionLabel: "구매 목록 보기"
    }] : [])
  ]) ?? [];

  const repairItems: PurchaseChecklistItem[] = result.repairPlans && result.repairPlans.length > 0 ? [{
    id: "repair:best-plan",
    kind: "manual",
    severity: result.blockerCount > 0 ? "blocker" : "manual",
    title: "최소 변경 수리 플랜 검토",
    detail: `${result.repairPlans[0].label} 플랜의 변경 부품·가격·적용 후 남는 문제를 확인한 뒤 적용 여부를 결정하세요.`,
    targetId: "repair-plan-panel",
    actionLabel: "수리 플랜 보기"
  }] : [];

  const priceItems: PurchaseChecklistItem[] = !result.priceComplete ? [{
    id: "price:total",
    kind: "manual",
    severity: "manual",
    title: "전체 구매 금액 확인",
    detail: "가격 미확인 부품이 있어 실제 구매 전에 상품 가격과 유통 조건을 다시 확인해야 합니다.",
    targetId: "purchase-list-panel",
    actionLabel: "구매 목록 보기"
  }] : [];

  const connectivitySummary = buildConnectivitySummaryFor(
    build.motherboard ? partMap?.get(build.motherboard.partId)?.specs : undefined,
    build.case ? partMap?.get(build.case.partId)?.specs : undefined
  );
  const existingFindingRuleIds = new Set(result.findings.map((finding) => finding.ruleId));
  const connectivityItems: PurchaseChecklistItem[] = connectivitySummary.items
    .filter((item) => item.status !== "pass" && !existingFindingRuleIds.has(item.ruleId))
    .map((item) => ({
      id: `connectivity:${item.id}`,
      kind: "manual",
      severity: item.status === "review" ? "warning" : "unknown",
      title: `${item.label} ${item.status === "review" ? "주의 확인" : "근거 확인"}`,
      detail: `${item.detail} 케이스 기본 장치와 메인보드 연결 근거를 확인해야 합니다.`,
      targetId: "build-connectivity-panel",
      actionLabel: "연결 자원 보기"
    }));

  const hasPhysicalParts = Boolean(build.gpu || build.case || build.cooler || build.psu)
    || result.metrics.gpuLengthMm !== undefined
    || result.metrics.maxGpuLengthMm !== undefined
    || result.metrics.coolerHeightMm !== undefined
    || result.metrics.maxCoolerHeightMm !== undefined;
  const hasPowerPath = Boolean(build.gpu || build.psu) || result.metrics.powerHeadroomW !== undefined;
  const hasM2Storage = build.ssd.length > 0 || (result.metrics.m2SlotAssignments?.length ?? 0) > 0;
  const gpuPurchaseEvidence = result.gpuFit ? gpuPurchaseEvidenceFor(result.gpuFit) : undefined;
  const missingGpuPhysicalEvidence = gpuPurchaseEvidence?.physical === "needs_review";
  const missingPcieTopologyEvidence = gpuPurchaseEvidence?.pcieCableTopology === "needs_review";
  const manualItems: PurchaseChecklistItem[] = [
    {
      id: "manual:manufacturer-support",
      kind: "manual",
      severity: "manual",
      title: "제조사 QVL·BIOS 버전 확인",
      detail: "CPU·메인보드·RAM 조합의 제조사 지원 목록과 필요한 BIOS 버전을 원문에서 확인하세요."
    },
    ...(hasPhysicalParts ? [{
      id: missingGpuPhysicalEvidence ? "manual:gpu-physical-evidence" : "manual:physical-clearance",
      kind: "manual" as const,
      severity: "manual" as const,
      title: missingGpuPhysicalEvidence ? "GPU·케이스 물리 검수 근거 확인" : "케이스 내부 간섭·케이블 여유 확인",
      detail: missingGpuPhysicalEvidence ? "GPU 물리 슬롯 점유·케이블 굽힘 최소 여유·케이스 측면 공간 중 등록되지 않은 값을 제조사 매뉴얼 또는 도면에서 확인하세요." : "GPU·쿨러·파워의 실제 길이와 두께, 전면 라디에이터·케이블이 함께 들어가는지 실물 또는 제조사 도면으로 확인하세요.",
      ...(gpuPurchaseEvidence ? { targetId: "gpu-fit-summary-panel" as const, actionLabel: "GPU FIT 보기" } : {})
    }] : []),
    ...(hasPowerPath ? [{
      id: missingPcieTopologyEvidence ? "manual:pcie-cable-topology" : "manual:power-cabling",
      kind: "manual" as const,
      severity: "manual" as const,
      title: missingPcieTopologyEvidence ? "다중 8핀 독립 케이블·분배 구조 확인" : "파워 보조전원 케이블 경로 확인",
      detail: missingPcieTopologyEvidence ? "커넥터 개수만 보지 말고 다중 8핀 GPU를 서로 독립된 PCIe 케이블 런으로 연결할 수 있는지와 분배·공유 구조를 제조사 케이블 표에서 확인하세요." : "GPU 보조전원·CPU EPS·분배 케이블의 커넥터와 케이블 꺾임 여유를 실제 파워 구성에서 확인하세요.",
      ...(gpuPurchaseEvidence ? { targetId: "gpu-fit-summary-panel" as const, actionLabel: "GPU FIT 보기" } : {})
    }] : []),
    ...(hasM2Storage ? [{
      id: "manual:m2-placement",
      kind: "manual" as const,
      severity: "manual" as const,
      title: "M.2 슬롯 위치·방열판 장착 순서 확인",
      detail: "메인보드 매뉴얼에서 슬롯 공유·방열판 위치·나사 규격을 확인하고 조립 순서를 정하세요."
    }] : []),
    {
      id: "manual:post-build-test",
      kind: "manual",
      severity: "manual",
      title: "조립 후 POST·온도·소음 확인",
      detail: "첫 부팅 후 BIOS에서 메모리·저장장치·팬을 인식하는지 확인하고, 운영체제 진입 뒤 온도와 소음을 점검하세요."
    },
    {
      id: "manual:seller-warranty",
      kind: "manual",
      severity: "manual",
      title: "판매자·배송·AS 조건 확인",
      detail: "가격은 현재 카탈로그 기준이며 재고·배송일·초기 불량 교환·무상 보증 조건은 판매자 원문에서 확인하세요."
    }
  ];

  const severityOrder: Record<PurchaseChecklistItemSeverity, number> = { blocker: 0, unknown: 1, warning: 2, manual: 3 };
  const allItems = [...findingItems, ...accessoryFindingItems, ...dataItems, ...repairItems, ...priceItems, ...connectivityItems, ...manualItems];
  const itemOrder = new Map(allItems.map((item, index) => [item.id, index]));
  return allItems.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || (itemOrder.get(left.id) ?? 0) - (itemOrder.get(right.id) ?? 0));
}

export function purchaseChecklistProgressFor(items: PurchaseChecklistItem[], checkedIds: ReadonlySet<string>): PurchaseChecklistProgress {
  const checked = items.filter((item) => checkedIds.has(item.id)).length;
  const total = items.length;
  return { total, checked, remaining: Math.max(0, total - checked), percent: total === 0 ? 0 : Math.round((checked / total) * 100) };
}

export function purchaseChecklistTextFor(items: PurchaseChecklistItem[], checkedIds: ReadonlySet<string>) {
  const lines = ["PC Supporter 구매 전 실행 체크리스트", ""];
  items.forEach((item) => {
    const marker = checkedIds.has(item.id) ? "[x]" : "[ ]";
    const kind = item.kind === "finding" ? "엔진 finding" : "직접 확인";
    lines.push(`${marker} ${kind} · ${item.title}`, `    ${item.detail}`);
  });
  return lines.join("\n");
}

export function purchaseChecklistJsonFor(storageKey: string, items: PurchaseChecklistItem[], checkedIds: ReadonlySet<string>, exportedAt = new Date().toISOString()) {
  const itemIds = items.map((item) => item.id);
  const itemIdSet = new Set(itemIds);
  const envelope: PurchaseChecklistTransferEnvelope = {
    type: "pc-supporter-purchase-checklist",
    schemaVersion: 1,
    storageKey,
    exportedAt,
    itemIds,
    checkedIds: Array.from(checkedIds).filter((id) => itemIdSet.has(id))
  };
  return JSON.stringify(envelope, null, 2);
}

export function parsePurchaseChecklistJson(input: string, expectedStorageKey: string, items: PurchaseChecklistItem[]): PurchaseChecklistTransferParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return { checkedIds: [], ignoredIds: [], itemIds: [], errors: ["체크리스트 JSON 형식이 올바르지 않습니다."] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { checkedIds: [], ignoredIds: [], itemIds: [], errors: ["체크리스트 JSON은 객체여야 합니다."] };
  const candidate = parsed as Partial<PurchaseChecklistTransferEnvelope>;
  if (candidate.type !== "pc-supporter-purchase-checklist" || candidate.schemaVersion !== 1) return { checkedIds: [], ignoredIds: [], itemIds: [], errors: ["지원하지 않는 체크리스트 JSON 버전입니다."] };
  if (typeof candidate.storageKey !== "string" || candidate.storageKey !== expectedStorageKey) return { checkedIds: [], ignoredIds: [], itemIds: [], errors: ["현재 견적과 다른 체크리스트입니다. 같은 견적에서 내보낸 JSON만 가져올 수 있습니다."] };
  if (typeof candidate.exportedAt !== "string" || candidate.exportedAt.length === 0 || candidate.exportedAt.length > 120) return { checkedIds: [], ignoredIds: [], itemIds: [], errors: ["체크리스트 JSON의 내보낸 시각이 올바르지 않습니다."] };
  if (!Array.isArray(candidate.itemIds) || !candidate.itemIds.every((id) => typeof id === "string") || !Array.isArray(candidate.checkedIds) || !candidate.checkedIds.every((id) => typeof id === "string")) return { checkedIds: [], ignoredIds: [], itemIds: [], errors: ["체크리스트 JSON의 항목 목록 형식이 올바르지 않습니다."] };
  const currentIds = new Set(items.map((item) => item.id));
  const itemIds = [...new Set(candidate.itemIds as string[])];
  const checkedIds = [...new Set(candidate.checkedIds as string[])];
  return {
    checkedIds: checkedIds.filter((id) => currentIds.has(id)),
    ignoredIds: checkedIds.filter((id) => !currentIds.has(id)),
    itemIds,
    exportedAt: candidate.exportedAt,
    errors: []
  };
}

export function purchaseChecklistTransferDiffFor(currentCheckedIds: ReadonlyArray<string>, incomingCheckedIds: ReadonlyArray<string>): PurchaseChecklistTransferDiff {
  const current = new Set(currentCheckedIds);
  const incoming = new Set(incomingCheckedIds);
  return {
    currentCheckedCount: current.size,
    incomingCheckedCount: incoming.size,
    addedCount: Array.from(incoming).filter((id) => !current.has(id)).length,
    removedCount: Array.from(current).filter((id) => !incoming.has(id)).length,
    unchangedCount: Array.from(incoming).filter((id) => current.has(id)).length
  };
}

export function purchaseChecklistTransferMatchesCurrentFor(currentItemIds: ReadonlyArray<string>, incomingItemIds: ReadonlyArray<string>) {
  const current = new Set(currentItemIds);
  const incoming = new Set(incomingItemIds);
  return current.size === incoming.size && Array.from(current).every((id) => incoming.has(id));
}
