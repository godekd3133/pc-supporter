import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("admin login rate limit", () => {
  const previousAdminPassword = process.env.ADMIN_PASSWORD;

  afterEach(() => {
    vi.resetModules();
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
  });

  it("limits repeated failed login attempts per IP", async () => {
    process.env.ADMIN_PASSWORD = "admin-login-rate-limit-password";
    const [{ app }] = await Promise.all([import("./index")]);
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated admin login server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const attempt = () => fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong-password" })
      });

      const failed = await Promise.all(Array.from({ length: 10 }, attempt));
      expect(failed.every((response) => response.status === 401)).toBe(true);
      const limited = await attempt();
      expect(limited.status).toBe(429);
      expect(limited.headers.get("x-ratelimit-limit")).toBe("10");
      expect(limited.headers.get("x-ratelimit-remaining")).toBe("0");
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    } finally {
      await closeServer(server);
    }
  });
});
