import { describe, expect, it } from "vitest";
import { priceTrendFor } from "./price-trend";

describe("price trend aggregation", () => {
  it("aggregates weighted part history into a quote total and ranks drivers", () => {
    const result = priceTrendFor([
      {
        key: "part:cpu",
        label: "CPU",
        quantity: 1,
        currentPriceWon: 110_000,
        points: [
          { changedAt: "2026-09-01T00:00:00.000Z", priceWon: 100_000 },
          { changedAt: "2026-09-10T00:00:00.000Z", priceWon: 110_000 }
        ]
      },
      {
        key: "part:ram",
        label: "RAM",
        quantity: 2,
        currentPriceWon: 45_000,
        points: [
          { changedAt: "2026-09-01T00:00:00.000Z", priceWon: 50_000 },
          { changedAt: "2026-09-10T00:00:00.000Z", priceWon: 45_000 }
        ]
      }
    ], { days: 30, anchor: "2026-09-21T00:00:00.000Z" });

    expect(result.points.map((point) => point.priceWon)).toEqual([200_000, 200_000, 200_000]);
    expect(result.latestPriceWon).toBe(200_000);
    expect(result.minPriceWon).toBe(200_000);
    expect(result.maxPriceWon).toBe(200_000);
    expect(result.sampleCount).toBe(3);
    expect(result.drivers).toEqual([
      { key: "part:cpu", label: "CPU", deltaWon: 10_000 },
      { key: "part:ram", label: "RAM", deltaWon: -10_000 }
    ]);
  });

  it("keeps the current price flat for an item without a change record", () => {
    const result = priceTrendFor([
      { key: "part:gpu", label: "그래픽카드", quantity: 1, currentPriceWon: 700_000, points: [] },
      { key: "part:ssd", label: "SSD", quantity: 1, currentPriceWon: 100_000, points: [{ changedAt: "2026-09-10T00:00:00.000Z", priceWon: 90_000 }] }
    ], { days: 30, anchor: "2026-09-21T00:00:00.000Z" });

    expect(result.points.at(-1)?.priceWon).toBe(800_000);
    expect(result.coveredItemCount).toBe(2);
    expect(result.historicalSampleCount).toBe(1);
  });

  it("drops invalid and out-of-window samples without inventing a trend", () => {
    const result = priceTrendFor([
      {
        key: "part:cpu",
        label: "CPU",
        quantity: 1,
        currentPriceWon: 100_000,
        points: [
          { changedAt: "2026-07-01T00:00:00.000Z", priceWon: 80_000 },
          { changedAt: "not-a-date", priceWon: 90_000 },
          { changedAt: "2026-09-10T00:00:00.000Z", priceWon: 95_000 }
        ]
      }
    ], { days: 7, anchor: "2026-09-21T00:00:00.000Z" });

    expect(result.historicalSampleCount).toBe(0);
    expect(result.points).toHaveLength(1);
    expect(result.points[0].priceWon).toBe(100_000);
  });
});
