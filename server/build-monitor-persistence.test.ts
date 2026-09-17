import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { publicSavedBuild } from "./build-share";
import { savedBuildRecordFromUnknown } from "./repository";

const build = {
  id: "build-1",
  name: "서버 모니터 견적",
  selection: { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true },
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
  ownerTokenHash: "a".repeat(64)
};

describe("saved build monitor persistence", () => {
  it("normalizes valid private monitor state and drops malformed state without losing the build", () => {
    const monitorState = { enabled: true, intervalMinutes: 60, alertPolicy: "all" as const, updatedAt: "2026-08-31T01:00:00.000Z", nextCheckAt: "2026-08-31T01:00:00.000Z", alerts: [] } as const;
    expect(savedBuildRecordFromUnknown({ ...build, monitorState })?.monitorState).toEqual(monitorState);
    const malformed = savedBuildRecordFromUnknown({ ...build, monitorState: { ...monitorState, intervalMinutes: 5 } });
    expect(malformed).toBeDefined();
    expect(malformed?.monitorState).toBeUndefined();
    const purchaseProgress = { inputFingerprint: "build-fingerprint-1", rowKeys: ["part:cpu:cpu-1"], checkedIds: ["part:cpu:cpu-1"], revision: 1, updatedAt: "2026-08-31T01:00:00.000Z" };
    expect(savedBuildRecordFromUnknown({ ...build, purchaseProgress })?.purchaseProgress).toEqual(purchaseProgress);
    expect(savedBuildRecordFromUnknown({ ...build, purchaseProgress: { ...purchaseProgress, checkedIds: ["removed"] } })?.purchaseProgress).toBeUndefined();
    const purchasePriceHistory = { inputFingerprint: "build-fingerprint-1", rowKeys: ["part:cpu:cpu-1"], priceHistory: { "part:cpu:cpu-1": [{ checkedAt: "2026-08-31T01:00:00.000Z", unitPriceWon: 100_000 }] }, revision: 1, updatedAt: "2026-08-31T01:00:00.000Z" };
    expect(savedBuildRecordFromUnknown({ ...build, purchasePriceHistory })?.purchasePriceHistory).toEqual(purchasePriceHistory);
    expect(savedBuildRecordFromUnknown({ ...build, purchasePriceHistory: { ...purchasePriceHistory, priceHistory: { removed: purchasePriceHistory.priceHistory["part:cpu:cpu-1"] } } })?.purchasePriceHistory).toBeUndefined();
  });

  it("never exposes persisted monitor state through the public saved build shape", () => {
    const record = savedBuildRecordFromUnknown({ ...build, monitorState: { enabled: false, intervalMinutes: 360, alertPolicy: "all", updatedAt: "2026-08-31T01:00:00.000Z", alerts: [] } });
    expect(record).toBeDefined();
    expect(publicSavedBuild(record!)).not.toHaveProperty("monitorState");
    expect(publicSavedBuild(record!)).not.toHaveProperty("ownerTokenHash");
  });

  it("preserves valid version lineage metadata and drops malformed values", () => {
    const versioned = savedBuildRecordFromUnknown({ ...build, versionGroupId: "lineage-1", versionNumber: 2, derivedFromBuildId: "parent-1" });
    expect(versioned).toMatchObject({ versionGroupId: "lineage-1", versionNumber: 2, derivedFromBuildId: "parent-1" });
    const malformed = savedBuildRecordFromUnknown({ ...build, versionGroupId: "", versionNumber: 0, derivedFromBuildId: 7 });
    expect(malformed).toBeDefined();
    expect(malformed).not.toHaveProperty("versionGroupId");
    expect(malformed).not.toHaveProperty("versionNumber");
    expect(malformed).not.toHaveProperty("derivedFromBuildId");
  });

  it("preserves generated-build origin metadata and rejects malformed provenance", () => {
    const origin = { kind: "shared_generator_variants", sourceShareId: "generator-share-1", sourceShareName: "자동 구성 비교", sourcePriority: "balanced", sourceCatalogSnapshotAt: "2026-09-17T00:00:00.000Z", currentRecheckedAt: "2026-09-17T01:00:00.000Z" } as const;
    expect(savedBuildRecordFromUnknown({ ...build, origin })?.origin).toEqual({ ...origin });
    expect(savedBuildRecordFromUnknown({ ...build, origin: { ...origin, sourcePriority: "invalid" } })).toBeUndefined();
    expect(savedBuildRecordFromUnknown({ ...build, origin: { ...origin, sourceShareId: "" } })).toBeUndefined();
    expect(savedBuildRecordFromUnknown({ ...build, origin: { ...origin, currentRecheckedAt: "invalid" } })).toBeUndefined();
  });

  it("keeps the checked snapshot and monitor columns in the deployable PostgreSQL schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");
    expect(schema).toContain("check_snapshot JSONB");
    expect(schema).toContain("check_history JSONB");
    expect(schema).toContain("monitor_state JSONB");
    expect(schema).toContain("purchase_progress JSONB");
    expect(schema).toContain("purchase_price_history JSONB");
    expect(schema).toContain("ADD COLUMN IF NOT EXISTS monitor_state JSONB");
    expect(schema).toContain("ADD COLUMN IF NOT EXISTS purchase_progress JSONB");
    expect(schema).toContain("ADD COLUMN IF NOT EXISTS purchase_price_history JSONB");
    expect(schema).toContain("version_group_id TEXT");
    expect(schema).toContain("version_number INTEGER");
    expect(schema).toContain("derived_from_build_id TEXT");
    expect(schema).toContain("origin JSONB");
    expect(schema).toContain("ADD COLUMN IF NOT EXISTS origin JSONB");
    expect(schema).toContain("saved_build_version_backups");
    expect(schema).toContain("source_fingerprint TEXT");
  });
});
