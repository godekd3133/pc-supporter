import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const selectionFor = (partId: string) => ({
  cpu: { partId, quantity: 1 },
  memory: [],
  ssd: [],
  hdd: [],
  accessories: [],
  useIntegratedGraphics: false
});

const itemFor = (id: "economy" | "target" | "headroom", budgetWon: number) => ({
  id,
  label: id,
  description: id,
  budgetWon,
  status: "호환 가능",
  totalPriceWon: budgetWon - 100_000,
  budgetDeltaWon: -100_000,
  withinBudget: true,
  priceComplete: true,
  blockerCount: 0,
  warningCount: 0,
  unknownCount: 0,
  analysisScore: 80,
  lines: [{ category: "cpu", text: `${id} CPU` }],
  selection: selectionFor(`${id}-cpu`)
});

const payload = {
  type: "pc-supporter-budget-ladder",
  version: 1,
  exportedAt: "2026-09-09T00:00:00.000Z",
  items: [itemFor("economy", 800_000), itemFor("target", 1_000_000), itemFor("headroom", 1_200_000)],
  changes: [
    { fromId: "economy", toId: "target", fromLabel: "절약형", toLabel: "목표 예산", budgetDeltaWon: 200_000, totalPriceDeltaWon: 200_000, blockerDelta: 0, warningDelta: 0, unknownDelta: 0, sameConfiguration: false, changedLines: [{ category: "cpu", label: "CPU", before: "절약형 CPU", after: "목표 예산 CPU" }] },
    { fromId: "target", toId: "headroom", fromLabel: "목표 예산", toLabel: "여유형", budgetDeltaWon: 200_000, totalPriceDeltaWon: 200_000, blockerDelta: 0, warningDelta: 0, unknownDelta: 0, sameConfiguration: false, changedLines: [{ category: "cpu", label: "CPU", before: "목표 예산 CPU", after: "여유형 CPU" }] }
  ]
};

const request = {
  profile: "gaming",
  budgetWon: 1_000_000,
  includeGpu: true,
  priority: "performance",
  gamingResolution: "1440p",
  gamingRefreshRate: 240,
  memoryCapacityGb: 32,
  storageCapacityGb: 1000,
  hddCount: 0,
  listingPolicy: "retail_only"
};

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("budget ladder share persistence API", () => {
  it("keeps the snapshot public while requiring its owner token for revoke", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-budget-ladder-share-"));
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
      if (!address || typeof address === "string") throw new Error("isolated budget ladder server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const create = await fetch(`${baseUrl}/api/budget-ladders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "예산 구간 공유", payload, request, expiresInDays: 30 })
      });
      const created = await create.json() as Record<string, any>;
      expect(create.status).toBe(201);
      expect(created.ownerToken).toEqual(expect.any(String));
      expect(created.ownerTokenHash).toBeUndefined();
      expect(created.payload).toMatchObject({ type: "pc-supporter-budget-ladder", items: [{ id: "economy" }, { id: "target" }, { id: "headroom" }] });

      const publicUrl = `${baseUrl}/api/budget-ladders/${created.id}`;
      const publicRead = await fetch(publicUrl);
      const publicPayload = await publicRead.json() as Record<string, any>;
      expect(publicRead.status).toBe(200);
      expect(publicPayload).toMatchObject({ id: created.id, name: "예산 구간 공유", catalogChangedSinceShare: false });
      expect(publicPayload.ownerTokenHash).toBeUndefined();

      const unauthorizedDelete = await fetch(publicUrl, { method: "DELETE" });
      expect(unauthorizedDelete.status).toBe(401);
      expect(await unauthorizedDelete.json()).toMatchObject({ code: "SHARE_OWNER_AUTH_REQUIRED" });
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
