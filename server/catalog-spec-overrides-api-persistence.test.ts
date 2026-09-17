import { mkdtemp, rm } from "node:fs/promises";
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

describe("catalog spec override API persistence", () => {
  it("validates, stores, applies, lists, and removes an override without changing the base catalog", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-catalog-spec-override-api-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "";
    vi.resetModules();
    let server: Server | undefined;
    const basePart: Part = {
      id: "api-override-gpu",
      category: "gpu",
      name: "API override GPU",
      source: "manual",
      specs: { vramGb: 16 },
      dataQuality: "incomplete",
      missingFields: ["powerW"],
      updatedAt: "2026-09-01T00:00:00.000Z"
    };
    try {
      const [{ app }, { CATALOG_PATH, readJson, writeJson }] = await Promise.all([import("./index"), import("./storage")]);
      await writeJson(CATALOG_PATH, [basePart]);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated override API server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const input = { items: [{ partId: basePart.id, category: "gpu", fields: { powerW: 320 }, manufacturerModel: "API-GPU-16", sourceNote: "제조사 공식 사양서 4쪽", sourceUrl: "https://vendor.example/api-gpu" }] };

      const validationResponse = await fetch(`${baseUrl}/api/admin/catalog-spec-overrides/batch/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const validation = await validationResponse.json() as Record<string, any>;
      expect(validationResponse.status).toBe(200);
      expect(validation).toMatchObject({ validCount: 1, invalidCount: 0, items: [{ operation: "create", changedFields: ["powerW"] }] });

      const savedResponse = await fetch(`${baseUrl}/api/admin/catalog-spec-overrides/batch`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const saved = await savedResponse.json() as Record<string, any>;
      expect(savedResponse.status).toBe(200);
      expect(saved).toMatchObject({ saved: true, count: 1, items: [{ partId: basePart.id, category: "gpu", fields: { powerW: 320 }, partName: basePart.name, remainingMissingFields: [] }] });

      const appliedResponse = await fetch(`${baseUrl}/api/parts/${basePart.id}`);
      const applied = await appliedResponse.json() as Record<string, any>;
      expect(appliedResponse.status).toBe(200);
      expect(applied).toMatchObject({ dataQuality: "manual", missingFields: [], specs: { vramGb: 16, powerW: 320, catalogSpecProvenance: { fields: ["powerW"], manufacturerModel: "API-GPU-16" } } });

      const sourceCheckCheckedAt = new Date().toISOString();
      checkPhysicalSourceUrlMock.mockResolvedValue({ requestedUrl: "https://vendor.example/api-gpu", checkedAt: sourceCheckCheckedAt, status: "reachable", identityStatus: "matched", redirectCount: 0, finalUrl: "https://vendor.example/api-gpu", httpStatus: 200, contentType: "text/html", detail: "등록한 제조사 모델/SKU를 확인했습니다." });
      const sourceCheckResponse = await fetch(`${baseUrl}/api/admin/catalog-spec-overrides/${basePart.id}/source-check`, { method: "POST" });
      const sourceCheck = await sourceCheckResponse.json() as Record<string, any>;
      expect(sourceCheckResponse.status).toBe(200);
      expect(sourceCheck).toMatchObject({ persisted: true, historyRecorded: true, sourceCheck: { status: "reachable", identityStatus: "matched" }, override: { sourceCheck: { status: "reachable", identityStatus: "matched" } }, part: { specs: { catalogSpecProvenance: { sourceCheck: { identityStatus: "matched" } } } } });

      const sourceHistoryResponse = await fetch(`${baseUrl}/api/admin/catalog-spec-overrides/${basePart.id}/source-check/history`);
      const sourceHistory = await sourceHistoryResponse.json() as Record<string, any>;
      expect(sourceHistoryResponse.status).toBe(200);
      expect(sourceHistory.entries).toHaveLength(1);
      expect(sourceHistory.entries[0]).toMatchObject({ partId: basePart.id, transition: "initial", sourceCheck: { identityStatus: "matched" } });

      const batchResponse = await fetch(`${baseUrl}/api/admin/catalog-spec-overrides/source-check/batch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partIds: [basePart.id, "missing-override"], limit: 50 }) });
      const batch = await batchResponse.json() as Record<string, any>;
      expect(batchResponse.status).toBe(200);
      expect(batch).toMatchObject({ persisted: true, totalCandidates: 1, checkedCount: 1, passedCount: 1, reviewCount: 0, persistedCount: 1, persistFailureCount: 0, items: [{ partId: basePart.id, sourceCheck: { status: "reachable", identityStatus: "matched" }, persisted: true }], skipped: [{ partId: "missing-override" }] });

      const listResponse = await fetch(`${baseUrl}/api/admin/catalog-spec-overrides`);
      const listed = await listResponse.json() as Record<string, any>;
      expect(listResponse.status).toBe(200);
      expect(listed.items).toHaveLength(1);

      const deletedResponse = await fetch(`${baseUrl}/api/admin/catalog-spec-overrides/${basePart.id}`, { method: "DELETE" });
      const deleted = await deletedResponse.json() as Record<string, any>;
      expect(deletedResponse.status).toBe(200);
      expect(deleted).toMatchObject({ deleted: true, partId: basePart.id, part: { dataQuality: "incomplete", missingFields: ["powerW"] } });

      const restoredResponse = await fetch(`${baseUrl}/api/parts/${basePart.id}`);
      const restored = await restoredResponse.json() as Record<string, any>;
      expect(restoredResponse.status).toBe(200);
      expect(restored).toEqual({ ...basePart, dataFreshness: expect.any(String) });
      expect(await readJson<Record<string, unknown>>(join(directory, "catalog-spec-overrides.json"), {})).toEqual({});
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
