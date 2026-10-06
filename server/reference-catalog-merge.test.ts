import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { applyPhase1CatalogSnapshot, phase1VerifiedCatalog } from "./phase1-catalog";
import { applyGamingAmdCatalogSnapshot, gamingAmdVerifiedCatalog } from "./gaming-amd-catalog";
import { applyGamingTargetCatalogSnapshot, gamingTargetVerifiedCatalog } from "./gaming-target-catalog";
import { applyGamingSupportCatalogSnapshot, gamingSupportVerifiedCatalog } from "./gaming-support-catalog";
import { mergeReferenceCatalogPart } from "./reference-catalog-merge";

const DAY_MS = 86_400_000;
const loaders: Array<{ name: string; apply: (catalog: readonly Part[]) => Part[]; product: Part }> = [
  { name: "phase1", apply: applyPhase1CatalogSnapshot, product: phase1VerifiedCatalog.find((part) => part.sourceProductCode === "54218171")! },
  { name: "AMD GPU", apply: applyGamingAmdCatalogSnapshot, product: gamingAmdVerifiedCatalog[0]! },
  { name: "target GPU", apply: applyGamingTargetCatalogSnapshot, product: gamingTargetVerifiedCatalog[0]! },
  { name: "support", apply: applyGamingSupportCatalogSnapshot, product: gamingSupportVerifiedCatalog.find((part) => part.category === "psu")! }
];

function sourceDates(source: Part) {
  const priceTime = Date.parse(source.priceCheckedAt ?? source.updatedAt);
  const newestTime = Math.max(priceTime, Date.parse(source.updatedAt));
  return {
    oldPrice: new Date(priceTime - DAY_MS).toISOString(),
    delisted: new Date(newestTime + DAY_MS).toISOString(),
    relisted: new Date(newestTime + 2 * DAY_MS).toISOString()
  };
}

function matchedProduct(catalog: Part[], source: Part): Part {
  const matches = catalog.filter((part) => part.category === source.category && part.sourceProductCode === source.sourceProductCode);
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

describe.each(loaders)("$name reference snapshot listing precedence", ({ apply, product: source }) => {
  it("updates an older price without reviving a product delisted after the bundled snapshot", () => {
    const dates = sourceDates(source);
    const current: Part = { ...source, id: `runtime-${source.id}`, priceWon: 1_234, priceCheckedAt: dates.oldPrice, updatedAt: dates.delisted, delistedAt: dates.delisted };
    const result = matchedProduct(apply([current]), source);
    expect(result.id).toBe(current.id);
    expect(result.delistedAt).toBe(dates.delisted);
    expect(result.updatedAt).toBe(dates.delisted);
    expect(result.priceWon).toBe(source.priceWon);
    expect(result.priceCheckedAt).toBe(source.priceCheckedAt);
    expect(current.priceWon).toBe(1_234);
    expect(current.delistedAt).toBe(dates.delisted);
    // Reapplying the same snapshot cannot discard the later sales-stop record.
    expect(matchedProduct(apply([result]), source).delistedAt).toBe(dates.delisted);
  });

  it("keeps a sales stop when it has the same observation time as an active snapshot", () => {
    const dates = sourceDates(source);
    const current: Part = { ...source, id: `tied-${source.id}`, priceWon: 1_234, priceCheckedAt: dates.oldPrice, updatedAt: source.updatedAt, delistedAt: source.updatedAt };
    const result = matchedProduct(apply([current]), source);
    expect(result.delistedAt).toBe(source.updatedAt);
    expect(result.priceWon).toBe(source.priceWon);
  });

  it("allows a later live active observation and keeps its latest price and local ID", () => {
    const dates = sourceDates(source);
    const stopped: Part = { ...source, id: `relisted-${source.id}`, priceWon: 1_234, priceCheckedAt: dates.oldPrice, updatedAt: dates.delisted, delistedAt: dates.delisted };
    const cachedStop = matchedProduct(apply([stopped]), source);
    const live: Part = { ...cachedStop, priceWon: source.priceWon! + 12_345, priceCheckedAt: dates.relisted, updatedAt: dates.relisted };
    delete live.delistedAt;
    const result = matchedProduct(apply([live]), source);
    expect(result).toBe(live);
    expect(result.id).toBe(stopped.id);
    expect(result.delistedAt).toBeUndefined();
    expect(result.priceWon).toBe(live.priceWon);
    expect(result.priceCheckedAt).toBe(dates.relisted);
    expect(result.updatedAt).toBe(dates.relisted);
  });

  it("permits a newer bundled active observation to clear an older sales stop", () => {
    const dates = sourceDates(source);
    const current: Part = { ...source, id: `older-stop-${source.id}`, priceWon: 1_234, priceCheckedAt: dates.oldPrice, updatedAt: dates.oldPrice, delistedAt: dates.oldPrice };
    const result = matchedProduct(apply([current]), source);
    expect(result.id).toBe(current.id);
    expect(result.delistedAt).toBeUndefined();
    expect(result.priceWon).toBe(source.priceWon);
  });

  it("retains reviewed specifications while refreshing the price of a newly delisted product", () => {
    const dates = sourceDates(source);
    const current: Part = {
      ...source, id: `reviewed-${source.id}`, priceWon: 1_234, priceCheckedAt: dates.oldPrice, updatedAt: dates.delisted, delistedAt: dates.delisted,
      dataQuality: "manual", missingFields: ["reviewed-dimension"],
      specs: { ...source.specs, lengthMm: 789, physicalEvidenceSourceUrl: "https://example.com/previous-manufacturer-review" }
    };
    const result = matchedProduct(apply([current]), source);
    expect(result.delistedAt).toBe(dates.delisted);
    expect(result.priceWon).toBe(source.priceWon);
    expect(result.specs.lengthMm).toBe(789);
    expect(result.specs.physicalEvidenceSourceUrl).toBe(current.specs.physicalEvidenceSourceUrl);
    expect(result.dataQuality).toBe("manual");
    expect(result.missingFields).toEqual(["reviewed-dimension"]);
  });

  it("does not match a similarly named product with another source product code", () => {
    const other: Part = { ...source, id: `other-${source.id}`, sourceProductCode: "unrelated-product", priceWon: 98_765 };
    const result = apply([other]);
    expect(result[0]).toBe(other);
    expect(matchedProduct(result, source).sourceProductCode).toBe(source.sourceProductCode);
    expect(result.filter((part) => part.id === other.id)).toHaveLength(1);
  });
});

describe("independent price and listing observations", () => {
  it("preserves a newer price when a still newer active observation clears an old sales stop", () => {
    const source = loaders[0]!.product;
    const dates = sourceDates(source);
    const current: Part = { ...source, priceWon: source.priceWon! + 54_321, priceCheckedAt: dates.delisted, updatedAt: dates.oldPrice, delistedAt: dates.oldPrice };
    const activeReference: Part = { ...source, updatedAt: dates.relisted };
    const result = mergeReferenceCatalogPart(current, activeReference);
    expect(result.delistedAt).toBeUndefined();
    expect(result.updatedAt).toBe(dates.relisted);
    expect(result.priceWon).toBe(current.priceWon);
    expect(result.priceCheckedAt).toBe(current.priceCheckedAt);
  });

  it("prefers a tied sales stop regardless of which side supplied it", () => {
    const source = loaders[0]!.product;
    const stoppedReference: Part = { ...source, delistedAt: source.updatedAt };
    expect(mergeReferenceCatalogPart(source, stoppedReference).delistedAt).toBe(source.updatedAt);
    expect(mergeReferenceCatalogPart(stoppedReference, source).delistedAt).toBe(source.updatedAt);
  });
});
