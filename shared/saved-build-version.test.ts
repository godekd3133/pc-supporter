import { describe, expect, it } from "vitest";
import { savedBuildVersionAuditFor, savedBuildVersionBackupDiffFor, savedBuildVersionGroupIdFor, savedBuildVersionGroupsFor, savedBuildVersionLabelFor, savedBuildVersionMetadataDiffFor, savedBuildVersionMetadataFor, savedBuildVersionMigratedBuildsFor, savedBuildVersionMigrationPreviewFor, savedBuildVersionNumberFor } from "./saved-build-version";
import type { SavedBuild } from "./types";

function build(id: string, updatedAt: string, versionGroupId?: string, versionNumber?: number): SavedBuild {
  return { id, name: id, selection: { memory: [], ssd: [], hdd: [], useIntegratedGraphics: true }, createdAt: updatedAt, updatedAt, ...(versionGroupId ? { versionGroupId } : {}), ...(versionNumber ? { versionNumber } : {}) };
}

describe("saved build versions", () => {
  it("treats legacy builds as their own v1", () => {
    const legacy = build("legacy", "2026-08-31T00:00:00.000Z");
    expect(savedBuildVersionGroupIdFor(legacy)).toBe("legacy");
    expect(savedBuildVersionNumberFor(legacy)).toBe(1);
    expect(savedBuildVersionLabelFor(legacy)).toBe("v1");
  });

  it("assigns the next version in the parent's lineage", () => {
    const parent = build("v1", "2026-08-30T00:00:00.000Z", "lineage", 1);
    const sibling = build("v2", "2026-08-31T00:00:00.000Z", "lineage", 2);
    expect(savedBuildVersionMetadataFor([parent, sibling], "v3", parent.id)).toEqual({ versionGroupId: "lineage", versionNumber: 3, derivedFromBuildId: "v1" });
  });

  it("groups versions chronologically and leaves unrelated builds separate", () => {
    const groups = savedBuildVersionGroupsFor([
      build("v2", "2026-08-31T00:00:00.000Z", "lineage", 2),
      build("other", "2026-08-29T00:00:00.000Z"),
      build("v1", "2026-08-30T00:00:00.000Z", "lineage", 1)
    ]);
    expect(groups.map((group) => group.versionGroupId)).toEqual(["lineage", "other"]);
    expect(groups[0]?.builds.map((item) => item.id)).toEqual(["v1", "v2"]);
  });

  it("reports legacy rows separately from valid version groups", () => {
    const audit = savedBuildVersionAuditFor([build("v1", "2026-08-30T00:00:00.000Z", "lineage", 1), build("legacy", "2026-08-31T00:00:00.000Z")]);
    expect(audit).toMatchObject({ status: "needs_migration", totalBuilds: 2, legacyCount: 1, versionedCount: 1, groupCount: 2, maxVersion: 1 });
  });

  it("reports missing version numbers without blocking an otherwise valid lineage", () => {
    const audit = savedBuildVersionAuditFor([
      build("v1", "2026-08-30T00:00:00.000Z", "lineage", 1),
      build("v3", "2026-08-31T00:00:00.000Z", "lineage", 3)
    ]);
    expect(audit.status).toBe("healthy");
    expect(audit.versionGapGroups).toEqual([{ versionGroupId: "lineage", missingVersions: [2] }]);
  });

  it("flags duplicate versions and orphan or cross-lineage parents", () => {
    const audit = savedBuildVersionAuditFor([
      build("v1", "2026-08-28T00:00:00.000Z", "lineage-a", 1),
      { ...build("duplicate", "2026-08-29T00:00:00.000Z", "lineage-a", 1), derivedFromBuildId: "missing" },
      { ...build("cross", "2026-08-30T00:00:00.000Z", "lineage-b", 2), derivedFromBuildId: "v1" }
    ]);
    expect(audit.status).toBe("invalid");
    expect(audit.duplicateVersionKeys).toEqual(["lineage-a:1"]);
    expect(audit.orphanParentIds).toEqual(["missing"]);
    expect(audit.crossGroupParentIds).toEqual(["cross"]);
  });

  it("previews legacy promotion without mutating the source rows", () => {
    const legacy = build("legacy", "2026-08-31T00:00:00.000Z");
    const versioned = build("v1", "2026-08-30T00:00:00.000Z", "lineage", 1);
    const preview = savedBuildVersionMigrationPreviewFor([legacy, versioned]);
    expect(preview).toMatchObject({ status: "ready", totalBuilds: 2, legacyCount: 1, changedCount: 1, blockers: [] });
    expect(preview.items[0]).toMatchObject({ buildId: "legacy", kind: "legacy", current: {}, proposed: { versionGroupId: "legacy", versionNumber: 1 } });
    expect(preview.items[1]).toMatchObject({ buildId: "v1", kind: "versioned", proposed: { versionGroupId: "lineage", versionNumber: 1 } });
    expect(legacy.versionGroupId).toBeUndefined();
  });

  it("places a legacy child after its parent's latest version", () => {
    const parent = build("parent", "2026-08-28T00:00:00.000Z", "lineage", 1);
    const latest = build("latest", "2026-08-29T00:00:00.000Z", "lineage", 4);
    const legacyChild = { ...build("child", "2026-08-30T00:00:00.000Z"), derivedFromBuildId: "parent" };
    const preview = savedBuildVersionMigrationPreviewFor([parent, latest, legacyChild]);
    expect(preview.status).toBe("ready");
    expect(preview.items.find((item) => item.buildId === "child")?.proposed).toEqual({ versionGroupId: "lineage", versionNumber: 5 });
  });

  it("blocks the preview when the current lineage is already invalid", () => {
    const first = build("first", "2026-08-28T00:00:00.000Z", "lineage", 1);
    const duplicate = { ...build("duplicate", "2026-08-29T00:00:00.000Z", "lineage", 1), derivedFromBuildId: "missing" };
    const preview = savedBuildVersionMigrationPreviewFor([first, duplicate]);
    expect(preview.status).toBe("blocked");
    expect(preview.blockers).toContain("중복 버전 키: lineage:1");
    expect(preview.blockers).toContain("존재하지 않는 부모 견적: missing");
  });

  it("applies only the previewed metadata and preserves the source record", () => {
    const legacy = build("legacy", "2026-08-31T00:00:00.000Z");
    const migrated = savedBuildVersionMigratedBuildsFor([legacy]);
    expect(migrated).toEqual([{ ...legacy, versionGroupId: "legacy", versionNumber: 1 }]);
    expect(legacy).not.toHaveProperty("versionGroupId");
    expect(savedBuildVersionMigratedBuildsFor([{ ...build("bad", "2026-08-31T00:00:00.000Z"), derivedFromBuildId: "missing" }])).toBeUndefined();
  });

  it("returns only changed version metadata in a backup diff", () => {
    const before = build("legacy", "2026-08-31T00:00:00.000Z");
    const after = { ...before, versionGroupId: "legacy", versionNumber: 1 };
    expect(savedBuildVersionMetadataDiffFor(before, after)).toMatchObject({ buildId: "legacy", changedFields: ["versionGroupId", "versionNumber"], before: {}, after: { versionGroupId: "legacy", versionNumber: 1 } });
    expect(savedBuildVersionBackupDiffFor([before])).toHaveLength(1);
    expect(savedBuildVersionMetadataDiffFor(after, after)).toBeUndefined();
  });
});
