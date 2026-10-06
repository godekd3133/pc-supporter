import { describe, expect, it } from "vitest";
import snapshot from "../server/reference-data/gaming-fps-reference.json";
import {
  gamingCpuModelFor, gamingFpsReferencesFromJson, gamingFpsReferencesFromUnknown,
  gamingGpuModelFor, gamingTargetAssessmentFor,
  type GamingFpsReference, type GamingTargetAssessmentOptions
} from "./gaming-target-assessment";

const now = "2026-10-05T00:00:00.000Z";

function reference(overrides: Partial<GamingFpsReference> = {}): GamingFpsReference {
  return {
    id: "lab-cyberpunk-5070", gameId: "cyberpunk", cpuModel: "Ryzen 7 9800X3D",
    gpuModel: "RTX 5070", gpuName: "MSI RTX 5070 Gaming Trio White 12GB", gpuVramGb: 12,
    resolution: "1440p", graphicsPreset: "high", sourcePreset: "Ultra Quality", rayTracing: false,
    upscaling: "native", upscaler: "none", frameGeneration: false, averageFps: 90, onePercentLowFps: 79,
    memoryType: "DDR5", memorySpeedMhz: 6000, memoryCapacityGb: 32, memoryModuleCount: 2,
    memoryTiming: "CL30-38-38-96", driverVersion: "610.88", operatingSystem: "Windows 11 25H2",
    gameVersion: "2.31", scene: "Built-in Benchmark", sourceKind: "lab", sourceTitle: "Fixture laboratory measurement",
    sourceUrl: "https://example.com/lab/cyberpunk", publishedAt: "2026-09-24T00:00:00.000Z",
    verifiedAt: "2026-10-04T22:00:10.000Z", sourceNote: "Synthetic test fixture, not production evidence.", ...overrides
  };
}

function options(overrides: Partial<GamingTargetAssessmentOptions> = {}): GamingTargetAssessmentOptions {
  return {
    gameIds: ["cyberpunk"], cpuName: "AMD Ryzen 7 9800X3D", gpuName: "MSI RTX 5070 Gaming Trio White 12GB",
    gpuVramGb: 12, resolution: "1440p", targetFps: 60, graphicsPreset: "high", rayTracing: false,
    upscaling: "native", frameGeneration: "off", memoryType: "DDR5", memorySpeedMhz: 6000,
    memoryCapacityGb: 32, memoryModuleCount: 2, memoryTiming: "CL30-38-38-96",
    sourcePreset: "Ultra Quality", driverVersion: "610.88", operatingSystem: "Windows 11 25H2",
    gameVersion: "2.31", scene: "Built-in Benchmark", ...overrides
  };
}

describe("absolute gaming FPS source validation", () => {
  it("loads the independently inspected current references with six game identities", () => {
    const records = gamingFpsReferencesFromUnknown(snapshot);
    expect(records).toHaveLength(80);
    expect(new Set(records.map((record) => record.gameId))).toEqual(new Set(["cyberpunk", "forza5", "cs2", "fortnite", "arkAscended", "helldivers2"]));
    expect(records.every((record) => record.sourceImageUrl?.startsWith("https://www.techspot.com/articles-info/") && record.onePercentLowFps! <= record.averageFps)).toBe(true);
    expect(records.some((record) => record.gpuModel === "RTX 5060 Ti" && record.gpuVramGb === 8)).toBe(false);
  });

  it("rejects legacy records whose CPU and frame generation conditions were not recorded", () => {
    const { cpuModel, frameGeneration, ...gpuOnlyLegacy } = reference();
    expect(gamingFpsReferencesFromUnknown([{ ...gpuOnlyLegacy, averageFps: 196 }])).toEqual([]);
  });

  it.each([
    { averageFps: 0 }, { averageFps: NaN }, { onePercentLowFps: 91 }, { cpuModel: undefined },
    { frameGeneration: undefined }, { sourceUrl: "http://example.com" }, { sourceImageUrl: "javascript:alert(1)" },
    { upscaling: "native", upscaler: "dlss" }, { upscaling: "quality", upscaler: "none" },
    { verifiedAt: "2020-01-01" }, { memorySpeedMhz: undefined }
  ])("rejects incomplete or invalid source conditions %j", (overrides) => {
    expect(gamingFpsReferencesFromUnknown([reference(overrides as Partial<GamingFpsReference>)])).toEqual([]);
  });

  it("fails the complete file closed on malformed or duplicate records", () => {
    expect(gamingFpsReferencesFromUnknown([reference(), { broken: true }])).toEqual([]);
    expect(gamingFpsReferencesFromUnknown([reference(), reference()])).toEqual([]);
    expect(gamingFpsReferencesFromJson("not JSON")).toEqual([]);
  });
});

describe("condition-aware target FPS assessment", () => {
  it("only verifies when every recorded environment condition matches and passes", () => {
    expect(gamingTargetAssessmentFor([reference()], options(), now)).toMatchObject({ status: "verified", targetMet: true, referenceTargetMet: true, estimatedTargetMet: true, minimumTargetRatio: 1.5 });
  });

  it("reuses a source measurement across target FPS values rather than treating the target as a measurement condition", () => {
    expect(gamingTargetAssessmentFor([reference()], options({ targetFps: 144 }), now)).toMatchObject({ status: "target_not_met", targetMet: false, estimatedTargetMet: false, belowTargetGameIds: ["cyberpunk"], measurements: [{ sourceAverageFps: 90 }] });
  });

  it("never multiplies absolute FPS by a CPU or GPU relative performance percentage", () => {
    const result = gamingTargetAssessmentFor([reference()], options({ cpuName: "AMD Ryzen 5 5600" }), now);
    expect(result).toMatchObject({ status: "projected", targetMet: false, referenceTargetMet: true, measurements: [{ sourceAverageFps: 90, targetFit: "unknown", match: "projected" }] });
    expect(result.estimatedTargetMet).toBeUndefined();
    expect(result.measurements[0].differences.some((difference) => difference.startsWith("CPU:"))).toBe(true);
  });

  it.each([{ memoryType: "DDR4" }, { memoryCapacityGb: 16 }, { memoryCapacityGb: undefined }])("does not claim an estimate with different or unknown RAM type/capacity %j", (changes) => {
    const result = gamingTargetAssessmentFor([reference()], options(changes), now);
    expect(result.targetMet).toBe(false);
    expect(result.estimatedTargetMet).toBeUndefined();
    expect(result.measurements[0].sourceAverageFps).toBe(90);
  });

  it("keeps CPU/RAM matching but different memory timing, speed and board partner in the projection lane", () => {
    const result = gamingTargetAssessmentFor([reference()], options({ gpuName: "GIGABYTE RTX 5070 12GB", memorySpeedMhz: 5600, memoryTiming: "CL46" }), now);
    expect(result).toMatchObject({ status: "projected", targetMet: false, estimatedTargetMet: true, measurements: [{ sourceAverageFps: 90 }] });
    expect(result.measurements[0].differences).toHaveLength(3);
  });

  it("does not fill missing source environment fields from the generated PC", () => {
    const result = gamingTargetAssessmentFor([reference({ memoryCapacityGb: undefined, gameVersion: undefined })], options(), now);
    expect(result.targetMet).toBe(false);
    expect(result.estimatedTargetMet).toBeUndefined();
    expect(result.measurements[0].differences.some((difference) => difference.includes("기사에 표시 없음"))).toBe(true);
  });

  it.each([
    { resolution: "1080p" }, { graphicsPreset: "balanced" }, { sourcePreset: "High Quality" },
    { rayTracing: true }, { upscaling: "quality" }, { frameGeneration: "on" }, { gpuVramGb: 16 },
    { gpuName: "RTX 5070 Ti 16GB", gpuVramGb: 16 }, { gpuName: undefined }, { gpuName: "RTX 5070 Laptop 12GB" }
  ])("does not interpolate from a different GPU or rendering condition %j", (changes) => {
    const result = gamingTargetAssessmentFor([reference()], options(changes as Partial<GamingTargetAssessmentOptions>), now);
    expect(result).toMatchObject({ status: "missing", targetMet: false, measurements: [], missingGameIds: ["cyberpunk"] });
    expect(result.minimumTargetRatio).toBeUndefined();
  });

  it("cannot turn generated frames into native FPS evidence", () => {
    expect(gamingTargetAssessmentFor([reference({ frameGeneration: true, averageFps: 196 })], options(), now)).toMatchObject({ status: "missing", targetMet: false, measurements: [] });
  });

  it("cannot claim all requested games when one game has no reference", () => {
    expect(gamingTargetAssessmentFor([reference()], options({ gameIds: ["cyberpunk", "valorant"] }), now)).toMatchObject({ status: "partial", targetMet: false, referenceTargetMet: false, missingGameIds: ["valorant"], measurements: [{ gameId: "cyberpunk" }] });
  });

  it("keeps the absolute observation but removes fulfillment for old or future-dated sources", () => {
    for (const publishedAt of ["2025-04-16T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]) {
      const result = gamingTargetAssessmentFor([reference({ publishedAt })], options(), now);
      expect(result).toMatchObject({ status: "stale", targetMet: false, referenceTargetMet: false, staleReferenceIds: ["lab-cyberpunk-5070"], measurements: [{ sourceAverageFps: 90 }] });
    }
  });

  it("allows an explicit age policy up to one year without refreshing the benchmark date", () => {
    const old = reference({ publishedAt: "2026-01-01T00:00:00.000Z" });
    expect(gamingTargetAssessmentFor([old], options(), now).status).toBe("stale");
    expect(gamingTargetAssessmentFor([old], options({ referenceMaxAgeDays: 365 }), now)).toMatchObject({ status: "verified", referenceMaxAgeDays: 365 });
  });

  it.each([0, 29, 60.5, 501, NaN])("fails invalid target FPS closed: %s", (targetFps) => {
    expect(gamingTargetAssessmentFor([reference()], options({ targetFps }), now)).toMatchObject({ status: "missing", targetMet: false, measurements: [] });
  });

  it("marks production samples as source-system comparisons, retaining the original source conditions", () => {
    const result = gamingTargetAssessmentFor(gamingFpsReferencesFromUnknown(snapshot), options({ gpuName: "GIGABYTE 지포스 RTX 5070 12GB", cpuName: "AMD 라이젠5 7500F", sourcePreset: undefined, memoryCapacityGb: 16 }), now);
    expect(result).toMatchObject({ status: "projected", targetMet: false, referenceTargetMet: true, measurements: [{ sourceAverageFps: 90, sourceOnePercentLowFps: 79, sourceConditions: { cpuModel: "Ryzen 7 9800X3D", sourcePreset: "Ultra Quality", publishedAt: "2026-09-07T00:00:00.000Z" } }] });
    expect(result.estimatedTargetMet).toBeUndefined();
  });

  it("does not borrow the 16GB result for a 5060 Ti 8GB", () => {
    expect(gamingTargetAssessmentFor(gamingFpsReferencesFromUnknown(snapshot), options({ gpuName: "RTX 5060 Ti 8GB", gpuVramGb: 8 }), now)).toMatchObject({ status: "missing", measurements: [], targetMet: false });
  });

  it("handles no game selection without inventing a default game", () => {
    expect(gamingTargetAssessmentFor([reference()], options({ gameIds: [] }), now)).toMatchObject({ status: "not_recorded", gameIds: [], targetMet: false });
  });
});

describe("hardware identity boundaries", () => {
  it("distinguishes CPU suffixes and GPU Ti/SUPER/XT variants", () => {
    expect(gamingCpuModelFor("AMD Ryzen 9 9950X3D2")).toBe("9950X3D2");
    expect(gamingCpuModelFor("AMD 라이젠 5500GT")).toBe("5500GT");
    expect(gamingGpuModelFor("MSI GeForce RTX5070Ti 16GB")).toBe("RTX 5070 TI");
    expect(gamingGpuModelFor("SAPPHIRE Radeon RX9070XT 16GB")).toBe("RX 9070 XT");
    expect(gamingGpuModelFor("MSI GeForce RTX 5070 Laptop")).toBeUndefined();
  });
});
