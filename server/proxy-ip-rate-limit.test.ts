import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("reverse-proxy client IP boundary", () => {
  it("keeps different forwarded client IPs in separate rate-limit buckets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-proxy-ip-rate-limit-"));
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    vi.resetModules();
    let server: Server | undefined;
    try {
      const { app } = await import("./index");
      const trustProxy = app.get("trust proxy fn") as (address: string, index?: number) => boolean;
      expect(trustProxy("127.0.0.1", 0)).toBe(true);
      expect(trustProxy("::ffff:127.0.0.1", 0)).toBe(true);
      expect(trustProxy("203.0.113.20", 0)).toBe(false);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("proxy IP test server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const forwardedIps = ["198.51.100.10", "198.51.100.11"];
      const responses = await Promise.all(forwardedIps.map((ip) => fetch(`${baseUrl}/api/parts?category=cpu&limit=1`, { headers: { "X-Forwarded-For": ip } })));

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(responses.map((response) => response.headers.get("x-ratelimit-limit"))).toEqual(["180", "180"]);
      expect(responses.map((response) => response.headers.get("x-ratelimit-remaining"))).toEqual(["179", "179"]);
      await Promise.all(responses.map((response) => response.arrayBuffer()));
    } finally {
      if (server) await closeServer(server);
      if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
      else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
