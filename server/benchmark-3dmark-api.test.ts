import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";

const { import3DMarkResultMock, MockBenchmark3DMarkImportError } = vi.hoisted(() => {
  class MockBenchmark3DMarkImportError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "Benchmark3DMarkImportError";
    }
  }
  return { import3DMarkResultMock: vi.fn(), MockBenchmark3DMarkImportError };
});

vi.mock("./benchmark-3dmark", () => ({
  Benchmark3DMarkImportError: MockBenchmark3DMarkImportError,
  import3DMarkResult: import3DMarkResultMock
}));

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("3DMark preview API", () => {
  it("validates the selected GPU and forwards safe URL errors without writing data", async () => {
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "";
    let server: Server | undefined;
    import3DMarkResultMock.mockReset().mockImplementation(async (sourceUrl: string) => {
      if (sourceUrl.includes("/results/")) throw new MockBenchmark3DMarkImportError("지원하지 않는 3DMark 결과 유형입니다.");
      return {
        sourceUrl,
        resultId: "123456",
        benchmark: "time_spy",
        benchmarkLabel: "3DMark Time Spy",
        scoreKey: "gpu3dmarkTimeSpyScore",
        score: 18385,
        gpuName: "NVIDIA GeForce RTX 4060",
        identityStatus: "matched",
        identityDetail: "선택 부품과 결과 페이지의 GPU 식별자가 일치합니다.",
        fetchedAt: "2026-09-05T00:00:00.000Z"
      };
    });

    try {
      const { app } = await import("./index");
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("3DMark API test server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const missingInput = await fetch(`${baseUrl}/api/admin/benchmark-import/3dmark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId: "gpu-rtx-4060" })
      });
      expect(missingInput.status).toBe(400);
      expect(await missingInput.json()).toMatchObject({ code: "BENCHMARK_3DMARK_INPUT_INVALID" });

      const cpuSelection = await fetch(`${baseUrl}/api/admin/benchmark-import/3dmark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId: "cpu-ryzen-7-7800x3d", sourceUrl: "https://www.3dmark.com/spy/123456" })
      });
      expect(cpuSelection.status).toBe(404);
      expect(await cpuSelection.json()).toMatchObject({ code: "BENCHMARK_3DMARK_GPU_NOT_FOUND" });

      const validPreview = await fetch(`${baseUrl}/api/admin/benchmark-import/3dmark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId: "gpu-rtx-4060", sourceUrl: "https://www.3dmark.com/spy/123456" })
      });
      expect(validPreview.status).toBe(200);
      expect(await validPreview.json()).toMatchObject({
        partId: "gpu-rtx-4060",
        benchmark: "time_spy",
        scoreKey: "gpu3dmarkTimeSpyScore",
        score: 18385,
        identityStatus: "matched"
      });
      expect(import3DMarkResultMock).toHaveBeenCalledWith("https://www.3dmark.com/spy/123456", expect.any(String), expect.any(String), {});

      const unsafeResultPath = await fetch(`${baseUrl}/api/admin/benchmark-import/3dmark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partId: "gpu-rtx-4060", sourceUrl: "https://www.3dmark.com/results/123456" })
      });
      expect(unsafeResultPath.status).toBe(422);
      expect(await unsafeResultPath.json()).toMatchObject({ code: "BENCHMARK_3DMARK_PREVIEW_FAILED" });
    } finally {
      if (server) await closeServer(server);
      if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = previousAdminPassword;
    }
  }, 30_000);

  it("previews a bounded batch with per-row identity and failure states without persistence", async () => {
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "";
    let server: Server | undefined;
    import3DMarkResultMock.mockReset().mockImplementation(async (sourceUrl: string) => ({
      sourceUrl,
      resultId: sourceUrl.split("/").pop() ?? "1",
      benchmark: sourceUrl.includes("/prt/") ? "port_royal" : "time_spy",
      benchmarkLabel: sourceUrl.includes("/prt/") ? "3DMark Port Royal" : "3DMark Time Spy",
      scoreKey: sourceUrl.includes("/prt/") ? "gpu3dmarkPortRoyalScore" : "gpu3dmarkTimeSpyScore",
      score: sourceUrl.includes("/prt/") ? 9876 : 18385,
      gpuName: sourceUrl.includes("manual") ? "NVIDIA GeForce RTX 5080" : "NVIDIA GeForce RTX 4060",
      identityStatus: sourceUrl.includes("manual") ? "manual_required" : "matched",
      identityDetail: sourceUrl.includes("manual") ? "수동 대조 필요" : "일치",
      fetchedAt: "2026-09-06T00:00:00.000Z"
    }));

    try {
      const { app } = await import("./index");
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("3DMark batch API test server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const response = await fetch(`${baseUrl}/api/admin/benchmark-import/3dmark/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [
          { partId: "gpu-rtx-4060", sourceUrl: "https://www.3dmark.com/spy/123456" },
          { partId: "gpu-rtx-5090", sourceUrl: "https://www.3dmark.com/prt/manual" },
          { partId: "cpu-7800x3d", sourceUrl: "https://www.3dmark.com/spy/777777" },
          { partId: "gpu-rtx-4060", sourceUrl: "https://www.3dmark.com/spy/888888" }
        ] })
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({ schemaVersion: 1, kind: "3dmark-batch-preview", readOnly: true, requestedCount: 4, processedCount: 4, matchedCount: 1, reviewCount: 1, failedCount: 2, maxItems: 12 });
      expect(payload.items.map((item: { status: string }) => item.status)).toEqual(["matched", "manual_required", "failed", "failed"]);
      expect(payload.items[2].error).toContain("GPU만");
      expect(payload.items[3].error).toContain("중복");
      expect(import3DMarkResultMock).toHaveBeenCalledTimes(2);

      const invalid = await fetch(`${baseUrl}/api/admin/benchmark-import/3dmark/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: Array.from({ length: 13 }, () => ({ partId: "gpu-rtx-4060", sourceUrl: "https://www.3dmark.com/spy/1" })) })
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ code: "BENCHMARK_3DMARK_BATCH_LIMIT_EXCEEDED", maxItems: 12 });
      expect(import3DMarkResultMock).toHaveBeenCalledTimes(2);
    } finally {
      if (server) await closeServer(server);
      if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = previousAdminPassword;
    }
  }, 30_000);
});
