import { parseBuildDraftStorage } from '../shared/build-draft';
import { parseBuildTransfer } from '../shared/build-transfer';
import { generatorPresetConfigFromUnknown } from '../shared/generator-preset';
import type { GeneratorPresetConfig } from '../shared/generator-preset';
import { PART_CATEGORIES } from '../shared/types';
import type { BuildGenerationResult, PartCategory, RecommendationPreferences } from '../shared/types';

export const GENERATED_DRAFT_CONTEXT_KEY = 'pc-supporter-generated-draft-context-v1';
const MAX_CONTEXT_BYTES = 64_000;
const idValid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160;
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** The request metadata for a generated draft, independent of current editor state. */
export function recommendationPreferencesForGeneratedDraft(draft: BuildGenerationResult): RecommendationPreferences {
  const gaming = draft.profile === 'gaming';
  return {
    profile: draft.profile, priority: draft.priority, performanceTier: draft.performanceTier,
    budgetWon: draft.budgetWon, listingPolicy: draft.listingPolicy,
    gamingMode: gaming ? draft.gamingMode : undefined,
    gamingTargetFps: gaming ? draft.gamingTargetFps : undefined,
    gpuVendorPreference: gaming ? draft.gpuVendorPreference : undefined,
    gamingResolution: gaming ? draft.gamingResolution : undefined,
    gamingRefreshRate: gaming ? draft.gamingRefreshRate : undefined,
    gamingGameIds: gaming ? draft.gamingGameIds : undefined,
    gamingGraphicsPreset: gaming ? draft.gamingGraphicsPreset : undefined,
    gamingRayTracing: gaming ? draft.gamingRayTracing : undefined,
    gamingUpscaling: gaming ? draft.gamingUpscaling : undefined
  };
}

/** Conditions for editing the generated quote through the existing onboarding seam. */
export function generatorPresetConfigForGeneratedDraft(draft: BuildGenerationResult): GeneratorPresetConfig | null {
  return generatorPresetConfigFromUnknown({
    ...recommendationPreferencesForGeneratedDraft(draft),
    gamingResolution: draft.gamingResolution, gamingRefreshRate: draft.gamingRefreshRate,
    memoryCapacityGb: draft.memoryCapacityGb, storageCapacityGb: draft.storageCapacityGb,
    includeGpu: Boolean(draft.selection.gpu), hddCount: draft.hddCount,
    hddCapacityGb: draft.hddCapacityGb ?? 4000
  });
}

/** FPS assessments must be refreshed by the server, never trusted from a local JSON object. */
export function generatedDraftWithoutPersistedFpsAssessment(draft: BuildGenerationResult): BuildGenerationResult {
  const { gamingTargetAssessment: _targetAssessment, gamingPerformanceAssessment: _legacyAssessment, gamingSupportRequirements: _supportRequirements, partTierSuitability: _tierSuitability, ...rest } = draft;
  return rest;
}

/** Restore controls only for a bounded, valid generated build; App checks the exact current selection separately. */
export function generatedDraftContextFromJson(raw: string | null): BuildGenerationResult | null {
  if (!raw || raw.length > MAX_CONTEXT_BYTES) return null;
  try {
    const draft = JSON.parse(raw) as BuildGenerationResult;
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)
      || draft.gamingTestbedPhase1 !== true || draft.profile !== 'gaming'
      || !finite(draft.budgetWon, 800_000, 10_000_000) || !finite(draft.totalPriceWon, 1, 100_000_000)
      || ![16, 32, 64, 128].includes(draft.memoryCapacityGb)
      || !finite(draft.storageCapacityGb, 1, 100_000) || !finite(draft.hddCount, 0, 8) || !Number.isInteger(draft.hddCount)
      || !['budget', 'balanced', 'performance', 'reliability'].includes(draft.priority)
      || !['compatible', 'needs_review'].includes(draft.status)
      || !Array.isArray(draft.lines) || draft.lines.length < 5 || draft.lines.length > 9
      || !Array.isArray(draft.rationale) || !Array.isArray(draft.warnings)) return null;
    const preferences = parseBuildTransfer({ selection: { memory: [], ssd: [], hdd: [], useIntegratedGraphics: true }, recommendationPreferences: recommendationPreferencesForGeneratedDraft(draft) });
    if (!preferences.envelope) return null;
    if (draft.gamingMode === 'target_fps' && (draft.gamingTargetFps === undefined || !draft.gamingGameIds?.length)) return null;
    const selection = parseBuildDraftStorage(JSON.stringify(draft.selection));
    if (selection.status !== 'valid') return null;
    const categories = new Set<PartCategory>();
    for (const line of draft.lines) {
      if (!line || !PART_CATEGORIES.includes(line.category) || categories.has(line.category)
        || !idValid(line.partId) || typeof line.name !== 'string' || line.name.length > 500
        || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99
        || !finite(line.priceWon, 1, 100_000_000)) return null;
      categories.add(line.category);
      const selected = selection.build[line.category];
      const entries = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (!entries.some((entry) => entry.partId === line.partId && entry.quantity === line.quantity)) return null;
    }
    if (draft.partTiers && Object.entries(draft.partTiers).some(([key, tier]) => !PART_CATEGORIES.includes(key as PartCategory)
      || !tier || typeof tier !== "object" || Array.isArray(tier) || (tier.downUseIncludedCooler !== undefined && (key !== "cooler" || typeof tier.downUseIncludedCooler !== "boolean")) || (tier.upId !== undefined && !idValid(tier.upId)) || (tier.downId !== undefined && !idValid(tier.downId))
      || (tier.upMemoryCapacityGb !== undefined && (key !== "memory" || !tier.upId || ![16, 32, 64, 128].includes(tier.upMemoryCapacityGb)))
      || (tier.downMemoryCapacityGb !== undefined && (key !== "memory" || !tier.downId || ![16, 32, 64, 128].includes(tier.downMemoryCapacityGb)))
      || (tier.upStorageCapacityGb !== undefined && (key !== "ssd" || !tier.upId || ![500, 1000, 2000, 4000].includes(tier.upStorageCapacityGb)))
      || (tier.downStorageCapacityGb !== undefined && (key !== "ssd" || !tier.downId || ![500, 1000, 2000, 4000].includes(tier.downStorageCapacityGb)))
      || (tier.upHddCapacityGb !== undefined && (key !== "hdd" || !tier.upId || ![2000, 4000, 8000, 16000].includes(tier.upHddCapacityGb)))
      || (tier.downHddCapacityGb !== undefined && (key !== "hdd" || !tier.downId || ![2000, 4000, 8000, 16000].includes(tier.downHddCapacityGb))))) return null;
    return { ...generatedDraftWithoutPersistedFpsAssessment(draft), selection: selection.build };
  } catch { return null; }
}
