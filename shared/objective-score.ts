import type { PartCategory } from "./types";

/**
 * Objective performance index model (v1).
 *
 * The generator and the build analysis used to score a part by its percentile
 * rank inside the *current candidate pool*, so adding or removing a catalog part
 * shifted every other score. This model replaces the pool-relative rank with a
 * fixed reference anchor per dimension: index = value / reference * 100.
 *
 * Anchors are pinned to a flagship-class reference point per spec dimension and
 * are versioned with the model. Changing an anchor requires bumping
 * OBJECTIVE_SCORE_MODEL_VERSION so cached scores stay interpretable.
 */
export const OBJECTIVE_SCORE_MODEL_VERSION = "objective-index-v2";

/** A dimension index is capped above 100 so halo parts still rank ahead of the
 *  reference part without letting a single runaway spec dominate the average. */
export const OBJECTIVE_SCORE_DIMENSION_CAP = 120;

/** Final part scores keep the 0~100 contract used by analysis bands and tier gates. */
export const OBJECTIVE_SCORE_MAX = 100;

export interface ObjectiveScoreAnchor {
  /** Raw value that maps to index 100. */
  reference: number;
  higherIsBetter: boolean;
  /**
   * "linear": index = value/reference (기본). "log": index = log(value)/log(reference).
   * 순차 처리량·IOPS처럼 체감이 포화되는 차원은 log로 눌러야 프리미엄 부품이
   * 실익 없이 예산을 흡수하지 않는다. 용량·점수 차원은 선형을 유지한다.
   */
  scale?: "linear" | "log";
}

/**
 * Fixed reference anchors per category + performance-dimension key.
 * Benchmark dimensions (Cinebench, 3DMark) are measured scores; the remaining
 * keys are spec proxies used only while a measured value is missing.
 */
export const OBJECTIVE_SCORE_ANCHORS: Record<PartCategory, Record<string, ObjectiveScoreAnchor>> = {
  cpu: {
    // Cinebench R23 reference points sit near current flagship desktop results.
    cinebenchR23Single: { reference: 2_300, higherIsBetter: true },
    cinebenchR23Multi: { reference: 45_000, higherIsBetter: true },
    cores: { reference: 24, higherIsBetter: true },
    threads: { reference: 32, higherIsBetter: true },
    boostClockGhz: { reference: 6, higherIsBetter: true },
    // 3D V-Cache급 L3 캐시. 게임 지연 민감 작업에서 실측 프레임과 가장 강하게 상관한다.
    l3CacheMb: { reference: 96, higherIsBetter: true }
  },
  gpu: {
    // 3DMark references sit near RTX 4090-class results.
    gpu3dmarkTimeSpyScore: { reference: 36_000, higherIsBetter: true },
    gpu3dmarkPortRoyalScore: { reference: 26_000, higherIsBetter: true },
    vramGb: { reference: 32, higherIsBetter: true },
    gpuMemoryBandwidthGbps: { reference: 1_800, higherIsBetter: true },
    gpuStreamProcessors: { reference: 21_760, higherIsBetter: true },
    gpuBoostClockMhz: { reference: 3_000, higherIsBetter: true }
  },
  memory: {
    capacityGb: { reference: 64, higherIsBetter: true },
    // 클럭이 필요량을 넘으면 체감 이익이 급감한다 — 8400 CUDIMM 프리미엄이
    // 6000급 표준 킷을 이기며 예산을 삼키는 것을 막는다.
    speedMhz: { reference: 8_400, higherIsBetter: true, scale: "log" },
    memoryEffectiveLatencyNs: { reference: 9, higherIsBetter: false },
    memoryCasLatency: { reference: 28, higherIsBetter: false },
    memoryRcdLatency: { reference: 30, higherIsBetter: false },
    memoryTrpLatency: { reference: 30, higherIsBetter: false },
    memoryTrasLatency: { reference: 60, higherIsBetter: false }
  },
  ssd: {
    capacityGb: { reference: 4_000, higherIsBetter: true },
    m2PcieGeneration: { reference: 5, higherIsBetter: true },
    sequentialReadMbps: { reference: 14_000, higherIsBetter: true, scale: "log" },
    sequentialWriteMbps: { reference: 12_000, higherIsBetter: true, scale: "log" },
    ssdReadIops: { reference: 1_500_000, higherIsBetter: true, scale: "log" },
    ssdWriteIops: { reference: 1_400_000, higherIsBetter: true, scale: "log" }
  },
  hdd: {
    capacityGb: { reference: 24_000, higherIsBetter: true },
    sequentialReadMbps: { reference: 300, higherIsBetter: true },
    sequentialWriteMbps: { reference: 300, higherIsBetter: true }
  },
  motherboard: {
    maxMemoryGb: { reference: 256, higherIsBetter: true },
    memorySlots: { reference: 4, higherIsBetter: true },
    m2Slots: { reference: 5, higherIsBetter: true }
  },
  cooler: {
    // 냉각 여유는 CPU 발열을 넘으면 소용이 없다 — 고부하 선호는
    // preferCoolerHeadroom에서 별도로 처리한다.
    maxCoolingW: { reference: 350, higherIsBetter: true, scale: "log" },
    radiatorSizeMm: { reference: 420, higherIsBetter: true, scale: "log" }
  },
  case: {
    // 케이스 크기 계열은 필요치를 넘는 여유가 거의 무의미하다 — 대형 케이스가
    // 길이·베이 수만으로 예산을 크게 쓰는 것을 막는다.
    maxGpuLengthMm: { reference: 460, higherIsBetter: true, scale: "log" },
    maxCoolerHeightMm: { reference: 200, higherIsBetter: true, scale: "log" },
    hddBays: { reference: 8, higherIsBetter: true, scale: "log" }
  },
  psu: {
    // 와트수는 적정 구간 안에서 효율·가격이 결정해야 한다 — 선형이면
    // 400W급 구성에서도 800W+ 파워가 점수 우위를 가져간다.
    wattageW: { reference: 1_600, higherIsBetter: true, scale: "log" },
    efficiency: { reference: 6, higherIsBetter: true }
  }
};

/** Dimensions backed by an actual benchmark measurement rather than a spec proxy. */
export const OBJECTIVE_BENCHMARK_DIMENSION_KEYS: ReadonlySet<string> = new Set([
  "cinebenchR23Single",
  "cinebenchR23Multi",
  "gpu3dmarkTimeSpyScore",
  "gpu3dmarkPortRoyalScore"
]);

export type ObjectiveScoreBasis = "benchmark" | "spec" | "mixed" | "none";

export interface ObjectiveScoreExtraTerm {
  /** Precomputed 0~100 term (e.g. a fixed target-fit score) folded into the mean. */
  index: number;
  weight: number;
}

export interface ObjectiveScore {
  /** Weighted index clamped to 0~100. Undefined when no anchored dimension exists. */
  score?: number;
  basis: ObjectiveScoreBasis;
  /** Anchored dimensions that had a usable value for this part. */
  knownDimensions: number;
  /** Anchored dimensions defined for the category. */
  totalDimensions: number;
  modelVersion: typeof OBJECTIVE_SCORE_MODEL_VERSION;
}

export function objectiveDimensionIndex(category: PartCategory, key: string, value: number): number | undefined {
  const anchor = OBJECTIVE_SCORE_ANCHORS[category]?.[key];
  if (!anchor || !Number.isFinite(value) || value <= 0) return undefined;
  const index = anchor.scale === "log"
    ? (anchor.higherIsBetter ? (Math.log(value) / Math.log(anchor.reference)) * 100 : (Math.log(anchor.reference) / Math.log(value)) * 100)
    : anchor.higherIsBetter ? (value / anchor.reference) * 100 : (anchor.reference / value) * 100;
  return Math.min(OBJECTIVE_SCORE_DIMENSION_CAP, Math.max(0, index));
}

export function objectiveScoreForDimensions(
  category: PartCategory,
  dimensions: Record<string, number | undefined>,
  weights: Record<string, number>,
  extras: readonly ObjectiveScoreExtraTerm[] = []
): ObjectiveScore {
  const anchoredKeys = Object.keys(OBJECTIVE_SCORE_ANCHORS[category] ?? {});
  let weighted = 0;
  let totalWeight = 0;
  let knownDimensions = 0;
  let benchmarkDimensions = 0;
  for (const [key, value] of Object.entries(dimensions)) {
    if (typeof value !== "number") continue;
    const index = objectiveDimensionIndex(category, key, value);
    if (index === undefined) continue;
    const weight = weights[key] ?? 1;
    weighted += index * weight;
    totalWeight += weight;
    knownDimensions += 1;
    if (OBJECTIVE_BENCHMARK_DIMENSION_KEYS.has(key)) benchmarkDimensions += 1;
  }
  for (const extra of extras) {
    if (!Number.isFinite(extra.index) || extra.weight <= 0) continue;
    weighted += Math.min(OBJECTIVE_SCORE_DIMENSION_CAP, Math.max(0, extra.index)) * extra.weight;
    totalWeight += extra.weight;
  }
  const basis: ObjectiveScoreBasis = knownDimensions === 0
    ? "none"
    : benchmarkDimensions === knownDimensions
      ? "benchmark"
      : benchmarkDimensions > 0
        ? "mixed"
        : "spec";
  return {
    ...(totalWeight > 0 ? { score: Math.max(0, Math.min(OBJECTIVE_SCORE_MAX, Math.round(weighted / totalWeight))) } : {}),
    basis,
    knownDimensions,
    totalDimensions: anchoredKeys.length,
    modelVersion: OBJECTIVE_SCORE_MODEL_VERSION
  };
}
