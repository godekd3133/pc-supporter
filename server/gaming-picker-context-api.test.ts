import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const fixture = vi.hoisted(() => {
  const cpu = (id: string, name: string, priceWon: number) => ({ id, name, category: "cpu", brand: "AMD", source: "danawa", dataQuality: "live", priceWon, listingType: "retail", updatedAt: new Date().toISOString(), priceCheckedAt: new Date().toISOString(), missingFields: [], specs: { cpuSeries: id === "old-5600" ? "Ryzen 5000" : "Ryzen 9000", socket: id === "old-5600" ? "AM4" : "AM5", memoryType: id === "old-5600" ? "DDR4" : "DDR5", tdpW: 65 } });
  return [cpu("old-5600", "AMD Ryzen 5600", 120000), cpu("new-9800", "AMD Ryzen 9800X3D", 500000), cpu("new-9950", "AMD Ryzen 9950X3D", 800000)];
});
vi.mock("./catalog", async (original) => ({ ...await original<typeof import("./catalog")>(), loadCatalog: async () => fixture }));
import { app } from "./index";

describe("explicit gaming picker public API scope", () => {
  let server: Server;
  let baseUrl: string;
  beforeAll(async () => {
    server = await new Promise<Server>((resolve) => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

  it("exposes old nominated CPUs only in the scoped list and keeps pagination bounded", async () => {
    const general = await fetch(`${baseUrl}/api/parts?category=cpu&limit=100`).then((response) => response.json()) as { items: Array<{ id: string }> };
    expect(general.items.map(({ id }) => id)).not.toContain("old-5600");
    const response = await fetch(`${baseUrl}/api/parts?category=cpu&quoteContext=gaming_testbed&limit=999&offset=0`);
    expect(response.status).toBe(200);
    const scoped = await response.json() as { items: Array<{ id: string }>; limit: number; total: number };
    expect(scoped.items.map(({ id }) => id)).toContain("old-5600");
    expect(scoped.total).toBe(3);
    expect(scoped.limit).toBe(100);
  });

  it("uses the scoped listing pool for facets without contaminating cached general options", async () => {
    const facets = async (suffix: string) => {
      const response = await fetch(`${baseUrl}/api/parts/facets?category=cpu${suffix}`);
      expect(response.status).toBe(200);
      return await response.json() as { options: { partCount: number; facetOptions: Record<string, { options: Array<{ value: string }> }> } };
    };
    const general = await facets("");
    const scoped = await facets("&quoteContext=gaming_testbed");
    expect(general.options.partCount).toBe(2);
    expect(general.options.facetOptions.socket.options.map(({ value }) => value)).toEqual(["AM5"]);
    expect(general.options.facetOptions.memoryType.options.map(({ value }) => value)).toEqual(["DDR5"]);
    expect(scoped.options.partCount).toBe(3);
    expect(scoped.options.facetOptions.socket.options.map(({ value }) => value)).toEqual(expect.arrayContaining(["AM4", "AM5"]));
    expect(scoped.options.facetOptions.memoryType.options.map(({ value }) => value)).toEqual(expect.arrayContaining(["DDR4", "DDR5"]));
    expect(await facets("")).toEqual(general);
  });

  it("rejects unknown and repeated scope values instead of silently opening a broader pool", async () => {
    for (const query of ["quoteContext=all", "quoteContext=gaming_testbed_extra", "quoteContext=gaming_testbed&quoteContext=gaming_testbed"]) {
      for (const path of ["/api/parts", "/api/parts/facets"]) {
        const response = await fetch(`${baseUrl}${path}?category=cpu&${query}`);
        expect(response.status).toBe(400);
        expect((await response.json() as { code: string }).code).toBe("INVALID_QUOTE_CONTEXT");
      }
    }
  });
});
