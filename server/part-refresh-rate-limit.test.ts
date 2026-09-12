import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("catalog detail refresh rate limit", () => {
  it.each([
    ["parts", "부품"],
    ["accessories", "주변 부품"]
  ])("limits rotating %s refresh IDs before any external lookup", async (route, label) => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-refresh-rate-limit-"));
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
      if (!address || typeof address === "string") throw new Error(`${label} refresh test server did not expose a TCP port`);
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const statuses: number[] = [];
      let firstHeaders: Headers | undefined;
      for (let index = 0; index < 30; index += 1) {
        const response = await fetch(`${baseUrl}/api/${route}/refresh-rate-limit-probe-${index}/refresh`, { method: "POST" });
        if (!firstHeaders) firstHeaders = response.headers;
        statuses.push(response.status);
        await response.arrayBuffer();
      }
      const limited = await fetch(`${baseUrl}/api/${route}/refresh-rate-limit-probe-limited/refresh`, { method: "POST" });
      const payload = await limited.json() as { code?: string };

      expect(statuses).toEqual(Array.from({ length: 30 }, () => 404));
      expect(firstHeaders?.get("x-ratelimit-limit")).toBe("30");
      expect(limited.status).toBe(429);
      expect(limited.headers.get("x-ratelimit-remaining")).toBe("0");
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(payload.code).toBe("RATE_LIMITED");
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
