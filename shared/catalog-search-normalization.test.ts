import { describe, expect, it } from "vitest";
import { catalogSearchMatches, normalizeCatalogSearchText } from "./catalog-search-normalization";

describe("catalog model search", () => {
  it("matches spaced and joined Ti model spelling in both directions", () => {
    for (const query of ["5060ti", "5060 ti", "RTX5060TI", "rtx 5060 ti"]) {
      expect(catalogSearchMatches("MSI 지포스 RTX 5060 Ti GAMING 16GB", query)).toBe(true);
      expect(catalogSearchMatches("MSI 지포스 RTX5060TI GAMING 16GB", query)).toBe(true);
    }
    expect(normalizeCatalogSearchText("  RTX  5060 TI  ")).toBe("rtx 5060ti");
  });
  it("keeps complete models and suffix siblings distinct", () => {
    expect(catalogSearchMatches("RTX 5060 Ti 8GB", "5060")).toBe(false);
    expect(catalogSearchMatches("RTX 5060 8GB", "5060ti")).toBe(false);
    expect(catalogSearchMatches("RTX 50600", "5060")).toBe(false);
    expect(catalogSearchMatches("MSI Test with spaces", "testwithspaces")).toBe(false);
    expect(catalogSearchMatches("XFX RX9070XT", "rx 9070 xt")).toBe(true);
    expect(catalogSearchMatches("[OEM] RTX 5060 Ti", "[OEM]")).toBe(true);
  });
});
