import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  FileRuntimeStateImportConflictError,
  executeFileRuntimeStateImport,
  importFileRuntimeStateWithClient,
  priceRefreshAttemptsFromUnknown,
  readFileRuntimeStateSnapshot,
  usageEventsFromUnknown
} from "./import-file-runtime-state";
import { POSTGRES_SCHEMA_SHA256, POSTGRES_SCHEMA_VERSION } from "../server/postgres-schema-contract";

const now = new Date("2026-09-30T12:00:00.000Z");
const attemptsInput = {
  "part:cpu-1": "2026-09-30T11:30:00.000Z",
  "accessory:fan-1": "2026-09-30T11:45:00Z"
};
const usageInput = {
  schemaVersion: 1,
  daily: { "2026-09-30": { app_open: 1, recommend: 3, check: 0 } }
};
function bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value));
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

type AttemptRow = { item_kind: "part" | "accessory"; item_id: string; attempted_at: Date };
type UsageRow = { day_utc: string; counts: Record<string, number> };

class FakeRuntimeStateClient {
  attempts: AttemptRow[];
  usage: UsageRow[];
  readonly statements: Array<{ sql: string; values?: unknown[] }> = [];
  readonly databaseName: string;
  schemaVersion: number;
  schemaSha256: string;
  failUsageInsert = false;
  corruptUsageReadback = false;
  private transactionState?: { attempts: AttemptRow[]; usage: UsageRow[] };

  constructor(options: { attempts?: AttemptRow[]; usage?: UsageRow[]; databaseName?: string; schemaVersion?: number; schemaSha256?: string } = {}) {
    this.attempts = structuredClone(options.attempts ?? []);
    this.usage = structuredClone(options.usage ?? []);
    this.databaseName = options.databaseName ?? "pcsupporter";
    this.schemaVersion = options.schemaVersion ?? POSTGRES_SCHEMA_VERSION;
    this.schemaSha256 = options.schemaSha256 ?? POSTGRES_SCHEMA_SHA256;
  }

  asPoolClient() { return this as unknown as PoolClient; }

  async query(sql: string, values?: unknown[]) {
    this.statements.push({ sql, values });
    if (sql === "BEGIN") {
      this.transactionState = { attempts: structuredClone(this.attempts), usage: structuredClone(this.usage) };
      return { rows: [] };
    }
    if (sql === "COMMIT") {
      if (!this.transactionState) throw new Error("fake transaction missing");
      this.attempts = this.transactionState.attempts;
      this.usage = this.transactionState.usage;
      this.transactionState = undefined;
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      this.transactionState = undefined;
      return { rows: [] };
    }
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("current_database()")) return { rows: [{ database_name: this.databaseName }] };
    if (sql.includes("FROM pc_supporter_schema_revision")) return { rows: [{ schema_version: this.schemaVersion, schema_sha256: this.schemaSha256 }] };
    if (sql.includes("FROM price_refresh_attempts")) return { rows: structuredClone((this.transactionState ?? this).attempts) };
    if (sql.includes("FROM usage_event_daily_counts")) {
      const rows = structuredClone((this.transactionState ?? this).usage);
      if (this.corruptUsageReadback && rows.length > 0) rows[0]!.counts.recommend = 999;
      return { rows };
    }
    if (sql.includes("INSERT INTO price_refresh_attempts")) {
      if (!this.transactionState) throw new Error("attempt write outside transaction");
      const [kinds, ids, timestamps] = values ?? [];
      for (let index = 0; index < (kinds as string[]).length; index += 1) {
        this.transactionState.attempts.push({
          item_kind: (kinds as AttemptRow["item_kind"][])[index]!,
          item_id: (ids as string[])[index]!,
          attempted_at: new Date((timestamps as string[])[index]!)
        });
      }
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO usage_event_daily_counts")) {
      if (!this.transactionState) throw new Error("usage write outside transaction");
      if (this.failUsageInsert) throw Object.assign(new Error("synthetic insertion failure"), { code: "XX000" });
      this.transactionState.usage.push({ day_utc: String(values?.[0]), counts: JSON.parse(String(values?.[1])) as Record<string, number> });
      return { rows: [] };
    }
    if (/\b(CREATE|ALTER|DROP)\b/i.test(sql)) throw new Error("runtime-state import must not execute DDL");
    throw new Error(`unexpected fake SQL: ${sql}`);
  }

  release(_discard?: boolean) {}
}

describe("file runtime-state import source contract", () => {
  it("parses the observed attempt keys and event counts without exposing source rows", () => {
    expect(priceRefreshAttemptsFromUnknown(attemptsInput, now)).toEqual([
      { kind: "accessory", itemId: "fan-1", attemptedAt: "2026-09-30T11:45:00.000Z" },
      { kind: "part", itemId: "cpu-1", attemptedAt: "2026-09-30T11:30:00.000Z" }
    ]);
    expect(usageEventsFromUnknown(usageInput, now)).toEqual({
      days: [{ dayUtc: "2026-09-30", counts: { app_open: 1, recommend: 3, check: 0 } }],
      totalEvents: 4
    });
  });

  it("matches the schema's 512-character item ID boundary and rejects future timestamps", () => {
    expect(() => priceRefreshAttemptsFromUnknown({ "gpu:id": "2026-09-30T11:00:00.000Z" }, now)).toThrow(/unsupported item kind/);
    expect(priceRefreshAttemptsFromUnknown({ [`part:${"x".repeat(512)}`]: "2026-09-30T11:00:00.000Z" }, now)[0]?.itemId).toHaveLength(512);
    expect(() => priceRefreshAttemptsFromUnknown({ [`part:${"x".repeat(513)}`]: "2026-09-30T11:00:00.000Z" }, now)).toThrow(/invalid item ID/);
    expect(() => priceRefreshAttemptsFromUnknown({ "part:gpu-1": "2026-09-30T12:00:01.000Z" }, now)).toThrow(/future/);
  });

  it("rejects unsupported usage names, non-integers, and future days", () => {
    expect(() => usageEventsFromUnknown({ schemaVersion: 1, daily: { "2026-09-30": { purchase: 1 } } }, now)).toThrow(/unsupported event name/);
    expect(() => usageEventsFromUnknown({ schemaVersion: 1, daily: { "2026-09-30": { check: -1 } } }, now)).toThrow(/non-negative/);
    expect(() => usageEventsFromUnknown({ schemaVersion: 1, daily: { "2026-10-01": { check: 1 } } }, now)).toThrow(/future daily bucket/);
    expect(() => usageEventsFromUnknown({ schemaVersion: 2, daily: {} }, now)).toThrow(/schemaVersion 1/);
  });
});

describe("file runtime-state import command", () => {
  let directory: string;
  let attemptsPath: string;
  let usagePath: string;
  let attemptsBytes: Uint8Array;
  let usageBytes: Uint8Array;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "pc-supporter-file-runtime-state-"));
    attemptsPath = join(directory, "price-refresh-attempts.json");
    usagePath = join(directory, "usage-events.json");
    attemptsBytes = bytes(attemptsInput);
    usageBytes = bytes(usageInput);
    await writeFile(attemptsPath, attemptsBytes);
    await writeFile(usagePath, usageBytes);
  });

  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  const baseArgs = () => ["--price-attempts-file", attemptsPath, "--usage-events-file", usagePath];
  const reviewedArgs = () => [...baseArgs(), "--apply", "--price-attempts-sha256", sha256(attemptsBytes), "--usage-events-sha256", sha256(usageBytes)];

  it("dry-runs without opening a pool or loading dotenv", async () => {
    const createPool = vi.fn(() => { throw new Error("pool must not be created"); });
    const result = await executeFileRuntimeStateImport([...baseArgs(), "--dry-run"], {
      env: { DATABASE_URL: "postgres://configured-but-not-used" },
      createPool,
      now: () => now
    });
    expect(result).toMatchObject({
      mode: "dry-run",
      connectedToDatabase: false,
      priceRefreshAttempts: { records: 2, sha256: sha256(attemptsBytes) },
      usageEvents: { dailyBuckets: 1, totalEvents: 4, sha256: sha256(usageBytes) }
    });
    expect(createPool).not.toHaveBeenCalled();
  });

  it("checks both reviewed raw hashes before opening PostgreSQL", async () => {
    const createPool = vi.fn(() => { throw new Error("must fail before this point"); });
    await expect(executeFileRuntimeStateImport([
      ...baseArgs(), "--apply", "--price-attempts-sha256", "0".repeat(64), "--usage-events-sha256", sha256(usageBytes)
    ], { env: { DATABASE_URL: "postgres://not-printed" }, createPool, now: () => now })).rejects.toThrow(/reviewed SHA-256/);
    expect(createPool).not.toHaveBeenCalled();
  });

  it("imports both files in one transaction and an exact replay is a no-op", async () => {
    const client = new FakeRuntimeStateClient();
    const createPool = vi.fn(() => ({ connect: async () => client.asPoolClient(), end: async () => undefined }));
    const dependencies = { env: { DATABASE_URL: "postgres://not-printed" }, createPool, now: () => now };
    const first = await executeFileRuntimeStateImport(reviewedArgs(), dependencies);
    expect(first).toMatchObject({
      mode: "apply",
      connectedToDatabase: true,
      targetDatabase: "pcsupporter",
      priceRefreshAttempts: { records: 2, status: "imported" },
      usageEvents: { dailyBuckets: 1, totalEvents: 4, status: "imported" }
    });
    expect(client.attempts).toHaveLength(2);
    expect(client.usage).toEqual([{ day_utc: "2026-09-30", counts: usageInput.daily["2026-09-30"] }]);
    expect(client.statements.filter(({ sql }) => sql === "BEGIN")).toHaveLength(1);
    expect(client.statements.filter(({ sql }) => sql === "COMMIT")).toHaveLength(1);
    expect(client.statements.some(({ sql }) => /\b(CREATE|ALTER|DROP)\b/i.test(sql))).toBe(false);

    const replay = await executeFileRuntimeStateImport(reviewedArgs(), dependencies);
    expect(replay.priceRefreshAttempts.status).toBe("unchanged");
    expect(replay.usageEvents.status).toBe("unchanged");
    expect(client.statements.filter(({ sql }) => sql.startsWith("INSERT INTO"))).toHaveLength(2);
  });

  it("rejects a different nonempty target before modifying either table", async () => {
    const client = new FakeRuntimeStateClient({ attempts: [{ item_kind: "part", item_id: "cpu-1", attempted_at: new Date("2026-09-30T10:00:00.000Z") }] });
    await expect(importFileRuntimeStateWithClient(client.asPoolClient(), await readFileRuntimeStateSnapshot(attemptsPath, usagePath, { now })))
      .rejects.toBeInstanceOf(FileRuntimeStateImportConflictError);
    expect(client.usage).toHaveLength(0);
    expect(client.statements.some(({ sql }) => sql.startsWith("INSERT INTO"))).toBe(false);
    expect(client.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rolls back both tables if the second table write fails", async () => {
    const client = new FakeRuntimeStateClient();
    client.failUsageInsert = true;
    await expect(importFileRuntimeStateWithClient(client.asPoolClient(), await readFileRuntimeStateSnapshot(attemptsPath, usagePath, { now }))).rejects.toThrow(/synthetic insertion failure/);
    expect(client.attempts).toHaveLength(0);
    expect(client.usage).toHaveLength(0);
    expect(client.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("fails closed for the wrong database and stale schema revision", async () => {
    const snapshot = await readFileRuntimeStateSnapshot(attemptsPath, usagePath, { now });
    const wrongDatabase = new FakeRuntimeStateClient({ databaseName: "other" });
    await expect(importFileRuntimeStateWithClient(wrongDatabase.asPoolClient(), snapshot)).rejects.toThrow(/restricted/);
    expect(wrongDatabase.statements.some(({ sql }) => sql.startsWith("INSERT INTO"))).toBe(false);

    const oldSchema = new FakeRuntimeStateClient({ schemaVersion: 0 });
    await expect(importFileRuntimeStateWithClient(oldSchema.asPoolClient(), snapshot)).rejects.toThrow(/schema is not current/);
    expect(oldSchema.statements.some(({ sql }) => sql.startsWith("INSERT INTO"))).toBe(false);
  });

});
