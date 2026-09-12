import { benchmarkEvidenceForBuild } from "./benchmark-evidence";
import { physicalSourceCheckNeedsReview } from "./physical-source-check";
import type { BenchmarkEvidencePart, BenchmarkEvidenceRow } from "./benchmark-evidence";
import type { BenchmarkProvenance, BenchmarkScoreKey, DataFreshness, Part, PhysicalSourceCheck } from "./types";

export const BUILD_BENCHMARK_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type BuildBenchmarkSnapshotStatus = "not_applicable" | "complete" | "partial" | "missing";
export type BuildBenchmarkImpactStatus = "not_recorded" | "same" | "changed" | "unverified";
export type BuildBenchmarkDecisionImpact = "stable" | "changed" | "unverified" | "not_recorded";

export interface BuildBenchmarkSnapshot {
  schemaVersion: typeof BUILD_BENCHMARK_SNAPSHOT_SCHEMA_VERSION;
  status: BuildBenchmarkSnapshotStatus;
  parts: BenchmarkEvidencePart[];
  expectedScoreCount: number;
  presentScoreCount: number;
  fingerprint: string;
}

export interface BuildBenchmarkImpactRow {
  category: "cpu" | "gpu";
  partId: string;
  partName: string;
  key: BenchmarkScoreKey;
  label: string;
  sharedValue?: number;
  currentValue?: number;
  delta?: number;
  changed: boolean;
}

export interface BuildBenchmarkImpact {
  status: BuildBenchmarkImpactStatus;
  decisionImpact: BuildBenchmarkDecisionImpact;
  beforeStatus?: BuildBenchmarkSnapshotStatus;
  afterStatus?: BuildBenchmarkSnapshotStatus;
  changedScoreCount: number;
  changedPartCount: number;
  coverageChanged: boolean;
  sourceChanged: boolean;
  benchmarkDateChanged: boolean;
  sourceCheckNeedsReview: boolean;
  freshnessNeedsReview: boolean;
  rows: BuildBenchmarkImpactRow[];
}

const BENCHMARK_STATUSES = ["not_applicable", "complete", "partial", "missing"] as const;
const BENCHMARK_SCORE_KEYS = ["cinebenchR23Single", "cinebenchR23Multi", "gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore"] as const;
const SOURCE_KINDS = ["official", "independent_review", "community_measurement", "other"] as const;
const SOURCE_CHECK_STATUSES = ["reachable", "redirected", "http_error", "unreachable", "blocked", "identity_mismatch"] as const;
const SOURCE_CHECK_IDENTITIES = ["matched", "not_found", "manual_required", "not_checked"] as const;
const FRESHNESS_VALUES = ["fresh", "aging", "stale", "unknown"] as const;
const EXPECTED_SCORE_KEYS: Record<"cpu" | "gpu", readonly BenchmarkScoreKey[]> = {
  cpu: ["cinebenchR23Single", "cinebenchR23Multi"],
  gpu: ["gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore"]
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function textWithin(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function sourceCheckFromUnknown(value: unknown): PhysicalSourceCheck | undefined {
  if (!isRecord(value)
    || !textWithin(value.requestedUrl, 2048)
    || !textWithin(value.checkedAt, 120)
    || !SOURCE_CHECK_STATUSES.includes(value.status as typeof SOURCE_CHECK_STATUSES[number])
    || !SOURCE_CHECK_IDENTITIES.includes(value.identityStatus as typeof SOURCE_CHECK_IDENTITIES[number])
    || !finiteNonNegative(value.redirectCount)
    || !Number.isInteger(value.redirectCount)
    || (value.finalUrl !== undefined && !textWithin(value.finalUrl, 2048))
    || (value.httpStatus !== undefined && (!finiteNonNegative(value.httpStatus) || !Number.isInteger(value.httpStatus)))
    || (value.contentType !== undefined && !textWithin(value.contentType, 160))
    || (value.detail !== undefined && !textWithin(value.detail, 400))) return undefined;
  return {
    requestedUrl: value.requestedUrl,
    checkedAt: value.checkedAt,
    status: value.status as PhysicalSourceCheck["status"],
    identityStatus: value.identityStatus as PhysicalSourceCheck["identityStatus"],
    redirectCount: value.redirectCount,
    ...(value.finalUrl !== undefined ? { finalUrl: value.finalUrl } : {}),
    ...(value.httpStatus !== undefined ? { httpStatus: value.httpStatus } : {}),
    ...(value.contentType !== undefined ? { contentType: value.contentType } : {}),
    ...(value.detail !== undefined ? { detail: value.detail } : {})
  };
}

function provenanceFromUnknown(value: unknown): BenchmarkProvenance | undefined {
  if (!isRecord(value)
    || !SOURCE_KINDS.includes(value.sourceKind as typeof SOURCE_KINDS[number])
    || !textWithin(value.sourceNote, 400)
    || !textWithin(value.updatedAt, 120)
    || (value.sourceUrl !== undefined && !textWithin(value.sourceUrl, 2048))) return undefined;
  const sourceCheck = value.sourceCheck === undefined ? undefined : sourceCheckFromUnknown(value.sourceCheck);
  if (value.sourceCheck !== undefined && !sourceCheck) return undefined;
  return {
    sourceKind: value.sourceKind as BenchmarkProvenance["sourceKind"],
    sourceNote: value.sourceNote,
    ...(value.sourceUrl !== undefined ? { sourceUrl: value.sourceUrl } : {}),
    ...(sourceCheck ? { sourceCheck } : {}),
    updatedAt: value.updatedAt
  };
}

function benchmarkRowFromUnknown(value: unknown): BenchmarkEvidenceRow | undefined {
  if (!isRecord(value)
    || !BENCHMARK_SCORE_KEYS.includes(value.key as typeof BENCHMARK_SCORE_KEYS[number])
    || !textWithin(value.label, 120)
    || value.unit !== "점"
    || (value.value !== undefined && !finitePositive(value.value))) return undefined;
  return {
    key: value.key as BenchmarkScoreKey,
    label: value.label,
    unit: "점",
    ...(value.value !== undefined ? { value: value.value } : {})
  };
}

function benchmarkPartFromUnknown(value: unknown): BenchmarkEvidencePart | undefined {
  if (!isRecord(value)
    || !textWithin(value.partId, 160)
    || (value.category !== "cpu" && value.category !== "gpu")
    || !textWithin(value.name, 240)
    || !Array.isArray(value.rows)
    || value.rows.length !== 2
    || !BENCHMARK_STATUSES.slice(1).includes(value.status as Exclude<BuildBenchmarkSnapshotStatus, "not_applicable">)
    || !finiteNonNegative(value.presentCount)
    || !Number.isInteger(value.presentCount)
    || !finiteNonNegative(value.totalCount)
    || !Number.isInteger(value.totalCount)
    || !textWithin(value.benchmarkFreshness, 32)
    || !FRESHNESS_VALUES.includes(value.benchmarkFreshness as typeof FRESHNESS_VALUES[number])
    || !textWithin(value.dataUpdatedAt, 120)) return undefined;
  const rows = value.rows.map(benchmarkRowFromUnknown);
  if (rows.some((row): row is undefined => row === undefined)) return undefined;
  const validRows = rows as BenchmarkEvidenceRow[];
  const expectedKeys = EXPECTED_SCORE_KEYS[value.category];
  if (new Set(validRows.map((row) => row.key)).size !== validRows.length
    || validRows.map((row) => row.key).some((key) => !expectedKeys.includes(key))
    || expectedKeys.some((key) => !validRows.some((row) => row.key === key))
    || validRows.filter((row) => row.value !== undefined).length !== value.presentCount
    || value.totalCount !== validRows.length
    || (value.status === "complete" && value.presentCount !== value.totalCount)
    || (value.status === "partial" && (value.presentCount <= 0 || value.presentCount >= value.totalCount))
    || (value.status === "missing" && value.presentCount !== 0)) return undefined;
  const provenance = value.provenance === undefined ? undefined : provenanceFromUnknown(value.provenance);
  if (value.provenance !== undefined && !provenance) return undefined;
  const sourceCheck = value.sourceCheck === undefined ? undefined : sourceCheckFromUnknown(value.sourceCheck);
  if (value.sourceCheck !== undefined && !sourceCheck) return undefined;
  return {
    partId: value.partId,
    category: value.category,
    name: value.name,
    rows: validRows,
    presentCount: value.presentCount,
    totalCount: value.totalCount,
    status: value.status as BenchmarkEvidencePart["status"],
    ...(provenance ? { provenance } : {}),
    ...(sourceCheck ? { sourceCheck } : {}),
    benchmarkFreshness: value.benchmarkFreshness as DataFreshness,
    dataUpdatedAt: value.dataUpdatedAt
  };
}

function sourceCheckFingerprintFor(sourceCheck: PhysicalSourceCheck | undefined) {
  return sourceCheck ? {
    status: sourceCheck.status,
    identityStatus: sourceCheck.identityStatus,
    redirectCount: sourceCheck.redirectCount,
    finalUrl: sourceCheck.finalUrl ?? null,
    httpStatus: sourceCheck.httpStatus ?? null,
    contentType: sourceCheck.contentType ?? null,
    detail: sourceCheck.detail ?? null
  } : null;
}

function fingerprintPartFor(part: BenchmarkEvidencePart) {
  const sourceCheck = part.provenance?.sourceCheck ?? part.sourceCheck;
  return {
    partId: part.partId,
    category: part.category,
    rows: part.rows.map((row) => ({ key: row.key, value: row.value ?? null })),
    provenance: part.provenance ? {
      sourceKind: part.provenance.sourceKind,
      sourceNote: part.provenance.sourceNote,
      sourceUrl: part.provenance.sourceUrl ?? null,
      updatedAt: part.provenance.updatedAt,
      sourceCheck: sourceCheckFingerprintFor(sourceCheck)
    } : null,
    dataUpdatedAt: part.dataUpdatedAt
  };
}

function statusFor(parts: ReadonlyArray<BenchmarkEvidencePart>, presentScoreCount: number, expectedScoreCount: number): BuildBenchmarkSnapshotStatus {
  if (parts.length === 0) return "not_applicable";
  if (presentScoreCount === expectedScoreCount) return "complete";
  return presentScoreCount > 0 ? "partial" : "missing";
}

export function buildBenchmarkSnapshotFor(cpu: Part | undefined, gpu: Part | undefined, now: string | number = Date.now()): BuildBenchmarkSnapshot {
  const parts = benchmarkEvidenceForBuild(cpu, gpu, now);
  const expectedScoreCount = parts.reduce((total, part) => total + part.totalCount, 0);
  const presentScoreCount = parts.reduce((total, part) => total + part.presentCount, 0);
  const status = statusFor(parts, presentScoreCount, expectedScoreCount);
  return {
    schemaVersion: BUILD_BENCHMARK_SNAPSHOT_SCHEMA_VERSION,
    status,
    parts,
    expectedScoreCount,
    presentScoreCount,
    fingerprint: JSON.stringify({ schemaVersion: BUILD_BENCHMARK_SNAPSHOT_SCHEMA_VERSION, parts: parts.map(fingerprintPartFor) })
  };
}

export function buildBenchmarkSnapshotFromUnknown(value: unknown): BuildBenchmarkSnapshot | undefined {
  if (!isRecord(value)
    || value.schemaVersion !== BUILD_BENCHMARK_SNAPSHOT_SCHEMA_VERSION
    || !BENCHMARK_STATUSES.includes(value.status as BuildBenchmarkSnapshotStatus)
    || !Array.isArray(value.parts)
    || value.parts.length > 2
    || !finiteNonNegative(value.expectedScoreCount)
    || !Number.isInteger(value.expectedScoreCount)
    || !finiteNonNegative(value.presentScoreCount)
    || !Number.isInteger(value.presentScoreCount)
    || !textWithin(value.fingerprint, 16_000)) return undefined;
  const parts = value.parts.map(benchmarkPartFromUnknown);
  if (parts.some((part): part is undefined => part === undefined)) return undefined;
  const validParts = parts as BenchmarkEvidencePart[];
  if (new Set(validParts.map((part) => part.partId)).size !== validParts.length
    || new Set(validParts.map((part) => part.category)).size !== validParts.length
    || validParts.length === 0 && value.status !== "not_applicable"
    || validParts.length > 0 && value.status === "not_applicable"
    || value.expectedScoreCount !== validParts.reduce((total, part) => total + part.totalCount, 0)
    || value.presentScoreCount !== validParts.reduce((total, part) => total + part.presentCount, 0)
    || (value.status === "complete" && value.presentScoreCount !== value.expectedScoreCount)
    || (value.status === "partial" && (value.presentScoreCount <= 0 || value.presentScoreCount >= value.expectedScoreCount))
    || (value.status === "missing" && value.presentScoreCount !== 0)) return undefined;
  const expectedFingerprint = JSON.stringify({ schemaVersion: BUILD_BENCHMARK_SNAPSHOT_SCHEMA_VERSION, parts: validParts.map(fingerprintPartFor) });
  if (value.fingerprint !== expectedFingerprint) return undefined;
  return {
    schemaVersion: BUILD_BENCHMARK_SNAPSHOT_SCHEMA_VERSION,
    status: value.status as BuildBenchmarkSnapshotStatus,
    parts: validParts,
    expectedScoreCount: value.expectedScoreCount,
    presentScoreCount: value.presentScoreCount,
    fingerprint: value.fingerprint
  };
}

function decisionImpactFor(status: BuildBenchmarkImpactStatus): BuildBenchmarkDecisionImpact {
  return status === "same" ? "stable" : status === "changed" ? "changed" : status === "unverified" ? "unverified" : "not_recorded";
}

function provenanceChangedFor(before: BenchmarkEvidencePart["provenance"], after: BenchmarkEvidencePart["provenance"]) {
  const beforeCheck = before?.sourceCheck;
  const afterCheck = after?.sourceCheck;
  return before?.sourceKind !== after?.sourceKind
    || before?.sourceNote !== after?.sourceNote
    || before?.sourceUrl !== after?.sourceUrl
    || JSON.stringify(sourceCheckFingerprintFor(beforeCheck)) !== JSON.stringify(sourceCheckFingerprintFor(afterCheck));
}

function emptyImpact(status: Extract<BuildBenchmarkImpactStatus, "not_recorded" | "unverified">, before?: BuildBenchmarkSnapshot, after?: BuildBenchmarkSnapshot, now: string | number = Date.now()): BuildBenchmarkImpact {
  return {
    status,
    decisionImpact: decisionImpactFor(status),
    ...(before ? { beforeStatus: before.status } : {}),
    ...(after ? { afterStatus: after.status } : {}),
    changedScoreCount: 0,
    changedPartCount: 0,
    coverageChanged: Boolean(before) !== Boolean(after),
    sourceChanged: false,
    benchmarkDateChanged: false,
    sourceCheckNeedsReview: Boolean(after?.parts.some((part) => physicalSourceCheckNeedsReview(part.sourceCheck, Boolean(part.provenance?.sourceUrl), now))),
    freshnessNeedsReview: Boolean(after?.parts.some((part) => ["aging", "stale", "unknown"].includes(part.benchmarkFreshness))),
    rows: []
  };
}

export function buildBenchmarkImpactFor(before: BuildBenchmarkSnapshot | undefined, after: BuildBenchmarkSnapshot | undefined, now: string | number = Date.now()): BuildBenchmarkImpact {
  if (!before && !after) return emptyImpact("not_recorded", before, after, now);
  if (!before || !after) {
    const impact = emptyImpact("unverified", before, after, now);
    return {
      ...impact,
      sourceCheckNeedsReview: Boolean(after?.parts.some((part) => physicalSourceCheckNeedsReview(part.sourceCheck, Boolean(part.provenance?.sourceUrl), now))),
      freshnessNeedsReview: Boolean(after?.parts.some((part) => ["aging", "stale", "unknown"].includes(part.benchmarkFreshness)))
    };
  }

  const beforeParts = new Map(before.parts.map((part) => [`${part.category}:${part.partId}`, part]));
  const afterParts = new Map(after.parts.map((part) => [`${part.category}:${part.partId}`, part]));
  const partKeys = [...new Set([...beforeParts.keys(), ...afterParts.keys()])];
  const rows: BuildBenchmarkImpactRow[] = [];
  let sourceChanged = false;
  let benchmarkDateChanged = false;
  let changedPartCount = 0;

  for (const partKey of partKeys) {
    const previous = beforeParts.get(partKey);
    const current = afterParts.get(partKey);
    if (!previous || !current) {
      changedPartCount += 1;
      for (const row of previous?.rows ?? current?.rows ?? []) {
        rows.push({
          category: (previous ?? current)!.category,
          partId: (previous ?? current)!.partId,
          partName: (previous ?? current)!.name,
          key: row.key,
          label: row.label,
          ...(previous ? row.value !== undefined ? { sharedValue: row.value } : {} : {}),
          ...(current ? row.value !== undefined ? { currentValue: row.value } : {} : {}),
          changed: true
        });
      }
      continue;
    }
    const previousRows = new Map(previous.rows.map((row) => [row.key, row]));
    const currentRows = new Map(current.rows.map((row) => [row.key, row]));
    let partChanged = previous.status !== current.status;
    const rowKeys = [...new Set([...previousRows.keys(), ...currentRows.keys()])];
    for (const key of rowKeys) {
      const previousRow = previousRows.get(key);
      const currentRow = currentRows.get(key);
      const sharedValue = previousRow?.value;
      const currentValue = currentRow?.value;
      const changed = sharedValue !== currentValue;
      if (changed) partChanged = true;
      rows.push({
        category: current.category,
        partId: current.partId,
        partName: current.name,
        key,
        label: currentRow?.label ?? previousRow?.label ?? key,
        ...(sharedValue !== undefined ? { sharedValue } : {}),
        ...(currentValue !== undefined ? { currentValue } : {}),
        ...(sharedValue !== undefined && currentValue !== undefined ? { delta: currentValue - sharedValue } : {}),
        changed
      });
    }
    const sourceChangedForPart = provenanceChangedFor(previous.provenance, current.provenance);
    const dateChangedForPart = previous.dataUpdatedAt !== current.dataUpdatedAt || previous.provenance?.updatedAt !== current.provenance?.updatedAt;
    sourceChanged = sourceChanged || sourceChangedForPart;
    benchmarkDateChanged = benchmarkDateChanged || dateChangedForPart;
    if (sourceChangedForPart || dateChangedForPart) partChanged = true;
    if (partChanged) changedPartCount += 1;
  }

  const changedScoreCount = rows.filter((row) => row.changed).length;
  const coverageChanged = before.status !== after.status
    || before.expectedScoreCount !== after.expectedScoreCount
    || before.presentScoreCount !== after.presentScoreCount
    || beforeParts.size !== afterParts.size;
  const sourceCheckNeedsReview = after.parts.some((part) => physicalSourceCheckNeedsReview(part.sourceCheck, Boolean(part.provenance?.sourceUrl), now));
  const freshnessNeedsReview = after.parts.some((part) => ["aging", "stale", "unknown"].includes(part.benchmarkFreshness));
  const hasChanges = changedScoreCount > 0 || changedPartCount > 0 || coverageChanged || sourceChanged || benchmarkDateChanged;
  const status: BuildBenchmarkImpactStatus = hasChanges ? "changed" : sourceCheckNeedsReview || freshnessNeedsReview || after.status !== "complete" ? "unverified" : "same";
  return {
    status,
    decisionImpact: decisionImpactFor(status),
    beforeStatus: before.status,
    afterStatus: after.status,
    changedScoreCount,
    changedPartCount,
    coverageChanged,
    sourceChanged,
    benchmarkDateChanged,
    sourceCheckNeedsReview,
    freshnessNeedsReview,
    rows
  };
}

export function buildBenchmarkSnapshotStatusText(status: BuildBenchmarkSnapshotStatus) {
  return status === "complete" ? "근거 충분" : status === "partial" ? "일부 근거" : status === "missing" ? "근거 부족" : "적용 지표 없음";
}

export function buildBenchmarkImpactStatusText(status: BuildBenchmarkImpactStatus) {
  return status === "same" ? "benchmark 동일" : status === "changed" ? "benchmark 변경" : status === "unverified" ? "benchmark 확인 필요" : "benchmark 기록 없음";
}

export function buildBenchmarkDecisionImpactText(impact: BuildBenchmarkDecisionImpact) {
  return impact === "stable" ? "성능 판단 영향 없음" : impact === "changed" ? "성능 판단 재검토" : impact === "unverified" ? "성능 판단 확인 필요" : "성능 판단 근거 없음";
}
