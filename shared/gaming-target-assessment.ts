import type { GamingGraphicsPreset, GamingResolution, GamingUpscaling } from "./types";

/** Absolute FPS observations. Relative GPU and Cinebench percentages never enter this contract. */
export interface GamingFpsReference {
  id: string;
  gameId: string;
  cpuModel: string;
  gpuModel: string;
  gpuName?: string;
  gpuVramGb: number;
  resolution: GamingResolution;
  graphicsPreset: GamingGraphicsPreset;
  sourcePreset: string;
  rayTracing: boolean;
  upscaling: GamingUpscaling;
  upscaler: "none" | "dlss" | "fsr" | "xess";
  frameGeneration: boolean;
  averageFps: number;
  onePercentLowFps?: number;
  memoryType: "DDR4" | "DDR5";
  memorySpeedMhz: number;
  memoryCapacityGb?: number;
  memoryModuleCount?: number;
  memoryTiming?: string;
  driverVersion?: string;
  operatingSystem?: string;
  gameVersion?: string;
  scene?: string;
  sourceKind: "independent_review" | "official" | "lab" | "user_capture";
  sourceUrl: string;
  sourceImageUrl?: string;
  sourceTitle: string;
  publishedAt: string;
  verifiedAt: string;
  sourceNote: string;
}

export interface GamingTargetAssessmentOptions {
  gameIds: readonly string[];
  cpuName?: string;
  gpuName?: string;
  cpuPartId?: string;
  gpuPartId?: string;
  gpuVramGb?: number;
  resolution: GamingResolution;
  targetFps: number;
  graphicsPreset?: GamingGraphicsPreset;
  rayTracing?: boolean;
  upscaling?: GamingUpscaling;
  frameGeneration?: boolean | "off" | "on";
  referenceMaxAgeDays?: number;
  memoryType?: string;
  memorySpeedMhz?: number;
  memoryCapacityGb?: number;
  memoryModuleCount?: number;
  memoryTiming?: string;
  /** Exact benchmark conditions, supplied only when the caller knows them. */
  sourcePreset?: string;
  driverVersion?: string;
  operatingSystem?: string;
  gameVersion?: string;
  scene?: string;
}

export type GamingTargetAssessmentStatus = "verified" | "projected" | "target_not_met" | "partial" | "missing" | "stale" | "not_recorded";

export interface GamingTargetMeasurement {
  referenceId: string;
  gameId: string;
  /** Raw source observation, never a measured result for the generated PC. */
  sourceAverageFps: number;
  sourceOnePercentLowFps?: number;
  referenceTargetRatio: number;
  match: "exact" | "projected";
  targetFit: "met" | "below" | "unknown";
  differences: string[];
  sourceConditions: GamingFpsReference;
}

export interface GamingTargetAssessment {
  status: GamingTargetAssessmentStatus;
  gameIds: string[];
  targetFps: number;
  resolution: GamingResolution;
  graphicsPreset: GamingGraphicsPreset;
  rayTracing: boolean;
  upscaling: GamingUpscaling;
  frameGeneration: boolean;
  referenceMaxAgeDays: number;
  cpuPartId?: string;
  cpuName?: string;
  gpuPartId?: string;
  gpuName?: string;
  /** True only when every requested game's complete measurement environment matches and passes. */
  targetMet: boolean;
  /** Reference-system comparison, explicitly separate from generated-PC fulfillment. */
  referenceTargetMet: boolean;
  /** Available only when CPU plus RAM type/capacity match; never a measured-PC claim. */
  estimatedTargetMet?: boolean;
  /** Undefined when there is no absolute FPS observation. Useful for ranking, never for claiming fulfillment. */
  minimumTargetRatio?: number;
  missingGameIds: string[];
  belowTargetGameIds: string[];
  staleReferenceIds: string[];
  measurements: GamingTargetMeasurement[];
  note: string;
}

export const GAMING_FPS_REFERENCE_STALE_DAYS = 180;

const RESOLUTIONS = ["1080p", "1440p", "4k"] as const;
const PRESETS = ["competitive", "balanced", "high"] as const;
const UPSCALING = ["native", "quality", "balanced"] as const;
const SOURCE_KINDS = ["independent_review", "official", "lab", "user_capture"] as const;

function textValue(value: unknown, max = 1_000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function positive(value: unknown, max = 100_000): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max;
}

function dateValue(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** A malformed file is not partially trusted; all records must be valid and unique. */
export function gamingFpsReferencesFromUnknown(value: unknown): GamingFpsReference[] {
  const items = Array.isArray(value) ? value : value && typeof value === "object" && "records" in value ? (value as { records: unknown }).records : undefined;
  if (!Array.isArray(items) || items.length > 5_000) return [];
  const ids = new Set<string>();
  const records: GamingFpsReference[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (!["id", "gameId", "cpuModel", "gpuModel", "sourcePreset", "sourceUrl", "sourceTitle", "sourceNote"].every((field) => textValue(record[field]))
      || !positive(record.gpuVramGb, 128)
      || !RESOLUTIONS.includes(record.resolution as GamingResolution)
      || !PRESETS.includes(record.graphicsPreset as GamingGraphicsPreset)
      || !UPSCALING.includes(record.upscaling as GamingUpscaling)
      || !["none", "dlss", "fsr", "xess"].includes(String(record.upscaler))
      || typeof record.rayTracing !== "boolean"
      || typeof record.frameGeneration !== "boolean"
      || !positive(record.averageFps, 2_000)
      || (record.onePercentLowFps !== undefined && (!positive(record.onePercentLowFps, 2_000) || Number(record.onePercentLowFps) > Number(record.averageFps)))
      || !["DDR4", "DDR5"].includes(String(record.memoryType))
      || !positive(record.memorySpeedMhz, 20_000)
      || !["memoryCapacityGb", "memoryModuleCount"].every((field) => record[field] === undefined || positive(record[field]))
      || !["gpuName", "memoryTiming", "driverVersion", "operatingSystem", "gameVersion", "scene"].every((field) => record[field] === undefined || textValue(record[field]))
      || !SOURCE_KINDS.includes(record.sourceKind as GamingFpsReference["sourceKind"])
      || !dateValue(record.publishedAt) || !dateValue(record.verifiedAt)
      || Date.parse(record.verifiedAt) < Date.parse(record.publishedAt)
      || ids.has(String(record.id))) return [];
    try {
      if (new URL(String(record.sourceUrl)).protocol !== "https:") return [];
      if (record.sourceImageUrl !== undefined && (!textValue(record.sourceImageUrl, 2_000) || new URL(record.sourceImageUrl).protocol !== "https:")) return [];
    } catch { return []; }
    if ((record.upscaling === "native") !== (record.upscaler === "none")) return [];
    ids.add(String(record.id));
    records.push({ ...record } as unknown as GamingFpsReference);
  }
  return records;
}

export function gamingFpsReferencesFromJson(raw: string | undefined | null): GamingFpsReference[] {
  try { return raw ? gamingFpsReferencesFromUnknown(JSON.parse(raw)) : []; } catch { return []; }
}

export function gamingCpuModelFor(name: string | undefined): string | undefined {
  return name?.match(/\b(?:[579]\d{3}(?:X3D2|X3D|GT|G|XT|X|F)?|(?:1[234]\d{3}|2[456]\d)(?:KS|KF|K|F|T)?)\b/i)?.[0].toUpperCase();
}

export function gamingGpuModelFor(name: string | undefined): string | undefined {
  if (!name || /\b(?:laptop|mobile)\b|노트북/i.test(name)) return undefined;
  const model = name.match(/\b(?:RTX\s*\d{4}(?:\s*Ti)?(?:\s*SUPER)?|RX\s*\d{3,4}(?:\s*XTX|\s*XT|\s*GRE|\s*2048SP)?)\b/i)?.[0];
  return model?.toUpperCase().replace(/\s+/g, " ").replace(/(RTX|RX)\s*(\d)/, "$1 $2").replace(/(\d)(TI|SUPER|XTX|XT|GRE|2048SP)\b/, "$1 $2");
}

function vramFor(options: GamingTargetAssessmentOptions): number | undefined {
  return options.gpuVramGb ?? (Number(options.gpuName?.match(/\b(\d{1,3})\s*(?:GB|G)\b/i)?.[1] ?? 0) || undefined);
}

function stale(record: GamingFpsReference, nowMs: number, maxAgeDays: number): boolean {
  // Re-reading an old article does not make its benchmark new.
  return !Number.isFinite(nowMs) || nowMs - Date.parse(record.publishedAt) > maxAgeDays * 86_400_000 || Date.parse(record.publishedAt) > nowMs;
}

function environmentDifferences(reference: GamingFpsReference, options: GamingTargetAssessmentOptions): string[] {
  const differences: string[] = [];
  if (gamingCpuModelFor(options.cpuName) !== gamingCpuModelFor(reference.cpuModel)) differences.push(`CPU: 테스트 PC ${reference.cpuModel} · 견적 ${options.cpuName ?? "정보 없음"}`);
  if (!reference.gpuName || options.gpuName !== reference.gpuName) differences.push(`그래픽카드: 테스트 PC ${reference.gpuName ?? reference.gpuModel} · 견적 ${options.gpuName ?? "정보 없음"}`);
  const fields: Array<[keyof GamingTargetAssessmentOptions & keyof GamingFpsReference, string]> = [
    ["memoryType", "RAM 규격"], ["memorySpeedMhz", "RAM 속도"], ["memoryCapacityGb", "RAM 용량"],
    ["memoryModuleCount", "RAM 모듈 수"], ["memoryTiming", "RAM 타이밍"], ["sourcePreset", "게임 상세 옵션"],
    ["driverVersion", "드라이버"], ["operatingSystem", "운영체제"], ["gameVersion", "게임 버전"], ["scene", "측정 구간"]
  ];
  for (const [field, label] of fields) {
    if (reference[field] === undefined || options[field] === undefined || reference[field] !== options[field]) {
      differences.push(`${label}: 테스트 PC ${reference[field] ?? "기사에 표시 없음"} · 견적 ${options[field] ?? "정보 없음"}`);
    }
  }
  return differences;
}

/**
 * FPS observations do not depend on the user's target FPS. The target is a comparator,
 * unlike refreshRate in the legacy evidence matcher. Different resolution/preset/RT/
 * upscaling/frame generation conditions are never scaled into made-up absolute FPS.
 */
export function gamingTargetAssessmentFor(references: readonly GamingFpsReference[], options: GamingTargetAssessmentOptions, now: number | string = Date.now()): GamingTargetAssessment {
  const gameIds = [...new Set(options.gameIds.map((id) => id.trim()).filter(Boolean))].slice(0, 5);
  const graphicsPreset = options.graphicsPreset ?? "high";
  const rayTracing = options.rayTracing ?? false;
  const upscaling = options.upscaling ?? "native";
  const frameGeneration = options.frameGeneration === true || options.frameGeneration === "on";
  const gpuModel = gamingGpuModelFor(options.gpuName);
  const vram = vramFor(options);
  const cpuModel = gamingCpuModelFor(options.cpuName);
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  const referenceMaxAgeDays = positive(options.referenceMaxAgeDays, 365) ? options.referenceMaxAgeDays : GAMING_FPS_REFERENCE_STALE_DAYS;
  const measurements: GamingTargetMeasurement[] = [];
  const staleReferenceIds: string[] = [];
  if (positive(options.targetFps, 500) && Number.isInteger(options.targetFps) && options.targetFps >= 30) {
    for (const gameId of gameIds) {
      const matching = references.filter((reference) => reference.gameId === gameId
        && gamingGpuModelFor(reference.gpuModel) === gpuModel && gpuModel !== undefined
        && reference.gpuVramGb === vram && vram !== undefined
        && reference.resolution === options.resolution && reference.graphicsPreset === graphicsPreset
        && (options.sourcePreset === undefined || reference.sourcePreset === options.sourcePreset)
        && reference.rayTracing === rayTracing && reference.upscaling === upscaling && reference.frameGeneration === frameGeneration);
      matching.sort((a, b) => Number(stale(a, nowMs, referenceMaxAgeDays)) - Number(stale(b, nowMs, referenceMaxAgeDays))
        || Number(gamingCpuModelFor(b.cpuModel) === cpuModel) - Number(gamingCpuModelFor(a.cpuModel) === cpuModel)
        || Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id));
      const reference = matching[0];
      if (!reference) continue;
      const differences = environmentDifferences(reference, options);
      const exact = differences.length === 0;
      if (stale(reference, nowMs, referenceMaxAgeDays)) staleReferenceIds.push(reference.id);
      const below = reference.averageFps < options.targetFps;
      measurements.push({
        referenceId: reference.id, gameId, sourceAverageFps: reference.averageFps,
        ...(reference.onePercentLowFps !== undefined ? { sourceOnePercentLowFps: reference.onePercentLowFps } : {}),
        referenceTargetRatio: reference.averageFps / options.targetFps, match: exact ? "exact" : "projected",
        targetFit: exact ? below ? "below" : "met" : "unknown", differences, sourceConditions: reference
      });
    }
  }
  const missingGameIds = gameIds.filter((id) => !measurements.some((measurement) => measurement.gameId === id));
  const belowTargetGameIds = measurements.filter((measurement) => measurement.sourceAverageFps < options.targetFps).map((measurement) => measurement.gameId);
  const allCovered = gameIds.length > 0 && missingGameIds.length === 0;
  const referenceTargetMet = allCovered && staleReferenceIds.length === 0 && belowTargetGameIds.length === 0;
  const targetMet = referenceTargetMet && measurements.every((measurement) => measurement.match === "exact");
  const canEstimate = allCovered && staleReferenceIds.length === 0 && measurements.every(({ sourceConditions: reference }) =>
    cpuModel !== undefined && gamingCpuModelFor(reference.cpuModel) === cpuModel
    && reference.memoryType === options.memoryType && reference.memoryCapacityGb !== undefined
    && reference.memoryCapacityGb === options.memoryCapacityGb);
  const estimatedTargetMet = canEstimate ? referenceTargetMet : undefined;
  const status: GamingTargetAssessmentStatus = gameIds.length === 0 ? "not_recorded"
    : measurements.length === 0 ? "missing" : staleReferenceIds.length > 0 ? "stale"
      : missingGameIds.length > 0 ? "partial" : belowTargetGameIds.length > 0 ? "target_not_met"
        : targetMet ? "verified" : "projected";
  const note = status === "verified" ? "같은 부품과 게임 설정으로 진행한 테스트에서 모든 게임의 평균 FPS가 설정한 값 이상이었습니다."
    : status === "projected" ? "테스트 PC의 평균 FPS는 설정한 값 이상이었습니다. 이 견적은 부품이나 설정이 같지 않을 수 있어 실제 FPS는 다를 수 있습니다."
      : status === "target_not_met" ? "테스트 PC의 평균 FPS가 설정한 값보다 낮습니다. 그래픽카드나 게임 옵션을 바꿔 다시 비교해 보세요."
        : status === "partial" ? "같은 그래픽카드와 게임 설정으로 테스트한 결과가 일부 게임에만 있습니다."
          : status === "stale" ? "테스트가 진행된 지 오래됐습니다. 게임 업데이트에 따라 FPS가 달라질 수 있습니다."
            : status === "not_recorded" ? "게임을 선택하면 테스트 FPS를 비교할 수 있습니다."
              : "이 그래픽카드와 게임 설정으로 테스트한 FPS를 찾지 못했습니다.";
  return {
    status, gameIds, targetFps: options.targetFps, resolution: options.resolution, graphicsPreset, rayTracing, upscaling, frameGeneration, referenceMaxAgeDays,
    ...(options.cpuPartId ? { cpuPartId: options.cpuPartId } : {}), ...(options.cpuName ? { cpuName: options.cpuName } : {}),
    ...(options.gpuPartId ? { gpuPartId: options.gpuPartId } : {}), ...(options.gpuName ? { gpuName: options.gpuName } : {}),
    targetMet, referenceTargetMet, ...(estimatedTargetMet !== undefined ? { estimatedTargetMet } : {}), ...(measurements.length > 0 ? { minimumTargetRatio: Math.min(...measurements.map((measurement) => measurement.referenceTargetRatio)) } : {}),
    missingGameIds, belowTargetGameIds, staleReferenceIds, measurements, note
  };
}
