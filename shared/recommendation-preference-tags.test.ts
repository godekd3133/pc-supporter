import { describe, expect, it } from "vitest";
import { engineConditionTagsFor, savedBuildPreferenceTagsFor } from "./recommendation-preference-tags";
import type { RecommendationPreferences } from "./types";

function preferencesWith(patch: Partial<RecommendationPreferences>): RecommendationPreferences {
  return { profile: "general", priority: "balanced", ...patch };
}

describe("engineConditionTagsFor", () => {
  it("lists gaming resolution, refresh, preset, upscaling, ray tracing and game count", () => {
    expect(engineConditionTagsFor(preferencesWith({
      profile: "gaming",
      gamingResolution: "4k",
      gamingRefreshRate: 144,
      gamingGraphicsPreset: "high",
      gamingUpscaling: "quality",
      gamingRayTracing: true,
      gamingGameIds: ["cyberpunk", "pubg"]
    }))).toEqual(["4K", "144Hz", "높음", "DLSS·품질 참고", "레이 트레이싱", "게임 2개"]);
  });

  it("lists the performance tier for general profiles and skips unset fields", () => {
    expect(engineConditionTagsFor(preferencesWith({ performanceTier: "top" }))).toEqual(["최상급 성능"]);
    expect(engineConditionTagsFor(preferencesWith({ profile: "gaming" }))).toEqual([]);
    expect(engineConditionTagsFor(preferencesWith({ profile: "office" }))).toEqual([]);
  });
});

describe("savedBuildPreferenceTagsFor", () => {
  it("starts with priority and budget before the condition tags", () => {
    expect(savedBuildPreferenceTagsFor(preferencesWith({
      priority: "performance",
      budgetWon: 2_000_000,
      profile: "gaming",
      gamingResolution: "1440p",
      gamingRefreshRate: 60
    }))).toEqual(["성능 우선", "예산 2,000,000원", "QHD", "60Hz"]);
  });

  it("omits the budget tag when unset and always carries the priority", () => {
    expect(savedBuildPreferenceTagsFor(preferencesWith({ priority: "budget" }))).toEqual(["가성비 우선"]);
    expect(savedBuildPreferenceTagsFor(preferencesWith({ budgetWon: 0 }))).toEqual(["균형형"]);
  });
});
