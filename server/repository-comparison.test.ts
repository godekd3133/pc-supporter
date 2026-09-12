import { describe, expect, it } from "vitest";
import { savedAlternativeComparisonFromDatabaseRow } from "./repository";

describe("saved comparison database mapping", () => {
  it("restores snapshot metadata needed for freshness decisions", () => {
    const mapped = savedAlternativeComparisonFromDatabaseRow({
      id: "comparison-db-1",
      name: "GPU 후보 비교",
      category: "gpu",
      current_part_name: "기존 GPU",
      current_part_summary: "PCIe 4.0 · VRAM 8GB",
      current_part_price: "450,000원",
      catalog_snapshot_at: new Date("2026-09-02T01:02:03.000Z"),
      engine_version: "2.57.0",
      candidates: [],
      created_at: new Date("2026-09-02T01:02:03.000Z"),
      updated_at: new Date("2026-09-02T01:02:03.000Z"),
      expires_at: null,
      owner_token_hash: "a".repeat(64)
    });

    expect(mapped).toMatchObject({
      id: "comparison-db-1",
      catalogSnapshotAt: "2026-09-02T01:02:03.000Z",
      engineVersion: "2.57.0",
      currentPartSummary: "PCIe 4.0 · VRAM 8GB",
      currentPartPrice: "450,000원",
      ownerTokenHash: "a".repeat(64)
    });
  });

  it("keeps legacy rows valid when metadata columns are null", () => {
    const mapped = savedAlternativeComparisonFromDatabaseRow({
      id: "comparison-db-legacy",
      name: "레거시 비교",
      category: null,
      current_part_name: null,
      current_part_summary: null,
      current_part_price: null,
      catalog_snapshot_at: null,
      engine_version: null,
      candidates: [],
      created_at: new Date("2026-09-02T01:02:03.000Z"),
      updated_at: new Date("2026-09-02T01:02:03.000Z"),
      expires_at: null,
      owner_token_hash: null
    });

    expect(mapped).not.toHaveProperty("catalogSnapshotAt");
    expect(mapped).not.toHaveProperty("engineVersion");
    expect(mapped).not.toHaveProperty("ownerTokenHash");
  });
});
