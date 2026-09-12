import type { AccessoryItem, AccessorySelection, BuildSelection, Part, PartCategory, PartSelection } from "../shared/types";
import { validateAccessorySelectionIds, validateAccessoryTargetAccessoryIds, validateRgbControllerAccessoryId } from "./accessory-cart";
import { findPart } from "./catalog";

export function validateBuildPartIds(build: BuildSelection, catalog: Part[]) {
  const selections: Array<{ category: PartCategory; selection?: PartSelection }> = [
    { category: "cpu", selection: build.cpu },
    { category: "cooler", selection: build.cooler },
    { category: "motherboard", selection: build.motherboard },
    { category: "gpu", selection: build.gpu },
    { category: "case", selection: build.case },
    { category: "psu", selection: build.psu },
    ...build.memory.map((selection) => ({ category: "memory" as const, selection })),
    ...build.ssd.map((selection) => ({ category: "ssd" as const, selection })),
    ...build.hdd.map((selection) => ({ category: "hdd" as const, selection }))
  ];
  return selections
    .filter((entry) => {
      if (!entry.selection) return false;
      const part = findPart(catalog, entry.selection.partId);
      return !part || part.category !== entry.category;
    })
    .flatMap((entry) => entry.selection ? [entry.selection] : []);
}

export function validateAccessoryTargetPartIds(build: BuildSelection, catalog: Part[]) {
  const selectedSsdIds = new Set(build.ssd.map((selection) => selection.partId).filter((partId) => findPart(catalog, partId)?.category === "ssd"));
  return (build.accessories ?? [])
    .filter((selection) => selection.targetPartId !== undefined && !selectedSsdIds.has(selection.targetPartId))
    .map((selection) => selection.targetPartId as string);
}

export type BuildSelectionValidation = {
  invalidSelections: PartSelection[];
  invalidAccessories: AccessorySelection[];
  invalidAccessoryTargets: string[];
  invalidAccessoryHubTargets: string[];
  invalidRgbControllerAccessoryIds: string[];
};

/** Validates every catalog relationship carried by one parsed build selection. */
export function validateBuildSelection(
  build: BuildSelection,
  catalog: Part[],
  accessories: AccessoryItem[]
): BuildSelectionValidation {
  return {
    invalidSelections: validateBuildPartIds(build, catalog),
    invalidAccessories: validateAccessorySelectionIds(build.accessories ?? [], accessories),
    invalidAccessoryTargets: validateAccessoryTargetPartIds(build, catalog),
    invalidAccessoryHubTargets: validateAccessoryTargetAccessoryIds(build, accessories),
    invalidRgbControllerAccessoryIds: validateRgbControllerAccessoryId(build, accessories)
  };
}
