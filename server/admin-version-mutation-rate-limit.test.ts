import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("admin saved-build version mutation rate limits", () => {
  it("limits repeated migration and rollback attempts independently per IP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-admin-version-rate-limit-"));
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
      if (!address || typeof address === "string") throw new Error("admin version rate-limit server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const attempt = (path: string) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });

      const migrationValidationResponses = await Promise.all(Array.from({ length: 5 }, () => attempt("/api/admin/build-versions/migrate")));
      expect(migrationValidationResponses.every((response) => response.status === 400)).toBe(true);
      const migrationLimited = await attempt("/api/admin/build-versions/migrate");
      expect(migrationLimited.status).toBe(429);
      expect(migrationLimited.headers.get("x-ratelimit-limit")).toBe("5");
      expect(await migrationLimited.json()).toMatchObject({ code: "RATE_LIMITED" });

      const rollbackValidationResponses = await Promise.all(Array.from({ length: 5 }, () => attempt("/api/admin/build-versions/rollback")));
      expect(rollbackValidationResponses.every((response) => response.status === 400)).toBe(true);
      const rollbackLimited = await attempt("/api/admin/build-versions/rollback");
      expect(rollbackLimited.status).toBe(429);
      expect(rollbackLimited.headers.get("x-ratelimit-limit")).toBe("5");
      expect(await rollbackLimited.json()).toMatchObject({ code: "RATE_LIMITED" });
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
  }, 15_000);
});
