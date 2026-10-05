import { describe, expect, it } from "vitest";
import { buildDraftSyncFor, parseBuildDraftStorage, recommendationPreferencesSyncFor } from "./build-draft";

describe("build draft storage", () => {
  it("parses the raw selection saved by the editor", () => {
    const result = parseBuildDraftStorage(JSON.stringify({ cpu: { partId: "cpu-1", quantity: 1 }, memory: [], ssd: [], hdd: [], useIntegratedGraphics: true }));
    expect(result).toMatchObject({ status: "valid", build: { cpu: { partId: "cpu-1", quantity: 1 }, useIntegratedGraphics: true } });
  });

  it("normalizes a transfer envelope through the same parser", () => {
    const result = parseBuildDraftStorage(JSON.stringify({ schemaVersion: 1, selection: { memory: [], ssd: [], hdd: [], useIntegratedGraphics: false }, recommendationPreferences: { profile: "gaming", priority: "balanced" } }));
    expect(result).toMatchObject({ status: "valid", build: { useIntegratedGraphics: false } });
  });

  it("falls back to an empty safe build for malformed storage", () => {
    expect(parseBuildDraftStorage("not-json")).toMatchObject({ status: "recovered", build: { memory: [], ssd: [], hdd: [], accessories: [], useIntegratedGraphics: true } });
  });

  it("detects a valid draft written by another browser tab without applying it", () => {
    const current = { memory: [], ssd: [], hdd: [], useIntegratedGraphics: true };
    const incoming = { ...current, cpu: { partId: "cpu-2", quantity: 1 } };
    expect(buildDraftSyncFor(current, JSON.stringify(incoming))).toMatchObject({ status: "changed", build: incoming });
    expect(buildDraftSyncFor(incoming, JSON.stringify(incoming))).toEqual({ status: "same" });
  });

  it("ignores malformed cross-tab draft values", () => {
    expect(buildDraftSyncFor({ memory: [], ssd: [], hdd: [], useIntegratedGraphics: true }, "broken")).toMatchObject({ status: "invalid" });
  });

  it("detects recommendation criteria changed in another tab with canonical fields", () => {
    const current = { profile: "general" as const, priority: "balanced" as const, listingPolicy: "retail_only" as const, gamingResolution: "1440p" as const };
    const incoming = { ...current, profile: "gaming" as const, budgetWon: 1_500_000, gamingRefreshRate: 144 as const };
    expect(recommendationPreferencesSyncFor(current, JSON.stringify(incoming))).toMatchObject({ status: "changed", preferences: incoming });
    expect(recommendationPreferencesSyncFor(incoming, JSON.stringify({ gamingRefreshRate: 144, budgetWon: 1_500_000, listingPolicy: "retail_only", priority: "balanced", gamingResolution: "1440p", profile: "gaming" }))).toEqual({ status: "same" });
  });

  it("ignores malformed recommendation criteria from another tab", () => {
    expect(recommendationPreferencesSyncFor({ profile: "general", priority: "balanced", listingPolicy: "retail_only" }, "broken")).toMatchObject({ status: "invalid" });
  });
});


describe("game-target criteria sync", () => {
  it("detects a custom FPS change with the same hardware and retains the whole incoming request", () => {
    const current = { profile: "gaming" as const, priority: "performance" as const, gamingMode: "target_fps" as const, gamingTargetFps: 120, gamingRefreshRate: 144 as const, gamingResolution: "1440p" as const, gpuVendorPreference: "amd" as const, gamingGameIds: ["pubg"], gamingGraphicsPreset: "high" as const, gamingRayTracing: false, gamingUpscaling: "native" as const };
    const incoming = { ...current, gamingTargetFps: 144 };
    expect(recommendationPreferencesSyncFor(current, JSON.stringify(incoming))).toMatchObject({ status: "changed", preferences: incoming });
    expect(recommendationPreferencesSyncFor(incoming, JSON.stringify(incoming))).toEqual({ status: "same" });
  });
});
