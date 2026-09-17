import { describe, expect, it } from "vitest";
import { addSavedGeneratorPreset, generatorPresetConfigFromUnknown, mergeSavedGeneratorPresets, removeSavedGeneratorPreset, savedGeneratorPresetsFromJson, savedGeneratorPresetsToJson } from "./generator-preset";
import type { SavedGeneratorPreset } from "./generator-preset";

const config = {
  profile: "gaming" as const,
  priority: "performance" as const,
  gamingResolution: "1440p" as const,
  gamingRefreshRate: 144 as const,
  memoryCapacityGb: 32 as const,
  budgetWon: 2_000_000,
  includeGpu: true,
  storageCapacityGb: 1000 as const,
  hddCount: 0 as const,
  hddCapacityGb: 4000 as const,
  listingPolicy: "retail_only" as const
};

function preset(id: string, name = "QHD 작업용") : SavedGeneratorPreset {
  return { ...config, id, name, createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" };
}

describe("generator preset storage", () => {
  it("round-trips versioned saved conditions", () => {
    const saved = savedGeneratorPresetsFromJson(savedGeneratorPresetsToJson([preset("p1")]));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(preset("p1"));
  });

  it("drops malformed entries and duplicate ids", () => {
    const raw = JSON.stringify({ schemaVersion: 1, items: [preset("p1"), preset("p1", "중복"), { ...preset("p2"), budgetWon: -1 }, { ...preset("p3"), updatedAt: "not-a-date" }] });
    expect(savedGeneratorPresetsFromJson(raw)).toEqual([preset("p1")]);
    expect(generatorPresetConfigFromUnknown({ ...config, hddCount: 3 })).toBeNull();
    expect(generatorPresetConfigFromUnknown({ ...config, priority: "reliability" })).toMatchObject({ priority: "reliability" });
  });

  it("preserves gaming advisory conditions while keeping older presets valid", () => {
    const gaming = generatorPresetConfigFromUnknown({ ...config, gamingGameIds: ["cyberpunk", "pubg"], gamingGraphicsPreset: "high", gamingRayTracing: true, gamingUpscaling: "native" });
    expect(gaming).toMatchObject({ gamingGameIds: ["cyberpunk", "pubg"], gamingGraphicsPreset: "high", gamingRayTracing: true, gamingUpscaling: "native" });
    expect(generatorPresetConfigFromUnknown({ ...config, gamingGameIds: Array(6).fill("pubg") })).toBeNull();
    expect(generatorPresetConfigFromUnknown(config)).not.toBeNull();
  });

  it("preserves a direct performance tier in saved generator presets", () => {
    expect(generatorPresetConfigFromUnknown({ ...config, profile: "general", performanceTier: "top" })).toMatchObject({ profile: "general", performanceTier: "top" });
    expect(generatorPresetConfigFromUnknown({ ...config, profile: "general", performanceTier: "ultra" })).toBeNull();
  });

  it("keeps the most recent ten presets and supports removal", () => {
    const items = Array.from({ length: 10 }, (_, index) => preset(`p${index}`));
    const added = addSavedGeneratorPreset(items, preset("new", "새 조건"));
    expect(added).toHaveLength(10);
    expect(added[0]?.id).toBe("new");
    expect(removeSavedGeneratorPreset(added, "new")).toHaveLength(9);
  });

  it("merges imported presets without reversing order or exceeding the limit", () => {
    const current = [preset("current")];
    const imported = [preset("import-a", "가져온 A"), preset("import-b", "가져온 B")];
    const merged = mergeSavedGeneratorPresets(current, imported);
    expect(merged.map((item) => item.id)).toEqual(["import-a", "import-b", "current"]);
  });

  it("rejects an oversized raw preset array before normalizing every entry", () => {
    const oversized = Array.from({ length: 11 }, (_, index) => preset(`p${index}`));
    expect(savedGeneratorPresetsFromJson(JSON.stringify(oversized))).toEqual([]);
  });
});
