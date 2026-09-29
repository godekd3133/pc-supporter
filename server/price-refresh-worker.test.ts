import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackgroundJob, BackgroundJobStore } from "./background-job-store";
import { scheduledPriceRefreshJobIsCurrent, startPriceRefreshQueueWorker } from "./price-refresh-worker";
import type { PriceRefreshStatus } from "./price-refresh";

const completedStatus: PriceRefreshStatus = {
  startedAt: "2026-09-29T12:00:00.000Z",
  completedAt: "2026-09-29T12:00:02.000Z",
  running: false,
  dryRun: true,
  attempted: 0,
  succeeded: 0,
  changed: 0,
  failed: 0,
  failures: []
};

function job(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "price-refresh",
    status: "running",
    payload: { dryRun: true, coreLimit: 0, accessoryLimit: 0, delayMs: 0 },
    idempotencyKey: null,
    result: null,
    attempt: 1,
    maxAttempts: 5,
    availableAt: "2026-09-29T12:00:00.000Z",
    progress: null,
    createdAt: "2026-09-29T12:00:00.000Z",
    updatedAt: "2026-09-29T12:00:00.000Z",
    finishedAt: null,
    leaseOwner: "worker-test",
    leaseToken: "00000000-0000-4000-8000-000000000002",
    leaseExpiresAt: "2026-09-29T12:01:00.000Z",
    error: null,
    ...overrides
  };
}

function storeFor(oneJob: BackgroundJob) {
  let handedOut = false;
  const store = {
    async enqueue() { return oneJob; },
    async claimNext() {
      if (handedOut) return null;
      handedOut = true;
      return oneJob;
    },
    async heartbeat(): Promise<boolean> { return true; },
    async updateProgress(): Promise<boolean> { return true; },
    async complete(): Promise<boolean> { return true; },
    async fail(): Promise<boolean> { return true; },
    async requeue(): Promise<boolean> { return true; },
    async getById() { return oneJob; },
    async getLatestByKind() { return oneJob; },
    async getActiveByKind() { return oneJob; },
    async pruneFinished() { return 0; }
  } satisfies BackgroundJobStore;
  return store;
}

describe("price-refresh durable worker", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousRefreshInterval = process.env.PRICE_REFRESH_INTERVAL_HOURS;
  let directories: string[] = [];

  afterEach(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousRefreshInterval === undefined) delete process.env.PRICE_REFRESH_INTERVAL_HOURS;
    else process.env.PRICE_REFRESH_INTERVAL_HOURS = previousRefreshInterval;
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
    directories = [];
  });

  it("claims the owned kind, runs under the injected catalog lease, and writes a bounded terminal result", async () => {
    process.env.DATABASE_URL = "postgres://synthetic.test/pc_supporter";
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-price-worker-success-"));
    directories.push(directory);
    const store = storeFor(job());
    const claimNext = vi.spyOn(store, "claimNext");
    const complete = vi.spyOn(store, "complete");
    const run = vi.fn(async (options) => {
      await options.assertLease?.();
      await options.onProgress?.({ ...completedStatus, running: true });
      return completedStatus;
    });
    const runUnderLeaseCalls = vi.fn();
    const runUnderLease = async <T>(operation: () => Promise<T>): Promise<T> => {
      runUnderLeaseCalls();
      return operation();
    };
    const worker = startPriceRefreshQueueWorker({
      store,
      run,
      owner: "worker-test",
      leaseDurationMs: 3_000,
      pollIntervalMs: 100,
      healthFilePath: join(directory, "worker-health.json"),
      runUnderCatalogIngestionLease: runUnderLease
    });
    const loop = worker.start();
    const deadline = Date.now() + 1_000;
    while (complete.mock.calls.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    await worker.stop();
    await loop;

    expect(claimNext).toHaveBeenCalledWith("worker-test", 3_000, ["price-refresh"]);
    expect(runUnderLeaseCalls).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(job().id, { owner: "worker-test", token: job().leaseToken }, { phase: "finalizing", completed: 0 }, expect.objectContaining({ dryRun: true, attempted: 0, failed: 0 }));
    const health = JSON.parse(await readFile(join(directory, "worker-health.json"), "utf8")) as { lastDatabaseSuccessAt: string | null };
    expect(health.lastDatabaseSuccessAt).toBeTruthy();
  });

  it("stops taking a live lease through its fencing path when graceful shutdown begins", async () => {
    process.env.DATABASE_URL = "postgres://synthetic.test/pc_supporter";
    const directory = await mkdtemp(join(tmpdir(), "pc-supporter-price-worker-stop-"));
    directories.push(directory);
    const store = storeFor(job());
    const complete = vi.spyOn(store, "complete");
    const fail = vi.spyOn(store, "fail");
    let signalHandlerStarted!: () => void;
    let releaseHandler!: () => void;
    const handlerStarted = new Promise<void>((resolve) => { signalHandlerStarted = resolve; });
    const handlerGate = new Promise<void>((resolve) => { releaseHandler = resolve; });
    const worker = startPriceRefreshQueueWorker({
      store,
      run: async (options) => {
        signalHandlerStarted();
        await handlerGate;
        await options.assertLease?.();
        return completedStatus;
      },
      owner: "worker-test",
      leaseDurationMs: 3_000,
      pollIntervalMs: 100,
      healthFilePath: join(directory, "stop-health.json"),
      runUnderCatalogIngestionLease: async <T>(operation: () => Promise<T>) => operation()
    });
    const loop = worker.start();
    await handlerStarted;
    const stopping = worker.stop();
    releaseHandler();
    await Promise.all([stopping, loop]);

    expect(complete).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it("retries handler failures with structured backoff and stops mutations after heartbeat loss", async () => {
    process.env.DATABASE_URL = "postgres://synthetic.test/pc_supporter";
    const failureDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-price-worker-failure-"));
    directories.push(failureDirectory);
    const retryStore = storeFor(job({ attempt: 2 }));
    const fail = vi.spyOn(retryStore, "fail");
    const failedWorker = startPriceRefreshQueueWorker({
      store: retryStore,
      run: async () => { throw new Error("private crawler response html"); },
      owner: "worker-test",
      leaseDurationMs: 3_000,
      pollIntervalMs: 100,
      healthFilePath: join(failureDirectory, "retry-health.json"),
      runUnderCatalogIngestionLease: async (operation) => operation()
    });
    const failedLoop = failedWorker.start();
    const deadline = Date.now() + 1_000;
    while (fail.mock.calls.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    await failedWorker.stop();
    await failedLoop;
    expect(fail).toHaveBeenCalledWith(job().id, { owner: "worker-test", token: job().leaseToken }, { code: "WORKER_FAILED", retryable: true }, 10_000);
    expect(JSON.stringify(fail.mock.calls)).not.toContain("private crawler response html");

    const lostDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-price-worker-lost-"));
    directories.push(lostDirectory);
    const lostStore = storeFor(job());
    vi.spyOn(lostStore, "heartbeat").mockResolvedValue(false);
    const lostComplete = vi.spyOn(lostStore, "complete");
    const lostFail = vi.spyOn(lostStore, "fail");
    const lostWorker = startPriceRefreshQueueWorker({
      store: lostStore,
      run: async (options) => { await options.assertLease?.(); return completedStatus; },
      owner: "worker-test",
      leaseDurationMs: 3_000,
      pollIntervalMs: 100,
      healthFilePath: join(lostDirectory, "lost-health.json"),
      runUnderCatalogIngestionLease: async (operation) => operation(),
      onError: () => undefined
    });
    const lostLoop = lostWorker.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await lostWorker.stop();
    await lostLoop;
    expect(lostComplete).not.toHaveBeenCalled();
    expect(lostFail).not.toHaveBeenCalled();
  });

  it("skips stale scheduled slots before the handler when the worker catches up", async () => {
    process.env.DATABASE_URL = "postgres://synthetic.test/pc_supporter";
    process.env.PRICE_REFRESH_INTERVAL_HOURS = "3";
    const scheduleDirectory = await mkdtemp(join(tmpdir(), "pc-supporter-price-worker-schedule-skip-"));
    directories.push(scheduleDirectory);
    const intervalMs = 3 * 60 * 60_000;
    const now = Date.parse("2026-09-29T18:15:00.000Z");
    const currentSlot = Math.floor(now / intervalMs);
    expect(scheduledPriceRefreshJobIsCurrent({ intervalMs, slot: currentSlot }, now, intervalMs)).toBe(true);
    expect(scheduledPriceRefreshJobIsCurrent({ intervalMs, slot: currentSlot - 1 }, now, intervalMs)).toBe(false);
    expect(scheduledPriceRefreshJobIsCurrent({ intervalMs: 2 * 60 * 60_000, slot: currentSlot }, now, intervalMs)).toBe(false);

    const scheduled = job({
      payload: {
        dryRun: false,
        coreLimit: 100,
        accessoryLimit: 500,
        delayMs: 1_200,
        trigger: "scheduled",
        scheduledIntervalMs: intervalMs,
        scheduledSlot: currentSlot - 1
      }
    });
    const store = storeFor(scheduled);
    const complete = vi.spyOn(store, "complete");
    const run = vi.fn(async () => completedStatus);
    const worker = startPriceRefreshQueueWorker({
      store,
      run,
      owner: "worker-test",
      leaseDurationMs: 3_000,
      pollIntervalMs: 100,
      healthFilePath: join(scheduleDirectory, "schedule-health.json"),
      now: () => now,
      runUnderCatalogIngestionLease: async <T>(operation: () => Promise<T>) => operation()
    });
    const loop = worker.start();
    const deadline = Date.now() + 1_000;
    while (complete.mock.calls.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    await worker.stop();
    await loop;
    expect(run).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(scheduled.id, { owner: "worker-test", token: scheduled.leaseToken }, {
      phase: "finalizing", completed: 0
    }, { dryRun: false, attempted: 0, succeeded: 0, changed: 0, failed: 0, skippedCode: "STALE_SCHEDULE_SLOT" });
  });
});
