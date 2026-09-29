import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeDatabase = vi.hoisted(() => ({
  activeLocks: new Set<string>(),
  failUnlock: false,
  discardedConnections: 0
}));

vi.mock("pg", () => ({
  Pool: class {
    async query(sql: string) {
      if (sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected fake PostgreSQL query: ${sql.slice(0, 100)}`);
    }

    async connect() {
      let ownedLock: string | undefined;
      return {
        query: async (sql: string, values?: unknown[]) => {
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK"
            || sql.includes("pg_advisory_xact_lock") || sql.includes("CREATE TABLE IF NOT EXISTS catalog_parts")) {
            return { rows: [], rowCount: 0 };
          }
          const lockKey = String(values?.[0] ?? "");
          if (sql.includes("pg_try_advisory_lock")) {
            const acquired = !fakeDatabase.activeLocks.has(lockKey);
            if (acquired) {
              fakeDatabase.activeLocks.add(lockKey);
              ownedLock = lockKey;
            }
            return { rows: [{ acquired }], rowCount: 1 };
          }
          if (sql.includes("pg_advisory_unlock")) {
            if (fakeDatabase.failUnlock) throw new Error("synthetic unlock failure");
            const released = fakeDatabase.activeLocks.delete(lockKey);
            if (released) ownedLock = undefined;
            return { rows: [{ pg_advisory_unlock: released }], rowCount: 1 };
          }
          throw new Error(`Unexpected fake PostgreSQL client query: ${sql.slice(0, 100)}`);
        },
        release: (discard?: Error | boolean) => {
          if (discard && ownedLock) {
            fakeDatabase.activeLocks.delete(ownedLock);
            ownedLock = undefined;
            fakeDatabase.discardedConnections += 1;
          }
        }
      };
    }
  }
}));

describe("shared background job lease", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;

  beforeEach(() => {
    vi.resetModules();
    fakeDatabase.activeLocks = new Set();
    fakeDatabase.failUnlock = false;
    fakeDatabase.discardedConnections = 0;
    process.env.DATABASE_URL = "postgres://synthetic.test/pc_supporter";
    process.env.PC_SUPPORTER_DATA_DIR = "/tmp/pc-supporter-background-lease-test";
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
    else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
  });

  it("admits one PostgreSQL runner per scope and releases the advisory lock", async () => {
    const { withBackgroundJobLease } = await import("./repository");
    let signalStarted!: () => void;
    let releaseOperation!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const blockedOperation = new Promise<void>((resolve) => { releaseOperation = resolve; });
    let executions = 0;

    const first = withBackgroundJobLease("price-refresh", async () => {
      executions += 1;
      signalStarted();
      await blockedOperation;
      return "completed";
    });
    await started;

    const second = await withBackgroundJobLease("price-refresh", async () => {
      executions += 1;
      return "duplicate";
    });
    expect(second).toEqual({ backend: "postgres", acquired: false });
    expect(executions).toBe(1);

    releaseOperation();
    await expect(first).resolves.toEqual({ backend: "postgres", acquired: true, value: "completed" });
    expect(fakeDatabase.activeLocks.size).toBe(0);
  });

  it("discards a database connection if releasing its advisory lock fails", async () => {
    const { withBackgroundJobLease } = await import("./repository");
    fakeDatabase.failUnlock = true;

    await expect(withBackgroundJobLease("price-refresh", async () => "completed"))
      .resolves.toEqual({ backend: "postgres", acquired: true, value: "completed" });
    expect(fakeDatabase.discardedConnections).toBe(1);
    expect(fakeDatabase.activeLocks.size).toBe(0);
  });
});
