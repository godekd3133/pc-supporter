import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShareOwnerCredential } from "./build-share";
import { truncatePostgresTables } from "./testkit/postgres";

const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("public owner-token boundary", () => {
  const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousAdminPassword = process.env.ADMIN_PASSWORD;
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.resetModules();
    if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
    else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("requires an owner token when admin auth is disabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-owner-boundary-"));
    temporaryDirectories.push(directory);
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.ADMIN_PASSWORD = "";

    const [repository, { app }] = await Promise.all([
      import("./repository"),
      import("./index")
    ]);
    await repository.initializePersistence();
    await truncatePostgresTables();
    const buildId = "owner-boundary-build";
    const watchlistId = "owner-boundary-watchlist";
    const buildCredential = createShareOwnerCredential();
    const watchlistCredential = createShareOwnerCredential();
    await repository.writeSavedBuilds([{
      id: buildId,
      name: "Owner boundary build",
      selection,
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z",
      ownerTokenHash: buildCredential.hash
    }]);
    await repository.writeSavedWatchlists([{
      id: watchlistId,
      name: "Owner boundary watchlist",
      entries: [{ itemId: "cpu-1", itemName: "Test CPU", category: "cpu", kind: "part", addedAt: "2026-09-09T00:00:00.000Z" }],
      nearLowThresholdPercent: 5,
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z",
      ownerTokenHash: watchlistCredential.hash
    }]);

    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("owner boundary test server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const publicRead = await fetch(`${baseUrl}/api/builds/${buildId}`);
      expect(publicRead.status).toBe(200);
      expect(await publicRead.json()).not.toHaveProperty("ownerTokenHash");
      const requests: Array<Promise<Response>> = [
        fetch(`${baseUrl}/api/builds/${buildId}`, { method: "DELETE" }),
        fetch(`${baseUrl}/api/watchlists/${watchlistId}`, { method: "DELETE" }),
        fetch(`${baseUrl}/api/watchlists/${watchlistId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "stale mutation" }) }),
        fetch(`${baseUrl}/api/watchlists/${watchlistId}/alerts`),
        fetch(`${baseUrl}/api/watchlists/${watchlistId}/alerts/dismiss`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alertIds: [] }) })
      ];
      const responses = await Promise.all(requests);
      expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
      expect(responses[0].headers.get("x-ratelimit-limit")).toBe("120");
      expect(responses[1].headers.get("x-ratelimit-limit")).toBe("120");
      for (const response of responses) expect(await response.json()).toMatchObject({ code: "SHARE_OWNER_AUTH_REQUIRED" });

      expect(await repository.readSavedBuilds()).toHaveLength(1);
      expect(await repository.readSavedWatchlists()).toHaveLength(1);
    } finally {
      await closeServer(server);
    }
  }, 15_000);
});
