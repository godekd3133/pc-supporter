import { describe, expect, it } from "vitest";
import { savedBuildIdFromOwnershipInput } from "./SavedBuildDialogs";

describe("savedBuildIdFromOwnershipInput", () => {
  it("extracts the id from share links, absolute URLs, and bare ids", () => {
    expect(savedBuildIdFromOwnershipInput("/share/build-123?view=compact")).toBe("build-123");
    expect(savedBuildIdFromOwnershipInput("https://pc.example.com/share/build-abc")).toBe("build-abc");
    expect(savedBuildIdFromOwnershipInput("https://pc.example.com/some/path/build-xyz")).toBe("build-xyz");
    expect(savedBuildIdFromOwnershipInput("  build-raw  ")).toBe("build-raw");
  });

  it("returns undefined for empty input, malformed URLs, and invalid escapes", () => {
    expect(savedBuildIdFromOwnershipInput("   ")).toBeUndefined();
    expect(savedBuildIdFromOwnershipInput("https://")).toBeUndefined();
    expect(savedBuildIdFromOwnershipInput("/share/%ZZ")).toBeUndefined();
    expect(savedBuildIdFromOwnershipInput("/share/%E0%A4")).toBeUndefined();
  });

  it("decodes valid percent-encoded ids", () => {
    expect(savedBuildIdFromOwnershipInput("/share/build%2Ddash")).toBe("build-dash");
  });
});
