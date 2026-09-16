import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { app } from "./index";

describe("budget ladder recommendation API", () => {
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

  it("generates economy, target, and headroom scenarios in one backend request", async () => {
    const response = await fetch(`${baseUrl}/api/builds/recommend/budget-ladder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: "gaming",
        priority: "balanced",
        budgetWon: 1_500_000,
        includeGpu: true,
        gamingResolution: "1080p",
        gamingRefreshRate: 144,
        memoryCapacityGb: 32,
        storageCapacityGb: 1_000,
        hddCapacityGb: 4_000,
        hddCount: 0,
        listingPolicy: "retail_only"
      })
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { scenarios: Array<{ id: string; budgetWon: number; request: { budgetWon: number }; draft?: unknown; error?: string }> };
    expect(body.scenarios).toHaveLength(3);
    expect(body.scenarios.map((scenario) => scenario.id)).toEqual(["economy", "target", "headroom"]);
    expect(body.scenarios.map((scenario) => scenario.budgetWon)).toEqual([1_200_000, 1_500_000, 1_800_000]);
    expect(body.scenarios.every((scenario) => scenario.request.budgetWon === scenario.budgetWon)).toBe(true);
    expect(body.scenarios.some((scenario) => scenario.draft !== undefined || scenario.error !== undefined)).toBe(true);
  });
});
