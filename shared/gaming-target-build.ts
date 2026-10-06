import type { BuildSelection, Part, RecommendationPreferences } from "./types";
import { gamingTargetAssessmentFor, type GamingFpsReference } from "./gaming-target-assessment";

export function gamingTargetAssessmentForBuild(build: BuildSelection, catalog: readonly Part[], preferences: Pick<RecommendationPreferences, "gamingMode" | "gamingGameIds" | "gamingTargetFps" | "gamingResolution" | "gamingGraphicsPreset" | "gamingRayTracing" | "gamingUpscaling">, references: readonly GamingFpsReference[], now: number | string = Date.now()) {
  if (preferences.gamingMode !== "target_fps" || !preferences.gamingTargetFps) return undefined;
  const byId = new Map(catalog.map((part) => [part.id, part]));
  const cpu = byId.get(build.cpu?.partId ?? "");
  const gpu = byId.get(build.gpu?.partId ?? "");
  const memory = build.memory.map((selection) => ({ part: byId.get(selection.partId), quantity: selection.quantity }));
  const commonMemorySpec = <K extends "memoryType" | "speedMhz" | "memoryTiming">(key: K): Part["specs"][K] | undefined => {
    if (memory.length === 0) return undefined;
    const values = memory.map(({ part }) => part?.category === "memory" ? part.specs[key] : undefined);
    const first = values[0];
    return first !== undefined && values.every((value) => value === first) ? first : undefined;
  };
  const capacity = memory.every(({part}) => part?.specs.capacityGb !== undefined) ? memory.reduce((total, {part, quantity}) => total + part!.specs.capacityGb! * quantity, 0) : undefined;
  const modules = memory.every(({part}) => part?.specs.memoryModuleCountPerKit !== undefined) ? memory.reduce((total, {part, quantity}) => total + part!.specs.memoryModuleCountPerKit! * quantity, 0) : undefined;
  return gamingTargetAssessmentFor(references, {
    gameIds: preferences.gamingGameIds ?? [], targetFps: preferences.gamingTargetFps,
    resolution: preferences.gamingResolution ?? "1080p", graphicsPreset: preferences.gamingGraphicsPreset ?? "high",
    rayTracing: preferences.gamingRayTracing ?? false, upscaling: preferences.gamingUpscaling ?? "native", frameGeneration: false,
    cpuName: cpu?.name, cpuPartId: cpu?.id, gpuName: gpu?.name, gpuPartId: gpu?.id, gpuVramGb: gpu?.specs.vramGb,
    memoryType: commonMemorySpec("memoryType"), memorySpeedMhz: commonMemorySpec("speedMhz"),
    memoryCapacityGb: capacity, memoryModuleCount: modules, memoryTiming: commonMemorySpec("memoryTiming")
  }, now);
}
