import type { AccessoryCategory, AccessoryCategoryCoverage, AccessoryCoverageSnapshot } from "./types";

export interface AccessoryWorkPriority {
  id: string;
  category: AccessoryCategory;
  total: number;
  complete: number;
  gapCount: number;
  incompleteProductCount: number;
  incompleteSpecCount: number;
  coveragePercent: number;
  score: number;
  specCoverage: "partial" | "complete";
  details: boolean;
}

function coveragePercent(complete: number, total: number) {
  if (total <= 0) return 100;
  return Math.round((complete / total) * 1000) / 10;
}

export function accessoryCoverageGapFor(category: AccessoryCategoryCoverage) {
  const total = Math.max(0, category.storedProductCount);
  return Math.min(total, Math.max(0, category.incompleteProducts, category.incompleteSpecs));
}

export function accessoryCoveragePercentFor(category: AccessoryCategoryCoverage) {
  const total = Math.max(0, category.storedProductCount);
  return coveragePercent(total - accessoryCoverageGapFor(category), total);
}

export function accessoryWorkPriorityFor(snapshot: AccessoryCoverageSnapshot | undefined, limit = 3): AccessoryWorkPriority[] {
  const actions = (snapshot?.categories ?? [])
    .map((category): AccessoryWorkPriority | undefined => {
      const total = Math.max(0, category.storedProductCount);
      const incompleteProductCount = Math.min(total, Math.max(0, category.incompleteProducts));
      const incompleteSpecCount = Math.min(total, Math.max(0, category.incompleteSpecs));
      const gapCount = accessoryCoverageGapFor(category);
      if (total <= 0 || (gapCount <= 0 && category.storedSpecCoverage === "complete")) return undefined;
      const complete = total - gapCount;
      const percent = accessoryCoveragePercentFor(category);
      return {
        id: "accessory:" + category.category,
        category: category.category,
        total,
        complete,
        gapCount,
        incompleteProductCount,
        incompleteSpecCount,
        coveragePercent: percent,
        score: incompleteProductCount / Math.max(total, 1) * 2_000 + incompleteSpecCount / Math.max(total, 1) * 1_000 + (category.details ? 0 : 250) + (category.storedSpecCoverage === "complete" ? 0 : 100),
        specCoverage: category.storedSpecCoverage,
        details: category.details
      };
    })
    .filter((action): action is AccessoryWorkPriority => Boolean(action));
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(10, Math.floor(limit))) : 3;
  return actions
    .sort((left, right) => right.score - left.score || right.gapCount - left.gapCount || left.id.localeCompare(right.id))
    .slice(0, boundedLimit);
}
