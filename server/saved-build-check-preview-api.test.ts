import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { app } from "./index";
import { readSavedBuilds } from "./repository";
import { savedBuildCheckPreviewCache } from "./saved-build-check-cache";

describe("saved build check preview cache contract", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    server = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("reuses the current snapshot while preserving the monitor transition response", async () => {
    const build = (await readSavedBuilds()).find((candidate) => !candidate.expiresAt || Date.parse(candidate.expiresAt) > Date.now());
    expect(build).toBeDefined();
    savedBuildCheckPreviewCache.clear();
    const request = { ids: [build!.id] };
    const first = await fetch(`${baseUrl}/api/builds/check-preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
    const second = await fetch(`${baseUrl}/api/builds/check-preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get("x-pc-supporter-check-preview-cache")).toBe("MISS");
    expect(second.headers.get("x-pc-supporter-check-preview-cache")).toBe("HIT");
    const firstPayload = await first.json() as { items: Array<{ id: string; status: string; snapshot?: { catalogSnapshotAt: string }; transition?: unknown }> };
    const secondPayload = await second.json() as typeof firstPayload;
    expect(firstPayload.items[0]).toMatchObject({ id: build!.id, status: "ready" });
    expect(secondPayload.items[0]).toMatchObject({ id: build!.id, status: "ready" });
    expect(secondPayload.items[0]?.snapshot?.catalogSnapshotAt).toBe(firstPayload.items[0]?.snapshot?.catalogSnapshotAt);
    expect(secondPayload.items[0]?.transition).toEqual(firstPayload.items[0]?.transition);
  });
});
