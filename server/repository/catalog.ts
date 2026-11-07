import { type Part, type PartCategory, type AccessoryItem, type AccessoryCategory, type CoolingFanLoadOverride, type M2SlotOverride, type AccessoryCoverageSnapshot, type BenchmarkOverride } from "../../shared/types";
import { ensureDatabase, pool, markDatabaseUnavailable } from "./database";
import { publishInstanceEventTransactional } from "../instance-events";
import { type PoolClient } from "pg";
import { type CatalogSpecOverride } from "../../shared/catalog-spec-overrides";

export async function readCatalogRecords(): Promise<Part[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ payload: Part }>("SELECT payload FROM catalog_parts ORDER BY updated_at DESC");
    return result.rows.map((row) => row.payload);
  } catch (error) {
    markDatabaseUnavailable("catalog read", error);
    throw error;
  }
}

// 캐시된 런타임 카탈로그가 DB와 같은지 확인하는 저비용 프로브 — 부품+스펙/M.2
// 오버라이드 테이블의 건수와 최신 updated_at을 묶은 스탬프. 전체 행을 다시
// 읽는 대신 이 스탬프만 비교하면 된다.
export async function readCatalogVersionStamp(): Promise<string> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ stamp: string }>(`
      SELECT
        (SELECT count(*) FROM catalog_parts)::text || ':' ||
        coalesce((SELECT max(updated_at) FROM catalog_parts)::text, '-') || ':' ||
        (SELECT count(*) FROM catalog_spec_overrides)::text || ':' ||
        coalesce((SELECT max(updated_at) FROM catalog_spec_overrides)::text, '-') || ':' ||
        (SELECT count(*) FROM m2_slot_overrides)::text || ':' ||
        coalesce((SELECT max(updated_at) FROM m2_slot_overrides)::text, '-') || ':' ||
        (SELECT count(*) FROM benchmark_overrides)::text || ':' ||
        coalesce((SELECT max(updated_at) FROM benchmark_overrides)::text, '-') AS stamp
    `);
    return result.rows[0]?.stamp ?? "";
  } catch (error) {
    markDatabaseUnavailable("catalog version stamp", error);
    throw error;
  }
}

// 인스턴스 간 공유되는 운영 설정 — 파일 복제본이 아닌 DB가 원본이다.
export type RuntimeConfigRecord = { key: string; payload: unknown; updatedAt: string; updatedBy: string | null };

export async function readRuntimeConfigRecord(key: string): Promise<RuntimeConfigRecord | null> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ config_key: string; payload: unknown; updated_at: Date | string; updated_by: string | null }>(
      "SELECT config_key, payload, updated_at, updated_by FROM runtime_configs WHERE config_key = $1",
      [key]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { key: row.config_key, payload: row.payload, updatedAt: typeof row.updated_at === "string" ? row.updated_at : row.updated_at.toISOString(), updatedBy: row.updated_by };
  } catch (error) {
    markDatabaseUnavailable("runtime config read", error);
    throw error;
  }
}

export async function writeRuntimeConfigRecord(key: string, payload: unknown, updatedBy?: string): Promise<RuntimeConfigRecord> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ config_key: string; payload: unknown; updated_at: Date | string; updated_by: string | null }>(
      `INSERT INTO runtime_configs (config_key, payload, updated_at, updated_by)
       VALUES ($1, $2::jsonb, statement_timestamp(), $3)
       ON CONFLICT (config_key) DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = statement_timestamp(),
         updated_by = EXCLUDED.updated_by
       RETURNING config_key, payload, updated_at, updated_by`,
      [key, JSON.stringify(payload), updatedBy ?? null]
    );
    const row = result.rows[0];
    return { key: row.config_key, payload: row.payload, updatedAt: typeof row.updated_at === "string" ? row.updated_at : row.updated_at.toISOString(), updatedBy: row.updated_by };
  } catch (error) {
    markDatabaseUnavailable("runtime config write", error);
    throw error;
  }
}

export async function listRuntimeConfigRecords(): Promise<RuntimeConfigRecord[]> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ config_key: string; payload: unknown; updated_at: Date | string; updated_by: string | null }>(
      "SELECT config_key, payload, updated_at, updated_by FROM runtime_configs ORDER BY config_key"
    );
    return result.rows.map((row) => ({ key: row.config_key, payload: row.payload, updatedAt: typeof row.updated_at === "string" ? row.updated_at : row.updated_at.toISOString(), updatedBy: row.updated_by }));
  } catch (error) {
    markDatabaseUnavailable("runtime config list", error);
    throw error;
  }
}

export async function readAccessoryVersionStamp(): Promise<string> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ stamp: string }>(`
      SELECT
        (SELECT count(*) FROM catalog_accessories)::text || ':' ||
        coalesce((SELECT max(updated_at) FROM catalog_accessories)::text, '-') || ':' ||
        (SELECT count(*) FROM cooling_fan_load_overrides)::text || ':' ||
        coalesce((SELECT max(updated_at) FROM cooling_fan_load_overrides)::text, '-') AS stamp
    `);
    return result.rows[0]?.stamp ?? "";
  } catch (error) {
    markDatabaseUnavailable("accessory version stamp", error);
    throw error;
  }
}

export async function writeCatalogRecords(
  parts: Part[],
  options: { replaceDanawaCategories?: PartCategory[]; removeIds?: string[] } = {}
) {
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    const replaceCategories = [...new Set(options.replaceDanawaCategories ?? [])];
    if (replaceCategories.length > 0) {
      await client.query(
        "DELETE FROM catalog_parts WHERE source = 'danawa' AND category = ANY($1::text[])",
        [replaceCategories]
      );
    }
    const removeIds = [...new Set(options.removeIds ?? [])];
    if (removeIds.length > 0) {
      await client.query(
        "DELETE FROM catalog_parts WHERE id = ANY($1::text[])",
        [removeIds]
      );
    }
    for (const part of parts) {
      await client.query(
        `INSERT INTO catalog_parts (id, category, source, source_product_code, data_quality, payload, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           category = EXCLUDED.category,
           source = EXCLUDED.source,
           source_product_code = EXCLUDED.source_product_code,
           data_quality = EXCLUDED.data_quality,
           payload = EXCLUDED.payload,
           updated_at = EXCLUDED.updated_at`,
        [part.id, part.category, part.source, part.sourceProductCode ?? null, part.dataQuality, JSON.stringify(part), part.updatedAt]
      );
    }
    await publishInstanceEventTransactional(client, "cache-invalidate:catalog");
    await client.query("COMMIT");
    return;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("catalog write", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function patchCatalogPriceRecords(
  patches: import("../catalog").CatalogPricePatch[]
): Promise<Array<{ before: Part; after: Part }> | undefined> {
  await ensureDatabase();
  const client = await pool!.connect();
  const changed: Array<{ before: Part; after: Part }> = [];
  try {
    await client.query("BEGIN");
    for (const patch of patches) {
      const result = await client.query<{ before_payload: Part; after_payload: Part }>(
        `WITH current AS (
           SELECT id, payload AS before_payload FROM catalog_parts
           WHERE id = $1 AND source = 'danawa' AND source_product_code = $2 AND payload->>'danawaUrl' = $3
           FOR UPDATE
         ), updated AS (
           UPDATE catalog_parts AS catalog
           SET payload = CASE WHEN $6::text IS NOT NULL THEN
             jsonb_set(current.before_payload - 'priceWon', '{priceUnavailableAt}', to_jsonb($6::text), true)
           ELSE
             jsonb_set(
               jsonb_set(current.before_payload - 'priceUnavailableAt', '{priceWon}', to_jsonb($4::numeric), true),
               '{priceCheckedAt}', to_jsonb($5::text), true
             )
           END,
           updated_at = statement_timestamp()
           FROM current
           WHERE catalog.id = current.id
           RETURNING catalog.id, catalog.payload AS after_payload
         )
         SELECT current.before_payload, updated.after_payload FROM current JOIN updated USING (id)`,
        [patch.id, patch.sourceProductCode, patch.danawaUrl, patch.priceWon ?? null, patch.priceCheckedAt ?? null, patch.priceUnavailableAt ?? null]
      );
      if (result.rows[0]) changed.push({ before: result.rows[0].before_payload, after: result.rows[0].after_payload });
    }
    await publishInstanceEventTransactional(client, "cache-invalidate:catalog");
    await client.query("COMMIT");
    return changed;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw new Error(`PostgreSQL catalog price patch failed; kept the existing database price: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

export interface AccessoryCatalogSnapshot {
  items: AccessoryItem[];
  updatedAt: string;
}

export interface AccessoryCatalogMutation {
  items: AccessoryItem[];
  /** Optional delta to persist while `items` remains the complete post-mutation snapshot. */
  writeItems?: AccessoryItem[];
  /** Ids to delete outright — accessory rows absent from `items` are otherwise kept. */
  removeIds?: string[];
  replaceDanawaCategories?: AccessoryCategory[];
}

export interface AccessoryCatalogPricePatchResult {
  updates: Array<{ before: AccessoryItem; after: AccessoryItem }>;
  updatedAt: string;
}

function accessoryCatalogTimestamp(value: Date | string | null | undefined) {
  if (value === null || value === undefined) return "";
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : "";
}

function assertUniqueAccessoryCatalogKeys(items: AccessoryItem[]) {
  const ids = new Set<string>();
  const danawaProductCodes = new Set<string>();
  for (const item of items) {
    if (!item.id || ids.has(item.id)) throw new Error(`Accessory catalog contains a duplicate or empty id: ${item.id}`);
    ids.add(item.id);
    if (item.source === "danawa" && item.sourceProductCode) {
      if (danawaProductCodes.has(item.sourceProductCode)) throw new Error(`Accessory catalog contains duplicate Danawa product code: ${item.sourceProductCode}`);
      danawaProductCodes.add(item.sourceProductCode);
    }
  }
}

export async function readAccessoryCatalogRecords(): Promise<AccessoryCatalogSnapshot> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ payload: AccessoryItem; updated_at: Date | string }>(
      "SELECT payload, updated_at FROM catalog_accessories ORDER BY updated_at DESC, id ASC"
    );
    return {
      items: result.rows.map((row) => row.payload),
      updatedAt: accessoryCatalogTimestamp(result.rows[0]?.updated_at)
    };
  } catch (error: unknown) {
    markDatabaseUnavailable("accessory catalog read", error);
    throw error;
  }
}

/**
 * Serializes read/merge/write operations across API replicas. The callback receives
 * the authoritative PostgreSQL snapshot while holding the same transaction lock
 * used by accessory price patches.
 */
export async function mutateAccessoryCatalogRecords(
  mutation: (current: AccessoryItem[]) => AccessoryCatalogMutation
): Promise<AccessoryCatalogSnapshot> {
  await ensureDatabase();

  let client: PoolClient;
  try {
    client = await pool!.connect();
  } catch (error: unknown) {
    markDatabaseUnavailable("accessory catalog connection", error);
    throw error;
  }

  let discardClient = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:catalog-accessories', 0))");
    const currentResult = await client.query<{ payload: AccessoryItem }>(
      "SELECT payload FROM catalog_accessories ORDER BY updated_at DESC, id ASC"
    );
    const currentItems = currentResult.rows.map((row) => row.payload);
    const next = mutation(currentItems);
    assertUniqueAccessoryCatalogKeys(next.items);
    const writeItems = next.writeItems ?? next.items;
    assertUniqueAccessoryCatalogKeys(writeItems);

    const replaceDanawaCategories = [...new Set(next.replaceDanawaCategories ?? [])];
    if (replaceDanawaCategories.length > 0) {
      await client.query(
        "DELETE FROM catalog_accessories WHERE source = 'danawa' AND category = ANY($1::text[])",
        [replaceDanawaCategories]
      );
    }

    const removeIds = [...new Set(next.removeIds ?? [])];
    if (removeIds.length > 0) {
      await client.query(
        "DELETE FROM catalog_accessories WHERE id = ANY($1::text[])",
        [removeIds]
      );
    }

    const insertBatch = async (items: AccessoryItem[], conflictTarget: "id" | "danawa_product_code") => {
      const batchSize = 300;
      for (let offset = 0; offset < items.length; offset += batchSize) {
        const batch = items.slice(offset, offset + batchSize);
        const values: unknown[] = [];
        const rowsSql = batch.map((item, index) => {
          const firstParameter = index * 6 + 1;
          values.push(item.id, item.category, item.source, item.sourceProductCode ?? null, item.dataQuality, JSON.stringify(item));
          return `($${firstParameter}, $${firstParameter + 1}, $${firstParameter + 2}, $${firstParameter + 3}, $${firstParameter + 4}, $${firstParameter + 5}::jsonb, statement_timestamp())`;
        });
        const conflictSql = conflictTarget === "danawa_product_code"
          ? `ON CONFLICT (source_product_code) WHERE source = 'danawa' AND source_product_code IS NOT NULL DO UPDATE SET
               id = EXCLUDED.id,
               category = EXCLUDED.category,
               source = EXCLUDED.source,
               data_quality = EXCLUDED.data_quality,
               payload = EXCLUDED.payload,
               updated_at = statement_timestamp()`
          : `ON CONFLICT (id) DO UPDATE SET
               category = EXCLUDED.category,
               source = EXCLUDED.source,
               source_product_code = EXCLUDED.source_product_code,
               data_quality = EXCLUDED.data_quality,
               payload = EXCLUDED.payload,
               updated_at = statement_timestamp()`;
        await client.query(
          `INSERT INTO catalog_accessories (id, category, source, source_product_code, data_quality, payload, updated_at)
           VALUES ${rowsSql.join(", ")}
           ${conflictSql}`,
          values
        );
      }
    };

    await insertBatch(writeItems.filter((item) => item.source === "danawa" && Boolean(item.sourceProductCode)), "danawa_product_code");
    await insertBatch(writeItems.filter((item) => item.source !== "danawa" || !item.sourceProductCode), "id");

    const timestampResult = await client.query<{ updated_at: Date | string | null }>(
      "SELECT MAX(updated_at) AS updated_at FROM catalog_accessories"
    );
    await publishInstanceEventTransactional(client, "cache-invalidate:accessories");
    await client.query("COMMIT");
    return { items: next.items, updatedAt: accessoryCatalogTimestamp(timestampResult.rows[0]?.updated_at) };
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    markDatabaseUnavailable("accessory catalog write", error);
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function patchAccessoryCatalogPriceRecords(
  patches: Array<{ id: string; sourceProductCode: string; danawaUrl: string; priceWon: number; priceCheckedAt: string }>
): Promise<AccessoryCatalogPricePatchResult> {
  if (patches.length === 0) return { updates: [], updatedAt: "" };
  await ensureDatabase();

  let client: PoolClient;
  try {
    client = await pool!.connect();
  } catch (error: unknown) {
    markDatabaseUnavailable("accessory price patch connection", error);
    throw error;
  }

  let discardClient = false;
  const changed: Array<{ before: AccessoryItem; after: AccessoryItem }> = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:catalog-accessories', 0))");
    for (const patch of patches) {
      const result = await client.query<{ before_payload: AccessoryItem; after_payload: AccessoryItem }>(
        `WITH current AS (
           SELECT id, payload AS before_payload FROM catalog_accessories
           WHERE id = $1 AND source = 'danawa' AND source_product_code = $2 AND payload->>'danawaUrl' = $3
           FOR UPDATE
         ), updated AS (
           UPDATE catalog_accessories AS catalog
           SET payload = jsonb_set(
             jsonb_set(current.before_payload, '{priceWon}', to_jsonb($4::numeric), true),
             '{priceCheckedAt}', to_jsonb($5::text), true
           ), updated_at = statement_timestamp()
           FROM current
           WHERE catalog.id = current.id
           RETURNING catalog.id, catalog.payload AS after_payload
         )
         SELECT current.before_payload, updated.after_payload FROM current JOIN updated USING (id)`,
        [patch.id, patch.sourceProductCode, patch.danawaUrl, patch.priceWon, patch.priceCheckedAt]
      );
      if (result.rows[0]) changed.push({ before: result.rows[0].before_payload, after: result.rows[0].after_payload });
    }
    const timestampResult = await client.query<{ updated_at: Date | string | null }>("SELECT MAX(updated_at) AS updated_at FROM catalog_accessories");
    await publishInstanceEventTransactional(client, "cache-invalidate:accessories");
    await client.query("COMMIT");
    return { updates: changed, updatedAt: accessoryCatalogTimestamp(timestampResult.rows[0]?.updated_at) };
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    markDatabaseUnavailable("accessory price patch", error);
    throw new Error(`PostgreSQL accessory price patch failed; kept the existing database prices: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release(discardClient);
  }
}

export type CoolingFanLoadOverrideMapRecord = Record<string, CoolingFanLoadOverride>;
export type CoolingFanLoadOverrideSnapshotRecord = {
  overrides: CoolingFanLoadOverrideMapRecord;
  updatedAt: string;
};

function coolingFanLoadOverrideMapFromUnknown(value: unknown): CoolingFanLoadOverrideMapRecord {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PostgreSQL cooling-fan override snapshot is not an object.");
  }
  return value as CoolingFanLoadOverrideMapRecord;
}

export async function readCoolingFanLoadOverrideRecords(): Promise<CoolingFanLoadOverrideSnapshotRecord> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ payload: unknown; updated_at: Date | string | null }>(
      "SELECT payload, updated_at FROM cooling_fan_load_overrides WHERE singleton_id = 'current'"
    );
    return {
      overrides: coolingFanLoadOverrideMapFromUnknown(result.rows[0]?.payload),
      updatedAt: accessoryCatalogTimestamp(result.rows[0]?.updated_at)
    };
  } catch (error: unknown) {
    markDatabaseUnavailable("cooling-fan override read", error);
    throw error;
  }
}

/**
 * Serializes read/modify/write operations for the singleton override map across
 * API replicas. The transaction lock also protects the first insert when the
 * singleton row does not exist yet.
 */
export async function mutateCoolingFanLoadOverrideRecords(
  mutation: (current: CoolingFanLoadOverrideMapRecord) => CoolingFanLoadOverrideMapRecord
): Promise<CoolingFanLoadOverrideMapRecord> {
  await ensureDatabase();

  let client: PoolClient;
  try {
    client = await pool!.connect();
  } catch (error: unknown) {
    markDatabaseUnavailable("cooling-fan override connection", error);
    throw error;
  }

  let discardClient = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:cooling-fan-load-overrides', 0))");
    const currentResult = await client.query<{ payload: unknown }>(
      "SELECT payload FROM cooling_fan_load_overrides WHERE singleton_id = 'current' FOR UPDATE"
    );
    const next = coolingFanLoadOverrideMapFromUnknown(mutation(coolingFanLoadOverrideMapFromUnknown(currentResult.rows[0]?.payload)));
    await client.query(
      `INSERT INTO cooling_fan_load_overrides (singleton_id, payload, updated_at)
       VALUES ('current', $1::jsonb, statement_timestamp())
       ON CONFLICT (singleton_id) DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = statement_timestamp()`,
      [JSON.stringify(next)]
    );
    await publishInstanceEventTransactional(client, "cache-invalidate:accessories");
    await client.query("COMMIT");
    return next;
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    markDatabaseUnavailable("cooling-fan override write", error);
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export type CatalogSpecOverrideMapRecord = Record<string, CatalogSpecOverride>;
export type M2SlotOverrideMapRecord = Record<string, M2SlotOverride>;

type SingletonOverrideTable = "catalog_spec_overrides" | "m2_slot_overrides";
type SingletonOverrideMutation<T, V> = {
  value: V;
  overrides: Record<string, T>;
  changed: boolean;
};

function singletonOverrideMapFromUnknown<T>(value: unknown, label: string): Record<string, T> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`PostgreSQL ${label} snapshot is not an object.`);
  }
  return value as Record<string, T>;
}

async function readPostgresSingletonOverrideMap<T>(table: SingletonOverrideTable, label: string): Promise<Record<string, T>> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ payload: unknown }>(
      `SELECT payload FROM ${table} WHERE singleton_id = 'current'`
    );
    return singletonOverrideMapFromUnknown<T>(result.rows[0]?.payload, label);
  } catch (error: unknown) {
    markDatabaseUnavailable(`${label} read`, error);
    throw error;
  }
}

async function mutatePostgresSingletonOverrideMap<T, V>(
  table: SingletonOverrideTable,
  lockScope: string,
  label: string,
  mutation: (current: Record<string, T>) => SingletonOverrideMutation<T, V> | Promise<SingletonOverrideMutation<T, V>>
): Promise<V> {
  await ensureDatabase();

  let client: PoolClient;
  try {
    client = await pool!.connect();
  } catch (error: unknown) {
    markDatabaseUnavailable(`${label} connection`, error);
    throw error;
  }

  let discardClient = false;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:${lockScope}', 0))`);
    const currentResult = await client.query<{ payload: unknown }>(
      `SELECT payload FROM ${table} WHERE singleton_id = 'current' FOR UPDATE`
    );
    const current = singletonOverrideMapFromUnknown<T>(currentResult.rows[0]?.payload, label);
    const result = await mutation(current);
    if (result.changed) {
      await client.query(
        `INSERT INTO ${table} (singleton_id, payload, updated_at)
         VALUES ('current', $1::jsonb, statement_timestamp())
         ON CONFLICT (singleton_id) DO UPDATE SET
           payload = EXCLUDED.payload,
           updated_at = statement_timestamp()`,
        [JSON.stringify(result.overrides)]
      );
      await publishInstanceEventTransactional(client, "cache-invalidate:catalog");
    }
    await client.query("COMMIT");
    return result.value;
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    markDatabaseUnavailable(`${label} write`, error);
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function readCatalogSpecOverrideRecords(): Promise<CatalogSpecOverrideMapRecord> {
  return readPostgresSingletonOverrideMap<CatalogSpecOverride>("catalog_spec_overrides", "catalog-spec override");
}

export async function mutateCatalogSpecOverrideRecords<V>(
  mutation: (current: CatalogSpecOverrideMapRecord) => SingletonOverrideMutation<CatalogSpecOverride, V> | Promise<SingletonOverrideMutation<CatalogSpecOverride, V>>
): Promise<V> {
  return mutatePostgresSingletonOverrideMap("catalog_spec_overrides", "catalog-spec-overrides", "catalog-spec override", mutation);
}

export async function readM2SlotOverrideRecords(): Promise<M2SlotOverrideMapRecord> {
  return readPostgresSingletonOverrideMap<M2SlotOverride>("m2_slot_overrides", "M.2 slot override");
}

export async function mutateM2SlotOverrideRecords<V>(
  mutation: (current: M2SlotOverrideMapRecord) => SingletonOverrideMutation<M2SlotOverride, V> | Promise<SingletonOverrideMutation<M2SlotOverride, V>>
): Promise<V> {
  return mutatePostgresSingletonOverrideMap("m2_slot_overrides", "m2-slot-overrides", "M.2 slot override", mutation);
}

export type CatalogOverrideMapUpdatedAtRecord = {
  catalogSpecUpdatedAt: string;
  m2SlotUpdatedAt: string;
};

export async function readCatalogOverrideMapUpdatedAtRecords(): Promise<CatalogOverrideMapUpdatedAtRecord> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{
      catalog_spec_updated_at: Date | string | null;
      m2_slot_updated_at: Date | string | null;
    }>(
      `SELECT
         (SELECT updated_at FROM catalog_spec_overrides WHERE singleton_id = 'current') AS catalog_spec_updated_at,
         (SELECT updated_at FROM m2_slot_overrides WHERE singleton_id = 'current') AS m2_slot_updated_at`
    );
    return {
      catalogSpecUpdatedAt: accessoryCatalogTimestamp(result.rows[0]?.catalog_spec_updated_at),
      m2SlotUpdatedAt: accessoryCatalogTimestamp(result.rows[0]?.m2_slot_updated_at)
    };
  } catch (error: unknown) {
    markDatabaseUnavailable("catalog override timestamp read", error);
    throw error;
  }
}

const EMPTY_ACCESSORY_COVERAGE: AccessoryCoverageSnapshot = { updatedAt: "", categories: [] };

export async function readAccessoryCoverageRecord(): Promise<AccessoryCoverageSnapshot> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ payload: AccessoryCoverageSnapshot }>(
      "SELECT payload FROM accessory_coverage_state WHERE singleton_id = 'current'"
    );
    return result.rows[0]?.payload ?? EMPTY_ACCESSORY_COVERAGE;
  } catch (error: unknown) {
    markDatabaseUnavailable("accessory coverage read", error);
    throw error;
  }
}

export async function mutateAccessoryCoverageRecord(
  mutation: (current: AccessoryCoverageSnapshot) => AccessoryCoverageSnapshot
): Promise<AccessoryCoverageSnapshot> {
  await ensureDatabase();

  let client: PoolClient;
  try {
    client = await pool!.connect();
  } catch (error: unknown) {
    markDatabaseUnavailable("accessory coverage connection", error);
    throw error;
  }

  let discardClient = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:accessory-coverage', 0))");
    const currentResult = await client.query<{ payload: AccessoryCoverageSnapshot }>(
      "SELECT payload FROM accessory_coverage_state WHERE singleton_id = 'current' FOR UPDATE"
    );
    const next = mutation(currentResult.rows[0]?.payload ?? EMPTY_ACCESSORY_COVERAGE);
    await client.query(
      `INSERT INTO accessory_coverage_state (singleton_id, payload, updated_at)
       VALUES ('current', $1::jsonb, statement_timestamp())
       ON CONFLICT (singleton_id) DO UPDATE SET
         payload = EXCLUDED.payload,
         updated_at = statement_timestamp()`,
      [JSON.stringify(next)]
    );
    await client.query("COMMIT");
    return next;
  } catch (error: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discardClient = true;
    }
    markDatabaseUnavailable("accessory coverage write", error);
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function readBenchmarkOverrideRecords(): Promise<Record<string, BenchmarkOverride>> {
  await ensureDatabase();
  try {
    const result = await pool!.query<{ part_id: string; payload: BenchmarkOverride }>(
      "SELECT part_id, payload FROM benchmark_overrides ORDER BY updated_at DESC"
    );
    if (result.rows.length > 0) return Object.fromEntries(result.rows.map((row) => [row.part_id, row.payload]));
    return {};
  } catch (error) {
    markDatabaseUnavailable("benchmark override read", error);
    throw error;
  }
}

export async function writeBenchmarkOverrideRecords(overrides: Record<string, BenchmarkOverride>) {
  const values = Object.values(overrides);
  await ensureDatabase();
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    if (values.length === 0) {
      await client.query("DELETE FROM benchmark_overrides");
    } else {
      await client.query("DELETE FROM benchmark_overrides WHERE NOT (part_id = ANY($1::text[]))", [values.map((value) => value.partId)]);
    }
    for (const override of values) {
      await client.query(
        `INSERT INTO benchmark_overrides (part_id, payload, updated_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (part_id) DO UPDATE SET
           payload = EXCLUDED.payload,
           updated_at = EXCLUDED.updated_at`,
        [override.partId, JSON.stringify(override), override.updatedAt]
      );
    }
    await publishInstanceEventTransactional(client, "cache-invalidate:catalog");
    await client.query("COMMIT");
    return;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    markDatabaseUnavailable("benchmark override write", error);
    throw error;
  } finally {
    client.release();
  }
}
