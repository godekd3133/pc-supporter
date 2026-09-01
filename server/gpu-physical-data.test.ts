import { describe, expect, it } from "vitest";
import { loadCatalog } from "./catalog";
import { readGpuPhysicalOverrides, validateGpuPhysicalOverrideBatch } from "./gpu-physical-overrides";

describe("committed GPU physical evidence data", () => {
  it("keeps every committed override attached to a current GPU catalog item", async () => {
    const overrides = await readGpuPhysicalOverrides();
    const catalog = await loadCatalog();
    const entries = Object.values(overrides);
    const validation = validateGpuPhysicalOverrideBatch({ items: entries }, catalog, overrides);

    expect(entries.length).toBeGreaterThan(0);
    expect(validation.errors).toEqual([]);
    expect(entries.every((item) => catalog.some((part) => part.id === item.partId && part.category === "gpu"))).toBe(true);
    expect(entries.every((item) => item.sourceNote.length > 0 && item.sourceUrl?.startsWith("https://") && item.manufacturerModel.length > 0)).toBe(true);
    expect(entries.every((item) => item.gpuSlotOccupancy !== undefined)).toBe(true);
    expect(entries.map((item) => item.manufacturerModel).sort()).toEqual(["NE75090019R5-GB2020G", "NE75090S19R5-GB2020G", "ZT-B50900B-10P", "ZT-B50900J-10P", "ZT-B50900Q-10P"]);
  });
});
