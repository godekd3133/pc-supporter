import type { PoolClient, QueryResultRow } from "pg";
import { PART_CATEGORIES } from "../shared/types";
import { catalogSpecOverrideFieldTypeFor } from "../shared/catalog-spec-overrides";
import { physicalSourceCheckFromUnknown } from "./physical-source-check-history";

export type CatalogSpecOverrideMap = Record<string, Record<string, unknown>>;
export type M2SlotOverrideMap = Record<string, Record<string, unknown>>;

export type CatalogOverrideMaps = {
  catalogSpecOverrides: CatalogSpecOverrideMap;
  m2SlotOverrides: M2SlotOverrideMap;
};

export type CatalogOverrideImportMapStatus = "imported" | "unchanged";

export type CatalogOverrideImportResult = {
  catalogSpecOverrides: CatalogOverrideImportMapStatus;
  m2SlotOverrides: CatalogOverrideImportMapStatus;
};

const CATALOG_SPEC_OVERRIDE_KEYS = new Set([
  "partId", "category", "fields", "manufacturerModel", "sourceNote", "sourceUrl", "updatedAt", "sourceCheck"
]);
const SOURCE_CHECK_KEYS = new Set([
  "requestedUrl", "checkedAt", "status", "identityStatus", "redirectCount", "finalUrl", "httpStatus", "contentType", "detail"
]);
const M2_OVERRIDE_KEYS = new Set(["partId", "slots", "sourceNote", "sourceUrl", "updatedAt"]);
const M2_SLOT_KEYS = new Set(["slotId", "interfaces", "pcieGeneration", "connection", "sharedWith"]);
const ALLOWED_M2_INTERFACES = new Set(["NVMe", "SATA"]);
const ALLOWED_M2_CONNECTIONS = new Set(["cpu", "chipset", "unknown"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string) {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) throw new Error(`${label}에 지원하지 않는 필드가 있습니다.`);
}

function assertTimestamp(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label}.updatedAt는 유효한 날짜 문자열이어야 합니다.`);
  }
}

function assertHttpsUrl(value: unknown, label: string, required: boolean) {
  if (value === undefined && !required) return;
  if (typeof value !== "string" || value !== value.trim() || value.length === 0 || value.length > 1_000) {
    throw new Error(`${label}.sourceUrl 형식이 올바르지 않습니다.`);
  }
  try {
    if (new URL(value).protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`${label}.sourceUrl은 HTTPS 주소여야 합니다.`);
  }
}

function assertOptionalNote(value: unknown, label: string, fieldName: string, required: boolean, maximumLength: number) {
  if (value === undefined && !required) return;
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > maximumLength) {
    throw new Error(`${label}.${fieldName} 형식이 올바르지 않습니다.`);
  }
}

function assertCatalogSpecValue(category: string, field: string, value: unknown, label: string) {
  const valueType = catalogSpecOverrideFieldTypeFor(category as never, field);
  if (!valueType) throw new Error(`${label}.fields에 지원되지 않는 사양 필드가 있습니다.`);

  if (valueType === "number") {
    const allowZero = field === "hddBays";
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0) || value > 100_000
      || field === "hddBays" && !Number.isInteger(value)) {
      throw new Error(`${label}.fields의 숫자 값 형식 또는 범위가 올바르지 않습니다.`);
    }
    return;
  }
  if (valueType === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${label}.fields의 boolean 값이 올바르지 않습니다.`);
    return;
  }
  if (valueType === "string") {
    if (typeof value !== "string" || value !== value.trim() || !value || value.length > 160) {
      throw new Error(`${label}.fields의 문자열 값이 올바르지 않습니다.`);
    }
    if (field === "coolerType" && value !== "air" && value !== "liquid") throw new Error(`${label}.fields.coolerType 값은 air 또는 liquid여야 합니다.`);
    if (field === "memoryFormFactor" && value !== "DIMM" && value !== "SO-DIMM") throw new Error(`${label}.fields.memoryFormFactor 값이 올바르지 않습니다.`);
    if (field === "interface" && value !== "NVMe" && value !== "SATA") throw new Error(`${label}.fields.interface 값은 NVMe 또는 SATA여야 합니다.`);
    return;
  }

  if (!Array.isArray(value) || value.length < 1 || value.length > 16
    || value.some((item) => typeof item !== "string" || item !== item.trim() || !item || item.length > 80)
    || new Set(value).size !== value.length) {
    throw new Error(`${label}.fields 문자열 목록이 올바르지 않습니다.`);
  }
  if (field === "memoryProfiles" && value.some((item) => item !== "XMP" && item !== "EXPO")) {
    throw new Error(`${label}.fields.memoryProfiles 값은 XMP 또는 EXPO여야 합니다.`);
  }
}

export function catalogSpecOverrideMapFromUnknown(value: unknown, label = "catalog-spec-overrides.json"): CatalogSpecOverrideMap {
  if (!isRecord(value)) throw new Error(`${label} 최상위 값은 partId별 객체 map이어야 합니다.`);
  const entries = Object.entries(value);

  for (const [index, [partId, rawOverride]] of entries.entries()) {
    const itemLabel = `${label} record ${index + 1}`;
    if (!partId || !isRecord(rawOverride)) throw new Error(`${itemLabel} 객체가 올바르지 않습니다.`);
    assertOnlyKeys(rawOverride, CATALOG_SPEC_OVERRIDE_KEYS, itemLabel);
    if (rawOverride.partId !== partId || typeof rawOverride.partId !== "string") throw new Error(`${itemLabel}.partId가 map key와 일치하지 않습니다.`);
    if (typeof rawOverride.category !== "string" || !PART_CATEGORIES.includes(rawOverride.category as typeof PART_CATEGORIES[number])) {
      throw new Error(`${itemLabel}.category가 올바르지 않습니다.`);
    }
    assertOptionalNote(rawOverride.manufacturerModel, itemLabel, "manufacturerModel", true, 160);
    assertOptionalNote(rawOverride.sourceNote, itemLabel, "sourceNote", true, 500);
    assertHttpsUrl(rawOverride.sourceUrl, itemLabel, true);
    assertTimestamp(rawOverride.updatedAt, itemLabel);
    if (rawOverride.sourceCheck !== undefined) {
      if (!isRecord(rawOverride.sourceCheck)) throw new Error(`${itemLabel}.sourceCheck 객체가 올바르지 않습니다.`);
      assertOnlyKeys(rawOverride.sourceCheck, SOURCE_CHECK_KEYS, `${itemLabel}.sourceCheck`);
      if (!physicalSourceCheckFromUnknown(rawOverride.sourceCheck)) throw new Error(`${itemLabel}.sourceCheck 형식이 올바르지 않습니다.`);
    }
    if (!isRecord(rawOverride.fields)) throw new Error(`${itemLabel}.fields 객체가 필요합니다.`);
    const fields = Object.entries(rawOverride.fields);
    if (fields.length < 1 || fields.length > 8) throw new Error(`${itemLabel}.fields는 1개부터 8개까지 허용합니다.`);
    for (const [field, fieldValue] of fields) assertCatalogSpecValue(rawOverride.category, field, fieldValue, itemLabel);
  }

  return value as CatalogSpecOverrideMap;
}

function assertM2SlotOverride(partId: string, rawOverride: unknown, label: string) {
  const itemLabel = label;
  if (!partId || !isRecord(rawOverride)) throw new Error(`${itemLabel} 객체가 올바르지 않습니다.`);
  assertOnlyKeys(rawOverride, M2_OVERRIDE_KEYS, itemLabel);
  if (rawOverride.partId !== partId || typeof rawOverride.partId !== "string") throw new Error(`${itemLabel}.partId가 map key와 일치하지 않습니다.`);
  assertOptionalNote(rawOverride.sourceNote, itemLabel, "sourceNote", false, 500);
  assertHttpsUrl(rawOverride.sourceUrl, itemLabel, false);
  assertTimestamp(rawOverride.updatedAt, itemLabel);
  if (!Array.isArray(rawOverride.slots) || rawOverride.slots.length < 1 || rawOverride.slots.length > 8) {
    throw new Error(`${itemLabel}.slots는 1개부터 8개까지 허용합니다.`);
  }

  const slotIds = new Set<string>();
  for (const [index, rawSlot] of rawOverride.slots.entries()) {
    const slotLabel = `${itemLabel}.slots[${index}]`;
    if (!isRecord(rawSlot)) throw new Error(`${slotLabel} 객체가 필요합니다.`);
    assertOnlyKeys(rawSlot, M2_SLOT_KEYS, slotLabel);
    if (typeof rawSlot.slotId !== "string" || !/^M2_[1-8]$/.test(rawSlot.slotId)) throw new Error(`${slotLabel}.slotId 형식이 올바르지 않습니다.`);
    if (slotIds.has(rawSlot.slotId)) throw new Error(`${itemLabel}에 중복 슬롯이 있습니다.`);
    slotIds.add(rawSlot.slotId);
    if (rawSlot.interfaces !== undefined && (!Array.isArray(rawSlot.interfaces) || rawSlot.interfaces.length < 1 || rawSlot.interfaces.length > 2
      || rawSlot.interfaces.some((item) => typeof item !== "string" || !ALLOWED_M2_INTERFACES.has(item))
      || new Set(rawSlot.interfaces).size !== rawSlot.interfaces.length)) {
      throw new Error(`${slotLabel}.interfaces는 중복 없는 NVMe/SATA 배열이어야 합니다.`);
    }
    if (rawSlot.pcieGeneration !== undefined && (typeof rawSlot.pcieGeneration !== "number" || !Number.isFinite(rawSlot.pcieGeneration) || rawSlot.pcieGeneration < 2 || rawSlot.pcieGeneration > 6)) {
      throw new Error(`${slotLabel}.pcieGeneration은 2부터 6 사이여야 합니다.`);
    }
    if (rawSlot.connection !== undefined && (typeof rawSlot.connection !== "string" || !ALLOWED_M2_CONNECTIONS.has(rawSlot.connection))) {
      throw new Error(`${slotLabel}.connection 값이 올바르지 않습니다.`);
    }
    if (rawSlot.sharedWith !== undefined && (!Array.isArray(rawSlot.sharedWith) || rawSlot.sharedWith.length > 12
      || rawSlot.sharedWith.some((item) => typeof item !== "string" || item !== item.trim() || !item)
      || new Set(rawSlot.sharedWith).size !== rawSlot.sharedWith.length)) {
      throw new Error(`${slotLabel}.sharedWith 배열이 올바르지 않습니다.`);
    }
  }

  const orderedSlotIds = [...slotIds].sort((left, right) => Number(left.slice(3)) - Number(right.slice(3)));
  if (orderedSlotIds.some((slotId, index) => slotId !== `M2_${index + 1}`)) {
    throw new Error(`${itemLabel}.slots는 M2_1부터 빈 번호 없이 이어져야 합니다.`);
  }
}

export function m2SlotOverrideMapFromUnknown(value: unknown, label = "m2-slot-overrides.json"): M2SlotOverrideMap {
  if (!isRecord(value)) throw new Error(`${label} 최상위 값은 partId별 객체 map이어야 합니다.`);
  const entries = Object.entries(value);
  for (const [index, [partId, rawOverride]] of entries.entries()) assertM2SlotOverride(partId, rawOverride, `${label} record ${index + 1}`);
  return value as M2SlotOverrideMap;
}

export function canonicalCatalogOverrideJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalCatalogOverrideJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalCatalogOverrideJson(record[key])}`).join(",")}}`;
}

function isEmptyMap(value: Record<string, unknown>) {
  return Object.keys(value).length === 0;
}

function currentPayload(rows: Array<{ payload: unknown }>, table: string) {
  if (rows.length > 1) throw new Error(`PostgreSQL ${table}에 singleton 행이 둘 이상 있습니다.`);
  if (rows.length === 0) return undefined;
  if (!isRecord(rows[0].payload)) throw new Error(`PostgreSQL ${table} payload는 객체 map이어야 합니다.`);
  return rows[0].payload;
}

function writePlan(table: string, existing: Record<string, unknown> | undefined, incoming: Record<string, unknown>) {
  if (existing && canonicalCatalogOverrideJson(existing) === canonicalCatalogOverrideJson(incoming)) return "unchanged" as const;
  if (existing && !isEmptyMap(existing)) throw new Error(`PostgreSQL ${table}에 다른 override map이 있어 덮어쓰지 않았습니다.`);
  return isEmptyMap(incoming) ? "unchanged" as const : "imported" as const;
}

export async function importCatalogOverrideMapsWithClient(client: PoolClient, maps: CatalogOverrideMaps): Promise<CatalogOverrideImportResult> {
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:catalog-spec-overrides', 0))");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:m2-slot-overrides', 0))");

    const catalogResult = await client.query<QueryResultRow & { payload: unknown }>(
      "SELECT payload FROM catalog_spec_overrides WHERE singleton_id = 'current' FOR UPDATE"
    );
    const m2Result = await client.query<QueryResultRow & { payload: unknown }>(
      "SELECT payload FROM m2_slot_overrides WHERE singleton_id = 'current' FOR UPDATE"
    );
    const currentCatalog = currentPayload(catalogResult.rows, "catalog_spec_overrides");
    const currentM2 = currentPayload(m2Result.rows, "m2_slot_overrides");
    if (currentCatalog) catalogSpecOverrideMapFromUnknown(currentCatalog, "PostgreSQL catalog_spec_overrides");
    if (currentM2) m2SlotOverrideMapFromUnknown(currentM2, "PostgreSQL m2_slot_overrides");

    const catalogPlan = writePlan("catalog_spec_overrides", currentCatalog, maps.catalogSpecOverrides);
    const m2Plan = writePlan("m2_slot_overrides", currentM2, maps.m2SlotOverrides);
    if (catalogPlan === "imported") {
      await client.query(
        `INSERT INTO catalog_spec_overrides (singleton_id, payload, updated_at)
         VALUES ('current', $1::jsonb, statement_timestamp())
         ON CONFLICT (singleton_id) DO UPDATE SET
           payload = EXCLUDED.payload,
           updated_at = statement_timestamp()`,
        [JSON.stringify(maps.catalogSpecOverrides)]
      );
    }
    if (m2Plan === "imported") {
      await client.query(
        `INSERT INTO m2_slot_overrides (singleton_id, payload, updated_at)
         VALUES ('current', $1::jsonb, statement_timestamp())
         ON CONFLICT (singleton_id) DO UPDATE SET
           payload = EXCLUDED.payload,
           updated_at = statement_timestamp()`,
        [JSON.stringify(maps.m2SlotOverrides)]
      );
    }
    await client.query("COMMIT");
    transactionStarted = false;
    return { catalogSpecOverrides: catalogPlan, m2SlotOverrides: m2Plan };
  } catch (error: unknown) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The CLI discards the client if an import transaction fails.
      }
    }
    throw error;
  }
}
