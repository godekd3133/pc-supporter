import { describe, expect, it } from "vitest";
import { offlineCatalogRevisionMatches } from "./bundled-catalog";

describe("bundled offline catalog revision", () => {
  it("accepts only the exact catalog revision embedded in the client", () => {
    expect(offlineCatalogRevisionMatches("catalog-0-4ecaecc34937e837", "catalog-0-4ecaecc34937e837")).toBe(true);
    expect(offlineCatalogRevisionMatches("catalog-0-aaaaaaaaaaaaaaaa", "catalog-0-4ecaecc34937e837")).toBe(false);
    expect(offlineCatalogRevisionMatches("catalog-0-4ecaecc34937e837", "")).toBe(false);
    expect(offlineCatalogRevisionMatches(undefined, "catalog-0-4ecaecc34937e837")).toBe(false);
  });
});
