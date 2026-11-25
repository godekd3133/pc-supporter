import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { applyCaseMountSpecSnapshot, caseMountSpecItems } from "./case-mount-specs";

const item = caseMountSpecItems.find((entry) => entry.fields.radiatorSupports?.length)!;

function computerCase(specs: Part["specs"]): Part {
  return { id: item.partId, category: "case", name: "케이스", source: "danawa", priceWon: 100000, specs, dataQuality: "live", missingFields: ["radiatorSupports"], updatedAt: "2026-11-01T00:00:00.000Z" };
}

describe("case mount spec snapshot", () => {
  it("keeps every item tied to an official https source and consistent radiator sizes", () => {
    expect(caseMountSpecItems.length).toBeGreaterThanOrEqual(55);
    for (const entry of caseMountSpecItems) {
      expect(entry.sourceUrl).toMatch(/^https:\/\//);
      const supportSizes = new Set((entry.fields.radiatorSupports ?? []).flatMap((support) => support.sizesMm));
      for (const size of supportSizes) expect(entry.fields.radiatorSizesMm ?? []).toContain(size);
    }
  });

  it("fills missing case mount fields only", () => {
    const [filled] = applyCaseMountSpecSnapshot([computerCase({ ssdBays: 9 })]);
    expect(filled.specs.radiatorSupports).toEqual(item.fields.radiatorSupports);
    expect(filled.specs.ssdBays).toBe(9);
    expect(filled.missingFields).not.toContain("radiatorSupports");
  });

  it("corrects only fields confirmed wrong against the manufacturer spec", () => {
    const ncore: Part = { ...computerCase({ supportedPsuFormFactors: ["ATX"], maxPsuLengthMm: 160 }), id: "danawa-case-74012729" };
    const [corrected] = applyCaseMountSpecSnapshot([ncore]);
    expect(corrected.specs.supportedPsuFormFactors).toEqual(["SFX"]);
    expect(corrected.specs.maxPsuLengthMm).toBe(160);
  });

  it("does not overwrite existing radiator data or touch other categories", () => {
    const existing = [{ position: "front" as const, sizesMm: [120] }];
    const [kept] = applyCaseMountSpecSnapshot([computerCase({ radiatorSupports: existing })]);
    expect(kept.specs.radiatorSupports).toBe(existing);
    const psu = { ...computerCase({}), category: "psu" as const };
    expect(applyCaseMountSpecSnapshot([psu])[0]).toBe(psu);
  });
});
