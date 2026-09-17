import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { app } from "./index";

describe("recommendation variants API", () => {
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

  it("generates all comparison priorities from one catalog request", async () => {
    const response = await fetch(`${baseUrl}/api/builds/recommend/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: "gaming",
        priority: "balanced",
        budgetWon: 1_500_000,
        includeGpu: true,
        gamingResolution: "4k",
        gamingRefreshRate: 144,
        gamingGameIds: ["cyberpunk"],
        gamingGraphicsPreset: "high",
        gamingRayTracing: true,
        gamingUpscaling: "quality",
        memoryCapacityGb: 32,
        storageCapacityGb: 1_000,
        hddCapacityGb: 4_000,
        hddCount: 0,
        listingPolicy: "retail_only"
      })
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { variants: Array<{ priority: string; draft?: { budgetWon: number }; error?: string }> };
    expect(body.variants).toHaveLength(3);
    expect(body.variants.map((variant) => variant.priority)).toEqual(["balanced", "budget", "performance"]);
    expect(body.variants.every((variant) => variant.draft?.budgetWon === 1_500_000 || typeof variant.error === "string")).toBe(true);
  });
});
