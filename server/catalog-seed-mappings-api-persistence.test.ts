import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Part } from "../shared/types";

const { checkPhysicalSourceUrlMock } = vi.hoisted(() => ({ checkPhysicalSourceUrlMock: vi.fn() }));

vi.mock("./physical-source-check", () => ({ checkPhysicalSourceUrl: checkPhysicalSourceUrlMock }));

async function closeServer(server: { close(callback: (error?: Error) => void): void }) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("catalog seed mapping API persistence", () => {
  it("suggests, approves, reloads, and removes a code mapping without mutating catalog.json", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-catalog-seed-mapping-api-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "";
    vi.resetModules();
    let server: Server | undefined;
    const candidate: Part = {
      id: "danawa-cpu-9600x-api",
      category: "cpu",
      name: "AMD 라이젠5-6세대 9600X (그래니트 릿지)",
      brand: "AMD",
      model: "AMD 라이젠5-6세대 9600X (그래니트 릿지)",
      danawaUrl: "https://prod.danawa.com/info/?pcode=9600x-api&cate=112747",
      source: "danawa",
      sourceProductCode: "9600x-api",
      sourceCategoryId: "112747",
      listingType: "retail",
      priceWon: 299_000,
      specs: { socket: "AM5", cores: 6 },
      dataQuality: "live",
      missingFields: [],
      updatedAt: "2026-09-03T00:00:00.000Z"
    };

    try {
      const [{ app }, { CATALOG_PATH, readJson, writeJson }] = await Promise.all([import("./index"), import("./storage")]);
      await writeJson(CATALOG_PATH, [candidate]);
      const catalogBefore = await readFile(CATALOG_PATH, "utf8");
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated mapping API server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const previewResponse = await fetch(`${baseUrl}/api/admin/catalog/seed-mapping-preview`);
      const preview = await previewResponse.json() as Record<string, any>;
      expect(previewResponse.status).toBe(200);
      expect(preview).toMatchObject({ schemaVersion: 1, kind: "catalog-seed-mapping-preview", readOnly: true, summary: { approvedCount: 0 } });
      const collectionQueueResponse = await fetch(`${baseUrl}/api/admin/catalog/seed-collection-queue`);
      const collectionQueue = await collectionQueueResponse.json() as Record<string, any>;
      expect(collectionQueueResponse.status).toBe(200);
      expect(collectionQueue).toMatchObject({ schemaVersion: 1, kind: "catalog-seed-collection-queue", readOnly: true, mappingMissingCount: expect.any(Number), queueFingerprint: expect.any(String), summary: { queueCount: expect.any(Number) } });
      const item = preview.items.find((entry: any) => entry.starter.id === "cpu-9600x");
      expect(item).toMatchObject({ status: "pending", candidates: [expect.objectContaining({ activePartId: candidate.id, activeSourceProductCode: candidate.sourceProductCode })] });

      const approvedResponse = await fetch(`${baseUrl}/api/admin/catalog/seed-mapping-reviews/cpu-9600x`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activePartId: candidate.id, status: "approved", note: "모델·다나와 상품 코드 확인" }) });
      const approved = await approvedResponse.json() as Record<string, any>;
      expect(approvedResponse.status).toBe(200);
      expect(approved).toMatchObject({ saved: true, review: { starterPartId: "cpu-9600x", category: "cpu", activePartId: candidate.id, activeSourceProductCode: candidate.sourceProductCode, status: "approved", note: "모델·다나와 상품 코드 확인" } });

      const reloadedResponse = await fetch(`${baseUrl}/api/admin/catalog/seed-mapping-preview`);
      const reloaded = await reloadedResponse.json() as Record<string, any>;
      expect(reloaded.summary).toMatchObject({ approvedCount: 1, staleCount: 0 });
      expect(reloaded.items.find((entry: any) => entry.starter.id === "cpu-9600x")).toMatchObject({ status: "approved", approvedMapping: { activePartId: candidate.id, activeSourceProductCode: candidate.sourceProductCode } });
      expect(await readFile(CATALOG_PATH, "utf8")).toBe(catalogBefore);
      expect((await readJson<unknown>(join(directory, "catalog-seed-mappings.json"), {}))).toMatchObject({ schemaVersion: 1, items: [expect.objectContaining({ starterPartId: "cpu-9600x" })] });

      const deletedResponse = await fetch(`${baseUrl}/api/admin/catalog/seed-mapping-reviews/cpu-9600x`, { method: "DELETE" });
      expect(deletedResponse.status).toBe(200);
      expect(await deletedResponse.json()).toMatchObject({ deleted: true, starterPartId: "cpu-9600x" });
      const clearedResponse = await fetch(`${baseUrl}/api/admin/catalog/seed-mapping-preview`);
      const cleared = await clearedResponse.json() as Record<string, any>;
      expect(cleared.summary.approvedCount).toBe(0);
    } finally {
      if (server) await closeServer(server);
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = previousAdminPassword;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("manually verifies an existing source code before saving a mapping that automatic matching could not find", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-catalog-seed-manual-mapping-api-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "";
    vi.resetModules();
    let server: Server | undefined;
    const sourceProductCode = "9600x-manual";
    const sourceUrl = `https://prod.danawa.com/info/?pcode=${sourceProductCode}&cate=112747`;
    const catalogPart: Part = {
      id: "danawa-cpu-manual-unmatched",
      category: "cpu",
      name: "상세 상품명 보강 대기",
      brand: "AMD",
      source: "danawa",
      sourceProductCode,
      sourceCategoryId: "112747",
      danawaUrl: sourceUrl,
      listingType: "retail",
      specs: { socket: "AM5", memoryType: "DDR5", cores: 6 },
      dataQuality: "incomplete",
      missingFields: ["model"],
      updatedAt: "2026-09-03T00:00:00.000Z"
    };
    const matchedSourceCheck = { requestedUrl: sourceUrl, checkedAt: "2026-09-03T00:02:00.000Z", status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0, finalUrl: sourceUrl, httpStatus: 200, contentType: "text/html", detail: "원문에서 상품 식별자를 확인했습니다." };

    try {
      const [{ app }, { CATALOG_PATH, readJson, writeJson }] = await Promise.all([import("./index"), import("./storage")]);
      await writeJson(CATALOG_PATH, [catalogPart]);
      const catalogBefore = await readFile(CATALOG_PATH, "utf8");
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated manual mapping API server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const beforeResponse = await fetch(`${baseUrl}/api/admin/catalog/seed-mapping-preview`);
      const before = await beforeResponse.json() as Record<string, any>;
      const beforeItem = before.items.find((entry: any) => entry.starter.id === "cpu-9600x");
      expect(beforeItem).toMatchObject({ status: "pending", candidates: [] });

      checkPhysicalSourceUrlMock.mockReset();
      checkPhysicalSourceUrlMock.mockResolvedValueOnce({ ...matchedSourceCheck, status: "identity_mismatch", identityStatus: "not_found", detail: "원문에서 다른 상품을 확인했습니다." }).mockResolvedValue(matchedSourceCheck);
      const rejectedResponse = await fetch(`${baseUrl}/api/admin/catalog/seed-mapping-reviews/cpu-9600x/manual-verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceProductCode, sourceUrl }) });
      expect(rejectedResponse.status).toBe(422);
      expect((await readJson<unknown>(join(directory, "catalog-seed-mappings.json"), {}))).toEqual({});

      const saveResponse = await fetch(`${baseUrl}/api/admin/catalog/seed-mapping-reviews/cpu-9600x/manual-verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceProductCode, sourceUrl }) });
      const saved = await saveResponse.json() as Record<string, any>;
      expect(saveResponse.status).toBe(200);
      expect(saved).toMatchObject({ saved: true, review: { starterPartId: "cpu-9600x", activePartId: catalogPart.id, activeSourceProductCode: sourceProductCode, sourceUrl, verification: { identityStatus: "matched", categoryMatched: true, coreSpecsMatched: true, sourceCheck: { status: "reachable", identityStatus: "matched" } } } });
      expect(checkPhysicalSourceUrlMock).toHaveBeenCalledWith(sourceUrl, expect.arrayContaining([catalogPart.name, "9600X", sourceProductCode]));

      const afterResponse = await fetch(`${baseUrl}/api/admin/catalog/seed-mapping-preview`);
      const after = await afterResponse.json() as Record<string, any>;
      expect(after.summary).toMatchObject({ approvedCount: 1, staleCount: 0 });
      expect(after.items.find((entry: any) => entry.starter.id === "cpu-9600x")).toMatchObject({ status: "approved", approvedMapping: { sourceUrl, verification: { identityStatus: "matched" } } });
      expect(await readFile(CATALOG_PATH, "utf8")).toBe(catalogBefore);
      expect(await readJson<unknown>(join(directory, "catalog-seed-mappings.json"), {})).toMatchObject({ schemaVersion: 1, items: [expect.objectContaining({ starterPartId: "cpu-9600x", sourceUrl })] });

      const deletedResponse = await fetch(`${baseUrl}/api/admin/catalog/seed-mapping-reviews/cpu-9600x`, { method: "DELETE" });
      expect(deletedResponse.status).toBe(200);
    } finally {
      if (server) await closeServer(server);
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = previousAdminPassword;
      checkPhysicalSourceUrlMock.mockReset();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
