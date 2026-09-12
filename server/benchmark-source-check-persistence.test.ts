import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const { checkPhysicalSourceUrlMock } = vi.hoisted(() => ({ checkPhysicalSourceUrlMock: vi.fn() }));

vi.mock("./physical-source-check", () => ({ checkPhysicalSourceUrl: checkPhysicalSourceUrlMock }));

async function closeServer(server: { close(callback: (error?: Error) => void): void }) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("benchmark source-check persistence API", () => {
  it("checks, persists, and exposes benchmark source verification history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-benchmark-source-check-api-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "";
    checkPhysicalSourceUrlMock.mockResolvedValue({
      requestedUrl: "https://vendor.example/benchmark",
      checkedAt: "2026-09-03T00:00:00.000Z",
      status: "reachable",
      identityStatus: "matched",
      redirectCount: 0,
      finalUrl: "https://vendor.example/benchmark",
      httpStatus: 200,
      contentType: "text/html",
      detail: "등록한 모델을 확인했습니다."
    });
    vi.resetModules();
    let server: Server | undefined;
    try {
      const [{ app }, { BENCHMARK_OVERRIDES_PATH, writeJson }] = await Promise.all([import("./index"), import("./storage")]);
      await writeJson(BENCHMARK_OVERRIDES_PATH, {
        "cpu-7600": {
          partId: "cpu-7600",
          scores: { cinebenchR23Multi: 14500 },
          sourceKind: "official",
          sourceNote: "제조사 공식 측정표",
          sourceUrl: "https://vendor.example/benchmark",
          updatedAt: "2026-09-03T00:00:00.000Z"
        }
      });
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated benchmark source-check server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const checked = await fetch(`${baseUrl}/api/admin/benchmark-overrides/cpu-7600/source-check`, { method: "POST" });
      const checkedPayload = await checked.json() as Record<string, any>;
      expect(checked.status).toBe(200);
      expect(checkedPayload).toMatchObject({ persisted: true, historyRecorded: true, sourceCheck: { status: "reachable", identityStatus: "matched" }, override: { sourceCheck: { status: "reachable" } } });
      expect(checkPhysicalSourceUrlMock).toHaveBeenCalledWith("https://vendor.example/benchmark", "7600");

      const history = await fetch(`${baseUrl}/api/admin/benchmark-overrides/cpu-7600/source-check/history`);
      const historyPayload = await history.json() as Record<string, any>;
      expect(history.status).toBe(200);
      expect(historyPayload.entries).toHaveLength(1);
      expect(historyPayload.entries[0]).toMatchObject({ partId: "cpu-7600", transition: "initial", sourceCheck: { identityStatus: "matched" } });

      const part = await fetch(`${baseUrl}/api/parts/cpu-7600`);
      const partPayload = await part.json() as Record<string, any>;
      expect(part.status).toBe(200);
      expect(partPayload.specs.benchmarkProvenance.sourceCheck).toMatchObject({ status: "reachable", identityStatus: "matched" });
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
  }, 30_000);
});
