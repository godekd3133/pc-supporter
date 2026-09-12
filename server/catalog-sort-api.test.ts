import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { app } from "./index";

describe("catalog sort API", () => {
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

  it("accepts CPU benchmark sorting and falls back to price ordering outside CPU/GPU", async () => {
    const cpuResponse = await fetch(`${baseUrl}/api/parts?category=cpu&sort=benchmark_desc&limit=3`);
    expect(cpuResponse.status).toBe(200);
    const cpuPayload = await cpuResponse.json() as { items?: Array<{ category?: string }> };
    expect(cpuPayload.items).toHaveLength(3);
    expect(cpuPayload.items?.every((item) => item.category === "cpu")).toBe(true);

    const memoryResponse = await fetch(`${baseUrl}/api/parts?category=memory&sort=benchmark_desc&limit=24`);
    expect(memoryResponse.status).toBe(200);
    const memoryPayload = await memoryResponse.json() as { items?: Array<{ category?: string; priceWon?: unknown }> };
    expect(memoryPayload.items?.every((item) => item.category === "memory")).toBe(true);
    const knownPrices = (memoryPayload.items ?? [])
      .map((item) => item.priceWon)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
    expect(knownPrices).toEqual([...knownPrices].sort((left, right) => left - right));
  });
});
