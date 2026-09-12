import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Part } from "../shared/types";

const { refreshDanawaPartMock } = vi.hoisted(() => ({ refreshDanawaPartMock: vi.fn() }));

vi.mock("./part-refresh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./part-refresh")>();
  return { ...actual, refreshDanawaPart: refreshDanawaPartMock };
});

async function closeServer(server: { close(callback: (error?: Error) => void): void }) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("catalog spec refresh history persistence API", () => {
  it("stores a successful batch result with filters and exposes it to admin history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-catalog-spec-refresh-history-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "";
    const sourcePart: Part = {
      id: "danawa-cpu-history-test",
      category: "cpu",
      name: "이력 테스트 CPU",
      source: "danawa",
      sourceProductCode: "history-test",
      danawaUrl: "https://prod.danawa.com/info/?pcode=history-test",
      rawSpecText: "CPU / 소켓: AM5",
      specs: { socket: "AM5" },
      dataQuality: "incomplete",
      missingFields: ["tdpW"],
      updatedAt: "2026-09-02T00:00:00.000Z"
    };
    refreshDanawaPartMock.mockResolvedValue({ ...sourcePart, rawSpecText: "CPU / 소켓: AM5 / TDP: 65W", specs: { ...sourcePart.specs, tdpW: 65 }, dataQuality: "live", missingFields: [], updatedAt: "2026-09-03T00:00:00.000Z" });
    vi.resetModules();
    let server: Server | undefined;
    try {
      const [{ app }, { CATALOG_PATH, writeJson }] = await Promise.all([import("./index"), import("./storage")]);
      await writeJson(CATALOG_PATH, [sourcePart]);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated catalog refresh history server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const refreshed = await fetch(`${baseUrl}/api/admin/catalog-spec/refresh-batch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partIds: [sourcePart.id], filters: { category: "cpu", priority: "medium", offset: 0, limit: 1 } }) });
      const refreshedPayload = await refreshed.json() as Record<string, any>;
      expect(refreshed.status).toBe(200);
      expect(refreshedPayload).toMatchObject({ schemaVersion: 1, kind: "catalog-spec-refresh-batch", historyPersisted: true, requestedCount: 1, refreshedCount: 1, skippedCount: 0, failedCount: 0, filters: { category: "cpu", priority: "medium", offset: 0, limit: 1 }, coverageBefore: { total: expect.any(Number), complete: expect.any(Number), partial: expect.any(Number), incompleteCount: expect.any(Number), coveragePercent: expect.any(Number) }, coverageAfter: { total: expect.any(Number), complete: expect.any(Number), partial: expect.any(Number), incompleteCount: expect.any(Number), coveragePercent: expect.any(Number) }, coverageDelta: { complete: expect.any(Number), partial: expect.any(Number), incompleteCount: expect.any(Number), coveragePercent: expect.any(Number) } });
      expect(refreshedPayload.coverageAfter.complete).toBeGreaterThanOrEqual(refreshedPayload.coverageBefore.complete);
      expect(refreshedPayload.coverageAfter.incompleteCount).toBeLessThanOrEqual(refreshedPayload.coverageBefore.incompleteCount);
      expect(refreshedPayload.impact).toMatchObject({ newlyCompletedCount: 1, newlyResolvedFieldCount: 1, newlyCompletedByCategory: [{ category: "cpu", count: 1 }] });
      expect(refreshedPayload.runId).toMatch(/^[0-9a-f-]{36}$/);
      expect(refreshDanawaPartMock).toHaveBeenCalledTimes(1);

      const history = await fetch(`${baseUrl}/api/admin/catalog-spec/refresh-history?limit=5`);
      const historyPayload = await history.json() as Record<string, any>;
      expect(history.status).toBe(200);
      expect(historyPayload.items).toHaveLength(1);
      expect(historyPayload.items[0]).toMatchObject({ runId: refreshedPayload.runId, requestedCount: 1, refreshedCount: 1, filters: { category: "cpu", priority: "medium" }, coverageBefore: refreshedPayload.coverageBefore, coverageAfter: refreshedPayload.coverageAfter, coverageDelta: refreshedPayload.coverageDelta, items: [{ partId: sourcePart.id, category: "cpu", status: "refreshed", nextMissingFields: [] }] });

      const progress = await fetch(`${baseUrl}/api/admin/catalog-spec/refresh-progress`);
      const progressPayload = await progress.json() as Record<string, any>;
      expect(progress.status).toBe(200);
      expect(progressPayload).toMatchObject({ runCount: 1, coverageRunCount: 1, totalRefreshedCount: 1, totalSkippedCount: 0, totalFailedCount: 0, newlyCompletedCount: 1, completedByCategory: [{ category: "cpu", count: 1 }], latestCoverageAfter: refreshedPayload.coverageAfter, coverageDelta: refreshedPayload.coverageDelta, points: [{ runId: refreshedPayload.runId, coveragePercent: refreshedPayload.coverageAfter.coveragePercent }] });
      expect(progressPayload.latestCoverageAfter.categories).toEqual(expect.any(Array));
      expect(progressPayload.coverageDelta.categories).toEqual(expect.arrayContaining([{ category: "cpu", complete: expect.any(Number), partial: expect.any(Number), incompleteCount: expect.any(Number), coveragePercent: expect.any(Number) }]));
    } finally {
      if (server) await closeServer(server);
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = previousAdminPassword;
      refreshDanawaPartMock.mockReset();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("persists PCIe evidence impact and exposes it in cumulative progress", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-catalog-spec-pcie-history-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "";
    const sourcePart: Part = {
      id: "danawa-motherboard-pcie-history-test",
      category: "motherboard",
      name: "PCIe evidence 이력 테스트 보드",
      source: "danawa",
      sourceProductCode: "pcie-history-test",
      danawaUrl: "https://prod.danawa.com/info/?pcode=pcie-history-test",
      rawSpecText: "메인보드 / 메모리: DDR5",
      specs: { socket: "AM5", memoryType: "DDR5" },
      dataQuality: "live",
      missingFields: [],
      updatedAt: "2026-09-02T00:00:00.000Z"
    };
    const refreshedPart: Part = {
      ...sourcePart,
      rawSpecText: "메인보드 / [확장슬롯]PCIe x16: 1개 / PCIe x8: 1개 / PCIe x4: 2개 / PCIe x1: 2개",
      specs: { ...sourcePart.specs, pcieX16Slots: 1, pcieX8Slots: 1, pcieX4Slots: 2, pcieX1Slots: 2 },
      updatedAt: "2026-09-03T00:00:00.000Z"
    };
    refreshDanawaPartMock.mockResolvedValue(refreshedPart);
    vi.resetModules();
    let server: Server | undefined;
    try {
      const [{ app }, { CATALOG_PATH, writeJson }] = await Promise.all([import("./index"), import("./storage")]);
      await writeJson(CATALOG_PATH, [sourcePart]);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated PCIe history server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const refreshed = await fetch(`${baseUrl}/api/admin/catalog-spec/refresh-batch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partIds: [sourcePart.id], filters: { category: "motherboard", evidence: "pcie", limit: 1 } }) });
      const refreshedPayload = await refreshed.json() as Record<string, any>;
      expect(refreshed.status).toBe(200);
      expect(refreshedPayload.pcieImpact).toEqual({ newlyCompleteCount: 1, newlyResolvedFieldCount: 4 });
      expect(refreshedPayload.items[0]).toMatchObject({ previousPcieMissingFields: ["pcieX16Slots", "pcieX8Slots", "pcieX4Slots", "pcieX1Slots"], nextPcieMissingFields: [] });
      const beforeX4 = refreshedPayload.coverageBefore.pcieSlotCoverage.byRequiredWidth[4];
      const afterX4 = refreshedPayload.coverageAfter.pcieSlotCoverage.byRequiredWidth[4];
      const x4Delta = refreshedPayload.coverageDelta.pcieSlotCoverage.byRequiredWidth[4];
      expect(beforeX4.total).toBeGreaterThan(0);
      expect(afterX4).toMatchObject({ total: beforeX4.total, complete: beforeX4.complete + 1, missing: beforeX4.missing - 1 });
      expect(x4Delta).toMatchObject({ complete: 1, missing: -1, coveragePercent: Number((afterX4.coveragePercent - beforeX4.coveragePercent).toFixed(1)) });

      const history = await fetch(`${baseUrl}/api/admin/catalog-spec/refresh-history?limit=5`);
      const historyPayload = await history.json() as Record<string, any>;
      expect(history.status).toBe(200);
      expect(historyPayload.items[0]).toMatchObject({ filters: { category: "motherboard", evidence: "pcie" }, pcieImpact: refreshedPayload.pcieImpact, coverageDelta: refreshedPayload.coverageDelta });

      const progress = await fetch(`${baseUrl}/api/admin/catalog-spec/refresh-progress`);
      const progressPayload = await progress.json() as Record<string, any>;
      expect(progress.status).toBe(200);
      expect(progressPayload).toMatchObject({ pcieNewlyCompleteCount: 1, pcieResolvedFieldCount: 4, latestCoverageAfter: refreshedPayload.coverageAfter, coverageDelta: refreshedPayload.coverageDelta, pcieFieldProgress: expect.arrayContaining([{ field: "pcieX4Slots", observed: 1, resolved: 1, remaining: 0, successPercent: 100 }]) });
    } finally {
      if (server) await closeServer(server);
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = previousAdminPassword;
      refreshDanawaPartMock.mockReset();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
