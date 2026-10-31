import type { BuildGenerationRequest, BuildGenerationResult, PartCategory } from "../shared/types";
import { gamingAdjustmentDependentCategories } from "../shared/gaming-adjustment-dependencies";

export function generatorRequestForDraft(draft: BuildGenerationResult): BuildGenerationRequest {
  return {
    profile: draft.profile,
    gamingMode: draft.gamingMode,
    gamingTargetFps: draft.gamingTargetFps,
    gpuVendorPreference: draft.gpuVendorPreference,
    cpuVendorPreference: draft.cpuVendorPreference,
    memoryTypePreference: draft.memoryTypePreference,
    gamingTestbedPhase1: draft.gamingTestbedPhase1,
    priority: draft.priority,
    performanceTier: draft.performanceTier,
    budgetWon: draft.budgetWon,
    includeGpu: Boolean(draft.selection.gpu?.partId),
    gamingResolution: draft.gamingResolution,
    gamingRefreshRate: draft.gamingRefreshRate,
    gamingGameIds: draft.gamingGameIds,
    gamingGraphicsPreset: draft.gamingGraphicsPreset,
    gamingRayTracing: draft.gamingRayTracing,
    gamingUpscaling: draft.gamingUpscaling,
    memoryCapacityGb: draft.memoryCapacityGb,
    storageCapacityGb: draft.storageCapacityGb,
    hddCapacityGb: draft.hddCapacityGb,
    hddCount: draft.hddCount,
    listingPolicy: draft.listingPolicy
  };
}

export function pinnedPartsForChange(draft: BuildGenerationResult, category: PartCategory, targetId: string | undefined, released: Set<PartCategory>): BuildGenerationRequest["pinnedParts"] {
  const pinnedParts: Partial<Record<PartCategory, string>> = {};
  for (const line of draft.lines) {
    if (!released.has(line.category)) pinnedParts[line.category] = line.partId;
  }
  if (targetId) pinnedParts[category] = targetId;
  return pinnedParts;
}

export function generatorManualPartRequestFor(
  draft: BuildGenerationResult,
  category: PartCategory,
  partId: string,
  preferenceOverrides: Pick<BuildGenerationRequest, "cpuVendorPreference" | "gpuVendorPreference" | "memoryTypePreference"> = {}
): BuildGenerationRequest | undefined {
  const targetId = partId.trim();
  if (!targetId || targetId.length > 160) return undefined;
  const released = new Set(gamingAdjustmentDependentCategories(category));
  return {
    ...generatorRequestForDraft(draft),
    ...preferenceOverrides,
    ...(category === "gpu" ? { includeGpu: true } : {}),
    pinnedParts: pinnedPartsForChange(draft, category, targetId, released)
  };
}
