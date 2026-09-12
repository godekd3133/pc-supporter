import type { CatalogBenchmarkCoverage, PartCategory } from "./types";
import type { CatalogSpecCoverage } from "./catalog-spec-coverage";
import type { PcieSlotWidth } from "./pcie-slot";

export type CatalogWorkPriorityKind = "spec" | "benchmark" | "pcie";

export interface CatalogWorkPriority {
  id: string;
  kind: CatalogWorkPriorityKind;
  category: PartCategory;
  total: number;
  complete: number;
  gapCount: number;
  coveragePercent: number;
  score: number;
  missingField?: string;
  missingFieldCount?: number;
  pcieRequiredWidth?: PcieSlotWidth;
}

const PRIORITY_RANK = { high: 3, medium: 2, low: 1, none: 0 } as const;

function boundedPercent(complete: number, total: number) {
  if (total <= 0) return 100;
  return Math.round((complete / total) * 1000) / 10;
}

function specPriorityFor(category: CatalogSpecCoverage["categories"][number]): CatalogWorkPriority | undefined {
  if (category.total <= 0 || category.partial <= 0) return undefined;
  const missing = category.missingFields[0];
  const gapPercent = 100 - category.coveragePercent;
  return {
    id: "spec:" + category.category,
    kind: "spec",
    category: category.category,
    total: category.total,
    complete: category.complete,
    gapCount: category.partial,
    coveragePercent: category.coveragePercent,
    score: (PRIORITY_RANK[category.priority] + 1) * 1_000 + gapPercent * 10 + category.partial / Math.max(category.total, 1),
    ...(missing ? { missingField: missing.field, missingFieldCount: missing.count } : {})
  };
}

function benchmarkPriorityFor(category: "cpu" | "gpu", coverage: CatalogBenchmarkCoverage["cpu"] | CatalogBenchmarkCoverage["gpu"]): CatalogWorkPriority | undefined {
  const complete = "cinebenchR23Complete" in coverage ? coverage.cinebenchR23Complete : coverage.threeDMarkComplete;
  const total = coverage.total;
  const gapCount = Math.max(0, total - complete);
  if (total <= 0 || gapCount <= 0) return undefined;
  const coveragePercent = boundedPercent(complete, total);
  return {
    id: "benchmark:" + category,
    kind: "benchmark",
    category,
    total,
    complete,
    gapCount,
    coveragePercent,
    score: (category === "gpu" ? 5_000 : 2_500) + (100 - coveragePercent) * 10 + gapCount / Math.max(total, 1)
  };
}

function pciePriorityFor(coverage: CatalogSpecCoverage | undefined): CatalogWorkPriority | undefined {
  const pcieCoverage = coverage?.pcieSlotCoverage?.byRequiredWidth[4];
  if (!pcieCoverage || pcieCoverage.total <= 0 || pcieCoverage.missing <= 0) return undefined;
  return {
    id: "pcie:motherboard",
    kind: "pcie",
    category: "motherboard",
    total: pcieCoverage.total,
    complete: pcieCoverage.complete,
    gapCount: pcieCoverage.missing,
    coveragePercent: pcieCoverage.coveragePercent,
    score: 4_000 + (100 - pcieCoverage.coveragePercent) * 10 + pcieCoverage.missing / Math.max(pcieCoverage.total, 1),
    pcieRequiredWidth: 4
  };
}

export function catalogWorkPriorityFor(coverage: CatalogSpecCoverage | undefined, benchmarkCoverage: CatalogBenchmarkCoverage | undefined, limit = 4): CatalogWorkPriority[] {
  const actions = [
    ...(coverage?.categories.map(specPriorityFor).filter((action): action is CatalogWorkPriority => Boolean(action)) ?? []),
    ...([pciePriorityFor(coverage)].filter((action): action is CatalogWorkPriority => Boolean(action))),
    ...(benchmarkCoverage ? [benchmarkPriorityFor("cpu", benchmarkCoverage.cpu), benchmarkPriorityFor("gpu", benchmarkCoverage.gpu)].filter((action): action is CatalogWorkPriority => Boolean(action)) : [])
  ];
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(12, Math.floor(limit))) : 4;
  return actions
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, boundedLimit);
}
