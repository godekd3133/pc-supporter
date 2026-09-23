// Shared result/history domain helpers used by lazy views.
import { buildPriceSnapshotFor } from "../shared/build-price-summary";
import { type AccessoryItem, type BuildSelection, type CompatibilityResult, type Part, type PhysicalEvidenceSource, type RecommendationPlan, type RecommendationPreferences, type SavedBuild, PART_CATEGORIES } from "../shared/types";
import { safeHttpsUrl } from "./safe-source-url";
import { accessorySelections, selectionList } from "./build-edit";

export function sharedPhysicalEvidenceSources(sources: PhysicalEvidenceSource[] | undefined) {
  return (sources ?? []).flatMap((source) => {
    const note = typeof source.note === "string" && source.note.trim() ? source.note.trim() : undefined;
    if (!note || !["gpu", "case", "psu"].includes(source.category)) return [];
    const manufacturerModel = source.manufacturerModel?.trim();
    const manufacturerRevision = source.manufacturerRevision?.trim();
    const updatedAt = typeof source.updatedAt === "string" && source.updatedAt.trim() ? source.updatedAt.trim() : undefined;
    const url = safeHttpsUrl(source.url);
    return [{ category: source.category, note, ...(manufacturerModel ? { manufacturerModel } : {}), ...(manufacturerRevision ? { manufacturerRevision } : {}), ...(updatedAt ? { updatedAt } : {}), ...(url ? { url } : {}) } satisfies PhysicalEvidenceSource];
  });
}

export function sharedPhysicalEvidenceSourceLabel(category: PhysicalEvidenceSource["category"]) {
  return category === "gpu" ? "GPU" : category === "case" ? "케이스" : "PSU";
}

export function sharedPhysicalEvidenceSourceIdentity(source: PhysicalEvidenceSource) {
  return `${sharedPhysicalEvidenceSourceLabel(source.category)}${source.manufacturerModel ? ` · ${source.manufacturerModel}` : ""}${source.manufacturerRevision ? ` · ${source.manufacturerRevision}` : ""}`;
}

export function scenarioStatusLabel(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "정보 부족" : "호환 불가";
}

export function scenarioRiskText(result: CompatibilityResult) {
  return `호환 불가 ${result.blockerCount}개 · 주의 ${result.warningCount}개 · 정보 부족 ${result.unknownCount}개`;
}

export function currentDraftComparisonFor(build: BuildSelection, preferences: RecommendationPreferences, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>): SavedBuild {
  const price = buildPriceSnapshotFor(build, partMap, accessoryMap);
  const coreLines = PART_CATEGORIES.flatMap((category) => selectionList(build, category).map((selection) => ({
    category,
    name: partMap.get(selection.partId)?.name ?? selection.partId,
    quantity: selection.quantity
  })));
  const accessoryLines = accessorySelections(build).map((selection) => ({
    category: accessoryMap.get(selection.accessoryId)?.category,
    name: accessoryMap.get(selection.accessoryId)?.name ?? selection.accessoryId,
    quantity: selection.quantity
  }));
  return {
    id: "current-draft",
    name: "현재 편집기 견적",
    selection: build,
    recommendationPreferences: preferences,
    summary: {
      totalPriceWon: price.totalPriceWon,
      coreTotalPriceWon: price.coreTotalPriceWon,
      accessoryTotalPriceWon: price.accessoryTotalPriceWon,
      priceComplete: price.priceComplete,
      accessoryCount: accessoryLines.length,
      accessoryQuantity: accessoryLines.reduce((total, line) => total + line.quantity, 0),
      coreLines,
      accessoryLines
    },
    createdAt: "current-draft",
    updatedAt: "current-draft"
  };
}

export function repairPlanKey(plan: RecommendationPlan) {
  return plan.changes.map((change) => `${change.category}:${change.kind}:${change.toPart.id}:${change.toQuantity ?? ""}`).sort().join("|");
}
