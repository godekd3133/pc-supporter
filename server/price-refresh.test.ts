import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccessoryItem, Part } from "../shared/types";

const mocks = vi.hoisted(() => ({
  parts: [] as Part[],
  accessories: [] as AccessoryItem[],
  refreshPart: vi.fn(),
  refreshAccessory: vi.fn(),
  upsertCatalog: vi.fn(),
  upsertAccessories: vi.fn(),
  patchCatalogPrices: vi.fn(),
  patchAccessoryPrices: vi.fn(),
  appendChanges: vi.fn()
}));

vi.mock("./catalog", () => ({ loadCatalog: async () => mocks.parts, upsertCatalog: mocks.upsertCatalog, patchCatalogPrices: mocks.patchCatalogPrices }));
vi.mock("./accessories", () => ({ loadAccessories: async () => mocks.accessories, upsertAccessories: mocks.upsertAccessories, patchAccessoryPrices: mocks.patchAccessoryPrices }));
vi.mock("./part-refresh", () => ({ refreshDanawaPart: mocks.refreshPart, refreshDanawaAccessory: mocks.refreshAccessory }));
vi.mock("./catalog-change-log", () => ({
  appendCatalogChangeRecords: mocks.appendChanges,
  catalogChangeRecord: (kind: string, before: unknown, after: unknown, changedFields: string[]) => ({ kind, before, after, changedFields })
}));

const part = (id: string, overrides: Partial<Part> = {}): Part => ({
  id, category: "cpu", name: `CPU ${id}`, source: "danawa", sourceProductCode: id,
  danawaUrl: `https://prod.danawa.com/info/?pcode=${id}`, priceWon: 100_000,
  specs: { socket: "AM5" }, dataQuality: "live", missingFields: [],
  updatedAt: "2026-01-01T00:00:00.000Z", ...overrides
});

const accessory = (id: string, overrides: Partial<AccessoryItem> = {}): AccessoryItem => ({
  id, category: "cooling_fan", name: `Fan ${id}`, source: "danawa", sourceProductCode: id,
  danawaUrl: `https://prod.danawa.com/info/?pcode=${id}`, listingType: "accessory", priceWon: 10_000,
  specs: {}, dataQuality: "live", missingFields: [], updatedAt: "2026-01-01T00:00:00.000Z", ...overrides
});

describe("price refresh service", () => {
  let directory = "";
  let service: typeof import("./price-refresh");

  beforeEach(async () => {
    vi.resetModules();
    directory = await mkdtemp(join(tmpdir(), "pc-supporter-price-refresh-"));
    process.env.PC_SUPPORTER_DATA_DIR = directory;
    mocks.parts = [];
    mocks.accessories = [];
    mocks.refreshPart.mockReset();
    mocks.refreshAccessory.mockReset();
    mocks.upsertCatalog.mockReset().mockResolvedValue([]);
    mocks.upsertAccessories.mockReset().mockResolvedValue([]);
    mocks.patchCatalogPrices.mockReset().mockImplementation(async (patches: Array<{ id: string; priceWon: number; priceCheckedAt: string }>) => patches.flatMap((patch) => {
      const before = mocks.parts.find((item) => item.id === patch.id);
      return before ? [{ before, after: { ...before, priceWon: patch.priceWon, priceCheckedAt: patch.priceCheckedAt } }] : [];
    }));
    mocks.patchAccessoryPrices.mockReset().mockImplementation(async (patches: Array<{ id: string; priceWon: number; priceCheckedAt: string }>) => patches.flatMap((patch) => {
      const before = mocks.accessories.find((item) => item.id === patch.id);
      return before ? [{ before, after: { ...before, priceWon: patch.priceWon, priceCheckedAt: patch.priceCheckedAt } }] : [];
    }));
    mocks.appendChanges.mockReset().mockResolvedValue([]);
    service = await import("./price-refresh");
  });

  afterEach(async () => {
    delete process.env.PC_SUPPORTER_DATA_DIR;
    await rm(directory, { recursive: true, force: true });
  });

  it("refreshes only Danawa prices, selects oldest first, and leaves specs and updatedAt intact", async () => {
    mocks.parts = [
      part("new", { priceCheckedAt: "2026-09-01T00:00:00.000Z" }),
      part("seed", { source: "seed", sourceProductCode: undefined, danawaUrl: undefined }),
      part("old", { priceCheckedAt: "2026-08-01T00:00:00.000Z" })
    ];
    mocks.accessories = [accessory("fan")];
    mocks.refreshPart.mockImplementation(async (item: Part, options: { onPriceObserved?: (price: number | undefined) => void }) => {
      const price = item.id === "old" ? 120_000 : 110_000;
      options.onPriceObserved?.(price);
      return { ...item, priceWon: price, specs: { socket: "BROKEN" }, updatedAt: "2099-01-01T00:00:00.000Z" };
    });
    mocks.refreshAccessory.mockImplementation(async (item: AccessoryItem, options: { onPriceObserved?: (price: number | undefined) => void }) => {
      options.onPriceObserved?.(12_000);
      return { ...item, priceWon: 12_000 };
    });

    const status = await service.runPriceRefreshJob({ coreLimit: 1, accessoryLimit: 1, delayMs: 0 });

    expect(mocks.refreshPart).toHaveBeenCalledTimes(1);
    expect(mocks.refreshPart).toHaveBeenCalledWith(expect.objectContaining({ id: "old" }), expect.objectContaining({ onPriceObserved: expect.any(Function) }));
    expect(mocks.patchCatalogPrices).toHaveBeenCalledWith([expect.objectContaining({
      id: "old", priceWon: 120_000, danawaUrl: expect.stringContaining("pcode=old"), sourceProductCode: "old", priceCheckedAt: expect.any(String)
    })]);
    expect(mocks.patchAccessoryPrices).toHaveBeenCalledWith([expect.objectContaining({ id: "fan", priceWon: 12_000, priceCheckedAt: expect.any(String) })]);
    expect(status).toMatchObject({ attempted: 2, succeeded: 2, changed: 2, failed: 0, running: false });
    expect(await service.readPriceRefreshStatus()).toMatchObject(status);
  });

  it("keeps old prices after fetch or invalid-price failures and caps each run", async () => {
    mocks.parts = [part("throws"), part("invalid", { priceCheckedAt: "2026-02-01T00:00:00.000Z" }), part("unverified", { priceCheckedAt: "2026-03-01T00:00:00.000Z" })];
    mocks.refreshPart.mockImplementation(async (item: Part, options: { onPriceObserved?: (price: number | undefined) => void }) => {
      if (item.id === "throws") throw new Error("network failed");
      if (item.id === "unverified") {
        options.onPriceObserved?.(undefined);
        return { ...item, priceWon: item.priceWon };
      }
      options.onPriceObserved?.(0);
      return { ...item, priceWon: 0 };
    });

    const status = await service.runPriceRefreshJob({ delayMs: 0 });

    expect(mocks.patchCatalogPrices).not.toHaveBeenCalled();
    expect(status).toMatchObject({ attempted: 3, succeeded: 0, changed: 0, failed: 3 });
    expect(status.failures).toHaveLength(3);
  });

  it("does not persist catalog data in dry-run and rejects an existing lock", async () => {
    mocks.parts = [part("dry")];
    mocks.refreshPart.mockImplementation(async (item: Part, options: { onPriceObserved?: (price: number | undefined) => void }) => {
      options.onPriceObserved?.(120_000);
      return { ...item, priceWon: 120_000 };
    });
    const dry = await service.runPriceRefreshJob({ dryRun: true, delayMs: 0 });
    expect(dry).toMatchObject({ attempted: 1, succeeded: 1, changed: 1 });
    expect(mocks.patchCatalogPrices).not.toHaveBeenCalled();
    const attemptsPath = join(directory, "price-refresh-attempts.json");
    await expect(import("node:fs/promises").then(({ readFile }) => readFile(attemptsPath, "utf8"))).rejects.toThrow();

    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "price-refresh.lock"), "locked");
    await expect(service.runPriceRefreshJob()).rejects.toThrow("이미 실행 중");
  });

  it("recovers an old same-PID lock left by a previous container process", async () => {
    const lockPath = join(directory, "price-refresh.lock");
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: "2020-01-01T00:00:00.000Z", instanceId: "old-container" }));
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleTime, staleTime);

    await expect(service.runPriceRefreshJob({ coreLimit: 0, accessoryLimit: 0 })).resolves.toMatchObject({ running: false, attempted: 0 });
  });

  it("moves repeatedly failing candidates behind unattempted items across job runs", async () => {
    mocks.parts = [part("fails-first", { updatedAt: "2026-01-01T00:00:00.000Z" }), part("unattempted", { updatedAt: "2026-02-01T00:00:00.000Z" })];
    mocks.refreshPart.mockImplementation(async (item: Part, options: { onPriceObserved?: (price: number | undefined) => void }) => {
      if (item.id === "fails-first") throw new Error("source unavailable");
      options.onPriceObserved?.(115_000);
      return { ...item, priceWon: 115_000 };
    });

    await service.runPriceRefreshJob({ coreLimit: 1, accessoryLimit: 0, delayMs: 0 });
    expect(mocks.refreshPart).toHaveBeenLastCalledWith(expect.objectContaining({ id: "fails-first" }), expect.any(Object));
    await service.runPriceRefreshJob({ coreLimit: 1, accessoryLimit: 0, delayMs: 0 });

    expect(mocks.refreshPart).toHaveBeenLastCalledWith(expect.objectContaining({ id: "unattempted" }), expect.any(Object));
  });
});
