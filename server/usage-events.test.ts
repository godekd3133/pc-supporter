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

  it("parses client funnel batches and rejects server-owned or malformed events", async () => {
    const { clientUsageEventsFromRequest } = await import("./usage-events");

    const batch = clientUsageEventsFromRequest({
      visitorId: "visitor-12345678",
      sessionId: "session-12345678",
      events: [
        { name: "view", at: "2026-09-29T00:00:00.000Z", path: "/start", props: { view: "start" } },
        { name: "onboarding_step", props: { step: "budget", usecase: "gaming", BAD: "drop", nested: { a: 1 } } },
        { name: "save" },
        { name: "totally_made_up" },
        "not-an-event"
      ]
    });
    expect(batch).toBeDefined();
    expect(batch!.visitorId).toBe("visitor-12345678");
    expect(batch!.events.map((event) => event.name)).toEqual(["view", "onboarding_step"]);
    expect(batch!.events[0].props).toEqual({ view: "start" });
    expect(batch!.events[1].props).toEqual({ step: "budget", usecase: "gaming" });
    expect(Number.isNaN(batch!.events[1].at.getTime())).toBe(false);

    // 단일 {name} 레거시 형태도 받는다
    expect(clientUsageEventsFromRequest({ name: "app_open" })?.events.map((event) => event.name)).toEqual(["app_open"]);
    expect(clientUsageEventsFromRequest({ name: "save" })).toBeUndefined();
    expect(clientUsageEventsFromRequest({ name: "check" })).toBeUndefined();
    expect(clientUsageEventsFromRequest({ events: [{ name: "share" }] })).toBeUndefined();
    expect(clientUsageEventsFromRequest("nope")).toBeUndefined();
    expect(clientUsageEventsFromRequest({ events: [] })).toBeUndefined();
    // 비밀키 패턴에 맞지 않는 식별자는 버린다
    const badIds = clientUsageEventsFromRequest({ visitorId: "../etc", sessionId: "x", events: [{ name: "view" }] });
    expect(badIds?.visitorId).toBeUndefined();
    expect(badIds?.sessionId).toBeUndefined();
  });

  it("stores client funnel events with hashed identities and aggregates the analytics surface", async () => {
    directory = await mkdtemp(join(tmpdir(), "pc-supporter-usage-analytics-"));
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.ADMIN_PASSWORD = "usage-analytics-test-password";

    const repository = await import("./repository");
    await repository.initializePersistence();
    await truncatePostgresTables();
    const { recordClientUsageEvents, usageAnalyticsFor } = await import("./usage-events");

    // 90일 집계 창에 들어가도록 실제 현재 시각 기준으로 fixture를 만든다.
    const base = Date.now() - 5 * 24 * 60 * 60 * 1_000;
    const cohortDay = new Date(base).toISOString().slice(0, 10);
    const at = (offsetMs: number) => new Date(base + offsetMs);
    const day = (offsetDays: number) => new Date(base + offsetDays * 24 * 60 * 60 * 1_000);

    // visitor A: 완주 경로(다음날 재방문 포함) · visitor B: 온보딩 중도 이탈
    await recordClientUsageEvents({
      visitorId: "visitor-aaaaaa01", sessionId: "session-aaaaaa01",
      events: [
        { name: "app_open", at: at(0), path: "/" },
        { name: "onboarding_step", at: at(1_000), path: "/start", props: { step: "intent" } },
        { name: "onboarding_step", at: at(2_000), path: "/start", props: { step: "budget" } },
        { name: "onboarding_complete", at: at(3_000), path: "/start" },
        { name: "recommend_request", at: at(4_000), path: "/recommend", props: { source: "recommend" } },
        { name: "recommend_success", at: at(8_000), path: "/recommend" },
        { name: "view", at: at(9_000), path: "/result", props: { view: "result" } },
        { name: "build_save", at: at(10_000), path: "/result" },
        { name: "share_link", at: at(11_000), path: "/result", props: { kind: "result" } }
      ]
    });
    await recordClientUsageEvents({
      visitorId: "visitor-aaaaaa01", sessionId: "session-aaaaaa02",
      events: [{ name: "app_open", at: day(1), path: "/" }]
    });
    await recordClientUsageEvents({
      visitorId: "visitor-bbbbbb02", sessionId: "session-bbbbbb02",
      events: [
        { name: "app_open", at: at(0), path: "/" },
        { name: "onboarding_step", at: at(1_000), path: "/start", props: { step: "intent" } },
        { name: "recommend_request", at: at(2_000), path: "/recommend" },
        { name: "recommend_fail", at: at(5_000), path: "/recommend", props: { status: 500 } }
      ]
    });

    // 원시 로그에는 평문 식별자가 남지 않는다
    const rows = await repository.readUsageEventRowsForAnalytics(new Date(base - 60_000));
    expect(rows.length).toBe(14);
    const visitorKeys = new Set(rows.map((row) => row.visitor_key).filter(Boolean));
    expect(visitorKeys.size).toBe(2);
    for (const key of visitorKeys) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain("visitor-");
    }

    const analytics = await usageAnalyticsFor(90);
    expect(analytics.totals.visitors).toBe(2);
    expect(analytics.totals.sessions).toBe(3);
    expect(analytics.totals.recommendRequests).toBe(2);
    expect(analytics.totals.recommendSuccessRate).toBe(0.5);
    expect(analytics.totals.saves).toBe(1);

    // 단조 퍼널 — A는 8단계 완주, B는 앱 방문→온보딩 진입까지(실패한 recommend는 성공 단계로 안 넘어감)
    const funnel = Object.fromEntries(analytics.funnel.map((stage) => [stage.key, stage.visitors]));
    expect(funnel.visit).toBe(2);
    expect(funnel.entry).toBe(2);
    expect(funnel.configured).toBe(1); // B는 intent만 봤다
    expect(funnel.requested).toBe(2);
    expect(funnel.generated).toBe(1);
    expect(funnel.result).toBe(1);
    expect(funnel.saved).toBe(1);
    expect(funnel.shared).toBe(1);

    const entryStage = analytics.funnel.find((stage) => stage.key === "entry")!;
    expect(entryStage.conversionFromPrev).toBe(1);
    const configuredStage = analytics.funnel.find((stage) => stage.key === "configured")!;
    expect(configuredStage.dropFromPrev).toBe(0.5);
    // B의 최종 도달 단계는 requested — configured를 건너뛰어도 이후 단계는 이어서 센다.
    expect(analytics.funnel.find((stage) => stage.key === "requested")!.exitedHere).toBe(1);
    expect(analytics.funnel.find((stage) => stage.key === "shared")!.exitedHere).toBe(1);

    // 온보딩 단계 도달 — budget에 도달한 건 A뿐
    const onboarding = Object.fromEntries(analytics.onboarding.map((step) => [step.step, step.visitors]));
    expect(onboarding.intent).toBe(2);
    expect(onboarding.budget).toBe(1);

    // 코호트 리텐션 — fixture 코호트 2명 중 A만 D+1 재방문
    const cohort = analytics.retention.cohorts.find((item) => item.day === cohortDay)!;
    expect(cohort.size).toBe(2);
    expect(cohort.day1).toBe(0.5);
    expect(cohort.day7).toBe(0);
  });

  it("ingests client batches through POST /api/events and protects the analytics endpoint", async () => {
    directory = await mkdtemp(join(tmpdir(), "pc-supporter-usage-events-batch-"));
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.ADMIN_PASSWORD = "usage-events-batch-test-password";

    const [repository, { app }] = await Promise.all([import("./repository"), import("./index")]);
    await repository.initializePersistence();
    await truncatePostgresTables();
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("isolated usage-events server did not expose a TCP port");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const batch = await fetch(`${baseUrl}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId: "visitor-batch0001",
          sessionId: "session-batch0001",
          events: [
            { name: "app_open", path: "/" },
            { name: "view", path: "/start", props: { view: "start" } },
            { name: "onboarding_step", path: "/start", props: { step: "intent" } }
          ]
        })
      });
      expect(batch.status).toBe(204);

      // 서버 소유 이름만 들어온 배치는 여전히 400이다
      const rejected = await fetch(`${baseUrl}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [{ name: "recommend" }, { name: "check" }] })
      });
      expect(rejected.status).toBe(400);

      const { usageEventSummaryFor } = await import("./usage-events");
      const summary = await usageEventSummaryFor();
      expect(summary.totals.app_open).toBe(1);

      // 관리자 인증 없이는 분석 데이터를 열 수 없다
      const unauthenticated = await fetch(`${baseUrl}/api/admin/usage-analytics?days=7`);
      expect(unauthenticated.status).toBe(401);
    } finally {
      await closeServer(server);
    }
  });
});
