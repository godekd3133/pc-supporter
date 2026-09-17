import { RECOMMENDATION_PRIORITY_VALUES } from "./types";
import type { GamingGraphicsPreset, GamingRefreshRate, GamingResolution, GamingUpscaling, ListingPolicy, RecommendationPerformanceTier, RecommendationPriority, RecommendationProfile } from "./types";

export const GENERATOR_PRESET_STORAGE_KEY = "pc-supporter-generator-presets";
export const GENERATOR_PRESET_SCHEMA_VERSION = 1;
export const GENERATOR_PRESET_LIMIT = 10;

export type GeneratorPresetConfig = {
  profile: RecommendationProfile;
  priority: RecommendationPriority;
  performanceTier?: RecommendationPerformanceTier;
  gamingResolution: GamingResolution;
  gamingRefreshRate: GamingRefreshRate;
  gamingGameIds?: string[];
  gamingGraphicsPreset?: GamingGraphicsPreset;
  gamingRayTracing?: boolean;
  gamingUpscaling?: GamingUpscaling;
  memoryCapacityGb: 16 | 32 | 64 | 128;
  budgetWon: number;
  includeGpu: boolean;
  storageCapacityGb: 500 | 1000 | 2000 | 4000;
  hddCount: 0 | 1 | 2 | 4;
  hddCapacityGb: 2000 | 4000 | 8000 | 16000;
  listingPolicy: ListingPolicy;
};

export type SavedGeneratorPreset = GeneratorPresetConfig & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

function oneOf<T extends string | number>(value: unknown, values: readonly T[]): value is T {
  return values.includes(value as T);
}

export function generatorPresetConfigFromUnknown(value: unknown): GeneratorPresetConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const budgetWon = candidate.budgetWon;
  const gamingGameIds = candidate.gamingGameIds === undefined
    ? undefined
    : Array.isArray(candidate.gamingGameIds) && candidate.gamingGameIds.length <= 5 && candidate.gamingGameIds.every((item) => typeof item === "string" && item.trim().length > 0 && item.trim().length <= 160)
      ? candidate.gamingGameIds.map((item) => item.trim())
      : null;
  const gamingGraphicsPreset = candidate.gamingGraphicsPreset === undefined
    ? undefined
    : oneOf(candidate.gamingGraphicsPreset, ["competitive", "balanced", "high"] as const) ? candidate.gamingGraphicsPreset : null;
  const gamingUpscaling = candidate.gamingUpscaling === undefined
    ? undefined
    : oneOf(candidate.gamingUpscaling, ["native", "quality", "balanced"] as const) ? candidate.gamingUpscaling : null;
  const performanceTier = candidate.performanceTier === undefined
    ? undefined
    : oneOf(candidate.performanceTier, ["entry", "high", "top"] as const) ? candidate.performanceTier : null;
  if (!oneOf(candidate.profile, ["general", "gaming", "creator", "development", "office"] as const)
    || !oneOf(candidate.priority, RECOMMENDATION_PRIORITY_VALUES)
    || !oneOf(candidate.gamingResolution, ["1080p", "1440p", "4k"] as const)
    || !oneOf(candidate.gamingRefreshRate, [60, 144, 240] as const)
    || !oneOf(candidate.memoryCapacityGb, [16, 32, 64, 128] as const)
    || typeof budgetWon !== "number" || !Number.isInteger(budgetWon) || budgetWon <= 0 || budgetWon > 1_000_000_000
    || typeof candidate.includeGpu !== "boolean"
    || !oneOf(candidate.storageCapacityGb, [500, 1000, 2000, 4000] as const)
    || !oneOf(candidate.hddCount, [0, 1, 2, 4] as const)
    || !oneOf(candidate.hddCapacityGb, [2000, 4000, 8000, 16000] as const)
    || !oneOf(candidate.listingPolicy, ["retail_only", "include_bulk", "all"] as const)
    || gamingGameIds === null
    || performanceTier === null
    || gamingGraphicsPreset === null
    || typeof candidate.gamingRayTracing !== "undefined" && typeof candidate.gamingRayTracing !== "boolean"
    || gamingUpscaling === null) return null;
  return {
    profile: candidate.profile,
    priority: candidate.priority,
    ...(performanceTier ? { performanceTier } : {}),
    gamingResolution: candidate.gamingResolution,
    gamingRefreshRate: candidate.gamingRefreshRate,
    ...(gamingGameIds ? { gamingGameIds } : {}),
    ...(gamingGraphicsPreset ? { gamingGraphicsPreset } : {}),
    ...(candidate.gamingRayTracing !== undefined ? { gamingRayTracing: candidate.gamingRayTracing as boolean } : {}),
    ...(gamingUpscaling ? { gamingUpscaling } : {}),
    memoryCapacityGb: candidate.memoryCapacityGb,
    budgetWon,
    includeGpu: candidate.includeGpu,
    storageCapacityGb: candidate.storageCapacityGb,
    hddCount: candidate.hddCount,
    hddCapacityGb: candidate.hddCapacityGb,
    listingPolicy: candidate.listingPolicy
  };
}

export function savedGeneratorPresetsFromJson(raw: string | null): SavedGeneratorPreset[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const candidates = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as { items?: unknown }).items) ? (parsed as { items: unknown[] }).items : [];
    if (candidates.length > GENERATOR_PRESET_LIMIT) return [];
    const seen = new Set<string>();
    return candidates.map((value): SavedGeneratorPreset | null => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const item = value as Record<string, unknown>;
      const config = generatorPresetConfigFromUnknown(item);
      const id = typeof item.id === "string" ? item.id.trim().slice(0, 80) : "";
      const name = typeof item.name === "string" ? item.name.trim().slice(0, 60) : "";
      const createdAt = typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : "";
      const updatedAt = typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt)) ? item.updatedAt : "";
      if (!config || !id || !name || !createdAt || !updatedAt || seen.has(id)) return null;
      seen.add(id);
      return { ...config, id, name, createdAt, updatedAt };
    }).filter((value): value is SavedGeneratorPreset => value !== null).slice(0, GENERATOR_PRESET_LIMIT);
  } catch {
    return [];
  }
}

export function savedGeneratorPresetsToJson(items: SavedGeneratorPreset[]) {
  return JSON.stringify({ schemaVersion: GENERATOR_PRESET_SCHEMA_VERSION, items: items.slice(0, GENERATOR_PRESET_LIMIT) });
}

export function addSavedGeneratorPreset(items: SavedGeneratorPreset[], preset: SavedGeneratorPreset) {
  return [preset, ...items.filter((item) => item.id !== preset.id)].slice(0, GENERATOR_PRESET_LIMIT);
}

export function mergeSavedGeneratorPresets(current: SavedGeneratorPreset[], imported: SavedGeneratorPreset[]) {
  return imported.slice().reverse().reduce((items, preset) => addSavedGeneratorPreset(items, preset), current).slice(0, GENERATOR_PRESET_LIMIT);
}

export function removeSavedGeneratorPreset(items: SavedGeneratorPreset[], id: string) {
  return items.filter((item) => item.id !== id);
}
