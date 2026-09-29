import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Part } from "../shared/types";

type IsolatedBackend = {
  directory: string;
  storage: typeof import("./storage");
  repository: typeof import("./repository");
  baseUrl: string;
};

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withIsolatedBackend(databaseUrl: string | undefined, run: (backend: IsolatedBackend) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "pc-supporter-persistence-mode-"));
  const keys = ["PC_SUPPORTER_DATA_DIR", "DATABASE_URL", "BUILD_MONITOR_SCHEDULER_ENABLED", "DANAWA_CRAWL_ON_START"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]])) as Record<(typeof keys)[number], string | undefined>;
  let server: Server | undefined;
  let repository: IsolatedBackend["repository"] | undefined;

  try {
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    if (databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = databaseUrl;
    process.env.BUILD_MONITOR_SCHEDULER_ENABLED = "false";
    process.env.DANAWA_CRAWL_ON_START = "false";
    vi.resetModules();

    const storage = await import("./storage");
    repository = await import("./repository");
    const { app } = await import("./index");
    server = await new Promise<Server>((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("isolated persistence API did not expose a TCP port");

    await run({ directory, storage, repository, baseUrl: `http://127.0.0.1:${address.port}` });
  } finally {
    if (server) await closeServer(server);
    if (repository) await repository.closePersistence();
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
    await rm(directory, { recursive: true, force: true });
  }
}

const preparedLocalPart: Part = {
  id: "local-only-catalog-record",
  category: "cpu",
  name: "Local JSON record that must not be served",
  source: "manual",
  specs: {},
  dataQuality: "incomplete",
  missingFields: [],
  updatedAt: "2026-09-29T00:00:00.000Z"
};

describe("persistence backend selection", () => {
  it("keeps PostgreSQL authoritative and reports unhealthy when the configured database cannot connect", async () => {
    await withIsolatedBackend("postgresql://pc_supporter:pc_supporter@127.0.0.1:1/pc_supporter?connect_timeout=1", async ({ storage, repository, baseUrl }) => {
      await storage.writeJson(storage.CATALOG_PATH, [preparedLocalPart]);

      await expect(repository.persistenceMode()).resolves.toBe("postgres");
      await expect(repository.readCatalogRecords()).rejects.toThrow(/connect|PostgreSQL/i);
      expect(await storage.readJson<Part[]>(storage.CATALOG_PATH, [])).toEqual([preparedLocalPart]);

      const catalogResponse = await fetch(`${baseUrl}/api/parts`);
      expect(catalogResponse.status).toBe(503);
      expect(catalogResponse.headers.get("retry-after")).toBe("1");
      expect(await catalogResponse.json()).toMatchObject({ code: "PERSISTENCE_UNAVAILABLE" });

      const response = await fetch(`${baseUrl}/api/health`);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        ok: false,
        persistence: {
          databaseConfigured: true,
          storageMode: "postgres",
          ready: false,
          unavailableReason: "database_unavailable"
        }
      });
    });
  });

  it("uses local JSON and stays healthy when DATABASE_URL is absent", async () => {
    await withIsolatedBackend(undefined, async ({ storage, repository, baseUrl }) => {
      await storage.writeJson(storage.CATALOG_PATH, [preparedLocalPart]);

      await expect(repository.persistenceMode()).resolves.toBe("file");
      await expect(repository.readCatalogRecords()).resolves.toEqual([preparedLocalPart]);
      await expect(repository.persistenceDiagnostics()).resolves.toMatchObject({ databaseConfigured: false, storageMode: "file", ready: true });

      const response = await fetch(`${baseUrl}/api/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        persistence: { databaseConfigured: false, storageMode: "file", ready: true }
      });

      await writeFile(storage.CATALOG_PATH, "{\"parts\":[", "utf8");
      await expect(repository.readCatalogRecords()).rejects.toThrow(SyntaxError);
      await expect(repository.persistenceDiagnostics()).resolves.toMatchObject({
        databaseConfigured: false,
        storageMode: "file",
        ready: false,
        unavailableReason: "file_storage_unavailable"
      });

      await storage.writeJson(storage.CATALOG_PATH, [preparedLocalPart]);
      await expect(repository.persistenceDiagnostics()).resolves.toMatchObject({ ready: true });

      const malformedBuilds = [{ id: "invalid-build", name: 7, selection: null, createdAt: "invalid", updatedAt: "invalid" }];
      await storage.writeJson(storage.BUILDS_PATH, malformedBuilds);
      const originalBuilds = await readFile(storage.BUILDS_PATH, "utf8");
      await expect(repository.readSavedBuilds()).rejects.toThrow(/safely interpret|안전하게 해석/i);
      await expect(readFile(storage.BUILDS_PATH, "utf8")).resolves.toBe(originalBuilds);
    });
  });

  it("retries PostgreSQL after a bounded cooldown and recovers without reading the local catalog", async () => {
    let databaseAvailable = false;
    const queryMock = vi.fn(async (statement: string) => {
      if (!databaseAvailable) throw new Error("connect ECONNREFUSED fake-postgres");
      if (statement.startsWith("SELECT payload FROM catalog_parts")) return { rows: [] };
      return { rows: [] };
    });

    vi.doMock("pg", () => ({
      Pool: class FakePool {
        query = queryMock;
        connect = async () => ({ query: queryMock, release: () => undefined });
        end = async () => undefined;
      }
    }));

    try {
      await withIsolatedBackend("postgresql://pc_supporter:pc_supporter@127.0.0.1:5432/pc_supporter", async ({ storage, repository, baseUrl }) => {
        await storage.writeJson(storage.CATALOG_PATH, [preparedLocalPart]);

        await expect(repository.initializePersistence()).rejects.toThrow(/ECONNREFUSED/);
        const attemptsAfterFailure = queryMock.mock.calls.length;
        await expect(repository.readCatalogRecords()).rejects.toThrow(/retry is deferred/);
        await expect(repository.persistenceDiagnostics()).resolves.toMatchObject({ storageMode: "postgres", ready: false });
        expect(queryMock).toHaveBeenCalledTimes(attemptsAfterFailure);

        databaseAvailable = true;
        await new Promise((resolve) => setTimeout(resolve, 1_050));

        await expect(repository.persistenceDiagnostics()).resolves.toMatchObject({ databaseConfigured: true, storageMode: "postgres", ready: true });
        await expect(repository.readCatalogRecords()).resolves.toEqual([]);
        expect(await storage.readJson<Part[]>(storage.CATALOG_PATH, [])).toEqual([preparedLocalPart]);

        const response = await fetch(`${baseUrl}/api/health`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ ok: true, persistence: { storageMode: "postgres", ready: true } });
      });
    } finally {
      vi.doUnmock("pg");
      vi.resetModules();
    }
  });
});
