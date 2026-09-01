import { describe, expect, it } from "vitest";
import { loadCatalog } from "./catalog";
import sampleOverrides from "./fixtures/gpu-physical-overrides.sample.json";
import { validateGpuPhysicalOverrideBatch, type GpuPhysicalOverrideMap } from "./gpu-physical-overrides";

describe("public GPU physical evidence fixture", () => {
  it("keeps every public fixture override attached to a current GPU catalog item", async () => {
    const overrides = sampleOverrides as GpuPhysicalOverrideMap;
    const catalog = await loadCatalog();
    const entries = Object.values(overrides);
    const validation = validateGpuPhysicalOverrideBatch({ items: entries }, catalog, overrides);

    expect(entries.length).toBeGreaterThan(0);
    expect(validation.errors).toEqual([]);
    expect(entries.every((item) => catalog.some((part) => part.id === item.partId && part.category === "gpu"))).toBe(true);
    expect(entries.every((item) => item.sourceNote.length > 0 && item.sourceUrl?.startsWith("https://") && item.manufacturerModel.length > 0)).toBe(true);
    expect(entries.every((item) => item.gpuSlotOccupancy !== undefined)).toBe(true);
    expect(entries.map((item) => item.manufacturerModel).sort()).toEqual(["PC-SUPPORTER-GPU-4060-SAMPLE", "PC-SUPPORTER-GPU-5090-SAMPLE"]);
  });
});
