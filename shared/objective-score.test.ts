import { describe, expect, it } from "vitest";
import {
  OBJECTIVE_BENCHMARK_DIMENSION_KEYS,
  OBJECTIVE_SCORE_ANCHORS,
  OBJECTIVE_SCORE_DIMENSION_CAP,
  OBJECTIVE_SCORE_MAX,
  OBJECTIVE_SCORE_MODEL_VERSION,
  objectiveDimensionIndex,
  objectiveScoreForDimensions
} from "./objective-score";
import { PART_CATEGORIES } from "./types";

const CPU_DIMS = {
  cinebenchR23Single: 2073,
  cinebenchR23Multi: 23334,
  cores: 8,
  threads: 16,
  boostClockGhz: 5.2
};

const WEIGHTS = { cinebenchR23Single: 6, cinebenchR23Multi: 7, cores: 4, threads: 3, boostClockGhz: 2 };

describe("objective score model", () => {
  it("gives a part the same score regardless of which peers are in the catalog", () => {
    const alone = objectiveScoreForDimensions("cpu", CPU_DIMS, WEIGHTS);
    const withStrongerPeer = objectiveScoreForDimensions("cpu", CPU_DIMS, WEIGHTS);
    const flagship = objectiveScoreForDimensions("cpu", {
      cinebenchR23Single: 2300,
      cinebenchR23Multi: 45000,
      cores: 24,
      threads: 32,
      boostClockGhz: 6
    }, WEIGHTS);
    expect(alone.score).toBe(withStrongerPeer.score);
    expect(flagship.score).toBe(100);
    expect(alone.score).toBeGreaterThan(0);
    expect(alone.score).toBeLessThan(flagship.score ?? 0);
  });

  it("maps the anchor reference value to index 100 and scales monotonically", () => {
    expect(objectiveDimensionIndex("cpu", "cinebenchR23Multi", 45_000)).toBe(100);
    expect(objectiveDimensionIndex("cpu", "cinebenchR23Multi", 22_500)).toBe(50);
    expect(objectiveDimensionIndex("gpu", "gpu3dmarkTimeSpyScore", 36_000)).toBe(100);
    expect(objectiveDimensionIndex("gpu", "gpu3dmarkTimeSpyScore", 18_000)).toBe(50);
  });

  it("caps runaway dimension indexes so a single spec cannot dominate", () => {
    expect(objectiveDimensionIndex("cpu", "cinebenchR23Multi", 90_000)).toBe(OBJECTIVE_SCORE_DIMENSION_CAP);
    const halo = objectiveScoreForDimensions("cpu", { cinebenchR23Multi: 90_000 }, { cinebenchR23Multi: 1 });
    expect(halo.score).toBe(OBJECTIVE_SCORE_MAX);
  });

  it("inverts the index for lower-is-better dimensions", () => {
    const tight = objectiveDimensionIndex("memory", "memoryCasLatency", 28);
    const loose = objectiveDimensionIndex("memory", "memoryCasLatency", 40);
    expect(tight).toBe(100);
    expect(loose).toBeLessThan(tight ?? 0);
  });

  it("leaves the score undefined when no anchored dimension is present", () => {
    const result = objectiveScoreForDimensions("cpu", { cores: undefined }, WEIGHTS);
    expect(result.score).toBeUndefined();
    expect(result.basis).toBe("none");
    expect(result.knownDimensions).toBe(0);
    expect(result.totalDimensions).toBe(Object.keys(OBJECTIVE_SCORE_ANCHORS.cpu).length);
    expect(result.modelVersion).toBe(OBJECTIVE_SCORE_MODEL_VERSION);
  });

  it("keeps unanchored dimension keys out of the score instead of guessing", () => {
    const result = objectiveScoreForDimensions("cpu", { ...CPU_DIMS, mysteryMetric: 999 }, WEIGHTS);
    expect(result.knownDimensions).toBe(5);
  });

  it("reports benchmark vs spec basis honestly", () => {
    const benchmarkOnly = objectiveScoreForDimensions("gpu", { gpu3dmarkTimeSpyScore: 18_000 }, { gpu3dmarkTimeSpyScore: 1 });
    const specOnly = objectiveScoreForDimensions("gpu", { vramGb: 16 }, { vramGb: 1 });
    const mixed = objectiveScoreForDimensions("gpu", { gpu3dmarkTimeSpyScore: 18_000, vramGb: 16 }, { gpu3dmarkTimeSpyScore: 1, vramGb: 1 });
    expect(benchmarkOnly.basis).toBe("benchmark");
    expect(specOnly.basis).toBe("spec");
    expect(mixed.basis).toBe("mixed");
  });

  it("folds fixed target-fit extras into the weighted mean", () => {
    const base = objectiveScoreForDimensions("gpu", { vramGb: 16 }, { vramGb: 1 });
    const boosted = objectiveScoreForDimensions("gpu", { vramGb: 16 }, { vramGb: 1 }, [{ index: 100, weight: 1 }]);
    expect(boosted.score).toBeGreaterThan(base.score ?? 0);
  });

  it("defines an anchor for every performance dimension the engine emits", () => {
    const emitted: Record<string, string[]> = {
      cpu: ["cinebenchR23Single", "cinebenchR23Multi", "cores", "threads", "boostClockGhz", "l3CacheMb"],
      gpu: ["gpu3dmarkTimeSpyScore", "gpu3dmarkPortRoyalScore", "vramGb", "gpuMemoryBandwidthGbps", "gpuStreamProcessors", "gpuBoostClockMhz"],
      memory: ["capacityGb", "speedMhz", "memoryEffectiveLatencyNs", "memoryCasLatency", "memoryRcdLatency", "memoryTrpLatency", "memoryTrasLatency"],
      ssd: ["capacityGb", "m2PcieGeneration", "sequentialReadMbps", "sequentialWriteMbps", "ssdReadIops", "ssdWriteIops"],
      hdd: ["capacityGb", "sequentialReadMbps", "sequentialWriteMbps"],
      motherboard: ["maxMemoryGb", "memorySlots", "m2Slots"],
      cooler: ["maxCoolingW", "radiatorSizeMm"],
      case: ["maxGpuLengthMm", "maxCoolerHeightMm", "hddBays"],
      psu: ["wattageW", "efficiency"]
    };
    for (const category of PART_CATEGORIES) {
      const anchors = OBJECTIVE_SCORE_ANCHORS[category];
      expect(Object.keys(anchors).sort()).toEqual((emitted[category] ?? []).sort());
    }
    for (const anchors of Object.values(OBJECTIVE_SCORE_ANCHORS)) {
      for (const anchor of Object.values(anchors)) {
        expect(anchor.reference).toBeGreaterThan(0);
      }
    }
    expect(OBJECTIVE_BENCHMARK_DIMENSION_KEYS.size).toBe(4);
  });
});

it("compresses saturating throughput dimensions so premium speed does not dominate budget", () => {
  const weights = { capacityGb: 1, sequentialReadMbps: 2, sequentialWriteMbps: 2 };
  const gen4Score = objectiveScoreForDimensions("ssd", { capacityGb: 2000, sequentialReadMbps: 7450, sequentialWriteMbps: 6900 }, weights);
  const gen5Score = objectiveScoreForDimensions("ssd", { capacityGb: 2000, sequentialReadMbps: 14500, sequentialWriteMbps: 12700 }, weights);
  // Linear scaling would give gen4 ~50 vs gen5 ~100 — a 50-point gap. Log compression
  // keeps the real gap small so halo SSDs cannot absorb budget for benchmark numbers.
  expect(gen4Score.score).toBeGreaterThanOrEqual(80);
  expect(gen5Score.score).toBeGreaterThanOrEqual(gen4Score.score ?? 0);
  expect((gen5Score.score ?? 0) - (gen4Score.score ?? 0)).toBeLessThanOrEqual(15);
});
