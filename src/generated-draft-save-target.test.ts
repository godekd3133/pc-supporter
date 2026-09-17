import { describe, expect, it } from "vitest";
import { generatedDraftSaveTargetFor } from "./generated-draft-save-target";
import type { BuildGenerationResult } from "../shared/types";

describe("generatedDraftSaveTargetFor", () => {
  it("keeps the complete gaming context when a generated draft becomes a saved build", () => {
    const draft = {
      selection: {},
      profile: "gaming",
      priority: "performance",
      performanceTier: "top",
      gamingResolution: "4k",
      gamingRefreshRate: 240,
      gamingGameIds: ["cyberpunk", "pubg"],
      gamingGraphicsPreset: "high",
      gamingRayTracing: true,
      gamingUpscaling: "quality",
      budgetWon: 2_000_000,
      listingPolicy: "retail_only"
    } as BuildGenerationResult;

    expect(generatedDraftSaveTargetFor(draft).preferences).toMatchObject({
      profile: "gaming",
      priority: "performance",
      performanceTier: "top",
      budgetWon: 2_000_000,
      listingPolicy: "retail_only",
      gamingResolution: "4k",
      gamingRefreshRate: 240,
      gamingGameIds: ["cyberpunk", "pubg"],
      gamingGraphicsPreset: "high",
      gamingRayTracing: true,
      gamingUpscaling: "quality"
    });
  });
});
