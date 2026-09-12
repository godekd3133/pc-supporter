import type { DataQuality, Part, PartCategory } from "./types";
import { PART_CATEGORIES } from "./types";

export type CatalogSeedPreviewDifference = "name" | "price" | "specs";

export interface CatalogSeedPreviewCategoryRow {
  category: PartCategory;
  starterCount: number;
  activeCount: number;
  matchedCount: number;
  missingCount: number;
  coveragePercent: number;
}

export interface CatalogSeedPreviewConflict {
  id: string;
  category: PartCategory;
  starterName: string;
  activeName: string;
  activeSource: Part["source"];
  activeDataQuality: DataQuality;
  differences: CatalogSeedPreviewDifference[];
}

export interface CatalogSeedPreview {
  schemaVersion: 1;
  kind: "catalog-seed-preview";
  generatedAt: string;
  readOnly: true;
  starter: {
    total: number;
    categoryCounts: Record<PartCategory, number>;
  };
  active: {
    total: number;
    coreEligibleCount?: number;
    excludedNonCoreCount?: number;
    categoryCounts: Record<PartCategory, number>;
    sourceCounts: Record<Part["source"], number>;
    qualityCounts: Record<DataQuality, number>;
  };
  coverage: {
    matchedCount: number;
    missingCount: number;
    conflictCount: number;
    coveragePercent: number;
  };
  categoryRows: CatalogSeedPreviewCategoryRow[];
  missingItems: Array<{
    id: string;
    category: PartCategory;
    name: string;
    brand?: string;
    model?: string;
    priceWon?: number;
  }>;
  conflicts: CatalogSeedPreviewConflict[];
}

const DATA_QUALITY_KEYS = ["seed", "live", "manual", "incomplete"] as const;
const SOURCE_KEYS = ["seed", "danawa", "manual"] as const;

function emptyCategoryCounts() {
  return Object.fromEntries(PART_CATEGORIES.map((category) => [category, 0])) as Record<PartCategory, number>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function specsFingerprint(part: Part) {
  return JSON.stringify(canonicalize(part.specs));
}

function partKey(part: Part) {
  return `${part.category}:${part.id}`;
}

function categoryIndex(category: PartCategory) {
  return PART_CATEGORIES.indexOf(category);
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

export function catalogSeedPreviewFor(
  starterCatalog: Part[],
  activeCatalog: Part[],
  options: { generatedAt?: string; coreEligibleCount?: number; excludedNonCoreCount?: number } = {}
): CatalogSeedPreview {
  const starterCategoryCounts = emptyCategoryCounts();
  const activeCategoryCounts = emptyCategoryCounts();
  const sourceCounts = Object.fromEntries(SOURCE_KEYS.map((source) => [source, 0])) as Record<Part["source"], number>;
  const qualityCounts = Object.fromEntries(DATA_QUALITY_KEYS.map((quality) => [quality, 0])) as Record<DataQuality, number>;
  const activeByKey = new Map(activeCatalog.map((part) => [partKey(part), part]));

  for (const part of starterCatalog) starterCategoryCounts[part.category] += 1;
  for (const part of activeCatalog) {
    activeCategoryCounts[part.category] += 1;
    sourceCounts[part.source] += 1;
    qualityCounts[part.dataQuality] += 1;
  }

  const categoryRows = PART_CATEGORIES.map((category) => ({
    category,
    starterCount: starterCategoryCounts[category],
    activeCount: activeCategoryCounts[category],
    matchedCount: 0,
    missingCount: 0,
    coveragePercent: 0
  }));
  const categoryRowByCategory = new Map(categoryRows.map((row) => [row.category, row]));
  const missingItems: CatalogSeedPreview["missingItems"] = [];
  const conflicts: CatalogSeedPreviewConflict[] = [];
  let matchedCount = 0;

  for (const starterPart of starterCatalog) {
    const activePart = activeByKey.get(partKey(starterPart));
    const row = categoryRowByCategory.get(starterPart.category);
    if (!row) continue;
    if (!activePart) {
      row.missingCount += 1;
      missingItems.push({
        id: starterPart.id,
        category: starterPart.category,
        name: starterPart.name,
        ...(starterPart.brand ? { brand: starterPart.brand } : {}),
        ...(starterPart.model ? { model: starterPart.model } : {}),
        ...(starterPart.priceWon !== undefined ? { priceWon: starterPart.priceWon } : {})
      });
      continue;
    }
    matchedCount += 1;
    row.matchedCount += 1;
    const differences: CatalogSeedPreviewDifference[] = [];
    if (starterPart.name !== activePart.name) differences.push("name");
    if (starterPart.priceWon !== activePart.priceWon) differences.push("price");
    if (specsFingerprint(starterPart) !== specsFingerprint(activePart)) differences.push("specs");
    if (differences.length > 0) {
      conflicts.push({
        id: starterPart.id,
        category: starterPart.category,
        starterName: starterPart.name,
        activeName: activePart.name,
        activeSource: activePart.source,
        activeDataQuality: activePart.dataQuality,
        differences
      });
    }
  }

  for (const row of categoryRows) {
    row.coveragePercent = row.starterCount === 0 ? 100 : roundPercent((row.matchedCount / row.starterCount) * 100);
  }
  missingItems.sort((left, right) => categoryIndex(left.category) - categoryIndex(right.category) || left.name.localeCompare(right.name, "ko-KR"));
  conflicts.sort((left, right) => categoryIndex(left.category) - categoryIndex(right.category) || left.starterName.localeCompare(right.starterName, "ko-KR"));

  const total = starterCatalog.length;
  return {
    schemaVersion: 1,
    kind: "catalog-seed-preview",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    readOnly: true,
    starter: { total, categoryCounts: starterCategoryCounts },
    active: {
      total: activeCatalog.length,
      ...(options.coreEligibleCount !== undefined ? { coreEligibleCount: options.coreEligibleCount } : {}),
      ...(options.excludedNonCoreCount !== undefined ? { excludedNonCoreCount: options.excludedNonCoreCount } : {}),
      categoryCounts: activeCategoryCounts,
      sourceCounts,
      qualityCounts
    },
    coverage: {
      matchedCount,
      missingCount: Math.max(0, total - matchedCount),
      conflictCount: conflicts.length,
      coveragePercent: total === 0 ? 100 : roundPercent((matchedCount / total) * 100)
    },
    categoryRows,
    missingItems,
    conflicts
  };
}
