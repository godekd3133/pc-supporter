import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { truncatePostgresTables } from "./testkit/postgres";

const budgetLadderRequest = {
  profile: "gaming",
  priority: "balanced",
  budgetWon: 1_500_000,
  includeGpu: true,
  gamingResolution: "1080p",
  gamingRefreshRate: 144,
  memoryCapacityGb: 32,
  storageCapacityGb: 1_000,
  hddCapacityGb: 4_000,
  hddCount: 0,
  listingPolicy: "retail_only"
};

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("usage events", () => {
  const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
  const previousAdminPassword = process.env.ADMIN_PASSWORD;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let directory: string | undefined;

  afterEach(async () => {
    vi.resetModules();
    if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
    else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it("counts app_open posts and rejects server-owned event names", async () => {
    directory = await mkdtemp(join(tmpdir(), "pc-supporter-usage-events-"));
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.ADMIN_PASSWORD = "usage-events-test-password";

    const [repository, { app }] = await Promise.all([import("./repository"), import("./index")]);
    await repository.initializePersistence();
    await truncatePostgresTables();
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

      const budgetLadder = await fetch(`${baseUrl}/api/builds/recommend/budget-ladder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(budgetLadderRequest)
      });
      expect(budgetLadder.status).toBe(200);
      expect((await budgetLadder.json() as { scenarios: unknown[] }).scenarios).toHaveLength(3);

      let ladderSummary = await usageEventSummaryFor();
      for (let attempt = 0; ladderSummary.totals.recommend !== 1 && attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        ladderSummary = await usageEventSummaryFor();
      }
      expect(ladderSummary.totals.recommend).toBe(1);
    } finally {
      await closeServer(server);
    }
  });

  it("serializes concurrent increments without losing counts", async () => {
    directory = await mkdtemp(join(tmpdir(), "pc-supporter-usage-events-"));
    process.env.PC_SUPPORTER_DATA_DIR = directory;

    const repository = await import("./repository");
    await repository.initializePersistence();
    await truncatePostgresTables();
    const { recordUsageEvent, usageEventSummaryFor } = await import("./usage-events");
    await Promise.all(Array.from({ length: 8 }, () => recordUsageEvent("check")));
    const summary = await usageEventSummaryFor();
    expect(summary.totals.check).toBe(8);
  });

  it("aggregates events in the PostgreSQL daily-count store", async () => {
    directory = await mkdtemp(join(tmpdir(), "pc-supporter-usage-events-postgres-"));
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.DATABASE_URL = "postgresql://usage-events.test.invalid/not-a-database";

    const rowsByDay = new Map<string, Record<string, number>>();
    const queryMock = vi.fn(async (statement: string, params: unknown[] = []) => {
      if (statement.includes("CREATE TABLE IF NOT EXISTS usage_event_daily_counts")) return { rows: [] };
      if (statement.startsWith("INSERT INTO usage_event_daily_counts")) {
        const day = String(params[0]);
        const name = String(params[1]);
        const counts = rowsByDay.get(day) ?? {};
        counts[name] = (counts[name] ?? 0) + 1;
        rowsByDay.set(day, counts);
        return { rows: [] };
      }
      if (statement.startsWith("DELETE FROM usage_event_daily_counts")) {
        const maxBuckets = Number(params[0]);
        const retainedDays = [...rowsByDay.keys()].sort().reverse().slice(0, maxBuckets);
        for (const day of rowsByDay.keys()) if (!retainedDays.includes(day)) rowsByDay.delete(day);
        return { rows: [] };
      }
      if (statement.startsWith("SELECT day_utc::text AS day_utc")) {
        return { rows: [...rowsByDay.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day_utc, counts]) => ({ day_utc, counts })) };
      }
      return { rows: [] };
    });
    const releaseMock = vi.fn();
    const connectMock = vi.fn(async () => ({ query: queryMock, release: releaseMock }));
    const endMock = vi.fn(async () => undefined);
    vi.doMock("pg", () => ({
      Pool: class FakePool {
        query = queryMock;
        connect = connectMock;
        end = endMock;
      }
    }));

    try {
      vi.resetModules();
      const repository = await import("./repository");
      await repository.initializePersistence();
      const { recordUsageEvent, usageEventSummaryFor } = await import("./usage-events");
      await recordUsageEvent("check", new Date("2026-09-29T00:30:00.000Z"));

      const summary = await usageEventSummaryFor();
      expect(summary).toEqual({
        retentionDays: 90,
        days: 1,
        totals: { check: 1 },
        daily: { "2026-09-29": { check: 1 } }
      });
      expect(queryMock.mock.calls.some(([statement]) => statement.includes("CREATE TABLE IF NOT EXISTS usage_event_daily_counts"))).toBe(true);
      expect(queryMock.mock.calls.some(([statement, params]) => statement.startsWith("INSERT INTO usage_event_daily_counts") && params?.[0] === "2026-09-29" && params?.[1] === "check")).toBe(true);
      expect(queryMock.mock.calls.some(([statement, params]) => statement.startsWith("DELETE FROM usage_event_daily_counts") && params?.[0] === 97)).toBe(true);
      expect(releaseMock).toHaveBeenCalledTimes(2);
    } finally {
      const repository = await import("./repository");
      await repository.closePersistence();
      vi.doUnmock("pg");
    }
  });
});
