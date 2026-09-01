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

  it("keeps the checked snapshot and monitor columns in the deployable PostgreSQL schema", () => {
    const schema = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");
    expect(schema).toContain("check_snapshot JSONB");
    expect(schema).toContain("check_history JSONB");
    expect(schema).toContain("monitor_state JSONB");
    expect(schema).toContain("ADD COLUMN IF NOT EXISTS monitor_state JSONB");
    expect(schema).toContain("version_group_id TEXT");
    expect(schema).toContain("version_number INTEGER");
    expect(schema).toContain("derived_from_build_id TEXT");
    expect(schema).toContain("saved_build_version_backups");
    expect(schema).toContain("source_fingerprint TEXT");
  });
});
