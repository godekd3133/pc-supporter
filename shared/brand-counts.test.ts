import { describe, expect, it } from "vitest";
import { brandCountsFor } from "./brand-counts";

describe("brand counts", () => {
  it("merges case and whitespace variants and sorts by count", () => {
    expect(brandCountsFor([
      { brand: " AMD " },
      { brand: "amd" },
      { brand: "ASUS" },
      { brand: "" },
      {}
    ])).toEqual([
      { brand: "AMD", count: 2 },
      { brand: "ASUS", count: 1 }
    ]);
  });

  it("keeps the suggestion list bounded", () => {
    const items = Array.from({ length: 5 }, (_, index) => ({ brand: `Brand-${index}` }));
    expect(brandCountsFor(items, 2)).toHaveLength(2);
    expect(brandCountsFor(items, 0)).toHaveLength(1);
  });
});
