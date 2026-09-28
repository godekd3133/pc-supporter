import { describe, expect, it } from "vitest";
import { compatibilityDisplayStatusFor } from "./compatibility-display-status";

describe("compatibility display status", () => {
  it("includes peripheral incompatibilities and unknowns in the overall status", () => {
    expect(compatibilityDisplayStatusFor({ status: "compatible", accessoryCompatibility: { status: "incompatible" } })).toBe("incompatible");
    expect(compatibilityDisplayStatusFor({ status: "compatible", accessoryCompatibility: { status: "needs_review" } })).toBe("needs_review");
  });

  it("keeps a core incompatibility above a peripheral review state", () => {
    expect(compatibilityDisplayStatusFor({ status: "incompatible", accessoryCompatibility: { status: "needs_review" } })).toBe("incompatible");
  });

  it("keeps a compatible result when no peripheral result is available", () => {
    expect(compatibilityDisplayStatusFor({ status: "compatible" })).toBe("compatible");
  });
});
