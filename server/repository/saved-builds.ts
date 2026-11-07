import { type SavedBuildRecord } from "../build-share";
import { createHash, randomUUID } from "node:crypto";
import { type SavedBuildMonitorSubscription, savedBuildMonitorSubscriptionFromUnknown } from "../../shared/saved-build-monitor-subscription";
import { type SavedBuildPurchaseProgress, type SavedBuildPurchasePriceHistory, type SavedBuildCheckSnapshot, type SavedBuildPurchasePriceHistorySnapshot } from "../../shared/types";
import { savedBuildCheckSnapshotFromUnknown, savedBuildCheckHistoryFromUnknown, SAVED_BUILD_CHECK_HISTORY_LIMIT, appendSavedBuildCheckHistory } from "../../shared/saved-build-check";
import { savedBuildPurchaseProgressFromUnknown, savedBuildPurchaseProgressRevisionMatchesFor, savedBuildPurchaseProgressWithNextRevisionFor, savedBuildPurchaseProgressHistoryTargetFor } from "../purchase-progress";
import { savedBuildPurchasePriceHistoryFromUnknown, savedBuildPurchasePriceHistoryRevisionMatchesFor, savedBuildPurchasePriceHistoryWithNextRevisionFor, savedBuildPurchasePriceHistoryHistoryTargetFor } from "../purchase-price-history";
import { savedBuildDecisionNoteFromUnknown, savedBuildMetadataHistoryFromUnknown, savedBuildMetadataHistoryWithNextEntryFor, savedBuildMetadataHistoryEntryFor } from "../../shared/saved-build-decision-note";
import { savedBuildOriginFromUnknown } from "../../shared/saved-build-origin";
import { ensureDatabase, pool, markDatabaseUnavailable } from "./database";
import { savedBuildVersionGroupIdFor, type SavedBuildVersionMigrationMutationResult, type SavedBuildVersionMigrationPreview, type SavedBuildVersionMigrationRollbackResult, type SavedBuildVersionBackupSummary, type SavedBuildVersionBackupDetail, savedBuildVersionBackupDiffFor, savedBuildVersionMigrationPreviewFor, savedBuildVersionMigratedBuildsFor } from "../../shared/saved-build-version";
import { type PoolClient } from "pg";
import { type AssemblyVerificationSavedSnapshot } from "../../shared/assembly-verification";

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function savedBuildVersionSnapshotFingerprintFor(builds: SavedBuildRecord[]) {
  return createHash("sha256").update(canonicalJson(builds)).digest("hex");
}

const SAVED_BUILD_DATABASE_COLUMNS = "id, name, selection, recommendation_preferences, created_at, updated_at, expires_at, owner_token_hash, recovery_code_hash, my_pc_at, version_group_id, version_number, derived_from_build_id, check_snapshot, check_history, monitor_state, purchase_progress, purchase_price_history, decision_note, origin, metadata_history";

type SavedBuildDatabaseRow = {
  id: string;
  name: string;
  selection: SavedBuildRecord["selection"];
  recommendation_preferences: SavedBuildRecord["recommendationPreferences"] | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  owner_token_hash: string | null;
  recovery_code_hash: string | null;
  my_pc_at: Date | null;
  version_group_id: string | null;
  version_number: number | null;
  derived_from_build_id: string | null;
  check_snapshot: SavedBuildRecord["checkSnapshot"] | null;
  check_history: SavedBuildRecord["checkHistory"] | null;
  monitor_state: SavedBuildMonitorSubscription | null;
  purchase_progress: SavedBuildPurchaseProgress | null;
  purchase_price_history: SavedBuildPurchasePriceHistory | null;
  decision_note: string | null;
  origin: SavedBuildRecord["origin"] | null;
  metadata_history: unknown | null;
};

export function savedBuildRecordFromUnknown(value: unknown): SavedBuildRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<SavedBuildRecord>;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || !candidate.selection || typeof candidate.selection !== "object" || typeof candidate.createdAt !== "string" || typeof candidate.updatedAt !== "string") return undefined;
  const ownerTokenHash = typeof candidate.ownerTokenHash === "string" && /^[0-9a-f]{64}$/.test(candidate.ownerTokenHash) ? candidate.ownerTokenHash : undefined;
  const recoveryCodeHash = typeof candidate.recoveryCodeHash === "string" && /^[0-9a-f]{64}$/.test(candidate.recoveryCodeHash) ? candidate.recoveryCodeHash : undefined;
  const myPcAt = typeof candidate.myPcAt === "string" && Number.isFinite(Date.parse(candidate.myPcAt)) ? candidate.myPcAt : undefined;
  const explicitSnapshot = savedBuildCheckSnapshotFromUnknown(candidate.checkSnapshot);
  const parsedHistory = savedBuildCheckHistoryFromUnknown(candidate.checkHistory);
  if (candidate.checkHistory !== undefined && !parsedHistory) return undefined;
  const normalizedHistory = parsedHistory ?? [];
  const checkHistory = explicitSnapshot && (normalizedHistory.length === 0 || normalizedHistory[normalizedHistory.length - 1].checkedAt !== explicitSnapshot.checkedAt)
    ? [...normalizedHistory, explicitSnapshot].slice(-SAVED_BUILD_CHECK_HISTORY_LIMIT)
    : normalizedHistory;
  const checkSnapshot = explicitSnapshot ?? checkHistory[checkHistory.length - 1];
  const monitorState = savedBuildMonitorSubscriptionFromUnknown(candidate.monitorState);
  const purchaseProgress = savedBuildPurchaseProgressFromUnknown(candidate.purchaseProgress);
  const purchasePriceHistory = savedBuildPurchasePriceHistoryFromUnknown(candidate.purchasePriceHistory);
  const decisionNote = savedBuildDecisionNoteFromUnknown(candidate.decisionNote);
  const origin = savedBuildOriginFromUnknown(candidate.origin);
  if (candidate.origin !== undefined && !origin) return undefined;
  const metadataHistory = savedBuildMetadataHistoryFromUnknown(candidate.metadataHistory);
  if (candidate.metadataHistory !== undefined && !metadataHistory) return undefined;
  const normalizedMetadataHistory = metadataHistory ?? [];
  const versionGroupId = typeof candidate.versionGroupId === "string" && candidate.versionGroupId.length > 0 && candidate.versionGroupId.length <= 120 ? candidate.versionGroupId : undefined;
  const versionNumber = Number.isInteger(candidate.versionNumber) && (candidate.versionNumber ?? 0) >= 1 && (candidate.versionNumber ?? 0) <= 1_000_000 ? candidate.versionNumber : undefined;
  const derivedFromBuildId = typeof candidate.derivedFromBuildId === "string" && candidate.derivedFromBuildId.length > 0 && candidate.derivedFromBuildId.length <= 120 ? candidate.derivedFromBuildId : undefined;
  const { ownerTokenHash: _rawOwnerTokenHash, recoveryCodeHash: _rawRecoveryCodeHash, myPcAt: _rawMyPcAt, versionGroupId: _rawVersionGroupId, versionNumber: _rawVersionNumber, derivedFromBuildId: _rawDerivedFromBuildId, checkSnapshot: _rawCheckSnapshot, checkHistory: _rawCheckHistory, monitorState: _rawMonitorState, purchaseProgress: _rawPurchaseProgress, purchasePriceHistory: _rawPurchasePriceHistory, decisionNote: _rawDecisionNote, origin: _rawOrigin, metadataHistory: _rawMetadataHistory, ...build } = candidate as SavedBuildRecord;
  return { ...build, ...(decisionNote ? { decisionNote } : {}), ...(origin ? { origin } : {}), ...(normalizedMetadataHistory.length > 0 ? { metadataHistory: normalizedMetadataHistory } : {}), ...(ownerTokenHash ? { ownerTokenHash } : {}), ...(recoveryCodeHash ? { recoveryCodeHash } : {}), ...(myPcAt ? { myPcAt } : {}), ...(versionGroupId ? { versionGroupId } : {}), ...(versionNumber ? { versionNumber } : {}), ...(derivedFromBuildId ? { derivedFromBuildId } : {}), ...(checkSnapshot ? { checkSnapshot } : {}), ...(checkHistory.length > 0 ? { checkHistory } : {}), ...(monitorState ? { monitorState } : {}), ...(purchaseProgress ? { purchaseProgress } : {}), ...(purchasePriceHistory ? { purchasePriceHistory } : {}) };
}

function savedBuildRecordFromDatabaseRow(row: SavedBuildDatabaseRow) {
  return savedBuildRecordFromUnknown({
    id: row.id,
    name: row.name,
    selection: row.selection,
    recommendationPreferences: row.recommendation_preferences ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {}),
    ...(row.recovery_code_hash ? { recoveryCodeHash: row.recovery_code_hash } : {}),
    ...(row.my_pc_at ? { myPcAt: new Date(row.my_pc_at).toISOString() } : {}),
    ...(row.version_group_id ? { versionGroupId: row.version_group_id } : {}),
    ...(row.version_number ? { versionNumber: row.version_number } : {}),
    ...(row.derived_from_build_id ? { derivedFromBuildId: row.derived_from_build_id } : {}),
    ...(row.check_snapshot ? { checkSnapshot: row.check_snapshot } : {}),
    ...(row.check_history ? { checkHistory: row.check_history } : {}),
    ...(row.monitor_state ? { monitorState: row.monitor_state } : {}),
    ...(row.purchase_progress ? { purchaseProgress: row.purchase_progress } : {}),
    ...(row.purchase_price_history ? { purchasePriceHistory: row.purchase_price_history } : {}),
    ...(row.decision_note ? { decisionNote: row.decision_note } : {}),
    ...(row.origin ? { origin: row.origin } : {}),
    ...(row.metadata_history ? { metadataHistory: row.metadata_history } : {})
  });
}

function requiredSavedBuildRecordFromDatabaseRow(row: SavedBuildDatabaseRow | undefined) {
  const build = row ? savedBuildRecordFromDatabaseRow(row) : undefined;
  if (!build) throw new Error("저장 견적 변경 결과를 안전하게 해석할 수 없습니다.");
  return build;
}

export async function readSavedBuilds(): Promise<SavedBuildRecord[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedBuildDatabaseRow>(
      `SELECT ${SAVED_BUILD_DATABASE_COLUMNS} FROM saved_builds ORDER BY updated_at DESC`
    );
    return savedBuildRecordsFromUnknownArray(result.rows.map(savedBuildRecordFromDatabaseRow));
  } catch (error) {
    markDatabaseUnavailable("build read", error);
    throw error;
  }
}

function savedBuildRecordsFromUnknownArray(value: unknown): SavedBuildRecord[] {
  if (!Array.isArray(value)) throw new Error("저장 견적 데이터가 배열 형식이 아니므로 원본을 보존했습니다.");
  const builds = value.map(savedBuildRecordFromUnknown);
  if (builds.some((build) => build === undefined)) throw new Error("저장 견적 데이터 일부를 안전하게 해석할 수 없어 원본을 보존했습니다.");
  return builds.filter((build): build is SavedBuildRecord => build !== undefined);
}

export async function writeSavedBuilds(builds: SavedBuildRecord[]) {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    if (builds.length === 0) {
      await client.query("DELETE FROM saved_builds");
    } else {
      await client.query("DELETE FROM saved_builds WHERE NOT (id = ANY($1::text[]))", [builds.map((build) => build.id)]);
    }
    for (const build of builds) {
      await client.query(
        `INSERT INTO saved_builds (id, name, decision_note, origin, selection, recommendation_preferences, created_at, updated_at, expires_at, owner_token_hash, recovery_code_hash, my_pc_at, version_group_id, version_number, derived_from_build_id, check_snapshot, check_history, monitor_state, purchase_progress, purchase_price_history, metadata_history)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::timestamptz, $8::timestamptz, $9::timestamptz, $10, $11, $12::timestamptz, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb, $21::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           decision_note = EXCLUDED.decision_note,
           origin = EXCLUDED.origin,
           selection = EXCLUDED.selection,
           recommendation_preferences = EXCLUDED.recommendation_preferences,
           updated_at = EXCLUDED.updated_at,
           expires_at = EXCLUDED.expires_at,
           owner_token_hash = EXCLUDED.owner_token_hash,
           my_pc_at = EXCLUDED.my_pc_at,
           recovery_code_hash = EXCLUDED.recovery_code_hash,
           version_group_id = EXCLUDED.version_group_id,
           version_number = EXCLUDED.version_number,
           derived_from_build_id = EXCLUDED.derived_from_build_id,
           check_snapshot = EXCLUDED.check_snapshot,
           check_history = EXCLUDED.check_history,
           monitor_state = EXCLUDED.monitor_state,
           purchase_progress = EXCLUDED.purchase_progress,
           purchase_price_history = EXCLUDED.purchase_price_history,
           metadata_history = EXCLUDED.metadata_history`,
        [build.id, build.name, build.decisionNote ?? null, build.origin ? JSON.stringify(build.origin) : null, JSON.stringify(build.selection), build.recommendationPreferences ? JSON.stringify(build.recommendationPreferences) : null, build.createdAt, build.updatedAt, build.expiresAt ?? null, build.ownerTokenHash ?? null, build.recoveryCodeHash ?? null, build.myPcAt ?? null, build.versionGroupId ?? null, build.versionNumber ?? null, build.derivedFromBuildId ?? null, build.checkSnapshot ? JSON.stringify(build.checkSnapshot) : null, build.checkHistory ? JSON.stringify(build.checkHistory) : null, build.monitorState ? JSON.stringify(build.monitorState) : null, build.purchaseProgress ? JSON.stringify(build.purchaseProgress) : null, build.purchasePriceHistory ? JSON.stringify(build.purchasePriceHistory) : null, build.metadataHistory ? JSON.stringify(build.metadataHistory) : null]
      );
    }
    await client.query("COMMIT");
    return;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("build write", error);
    throw error;
  } finally {
    client.release();
  }
}

async function appendSavedBuildToDatabase(build: SavedBuildRecord, max: number) {
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const versionGroupId = savedBuildVersionGroupIdFor(build);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`pc-supporter:saved-build-version:${versionGroupId}`]);
    const result = await client.query<{ max_version: number | string | null }>(
      "SELECT COALESCE(MAX(COALESCE(version_number, 1)), 0) AS max_version FROM saved_builds WHERE version_group_id = $1 OR (version_group_id IS NULL AND id = $1)",
      [versionGroupId]
    );
    const nextVersion = Number(result.rows[0]?.max_version ?? 0) + 1;
    const next = { ...build, versionGroupId, versionNumber: nextVersion } satisfies SavedBuildRecord;
    await client.query(
      `INSERT INTO saved_builds (id, name, decision_note, origin, selection, recommendation_preferences, created_at, updated_at, expires_at, owner_token_hash, recovery_code_hash, my_pc_at, version_group_id, version_number, derived_from_build_id, check_snapshot, check_history, monitor_state, purchase_progress, purchase_price_history, metadata_history)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::timestamptz, $8::timestamptz, $9::timestamptz, $10, $11, $12::timestamptz, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb, $21::jsonb)`,
      [next.id, next.name, next.decisionNote ?? null, next.origin ? JSON.stringify(next.origin) : null, JSON.stringify(next.selection), next.recommendationPreferences ? JSON.stringify(next.recommendationPreferences) : null, next.createdAt, next.updatedAt, next.expiresAt ?? null, next.ownerTokenHash ?? null, next.recoveryCodeHash ?? null, next.myPcAt ?? null, next.versionGroupId, next.versionNumber, next.derivedFromBuildId ?? null, next.checkSnapshot ? JSON.stringify(next.checkSnapshot) : null, next.checkHistory ? JSON.stringify(next.checkHistory) : null, next.monitorState ? JSON.stringify(next.monitorState) : null, next.purchaseProgress ? JSON.stringify(next.purchaseProgress) : null, next.purchasePriceHistory ? JSON.stringify(next.purchasePriceHistory) : null, next.metadataHistory ? JSON.stringify(next.metadataHistory) : null]
    );
    const boundedMax = Math.max(1, Math.floor(max));
    const stale = await client.query<{ id: string }>("SELECT id FROM saved_builds ORDER BY updated_at DESC, id DESC OFFSET $1", [boundedMax]);
    if (stale.rows.length > 0) await client.query("DELETE FROM saved_builds WHERE id = ANY($1::text[])", [stale.rows.map((row) => row.id)]);
    await client.query("COMMIT");
    return next;
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendSavedBuild(build: SavedBuildRecord, max = 100) {
  const boundedMax = Math.max(1, Math.floor(max));
  await ensureDatabase();
  try {
    return await appendSavedBuildToDatabase(build, boundedMax);
  } catch (error: unknown) {
    markDatabaseUnavailable("versioned build write", error);
    throw error;
  }
}

export type SavedBuildMetadataUpdateResult =
  | { status: "updated"; build: SavedBuildRecord }
  | { status: "not-found" };

export async function updateSavedBuildMetadata(id: string, name: string, decisionNote?: string): Promise<SavedBuildMetadataUpdateResult> {
  const updatedAt = new Date().toISOString();
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<{ name: string; decision_note: string | null; metadata_history: unknown }>(
      "SELECT name, decision_note, metadata_history FROM saved_builds WHERE id = $1 FOR UPDATE",
      [id]
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("COMMIT");
      return { status: "not-found" };
    }
    const metadataHistory = savedBuildMetadataHistoryWithNextEntryFor(
      savedBuildMetadataHistoryFromUnknown(current.metadata_history),
      savedBuildMetadataHistoryEntryFor(
        { name: current.name, ...(current.decision_note ? { decisionNote: current.decision_note } : {}) },
        { name, ...(decisionNote ? { decisionNote } : {}) },
        updatedAt
      )
    );
    const updatedResult = await client.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET name = $2, decision_note = $3, updated_at = $4::timestamptz, metadata_history = $5::jsonb WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, name, decisionNote ?? null, updatedAt, JSON.stringify(metadataHistory)]
    );
    const updated = requiredSavedBuildRecordFromDatabaseRow(updatedResult.rows[0]);
    await client.query("COMMIT");
    return { status: "updated", build: updated };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("saved build metadata update", error);
    throw error;
  } finally {
    client.release();
  }
}

type SavedBuildVersionBackup = {
  id: string;
  createdAt: string;
  sourceFingerprint: string;
  resultingFingerprint: string;
  changedCount: number;
  builds: SavedBuildRecord[];
};

export type SavedBuildVersionMigrationOperation =
  | SavedBuildVersionMigrationMutationResult
  | { status: "conflict"; expectedFingerprint: string; actualFingerprint: string; totalBuilds: number }
  | { status: "blocked"; sourceFingerprint: string; preview: SavedBuildVersionMigrationPreview };

export type SavedBuildVersionRollbackOperation =
  | SavedBuildVersionMigrationRollbackResult
  | { status: "conflict"; backupId: string; expectedFingerprint: string; actualFingerprint: string }
  | { status: "not_found"; backupId: string };

const SAVED_BUILD_VERSION_MIGRATION_LOCK = "pc-supporter:saved-build-version-migration";
const SAVED_BUILD_VERSION_BACKUP_RETENTION = 5;

function savedBuildVersionBackupFromUnknown(value: unknown): SavedBuildVersionBackup | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<SavedBuildVersionBackup>;
  const changedCount = candidate.changedCount;
  if (typeof candidate.id !== "string" || typeof candidate.createdAt !== "string" || typeof candidate.sourceFingerprint !== "string" || typeof candidate.resultingFingerprint !== "string" || typeof changedCount !== "number" || !Number.isInteger(changedCount) || changedCount < 1 || !Array.isArray(candidate.builds)) return undefined;
  const builds = candidate.builds.map(savedBuildRecordFromUnknown).filter((build): build is SavedBuildRecord => build !== undefined);
  return builds.length === candidate.builds.length ? { id: candidate.id, createdAt: candidate.createdAt, sourceFingerprint: candidate.sourceFingerprint, resultingFingerprint: candidate.resultingFingerprint, changedCount, builds } : undefined;
}

function savedBuildVersionBackupSummaryFor(backup: SavedBuildVersionBackup, currentFingerprint: string): SavedBuildVersionBackupSummary {
  return { backupId: backup.id, createdAt: backup.createdAt, totalBuilds: backup.builds.length, changedCount: backup.changedCount, sourceFingerprint: backup.sourceFingerprint, resultingFingerprint: backup.resultingFingerprint, rollbackAvailable: currentFingerprint === backup.resultingFingerprint };
}

function savedBuildVersionBackupDetailFor(backup: SavedBuildVersionBackup, currentFingerprint: string): SavedBuildVersionBackupDetail {
  return { ...savedBuildVersionBackupSummaryFor(backup, currentFingerprint), currentFingerprint, items: savedBuildVersionBackupDiffFor(backup.builds) };
}

export async function readSavedBuildVersionBackups(): Promise<SavedBuildVersionBackupSummary[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ id: string; created_at: Date; source_fingerprint: string; resulting_fingerprint: string; changed_count: number | string; total_builds: number | string }>(
      "SELECT id, created_at, source_fingerprint, resulting_fingerprint, changed_count, jsonb_array_length(builds) AS total_builds FROM saved_build_version_backups ORDER BY created_at DESC LIMIT $1",
      [SAVED_BUILD_VERSION_BACKUP_RETENTION]
    );
    const currentFingerprint = savedBuildVersionSnapshotFingerprintFor(await readSavedBuilds());
    return result.rows.map((row) => ({ backupId: row.id, createdAt: new Date(row.created_at).toISOString(), totalBuilds: Number(row.total_builds), changedCount: Number(row.changed_count), sourceFingerprint: row.source_fingerprint, resultingFingerprint: row.resulting_fingerprint, rollbackAvailable: currentFingerprint === row.resulting_fingerprint }));
  } catch (error: unknown) {
    markDatabaseUnavailable("version backup read", error);
    throw error;
  }
}

export async function readLatestSavedBuildVersionBackup(): Promise<SavedBuildVersionBackupSummary | undefined> {
  return (await readSavedBuildVersionBackups())[0];
}

export async function readSavedBuildVersionBackupDetail(backupId: string): Promise<SavedBuildVersionBackupDetail | undefined> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ id: string; created_at: Date; source_fingerprint: string; resulting_fingerprint: string; changed_count: number | string; builds: unknown }>(
      "SELECT id, created_at, source_fingerprint, resulting_fingerprint, changed_count, builds FROM saved_build_version_backups WHERE id = $1",
      [backupId]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const backup = savedBuildVersionBackupFromUnknown({ id: row.id, createdAt: new Date(row.created_at).toISOString(), sourceFingerprint: row.source_fingerprint, resultingFingerprint: row.resulting_fingerprint, changedCount: Number(row.changed_count), builds: row.builds });
    if (!backup) return undefined;
    const currentFingerprint = savedBuildVersionSnapshotFingerprintFor(await readSavedBuilds());
    return savedBuildVersionBackupDetailFor(backup, currentFingerprint);
  } catch (error: unknown) {
    markDatabaseUnavailable("version backup detail read", error);
    throw error;
  }
}

async function readSavedBuildsWithDatabaseClient(client: PoolClient) {
  const result = await client.query<SavedBuildDatabaseRow>(
    `SELECT ${SAVED_BUILD_DATABASE_COLUMNS} FROM saved_builds ORDER BY updated_at DESC`
  );
  const builds = result.rows.map(savedBuildRecordFromDatabaseRow).filter((value): value is SavedBuildRecord => value !== undefined);
  if (builds.length !== result.rows.length) throw new Error("저장 견적 데이터 일부를 안전하게 해석할 수 없어 마이그레이션을 중단했습니다.");
  return builds;
}

async function migrateSavedBuildVersionsInDatabase(expectedFingerprint: string): Promise<SavedBuildVersionMigrationOperation> {
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [SAVED_BUILD_VERSION_MIGRATION_LOCK]);
    await client.query("LOCK TABLE saved_builds IN ACCESS EXCLUSIVE MODE");
    const builds = await readSavedBuildsWithDatabaseClient(client);
    const sourceFingerprint = savedBuildVersionSnapshotFingerprintFor(builds);
    if (sourceFingerprint !== expectedFingerprint) {
      await client.query("ROLLBACK");
      return { status: "conflict", expectedFingerprint, actualFingerprint: sourceFingerprint, totalBuilds: builds.length };
    }
    const preview = savedBuildVersionMigrationPreviewFor(builds);
    if (preview.status !== "ready") {
      await client.query("ROLLBACK");
      return { status: "blocked", sourceFingerprint, preview };
    }
    const migrated = savedBuildVersionMigratedBuildsFor(builds);
    if (!migrated || preview.changedCount === 0) {
      await client.query("COMMIT");
      return { status: "noop", totalBuilds: builds.length, changedCount: 0, sourceFingerprint, resultingFingerprint: sourceFingerprint };
    }
    const backupId = randomUUID();
    const createdAt = new Date().toISOString();
    const resultingFingerprint = savedBuildVersionSnapshotFingerprintFor(migrated);
    await client.query(
      "INSERT INTO saved_build_version_backups (id, created_at, source_fingerprint, resulting_fingerprint, changed_count, builds) VALUES ($1, $2::timestamptz, $3, $4, $5, $6::jsonb)",
      [backupId, createdAt, sourceFingerprint, resultingFingerprint, preview.changedCount, JSON.stringify(builds)]
    );
    for (const build of migrated) {
      await client.query("UPDATE saved_builds SET version_group_id = $1, version_number = $2 WHERE id = $3", [build.versionGroupId ?? null, build.versionNumber ?? null, build.id]);
    }
    await client.query("DELETE FROM saved_build_version_backups WHERE id NOT IN (SELECT id FROM saved_build_version_backups ORDER BY created_at DESC LIMIT $1)", [SAVED_BUILD_VERSION_BACKUP_RETENTION]);
    await client.query("COMMIT");
    return { status: "applied", backupId, totalBuilds: builds.length, changedCount: preview.changedCount, sourceFingerprint, resultingFingerprint };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function rollbackSavedBuildVersionsInDatabase(backupId: string, expectedFingerprint: string): Promise<SavedBuildVersionRollbackOperation> {
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [SAVED_BUILD_VERSION_MIGRATION_LOCK]);
    await client.query("LOCK TABLE saved_builds IN ACCESS EXCLUSIVE MODE");
    const backupResult = await client.query<{ id: string; source_fingerprint: string; resulting_fingerprint: string; changed_count: number; builds: unknown }>(
      "SELECT id, source_fingerprint, resulting_fingerprint, changed_count, builds FROM saved_build_version_backups WHERE id = $1",
      [backupId]
    );
    const backupRow = backupResult.rows[0];
    if (!backupRow) {
      await client.query("ROLLBACK");
      return { status: "not_found", backupId };
    }
    const builds = await readSavedBuildsWithDatabaseClient(client);
    const actualFingerprint = savedBuildVersionSnapshotFingerprintFor(builds);
    if (actualFingerprint !== expectedFingerprint || actualFingerprint !== backupRow.resulting_fingerprint) {
      await client.query("ROLLBACK");
      return { status: "conflict", backupId, expectedFingerprint, actualFingerprint };
    }
    const backupBuilds = Array.isArray(backupRow.builds) ? backupRow.builds.map(savedBuildRecordFromUnknown).filter((build): build is SavedBuildRecord => build !== undefined) : [];
    if (backupBuilds.length !== builds.length) throw new Error("백업과 현재 저장 견적 수가 달라 rollback을 중단했습니다.");
    const currentIds = new Set(builds.map((build) => build.id));
    if (backupBuilds.some((build) => !currentIds.has(build.id))) throw new Error("백업과 현재 저장 견적 ID가 달라 rollback을 중단했습니다.");
    for (const build of backupBuilds) {
      await client.query("UPDATE saved_builds SET version_group_id = $1, version_number = $2, derived_from_build_id = $3 WHERE id = $4", [build.versionGroupId ?? null, build.versionNumber ?? null, build.derivedFromBuildId ?? null, build.id]);
    }
    await client.query("COMMIT");
    return { status: "rolled_back", backupId, totalBuilds: backupBuilds.length, changedCount: backupRow.changed_count, sourceFingerprint: backupRow.source_fingerprint, resultingFingerprint: backupRow.source_fingerprint };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function migrateSavedBuildVersions(expectedFingerprint: string): Promise<SavedBuildVersionMigrationOperation> {
  await ensureDatabase();
  return migrateSavedBuildVersionsInDatabase(expectedFingerprint);
}

export async function rollbackSavedBuildVersions(backupId: string, expectedFingerprint: string): Promise<SavedBuildVersionRollbackOperation> {
  await ensureDatabase();
  return rollbackSavedBuildVersionsInDatabase(backupId, expectedFingerprint);
}

export async function appendSavedBuildCheck(id: string, snapshot: SavedBuildCheckSnapshot, max = 20) {
  const builds = await readSavedBuilds();
  const current = builds.find((build) => build.id === id);
  if (!current) return undefined;
  const existingHistory = current.checkHistory ?? (current.checkSnapshot ? [current.checkSnapshot] : []);
  const nextSnapshot = snapshot.assemblyVerification || !current.checkSnapshot?.assemblyVerification
    ? snapshot
    : {
        ...snapshot,
        assemblyVerification: current.checkSnapshot.assemblyVerification,
        ...(current.checkSnapshot.assemblyVerificationHistory ? { assemblyVerificationHistory: current.checkSnapshot.assemblyVerificationHistory } : {})
      };
  const checkHistory = appendSavedBuildCheckHistory(existingHistory, nextSnapshot, max);
  const next = { ...current, checkSnapshot: nextSnapshot, checkHistory };
  await writeSavedBuilds(builds.map((build) => build.id === id ? next : build));
  return next;
}

export async function updateSavedBuildAssemblyVerification(id: string, verification: AssemblyVerificationSavedSnapshot, verificationHistory: AssemblyVerificationSavedSnapshot[] = [verification]) {
  const builds = await readSavedBuilds();
  const current = builds.find((build) => build.id === id);
  if (!current) return undefined;
  const existingHistory = current.checkHistory ?? (current.checkSnapshot ? [current.checkSnapshot] : []);
  const currentSnapshot = current.checkSnapshot ?? existingHistory.at(-1);
  if (!currentSnapshot) return undefined;
  const nextSnapshot = { ...currentSnapshot, assemblyVerification: verification, assemblyVerificationHistory: verificationHistory };
  const checkHistory = existingHistory.length > 0
    ? existingHistory.map((snapshot, index) => index === existingHistory.length - 1 ? { ...snapshot, assemblyVerification: verification, assemblyVerificationHistory: verificationHistory } : snapshot)
    : [nextSnapshot];
  const next = { ...current, checkSnapshot: nextSnapshot, checkHistory };
  await writeSavedBuilds(builds.map((build) => build.id === id ? next : build));
  return next;
}

export type SavedBuildPurchaseProgressUpdateResult =
  | { status: "updated"; build: SavedBuildRecord; purchaseProgress: SavedBuildPurchaseProgress }
  | { status: "not-found" }
  | { status: "conflict"; currentProgress?: SavedBuildPurchaseProgress };

export type SavedBuildPurchaseProgressRestoreResult = SavedBuildPurchaseProgressUpdateResult
  | { status: "history-unavailable"; currentProgress?: SavedBuildPurchaseProgress };

export async function updateSavedBuildPurchaseProgress(id: string, purchaseProgress: SavedBuildPurchaseProgress, expectedRevision: number | null = null): Promise<SavedBuildPurchaseProgressUpdateResult> {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<{ purchase_progress: unknown }>("SELECT purchase_progress FROM saved_builds WHERE id = $1 FOR UPDATE", [id]);
    if (currentResult.rows.length === 0) {
      await client.query("COMMIT");
      return { status: "not-found" };
    }
    const currentProgress = savedBuildPurchaseProgressFromUnknown(currentResult.rows[0].purchase_progress);
    if (!savedBuildPurchaseProgressRevisionMatchesFor(currentProgress, expectedRevision)) {
      await client.query("COMMIT");
      return { status: "conflict", ...(currentProgress ? { currentProgress } : {}) };
    }
    const nextPurchaseProgress = savedBuildPurchaseProgressWithNextRevisionFor(purchaseProgress, currentProgress);
    const updatedResult = await client.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET purchase_progress = $2::jsonb WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, JSON.stringify(nextPurchaseProgress)]
    );
    const build = requiredSavedBuildRecordFromDatabaseRow(updatedResult.rows[0]);
    await client.query("COMMIT");
    return { status: "updated", build, purchaseProgress: nextPurchaseProgress };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("purchase progress update", error);
    throw error;
  } finally {
    client.release();
  }
}

export type SavedBuildPurchasePriceHistoryUpdateResult =
  | { status: "updated"; build: SavedBuildRecord; purchasePriceHistory: SavedBuildPurchasePriceHistory }
  | { status: "not-found" }
  | { status: "conflict"; currentPriceHistory?: SavedBuildPurchasePriceHistory };

export async function updateSavedBuildPurchasePriceHistory(id: string, purchasePriceHistory: SavedBuildPurchasePriceHistorySnapshot, expectedRevision: number | null = null): Promise<SavedBuildPurchasePriceHistoryUpdateResult> {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<{ purchase_price_history: unknown }>("SELECT purchase_price_history FROM saved_builds WHERE id = $1 FOR UPDATE", [id]);
    if (currentResult.rows.length === 0) {
      await client.query("COMMIT");
      return { status: "not-found" };
    }
    const currentPriceHistory = savedBuildPurchasePriceHistoryFromUnknown(currentResult.rows[0].purchase_price_history);
    if (!savedBuildPurchasePriceHistoryRevisionMatchesFor(currentPriceHistory, expectedRevision)) {
      await client.query("COMMIT");
      return { status: "conflict", ...(currentPriceHistory ? { currentPriceHistory } : {}) };
    }
    const nextPriceHistory = savedBuildPurchasePriceHistoryWithNextRevisionFor(purchasePriceHistory, currentPriceHistory);
    const updatedResult = await client.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET purchase_price_history = $2::jsonb WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, JSON.stringify(nextPriceHistory)]
    );
    const build = requiredSavedBuildRecordFromDatabaseRow(updatedResult.rows[0]);
    await client.query("COMMIT");
    return { status: "updated", build, purchasePriceHistory: nextPriceHistory };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("purchase price history update", error);
    throw error;
  } finally {
    client.release();
  }
}

export type SavedBuildPurchasePriceHistoryRestoreResult = SavedBuildPurchasePriceHistoryUpdateResult
  | { status: "history-unavailable"; currentPriceHistory?: SavedBuildPurchasePriceHistory };

export async function restoreSavedBuildPurchasePriceHistory(id: string, targetRevision: number, expectedRevision: number | null = null, expectedFingerprint?: string, expectedRowKeys: string[] = []): Promise<SavedBuildPurchasePriceHistoryRestoreResult> {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<{ purchase_price_history: unknown }>("SELECT purchase_price_history FROM saved_builds WHERE id = $1 FOR UPDATE", [id]);
    if (currentResult.rows.length === 0) {
      await client.query("COMMIT");
      return { status: "not-found" };
    }
    const currentPriceHistory = savedBuildPurchasePriceHistoryFromUnknown(currentResult.rows[0].purchase_price_history);
    if (!savedBuildPurchasePriceHistoryRevisionMatchesFor(currentPriceHistory, expectedRevision)) {
      await client.query("COMMIT");
      return { status: "conflict", ...(currentPriceHistory ? { currentPriceHistory } : {}) };
    }
    const target = savedBuildPurchasePriceHistoryHistoryTargetFor(currentPriceHistory, targetRevision);
    const rowKeysMatch = expectedRowKeys.length === 0 || (target ? target.rowKeys.length === expectedRowKeys.length && target.rowKeys.every((key) => expectedRowKeys.includes(key)) : false);
    if (!target || (expectedFingerprint && target.inputFingerprint !== expectedFingerprint) || !rowKeysMatch) {
      await client.query("COMMIT");
      return { status: "history-unavailable", ...(currentPriceHistory ? { currentPriceHistory } : {}) };
    }
    const nextPriceHistory = savedBuildPurchasePriceHistoryWithNextRevisionFor(target, currentPriceHistory);
    const updatedResult = await client.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET purchase_price_history = $2::jsonb WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, JSON.stringify(nextPriceHistory)]
    );
    const build = requiredSavedBuildRecordFromDatabaseRow(updatedResult.rows[0]);
    await client.query("COMMIT");
    return { status: "updated", build, purchasePriceHistory: nextPriceHistory };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("purchase price history restore", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function restoreSavedBuildPurchaseProgress(id: string, targetRevision: number, expectedRevision: number | null = null, expectedFingerprint?: string, expectedRowKeys: string[] = []): Promise<SavedBuildPurchaseProgressRestoreResult> {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<{ purchase_progress: unknown }>("SELECT purchase_progress FROM saved_builds WHERE id = $1 FOR UPDATE", [id]);
    if (currentResult.rows.length === 0) {
      await client.query("COMMIT");
      return { status: "not-found" };
    }
    const currentProgress = savedBuildPurchaseProgressFromUnknown(currentResult.rows[0].purchase_progress);
    if (!savedBuildPurchaseProgressRevisionMatchesFor(currentProgress, expectedRevision)) {
      await client.query("COMMIT");
      return { status: "conflict", ...(currentProgress ? { currentProgress } : {}) };
    }
    const target = savedBuildPurchaseProgressHistoryTargetFor(currentProgress, targetRevision);
    const rowKeysMatch = expectedRowKeys.length === 0 || (target ? target.rowKeys.length === expectedRowKeys.length && target.rowKeys.every((key) => expectedRowKeys.includes(key)) : false);
    if (!target || (expectedFingerprint && target.inputFingerprint !== expectedFingerprint) || !rowKeysMatch) {
      await client.query("COMMIT");
      return { status: "history-unavailable", ...(currentProgress ? { currentProgress } : {}) };
    }
    const nextPurchaseProgress = savedBuildPurchaseProgressWithNextRevisionFor(target, currentProgress);
    const updatedResult = await client.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET purchase_progress = $2::jsonb WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, JSON.stringify(nextPurchaseProgress)]
    );
    const build = requiredSavedBuildRecordFromDatabaseRow(updatedResult.rows[0]);
    await client.query("COMMIT");
    return { status: "updated", build, purchaseProgress: nextPurchaseProgress };
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("purchase progress restore", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateSavedBuildMonitorState(id: string, monitorState: SavedBuildMonitorSubscription) {
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET monitor_state = $2::jsonb WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, JSON.stringify(monitorState)]
    );
    const row = result.rows[0];
    return row ? requiredSavedBuildRecordFromDatabaseRow(row) : undefined;
  } catch (error) {
    markDatabaseUnavailable("build monitor update", error);
    throw error;
  }
}

export async function updateSavedBuildShareCredentials(
  id: string,
  ownerTokenHash: string,
  recoveryCodeHash: string,
  expectedRecoveryCodeHash: string | undefined
): Promise<{ id: string } | undefined> {
  await ensureDatabase();
  try {
    const result = await pool!.query(
      "UPDATE saved_builds SET owner_token_hash = $2, recovery_code_hash = $3 WHERE id = $1 AND recovery_code_hash IS NOT DISTINCT FROM $4 RETURNING id",
      [id, ownerTokenHash, recoveryCodeHash, expectedRecoveryCodeHash ?? null]
    );
    return result.rows[0]?.id ? { id: result.rows[0].id as string } : undefined;
  } catch (error) {
    markDatabaseUnavailable("build credential update", error);
    throw error;
  }
}

export async function updateSavedBuildMyPc(id: string, myPcAt: string | null, monitorState?: SavedBuildMonitorSubscription) {
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedBuildDatabaseRow>(
      `UPDATE saved_builds SET my_pc_at = $2::timestamptz, monitor_state = COALESCE($3::jsonb, monitor_state) WHERE id = $1 RETURNING ${SAVED_BUILD_DATABASE_COLUMNS}`,
      [id, myPcAt, monitorState ? JSON.stringify(monitorState) : null]
    );
    const row = result.rows[0];
    return row ? requiredSavedBuildRecordFromDatabaseRow(row) : undefined;
  } catch (error) {
    markDatabaseUnavailable("build my-pc update", error);
    throw error;
  }
}

export async function deleteSavedBuild(id: string) {
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM saved_builds WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    markDatabaseUnavailable("build delete", error);
    throw error;
  }
}
