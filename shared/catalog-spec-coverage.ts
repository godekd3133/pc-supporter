import { classifyDataFreshness } from "./data-freshness";
import { catalogCategoryIntegritySummaryFor, catalogCategoryMismatchFor, type CatalogCategoryIntegritySummary } from "./catalog-category-integrity";
import { PART_CATEGORIES, type DataFreshness, type DataQuality, type Part, type PartCategory } from "./types";
import { pcieCompatibleSlotInventoryFor, type PcieSlotWidth } from "./pcie-slot";

export interface CatalogSpecCoverageMissingField {
  field: string;
  count: number;
}

export type CatalogSpecCoveragePriority = "high" | "medium" | "low" | "none";

export interface CatalogSpecCoverageCategory {
  category: PartCategory;
  total: number;
  complete: number;
  partial: number;
  coveragePercent: number;
  priority: CatalogSpecCoveragePriority;
  priceKnown: number;
  priceUnknown: number;
  qualityCounts: Record<DataQuality, number>;
  freshnessCounts: Record<DataFreshness, number>;
  missingFields: CatalogSpecCoverageMissingField[];
  unnamedIncomplete: number;
}

export interface CatalogPcieSlotCoverageEntry {
  requiredWidth: PcieSlotWidth;
  total: number;
  complete: number;
  missing: number;
  coveragePercent: number;
}

export interface CatalogPcieSlotCoverage {
  total: number;
  byRequiredWidth: Record<PcieSlotWidth, CatalogPcieSlotCoverageEntry>;
  /** Count before high-confidence category integrity filtering. */
  rawTotal?: number;
  /** High-confidence non-PC records excluded from the PCIe evidence target. */
  excludedCategoryMismatchCount?: number;
}

export interface CatalogPcieSlotCoverageDeltaEntry {
  requiredWidth: PcieSlotWidth;
  complete: number;
  missing: number;
  coveragePercent: number;
}

export interface CatalogPcieSlotCoverageDelta {
  byRequiredWidth: Record<PcieSlotWidth, CatalogPcieSlotCoverageDeltaEntry>;
}

export interface CatalogSpecCoverage {
  total: number;
  complete: number;
  partial: number;
  coveragePercent: number;
  priceKnown: number;
  priceUnknown: number;
  qualityCounts: Record<DataQuality, number>;
  freshnessCounts: Record<DataFreshness, number>;
  categories: CatalogSpecCoverageCategory[];
  pcieSlotCoverage?: CatalogPcieSlotCoverage;
  categoryIntegrity?: CatalogCategoryIntegritySummary;
}

const CATALOG_MISSING_FIELD_LABELS: Record<string, string> = {
  socket: "소켓",
  memoryType: "메모리 세대",
  maxMemoryGb: "최대 메모리",
  memorySlots: "메모리 슬롯",
  maxMemorySpeedMhz: "최대 메모리 속도",
  m2Slots: "M.2 슬롯",
  sataPorts: "SATA 포트",
  formFactor: "폼팩터",
  vrmCapacityW: "VRM 용량",
  supportedSockets: "지원 소켓",
  maxCoolingW: "냉각 지원",
  maxCoolerHeightMm: "쿨러 허용 높이",
  powerW: "소비전력",
  recommendedPsuW: "권장 PSU",
  lengthMm: "GPU 길이",
  interface: "인터페이스",
  capacityGb: "용량",
  speedMhz: "메모리 속도",
  motherboardFormFactors: "지원 메인보드 규격",
  maxGpuLengthMm: "GPU 허용 길이",
  hddBays: "HDD 베이",
  wattageW: "정격 출력",
  psuFormFactor: "PSU 폼팩터",
  psuDepthMm: "PSU 깊이",
  "internal storage device": "저장장치 종류",
  "12V output": "12V 출력",
  connectors: "커넥터",
  efficiency: "효율",
  pcieX16Slots: "PCIe x16 슬롯",
  pcieX8Slots: "PCIe x8 슬롯",
  pcieX4Slots: "PCIe x4 슬롯",
  pcieX1Slots: "PCIe x1 슬롯"
};

export function catalogMissingFieldLabelFor(field: string) {
  return CATALOG_MISSING_FIELD_LABELS[field] ?? field;
}

function missingFieldCountsToList(counts: Map<string, number>, limit = 8): CatalogSpecCoverageMissingField[] {
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(32, Math.floor(limit))) : 8;
  return [...counts.entries()]
    .map(([field, count]) => ({ field, count }))
    .sort((left, right) => right.count - left.count || left.field.localeCompare(right.field))
    .slice(0, boundedLimit);
}

export function catalogMissingFieldCountsFor(parts: Part[], limit = 8): CatalogSpecCoverageMissingField[] {
  const counts = new Map<string, number>();
  for (const part of parts) for (const field of part.missingFields) counts.set(field, (counts.get(field) ?? 0) + 1);
  return missingFieldCountsToList(counts, limit);
}

const DATA_QUALITIES: DataQuality[] = ["seed", "live", "manual", "incomplete"];
const DATA_FRESHNESSES: DataFreshness[] = ["fresh", "aging", "stale", "unknown"];

function emptyCounts<T extends string>(keys: readonly T[]) {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function coveragePercent(complete: number, total: number) {
  return total === 0 ? 100 : Math.round((complete / total) * 1000) / 10;
}

function coveragePriorityFor(complete: number, total: number): CatalogSpecCoveragePriority {
  if (total === 0 || complete === total) return "none";
  const partialRate = (total - complete) / total;
  return partialRate >= 0.5 ? "high" : partialRate >= 0.1 ? "medium" : "low";
}

function categoryCoverageFor(category: PartCategory, parts: Part[], now: string | number): CatalogSpecCoverageCategory {
  const qualityCounts = emptyCounts(DATA_QUALITIES);
  const freshnessCounts = emptyCounts(DATA_FRESHNESSES);
  const missingFieldCounts = new Map<string, number>();
  let complete = 0;
  let priceKnown = 0;
  let unnamedIncomplete = 0;
  for (const part of parts) {
    qualityCounts[part.dataQuality] += 1;
    freshnessCounts[classifyDataFreshness(part.updatedAt, now)] += 1;
    for (const field of part.missingFields) missingFieldCounts.set(field, (missingFieldCounts.get(field) ?? 0) + 1);
    if (part.priceWon !== undefined && Number.isFinite(part.priceWon) && part.priceWon > 0) priceKnown += 1;
    if (part.dataQuality !== "incomplete" && part.missingFields.length === 0) complete += 1;
    if (part.dataQuality === "incomplete" && part.missingFields.length === 0) unnamedIncomplete += 1;
  }
  const missingFields = missingFieldCountsToList(missingFieldCounts);
  return {
    category,
    total: parts.length,
    complete,
    partial: parts.length - complete,
    coveragePercent: coveragePercent(complete, parts.length),
    priority: coveragePriorityFor(complete, parts.length),
    priceKnown,
    priceUnknown: parts.length - priceKnown,
    qualityCounts,
    freshnessCounts,
    missingFields,
    unnamedIncomplete
  };
}

const PCIE_REQUIRED_WIDTHS = [16, 8, 4, 1] as const satisfies readonly PcieSlotWidth[];

export function catalogPcieSlotCoverageFor(parts: Part[]): CatalogPcieSlotCoverage {
  const eligibleParts = parts.filter((part) => !catalogCategoryMismatchFor(part));
  const byRequiredWidth = Object.fromEntries(PCIE_REQUIRED_WIDTHS.map((requiredWidth) => {
    const complete = eligibleParts.filter((part) => pcieCompatibleSlotInventoryFor(part.specs, requiredWidth).complete).length;
    return [requiredWidth, {
      requiredWidth,
      total: eligibleParts.length,
      complete,
      missing: eligibleParts.length - complete,
      coveragePercent: coveragePercent(complete, eligibleParts.length)
    } satisfies CatalogPcieSlotCoverageEntry];
  })) as Record<PcieSlotWidth, CatalogPcieSlotCoverageEntry>;
  const excludedCategoryMismatchCount = parts.length - eligibleParts.length;
  return {
    total: eligibleParts.length,
    byRequiredWidth,
    ...(excludedCategoryMismatchCount > 0 ? {
      rawTotal: parts.length,
      excludedCategoryMismatchCount
    } : {})
  };
}

export function catalogPcieSlotCoverageDeltaFor(before: CatalogPcieSlotCoverage, after: CatalogPcieSlotCoverage): CatalogPcieSlotCoverageDelta {
  const byRequiredWidth = Object.fromEntries(PCIE_REQUIRED_WIDTHS.map((requiredWidth) => {
    const beforeEntry = before.byRequiredWidth[requiredWidth];
    const afterEntry = after.byRequiredWidth[requiredWidth];
    return [requiredWidth, {
      requiredWidth,
      complete: afterEntry.complete - beforeEntry.complete,
      missing: afterEntry.missing - beforeEntry.missing,
      coveragePercent: Number((afterEntry.coveragePercent - beforeEntry.coveragePercent).toFixed(1))
    } satisfies CatalogPcieSlotCoverageDeltaEntry];
  })) as Record<PcieSlotWidth, CatalogPcieSlotCoverageDeltaEntry>;
  return { byRequiredWidth };
}

export function catalogSpecCoverageFor(catalog: Part[], now: string | number = Date.now()): CatalogSpecCoverage {
  const partsByCategory = new Map<PartCategory, Part[]>(PART_CATEGORIES.map((category) => [category, []]));
  for (const part of catalog) partsByCategory.get(part.category)?.push(part);
  const categories = PART_CATEGORIES.map((category) => categoryCoverageFor(category, partsByCategory.get(category) ?? [], now));
  const pcieSlotCoverage = catalogPcieSlotCoverageFor(partsByCategory.get("motherboard") ?? []);
  const categoryIntegrity = catalogCategoryIntegritySummaryFor(catalog);
  const qualityCounts = emptyCounts(DATA_QUALITIES);
  const freshnessCounts = emptyCounts(DATA_FRESHNESSES);
  for (const category of categories) {
    for (const quality of DATA_QUALITIES) qualityCounts[quality] += category.qualityCounts[quality];
    for (const freshness of DATA_FRESHNESSES) freshnessCounts[freshness] += category.freshnessCounts[freshness];
  }
  const complete = categories.reduce((total, category) => total + category.complete, 0);
  const priceKnown = categories.reduce((total, category) => total + category.priceKnown, 0);
  return {
    total: catalog.length,
    complete,
    partial: catalog.length - complete,
    coveragePercent: coveragePercent(complete, catalog.length),
    priceKnown,
    priceUnknown: catalog.length - priceKnown,
    qualityCounts,
    freshnessCounts,
    categories,
    pcieSlotCoverage,
    categoryIntegrity
  };
}
