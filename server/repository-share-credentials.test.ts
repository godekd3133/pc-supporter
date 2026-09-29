import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeDatabase = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; values?: unknown[] }>,
  build: null as Record<string, unknown> | null
}));

vi.mock("pg", () => ({
  Pool: class {
    async query(sql: string, values?: unknown[]) {
      fakeDatabase.queries.push({ sql, values });
      if (sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("UPDATE saved_builds SET owner_token_hash")) {
        const [id, ownerTokenHash, recoveryCodeHash, expectedRecoveryCodeHash] = values ?? [];
        if (!fakeDatabase.build || fakeDatabase.build.id !== id || fakeDatabase.build.recovery_code_hash !== expectedRecoveryCodeHash) {
          return { rows: [], rowCount: 0 };
        }
        fakeDatabase.build.owner_token_hash = ownerTokenHash;
        fakeDatabase.build.recovery_code_hash = recoveryCodeHash;
        return { rows: [{ id }], rowCount: 1 };
      }
      if (sql.startsWith("SELECT id, name, selection")) throw new Error("Credential CAS must not require a second database read.");
      throw new Error(`Unexpected fake PostgreSQL query: ${sql.slice(0, 100)}`);
    }

    async connect() {
      return {
        query: async (sql: string, values?: unknown[]) => {
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK"
            || sql.includes("pg_advisory_xact_lock") || sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) {
            return { rows: [], rowCount: 0 };
          }
          return this.query(sql, values);
        },
        release: () => undefined
      };
    }
  }
}));

describe("saved build credential compare-and-swap", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;

  beforeEach(() => {
    vi.resetModules();
    fakeDatabase.queries = [];
    fakeDatabase.build = {
      id: "postgres-recovery-race-build",
      name: "Synthetic recovery race fixture",
      selection: { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true },
      recommendation_preferences: null,
      created_at: new Date("2026-09-29T00:00:00.000Z"),
      updated_at: new Date("2026-09-29T00:00:00.000Z"),
      expires_at: null,
      owner_token_hash: "a".repeat(64),
      recovery_code_hash: "b".repeat(64),
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
    process.env.PC_SUPPORTER_DATA_DIR = "/tmp/pc-supporter-recovery-cas-test";
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
    else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
  });

  it("allows only one database update for the same expected recovery hash", async () => {
    const { updateSavedBuildShareCredentials } = await import("./repository");
    const buildId = "postgres-recovery-race-build";
    const previousRecoveryHash = "b".repeat(64);
    const credentialUpdates = await Promise.all([
      updateSavedBuildShareCredentials(buildId, "c".repeat(64), "d".repeat(64), previousRecoveryHash),
      updateSavedBuildShareCredentials(buildId, "e".repeat(64), "f".repeat(64), previousRecoveryHash)
    ]);

    expect(credentialUpdates.filter(Boolean)).toHaveLength(1);
    expect(fakeDatabase.build).toMatchObject({
      recovery_code_hash: expect.stringMatching(/^(d|f){64}$/),
      owner_token_hash: expect.stringMatching(/^(c|e){64}$/)
    });
    const updates = fakeDatabase.queries.filter(({ sql }) => sql.startsWith("UPDATE saved_builds SET owner_token_hash"));
    expect(updates).toHaveLength(2);
    expect(updates[0].sql).toContain("recovery_code_hash IS NOT DISTINCT FROM $4");
    expect(updates.every(({ values }) => values?.[3] === previousRecoveryHash)).toBe(true);
    expect(fakeDatabase.queries.some(({ sql }) => sql.startsWith("SELECT id, name, selection"))).toBe(false);
  });
});
