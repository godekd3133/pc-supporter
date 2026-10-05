import type { BuildGenerationRequest, BuildGenerationResult, PartCategory } from "../shared/types";
import { gamingAdjustmentDependentCategories } from "../shared/gaming-part-tiers";

export const BALANCE_BUDGET_STEP_WON = 100_000;
export const BALANCE_BUDGET_MIN_WON = 800_000;
export const BALANCE_BUDGET_MAX_WON = 10_000_000;

export function generatorRequestForDraft(draft: BuildGenerationResult): BuildGenerationRequest {
  return {
    profile: draft.profile,
    gamingMode: draft.gamingMode,
    gamingTargetFps: draft.gamingTargetFps,
    gpuVendorPreference: draft.gpuVendorPreference,
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

export function generatorBudgetAdjustmentRequestFor(draft: BuildGenerationResult, direction: "up" | "down"): BuildGenerationRequest | undefined {
  const budgetWon = draft.budgetWon + (direction === "up" ? BALANCE_BUDGET_STEP_WON : -BALANCE_BUDGET_STEP_WON);
  if (budgetWon < BALANCE_BUDGET_MIN_WON || budgetWon > BALANCE_BUDGET_MAX_WON) return undefined;
  // A budget change asks the engine to rebalance the whole build, including iGPU → GPU.
  return { ...generatorRequestForDraft(draft), budgetWon, includeGpu: draft.profile === "gaming" || Boolean(draft.selection.gpu?.partId) };
}

export function generatorPartAdjustmentRequestFor(draft: BuildGenerationResult, category: PartCategory, direction: "up" | "down"): BuildGenerationRequest | undefined {
  const tier = draft.partTiers?.[category];
  const targetId = direction === "up" ? tier?.upId : tier?.downId;
  const useIncludedCooler = category === "cooler" && direction === "down" && tier?.downUseIncludedCooler === true;
  if (!targetId && !useIncludedCooler) return undefined;
  const targetMemoryCapacityGb = category === "memory" ? direction === "up" ? tier?.upMemoryCapacityGb : tier?.downMemoryCapacityGb : undefined;
  const currentMemoryCapacityGb = draft.partTierSuitability?.memory?.tier.order ?? draft.memoryCapacityGb;
  if (targetMemoryCapacityGb !== undefined && (![16, 32, 64, 128].includes(targetMemoryCapacityGb) || direction === "up" && targetMemoryCapacityGb <= currentMemoryCapacityGb || direction === "down" && targetMemoryCapacityGb >= currentMemoryCapacityGb)) return undefined;
  const targetStorageCapacityGb = category === "ssd" ? direction === "up" ? tier?.upStorageCapacityGb : tier?.downStorageCapacityGb : undefined;
  const targetHddCapacityGb = category === "hdd" ? direction === "up" ? tier?.upHddCapacityGb : tier?.downHddCapacityGb : undefined;
  const capacityValid = (target: number | undefined, steps: number[], actual: number | undefined, requested: number | undefined) => target === undefined || steps.includes(target)
    && (actual !== undefined ? direction === "up" ? target > actual : target < actual : direction === "down" || target > (requested ?? 0));
  if (!capacityValid(targetStorageCapacityGb, [500, 1000, 2000, 4000], draft.partTierSuitability?.ssd?.tier.order, draft.storageCapacityGb)
    || !capacityValid(targetHddCapacityGb, [2000, 4000, 8000, 16000], draft.partTierSuitability?.hdd?.tier.order, draft.hddCapacityGb)
    || category === "hdd" && draft.hddCount < 1) return undefined;
  // Capacity-aware RAM steps stay on the existing DDR platform. Legacy ID-only
  // metadata can change generation and must release the whole platform chain.
  const samePlatformBoard = category === "motherboard" && draft.gamingMode !== undefined;
  const released = new Set(category === "memory" && targetMemoryCapacityGb !== undefined
    ? ["memory" as PartCategory]
    : samePlatformBoard ? ["motherboard", "memory", "psu", "case"] as PartCategory[] : gamingAdjustmentDependentCategories(category));
  const pinnedParts: Partial<Record<PartCategory, string>> = {};
  for (const line of draft.lines) {
    if (!released.has(line.category)) pinnedParts[line.category] = line.partId;
  }
  if (targetId) pinnedParts[category] = targetId;
  const request = generatorRequestForDraft(draft);
  // Legacy ID-only platform changes keep their old 16GB floor; capacity-aware
  // RAM steps send the new total so changing a kit cannot silently keep 16GB.
  const rebuildGamingDisplay = category === "gpu" || draft.gamingTestbedPhase1 === true && (category === "cpu" || category === "motherboard" && !samePlatformBoard || category === "memory" && targetMemoryCapacityGb === undefined);
  return { ...request, ...(rebuildGamingDisplay ? { includeGpu: true } : {}), ...(category === "memory" ? { memoryCapacityGb: targetMemoryCapacityGb ?? 16 } : {}), ...(targetStorageCapacityGb !== undefined ? { storageCapacityGb: targetStorageCapacityGb } : {}), ...(targetHddCapacityGb !== undefined ? { hddCapacityGb: targetHddCapacityGb } : {}), pinnedParts };
}

export function generatorBalanceChangesFor(before: BuildGenerationResult, after: BuildGenerationResult): PartCategory[] {
  const changed = after.lines.filter((line) => {
    const previous = before.lines.find((candidate) => candidate.category === line.category);
    return !previous || previous.partId !== line.partId || previous.quantity !== line.quantity;
  }).map((line) => line.category);
  const removed = before.lines.filter((line) => !after.lines.some((candidate) => candidate.category === line.category)).map((line) => line.category);
  return [...new Set([...changed, ...removed])];
}
