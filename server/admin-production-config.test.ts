import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withProductionServer(options: { password?: string; secret?: string }, run: (baseUrl: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "pc-supporter-admin-production-config-"));
  const keys = ["NODE_ENV", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET", "PC_SUPPORTER_DATA_DIR", "DATABASE_URL", "DANAWA_CRAWL_ON_START", "BUILD_MONITOR_SCHEDULER_ENABLED"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  let server: Server | undefined;
  try {
    process.env.NODE_ENV = "production";
    if (options.password === undefined) process.env.ADMIN_PASSWORD = "";
    else process.env.ADMIN_PASSWORD = options.password;
    if (options.secret === undefined) process.env.ADMIN_SESSION_SECRET = "";
    else process.env.ADMIN_SESSION_SECRET = options.secret;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    process.env.DANAWA_CRAWL_ON_START = "false";
    process.env.BUILD_MONITOR_SCHEDULER_ENABLED = "false";
    vi.resetModules();
    const { app } = await import("./index");
    server = await new Promise<Server>((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("production admin config test did not expose a TCP port");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    if (server) await closeServer(server);
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
    await rm(directory, { recursive: true, force: true });
  }
}

describe("production admin authentication configuration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps admin APIs blocked when production credentials are missing", async () => {
    await withProductionServer({}, async (baseUrl) => {
      const session = await fetch(`${baseUrl}/api/admin/session`).then((response) => response.json());
      expect(session).toMatchObject({
        enabled: true,
        authenticated: false,
        security: {
          environment: "production",
          passwordConfigured: false,
          sessionSecretConfigured: false,
          productionReady: false
        }
      });

      const login = await fetch(`${baseUrl}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "missing" }) });
      expect(login.status).toBe(503);
      expect(await login.json()).toMatchObject({ code: "ADMIN_AUTH_MISCONFIGURED" });

      const protectedRead = await fetch(`${baseUrl}/api/admin/crawl/status`);
      expect(protectedRead.status).toBe(503);
      expect(await protectedRead.json()).toMatchObject({ code: "ADMIN_AUTH_MISCONFIGURED" });
    });
  });

  it("rejects a production password when the session secret is missing", async () => {
    await withProductionServer({ password: "production-password" }, async (baseUrl) => {
      const login = await fetch(`${baseUrl}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "production-password" }) });
      expect(login.status).toBe(503);
      expect(await login.json()).toMatchObject({ code: "ADMIN_AUTH_MISCONFIGURED" });
    });
  });

  it("allows a production session only when both password and non-default secret exist", async () => {
    await withProductionServer({ password: "production-password", secret: "production-session-secret" }, async (baseUrl) => {
      const login = await fetch(`${baseUrl}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "production-password" }) });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toContain("pc_supporter_admin=");
      expect(login.headers.get("set-cookie")).toContain("Secure");

      const protectedRead = await fetch(`${baseUrl}/api/admin/crawl/status`, { headers: { Cookie: cookie! } });
      expect(protectedRead.status).toBe(200);
    });
  });
});
