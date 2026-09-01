import { describe, expect, it } from "vitest";
import type { AccessoryItem, BuildSelection } from "../shared/types";
import { summarizeSavedBuild } from "./build-summary";
import { seedCatalog } from "./seed-catalog";

const build = (): BuildSelection => ({
  cpu: { partId: "cpu-7800x3d", quantity: 1 },
  cooler: { partId: "cooler-tower-am5-1700", quantity: 1 },
  motherboard: { partId: "mb-b650-4x3", quantity: 1 },
  memory: [{ partId: "memory-ddr5-16-5600", quantity: 2 }],
  gpu: { partId: "gpu-rtx-4060", quantity: 1 },
  ssd: [{ partId: "ssd-nvme-1tb", quantity: 1 }],
  hdd: [{ partId: "hdd-seagate-4tb", quantity: 1 }],
  case: { partId: "case-full-airflow", quantity: 1 },
  psu: { partId: "psu-1000w", quantity: 1 },
  accessories: [{ accessoryId: "fan", quantity: 2 }],
  useIntegratedGraphics: false
});

function accessory(overrides: Partial<AccessoryItem> = {}): AccessoryItem {
  return {
    id: "fan",
    category: "cooling_fan",
    name: "120mm 쿨링팬",
    source: "manual",
    listingType: "accessory",
    priceWon: 12500,
    specs: {},
    dataQuality: "manual",
    missingFields: [],
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides
  };
}

describe("saved build summary", () => {
  it("includes core and peripheral totals with quantities", () => {
    const summary = summarizeSavedBuild(build(), seedCatalog, [accessory()]);

    expect(summary.coreTotalPriceWon).toBeGreaterThan(0);
    expect(summary.accessoryTotalPriceWon).toBe(25000);
    expect(summary.totalPriceWon).toBe(summary.coreTotalPriceWon + 25000);
    expect(summary.accessoryCount).toBe(1);
    expect(summary.accessoryQuantity).toBe(2);
    expect(summary.priceComplete).toBe(true);
  });

  it("keeps the saved total provisional when a peripheral price is unknown", () => {
    const summary = summarizeSavedBuild(build(), seedCatalog, [accessory({ priceWon: undefined })]);

    expect(summary.accessoryTotalPriceWon).toBe(0);
    expect(summary.priceComplete).toBe(false);
  });
});
