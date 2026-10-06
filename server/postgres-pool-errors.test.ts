import { EventEmitter } from "node:events";
import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPostgresPoolErrorHandlers } from "./postgres-pool-errors";

function idleTransactionError() {
  return Object.assign(new Error("terminating connection due to idle-in-transaction timeout"), { code: "25P03" });
}

class FaultClient extends EventEmitter {
  queryable = true;
  releases: (boolean | undefined)[] = [];
  statements: string[] = [];

  constructor(private readonly returnToPool: (client: FaultClient, discard: boolean) => void) {
    super();
  }

  async query(statement: string) {
    this.statements.push(statement);
    if (!this.queryable) throw new Error("Client has encountered a connection error and is not queryable");
    return { rows: [] };
  }

  failConnection(error: Error) {
    // This is pg's fatal-connection behavior, unlike a SQL statement error.
    this.queryable = false;
    this.emit("error", error);
  }

  release(discard?: boolean) {
    this.releases.push(discard);
    this.returnToPool(this, Boolean(discard) || !this.queryable);
  }
}

class FaultPool extends EventEmitter {
  static instances: FaultPool[] = [];
  clients: FaultClient[] = [];
  idle: FaultClient[] = [];
  discarded: FaultClient[] = [];

  constructor() {
    super();
    FaultPool.instances.push(this);
  }

  async connect() {
    const idleClient = this.idle.pop();
    if (idleClient) return idleClient;
    const client = new FaultClient((returned, discard) => {
      if (discard) this.discarded.push(returned);
      else this.idle.push(returned);
    });
    this.clients.push(client);
    this.emit("connect", client);
    return client;
  }

  async query(statement: string) {
    const client = await this.connect();
    try {
      return await client.query(statement);
    } finally {
      client.release();
    }
  }

  async end() {}
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PostgreSQL pool connection errors", () => {
  it("handles a fatal checked-out client error without releasing the caller's connection", async () => {
    const pool = new FaultPool();
    const notify = vi.fn();
    registerPostgresPoolErrorHandlers(pool as unknown as Pool, notify);
    const client = await pool.connect();
    await client.query("BEGIN");
    const error = idleTransactionError();

    expect(() => client.failConnection(error)).not.toThrow();
    expect(notify).toHaveBeenCalledWith(error);
    expect(client.releases).toEqual([]);
    await expect(client.query("COMMIT")).rejects.toThrow(/not queryable/);
  });

  it("handles the pool's idle connection error event", () => {
    const pool = new FaultPool();
    const notify = vi.fn();
    registerPostgresPoolErrorHandlers(pool as unknown as Pool, notify);
    const error = new Error("idle connection closed");

    expect(() => pool.emit("error", error)).not.toThrow();
    expect(notify).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("keeps one listener and replaces the readiness callback across module reloads", async () => {
    const pool = new FaultPool();
    const originalNotify = vi.fn();
    registerPostgresPoolErrorHandlers(pool as unknown as Pool, originalNotify);
    const client = await pool.connect();
    // Repeated connect notifications must not duplicate a client listener.
    pool.emit("connect", client);

    vi.resetModules();
    const reloaded = await import("./postgres-pool-errors");
    const currentNotify = vi.fn();
    reloaded.registerPostgresPoolErrorHandlers(pool as unknown as Pool, currentNotify);
    reloaded.registerPostgresPoolErrorHandlers(pool as unknown as Pool, currentNotify);
    const error = idleTransactionError();
    client.failConnection(error);
    pool.emit("error", error);

    expect(pool.listenerCount("connect")).toBe(1);
    expect(pool.listenerCount("error")).toBe(1);
    expect(client.listenerCount("error")).toBe(1);
    expect(originalNotify).not.toHaveBeenCalled();
    expect(currentNotify).toHaveBeenCalledTimes(2);
  });
});

describe("repository connection failure lifecycle", () => {
  async function withFaultRepository(run: (repository: typeof import("./repository"), pool: FaultPool, advanceCooldown: () => void) => Promise<void>) {
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `postgres://connection-error.test/${crypto.randomUUID()}`;
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.doMock("pg", () => ({ Pool: FaultPool }));
    vi.doMock("./postgres-schema-contract", () => ({
      initializePostgresSchemaWithClient: async () => undefined,
      postgresSchemaInitializationModeForNodeEnv: () => "development-auto"
    }));
    vi.resetModules();
    let repository: typeof import("./repository") | undefined;
    try {
      repository = await import("./repository");
      await repository.initializePersistence();
      await run(repository, FaultPool.instances.at(-1)!, () => { now += 1_001; });
    } finally {
      if (repository) await repository.closePersistence();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      vi.doUnmock("pg");
      vi.doUnmock("./postgres-schema-contract");
      vi.resetModules();
    }
  }

  it("rejects callback work, discards the failed client, and recovers readiness using a fresh connection", async () => {
    await withFaultRepository(async (repository, pool, advanceCooldown) => {
      const error = idleTransactionError();
      await expect(repository.withPostgresTransaction("fault test", async (client: PoolClient) => {
        (client as unknown as FaultClient).failConnection(error);
        await client.query("SELECT 1");
      })).rejects.toThrow(/not queryable/);

      expect(pool.discarded).toEqual([pool.clients[0]]);
      expect(pool.clients[0].statements).toEqual(["BEGIN", "SELECT 1", "ROLLBACK"]);
      await expect(repository.persistenceDiagnostics()).resolves.toMatchObject({ ready: false, storageMode: "postgres" });

      advanceCooldown();
      await expect(repository.readCatalogRecords()).resolves.toEqual([]);
      expect(pool.clients).toHaveLength(2);
      await expect(repository.persistenceDiagnostics()).resolves.toMatchObject({ ready: true });
    });
  });

  it("rejects COMMIT when the client fails after callback work instead of reporting a successful transaction", async () => {
    await withFaultRepository(async (repository, pool) => {
      await expect(repository.withPostgresTransaction("commit fault test", async (client: PoolClient) => {
        (client as unknown as FaultClient).failConnection(idleTransactionError());
        return "must not be returned";
      })).rejects.toThrow(/not queryable/);

      expect(pool.clients[0].statements).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
      expect(pool.discarded).toEqual([pool.clients[0]]);
      await expect(repository.persistenceDiagnostics()).resolves.toMatchObject({ ready: false });
    });
  });

  it("updates the current repository readiness when a cached pool emits an idle error", async () => {
    await withFaultRepository(async (repository, pool) => {
      vi.resetModules();
      const currentRepository = await import("./repository");
      await currentRepository.initializePersistence();
      expect(FaultPool.instances.at(-1)).toBe(pool);
      pool.emit("error", new Error("idle connection closed"));

      await expect(currentRepository.persistenceDiagnostics()).resolves.toMatchObject({ ready: false });
      expect(pool.listenerCount("connect")).toBe(1);
      expect(pool.listenerCount("error")).toBe(1);
    });
  });
});
