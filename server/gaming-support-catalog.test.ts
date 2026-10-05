import { describe, expect, it } from "vitest";
import { applyGamingSupportCatalogSnapshot, gamingSupportVerifiedCatalog } from "./gaming-support-catalog";
import type { Part } from "../shared/types";

const product = (code: string): Part => gamingSupportVerifiedCatalog.find((part) => part.sourceProductCode === code)!;

describe("public gaming support product snapshot", () => {
  it("covers domestic 600/700/750/850/1000W choices and cases for large GPUs and dual towers", () => {
    expect(gamingSupportVerifiedCatalog).toHaveLength(8);
    expect(gamingSupportVerifiedCatalog.filter((part) => part.category === "psu").map((part) => part.specs.wattageW)).toEqual([600, 700, 750, 850, 1000]);
    for (const part of gamingSupportVerifiedCatalog) {
      expect(part.source).toBe("danawa");
      expect(part.listingType).toBe("retail");
      expect(part.priceWon).toBeGreaterThan(0);
      expect(part.priceCheckedAt).toBeDefined();
      if (part.category === "case") {
        expect(part.specs.maxGpuLengthMm).toBeGreaterThanOrEqual(400);
        expect(part.specs.maxCoolerHeightMm).toBeGreaterThanOrEqual(160);
      } else expect(part.brand).toBe("마이크로닉스");
    }
    expect(product("90643607").specs.pciePowerConnectors?.["12v2x6"]).toBe(1);
  });

  it("installs the source identities without private runtime data and avoids duplicates", () => {
    const first = applyGamingSupportCatalogSnapshot([]);
    expect(first).toHaveLength(8);
    expect(applyGamingSupportCatalogSnapshot(first)).toHaveLength(8);
    expect(new Set(first.map((part) => part.id)).size).toBe(8);
  });

  it("preserves a newer current price and original ID", () => {
    const source = product("74484791");
    const newer = { ...source, id: "existing-runtime-850", priceWon: 120000, priceCheckedAt: "2099-01-01T00:00:00.000Z" };
    const merged = applyGamingSupportCatalogSnapshot([newer]);
    expect(merged.find((part) => part.sourceProductCode === "74484791")).toBe(newer);
    expect(merged).toHaveLength(8);
  });

  it("refreshes old prices while retaining separately reviewed case dimensions and provenance", () => {
    const source = product("94088714");
    const reviewed = { ...source, id: "case-runtime-reviewed", priceWon: 10000, priceCheckedAt: "2000-01-01T00:00:00.000Z", dataQuality: "manual" as const, missingFields: ["reviewed-field"], specs: { ...source.specs, maxGpuLengthMm: 390, physicalEvidenceSourceUrl: "https://www.abko.co.kr/reviewed-source", physicalEvidenceSourceNote: "Existing reviewer decision" } };
    const merged = applyGamingSupportCatalogSnapshot([reviewed]).find((part) => part.sourceProductCode === "94088714")!;
    expect(merged.priceWon).toBe(source.priceWon);
    expect(merged.id).toBe("case-runtime-reviewed");
    expect(merged.specs.maxGpuLengthMm).toBe(390);
    expect(merged.specs.physicalEvidenceSourceNote).toBe("Existing reviewer decision");
    expect(merged.missingFields).toEqual(["reviewed-field"]);
    expect(reviewed.priceWon).toBe(10000);
  });

  it("records only the exact DS900 manufacturer radiator layout and preserves unknown air-case bays", () => {
    const ds900 = product("32861099");
    expect(ds900.specs.radiatorSupports).toEqual([{ position: "top", sizesMm: [240, 360] }, { position: "side", sizesMm: [240] }]);
    expect(ds900.specs.physicalEvidenceSourceUrl).toBe("https://www.darkflash.com/product/ds900");
    expect(ds900.specs.hddBays).toBe(2);
    expect(ds900.specs.radiatorThicknessMm).toBeUndefined();
    expect(product("124217320").specs.hddBays).toBeUndefined();
    expect(product("124217320").missingFields).toContain("hddBays");
  });
});
