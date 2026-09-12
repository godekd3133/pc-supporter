import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("watchlist share persistence API", () => {
  it("keeps public reads open while protecting patch, alerts, and delete with the owner token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-watchlist-share-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "";
    vi.resetModules();
    let server: Server | undefined;
    try {
      const [{ app }] = await Promise.all([import("./index")]);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated watchlist server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const entries = [{ itemId: "cpu-7800x3d", itemName: "AMD 라이젠7-5세대 7800X3D", category: "cpu", kind: "part", addedAt: "2026-09-09T00:00:00.000Z", targetPriceWon: 450_000 }];
      const create = await fetch(`${baseUrl}/api/watchlists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "가격 추적 공유", entries, nearLowThresholdPercent: 5, expiresInDays: 30 })
      });
      const created = await create.json() as Record<string, any>;
      expect(create.status).toBe(201);
      expect(created.ownerToken).toEqual(expect.any(String));
      expect(created.ownerTokenHash).toBeUndefined();

      const publicUrl = `${baseUrl}/api/watchlists/${created.id}`;
      const publicRead = await fetch(publicUrl);
      const publicPayload = await publicRead.json() as Record<string, any>;
      expect(publicRead.status).toBe(200);
      expect(publicPayload).toMatchObject({ id: created.id, name: "가격 추적 공유", nearLowThresholdPercent: 5 });
      expect(publicPayload.ownerTokenHash).toBeUndefined();

      const unauthorizedPatch = await fetch(publicUrl, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "ownerless mutation", entries, nearLowThresholdPercent: 5 }) });
      expect(unauthorizedPatch.status).toBe(401);
      expect(await unauthorizedPatch.json()).toMatchObject({ code: "SHARE_OWNER_AUTH_REQUIRED" });

      const patched = await fetch(publicUrl, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Share-Owner-Token": created.ownerToken }, body: JSON.stringify({ name: "가격 추적 수정", entries, nearLowThresholdPercent: 10 }) });
      expect(patched.status).toBe(200);
      expect(await patched.json()).toMatchObject({ name: "가격 추적 수정", nearLowThresholdPercent: 10 });

      const alerts = await fetch(`${publicUrl}/alerts`, { headers: { "X-Share-Owner-Token": created.ownerToken } });
      expect(alerts.status).toBe(200);
      expect(await alerts.json()).toMatchObject({ items: expect.any(Array), unreadCount: expect.any(Number) });

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
  });
});
