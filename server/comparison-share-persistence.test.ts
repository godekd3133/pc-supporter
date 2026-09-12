import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

async function closeServer(server: { close(callback: (error?: Error) => void): void }) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function candidate(id: string, priceWon: number) {
  return {
    name: `공유 GPU ${id}`,
    category: "gpu",
    partId: `gpu-${id}`,
    summary: "12GB · 220W · 244mm",
    price: `${priceWon.toLocaleString("ko-KR")}원`,
    priceWon,
    similarity: "동급 88점",
    performance: "현재 기준 성능 비교",
    compatibility: "호환 가능",
    dataQuality: "수동 검수"
  };
}

describe("alternative comparison persistence API", () => {
  it("preserves metadata, supports conditional reads, and revokes with the owner token", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-comparison-share-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    vi.resetModules();
    let server: Server | undefined;
    try {
      const [{ app }] = await Promise.all([import("./index")]);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated comparison server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const created = await fetch(`${baseUrl}/api/comparisons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "GPU 후보 전체 가상 비교",
          category: "그래픽카드",
          currentPartName: "기존 GPU",
          currentPartSummary: "PCIe 4.0 · VRAM 8GB",
          currentPartPrice: "450,000원",
          catalogSnapshotAt: "2026-09-02T01:02:03.000Z",
          engineVersion: "2.57.0",
          candidates: [candidate("one", 899000), candidate("two", 999000)],
          expiresInDays: 30
        })
      });
      const createdPayload = await created.json() as Record<string, any>;
      expect(created.status).toBe(201);
      expect(createdPayload.ownerToken).toEqual(expect.any(String));
      expect(createdPayload.ownerToken.length).toBeGreaterThanOrEqual(40);
      expect(createdPayload.catalogSnapshotAt).toBe("2026-09-02T01:02:03.000Z");
      expect(createdPayload.engineVersion).toBe("2.57.0");

      const comparisonUrl = `${baseUrl}/api/comparisons/${createdPayload.id}`;
      const first = await fetch(comparisonUrl);
      const etag = first.headers.get("etag");
      const publicPayload = await first.json() as Record<string, any>;
      expect(first.status).toBe(200);
      expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
      expect(publicPayload).toMatchObject({ currentPartName: "기존 GPU", currentPartSummary: "PCIe 4.0 · VRAM 8GB", currentPartPrice: "450,000원", catalogSnapshotAt: "2026-09-02T01:02:03.000Z", engineVersion: "2.57.0" });
      expect(publicPayload.ownerToken).toBeUndefined();
      expect(publicPayload.ownerTokenHash).toBeUndefined();

      const notModified = await fetch(comparisonUrl, { headers: { "If-None-Match": etag! } });
      expect(notModified.status).toBe(304);
      expect(notModified.headers.get("etag")).toBe(etag);
      expect(await notModified.text()).toBe("");

      const unauthenticatedDelete = await fetch(comparisonUrl, { method: "DELETE" });
      expect(unauthenticatedDelete.status).toBe(401);

      const revoked = await fetch(comparisonUrl, { method: "DELETE", headers: { "X-Share-Owner-Token": createdPayload.ownerToken } });
      expect(revoked.status).toBe(200);
      expect(await revoked.json()).toEqual({ deleted: true });

      const afterRevoke = await fetch(comparisonUrl);
      expect(afterRevoke.status).toBe(404);
    } finally {
      if (server) await closeServer(server);
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
