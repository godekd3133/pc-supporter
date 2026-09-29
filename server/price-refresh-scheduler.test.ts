import { describe, expect, it } from "vitest";
import { boundedInteger, priceRefreshOptionsFromEnv, scheduledPriceRefreshIdempotencyKey, scheduledPriceRefreshSlot, startDurablePriceRefreshScheduler, startPriceRefreshScheduler, waitForPriceRefreshStart } from "./price-refresh-scheduler";
import type { BackgroundJob } from "./background-job-store";

describe("price refresh scheduler", () => {
  it("bounds configured work to a complete but finite local catalog pass", () => {
    expect(priceRefreshOptionsFromEnv({})).toEqual({ coreLimit: 100, accessoryLimit: 500, delayMs: 1200, dryRun: false });
    expect(priceRefreshOptionsFromEnv({ PRICE_REFRESH_CORE_LIMIT: "999", PRICE_REFRESH_ACCESSORY_LIMIT: "bad", PRICE_REFRESH_DELAY_MS: "1" })).toEqual({
      coreLimit: 100, accessoryLimit: 500, delayMs: 500, dryRun: false
    });
    expect(boundedInteger("-2", 4, 0, 10)).toBe(0);
  });

  it("reserves the in-flight slot synchronously for one manual or scheduled run", async () => {
    let release!: (value: { startedAt: string; completedAt: string; running: boolean; dryRun: boolean; attempted: number; succeeded: number; changed: number; failed: number; failures: never[] }) => void;
    let calls = 0;
    const scheduler = startPriceRefreshScheduler({
      run: () => {
        calls += 1;
        return new Promise((resolve) => { release = resolve; });
      }
    });
    const first = scheduler.tryRunOnce({});
    const second = scheduler.tryRunOnce({ dryRun: true });
    expect(first).toBeInstanceOf(Promise);
    expect(second).toBeUndefined();
    expect(calls).toBe(1);
    expect(scheduler.isRunning()).toBe(true);
    release({ startedAt: "now", completedAt: "later", running: false, dryRun: false, attempted: 1, succeeded: 1, changed: 1, failed: 0, failures: [] });
    await first;
    expect(scheduler.isRunning()).toBe(false);
    scheduler.stop();
  });

  it("does not acknowledge a refresh until the runner signals that its lock is acquired", async () => {
    let markStarted!: () => void;
    let finishJob!: (status: { startedAt: string; completedAt: string; running: boolean; dryRun: boolean; attempted: number; succeeded: number; changed: number; failed: number; failures: never[] }) => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const job = new Promise<{ startedAt: string; completedAt: string; running: boolean; dryRun: boolean; attempted: number; succeeded: number; changed: number; failed: number; failures: never[] }>((resolve) => { finishJob = resolve; });
    let settled = false;
    const outcome = waitForPriceRefreshStart(started, job).then((value) => { settled = true; return value; });

    await Promise.resolve();
    expect(settled).toBe(false);
    markStarted();
    expect(await outcome).toEqual({ kind: "started" });
    finishJob({ startedAt: "now", completedAt: "later", running: false, dryRun: false, attempted: 0, succeeded: 0, changed: 0, failed: 0, failures: [] });
  });

  it("assigns singleton UTC slot keys and catches up only to the latest missed slot", async () => {
    const intervalMs = 3 * 60 * 60 * 1_000;
    const base = Date.parse("2026-09-29T00:00:00.000Z");
    expect(scheduledPriceRefreshIdempotencyKey(base + 1, intervalMs)).toBe("price-refresh:scheduled:10800000:165800");
    expect(scheduledPriceRefreshIdempotencyKey(base + 2 * 60 * 60 * 1_000, intervalMs)).toBe("price-refresh:scheduled:10800000:165800");
    expect(scheduledPriceRefreshIdempotencyKey(base + 8 * 60 * 60 * 1_000, intervalMs)).toBe("price-refresh:scheduled:10800000:165802");
    expect(scheduledPriceRefreshIdempotencyKey(base + 1, 2 * 60 * 60 * 1_000)).toBe("price-refresh:scheduled:7200000:248700");
    expect(scheduledPriceRefreshSlot(base + 1, intervalMs)).toEqual({ intervalMs, slot: 165800, scheduledAt: 165800 * intervalMs });

    let currentTime = base + 8 * 60 * 60 * 1_000;
    const requestedKeys: string[] = [];
    const requestedSlots: Array<{ intervalMs: number; slot: number; scheduledAt: number }> = [];
    const enqueue = async (key: string, slot: { intervalMs: number; slot: number; scheduledAt: number }) => {
      requestedKeys.push(key);
      requestedSlots.push(slot);
      return { id: key, kind: "price-refresh", status: "queued" } as BackgroundJob;
    };
    const firstReplica = startDurablePriceRefreshScheduler({ enqueue, intervalMs, now: () => currentTime });
    const secondReplica = startDurablePriceRefreshScheduler({ enqueue, intervalMs, now: () => currentTime });
    await Promise.all([firstReplica.enqueueCurrentSlot(), secondReplica.enqueueCurrentSlot()]);
    expect(requestedKeys).toEqual(["price-refresh:scheduled:10800000:165802", "price-refresh:scheduled:10800000:165802"]);
    expect(requestedSlots).toEqual([
      { intervalMs, slot: 165802, scheduledAt: 165802 * intervalMs },
      { intervalMs, slot: 165802, scheduledAt: 165802 * intervalMs }
    ]);

    currentTime += 30 * 60 * 60 * 1_000;
    expect(scheduledPriceRefreshIdempotencyKey(currentTime, intervalMs)).toBe("price-refresh:scheduled:10800000:165812");
    await firstReplica.enqueueCurrentSlot();
    expect(requestedKeys).toEqual(["price-refresh:scheduled:10800000:165802", "price-refresh:scheduled:10800000:165802", "price-refresh:scheduled:10800000:165812"]);
  });
});
