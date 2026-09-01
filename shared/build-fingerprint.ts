import type { AccessorySelection, BuildSelection, RecommendationPreferences } from "./types";

type FingerprintSelection = {
  partId: string;
  quantity: number;
};

function normalizeSelection(selection: FingerprintSelection | undefined) {
  return selection
    ? { partId: selection.partId, quantity: selection.quantity }
    : null;
}

function normalizeSelections(selections: FingerprintSelection[] | undefined) {
  return (selections ?? []).map((selection) => normalizeSelection(selection));
}

function normalizeAccessorySelections(selections: AccessorySelection[] | undefined) {
  return (selections ?? []).map((selection) => ({
    partId: selection.accessoryId,
    quantity: selection.quantity,
    targetPartId: selection.targetPartId ?? null,
    targetAccessoryId: selection.targetAccessoryId ?? null
  }));
}

function normalizeSlotSelection(selection: Record<string, string> | undefined) {
  return Object.entries(selection ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slotId, partId]) => [slotId, partId]);
}

/**
 * Returns a deterministic key for the exact inputs that affect a compatibility check.
 * It intentionally includes recommendation preferences because they change the
 * explanation and candidate ranking even when the selected hardware is unchanged.
 */
export function buildCompatibilityInputFingerprint(build: BuildSelection, preferences: RecommendationPreferences) {
  return JSON.stringify({
    build: {
      cpu: normalizeSelection(build.cpu),
      cooler: normalizeSelection(build.cooler),
      motherboard: normalizeSelection(build.motherboard),
      memory: normalizeSelections(build.memory),
      gpu: normalizeSelection(build.gpu),
      ssd: normalizeSelections(build.ssd),
      hdd: normalizeSelections(build.hdd),
      case: normalizeSelection(build.case),
      psu: normalizeSelection(build.psu),
      accessories: normalizeAccessorySelections(build.accessories),
      m2SlotSelection: normalizeSlotSelection(build.m2SlotSelection),
      rgbControllerAccessoryId: build.rgbControllerAccessoryId ?? null,
      useIntegratedGraphics: build.useIntegratedGraphics
    },
    recommendationPreferences: {
      profile: preferences.profile,
      priority: preferences.priority,
      listingPolicy: preferences.listingPolicy ?? "retail_only",
      budgetWon: preferences.budgetWon ?? null,
      gamingResolution: preferences.gamingResolution ?? null,
      gamingRefreshRate: preferences.profile === "gaming" ? preferences.gamingRefreshRate ?? 144 : null
    }
  });
}
