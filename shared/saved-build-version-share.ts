import type { SavedBuildVersionComparisonExport, SavedBuildVersionExportBuild, SavedBuildVersionExportCheck } from "./saved-build-version-export";

export const SAVED_BUILD_VERSION_SHARE_SCHEMA_VERSION = 1;
export const SAVED_BUILD_VERSION_SHARE_KIND = "pc-supporter.saved-build-version-comparison-share" as const;

export type SavedBuildVersionShareCheck = {
  status: SavedBuildVersionExportCheck["status"];
  blockerCount: number;
  warningCount: number;
  unknownCount: number;
  totalPriceWon: number;
  priceComplete: boolean;
  analysisScore?: number;
  analysisScoreLabel: SavedBuildVersionExportCheck["analysisScoreLabel"];
  analysisConfidence: SavedBuildVersionExportCheck["analysisConfidence"];
  findings?: Array<{ key: string; title: string; severity: string }>;
  engineVersion: string;
  catalogSnapshotAt: string;
  checkedAt: string;
};

export type SavedBuildVersionShareBuild = {
  id: string;
  label: string;
  versionNumber: number;
  name: string;
  updatedAt: string;
  decisionNote?: string;
  check?: SavedBuildVersionShareCheck;
};

export type SavedBuildVersionShareTransition = {
  direction: "improved" | "regressed" | "changed" | "same";
  statusChanged: boolean;
  blockerDelta: number;
  warningDelta: number;
  unknownDelta: number;
  priceDeltaWon?: number;
  analysisScoreDelta?: number;
  priceCompletenessChanged: boolean;
  resourceBudgetChanged: boolean;
  benchmarkChanged: boolean;
  benchmarkNeedsReview: boolean;
  engineChanged: boolean;
  catalogChanged: boolean;
  resolvedFindingCount: number;
  newFindingCount: number;
  severityChangedFindingCount: number;
  detailsChangedFindingCount: number;
};

export type SavedBuildVersionShareSummary = {
  direction?: SavedBuildVersionShareTransition["direction"];
  selectionChangedCategoryCount: number;
  priceDeltaWon?: number;
  analysisScoreDelta?: number;
  resolvedFindingCount?: number;
  newFindingCount?: number;
  changedFindingCount?: number;
};

export type SavedBuildVersionShareFindingChange = {
  key: string;
  change: "resolved" | "new" | "severity_changed" | "details_changed";
  title: string;
  severity?: string;
};

export type SavedBuildVersionSharePayload = {
  schemaVersion: typeof SAVED_BUILD_VERSION_SHARE_SCHEMA_VERSION;
  kind: typeof SAVED_BUILD_VERSION_SHARE_KIND;
  generatedAt: string;
  before: SavedBuildVersionShareBuild;
  after: SavedBuildVersionShareBuild;
  summary: SavedBuildVersionShareSummary;
  transition?: SavedBuildVersionShareTransition;
  changes: Array<{ id: string; label: string; before: string; after: string }>;
  findingChanges: SavedBuildVersionShareFindingChange[];
  dataBoundary: string;
  text: string;
};

export interface SavedBuildVersionComparisonShareSnapshot {
  id: string;
  name: string;
  payload: SavedBuildVersionSharePayload;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export type SavedBuildVersionComparisonShareRecord = SavedBuildVersionComparisonShareSnapshot & {
  sourceBeforeBuildId: string;
  sourceAfterBuildId: string;
  ownerTokenHash?: string;
};

export interface SavedBuildVersionComparisonShareCreateInput {
  name?: unknown;
  beforeBuildId?: unknown;
  afterBuildId?: unknown;
  expiresInDays?: unknown;
}

export interface SavedBuildVersionComparisonShareInputResult {
  name?: string;
  beforeBuildId?: string;
  afterBuildId?: string;
  expiresInDays?: 7 | 30;
  errors: string[];
}

type ShareExpiryDays = 7 | 30;

function shareExpiryDaysFrom(value: unknown): ShareExpiryDays | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return value === 7 || value === 30 ? value : undefined;
}

function shareExpiryValueProvided(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function shareExpiresAtFor(expiryDays: ShareExpiryDays | undefined, now: number | Date = Date.now()) {
  if (expiryDays === undefined) return undefined;
  const timestamp = now instanceof Date ? now.getTime() : now;
  return new Date(timestamp + expiryDays * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeShareExpiryAt(value: unknown): { valid: boolean; value?: string } {
  if (!shareExpiryValueProvided(value)) return { valid: true };
  if (typeof value !== "string") return { valid: false };
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? { valid: true, value: new Date(timestamp).toISOString() } : { valid: false };
}

function shareExpired(expiresAt: string | undefined, now = Date.now()) {
  if (expiresAt === undefined) return false;
  const timestamp = Date.parse(expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= now;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function dateValue(value: unknown, maxLength = 80) {
  const text = textValue(value, maxLength);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : undefined;
}

function integerValue(value: unknown, minimum = 0, maximum = 1_000_000) {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : undefined;
}

function finiteNumberValue(value: unknown, minimum = -1_000_000_000, maximum = 1_000_000_000) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}

function checkFromUnknown(value: unknown): SavedBuildVersionShareCheck | undefined {
  if (!isRecord(value)) return undefined;
  const status = value.status === "compatible" || value.status === "needs_review" || value.status === "incompatible" ? value.status : undefined;
  const blockerCount = integerValue(value.blockerCount);
  const warningCount = integerValue(value.warningCount);
  const unknownCount = integerValue(value.unknownCount);
  const totalPriceWon = finiteNumberValue(value.totalPriceWon, 0);
  const analysisScore = value.analysisScore === undefined ? undefined : finiteNumberValue(value.analysisScore, 0, 100);
  const priceComplete = value.priceComplete;
  const analysisScoreLabel = value.analysisScoreLabel === "상위권" || value.analysisScoreLabel === "균형형" || value.analysisScoreLabel === "보완 권장" || value.analysisScoreLabel === "계산 불가" ? value.analysisScoreLabel : undefined;
  const analysisConfidence = value.analysisConfidence === "high" || value.analysisConfidence === "limited" || value.analysisConfidence === "unknown" ? value.analysisConfidence : undefined;
  const engineVersion = textValue(value.engineVersion, 80);
  const catalogSnapshotAt = dateValue(value.catalogSnapshotAt, 120);
  const checkedAt = dateValue(value.checkedAt, 120);
  const findingsValue = value.findings;
  const findings = findingsValue === undefined ? undefined : Array.isArray(findingsValue) && findingsValue.length <= 32 ? findingsValue.flatMap((item) => {
    if (!isRecord(item)) return [];
    const key = textValue(item.key, 160);
    const title = textValue(item.title, 240);
    const severity = textValue(item.severity, 40);
    return key && title && severity ? [{ key, title, severity }] : [];
  }) : undefined;
  if (!status || blockerCount === undefined || warningCount === undefined || unknownCount === undefined || totalPriceWon === undefined || typeof priceComplete !== "boolean" || !analysisScoreLabel || !analysisConfidence || !engineVersion || !catalogSnapshotAt || !checkedAt || findingsValue !== undefined && (!findings || !Array.isArray(findingsValue) || findings.length !== findingsValue.length || new Set(findings.map((finding) => finding.key)).size !== findings.length)) return undefined;
  return { status, blockerCount, warningCount, unknownCount, totalPriceWon, priceComplete, ...(analysisScore !== undefined ? { analysisScore } : {}), analysisScoreLabel, analysisConfidence, ...(findings ? { findings } : {}), engineVersion, catalogSnapshotAt, checkedAt };
}

function buildFromUnknown(value: unknown): SavedBuildVersionShareBuild | undefined {
  if (!isRecord(value)) return undefined;
  const id = textValue(value.id, 120);
  const label = textValue(value.label, 24);
  const versionNumber = integerValue(value.versionNumber, 1);
  const name = textValue(value.name, 200);
  const updatedAt = dateValue(value.updatedAt, 120);
  const decisionNote = value.decisionNote === undefined ? undefined : textValue(value.decisionNote, 500);
  const check = value.check === undefined ? undefined : checkFromUnknown(value.check);
  if (!id || !label || versionNumber === undefined || !name || !updatedAt || value.check !== undefined && !check) return undefined;
  return { id, label, versionNumber, name, updatedAt, ...(decisionNote ? { decisionNote } : {}), ...(check ? { check } : {}) };
}

function summaryFromUnknown(value: unknown): SavedBuildVersionShareSummary | undefined {
  if (!isRecord(value)) return undefined;
  const direction = value.direction === undefined ? undefined : value.direction === "improved" || value.direction === "regressed" || value.direction === "changed" || value.direction === "same" ? value.direction : undefined;
  const selectionChangedCategoryCount = integerValue(value.selectionChangedCategoryCount);
  const priceDeltaWon = value.priceDeltaWon === undefined ? undefined : finiteNumberValue(value.priceDeltaWon);
  const analysisScoreDelta = value.analysisScoreDelta === undefined ? undefined : finiteNumberValue(value.analysisScoreDelta, -100, 100);
  const resolvedFindingCount = value.resolvedFindingCount === undefined ? undefined : integerValue(value.resolvedFindingCount);
  const newFindingCount = value.newFindingCount === undefined ? undefined : integerValue(value.newFindingCount);
  const changedFindingCount = value.changedFindingCount === undefined ? undefined : integerValue(value.changedFindingCount);
  if (value.direction !== undefined && direction === undefined || selectionChangedCategoryCount === undefined || value.priceDeltaWon !== undefined && priceDeltaWon === undefined || value.analysisScoreDelta !== undefined && analysisScoreDelta === undefined || value.resolvedFindingCount !== undefined && resolvedFindingCount === undefined || value.newFindingCount !== undefined && newFindingCount === undefined || value.changedFindingCount !== undefined && changedFindingCount === undefined) return undefined;
  return { ...(direction ? { direction } : {}), selectionChangedCategoryCount, ...(priceDeltaWon !== undefined ? { priceDeltaWon } : {}), ...(analysisScoreDelta !== undefined ? { analysisScoreDelta } : {}), ...(resolvedFindingCount !== undefined ? { resolvedFindingCount } : {}), ...(newFindingCount !== undefined ? { newFindingCount } : {}), ...(changedFindingCount !== undefined ? { changedFindingCount } : {}) };
}

function transitionFromUnknown(value: unknown): SavedBuildVersionShareTransition | undefined {
  if (!isRecord(value)) return undefined;
  const direction = value.direction === "improved" || value.direction === "regressed" || value.direction === "changed" || value.direction === "same" ? value.direction : undefined;
  const bool = (key: string) => typeof value[key] === "boolean" ? value[key] as boolean : undefined;
  const blockerDelta = finiteNumberValue(value.blockerDelta, -1_000_000, 1_000_000);
  const warningDelta = finiteNumberValue(value.warningDelta, -1_000_000, 1_000_000);
  const unknownDelta = finiteNumberValue(value.unknownDelta, -1_000_000, 1_000_000);
  const priceDeltaWon = value.priceDeltaWon === undefined ? undefined : finiteNumberValue(value.priceDeltaWon);
  const analysisScoreDelta = value.analysisScoreDelta === undefined ? undefined : finiteNumberValue(value.analysisScoreDelta, -100, 100);
  const resolvedFindingCount = integerValue(value.resolvedFindingCount);
  const newFindingCount = integerValue(value.newFindingCount);
  const severityChangedFindingCount = integerValue(value.severityChangedFindingCount);
  const detailsChangedFindingCount = integerValue(value.detailsChangedFindingCount);
  const boolKeys = ["statusChanged", "priceCompletenessChanged", "resourceBudgetChanged", "benchmarkChanged", "benchmarkNeedsReview", "engineChanged", "catalogChanged"] as const;
  const boolValues = Object.fromEntries(boolKeys.map((key) => [key, bool(key)]));
  if (!direction || blockerDelta === undefined || warningDelta === undefined || unknownDelta === undefined || resolvedFindingCount === undefined || newFindingCount === undefined || severityChangedFindingCount === undefined || detailsChangedFindingCount === undefined || boolKeys.some((key) => boolValues[key] === undefined) || value.priceDeltaWon !== undefined && priceDeltaWon === undefined || value.analysisScoreDelta !== undefined && analysisScoreDelta === undefined) return undefined;
  return { direction, blockerDelta, warningDelta, unknownDelta, resolvedFindingCount, newFindingCount, severityChangedFindingCount, detailsChangedFindingCount, ...(priceDeltaWon !== undefined ? { priceDeltaWon } : {}), ...(analysisScoreDelta !== undefined ? { analysisScoreDelta } : {}), ...Object.fromEntries(boolKeys.map((key) => [key, boolValues[key]])) as Pick<SavedBuildVersionShareTransition, typeof boolKeys[number]> };
}

function changesFromUnknown(value: unknown) {
  if (!Array.isArray(value) || value.length > 32) return undefined;
  const changes = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = textValue(item.id, 120);
    const label = textValue(item.label, 160);
    const before = textValue(item.before, 600);
    const after = textValue(item.after, 600);
    return id && label && before && after ? [{ id, label, before, after }] : [];
  });
  return changes.length === value.length ? changes : undefined;
}

function findingChangesFromUnknown(value: unknown): SavedBuildVersionShareFindingChange[] | undefined {
  if (!Array.isArray(value) || value.length > 32) return undefined;
  const changes = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const key = textValue(item.key, 160);
    const change = item.change === "resolved" || item.change === "new" || item.change === "severity_changed" || item.change === "details_changed" ? item.change : undefined;
    const title = textValue(item.title, 240);
    const severity = item.severity === undefined ? undefined : textValue(item.severity, 40);
    return key && change && title ? [{ key, change: change as SavedBuildVersionShareFindingChange["change"], title, ...(severity ? { severity } : {}) }] : [];
  });
  return changes.length === value.length ? changes : undefined;
}

export function savedBuildVersionComparisonSharePayloadFor(exported: SavedBuildVersionComparisonExport, text: string): SavedBuildVersionSharePayload {
  const compactCheck = (check: SavedBuildVersionExportCheck | undefined): SavedBuildVersionShareCheck | undefined => check ? {
    status: check.status,
    blockerCount: check.blockerCount,
    warningCount: check.warningCount,
    unknownCount: check.unknownCount,
    totalPriceWon: check.totalPriceWon,
    priceComplete: check.priceComplete,
    ...(check.analysisScore !== undefined ? { analysisScore: check.analysisScore } : {}),
    analysisScoreLabel: check.analysisScoreLabel,
    analysisConfidence: check.analysisConfidence,
    ...(check.findings ? { findings: check.findings.slice(0, 32).map((finding) => ({ key: finding.ruleId || finding.id, title: finding.title, severity: finding.severity })) } : {}),
    engineVersion: check.engineVersion,
    catalogSnapshotAt: check.catalogSnapshotAt,
    checkedAt: check.checkedAt
  } : undefined;
  const compactBuild = (build: SavedBuildVersionExportBuild): SavedBuildVersionShareBuild => ({ id: build.id, label: build.label, versionNumber: build.versionNumber, name: build.name, updatedAt: build.updatedAt, ...(build.decisionNote ? { decisionNote: build.decisionNote } : {}), ...(compactCheck(build.check) ? { check: compactCheck(build.check) } : {}) });
  const transition = exported.transition ? {
    direction: exported.transition.direction,
    statusChanged: exported.transition.statusChanged,
    blockerDelta: exported.transition.blockerDelta,
    warningDelta: exported.transition.warningDelta,
    unknownDelta: exported.transition.unknownDelta,
    ...(exported.transition.priceDeltaWon !== undefined ? { priceDeltaWon: exported.transition.priceDeltaWon } : {}),
    ...(exported.transition.analysisScoreDelta !== undefined ? { analysisScoreDelta: exported.transition.analysisScoreDelta } : {}),
    priceCompletenessChanged: exported.transition.priceCompletenessChanged,
    resourceBudgetChanged: exported.transition.resourceBudgetChanged,
    benchmarkChanged: exported.transition.benchmarkChanged,
    benchmarkNeedsReview: exported.transition.benchmarkNeedsReview,
    engineChanged: exported.transition.engineChanged,
    catalogChanged: exported.transition.catalogChanged,
    resolvedFindingCount: exported.transition.resolvedFindingCount,
    newFindingCount: exported.transition.newFindingCount,
    severityChangedFindingCount: exported.transition.severityChangedFindingCount,
    detailsChangedFindingCount: exported.transition.detailsChangedFindingCount
  } satisfies SavedBuildVersionShareTransition : undefined;
  return {
    schemaVersion: SAVED_BUILD_VERSION_SHARE_SCHEMA_VERSION,
    kind: SAVED_BUILD_VERSION_SHARE_KIND,
    generatedAt: exported.generatedAt,
    before: compactBuild(exported.before),
    after: compactBuild(exported.after),
    summary: exported.summary,
    ...(transition ? { transition } : {}),
    changes: exported.changes.slice(0, 32),
    findingChanges: exported.findingChanges.filter((change) => change.change !== "unchanged").slice(0, 32).map((change): SavedBuildVersionShareFindingChange => ({ key: change.key, change: change.change as SavedBuildVersionShareFindingChange["change"], title: (change.after ?? change.before)?.title ?? change.key, ...((change.after ?? change.before)?.severity ? { severity: (change.after ?? change.before)!.severity } : {}) })),
    dataBoundary: exported.dataBoundary,
    text: text.slice(0, 12_000)
  };
}

export function savedBuildVersionComparisonSharePayloadFromUnknown(value: unknown): SavedBuildVersionSharePayload | undefined {
  if (!isRecord(value) || value.schemaVersion !== SAVED_BUILD_VERSION_SHARE_SCHEMA_VERSION || value.kind !== SAVED_BUILD_VERSION_SHARE_KIND) return undefined;
  const generatedAt = dateValue(value.generatedAt, 120);
  const before = buildFromUnknown(value.before);
  const after = buildFromUnknown(value.after);
  const summary = summaryFromUnknown(value.summary);
  const transition = value.transition === undefined ? undefined : transitionFromUnknown(value.transition);
  const changes = changesFromUnknown(value.changes);
  const findingChanges = findingChangesFromUnknown(value.findingChanges);
  const dataBoundary = textValue(value.dataBoundary, 800);
  const text = textValue(value.text, 12_000);
  if (!generatedAt || !before || !after || !summary || value.transition !== undefined && !transition || !changes || !findingChanges || !dataBoundary || !text) return undefined;
  return { schemaVersion: SAVED_BUILD_VERSION_SHARE_SCHEMA_VERSION, kind: SAVED_BUILD_VERSION_SHARE_KIND, generatedAt, before, after, summary, ...(transition ? { transition } : {}), changes, findingChanges, dataBoundary, text };
}

export function parseSavedBuildVersionComparisonShareInput(input: SavedBuildVersionComparisonShareCreateInput): SavedBuildVersionComparisonShareInputResult {
  const name = textValue(input.name, 160) ?? "PC Supporter 저장 견적 버전 비교";
  const beforeBuildId = textValue(input.beforeBuildId, 120);
  const afterBuildId = textValue(input.afterBuildId, 120);
  const expiresInDays = shareExpiryDaysFrom(input.expiresInDays);
  const errors: string[] = [];
  if (!beforeBuildId) errors.push("비교할 이전 버전 ID가 필요합니다.");
  if (!afterBuildId) errors.push("비교할 이후 버전 ID가 필요합니다.");
  if (beforeBuildId && afterBuildId && beforeBuildId === afterBuildId) errors.push("서로 다른 두 버전을 선택해야 합니다.");
  if (shareExpiryValueProvided(input.expiresInDays) && expiresInDays === undefined) errors.push("버전 비교 링크 유효기간은 무기한, 7일, 30일 중 하나여야 합니다.");
  return { name, ...(beforeBuildId ? { beforeBuildId } : {}), ...(afterBuildId ? { afterBuildId } : {}), ...(expiresInDays !== undefined ? { expiresInDays } : {}), errors };
}

export function savedBuildVersionComparisonFromUnknown(value: unknown): SavedBuildVersionComparisonShareRecord | undefined {
  if (!isRecord(value)) return undefined;
  const id = textValue(value.id, 120);
  const name = textValue(value.name, 160);
  const payload = savedBuildVersionComparisonSharePayloadFromUnknown(value.payload);
  const sourceBeforeBuildId = textValue(value.sourceBeforeBuildId, 120);
  const sourceAfterBuildId = textValue(value.sourceAfterBuildId, 120);
  const createdAt = dateValue(value.createdAt, 120);
  const updatedAt = dateValue(value.updatedAt, 120);
  const expiresAt = normalizeShareExpiryAt(value.expiresAt);
  const ownerTokenHash = typeof value.ownerTokenHash === "string" && /^[0-9a-f]{64}$/.test(value.ownerTokenHash) ? value.ownerTokenHash : undefined;
  if (!id || !name || !payload || !sourceBeforeBuildId || !sourceAfterBuildId || !createdAt || !updatedAt || !expiresAt.valid || value.expiresAt !== undefined && value.expiresAt !== null && !expiresAt.valid || !Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) return undefined;
  return { id, name, payload, sourceBeforeBuildId, sourceAfterBuildId, createdAt, updatedAt, ...(expiresAt.value ? { expiresAt: expiresAt.value } : {}), ...(ownerTokenHash ? { ownerTokenHash } : {}) };
}

export function savedBuildVersionComparisonShareExpired(snapshot: Pick<SavedBuildVersionComparisonShareSnapshot, "expiresAt">, now = Date.now()) {
  return shareExpired(snapshot.expiresAt, now);
}

export function savedBuildVersionComparisonShareExpiresAtFor(expiresInDays: 7 | 30 | undefined, now: number | Date = Date.now()) {
  return shareExpiresAtFor(expiresInDays, now);
}

export function publicSavedBuildVersionComparisonShare(record: SavedBuildVersionComparisonShareRecord): SavedBuildVersionComparisonShareSnapshot {
  const { ownerTokenHash: _ownerTokenHash, sourceBeforeBuildId: _sourceBeforeBuildId, sourceAfterBuildId: _sourceAfterBuildId, ...snapshot } = record;
  return snapshot;
}
