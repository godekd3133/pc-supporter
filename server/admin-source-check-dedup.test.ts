import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const { checkPhysicalSourceUrlMock } = vi.hoisted(() => ({ checkPhysicalSourceUrlMock: vi.fn() }));

vi.mock("./physical-source-check", () => ({ checkPhysicalSourceUrl: checkPhysicalSourceUrlMock }));

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitForMockCall() {
  for (let index = 0; index < 100 && checkPhysicalSourceUrlMock.mock.calls.length === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  expect(checkPhysicalSourceUrlMock).toHaveBeenCalledTimes(1);
}

function checkedSource() {
  return {
    requestedUrl: "https://vendor.example/source-check",
    checkedAt: "2026-09-09T00:00:00.000Z",
    status: "reachable",
    identityStatus: "matched",
    redirectCount: 0,
    finalUrl: "https://vendor.example/source-check",
    httpStatus: 200,
    contentType: "text/html",
    detail: "등록한 모델을 확인했습니다."
  } as const;
}

describe("admin source-check deduplication", () => {
  it("rejects an in-flight duplicate and cools down benchmark checks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-benchmark-source-check-dedup-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "";
    checkPhysicalSourceUrlMock.mockReset().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(checkedSource()), 200)));
    vi.resetModules();
    let server: Server | undefined;
    try {
      const [{ app }, { BENCHMARK_OVERRIDES_PATH, writeJson }] = await Promise.all([import("./index"), import("./storage")]);
      await writeJson(BENCHMARK_OVERRIDES_PATH, { "cpu-7600": { partId: "cpu-7600", scores: { cinebenchR23Multi: 14500 }, sourceKind: "official", sourceNote: "제조사 공식 측정표", sourceUrl: "https://vendor.example/source-check", updatedAt: "2026-09-09T00:00:00.000Z" } });
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("benchmark source-check dedup server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const check = () => fetch(`${baseUrl}/api/admin/benchmark-overrides/cpu-7600/source-check?persist=false`, { method: "POST" });
      const firstRequest = check();
      await waitForMockCall();
      const duplicate = await check();
      expect(duplicate.status).toBe(409);
      expect(await duplicate.json()).toMatchObject({ code: "BENCHMARK_SOURCE_CHECK_RUNNING" });
      const first = await firstRequest;
      expect(first.status).toBe(200);
      const cooldown = await check();
      expect(cooldown.status).toBe(429);
      expect(cooldown.headers.get("retry-after")).toBe("15");
      expect(await cooldown.json()).toMatchObject({ code: "BENCHMARK_SOURCE_CHECK_COOLDOWN" });
      expect(checkPhysicalSourceUrlMock).toHaveBeenCalledTimes(1);
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

  it("rejects an in-flight duplicate and cools down GPU physical checks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-gpu-source-check-dedup-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.ADMIN_PASSWORD = "";
    checkPhysicalSourceUrlMock.mockReset().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(checkedSource()), 200)));
    vi.resetModules();
    let server: Server | undefined;
    try {
      const [{ app }, { GPU_PHYSICAL_OVERRIDES_PATH, writeJson }] = await Promise.all([import("./index"), import("./storage")]);
      await writeJson(GPU_PHYSICAL_OVERRIDES_PATH, { "gpu-rtx-4060-ti": { partId: "gpu-rtx-4060-ti", gpuSlotOccupancy: 2, manufacturerModel: "RTX 4060 Ti", sourceNote: "제조사 공식 사양서", sourceUrl: "https://vendor.example/source-check", updatedAt: "2026-09-09T00:00:00.000Z" } });
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("GPU source-check dedup server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const check = () => fetch(`${baseUrl}/api/admin/gpu-physical-overrides/gpu-rtx-4060-ti/source-check?persist=false`, { method: "POST" });
      const firstRequest = check();
      await waitForMockCall();
      const duplicate = await check();
      expect(duplicate.status).toBe(409);
      expect(await duplicate.json()).toMatchObject({ code: "GPU_PHYSICAL_SOURCE_CHECK_RUNNING" });
      const first = await firstRequest;
      expect(first.status).toBe(200);
      const cooldown = await check();
      expect(cooldown.status).toBe(429);
      expect(cooldown.headers.get("retry-after")).toBe("15");
      expect(await cooldown.json()).toMatchObject({ code: "GPU_PHYSICAL_SOURCE_CHECK_COOLDOWN" });
      expect(checkPhysicalSourceUrlMock).toHaveBeenCalledTimes(1);
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
