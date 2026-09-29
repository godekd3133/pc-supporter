import { describe, expect, it } from "vitest";
import { offlineCatalogSnapshotFromUnknown, requireOfflineCatalogSnapshot } from "./offline-catalog";

function validRawSnapshot() {
  return {
    manifest: {
      schemaVersion: 1,
      kind: "pc-supporter-offline-catalog",
      revision: "catalog-3-1234567890abcdef",
      snapshotAt: "2026-09-29T00:00:00.000Z",
      accessorySnapshotAt: "2026-09-29T00:00:00.000Z",
      catalogRevision: 3,
      privateRecommendationEvidenceIncluded: false,
      generatedAt: "2026-09-29T00:00:00.000Z",
      selectedCategories: { parts: ["cpu"], accessories: ["storage_accessory"] },
      counts: { parts: 1, accessories: 1 },
      sourceHashes: { catalog: "1".repeat(64), accessories: "2".repeat(64) },
      bundleHashes: { parts: "3".repeat(64), accessories: "4".repeat(64) }
    },
    parts: [{
      id: "cpu-offline-test",
      category: "cpu",
      name: "Test CPU",
      updatedAt: "2026-09-29T00:00:00.000Z",
      specs: { socket: "AM5", supportedSockets: ["AM5"], nested: { values: [1, 2] } }
    }],
    accessories: [{
      id: "storage-accessory-offline-test",
      category: "storage_accessory",
      listingType: "accessory",
      name: "Test storage accessory",
      updatedAt: "2026-09-29T00:00:00.000Z",
      specs: { compatibility: { targets: ["ssd"] } }
    }]
  };
}

describe("offline catalog snapshot trust boundary", () => {
  it("returns and reuses a deeply frozen normalized snapshot copy", () => {
    const raw = validRawSnapshot();
    const snapshot = offlineCatalogSnapshotFromUnknown(raw);
    const part = snapshot?.parts[0] as unknown as { specs: { supportedSockets: string[]; nested: { values: number[] } } };
    const accessory = snapshot?.accessories[0] as unknown as { specs: { compatibility: { targets: string[] } } };

    expect(snapshot).toBeDefined();
    expect(snapshot).not.toBe(raw);
    expect(snapshot?.parts).not.toBe(raw.parts);
    expect(requireOfflineCatalogSnapshot(snapshot)).toBe(snapshot);
    expect(offlineCatalogSnapshotFromUnknown(snapshot)).toBe(snapshot);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.manifest)).toBe(true);
    expect(Object.isFrozen(snapshot?.manifest.selectedCategories.parts)).toBe(true);
    expect(Object.isFrozen(snapshot?.parts)).toBe(true);
    expect(Object.isFrozen(snapshot?.parts[0])).toBe(true);
    expect(Object.isFrozen(snapshot?.parts[0]?.specs)).toBe(true);
    expect(Object.isFrozen(part.specs.supportedSockets)).toBe(true);
    expect(Object.isFrozen(part.specs.nested)).toBe(true);
    expect(Object.isFrozen(part.specs.nested.values)).toBe(true);
    expect(Object.isFrozen(accessory.specs.compatibility.targets)).toBe(true);

    raw.parts[0]!.specs.supportedSockets[0] = "LGA1700";
    expect(part.specs.supportedSockets).toEqual(["AM5"]);
  });

  it("revalidates mutable raw input and preserves failure behavior", () => {
    const raw = validRawSnapshot();
    const normalized = offlineCatalogSnapshotFromUnknown(raw)!;

    (raw.parts[0] as Record<string, unknown>).imageUrl = "https://example.invalid/image.jpg";

    expect(offlineCatalogSnapshotFromUnknown(raw)).toBeUndefined();
    expect(() => requireOfflineCatalogSnapshot(raw)).toThrow(
      "로컬 카탈로그 묶음의 manifest 또는 데이터 구조가 올바르지 않습니다."
    );
    expect(requireOfflineCatalogSnapshot(normalized)).toBe(normalized);
    expect((normalized.parts[0] as unknown as Record<string, unknown>)).not.toHaveProperty("imageUrl");
  });
});
