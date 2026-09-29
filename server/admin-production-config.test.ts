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
  const keys = ["NODE_ENV", "ADMIN_PASSWORD", "ADMIN_SESSION_SECRET", "ADMIN_COOKIE_SAMESITE", "CORS_ALLOWED_ORIGINS", "PC_SUPPORTER_DATA_DIR", "DATABASE_URL", "DANAWA_CRAWL_ON_START", "BUILD_MONITOR_SCHEDULER_ENABLED"] as const;
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
    process.env.ADMIN_COOKIE_SAMESITE = "none";
    process.env.CORS_ALLOWED_ORIGINS = "";
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
      const health = await fetch(`${baseUrl}/api/health`);
      expect(health.status).toBe(503);
      expect(await health.json()).toMatchObject({
        ok: false,
        adminSecurity: { productionReady: false }
      });

      const sessionResponse = await fetch(`${baseUrl}/api/admin/session`);
      expect(sessionResponse.headers.get("cache-control")).toBe("private, no-store");
      const session = await sessionResponse.json();
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
      expect(login.headers.get("cache-control")).toBe("private, no-store");
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
      expect(login.headers.get("cache-control")).toBe("private, no-store");
      expect(await login.json()).toMatchObject({ code: "ADMIN_AUTH_MISCONFIGURED" });
    });
  });

  it("allows a production session only when both password and non-default secret exist", async () => {
    await withProductionServer({ password: "production-password", secret: "production-session-secret" }, async (baseUrl) => {
      const health = await fetch(`${baseUrl}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true, adminSecurity: { productionReady: true } });

      const login = await fetch(`${baseUrl}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "production-password" }) });
      expect(login.status).toBe(200);
      expect(login.headers.get("cache-control")).toBe("private, no-store");
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toContain("pc_supporter_admin=");
      expect(login.headers.get("set-cookie")).toContain("Secure");

      const protectedRead = await fetch(`${baseUrl}/api/admin/crawl/status`, { headers: { Cookie: cookie! } });
      expect(protectedRead.status).toBe(200);
    });
  });

  it("blocks cross-site requests to authenticated admin mutations while allowing same-origin requests", async () => {
    await withProductionServer({ password: "production-password", secret: "production-session-secret" }, async (baseUrl) => {
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: { Origin: baseUrl, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "production-password" })
      });
      expect(login.status).toBe(200);
      expect(login.headers.get("cache-control")).toBe("private, no-store");
      expect(login.headers.get("set-cookie")).toContain("SameSite=None");
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toContain("pc_supporter_admin=");

      const crossSite = await fetch(`${baseUrl}/api/admin/benchmark-overrides/validate`, {
        method: "POST",
        headers: {
          Cookie: cookie!,
          Origin: "https://attacker.invalid",
          "Sec-Fetch-Site": "cross-site",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });
      expect(crossSite.status).toBe(403);
      expect(await crossSite.json()).toMatchObject({ code: "ADMIN_CSRF_ORIGIN_INVALID" });

      const sameOrigin = await fetch(`${baseUrl}/api/admin/benchmark-overrides/validate`, {
        method: "POST",
        headers: { Cookie: cookie!, Origin: baseUrl, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      expect(sameOrigin.status).toBe(400);
    });
  });

  it("rejects cross-site login and logout attempts before changing the session cookie", async () => {
    await withProductionServer({ password: "production-password", secret: "production-session-secret" }, async (baseUrl) => {
      const sameOriginLogin = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: { Origin: baseUrl, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "production-password" })
      });
      expect(sameOriginLogin.status).toBe(200);
      expect(sameOriginLogin.headers.get("cache-control")).toBe("private, no-store");
      const sameOriginCookie = sameOriginLogin.headers.get("set-cookie")?.split(";", 1)[0];
      const sameOriginLogout = await fetch(`${baseUrl}/api/admin/logout`, {
        method: "POST",
        headers: { Cookie: sameOriginCookie!, Origin: baseUrl }
      });
      expect(sameOriginLogout.status).toBe(200);
      expect(sameOriginLogout.headers.get("cache-control")).toBe("private, no-store");
      expect(sameOriginLogout.headers.get("set-cookie")).toContain("Max-Age=0");

      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: { Origin: "https://attacker.invalid", "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" },
        body: JSON.stringify({ password: "production-password" })
      });
      expect(login.status).toBe(403);
      expect(login.headers.get("cache-control")).toBe("private, no-store");
      expect(login.headers.get("set-cookie")).toBeNull();

      const logout = await fetch(`${baseUrl}/api/admin/logout`, {
        method: "POST",
        headers: { Origin: "https://attacker.invalid", "Sec-Fetch-Site": "cross-site" }
      });
      expect(logout.status).toBe(403);
      expect(logout.headers.get("cache-control")).toBe("private, no-store");
      expect(logout.headers.get("set-cookie")).toBeNull();
      expect(await logout.json()).toMatchObject({ code: "ADMIN_CSRF_ORIGIN_INVALID" });
    });
  });
});
