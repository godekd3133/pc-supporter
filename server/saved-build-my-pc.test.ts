import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Part } from "../shared/types";
import type { SavedBuildMonitorSubscription } from "../shared/saved-build-monitor-subscription";
import { createShareOwnerCredential } from "./build-share";
import { savedBuildAlternativeAlertsFor } from "./saved-build-alternatives";
import { truncatePostgresTables } from "./testkit/postgres";
import type { SavedBuildRecord } from "./build-share";

const selection = { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true };

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitForMonitorRun(baseUrl: string, buildId: string, ownerToken: string) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/builds/${buildId}/monitor`, { headers: { "X-Share-Owner-Token": ownerToken } });
    if (!response.ok) throw new Error(`monitor read failed while awaiting first run: ${response.status}`);
    const body = await response.json() as { subscription: SavedBuildMonitorSubscription };
    if (body.subscription.lastCheckedAt || body.subscription.lastErrorAt) return body.subscription;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("promote-triggered monitor run did not settle before test cleanup");
}

async function startIsolatedServer() {
  const [{ app }] = await Promise.all([import("./index")]);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("my-pc test server did not expose a TCP port");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function cpuPart(id: string, score: number, priceWon?: number): Part {
  return {
    id,
    name: `CPU ${id}`,
    category: "cpu",
    source: "danawa",
    priceWon,
    specs: { cinebenchR23Multi: score },
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-09-09T00:00:00.000Z"
  } as Part;
}

function ownedRecord(overrides: Partial<SavedBuildRecord> = {}): SavedBuildRecord {
  return {
    id: "alt-build",
    name: "내 PC",
    selection: { ...selection, cpu: { partId: "cpu-current", quantity: 1 } },
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    myPcAt: "2026-09-10T00:00:00.000Z",
    ...overrides
  } as SavedBuildRecord;
}

describe("saved build my-pc ownership cycle", () => {
  const previousDataDirectory = process.env.PC_SUPPORTER_DATA_DIR;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousAdminPassword = process.env.ADMIN_PASSWORD;
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.resetModules();
    if (previousDataDirectory === undefined) delete process.env.PC_SUPPORTER_DATA_DIR;
    else process.env.PC_SUPPORTER_DATA_DIR = previousDataDirectory;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousAdminPassword;
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function seedBuild(id: string, alertPolicy: "all" | "risk" | "critical" = "all") {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-my-pc-"));
    temporaryDirectories.push(directory);
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.ADMIN_PASSWORD = "";
    const repository = await import("./repository");
    await repository.initializePersistence();
    await truncatePostgresTables();
    const ownerCredential = createShareOwnerCredential();
    await repository.writeSavedBuilds([{
      id,
      name: "My PC boundary build",
      selection,
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z",
      ownerTokenHash: ownerCredential.hash,
      monitorState: { enabled: true, intervalMinutes: 360, alertPolicy, updatedAt: "2026-09-09T00:00:00.000Z", alerts: [] }
    }]);
    return { ownerCredential };
  }

  it("promotes a build to my-pc and narrows the all-policy monitor to risk", async () => {
    const buildId = "my-pc-promote-build";
    const { ownerCredential } = await seedBuild(buildId, "all");
    const { server, baseUrl } = await startIsolatedServer();
    try {
      const promoted = await fetch(`${baseUrl}/api/builds/${buildId}/my-pc`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Share-Owner-Token": ownerCredential.token },
        body: JSON.stringify({ owned: true })
      });
      expect(promoted.status).toBe(200);
      const body = await promoted.json() as { myPcAt?: string };
      expect(body.myPcAt).toBeTruthy();

      const monitorSubscription = await waitForMonitorRun(baseUrl, buildId, ownerCredential.token);
      expect(monitorSubscription.alertPolicy).toBe("risk");
      expect(monitorSubscription.enabled).toBe(true);
      expect(monitorSubscription.nextCheckAt).toBeTruthy();
      expect(monitorSubscription.lastCheckedAt).toBeTruthy();

      const demoted = await fetch(`${baseUrl}/api/builds/${buildId}/my-pc`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Share-Owner-Token": ownerCredential.token },
        body: JSON.stringify({ owned: false })
      });
      expect(demoted.status).toBe(200);
      expect((await demoted.json() as { myPcAt?: string }).myPcAt).toBeUndefined();

      // 해제하면 승격이 강제한 risk 정책이 아니라 승격 전의 all 정책으로 돌아간다.
      const restoredMonitor = await fetch(`${baseUrl}/api/builds/${buildId}/monitor`, { headers: { "X-Share-Owner-Token": ownerCredential.token } });
      const restoredBody = await restoredMonitor.json() as { subscription: { alertPolicy: string; enabled: boolean; preMyPcAlertPolicy?: string } };
      expect(restoredBody.subscription.alertPolicy).toBe("all");
      expect(restoredBody.subscription.enabled).toBe(true);
      expect(restoredBody.subscription.preMyPcAlertPolicy).toBeUndefined();
    } finally {
      await closeServer(server);
    }
  }, 15_000);

  it("enables the monitor subscription on promote so alternative alerts can actually fire", async () => {
    const buildId = "my-pc-monitor-enable-build";
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-my-pc-enable-"));
    temporaryDirectories.push(directory);
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.ADMIN_PASSWORD = "";
    const repository = await import("./repository");
    await repository.initializePersistence();
    await truncatePostgresTables();
    const ownerCredential = createShareOwnerCredential();
    // 모니터 구독이 아예 없는 견적 — 승격만으로 enabled 구독이 생겨야 한다.
    await repository.writeSavedBuilds([{
      id: buildId,
      name: "Monitor-less build",
      selection,
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z",
      ownerTokenHash: ownerCredential.hash
    }]);
    const { server, baseUrl } = await startIsolatedServer();
    try {
      const promoted = await fetch(`${baseUrl}/api/builds/${buildId}/my-pc`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Share-Owner-Token": ownerCredential.token },
        body: JSON.stringify({ owned: true })
      });
      expect(promoted.status).toBe(200);

      const subscription = await waitForMonitorRun(baseUrl, buildId, ownerCredential.token);
      expect(subscription.enabled).toBe(true);
      expect(subscription.alertPolicy).toBe("risk");
      expect(subscription.nextCheckAt).toBeTruthy();
      expect(subscription.lastCheckedAt).toBeTruthy();
    } finally {
      await closeServer(server);
    }
  }, 15_000);

  it("rejects my-pc changes without an owner token", async () => {
    const buildId = "my-pc-unauthorized-build";
    await seedBuild(buildId);
    const { server, baseUrl } = await startIsolatedServer();
    try {
      const response = await fetch(`${baseUrl}/api/builds/${buildId}/my-pc`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owned: true })
      });
      expect(response.status).toBe(401);
    } finally {
      await closeServer(server);
    }
  }, 15_000);

  it("emits an alternative alert during a monitor run for an owned pc", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-my-pc-alt-"));
    temporaryDirectories.push(directory);
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    process.env.ADMIN_PASSWORD = "";
    const repository = await import("./repository");
    await repository.initializePersistence();
    await truncatePostgresTables();
    const ownerCredential = createShareOwnerCredential();
    // source:"manual" 부품은 danawa reparse를 거치지 않아 벤치 점수가 유지된다.
    await repository.writeCatalogRecords([
      cpuPart("cpu-current", 10000, 300000),
      cpuPart("cpu-better", 13000, 400000)
    ].map((part) => ({ ...part, source: "manual" as const })));
    await repository.writeSavedBuilds([{
      id: "my-pc-monitor-build",
      name: "모니터 대상 내 PC",
      selection: { ...selection, cpu: { partId: "cpu-current", quantity: 1 } },
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z",
      ownerTokenHash: ownerCredential.hash,
      myPcAt: "2026-09-10T00:00:00.000Z",
      monitorState: { enabled: true, intervalMinutes: 360, alertPolicy: "risk", updatedAt: "2026-09-09T00:00:00.000Z", alerts: [] }
    }]);
    const { server, baseUrl } = await startIsolatedServer();
    try {
      const run = await fetch(`${baseUrl}/api/builds/my-pc-monitor-build/monitor/run`, {
        method: "POST",
        headers: { "X-Share-Owner-Token": ownerCredential.token }
      });
      expect(run.status).toBe(200);
      const monitor = await fetch(`${baseUrl}/api/builds/my-pc-monitor-build/monitor`, { headers: { "X-Share-Owner-Token": ownerCredential.token } });
      const body = await monitor.json() as { subscription: { alerts: Array<{ kind: string; message: string }> } };
      const alternative = body.subscription.alerts.find((alert) => alert.kind === "alternative");
      expect(alternative).toBeTruthy();
      expect(alternative!.message).toContain("cpu-better");
    } finally {
      await closeServer(server);
    }
  }, 20_000);
});

describe("saved build alternative detection", () => {
  const at = "2026-09-12T00:00:00.000Z";

  it("flags a benchmark-backed better cpu candidate within the price bound", () => {
    const catalog = [cpuPart("cpu-current", 10000, 300000), cpuPart("cpu-better", 12000, 320000), cpuPart("cpu-worse", 8000, 100000)];
    const alerts = savedBuildAlternativeAlertsFor(ownedRecord(), catalog, at);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("alternative");
    expect(alerts[0].message).toContain("cpu-better");
    expect(alerts[0].message).toContain("+20%");
  });

  it("does not flag candidates outside the price or score bound", () => {
    const catalog = [cpuPart("cpu-current", 10000, 300000), cpuPart("cpu-pricey", 14000, 600000), cpuPart("cpu-marginal", 10500, 250000)];
    expect(savedBuildAlternativeAlertsFor(ownedRecord(), catalog, at)).toHaveLength(0);
  });

  it("stays silent when the current part has no benchmark evidence", () => {
    const catalog = [cpuPart("cpu-current", 0, 300000), cpuPart("cpu-better", 20000, 250000)];
    const build = ownedRecord({ selection: { ...selection, cpu: { partId: "cpu-current", quantity: 1 } } });
    const noScoreCurrent = catalog.map((part) => part.id === "cpu-current" ? { ...part, specs: {} } : part);
    expect(savedBuildAlternativeAlertsFor(build, noScoreCurrent, at)).toHaveLength(0);
  });

  it("produces a stable alert id so repeated runs do not duplicate", () => {
    const catalog = [cpuPart("cpu-current", 10000, 300000), cpuPart("cpu-better", 13000, 320000)];
    const first = savedBuildAlternativeAlertsFor(ownedRecord(), catalog, at);
    const second = savedBuildAlternativeAlertsFor(ownedRecord(), catalog, "2026-09-13T00:00:00.000Z");
    expect(first[0].id).toBe(second[0].id);
  });
});
