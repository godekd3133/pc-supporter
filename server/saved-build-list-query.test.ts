import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { truncatePostgresTables } from "./testkit/postgres";

const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("saved build list query", () => {
  it("uses the default page size when limit is not finite", async () => {
    vi.resetModules();
    const [repository, { app }] = await Promise.all([import("./repository"), import("./index")]);
    await repository.initializePersistence();
    await truncatePostgresTables();

    const ids = ["saved-build-list-query-a", "saved-build-list-query-b"];
    for (const id of ids) {
      await repository.appendSavedBuild({
        id,
        name: id,
        selection,
        createdAt: "2026-09-09T00:00:00.000Z",
        updatedAt: "2026-09-09T00:00:00.000Z"
      });
    }

    let server: Server | undefined;
    try {
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
      await repository.closePersistence();
      vi.resetModules();
    }
  }, 15_000);
});
