import { type SavedBudgetLadderRecord } from "../../shared/budget-ladder-share";
import { type SavedGeneratorVariantsRecord } from "../../shared/generator-variants-share";
import { type SavedCatalogWatchlistRecord } from "../watchlist-share";
import { ensureDatabase, pool, markDatabaseUnavailable } from "./database";
import { type SavedWatchlistAlertPreferences, savedWatchlistAlertPreferencesFromUnknown } from "../watchlist-store";
import { type SavedAlternativeComparisonRecord } from "../comparison-share";
import { type SavedBuildVersionComparisonShareRecord, savedBuildVersionComparisonFromUnknown } from "../../shared/saved-build-version-share";
import { savedBudgetLadderFromUnknown } from "../budget-ladder-share";
import { savedGeneratorVariantsFromUnknown } from "../generator-variants-share";
import { type SavedWatchlistAlertState, upsertSavedWatchlistAlertStates } from "../watchlist-alert-state";

type SavedBudgetLadderDatabaseRow = {
  id: string;
  name: string;
  payload: SavedBudgetLadderRecord["payload"];
  request: SavedBudgetLadderRecord["request"] | null;
  parent_id: string | null;
  lineage_id: string | null;
  version_number: number | null;
  catalog_snapshot_at: Date;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  owner_token_hash: string | null;
};

type SavedGeneratorVariantsDatabaseRow = {
  id: string;
  name: string;
  payload: SavedGeneratorVariantsRecord["payload"];
  request: SavedGeneratorVariantsRecord["request"] | null;
  catalog_snapshot_at: Date;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  owner_token_hash: string | null;
};

export async function readSavedWatchlists(): Promise<SavedCatalogWatchlistRecord[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ id: string; name: string; entries: SavedCatalogWatchlistRecord["entries"]; near_low_threshold_percent: 5 | 10 | 20; alert_preferences: SavedWatchlistAlertPreferences | null; created_at: Date; updated_at: Date; expires_at: Date | null; owner_token_hash: string | null }>(
      "SELECT id, name, entries, near_low_threshold_percent, alert_preferences, created_at, updated_at, expires_at, owner_token_hash FROM saved_watchlists ORDER BY updated_at DESC"
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, entries: row.entries, nearLowThresholdPercent: row.near_low_threshold_percent, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), ...(row.alert_preferences ? { alertPreferences: savedWatchlistAlertPreferencesFromUnknown(row.alert_preferences) } : {}), ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}), ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {}) }));
  } catch (error) {
    markDatabaseUnavailable("watchlist read", error);
    throw error;
  }
}

export async function writeSavedWatchlists(watchlists: SavedCatalogWatchlistRecord[]) {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    if (watchlists.length === 0) {
      await client.query("DELETE FROM saved_watchlists");
    } else {
      await client.query("DELETE FROM saved_watchlists WHERE NOT (id = ANY($1::text[]))", [watchlists.map((watchlist) => watchlist.id)]);
    }
    for (const watchlist of watchlists) {
      await client.query(
        `INSERT INTO saved_watchlists (id, name, entries, near_low_threshold_percent, alert_preferences, created_at, updated_at, expires_at, owner_token_hash)
         VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           entries = EXCLUDED.entries,
           near_low_threshold_percent = EXCLUDED.near_low_threshold_percent,
           alert_preferences = EXCLUDED.alert_preferences,
           updated_at = EXCLUDED.updated_at,
           expires_at = EXCLUDED.expires_at,
           owner_token_hash = EXCLUDED.owner_token_hash`,
        [watchlist.id, watchlist.name, JSON.stringify(watchlist.entries), watchlist.nearLowThresholdPercent, watchlist.alertPreferences ? JSON.stringify(watchlist.alertPreferences) : null, watchlist.createdAt, watchlist.updatedAt, watchlist.expiresAt ?? null, watchlist.ownerTokenHash ?? null]
      );
    }
    await client.query("COMMIT");
    return;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("watchlist write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendSavedWatchlist(watchlist: SavedCatalogWatchlistRecord, max = 100) {
  const watchlists = await readSavedWatchlists();
  await writeSavedWatchlists([watchlist, ...watchlists].slice(0, max));
}

export async function updateSavedWatchlist(watchlist: SavedCatalogWatchlistRecord) {
  await ensureDatabase();
  try {
    const result = await pool!.query(
      `UPDATE saved_watchlists
       SET name = $2,
           entries = $3::jsonb,
           near_low_threshold_percent = $4,
           alert_preferences = $5::jsonb,
           updated_at = $6::timestamptz,
           expires_at = $7::timestamptz
       WHERE id = $1`,
      [watchlist.id, watchlist.name, JSON.stringify(watchlist.entries), watchlist.nearLowThresholdPercent, watchlist.alertPreferences ? JSON.stringify(watchlist.alertPreferences) : null, watchlist.updatedAt, watchlist.expiresAt ?? null]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    markDatabaseUnavailable("watchlist update", error);
    throw error;
  }
}

export async function deleteSavedWatchlist(id: string) {
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM saved_watchlists WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    markDatabaseUnavailable("watchlist delete", error);
    throw error;
  }
}

export async function readSavedComparisons(): Promise<SavedAlternativeComparisonRecord[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedAlternativeComparisonDatabaseRow>(
      "SELECT id, name, category, current_part_name, current_part_summary, current_part_price, catalog_snapshot_at, engine_version, candidates, created_at, updated_at, expires_at, owner_token_hash FROM saved_comparisons ORDER BY updated_at DESC"
    );
    return result.rows.map(savedAlternativeComparisonFromDatabaseRow);
  } catch (error) {
    markDatabaseUnavailable("comparison read", error);
    throw error;
  }
}

type SavedAlternativeComparisonDatabaseRow = {
  id: string;
  name: string;
  category: string | null;
  current_part_name: string | null;
  current_part_summary: string | null;
  current_part_price: string | null;
  catalog_snapshot_at: Date | null;
  engine_version: string | null;
  candidates: SavedAlternativeComparisonRecord["candidates"];
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  owner_token_hash: string | null;
};

export function savedAlternativeComparisonFromDatabaseRow(row: SavedAlternativeComparisonDatabaseRow): SavedAlternativeComparisonRecord {
  return {
    id: row.id,
    name: row.name,
    ...(row.category ? { category: row.category } : {}),
    ...(row.current_part_name ? { currentPartName: row.current_part_name } : {}),
    ...(row.current_part_summary ? { currentPartSummary: row.current_part_summary } : {}),
    ...(row.current_part_price ? { currentPartPrice: row.current_part_price } : {}),
    ...(row.catalog_snapshot_at ? { catalogSnapshotAt: new Date(row.catalog_snapshot_at).toISOString() } : {}),
    ...(row.engine_version ? { engineVersion: row.engine_version } : {}),
    candidates: row.candidates,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {})
  };
}

export async function writeSavedComparisons(comparisons: SavedAlternativeComparisonRecord[]) {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    if (comparisons.length === 0) {
      await client.query("DELETE FROM saved_comparisons");
    } else {
      await client.query("DELETE FROM saved_comparisons WHERE NOT (id = ANY($1::text[]))", [comparisons.map((comparison) => comparison.id)]);
    }
    for (const comparison of comparisons) {
      await client.query(
        `INSERT INTO saved_comparisons (id, name, category, current_part_name, current_part_summary, current_part_price, catalog_snapshot_at, engine_version, candidates, created_at, updated_at, expires_at, owner_token_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9::jsonb, $10::timestamptz, $11::timestamptz, $12::timestamptz, $13)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           current_part_name = EXCLUDED.current_part_name,
           current_part_summary = EXCLUDED.current_part_summary,
           current_part_price = EXCLUDED.current_part_price,
           catalog_snapshot_at = EXCLUDED.catalog_snapshot_at,
           engine_version = EXCLUDED.engine_version,
           candidates = EXCLUDED.candidates,
           updated_at = EXCLUDED.updated_at,
           expires_at = EXCLUDED.expires_at,
           owner_token_hash = EXCLUDED.owner_token_hash`,
        [comparison.id, comparison.name, comparison.category ?? null, comparison.currentPartName ?? null, comparison.currentPartSummary ?? null, comparison.currentPartPrice ?? null, comparison.catalogSnapshotAt ?? null, comparison.engineVersion ?? null, JSON.stringify(comparison.candidates), comparison.createdAt, comparison.updatedAt, comparison.expiresAt ?? null, comparison.ownerTokenHash ?? null]
      );
    }
    await client.query("COMMIT");
    return;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("comparison write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendSavedComparison(comparison: SavedAlternativeComparisonRecord, max = 100) {
  const comparisons = await readSavedComparisons();
  await writeSavedComparisons([comparison, ...comparisons].slice(0, max));
}

export async function deleteSavedComparison(id: string) {
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM saved_comparisons WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    markDatabaseUnavailable("comparison delete", error);
    throw error;
  }
}

type SavedBuildVersionComparisonDatabaseRow = {
  id: string;
  name: string;
  payload: SavedBuildVersionComparisonShareRecord["payload"];
  source_before_build_id: string;
  source_after_build_id: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  owner_token_hash: string | null;
};

function savedBuildVersionComparisonRecordFromDatabaseRow(row: SavedBuildVersionComparisonDatabaseRow) {
  return savedBuildVersionComparisonFromUnknown({
    id: row.id,
    name: row.name,
    payload: row.payload,
    sourceBeforeBuildId: row.source_before_build_id,
    sourceAfterBuildId: row.source_after_build_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {})
  });
}

export async function readSavedBuildVersionComparisons(): Promise<SavedBuildVersionComparisonShareRecord[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedBuildVersionComparisonDatabaseRow>(
      "SELECT id, name, payload, source_before_build_id, source_after_build_id, created_at, updated_at, expires_at, owner_token_hash FROM saved_version_comparisons ORDER BY updated_at DESC"
    );
    return result.rows.map(savedBuildVersionComparisonRecordFromDatabaseRow).filter((value): value is SavedBuildVersionComparisonShareRecord => value !== undefined);
  } catch (error) {
    markDatabaseUnavailable("saved version comparison read", error);
    throw error;
  }
}

export async function writeSavedBuildVersionComparisons(comparisons: SavedBuildVersionComparisonShareRecord[]) {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    if (comparisons.length === 0) {
      await client.query("DELETE FROM saved_version_comparisons");
    } else {
      await client.query("DELETE FROM saved_version_comparisons WHERE NOT (id = ANY($1::text[]))", [comparisons.map((comparison) => comparison.id)]);
    }
    for (const comparison of comparisons) {
      await client.query(
        `INSERT INTO saved_version_comparisons (id, name, payload, source_before_build_id, source_after_build_id, created_at, updated_at, expires_at, owner_token_hash)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           payload = EXCLUDED.payload,
           source_before_build_id = EXCLUDED.source_before_build_id,
           source_after_build_id = EXCLUDED.source_after_build_id,
           updated_at = EXCLUDED.updated_at,
           expires_at = EXCLUDED.expires_at,
           owner_token_hash = EXCLUDED.owner_token_hash`,
        [comparison.id, comparison.name, JSON.stringify(comparison.payload), comparison.sourceBeforeBuildId, comparison.sourceAfterBuildId, comparison.createdAt, comparison.updatedAt, comparison.expiresAt ?? null, comparison.ownerTokenHash ?? null]
      );
    }
    await client.query("COMMIT");
    return;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("saved version comparison write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendSavedBuildVersionComparison(comparison: SavedBuildVersionComparisonShareRecord, max = 100) {
  const comparisons = await readSavedBuildVersionComparisons();
  await writeSavedBuildVersionComparisons([comparison, ...comparisons].slice(0, Math.max(1, Math.floor(max))));
}

export async function deleteSavedBuildVersionComparison(id: string) {
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM saved_version_comparisons WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    markDatabaseUnavailable("saved version comparison delete", error);
    throw error;
  }
}

function savedBudgetLadderRecordFromDatabaseRow(row: SavedBudgetLadderDatabaseRow) {
  return savedBudgetLadderFromUnknown({
    id: row.id,
    name: row.name,
    payload: row.payload,
    ...(row.request ? { request: row.request } : {}),
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    ...(row.lineage_id ? { lineageId: row.lineage_id } : {}),
    ...(row.version_number ? { versionNumber: row.version_number } : {}),
    catalogSnapshotAt: new Date(row.catalog_snapshot_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {})
  });
}

export async function readSavedBudgetLadders(): Promise<SavedBudgetLadderRecord[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedBudgetLadderDatabaseRow>(
      "SELECT id, name, payload, request, parent_id, lineage_id, version_number, catalog_snapshot_at, created_at, updated_at, expires_at, owner_token_hash FROM saved_budget_ladders ORDER BY updated_at DESC"
    );
    return result.rows.map(savedBudgetLadderRecordFromDatabaseRow).filter((value): value is SavedBudgetLadderRecord => value !== undefined);
  } catch (error) {
    markDatabaseUnavailable("budget ladder read", error);
    throw error;
  }
}

export async function writeSavedBudgetLadders(ladders: SavedBudgetLadderRecord[]) {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    if (ladders.length === 0) {
      await client.query("DELETE FROM saved_budget_ladders");
    } else {
      await client.query("DELETE FROM saved_budget_ladders WHERE NOT (id = ANY($1::text[]))", [ladders.map((ladder) => ladder.id)]);
    }
    for (const ladder of ladders) {
      await client.query(
        `INSERT INTO saved_budget_ladders (id, name, payload, request, parent_id, lineage_id, version_number, catalog_snapshot_at, created_at, updated_at, expires_at, owner_token_hash)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10::timestamptz, $11::timestamptz, $12)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           payload = EXCLUDED.payload,
           request = EXCLUDED.request,
           parent_id = EXCLUDED.parent_id,
           lineage_id = EXCLUDED.lineage_id,
           version_number = EXCLUDED.version_number,
           catalog_snapshot_at = EXCLUDED.catalog_snapshot_at,
           updated_at = EXCLUDED.updated_at,
           expires_at = EXCLUDED.expires_at,
           owner_token_hash = EXCLUDED.owner_token_hash`,
        [ladder.id, ladder.name, JSON.stringify(ladder.payload), ladder.request ? JSON.stringify(ladder.request) : null, ladder.parentId ?? null, ladder.lineageId ?? ladder.id, ladder.versionNumber ?? 1, ladder.catalogSnapshotAt, ladder.createdAt, ladder.updatedAt, ladder.expiresAt ?? null, ladder.ownerTokenHash ?? null]
      );
    }
    await client.query("COMMIT");
    return;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("budget ladder write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendSavedBudgetLadder(ladder: SavedBudgetLadderRecord, max = 100) {
  const ladders = await readSavedBudgetLadders();
  await writeSavedBudgetLadders([ladder, ...ladders].slice(0, Math.max(1, Math.floor(max))));
}

export async function deleteSavedBudgetLadder(id: string) {
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM saved_budget_ladders WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    markDatabaseUnavailable("budget ladder delete", error);
    throw error;
  }
}

function savedGeneratorVariantsRecordFromDatabaseRow(row: SavedGeneratorVariantsDatabaseRow) {
  return savedGeneratorVariantsFromUnknown({
    id: row.id,
    name: row.name,
    payload: row.payload,
    ...(row.request ? { request: row.request } : {}),
    catalogSnapshotAt: new Date(row.catalog_snapshot_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
    ...(row.owner_token_hash ? { ownerTokenHash: row.owner_token_hash } : {})
  });
}

export async function readSavedGeneratorVariants(): Promise<SavedGeneratorVariantsRecord[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<SavedGeneratorVariantsDatabaseRow>(
      "SELECT id, name, payload, request, catalog_snapshot_at, created_at, updated_at, expires_at, owner_token_hash FROM saved_generator_variants ORDER BY updated_at DESC"
    );
    return result.rows.map(savedGeneratorVariantsRecordFromDatabaseRow).filter((value): value is SavedGeneratorVariantsRecord => value !== undefined);
  } catch (error) {
    markDatabaseUnavailable("generator variants read", error);
    throw error;
  }
}

export async function writeSavedGeneratorVariants(records: SavedGeneratorVariantsRecord[]) {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    if (records.length === 0) {
      await client.query("DELETE FROM saved_generator_variants");
    } else {
      await client.query("DELETE FROM saved_generator_variants WHERE NOT (id = ANY($1::text[]))", [records.map((record) => record.id)]);
    }
    for (const record of records) {
      await client.query(
        `INSERT INTO saved_generator_variants (id, name, payload, request, catalog_snapshot_at, created_at, updated_at, expires_at, owner_token_hash)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::timestamptz, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           payload = EXCLUDED.payload,
           request = EXCLUDED.request,
           catalog_snapshot_at = EXCLUDED.catalog_snapshot_at,
           updated_at = EXCLUDED.updated_at,
           expires_at = EXCLUDED.expires_at,
           owner_token_hash = EXCLUDED.owner_token_hash`,
        [record.id, record.name, JSON.stringify(record.payload), record.request ? JSON.stringify(record.request) : null, record.catalogSnapshotAt, record.createdAt, record.updatedAt, record.expiresAt ?? null, record.ownerTokenHash ?? null]
      );
    }
    await client.query("COMMIT");
    return;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("generator variants write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function appendSavedGeneratorVariants(record: SavedGeneratorVariantsRecord, max = 100) {
  const records = await readSavedGeneratorVariants();
  await writeSavedGeneratorVariants([record, ...records].slice(0, Math.max(1, Math.floor(max))));
}

export async function deleteSavedGeneratorVariants(id: string) {
  await ensureDatabase();
  try {
    const result = await pool!.query("DELETE FROM saved_generator_variants WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    markDatabaseUnavailable("generator variants delete", error);
    throw error;
  }
}

export async function readSavedWatchlistAlertStates(): Promise<SavedWatchlistAlertState[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ watchlist_id: string; alert_id: string; read_at: Date | null; dismissed_at: Date | null; updated_at: Date }>(
      "SELECT watchlist_id, alert_id, read_at, dismissed_at, updated_at FROM saved_watchlist_alert_states ORDER BY updated_at DESC"
    );
    return result.rows.map((row) => ({ watchlistId: row.watchlist_id, alertId: row.alert_id, ...(row.read_at ? { readAt: new Date(row.read_at).toISOString() } : {}), ...(row.dismissed_at ? { dismissedAt: new Date(row.dismissed_at).toISOString() } : {}), updatedAt: new Date(row.updated_at).toISOString() }));
  } catch (error) {
    markDatabaseUnavailable("watchlist alert state read", error);
    throw error;
  }
}

export async function writeSavedWatchlistAlertStates(states: SavedWatchlistAlertState[]) {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    if (states.length === 0) {
      await client.query("DELETE FROM saved_watchlist_alert_states");
    } else {
      await client.query("DELETE FROM saved_watchlist_alert_states WHERE NOT (watchlist_id || ':' || alert_id = ANY($1::text[]))", [states.map((state) => state.watchlistId + ":" + state.alertId)]);
    }
    for (const state of states) {
      await client.query(
        `INSERT INTO saved_watchlist_alert_states (watchlist_id, alert_id, read_at, dismissed_at, updated_at)
         VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5::timestamptz)
         ON CONFLICT (watchlist_id, alert_id) DO UPDATE SET
           read_at = EXCLUDED.read_at,
           dismissed_at = EXCLUDED.dismissed_at,
           updated_at = EXCLUDED.updated_at`,
        [state.watchlistId, state.alertId, state.readAt ?? null, state.dismissedAt ?? null, state.updatedAt]
      );
    }
    await client.query("COMMIT");
    return;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("watchlist alert state write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateSavedWatchlistAlertStates(watchlistId: string, alertIds: string[], patch: "read" | "dismiss", updatedAt: string) {
  const states = await readSavedWatchlistAlertStates();
  const next = upsertSavedWatchlistAlertStates(states, watchlistId, alertIds, patch, updatedAt);
  await writeSavedWatchlistAlertStates(next);
  return next.filter((state) => state.watchlistId === watchlistId);
}

export async function deleteSavedWatchlistAlertStates(watchlistId: string) {
  await ensureDatabase();
  try {
    await pool!.query("DELETE FROM saved_watchlist_alert_states WHERE watchlist_id = $1", [watchlistId]);
    return;
  } catch (error) {
    markDatabaseUnavailable("watchlist alert state delete", error);
    throw error;
  }
}
