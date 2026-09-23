import { describe, expect, it } from "vitest";
import { boundedInteger, priceRefreshOptionsFromEnv, startPriceRefreshScheduler } from "./price-refresh-scheduler";

describe("price refresh scheduler", () => {
  it("bounds configured work to a complete but finite local catalog pass", () => {
    expect(priceRefreshOptionsFromEnv({})).toEqual({ coreLimit: 45, accessoryLimit: 500, delayMs: 1200, dryRun: false });
    expect(priceRefreshOptionsFromEnv({ PRICE_REFRESH_CORE_LIMIT: "999", PRICE_REFRESH_ACCESSORY_LIMIT: "bad", PRICE_REFRESH_DELAY_MS: "1" })).toEqual({
      coreLimit: 100, accessoryLimit: 500, delayMs: 500, dryRun: false
    });
    expect(boundedInteger("-2", 4, 0, 10)).toBe(0);
  });

  it("returns the in-flight promise instead of overlapping manual and scheduled runs", async () => {
    let release!: (value: { running: boolean; attempted: number; succeeded: number; changed: number; failed: number; failures: unknown[] }) => void;
    let calls = 0;
    const scheduler = startPriceRefreshScheduler({
      intervalMs: 0,
      run: () => {
        calls += 1;
        return new Promise((resolve) => { release = resolve; });
      }
    });
    const first = scheduler.runOnce({});
    const second = scheduler.runOnce({ dryRun: true });
    expect(first).toBe(second);
    expect(calls).toBe(1);
    expect(scheduler.isRunning()).toBe(true);
    release({ running: false, attempted: 1, succeeded: 1, changed: 1, failed: 0, failures: [] });
    await first;
    expect(scheduler.isRunning()).toBe(false);
    scheduler.stop();
  });
});
