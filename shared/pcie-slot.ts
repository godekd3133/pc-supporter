import type { PartSpecs } from "./types";

export type PcieSlotWidth = 1 | 4 | 8 | 16;
export type PcieSlotField = keyof Pick<PartSpecs, "pcieX1Slots" | "pcieX4Slots" | "pcieX8Slots" | "pcieX16Slots">;

export function pcieSlotWidthFromUnknown(value: unknown): PcieSlotWidth | undefined {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number(value)
      : Number.NaN;
  return numeric === 1 || numeric === 4 || numeric === 8 || numeric === 16 ? numeric : undefined;
}

const PCIE_SLOT_FIELDS: Record<PcieSlotWidth, PcieSlotField> = {
  1: "pcieX1Slots",
  4: "pcieX4Slots",
  8: "pcieX8Slots",
  16: "pcieX16Slots"
};

export function pcieSlotEvidenceMissingFieldsFor(specs: PartSpecs): PcieSlotField[] {
  return pcieCompatibleSlotWidthsFor(1)
    .filter((width) => specs[PCIE_SLOT_FIELDS[width]] === undefined)
    .map((width) => PCIE_SLOT_FIELDS[width]);
}

export function pcieCompatibleSlotWidthsFor(requiredWidth: PcieSlotWidth) {
  return ([16, 8, 4, 1] as const).filter((width) => width >= requiredWidth);
}

export function pcieCompatibleSlotInventoryFor(specs: PartSpecs, requiredWidth: PcieSlotWidth) {
  const widths = pcieCompatibleSlotWidthsFor(requiredWidth);
  const unknownWidths = widths.filter((width) => specs[PCIE_SLOT_FIELDS[width]] === undefined);
  const knownSlotCount = widths.reduce((total, width) => total + (specs[PCIE_SLOT_FIELDS[width]] ?? 0), 0);
  return {
    requiredWidth,
    widths,
    knownSlotCount,
    unknownWidths,
    complete: unknownWidths.length === 0
  };
}

export function pcieSlotInventoryText(specs: PartSpecs) {
  return ([16, 8, 4, 1] as const)
    .map((width) => `x${width} ${specs[PCIE_SLOT_FIELDS[width]] === undefined ? "확인 필요" : `${specs[PCIE_SLOT_FIELDS[width]]}개`}`)
    .join(" · ");
}
