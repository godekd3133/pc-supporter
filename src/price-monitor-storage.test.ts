import { describe, expect, it } from "vitest";
import { autoRefreshEnabledFromStorage, autoRefreshMinutesFromStorage, priceAlertsFromJson, priceAlertsToJson, priceBaselineFromJson, priceBaselineToJson } from "./price-monitor-storage";

describe("price monitor storage", () => {
  it("normalizes valid baselines and drops malformed entries", () => {
    const value = priceBaselineFromJson(JSON.stringify({ "part:cpu-1": { status: "available", priceWon: 120000 }, bad: { status: "available", priceWon: 0 }, broken: { status: "unknown" }, transient: { status: "error" }, text: "invalid" }));
    expect(value).toEqual({ "part:cpu-1": { status: "available", priceWon: 120000 }, bad: { status: "available" } });
    expect(priceBaselineFromJson("not-json")).toEqual({});
    expect(priceBaselineFromJson(priceBaselineToJson(value))).toEqual(value);
  });

  it("keeps only valid alerts and caps the persisted history", () => {
    const alerts = Array.from({ length: 22 }, (_value, index) => ({ id: "alert-" + index, itemKey: "part:cpu-1", message: "알림 " + index, kind: "drop" as const, createdAt: "2026-08-28T00:00:00.000Z" }));
    const restored = priceAlertsFromJson(JSON.stringify([...alerts, { id: "bad" }, null]));
    expect(restored).toHaveLength(20);
    expect(restored[0].id).toBe("alert-0");
    expect(priceAlertsFromJson(priceAlertsToJson(alerts))).toHaveLength(20);
  });

  it("uses safe defaults for monitoring settings", () => {
    expect(autoRefreshMinutesFromStorage("5")).toBe(5);
    expect(autoRefreshMinutesFromStorage("60")).toBe(15);
    expect(autoRefreshMinutesFromStorage(null, 30)).toBe(30);
    expect(autoRefreshEnabledFromStorage("true")).toBe(true);
    expect(autoRefreshEnabledFromStorage("1")).toBe(false);
  });
});
