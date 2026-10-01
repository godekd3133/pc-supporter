import type { BuildSelection, CompatibilityResult, Part, PartCategory, PartSelection } from "./types";
import { evaluateBuild } from "./domain/engine";
import { isCurrentGenerationPart, isQuotePurchasable, isQuoteSelectable } from "./domain/listing";

export type PartAdjustmentDirection = "upgrade" | "downgrade";

export interface PartAdjustmentSuggestion {
  category: PartCategory;
  direction: PartAdjustmentDirection;
  part: Part;
  entry: PartSelection;
  selection: BuildSelection;
  beforePriceWon: number;
  afterPriceWon: number;
  status: CompatibilityResult["status"];
}

export interface PartAdjustmentResult {
  suggestion?: PartAdjustmentSuggestion;
  alternatives: Part[];
  reason?: "no-candidates" | "no-compatible-candidate";
}

/** + 버튼용 카테고리. 배열 슬롯(memory/ssd/hdd)은 첫 항목을 강화/약화 대상으로 본다. */
export const ADJUSTABLE_CATEGORIES = ["cpu", "gpu", "motherboard", "cooler", "case", "psu", "memory", "ssd", "hdd"] as const satisfies readonly PartCategory[];

const ARRAY_SLOT_CATEGORIES = new Set<PartCategory>(["memory", "ssd", "hdd"]);
const MAX_ADJUSTMENT_EVALUATIONS = 24;

function currentEntryFor(selection: BuildSelection, category: PartCategory): PartSelection | undefined {
  const slot = selection[category as keyof BuildSelection];
  if (Array.isArray(slot)) return (slot as PartSelection[])[0];
  return slot as PartSelection | undefined;
}

function selectionWithReplacement(selection: BuildSelection, category: PartCategory, entry: PartSelection): BuildSelection {
  if (ARRAY_SLOT_CATEGORIES.has(category)) {
    const next = [...((selection[category as keyof BuildSelection] as PartSelection[] | undefined) ?? [])];
    next[0] = entry;
    return { ...selection, [category]: next };
  }
  return { ...selection, [category]: entry };
}

function adjustmentCandidatesFor(catalog: readonly Part[], category: PartCategory, current: Part | undefined): Part[] {
  return catalog
    .filter((part) => part.category === category && part.id !== current?.id)
    .filter((part) => (part.dataQuality === "seed" ? isQuotePurchasable(part) : isQuoteSelectable(part, catalog)))
    .filter((part) => part.dataQuality === "seed" || isCurrentGenerationPart(part, catalog))
    .filter((part) => part.priceWon !== undefined && part.priceWon > 0)
    .sort((a, b) => (a.priceWon ?? 0) - (b.priceWon ?? 0));
}

/**
 * 현재 견적에서 특정 카테고리 부품을 한 단계 강화(upgrade)/약화(downgrade)한 호환 대안을 제안한다.
 * 가격 인접 후보부터 실제 호환 평가(evaluateBuild)로 검증해 blocker가 없는 첫 후보를 고른다.
 */
export function suggestPartAdjustment(
  catalog: Part[],
  selection: BuildSelection,
  category: PartCategory,
  direction: PartAdjustmentDirection
): PartAdjustmentResult {
  const partMap = new Map(catalog.map((part) => [part.id, part]));
  const currentEntry = currentEntryFor(selection, category);
  const currentPart = currentEntry ? partMap.get(currentEntry.partId) : undefined;
  const beforePriceWon = catalog
    .filter((part) => new Set(collectPartIds(selection)).has(part.id))
    .reduce((sum, part) => sum + (part.priceWon ?? 0) * (quantityOf(selection, part.id) || 1), 0);

  const ordered = adjustmentCandidatesFor(catalog, category, currentPart)
    .filter((part) => direction === "upgrade" ? (part.priceWon ?? 0) >= (currentPart?.priceWon ?? 0) * 1.02 : (part.priceWon ?? 0) <= (currentPart?.priceWon ?? Number.POSITIVE_INFINITY) * 0.98);
  if (direction === "downgrade") ordered.reverse();
  if (ordered.length === 0) return { alternatives: [], reason: "no-candidates" };

  const compatible: PartAdjustmentSuggestion[] = [];
  let evaluated = 0;
  for (const part of ordered) {
    if (evaluated >= MAX_ADJUSTMENT_EVALUATIONS || compatible.length >= 3) break;
    const entry: PartSelection = { partId: part.id, quantity: ARRAY_SLOT_CATEGORIES.has(category) ? (currentEntry?.quantity ?? 1) : 1 };
    const next = selectionWithReplacement(selection, category, entry);
    const result = evaluateBuild(next, catalog, { includeSuggestions: false });
    evaluated += 1;
    if (result.status === "incompatible") continue;
    const afterPriceWon = beforePriceWon - (currentPart?.priceWon ?? 0) * (currentEntry?.quantity ?? 1) + (part.priceWon ?? 0) * entry.quantity;
    compatible.push({ category, direction, part, entry, selection: next, beforePriceWon, afterPriceWon, status: result.status });
  }
  if (compatible.length === 0) return { alternatives: [], reason: "no-compatible-candidate" };
  return { suggestion: compatible[0], alternatives: compatible.slice(1).map((suggestion) => suggestion.part) };
}

function collectPartIds(selection: BuildSelection): string[] {
  const ids: string[] = [];
  for (const key of ["cpu", "cooler", "motherboard", "gpu", "case", "psu"] as const) {
    const entry = selection[key];
    if (entry) ids.push(entry.partId);
  }
  for (const key of ["memory", "ssd", "hdd"] as const) for (const entry of selection[key] ?? []) ids.push(entry.partId);
  return ids;
}

function quantityOf(selection: BuildSelection, partId: string): number {
  for (const key of ["cpu", "cooler", "motherboard", "gpu", "case", "psu"] as const) if (selection[key]?.partId === partId) return selection[key]?.quantity ?? 1;
  for (const key of ["memory", "ssd", "hdd"] as const) {
    const hit = (selection[key] ?? []).find((entry) => entry.partId === partId);
    if (hit) return hit.quantity ?? 1;
  }
  return 1;
}
