import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeDatabase = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; values?: unknown[] }>,
  build: null as Record<string, unknown> | null,
  clientQueries: [] as Array<{ sql: string; values?: unknown[] }>
}));

vi.mock("pg", () => ({
  Pool: class {
    async query(sql: string, values?: unknown[]) {
      fakeDatabase.queries.push({ sql, values });
      if (sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected out-of-transaction PostgreSQL query: ${sql.slice(0, 100)}`);
    }

    async connect() {
      return {
        query: async (sql: string, values?: unknown[]) => {
          fakeDatabase.clientQueries.push({ sql, values });
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
          if (sql.includes("pg_advisory_xact_lock") || sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) return { rows: [], rowCount: 0 };
          if (sql.startsWith("SELECT name, decision_note, metadata_history FROM saved_builds")) {
            return { rows: fakeDatabase.build ? [{
              name: fakeDatabase.build.name,
              decision_note: fakeDatabase.build.decision_note,
              metadata_history: fakeDatabase.build.metadata_history
            }] : [], rowCount: fakeDatabase.build ? 1 : 0 };
          }
          if (sql.startsWith("UPDATE saved_builds SET name =")) {
            if (!fakeDatabase.build) return { rows: [], rowCount: 0 };
            const [id, name, decisionNote, updatedAt, metadataHistory] = values ?? [];
            fakeDatabase.build = {
              ...fakeDatabase.build,
              id,
              name,
              decision_note: decisionNote,
              updated_at: new Date(String(updatedAt)),
              metadata_history: JSON.parse(String(metadataHistory))
            };
            return { rows: [fakeDatabase.build], rowCount: 1 };
          }
          throw new Error(`Unexpected fake PostgreSQL client query: ${sql.slice(0, 100)}`);
        },
        release: () => undefined
      };
    }
  }
}));

describe("saved build metadata persistence", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;

  beforeEach(() => {
    vi.resetModules();
    fakeDatabase.queries = [];
    fakeDatabase.clientQueries = [];
    fakeDatabase.build = {
      id: "metadata-update-build",
      name: "Old name",
      selection: { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true },
      recommendation_preferences: null,
      created_at: new Date("2026-09-28T00:00:00.000Z"),
      updated_at: new Date("2026-09-28T00:00:00.000Z"),
      expires_at: null,
      owner_token_hash: "a".repeat(64),
      recovery_code_hash: null,
      my_pc_at: null,
      version_group_id: null,
      version_number: null,
      derived_from_build_id: null,
      check_snapshot: null,
      check_history: null,
      monitor_state: null,
      purchase_progress: null,
      purchase_price_history: null,
      decision_note: null,
      origin: null,
      metadata_history: null
    };
    process.env.DATABASE_URL = "postgres://synthetic.test/pc_supporter";
    process.env.PC_SUPPORTER_DATA_DIR = "/tmp/pc-supporter-metadata-update-test";
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
    else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
  });

  it("returns the committed row without a second pool read after the update", async () => {
    const { updateSavedBuildMetadata } = await import("./repository");

    const result = await updateSavedBuildMetadata("metadata-update-build", "New name", "선택 이유");

    expect(result).toMatchObject({ status: "updated", build: { id: "metadata-update-build", name: "New name", decisionNote: "선택 이유" } });
    const clientSql = fakeDatabase.clientQueries.map(({ sql }) => sql);
    expect(clientSql.filter((sql) => sql === "BEGIN")).toHaveLength(2);
    expect(clientSql.filter((sql) => sql === "COMMIT")).toHaveLength(2);
    expect(clientSql.some((sql) => sql.includes("pg_advisory_xact_lock(hashtextextended($1, 0))"))).toBe(true);
    expect(clientSql.filter((sql) => sql.startsWith("SELECT name, decision_note, metadata_history FROM saved_builds")
      || sql.startsWith("UPDATE saved_builds SET name ="))).toEqual([
      expect.stringMatching(/^SELECT name, decision_note, metadata_history FROM saved_builds/),
      expect.stringMatching(/^UPDATE saved_builds SET name = .* RETURNING /)
    ]);
    expect(fakeDatabase.queries.some(({ sql }) => sql.startsWith("SELECT id, name, selection"))).toBe(false);
  });
});
