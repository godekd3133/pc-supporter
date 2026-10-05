import { describe, expect, it } from "vitest";
import type { BuildSelection, Part } from "./types";
import type { GamingFpsReference } from "./gaming-target-assessment";
import { gamingTargetAssessmentForBuild } from "./gaming-target-build";

const part = (category: Part["category"], id: string, name: string, specs: Part["specs"]): Part => ({ category, id, name, specs, source: "manual", dataQuality: "manual", missingFields: [], updatedAt: "2026-10-05T00:00:00.000Z" });
const ref: GamingFpsReference = { id: "test-memory-conditions", gameId: "cyberpunk", cpuModel: "Ryzen 7 9800X3D", gpuModel: "RTX 5070", gpuName: "MSI RTX 5070 12GB", gpuVramGb: 12, resolution: "1440p", graphicsPreset: "high", sourcePreset: "Ultra", rayTracing: false, upscaling: "native", upscaler: "none", frameGeneration: false, averageFps: 90, memoryType: "DDR5", memorySpeedMhz: 6000, memoryCapacityGb: 32, memoryModuleCount: 2, memoryTiming: "CL30", sourceKind: "lab", sourceUrl: "https://example.com/fixture", sourceTitle: "Synthetic test conditions", sourceNote: "Synthetic fixture", publishedAt: "2026-09-01", verifiedAt: "2026-10-01" };
const cpu = part("cpu", "cpu", "AMD Ryzen 9800X3D", {});
const gpu = part("gpu", "gpu", "MSI RTX 5070 12GB", { vramGb: 12 });
const ram = (id: string, memoryType = "DDR5", speedMhz = 6000, memoryTiming = "CL30") => part("memory", id, `${memoryType} ${id}`, { memoryType, speedMhz, memoryTiming, capacityGb: 16, memoryModuleCountPerKit: 1 });
const prefs = { gamingMode: "target_fps" as const, gamingTargetFps: 60, gamingGameIds: ["cyberpunk"], gamingResolution: "1440p" as const, gamingGraphicsPreset: "high" as const, gamingUpscaling: "native" as const, gamingRayTracing: false };
function assessment(memory: Part[]) {
  const build: BuildSelection = { cpu: {partId:"cpu",quantity:1}, gpu:{partId:"gpu",quantity:1}, memory:memory.map((part)=>({partId:part.id,quantity:1})), ssd:[],hdd:[],useIntegratedGraphics:false };
  return gamingTargetAssessmentForBuild(build, [cpu,gpu,...memory], prefs, [ref], "2026-10-05")!;
}
describe("whole-build FPS memory conditions", () => {
  it("does not treat mixed DDR generations as the first selected memory", () => {
    for (const memory of [[ram("a"),ram("b","DDR4",3200)], [ram("b","DDR4",3200),ram("a")]]) {
      const result=assessment(memory);
      expect(result.estimatedTargetMet).toBeUndefined();
      expect(result.targetMet).toBe(false);
      expect(result.measurements[0].differences.some((line)=>line.includes("RAM 규격"))).toBe(true);
    }
  });
  it("does not hide different RAM speeds or timings behind the first kit", () => {
    const result=assessment([ram("a"),ram("b","DDR5",5600,"CL46")]);
    expect(result.measurements[0].differences.some((line)=>line.includes("RAM 속도"))).toBe(true);
    expect(result.measurements[0].differences.some((line)=>line.includes("RAM 타이밍"))).toBe(true);
  });
  it("preserves known common conditions and actual combined capacity", () => {
    const result=assessment([ram("a"),ram("b")]);
    expect(result.estimatedTargetMet).toBe(true);
    expect(result.measurements[0].differences.some((line)=>line.includes("RAM 규격")||line.includes("RAM 속도")||line.includes("RAM 용량")||line.includes("RAM 타이밍"))).toBe(false);
    expect(result.targetMet).toBe(false);
  });
});
