import { describe, expect, it } from "vitest";
import { isCustomerVisibleCatalogSpecKey } from "./SavedCheckTimeline";

describe("isCustomerVisibleCatalogSpecKey", () => {
  it("hides benchmark score fields while preserving hardware specs", () => {
    expect(isCustomerVisibleCatalogSpecKey("cinebenchR23Multi")).toBe(false);
    expect(isCustomerVisibleCatalogSpecKey("gpu3dmarkTimeSpyScore")).toBe(false);
    expect(isCustomerVisibleCatalogSpecKey("cores")).toBe(true);
    expect(isCustomerVisibleCatalogSpecKey("vramGb")).toBe(true);
  });
});
