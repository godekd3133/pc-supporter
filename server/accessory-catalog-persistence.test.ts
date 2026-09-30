import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccessoryCrawlCategoryReport, AccessoryCoverageSnapshot, AccessoryItem, CoolingFanLoadOverride } from "../shared/types";

type SyntheticAccessoryRow = {
  id: string;
  category: string;
  source: string;
  source_product_code: string | null;
  data_quality: string;
  payload: AccessoryItem;
  updated_at: Date;
};

const fakeDatabase = vi.hoisted(() => ({
  rows: [] as SyntheticAccessoryRow[],
  coverage: null as AccessoryCoverageSnapshot | null,
  coolingFanOverrides: {} as Record<string, CoolingFanLoadOverride>,
  coolingFanOverrideUpdatedAt: null as Date | string | null,
  queries: [] as Array<{ sql: string; values?: unknown[] }>,
  clock: 1_790_000_000_000,
  failAccessoryRead: false,
  failAccessoryWrite: false,
  failCoolingFanOverrideRead: false,
  failCoolingFanOverrideWrite: false
}));

function clonedRows(rows: SyntheticAccessoryRow[]) {
  return rows.map((row) => ({ ...row, payload: structuredClone(row.payload), updated_at: new Date(row.updated_at) }));
}

vi.mock("pg", () => ({
  Pool: class SyntheticPool {
    async query(sql: string, values?: unknown[]) {
      fakeDatabase.queries.push({ sql, values });
      if (sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("SELECT payload, updated_at FROM catalog_accessories")) {
        if (fakeDatabase.failAccessoryRead) throw new Error("synthetic PostgreSQL accessory read outage");
        const rows = clonedRows(fakeDatabase.rows).sort((left, right) => right.updated_at.getTime() - left.updated_at.getTime() || left.id.localeCompare(right.id));
        return { rows: rows.map(({ payload, updated_at }) => ({ payload, updated_at })), rowCount: rows.length };
      }
      if (sql.startsWith("SELECT payload FROM accessory_coverage_state WHERE singleton_id")) {
        return { rows: fakeDatabase.coverage ? [{ payload: structuredClone(fakeDatabase.coverage) }] : [], rowCount: fakeDatabase.coverage ? 1 : 0 };
      }
      if (sql.startsWith("SELECT payload, updated_at FROM cooling_fan_load_overrides WHERE singleton_id")) {
        if (fakeDatabase.failCoolingFanOverrideRead) throw new Error("synthetic PostgreSQL cooling-fan override read outage");
        const hasOverrides = Object.keys(fakeDatabase.coolingFanOverrides).length > 0;
        return { rows: hasOverrides ? [{ payload: structuredClone(fakeDatabase.coolingFanOverrides), updated_at: fakeDatabase.coolingFanOverrideUpdatedAt }] : [], rowCount: hasOverrides ? 1 : 0 };
      }
      throw new Error(`Unexpected synthetic PostgreSQL pool query: ${sql.slice(0, 140)}`);
    }

    async connect() {
      let transactionRows: SyntheticAccessoryRow[] | undefined;
      let transactionCoverage: AccessoryCoverageSnapshot | null | undefined;
      let transactionCoolingFanOverrides: Record<string, CoolingFanLoadOverride> | undefined;
      let transactionCoolingFanOverrideUpdatedAt: Date | string | null | undefined;
      const rows = () => transactionRows ?? fakeDatabase.rows;
      return {
        query: async (sql: string, values?: unknown[]) => {
          fakeDatabase.queries.push({ sql, values });
          if (sql === "BEGIN") {
            transactionRows = clonedRows(fakeDatabase.rows);
            transactionCoverage = fakeDatabase.coverage ? structuredClone(fakeDatabase.coverage) : null;
            transactionCoolingFanOverrides = structuredClone(fakeDatabase.coolingFanOverrides);
            transactionCoolingFanOverrideUpdatedAt = fakeDatabase.coolingFanOverrideUpdatedAt;
            return { rows: [], rowCount: 0 };
          }
          if (sql === "ROLLBACK" || sql.includes("pg_advisory_xact_lock") || sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) {
            return { rows: [], rowCount: 0 };
          }
          if (sql === "COMMIT") {
            if (transactionRows) fakeDatabase.rows = transactionRows;
            if (transactionCoverage !== undefined) fakeDatabase.coverage = transactionCoverage;
            if (transactionCoolingFanOverrides !== undefined) fakeDatabase.coolingFanOverrides = transactionCoolingFanOverrides;
            if (transactionCoolingFanOverrideUpdatedAt !== undefined) fakeDatabase.coolingFanOverrideUpdatedAt = transactionCoolingFanOverrideUpdatedAt;
            transactionRows = undefined;
            transactionCoverage = undefined;
            transactionCoolingFanOverrides = undefined;
            transactionCoolingFanOverrideUpdatedAt = undefined;
            return { rows: [], rowCount: 0 };
          }
          if (sql === "ROLLBACK") {
            transactionRows = undefined;
            transactionCoverage = undefined;
            transactionCoolingFanOverrides = undefined;
            transactionCoolingFanOverrideUpdatedAt = undefined;
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("pg_advisory_xact_lock")) return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
          if (sql.startsWith("SELECT payload FROM catalog_accessories")) {
            if (fakeDatabase.failAccessoryRead) throw new Error("synthetic PostgreSQL accessory read outage");
            return { rows: clonedRows(rows()).map(({ payload }) => ({ payload })), rowCount: rows().length };
          }
          if (sql.startsWith("DELETE FROM catalog_accessories")) {
            const categories = new Set((values?.[0] as string[]) ?? []);
            transactionRows = rows().filter((row) => row.source !== "danawa" || !categories.has(row.category));
            return { rows: [], rowCount: 0 };
          }
          if (sql.startsWith("INSERT INTO catalog_accessories")) {
            if (fakeDatabase.failAccessoryWrite) throw new Error("synthetic PostgreSQL accessory write outage");
            const pcodeConflict = sql.includes("ON CONFLICT (source_product_code)");
            const input = values ?? [];
            for (let index = 0; index < input.length; index += 6) {
              const item: AccessoryItem = JSON.parse(String(input[index + 5])) as AccessoryItem;
              const matchIndex = rows().findIndex((row) => pcodeConflict
                ? row.source === "danawa" && row.source_product_code === item.sourceProductCode
                : row.id === item.id);
              const record: SyntheticAccessoryRow = {
                id: item.id,
                category: item.category,
                source: item.source,
                source_product_code: item.sourceProductCode ?? null,
                data_quality: item.dataQuality,
                payload: item,
                updated_at: new Date(++fakeDatabase.clock)
              };
              if (matchIndex >= 0) rows()[matchIndex] = record;
              else rows().push(record);
            }
            return { rows: [], rowCount: input.length / 6 };
          }
          if (sql.startsWith("SELECT MAX(updated_at) AS updated_at FROM catalog_accessories")) {
            const latest = rows().map((row) => row.updated_at).sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
            return { rows: [{ updated_at: latest }], rowCount: 1 };
          }
          if (sql.startsWith("WITH current AS (") && sql.includes("UPDATE catalog_accessories AS catalog")) {
            if (fakeDatabase.failAccessoryWrite) throw new Error("synthetic PostgreSQL accessory write outage");
            const [id, productCode, danawaUrl, rawPrice, priceCheckedAt] = values ?? [];
            const row = rows().find((candidate) => candidate.id === id
              && candidate.source === "danawa"
              && candidate.source_product_code === productCode
              && candidate.payload.danawaUrl === danawaUrl);
            if (!row) return { rows: [], rowCount: 0 };
            const before = structuredClone(row.payload);
            const after = { ...row.payload, priceWon: Number(rawPrice), priceCheckedAt: String(priceCheckedAt) };
            row.payload = after;
            row.updated_at = new Date(++fakeDatabase.clock);
            return { rows: [{ before_payload: before, after_payload: structuredClone(after) }], rowCount: 1 };
          }
          if (sql.startsWith("SELECT payload FROM accessory_coverage_state WHERE singleton_id = 'current' FOR UPDATE")) {
            return { rows: transactionCoverage ? [{ payload: structuredClone(transactionCoverage) }] : [], rowCount: transactionCoverage ? 1 : 0 };
          }
          if (sql.startsWith("INSERT INTO accessory_coverage_state")) {
            transactionCoverage = JSON.parse(String(values?.[0])) as AccessoryCoverageSnapshot;
            return { rows: [], rowCount: 1 };
          }
          if (sql.startsWith("SELECT payload FROM cooling_fan_load_overrides WHERE singleton_id = 'current' FOR UPDATE")) {
            if (fakeDatabase.failCoolingFanOverrideRead) throw new Error("synthetic PostgreSQL cooling-fan override read outage");
            const snapshot = transactionCoolingFanOverrides ?? {};
            return { rows: Object.keys(snapshot).length > 0 ? [{ payload: structuredClone(snapshot) }] : [], rowCount: Object.keys(snapshot).length > 0 ? 1 : 0 };
          }
          if (sql.startsWith("INSERT INTO cooling_fan_load_overrides")) {
            if (fakeDatabase.failCoolingFanOverrideWrite) throw new Error("synthetic PostgreSQL cooling-fan override write outage");
            transactionCoolingFanOverrides = JSON.parse(String(values?.[0])) as Record<string, CoolingFanLoadOverride>;
            transactionCoolingFanOverrideUpdatedAt = new Date(++fakeDatabase.clock);
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`Unexpected synthetic PostgreSQL client query: ${sql.slice(0, 160)}`);
        },
        release: () => undefined
      };
    }

    async end() { return undefined; }
  }
}));

function accessory(overrides: Partial<AccessoryItem> = {}): AccessoryItem {
  return {
    id: "synthetic-accessory",
    category: "cooling_fan",
    name: "합성 쿨링팬",
    source: "danawa",
    sourceProductCode: "synthetic-fan-pcode",
    danawaUrl: "https://example.invalid/product/synthetic-fan-pcode",
    listingType: "accessory",
    priceWon: 12_000,
    specs: {},
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-09-29T00:00:00.000Z",
    ...overrides
  };
}

function databaseRow(item: AccessoryItem): SyntheticAccessoryRow {
  return {
    id: item.id,
    category: item.category,
    source: item.source,
    source_product_code: item.sourceProductCode ?? null,
    data_quality: item.dataQuality,
    payload: item,
    updated_at: new Date("2026-09-28T00:00:00.000Z")
  };
}

async function withFakePostgres(run: (context: {
  storage: typeof import("./storage");
  accessories: typeof import("./accessories");
  repository: typeof import("./repository");
  directory: string;
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "pc-supporter-accessory-pg-"));
  const keys = ["DATABASE_URL", "PC_SUPPORTER_DATA_DIR", "NODE_ENV"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]])) as Record<(typeof keys)[number], string | undefined>;
  let repository: typeof import("./repository") | undefined;
  try {
    process.env.DATABASE_URL = "postgres://synthetic.test/pc_supporter";
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.NODE_ENV = "test";
    fakeDatabase.rows = [];
    fakeDatabase.coverage = null;
    fakeDatabase.coolingFanOverrides = {};
    fakeDatabase.coolingFanOverrideUpdatedAt = null;
    fakeDatabase.queries = [];
    fakeDatabase.clock = 1_790_000_000_000;
    fakeDatabase.failAccessoryRead = false;
    fakeDatabase.failAccessoryWrite = false;
    fakeDatabase.failCoolingFanOverrideRead = false;
    fakeDatabase.failCoolingFanOverrideWrite = false;
    vi.resetModules();
    const storage = await import("./storage");
    const accessories = await import("./accessories");
    repository = await import("./repository");
    await run({ storage, accessories, repository, directory });
  } finally {
    if (repository) await repository.closePersistence();
    vi.resetModules();
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

describe("PostgreSQL accessory persistence", () => {
  it("loads the shared accessory rows and cooling-fan overrides without consulting accessories.json", async () => {
    await withFakePostgres(async ({ accessories, directory }) => {
      const strayLocalJson = join(directory, "accessories.json");
      const fan = accessory({ id: "shared-db-fan", sourceProductCode: "shared-db-fan-pcode" });
      fakeDatabase.rows = [databaseRow(fan)];
      const localOnly = accessory({ id: "instance-local-only", source: "manual", sourceProductCode: undefined, name: "인스턴스 전용 데이터" });
      await writeFile(strayLocalJson, "{ deliberately invalid local JSON", "utf8");
      const { saveCoolingFanLoadOverrides } = await import("./cooling-fan-load-overrides");
      await saveCoolingFanLoadOverrides([{
        accessoryId: fan.id,
        fanCurrentA: 0.42,
        manufacturerModel: "합성 제조사 SKU",
        sourceNote: "합성 override 테스트",
        updatedAt: "2026-09-29T01:00:00.000Z"
      }]);

      const loaded = await accessories.loadAccessories();
      expect(loaded.some((item) => item.id === fan.id && item.specs.fanCurrentA === 0.42)).toBe(true);
      expect(loaded.some((item) => item.id === localOnly.id)).toBe(false);
      expect(fakeDatabase.queries.some(({ sql }) => sql.startsWith("SELECT payload, updated_at FROM catalog_accessories"))).toBe(true);
      await expect(readFile(strayLocalJson, "utf8")).resolves.toBe("{ deliberately invalid local JSON");

      const writtenByAnotherReplica = accessory({ id: "second-replica-fan", sourceProductCode: "second-replica-pcode" });
      fakeDatabase.rows.push(databaseRow(writtenByAnotherReplica));
      expect((await accessories.loadAccessories()).some((item) => item.id === writtenByAnotherReplica.id)).toBe(true);

      fakeDatabase.failAccessoryRead = true;
      await expect(accessories.loadAccessories()).rejects.toThrow("synthetic PostgreSQL accessory read outage");
      await expect(readFile(strayLocalJson, "utf8")).resolves.toBe("{ deliberately invalid local JSON");
    });
  });

  it("uses the shared PostgreSQL override updated_at for accessory metadata after another replica changes it", async () => {
    await withFakePostgres(async ({ accessories, directory }) => {
      const strayOverrideJson = join(directory, "cooling-fan-load-overrides.json");
      const fan = accessory({ id: "metadata-shared-fan", sourceProductCode: "metadata-shared-fan-pcode" });
      fakeDatabase.rows = [databaseRow(fan)];
      fakeDatabase.coolingFanOverrides = {
        [fan.id]: {
          accessoryId: fan.id,
          fanCurrentA: 0.36,
          manufacturerModel: "SYNTHETIC-METADATA-FAN",
          sourceNote: "synthetic metadata fixture",
          updatedAt: "2026-09-29T03:00:00.000Z"
        }
      };
      fakeDatabase.coolingFanOverrideUpdatedAt = new Date("2026-09-29T03:00:00.000Z");
      await writeFile(strayOverrideJson, "{ intentionally invalid instance-local JSON", "utf8");

      const first = await accessories.accessoryMeta();
      expect(first.accessoryUpdatedAt).toBe("2026-09-29T03:00:00.000Z");

      // Simulate a commit by another API replica; the local JSON mtime/content stays untouched.
      fakeDatabase.coolingFanOverrides[fan.id] = {
        ...fakeDatabase.coolingFanOverrides[fan.id]!,
        fanCurrentA: 0.41,
        updatedAt: "2026-09-30T03:00:00.000Z"
      };
      fakeDatabase.coolingFanOverrideUpdatedAt = new Date("2026-09-30T03:00:00.000Z");

      const second = await accessories.accessoryMeta();
      expect(second.accessoryUpdatedAt).toBe("2026-09-30T03:00:00.000Z");
      expect(fakeDatabase.queries.filter(({ sql }) => sql.startsWith("SELECT payload, updated_at FROM cooling_fan_load_overrides WHERE singleton_id = 'current'"))).toHaveLength(2);
      await expect(readFile(strayOverrideJson, "utf8")).resolves.toBe("{ intentionally invalid instance-local JSON");
    });
  });

  it("reuses a supplied accessory snapshot for metadata and coverage without rereading catalog rows", async () => {
    await withFakePostgres(async ({ accessories }) => {
      fakeDatabase.rows = [databaseRow(accessory({ id: "meta-snapshot-fan" }))];
      const snapshot = await accessories.loadAccessories();
      fakeDatabase.queries = [];
      const snapshotUpdatedAt = "2026-09-27T12:00:00.000Z";

      const metadata = await accessories.accessoryMeta(snapshot, snapshotUpdatedAt);
      const coverage = await accessories.readAccessoryCoverage(snapshot);

      expect(fakeDatabase.queries.filter(({ sql }) => sql.startsWith("SELECT payload, updated_at FROM catalog_accessories"))).toHaveLength(0);
      expect(metadata.accessoryCount).toBe(snapshot.length);
      expect(metadata.accessoryUpdatedAt).toBe(snapshotUpdatedAt);
      expect(coverage.categories.find((entry) => entry.category === "cooling_fan")?.storedProductCount).toBe(
        snapshot.filter((item) => item.category === "cooling_fan").length
      );
    });
  });

  it("shares override writes and deletes through the PostgreSQL singleton", async () => {
    await withFakePostgres(async ({ repository, directory }) => {
      const strayOverrideJson = join(directory, "cooling-fan-load-overrides.json");
      const replicaOne = await import("./cooling-fan-load-overrides");
      const first: CoolingFanLoadOverride = {
        accessoryId: "shared-fan-one",
        fanCurrentA: 0.31,
        manufacturerModel: "SYNTHETIC-ONE",
        sourceNote: "합성 fixture",
        updatedAt: "2026-09-29T01:00:00.000Z"
      };
      const second = { ...first, accessoryId: "shared-fan-two", manufacturerModel: "SYNTHETIC-TWO" };

      await replicaOne.saveCoolingFanLoadOverrides([first]);
      await repository.closePersistence();
      vi.resetModules();
      const replicaTwo = await import("./cooling-fan-load-overrides");
      const replicaTwoRepository = await import("./repository");
      try {
        expect(await replicaTwo.readCoolingFanLoadOverrides()).toEqual({ [first.accessoryId]: first });
        await replicaTwo.saveCoolingFanLoadOverrides([second]);
        expect(await replicaTwo.readCoolingFanLoadOverrides()).toEqual({ [first.accessoryId]: first, [second.accessoryId]: second });
      expect(fakeDatabase.queries.some(({ sql }) => sql.includes("pg_advisory_xact_lock(hashtextextended('pc-supporter:cooling-fan-load-overrides'"))).toBe(true);
      expect(fakeDatabase.queries.filter(({ sql }) => sql.startsWith("INSERT INTO cooling_fan_load_overrides"))).toHaveLength(2);

        expect(await replicaTwo.deleteCoolingFanLoadOverride(first.accessoryId)).toBe(true);
        expect(await replicaTwo.deleteCoolingFanLoadOverride("missing-fan")).toBe(false);
        expect(await replicaTwo.readCoolingFanLoadOverrides()).toEqual({ [second.accessoryId]: second });
        expect(fakeDatabase.queries.some(({ sql }) => sql.includes("FOR UPDATE"))).toBe(true);

        fakeDatabase.failCoolingFanOverrideRead = true;
        await expect(replicaTwo.readCoolingFanLoadOverrides()).rejects.toThrow("synthetic PostgreSQL cooling-fan override read outage");
        await expect(readFile(strayOverrideJson, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

        const baseline = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
        const migration = await readFile(new URL("../db/migrations/20260930_cooling_fan_load_overrides.sql", import.meta.url), "utf8");
        expect(baseline).toContain("CREATE TABLE IF NOT EXISTS cooling_fan_load_overrides");
        expect(migration).toContain("CREATE TABLE IF NOT EXISTS cooling_fan_load_overrides");
      } finally {
        await replicaTwoRepository.closePersistence();
      }
    });
  });

  it("does not fall back to a local file when a PostgreSQL override write fails", async () => {
    await withFakePostgres(async ({ directory }) => {
      fakeDatabase.failCoolingFanOverrideWrite = true;
      const overrides = await import("./cooling-fan-load-overrides");
      await expect(overrides.saveCoolingFanLoadOverrides([{
        accessoryId: "failed-write-fan",
        fanCurrentA: 0.31,
        manufacturerModel: "SYNTHETIC-FAILURE",
        sourceNote: "synthetic failure fixture",
        updatedAt: "2026-09-29T01:00:00.000Z"
      }])).rejects.toThrow("synthetic PostgreSQL cooling-fan override write outage");
      expect(fakeDatabase.coolingFanOverrides).toEqual({});
      await expect(readFile(join(directory, "cooling-fan-load-overrides.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("serializes merges, keeps higher-quality existing products, and replaces only selected Danawa categories", async () => {
    await withFakePostgres(async ({ accessories }) => {
      const existingFan = accessory({ id: "existing-live-fan", sourceProductCode: "existing-live-fan-pcode", name: "기존 라이브 팬" });
      const staleFan = accessory({ id: "stale-fan", sourceProductCode: "stale-fan-pcode", name: "교체 대상 팬" });
      const manualFan = accessory({ id: "manual-fan", source: "manual", sourceProductCode: undefined, dataQuality: "manual", name: "수동 등록 팬" });
      const ups = accessory({ id: "kept-ups", category: "ups", sourceProductCode: "kept-ups-pcode", name: "유지할 UPS" });
      fakeDatabase.rows = [existingFan, staleFan, manualFan, ups].map(databaseRow);

      await accessories.upsertAccessories([accessory({
        id: "lower-quality-same-product",
        sourceProductCode: "existing-live-fan-pcode",
        dataQuality: "incomplete",
        name: "낮은 품질 중복 팬",
        missingFields: ["detail page"]
      })]);
      expect(fakeDatabase.rows.find((row) => row.source_product_code === "existing-live-fan-pcode")?.payload).toMatchObject({
        id: "existing-live-fan",
        dataQuality: "live",
        name: "기존 라이브 팬"
      });

      const replacement = accessory({ id: "new-fan", sourceProductCode: "new-fan-pcode", name: "새 쿨링팬" });
      await accessories.upsertAccessories([replacement], { replaceDanawaCategories: ["cooling_fan"] });
      expect(fakeDatabase.rows.some((row) => row.source_product_code === "stale-fan-pcode")).toBe(false);
      expect(fakeDatabase.rows.some((row) => row.source_product_code === "existing-live-fan-pcode")).toBe(false);
      expect(fakeDatabase.rows.some((row) => row.id === manualFan.id)).toBe(true);
      expect(fakeDatabase.rows.some((row) => row.source_product_code === "kept-ups-pcode")).toBe(true);
      expect(fakeDatabase.rows.some((row) => row.source_product_code === "new-fan-pcode")).toBe(true);
      expect(fakeDatabase.queries.some(({ sql }) => sql.includes("pg_advisory_xact_lock(hashtextextended('pc-supporter:catalog-accessories'"))).toBe(true);
      expect(fakeDatabase.queries.some(({ sql }) => sql.includes("DELETE FROM catalog_accessories WHERE source = 'danawa' AND category = ANY"))).toBe(true);
      expect(fakeDatabase.queries.filter(({ sql }) => sql === "COMMIT").length).toBeGreaterThanOrEqual(2);

      const recordsBeforeFailedWrite = structuredClone(fakeDatabase.rows);
      fakeDatabase.failAccessoryWrite = true;
      await expect(accessories.upsertAccessories([accessory({ id: "failed-fan", sourceProductCode: "failed-fan-pcode" })]))
        .rejects.toThrow("synthetic PostgreSQL accessory write outage");
      expect(fakeDatabase.rows).toEqual(recordsBeforeFailedWrite);
      expect(fakeDatabase.queries.some(({ sql }) => sql === "ROLLBACK")).toBe(true);
    });
  });

  it("applies guarded price patches transactionally and persists coverage in the shared store", async () => {
    await withFakePostgres(async ({ accessories, directory }) => {
      const strayLocalJson = join(directory, "accessories.json");
      const fan = accessory({ id: "price-patch-fan", sourceProductCode: "price-patch-fan-pcode" });
      fakeDatabase.rows = [databaseRow(fan)];
      await writeFile(strayLocalJson, "{ not the configured database", "utf8");
      const updates = await accessories.patchAccessoryPrices([
        { id: fan.id, sourceProductCode: "price-patch-fan-pcode", danawaUrl: fan.danawaUrl!, priceWon: 13_500, priceCheckedAt: "2026-09-29T02:00:00.000Z" },
        { id: fan.id, sourceProductCode: "wrong-pcode", danawaUrl: fan.danawaUrl!, priceWon: 1, priceCheckedAt: "2026-09-29T02:01:00.000Z" },
        { id: fan.id, sourceProductCode: "price-patch-fan-pcode", danawaUrl: "https://example.invalid/wrong", priceWon: 1, priceCheckedAt: "2026-09-29T02:02:00.000Z" }
      ]);
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({ before: { priceWon: 12_000 }, after: { priceWon: 13_500, priceCheckedAt: "2026-09-29T02:00:00.000Z" } });
      expect(fakeDatabase.rows[0]?.payload.priceWon).toBe(13_500);
      expect(fakeDatabase.queries.some(({ sql }) => sql.includes("payload->>'danawaUrl' = $3"))).toBe(true);

      const report: AccessoryCrawlCategoryReport = {
        category: "cooling_fan",
        categoryId: "synthetic-fan-list",
        pagesExpected: 1,
        pagesVisited: 1,
        listedProducts: 1,
        uniqueProducts: 1,
        detailFetched: 1,
        detailFailed: 0,
        missingProducts: 0,
        incompleteSpecs: 0,
        listCoverage: "complete",
        coverage: "partial",
        specCoverage: "complete"
      };
      const coverage = await accessories.recordAccessoryCoverage([report], {
        mode: "all",
        details: true,
        onlyIncomplete: false,
        lastCrawledAt: "2026-09-29T02:10:00.000Z"
      });
      expect(coverage.updatedAt).toBe("2026-09-29T02:10:00.000Z");
      expect(fakeDatabase.coverage?.updatedAt).toBe(coverage.updatedAt);
      expect(fakeDatabase.queries.some(({ sql }) => sql.includes("accessory-coverage"))).toBe(true);
      await expect(readFile(strayLocalJson, "utf8")).resolves.toBe("{ not the configured database");

      fakeDatabase.coverage = null;
      const strayCoverageJson = join(directory, "accessory-coverage.json");
      await writeFile(strayCoverageJson, "{ divergent instance-local coverage", "utf8");
      const sharedCoverage = await accessories.readAccessoryCoverage();
      expect(sharedCoverage.categories.find((entry) => entry.category === "cooling_fan")?.hasCrawlHistory).toBe(false);
      await expect(readFile(strayCoverageJson, "utf8")).resolves.toBe("{ divergent instance-local coverage");
    });
  });

  it("aligns baseline and migration schemas for the accessory tables", async () => {
    const baseline = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
    const migration = await readFile(new URL("../db/migrations/20260930_accessory_catalog.sql", import.meta.url), "utf8");
    const overrideMigration = await readFile(new URL("../db/migrations/20260930_cooling_fan_load_overrides.sql", import.meta.url), "utf8");
    for (const table of ["catalog_accessories", "accessory_coverage_state"]) {
      expect(baseline).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(baseline).toContain("CREATE TABLE IF NOT EXISTS cooling_fan_load_overrides");
    expect(overrideMigration).toContain("CREATE TABLE IF NOT EXISTS cooling_fan_load_overrides");
    expect(baseline).toContain("catalog_accessories_danawa_product_code_idx");
    expect(migration).toContain("catalog_accessories_danawa_product_code_idx");
  });
});
