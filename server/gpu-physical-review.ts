import type {
  GpuPhysicalOverride,
  Part,
  PhysicalOverrideCategory,
  DataFreshness,
  PhysicalReviewPriority,
  PhysicalReviewCoverage,
  PhysicalReviewQueue,
  PhysicalReviewCoverageCategory,
  PhysicalReviewQueueItem,
  PhysicalReviewStatus,
  PhysicalReviewWorkAction,
  PhysicalReviewWorkField,
  PhysicalReviewWorkItem,
  PhysicalReviewWorkPackage
} from "../shared/types";
import { DATA_FRESHNESS_LABELS } from "../shared/types";
import { classifyDataFreshness } from "../shared/data-freshness";
import { physicalSourceCheckNeedsReview } from "../shared/physical-source-check";

type PhysicalReviewQueueOptions = {
  category?: PhysicalOverrideCategory;
  query?: string;
  offset?: number;
  limit?: number;
  priority?: PhysicalReviewPriority;
  now?: string | number;
};

function physicalPart(part: Part): part is Part & { category: PhysicalOverrideCategory } {
  return part.category === "gpu" || part.category === "case" || part.category === "psu";
}

function eightPinRequirementCount(part: Part) {
  return Math.max(0, ...(part.specs.pciePowerOptions ?? []).map((option) => option
    .filter((requirement) => requirement.kind === "pcie_8pin_6plus2")
    .reduce((total, requirement) => total + requirement.count, 0)));
}

function reviewStatusFor(part: Part, override: GpuPhysicalOverride | undefined, now: string | number): PhysicalReviewStatus {
  if (!override) return "pending";
  const complete = part.category === "gpu"
    ? override.gpuSlotOccupancy !== undefined && override.gpuCableBendClearanceMm !== undefined
    : part.category === "case"
      ? override.caseSidePanelClearanceMm !== undefined
      : override.psuIndependentPcieCableRuns !== undefined && override.psuPcieCableTopology !== undefined;
  if (!complete) return "partial";
  const freshness = classifyDataFreshness(override.updatedAt, now);
  return freshness === "stale" || freshness === "unknown" || physicalSourceCheckNeedsReview(override.sourceCheck, Boolean(override.sourceUrl), now) ? "stale" : "reviewed";
}

function focusFieldsFor(part: Part, override: GpuPhysicalOverride | undefined) {
  if (part.category === "gpu") {
    return [
      override?.gpuSlotOccupancy === undefined ? "GPU 물리 슬롯 점유" : undefined,
      override?.gpuCableBendClearanceMm === undefined ? "GPU 케이블 굽힘 최소 여유" : undefined
    ].filter((value): value is string => Boolean(value));
  }
  if (part.category === "case") return override?.caseSidePanelClearanceMm === undefined ? ["케이스 측면 케이블 여유"] : [];
  return [
    override?.psuIndependentPcieCableRuns === undefined ? "독립 PCIe 케이블 런 수" : undefined,
    override?.psuPcieCableTopology === undefined ? "PCIe 케이블 분배 구조" : undefined
  ].filter((value): value is string => Boolean(value));
}

function priorityScoreFor(part: Part) {
  let score = 15;
  const reasons: string[] = [];
  if (part.category === "gpu") {
    const power = part.specs.powerW;
    if (power !== undefined && power >= 450) { score += 40; reasons.push(`고전력 GPU ${power}W`); }
    else if (power !== undefined && power >= 300) { score += 28; reasons.push(`고전력 GPU ${power}W`); }
    else if (power !== undefined && power >= 200) { score += 15; reasons.push(`중고전력 GPU ${power}W`); }
    const eightPinCount = eightPinRequirementCount(part);
    if (eightPinCount >= 3) { score += 25; reasons.push(`다중 8핀 ${eightPinCount}개`); }
    else if (eightPinCount >= 2) { score += 18; reasons.push(`다중 8핀 ${eightPinCount}개`); }
    else if (eightPinCount === 1) score += 6;
    if (part.specs.thicknessMm !== undefined && part.specs.thicknessMm >= 55) { score += 12; reasons.push(`두께 ${part.specs.thicknessMm}mm`); }
    if (part.specs.lengthMm !== undefined && part.specs.lengthMm >= 300) { score += 12; reasons.push(`길이 ${part.specs.lengthMm}mm`); }
  } else if (part.category === "case") {
    const maxGpuLength = part.specs.maxGpuLengthMm;
    if (maxGpuLength !== undefined && maxGpuLength >= 330) { score += 35; reasons.push(`대형 GPU 수용 ${maxGpuLength}mm`); }
    else if (maxGpuLength !== undefined && maxGpuLength >= 300) { score += 25; reasons.push(`대형 GPU 수용 ${maxGpuLength}mm`); }
    else if (maxGpuLength !== undefined && maxGpuLength >= 280) { score += 15; reasons.push(`GPU 수용 ${maxGpuLength}mm`); }
    if (part.specs.maxCoolerHeightMm !== undefined && part.specs.maxCoolerHeightMm >= 170) { score += 10; reasons.push(`대형 공랭 높이 ${part.specs.maxCoolerHeightMm}mm`); }
  } else {
    const wattage = part.specs.wattageW;
    if (wattage !== undefined && wattage >= 1200) { score += 35; reasons.push(`고출력 PSU ${wattage}W`); }
    else if (wattage !== undefined && wattage >= 1000) { score += 28; reasons.push(`고출력 PSU ${wattage}W`); }
    else if (wattage !== undefined && wattage >= 850) { score += 20; reasons.push(`고출력 PSU ${wattage}W`); }
    else if (wattage !== undefined && wattage >= 650) score += 10;
    const eightPinConnectors = part.specs.pciePowerConnectors?.pcie_8pin_6plus2 ?? 0;
    const modernConnectors = part.specs.pciePowerConnectors?.["12v2x6"] ?? 0;
    if (eightPinConnectors >= 4) { score += 25; reasons.push(`8핀 커넥터 ${eightPinConnectors}개`); }
    else if (eightPinConnectors >= 2) { score += 15; reasons.push(`8핀 커넥터 ${eightPinConnectors}개`); }
    if (modernConnectors > 0) { score += 12; reasons.push(`12V2x6 ${modernConnectors}개`); }
  }
  if (part.dataQuality === "live") score += 5;
  return { score, reasons };
}

function priorityFor(score: number): PhysicalReviewPriority {
  return score >= 65 ? "high" : score >= 35 ? "medium" : "low";
}

function reviewReasonFor(part: Part, focusFields: string[], priorityReasons: string[], reviewStatus: PhysicalReviewStatus, freshness: DataFreshness, sourceCheckNeedsReview: boolean) {
  const reason = priorityReasons.length > 0 ? priorityReasons.join(" · ") : "일반 물리 호환 근거";
  const freshnessReason = reviewStatus === "stale" && (freshness === "stale" || freshness === "unknown")
    ? `근거 ${DATA_FRESHNESS_LABELS[freshness]} · 제조사 원문 재확인 필요`
    : undefined;
  const sourceCheckReason = sourceCheckNeedsReview ? "근거 URL 접근·모델 식별 재확인 필요" : undefined;
  return [reason, freshnessReason, sourceCheckReason, `우선 검수: ${focusFields.join(" · ") || "현재 등록값 재확인"}`].filter(Boolean).join(" · ");
}

function queueItemFor(part: Part & { category: PhysicalOverrideCategory }, overrides: Record<string, GpuPhysicalOverride>, now: string | number): PhysicalReviewQueueItem {
  const override = overrides[part.id];
  const reviewStatus = reviewStatusFor(part, override, now);
  const freshness = override ? classifyDataFreshness(override.updatedAt, now) : "unknown";
  const sourceCheckReviewRequired = physicalSourceCheckNeedsReview(override?.sourceCheck, Boolean(override?.sourceUrl), now);
  const focusFields = reviewStatus === "stale"
    ? [...focusFieldsFor(part, override), sourceCheckReviewRequired ? "근거 URL 접근·모델 식별 재확인" : "제조사 근거 신선도 재확인"]
    : focusFieldsFor(part, override);
  const priorityData = priorityScoreFor(part);
  return {
    partId: part.id,
    partName: part.name,
    category: part.category,
    dataQuality: part.dataQuality,
    ...(part.priceWon !== undefined ? { priceWon: part.priceWon } : {}),
    ...(part.updatedAt ? { updatedAt: part.updatedAt } : {}),
    reviewStatus,
    freshness,
    ...(override ? { evidenceUpdatedAt: override.updatedAt } : {}),
    priority: priorityFor(priorityData.score),
    priorityScore: priorityData.score,
    reviewReason: reviewReasonFor(part, focusFields, priorityData.reasons, reviewStatus, freshness, sourceCheckReviewRequired),
    focusFields
  };
}

const priorityRank: Record<PhysicalReviewPriority, number> = { high: 0, medium: 1, low: 2 };
const reviewStatusRank: Record<PhysicalReviewStatus, number> = { stale: 0, partial: 1, pending: 2, reviewed: 3 };

export function physicalReviewQueueFor(catalog: Part[], overrides: Record<string, GpuPhysicalOverride>, options: PhysicalReviewQueueOptions = {}): PhysicalReviewQueue {
  const category = options.category;
  const query = options.query?.trim().toLocaleLowerCase("ko-KR") ?? "";
  const priority = options.priority;
  const offset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset ?? 0)) : 0;
  const limit = Number.isFinite(options.limit) ? Math.min(100, Math.max(1, Math.floor(options.limit ?? 12))) : 12;
  const now = options.now ?? Date.now();
  const candidates = catalog
    .filter(physicalPart)
    .filter((part) => !category || part.category === category)
    .filter((part) => !query || [part.id, part.name, part.brand, part.model].filter((value): value is string => Boolean(value)).some((value) => value.toLocaleLowerCase("ko-KR").includes(query)));
  const allItems = candidates.map((part) => queueItemFor(part, overrides, now));
  const allQueueItems = allItems
    .filter((item) => item.reviewStatus !== "reviewed")
    .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority]
      || reviewStatusRank[left.reviewStatus] - reviewStatusRank[right.reviewStatus]
      || right.priorityScore - left.priorityScore
      || left.partName.localeCompare(right.partName, "ko-KR"));
  const queueItems = priority ? allQueueItems.filter((item) => item.priority === priority) : allQueueItems;
  const reviewedCount = allItems.filter((item) => item.reviewStatus === "reviewed").length;
  const partialCount = allItems.filter((item) => item.reviewStatus === "partial").length;
  const staleCount = allItems.filter((item) => item.reviewStatus === "stale").length;
  const pendingCount = allItems.filter((item) => item.reviewStatus === "pending").length;
  const freshCount = allItems.filter((item) => item.freshness === "fresh").length;
  const agingCount = allItems.filter((item) => item.freshness === "aging").length;
  const staleFreshnessCount = allItems.filter((item) => item.freshness === "stale").length;
  const unknownFreshnessCount = allItems.filter((item) => item.freshness === "unknown").length;
  return {
    generatedAt: new Date().toISOString(),
    ...(category ? { category } : {}),
    ...(query ? { query } : {}),
    ...(priority ? { priority } : {}),
    offset,
    limit,
    total: allItems.length,
    allQueueTotal: allQueueItems.length,
    queueTotal: queueItems.length,
    registeredCount: partialCount + staleCount + reviewedCount,
    reviewedCount,
    partialCount,
    staleCount,
    pendingCount,
    freshCount,
    agingCount,
    staleFreshnessCount,
    unknownFreshnessCount,
    coveragePercent: allItems.length > 0 ? Math.round((reviewedCount / allItems.length) * 1000) / 10 : 0,
    items: queueItems.slice(offset, offset + limit)
  };
}

const physicalReviewCategories: PhysicalOverrideCategory[] = ["gpu", "case", "psu"];

function physicalReviewCoverageCategoryFor(category: PhysicalOverrideCategory, queue: PhysicalReviewQueue): PhysicalReviewCoverageCategory {
  return {
    category,
    total: queue.total,
    registeredCount: queue.registeredCount,
    reviewedCount: queue.reviewedCount,
    partialCount: queue.partialCount,
    staleCount: queue.staleCount,
    pendingCount: queue.pendingCount,
    freshCount: queue.freshCount,
    agingCount: queue.agingCount,
    staleFreshnessCount: queue.staleFreshnessCount,
    unknownFreshnessCount: queue.unknownFreshnessCount,
    queueCount: queue.allQueueTotal,
    coveragePercent: queue.coveragePercent
  };
}

export function physicalReviewCoverageFor(catalog: Part[], overrides: Record<string, GpuPhysicalOverride>, now: string | number = Date.now()): PhysicalReviewCoverage {
  const categories = physicalReviewCategories.map((category) => physicalReviewCoverageCategoryFor(
    category,
    physicalReviewQueueFor(catalog, overrides, { category, limit: 1, now })
  ));
  const total = categories.reduce((sum, category) => sum + category.total, 0);
  const registeredCount = categories.reduce((sum, category) => sum + category.registeredCount, 0);
  const reviewedCount = categories.reduce((sum, category) => sum + category.reviewedCount, 0);
  return {
    generatedAt: new Date().toISOString(),
    categories,
    total,
    registeredCount,
    reviewedCount,
    partialCount: categories.reduce((sum, category) => sum + category.partialCount, 0),
    staleCount: categories.reduce((sum, category) => sum + category.staleCount, 0),
    pendingCount: categories.reduce((sum, category) => sum + category.pendingCount, 0),
    freshCount: categories.reduce((sum, category) => sum + category.freshCount, 0),
    agingCount: categories.reduce((sum, category) => sum + category.agingCount, 0),
    staleFreshnessCount: categories.reduce((sum, category) => sum + category.staleFreshnessCount, 0),
    unknownFreshnessCount: categories.reduce((sum, category) => sum + category.unknownFreshnessCount, 0),
    queueCount: categories.reduce((sum, category) => sum + category.queueCount, 0),
    coveragePercent: total > 0 ? Math.round((reviewedCount / total) * 1000) / 10 : 0
  };
}

const commonPhysicalReviewWorkFields: PhysicalReviewWorkField[] = [
  { key: "manufacturerModel", label: "제조사 모델/SKU", type: "text", required: true, instruction: "문서가 적용되는 정확한 제조사 모델 또는 SKU를 입력합니다." },
  { key: "manufacturerRevision", label: "문서 revision", type: "text", required: false, instruction: "문서에 revision·개정일이 있을 때만 입력합니다." },
  { key: "sourceNote", label: "검수 근거 메모", type: "text", required: true, instruction: "제조사 매뉴얼 페이지·설치 가이드·케이블 표의 확인 위치를 남깁니다." },
  { key: "sourceUrl", label: "근거 URL", type: "url", required: false, instruction: "가능하면 제조사 공식 HTTPS 원문 URL을 입력합니다." }
];

const physicalReviewWorkFields: Record<PhysicalOverrideCategory, PhysicalReviewWorkField[]> = {
  gpu: [
    { key: "gpuSlotOccupancy", label: "GPU 물리 슬롯 점유", type: "number", required: true, instruction: "제조사 표기의 2-slot·2.5-slot·3-slot 등을 숫자로 입력합니다." },
    { key: "gpuCableBendClearanceMm", label: "GPU 케이블 굽힘 최소 여유 (mm)", type: "number", required: true, instruction: "제조사 설치 가이드에서 전원 케이블 굽힘에 필요한 최소 공간을 입력합니다." }
  ],
  case: [
    { key: "caseSidePanelClearanceMm", label: "케이스 측면 케이블 여유 (mm)", type: "number", required: true, instruction: "GPU 전원 케이블과 측판 사이의 확인된 여유를 입력합니다." }
  ],
  psu: [
    { key: "psuIndependentPcieCableRuns", label: "독립 PCIe 케이블 런 수", type: "number", required: true, instruction: "서로 독립된 PCIe 케이블 가닥 수를 제조사 케이블 표에서 확인합니다." },
    { key: "psuPcieCableTopology", label: "PCIe 케이블 분배 구조", type: "select", required: true, instruction: "independent 또는 shared 중 실제 케이블 분배 구조를 선택합니다." }
  ]
};

function physicalReviewWorkFieldsFor(category: PhysicalOverrideCategory | undefined) {
  const categories = category ? [category] : ["gpu", "case", "psu"] as PhysicalOverrideCategory[];
  const fields = [...commonPhysicalReviewWorkFields, ...categories.flatMap((item) => physicalReviewWorkFields[item])];
  return fields.filter((field, index) => fields.findIndex((candidate) => candidate.key === field.key) === index);
}

function physicalReviewWorkActionFor(status: PhysicalReviewStatus): { action: PhysicalReviewWorkAction; label: string } {
  if (status === "stale") return { action: "refresh_evidence", label: "제조사 근거 재확인" };
  if (status === "partial") return { action: "complete_missing_fields", label: "누락 물리 필드 보완" };
  return { action: "register_evidence", label: "근거와 필수값 등록" };
}

function physicalReviewWorkItemFor(item: PhysicalReviewQueueItem, override: GpuPhysicalOverride | undefined): PhysicalReviewWorkItem {
  const action = physicalReviewWorkActionFor(item.reviewStatus);
  return {
    partId: item.partId,
    partName: item.partName,
    category: item.category,
    dataQuality: item.dataQuality,
    ...(item.priceWon !== undefined ? { priceWon: item.priceWon } : {}),
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
    reviewStatus: item.reviewStatus,
    freshness: item.freshness,
    ...(item.evidenceUpdatedAt ? { evidenceUpdatedAt: item.evidenceUpdatedAt } : {}),
    priority: item.priority,
    priorityScore: item.priorityScore,
    reviewReason: item.reviewReason,
    focusFields: item.focusFields,
    nextAction: action.action,
    nextActionLabel: action.label,
    ...(override?.gpuSlotOccupancy !== undefined ? { gpuSlotOccupancy: override.gpuSlotOccupancy } : {}),
    ...(override?.gpuCableBendClearanceMm !== undefined ? { gpuCableBendClearanceMm: override.gpuCableBendClearanceMm } : {}),
    ...(override?.caseSidePanelClearanceMm !== undefined ? { caseSidePanelClearanceMm: override.caseSidePanelClearanceMm } : {}),
    ...(override?.psuIndependentPcieCableRuns !== undefined ? { psuIndependentPcieCableRuns: override.psuIndependentPcieCableRuns } : {}),
    ...(override?.psuPcieCableTopology !== undefined ? { psuPcieCableTopology: override.psuPcieCableTopology } : {}),
    ...(override?.manufacturerModel ? { manufacturerModel: override.manufacturerModel } : {}),
    ...(override?.manufacturerRevision ? { manufacturerRevision: override.manufacturerRevision } : {}),
    ...(override?.sourceNote ? { sourceNote: override.sourceNote } : {}),
    ...(override?.sourceUrl ? { sourceUrl: override.sourceUrl } : {}),
    ...(override?.sourceCheck ? { sourceCheck: override.sourceCheck } : {})
  };
}

export function physicalReviewWorkPackageFor(catalog: Part[], overrides: Record<string, GpuPhysicalOverride>, options: PhysicalReviewQueueOptions = {}): PhysicalReviewWorkPackage {
  const queue = physicalReviewQueueFor(catalog, overrides, options);
  const items = queue.items.map((item) => physicalReviewWorkItemFor(item, overrides[item.partId]));
  const remainingCount = Math.max(0, queue.queueTotal - (queue.offset + items.length));
  return {
    schemaVersion: 1,
    kind: "gpu-physical-review-package",
    generatedAt: new Date().toISOString(),
    ...(options.category ? { category: options.category } : {}),
    ...(options.priority ? { priority: options.priority } : {}),
    ...(options.query?.trim() ? { query: options.query.trim() } : {}),
    offset: queue.offset,
    limit: queue.limit,
    ...(remainingCount > 0 ? { nextOffset: queue.offset + items.length } : {}),
    fields: physicalReviewWorkFieldsFor(options.category),
    summary: {
      total: queue.total,
      queueTotal: queue.queueTotal,
      includedCount: items.length,
      remainingCount,
      reviewedCount: queue.reviewedCount,
      partialCount: queue.partialCount,
      staleCount: queue.staleCount,
      pendingCount: queue.pendingCount,
      coveragePercent: queue.coveragePercent
    },
    items
  };
}
