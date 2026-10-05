import { describe, expect, it } from "vitest";
import { catalogSpecOverrideInputPlaceholder, parseCatalogSpecOverrideFieldValue } from "./AdminCatalogSpecOverridePanel";

describe("catalog support field input", () => {
  it("parses comma-separated numeric sizes and preserves position JSON", () => {
    expect(parseCatalogSpecOverrideFieldValue("number_list", "120, 240,360")).toEqual([120, 240, 360]);
    expect(parseCatalogSpecOverrideFieldValue("radiator_support_list", '[{"position":"top","sizesMm":[120,240]}]')).toEqual([{ position: "top", sizesMm: [120, 240] }]);
    expect(parseCatalogSpecOverrideFieldValue("number", "0")).toBe(0);
    expect(parseCatalogSpecOverrideFieldValue("string_list", "ATX, SFX-L")).toEqual(["ATX", "SFX-L"]);
    expect(parseCatalogSpecOverrideFieldValue("radiator_support_list", '[{"position":"psu_shroud","sizesMm":[240],"requirements":[{"maxAssemblyThicknessMm":55.5,"configurationNote":"HDD 케이지 분리"}]}]')).toEqual([{ position: "psu_shroud", sizesMm: [240], requirements: [{ maxAssemblyThicknessMm: 55.5, configurationNote: "HDD 케이지 분리" }] }]);
  });

  it("rejects incomplete comma lists and malformed position JSON before submission", () => {
    for (const input of ["240,", "240,,360", "240,240", "240,unknown"]) expect(parseCatalogSpecOverrideFieldValue("number_list", input)).toBeUndefined();
    for (const input of ["[]", "{", '[{"position":"top","sizesMm":[]}]', '[{"position":"top","sizesMm":[240],"extra":1}]']) expect(parseCatalogSpecOverrideFieldValue("radiator_support_list", input)).toBeUndefined();
    expect(catalogSpecOverrideInputPlaceholder("radiator_support_list", "radiatorSupports")).toContain('"position":"top"');
    expect(catalogSpecOverrideInputPlaceholder("number_list", "radiatorSizesMm")).toContain("120, 240, 360");
    expect(catalogSpecOverrideInputPlaceholder("string_list", "supportedPsuFormFactors")).toContain("ATX, SFX, SFX-L");
  });
});
