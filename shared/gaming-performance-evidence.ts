import type { GamingPerformanceAssessment, GamingPerformanceEvidenceStatus, GamingGraphicsPreset, GamingPerformanceMeasurement, GamingRefreshRate, GamingResolution, GamingUpscaling } from "./types";

export type GamingPerformanceEvidenceSourceKind = "independent_review" | "official" | "lab" | "user_capture";

export interface GamingPerformanceEvidenceRecord {
  id: string;
  gameId: string;
  gpuPartId: string;
  gpuName: string;
  resolution: GamingResolution;
  refreshRate: GamingRefreshRate;
  graphicsPreset: GamingGraphicsPreset;
  rayTracing: boolean;
  upscaling: GamingUpscaling;
  averageFps: number;
  onePercentLowFps?: number;
  driverVersion?: string;
  measuredAt: string;
  sourceKind: GamingPerformanceEvidenceSourceKind;
  sourceUrl: string;
  sourceNote?: string;
}

export interface GamingPerformanceCondition {
  gameId: string;
  resolution: GamingResolution;
  refreshRate: GamingRefreshRate;
  graphicsPreset: GamingGraphicsPreset;
  rayTracing: boolean;
  upscaling: GamingUpscaling;
  gpuPartId: string;
}

export interface GamingPerformanceEvidenceRequest {
  schemaVersion: 1;
  kind: "gaming-performance-evidence-request";
  createdAt: string;
  gameIds: string[];
  resolution: GamingResolution;
  refreshRate: GamingRefreshRate;
  graphicsPreset: GamingGraphicsPreset;
  rayTracing: boolean;
  upscaling: GamingUpscaling;
  gpuPartId?: string;
  gpuName?: string;
}

export function gamingPerformanceEvidenceRequestFor(assessment: GamingPerformanceAssessment, createdAt = new Date().toISOString()): GamingPerformanceEvidenceRequest {
  return {
    schemaVersion: 1,
    kind: "gaming-performance-evidence-request",
    createdAt,
    gameIds: assessment.gameIds.slice(0, 5),
    resolution: assessment.resolution,
    refreshRate: assessment.refreshRate,
    graphicsPreset: assessment.graphicsPreset ?? "balanced",
    rayTracing: assessment.rayTracing ?? false,
    upscaling: assessment.upscaling ?? "quality",
    ...(assessment.gpuPartId ? { gpuPartId: assessment.gpuPartId } : {}),
    ...(assessment.gpuName ? { gpuName: assessment.gpuName } : {})
  };
}

export function gamingPerformanceEvidenceRequestFromUnknown(value: unknown): GamingPerformanceEvidenceRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const gameIds = Array.isArray(candidate.gameIds) && candidate.gameIds.length > 0 && candidate.gameIds.length <= 5 && candidate.gameIds.every((gameId) => boundedText(gameId, 160))
    ? [...new Set(candidate.gameIds.map((gameId) => String(gameId).trim()))]
    : undefined;
  if (candidate.schemaVersion !== 1
    || candidate.kind !== "gaming-performance-evidence-request"
    || "averageFps" in candidate
    || "onePercentLowFps" in candidate
    || "measuredAt" in candidate
    || "sourceUrl" in candidate
    || "sourceKind" in candidate
    || !gameIds
    || !RESOLUTIONS.includes(candidate.resolution as GamingResolution)
    || !REFRESH_RATES.includes(candidate.refreshRate as GamingRefreshRate)
    || !GRAPHICS_PRESETS.includes(candidate.graphicsPreset as GamingGraphicsPreset)
    || typeof candidate.rayTracing !== "boolean"
    || !UPSCALING_OPTIONS.includes(candidate.upscaling as GamingUpscaling)
    || !validDate(candidate.createdAt)
    || (candidate.gpuPartId !== undefined && !boundedText(candidate.gpuPartId, 160))
    || (candidate.gpuName !== undefined && !boundedText(candidate.gpuName, 240))) return null;
  return {
    schemaVersion: 1,
    kind: "gaming-performance-evidence-request",
    createdAt: String(candidate.createdAt),
    gameIds,
    resolution: candidate.resolution as GamingResolution,
    refreshRate: candidate.refreshRate as GamingRefreshRate,
    graphicsPreset: candidate.graphicsPreset as GamingGraphicsPreset,
    rayTracing: candidate.rayTracing,
    upscaling: candidate.upscaling as GamingUpscaling,
    ...(candidate.gpuPartId !== undefined ? { gpuPartId: String(candidate.gpuPartId).trim() } : {}),
    ...(candidate.gpuName !== undefined ? { gpuName: String(candidate.gpuName).trim() } : {})
  };
}

export function gamingPerformanceEvidenceRequestFromJson(raw: string | null | undefined): GamingPerformanceEvidenceRequest | null {
  if (!raw) return null;
  try {
    return gamingPerformanceEvidenceRequestFromUnknown(JSON.parse(raw));
  } catch {
    return null;
  }
}

export interface GamingPerformanceEvidenceSummary {
  status: GamingPerformanceEvidenceStatus;
  matchedRecords: GamingPerformanceEvidenceRecord[];
  matchedGameIds: string[];
  missingGameIds: string[];
  staleRecordIds: string[];
  belowTargetRecordIds: string[];
  belowTargetGameIds: string[];
  measurements: GamingPerformanceMeasurement[];
  note: string;
}

export interface GamingPerformanceAssessmentOptions {
  gameIds: readonly string[];
  resolution: GamingResolution;
  refreshRate: GamingRefreshRate;
  graphicsPreset?: GamingGraphicsPreset;
  rayTracing?: boolean;
  upscaling?: GamingUpscaling;
  gpuPartId?: string;
  gpuName?: string;
}

export interface GamingPerformanceEvidenceValidationError {
  index: number;
  id?: string;
  message: string;
}

export interface GamingPerformanceEvidenceBatchValidation {
  valid: boolean;
  records: GamingPerformanceEvidenceRecord[];
  validCount: number;
  invalidCount: number;
  duplicateIds: string[];
  errors: GamingPerformanceEvidenceValidationError[];
}

export const GAMING_PERFORMANCE_EVIDENCE_MAX_RECORDS = 5_000;
export const GAMING_PERFORMANCE_EVIDENCE_STALE_DAYS = 180;

const RESOLUTIONS: readonly GamingResolution[] = ["1080p", "1440p", "4k"];
const REFRESH_RATES: readonly GamingRefreshRate[] = [60, 144, 240];
const GRAPHICS_PRESETS: readonly GamingGraphicsPreset[] = ["competitive", "balanced", "high"];
const UPSCALING_OPTIONS: readonly GamingUpscaling[] = ["native", "quality", "balanced"];
const SOURCE_KINDS: readonly GamingPerformanceEvidenceSourceKind[] = ["independent_review", "official", "lab", "user_capture"];

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function validFps(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1_000;
}

function validHttpsUrl(value: unknown): value is string {
  if (!boundedText(value, 2_000)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function gamingPerformanceEvidenceRecordFromUnknown(value: unknown): GamingPerformanceEvidenceRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!boundedText(candidate.id, 160)
    || !boundedText(candidate.gameId, 160)
    || !boundedText(candidate.gpuPartId, 160)
    || !boundedText(candidate.gpuName, 240)
    || !RESOLUTIONS.includes(candidate.resolution as GamingResolution)
    || !REFRESH_RATES.includes(candidate.refreshRate as GamingRefreshRate)
    || !GRAPHICS_PRESETS.includes(candidate.graphicsPreset as GamingGraphicsPreset)
    || typeof candidate.rayTracing !== "boolean"
    || !UPSCALING_OPTIONS.includes(candidate.upscaling as GamingUpscaling)
    || !validFps(candidate.averageFps)
    || (candidate.onePercentLowFps !== undefined && (!validFps(candidate.onePercentLowFps) || Number(candidate.onePercentLowFps) > Number(candidate.averageFps)))
    || (candidate.driverVersion !== undefined && !boundedText(candidate.driverVersion, 120))
    || !validDate(candidate.measuredAt)
    || !SOURCE_KINDS.includes(candidate.sourceKind as GamingPerformanceEvidenceSourceKind)
    || !validHttpsUrl(candidate.sourceUrl)
    || (candidate.sourceNote !== undefined && !boundedText(candidate.sourceNote, 1_000))) return null;
  return {
    id: candidate.id.trim(),
    gameId: candidate.gameId.trim(),
    gpuPartId: candidate.gpuPartId.trim(),
    gpuName: candidate.gpuName.trim(),
    resolution: candidate.resolution as GamingResolution,
    refreshRate: candidate.refreshRate as GamingRefreshRate,
    graphicsPreset: candidate.graphicsPreset as GamingGraphicsPreset,
    rayTracing: candidate.rayTracing,
    upscaling: candidate.upscaling as GamingUpscaling,
    averageFps: Number(candidate.averageFps),
    ...(candidate.onePercentLowFps !== undefined ? { onePercentLowFps: Number(candidate.onePercentLowFps) } : {}),
    ...(candidate.driverVersion !== undefined ? { driverVersion: String(candidate.driverVersion).trim() } : {}),
    measuredAt: candidate.measuredAt,
    sourceKind: candidate.sourceKind as GamingPerformanceEvidenceSourceKind,
    sourceUrl: candidate.sourceUrl.trim(),
    ...(candidate.sourceNote !== undefined ? { sourceNote: String(candidate.sourceNote).trim() } : {})
  };
}

export function gamingPerformanceEvidenceFromJson(raw: string | null | undefined): GamingPerformanceEvidenceRecord[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > GAMING_PERFORMANCE_EVIDENCE_MAX_RECORDS) return [];
    const seen = new Set<string>();
    return parsed.map(gamingPerformanceEvidenceRecordFromUnknown).filter((record): record is GamingPerformanceEvidenceRecord => {
      if (!record || seen.has(record.id)) return false;
      seen.add(record.id);
      return true;
    });
  } catch {
    return [];
  }
}

export function gamingPerformanceEvidenceBatchValidationFor(value: unknown): GamingPerformanceEvidenceBatchValidation {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as Record<string, unknown>).items)
      ? (value as Record<string, unknown>).items as unknown[]
      : undefined;
  if (!items) {
    return { valid: false, records: [], validCount: 0, invalidCount: 1, duplicateIds: [], errors: [{ index: -1, message: "FPS 자료는 배열 또는 items 배열이어야 합니다." }] };
  }
  if (items.length > GAMING_PERFORMANCE_EVIDENCE_MAX_RECORDS) {
    return { valid: false, records: [], validCount: 0, invalidCount: items.length, duplicateIds: [], errors: [{ index: -1, message: `한 번에 최대 ${GAMING_PERFORMANCE_EVIDENCE_MAX_RECORDS.toLocaleString("ko-KR")}개 자료만 확인할 수 있습니다.` }] };
  }
  const records: GamingPerformanceEvidenceRecord[] = [];
  const errors: GamingPerformanceEvidenceValidationError[] = [];
  const duplicateIds: string[] = [];
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const record = gamingPerformanceEvidenceRecordFromUnknown(item);
    const candidateId = item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === "string"
      ? ((item as Record<string, unknown>).id as string).trim()
      : undefined;
    if (!record) {
      errors.push({ index, ...(candidateId ? { id: candidateId } : {}), message: "필수 조건·GPU ID·출처 URL·측정값을 확인해 주세요." });
      return;
    }
    if (seen.has(record.id)) {
      duplicateIds.push(record.id);
      errors.push({ index, id: record.id, message: "같은 자료 ID가 중복되었습니다." });
      return;
    }
    seen.add(record.id);
    records.push(record);
  });
  return {
    valid: errors.length === 0,
    records,
    validCount: records.length,
    invalidCount: errors.length,
    duplicateIds,
    errors
  };
}

function conditionMatches(record: GamingPerformanceEvidenceRecord, condition: GamingPerformanceCondition) {
  return record.gameId === condition.gameId
    && record.resolution === condition.resolution
    && record.refreshRate === condition.refreshRate
    && record.graphicsPreset === condition.graphicsPreset
    && record.rayTracing === condition.rayTracing
    && record.upscaling === condition.upscaling
    && record.gpuPartId === condition.gpuPartId;
}

function isStale(record: GamingPerformanceEvidenceRecord, now: string | number): boolean {
  const measuredAt = Date.parse(record.measuredAt);
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  return !Number.isFinite(measuredAt) || !Number.isFinite(nowMs) || nowMs - measuredAt > GAMING_PERFORMANCE_EVIDENCE_STALE_DAYS * 24 * 60 * 60 * 1_000;
}

const SOURCE_CREDIBILITY: Record<GamingPerformanceEvidenceSourceKind, number> = {
  independent_review: 4,
  official: 3,
  lab: 2,
  user_capture: 1
};

function compareEvidencePreference(a: GamingPerformanceEvidenceRecord, b: GamingPerformanceEvidenceRecord, now: string | number): number {
  // Prefer current evidence over stale evidence, then the more independently
  // reproducible source, then the newest measurement within that source tier.
  // ID is a final stable tie-breaker.
  const aStale = isStale(a, now);
  const bStale = isStale(b, now);
  if (aStale !== bStale) return aStale ? 1 : -1;
  const credibilityDelta = SOURCE_CREDIBILITY[b.sourceKind] - SOURCE_CREDIBILITY[a.sourceKind];
  if (credibilityDelta !== 0) return credibilityDelta;
  const dateDelta = Date.parse(b.measuredAt) - Date.parse(a.measuredAt);
  if (Number.isFinite(dateDelta) && dateDelta !== 0) return dateDelta;
  return a.id.localeCompare(b.id);
}

export function gamingPerformanceEvidenceSummaryFor(records: readonly GamingPerformanceEvidenceRecord[], conditions: readonly GamingPerformanceCondition[], now: string | number = Date.now()): GamingPerformanceEvidenceSummary {
  const uniqueConditions = [...new Map(conditions.map((condition) => [condition.gameId, condition])).values()];
  if (uniqueConditions.length === 0 || records.length === 0) {
    return { status: "not_recorded", matchedRecords: [], matchedGameIds: [], missingGameIds: uniqueConditions.map((condition) => condition.gameId), staleRecordIds: [], belowTargetRecordIds: [], belowTargetGameIds: [], measurements: [], note: "게임별 실측 FPS 자료가 아직 연결되지 않았습니다." };
  }
  const recordsByCondition = uniqueConditions.map((condition) => records
    .filter((record) => conditionMatches(record, condition))
    .slice()
    .sort((a, b) => compareEvidencePreference(a, b, now)));
  const matchedRecords = recordsByCondition.flatMap((matches) => matches.slice(0, 1));
  const matchedGameIds = [...new Set(matchedRecords.map((record) => record.gameId))];
  const missingGameIds = uniqueConditions.map((condition) => condition.gameId).filter((gameId) => !matchedGameIds.includes(gameId));
  const staleRecordIds = matchedRecords.filter((record) => isStale(record, now)).map((record) => record.id);
  const conditionByGameId = new Map(uniqueConditions.map((condition) => [condition.gameId, condition]));
  // A fresh credible result below target prevents verification despite a passing
  // result. User captures remain conservative evidence when alone, but cannot
  // override a passing independent review, official result, or lab measurement.
  const belowTargetRecords = recordsByCondition.flatMap((matches) => {
    const freshMatches = matches.filter((record) => !isStale(record, now));
    const hasPassingCredibleMeasurement = freshMatches.some((record) =>
      record.sourceKind !== "user_capture" && record.averageFps >= record.refreshRate);
    return freshMatches.filter((record) => {
      const condition = conditionByGameId.get(record.gameId);
      if (condition === undefined || record.averageFps >= condition.refreshRate) return false;
      return record.sourceKind !== "user_capture" || !hasPassingCredibleMeasurement;
    });
  });
  const belowTargetRecordIds = belowTargetRecords.map((record) => record.id);
  const belowTargetGameIds = [...new Set(belowTargetRecords.map((record) => record.gameId))];
  const measurements: GamingPerformanceMeasurement[] = matchedRecords.map((record) => ({
    recordId: record.id,
    gameId: record.gameId,
    gpuName: record.gpuName,
    averageFps: record.averageFps,
    ...(record.onePercentLowFps !== undefined ? { onePercentLowFps: record.onePercentLowFps } : {}),
    measuredAt: record.measuredAt,
    sourceUrl: record.sourceUrl
  }));
  const status: GamingPerformanceEvidenceStatus = matchedRecords.length === 0
    ? "missing"
    : staleRecordIds.length > 0
      ? "stale"
      : belowTargetRecordIds.length > 0
        ? "target_not_met"
        : missingGameIds.length > 0
          ? "partial"
          : "verified";
  const note = status === "verified"
    ? "선택한 모든 게임·GPU 조건에 출처·측정일이 있는 자료가 연결되었고, 평균 FPS가 목표 프레임 이상입니다. 측정 환경까지 동일하다는 뜻은 아닙니다."
    : status === "target_not_met"
      ? `연결된 실측 자료 중 ${belowTargetGameIds.length}개 게임의 평균 FPS가 목표 프레임보다 낮습니다.`
    : status === "partial"
      ? `선택 조건 ${missingGameIds.length}개 게임의 실측 FPS 자료가 부족합니다.`
      : status === "stale"
        ? "연결된 FPS 자료 중 갱신이 필요한 측정값이 있습니다."
        : "조건과 일치하는 게임별 FPS 자료를 찾지 못했습니다.";
  return { status, matchedRecords, matchedGameIds, missingGameIds, staleRecordIds, belowTargetRecordIds, belowTargetGameIds, measurements, note };
}

export function gamingPerformanceAssessmentFor(records: readonly GamingPerformanceEvidenceRecord[], options: GamingPerformanceAssessmentOptions, now: string | number = Date.now()): GamingPerformanceAssessment {
  const gameIds = [...new Set(options.gameIds.map((gameId) => gameId.trim()).filter(Boolean))].slice(0, 5);
  const graphicsPreset = options.graphicsPreset ?? "balanced";
  const rayTracing = options.rayTracing ?? false;
  const upscaling = options.upscaling ?? "quality";
  const gpuPartId = options.gpuPartId ?? "__integrated_graphics__";
  const summary = gamingPerformanceEvidenceSummaryFor(records, gameIds.map((gameId) => ({
    gameId,
    resolution: options.resolution,
    refreshRate: options.refreshRate,
    graphicsPreset,
    rayTracing,
    upscaling,
    gpuPartId
  })), now);
  return {
    status: summary.status,
    gameIds,
    resolution: options.resolution,
    refreshRate: options.refreshRate,
    ...(options.graphicsPreset !== undefined ? { graphicsPreset: options.graphicsPreset } : {}),
    ...(options.rayTracing !== undefined ? { rayTracing: options.rayTracing } : {}),
    ...(options.upscaling !== undefined ? { upscaling: options.upscaling } : {}),
    ...(options.gpuPartId !== undefined ? { gpuPartId: options.gpuPartId } : {}),
    ...(options.gpuName !== undefined ? { gpuName: options.gpuName } : {}),
    ...(summary.matchedRecords.length > 0 ? { matchedRecordIds: summary.matchedRecords.map((record) => record.id) } : {}),
    ...(summary.matchedGameIds.length > 0 ? { matchedGameIds: summary.matchedGameIds } : {}),
    ...(summary.missingGameIds.length > 0 ? { missingGameIds: summary.missingGameIds } : {}),
    ...(summary.staleRecordIds.length > 0 ? { staleRecordIds: summary.staleRecordIds } : {}),
    ...(summary.belowTargetRecordIds.length > 0 ? { belowTargetRecordIds: summary.belowTargetRecordIds } : {}),
    ...(summary.belowTargetGameIds.length > 0 ? { belowTargetGameIds: summary.belowTargetGameIds } : {}),
    ...(summary.measurements.length > 0 ? { measurements: summary.measurements } : {}),
    ...(summary.matchedRecords.length > 0 ? { sourceUrls: summary.matchedRecords.map((record) => record.sourceUrl) } : {}),
    note: summary.note
  };
}
