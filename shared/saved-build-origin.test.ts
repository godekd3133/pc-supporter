import { describe, expect, it } from "vitest";
import { savedBuildOriginAvailabilityLabelFor, savedBuildOriginComparisonTextFor, savedBuildOriginDetailFor, savedBuildOriginFromUnknown, savedBuildOriginLabelFor } from "./saved-build-origin";

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
    expect(savedBuildOriginDetailFor(origin!)).toContain("공유 catalog");
  });

  it("rejects malformed provenance fields", () => {
    expect(savedBuildOriginFromUnknown({ kind: "unknown" })).toBeUndefined();
    expect(savedBuildOriginFromUnknown({ kind: "generated", sourcePriority: "invalid" })).toBeUndefined();
    expect(savedBuildOriginFromUnknown({ kind: "generated", generatedAt: "not-a-date" })).toBeUndefined();
    expect(savedBuildOriginFromUnknown({ kind: "generated", sourceShareId: " " })).toBeUndefined();
  });

  it("summarizes provenance differences between saved versions", () => {
    const before = savedBuildOriginFromUnknown({ kind: "shared_generator_variants", sourceShareId: "share-1", sourcePriority: "balanced", sourceCatalogSnapshotAt: "2026-09-17T00:00:00.000Z" });
    const same = savedBuildOriginFromUnknown({ kind: "shared_generator_variants", sourceShareId: "share-1", sourcePriority: "balanced", sourceCatalogSnapshotAt: "2026-09-17T00:00:00.000Z" });
    const changed = savedBuildOriginFromUnknown({ kind: "shared_generator_variants", sourceShareId: "share-2", sourcePriority: "performance", sourceCatalogSnapshotAt: "2026-09-17T00:00:00.000Z" });
    expect(savedBuildOriginComparisonTextFor(before, same)).toBe("같은 공유 비교·priority에서 파생");
    expect(savedBuildOriginComparisonTextFor(before, changed)).toBe("공유 비교가 다름 · priority가 다름");
    expect(savedBuildOriginComparisonTextFor(undefined, same)).toBe("한 버전에만 생성 출처 기록");
    expect(savedBuildOriginAvailabilityLabelFor("active")).toBe("원본 비교 사용 가능");
    expect(savedBuildOriginAvailabilityLabelFor("unavailable")).toBe("원본 비교 만료 또는 취소됨");
  });
});
