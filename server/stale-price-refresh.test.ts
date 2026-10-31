import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessoryItem, Part } from "../shared/types";

const mocks = vi.hoisted(() => ({
  catalog: [] as Part[],
  accessories: [] as AccessoryItem[],
  refreshPart: vi.fn(),
  refreshAccessory: vi.fn(),
  upsertCatalog: vi.fn(),
  upsertAccessories: vi.fn(),
  appendChange: vi.fn(),
  lease: vi.fn()
}));

vi.mock("./catalog", () => ({
  loadCatalog: async () => mocks.catalog,
  findPart: (list: Part[], id: string) => list.find((part) => part.id === id),
  upsertCatalog: mocks.upsertCatalog
}));
vi.mock("./accessories", () => ({
  loadAccessories: async () => mocks.accessories,
  findAccessory: (list: AccessoryItem[], id: string) => list.find((item) => item.id === id),
  upsertAccessories: mocks.upsertAccessories
}));
vi.mock("./part-refresh", () => ({
  refreshDanawaPart: mocks.refreshPart,
  refreshDanawaAccessory: mocks.refreshAccessory,
  partRefreshBlockReason: () => undefined,
  accessoryRefreshBlockReason: () => undefined,
  partRefreshResponse: () => ({ changedFields: ["priceWon"], refreshedAt: "2026-10-02T00:00:00.000Z" }),
  accessoryRefreshResponse: () => ({ changedFields: ["priceWon"], refreshedAt: "2026-10-02T00:00:00.000Z" })
}));
vi.mock("./catalog-ingestion-coordinator", () => ({
  withCatalogIngestionLease: (fn: () => Promise<unknown>) => mocks.lease(fn)
}));
vi.mock("./catalog-change-log", () => ({
  appendCatalogChangeRecord: mocks.appendChange,
  catalogChangeRecord: () => ({ id: "change-record" })
}));

import { noteStaleServedPrices, resetStalePriceRefreshState, stalePriceRefreshQueueSize, stalePriceRefreshStatus, whenStalePriceRefreshIdle } from "./stale-price-refresh";

const staleCheckedAt = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
const freshCheckedAt = new Date().toISOString();

const part = (overrides: Partial<Part>): Part => ({
  id: `p-${Math.random().toString(36).slice(2, 8)}`,
  category: "memory",
  name: "테스트 부품",
  source: "danawa",
  sourceProductCode: "pcode-1",
  danawaUrl: "https://prod.danawa.com/info/?pcode=1",
  priceWon: 100000,
  specs: {},
  dataQuality: "live",
  missingFields: [],
  updatedAt: staleCheckedAt,
  ...overrides
});

const accessory = (overrides: Partial<AccessoryItem>): AccessoryItem => ({
  id: `a-${Math.random().toString(36).slice(2, 8)}`,
  category: "cooling_fan",
  name: "테스트 팬",
  source: "danawa",
  sourceProductCode: "acode-1",
  danawaUrl: "https://prod.danawa.com/info/?pcode=a1",
  listingType: "accessory",
  priceWon: 10000,
  specs: {},
  dataQuality: "live",
  missingFields: [],
  updatedAt: staleCheckedAt,
  ...overrides
});

describe("stale served price refresh", () => {
  beforeEach(() => {
    mocks.catalog = [];
    mocks.accessories = [];
    mocks.refreshPart.mockReset();
    mocks.refreshAccessory.mockReset();
    mocks.upsertCatalog.mockReset().mockImplementation(async (items: Part[]) => items);
    mocks.upsertAccessories.mockReset().mockImplementation(async (items: AccessoryItem[]) => items);
    mocks.appendChange.mockReset().mockResolvedValue(undefined);
    mocks.lease.mockReset().mockImplementation(async (fn: () => Promise<unknown>) => fn());
    resetStalePriceRefreshState();
  });

  it("refreshes only danawa items whose price check is older than the TTL", async () => {
    const stalePart = part({ id: "stale-part", priceCheckedAt: staleCheckedAt });
    const freshPart = part({ id: "fresh-part", priceCheckedAt: freshCheckedAt });
    const seedPart = part({ id: "seed-part", source: "seed", dataQuality: "seed", priceCheckedAt: staleCheckedAt });
    const noCode = part({ id: "no-code", priceCheckedAt: staleCheckedAt, sourceProductCode: undefined, danawaUrl: undefined });
    mocks.catalog = [stalePart, freshPart, seedPart, noCode];
    mocks.refreshPart.mockImplementation(async (before: Part) => ({ ...before, priceWon: 120000, priceCheckedAt: freshCheckedAt }));

    noteStaleServedPrices([stalePart, freshPart, seedPart, noCode]);
    await whenStalePriceRefreshIdle();

    expect(mocks.refreshPart).toHaveBeenCalledTimes(1);
    expect(mocks.refreshPart.mock.calls[0][0].id).toBe("stale-part");
    expect(mocks.upsertCatalog).toHaveBeenCalled();
    expect(mocks.appendChange).toHaveBeenCalled();
  });

  it("refreshes stale accessories through the accessory path", async () => {
    const staleAcc = accessory({ id: "stale-acc", priceCheckedAt: staleCheckedAt });
    mocks.accessories = [staleAcc];
    mocks.refreshAccessory.mockImplementation(async (before: AccessoryItem) => ({ ...before, priceWon: 12000, priceCheckedAt: freshCheckedAt }));

    noteStaleServedPrices([staleAcc]);
    await whenStalePriceRefreshIdle();

    expect(mocks.refreshAccessory).toHaveBeenCalledTimes(1);
    expect(mocks.upsertAccessories).toHaveBeenCalled();
  });

  it("skips refresh when the item became fresh between enqueue and drain", async () => {
    const stalePart = part({ id: "now-fresh", priceCheckedAt: staleCheckedAt });
    // 드레인 시점에 이미 최신 — 재확인 없이 끝낸다.
    mocks.catalog = [{ ...stalePart, priceCheckedAt: freshCheckedAt }];

    noteStaleServedPrices([stalePart]);
    await whenStalePriceRefreshIdle();

    expect(mocks.refreshPart).not.toHaveBeenCalled();
  });

  it("dedupes repeat views of the same item into a single refresh", async () => {
    const stalePart = part({ id: "dup", priceCheckedAt: staleCheckedAt });
    mocks.catalog = [stalePart];
    mocks.refreshPart.mockImplementation(async (before: Part) => ({ ...before, priceCheckedAt: freshCheckedAt }));

    noteStaleServedPrices([stalePart]);
    noteStaleServedPrices([stalePart]);
    await whenStalePriceRefreshIdle();

    expect(mocks.refreshPart).toHaveBeenCalledTimes(1);
    expect(stalePriceRefreshQueueSize()).toBe(0);
  });

  it("does not immediately retry a recently confirmed no-offer price", async () => {
    const unavailable = part({ priceCheckedAt: staleCheckedAt, priceUnavailableAt: freshCheckedAt, priceWon: undefined });
    noteStaleServedPrices([unavailable]);
    await whenStalePriceRefreshIdle();
    expect(mocks.refreshPart).not.toHaveBeenCalled();
  });

  it("retains busy work and retries it on a subsequent view after the cooldown", async () => {
    const stale = part({ id: "busy-part", priceCheckedAt: staleCheckedAt });
    mocks.catalog = [stale];
    mocks.lease.mockRejectedValueOnce(Object.assign(new Error("busy"), { name: "CatalogIngestionBusyError" }));
    const initialNow = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(initialNow);
    try {
      noteStaleServedPrices([stale]);
      await whenStalePriceRefreshIdle();
      expect(stalePriceRefreshStatus()).toMatchObject({ pending: 1, deferred: 1, failed: 0 });
      expect(mocks.refreshPart).not.toHaveBeenCalled();
      now.mockReturnValue(initialNow + 60_001);
      mocks.refreshPart.mockResolvedValue({ ...stale, priceCheckedAt: new Date(initialNow + 60_001).toISOString() });
      noteStaleServedPrices([stale]);
      await whenStalePriceRefreshIdle();
      expect(mocks.refreshPart).toHaveBeenCalledTimes(1);
      expect(stalePriceRefreshStatus()).toMatchObject({ pending: 0, succeeded: 1, deferred: 1 });
    } finally { now.mockRestore(); }
  });

  it("does not use a recent specs update as evidence of a fresh price", async () => {
    const stale = part({ id: "recent-specs", updatedAt: freshCheckedAt, priceCheckedAt: undefined });
    mocks.catalog = [stale];
    mocks.refreshPart.mockResolvedValue({ ...stale, priceCheckedAt: freshCheckedAt });
    noteStaleServedPrices([stale]);
    await whenStalePriceRefreshIdle();
    expect(mocks.refreshPart).toHaveBeenCalledTimes(1);
    expect(stalePriceRefreshStatus()).toMatchObject({ pending: 0, succeeded: 1 });
  });

  it("records a failed observation while leaving the stale price timestamp unchanged", async () => {
    const stale = part({ id: "failed-part", priceCheckedAt: staleCheckedAt });
    mocks.catalog = [stale];
    mocks.refreshPart.mockRejectedValue(new Error("network failed"));
    noteStaleServedPrices([stale]);
    await whenStalePriceRefreshIdle();
    expect(stalePriceRefreshStatus()).toMatchObject({ pending: 1, failed: 1, lastFailure: { itemId: stale.id, message: "network failed" } });
    expect(mocks.upsertCatalog).not.toHaveBeenCalled();
    expect(stale.priceCheckedAt).toBe(staleCheckedAt);
  });
});
