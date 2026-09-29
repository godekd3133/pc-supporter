import type { PriceRefreshStatus } from "./price-refresh";
import type { BackgroundJob } from "./background-job-store";

export type PriceRefreshOptions = {
  coreLimit?: number;
  accessoryLimit?: number;
  delayMs?: number;
  dryRun?: boolean;
  onStarted?: (status: PriceRefreshStatus) => void;
};

export type PriceRefreshRunner = (options: PriceRefreshOptions) => Promise<PriceRefreshStatus>;
export type PriceRefreshStartOutcome =
  | { kind: "started" }
  | { kind: "finished" }
  | { kind: "failed"; error: unknown };

export function waitForPriceRefreshStart(started: Promise<void>, job: Promise<PriceRefreshStatus>): Promise<PriceRefreshStartOutcome> {
  const finished = job.then(
    () => ({ kind: "finished" as const }),
    (error: unknown) => ({ kind: "failed" as const, error })
  );
  return Promise.race([started.then(() => ({ kind: "started" as const })), finished]);
}

export function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = value === undefined || value.trim() === "" ? fallback : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

export function priceRefreshOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): Required<Pick<PriceRefreshOptions, "coreLimit" | "accessoryLimit" | "delayMs" | "dryRun">> {
  return {
    coreLimit: boundedInteger(env.PRICE_REFRESH_CORE_LIMIT, 100, 1, 100),
    accessoryLimit: boundedInteger(env.PRICE_REFRESH_ACCESSORY_LIMIT, 500, 1, 1000),
    delayMs: boundedInteger(env.PRICE_REFRESH_DELAY_MS, 1200, 500, 10000),
    dryRun: false
  };
}

export interface PriceRefreshScheduleSlot {
  intervalMs: number;
  slot: number;
  scheduledAt: number;
}

/** A shared UTC time bucket makes every scheduler replica agree on one durable run. */
export function scheduledPriceRefreshSlot(now: number | Date, intervalMs: number): PriceRefreshScheduleSlot {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new TypeError("Price-refresh interval must be at least one second.");
  const timestamp = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new TypeError("Price-refresh schedule time is invalid.");
  const slot = Math.floor(timestamp / intervalMs);
  return { intervalMs, slot, scheduledAt: slot * intervalMs };
}

export function scheduledPriceRefreshIdempotencyKey(now: number | Date, intervalMs: number) {
  const slot = scheduledPriceRefreshSlot(now, intervalMs);
  return `price-refresh:scheduled:${intervalMs}:${slot.slot}`;
}

export function priceRefreshIntervalMsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const intervalHours = Number(env.PRICE_REFRESH_INTERVAL_HOURS ?? 3);
  return Number.isFinite(intervalHours) && intervalHours > 0
    ? Math.max(1_000, Math.min(365 * 24 * 60 * 60 * 1_000, Math.floor(intervalHours * 60 * 60 * 1_000)))
    : 0;
}

/** Scheduler instances enqueue only the current slot; missed slots are never replayed. */
export function startDurablePriceRefreshScheduler({
  enqueue,
  intervalMs,
  now = Date.now,
  onError = (error) => console.error("Price refresh schedule enqueue failed", error)
}: {
  enqueue: (idempotencyKey: string, slot: PriceRefreshScheduleSlot) => Promise<BackgroundJob>;
  intervalMs: number;
  now?: () => number;
  onError?: (error: unknown) => void;
}) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight: Promise<BackgroundJob> | undefined;
  const enqueueCurrentSlot = () => {
    if (intervalMs <= 0 || inFlight) return inFlight;
    const slot = scheduledPriceRefreshSlot(now(), intervalMs);
    const key = scheduledPriceRefreshIdempotencyKey(slot.scheduledAt, slot.intervalMs);
    const current = enqueue(key, slot).finally(() => {
      if (inFlight === current) inFlight = undefined;
    });
    inFlight = current;
    return current;
  };
  return {
    enqueueCurrentSlot,
    async waitForIdle() {
      if (inFlight) await inFlight.catch(() => undefined);
    },
    start() {
      if (timer) clearInterval(timer);
      if (intervalMs > 0) {
        timer = setInterval(() => { void enqueueCurrentSlot()?.catch(onError); }, intervalMs);
        timer.unref();
      }
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Starts a bounded refresh timer. The runner itself owns source selection and persistence. */
export function startPriceRefreshScheduler({
  run,
  onError = (error) => console.error("Price refresh job failed", error)
}: {
  run: PriceRefreshRunner;
  onError?: (error: unknown) => void;
}) {
  let inFlight: Promise<PriceRefreshStatus> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const runOnce = (options: PriceRefreshOptions) => {
    if (inFlight) return inFlight;
    const current = run(options).finally(() => {
      if (inFlight === current) inFlight = undefined;
    });
    inFlight = current;
    return current;
  };
  const tryRunOnce = (options: PriceRefreshOptions) => {
    if (inFlight) return undefined;
    return runOnce(options);
  };
  const start = (intervalMs: number) => {
    if (timer) clearInterval(timer);
    timer = intervalMs > 0 ? setInterval(() => {
      if (!inFlight) void runOnce(priceRefreshOptionsFromEnv()).catch(onError);
    }, intervalMs) : undefined;
    timer?.unref();
  };
  return {
    runOnce,
    tryRunOnce,
    async waitForIdle() {
      if (inFlight) await inFlight.catch(() => undefined);
    },
    start,
    isRunning: () => Boolean(inFlight),
    stop: () => { if (timer) clearInterval(timer); timer = undefined; }
  };
}
