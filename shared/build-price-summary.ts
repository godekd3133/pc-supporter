import type { AccessoryItem, AccessorySelection, BuildSelection, CatalogPriceEvidence, Part, PartCategory, PartSelection } from "./types";
import { isKnownPrice, PART_CATEGORIES } from "./types";
import { catalogPriceEvidenceFor } from "./catalog-price-evidence";

export interface BuildPriceSnapshot {
  coreTotalPriceWon: number;
  accessoryTotalPriceWon: number;
  totalPriceWon: number;
  corePriceComplete: boolean;
  accessoryPriceComplete: boolean;
  priceComplete: boolean;
  unknownPriceCount: number;
  /** Number of selected rows whose numeric price is not live/manual confirmed. */
  priceEvidenceReviewCount?: number;
}

function selectionsForCategory(build: BuildSelection, category: PartCategory): PartSelection[] {
  if (category === "memory") return build.memory;
  if (category === "ssd") return build.ssd;
  if (category === "hdd") return build.hdd;
  const selection = build[category];
  return selection ? [selection] : [];
}

function accessorySelectionsFor(build: BuildSelection): AccessorySelection[] {
  return build.accessories ?? [];
}

export function buildPriceSnapshotFor(build: BuildSelection, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>, extraParts: Part[] = []): BuildPriceSnapshot {
  const knownParts = new Map(partMap);
  extraParts.forEach((part) => knownParts.set(part.id, part));
  const unknownPriceIds = new Set<string>();
  let priceEvidenceReviewCount = 0;
  const recordPriceEvidence = (evidence: CatalogPriceEvidence) => {
    if (evidence !== "live" && evidence !== "manual") priceEvidenceReviewCount += 1;
  };
  let corePriceComplete = true;
  let coreTotalPriceWon = 0;
  for (const category of PART_CATEGORIES) {
    for (const selection of selectionsForCategory(build, category)) {
      const part = knownParts.get(selection.partId);
      if (!part || !isKnownPrice(part.priceWon)) {
        unknownPriceIds.add(`part:${selection.partId}`);
        recordPriceEvidence(part ? catalogPriceEvidenceFor(part) : "unknown");
        corePriceComplete = false;
        continue;
      }
      recordPriceEvidence(catalogPriceEvidenceFor(part));
      coreTotalPriceWon += part.priceWon * selection.quantity;
    }
  }
  let accessoryPriceComplete = true;
  let accessoryTotalPriceWon = 0;
  for (const selection of accessorySelectionsFor(build)) {
    const item = accessoryMap.get(selection.accessoryId);
    if (!item || !isKnownPrice(item.priceWon)) {
      unknownPriceIds.add(`accessory:${selection.accessoryId}`);
      recordPriceEvidence(item ? catalogPriceEvidenceFor(item) : "unknown");
      accessoryPriceComplete = false;
      continue;
    }
    recordPriceEvidence(catalogPriceEvidenceFor(item));
    accessoryTotalPriceWon += item.priceWon * selection.quantity;
  }
  return {
    coreTotalPriceWon,
    accessoryTotalPriceWon,
    totalPriceWon: coreTotalPriceWon + accessoryTotalPriceWon,
    corePriceComplete,
    accessoryPriceComplete,
    priceComplete: unknownPriceIds.size === 0,
    unknownPriceCount: unknownPriceIds.size,
    ...(priceEvidenceReviewCount > 0 ? { priceEvidenceReviewCount } : {})
  };
}
