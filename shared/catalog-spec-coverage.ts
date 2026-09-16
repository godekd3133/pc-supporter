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
  tdpW: "TDP",
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
  radiatorSizeMm: "라디에이터 크기",
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
  maxPsuLengthMm: "PSU 허용 길이",
  "internal storage device": "저장장치 종류",
  "12V output": "12V 출력",
  connectors: "커넥터",
  efficiency: "효율",
  pcieX16Slots: "PCIe x16 슬롯",
  pcieX8Slots: "PCIe x8 슬롯",
  pcieX4Slots: "PCIe x4 슬롯",
  pcieX1Slots: "PCIe x1 슬롯",
  "detail page": "상세 페이지",
  specification: "상세 스펙",
  "3.5-inch bays": "3.5인치 베이",
  "CPU power": "CPU 소비전력",
  "CPU socket": "CPU 소켓",
  "CPU supported memory speed": "CPU 지원 메모리 속도",
  "case maximum PSU length": "케이스 PSU 허용 길이",
  "case radiator support": "케이스 라디에이터 지원",
  "case supported PSU form factors": "케이스 지원 PSU 규격",
  "GPU PCIe power connector": "GPU 보조전원 커넥터",
  "GPU length": "GPU 길이",
  "GPU power": "GPU 소비전력",
  "GPU thickness": "GPU 두께",
  "HDD interface": "HDD 연결 방식",
  "M.2 SSD interface": "M.2 SSD 인터페이스",
  "M.2 slots": "M.2 슬롯",
  "memory speed": "메모리 속도",
  "Motherboard socket": "메인보드 소켓",
  "motherboard M.2 interfaces": "메인보드 M.2 인터페이스",
  "motherboard supported memory speed": "메인보드 지원 메모리 속도",
  "PSU depth": "PSU 깊이",
  "PSU form factor": "PSU 폼팩터",
  "PSU PCIe power connectors": "파워 보조전원 커넥터",
  "PSU wattage": "파워 정격 출력",
  "radiator size": "라디에이터 크기",
  "VRM capacity": "메인보드 전원부 용량",
  "cooler supported sockets": "쿨러 지원 소켓",
  "integrated graphics": "내장 그래픽",
  "maximum GPU length": "GPU 허용 길이",
  "maximum memory capacity": "최대 메모리 용량",
  "memory slot form factor": "메모리 슬롯 규격",
  "memory slots": "메모리 슬롯",
  "memory type": "메모리 세대",
  "module capacity": "모듈 용량",
  "motherboard PCIe x16 slots": "메인보드 PCIe x16 슬롯",
  "motherboard PCIe x8/x16 slots": "메인보드 PCIe 슬롯",
  "motherboard RGB header voltage": "메인보드 RGB 전압",
  "motherboard RGB/ARGB headers": "메인보드 RGB 헤더",
  "motherboard fan headers": "메인보드 팬 헤더",
  "motherboard memory profiles": "메인보드 메모리 프로파일",
  "recommended PSU wattage": "권장 파워 출력",
  "supported memory speed": "지원 메모리 속도",
  "supported motherboard form factors": "지원 메인보드 규격"
};

export function catalogMissingFieldLabelFor(field: string) {
  return CATALOG_MISSING_FIELD_LABELS[field] ?? field;
}

const CATALOG_CHANGE_SPEC_FIELD_PREFIX = "정규화 스펙 · ";

export function catalogChangeFieldLabelFor(field: string) {
  if (field === "원문 스펙") return "수집된 스펙";
  if (field === "정규화 스펙") return "스펙 정보";
  if (field.startsWith(CATALOG_CHANGE_SPEC_FIELD_PREFIX)) return `스펙 · ${field.slice(CATALOG_CHANGE_SPEC_FIELD_PREFIX.length)}`;
  return field;
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
