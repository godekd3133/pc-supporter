import { describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";

const { isAccessoryCrawlRunningMock, readAccessoryCrawlStatusMock, runAccessoryCrawlJobMock } = vi.hoisted(() => ({
  isAccessoryCrawlRunningMock: vi.fn(),
  readAccessoryCrawlStatusMock: vi.fn(),
  runAccessoryCrawlJobMock: vi.fn()
}));

vi.mock("./accessory-crawler", () => ({
  isAccessoryCrawlRunning: isAccessoryCrawlRunningMock,
  readAccessoryCrawlManifest: vi.fn(),
  readAccessoryCrawlStatus: readAccessoryCrawlStatusMock,
  runAccessoryCrawlJob: runAccessoryCrawlJobMock
}));

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("admin accessory crawler input boundary", () => {
  it("rejects unbounded pages, batch size, and delay before starting a job", async () => {
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = "";
    vi.resetModules();
    isAccessoryCrawlRunningMock.mockReset().mockReturnValue(false);
    readAccessoryCrawlStatusMock.mockReset().mockResolvedValue({ status: "idle" });
    runAccessoryCrawlJobMock.mockReset().mockResolvedValue({ status: "running" });
    let server: Server | undefined;
    try {
      const { app } = await import("./index");
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("accessory crawl input test server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const request = (body: Record<string, unknown>) => fetch(`${baseUrl}/api/admin/accessories/crawl`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      for (const body of [{ pages: 1001 }, { limitPerCategory: 1001 }, { delayMs: 60_001 }]) {
        const response = await request(body);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "ACCESSORY_CRAWL_INPUT_INVALID" });
      }
      expect(runAccessoryCrawlJobMock).not.toHaveBeenCalled();
    } finally {
      if (server) await closeServer(server);
      if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = previousAdminPassword;
    }
  }, 15_000);
});
