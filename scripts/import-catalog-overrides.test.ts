import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { executeCatalogOverrideImport, parseImportOptions, runCatalogOverrideCli } from "./import-catalog-overrides";
import {
  catalogSpecOverrideMapFromUnknown,
  importCatalogOverrideMapsWithClient,
  m2SlotOverrideMapFromUnknown,
  type CatalogOverrideMaps
} from "../server/catalog-override-store";

type OverrideTable = "catalog_spec_overrides" | "m2_slot_overrides";
type FakeTables = Record<OverrideTable, Record<string, unknown> | undefined>;

const catalogOverrides = {
  "cpu-fixture": {
    partId: "cpu-fixture",
    category: "cpu",
    fields: { tdpW: 65 },
    manufacturerModel: "Fixture CPU",
    sourceNote: "Manufacturer specification",
    sourceUrl: "https://example.com/cpu",
    updatedAt: "2026-09-30T00:00:00.000Z",
    sourceCheck: {
      requestedUrl: "https://example.com/cpu",
      checkedAt: "2026-09-30T00:00:00.000Z",
      status: "reachable",
      identityStatus: "matched",
      redirectCount: 0,
      httpStatus: 200,
      contentType: "text/html"
    }
  }
};

const m2Overrides = {
  "board-fixture": {
    partId: "board-fixture",
    slots: [{ slotId: "M2_1", interfaces: ["NVMe"], pcieGeneration: 4, connection: "cpu", sharedWith: [] }],
    sourceNote: "Board manual",
    sourceUrl: "https://example.com/board",
    updatedAt: "2026-09-30T00:00:00.000Z"
  }
};

const sourceMaps: CatalogOverrideMaps = {
  catalogSpecOverrides: catalogOverrides,
  m2SlotOverrides: m2Overrides
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function rawHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

class FakeOverrideClient {
  readonly statements: Array<{ sql: string; values?: unknown[] }> = [];
  readonly tables: FakeTables;
  readonly existingTables: Set<OverrideTable>;
  readonly failOnInsert?: OverrideTable;
  private transactionTables: FakeTables | undefined;

  constructor(options: { tables?: Partial<FakeTables>; missingTables?: OverrideTable[]; failOnInsert?: OverrideTable } = {}) {
    this.tables = {
      catalog_spec_overrides: clone(options.tables?.catalog_spec_overrides),
      m2_slot_overrides: clone(options.tables?.m2_slot_overrides)
    };
    this.existingTables = new Set(["catalog_spec_overrides", "m2_slot_overrides"].filter((table) => !(options.missingTables ?? []).includes(table as OverrideTable)) as OverrideTable[]);
    this.failOnInsert = options.failOnInsert;
  }

  asPoolClient() {
    return this as unknown as PoolClient;
  }

  async query(sql: string, values?: unknown[]) {
    this.statements.push({ sql, values });
    if (sql === "BEGIN") {
      this.transactionTables = clone(this.tables);
      return { rows: [] };
    }
    if (sql === "COMMIT") {
      if (!this.transactionTables) throw new Error("fake transaction missing");
      this.tables.catalog_spec_overrides = this.transactionTables.catalog_spec_overrides;
      this.tables.m2_slot_overrides = this.transactionTables.m2_slot_overrides;
      this.transactionTables = undefined;
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      this.transactionTables = undefined;
      return { rows: [] };
    }
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("pg_notify")) return { rows: [] };

    const table = sql.includes("catalog_spec_overrides") ? "catalog_spec_overrides" : sql.includes("m2_slot_overrides") ? "m2_slot_overrides" : undefined;
    if (!table) throw new Error(`unexpected fake SQL: ${sql}`);
    if (!this.existingTables.has(table)) throw Object.assign(new Error("missing table"), { code: "42P01" });
    if (sql.startsWith("SELECT payload")) {
      const payload = this.transactionTables?.[table];
      return { rows: payload === undefined ? [] : [{ payload }] };
    }
    if (sql.startsWith("INSERT")) {
      if (!this.transactionTables) throw new Error("write outside transaction");
      if (this.failOnInsert === table) throw new Error("synthetic partial insert failure");
      this.transactionTables[table] = JSON.parse(String(values?.[0])) as Record<string, unknown>;
      return { rows: [] };
    }
    throw new Error(`unexpected fake SQL: ${sql}`);
  }

  release(_discard?: boolean) {}
}

describe("catalog override map contracts", () => {
  it("preserves stored update/source-check metadata while validating both raw maps", () => {
    expect(catalogSpecOverrideMapFromUnknown(clone(catalogOverrides))["cpu-fixture"].sourceCheck).toEqual(catalogOverrides["cpu-fixture"].sourceCheck);
    expect(m2SlotOverrideMapFromUnknown(clone(m2Overrides))["board-fixture"]).toEqual(m2Overrides["board-fixture"]);
  });

  it("rejects malformed catalog specs, unsupported fields, and map-key mismatches", () => {
    expect(() => catalogSpecOverrideMapFromUnknown({ ...catalogOverrides, wrong: catalogOverrides["cpu-fixture"] })).toThrow(/map key/);
    expect(() => catalogSpecOverrideMapFromUnknown({ item: { ...catalogOverrides["cpu-fixture"], partId: "item", fields: { unsupported: 1 } } })).toThrow(/지원되지 않는 사양 필드/);
    expect(() => catalogSpecOverrideMapFromUnknown({ item: { ...catalogOverrides["cpu-fixture"], partId: "item", manufacturerModel: " " } })).toThrow(/manufacturerModel/);
    expect(() => catalogSpecOverrideMapFromUnknown({ item: { ...catalogOverrides["cpu-fixture"], partId: "item", sourceCheck: { ...catalogOverrides["cpu-fixture"].sourceCheck, status: "unknown" } } })).toThrow(/sourceCheck 형식/);
  });

  it("accepts the new case support contract without changing the stored map", () => {
    const override = { ...clone(catalogOverrides["cpu-fixture"]), partId: "case-fixture", category: "case", fields: { radiatorSizesMm: [120, 240, 360], radiatorSupports: [{ position: "top", sizesMm: [120, 240] }, { position: "front", sizesMm: [360] }], supportedPsuFormFactors: ["ATX", "SFX", "SFX-L"], ssdBays: 0 } };
    const input = { [override.partId]: override };
    expect(catalogSpecOverrideMapFromUnknown(input)).toBe(input);
    expect(input[override.partId]).toEqual(override);
  });

  it("preserves conditional radiator support and fractional component geometry in private import", () => {
    const input = { "case-fixture": { ...clone(catalogOverrides["cpu-fixture"]), partId: "case-fixture", category: "case", fields: { radiatorSupports: [{ position: "psu_shroud", sizesMm: [240, 280], requirements: [{ sizesMm: [240], maxAssemblyThicknessMm: 55.5, maxMemoryHeightMm: 35, exclusiveUpperBound: true }, { sizesMm: [280], configurationNote: "HDD 케이지 분리" }] }] } }, "cooler-fixture": { ...clone(catalogOverrides["cpu-fixture"]), partId: "cooler-fixture", category: "cooler", fields: { radiatorThicknessMm: 27.5, radiatorFanThicknessMm: 25, radiatorWidthMm: 120.5, radiatorLengthMm: 277.5 } }, "memory-fixture": { ...clone(catalogOverrides["cpu-fixture"]), partId: "memory-fixture", category: "memory", fields: { memoryHeightMm: 34.5 } } };
    expect(catalogSpecOverrideMapFromUnknown(input)).toBe(input);
  });

  it.each([
    { sizesMm: [360], maxAssemblyThicknessMm: 55 },
    { maxAssemblyThicknessMm: 55, unknownLimit: 30 },
    { configurationNote: "HDD 케이지 분리", exclusiveUpperBound: true }
  ])("rejects invalid nested mounting conditions in private import: %j", (requirement) => {
    expect(() => catalogSpecOverrideMapFromUnknown({ "case-fixture": { ...clone(catalogOverrides["cpu-fixture"]), partId: "case-fixture", category: "case", fields: { radiatorSupports: [{ position: "top", sizesMm: [240], requirements: [requirement] }] } } })).toThrow(/값의 형식 또는 범위/);
  });

  it.each([
    { radiatorSizesMm: [] },
    { radiatorSizesMm: [240, 240] },
    { radiatorSizesMm: ["240"] },
    { radiatorSupports: [{ position: "top", sizesMm: [240], unreviewed: true }] },
    { radiatorSupports: [{ position: "top", sizesMm: [] }] },
    { radiatorSupports: [{ position: "roof", sizesMm: [240] }] },
    { radiatorSupports: [{ position: "top", sizesMm: [240] }, { position: "top", sizesMm: [360] }] },
    { supportedPsuFormFactors: ["ATX", "SFX", "TFX"] },
    { ssdBays: 0.5 }
  ])("rejects invalid case support in private full-map import: %j", (fields) => {
    expect(() => catalogSpecOverrideMapFromUnknown({ "case-fixture": { ...clone(catalogOverrides["cpu-fixture"]), partId: "case-fixture", category: "case", fields } })).toThrow(/값의 형식 또는 범위/);
  });

  it("accepts valid stored full maps above the per-request API batch limit", () => {
    const catalogMap = Object.fromEntries(Array.from({ length: 501 }, (_value, index) => {
      const partId = `cpu-${index}`;
      return [partId, { ...clone(catalogOverrides["cpu-fixture"]), partId }];
    }));
    const m2Map = Object.fromEntries(Array.from({ length: 501 }, (_value, index) => {
      const partId = `board-${index}`;
      return [partId, { ...clone(m2Overrides["board-fixture"]), partId }];
    }));

    expect(Object.keys(catalogSpecOverrideMapFromUnknown(catalogMap))).toHaveLength(501);
    expect(Object.keys(m2SlotOverrideMapFromUnknown(m2Map))).toHaveLength(501);
  });

  it("preserves long stored part IDs without an importer-only length cap", () => {
    const longPartId = `part-${"x".repeat(1_000)}`;
    const catalogMap = { [longPartId]: { ...clone(catalogOverrides["cpu-fixture"]), partId: longPartId } };
    const m2Map = { [longPartId]: { ...clone(m2Overrides["board-fixture"]), partId: longPartId } };

    expect(catalogSpecOverrideMapFromUnknown(catalogMap)[longPartId].partId).toBe(longPartId);
    expect(m2SlotOverrideMapFromUnknown(m2Map)[longPartId].partId).toBe(longPartId);
  });

  it("rejects malformed M.2 slot maps and non-contiguous slot IDs", () => {
    expect(() => m2SlotOverrideMapFromUnknown({ board: { ...m2Overrides["board-fixture"], partId: "other" } })).toThrow(/map key/);
    expect(() => m2SlotOverrideMapFromUnknown({ board: { ...m2Overrides["board-fixture"], partId: "board", slots: [{ slotId: "M2_2" }] } })).toThrow(/빈 번호 없이/);
  });
});

describe("atomic catalog override map import", () => {
  it("takes existing locks in order, writes both maps in one transaction, and executes no DDL", async () => {
    const client = new FakeOverrideClient();

    const result = await importCatalogOverrideMapsWithClient(client.asPoolClient(), clone(sourceMaps));

    expect(result).toEqual({ catalogSpecOverrides: "imported", m2SlotOverrides: "imported" });
    expect(client.tables.catalog_spec_overrides).toEqual(sourceMaps.catalogSpecOverrides);
    expect(client.tables.m2_slot_overrides).toEqual(sourceMaps.m2SlotOverrides);
    const locks = client.statements.filter(({ sql }) => sql.includes("pg_advisory_xact_lock")).map(({ sql }) => sql);
    expect(locks).toEqual([
      "SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:catalog-spec-overrides', 0))",
      "SELECT pg_advisory_xact_lock(hashtextextended('pc-supporter:m2-slot-overrides', 0))"
    ]);
    expect(client.statements.some(({ sql }) => /\b(CREATE|ALTER|DROP)\b/i.test(sql))).toBe(false);
  });

  it("treats exact canonical payload equality as idempotent regardless of object-key order", async () => {
    const reorderedCatalog = {
      "cpu-fixture": {
        sourceNote: "Manufacturer specification",
        updatedAt: "2026-09-30T00:00:00.000Z",
        sourceUrl: "https://example.com/cpu",
        manufacturerModel: "Fixture CPU",
        fields: { tdpW: 65 },
        category: "cpu",
        partId: "cpu-fixture",
        sourceCheck: clone(catalogOverrides["cpu-fixture"].sourceCheck)
      }
    };
    const client = new FakeOverrideClient({ tables: { catalog_spec_overrides: reorderedCatalog, m2_slot_overrides: clone(m2Overrides) } });

    const result = await importCatalogOverrideMapsWithClient(client.asPoolClient(), clone(sourceMaps));

    expect(result).toEqual({ catalogSpecOverrides: "unchanged", m2SlotOverrides: "unchanged" });
    expect(client.statements.some(({ sql }) => sql.startsWith("INSERT"))).toBe(false);
  });

  it("rejects a different nonempty destination before writing either map", async () => {
    const conflictingM2 = clone(m2Overrides);
    conflictingM2["board-fixture"].sourceNote = "Different reviewed source";
    const client = new FakeOverrideClient({ tables: { catalog_spec_overrides: {}, m2_slot_overrides: conflictingM2 } });

    await expect(importCatalogOverrideMapsWithClient(client.asPoolClient(), clone(sourceMaps))).rejects.toThrow(/다른 override map/);

    expect(client.tables.catalog_spec_overrides).toEqual({});
    expect(client.tables.m2_slot_overrides).toEqual(conflictingM2);
    expect(client.statements.some(({ sql }) => sql.startsWith("INSERT"))).toBe(false);
    expect(client.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rolls back both maps if the second insert fails", async () => {
    const client = new FakeOverrideClient({ failOnInsert: "m2_slot_overrides" });

    await expect(importCatalogOverrideMapsWithClient(client.asPoolClient(), clone(sourceMaps))).rejects.toThrow("synthetic partial insert failure");

    expect(client.tables.catalog_spec_overrides).toBeUndefined();
    expect(client.tables.m2_slot_overrides).toBeUndefined();
    expect(client.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("fails closed when either target table is missing without issuing DDL", async () => {
    const client = new FakeOverrideClient({ missingTables: ["m2_slot_overrides"] });

    await expect(importCatalogOverrideMapsWithClient(client.asPoolClient(), clone(sourceMaps))).rejects.toMatchObject({ code: "42P01" });

    expect(client.statements.some(({ sql }) => /\b(CREATE|ALTER|DROP)\b/i.test(sql))).toBe(false);
    expect(client.statements.at(-1)?.sql).toBe("ROLLBACK");
  });
});

describe("catalog override import command", () => {
  let directory: string;
  let catalogPath: string;
  let m2Path: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "pc-supporter-catalog-override-import-"));
    catalogPath = join(directory, "catalog-spec-overrides.json");
    m2Path = join(directory, "m2-slot-overrides.json");
    await writeFile(catalogPath, JSON.stringify(catalogOverrides));
    await writeFile(m2Path, JSON.stringify(m2Overrides));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("defaults to a read-only dry-run with counts and source digests, without creating a pool", async () => {
    let createPoolCalls = 0;
    let loadEnvironmentCalls = 0;
    const report = await executeCatalogOverrideImport(["--catalog-spec-file", catalogPath, "--m2-slot-file", m2Path], {
      env: new Proxy({}, { get: (_target, key) => { if (key === "DATABASE_URL") throw new Error("dry-run must not inspect DATABASE_URL"); return undefined; } }) as Record<string, string | undefined>,
      loadEnvironment: async () => { loadEnvironmentCalls += 1; throw new Error("dry-run must not load dotenv"); },
      createPool: () => { createPoolCalls += 1; throw new Error("pool must not be created in dry-run"); }
    });

    expect(report).toEqual({
      ok: true,
      mode: "dry-run",
      connectedToDatabase: false,
      catalogSpecOverrides: { source: "catalog-spec-overrides.json", sha256: rawHash(catalogOverrides), records: 1 },
      m2SlotOverrides: { source: "m2-slot-overrides.json", sha256: rawHash(m2Overrides), records: 1 }
    });
    expect(createPoolCalls).toBe(0);
    expect(loadEnvironmentCalls).toBe(0);
  });

  it("requires both explicit source paths and rejects a missing input file", async () => {
    expect(() => parseImportOptions([])).toThrow(/두 원본 전체 map/);
    await expect(executeCatalogOverrideImport(["--catalog-spec-file", catalogPath, "--m2-slot-file", join(directory, "missing.json")])).rejects.toThrow(/m2-slot-overrides.json 원본 파일을 읽을 수 없습니다/);
  });

  it("does not echo credential-bearing unknown arguments to stdout or stderr", async () => {
    const secretUrl = "postgres://user:secret-password@db.invalid/catalog";
    const stdout: string[] = [];
    const stderr: string[] = [];
    const capture = { writeStdout: (text: string) => stdout.push(text), writeStderr: (text: string) => stderr.push(text) };

    const unknownArgumentExitCode = await runCatalogOverrideCli([`--database-url=${secretUrl}`], capture);

    expect(unknownArgumentExitCode).toBe(1);
    expect(stdout.join("\n")).not.toContain(secretUrl);
    expect(stderr.join("\n")).not.toContain(secretUrl);
    expect(stderr.join("\n")).not.toContain("secret-password");
    expect(stderr.join("\n")).toContain("알 수 없는 인자가 있습니다.");

    stdout.length = 0;
    stderr.length = 0;
    const missingPathExitCode = await runCatalogOverrideCli([
      "--catalog-spec-file", secretUrl,
      "--m2-slot-file", m2Path
    ], capture);
    expect(missingPathExitCode).toBe(1);
    expect(stdout.join("\n")).not.toContain("secret-password");
    expect(stderr.join("\n")).not.toContain(secretUrl);

    stdout.length = 0;
    stderr.length = 0;
    await writeFile(catalogPath, JSON.stringify({
      [secretUrl]: { ...catalogOverrides["cpu-fixture"], partId: "different-id" }
    }));
    const invalidSourceExitCode = await runCatalogOverrideCli([
      "--catalog-spec-file", catalogPath,
      "--m2-slot-file", m2Path
    ], capture);
    expect(invalidSourceExitCode).toBe(1);
    expect(stdout.join("\n")).not.toContain("secret-password");
    expect(stderr.join("\n")).not.toContain(secretUrl);
  });

  it("validates malformed input and reviewed hash before database setup", async () => {
    await writeFile(m2Path, JSON.stringify({ board: { ...m2Overrides["board-fixture"], partId: "board", slots: [] } }));
    let createPoolCalls = 0;
    await expect(executeCatalogOverrideImport([
      "--apply", "--catalog-spec-file", catalogPath, "--m2-slot-file", m2Path,
      "--catalog-spec-sha256", rawHash(catalogOverrides), "--m2-slot-sha256", rawHash(m2Overrides)
    ], { env: { DATABASE_URL: "postgres://not-used.invalid/never-connect" }, createPool: () => { createPoolCalls += 1; throw new Error(); } })).rejects.toThrow(/slots는 1개부터 8개/);
    expect(createPoolCalls).toBe(0);

    await writeFile(m2Path, JSON.stringify(m2Overrides));
    await expect(executeCatalogOverrideImport([
      "--apply", "--catalog-spec-file", catalogPath, "--m2-slot-file", m2Path,
      "--catalog-spec-sha256", "0".repeat(64), "--m2-slot-sha256", rawHash(m2Overrides)
    ], { env: { DATABASE_URL: "postgres://not-used.invalid/never-connect" }, createPool: () => { createPoolCalls += 1; throw new Error(); } })).rejects.toThrow(/검토한 SHA-256과 일치하지 않습니다/);
    expect(createPoolCalls).toBe(0);
  });

  it("requires DATABASE_URL for apply and leaves source files unchanged", async () => {
    const catalogBefore = await readFile(catalogPath);
    const m2Before = await readFile(m2Path);
    let createPoolCalls = 0;

    await expect(executeCatalogOverrideImport([
      "--apply", "--catalog-spec-file", catalogPath, "--m2-slot-file", m2Path,
      "--catalog-spec-sha256", rawHash(catalogOverrides), "--m2-slot-sha256", rawHash(m2Overrides)
    ], { env: {}, createPool: () => { createPoolCalls += 1; throw new Error(); } })).rejects.toThrow(/DATABASE_URL/);

    expect(createPoolCalls).toBe(0);
    expect(await readFile(catalogPath)).toEqual(catalogBefore);
    expect(await readFile(m2Path)).toEqual(m2Before);
  });

  it("uses the reviewed hashes and one fake database pool for apply without logging credentials", async () => {
    const fakeClient = new FakeOverrideClient();
    let poolCreated = 0;
    let poolEnded = 0;
    const secretUrl = "postgres://user:secret@db.invalid/catalog";
    const report = await executeCatalogOverrideImport([
      "--apply", "--catalog-spec-file", catalogPath, "--m2-slot-file", m2Path,
      "--catalog-spec-sha256", rawHash(catalogOverrides), "--m2-slot-sha256", rawHash(m2Overrides)
    ], {
      env: { DATABASE_URL: secretUrl },
      createPool: () => {
        poolCreated += 1;
        return { connect: async () => fakeClient.asPoolClient(), end: async () => { poolEnded += 1; } };
      }
    });

    expect(poolCreated).toBe(1);
    expect(poolEnded).toBe(1);
    expect(report.connectedToDatabase).toBe(true);
    expect(report.catalogSpecOverrides.status).toBe("imported");
    expect(report.m2SlotOverrides.status).toBe("imported");
    expect(JSON.stringify(report)).not.toContain(secretUrl);
    expect(await readFile(catalogPath, "utf8")).toBe(JSON.stringify(catalogOverrides));
    expect(await readFile(m2Path, "utf8")).toBe(JSON.stringify(m2Overrides));
  });
});
