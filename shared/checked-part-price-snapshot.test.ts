import { describe, expect, it } from "vitest";
import { buildPriceSnapshotFor } from "./build-price-summary";
import { applyCheckedPartPriceSnapshot, checkedPartPriceSnapshotFor, checkedPartPriceSnapshotFromUnknown, CHECKED_PART_PRICE_SNAPSHOT_MAX_ENTRIES } from "./checked-part-price-snapshot";
import type { BuildSelection, Part } from "./types";

function part(id: string, category: Part["category"], priceWon?: number): Part {
  return {
    id,
    category,
    name: id,
    source: "danawa",
    sourceProductCode: `source-${id}`,
    dataQuality: "live",
    specs: { ...(category === "memory" ? { capacityGb: 8 } : {}) },
    missingFields: [],
    updatedAt: "2026-10-04T00:00:00.000Z",
    priceCheckedAt: "2026-10-04T01:00:00.000Z",
    ...(priceWon === undefined ? {} : { priceWon })
  };
}

const selection: BuildSelection = {
  cpu: { partId: "cpu", quantity: 1 },
  memory: [{ partId: "memory", quantity: 2 }, { partId: "memory", quantity: 1 }],
  ssd: [],
  hdd: [],
  accessories: [{ accessoryId: "accessory", quantity: 1 }],
  useIntegratedGraphics: true
};

describe("checked core-part price snapshot", () => {
  it("rejects malformed and duplicate restored snapshots instead of passing invalid values to consumers", () => {
    const malformed: unknown[] = [
      undefined,
      null,
      {},
      "snapshot",
      [null],
      [[]],
      [{ partId: 123 }],
      [{ partId: " " }],
      [{ partId: "x".repeat(161) }],
      [{ partId: "cpu", priceWon: "200000" }],
      [{ partId: "cpu", priceWon: null }],
      [{ partId: "cpu", priceWon: 0 }],
      [{ partId: "cpu", priceWon: -1 }],
      [{ partId: "cpu", priceWon: Number.NaN }],
      [{ partId: "cpu", priceWon: Number.POSITIVE_INFINITY }],
      [{ partId: "cpu", priceCheckedAt: 123 }],
      [{ partId: "cpu", priceCheckedAt: "not-a-date" }],
      [{ partId: "cpu", priceCheckedAt: "" }],
      [{ partId: "cpu", priceWon: 200_000 }, { partId: "cpu", priceWon: 219_000 }]
    ];

    for (const value of malformed) expect(checkedPartPriceSnapshotFromUnknown(value)).toBeUndefined();
  });

  it("accepts bounded saved prices and unavailable prices while rejecting oversized snapshots", () => {
    const maximumSnapshot = Array.from({ length: CHECKED_PART_PRICE_SNAPSHOT_MAX_ENTRIES }, (_, index) => ({ partId: `part-${index}` }));
    expect(checkedPartPriceSnapshotFromUnknown(maximumSnapshot)).toHaveLength(CHECKED_PART_PRICE_SNAPSHOT_MAX_ENTRIES);
    expect(checkedPartPriceSnapshotFromUnknown([...maximumSnapshot, { partId: "one-too-many" }])).toBeUndefined();
    expect(checkedPartPriceSnapshotFromUnknown([])).toEqual([]);

    const restored = checkedPartPriceSnapshotFromUnknown(JSON.parse(JSON.stringify([
      { partId: "cpu", priceWon: 200_000, priceCheckedAt: "2026-10-04T01:00:00.000Z", source: "untrusted" },
      { partId: "memory" }
    ])));
    expect(restored).toEqual([
      { partId: "cpu", priceWon: 200_000, priceCheckedAt: "2026-10-04T01:00:00.000Z" },
      { partId: "memory", priceWon: undefined, priceCheckedAt: undefined }
    ]);
    expect(applyCheckedPartPriceSnapshot([part("memory", "memory", 50_000)], restored ?? [])[0].priceWon).toBeUndefined();
  });

  it("keeps unit prices unique while the selected quantities determine the total", () => {
    const catalog = [part("cpu", "cpu", 200_000), part("memory", "memory", 40_000)];
    const snapshot = checkedPartPriceSnapshotFor(selection, catalog);
    const applied = applyCheckedPartPriceSnapshot(catalog, snapshot);
    const total = buildPriceSnapshotFor({ ...selection, accessories: [] }, new Map(applied.map((item) => [item.id, item])), new Map());

    expect(snapshot).toEqual([
      { partId: "cpu", priceWon: 200_000, priceCheckedAt: "2026-10-04T01:00:00.000Z" },
      { partId: "memory", priceWon: 40_000, priceCheckedAt: "2026-10-04T01:00:00.000Z" }
    ]);
    expect(total).toMatchObject({ coreTotalPriceWon: 320_000, corePriceComplete: true });
  });

  it("reproduces the checked total after an asynchronous catalog price refresh", () => {
    const checkedCatalog = [part("cpu", "cpu", 200_000), part("memory", "memory", 40_000)];
    const snapshot = checkedPartPriceSnapshotFor(selection, checkedCatalog);
    checkedCatalog[0].priceWon = 219_000;
    checkedCatalog[0].priceCheckedAt = "2026-10-04T02:00:00.000Z";
    const refreshedCatalog = checkedCatalog.map((item) => ({ ...item, priceWon: (item.priceWon ?? 0) + 10_000 }));
    const applied = applyCheckedPartPriceSnapshot(refreshedCatalog, snapshot);
    const checkedTotal = buildPriceSnapshotFor({ ...selection, accessories: [] }, new Map(applied.map((item) => [item.id, item])), new Map());

    expect(checkedTotal.coreTotalPriceWon).toBe(320_000);
    expect(applied[0]).toMatchObject({ priceWon: 200_000, priceCheckedAt: "2026-10-04T01:00:00.000Z" });
    expect(refreshedCatalog[0]).toMatchObject({ priceWon: 229_000, priceCheckedAt: "2026-10-04T02:00:00.000Z" });
    expect(snapshot[0].priceWon).toBe(200_000);
    expect(applied[0]).not.toBe(refreshedCatalog[0]);
    expect(applied[0].specs).toBe(refreshedCatalog[0].specs);
    expect(applied[0]).toMatchObject({ source: "danawa", sourceProductCode: "source-cpu", dataQuality: "live", updatedAt: "2026-10-04T00:00:00.000Z" });
  });

  it("preserves an unavailable checked price even if a newer catalog has a price", () => {
    const snapshot = checkedPartPriceSnapshotFor(selection, [part("cpu", "cpu", 200_000)]);
    const refreshedCatalog = [part("cpu", "cpu", 200_000), part("memory", "memory", 50_000), part("unselected", "gpu", 500_000)];
    const applied = applyCheckedPartPriceSnapshot(refreshedCatalog, snapshot);
    const total = buildPriceSnapshotFor({ ...selection, accessories: [] }, new Map(applied.map((item) => [item.id, item])), new Map());

    expect(snapshot.find((entry) => entry.partId === "memory")).toEqual({ partId: "memory", priceWon: undefined, priceCheckedAt: undefined });
    expect(applied[1].priceWon).toBeUndefined();
    expect(applied[1].priceCheckedAt).toBeUndefined();
    expect(total).toMatchObject({ coreTotalPriceWon: 200_000, corePriceComplete: false, unknownPriceCount: 1 });
    expect(refreshedCatalog[1].priceWon).toBe(50_000);
    expect(applied[2]).toBe(refreshedCatalog[2]);
  });

  it("bounds core rows to the existing build selection limits", () => {
    const list = (category: string) => Array.from({ length: 101 }, (_, index) => ({ partId: `${category}-${index}`, quantity: 1 }));
    const maximumSelection: BuildSelection = {
      cpu: { partId: "cpu", quantity: 1 },
      cooler: { partId: "cooler", quantity: 1 },
      motherboard: { partId: "motherboard", quantity: 1 },
      gpu: { partId: "gpu", quantity: 1 },
      case: { partId: "case", quantity: 1 },
      psu: { partId: "psu", quantity: 1 },
      memory: list("memory"),
      ssd: list("ssd"),
      hdd: list("hdd"),
      useIntegratedGraphics: false
    };
    const snapshot = checkedPartPriceSnapshotFor(maximumSelection, []);

    expect(snapshot).toHaveLength(CHECKED_PART_PRICE_SNAPSHOT_MAX_ENTRIES);
    expect(CHECKED_PART_PRICE_SNAPSHOT_MAX_ENTRIES).toBe(306);
    expect(snapshot.some((entry) => entry.partId.endsWith("-100"))).toBe(false);
  });
});
