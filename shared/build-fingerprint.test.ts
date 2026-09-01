import { describe, expect, it } from "vitest";
import type { BuildSelection, RecommendationPreferences } from "./types";
import { buildCompatibilityInputFingerprint } from "./build-fingerprint";

const build: BuildSelection = {
  cpu: { partId: "cpu-1", quantity: 1 },
  motherboard: { partId: "motherboard-1", quantity: 1 },
  memory: [{ partId: "memory-1", quantity: 2 }],
  gpu: { partId: "gpu-1", quantity: 1 },
  ssd: [{ partId: "ssd-1", quantity: 1 }],
  hdd: [],
  accessories: [{ accessoryId: "accessory-1", quantity: 1 }],
  useIntegratedGraphics: false,
  m2SlotSelection: { M2_2: "ssd-1", M2_1: "ssd-1" }
};

const preferences: RecommendationPreferences = {
  profile: "gaming",
  priority: "balanced",
  listingPolicy: "retail_only",
  gamingResolution: "1440p",
  budgetWon: 1_500_000
};

describe("buildCompatibilityInputFingerprint", () => {
  it("is stable when semantically identical slot maps use a different insertion order", () => {
    const reordered = { ...build, m2SlotSelection: { M2_1: "ssd-1", M2_2: "ssd-1" } };

    expect(buildCompatibilityInputFingerprint(build, preferences)).toBe(
      buildCompatibilityInputFingerprint(reordered, preferences)
    );
  });

  it("changes when a hardware input or quantity changes", () => {
    const changedQuantity = { ...build, memory: [{ partId: "memory-1", quantity: 4 }] };
    const changedPart = { ...build, gpu: { partId: "gpu-2", quantity: 1 } };
    const changedAccessoryTarget = { ...build, accessories: [{ accessoryId: "accessory-1", quantity: 1, targetPartId: "ssd-2" }] };
    const changedAccessoryHubTarget = { ...build, accessories: [{ accessoryId: "accessory-1", quantity: 1, targetAccessoryId: "hub-2" }] };
    const changedRgbController = { ...build, rgbControllerAccessoryId: "hub-2" };

    expect(buildCompatibilityInputFingerprint(build, preferences)).not.toBe(
      buildCompatibilityInputFingerprint(changedQuantity, preferences)
    );
    expect(buildCompatibilityInputFingerprint(build, preferences)).not.toBe(
      buildCompatibilityInputFingerprint(changedPart, preferences)
    );
    expect(buildCompatibilityInputFingerprint(build, preferences)).not.toBe(
      buildCompatibilityInputFingerprint(changedAccessoryTarget, preferences)
    );
    expect(buildCompatibilityInputFingerprint(build, preferences)).not.toBe(
      buildCompatibilityInputFingerprint(changedAccessoryHubTarget, preferences)
    );
    expect(buildCompatibilityInputFingerprint(build, preferences)).not.toBe(
      buildCompatibilityInputFingerprint(changedRgbController, preferences)
    );
  });

  it("changes when recommendation preferences change", () => {
    const changedPreferences = { ...preferences, priority: "performance" as const };
    const changedRefreshRate = { ...preferences, gamingRefreshRate: 240 as const };

    expect(buildCompatibilityInputFingerprint(build, preferences)).not.toBe(
      buildCompatibilityInputFingerprint(build, changedPreferences)
    );
    expect(buildCompatibilityInputFingerprint(build, preferences)).not.toBe(
      buildCompatibilityInputFingerprint(build, changedRefreshRate)
    );
  });
});
