import { applyGamingStorageCatalogSnapshot } from "./gaming-storage-catalog";
import { applyGamingSupportCatalogSnapshot } from "./gaming-support-catalog";
import { applyGamingTargetCatalogSnapshot } from "./gaming-target-catalog";
import { applyGamingAmdCatalogSnapshot } from "./gaming-amd-catalog";
import { describe, expect, it } from "vitest";
import { evaluateBuild, generateBuildDraft } from "./engine";
import { applyPhase1CatalogSnapshot } from "./phase1-catalog";
import { gamingFpsReferences } from "./gaming-fps-reference";
import { parseBuildGenerationRequest } from "../shared/domain/build-input";
import { publicApiPayloadProjection } from "../shared/public-api-projection";
import { compatibilityReportJsonFor, compatibilityReportTextFor } from "../shared/compatibility-report";
import type { BuildGenerationRequest, CompatibilityResult } from "../shared/types";

const catalog = applyGamingStorageCatalogSnapshot(applyGamingTargetCatalogSnapshot(applyGamingSupportCatalogSnapshot(applyGamingAmdCatalogSnapshot(applyPhase1CatalogSnapshot([])))));
const options = { gamingTestbedPhase1: true, gamingFpsReferences };
const request: BuildGenerationRequest = { profile: "gaming", gamingTestbedPhase1: true, gamingMode: "target_fps", gamingTargetFps: 60, gamingGameIds: ["cyberpunk"], gamingResolution: "1440p", gamingGraphicsPreset: "high", gamingRayTracing: false, gamingUpscaling: "native", gpuVendorPreference: "nvidia", budgetWon: 5_000_000, includeGpu: true, memoryCapacityGb: 16, storageCapacityGb: 1000 };

describe("phase-two gaming generation contract", () => {
  it("selects an economical measured CPU/GPU combination instead of spending the budget on the strongest GPU", () => {
    const draft = generateBuildDraft(catalog, request, [], options);
    expect(draft.lines.find((line) => line.category === "cpu")?.name).toMatch(/9800X3D/);
    expect(draft.lines.find((line) => line.category === "gpu")?.name).toMatch(/5060\s*Ti.*16GB/);
    expect(draft.gamingTargetAssessment).toMatchObject({ status: "projected", referenceTargetMet: true, targetMet: false, targetFps: 60 });
    expect(draft.gamingTargetAssessment?.estimatedTargetMet).toBeUndefined();
    expect(draft.withinBudget).toBe(true);
    expect(draft.blockerCount).toBe(0);
    expect(draft.partTierSuitability?.memory?.minimum).toBe("met");
  });
  it("uses the minimum reference result across all selected games and raises GPU for a higher goal", () => {
    const draft = generateBuildDraft(catalog, { ...request, gamingGameIds: ["cyberpunk", "forza5"], gamingTargetFps: 100 }, [], options);
    expect(draft.lines.find((line) => line.category === "gpu")?.name).toMatch(/5070\s*Ti/);
    expect(draft.gamingTargetAssessment?.missingGameIds).toEqual([]);
    expect(draft.gamingTargetAssessment?.referenceTargetMet).toBe(true);
  });
  it("prefers a recorded 32GB RAM condition over a cheaper 16GB reference-only match", () => {
    const reference = { ...gamingFpsReferences.find((ref) => ref.gameId === "cyberpunk" && ref.gpuModel === "RTX 5060 Ti" && ref.gpuVramGb === 16 && ref.resolution === "1440p")!, id: "fixture-known-ram-32", memoryCapacityGb: 32 };
    expect(reference.averageFps).toBeGreaterThanOrEqual(request.gamingTargetFps!);
    const sourceOptions = { ...options, gamingFpsReferences: [reference] };
    const knownCapacity = generateBuildDraft(catalog, request, [], sourceOptions);
    const unknownCapacity = generateBuildDraft(catalog, request, [], { ...options, gamingFpsReferences: [{ ...reference, memoryCapacityGb: undefined }] });
    expect(knownCapacity.selection.cpu?.partId).toBe(unknownCapacity.selection.cpu?.partId);
    expect(knownCapacity.selection.gpu?.partId).toBe(unknownCapacity.selection.gpu?.partId);
    expect(knownCapacity.memoryCapacityGb).toBe(32);
    expect(unknownCapacity.memoryCapacityGb).toBe(16);
    expect(knownCapacity.totalPriceWon).toBeGreaterThan(unknownCapacity.totalPriceWon);
    expect(knownCapacity.withinBudget).toBe(true);
    expect(unknownCapacity.withinBudget).toBe(true);
    expect(knownCapacity.gamingTargetAssessment).toMatchObject({ referenceTargetMet: true, estimatedTargetMet: true, targetMet: false });
    expect(unknownCapacity.gamingTargetAssessment?.estimatedTargetMet).toBeUndefined();
  });
  it("preserves an explicit 64GB minimum when the recorded reference uses 32GB", () => {
    const reference = { ...gamingFpsReferences.find((ref) => ref.gameId === "cyberpunk" && ref.gpuModel === "RTX 5060 Ti" && ref.gpuVramGb === 16 && ref.resolution === "1440p")!, id: "fixture-known-ram-32", memoryCapacityGb: 32 };
    const draft = generateBuildDraft(catalog, { ...request, memoryCapacityGb: 64 }, [], { ...options, gamingFpsReferences: [reference] });
    expect(draft.memoryCapacityGb).toBe(64);
    expect(draft.selection.memory.reduce((sum, selection) => sum + catalog.find((part) => part.id === selection.partId)!.specs.capacityGb! * selection.quantity, 0)).toBeGreaterThanOrEqual(64);
    expect(draft.gamingTargetAssessment).toMatchObject({ referenceTargetMet: true, targetMet: false });
    expect(draft.gamingTargetAssessment?.estimatedTargetMet).toBeUndefined();
  });
  it("retains an honest reference-only comparison when matching 32GB exceeds the budget", () => {
    const reference = { ...gamingFpsReferences.find((ref) => ref.gameId === "cyberpunk" && ref.gpuModel === "RTX 5060 Ti" && ref.gpuVramGb === 16 && ref.resolution === "1440p")!, id: "fixture-known-ram-32", memoryCapacityGb: 32 };
    const cheaper = generateBuildDraft(catalog, request, [], { ...options, gamingFpsReferences: [{ ...reference, memoryCapacityGb: undefined }] });
    const draft = generateBuildDraft(catalog, { ...request, budgetWon: cheaper.totalPriceWon }, [], { ...options, gamingFpsReferences: [reference] });
    expect(draft.withinBudget).toBe(true);
    expect(draft.memoryCapacityGb).toBe(16);
    expect(draft.gamingTargetAssessment).toMatchObject({ status: "projected", referenceTargetMet: true, targetMet: false });
    expect(draft.gamingTargetAssessment?.estimatedTargetMet).toBeUndefined();
    expect(draft.gamingTargetAssessment?.measurements[0].differences.some((item) => item.startsWith("RAM 용량:"))).toBe(true);
  });
  it("keeps 16GB when the public FPS reference does not record RAM capacity", () => {
    const unknownCapacityReferences = gamingFpsReferences.map((ref) => ({ ...ref, memoryCapacityGb: undefined }));
    const draft = generateBuildDraft(catalog, request, [], { ...options, gamingFpsReferences: unknownCapacityReferences });
    expect(draft.memoryCapacityGb).toBe(16);
    expect(draft.gamingTargetAssessment?.estimatedTargetMet).toBeUndefined();
  });
  it("keeps unsupported conditions missing and never manufactures target fulfillment", () => {
    const draft = generateBuildDraft(catalog, { ...request, gamingUpscaling: "quality" }, [], options);
    expect(draft.gamingTargetAssessment).toMatchObject({ status: "missing", targetMet: false, referenceTargetMet: false });
    expect(draft.gamingTargetAssessment?.measurements).toEqual([]);
  });
  it("never replaces an explicit AMD choice with NVIDIA and never uses the other vendor in adjacency", () => {
    const draft = generateBuildDraft(catalog, { ...request, gamingMode: "budget", gamingGameIds: [], gpuVendorPreference: "amd", budgetWon: 1_200_000 }, [], options);
    expect(draft.lines.find((line) => line.category === "gpu")?.name).toMatch(/RX\s*9060/);
    const adjacent = catalog.find((part) => part.id === draft.partTiers?.gpu?.upId);
    expect(adjacent?.specs.gpuVendor).not.toBe("nvidia");
  });
  it("excludes a cheaper unverified physical product from the measured-pair search", () => {
    const gpu = catalog.find((part) => part.category === "gpu" && /5060\s*Ti.*16GB/.test(part.name))!;
    const invalid = { ...gpu, id: "invalid-cheap-gpu", sourceProductCode: "invalid-cheap-gpu", priceWon: 1, specs: { ...gpu.specs, lengthMm: undefined } };
    const draft = generateBuildDraft([...catalog, invalid], request, [], options);
    expect(draft.selection.gpu?.partId).not.toBe(invalid.id);
  });
  it("rejects invalid targets, unknown game IDs and integrated-only target requests", () => {
    expect(parseBuildGenerationRequest(request).errors).toEqual([]);
    for (const patch of [{ gamingTargetFps: 29 }, { gamingTargetFps: 501 }, { gamingTargetFps: 60.1 }, { gamingGameIds: [] }, { gamingGameIds: ["not-a-game"] }, { includeGpu: false }]) expect(parseBuildGenerationRequest({ ...request, ...patch }).errors.length).toBeGreaterThan(0);
  });
  it("retains the highest affordable GPU before increasing appropriate RAM", () => {
    const draft = generateBuildDraft(catalog, { ...request, gamingMode: "budget" }, [], options);
    const baseline = generateBuildDraft(catalog, { ...request, gamingMode: undefined }, [], options);
    expect(draft.selection.gpu?.partId).toBe(baseline.selection.gpu?.partId);
    expect(draft.memoryCapacityGb).toBe(32);
    expect(draft.withinBudget).toBe(true);
  });
  it("exposes requested absolute FPS while continuing to redact private benchmark signals in API and export", () => {
    const draft = generateBuildDraft(catalog, request, [], options);
    const target = { ...draft.gamingTargetAssessment!, benchmarkSnapshot: { secret: true }, score: 1 };
    const projected = publicApiPayloadProjection({ averageFps: 900, gamingTargetAssessment: target }) as Record<string, any>;
    expect(projected.averageFps).toBeUndefined();
    expect(projected.gamingTargetAssessment.targetFps).toBe(60);
    expect(projected.gamingTargetAssessment.measurements[0].sourceConditions.averageFps).toBe(69);
    expect(projected.gamingTargetAssessment.score).toBeUndefined();
    const result = { ...evaluateBuild(draft.selection, catalog), recommendationPreferences: { ...request, priority: "balanced" }, gamingTargetAssessment: target } as CompatibilityResult;
    const payload = JSON.parse(compatibilityReportJsonFor(result, draft.selection, result.recommendationPreferences, new Map(catalog.map((part) => [part.id, part]))));
    expect(payload.result.gamingTargetAssessment.targetFps).toBe(60);
    expect(payload.result.gamingTargetAssessment.benchmarkSnapshot).toBeUndefined();
    expect(payload.result.gamingTargetAssessment.score).toBeUndefined();
    expect(compatibilityReportTextFor(result, draft.selection, new Map(catalog.map((part) => [part.id, part])), new Map())).toContain("테스트 PC 평균 69 FPS");
  });
});

it("returns from a paid cooler to the included cooler without pinning a fake stock part", async () => {
  const { generatorPartAdjustmentRequestFor } = await import("../src/generator-balance");
  const cpu = catalog.find((part) => part.category === "cpu" && /5500GT/.test(part.name))!;
  const cooler = catalog.find((part) => part.category === "cooler" && /AG400/.test(part.name))!;
  const paid = generateBuildDraft(catalog, { ...request, gamingMode: "budget", includeGpu: false, budgetWon: 1_000_000, pinnedParts: { cpu: cpu.id, cooler: cooler.id } }, [], options);
  expect(paid.partTiers?.cooler?.downUseIncludedCooler).toBe(true);
  const down = generatorPartAdjustmentRequestFor(paid, "cooler", "down")!;
  expect(down.pinnedParts?.cooler).toBeUndefined();
  const stock = generateBuildDraft(catalog, down, [], options);
  expect(stock.selection.cooler).toBeUndefined();
  expect(stock.selection.cpu?.partId).toBe(cpu.id);
  expect(stock.totalPriceWon).toBeLessThan(paid.totalPriceWon);
});

it("changes SSD capacity 1TB to 2TB and back while retaining integrated graphics", async () => {
  const { generatorPartAdjustmentRequestFor } = await import("../src/generator-balance");
  const base = generateBuildDraft(catalog, { ...request, gamingMode: "budget", budgetWon: 1_000_000, includeGpu: false }, [], options);
  const up = generatorPartAdjustmentRequestFor(base, "ssd", "up")!;
  expect(up.storageCapacityGb).toBe(2000);
  expect(up.includeGpu).toBe(false);
  const larger = generateBuildDraft(catalog, up, [], options);
  expect(catalog.find((part) => part.id === larger.selection.ssd[0].partId)?.specs.capacityGb).toBe(2000);
  expect(larger.selection.gpu).toBeUndefined();
  const smaller = generateBuildDraft(catalog, generatorPartAdjustmentRequestFor(larger, "ssd", "down")!, [], options);
  expect(smaller.storageCapacityGb).toBe(1000);
  expect(catalog.find((part) => part.id === smaller.selection.ssd[0].partId)?.specs.capacityGb).toBe(1000);
});

it("changes HDD drive capacity while keeping both drives and the CPU", async () => {
  const { generatorPartAdjustmentRequestFor } = await import("../src/generator-balance");
  const base = generateBuildDraft(catalog, { ...request, gamingMode: "budget", budgetWon: 2_000_000, includeGpu: false, hddCount: 2, hddCapacityGb: 2000 }, [], options);
  const up = generatorPartAdjustmentRequestFor(base, "hdd", "up")!;
  expect(up.hddCapacityGb).toBe(4000);
  expect(up.hddCount).toBe(2);
  const larger = generateBuildDraft(catalog, up, [], options);
  expect(larger.selection.cpu).toEqual(base.selection.cpu);
  expect(larger.selection.hdd[0].quantity).toBe(2);
  expect(catalog.find((part) => part.id === larger.selection.hdd[0].partId)?.specs.capacityGb).toBe(4000);
  const smaller = generateBuildDraft(catalog, generatorPartAdjustmentRequestFor(larger, "hdd", "down")!, [], options);
  expect(smaller.hddCapacityGb).toBe(2000);
  expect(smaller.selection.hdd[0].quantity).toBe(2);
});
