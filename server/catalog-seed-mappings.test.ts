import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { sourceIdentitiesFor, validateCatalogSeedMappingManualInput } from "./catalog-seed-mappings";

function part(overrides: Partial<Part>): Part {
  return {
    id: "starter",
    category: "cpu",
    name: "AMD 라이젠5 9600X",
    brand: "AMD",
    model: "9600X",
    source: "seed",
    specs: { socket: "AM5", memoryType: "DDR5" },
    dataQuality: "seed",
    missingFields: [],
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...overrides
  };
}

describe("catalog seed manual mapping input", () => {
  it("accepts a canonical Danawa product URL whose code and category match", () => {
    expect(validateCatalogSeedMappingManualInput({ sourceProductCode: "62794079", sourceUrl: "https://prod.danawa.com/info/?pcode=62794079&cate=112747" }, "cpu")).toEqual({
      valid: true,
      errors: [],
      input: { sourceProductCode: "62794079", sourceUrl: "https://prod.danawa.com/info/?pcode=62794079&cate=112747" }
    });
  });

  it("rejects code mismatches, non-Danawa URLs, and wrong category URLs", () => {
    expect(validateCatalogSeedMappingManualInput({ sourceProductCode: "62794079", sourceUrl: "https://prod.danawa.com/info/?pcode=62794078&cate=112747" }, "cpu").errors).toContain("URL의 pcode와 입력한 상품 코드가 일치하지 않습니다.");
    expect(validateCatalogSeedMappingManualInput({ sourceProductCode: "62794079", sourceUrl: "https://example.com/info/?pcode=62794079&cate=112747" }, "cpu").errors).toContain("prod.danawa.com의 HTTPS 상품 URL만 등록할 수 있습니다.");
    expect(validateCatalogSeedMappingManualInput({ sourceProductCode: "62794079", sourceUrl: "https://prod.danawa.com/info/?pcode=62794079&cate=112751" }, "cpu").errors).toContain("URL의 다나와 범주가 starter 범주와 일치하지 않습니다.");
  });

  it("builds multiple source identity aliases without duplicates", () => {
    const starter = part({ model: "9600X" });
    const active = part({ id: "active", source: "danawa", sourceProductCode: "62794079", name: "AMD Ryzen 5 9600X (Granite Ridge)", model: "AMD Ryzen 5 9600X" });
    expect(sourceIdentitiesFor(starter, active, "62794079")).toEqual(["AMD Ryzen 5 9600X", "AMD Ryzen 5 9600X (Granite Ridge)", "9600X", "AMD 라이젠5 9600X", "62794079"]);
  });
});
