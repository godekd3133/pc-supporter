import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// The meta payload intentionally exposes crawler status. Freeze that producer
// for this ETag contract so unrelated crawler tests cannot change the entity
// between the first and conditional request.
vi.mock("./crawler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./crawler")>();
  return {
    ...actual,
    readCrawlStatus: async () => ({
      status: "idle" as const,
      mode: "sample" as const,
      categoriesCompleted: 0,
      categoriesTotal: 9,
      pagesVisited: 0,
      pagesExpected: 0,
      listedProducts: 0,
      productsSeen: 0,
      productsUpdated: 0,
      detailFetched: 0,
      detailFailed: 0,
      failedProducts: 0,
      missingProducts: 0,
      incompleteSpecs: 0,
      coverage: "partial" as const,
      specCoverage: "partial" as const
    })
  };
});
import { app } from "./index";

describe("public read endpoint ETags", () => {
  let server: Server;
  let baseUrl = "";
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-05T12:00:00.000Z"));
    server = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    dateNowSpy.mockRestore();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it.each([
    ["meta", "/api/meta"],
    ["parts", "/api/parts?category=cpu&limit=1"],
    ["accessories", "/api/accessories?category=cooling_fan&limit=1"],
    ["price-history", "/api/price-history?ids=part%3Acpu-7800x3d&days=30"]
  ])("returns 304 for an unchanged %s response", async (_label, path) => {
    const first = await fetch(baseUrl + path);
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    if (path === "/api/meta") {
      const payload = await first.json() as { accessoryCategoryQualityCounts?: Record<string, Record<string, number>> };
      expect(payload.accessoryCategoryQualityCounts?.fan_hub).toMatchObject({ seed: expect.any(Number), live: expect.any(Number), incomplete: expect.any(Number) });
    }

    const second = await fetch(baseUrl + path, { headers: { "If-None-Match": etag! } });
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
    expect(await second.text()).toBe("");
  });
});
