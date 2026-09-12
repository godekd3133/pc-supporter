import { catalogMissingFieldLabelFor, catalogPcieSlotCoverageDeltaFor, catalogPcieSlotCoverageFor, catalogSpecCoverageFor, type CatalogPcieSlotCoverage, type CatalogPcieSlotCoverageDelta, type CatalogSpecCoveragePriority } from "./catalog-spec-coverage";
import { catalogCategoryMismatchFor } from "./catalog-category-integrity";
import { classifyDataFreshness } from "./data-freshness";
import { pcieSlotEvidenceMissingFieldsFor } from "./pcie-slot";
import { CATEGORY_LABELS, PART_CATEGORIES, type DataFreshness, type DataQuality, type Part, type PartCategory } from "./types";

export type CatalogSpecReviewPriority = "high" | "medium" | "low";
export type CatalogSpecReviewAction = "refresh_source" | "review_source" | "inspect_catalog";
export type CatalogSpecRefreshOutcome = "untried" | "succeeded" | "retryable_failure" | "repeated_failure";
export type CatalogSpecReviewEvidence = "all" | "spec" | "pcie";
export type CatalogSpecReviewEvidenceKind = "spec" | "pcie" | "mixed";

export interface CatalogSpecReviewField {
  category: PartCategory;
  field: string;
  label: string;
  weight: number;
  instruction: string;
}

export interface CatalogSpecReviewItem {
  partId: string;
  partName: string;
  category: PartCategory;
  source: Part["source"];
  sourceProductCode?: string;
  sourceUrl?: string;
  dataQuality: DataQuality;
  freshness: DataFreshness;
  updatedAt: string;
  priceWon?: number;
  missingFields: string[];
  pcieMissingFields: string[];
  evidenceKind: CatalogSpecReviewEvidenceKind;
  focusFields: CatalogSpecReviewField[];
  priority: CatalogSpecReviewPriority;
  priorityScore: number;
  reviewReason: string;
  nextAction: CatalogSpecReviewAction;
  nextActionLabel: string;
  refreshAttemptCount?: number;
  refreshFailureCount?: number;
  refreshFailureStreakCount?: number;
  lastRefreshStatus?: CatalogSpecRefreshBatchItemStatus;
  refreshOutcome?: CatalogSpecRefreshOutcome;
  catalogUrl: string;
}

export interface CatalogSpecReviewQueueOptions {
  category?: PartCategory;
  priority?: CatalogSpecReviewPriority;
  action?: CatalogSpecReviewAction;
  evidence?: CatalogSpecReviewEvidence;
  query?: string;
  missingField?: string;
  offset?: number;
  limit?: number;
  now?: string | number;
  refreshHistory?: CatalogSpecRefreshHistoryEntry[];
}

export interface CatalogSpecReviewQueue {
  generatedAt: string;
  category?: PartCategory;
  priority?: CatalogSpecReviewPriority;
  action?: CatalogSpecReviewAction;
  evidence?: CatalogSpecReviewEvidence;
  query?: string;
  missingField?: string;
  offset: number;
  limit: number;
  total: number;
  queueTotal: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  freshCount: number;
  agingCount: number;
  staleCount: number;
  unknownCount: number;
  queueFingerprint: string;
  items: CatalogSpecReviewItem[];
}

export interface CatalogSpecReviewWorkPackageSummary {
  total: number;
  queueTotal: number;
  includedCount: number;
  remainingCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  freshCount: number;
  agingCount: number;
  staleCount: number;
  unknownCount: number;
}

export interface CatalogSpecReviewWorkPackage {
  schemaVersion: 1;
  kind: "catalog-spec-review-package";
  generatedAt: string;
  category?: PartCategory;
  priority?: CatalogSpecReviewPriority;
  action?: CatalogSpecReviewAction;
  query?: string;
  missingField?: string;
  offset: number;
  limit: number;
  nextOffset?: number;
  queueFingerprint: string;
  queueChanged?: boolean;
  excludedNonCoreCount?: number;
  /** Raw catalog records excluded by the high-confidence category integrity boundary. */
  categoryMismatchExcludedCount?: number;
  fields: CatalogSpecReviewField[];
  summary: CatalogSpecReviewWorkPackageSummary;
  items: CatalogSpecReviewItem[];
}

export type CatalogSpecRefreshBatchItemStatus = "refreshed" | "skipped" | "failed";

export interface CatalogSpecRefreshBatchItem {
  partId: string;
  partName: string;
  category?: PartCategory;
  status: CatalogSpecRefreshBatchItemStatus;
  changedFields?: string[];
  previousMissingFields?: string[];
  nextMissingFields?: string[];
  previousPcieMissingFields?: string[];
  nextPcieMissingFields?: string[];
  refreshedAt?: string;
  code?: string;
  error?: string;
  retryAfterSeconds?: number;
}

export interface CatalogSpecRefreshBatchResponse {
  schemaVersion: 1;
  kind: "catalog-spec-refresh-batch";
  runId: string;
  startedAt: string;
  finishedAt: string;
  filters?: CatalogSpecRefreshBatchFilters;
  historyPersisted?: boolean;
  requestedCount: number;
  processedCount: number;
  refreshedCount: number;
  skippedCount: number;
  failedCount: number;
  changedFieldCount: number;
  coverageBefore?: CatalogSpecRefreshCoverageSummary;
  coverageAfter?: CatalogSpecRefreshCoverageSummary;
  coverageDelta?: CatalogSpecRefreshCoverageDelta;
  impact?: CatalogSpecRefreshBatchImpact;
  pcieImpact?: CatalogPcieRefreshImpact;
  items: CatalogSpecRefreshBatchItem[];
}

export interface CatalogSpecRefreshCoverageSummary {
  total: number;
  complete: number;
  partial: number;
  incompleteCount: number;
  coveragePercent: number;
  categories?: CatalogSpecRefreshCategoryCoverageSummary[];
  pcieSlotCoverage?: CatalogPcieSlotCoverage;
}

export interface CatalogSpecRefreshCoverageDelta {
  complete: number;
  partial: number;
  incompleteCount: number;
  coveragePercent: number;
  categories?: CatalogSpecRefreshCategoryCoverageDelta[];
  pcieSlotCoverage?: CatalogPcieSlotCoverageDelta;
}

export interface CatalogSpecRefreshCategoryCoverageSummary {
  category: PartCategory;
  total: number;
  complete: number;
  partial: number;
  incompleteCount: number;
  coveragePercent: number;
}

export interface CatalogSpecRefreshCategoryCoverageDelta {
  category: PartCategory;
  complete: number;
  partial: number;
  incompleteCount: number;
  coveragePercent: number;
}

export interface CatalogSpecRefreshCategoryImpact {
  category: PartCategory;
  count: number;
}

export interface CatalogSpecRefreshBatchImpact {
  newlyCompletedCount: number;
  newlyResolvedFieldCount: number;
  newlyCompletedByCategory: CatalogSpecRefreshCategoryImpact[];
}

export interface CatalogPcieRefreshImpact {
  newlyCompleteCount: number;
  newlyResolvedFieldCount: number;
}

export interface CatalogSpecRefreshProgressPoint {
  runId: string;
  finishedAt: string;
  coveragePercent: number;
  incompleteCount: number;
  refreshedCount: number;
  failedCount: number;
}

export interface CatalogSpecRefreshFieldProgress {
  field: string;
  observed: number;
  resolved: number;
  remaining: number;
  successPercent: number;
}

export interface CatalogSpecRefreshCategoryProgress {
  category: PartCategory;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  successPercent: number;
}

export interface CatalogSpecRefreshProgressSummary {
  runCount: number;
  coverageRunCount: number;
  totalRefreshedCount: number;
  totalSkippedCount: number;
  totalFailedCount: number;
  firstCoverageBefore?: CatalogSpecRefreshCoverageSummary;
  latestCoverageAfter?: CatalogSpecRefreshCoverageSummary;
  coverageDelta?: CatalogSpecRefreshCoverageDelta;
  newlyCompletedCount: number;
  completedByCategory: CatalogSpecRefreshCategoryImpact[];
  resolvedFieldCount: number;
  fieldProgress: CatalogSpecRefreshFieldProgress[];
  pcieNewlyCompleteCount: number;
  pcieResolvedFieldCount: number;
  pcieFieldProgress: CatalogSpecRefreshFieldProgress[];
  categoryProgress: CatalogSpecRefreshCategoryProgress[];
  points: CatalogSpecRefreshProgressPoint[];
}

export interface CatalogSpecRefreshBatchFilters {
  category?: PartCategory;
  priority?: CatalogSpecReviewPriority;
  action?: CatalogSpecReviewAction;
  evidence?: CatalogSpecReviewEvidence;
  query?: string;
  missingField?: string;
  offset?: number;
  limit?: number;
}

export interface CatalogSpecRefreshHistoryEntry {
  schemaVersion: 1;
  kind: "catalog-spec-refresh-batch";
  runId: string;
  createdAt: string;
  startedAt: string;
  finishedAt: string;
  filters?: CatalogSpecRefreshBatchFilters;
  requestedCount: number;
  processedCount: number;
  refreshedCount: number;
  skippedCount: number;
  failedCount: number;
  changedFieldCount: number;
  coverageBefore?: CatalogSpecRefreshCoverageSummary;
  coverageAfter?: CatalogSpecRefreshCoverageSummary;
  coverageDelta?: CatalogSpecRefreshCoverageDelta;
  impact?: CatalogSpecRefreshBatchImpact;
  pcieImpact?: CatalogPcieRefreshImpact;
  items: CatalogSpecRefreshBatchItem[];
}

export function catalogSpecRefreshCoverageSummaryFor(catalog: Part[], now: string | number = Date.now()): CatalogSpecRefreshCoverageSummary {
  const coverage = catalogSpecCoverageFor(catalog, now);
  return {
    total: coverage.total,
    complete: coverage.complete,
    partial: coverage.partial,
    incompleteCount: coverage.qualityCounts.incomplete,
    coveragePercent: coverage.coveragePercent,
    categories: coverage.categories.map((category) => ({
      category: category.category,
      total: category.total,
      complete: category.complete,
      partial: category.partial,
      incompleteCount: category.qualityCounts.incomplete,
      coveragePercent: category.coveragePercent
    })),
    pcieSlotCoverage: coverage.pcieSlotCoverage
  };
}

export function catalogSpecRefreshCoverageDeltaFor(before: CatalogSpecRefreshCoverageSummary, after: CatalogSpecRefreshCoverageSummary): CatalogSpecRefreshCoverageDelta {
  const beforeCategories = new Map((before.categories ?? []).map((category) => [category.category, category]));
  const categories = (after.categories ?? []).flatMap((category) => {
    const previous = beforeCategories.get(category.category);
    if (!previous) return [];
    return [{
      category: category.category,
      complete: category.complete - previous.complete,
      partial: category.partial - previous.partial,
      incompleteCount: category.incompleteCount - previous.incompleteCount,
      coveragePercent: Number((category.coveragePercent - previous.coveragePercent).toFixed(1))
    }];
  });
  return {
    complete: after.complete - before.complete,
    partial: after.partial - before.partial,
    incompleteCount: after.incompleteCount - before.incompleteCount,
    coveragePercent: Number((after.coveragePercent - before.coveragePercent).toFixed(1)),
    ...(categories.length > 0 ? { categories } : {}),
    ...(before.pcieSlotCoverage && after.pcieSlotCoverage ? { pcieSlotCoverage: catalogPcieSlotCoverageDeltaFor(before.pcieSlotCoverage, after.pcieSlotCoverage) } : {})
  };
}

export function catalogSpecRefreshImpactFor(items: CatalogSpecRefreshBatchItem[]): CatalogSpecRefreshBatchImpact {
  const completedByCategory = new Map<PartCategory, number>();
  let newlyCompletedCount = 0;
  let newlyResolvedFieldCount = 0;
  for (const item of items) {
    if (item.status !== "refreshed" || !item.previousMissingFields || !item.nextMissingFields) continue;
    const resolvedFields = item.previousMissingFields.filter((field) => !item.nextMissingFields!.includes(field));
    newlyResolvedFieldCount += resolvedFields.length;
    if (item.previousMissingFields.length > 0 && item.nextMissingFields.length === 0) {
      newlyCompletedCount += 1;
      if (item.category) completedByCategory.set(item.category, (completedByCategory.get(item.category) ?? 0) + 1);
    }
  }
  return {
    newlyCompletedCount,
    newlyResolvedFieldCount,
    newlyCompletedByCategory: [...completedByCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category))
  };
}

export function catalogPcieRefreshImpactFor(items: CatalogSpecRefreshBatchItem[]): CatalogPcieRefreshImpact {
  let newlyCompleteCount = 0;
  let newlyResolvedFieldCount = 0;
  for (const item of items) {
    if (item.status !== "refreshed" || !item.previousPcieMissingFields || !item.nextPcieMissingFields) continue;
    newlyResolvedFieldCount += item.previousPcieMissingFields.filter((field) => !item.nextPcieMissingFields!.includes(field)).length;
    if (item.previousPcieMissingFields.length > 0 && item.nextPcieMissingFields.length === 0) newlyCompleteCount += 1;
  }
  return { newlyCompleteCount, newlyResolvedFieldCount };
}

export function catalogSpecRefreshProgressSummaryFor(history: CatalogSpecRefreshHistoryEntry[]): CatalogSpecRefreshProgressSummary {
  const ordered = history.slice().sort((left, right) => Date.parse(left.finishedAt) - Date.parse(right.finishedAt) || left.runId.localeCompare(right.runId));
  const coverageRuns = ordered.filter((entry): entry is CatalogSpecRefreshHistoryEntry & { coverageBefore: CatalogSpecRefreshCoverageSummary; coverageAfter: CatalogSpecRefreshCoverageSummary } => Boolean(entry.coverageBefore && entry.coverageAfter));
  const firstCoverageBefore = coverageRuns[0]?.coverageBefore;
  const latestCoverageAfter = coverageRuns.at(-1)?.coverageAfter;
  const points = coverageRuns.slice(-12).map((entry) => ({
    runId: entry.runId,
    finishedAt: entry.finishedAt,
    coveragePercent: entry.coverageAfter.coveragePercent,
    incompleteCount: entry.coverageAfter.incompleteCount,
    refreshedCount: entry.refreshedCount,
    failedCount: entry.failedCount
  }));
  const fieldProgressMap = new Map<string, { observed: number; resolved: number; remaining: number }>();
  const pcieFieldProgressMap = new Map<string, { observed: number; resolved: number; remaining: number }>();
  const categoryProgressMap = new Map<PartCategory, { attempted: number; succeeded: number; failed: number; skipped: number }>();
  const completedByCategoryMap = new Map<PartCategory, number>();
  let newlyCompletedCount = 0;
  let pcieNewlyCompleteCount = 0;
  for (const entry of ordered) {
    if (entry.impact) {
      newlyCompletedCount += entry.impact.newlyCompletedCount;
      for (const category of entry.impact.newlyCompletedByCategory) completedByCategoryMap.set(category.category, (completedByCategoryMap.get(category.category) ?? 0) + category.count);
    }
    const pcieImpact = entry.pcieImpact ?? catalogPcieRefreshImpactFor(entry.items);
    pcieNewlyCompleteCount += pcieImpact.newlyCompleteCount;
    for (const item of entry.items) {
      if (item.category) {
        const category = categoryProgressMap.get(item.category) ?? { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
        if (item.status === "refreshed") {
          category.attempted += 1;
          category.succeeded += 1;
        } else if (item.status === "failed") {
          category.attempted += 1;
          category.failed += 1;
        } else {
          category.skipped += 1;
        }
        categoryProgressMap.set(item.category, category);
      }
      if (item.status !== "refreshed") continue;
      if (item.previousMissingFields && item.nextMissingFields) {
        for (const field of item.previousMissingFields) {
          const progress = fieldProgressMap.get(field) ?? { observed: 0, resolved: 0, remaining: 0 };
          progress.observed += 1;
          if (!item.nextMissingFields.includes(field)) progress.resolved += 1;
          else progress.remaining += 1;
          fieldProgressMap.set(field, progress);
        }
      }
      if (item.previousPcieMissingFields && item.nextPcieMissingFields) {
        for (const field of item.previousPcieMissingFields) {
          const progress = pcieFieldProgressMap.get(field) ?? { observed: 0, resolved: 0, remaining: 0 };
          progress.observed += 1;
          if (!item.nextPcieMissingFields.includes(field)) progress.resolved += 1;
          else progress.remaining += 1;
          pcieFieldProgressMap.set(field, progress);
        }
      }
    }
  }
  const fieldProgress = [...fieldProgressMap.entries()]
    .map(([field, progress]) => ({ field, ...progress, successPercent: progress.observed > 0 ? Number(((progress.resolved / progress.observed) * 100).toFixed(1)) : 0 }))
    .sort((left, right) => right.resolved - left.resolved || right.observed - left.observed || left.field.localeCompare(right.field))
    .slice(0, 12);
  const resolvedFieldCount = [...fieldProgressMap.values()].reduce((total, progress) => total + progress.resolved, 0);
  const pcieFieldProgress = [...pcieFieldProgressMap.entries()]
    .map(([field, progress]) => ({ field, ...progress, successPercent: progress.observed > 0 ? Number(((progress.resolved / progress.observed) * 100).toFixed(1)) : 0 }))
    .sort((left, right) => right.resolved - left.resolved || right.observed - left.observed || left.field.localeCompare(right.field))
    .slice(0, 12);
  const pcieResolvedFieldCount = [...pcieFieldProgressMap.values()].reduce((total, progress) => total + progress.resolved, 0);
  const categoryProgress = [...categoryProgressMap.entries()]
    .map(([category, progress]) => ({ category, ...progress, successPercent: progress.attempted > 0 ? Number(((progress.succeeded / progress.attempted) * 100).toFixed(1)) : 0 }))
    .sort((left, right) => right.attempted - left.attempted || left.category.localeCompare(right.category));
  const completedByCategory = [...completedByCategoryMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
  return {
    runCount: ordered.length,
    coverageRunCount: coverageRuns.length,
    totalRefreshedCount: ordered.reduce((total, entry) => total + entry.refreshedCount, 0),
    totalSkippedCount: ordered.reduce((total, entry) => total + entry.skippedCount, 0),
    totalFailedCount: ordered.reduce((total, entry) => total + entry.failedCount, 0),
    ...(firstCoverageBefore ? { firstCoverageBefore } : {}),
    ...(latestCoverageAfter ? { latestCoverageAfter } : {}),
    ...(firstCoverageBefore && latestCoverageAfter ? { coverageDelta: catalogSpecRefreshCoverageDeltaFor(firstCoverageBefore, latestCoverageAfter) } : {}),
    newlyCompletedCount,
    completedByCategory,
    resolvedFieldCount,
    fieldProgress,
    pcieNewlyCompleteCount,
    pcieResolvedFieldCount,
    pcieFieldProgress,
    categoryProgress,
    points
  };
}

type FieldDefinition = Omit<CatalogSpecReviewField, "category">;

const FIELD_DEFINITIONS: Record<PartCategory, FieldDefinition[]> = {
  cpu: [
    { field: "socket", label: "소켓", weight: 40, instruction: "제조사 원문에서 CPU 소켓 또는 호환 플랫폼을 확인합니다." },
    { field: "tdpW", label: "TDP", weight: 35, instruction: "TDP 또는 PPT를 실제 원문 표기와 단위로 확인합니다. 소비전력과 혼동하지 않습니다." },
    { field: "cores", label: "코어 수", weight: 20, instruction: "제조사 제품 사양의 물리 코어 수를 확인합니다." },
    { field: "threads", label: "스레드 수", weight: 18, instruction: "제조사 제품 사양의 스레드 수를 확인합니다." }
  ],
  cooler: [
    { field: "supportedSockets", label: "지원 소켓", weight: 40, instruction: "동봉 브래킷 기준의 지원 CPU 소켓을 확인합니다." },
    { field: "maxCoolingW", label: "냉각 지원", weight: 38, instruction: "제조사 표기 냉각 한도를 확인하되 TDP와 동일하다고 추정하지 않습니다." },
    { field: "coolerType", label: "쿨러 유형", weight: 22, instruction: "공랭·일체형 수랭 등 실제 쿨러 유형을 확인합니다." },
    { field: "radiatorSizeMm", label: "라디에이터 크기", weight: 20, instruction: "수랭 쿨러의 라디에이터 크기와 단위를 확인합니다." }
  ],
  motherboard: [
    { field: "socket", label: "소켓", weight: 40, instruction: "메인보드 CPU 소켓을 제조사 원문에서 확인합니다." },
    { field: "memoryType", label: "메모리 세대", weight: 32, instruction: "지원 메모리 세대(DDR4·DDR5 등)를 확인합니다." },
    { field: "m2Slots", label: "M.2 슬롯", weight: 32, instruction: "사용 가능한 M.2 슬롯 수를 확인합니다. 슬롯별 연결 방식은 별도 매핑에서 검수합니다." },
    { field: "maxMemoryGb", label: "최대 메모리", weight: 25, instruction: "제조사 공식 최대 메모리 용량을 확인합니다." },
    { field: "memorySlots", label: "메모리 슬롯", weight: 24, instruction: "물리 DIMM 슬롯 수를 확인합니다." },
    { field: "sataPorts", label: "SATA 포트", weight: 22, instruction: "사용 가능한 SATA 포트 수를 확인합니다." },
    { field: "motherboardFormFactors", label: "지원 메인보드 규격", weight: 18, instruction: "메인보드 자체 규격을 원문에서 확인합니다." },
    { field: "pcieX16Slots", label: "PCIe x16 슬롯", weight: 38, instruction: "확장슬롯 원문에서 PCIe x16 슬롯 수를 확인합니다. 표기가 없으면 0개로 추정하지 않습니다." },
    { field: "pcieX8Slots", label: "PCIe x8 슬롯", weight: 36, instruction: "확장슬롯 원문에서 PCIe x8 슬롯 수를 확인합니다. 표기가 없으면 0개로 추정하지 않습니다." },
    { field: "pcieX4Slots", label: "PCIe x4 슬롯", weight: 34, instruction: "확장슬롯 원문에서 PCIe x4 슬롯 수를 확인합니다. 표기가 없으면 0개로 추정하지 않습니다." },
    { field: "pcieX1Slots", label: "PCIe x1 슬롯", weight: 32, instruction: "확장슬롯 원문에서 PCIe x1 슬롯 수를 확인합니다. 표기가 없으면 0개로 추정하지 않습니다." }
  ],
  memory: [
    { field: "memoryType", label: "메모리 세대", weight: 35, instruction: "DDR 세대를 확인합니다." },
    { field: "capacityGb", label: "용량", weight: 30, instruction: "킷 또는 모듈 1개의 실제 용량을 확인합니다." },
    { field: "speedMhz", label: "메모리 속도", weight: 28, instruction: "원문 표기 속도를 MT/s 기준으로 정규화해 확인합니다." },
    { field: "memoryFormFactor", label: "물리 규격", weight: 26, instruction: "DIMM·SO-DIMM 등 물리 규격을 확인합니다." },
    { field: "memoryModuleCountPerKit", label: "킷 모듈 수", weight: 22, instruction: "킷 구성의 실제 모듈 개수를 확인합니다." },
    { field: "memoryProfiles", label: "XMP·EXPO 프로파일", weight: 16, instruction: "XMP·EXPO 프로파일이 원문에 명시된 경우에만 기록합니다." }
  ],
  gpu: [
    { field: "powerW", label: "소비전력", weight: 45, instruction: "그래픽카드 보드 전력 또는 제조사 권장 기준을 구분해 확인합니다." },
    { field: "recommendedPsuW", label: "권장 PSU", weight: 40, instruction: "제조사 권장 파워 정격을 확인하며 임의로 계산하지 않습니다." },
    { field: "lengthMm", label: "GPU 길이", weight: 38, instruction: "브래킷 포함 여부를 확인하고 제조사 표기 길이를 기록합니다." },
    { field: "widthMm", label: "GPU 폭", weight: 30, instruction: "제조사 표기 폭과 측정 기준을 확인합니다." },
    { field: "thicknessMm", label: "GPU 두께", weight: 30, instruction: "슬롯 점유와 혼동하지 않도록 실제 두께를 확인합니다." },
    { field: "vramGb", label: "VRAM", weight: 25, instruction: "메모리 용량을 제조사 사양에서 확인합니다." },
    { field: "pciePowerOptions", label: "보조전원 구성", weight: 42, instruction: "필요한 보조전원 조합을 제조사 사양에서 확인하며 커넥터 수만으로 추정하지 않습니다." }
  ],
  ssd: [
    { field: "interface", label: "인터페이스", weight: 40, instruction: "NVMe·SATA 신호 방식을 원문에서 확인합니다." },
    { field: "capacityGb", label: "용량", weight: 34, instruction: "실제 표기 용량을 확인합니다." },
    { field: "formFactor", label: "폼팩터", weight: 32, instruction: "M.2 2280·2.5인치 등 물리 폼팩터를 확인합니다." },
    { field: "m2PcieGeneration", label: "M.2 PCIe 세대", weight: 28, instruction: "M.2 NVMe 제품의 지원 PCIe 세대를 확인합니다." },
    { field: "lengthMm", label: "저장장치 길이", weight: 20, instruction: "M.2 길이 등 장착 치수를 원문에서 확인합니다." }
  ],
  hdd: [
    { field: "interface", label: "인터페이스", weight: 35, instruction: "SATA 등 연결 방식을 확인합니다." },
    { field: "capacityGb", label: "용량", weight: 32, instruction: "실제 표기 용량을 확인합니다." },
    { field: "formFactor", label: "폼팩터", weight: 30, instruction: "3.5인치·2.5인치 등 물리 규격을 확인합니다." },
    { field: "lengthMm", label: "저장장치 길이", weight: 18, instruction: "장착에 영향을 주는 실제 치수를 확인합니다." }
  ],
  case: [
    { field: "maxGpuLengthMm", label: "GPU 허용 길이", weight: 45, instruction: "라디에이터·전면 팬 장착 시 조건을 포함해 제조사 허용 길이를 확인합니다." },
    { field: "maxCoolerHeightMm", label: "쿨러 허용 높이", weight: 40, instruction: "측면 패널 기준 CPU 쿨러 허용 높이를 확인합니다." },
    { field: "maxPsuLengthMm", label: "PSU 허용 길이", weight: 35, instruction: "케이지·브래킷 조건을 포함한 PSU 허용 길이를 확인합니다." },
    { field: "motherboardFormFactors", label: "지원 메인보드 규격", weight: 28, instruction: "지원 메인보드 폼팩터를 확인합니다." },
    { field: "hddBays", label: "HDD 베이", weight: 25, instruction: "실제로 장착 가능한 3.5인치 HDD 베이 수를 확인합니다." },
    { field: "fanCount", label: "기본 팬 수", weight: 15, instruction: "기본 제공 팬 수를 추가 팬 슬롯과 구분해 확인합니다." }
  ],
  psu: [
    { field: "wattageW", label: "정격 출력", weight: 48, instruction: "정격 출력과 피크 출력·12V 출력을 구분해 기록합니다." },
    { field: "psuFormFactor", label: "PSU 폼팩터", weight: 35, instruction: "ATX·SFX 등 폼팩터를 확인합니다." },
    { field: "psuDepthMm", label: "PSU 깊이", weight: 32, instruction: "모듈러 케이블 장착 조건을 포함한 실제 깊이를 확인합니다." },
    { field: "pciePowerConnectors", label: "PCIe 전원 커넥터", weight: 42, instruction: "커넥터 개수와 케이블 런 구조를 구분해 확인합니다." },
    { field: "efficiency", label: "효율 등급", weight: 16, instruction: "80 PLUS 등 제조사 표기 효율 등급을 확인합니다." }
  ]
};

const CATEGORY_PRIORITY_SCORE: Record<CatalogSpecCoveragePriority, number> = { high: 40, medium: 24, low: 12, none: 0 };
const PRIORITY_LABELS: Record<CatalogSpecReviewPriority, string> = { high: "우선 보강", medium: "보강 권장", low: "일반 보강" };
const FRESHNESS_SCORE: Record<DataFreshness, number> = { fresh: 0, aging: 4, stale: 10, unknown: 8 };

function definitionFor(category: PartCategory, field: string): CatalogSpecReviewField {
  const definition = FIELD_DEFINITIONS[category].find((item) => item.field === field);
  if (definition) return { category, ...definition };
  const label = catalogMissingFieldLabelFor(field);
  return {
    category,
    field,
    label,
    weight: 12,
    instruction: `제조사 원문에서 ${label}을 확인하고 추정값 없이 기록합니다.`
  };
}

function categoryPriorityFor(category: PartCategory, coverage: ReturnType<typeof catalogSpecCoverageFor>) {
  return coverage.categories.find((item) => item.category === category)?.priority ?? "none";
}

function queryMatches(part: Part, query: string) {
  if (!query) return true;
  return [part.id, part.name, part.brand, part.model, part.sourceProductCode]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase("ko-KR").includes(query));
}

function reviewPriorityFor(score: number): CatalogSpecReviewPriority {
  return score >= 70 ? "high" : score >= 40 ? "medium" : "low";
}

function refreshHistoryForPart(partId: string, history: CatalogSpecRefreshHistoryEntry[] | undefined) {
  if (!history || history.length === 0) return undefined;
  const entries = history
    .flatMap((entry) => entry.items.map((item, index) => ({ item, finishedAt: entry.finishedAt, index })))
    .filter(({ item }) => item.partId === partId)
    .sort((left, right) => Date.parse(left.finishedAt) - Date.parse(right.finishedAt) || left.index - right.index);
  const attempts = entries.filter(({ item }) => item.status === "refreshed" || item.status === "failed");
  if (attempts.length === 0) return { attemptCount: 0, failureCount: 0, failureStreakCount: 0, outcome: "untried" as const };
  const failureCount = attempts.filter(({ item }) => item.status === "failed").length;
  const lastRefreshStatus = attempts.at(-1)!.item.status;
  let failureStreakCount = 0;
  for (const entry of attempts.slice().reverse()) {
    if (entry.item.status !== "failed") break;
    failureStreakCount += 1;
  }
  const outcome: CatalogSpecRefreshOutcome = lastRefreshStatus === "failed"
    ? failureStreakCount >= 3 ? "repeated_failure" : "retryable_failure"
    : "succeeded";
  return { attemptCount: attempts.length, failureCount, failureStreakCount, lastRefreshStatus, outcome };
}

function nextActionFor(part: Part, refreshOutcome: CatalogSpecRefreshOutcome | undefined): { action: CatalogSpecReviewAction; label: string } {
  if (refreshOutcome === "repeated_failure" && part.danawaUrl) return { action: "review_source", label: "반복 실패 · 수동 확인" };
  if (part.source === "danawa" && part.sourceProductCode && part.danawaUrl) return { action: "refresh_source", label: "원문 다시 확인" };
  if (part.danawaUrl) return { action: "review_source", label: "원문 확인" };
  return { action: "inspect_catalog", label: "카탈로그 상세 확인" };
}

function reviewItemFor(part: Part, categoryPriority: CatalogSpecCoveragePriority, evidence: CatalogSpecReviewEvidence, now: string | number, refreshHistoryEntries?: CatalogSpecRefreshHistoryEntry[]): CatalogSpecReviewItem {
  const missingFields = [...new Set(part.missingFields.map((field) => field.trim()).filter(Boolean))];
  const pcieMissingFields = part.category === "motherboard" ? pcieSlotEvidenceMissingFieldsFor(part.specs) : [];
  const focusFieldNames = [...new Set([
    ...(evidence === "pcie" ? [] : missingFields),
    ...(evidence === "spec" ? [] : pcieMissingFields)
  ])];
  const focusFields = focusFieldNames
    .map((field) => definitionFor(part.category, field))
    .sort((left, right) => right.weight - left.weight || left.field.localeCompare(right.field))
    .slice(0, 5);
  const freshness = classifyDataFreshness(part.updatedAt, now);
  const categoryScore = CATEGORY_PRIORITY_SCORE[categoryPriority];
  const impactScore = Math.min(45, focusFields[0]?.weight ?? 12);
  const breadthScore = Math.min(15, focusFieldNames.length * 3 + (part.dataQuality === "incomplete" ? 5 : 0));
  const sourceScore = part.source === "danawa" && part.danawaUrl ? 5 : 0;
  const priorityScore = Math.min(100, categoryScore + impactScore + breadthScore + FRESHNESS_SCORE[freshness] + sourceScore);
  const priority = reviewPriorityFor(priorityScore);
  const refreshState = refreshHistoryForPart(part.id, refreshHistoryEntries);
  const action = nextActionFor(part, refreshState?.outcome);
  const shownSpecGap = evidence !== "pcie" && missingFields.length > 0;
  const shownPcieGap = evidence !== "spec" && pcieMissingFields.length > 0;
  const evidenceKind: CatalogSpecReviewEvidenceKind = shownSpecGap && shownPcieGap ? "mixed" : shownPcieGap ? "pcie" : "spec";
  const reasonParts = [
    `${CATEGORY_LABELS[part.category]} ${PRIORITY_LABELS[priority]}`,
    evidence !== "pcie" && missingFields.length > 0 ? `스펙 누락 ${missingFields.length}개` : undefined,
    evidence !== "spec" && pcieMissingFields.length > 0 ? `PCIe 정보 부족 ${pcieMissingFields.length}개` : undefined,
    focusFieldNames.length === 0 ? "incomplete 품질" : undefined,
    focusFields.length > 0 ? `핵심 ${focusFields.slice(0, 2).map((field) => field.label).join("·")}` : undefined,
    freshness === "stale" || freshness === "unknown" ? `정보 ${freshness === "stale" ? "오래됨" : "시점 확인 필요"}` : undefined,
    refreshState?.outcome === "retryable_failure" ? `원문 재확인 실패 ${refreshState.failureStreakCount}회 · 재시도 권장` : undefined,
    refreshState?.outcome === "repeated_failure" ? `원문 재확인 연속 ${refreshState.failureStreakCount}회 실패 · 수동 전환` : undefined
  ].filter((value): value is string => Boolean(value));
  const params = new URLSearchParams({ category: part.category, partId: part.id });
  if (focusFields[0]) params.set("missingField", focusFields[0].field);
  return {
    partId: part.id,
    partName: part.name,
    category: part.category,
    source: part.source,
    ...(part.sourceProductCode ? { sourceProductCode: part.sourceProductCode } : {}),
    ...(part.danawaUrl ? { sourceUrl: part.danawaUrl } : {}),
    dataQuality: part.dataQuality,
    freshness,
    updatedAt: part.updatedAt,
    ...(part.priceWon !== undefined ? { priceWon: part.priceWon } : {}),
    missingFields,
    pcieMissingFields,
    evidenceKind,
    focusFields,
    priority,
    priorityScore,
    reviewReason: reasonParts.join(" · "),
    nextAction: action.action,
    nextActionLabel: action.label,
    ...(refreshState && refreshState.attemptCount > 0 ? { refreshAttemptCount: refreshState.attemptCount, refreshFailureCount: refreshState.failureCount, refreshFailureStreakCount: refreshState.failureStreakCount, lastRefreshStatus: refreshState.lastRefreshStatus, refreshOutcome: refreshState.outcome } : { refreshOutcome: "untried" }),
    catalogUrl: `/catalog?${params.toString()}`
  };
}

const priorityRank: Record<CatalogSpecReviewPriority, number> = { high: 0, medium: 1, low: 2 };
const freshnessRank: Record<DataFreshness, number> = { stale: 0, unknown: 1, aging: 2, fresh: 3 };
const refreshOutcomeRank: Record<CatalogSpecRefreshOutcome, number> = { repeated_failure: 0, retryable_failure: 1, untried: 2, succeeded: 3 };

function hashText(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function catalogSpecReviewQueueFingerprintFor(items: CatalogSpecReviewItem[], options: Pick<CatalogSpecReviewQueueOptions, "category" | "priority" | "action" | "evidence" | "query" | "missingField">) {
  return `csr1-${hashText(JSON.stringify({
    category: options.category ?? null,
    priority: options.priority ?? null,
    action: options.action ?? null,
    evidence: options.evidence ?? "all",
    query: options.query?.trim().toLocaleLowerCase("ko-KR") ?? "",
    missingField: options.missingField?.trim() ?? "",
    items: items.map((item) => ({
      partId: item.partId,
      missingFields: item.missingFields,
      pcieMissingFields: item.pcieMissingFields,
      evidenceKind: item.evidenceKind,
      updatedAt: item.updatedAt,
      priority: item.priority,
      priorityScore: item.priorityScore,
      refreshAttemptCount: item.refreshAttemptCount ?? 0,
      refreshFailureCount: item.refreshFailureCount ?? 0,
      refreshFailureStreakCount: item.refreshFailureStreakCount ?? 0,
      lastRefreshStatus: item.lastRefreshStatus ?? null,
      refreshOutcome: item.refreshOutcome ?? "untried"
    }))
  }))}`;
}

export function catalogSpecReviewFieldsFor(category?: PartCategory): CatalogSpecReviewField[] {
  const categories = category ? [category] : PART_CATEGORIES;
  return categories.flatMap((item) => FIELD_DEFINITIONS[item].map((field) => ({ category: item, ...field })));
}

export function catalogSpecReviewQueueFor(catalog: Part[], options: CatalogSpecReviewQueueOptions = {}): CatalogSpecReviewQueue {
  const now = options.now ?? Date.now();
  const category = options.category;
  const priority = options.priority;
  const evidence = options.evidence ?? "all";
  const query = options.query?.trim().toLocaleLowerCase("ko-KR") ?? "";
  const missingField = options.missingField?.trim() ?? "";
  const offset = Number.isFinite(options.offset) ? Math.min(100_000, Math.max(0, Math.floor(options.offset ?? 0))) : 0;
  const limit = Number.isFinite(options.limit) ? Math.min(100, Math.max(1, Math.floor(options.limit ?? 24))) : 24;
  const coverage = catalogSpecCoverageFor(catalog, now);
  const candidates = catalog
    .filter((part) => !catalogCategoryMismatchFor(part))
    .filter((part) => {
      const hasSpecGap = part.dataQuality === "incomplete" || part.missingFields.length > 0;
      const hasPcieGap = part.category === "motherboard" && pcieSlotEvidenceMissingFieldsFor(part.specs).length > 0;
      return evidence === "spec" ? hasSpecGap : evidence === "pcie" ? hasPcieGap : hasSpecGap || hasPcieGap;
    })
    .filter((part) => !category || part.category === category)
    .filter((part) => queryMatches(part, query))
    .filter((part) => {
      if (!missingField) return true;
      const pcieMissingFields = part.category === "motherboard" ? pcieSlotEvidenceMissingFieldsFor(part.specs) : [];
      return evidence === "spec"
        ? part.missingFields.includes(missingField)
        : evidence === "pcie"
          ? pcieMissingFields.some((field) => field === missingField)
          : part.missingFields.includes(missingField) || pcieMissingFields.some((field) => field === missingField);
    });
  const allItems = candidates.map((part) => reviewItemFor(part, categoryPriorityFor(part.category, coverage), evidence, now, options.refreshHistory));
  const sortedItems = allItems.sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority]
    || right.priorityScore - left.priorityScore
    || refreshOutcomeRank[left.refreshOutcome ?? "untried"] - refreshOutcomeRank[right.refreshOutcome ?? "untried"]
    || freshnessRank[left.freshness] - freshnessRank[right.freshness]
    || right.missingFields.length - left.missingFields.length
    || left.partName.localeCompare(right.partName, "ko-KR")
    || left.partId.localeCompare(right.partId));
  const queueItems = sortedItems.filter((item) => (!priority || item.priority === priority) && (!options.action || item.nextAction === options.action));
  const queueFingerprint = catalogSpecReviewQueueFingerprintFor(queueItems, { category, priority, action: options.action, evidence, query, missingField });
  return {
    generatedAt: new Date().toISOString(),
    ...(category ? { category } : {}),
    ...(priority ? { priority } : {}),
    ...(options.action ? { action: options.action } : {}),
    ...(evidence !== "all" ? { evidence } : {}),
    ...(query ? { query } : {}),
    ...(missingField ? { missingField } : {}),
    offset,
    limit,
    total: allItems.length,
    queueTotal: queueItems.length,
    highCount: allItems.filter((item) => item.priority === "high").length,
    mediumCount: allItems.filter((item) => item.priority === "medium").length,
    lowCount: allItems.filter((item) => item.priority === "low").length,
    freshCount: allItems.filter((item) => item.freshness === "fresh").length,
    agingCount: allItems.filter((item) => item.freshness === "aging").length,
    staleCount: allItems.filter((item) => item.freshness === "stale").length,
    unknownCount: allItems.filter((item) => item.freshness === "unknown").length,
    queueFingerprint,
    items: queueItems.slice(offset, offset + limit)
  };
}

export function catalogSpecReviewWorkPackageFor(catalog: Part[], options: CatalogSpecReviewQueueOptions = {}): CatalogSpecReviewWorkPackage {
  const queue = catalogSpecReviewQueueFor(catalog, options);
  const remainingCount = Math.max(0, queue.queueTotal - (queue.offset + queue.items.length));
  const evidence = options.evidence ?? "all";
  const fields = new Map(catalogSpecReviewFieldsFor(options.category)
    .filter((field) => evidence === "all" || (evidence === "pcie" ? field.field.startsWith("pcieX") : !field.field.startsWith("pcieX")))
    .map((field) => [`${field.category}:${field.field}`, field]));
  for (const item of queue.items) for (const field of item.focusFields) fields.set(`${field.category}:${field.field}`, field);
  return {
    schemaVersion: 1,
    kind: "catalog-spec-review-package",
    generatedAt: queue.generatedAt,
    ...(options.category ? { category: options.category } : {}),
    ...(options.priority ? { priority: options.priority } : {}),
    ...(options.action ? { action: options.action } : {}),
    ...(options.evidence && options.evidence !== "all" ? { evidence: options.evidence } : {}),
    ...(options.query?.trim() ? { query: options.query.trim() } : {}),
    ...(options.missingField?.trim() ? { missingField: options.missingField.trim() } : {}),
    offset: queue.offset,
    limit: queue.limit,
    ...(remainingCount > 0 ? { nextOffset: queue.offset + queue.items.length } : {}),
    queueFingerprint: queue.queueFingerprint,
    fields: [...fields.values()],
    summary: {
      total: queue.total,
      queueTotal: queue.queueTotal,
      includedCount: queue.items.length,
      remainingCount,
      highCount: queue.highCount,
      mediumCount: queue.mediumCount,
      lowCount: queue.lowCount,
      freshCount: queue.freshCount,
      agingCount: queue.agingCount,
      staleCount: queue.staleCount,
      unknownCount: queue.unknownCount
    },
    items: queue.items
  };
}
