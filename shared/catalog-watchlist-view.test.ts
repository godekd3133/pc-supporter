import { describe, expect, it } from "vitest";
import type { CatalogWatchSnapshot } from "./catalog-watchlist-export";
import { catalogWatchSnapshotMatches, catalogWatchSnapshotTargetGap, sortCatalogWatchSnapshots } from "./catalog-watchlist-view";

const snapshot = (overrides: Partial<CatalogWatchSnapshot> = {}): CatalogWatchSnapshot => ({
  entry: { itemId: "part-1", itemName: "테스트 CPU", category: "cpu", kind: "part", addedAt: "2026-08-28T00:00:00.000Z" },
  currentDataStatus: "available",
  targetPriceWon: 90000,
  sampleCount: 2,
  latestPriceWon: 100000,
  signals: [],
  ...overrides
});

describe("catalog watchlist view", () => {
  it("searches by name, id, or category and filters by status or target signal", () => {
    const target = snapshot({ signals: ["목표가 도달"] });
    const unavailable = snapshot({ entry: { ...snapshot().entry, itemId: "part-2", itemName: "미확인 GPU", category: "gpu" }, currentDataStatus: "price_unavailable", latestPriceWon: undefined, targetPriceWon: undefined });

    expect(catalogWatchSnapshotMatches(target, "cpu", "target_reached")).toBe(true);
    expect(catalogWatchSnapshotMatches(target, "part-1", "signals")).toBe(true);
    expect(catalogWatchSnapshotMatches(unavailable, "gpu", "price_unavailable")).toBe(true);
    expect(catalogWatchSnapshotMatches(unavailable, "cpu", "all")).toBe(false);
  });

  it("calculates target gap and puts snapshots with missing values last", () => {
    const nearTarget = snapshot({ entry: { ...snapshot().entry, itemId: "near" }, targetPriceWon: 95000, latestPriceWon: 100000 });
    const reached = snapshot({ entry: { ...snapshot().entry, itemId: "reached" }, targetPriceWon: 110000, latestPriceWon: 100000 });
    const missing = snapshot({ entry: { ...snapshot().entry, itemId: "missing" }, targetPriceWon: undefined, latestPriceWon: undefined });

    expect(catalogWatchSnapshotTargetGap(nearTarget)).toBe(5000);
    expect(sortCatalogWatchSnapshots([missing, nearTarget, reached], "target_gap_asc").map((item) => item.entry.itemId)).toEqual(["reached", "near", "missing"]);
  });

  it("sorts without mutating the source list and prioritizes active signals", () => {
    const quiet = snapshot({ entry: { ...snapshot().entry, itemId: "quiet", addedAt: "2026-08-28T02:00:00Z" } });
    const active = snapshot({ entry: { ...snapshot().entry, itemId: "active", addedAt: "2026-08-28T01:00:00Z" }, signals: ["최저가 근접", "목표가 도달"] });
    const source = [quiet, active];

    expect(sortCatalogWatchSnapshots(source, "signal_desc").map((item) => item.entry.itemId)).toEqual(["active", "quiet"]);
    expect(source.map((item) => item.entry.itemId)).toEqual(["quiet", "active"]);
  });
});
