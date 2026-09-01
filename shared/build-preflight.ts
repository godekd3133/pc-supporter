import type { AccessoryItem, BuildSelection, Part, PartCategory, PartSelection } from "./types";
import { CATEGORY_LABELS, isKnownPrice, PART_CATEGORIES } from "./types";
import type { RefreshTarget } from "./refresh-targets";
import { uniqueRefreshTargets } from "./refresh-targets";

export type BuildPreflightStatus = "ready" | "needs_selection" | "needs_data_review";
export type BuildPreflightIssueKind = "selection" | "catalog" | "data" | "price";

export interface BuildPreflightIssue {
  id: string;
  kind: BuildPreflightIssueKind;
  label: string;
  message: string;
  target?: RefreshTarget;
}

export interface BuildPreflight {
  status: BuildPreflightStatus;
  requiredSelectedCount: number;
  requiredTotal: number;
  missingRequired: PartCategory[];
  selectedPartCount: number;
  selectedAccessoryCount: number;
  dataReviewCount: number;
  unpricedCount: number;
  unknownCatalogCount: number;
  refreshTargets: RefreshTarget[];
  issues: BuildPreflightIssue[];
}

function selectionsForCategory(build: BuildSelection, category: PartCategory): PartSelection[] {
  if (category === "memory") return build.memory;
  if (category === "ssd") return build.ssd;
  if (category === "hdd") return build.hdd;
  const selection = build[category];
  return selection ? [selection] : [];
}

function categoryLabel(category: PartCategory) {
  return CATEGORY_LABELS[category];
}

const selectionParticles: Record<PartCategory, "을" | "를"> = {
  cpu: "를",
  cooler: "를",
  motherboard: "를",
  memory: "을",
  gpu: "를",
  ssd: "를",
  hdd: "를",
  case: "를",
  psu: "를"
};

export function buildPreflightFor(build: BuildSelection, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>): BuildPreflight {
  const cpu = build.cpu ? partMap.get(build.cpu.partId) : undefined;
  const coolerIncluded = cpu?.specs.coolerIncluded === true;
  const requiredCategories: PartCategory[] = ["cpu", "motherboard", "memory", "case", "psu"];
  if (!coolerIncluded) requiredCategories.push("cooler");
  if (!build.useIntegratedGraphics) requiredCategories.push("gpu");
  const missingRequired = requiredCategories.filter((category) => selectionsForCategory(build, category).length === 0);
  const requiredSelectedCount = requiredCategories.length - missingRequired.length;
  const issues: BuildPreflightIssue[] = missingRequired.map((category) => ({
    id: `preflight-selection-${category}`,
    kind: "selection",
    label: categoryLabel(category),
    message: `${categoryLabel(category)}${selectionParticles[category]} 선택해야 검사 준비가 완료됩니다.`
  }));
  const coreEntries = PART_CATEGORIES.flatMap((category) => selectionsForCategory(build, category).map((selection) => ({ category, partId: selection.partId })));
  const dataReviewIds = new Set<string>();
  const unpricedIds = new Set<string>();
  const unknownCatalogIds = new Set<string>();
  for (const entry of coreEntries) {
    const part = partMap.get(entry.partId);
    if (!part) {
      unknownCatalogIds.add(entry.partId);
      dataReviewIds.add(entry.partId);
      issues.push({ id: `preflight-catalog-${entry.partId}`, kind: "catalog", label: categoryLabel(entry.category), message: `${entry.partId}의 카탈로그 상세를 아직 확인하지 못했습니다.` });
      continue;
    }
    const dataNeedsReview = part.dataQuality === "incomplete" || part.missingFields.length > 0;
    const refreshTarget = part.source === "danawa" && part.danawaUrl ? { kind: "part" as const, id: part.id } : undefined;
    if (dataNeedsReview) {
      dataReviewIds.add(part.id);
      issues.push({ id: `preflight-data-${part.id}`, kind: "data", label: part.name, message: part.missingFields.length > 0 ? `확인되지 않은 스펙 ${part.missingFields.length}개: ${part.missingFields.slice(0, 3).join(", ")}` : "카탈로그 상세 스펙의 완성도를 확인해야 합니다.", ...(refreshTarget ? { target: refreshTarget } : {}) });
    }
    if (!isKnownPrice(part.priceWon)) {
      unpricedIds.add(part.id);
      issues.push({ id: `preflight-price-${part.id}`, kind: "price", label: part.name, message: "현재 가격을 확인할 수 없어 견적 금액이 확정되지 않습니다.", ...(!dataNeedsReview && refreshTarget ? { target: refreshTarget } : {}) });
    }
  }
  const accessoryEntries = build.accessories ?? [];
  const selectedSsdIds = new Set(build.ssd.map((selection) => selection.partId));
  const selectedFanHubIds = new Set(accessoryEntries
    .filter((selection) => accessoryMap.get(selection.accessoryId)?.category === "fan_hub")
    .map((selection) => selection.accessoryId));
  if (build.rgbControllerAccessoryId !== undefined && !selectedFanHubIds.has(build.rgbControllerAccessoryId)) {
    issues.push({ id: `preflight-rgb-controller-${build.rgbControllerAccessoryId}`, kind: "catalog", label: "RGB 연결 컨트롤러", message: `RGB 연결 컨트롤러 ${build.rgbControllerAccessoryId}가 현재 선택한 팬 허브 목록에 없습니다.` });
  }
  for (const selection of accessoryEntries) {
    const accessoryId = selection.accessoryId;
    const item = accessoryMap.get(accessoryId);
    if (!item) {
      unknownCatalogIds.add(accessoryId);
      dataReviewIds.add(accessoryId);
      issues.push({ id: `preflight-accessory-catalog-${accessoryId}`, kind: "catalog", label: "주변 부품", message: `${accessoryId}의 주변 부품 상세를 아직 확인하지 못했습니다.` });
      continue;
    }
    if (selection.targetPartId !== undefined && (!selectedSsdIds.has(selection.targetPartId) || partMap.get(selection.targetPartId)?.category !== "ssd")) {
      dataReviewIds.add(item.id);
      issues.push({ id: `preflight-accessory-target-${item.id}-${selection.targetPartId}`, kind: "catalog", label: item.name, message: `연결 대상 SSD ${selection.targetPartId}가 현재 선택한 SSD 목록에 없습니다.` });
    }
    if (selection.targetAccessoryId !== undefined && (!selectedFanHubIds.has(selection.targetAccessoryId) || item.category !== "cooling_fan")) {
      dataReviewIds.add(item.id);
      issues.push({ id: `preflight-accessory-hub-target-${item.id}-${selection.targetAccessoryId}`, kind: "catalog", label: item.name, message: `연결 대상 팬 허브 ${selection.targetAccessoryId}가 현재 선택한 팬 허브 목록에 없거나 대상 부품이 쿨링팬이 아닙니다.` });
    }
    const dataNeedsReview = item.dataQuality === "incomplete" || item.missingFields.length > 0;
    const refreshTarget = item.source === "danawa" && item.danawaUrl ? { kind: "accessory" as const, id: item.id } : undefined;
    if (dataNeedsReview) {
      dataReviewIds.add(item.id);
      issues.push({ id: `preflight-accessory-data-${item.id}`, kind: "data", label: item.name, message: item.missingFields.length > 0 ? `확인되지 않은 정보 ${item.missingFields.length}개: ${item.missingFields.slice(0, 3).join(", ")}` : "주변 부품 상세 정보의 완성도를 확인해야 합니다.", ...(refreshTarget ? { target: refreshTarget } : {}) });
    }
    if (!isKnownPrice(item.priceWon)) {
      unpricedIds.add(item.id);
      issues.push({ id: `preflight-accessory-price-${item.id}`, kind: "price", label: item.name, message: "현재 가격을 확인할 수 없어 주변 부품 합계가 확정되지 않습니다.", ...(!dataNeedsReview && refreshTarget ? { target: refreshTarget } : {}) });
    }
  }
  const status: BuildPreflightStatus = missingRequired.length > 0
    ? "needs_selection"
    : dataReviewIds.size > 0 || unpricedIds.size > 0
      ? "needs_data_review"
      : "ready";
  const refreshTargets = uniqueRefreshTargets(issues.flatMap((issue) => issue.target ? [issue.target] : []));
  return {
    status,
    requiredSelectedCount,
    requiredTotal: requiredCategories.length,
    missingRequired,
    selectedPartCount: coreEntries.length,
    selectedAccessoryCount: accessoryEntries.length,
    dataReviewCount: dataReviewIds.size,
    unpricedCount: unpricedIds.size,
    unknownCatalogCount: unknownCatalogIds.size,
    refreshTargets,
    issues
  };
}
