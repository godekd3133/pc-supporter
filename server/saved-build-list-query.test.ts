import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("saved build list query", () => {
  it("uses the default page size when limit is not finite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-saved-build-list-query-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    vi.resetModules();
    let server: Server | undefined;
    try {
      const [{ app }, { BUILDS_PATH, writeJson }] = await Promise.all([
        import("./index"),
        import("./storage")
      ]);
      const ids = ["saved-build-list-query-a", "saved-build-list-query-b"];
      await writeJson(BUILDS_PATH, ids.map((id) => ({
        id,
        name: id,
        selection,
        createdAt: "2026-09-09T00:00:00.000Z",
        updatedAt: "2026-09-09T00:00:00.000Z"
      })));

      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("saved build list test server did not expose a TCP port");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/builds?ids=${ids.join(",")}&limit=NaN`);
      const payload = await response.json() as { items?: Array<{ id?: string }> };
      const detailResponse = await fetch(`http://127.0.0.1:${address.port}/api/builds/${ids[0]}`);
      await detailResponse.arrayBuffer();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-ratelimit-limit")).toBe("120");
      expect(response.headers.get("x-ratelimit-remaining")).toBe("119");
      expect(detailResponse.headers.get("x-ratelimit-limit")).toBe("120");
      expect(detailResponse.headers.get("x-ratelimit-remaining")).toBe("119");
      expect(payload.items?.map((item) => item.id)).toEqual(ids);
    } finally {
      if (server) await closeServer(server);
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
