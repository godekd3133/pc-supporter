import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./index";

describe("admin crawl read boundary", () => {
  let server: Server;
  let baseUrl = "";
  const previousAdminPassword = process.env.ADMIN_PASSWORD;

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = "admin-boundary-test-password";
    server = await new Promise<Server>((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
  });

  it.each([
    "/api/admin/crawl/status",
    "/api/admin/crawl/manifest",
    "/api/admin/accessories/crawl/status",
    "/api/admin/accessories/crawl/manifest",
    "/api/admin/accessories/coverage"
  ])("rejects unauthenticated reads for %s", async (path) => {
    const response = await fetch(baseUrl + path);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "ADMIN_AUTH_REQUIRED" });
  });

  it("treats a malformed admin cookie as an unauthenticated session", async () => {
    const response = await fetch(`${baseUrl}/api/admin/crawl/status`, { headers: { Cookie: "pc_supporter_admin=%" } });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "ADMIN_AUTH_REQUIRED" });
  });

  it("allows the same read after an admin session is established", async () => {
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "admin-boundary-test-password" })
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie");
    expect(setCookie).toContain("pc_supporter_admin=");

    const status = await fetch(`${baseUrl}/api/admin/crawl/status`, { headers: { Cookie: setCookie!.split(";", 1)[0] } });
    expect(status.status).toBe(200);
    expect(await status.json()).toHaveProperty("status");
  });

  it("keeps deployment security diagnostics behind an authenticated session", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/admin/session`);
    expect(unauthenticated.status).toBe(200);
    expect(await unauthenticated.json()).toEqual({ enabled: true, authenticated: false });

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "admin-boundary-test-password" })
    });
    const setCookie = login.headers.get("set-cookie");
    expect(setCookie).toContain("pc_supporter_admin=");
    const session = await fetch(`${baseUrl}/api/admin/session`, { headers: { Cookie: setCookie!.split(";", 1)[0] } });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      enabled: true,
      authenticated: true,
      security: {
        environment: expect.any(String),
        passwordConfigured: true,
        sessionSecretConfigured: expect.any(Boolean),
        productionReady: expect.any(Boolean)
      }
    });
  });

  it("clears an authenticated admin session on logout", async () => {
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "admin-boundary-test-password" })
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie");
    expect(setCookie).toContain("pc_supporter_admin=");
    const cookie = setCookie!.split(";", 1)[0];

    const logout = await fetch(`${baseUrl}/api/admin/logout`, {
      method: "POST",
      headers: { Cookie: cookie }
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await logout.json()).toEqual({ enabled: true, authenticated: false });

    const session = await fetch(`${baseUrl}/api/admin/session`);
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ enabled: true, authenticated: false });
  });
});
