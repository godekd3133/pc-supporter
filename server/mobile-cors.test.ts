import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./index";

describe("mobile API CORS boundary", () => {
  let server: Server;
  let baseUrl = "";
  const previousAdminPassword = process.env.ADMIN_PASSWORD;

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = "mobile-cors-test-password";
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

  it("answers Capacitor preflight and exposes cache headers", async () => {
    const response = await fetch(`${baseUrl}/api/meta`, {
      method: "OPTIONS",
      headers: {
        Origin: "capacitor://localhost",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "If-None-Match, Content-Type"
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain("ETag");
  });

  it("does not reflect an untrusted origin", async () => {
    const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: "https://untrusted.example" } });

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("marks native admin sessions as cross-origin secure cookies", async () => {
    const response = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { Origin: "capacitor://localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ password: "mobile-cors-test-password" })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("SameSite=None");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });
});
