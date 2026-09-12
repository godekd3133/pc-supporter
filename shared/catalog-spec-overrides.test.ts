import { describe, expect, it } from "vitest";
import { catalogSpecOverrideFieldKeysFor, catalogSpecOverrideFieldTypeFor } from "./catalog-spec-overrides";

describe("catalog spec override field contract", () => {
  it("exposes only scalar/list fields per category and rejects cross-category fields", () => {
    expect(catalogSpecOverrideFieldTypeFor("gpu", "powerW")).toBe("number");
    expect(catalogSpecOverrideFieldTypeFor("motherboard", "motherboardFormFactors")).toBe("string_list");
    expect(catalogSpecOverrideFieldTypeFor("memory", "memoryProfiles")).toBe("string_list");
    expect(catalogSpecOverrideFieldTypeFor("gpu", "m2Slots")).toBeUndefined();
    expect(catalogSpecOverrideFieldKeysFor("case")).toEqual(expect.arrayContaining(["maxGpuLengthMm", "maxCoolerHeightMm", "hddBays"]));
  });
});
