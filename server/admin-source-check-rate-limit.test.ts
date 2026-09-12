import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("admin source-check batch rate limits", () => {
  it("limits GPU physical and benchmark batches independently per IP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-admin-source-check-rate-limit-"));
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.ADMIN_PASSWORD = "";
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    vi.resetModules();
    let server: Server | undefined;
    try {
      const { app } = await import("./index");
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("admin source-check batch rate-limit server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const batch = (path: string) => fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partIds: ["missing-source-check"], limit: 50 })
      });

      const gpuAllowed = await Promise.all(Array.from({ length: 5 }, () => batch("/api/admin/gpu-physical-overrides/source-check/batch")));
      expect(gpuAllowed.every((response) => response.status === 200)).toBe(true);
      expect(gpuAllowed.map((response) => response.headers.get("x-ratelimit-remaining"))).toContain("0");
      const gpuLimited = await batch("/api/admin/gpu-physical-overrides/source-check/batch");
      expect(gpuLimited.status).toBe(429);
      expect(gpuLimited.headers.get("x-ratelimit-limit")).toBe("5");
      expect(await gpuLimited.json()).toMatchObject({ code: "RATE_LIMITED" });

      const benchmarkAllowed = await Promise.all(Array.from({ length: 5 }, () => batch("/api/admin/benchmark-overrides/source-check/batch")));
      expect(benchmarkAllowed.every((response) => response.status === 200)).toBe(true);
      expect(benchmarkAllowed.map((response) => response.headers.get("x-ratelimit-remaining"))).toContain("0");
      const benchmarkLimited = await batch("/api/admin/benchmark-overrides/source-check/batch");
      expect(benchmarkLimited.status).toBe(429);
      expect(benchmarkLimited.headers.get("x-ratelimit-limit")).toBe("5");
      expect(await benchmarkLimited.json()).toMatchObject({ code: "RATE_LIMITED" });

      const individual = (path: string) => fetch(`${baseUrl}${path}`, { method: "POST" });
      for (const path of ["/api/admin/catalog-spec-overrides/missing-source-check/source-check", "/api/admin/gpu-physical-overrides/missing-source-check/source-check", "/api/admin/benchmark-overrides/missing-source-check/source-check"]) {
        const allowed = await Promise.all(Array.from({ length: 30 }, () => individual(path)));
        expect(allowed.every((response) => response.status === 404)).toBe(true);
        const limited = await individual(path);
        expect(limited.status).toBe(429);
        expect(limited.headers.get("x-ratelimit-limit")).toBe("30");
        expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED" });
      }
    } finally {
      if (server) await closeServer(server);
      if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = previousAdminPassword;
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
