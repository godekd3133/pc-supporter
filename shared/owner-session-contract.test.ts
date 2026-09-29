import { describe, expect, it } from "vitest";
import { isOwnerSessionResourceType, OWNER_SESSION_RESOURCE_TYPES } from "./owner-session-contract";

describe("owner session resource contract", () => {
  it("exposes one supported resource-kind list and rejects values outside it", () => {
    expect(OWNER_SESSION_RESOURCE_TYPES).toEqual([
      "build",
      "watchlist",
      "comparison",
      "version-comparison",
      "budget-ladder",
      "generator-variants"
    ]);
    for (const resourceType of OWNER_SESSION_RESOURCE_TYPES) {
      expect(isOwnerSessionResourceType(resourceType)).toBe(true);
    }
    for (const value of [undefined, null, 0, "", "unknown"]) {
      expect(isOwnerSessionResourceType(value)).toBe(false);
    }
  });
});
