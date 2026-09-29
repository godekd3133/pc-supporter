import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("admin crawler rate limits", () => {
  it("limits repeated core and accessory crawl starts independently per IP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-admin-crawl-rate-limit-"));
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
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const crawl = (path: string) => fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "__invalid__" })
      });

      const coreValidationResponses = await Promise.all(Array.from({ length: 10 }, () => crawl("/api/admin/crawl")));
      expect(coreValidationResponses.every((response) => response.status === 400)).toBe(true);
      const coreLimited = await crawl("/api/admin/crawl");
      expect(coreLimited.status).toBe(429);
      expect(coreLimited.headers.get("x-ratelimit-limit")).toBe("10");
      expect(coreLimited.headers.get("x-ratelimit-remaining")).toBe("0");
      expect(await coreLimited.json()).toMatchObject({ code: "RATE_LIMITED" });

      const accessoryValidationResponses = await Promise.all(Array.from({ length: 10 }, () => crawl("/api/admin/accessories/crawl")));
      expect(accessoryValidationResponses.every((response) => response.status === 400)).toBe(true);
      const accessoryLimited = await crawl("/api/admin/accessories/crawl");
      expect(accessoryLimited.status).toBe(429);
      expect(accessoryLimited.headers.get("x-ratelimit-limit")).toBe("10");
      expect(accessoryLimited.headers.get("x-ratelimit-remaining")).toBe("0");
      expect(await accessoryLimited.json()).toMatchObject({ code: "RATE_LIMITED" });

      const retryPage = () => fetch(`${baseUrl}/api/admin/crawl/retry-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "__invalid__", page: 0 })
      });
      const retryPageValidationResponses = await Promise.all(Array.from({ length: 10 }, retryPage));
      expect(retryPageValidationResponses.every((response) => response.status === 400)).toBe(true);
      const retryPageLimited = await retryPage();
      expect(retryPageLimited.status).toBe(429);
      expect(retryPageLimited.headers.get("x-ratelimit-limit")).toBe("10");
      expect(await retryPageLimited.json()).toMatchObject({ code: "RATE_LIMITED" });

      const retryBatch = () => fetch(`${baseUrl}/api/admin/crawl/retry-failed-pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const retryBatchValidationResponses = await Promise.all(Array.from({ length: 5 }, retryBatch));
      expect(retryBatchValidationResponses.every((response) => response.status === 409)).toBe(true);
      const retryBatchLimited = await retryBatch();
      expect(retryBatchLimited.status).toBe(429);
      expect(retryBatchLimited.headers.get("x-ratelimit-limit")).toBe("5");
      expect(await retryBatchLimited.json()).toMatchObject({ code: "RATE_LIMITED" });
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

  it("rejects price and crawler starts while another ingestion runner holds the shared lease", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-admin-crawl-lease-"));
    const previousAdminPassword = process.env.ADMIN_PASSWORD;
    const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.ADMIN_PASSWORD = "";
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "";
    await writeFile(join(directory, "background-job-catalog-ingestion.lease"), "locked", "utf8");
    vi.resetModules();
    let server: Server | undefined;
    try {
      const { app } = await import("./index");
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => { server?.once("listening", resolve); server?.once("error", reject); });
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const core = await post("/api/admin/crawl", { category: "cpu", pages: 1, limitPerCategory: 1 });
      expect(core.status).toBe(409);
      expect(await core.json()).toMatchObject({ code: "CRAWL_RUNNING" });

      const accessories = await post("/api/admin/accessories/crawl", {});
      expect(accessories.status).toBe(409);
      expect(await accessories.json()).toMatchObject({ code: "ACCESSORY_CRAWL_RUNNING" });

      const prices = await post("/api/admin/prices/refresh", { dryRun: true });
      expect(prices.status).toBe(409);
      expect(await prices.json()).toMatchObject({ code: "PRICE_REFRESH_RUNNING_ON_ANOTHER_INSTANCE" });
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
