import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const baseSelection = { cpu: { partId: "cpu-7500f", quantity: 1 }, memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("saved build version comparison share API", () => {
  it("creates an owner-protected snapshot, serves it read-only, and revokes it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-version-comparison-share-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    vi.resetModules();
    let server: Server | undefined;
    try {
      const { app } = await import("./index");
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated version comparison server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const create = async (body: Record<string, unknown>, token?: string) => fetch(`${baseUrl}/api/builds`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "X-Share-Owner-Token": token } : {}) }, body: JSON.stringify(body) });
      const firstResponse = await create({ name: "버전 비교 원본", selection: baseSelection, decisionNote: "호환성을 우선" });
      const first = await firstResponse.json() as Record<string, any>;
      expect(firstResponse.status).toBe(201);
      const secondResponse = await create({ name: "버전 비교 수정", selection: { ...baseSelection, useIntegratedGraphics: false }, parentBuildId: first.id, decisionNote: "변경 후 다시 확인" }, first.ownerToken);
      const second = await secondResponse.json() as Record<string, any>;
      expect(secondResponse.status).toBe(201);
      expect(second.versionNumber).toBe(2);

      const unauthorizedCreate = await fetch(`${baseUrl}/api/version-comparisons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ beforeBuildId: first.id, afterBuildId: second.id }) });
      expect(unauthorizedCreate.status).toBe(401);
      const createShare = await fetch(`${baseUrl}/api/version-comparisons`, { method: "POST", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": second.ownerToken }, body: JSON.stringify({ name: "원본·수정 버전 공유", beforeBuildId: first.id, afterBuildId: second.id, expiresInDays: 30 }) });
      const shared = await createShare.json() as Record<string, any>;
      expect(createShare.status).toBe(201);
      expect(shared.ownerToken).toEqual(expect.any(String));
      expect(shared.payload).toMatchObject({ schemaVersion: 1, kind: "pc-supporter.saved-build-version-comparison-share", before: { id: first.id, label: "v1" }, after: { id: second.id, label: "v2" } });
      expect(shared.payload.text).toContain("PC Supporter 저장 견적 버전 비교");
      expect(shared.payload.ownerToken).toBeUndefined();
      expect(shared.ownerTokenHash).toBeUndefined();

      const publicUrl = `${baseUrl}/api/version-comparisons/${shared.id}`;
      const publicResponse = await fetch(publicUrl);
      const etag = publicResponse.headers.get("etag");
      const publicPayload = await publicResponse.json() as Record<string, any>;
      expect(publicResponse.status).toBe(200);
      expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
      expect(publicPayload.payload.kind).toBe("pc-supporter.saved-build-version-comparison-share");
      expect(publicPayload.ownerToken).toBeUndefined();
      expect(publicPayload.ownerTokenHash).toBeUndefined();
      const notModified = await fetch(publicUrl, { headers: { "If-None-Match": etag! } });
      expect(notModified.status).toBe(304);
      expect(await notModified.text()).toBe("");

      const mismatched = await create({ name: "독립 견적", selection: baseSelection });
      const independent = await mismatched.json() as Record<string, any>;
      const lineageMismatch = await fetch(`${baseUrl}/api/version-comparisons`, { method: "POST", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": second.ownerToken }, body: JSON.stringify({ beforeBuildId: independent.id, afterBuildId: second.id }) });
      expect(lineageMismatch.status).toBe(400);
      expect((await lineageMismatch.json()).code).toBe("VERSION_COMPARISON_LINEAGE_MISMATCH");

      const unauthorizedDelete = await fetch(publicUrl, { method: "DELETE" });
      expect(unauthorizedDelete.status).toBe(401);
      const deleteResponse = await fetch(publicUrl, { method: "DELETE", headers: { "X-Share-Owner-Token": shared.ownerToken } });
      expect(deleteResponse.status).toBe(200);
      expect(await deleteResponse.json()).toEqual({ deleted: true });
      expect((await fetch(publicUrl)).status).toBe(404);
    } finally {
      if (server) await closeServer(server);
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
