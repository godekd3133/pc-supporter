import type { AccessoryCompatibilityFinding, CompatibilityResult, Finding, FindingFact, FindingSeverity, SavedBuildAccessoryCompatibilitySnapshot, SavedBuildAccessoryFindingSummary, SavedBuildCheckFindingSummary, SavedBuildCheckSnapshot } from "./types";
import { buildActionCenterFor } from "./build-action-center";
import { assemblyVerificationSavedHistoryFromUnknown, assemblyVerificationSavedSnapshotFromUnknown } from "./assembly-verification";

const COMPATIBILITY_STATUSES = ["compatible", "incompatible", "needs_review"] as const;
const ANALYSIS_SCORE_LABELS = ["상위권", "균형형", "보완 권장", "계산 불가"] as const;
const ANALYSIS_CONFIDENCE = ["high", "limited", "unknown"] as const;
export const SAVED_BUILD_CHECK_HISTORY_LIMIT = 20;
export const SAVED_BUILD_CHECK_FINDING_LIMIT = 32;
export const SAVED_BUILD_CHECK_ACCESSORY_FINDING_LIMIT = 32;
const SAVED_BUILD_CHECK_FACT_LIMIT = 4;
const SAVED_BUILD_CHECK_AFFECTED_PART_LIMIT = 8;
const SAVED_BUILD_CHECK_TEXT_LIMIT = 240;
const FINDING_SEVERITIES = ["blocker", "warning", "unknown", "info"] as const;
const ACCESSORY_COMPATIBILITY_STATUSES = ["compatible", "incompatible", "needs_review"] as const;
const ACCESSORY_FINDING_SEVERITIES = ["blocker", "warning", "unknown"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function textWithinLimit(value: unknown, max = SAVED_BUILD_CHECK_TEXT_LIMIT): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function compactText(value: string | undefined, max = SAVED_BUILD_CHECK_TEXT_LIMIT) {
  if (!value) return undefined;
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function findingFactFor(fact: FindingFact): FindingFact | undefined {
  if (!textWithinLimit(fact.label, 120)) return undefined;
  const actual = compactText(fact.actual, 160);
  const expected = compactText(fact.expected, 160);
  return { label: fact.label, ...(actual ? { actual } : {}), ...(expected ? { expected } : {}) };
}

function findingSummaryFor(finding: Finding): SavedBuildCheckFindingSummary {
  return {
    id: finding.id,
    ruleId: finding.ruleId,
    severity: finding.severity,
    title: compactText(finding.title, 160) ?? finding.ruleId,
    message: compactText(finding.message) ?? finding.ruleId,
    affectedPartIds: finding.affectedPartIds.slice(0, SAVED_BUILD_CHECK_AFFECTED_PART_LIMIT),
    facts: finding.facts.map(findingFactFor).filter((fact): fact is FindingFact => fact !== undefined).slice(0, SAVED_BUILD_CHECK_FACT_LIMIT)
  };
}

function accessoryFindingSummaryFor(finding: AccessoryCompatibilityFinding): SavedBuildAccessoryFindingSummary {
  return {
    id: finding.id,
    ruleId: finding.ruleId,
    severity: finding.severity,
    accessoryId: compactText(finding.accessoryId, 120) ?? finding.ruleId,
    accessoryName: compactText(finding.accessoryName, 160) ?? finding.ruleId,
    relatedPartIds: finding.relatedPartIds.slice(0, SAVED_BUILD_CHECK_AFFECTED_PART_LIMIT),
    title: compactText(finding.title, 160) ?? finding.ruleId,
    message: compactText(finding.message) ?? finding.ruleId,
    facts: finding.facts.map(findingFactFor).filter((fact): fact is FindingFact => fact !== undefined).slice(0, SAVED_BUILD_CHECK_FACT_LIMIT),
    ...(finding.action ? { action: compactText(finding.action, 200) } : {})
  };
}

function accessoryCompatibilitySnapshotFor(result: CompatibilityResult): SavedBuildAccessoryCompatibilitySnapshot | undefined {
  const compatibility = result.accessoryCompatibility;
  if (!compatibility) return undefined;
  return {
    status: compatibility.status,
    blockerCount: compatibility.blockerCount,
    warningCount: compatibility.warningCount,
    unknownCount: compatibility.unknownCount,
    findings: compatibility.findings.slice(0, SAVED_BUILD_CHECK_ACCESSORY_FINDING_LIMIT).map(accessoryFindingSummaryFor)
  };
}

export function savedBuildCheckSnapshotFor(result: CompatibilityResult): SavedBuildCheckSnapshot {
  const coreTotalPriceWon = result.coreTotalPriceWon ?? Math.max(0, result.totalPriceWon - (result.accessoryTotalPriceWon ?? 0));
  const corePriceComplete = result.corePriceComplete ?? result.priceComplete;
  const accessoryTotalPriceWon = result.accessoryTotalPriceWon ?? 0;
  const accessoryPriceComplete = result.accessoryPriceComplete ?? true;
  const accessoryCompatibility = accessoryCompatibilitySnapshotFor(result);
  const actionCenter = buildActionCenterFor(result);
  return {
    status: result.status,
    blockerCount: result.blockerCount,
    warningCount: result.warningCount,
    unknownCount: result.unknownCount,
    totalPriceWon: result.totalPriceWon,
    priceComplete: result.priceComplete,
    coreTotalPriceWon,
    corePriceComplete,
    accessoryTotalPriceWon,
    accessoryPriceComplete,
    ...(accessoryCompatibility ? { accessoryCompatibility } : {}),
    findings: result.findings.slice(0, SAVED_BUILD_CHECK_FINDING_LIMIT).map(findingSummaryFor),
    ...(result.analysis.overallScore !== undefined ? { analysisScore: result.analysis.overallScore } : {}),
    analysisScoreLabel: result.analysis.scoreLabel,
    analysisConfidence: result.analysis.confidence,
    actionCenterState: actionCenter.state,
    actionCenterSummary: actionCenter.summary,
    actionCenterTotalCount: actionCenter.totalCount,
    engineVersion: result.engineVersion,
    catalogSnapshotAt: result.catalogSnapshotAt,
    checkedAt: result.checkedAt
  };
}

function savedBuildCheckFindingSummaryFromUnknown(value: unknown): SavedBuildCheckFindingSummary | undefined {
  if (!isRecord(value)) return undefined;
  if (!textWithinLimit(value.id, 120) || !textWithinLimit(value.ruleId, 120)) return undefined;
  if (!FINDING_SEVERITIES.includes(value.severity as typeof FINDING_SEVERITIES[number])) return undefined;
  if (!textWithinLimit(value.title, 160) || !textWithinLimit(value.message)) return undefined;
  const affectedPartIds = Array.isArray(value.affectedPartIds)
    ? value.affectedPartIds.filter((partId): partId is string => textWithinLimit(partId, 120)).slice(0, SAVED_BUILD_CHECK_AFFECTED_PART_LIMIT)
    : [];
  const facts = Array.isArray(value.facts)
    ? value.facts.map((fact) => isRecord(fact) ? findingFactFor({ label: fact.label as string, actual: fact.actual as string | undefined, expected: fact.expected as string | undefined }) : undefined).filter((fact): fact is FindingFact => fact !== undefined).slice(0, SAVED_BUILD_CHECK_FACT_LIMIT)
    : [];
  return {
    id: value.id,
    ruleId: value.ruleId,
    severity: value.severity as FindingSeverity,
    title: value.title,
    message: value.message,
    affectedPartIds,
    facts
  };
}

function savedBuildCheckFindingsFromUnknown(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map(savedBuildCheckFindingSummaryFromUnknown)
    .filter((finding): finding is SavedBuildCheckFindingSummary => finding !== undefined)
    .slice(0, SAVED_BUILD_CHECK_FINDING_LIMIT);
}

function savedBuildAccessoryFindingSummaryFromUnknown(value: unknown): SavedBuildAccessoryFindingSummary | undefined {
  if (!isRecord(value)) return undefined;
  if (!textWithinLimit(value.id, 160) || !textWithinLimit(value.ruleId, 120) || !ACCESSORY_FINDING_SEVERITIES.includes(value.severity as typeof ACCESSORY_FINDING_SEVERITIES[number])) return undefined;
  if (!textWithinLimit(value.accessoryId, 120) || !textWithinLimit(value.accessoryName, 160) || !textWithinLimit(value.title, 160) || !textWithinLimit(value.message)) return undefined;
  if (value.action !== undefined && !textWithinLimit(value.action, 200)) return undefined;
  const relatedPartIds = Array.isArray(value.relatedPartIds)
    ? value.relatedPartIds.filter((partId): partId is string => textWithinLimit(partId, 120)).slice(0, SAVED_BUILD_CHECK_AFFECTED_PART_LIMIT)
    : [];
  const facts = Array.isArray(value.facts)
    ? value.facts.map((fact) => isRecord(fact) ? findingFactFor({ label: fact.label as string, actual: fact.actual as string | undefined, expected: fact.expected as string | undefined }) : undefined).filter((fact): fact is FindingFact => fact !== undefined).slice(0, SAVED_BUILD_CHECK_FACT_LIMIT)
    : [];
  return {
    id: value.id,
    ruleId: value.ruleId,
    severity: value.severity as SavedBuildAccessoryFindingSummary["severity"],
    accessoryId: value.accessoryId,
    accessoryName: value.accessoryName,
    relatedPartIds,
    title: value.title,
    message: value.message,
    facts,
    ...(value.action !== undefined ? { action: value.action } : {})
  };
}

function savedBuildAccessoryFindingsFromUnknown(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map(savedBuildAccessoryFindingSummaryFromUnknown)
    .filter((finding): finding is SavedBuildAccessoryFindingSummary => finding !== undefined)
    .slice(0, SAVED_BUILD_CHECK_ACCESSORY_FINDING_LIMIT);
}

function savedBuildAccessoryCompatibilityFromUnknown(value: unknown): SavedBuildAccessoryCompatibilitySnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (!ACCESSORY_COMPATIBILITY_STATUSES.includes(value.status as typeof ACCESSORY_COMPATIBILITY_STATUSES[number])
    || !nonNegativeInteger(value.blockerCount)
    || !nonNegativeInteger(value.warningCount)
    || !nonNegativeInteger(value.unknownCount)) return undefined;
  const findings = value.findings === undefined ? undefined : savedBuildAccessoryFindingsFromUnknown(value.findings);
  return {
    status: value.status as SavedBuildAccessoryCompatibilitySnapshot["status"],
    blockerCount: value.blockerCount,
    warningCount: value.warningCount,
    unknownCount: value.unknownCount,
    ...(findings !== undefined ? { findings } : {})
  };
}

export function savedBuildCheckSnapshotFromUnknown(value: unknown): SavedBuildCheckSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (!COMPATIBILITY_STATUSES.includes(value.status as typeof COMPATIBILITY_STATUSES[number])) return undefined;
  if (!nonNegativeInteger(value.blockerCount) || !nonNegativeInteger(value.warningCount) || !nonNegativeInteger(value.unknownCount)) return undefined;
  if (!finiteNumber(value.totalPriceWon) || value.totalPriceWon < 0 || !finiteNumber(value.coreTotalPriceWon) || value.coreTotalPriceWon < 0 || !finiteNumber(value.accessoryTotalPriceWon) || value.accessoryTotalPriceWon < 0) return undefined;
  if (typeof value.priceComplete !== "boolean" || typeof value.corePriceComplete !== "boolean" || typeof value.accessoryPriceComplete !== "boolean") return undefined;
  if (!ANALYSIS_SCORE_LABELS.includes(value.analysisScoreLabel as typeof ANALYSIS_SCORE_LABELS[number])) return undefined;
  if (!ANALYSIS_CONFIDENCE.includes(value.analysisConfidence as typeof ANALYSIS_CONFIDENCE[number])) return undefined;
  const actionCenterStates = ["blocked", "review", "ready"] as const;
  if (value.actionCenterState !== undefined && !actionCenterStates.includes(value.actionCenterState as typeof actionCenterStates[number])) return undefined;
  if (value.actionCenterSummary !== undefined && !textWithinLimit(value.actionCenterSummary, 500)) return undefined;
  if (value.actionCenterTotalCount !== undefined && !nonNegativeInteger(value.actionCenterTotalCount)) return undefined;
  if (typeof value.engineVersion !== "string" || value.engineVersion.length === 0 || value.engineVersion.length > 80) return undefined;
  if (typeof value.catalogSnapshotAt !== "string" || value.catalogSnapshotAt.length === 0 || value.catalogSnapshotAt.length > 120) return undefined;
  if (typeof value.checkedAt !== "string" || value.checkedAt.length === 0 || value.checkedAt.length > 120) return undefined;
  if (value.analysisScore !== undefined && (!finiteNumber(value.analysisScore) || value.analysisScore < 0 || value.analysisScore > 100)) return undefined;
  const findings = value.findings === undefined ? undefined : savedBuildCheckFindingsFromUnknown(value.findings);
  const accessoryCompatibility = value.accessoryCompatibility === undefined ? undefined : savedBuildAccessoryCompatibilityFromUnknown(value.accessoryCompatibility);
  if (value.accessoryCompatibility !== undefined && !accessoryCompatibility) return undefined;
  const assemblyVerification = value.assemblyVerification === undefined ? undefined : assemblyVerificationSavedSnapshotFromUnknown(value.assemblyVerification);
  if (value.assemblyVerification !== undefined && !assemblyVerification) return undefined;
  const assemblyVerificationHistory = value.assemblyVerificationHistory === undefined ? undefined : assemblyVerificationSavedHistoryFromUnknown(value.assemblyVerificationHistory);
  if (value.assemblyVerificationHistory !== undefined && !assemblyVerificationHistory) return undefined;
  return {
    status: value.status as SavedBuildCheckSnapshot["status"],
    blockerCount: value.blockerCount,
    warningCount: value.warningCount,
    unknownCount: value.unknownCount,
    totalPriceWon: value.totalPriceWon,
    priceComplete: value.priceComplete,
    coreTotalPriceWon: value.coreTotalPriceWon,
    corePriceComplete: value.corePriceComplete,
    accessoryTotalPriceWon: value.accessoryTotalPriceWon,
    accessoryPriceComplete: value.accessoryPriceComplete,
    ...(findings !== undefined ? { findings } : {}),
    ...(accessoryCompatibility ? { accessoryCompatibility } : {}),
    ...(value.analysisScore !== undefined ? { analysisScore: value.analysisScore } : {}),
    analysisScoreLabel: value.analysisScoreLabel as SavedBuildCheckSnapshot["analysisScoreLabel"],
    analysisConfidence: value.analysisConfidence as SavedBuildCheckSnapshot["analysisConfidence"],
    ...(value.actionCenterState !== undefined ? { actionCenterState: value.actionCenterState as SavedBuildCheckSnapshot["actionCenterState"] } : {}),
    ...(value.actionCenterSummary !== undefined ? { actionCenterSummary: value.actionCenterSummary } : {}),
    ...(value.actionCenterTotalCount !== undefined ? { actionCenterTotalCount: value.actionCenterTotalCount } : {}),
    ...(assemblyVerification ? { assemblyVerification } : {}),
    ...(assemblyVerificationHistory ? { assemblyVerificationHistory } : {}),
    engineVersion: value.engineVersion,
    catalogSnapshotAt: value.catalogSnapshotAt,
    checkedAt: value.checkedAt
  };
}

export function savedBuildCheckHistoryFromUnknown(value: unknown): SavedBuildCheckSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => savedBuildCheckSnapshotFromUnknown(item))
    .filter((item): item is SavedBuildCheckSnapshot => item !== undefined)
    .slice(-SAVED_BUILD_CHECK_HISTORY_LIMIT);
}

export function appendSavedBuildCheckHistory(history: SavedBuildCheckSnapshot[], snapshot: SavedBuildCheckSnapshot, max = SAVED_BUILD_CHECK_HISTORY_LIMIT) {
  const requestedLimit = Number.isFinite(max) ? Math.floor(max) : SAVED_BUILD_CHECK_HISTORY_LIMIT;
  const limit = Math.max(1, Math.min(SAVED_BUILD_CHECK_HISTORY_LIMIT, requestedLimit));
  return [...history, snapshot].slice(-limit);
}

function accessoryRiskFingerprint(value: SavedBuildAccessoryCompatibilitySnapshot | undefined) {
  return JSON.stringify({
    status: value?.status ?? "compatible",
    blockerCount: value?.blockerCount ?? 0,
    warningCount: value?.warningCount ?? 0,
    unknownCount: value?.unknownCount ?? 0,
    findings: value?.findings && value.findings.length > 0
      ? value.findings.map((finding) => ({
          ruleId: finding.ruleId,
          severity: finding.severity,
          accessoryId: finding.accessoryId,
          title: finding.title,
          message: finding.message,
          facts: finding.facts
        }))
      : null
  });
}

function accessoryRiskFromResult(result: CompatibilityResult) {
  return result.accessoryCompatibility;
}

export interface SavedBuildCheckDiff {
  statusChanged: boolean;
  riskChanged: boolean;
  accessoryRiskChanged: boolean;
  priceChanged: boolean;
  priceCompletenessChanged: boolean;
  engineChanged: boolean;
  catalogChanged: boolean;
  hasChanges: boolean;
}

export function savedBuildCheckDiffFor(snapshot: SavedBuildCheckSnapshot, result: CompatibilityResult): SavedBuildCheckDiff {
  const statusChanged = snapshot.status !== result.status;
  const accessoryRiskChanged = accessoryRiskFingerprint(snapshot.accessoryCompatibility) !== accessoryRiskFingerprint(accessoryRiskFromResult(result));
  const riskChanged = snapshot.blockerCount !== result.blockerCount
    || snapshot.warningCount !== result.warningCount
    || snapshot.unknownCount !== result.unknownCount
    || accessoryRiskChanged;
  const priceCompletenessChanged = snapshot.priceComplete !== result.priceComplete;
  const priceChanged = snapshot.priceComplete && result.priceComplete && snapshot.totalPriceWon !== result.totalPriceWon;
  const engineChanged = snapshot.engineVersion !== result.engineVersion;
  const catalogChanged = snapshot.catalogSnapshotAt !== result.catalogSnapshotAt;
  return {
    statusChanged,
    riskChanged,
    accessoryRiskChanged,
    priceChanged,
    priceCompletenessChanged,
    engineChanged,
    catalogChanged,
    hasChanges: statusChanged || riskChanged || priceChanged || priceCompletenessChanged || engineChanged || catalogChanged
  };
}

export function savedBuildCheckSnapshotDiffFor(before: SavedBuildCheckSnapshot, after: SavedBuildCheckSnapshot): SavedBuildCheckDiff {
  const statusChanged = before.status !== after.status;
  const accessoryRiskChanged = accessoryRiskFingerprint(before.accessoryCompatibility) !== accessoryRiskFingerprint(after.accessoryCompatibility);
  const riskChanged = before.blockerCount !== after.blockerCount
    || before.warningCount !== after.warningCount
    || before.unknownCount !== after.unknownCount
    || accessoryRiskChanged;
  const priceCompletenessChanged = before.priceComplete !== after.priceComplete;
  const priceChanged = before.priceComplete && after.priceComplete && before.totalPriceWon !== after.totalPriceWon;
  const engineChanged = before.engineVersion !== after.engineVersion;
  const catalogChanged = before.catalogSnapshotAt !== after.catalogSnapshotAt;
  return {
    statusChanged,
    riskChanged,
    accessoryRiskChanged,
    priceChanged,
    priceCompletenessChanged,
    engineChanged,
    catalogChanged,
    hasChanges: statusChanged || riskChanged || priceChanged || priceCompletenessChanged || engineChanged || catalogChanged
  };
}

export type SavedBuildCheckFindingChange = "resolved" | "new" | "severity_changed" | "details_changed" | "unchanged";

export interface SavedBuildCheckFindingDiff {
  key: string;
  change: SavedBuildCheckFindingChange;
  before?: SavedBuildCheckFindingSummary;
  after?: SavedBuildCheckFindingSummary;
}

export interface SavedBuildCheckFindingDiffResult {
  available: boolean;
  changes: SavedBuildCheckFindingDiff[];
}

function findingKeyFor(finding: SavedBuildCheckFindingSummary) {
  return finding.ruleId || finding.id;
}

function findingDetailFingerprint(finding: SavedBuildCheckFindingSummary) {
  return JSON.stringify({
    title: finding.title,
    message: finding.message,
    affectedPartIds: [...finding.affectedPartIds].sort(),
    facts: finding.facts
  });
}

const findingChangeRank: Record<SavedBuildCheckFindingChange, number> = {
  resolved: 0,
  new: 1,
  severity_changed: 2,
  details_changed: 3,
  unchanged: 4
};

export function savedBuildCheckFindingDiffFor(before: SavedBuildCheckSnapshot, after: SavedBuildCheckSnapshot): SavedBuildCheckFindingDiffResult {
  if (!Array.isArray(before.findings) || !Array.isArray(after.findings)) return { available: false, changes: [] };
  const beforeByKey = new Map(before.findings.map((finding) => [findingKeyFor(finding), finding]));
  const afterByKey = new Map(after.findings.map((finding) => [findingKeyFor(finding), finding]));
  const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])];
  const changes = keys.map((key): SavedBuildCheckFindingDiff => {
    const previous = beforeByKey.get(key);
    const next = afterByKey.get(key);
    if (!previous && next) return { key, change: "new", after: next };
    if (previous && !next) return { key, change: "resolved", before: previous };
    if (!previous || !next) return { key, change: "unchanged" };
    if (previous.severity !== next.severity) return { key, change: "severity_changed", before: previous, after: next };
    return { key, change: findingDetailFingerprint(previous) === findingDetailFingerprint(next) ? "unchanged" : "details_changed", before: previous, after: next };
  });
  changes.sort((left, right) => findingChangeRank[left.change] - findingChangeRank[right.change] || left.key.localeCompare(right.key));
  return { available: true, changes };
}

export type SavedBuildCheckTransitionDirection = "improved" | "regressed" | "changed" | "same";

export interface SavedBuildCheckTransitionSummary {
  direction: SavedBuildCheckTransitionDirection;
  statusChanged: boolean;
  blockerDelta: number;
  warningDelta: number;
  unknownDelta: number;
  accessoryBlockerDelta: number;
  accessoryWarningDelta: number;
  accessoryUnknownDelta: number;
  accessoryRiskChanged: boolean;
  priceDeltaWon?: number;
  priceCompletenessChanged: boolean;
  engineChanged: boolean;
  catalogChanged: boolean;
  findingDiffAvailable: boolean;
  resolvedFindingCount: number;
  newFindingCount: number;
  severityChangedFindingCount: number;
  detailsChangedFindingCount: number;
  unchangedFindingCount: number;
  hasChanges: boolean;
}

const CHECK_STATUS_RANK: Record<SavedBuildCheckSnapshot["status"], number> = {
  incompatible: 0,
  needs_review: 1,
  compatible: 2
};

export function savedBuildCheckTransitionSummaryFor(before: SavedBuildCheckSnapshot, after: SavedBuildCheckSnapshot): SavedBuildCheckTransitionSummary {
  const topLevelDiff = savedBuildCheckSnapshotDiffFor(before, after);
  const findingDiff = savedBuildCheckFindingDiffFor(before, after);
  const resolvedFindingCount = findingDiff.changes.filter((change) => change.change === "resolved").length;
  const newFindingCount = findingDiff.changes.filter((change) => change.change === "new").length;
  const severityChangedFindingCount = findingDiff.changes.filter((change) => change.change === "severity_changed").length;
  const detailsChangedFindingCount = findingDiff.changes.filter((change) => change.change === "details_changed").length;
  const unchangedFindingCount = findingDiff.changes.filter((change) => change.change === "unchanged").length;
  const findingHasChanges = findingDiff.changes.some((change) => change.change !== "unchanged");
  const statusRankDelta = CHECK_STATUS_RANK[after.status] - CHECK_STATUS_RANK[before.status];
  const direction: SavedBuildCheckTransitionDirection = statusRankDelta > 0
    ? "improved"
    : statusRankDelta < 0
      ? "regressed"
      : topLevelDiff.hasChanges || findingHasChanges
        ? "changed"
        : "same";
  return {
    direction,
    statusChanged: topLevelDiff.statusChanged,
    blockerDelta: after.blockerCount - before.blockerCount,
    warningDelta: after.warningCount - before.warningCount,
    unknownDelta: after.unknownCount - before.unknownCount,
    accessoryBlockerDelta: (after.accessoryCompatibility?.blockerCount ?? 0) - (before.accessoryCompatibility?.blockerCount ?? 0),
    accessoryWarningDelta: (after.accessoryCompatibility?.warningCount ?? 0) - (before.accessoryCompatibility?.warningCount ?? 0),
    accessoryUnknownDelta: (after.accessoryCompatibility?.unknownCount ?? 0) - (before.accessoryCompatibility?.unknownCount ?? 0),
    accessoryRiskChanged: topLevelDiff.accessoryRiskChanged,
    ...(before.priceComplete && after.priceComplete ? { priceDeltaWon: after.totalPriceWon - before.totalPriceWon } : {}),
    priceCompletenessChanged: topLevelDiff.priceCompletenessChanged,
    engineChanged: topLevelDiff.engineChanged,
    catalogChanged: topLevelDiff.catalogChanged,
    findingDiffAvailable: findingDiff.available,
    resolvedFindingCount,
    newFindingCount,
    severityChangedFindingCount,
    detailsChangedFindingCount,
    unchangedFindingCount,
    hasChanges: topLevelDiff.hasChanges || findingHasChanges
  };
}
