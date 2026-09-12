import { describe, expect, it } from "vitest";
import type { BuildSelection, RecommendationPreferences } from "./types";
import type { BuildInputSnapshot } from "./build-history";
import { appendBuildHistoryEntry, buildInputChangeLabel, changedBuildCategories } from "./build-history";

const build: BuildSelection = {
  cpu: { partId: "cpu-1", quantity: 1 },
  motherboard: { partId: "motherboard-1", quantity: 1 },
  memory: [{ partId: "memory-1", quantity: 2 }],
  gpu: { partId: "gpu-1", quantity: 1 },
  ssd: [],
  hdd: [],
  accessories: [],
  useIntegratedGraphics: false
};

const preferences: RecommendationPreferences = { profile: "general", priority: "balanced", listingPolicy: "retail_only" };

function snapshot(nextBuild = build, nextPreferences = preferences): BuildInputSnapshot {
  return { build: nextBuild, recommendationPreferences: nextPreferences };
}

describe("build history labels", () => {
  it("finds changed hardware categories including quantity changes", () => {
    const after = { ...build, memory: [{ partId: "memory-1", quantity: 4 }], gpu: { partId: "gpu-2", quantity: 1 } };

    expect(changedBuildCategories(build, after)).toEqual(["memory", "gpu"]);
  });

  it("includes changed recommendation settings in the human-readable label", () => {
    const afterPreferences = { ...preferences, profile: "gaming" as const, budgetWon: 1_500_000 };

    expect(buildInputChangeLabel(snapshot(), snapshot(build, afterPreferences))).toBe("사용 목적 · 목표 예산 변경");
    const gamingBefore = { ...preferences, profile: "gaming" as const, gamingRefreshRate: 60 as const };
    const gamingAfter = { ...gamingBefore, gamingRefreshRate: 240 as const };
    expect(buildInputChangeLabel(snapshot(build, gamingBefore), snapshot(build, gamingAfter))).toBe("게임 주사율 변경");
  });

  it("falls back to a generic label when the snapshots are equal", () => {
    expect(buildInputChangeLabel(snapshot(), snapshot())).toBe("구성 변경");
  });

  it("coalesces rapid edits while preserving the snapshot before the edit burst", () => {
    const firstAfter = { ...build, memory: [{ partId: "memory-1", quantity: 3 }] };
    const secondAfter = { ...build, memory: [{ partId: "memory-1", quantity: 4 }], gpu: { partId: "gpu-2", quantity: 1 } };
    const first: Parameters<typeof appendBuildHistoryEntry>[1] = { id: "first", label: "RAM 변경", snapshot: snapshot(), changedAt: "2026-09-02T00:00:00.000Z" };
    const second: Parameters<typeof appendBuildHistoryEntry>[1] = { id: "second", label: "GPU 변경", snapshot: snapshot(firstAfter), changedAt: "2026-09-02T00:00:00.500Z" };
    const coalesced = appendBuildHistoryEntry([first], second, snapshot(secondAfter));

    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]).toMatchObject({ id: "first", snapshot: snapshot(), label: "RAM · 그래픽카드 변경", changedAt: second.changedAt });
  });

  it("starts a new history entry after the coalescing window", () => {
    const first: Parameters<typeof appendBuildHistoryEntry>[1] = { id: "first", label: "RAM 변경", snapshot: snapshot(), changedAt: "2026-09-02T00:00:00.000Z" };
    const second: Parameters<typeof appendBuildHistoryEntry>[1] = { id: "second", label: "GPU 변경", snapshot: snapshot(), changedAt: "2026-09-02T00:00:00.801Z" };

    expect(appendBuildHistoryEntry([first], second, snapshot(build, { ...preferences, profile: "gaming" }))).toHaveLength(2);
  });
});
