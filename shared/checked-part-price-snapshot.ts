import { BUILD_INPUT_MAX_ID_LENGTH, BUILD_INPUT_MAX_SELECTIONS_PER_LIST } from "./build-input-limits";
import { isKnownPrice, PART_CATEGORIES } from "./types";
import type { BuildSelection, Part, PartSelection } from "./types";

/** Unit prices read from the catalog used for a compatibility check. */
export interface CheckedPartPriceSnapshotEntry {
  partId: string;
  priceWon?: number;
  priceCheckedAt?: string;
}

/** Three bounded selection lists and the six single core-part selections. */
export const CHECKED_PART_PRICE_SNAPSHOT_MAX_ENTRIES = BUILD_INPUT_MAX_SELECTIONS_PER_LIST * 3 + 6;

/** Restores a bounded snapshot from saved JSON without accepting malformed prices. */
export function checkedPartPriceSnapshotFromUnknown(value: unknown): readonly CheckedPartPriceSnapshotEntry[] | undefined {
  if (!Array.isArray(value) || value.length > CHECKED_PART_PRICE_SNAPSHOT_MAX_ENTRIES) return undefined;
  const snapshot: CheckedPartPriceSnapshotEntry[] = [];
  const selectedIds = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
    const entry = item as Record<string, unknown>;
    if (typeof entry.partId !== "string" || !entry.partId.trim() || entry.partId.length > BUILD_INPUT_MAX_ID_LENGTH || selectedIds.has(entry.partId)) return undefined;
    if (entry.priceWon !== undefined && (typeof entry.priceWon !== "number" || !isKnownPrice(entry.priceWon))) return undefined;
    if (entry.priceCheckedAt !== undefined && (typeof entry.priceCheckedAt !== "string" || !Number.isFinite(Date.parse(entry.priceCheckedAt)))) return undefined;
    selectedIds.add(entry.partId);
    snapshot.push({
      partId: entry.partId,
      priceWon: entry.priceWon as number | undefined,
      priceCheckedAt: entry.priceCheckedAt as string | undefined
    });
  }
  return snapshot;
}

function selectionsFor(build: BuildSelection, category: Part["category"]): readonly PartSelection[] {
  if (category === "memory" || category === "ssd" || category === "hdd") {
    return build[category].slice(0, BUILD_INPUT_MAX_SELECTIONS_PER_LIST);
  }
  const selection = build[category];
  return selection ? [selection] : [];
}

/** Captures each selected core part once; quantity is applied by the price consumer. */
export function checkedPartPriceSnapshotFor(build: BuildSelection, catalog: readonly Part[]): CheckedPartPriceSnapshotEntry[] {
  const partMap = new Map(catalog.map((part) => [part.id, part]));
  const snapshot: CheckedPartPriceSnapshotEntry[] = [];
  const selectedIds = new Set<string>();
  for (const category of PART_CATEGORIES) {
    for (const selection of selectionsFor(build, category)) {
      if (selectedIds.has(selection.partId)) continue;
      selectedIds.add(selection.partId);
      const part = partMap.get(selection.partId);
      snapshot.push({
        partId: selection.partId,
        priceWon: part && isKnownPrice(part.priceWon) ? part.priceWon : undefined,
        priceCheckedAt: part?.priceCheckedAt
      });
    }
  }
  return snapshot;
}

/** Applies checked prices without replacing catalog identity, specs, or source evidence. */
export function applyCheckedPartPriceSnapshot(parts: readonly Part[], snapshot: readonly CheckedPartPriceSnapshotEntry[]): Part[] {
  const checkedPrices = new Map(snapshot.map((entry) => [entry.partId, entry]));
  return parts.map((part) => {
    const checkedPrice = checkedPrices.get(part.id);
    return checkedPrice
      ? { ...part, priceWon: checkedPrice.priceWon, priceCheckedAt: checkedPrice.priceCheckedAt }
      : part;
  });
}
