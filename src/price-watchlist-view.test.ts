import { describe, expect, it } from "vitest";
import type { CatalogWatchEntry } from "../shared/catalog-watchlist";
import { priceWatchEntriesFor } from "./price-watchlist-view";

const entries: CatalogWatchEntry[] = [
  { itemId: "cpu-1", itemName: "테스트 CPU", category: "cpu", kind: "part", addedAt: "2026-08-28T01:00:00.000Z", targetPriceWon: 100000 },
  { itemId: "gpu-1", itemName: "테스트 GPU", category: "gpu", kind: "part", addedAt: "2026-08-28T02:00:00.000Z", targetPriceWon: 300000 },
  { itemId: "fan-1", itemName: "테스트 팬", category: "cooling_fan", kind: "accessory", addedAt: "2026-08-28T03:00:00.000Z" }
];

const observations = {
  "part:cpu-1": { status: "available" as const, priceWon: 120000 },
  "part:gpu-1": { status: "error" as const },
  "accessory:fan-1": { status: "unavailable" as const }
};

describe("price watchlist view", () => {
  it("filters by query and current observation status without mutating the source", () => {
    const original = entries.slice();
    expect(priceWatchEntriesFor(entries, observations, { query: "GPU", status: "error" })).toEqual([entries[1]]);
    expect(priceWatchEntriesFor(entries, observations, { status: "unavailable" })).toEqual([entries[2]]);
    expect(entries).toEqual(original);
  });

  it("prioritizes alert entries and sorts known prices before missing values", () => {
    const alertKeys = new Set(["part:gpu-1"]);
    expect(priceWatchEntriesFor(entries, observations, { status: "alerts", alertKeys })).toEqual([entries[1]]);
    expect(priceWatchEntriesFor(entries, observations, { sort: "price_asc" }).map((entry) => entry.itemId)).toEqual(["cpu-1", "gpu-1", "fan-1"]);
    expect(priceWatchEntriesFor(entries, observations, { sort: "target_gap_asc" }).map((entry) => entry.itemId)).toEqual(["cpu-1", "gpu-1", "fan-1"]);
  });
});
