import { describe, expect, it } from "vitest";
import { catalogSearchMatcherFor, catalogSearchMatches, normalizeCatalogSearchText } from "./catalog-search-normalization";

describe("catalog model search", () => {
  it("matches spaced and joined Ti model spelling in both directions", () => {
    for (const query of ["5060ti", "5060 ti", "RTX5060TI", "rtx 5060 ti"]) {
      expect(catalogSearchMatches("MSI 지포스 RTX 5060 Ti GAMING 16GB", query)).toBe(true);
      expect(catalogSearchMatches("MSI 지포스 RTX5060TI GAMING 16GB", query)).toBe(true);
    }
    expect(normalizeCatalogSearchText("  RTX  5060 TI  ")).toBe("rtx 5060ti");
  });
  it("matches partial model numbers as prefixes but never longer-model tails", () => {
    expect(catalogSearchMatches("AMD 라이젠5-6세대 9500F (그래니트 릿지)", "9500")).toBe(true);
    expect(catalogSearchMatches("인텔 코어i5-14세대 14400F", "14400")).toBe(true);
    expect(catalogSearchMatches("RTX 5060 Ti 8GB", "5060")).toBe(true);
    expect(catalogSearchMatches("라이젠 9500F", "라이젠 9500")).toBe(true);
    expect(catalogSearchMatches("인텔 코어i5-14세대 14400F", "4400")).toBe(false);
    expect(catalogSearchMatches("가상 19500 CPU", "9500")).toBe(false);
  });
  it("ranks whole-token model matches before prefix matches", () => {
    const matcher = catalogSearchMatcherFor("5060");
    expect(matcher.relevance("RTX 5060 8GB")).toBeLessThan(matcher.relevance("RTX 5060 Ti 8GB"));
    expect(matcher.relevance("RTX 5070")).toBe(Number.POSITIVE_INFINITY);
  });
  it("keeps suffix siblings distinct in the other direction", () => {
    expect(catalogSearchMatches("RTX 5060 8GB", "5060ti")).toBe(false);
    expect(catalogSearchMatches("MSI Test with spaces", "testwithspaces")).toBe(false);
    expect(catalogSearchMatches("XFX RX9070XT", "rx 9070 xt")).toBe(true);
    expect(catalogSearchMatches("[OEM] RTX 5060 Ti", "[OEM]")).toBe(true);
  });
});
