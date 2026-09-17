import { describe, expect, it } from "vitest";
import { savedBuildOriginDetailFor, savedBuildOriginFromUnknown, savedBuildOriginLabelFor } from "./saved-build-origin";

describe("saved build origin", () => {
  it("normalizes shared generator provenance without owner credentials", () => {
    const origin = savedBuildOriginFromUnknown({
      kind: "shared_generator_variants",
      sourceShareId: "generator-share-123456",
      sourceShareName: "사이버펑크 자동 구성 비교",
      sourcePriority: "balanced",
      sourceCatalogSnapshotAt: "2026-09-17T00:00:00.000Z",
      currentRecheckedAt: "2026-09-17T01:00:00.000Z"
    });
    expect(origin).toMatchObject({ kind: "shared_generator_variants", sourcePriority: "balanced", sourceShareId: "generator-share-123456" });
    expect(origin).not.toHaveProperty("ownerToken");
    expect(savedBuildOriginLabelFor(origin!)).toContain("사이버펑크 자동 구성 비교");
    expect(savedBuildOriginDetailFor(origin!)).toContain("균형형");
  });

  it("rejects malformed provenance fields", () => {
    expect(savedBuildOriginFromUnknown({ kind: "unknown" })).toBeUndefined();
    expect(savedBuildOriginFromUnknown({ kind: "generated", sourcePriority: "invalid" })).toBeUndefined();
    expect(savedBuildOriginFromUnknown({ kind: "generated", generatedAt: "not-a-date" })).toBeUndefined();
    expect(savedBuildOriginFromUnknown({ kind: "generated", sourceShareId: " " })).toBeUndefined();
  });
});
