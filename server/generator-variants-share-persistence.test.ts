import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const payload = {
  type: "pc-supporter-generator-variants",
  version: 1,
  exportedAt: "2026-09-17T00:00:00.000Z",
  items: [{
    priority: "balanced",
    label: "균형형",
    status: "호환 가능",
    draft: {
      priority: "balanced",
      profile: "general",
      status: "compatible",
      selection: {},
      lines: [{ category: "cpu", partId: "cpu-1", name: "테스트 CPU", quantity: 1, priceWon: 300_000 }]
    }
  }]
};

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("generator variants share persistence API", () => {
  it("creates a public read-only snapshot and requires its owner token for revoke", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-generator-variants-share-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "";
    vi.resetModules();
    let server: Server | undefined;
    try {
      const { app } = await import("./index");
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated generator variants server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const create = await fetch(`${baseUrl}/api/generator-variants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "자동 구성 3안 공유", payload, request: { profile: "gaming", priority: "balanced", budgetWon: 1_500_000, includeGpu: true, gamingResolution: "1440p", gamingRefreshRate: 144, memoryCapacityGb: 32, storageCapacityGb: 1000, hddCount: 0, listingPolicy: "retail_only" }, expiresInDays: 30 })
      });
      const created = await create.json() as Record<string, any>;
      expect(create.status).toBe(201);
      expect(created.ownerToken).toEqual(expect.any(String));
      expect(created.ownerTokenHash).toBeUndefined();
      expect(created.payload).toMatchObject({ type: "pc-supporter-generator-variants", version: 1, items: [{ priority: "balanced" }] });
      expect(created.request).toMatchObject({ profile: "gaming", priority: "balanced", budgetWon: 1_500_000, includeGpu: true });

      const publicUrl = `${baseUrl}/api/generator-variants/${created.id}`;
      const publicRead = await fetch(publicUrl);
      const etag = publicRead.headers.get("etag");
      const publicPayload = await publicRead.json() as Record<string, any>;
      expect(publicRead.status).toBe(200);
      expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
      expect(publicPayload).toMatchObject({ id: created.id, name: "자동 구성 3안 공유", catalogChangedSinceShare: false });
      expect(publicPayload.request).toMatchObject({ profile: "gaming", priority: "balanced", budgetWon: 1_500_000, includeGpu: true });
      expect(publicPayload.ownerToken).toBeUndefined();
      expect(publicPayload.ownerTokenHash).toBeUndefined();
      const notModified = await fetch(publicUrl, { headers: { "If-None-Match": etag! } });
      expect(notModified.status).toBe(304);
      expect(await notModified.text()).toBe("");

      const unauthorizedDelete = await fetch(publicUrl, { method: "DELETE" });
      expect(unauthorizedDelete.status).toBe(401);
      const deleted = await fetch(publicUrl, { method: "DELETE", headers: { "X-Share-Owner-Token": created.ownerToken } });
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toEqual({ deleted: true });
      expect((await fetch(publicUrl)).status).toBe(404);
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
  }, 30_000);
});
