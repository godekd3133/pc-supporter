import type { SavedBuild, SavedBuildAccessoryFindingSummary, SavedBuildCheckFindingSummary, SavedBuildCheckSnapshot } from "./types";
import { PART_CATEGORIES } from "./types";
import { savedBuildCheckFindingDiffFor, savedBuildCheckTransitionSummaryFor, type SavedBuildCheckFindingChange } from "./saved-build-check";

export type SavedBuildVersionFindingChange = {
  change: Exclude<SavedBuildCheckFindingChange, "unchanged">;
  title: string;
  severity?: SavedBuildCheckFindingSummary["severity"];
  affectedPartIds: string[];
};

export type SavedBuildVersionAccessoryFindingChange = {
  change: Exclude<SavedBuildCheckFindingChange, "unchanged">;
  title: string;
  severity: SavedBuildAccessoryFindingSummary["severity"];
  accessoryId: string;
  accessoryName: string;
  relatedPartIds: string[];
};

export type SavedBuildVersionDelta = {
  selectionChangedCategoryCount: number;
  transition?: ReturnType<typeof savedBuildCheckTransitionSummaryFor>;
  resolvedFindingCount?: number;
  newFindingCount?: number;
  changedFindingCount?: number;
  findingChanges?: SavedBuildVersionFindingChange[];
  accessoryFindingChanges?: SavedBuildVersionAccessoryFindingChange[];
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

function accessoryFindingKeyFor(finding: SavedBuildAccessoryFindingSummary) {
  return finding.ruleId || finding.id;
}

function accessoryFindingFingerprintFor(finding: SavedBuildAccessoryFindingSummary) {
  return JSON.stringify({
    title: finding.title,
    message: finding.message,
    accessoryId: finding.accessoryId,
    relatedPartIds: [...finding.relatedPartIds].sort(),
    facts: finding.facts,
    action: finding.action
  });
}

function accessoryFindingChangesFor(before?: SavedBuildCheckSnapshot["accessoryCompatibility"], after?: SavedBuildCheckSnapshot["accessoryCompatibility"]) {
  if (!Array.isArray(before?.findings) || !Array.isArray(after?.findings)) return [];
  const beforeByKey = new Map(before.findings.map((finding) => [accessoryFindingKeyFor(finding), finding]));
  const afterByKey = new Map(after.findings.map((finding) => [accessoryFindingKeyFor(finding), finding]));
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])];
  return keys.map((key): SavedBuildVersionAccessoryFindingChange | undefined => {
    const previous = beforeByKey.get(key);
    const next = afterByKey.get(key);
    if (!previous && !next) return undefined;
    if (!previous && next) return { change: "new", title: next.title, severity: next.severity, accessoryId: next.accessoryId, accessoryName: next.accessoryName, relatedPartIds: next.relatedPartIds };
    if (previous && !next) return { change: "resolved", title: previous.title, severity: previous.severity, accessoryId: previous.accessoryId, accessoryName: previous.accessoryName, relatedPartIds: previous.relatedPartIds };
    if (!previous || !next) return undefined;
    if (previous.severity !== next.severity) return { change: "severity_changed", title: next.title, severity: next.severity, accessoryId: next.accessoryId, accessoryName: next.accessoryName, relatedPartIds: next.relatedPartIds };
    if (accessoryFindingFingerprintFor(previous) === accessoryFindingFingerprintFor(next)) return undefined;
    return { change: "details_changed", title: next.title, severity: next.severity, accessoryId: next.accessoryId, accessoryName: next.accessoryName, relatedPartIds: next.relatedPartIds };
  }).filter((change): change is SavedBuildVersionAccessoryFindingChange => change !== undefined);
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
  const findingChangeSummary = findingChanges.map((change): SavedBuildVersionFindingChange => {
    const finding = change.after ?? change.before;
    return {
      change: change.change as Exclude<SavedBuildCheckFindingChange, "unchanged">,
      title: finding?.title ?? change.key,
      affectedPartIds: finding?.affectedPartIds ?? [],
      ...(finding?.severity ? { severity: finding.severity } : {})
    };
  });
  const accessoryFindingChanges = beforeSnapshot && afterSnapshot ? accessoryFindingChangesFor(beforeSnapshot.accessoryCompatibility, afterSnapshot.accessoryCompatibility) : [];
  return {
    selectionChangedCategoryCount,
    ...(beforeSnapshot && afterSnapshot ? { transition: savedBuildCheckTransitionSummaryFor(beforeSnapshot, afterSnapshot) } : {}),
    ...(findingDiff?.available ? {
      resolvedFindingCount: findingChanges.filter((change) => change.change === "resolved").length,
      newFindingCount: findingChanges.filter((change) => change.change === "new").length,
      changedFindingCount: findingChanges.filter((change) => change.change === "severity_changed" || change.change === "details_changed").length,
      ...(findingChangeSummary.length > 0 ? { findingChanges: findingChangeSummary } : {})
    } : {}),
    ...(accessoryFindingChanges.length > 0 ? { accessoryFindingChanges } : {})
  };
}
