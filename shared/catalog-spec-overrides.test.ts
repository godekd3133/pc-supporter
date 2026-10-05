import { describe, expect, it } from "vitest";
import { catalogCaseSupportOverrideValueFor, catalogSpecOverrideFieldIsMissing, catalogSpecOverrideFieldKeysFor, catalogSpecOverrideFieldTypeFor } from "./catalog-spec-overrides";

describe("catalog spec override field contract", () => {
  it("exposes supported field types per category and rejects cross-category fields", () => {
    expect(catalogSpecOverrideFieldTypeFor("gpu", "powerW")).toBe("number");
    expect(catalogSpecOverrideFieldTypeFor("motherboard", "motherboardFormFactors")).toBe("string_list");
    expect(catalogSpecOverrideFieldTypeFor("memory", "memoryProfiles")).toBe("string_list");
    expect(catalogSpecOverrideFieldTypeFor("gpu", "m2Slots")).toBeUndefined();
    expect(catalogSpecOverrideFieldKeysFor("case")).toEqual(expect.arrayContaining(["maxGpuLengthMm", "maxCoolerHeightMm", "hddBays"]));
    expect(catalogSpecOverrideFieldTypeFor("case", "radiatorSizesMm")).toBe("number_list");
    expect(catalogSpecOverrideFieldTypeFor("case", "radiatorSupports")).toBe("radiator_support_list");
    expect(catalogSpecOverrideFieldTypeFor("case", "supportedPsuFormFactors")).toBe("string_list");
    expect(catalogSpecOverrideFieldTypeFor("case", "ssdBays")).toBe("number");
    expect(catalogSpecOverrideFieldTypeFor("psu", "supportedPsuFormFactors")).toBeUndefined();
    expect(catalogSpecOverrideFieldTypeFor("cooler", "radiatorThicknessMm")).toBe("number");
    expect(catalogSpecOverrideFieldTypeFor("memory", "memoryHeightMm")).toBe("number");
    expect(catalogSpecOverrideFieldTypeFor("case", "memoryHeightMm")).toBeUndefined();
  });

  it("recognizes all allowed empty lists as unknown while retaining known zero and nonempty lists", () => {
    const specs = { radiatorSizesMm: [], radiatorSupports: [], supportedPsuFormFactors: [], ssdBays: 0, motherboardFormFactors: [] };
    expect(["radiatorSizesMm", "radiatorSupports", "supportedPsuFormFactors"].map((field) => catalogSpecOverrideFieldIsMissing(specs, field))).toEqual([true, true, true]);
    expect(catalogSpecOverrideFieldIsMissing(specs, "ssdBays")).toBe(false);
    expect(catalogSpecOverrideFieldIsMissing(specs, "motherboardFormFactors")).toBe(true);
    expect(catalogSpecOverrideFieldIsMissing({ supportedSockets: [] }, "supportedSockets")).toBe(true);
    expect(catalogSpecOverrideFieldIsMissing({ memoryProfiles: [] }, "memoryProfiles")).toBe(true);
    expect(catalogSpecOverrideFieldIsMissing({ supportedSockets: ["AM5"] }, "supportedSockets")).toBe(false);
    expect(catalogSpecOverrideFieldIsMissing({}, "ssdBays")).toBe(true);
    expect(catalogSpecOverrideFieldIsMissing({ radiatorSizesMm: [240] }, "radiatorSizesMm")).toBe(false);
  });

  it("retains size-scoped physical limits and configuration notes including fractional measurements", () => {
    const input = [{ position: "psu_shroud", sizesMm: [240, 280], requirements: [{ sizesMm: [240], maxRadiatorThicknessMm: 27.5, maxAssemblyThicknessMm: 55.5, maxMemoryHeightMm: 35.5, maxRadiatorWidthMm: 125.5, maxRadiatorLengthMm: 300.5, maxGpuLengthMm: 320.5, exclusiveUpperBound: true }, { sizesMm: [280], configurationNote: "  HDD 케이지 분리  " }] }];
    expect(catalogCaseSupportOverrideValueFor("radiatorSupports", input)).toEqual([{ ...input[0], requirements: [input[0].requirements[0], { sizesMm: [280], configurationNote: "HDD 케이지 분리" }] }]);
  });

  it.each([
    [], Array(1), [{}], [{ sizesMm: [240] }], [{ maxAssemblyThicknessMm: 0 }], [{ maxRadiatorThicknessMm: Infinity }], [{ maxMemoryHeightMm: 100_001 }], [{ maxAssemblyThicknessMm: "55" }], [{ maxAssemblyThicknessMm: 55, extra: true }], [{ sizesMm: [360], maxAssemblyThicknessMm: 55 }], [{ sizesMm: [240, 240], maxAssemblyThicknessMm: 55 }], [{ sizesMm: Array(1), maxAssemblyThicknessMm: 55 }], [{ configurationNote: " " }], [{ configurationNote: "x".repeat(501) }], [{ configurationNote: "HDD 케이지 분리", exclusiveUpperBound: true }], [{ maxAssemblyThicknessMm: 55, exclusiveUpperBound: "true" }], [{ maxAssemblyThicknessMm: 55 }, { maxAssemblyThicknessMm: 55 }], Array.from({ length: 17 }, (_, index) => ({ maxAssemblyThicknessMm: index + 1 }))
  ].map((requirements) => ({ requirements })))("rejects malformed mounting requirements: %j", ({ requirements }) => {
    expect(catalogCaseSupportOverrideValueFor("radiatorSupports", [{ position: "top", sizesMm: [240], requirements }])).toBeUndefined();
  });
});
