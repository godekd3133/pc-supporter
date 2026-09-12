import { describe, expect, it } from "vitest";
import type { AccessoryItem, BuildSelection, Part } from "./types";
import { buildPriceSnapshotFor } from "./build-price-summary";

function part(id: string, category: Part["category"], priceWon?: number): Part {
  return {
    id,
    category,
    name: id,
    source: "manual",
    specs: {},
    dataQuality: "manual",
    missingFields: [],
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...(priceWon === undefined ? {} : { priceWon })
  };
}

function accessory(id: string, priceWon?: number): AccessoryItem {
  return {
    id,
    category: "gpu_support",
    name: id,
    source: "manual",
    listingType: "accessory",
    specs: {},
    dataQuality: "manual",
    missingFields: [],
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...(priceWon === undefined ? {} : { priceWon })
  };
}

const build: BuildSelection = {
  cpu: { partId: "cpu-known", quantity: 1 },
  memory: [{ partId: "memory-unknown", quantity: 2 }],
  accessories: [{ accessoryId: "support-known", quantity: 2 }],
  ssd: [],
  hdd: [],
  useIntegratedGraphics: true
};

describe("build price summary", () => {
  it("keeps known subtotals while refusing to confirm an incomplete total", () => {
    const snapshot = buildPriceSnapshotFor(
      build,
      new Map([
        ["cpu-known", part("cpu-known", "cpu", 300_000)],
        ["memory-unknown", part("memory-unknown", "memory")]
      ]),
      new Map([["support-known", accessory("support-known", 15_000)]])
    );

    expect(snapshot).toMatchObject({
      coreTotalPriceWon: 300_000,
      accessoryTotalPriceWon: 30_000,
      totalPriceWon: 330_000,
      corePriceComplete: false,
      accessoryPriceComplete: true,
      priceComplete: false,
      unknownPriceCount: 1
    });
  });

  it("treats an empty selection as a complete zero snapshot without unknown prices", () => {
    const snapshot = buildPriceSnapshotFor({ memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true }, new Map(), new Map());

    expect(snapshot).toEqual({
      coreTotalPriceWon: 0,
      accessoryTotalPriceWon: 0,
      totalPriceWon: 0,
      corePriceComplete: true,
      accessoryPriceComplete: true,
      priceComplete: true,
      unknownPriceCount: 0
    });
  });

  it("keeps a numeric project reference price separate from a confirmed price", () => {
    const referencePart = { ...part("cpu-reference", "cpu", 300_000), source: "seed" as const, dataQuality: "seed" as const };
    const snapshot = buildPriceSnapshotFor({ cpu: { partId: referencePart.id, quantity: 1 }, memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true }, new Map([[referencePart.id, referencePart]]), new Map());
    expect(snapshot).toMatchObject({ priceComplete: true, totalPriceWon: 300_000, priceEvidenceReviewCount: 1 });
  });
});
