import { describe, expect, it } from "vitest";
import { catalogPriceEvidenceDescriptionFor, catalogPriceEvidenceFor, catalogPriceEvidenceLabelFor } from "./catalog-price-evidence";

describe("catalogPriceEvidenceFor", () => {
  it("classifies a live Danawa price as a collected catalog price", () => {
    const item = { dataQuality: "live" as const, source: "danawa" as const, priceWon: 129000 };
    expect(catalogPriceEvidenceFor(item)).toBe("live");
    expect(catalogPriceEvidenceLabelFor(item)).toBe("다나와 수집가");
  });

  it("classifies manual prices independently from live collection", () => {
    const item = { dataQuality: "manual" as const, source: "manual" as const, priceWon: 7900 };
    expect(catalogPriceEvidenceFor(item)).toBe("manual");
    expect(catalogPriceEvidenceDescriptionFor(item)).toContain("수동 검수");
  });

  it("treats starter prices as project reference values", () => {
    expect(catalogPriceEvidenceFor({ dataQuality: "seed", source: "manual", priceWon: 9900 })).toBe("reference");
    expect(catalogPriceEvidenceFor({ dataQuality: "incomplete", source: "seed", priceWon: 9900 })).toBe("reference");
  });

  it("keeps incomplete non-seed numeric prices in a recheck state", () => {
    const item = { dataQuality: "incomplete" as const, source: "danawa" as const, priceWon: 9900 };
    expect(catalogPriceEvidenceFor(item)).toBe("recorded");
    expect(catalogPriceEvidenceDescriptionFor(item)).toContain("데이터 품질");
  });

  it("does not treat missing, zero, or non-finite prices as known", () => {
    expect(catalogPriceEvidenceFor({ dataQuality: "live" })).toBe("unknown");
    expect(catalogPriceEvidenceFor({ dataQuality: "live", priceWon: 0 })).toBe("unknown");
    expect(catalogPriceEvidenceFor({ dataQuality: "live", priceWon: Number.NaN })).toBe("unknown");
  });
});
