import type { SavedBuild, SavedBuildCheckSnapshot } from "./types";
import { PART_CATEGORIES } from "./types";
import { savedBuildCheckFindingDiffFor, savedBuildCheckTransitionSummaryFor } from "./saved-build-check";

export type SavedBuildVersionDelta = {
  selectionChangedCategoryCount: number;
  transition?: ReturnType<typeof savedBuildCheckTransitionSummaryFor>;
  resolvedFindingCount?: number;
  newFindingCount?: number;
  changedFindingCount?: number;
};

function selectionSignatureFor(build: SavedBuild) {
  const selection = build.selection;
  const partSelection = (value: { partId: string; quantity: number } | undefined) => value ? `${value.partId}:${value.quantity}` : "-";
  const repeatedSelections = (values: Array<{ partId: string; quantity: number }> | undefined) => (values ?? []).map((value) => `${value.partId}:${value.quantity}`).sort().join("|") || "-";
  const accessories = (selection.accessories ?? []).map((value) => JSON.stringify({ accessoryId: value.accessoryId, quantity: value.quantity, targetPartId: value.targetPartId ?? null, targetAccessoryId: value.targetAccessoryId ?? null })).sort().join("|") || "-";
  return {
    cpu: partSelection(selection.cpu),
    cooler: partSelection(selection.cooler),
    motherboard: partSelection(selection.motherboard),
    memory: repeatedSelections(selection.memory),
    gpu: partSelection(selection.gpu),
    ssd: repeatedSelections(selection.ssd),
    hdd: repeatedSelections(selection.hdd),
    case: partSelection(selection.case),
    psu: partSelection(selection.psu),
    accessories,
    m2SlotSelection: JSON.stringify(selection.m2SlotSelection ?? {}),
    useIntegratedGraphics: String(selection.useIntegratedGraphics)
  } satisfies Record<string, string>;
}

function snapshotFor(build: SavedBuild): SavedBuildCheckSnapshot | undefined {
  return build.checkSnapshot ?? build.checkHistory?.at(-1);
}

export function savedBuildVersionDeltaFor(before: SavedBuild, after: SavedBuild): SavedBuildVersionDelta {
  const beforeSignature = selectionSignatureFor(before);
  const afterSignature = selectionSignatureFor(after);
  const selectionChangedCategoryCount = PART_CATEGORIES.filter((category) => beforeSignature[category] !== afterSignature[category]).length
    + (beforeSignature.accessories !== afterSignature.accessories ? 1 : 0)
    + (beforeSignature.m2SlotSelection !== afterSignature.m2SlotSelection ? 1 : 0)
    + (beforeSignature.useIntegratedGraphics !== afterSignature.useIntegratedGraphics ? 1 : 0);
  const beforeSnapshot = snapshotFor(before);
  const afterSnapshot = snapshotFor(after);
  const findingDiff = beforeSnapshot && afterSnapshot ? savedBuildCheckFindingDiffFor(beforeSnapshot, afterSnapshot) : undefined;
  const findingChanges = findingDiff?.available ? findingDiff.changes.filter((change) => change.change !== "unchanged") : [];
  return {
    selectionChangedCategoryCount,
    ...(beforeSnapshot && afterSnapshot ? { transition: savedBuildCheckTransitionSummaryFor(beforeSnapshot, afterSnapshot) } : {}),
    ...(findingDiff?.available ? {
      resolvedFindingCount: findingChanges.filter((change) => change.change === "resolved").length,
      newFindingCount: findingChanges.filter((change) => change.change === "new").length,
      changedFindingCount: findingChanges.filter((change) => change.change === "severity_changed" || change.change === "details_changed").length
    } : {})
  };
}
