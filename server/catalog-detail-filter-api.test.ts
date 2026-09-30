import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { app } from "./index";

// 공개 부품 찾기의 다나와식 세부 조건 — facet 정의/선택지 API와 dv./dr./df./
// db/dprice 쿼리 파라미터가 실제 라우트에서 어떻게 동작하는지 검증한다.
describe("catalog detail filter API", () => {
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

  it("exposes per-category facet definitions and value options", async () => {
    const response = await fetch(`${baseUrl}/api/parts/facets?category=ssd`);
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      category: string;
      facets: Array<{ id: string; kind: string; label: string }>;
      options: {
        partCount: number;
        brandOptions: Array<{ value: string; count: number }>;
        facetOptions: Record<string, { options: Array<{ value: string; count: number }>; missingCount: number }>;
        priceRange: { min: number; max: number } | null;
      };
    };
    expect(payload.category).toBe("ssd");
    const facetIds = payload.facets.map((facet) => `${facet.kind}:${facet.id}`);
    expect(facetIds).toEqual(expect.arrayContaining(["values:interface", "range:capacityGb", "price:price", "brands:brands"]));
    // values facet에는 선택지가 있어야 하고, facet 선언에 없는 필드는 내려오지 않는다.
    expect(payload.options.facetOptions.interface.options.length).toBeGreaterThan(0);
    expect(payload.options.facetOptions.socket).toBeUndefined();
    expect(payload.options.partCount).toBeGreaterThan(0);
    expect(payload.options.priceRange?.min).toBeGreaterThan(0);
  });

  it("requires a category for the facets endpoint", async () => {
    const response = await fetch(`${baseUrl}/api/parts/facets`);
    expect(response.status).toBe(400);
  });

  it("filters parts by multi-select spec values, numeric ranges, flags, brands, and price", async () => {
    const all = await fetch(`${baseUrl}/api/parts?category=ssd&limit=100`).then((response) => response.json()) as { items: Array<{ specs: Record<string, unknown>; brand?: string }>; total: number };

    const nvme = await fetch(`${baseUrl}/api/parts?category=ssd&dv.interface=NVMe&limit=100`).then((response) => response.json()) as { items: Array<{ specs: Record<string, unknown> }>; total: number; detailExcludedCount?: number };
    expect(nvme.total).toBeGreaterThan(0);
    expect(nvme.items.every((item) => item.specs.interface === "NVMe")).toBe(true);
    expect(nvme.detailExcludedCount).toBe(all.total - nvme.total);

    // 같은 필드의 복수 선택은 OR로 동작한다 — NVMe·SATA 합집합이 단일 선택보다 크거나 같다.
    const either = await fetch(`${baseUrl}/api/parts?category=ssd&dv.interface=NVMe,SATA&limit=100`).then((response) => response.json()) as { total: number };
    expect(either.total).toBeGreaterThanOrEqual(nvme.total);

    const sataBrands = await fetch(`${baseUrl}/api/parts?category=ssd&db=삼성전자&limit=100`).then((response) => response.json()) as { items: Array<{ brand?: string }>; total: number };
    expect(sataBrands.items.every((item) => (item.brand ?? "").replace(/\s+/g, "") === "삼성전자")).toBe(true);

    const priced = await fetch(`${baseUrl}/api/parts?category=ssd&dprice=-50000&limit=100`).then((response) => response.json()) as { items: Array<{ priceWon: number }>; total: number };
    expect(priced.items.every((item) => item.priceWon <= 50000)).toBe(true);

    const ranged = await fetch(`${baseUrl}/api/parts?category=ssd&dr.capacityGb=1000-&limit=100`).then((response) => response.json()) as { items: Array<{ specs: Record<string, unknown> }>; total: number };
    expect(ranged.items.every((item) => typeof item.specs.capacityGb === "number" && item.specs.capacityGb >= 1000)).toBe(true);

    const flagged = await fetch(`${baseUrl}/api/parts?category=motherboard&df.wifi=1&limit=100`).then((response) => response.json()) as { items: Array<{ specs: Record<string, unknown> }> };
    expect(flagged.items.every((item) => item.specs.wifi === true)).toBe(true);
  });

  it("drops facets the category does not declare and reports malformed conditions", async () => {
    // cpu에는 gpuVendor facet이 없다 — 선언되지 않은 조건은 버리고 결과를 좁히지 않는다.
    const [all, foreign] = await Promise.all([
      fetch(`${baseUrl}/api/parts?category=cpu&limit=1`).then((response) => response.json()) as Promise<{ total: number }>,
      fetch(`${baseUrl}/api/parts?category=cpu&dv.gpuVendor=nvidia&limit=1`).then((response) => response.json()) as Promise<{ total: number }>
    ]);
    expect(foreign.total).toBe(all.total);

    const badFlag = await fetch(`${baseUrl}/api/parts?category=motherboard&df.wifi=maybe`);
    expect(badFlag.status).toBe(400);
    const badField = await fetch(`${baseUrl}/api/parts?category=cpu&dv.notAField=x`);
    expect(badField.status).toBe(400);
  });
});
