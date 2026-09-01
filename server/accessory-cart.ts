import type { AccessoryItem, AccessorySelection, BuildSelection } from "../shared/types";
import { isKnownPrice } from "../shared/types";

export function validateAccessorySelectionIds(selections: AccessorySelection[], accessories: AccessoryItem[]) {
  const known = new Set(accessories.map((item) => item.id));
  return selections.filter((selection) => !known.has(selection.accessoryId));
}

export function validateAccessoryTargetAccessoryIds(build: Pick<BuildSelection, "accessories">, accessories: AccessoryItem[]) {
  const accessoryMap = new Map(accessories.map((item) => [item.id, item]));
  const selectedFanHubIds = new Set((build.accessories ?? [])
    .filter((selection) => accessoryMap.get(selection.accessoryId)?.category === "fan_hub")
    .map((selection) => selection.accessoryId));
  return [...new Set((build.accessories ?? [])
    .filter((selection) => selection.targetAccessoryId !== undefined)
    .filter((selection) => accessoryMap.get(selection.accessoryId)?.category !== "cooling_fan" || !selectedFanHubIds.has(selection.targetAccessoryId!))
    .map((selection) => selection.targetAccessoryId!))];
}

export function validateRgbControllerAccessoryId(build: Pick<BuildSelection, "accessories" | "rgbControllerAccessoryId">, accessories: AccessoryItem[]) {
  if (!build.rgbControllerAccessoryId) return [];
  const selectedHubIds = new Set((build.accessories ?? [])
    .filter((selection) => accessories.find((item) => item.id === selection.accessoryId)?.category === "fan_hub")
    .map((selection) => selection.accessoryId));
  return selectedHubIds.has(build.rgbControllerAccessoryId) ? [] : [build.rgbControllerAccessoryId];
}

export function summarizeAccessorySelections(selections: AccessorySelection[], accessories: AccessoryItem[]) {
  const byId = new Map(accessories.map((item) => [item.id, item]));
  const lines = selections.map((selection) => {
    const item = byId.get(selection.accessoryId);
    return {
      selection,
      item,
      lineTotalWon: (item?.priceWon ?? 0) * selection.quantity
    };
  });
  return {
    totalPriceWon: lines.reduce((total, line) => total + line.lineTotalWon, 0),
    priceComplete: lines.every((line) => isKnownPrice(line.item?.priceWon)),
    itemCount: lines.reduce((total, line) => total + line.selection.quantity, 0),
    lines,
    invalidSelections: lines.filter((line) => !line.item).map((line) => line.selection)
  };
}
