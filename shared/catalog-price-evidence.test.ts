import { describe, expect, it } from "vitest";
import { CATALOG_PRICE_EVIDENCE_CHECK_LABELS, catalogPriceEvidenceDescriptionFor, catalogPriceEvidenceFor, catalogPriceEvidenceLabelFor } from "./catalog-price-evidence";

describe("catalogPriceEvidenceFor", () => {
  it("classifies a recently checked Danawa price independently from spec collection status", () => {
    const item = {
      dataQuality: "incomplete" as const,
      source: "danawa" as const,
      priceWon: 129000,
      priceCheckedAt: "2026-09-28T12:00:00.000Z",
      now: "2026-09-29T12:00:00.000Z"
    };
    expect(catalogPriceEvidenceFor(item)).toBe("live");
    expect(catalogPriceEvidenceLabelFor(item)).toBe("최근 확인");
    expect(catalogPriceEvidenceDescriptionFor(item)).toContain("최근 상품 페이지에서 확인한 금액");
  });

  it("requires a purchase recheck when a live product has no price confirmation time", () => {
    const item = { dataQuality: "live" as const, source: "danawa" as const, priceWon: 129000 };
    expect(catalogPriceEvidenceFor(item)).toBe("recorded");
    expect(catalogPriceEvidenceLabelFor(item)).toBe("다시 확인");
    expect(catalogPriceEvidenceDescriptionFor(item)).toContain("확인 시각이 없거나 오래된 금액");
  });

  it("requires a purchase recheck when the confirmed price is older than the freshness window", () => {
    const item = {
      dataQuality: "live" as const,
      source: "danawa" as const,
      priceWon: 129000,
      priceCheckedAt: "2026-09-20T12:00:00.000Z",
      now: "2026-09-29T12:00:00.000Z"
    };
    expect(catalogPriceEvidenceFor(item)).toBe("recorded");
  });

  it("classifies manual prices independently from live collection", () => {
    const item = { dataQuality: "manual" as const, source: "manual" as const, priceWon: 7900 };
    expect(catalogPriceEvidenceFor(item)).toBe("manual");
    expect(catalogPriceEvidenceLabelFor(item)).toBe("직접 입력");
    expect(CATALOG_PRICE_EVIDENCE_CHECK_LABELS.manual).toBe("직접 입력");
    expect(catalogPriceEvidenceDescriptionFor(item)).toContain("직접 입력한 금액");
    expect(catalogPriceEvidenceDescriptionFor(item)).toContain("구매 전에 다시 확인");
  });

  it("treats starter prices as project reference values", () => {
    expect(catalogPriceEvidenceFor({ dataQuality: "seed", source: "manual", priceWon: 9900 })).toBe("reference");
    expect(catalogPriceEvidenceFor({ dataQuality: "incomplete", source: "seed", priceWon: 9900 })).toBe("reference");
  });

  it("keeps incomplete non-seed numeric prices in a recheck state", () => {
    const item = { dataQuality: "incomplete" as const, source: "danawa" as const, priceWon: 9900 };
    expect(catalogPriceEvidenceFor(item)).toBe("recorded");
    expect(catalogPriceEvidenceDescriptionFor(item)).toContain("확인 시각이 없거나 오래된 금액");
    expect(catalogPriceEvidenceDescriptionFor(item)).toContain("상품 페이지의 금액과 사양을 다시 확인");
  });

  it("does not treat missing, zero, or non-finite prices as known", () => {
    expect(catalogPriceEvidenceFor({ dataQuality: "live" })).toBe("unknown");
    expect(catalogPriceEvidenceFor({ dataQuality: "live", priceWon: 0 })).toBe("unknown");
    expect(catalogPriceEvidenceFor({ dataQuality: "live", priceWon: Number.NaN })).toBe("unknown");
  });
});
