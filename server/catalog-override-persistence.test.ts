import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogSpecOverride } from "../shared/catalog-spec-overrides";
import type { M2SlotOverride, Part } from "../shared/types";

const fakeDatabase = vi.hoisted(() => ({
  catalogSpecOverrides: null as Record<string, CatalogSpecOverride> | null,
  m2SlotOverrides: null as Record<string, M2SlotOverride> | null,
  catalogSpecUpdatedAt: null as Date | string | null,
  m2SlotUpdatedAt: null as Date | string | null,
  failedReads: new Set<string>(),
  failedWrites: new Set<string>(),
  queries: [] as Array<{ sql: string; values?: unknown[] }>
}));

const databaseLocks = new Map<string, Promise<void>>();
const previousEnvironment = Object.fromEntries(["DATABASE_URL", "PC_SUPPORTER_DATA_DIR", "NODE_ENV"].map((key) => [key, process.env[key]])) as Record<string, string | undefined>;

async function acquireDatabaseLock(key: string) {
  const previous = databaseLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  databaseLocks.set(key, current);
  await previous;
  return () => {
    release();
    if (databaseLocks.get(key) === current) databaseLocks.delete(key);
  };
}

vi.mock("pg", () => ({
  Pool: class SyntheticPool {
    async query(sql: string, values?: unknown[]) {
      fakeDatabase.queries.push({ sql, values });
      if (sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("SELECT part_id, payload FROM benchmark_overrides")) return { rows: [], rowCount: 0 };
      if (sql.includes("AS catalog_spec_updated_at")) {
        return {
          rows: [{ catalog_spec_updated_at: fakeDatabase.catalogSpecUpdatedAt, m2_slot_updated_at: fakeDatabase.m2SlotUpdatedAt }],
          rowCount: 1
        };
      }
      const table = sql.startsWith("SELECT payload FROM catalog_spec_overrides")
        ? "catalog_spec_overrides"
        : sql.startsWith("SELECT payload FROM m2_slot_overrides")
          ? "m2_slot_overrides"
          : undefined;
      if (!table) throw new Error(`Unexpected synthetic PostgreSQL query: ${sql.slice(0, 160)}`);
      if (fakeDatabase.failedReads.has(table)) throw new Error(`synthetic PostgreSQL ${table} read outage`);
      const payload = fakeDatabase[table === "catalog_spec_overrides" ? "catalogSpecOverrides" : "m2SlotOverrides"];
      return { rows: payload ? [{ payload: structuredClone(payload) }] : [], rowCount: payload ? 1 : 0 };
    }

    async connect() {
      let transactionTable: "catalog_spec_overrides" | "m2_slot_overrides" | undefined;
      let transactionPayload: Record<string, CatalogSpecOverride | M2SlotOverride> | undefined;
      let releaseLock: (() => void) | undefined;
      return {
        query: async (sql: string, values?: unknown[]) => {
          fakeDatabase.queries.push({ sql, values });
          if (sql === "BEGIN" || sql.includes("pg_advisory_xact_lock(hashtextextended($1")) {
            return { rows: [], rowCount: 0 };
          }
          const lockKey = sql.match(/pg_advisory_xact_lock\(hashtextextended\('pc-supporter:([^']+)'/);
          if (lockKey) {
            releaseLock = await acquireDatabaseLock(lockKey[1]);
            return { rows: [], rowCount: 1 };
          }
          if (sql === "ROLLBACK") {
            releaseLock?.();
            releaseLock = undefined;
            transactionPayload = undefined;
            transactionTable = undefined;
            return { rows: [], rowCount: 0 };
          }
          if (sql === "COMMIT") {
            if (transactionTable && transactionPayload) {
              if (transactionTable === "catalog_spec_overrides") fakeDatabase.catalogSpecOverrides = structuredClone(transactionPayload) as Record<string, CatalogSpecOverride>;
              else fakeDatabase.m2SlotOverrides = structuredClone(transactionPayload) as Record<string, M2SlotOverride>;
            }
            releaseLock?.();
            releaseLock = undefined;
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) return { rows: [], rowCount: 0 };
          const select = sql.match(/^SELECT payload FROM (catalog_spec_overrides|m2_slot_overrides) WHERE singleton_id = 'current' FOR UPDATE$/);
          if (select) {
            const table = select[1] as "catalog_spec_overrides" | "m2_slot_overrides";
            if (fakeDatabase.failedReads.has(table)) throw new Error(`synthetic PostgreSQL ${table} read outage`);
            transactionTable = table;
            const current = table === "catalog_spec_overrides" ? fakeDatabase.catalogSpecOverrides : fakeDatabase.m2SlotOverrides;
            transactionPayload = current ? structuredClone(current) : {};
            return { rows: current ? [{ payload: structuredClone(current) }] : [], rowCount: current ? 1 : 0 };
          }
          const insert = sql.match(/^INSERT INTO (catalog_spec_overrides|m2_slot_overrides) \(singleton_id, payload, updated_at\)/);
          if (insert) {
            const table = insert[1] as "catalog_spec_overrides" | "m2_slot_overrides";
            if (fakeDatabase.failedWrites.has(table)) throw new Error(`synthetic PostgreSQL ${table} write outage`);
            transactionTable = table;
            transactionPayload = JSON.parse(String(values?.[0])) as Record<string, CatalogSpecOverride | M2SlotOverride>;
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

const catalogOverride = (partId: string): CatalogSpecOverride => ({
  partId,
  category: "cpu",
  fields: { tdpW: 65 },
  manufacturerModel: `CPU-${partId}`,
  sourceNote: "제조사 사양 확인",
  sourceUrl: "https://vendor.example/cpu",
  updatedAt: "2026-09-30T00:00:00.000Z"
});

const m2Override = (partId: string): M2SlotOverride => ({
  partId,
  slots: [{ slotId: "M2_1", interfaces: ["NVMe"], pcieGeneration: 4, connection: "cpu", sharedWith: [] }],
  sourceNote: "메인보드 설명서 확인",
  sourceUrl: "https://vendor.example/board",
  updatedAt: "2026-09-30T00:00:00.000Z"
});

async function temporaryDataDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "pc-supporter-catalog-override-persistence-"));
  process.env.PC_SUPPORTER_DATA_DIR = directory;
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgres://synthetic.test/pc_supporter";
  fakeDatabase.catalogSpecOverrides = null;
  fakeDatabase.m2SlotOverrides = null;
  fakeDatabase.catalogSpecUpdatedAt = null;
  fakeDatabase.m2SlotUpdatedAt = null;
  fakeDatabase.failedReads.clear();
  fakeDatabase.failedWrites.clear();
  fakeDatabase.queries = [];
  databaseLocks.clear();
  vi.resetModules();
  return directory;
}

async function loadPersistenceReplica() {
  const [storage, catalog, m2, repository] = await Promise.all([
    import("./storage"),
    import("./catalog-spec-overrides"),
    import("./m2-overrides"),
    import("./repository")
  ]);
  return { storage, catalog, m2, repository };
}

describe("catalog override repository persistence", () => {
  it("shares writes on the next read and serializes concurrent replica updates in PostgreSQL", async () => {
    const directory = await temporaryDataDirectory();
    const repositories: Array<typeof import("./repository")> = [];
    try {
      const replicaOne = await loadPersistenceReplica();
      repositories.push(replicaOne.repository);
      const initialCatalog = catalogOverride("cpu-initial");
      const initialM2 = m2Override("board-initial");
      await replicaOne.catalog.saveCatalogSpecOverrides([initialCatalog]);
      await replicaOne.m2.saveM2SlotOverrides([initialM2]);

      vi.resetModules();
      const replicaTwo = await loadPersistenceReplica();
      repositories.push(replicaTwo.repository);
      expect(await replicaTwo.catalog.readCatalogSpecOverrides()).toEqual({ [initialCatalog.partId]: initialCatalog });
      expect(await replicaTwo.m2.readM2SlotOverrides()).toEqual({ [initialM2.partId]: initialM2 });

      const catalogRows = [catalogOverride("cpu-one"), catalogOverride("cpu-two"), catalogOverride("cpu-three")];
      const m2Rows = [m2Override("board-one"), m2Override("board-two"), m2Override("board-three")];
      await Promise.all([
        replicaOne.catalog.saveCatalogSpecOverrides(catalogRows.slice(0, 2)),
        replicaTwo.catalog.saveCatalogSpecOverrides(catalogRows.slice(2)),
        replicaOne.m2.saveM2SlotOverrides(m2Rows.slice(0, 2)),
        replicaTwo.m2.saveM2SlotOverrides(m2Rows.slice(2))
      ]);

      expect(await replicaTwo.catalog.readCatalogSpecOverrides()).toEqual(Object.fromEntries([initialCatalog, ...catalogRows].map((item) => [item.partId, item])));
      expect(await replicaTwo.m2.readM2SlotOverrides()).toEqual(Object.fromEntries([initialM2, ...m2Rows].map((item) => [item.partId, item])));
      for (const lock of ["catalog-spec-overrides", "m2-slot-overrides"]) {
        expect(fakeDatabase.queries.some(({ sql }) => sql.includes(`pc-supporter:${lock}`))).toBe(true);
      }
      expect(fakeDatabase.queries.filter(({ sql }) => sql.includes("FOR UPDATE"))).toHaveLength(6);

      const [baseline, migration] = await Promise.all([
        readFile(new URL("../db/schema.sql", import.meta.url), "utf8"),
        readFile(new URL("../db/migrations/20260930_catalog_override_maps.sql", import.meta.url), "utf8")
      ]);
      for (const table of ["catalog_spec_overrides", "m2_slot_overrides"]) {
        const ddl = `CREATE TABLE IF NOT EXISTS ${table} (\n  singleton_id TEXT PRIMARY KEY CHECK (singleton_id = 'current'),\n  payload JSONB NOT NULL,\n  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()\n);`;
        expect(baseline).toContain(ddl);
        expect(migration).toContain(ddl);
      }
      expect(migration).toContain("Cutover gate");
    } finally {
      for (const repository of repositories) await repository.closePersistence();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses PostgreSQL override updated_at values instead of stray local artifact mtimes", async () => {
    const directory = await temporaryDataDirectory();
    let repository: typeof import("./repository") | undefined;
    try {
      const replica = await loadPersistenceReplica();
      repository = replica.repository;
      await replica.catalog.saveCatalogSpecOverrides([catalogOverride("cpu-timestamp")]);
      await replica.m2.saveM2SlotOverride(m2Override("board-timestamp"));

      const staleLocalTime = new Date("2050-01-01T00:00:00.000Z");
      const strayM2Path = join(directory, "m2-slot-overrides.json");
      const straySpecPath = join(directory, "catalog-spec-overrides.json");
      const strayCatalogPath = join(directory, "catalog.json");
      await writeFile(strayM2Path, "{}\n", "utf8");
      await writeFile(straySpecPath, "{}\n", "utf8");
      await writeFile(strayCatalogPath, "[]\n", "utf8");
      await utimes(strayM2Path, staleLocalTime, staleLocalTime);
      await utimes(straySpecPath, staleLocalTime, staleLocalTime);
      const staleCatalogTime = new Date("2060-01-01T00:00:00.000Z");
      await utimes(strayCatalogPath, staleCatalogTime, staleCatalogTime);
      fakeDatabase.catalogSpecUpdatedAt = "2026-10-01T00:00:00.000Z";
      fakeDatabase.m2SlotUpdatedAt = "2026-10-02T00:00:00.000Z";

      const [{ catalogUpdatedAtFor }, { fileUpdatedAt }] = await Promise.all([import("./catalog"), import("./storage")]);
      const basePart: Part = {
        id: "catalog-timestamp-fixture",
        category: "cpu",
        name: "Timestamp fixture CPU",
        source: "manual",
        specs: {},
        dataQuality: "manual",
        missingFields: [],
        updatedAt: "2026-09-01T00:00:00.000Z"
      };
      const baseCatalog = [basePart];
      expect(await fileUpdatedAt(strayM2Path)).toBe(staleLocalTime.toISOString());
      expect(await fileUpdatedAt(straySpecPath)).toBe(staleLocalTime.toISOString());
      expect(await fileUpdatedAt(strayCatalogPath)).toBe(staleCatalogTime.toISOString());
      expect(await catalogUpdatedAtFor(baseCatalog)).toBe("2026-10-02T00:00:00.000Z");
      fakeDatabase.catalogSpecUpdatedAt = "2026-10-03T00:00:00.000Z";
      expect(await catalogUpdatedAtFor([...baseCatalog])).toBe("2026-10-03T00:00:00.000Z");
      expect(fakeDatabase.queries.some(({ sql }) => sql.includes("AS catalog_spec_updated_at"))).toBe(true);
    } finally {
      if (repository) await repository.closePersistence();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed on PostgreSQL read and write errors without touching stray override JSON files", async () => {
    const directory = await temporaryDataDirectory();
    const repositories: Array<typeof import("./repository")> = [];
    const catalogFile = join(directory, "catalog-spec-overrides.json");
    const m2File = join(directory, "m2-slot-overrides.json");
    const catalogSentinel = "{\"preserved\":\"catalog-local-copy\"}\n";
    const m2Sentinel = "{\"preserved\":\"m2-local-copy\"}\n";
    try {
      const replica = await loadPersistenceReplica();
      repositories.push(replica.repository);
      await writeFile(catalogFile, catalogSentinel, "utf8");
      await writeFile(m2File, m2Sentinel, "utf8");
      const readJson = vi.spyOn(replica.storage, "readJson");
      const writeJson = vi.spyOn(replica.storage, "writeJson");

      fakeDatabase.failedReads.add("catalog_spec_overrides");
      fakeDatabase.failedReads.add("m2_slot_overrides");
      const readResults = await Promise.allSettled([
        replica.catalog.readCatalogSpecOverrides(),
        replica.m2.readM2SlotOverrides()
      ]);
      expect(readResults.map((result) => result.status)).toEqual(["rejected", "rejected"]);
      expect(readResults.map((result) => result.status === "rejected" ? result.reason.message : "")).toEqual([
        "synthetic PostgreSQL catalog_spec_overrides read outage",
        "synthetic PostgreSQL m2_slot_overrides read outage"
      ]);
      expect(readJson).not.toHaveBeenCalled();

      await replica.repository.closePersistence();
      repositories.splice(repositories.indexOf(replica.repository), 1);
      vi.resetModules();
      const writeReplica = await loadPersistenceReplica();
      repositories.push(writeReplica.repository);
      const writeJsonSpy = vi.spyOn(writeReplica.storage, "writeJson");
      fakeDatabase.failedReads.clear();
      fakeDatabase.failedWrites.add("catalog_spec_overrides");
      fakeDatabase.failedWrites.add("m2_slot_overrides");
      await expect(writeReplica.catalog.saveCatalogSpecOverrides([catalogOverride("cpu-failed")])).rejects.toThrow("synthetic PostgreSQL catalog_spec_overrides write outage");
      expect(writeJsonSpy).not.toHaveBeenCalled();
      await writeReplica.repository.closePersistence();
      repositories.splice(repositories.indexOf(writeReplica.repository), 1);
      vi.resetModules();
      const secondWriteReplica = await loadPersistenceReplica();
      repositories.push(secondWriteReplica.repository);
      const secondWriteJsonSpy = vi.spyOn(secondWriteReplica.storage, "writeJson");
      await expect(secondWriteReplica.m2.saveM2SlotOverride(m2Override("board-failed"))).rejects.toThrow("synthetic PostgreSQL m2_slot_overrides write outage");
      expect(secondWriteJsonSpy).not.toHaveBeenCalled();
      expect(writeJson).not.toHaveBeenCalled();
      expect(await readFile(catalogFile, "utf8")).toBe(catalogSentinel);
      expect(await readFile(m2File, "utf8")).toBe(m2Sentinel);
    } finally {
      for (const repository of repositories) await repository.closePersistence();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const key of ["DATABASE_URL", "PC_SUPPORTER_DATA_DIR", "NODE_ENV"]) {
    const value = previousEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
