import type { AccessoryItem, BuildSelection, Part, PartCategory, SavedBuildSummary } from "../shared/types";
import { PART_CATEGORIES } from "../shared/types";
import { summarizeAccessorySelections } from "./accessory-cart";
import { evaluateBuild } from "./engine";

function coreSelections(selection: BuildSelection, category: PartCategory) {
  if (category === "memory") return selection.memory;
  if (category === "ssd") return selection.ssd;
  if (category === "hdd") return selection.hdd;
  const item = selection[category];
  return item ? [item] : [];
}

export function summarizeSavedBuild(selection: BuildSelection, catalog: Part[], accessories: AccessoryItem[]): SavedBuildSummary {
  const coreResult = evaluateBuild(selection, catalog, { includeSuggestions: false });
  const accessorySummary = summarizeAccessorySelections(selection.accessories ?? [], accessories);
  const coreLines = PART_CATEGORIES.flatMap((category) => coreSelections(selection, category).map((item) => ({
    category,
    name: catalog.find((part) => part.id === item.partId)?.name ?? item.partId,
    quantity: item.quantity
  })));
  const accessoryLines = accessorySummary.lines.map(({ selection: itemSelection, item }) => ({
    category: item?.category,
    name: item?.name ?? itemSelection.accessoryId,
    quantity: itemSelection.quantity
  }));
  return {
    totalPriceWon: coreResult.totalPriceWon + accessorySummary.totalPriceWon,
    coreTotalPriceWon: coreResult.totalPriceWon,
    accessoryTotalPriceWon: accessorySummary.totalPriceWon,
    priceComplete: coreResult.priceComplete && accessorySummary.priceComplete,
    accessoryCount: accessorySummary.lines.length,
    accessoryQuantity: accessorySummary.itemCount,
    coreLines,
    accessoryLines
  };
}
