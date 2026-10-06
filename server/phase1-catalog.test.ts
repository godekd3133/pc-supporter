import { describe, expect, it } from "vitest";
import { applyPhase1CatalogSnapshot, phase1VerifiedCatalog } from "./phase1-catalog";
import type { Part } from "../shared/types";

const cpu = phase1VerifiedCatalog.find((part) => part.sourceProductCode === "54218171")!;

describe("first gaming testbed source snapshot", () => {
  it("fills the missing exact products with source prices and package inclusion", () => {
    const catalog = applyPhase1CatalogSnapshot([]);
    expect(catalog.find((part) => part.sourceProductCode === "70003022")?.name).toBe("CORSAIR NAUTILUS 360 RS");
    expect(catalog.find((part) => part.sourceProductCode === "54218171")?.specs.coolerIncluded).toBe(true);
    expect(catalog.find((part) => part.sourceProductCode === "21694499")?.specs.coolerIncluded).toBe(true);
    expect(catalog.every((part) => part.source === "danawa" && part.priceWon! > 0 && part.priceCheckedAt && part.listingType === "retail")).toBe(true);
  });

  it("refreshes older prices by product identity while preserving the caller's ID", () => {
    const old: Part = { ...cpu, id: "imported-5500gt", priceWon: 120000, updatedAt: "2026-01-01T00:00:00.000Z", priceCheckedAt: "2026-01-01T00:00:00.000Z" };
    const result = applyPhase1CatalogSnapshot([old]).find((part) => part.id === old.id)!;
    expect(result.priceWon).toBe(cpu.priceWon);
    expect(result.priceCheckedAt).toBe(cpu.priceCheckedAt);
    expect(applyPhase1CatalogSnapshot([old]).filter((part) => part.sourceProductCode === cpu.sourceProductCode)).toHaveLength(1);
  });

  it("does not replace later prices, manual specs, or delisting evidence", () => {
    const later: Part = { ...cpu, priceWon: 211000, specs: { ...cpu.specs, boostClockGhz: 4.3 }, delistedAt: "2026-11-01T00:00:00.000Z", priceCheckedAt: "2026-11-01T00:00:00.000Z" };
    expect(applyPhase1CatalogSnapshot([later]).find((part) => part.id === cpu.id)).toBe(later);
  });

  it("does not substitute a similarly named product or overwrite unrelated rows", () => {
    const unrelated: Part = { ...cpu, id: "different-retail-sku", sourceProductCode: "999999", priceWon: 99999 };
    expect(applyPhase1CatalogSnapshot([unrelated])[0]).toBe(unrelated);
  });

  it("keeps separately reviewed manufacturer specs when refreshing an older price", () => {
    const source = phase1VerifiedCatalog.find((part) => part.sourceProductCode === "75656861")!;
    const reviewed: Part = { ...source, priceWon: 7900000, priceCheckedAt: "2026-01-01T00:00:00.000Z", specs: { ...source.specs, powerW: 590, physicalEvidenceSourceUrl: "https://www.manli.com/reviewed-later-revision" } };
    const result = applyPhase1CatalogSnapshot([reviewed]).find((part) => part.id === source.id)!;
    expect(result.priceWon).toBe(source.priceWon);
    expect(result.specs.powerW).toBe(590);
    expect(result.specs.physicalEvidenceSourceUrl).toBe(reviewed.specs.physicalEvidenceSourceUrl);
  });
});
