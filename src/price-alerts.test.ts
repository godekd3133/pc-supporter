import { describe, expect, it } from "vitest";
import { priceAlertsFor } from "./price-alerts";

const entries = [{ itemKey: "part:cpu-1", itemName: "테스트 CPU", targetPriceWon: 100000 }];

describe("price alerts", () => {
  it("does not alert on the first observation", () => {
    expect(priceAlertsFor(entries, {}, { "part:cpu-1": { priceWon: 120000, status: "available" } }, "2026-08-28T00:00:00.000Z")).toEqual([]);
  });

  it("alerts when a price drops", () => {
    expect(priceAlertsFor(entries, { "part:cpu-1": { priceWon: 120000, status: "available" } }, { "part:cpu-1": { priceWon: 115000, status: "available" } }, "2026-08-28T00:00:00.000Z")).toMatchObject([{ kind: "drop", message: "테스트 CPU 가격이 5,000원 하락했습니다." }]);
  });

  it("prioritizes target reached over the same price drop", () => {
    expect(priceAlertsFor(entries, { "part:cpu-1": { priceWon: 105000, status: "available" } }, { "part:cpu-1": { priceWon: 99000, status: "available" } }, "2026-08-28T00:00:00.000Z")).toMatchObject([{ kind: "target", message: "테스트 CPU이 목표가에 도달했습니다." }]);
  });

  it("ignores unavailable or unchanged observations", () => {
    expect(priceAlertsFor(entries, { "part:cpu-1": { status: "unavailable" } }, { "part:cpu-1": { status: "unavailable" } }, "2026-08-28T00:00:00.000Z")).toEqual([]);
    expect(priceAlertsFor(entries, { "part:cpu-1": { priceWon: 120000, status: "available" } }, { "part:cpu-1": { priceWon: 120000, status: "available" } }, "2026-08-28T00:00:00.000Z")).toEqual([]);
  });

  it("applies disabled signals and a minimum percentage drop", () => {
    expect(priceAlertsFor(entries, { "part:cpu-1": { priceWon: 105000, status: "available" } }, { "part:cpu-1": { priceWon: 99000, status: "available" } }, "2026-08-28T00:00:00.000Z", { targetReached: false, priceDrop: false, priceAvailability: true, minimumDropPercent: 0 })).toEqual([]);
    expect(priceAlertsFor(entries, { "part:cpu-1": { priceWon: 120000, status: "available" } }, { "part:cpu-1": { priceWon: 115000, status: "available" } }, "2026-08-28T00:00:00.000Z", { targetReached: true, priceDrop: true, priceAvailability: true, minimumDropPercent: 5 })).toEqual([]);
    expect(priceAlertsFor(entries, { "part:cpu-1": { priceWon: 120000, status: "available" } }, { "part:cpu-1": { priceWon: 110000, status: "available" } }, "2026-08-28T00:00:00.000Z", { targetReached: true, priceDrop: true, priceAvailability: true, minimumDropPercent: 5 })).toMatchObject([{ kind: "drop" }]);
  });

  it("alerts only on real availability transitions and ignores transient errors", () => {
    const previous = { "part:cpu-1": { priceWon: 120000, status: "available" as const } };
    expect(priceAlertsFor(entries, previous, { "part:cpu-1": { status: "unavailable" } }, "2026-08-28T00:00:00.000Z")).toMatchObject([{ kind: "availability", message: "테스트 CPU의 가격을 확인할 수 없습니다." }]);
    expect(priceAlertsFor(entries, { "part:cpu-1": { status: "unavailable" } }, { "part:cpu-1": { priceWon: 120000, status: "available" } }, "2026-08-28T00:00:00.000Z")).toMatchObject([{ kind: "availability", message: "테스트 CPU의 가격을 다시 확인할 수 있습니다." }]);
    expect(priceAlertsFor(entries, previous, { "part:cpu-1": { status: "error" } }, "2026-08-28T00:00:00.000Z")).toEqual([]);
    expect(priceAlertsFor(entries, previous, { "part:cpu-1": { status: "unavailable" } }, "2026-08-28T00:00:00.000Z", { targetReached: true, priceDrop: true, priceAvailability: false, minimumDropPercent: 0 })).toEqual([]);
  });
});
