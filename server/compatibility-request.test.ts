import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { app } from "./index";

describe("compatibility request validation contract", () => {
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

  it("keeps invalid accessory IDs as IDs when the shared validation seam reports selection objects", async () => {
    const response = await fetch(`${baseUrl}/api/compatibility/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessories: [{ accessoryId: "missing-accessory", quantity: 1 }],
        useIntegratedGraphics: true
      })
    });

    expect(response.status).toBe(400);
    const payload = await response.json() as { accessoryIds?: unknown[] };
    expect(payload.accessoryIds).toEqual(["missing-accessory"]);
  });
});
