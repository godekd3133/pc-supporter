import { describe, expect, it } from "vitest";
import { loadCatalogSnapshot, loadCatalogSnapshotTimestamp } from "./catalog-snapshot";

describe("catalog snapshot seam", () => {
  it("captures reusable catalog/accessory arrays with matching cache dependencies", async () => {
    const first = await loadCatalogSnapshot();
    const second = await loadCatalogSnapshot();

    expect(first.catalog.length).toBeGreaterThan(0);
    expect(first.accessories.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(first.catalogUpdatedAt))).toBe(true);
    expect(typeof first.accessoryUpdatedAt).toBe("string");
    expect(Number.isInteger(first.catalogRevision)).toBe(true);
    expect(second.catalog).toBe(first.catalog);
    expect(second.accessories).toBe(first.accessories);
    expect(second.catalogUpdatedAt).toBe(first.catalogUpdatedAt);
    expect(second.accessoryUpdatedAt).toBe(first.accessoryUpdatedAt);
    expect(second.catalogRevision).toBe(first.catalogRevision);

    const timestamp = await loadCatalogSnapshotTimestamp();
    expect(timestamp.catalogUpdatedAt).toBe(first.catalogUpdatedAt);
    expect(timestamp.catalogRevision).toBe(first.catalogRevision);
  });
});
