import { describe, expect, it } from "vitest";
import type { BuildSelection, RecommendationPreferences } from "./types";
import { buildTransferJsonFor, parseBuildTransfer } from "./build-transfer";

const selection: BuildSelection = {
  cpu: { partId: "cpu-1", quantity: 1 },
  cooler: { partId: "cooler-1", quantity: 1 },
  motherboard: { partId: "board-1", quantity: 1 },
  memory: [{ partId: "memory-1", quantity: 2 }],
  gpu: { partId: "gpu-1", quantity: 1 },
  ssd: [{ partId: "ssd-1", quantity: 2 }],
  hdd: [],
  case: { partId: "case-1", quantity: 1 },
  psu: { partId: "psu-1", quantity: 1 },
  accessories: [{ accessoryId: "fan-1", quantity: 3, targetPartId: "ssd-1", targetAccessoryId: "hub-1" }],
  rgbControllerAccessoryId: "hub-1",
  m2SlotSelection: { M2_1: "ssd-1", M2_2: "ssd-1" },
  useIntegratedGraphics: false
};

const preferences: RecommendationPreferences = { priority: "performance", profile: "gaming", listingPolicy: "include_bulk", budgetWon: 2_000_000, gamingResolution: "4k", gamingRefreshRate: 240 };

describe("build transfer JSON", () => {
  it("round-trips selections, quantities, M.2 placement, and recommendation preferences", () => {
    const parsed = parseBuildTransfer(buildTransferJsonFor(selection, preferences));
    expect(parsed.errors).toEqual([]);
    expect(parsed.envelope).toMatchObject({ selection, recommendationPreferences: preferences });
  });

  it("accepts a raw build selection as a convenient legacy shape", () => {
    const parsed = parseBuildTransfer(JSON.stringify(selection));
    expect(parsed.errors).toEqual([]);
    expect(parsed.envelope?.selection).toEqual(selection);
  });

  it("rejects unsupported versions, malformed quantities, and invalid preferences atomically", () => {
    const parsed = parseBuildTransfer({
      schemaVersion: 99,
      selection: { cpu: { partId: "cpu-1", quantity: 0 }, memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true },
      recommendationPreferences: { profile: "unknown", budgetWon: -1 }
    });
    expect(parsed.envelope).toBeUndefined();
    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("지원하지 않는"),
      expect.stringContaining("quantity는 1부터 99"),
      expect.stringContaining("profile이 올바르지"),
      expect.stringContaining("budgetWon은 1부터")
    ]));
  });

  it("rejects invalid M.2 slot IDs and accessory shapes", () => {
    const parsed = parseBuildTransfer({ selection: { memory: [], ssd: [], hdd: [], accessories: [{ accessoryId: "fan-1", quantity: 0 }], m2SlotSelection: { M2_9: "ssd-1" }, useIntegratedGraphics: true } });
    expect(parsed.envelope).toBeUndefined();
    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("M2_1부터 M2_8"),
      expect.stringContaining("quantity는 1부터 99")
    ]));
  });

  it("rejects an empty accessory target SSD ID", () => {
    const parsed = parseBuildTransfer({ selection: { memory: [], ssd: [], hdd: [], accessories: [{ accessoryId: "fan-1", quantity: 1, targetPartId: "  " }], useIntegratedGraphics: true } });
    expect(parsed.envelope).toBeUndefined();
    expect(parsed.errors).toContain("selection.accessories[0].targetPartId는 비어 있지 않은 SSD ID여야 합니다.");
  });

  it("rejects an empty accessory target fan hub ID", () => {
    const parsed = parseBuildTransfer({ selection: { memory: [], ssd: [], hdd: [], accessories: [{ accessoryId: "fan-1", quantity: 1, targetAccessoryId: "  " }], useIntegratedGraphics: true } });
    expect(parsed.envelope).toBeUndefined();
    expect(parsed.errors).toContain("selection.accessories[0].targetAccessoryId는 비어 있지 않은 팬 허브 ID여야 합니다.");
  });

  it("rejects an empty RGB controller target ID", () => {
    const parsed = parseBuildTransfer({ selection: { memory: [], ssd: [], hdd: [], accessories: [], rgbControllerAccessoryId: "  ", useIntegratedGraphics: true } });
    expect(parsed.envelope).toBeUndefined();
    expect(parsed.errors).toContain("selection.rgbControllerAccessoryId는 비어 있지 않은 팬 허브 ID여야 합니다.");
  });

  it("rejects an unsupported gaming refresh rate", () => {
    const parsed = parseBuildTransfer({ selection: { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true }, recommendationPreferences: { gamingRefreshRate: 360 } });

    expect(parsed.envelope).toBeUndefined();
    expect(parsed.errors).toContain("recommendationPreferences.gamingRefreshRate가 올바르지 않습니다.");
  });
});
