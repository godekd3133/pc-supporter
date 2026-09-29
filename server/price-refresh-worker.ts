import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { BackgroundJob, BackgroundJobClaim, BackgroundJobStore } from "./background-job-store";
import { backgroundJobStore } from "./background-job-store";
import { withCatalogIngestionLease } from "./catalog-ingestion-coordinator";
import { runPriceRefreshJob, type PriceRefreshJobOptions, type PriceRefreshStatus } from "./price-refresh";
import { priceRefreshIntervalMsFromEnv, priceRefreshOptionsFromEnv } from "./price-refresh-scheduler";

export const PRICE_REFRESH_WORKER_KINDS = ["price-refresh"] as const;
export const PRICE_REFRESH_WORKER_LEASE_MS = 60_000;
export const PRICE_REFRESH_WORKER_POLL_MS = 1_000;
export const PRICE_REFRESH_WORKER_HEALTH_MAX_AGE_MS = 45_000;

export interface PriceRefreshWorkerHealth {
  service: "pc-supporter-price-refresh-worker";
  owner: string;
  startedAt: string;
  lastDatabaseSuccessAt: string | null;
  lastFailureCode: "DATABASE_UNAVAILABLE" | "LEASE_LOST" | null;
}

export function priceRefreshWorkerHealthFilePath() {
  const dataDirectory = process.env.PC_SUPPORTER_DATA_DIR?.trim() || resolve(process.cwd(), "data");
  return resolve(dataDirectory, ".price-refresh-worker-health.json");
}

export class PriceRefreshWorkerLeaseLostError extends Error {
  constructor() {
    super("The price-refresh worker lease is no longer current.");
    this.name = "PriceRefreshWorkerLeaseLostError";
  }
}

export class InvalidPriceRefreshPayloadError extends Error {
  constructor() {
    super("The price-refresh job payload is invalid.");
    this.name = "InvalidPriceRefreshPayloadError";
  }
}

interface ScheduledRefreshIdentity {
  intervalMs: number;
  slot: number;
}

interface ParsedPriceRefreshWork {
  options: PriceRefreshJobOptions;
  schedule?: ScheduledRefreshIdentity;
}

export function scheduledPriceRefreshJobIsCurrent(schedule: ScheduledRefreshIdentity, now: number, currentIntervalMs: number) {
  return currentIntervalMs > 0
    && schedule.intervalMs === currentIntervalMs
    && schedule.slot === Math.floor(now / currentIntervalMs);
}

function priceRefreshWorkFromPayload(payload: Record<string, unknown>): ParsedPriceRefreshWork {
  const allowed = new Set(["coreLimit", "accessoryLimit", "delayMs", "dryRun", "trigger", "scheduledIntervalMs", "scheduledSlot"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw new InvalidPriceRefreshPayloadError();
  const defaults = priceRefreshOptionsFromEnv();
  const bounded = (key: "coreLimit" | "accessoryLimit" | "delayMs", maximum: number, minimum: number) => {
    const value = payload[key];
    if (value === undefined) return defaults[key];
    if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new InvalidPriceRefreshPayloadError();
    return Number(value);
  };
  if (payload.dryRun !== undefined && typeof payload.dryRun !== "boolean") throw new InvalidPriceRefreshPayloadError();
  const scheduleKeysProvided = payload.scheduledIntervalMs !== undefined || payload.scheduledSlot !== undefined;
  let schedule: ScheduledRefreshIdentity | undefined;
  if (payload.trigger !== undefined || scheduleKeysProvided) {
    if (payload.trigger !== "scheduled"
      || !Number.isSafeInteger(payload.scheduledIntervalMs)
      || Number(payload.scheduledIntervalMs) < 1_000
      || Number(payload.scheduledIntervalMs) > 365 * 24 * 60 * 60 * 1_000
      || !Number.isSafeInteger(payload.scheduledSlot)
      || Number(payload.scheduledSlot) < 0) throw new InvalidPriceRefreshPayloadError();
    schedule = { intervalMs: Number(payload.scheduledIntervalMs), slot: Number(payload.scheduledSlot) };
  }
  return {
    options: {
      coreLimit: bounded("coreLimit", 100, 0),
      accessoryLimit: bounded("accessoryLimit", 1_000, 0),
      delayMs: bounded("delayMs", 10_000, 0),
      dryRun: payload.dryRun === true
    },
    ...(schedule ? { schedule } : {})
  };
}

function boundedResult(status: PriceRefreshStatus) {
  return {
    startedAt: status.startedAt,
    completedAt: status.completedAt ?? new Date().toISOString(),
    dryRun: status.dryRun,
    attempted: status.attempted,
    succeeded: status.succeeded,
    changed: status.changed,
    failed: status.failed
  };
}

function staleScheduleResult() {
  return { dryRun: false, attempted: 0, succeeded: 0, changed: 0, failed: 0, skippedCode: "STALE_SCHEDULE_SLOT" };
}

function retryDelayForAttempt(attempt: number) {
  return Math.min(10 * 60_000, 5_000 * (2 ** Math.max(0, attempt - 1)));
}

function sleep(ms: number) {
  return new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function startPriceRefreshQueueWorker({
  store = backgroundJobStore,
  run = runPriceRefreshJob,
  owner = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`,
  leaseDurationMs = PRICE_REFRESH_WORKER_LEASE_MS,
  pollIntervalMs = PRICE_REFRESH_WORKER_POLL_MS,
  healthFilePath = priceRefreshWorkerHealthFilePath(),
  now = Date.now,
  runUnderCatalogIngestionLease = withCatalogIngestionLease,
  onError = (code) => console.warn(`Price-refresh worker encountered ${code}.`)
}: {
  store?: BackgroundJobStore;
  run?: (options: PriceRefreshJobOptions) => Promise<PriceRefreshStatus>;
  owner?: string;
  leaseDurationMs?: number;
  pollIntervalMs?: number;
  healthFilePath?: string;
  now?: () => number;
  runUnderCatalogIngestionLease?: <T>(operation: () => Promise<T>) => Promise<T>;
  onError?: (code: "DATABASE_UNAVAILABLE" | "LEASE_LOST") => void;
} = {}) {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("The price-refresh queue worker requires DATABASE_URL.");
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 3_000 || leaseDurationMs > 10 * 60_000) {
    throw new TypeError("The price-refresh worker lease duration is invalid.");
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 60_000) {
    throw new TypeError("The price-refresh worker poll interval is invalid.");
  }

  const health: PriceRefreshWorkerHealth = {
    service: "pc-supporter-price-refresh-worker",
    owner,
    startedAt: new Date(now()).toISOString(),
    lastDatabaseSuccessAt: null,
    lastFailureCode: null
  };
  let stopped = false;
  let loopPromise: Promise<void> | undefined;
  let lastHealthFileWriteAt = 0;

  const writeHealth = async (immediate = false) => {
    if (!immediate && now() - lastHealthFileWriteAt < 10_000) return;
    await mkdir(dirname(healthFilePath), { recursive: true });
    const tempPath = `${healthFilePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(health)}\n`, { mode: 0o600 });
    await rename(tempPath, healthFilePath);
    lastHealthFileWriteAt = now();
  };

  const observeDatabaseSuccess = async () => {
    const isFirstSuccess = health.lastDatabaseSuccessAt === null;
    const recovering = health.lastFailureCode !== null;
    health.lastDatabaseSuccessAt = new Date(now()).toISOString();
    health.lastFailureCode = null;
    await writeHealth(isFirstSuccess || recovering);
  };

  const processClaim = async (job: BackgroundJob) => {
    if (!job.leaseToken) return;
    const claim: BackgroundJobClaim = { owner, token: job.leaseToken };
    let leaseLost = false;
    let heartbeatInFlight: Promise<void> | undefined;
    let lastHeartbeatAt = 0;
    const heartbeatOnce = () => {
      if (heartbeatInFlight) return heartbeatInFlight;
      const current = (async () => {
        try {
          if (!await store.heartbeat(job.id, claim, leaseDurationMs)) {
            leaseLost = true;
            health.lastFailureCode = "LEASE_LOST";
            onError("LEASE_LOST");
            await writeHealth(true);
            return;
          }
          lastHeartbeatAt = now();
          await observeDatabaseSuccess();
        } catch {
          leaseLost = true;
          health.lastFailureCode = "DATABASE_UNAVAILABLE";
          onError("DATABASE_UNAVAILABLE");
          await writeHealth(true).catch(() => undefined);
        }
      })().finally(() => {
        if (heartbeatInFlight === current) heartbeatInFlight = undefined;
    });
    heartbeatInFlight = current;
    return current;
  };
  const assertLease = async () => {
    if (stopped || leaseLost) throw new PriceRefreshWorkerLeaseLostError();
    if (now() - lastHeartbeatAt >= Math.floor(leaseDurationMs / 3)) await heartbeatOnce();
    if (stopped || leaseLost) throw new PriceRefreshWorkerLeaseLostError();
  };
    const heartbeatTimer = setInterval(() => { void heartbeatOnce(); }, Math.floor(leaseDurationMs / 3));
    heartbeatTimer.unref();
    try {
      const work = priceRefreshWorkFromPayload(job.payload);
      if (work.schedule && !scheduledPriceRefreshJobIsCurrent(work.schedule, now(), priceRefreshIntervalMsFromEnv())) {
        await assertLease();
        let skipped: boolean;
        try {
          skipped = await store.complete(job.id, claim, { phase: "finalizing", completed: 0 }, staleScheduleResult());
        } catch {
          leaseLost = true;
          health.lastFailureCode = "DATABASE_UNAVAILABLE";
          onError("DATABASE_UNAVAILABLE");
          await writeHealth(true).catch(() => undefined);
          return;
        }
        if (!skipped) {
          leaseLost = true;
          health.lastFailureCode = "LEASE_LOST";
          onError("LEASE_LOST");
          await writeHealth(true);
          return;
        }
        await observeDatabaseSuccess();
        return;
      }
      const status = await runUnderCatalogIngestionLease(() => run({
        ...work.options,
        persistStatus: false,
        assertLease,
        onProgress: async (latest) => {
          await assertLease();
          const progress = latest.running
            ? { phase: "fetching" as const, completed: latest.attempted }
            : { phase: "finalizing" as const, completed: latest.attempted };
          let updated: boolean;
          try {
            updated = await store.updateProgress(job.id, claim, progress);
          } catch {
            leaseLost = true;
            health.lastFailureCode = "DATABASE_UNAVAILABLE";
            onError("DATABASE_UNAVAILABLE");
            await writeHealth(true).catch(() => undefined);
            throw new PriceRefreshWorkerLeaseLostError();
          }
          if (!updated) {
            leaseLost = true;
            health.lastFailureCode = "LEASE_LOST";
            onError("LEASE_LOST");
            await writeHealth(true);
            throw new PriceRefreshWorkerLeaseLostError();
          }
          await observeDatabaseSuccess();
        }
      }));
      await assertLease();
      let completed: boolean;
      try {
        completed = await store.complete(job.id, claim, { phase: "finalizing", completed: status.attempted }, boundedResult(status));
      } catch {
        leaseLost = true;
        health.lastFailureCode = "DATABASE_UNAVAILABLE";
        onError("DATABASE_UNAVAILABLE");
        await writeHealth(true).catch(() => undefined);
        return;
      }
      if (!completed) {
        leaseLost = true;
        health.lastFailureCode = "LEASE_LOST";
        onError("LEASE_LOST");
        await writeHealth(true);
        return;
      }
      await observeDatabaseSuccess();
    } catch (error) {
      if (leaseLost || error instanceof PriceRefreshWorkerLeaseLostError) return;
      const invalidPayload = error instanceof InvalidPriceRefreshPayloadError;
      const retryable = !invalidPayload;
      const errorCode = invalidPayload ? "VALIDATION_FAILED" as const : "WORKER_FAILED" as const;
      try {
        if (!await store.fail(job.id, claim, { code: errorCode, retryable }, retryable ? retryDelayForAttempt(job.attempt) : 0)) {
          leaseLost = true;
          health.lastFailureCode = "LEASE_LOST";
          onError("LEASE_LOST");
          await writeHealth(true);
          return;
        }
        await observeDatabaseSuccess();
      } catch {
        health.lastFailureCode = "DATABASE_UNAVAILABLE";
        onError("DATABASE_UNAVAILABLE");
        await writeHealth(true).catch(() => undefined);
      }
    } finally {
      clearInterval(heartbeatTimer);
    }
  };

  const runLoop = async () => {
    await writeHealth(true);
    let nextPruneAt = now();
    while (!stopped) {
      try {
        if (now() >= nextPruneAt) {
          await store.pruneFinished(90, 250);
          nextPruneAt = now() + 24 * 60 * 60_000;
        }
        const job = await store.claimNext(owner, leaseDurationMs, PRICE_REFRESH_WORKER_KINDS);
        await observeDatabaseSuccess();
        if (job) await processClaim(job);
        else await sleep(pollIntervalMs);
      } catch {
        health.lastFailureCode = "DATABASE_UNAVAILABLE";
        onError("DATABASE_UNAVAILABLE");
        await writeHealth(true).catch(() => undefined);
        await sleep(pollIntervalMs);
      }
    }
  };

  return {
    health,
    start() {
      if (!loopPromise) loopPromise = runLoop();
      return loopPromise;
    },
    async stop() {
      stopped = true;
      await loopPromise;
    }
  };
}
