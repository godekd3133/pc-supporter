import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("usage events", () => {
  const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
  const previousAdminPassword = process.env.ADMIN_PASSWORD;
  let directory: string | undefined;

  afterEach(async () => {
    vi.resetModules();
    if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
    else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it("counts app_open posts and rejects server-owned event names", async () => {
    directory = await mkdtemp(join(tmpdir(), "pc-supporter-usage-events-"));
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.ADMIN_PASSWORD = "usage-events-test-password";

    const [{ app }] = await Promise.all([import("./index")]);
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated usage-events server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const open = await fetch(`${baseUrl}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "app_open" })
      });
      expect(open.status).toBe(204);

      const rejected = await fetch(`${baseUrl}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "save" })
      });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({ code: "USAGE_EVENT_INVALID" });

      const { usageEventSummaryFor } = await import("./usage-events");
      const summary = await usageEventSummaryFor();
      expect(summary.totals.app_open).toBe(1);
      expect(summary.totals.save).toBeUndefined();
    } finally {
      await closeServer(server);
    }
  });

  it("serializes concurrent increments without losing counts", async () => {
    directory = await mkdtemp(join(tmpdir(), "pc-supporter-usage-events-"));
    process.env.PC_SUPPORTER_DATA_DIR = directory;

    const { recordUsageEvent, usageEventSummaryFor } = await import("./usage-events");
    await Promise.all(Array.from({ length: 8 }, () => recordUsageEvent("check")));
    const summary = await usageEventSummaryFor();
    expect(summary.totals.check).toBe(8);
  });
});
