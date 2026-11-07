import { type Part, type PartCategory, type PartSelection, type BuildSelection } from "../../types";
import { selectedPart, formatPrice, buildPriceInfo } from "./core";

export function selectionFromCatalog(catalog: Part[], category: PartCategory, partId: string): PartSelection | undefined {
  return catalog.some((part) => part.category === category && part.id === partId)
    ? { partId, quantity: 1 }
    : undefined;
}

export function selectedPartSummary(catalog: Part[], selection: PartSelection | undefined) {
  const part = selectedPart(catalog, selection);
  return part
    ? {
        id: part.id,
        name: part.name,
        category: part.category,
        priceWon: part.priceWon,
        dataQuality: part.dataQuality
      }
    : undefined;
}

export function formatBuildPrice(catalog: Part[], build: BuildSelection) {
  return formatPrice(buildPriceInfo(catalog, build).total);
}
