import { describe, expect, it } from "vitest";
import type { AccessoryItem, AccessorySelection, BuildSelection } from "../shared/types";
import { summarizeAccessorySelections, validateAccessorySelectionIds, validateAccessoryTargetAccessoryIds, validateRgbControllerAccessoryId } from "./accessory-cart";

function item(overrides: Partial<AccessoryItem>): AccessoryItem {
  return {
    id: "accessory-1",
    category: "m2_heatsink",
    name: "M.2 방열판",
    source: "danawa",
    listingType: "accessory",
    priceWon: 10000,
    specs: {},
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides
  };
}

describe("accessory cart", () => {
  it("summarizes quantities and keeps price completeness explicit", () => {
    const selections: AccessorySelection[] = [
      { accessoryId: "fan", quantity: 2 },
      { accessoryId: "heatsink", quantity: 1 }
    ];
    const accessories = [
      item({ id: "fan", category: "cooling_fan", name: "쿨링팬", priceWon: 8000 }),
      item({ id: "heatsink", priceWon: 12000 })
    ];

    const summary = summarizeAccessorySelections(selections, accessories);

    expect(summary.totalPriceWon).toBe(28000);
    expect(summary.itemCount).toBe(3);
    expect(summary.priceComplete).toBe(true);
    expect(summary.invalidSelections).toHaveLength(0);
  });

  it("does not claim a complete price for an unknown accessory selection", () => {
    const selections: AccessorySelection[] = [{ accessoryId: "missing", quantity: 1 }];

    expect(validateAccessorySelectionIds(selections, [])).toEqual(selections);
    expect(summarizeAccessorySelections(selections, []).priceComplete).toBe(false);
  });

  it("accepts only a selected fan hub as a cooling fan connection target", () => {
    const build: Pick<BuildSelection, "accessories"> = {
      accessories: [
        { accessoryId: "fan", quantity: 1, targetAccessoryId: "hub" },
        { accessoryId: "hub", quantity: 1 },
        { accessoryId: "heatsink", quantity: 1 }
      ]
    };
    const accessories = [
      item({ id: "fan", category: "cooling_fan", name: "쿨링팬" }),
      item({ id: "hub", category: "fan_hub", name: "팬 허브" }),
      item({ id: "heatsink", category: "m2_heatsink", name: "방열판" })
    ];

    expect(validateAccessoryTargetAccessoryIds(build, accessories)).toEqual([]);
    expect(validateAccessoryTargetAccessoryIds({ accessories: [{ accessoryId: "fan", quantity: 1, targetAccessoryId: "heatsink" }] }, accessories)).toEqual(["heatsink"]);
    expect(validateAccessoryTargetAccessoryIds({ accessories: [{ accessoryId: "fan", quantity: 1, targetAccessoryId: "missing-hub" }] }, accessories)).toEqual(["missing-hub"]);
    expect(validateRgbControllerAccessoryId({ rgbControllerAccessoryId: "hub", accessories: [{ accessoryId: "hub", quantity: 1 }] }, accessories)).toEqual([]);
    expect(validateRgbControllerAccessoryId({ rgbControllerAccessoryId: "missing-hub", accessories: [{ accessoryId: "hub", quantity: 1 }] }, accessories)).toEqual(["missing-hub"]);
  });
});
