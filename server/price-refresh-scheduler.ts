import type { PriceRefreshStatus } from "./price-refresh";

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
    start,
    isRunning: () => Boolean(inFlight),
    stop: () => { if (timer) clearInterval(timer); timer = undefined; }
  };
}
