import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";

const { benchmark3DMarkReviewWorkPackageMock, benchmarkReviewQueueMock } = vi.hoisted(() => ({
  benchmark3DMarkReviewWorkPackageMock: vi.fn(),
  benchmarkReviewQueueMock: vi.fn()
}));

vi.mock("./benchmark-review", () => ({
  benchmark3DMarkReviewWorkPackageFor: benchmark3DMarkReviewWorkPackageMock,
  benchmarkReviewQueueFor: benchmarkReviewQueueMock
}));

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("3DMark review work package API", () => {
  it("forwards pagination and reports a stale queue fingerprint", async () => {
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "";
    let server: Server | undefined;
    benchmark3DMarkReviewWorkPackageMock.mockReset().mockImplementation((_catalog: unknown[], options: { offset?: number; limit?: number }) => {
      const offset = options.offset ?? 0;
      const limit = options.limit ?? 24;
      const includedCount = Math.min(limit, Math.max(0, 926 - offset));
      const remainingCount = Math.max(0, 926 - offset - includedCount);
      return {
      schemaVersion: 1,
      kind: "3dmark-gpu-review-package",
      readOnly: true,
      generatedAt: "2026-09-06T00:00:00.000Z",
      category: "gpu",
      offset,
      limit,
      nextOffset: 48,
      queueFingerprint: "b3mr1-current",
      summary: { totalGpu: 926, completeCount: 0, partialCount: 0, missingCount: 926, queueTotal: 926, includedCount, remainingCount },
      items: []
      };
    });

    try {
      const { app } = await import("./index");
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("3DMark review package API test did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const staleResponse = await fetch(`${baseUrl}/api/admin/benchmark-review/work-package?offset=24&limit=24&queueFingerprint=b3mr1-old`);
      expect(staleResponse.status).toBe(200);
      expect(await staleResponse.json()).toMatchObject({ offset: 24, limit: 24, queueFingerprint: "b3mr1-current", queueChanged: true });
      expect(benchmark3DMarkReviewWorkPackageMock).toHaveBeenCalledWith(expect.any(Array), { offset: 24, limit: 24 });

      const currentResponse = await fetch(`${baseUrl}/api/admin/benchmark-review/work-package?offset=24&limit=24&queueFingerprint=b3mr1-current`);
      expect(currentResponse.status).toBe(200);
      expect(await currentResponse.json()).not.toHaveProperty("queueChanged");
    } finally {
      if (server) await closeServer(server);
      if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = previousAdminPassword;
    }
  });
});
