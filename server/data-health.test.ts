import { describe, expect, it } from "vitest";
import type { AccessoryItem, BuildSelection, Part } from "../shared/types";
import { classifyDataFreshness, summarizeBuildDataHealth } from "./data-health";

const NOW = "2026-08-27T00:00:00.000Z";

function build(overrides: Partial<BuildSelection> = {}): BuildSelection {
  return {
    memory: [],
    ssd: [],
    hdd: [],
    accessories: [],
    useIntegratedGraphics: true,
    ...overrides
  };
}

function part(overrides: Partial<Part> = {}): Part {
  return {
    id: "cpu-1",
    category: "cpu",
    name: "테스트 CPU",
    source: "manual",
    priceWon: 100000,
    specs: {},
    dataQuality: "manual",
    missingFields: [],
    updatedAt: NOW,
    ...overrides
  };
}

function accessory(overrides: Partial<AccessoryItem> = {}): AccessoryItem {
  return {
    id: "fan-1",
    category: "cooling_fan",
    name: "테스트 팬",
    source: "manual",
    listingType: "accessory",
    priceWon: 10000,
    specs: {},
    dataQuality: "manual",
    missingFields: [],
    updatedAt: NOW,
    ...overrides
  };
}

describe("build data health", () => {
  it("classifies fresh, aging, stale, and unknown timestamps deterministically", () => {
    expect(classifyDataFreshness("2026-08-26T00:00:00.000Z", NOW)).toBe("fresh");
    expect(classifyDataFreshness("2026-08-17T00:00:00.000Z", NOW)).toBe("aging");
    expect(classifyDataFreshness("2026-07-01T00:00:00.000Z", NOW)).toBe("stale");
    expect(classifyDataFreshness(undefined, NOW)).toBe("unknown");
  });

  it("summarizes selected core and peripheral items with quantity and price state", () => {
    const result = summarizeBuildDataHealth(
      build({
        cpu: { partId: "cpu-1", quantity: 1 },
        memory: [{ partId: "memory-1", quantity: 2 }],
        accessories: [{ accessoryId: "fan-1", quantity: 3 }]
      }),
      [part(), part({ id: "memory-1", category: "memory", name: "테스트 RAM", updatedAt: "2026-08-17T00:00:00.000Z" })],
      [accessory()],
      NOW
    );

    expect(result.selectedCount).toBe(3);
    expect(result.selectedQuantity).toBe(6);
    expect(result.freshCount).toBe(2);
    expect(result.agingCount).toBe(1);
    expect(result.incompleteCount).toBe(0);
    expect(result.unpricedCount).toBe(0);
    expect(result.overall).toBe("mixed");
    expect(result.items.find((item) => item.id === "fan-1")?.category).toBe("cooling_fan");
  });

  it("flags stale, incomplete, and unpriced selections for refresh", () => {
    const result = summarizeBuildDataHealth(
      build({ cpu: { partId: "old-cpu", quantity: 1 }, accessories: [{ accessoryId: "unknown-fan", quantity: 1 }] }),
      [part({ id: "old-cpu", updatedAt: "2026-07-01T00:00:00.000Z", dataQuality: "incomplete", priceWon: undefined, missingFields: ["socket"] })],
      [accessory({ id: "unknown-fan", updatedAt: "not-a-date", priceWon: undefined, dataQuality: "incomplete", missingFields: ["size"] })],
      NOW
    );

    expect(result.staleCount).toBe(1);
    expect(result.unknownFreshnessCount).toBe(1);
    expect(result.incompleteCount).toBe(2);
    expect(result.unpricedCount).toBe(2);
    expect(result.overall).toBe("needs_refresh");
  });
});
