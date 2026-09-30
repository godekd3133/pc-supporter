import { describe, expect, it, vi } from "vitest";
import type { CatalogWatchEntry } from "../shared/catalog-watchlist";
import type { Part } from "../shared/types";
import { priceWatchDecisionCountsFor, priceWatchEntriesFor, priceWatchlistCapabilitiesFor, priceWatchlistStatusForMode, readPriceWatchCatalogPrices } from "./price-watchlist-view";

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
  it("enables catalog search, history, refresh, alerts, and sharing for the remote-backed view", () => {
    expect(priceWatchlistCapabilitiesFor()).toEqual({
      catalogSearch: true,
      catalogSnapshotPrices: true,
      browserLocalWatchlist: true,
      priceHistory: true,
      automaticRefresh: true,
      alerts: true,
      serverSharing: true
    });
  });

  it("retains alert and history filters with the current capabilities", () => {
    const capabilities = priceWatchlistCapabilitiesFor();
    expect(priceWatchlistStatusForMode("alerts", capabilities)).toBe("alerts");
    expect(priceWatchlistStatusForMode("buy", capabilities)).toBe("buy");
    expect(priceWatchlistStatusForMode("target", capabilities)).toBe("target");
  });

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

  it("filters by the derived price decision state without losing raw status filters", () => {
    const decisionStates = { "part:cpu-1": "buy" as const, "part:gpu-1": "error" as const, "accessory:fan-1": "unavailable" as const };

    expect(priceWatchEntriesFor(entries, observations, { status: "buy", decisionStates })).toEqual([entries[0]]);
    expect(priceWatchEntriesFor(entries, observations, { status: "error", decisionStates })).toEqual([entries[1]]);
    expect(priceWatchDecisionCountsFor(decisionStates)).toEqual({ target: 0, buy: 1, wait: 0, observe: 0, tracking: 0, unavailable: 1, error: 1 });
  });

  it("keeps the catalog source timestamp and provenance separate from the client read time", async () => {
    const catalogItem = {
      id: "cpu-1",
      source: "danawa",
      dataQuality: "live",
      dataFreshness: "aging",
      updatedAt: "2026-09-28T22:15:00.000Z",
      priceCheckedAt: "2026-09-28T23:30:00.000Z",
      priceWon: 104000
    } as Part;

    const prices = await readPriceWatchCatalogPrices([entries[0]], async () => catalogItem, new AbortController().signal);

    expect(prices["part:cpu-1"]).toMatchObject({
      status: "available",
      priceWon: 104000,
      source: "danawa",
      dataQuality: "live",
      dataFreshness: "aging",
      updatedAt: "2026-09-28T22:15:00.000Z",
      priceCheckedAt: "2026-09-28T23:30:00.000Z"
    });
  });

  it("aborts in-flight item reads and stops before starting another batch", async () => {
    const controller = new AbortController();
    const batchEntries = Array.from({ length: 7 }, (_, index) => ({ ...entries[0], itemId: "cpu-" + index }));
    const readCatalogItem = vi.fn((_entry: CatalogWatchEntry, signal: AbortSignal) => new Promise<Part>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));

    const pending = readPriceWatchCatalogPrices(batchEntries, readCatalogItem, controller.signal);
    expect(readCatalogItem).toHaveBeenCalledTimes(6);
    controller.abort();

    await expect(pending).resolves.toEqual({});
    expect(readCatalogItem).toHaveBeenCalledTimes(6);
    expect(readCatalogItem.mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
  });
});
