import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { isQuoteBrandAllowed } from "../shared/domain/listing";
import { applyGamingStorageCatalogSnapshot, GAMING_STORAGE_CATALOG_REFRESHED_AT, gamingStorageVerifiedCatalog } from "./gaming-storage-catalog";

const product = (code: string): Part => gamingStorageVerifiedCatalog.find((part) => part.sourceProductCode === code)!;

describe("public gaming storage product snapshot", () => {
  it("provides domestic 500GB/2TB SATA SSDs and individual 2TB/4TB SATA HDDs", () => {
    expect(gamingStorageVerifiedCatalog).toHaveLength(4);
    expect(gamingStorageVerifiedCatalog.filter((part) => part.category === "ssd").map((part) => part.specs.capacityGb)).toEqual([500, 2000]);
    expect(gamingStorageVerifiedCatalog.filter((part) => part.category === "hdd").map((part) => part.specs.capacityGb)).toEqual([2000, 4000]);
    expect(Number.isFinite(Date.parse(GAMING_STORAGE_CATALOG_REFRESHED_AT))).toBe(true);
    for (const part of gamingStorageVerifiedCatalog) {
      expect(part.source).toBe("danawa");
      expect(part.listingType).toBe("retail");
      expect(isQuoteBrandAllowed(part.category, part.brand)).toBe(true);
      expect(part.priceWon).toBeGreaterThan(0);
      expect(part.priceCheckedAt).toBeDefined();
      expect(part.specs.interface).toBe("SATA");
      expect(part.specs.formFactor).toBe(part.category === "ssd" ? "2.5인치" : "3.5인치");
      expect(part.danawaUrl).toBe(`https://prod.danawa.com/info/?pcode=${part.sourceProductCode}`);
      expect(part.delistedAt).toBeUndefined();
      expect(part.name).not.toMatch(/해외|중고|병행|벌크|패키지/);
    }
    expect(product("102550253").rawSpecText).toContain("4TB");
    expect(gamingStorageVerifiedCatalog.some((part) => part.sourceProductCode === "104374406")).toBe(false);
  });

  it("installs source products without private catalog data and preserves identity without duplicates", () => {
    const first = applyGamingStorageCatalogSnapshot([]);
    expect(first).toHaveLength(4);
    expect(applyGamingStorageCatalogSnapshot(first)).toHaveLength(4);
    expect(new Set(first.map((part) => part.id)).size).toBe(4);
  });

  it("keeps a newer live price and the original catalog ID", () => {
    const source = product("13190519");
    const newer = { ...source, id: "existing-ssd-500gb", priceWon: source.priceWon! + 1, priceCheckedAt: "2099-01-01T00:00:00.000Z", updatedAt: "2099-01-01T00:00:00.000Z" };
    const result = applyGamingStorageCatalogSnapshot([newer]);
    expect(result.find((part) => part.sourceProductCode === source.sourceProductCode)).toBe(newer);
    expect(result).toHaveLength(4);
  });

  it("refreshes older prices while preserving reviewed specs and provenance", () => {
    const source = product("13190630");
    const reviewed: Part = { ...source, id: "reviewed-ssd-2tb", priceWon: source.priceWon! + 1, priceCheckedAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z", dataQuality: "manual", missingFields: ["reviewed-field"], specs: { ...source.specs, ssdController: "reviewed controller", physicalEvidenceSourceUrl: "https://www.samsung.com/reviewed-source" } };
    const result = applyGamingStorageCatalogSnapshot([reviewed]).find((part) => part.sourceProductCode === source.sourceProductCode)!;
    expect(result.priceWon).toBe(source.priceWon);
    expect(result.id).toBe(reviewed.id);
    expect(result.specs.ssdController).toBe("reviewed controller");
    expect(result.specs.physicalEvidenceSourceUrl).toBe(reviewed.specs.physicalEvidenceSourceUrl);
    expect(result.missingFields).toEqual(["reviewed-field"]);
    expect(reviewed.priceWon).toBe(source.priceWon! + 1);
  });

  it("does not let an older active price snapshot erase a newer sales stop", () => {
    const source = product("6545078");
    const stopped: Part = { ...source, id: "existing-stopped-hdd", priceCheckedAt: "2000-01-01T00:00:00.000Z", updatedAt: "2099-01-01T00:00:00.000Z", delistedAt: "2099-01-01T00:00:00.000Z" };
    const result = applyGamingStorageCatalogSnapshot([stopped]).find((part) => part.sourceProductCode === source.sourceProductCode)!;
    expect(result.id).toBe(stopped.id);
    expect(result.delistedAt).toBe(stopped.delistedAt);
    expect(result.updatedAt).toBe(stopped.updatedAt);
  });
});
