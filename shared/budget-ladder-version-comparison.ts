import type { BudgetLadderExportItem } from "./budget-ladder";
import type { BudgetLadderShareSnapshot } from "./budget-ladder-share";
import type { PartCategory } from "./types";
import { CATEGORY_LABELS, GAMING_REFRESH_RATE_LABELS, GAMING_RESOLUTION_LABELS, LISTING_POLICY_LABELS, PART_CATEGORIES, RECOMMENDATION_PRIORITY_LABELS, RECOMMENDATION_PROFILE_LABELS } from "./types";

export interface BudgetLadderVersionComparisonRow {
  id: string;
  label: string;
  values: string[];
  changed: boolean;
  diffable: boolean;
}

export function budgetLadderVersionRequestText(request: BudgetLadderShareSnapshot["request"]) {
  if (!request) return "생성 조건을 저장하지 않은 snapshot";
  const parts = [
    RECOMMENDATION_PROFILE_LABELS[request.profile],
    RECOMMENDATION_PRIORITY_LABELS[request.priority ?? "balanced"],
    request.includeGpu ? "외장 GPU 포함" : "내장 그래픽",
    `RAM ${request.memoryCapacityGb ?? "?"}GB 이상`,
    `SSD ${request.storageCapacityGb ?? "?"}GB 이상`,
    `목표 ${request.budgetWon.toLocaleString("ko-KR")}원`
  ];
  if (request.profile === "gaming" && request.gamingResolution) parts.splice(2, 0, GAMING_RESOLUTION_LABELS[request.gamingResolution]);
  if (request.profile === "gaming" && request.gamingRefreshRate) parts.splice(3, 0, GAMING_REFRESH_RATE_LABELS[request.gamingRefreshRate]);
  if (request.hddCount && request.hddCount > 0) parts.push(`HDD ${request.hddCount}개 · ${request.hddCapacityGb ?? "?"}GB`);
  if (request.listingPolicy) parts.push(LISTING_POLICY_LABELS[request.listingPolicy]);
  return parts.join(" · ");
}

export function budgetLadderVersionLineText(item: BudgetLadderExportItem, category: PartCategory) {
  return item.lines?.find((line) => line.category === category)?.text ?? "미포함";
}

export function budgetLadderVersionRowsFor(snapshots: BudgetLadderShareSnapshot[]): BudgetLadderVersionComparisonRow[] {
  const rows: Array<Omit<BudgetLadderVersionComparisonRow, "changed">> = [
    { id: "created", label: "생성 시각", values: snapshots.map((snapshot) => new Date(snapshot.createdAt).toLocaleString("ko-KR")), diffable: false },
    { id: "request", label: "생성 조건", values: snapshots.map((snapshot) => budgetLadderVersionRequestText(snapshot.request)), diffable: true },
    { id: "catalog", label: "카탈로그 기준", values: snapshots.map((snapshot) => new Date(snapshot.catalogSnapshotAt).toLocaleString("ko-KR")), diffable: false },
    { id: "status", label: "상태", values: snapshots.map((snapshot) => snapshot.payload.items.map((item) => `${item.label} ${item.status}`).join(" · ")), diffable: true },
    { id: "budget", label: "목표 예산", values: snapshots.map((snapshot) => snapshot.payload.items.map((item) => `${item.label} ${item.budgetWon.toLocaleString("ko-KR")}원`).join(" · ")), diffable: true },
    { id: "total", label: "예상 합계", values: snapshots.map((snapshot) => snapshot.payload.items.map((item) => `${item.label} ${item.totalPriceWon === undefined ? "-" : `${item.totalPriceWon.toLocaleString("ko-KR")}원`}`).join(" · ")), diffable: true },
    { id: "risk", label: "위험", values: snapshots.map((snapshot) => snapshot.payload.items.map((item) => `${item.label} 차단 ${item.blockerCount ?? 0} · 주의 ${item.warningCount ?? 0} · 확인 ${item.unknownCount ?? 0}`).join(" · ")), diffable: true },
    { id: "analysis", label: "카탈로그 분석", values: snapshots.map((snapshot) => snapshot.payload.items.map((item) => `${item.label} ${item.analysisScore === undefined ? "계산 불가" : `${item.analysisScore}점`}`).join(" · ")), diffable: true },
    ...PART_CATEGORIES.map((category) => ({ id: category, label: CATEGORY_LABELS[category], values: snapshots.map((snapshot) => snapshot.payload.items.map((item) => `${item.label}: ${budgetLadderVersionLineText(item, category)}`).join(" · ")), diffable: true }))
  ];
  return rows.map((row) => ({ ...row, changed: row.values.some((value, index) => index > 0 && value !== row.values[0]) }));
}

export function budgetLadderVersionChangedRowsFor(rows: BudgetLadderVersionComparisonRow[]) {
  return rows.filter((row) => row.diffable && row.changed);
}
