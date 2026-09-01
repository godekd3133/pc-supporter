import type { SavedBuild } from "./types";

export interface SavedBuildVersionMetadata {
  versionGroupId: string;
  versionNumber: number;
  derivedFromBuildId?: string;
}

export interface SavedBuildVersionGroup {
  versionGroupId: string;
  builds: SavedBuild[];
}

function versionNumberFor(build: Pick<SavedBuild, "versionNumber">) {
  return Number.isInteger(build.versionNumber) && (build.versionNumber ?? 0) >= 1 ? build.versionNumber! : 1;
}

export function savedBuildVersionGroupIdFor(build: Pick<SavedBuild, "id" | "versionGroupId">) {
  return typeof build.versionGroupId === "string" && build.versionGroupId.trim() ? build.versionGroupId : build.id;
}

export function savedBuildVersionNumberFor(build: Pick<SavedBuild, "versionNumber">) {
  return versionNumberFor(build);
}

export function savedBuildVersionMetadataFor(builds: Pick<SavedBuild, "id" | "versionGroupId" | "versionNumber">[], newId: string, parentBuildId?: string): SavedBuildVersionMetadata {
  if (!parentBuildId) return { versionGroupId: newId, versionNumber: 1 };
  const parent = builds.find((build) => build.id === parentBuildId);
  if (!parent) return { versionGroupId: newId, versionNumber: 1 };
  const versionGroupId = savedBuildVersionGroupIdFor(parent);
  const versionNumber = Math.max(
    versionNumberFor(parent),
    ...builds.filter((build) => savedBuildVersionGroupIdFor(build) === versionGroupId).map(versionNumberFor)
  ) + 1;
  return { versionGroupId, versionNumber, derivedFromBuildId: parent.id };
}

export function savedBuildVersionGroupsFor(builds: SavedBuild[]): SavedBuildVersionGroup[] {
  const groups = new Map<string, SavedBuild[]>();
  for (const build of builds) {
    const versionGroupId = savedBuildVersionGroupIdFor(build);
    groups.set(versionGroupId, [...(groups.get(versionGroupId) ?? []), build]);
  }
  return [...groups.entries()]
    .map(([versionGroupId, groupBuilds]) => ({
      versionGroupId,
      builds: groupBuilds.slice().sort((left, right) => savedBuildVersionNumberFor(left) - savedBuildVersionNumberFor(right) || Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
    }))
    .sort((left, right) => Date.parse(right.builds.at(-1)?.updatedAt ?? "") - Date.parse(left.builds.at(-1)?.updatedAt ?? ""));
}

export function savedBuildVersionLabelFor(build: Pick<SavedBuild, "versionNumber">) {
  return `v${savedBuildVersionNumberFor(build)}`;
}

export type SavedBuildVersionAuditStatus = "healthy" | "needs_migration" | "invalid";

export interface SavedBuildVersionAuditGroup {
  versionGroupId: string;
  buildCount: number;
  minVersion: number;
  maxVersion: number;
  latestBuildId: string;
  latestUpdatedAt: string;
}

export interface SavedBuildVersionAuditGap {
  versionGroupId: string;
  missingVersions: number[];
}

export interface SavedBuildVersionAudit {
  status: SavedBuildVersionAuditStatus;
  totalBuilds: number;
  legacyCount: number;
  versionedCount: number;
  groupCount: number;
  multiVersionGroupCount: number;
  maxVersion: number;
  duplicateVersionKeys: string[];
  orphanParentIds: string[];
  crossGroupParentIds: string[];
  versionGapGroups: SavedBuildVersionAuditGap[];
  groups: SavedBuildVersionAuditGroup[];
}

function explicitVersionMetadataFor(build: SavedBuild) {
  return typeof build.versionGroupId === "string" && build.versionGroupId.trim().length > 0
    && Number.isInteger(build.versionNumber) && (build.versionNumber ?? 0) >= 1;
}

export function savedBuildVersionAuditFor(builds: SavedBuild[]): SavedBuildVersionAudit {
  const groups = new Map<string, SavedBuild[]>();
  const versions = new Map<string, string[]>();
  const orphanParentIds = new Set<string>();
  const crossGroupParentIds = new Set<string>();
  let legacyCount = 0;
  for (const build of builds) {
    if (explicitVersionMetadataFor(build)) {
      const key = `${build.versionGroupId}:${build.versionNumber}`;
      versions.set(key, [...(versions.get(key) ?? []), build.id]);
    } else {
      legacyCount += 1;
    }
    const groupId = savedBuildVersionGroupIdFor(build);
    groups.set(groupId, [...(groups.get(groupId) ?? []), build]);
    if (build.derivedFromBuildId) {
      const parent = builds.find((candidate) => candidate.id === build.derivedFromBuildId);
      if (!parent) orphanParentIds.add(build.derivedFromBuildId);
      else if (savedBuildVersionGroupIdFor(parent) !== groupId) crossGroupParentIds.add(build.id);
    }
  }
  const duplicateVersionKeys = [...versions.entries()].filter(([, idsForVersion]) => idsForVersion.length > 1).map(([key]) => key).sort();
  const versionGapGroups = [...groups.entries()].map(([versionGroupId, groupBuilds]) => {
    const explicitVersions = groupBuilds.filter(explicitVersionMetadataFor).map((build) => build.versionNumber!);
    if (explicitVersions.length === 0) return undefined;
    const maxVersion = Math.max(...explicitVersions);
    const presentVersions = new Set(explicitVersions);
    const missingVersions = Array.from({ length: maxVersion }, (_value, index) => index + 1).filter((version) => !presentVersions.has(version));
    return missingVersions.length > 0 ? { versionGroupId, missingVersions } : undefined;
  }).filter((gap): gap is SavedBuildVersionAuditGap => gap !== undefined).sort((left, right) => left.versionGroupId.localeCompare(right.versionGroupId));
  const groupSummaries = [...groups.entries()].map(([versionGroupId, groupBuilds]) => {
    const sorted = groupBuilds.slice().sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt) || left.id.localeCompare(right.id));
    const versionsForGroup = groupBuilds.map(savedBuildVersionNumberFor);
    const latest = sorted.at(-1)!;
    return {
      versionGroupId,
      buildCount: groupBuilds.length,
      minVersion: Math.min(...versionsForGroup),
      maxVersion: Math.max(...versionsForGroup),
      latestBuildId: latest.id,
      latestUpdatedAt: latest.updatedAt
    } satisfies SavedBuildVersionAuditGroup;
  }).sort((left, right) => Date.parse(right.latestUpdatedAt) - Date.parse(left.latestUpdatedAt) || right.maxVersion - left.maxVersion || left.versionGroupId.localeCompare(right.versionGroupId));
  const invalid = duplicateVersionKeys.length > 0 || orphanParentIds.size > 0 || crossGroupParentIds.size > 0;
  return {
    status: invalid ? "invalid" : legacyCount > 0 ? "needs_migration" : "healthy",
    totalBuilds: builds.length,
    legacyCount,
    versionedCount: builds.length - legacyCount,
    groupCount: groupSummaries.length,
    multiVersionGroupCount: groupSummaries.filter((group) => group.buildCount > 1).length,
    maxVersion: groupSummaries.reduce((max, group) => Math.max(max, group.maxVersion), 0),
    duplicateVersionKeys,
    orphanParentIds: [...orphanParentIds].sort(),
    crossGroupParentIds: [...crossGroupParentIds].sort(),
    versionGapGroups,
    groups: groupSummaries
  };
}

export type SavedBuildVersionMigrationPreviewStatus = "ready" | "blocked";

export interface SavedBuildVersionMigrationPreviewItem {
  buildId: string;
  name: string;
  kind: "legacy" | "versioned";
  current: {
    versionGroupId?: string;
    versionNumber?: number;
  };
  proposed: {
    versionGroupId: string;
    versionNumber: number;
  };
  derivedFromBuildId?: string;
}

export interface SavedBuildVersionMigrationPreview {
  status: SavedBuildVersionMigrationPreviewStatus;
  totalBuilds: number;
  legacyCount: number;
  changedCount: number;
  blockers: string[];
  items: SavedBuildVersionMigrationPreviewItem[];
  snapshotFingerprint?: string;
}

export const SAVED_BUILD_VERSION_MIGRATION_CONFIRMATION = "APPLY_SAVED_BUILD_VERSION_MIGRATION";
export const SAVED_BUILD_VERSION_ROLLBACK_CONFIRMATION = "ROLLBACK_SAVED_BUILD_VERSION_MIGRATION";

export interface SavedBuildVersionMigrationMutationResult {
  status: "applied" | "noop";
  backupId?: string;
  totalBuilds: number;
  changedCount: number;
  sourceFingerprint: string;
  resultingFingerprint: string;
}

export interface SavedBuildVersionMigrationRollbackResult {
  status: "rolled_back";
  backupId: string;
  totalBuilds: number;
  changedCount: number;
  sourceFingerprint: string;
  resultingFingerprint: string;
}

export interface SavedBuildVersionBackupSummary {
  backupId: string;
  createdAt: string;
  totalBuilds: number;
  changedCount: number;
  sourceFingerprint: string;
  resultingFingerprint: string;
  rollbackAvailable: boolean;
}

export type SavedBuildVersionMetadataField = "versionGroupId" | "versionNumber" | "derivedFromBuildId";

export interface SavedBuildVersionBackupDiffItem {
  buildId: string;
  name: string;
  changedFields: SavedBuildVersionMetadataField[];
  before: {
    versionGroupId?: string;
    versionNumber?: number;
    derivedFromBuildId?: string;
  };
  after: {
    versionGroupId?: string;
    versionNumber?: number;
    derivedFromBuildId?: string;
  };
}

export interface SavedBuildVersionBackupDetail extends SavedBuildVersionBackupSummary {
  currentFingerprint: string;
  items: SavedBuildVersionBackupDiffItem[];
}

type ProposedVersion = {
  versionGroupId: string;
  versionNumber: number;
};

function buildTimestampFor(build: Pick<SavedBuild, "createdAt" | "updatedAt">) {
  const createdAt = Date.parse(build.createdAt);
  if (Number.isFinite(createdAt)) return createdAt;
  const updatedAt = Date.parse(build.updatedAt);
  return Number.isFinite(updatedAt) ? updatedAt : Number.MAX_SAFE_INTEGER;
}

function nextAvailableVersion(used: Set<number>, start: number) {
  let next = Math.max(1, start);
  while (used.has(next)) next += 1;
  return next;
}

export function savedBuildVersionMigrationPreviewFor(builds: SavedBuild[]): SavedBuildVersionMigrationPreview {
  const audit = savedBuildVersionAuditFor(builds);
  const byId = new Map(builds.map((build) => [build.id, build]));
  const proposedById = new Map<string, ProposedVersion>();
  const usedVersionsByGroup = new Map<string, Set<number>>();
  const blockers = new Set<string>();

  for (const build of builds) {
    if (!explicitVersionMetadataFor(build)) continue;
    const versionGroupId = build.versionGroupId!;
    const versionNumber = build.versionNumber!;
    proposedById.set(build.id, { versionGroupId, versionNumber });
    usedVersionsByGroup.set(versionGroupId, new Set([...(usedVersionsByGroup.get(versionGroupId) ?? []), versionNumber]));
  }

  function resolveLegacy(build: SavedBuild, visiting = new Set<string>()): ProposedVersion {
    const existing = proposedById.get(build.id);
    if (existing) return existing;
    if (visiting.has(build.id)) {
      blockers.add(`순환 부모 연결: ${build.id}`);
      const cycleFallback = { versionGroupId: build.id, versionNumber: 1 } satisfies ProposedVersion;
      proposedById.set(build.id, cycleFallback);
      return cycleFallback;
    }
    const nextVisiting = new Set(visiting);
    nextVisiting.add(build.id);
    const parent = build.derivedFromBuildId ? byId.get(build.derivedFromBuildId) : undefined;
    const parentPlan = parent ? resolveLegacy(parent, nextVisiting) : undefined;
    const versionGroupId = parentPlan?.versionGroupId ?? build.id;
    const used = usedVersionsByGroup.get(versionGroupId) ?? new Set<number>();
    const maxUsedVersion = Math.max(0, ...used);
    const requestedVersion = parentPlan ? Math.max(parentPlan.versionNumber + 1, maxUsedVersion + 1) : 1;
    const versionNumber = nextAvailableVersion(used, requestedVersion);
    if (!parentPlan && used.size > 0) blockers.add(`legacy 견적 그룹 ID 충돌: ${build.id}`);
    const plan = { versionGroupId, versionNumber } satisfies ProposedVersion;
    proposedById.set(build.id, plan);
    usedVersionsByGroup.set(versionGroupId, new Set([...used, versionNumber]));
    return plan;
  }

  for (const build of builds.slice().sort((left, right) => buildTimestampFor(left) - buildTimestampFor(right) || left.id.localeCompare(right.id))) {
    if (!explicitVersionMetadataFor(build)) resolveLegacy(build);
  }

  for (const duplicate of audit.duplicateVersionKeys) blockers.add(`중복 버전 키: ${duplicate}`);
  for (const orphan of audit.orphanParentIds) blockers.add(`존재하지 않는 부모 견적: ${orphan}`);
  for (const crossGroup of audit.crossGroupParentIds) {
    const build = byId.get(crossGroup);
    if (build && !explicitVersionMetadataFor(build)) continue;
    blockers.add(`다른 버전 그룹의 부모 연결: ${crossGroup}`);
  }

  const items = builds.map((build) => {
    const explicit = explicitVersionMetadataFor(build);
    const proposed = proposedById.get(build.id) ?? { versionGroupId: build.id, versionNumber: 1 };
    return {
      buildId: build.id,
      name: build.name,
      kind: explicit ? "versioned" : "legacy",
      current: explicit ? { versionGroupId: build.versionGroupId!, versionNumber: build.versionNumber! } : {},
      proposed,
      ...(build.derivedFromBuildId ? { derivedFromBuildId: build.derivedFromBuildId } : {})
    } satisfies SavedBuildVersionMigrationPreviewItem;
  });
  return {
    status: blockers.size > 0 ? "blocked" : "ready",
    totalBuilds: builds.length,
    legacyCount: audit.legacyCount,
    changedCount: items.filter((item) => item.kind === "legacy").length,
    blockers: [...blockers].sort(),
    items
  };
}

export function savedBuildVersionMigratedBuildsFor<T extends SavedBuild>(builds: T[]): T[] | undefined {
  const preview = savedBuildVersionMigrationPreviewFor(builds);
  if (preview.status !== "ready") return undefined;
  const proposedById = new Map(preview.items.map((item) => [item.buildId, item.proposed]));
  return builds.map((build) => {
    const proposed = proposedById.get(build.id);
    return proposed ? { ...build, versionGroupId: proposed.versionGroupId, versionNumber: proposed.versionNumber } : build;
  });
}

function savedBuildVersionMetadataSnapshotFor(build: Pick<SavedBuild, "versionGroupId" | "versionNumber" | "derivedFromBuildId">) {
  return {
    ...(build.versionGroupId !== undefined ? { versionGroupId: build.versionGroupId } : {}),
    ...(build.versionNumber !== undefined ? { versionNumber: build.versionNumber } : {}),
    ...(build.derivedFromBuildId !== undefined ? { derivedFromBuildId: build.derivedFromBuildId } : {})
  };
}

export function savedBuildVersionMetadataDiffFor(before: SavedBuild, after: SavedBuild): SavedBuildVersionBackupDiffItem | undefined {
  const changedFields: SavedBuildVersionMetadataField[] = [];
  if (before.versionGroupId !== after.versionGroupId) changedFields.push("versionGroupId");
  if (before.versionNumber !== after.versionNumber) changedFields.push("versionNumber");
  if (before.derivedFromBuildId !== after.derivedFromBuildId) changedFields.push("derivedFromBuildId");
  if (changedFields.length === 0) return undefined;
  return { buildId: before.id, name: before.name, changedFields, before: savedBuildVersionMetadataSnapshotFor(before), after: savedBuildVersionMetadataSnapshotFor(after) };
}

export function savedBuildVersionBackupDiffFor(builds: SavedBuild[]): SavedBuildVersionBackupDiffItem[] {
  const migrated = savedBuildVersionMigratedBuildsFor(builds);
  if (!migrated) return [];
  return builds.map((before, index) => {
    const after = migrated[index];
    return after ? savedBuildVersionMetadataDiffFor(before, after) : undefined;
  }).filter((item): item is SavedBuildVersionBackupDiffItem => item !== undefined);
}
