import { describe, expect, it } from "vitest";
import {
  advanceOnboarding,
  backOnboarding,
  budgetEstimateFor,
  canAdvance,
  clampBudget,
  gamingTargetShortfall,
  initialOnboardingState,
  ONBOARDING_GAME_CATEGORIES,
  ONBOARDING_GAMES,
  onboardingStateFromJson,
  onboardingStateToJson,
  recommendParamsFor,
  recommendQueryFor,
  requiredWorkBudgetFor,
  requiredGamingBudgetFor,
  requiredSpecBudgetFor,
  stepIndicatorFor,
  targetBudgetRangeFor,
  workEstimateFor
} from "./quote-onboarding";
import type { OnboardingState } from "./quote-onboarding";

function stateWith(patch: Partial<OnboardingState>): OnboardingState {
  return { ...initialOnboardingState(), ...patch };
}

describe("quote-onboarding flow", () => {
  it("covers the visual catalog categories with an expandable famous-game list", () => {
    expect(ONBOARDING_GAMES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ONBOARDING_GAMES.map((game) => game.category))).toEqual(new Set(ONBOARDING_GAME_CATEGORIES));
    expect(ONBOARDING_GAMES.map((game) => game.label)).toEqual(expect.arrayContaining([
      "리그 오브 레전드",
      "발로란트",
      "배틀그라운드",
      "로스트아크",
      "사이버펑크 2077",
      "마인크래프트",
      "포르자 호라이즌 5",
      "헬다이버즈 2",
      "문명 VII",
      "콜 오브 듀티: 워존"
    ]));
  });

  it("starts at the intent step with defaults", () => {
    const state = initialOnboardingState();
    expect(state.step).toBe("intent");
    expect(state.games).toEqual([]);
    expect(state.budgetWon).toBe(2_000_000);
  });

  it("walks the gaming branch intent → mode → usecase → games → performance → graphics → budget → summary", () => {
    let state = stateWith({ intent: "new" });
    expect(advanceOnboarding(state).step).toBe("mode");
    state = stateWith({ step: "mode", mode: "task" });
    expect(advanceOnboarding(state).step).toBe("usecase");
    state = stateWith({ step: "usecase", usecase: "gaming" });
    expect(advanceOnboarding(state).step).toBe("games");
    state = stateWith({ step: "games", games: ["cyberpunk"] });
    expect(advanceOnboarding(state).step).toBe("performance");
    state = stateWith({ step: "performance" });
    expect(advanceOnboarding(state).step).toBe("graphics");
    state = stateWith({ step: "graphics" });
    expect(advanceOnboarding(state).step).toBe("budget");
    state = stateWith({ step: "budget", usecase: "gaming" });
    expect(advanceOnboarding(state).step).toBe("summary");
  });

  it("walks the work branch through intensity to budget and summary", () => {
    let state = stateWith({ step: "usecase", usecase: "work" });
    expect(advanceOnboarding(state).step).toBe("works");
    state = stateWith({ step: "works", works: ["video"] });
    expect(advanceOnboarding(state).step).toBe("intensity");
    state = stateWith({ step: "intensity", intensity: "heavy" });
    expect(advanceOnboarding(state).step).toBe("budget");
    state = stateWith({ step: "budget", usecase: "work" });
    expect(advanceOnboarding(state).step).toBe("summary");
  });

  it("routes spec and budget modes through budget to summary", () => {
    expect(advanceOnboarding(stateWith({ step: "mode", mode: "spec" })).step).toBe("spec");
    expect(advanceOnboarding(stateWith({ step: "mode", mode: "budget" })).step).toBe("budget");
    expect(advanceOnboarding(stateWith({ step: "spec" })).step).toBe("budget");
    expect(advanceOnboarding(stateWith({ step: "budget", mode: "spec" })).step).toBe("summary");
    expect(advanceOnboarding(stateWith({ step: "budget", mode: "budget" })).step).toBe("summary");
  });

  it("routes upgrade intent to the upgrade info step", () => {
    expect(advanceOnboarding(stateWith({ intent: "upgrade" })).step).toBe("upgrade");
  });

  it("goes back through the gaming branch in reverse", () => {
    expect(backOnboarding(stateWith({ step: "summary" })).step).toBe("budget");
    expect(backOnboarding(stateWith({ step: "budget", usecase: "gaming" })).step).toBe("graphics");
    expect(backOnboarding(stateWith({ step: "graphics" })).step).toBe("performance");
    expect(backOnboarding(stateWith({ step: "performance" })).step).toBe("games");
    expect(backOnboarding(stateWith({ step: "games" })).step).toBe("usecase");
    expect(backOnboarding(stateWith({ step: "usecase" })).step).toBe("mode");
    expect(backOnboarding(stateWith({ step: "mode" })).step).toBe("intent");
  });

  it("goes back to intensity/spec/mode from budget depending on branch", () => {
    expect(backOnboarding(stateWith({ step: "budget", usecase: "work" })).step).toBe("intensity");
    expect(backOnboarding(stateWith({ step: "budget", mode: "spec" })).step).toBe("spec");
    expect(backOnboarding(stateWith({ step: "budget", mode: "budget" })).step).toBe("mode");
  });

  it("blocks advancing without required selections", () => {
    expect(canAdvance(initialOnboardingState())).toBe(false);
    expect(canAdvance(stateWith({ intent: "new" }))).toBe(true);
    expect(canAdvance(stateWith({ step: "games" }))).toBe(false);
    expect(canAdvance(stateWith({ step: "games", games: ["pubg"] }))).toBe(true);
    expect(canAdvance(stateWith({ step: "works" }))).toBe(false);
    expect(canAdvance(stateWith({ step: "intensity" }))).toBe(false);
    expect(canAdvance(stateWith({ step: "intensity", intensity: "light" }))).toBe(true);
  });

  it("labels steps like the mockups", () => {
    expect(stepIndicatorFor(stateWith({ step: "intent" }))).toEqual({ eyebrow: "START HERE", index: 1, total: 4 });
    expect(stepIndicatorFor(stateWith({ step: "games" }))).toEqual({ eyebrow: "GAMING", index: 4, total: 8 });
    expect(stepIndicatorFor(stateWith({ step: "graphics" }))).toEqual({ eyebrow: "GRAPHICS OPTIONS", index: 6, total: 8 });
    expect(stepIndicatorFor(stateWith({ step: "budget", usecase: "gaming" }))).toEqual({ eyebrow: "BUDGET", index: 7, total: 8 });
    expect(stepIndicatorFor(stateWith({ step: "intensity", works: ["video"] })).eyebrow).toBe("VIDEO EDITING");
    expect(stepIndicatorFor(stateWith({ step: "budget", usecase: "work" }))).toEqual({ eyebrow: "BUDGET", index: 6, total: 7 });
    expect(stepIndicatorFor(stateWith({ step: "summary", usecase: "work" }))).toEqual({ eyebrow: "READY", index: 7, total: 7 });
    expect(stepIndicatorFor(stateWith({ step: "summary", mode: "spec" }))).toEqual({ eyebrow: "READY", index: 5, total: 5 });
    expect(stepIndicatorFor(stateWith({ step: "summary", mode: "budget" }))).toEqual({ eyebrow: "READY", index: 4, total: 4 });
  });
});

describe("quote-onboarding estimates", () => {
  it("maps 200만원 to the mockup's QHD·144 tier", () => {
    const estimate = budgetEstimateFor(2_000_000, "gaming");
    expect(estimate.performance).toBe("QHD · 144 FPS");
    expect(estimate.gpu).toBe("상급 GPU");
    expect(estimate.memory).toBe("32GB");
    expect(estimate.storage).toBe("1TB SSD");
  });

  it("uses a general PC tier when the user chooses budget without a use case", () => {
    const estimate = budgetEstimateFor(2_000_000, undefined);
    expect(estimate).toMatchObject({ performance: "균형형 일반 구성", gpu: "표준 GPU", memory: "32GB", storage: "1TB SSD" });
    expect(estimate.performance).not.toContain("작업");
  });

  it("turns the selected work and intensity into a concrete reference spec", () => {
    expect(workEstimateFor(["video"], "heavy")).toEqual({ performance: "4K·6K 편집·고급 효과", gpu: "상급 GPU", memory: "64GB", storage: "2TB SSD" });
    expect(workEstimateFor(["audio"], "balanced")).toMatchObject({ performance: "중형 프로젝트·가상악기", gpu: "내장 그래픽", memory: "32GB", storage: "1TB SSD" });
    expect(workEstimateFor(["office", "threed"], "heavy").performance).toBe("대형 씬·반복 렌더링");
  });

  it("raises the gaming tier as budget grows", () => {
    expect(budgetEstimateFor(4_000_000, "gaming").performance).toBe("4K · 144 FPS");
    expect(budgetEstimateFor(900_000, "gaming").performance).toBe("FHD · 60 FPS");
  });

  it("requires roughly 320~380만원 for 4K·144 like the mockup warning", () => {
    const required = requiredGamingBudgetFor("4k", 144, []);
    expect(required.minWon).toBe(3_200_000);
    expect(required.maxWon).toBe(3_800_000);
  });

  it("raises the required budget for demanding games", () => {
    const easy = requiredGamingBudgetFor("4k", 144, ["valorant"]);
    const hard = requiredGamingBudgetFor("4k", 144, ["cyberpunk"]);
    expect(hard.minWon).toBeGreaterThan(easy.minWon);
  });

  it("raises the advisory range when graphics options add GPU pressure", () => {
    const standard = requiredGamingBudgetFor("4k", 144, [], { graphicsPreset: "balanced", upscaling: "quality" });
    const demanding = requiredGamingBudgetFor("4k", 144, [], { graphicsPreset: "high", rayTracing: true, upscaling: "native" });
    expect(demanding.minWon).toBeGreaterThan(standard.minWon);
    expect(demanding.maxWon).toBeGreaterThan(standard.maxWon);
  });

  it("returns a work budget range based on the heaviest selected work", () => {
    const office = requiredWorkBudgetFor(["office"], "light");
    const render = requiredWorkBudgetFor(["office", "threed"], "heavy");
    expect(render.minWon).toBeGreaterThan(office.minWon);
    expect(targetBudgetRangeFor(stateWith({ usecase: "work", works: ["video"], intensity: "balanced" }))).toEqual(requiredWorkBudgetFor(["video"], "balanced"));
  });

  it("returns a spec budget range from the selected tier, GPU, RAM, and storage", () => {
    const basic = requiredSpecBudgetFor("entry", false, 16, 500);
    const top = requiredSpecBudgetFor("top", true, 128, 4000);
    expect(top.minWon).toBeGreaterThan(basic.minWon);
    expect(top.maxWon).toBeGreaterThan(basic.maxWon);
  });

  it("flags a shortfall only when the budget is below the requirement", () => {
    const short = stateWith({ usecase: "gaming", resolution: "4k", refreshRate: 144, budgetWon: 2_000_000 });
    expect(gamingTargetShortfall(short)).not.toBeNull();
    const enough = stateWith({ usecase: "gaming", resolution: "4k", refreshRate: 144, budgetWon: 4_000_000 });
    expect(gamingTargetShortfall(enough)).toBeNull();
    const work = stateWith({ usecase: "work", budgetWon: 800_000 });
    expect(gamingTargetShortfall(work)).toBeNull();
  });

  it("clamps the budget control range", () => {
    expect(clampBudget(100_000)).toBe(800_000);
    expect(clampBudget(9_000_000)).toBe(8_000_000);
    expect(clampBudget(2_040_000)).toBe(2_000_000);
  });
});

describe("quote-onboarding recommend params", () => {
  it("builds a gaming request from wizard state", () => {
    const params = recommendParamsFor(stateWith({ usecase: "gaming", games: ["cyberpunk", "pubg"], resolution: "4k", refreshRate: 144, graphicsPreset: "high", rayTracing: true, upscaling: "quality", budgetWon: 2_000_000 }));
    expect(params.profile).toBe("gaming");
    expect(params.includeGpu).toBe(true);
    expect(params.gamingResolution).toBe("4k");
    expect(params.gamingRefreshRate).toBe(144);
    expect(params.gamingGameIds).toEqual(["cyberpunk", "pubg"]);
    expect(params.gamingGraphicsPreset).toBe("high");
    expect(params.gamingRayTracing).toBe(true);
    expect(params.gamingUpscaling).toBe("quality");
    expect(params.budgetWon).toBe(2_000_000);
  });

  it("maps work selections to profiles and GPU inclusion", () => {
    const video = recommendParamsFor(stateWith({ usecase: "work", works: ["video"], intensity: "heavy" }));
    expect(video.profile).toBe("creator");
    expect(video.priority).toBe("performance");
    expect(video.includeGpu).toBe(true);
    expect(video.memoryCapacityGb).toBe(64);
    expect(video.workType).toBe("video");
    expect(video.workIntensity).toBe("heavy");

    const office = recommendParamsFor(stateWith({ usecase: "work", works: ["office"], intensity: "light" }));
    expect(office.profile).toBe("office");
    expect(office.includeGpu).toBe(false);

    const dev = recommendParamsFor(stateWith({ usecase: "work", works: ["dev"], intensity: "heavy" }));
    expect(dev.profile).toBe("development");
    expect(dev.includeGpu).toBe(true);

    const ai = recommendParamsFor(stateWith({ usecase: "work", works: ["ai"], intensity: "heavy" }));
    expect(ai.profile).toBe("development");
    expect(ai.includeGpu).toBe(true);

    const audio = recommendParamsFor(stateWith({ usecase: "work", works: ["audio"], intensity: "balanced" }));
    expect(audio.profile).toBe("creator");
    expect(audio.includeGpu).toBe(false);
  });

  it("prefers the heaviest work when several are selected", () => {
    const params = recommendParamsFor(stateWith({ usecase: "work", works: ["office", "threed"], intensity: "balanced" }));
    expect(params.profile).toBe("creator");
  });

  it("preserves work context in the recommendation URL", () => {
    const query = recommendQueryFor(stateWith({ usecase: "work", works: ["video"], intensity: "heavy", budgetWon: 2_500_000 }));
    const params = new URLSearchParams(query);
    expect(params.get("work")).toBe("video");
    expect(params.get("intensity")).toBe("heavy");
  });

  it("maps spec mode to a general request carrying memory/storage", () => {
    const params = recommendParamsFor(stateWith({ mode: "spec", resolution: "4k", memoryGb: 64, storageGb: 2000 }));
    expect(params.profile).toBe("general");
    expect(params.priority).toBe("performance");
    expect(params.includeGpu).toBe(true);
    expect(params.memoryCapacityGb).toBe(64);
    expect(params.storageCapacityGb).toBe(2000);

    const integrated = recommendParamsFor(stateWith({ mode: "spec", specTier: "entry", specIncludeGpu: false, memoryGb: 16, storageGb: 500 }));
    expect(integrated.priority).toBe("budget");
    expect(integrated.includeGpu).toBe(false);
  });

  it("carries the generic budget tier's expected memory and storage into the generator request", () => {
    const budget = recommendParamsFor(stateWith({ mode: "budget", budgetWon: 4_000_000 }));
    expect(budget).toMatchObject({ profile: "general", budgetWon: 4_000_000, includeGpu: true, memoryCapacityGb: 64, storageCapacityGb: 2000 });
  });

  it("serializes to the generator query format with autorun", () => {
    const query = recommendQueryFor(stateWith({ usecase: "gaming", resolution: "4k", refreshRate: 144, budgetWon: 2_000_000 }));
    const params = new URLSearchParams(query);
    expect(params.get("profile")).toBe("gaming");
    expect(params.get("resolution")).toBe("4k");
    expect(params.get("refresh")).toBe("144");
    expect(params.get("graphics")).toBe("high");
    expect(params.get("upscaling")).toBe("quality");
    expect(params.get("budget")).toBe("2000000");
    expect(params.get("autorun")).toBe("1");
  });

  it("keeps the direct performance tier in the generator query", () => {
    const query = recommendQueryFor(stateWith({ mode: "spec", specTier: "top", specIncludeGpu: false, memoryGb: 64, storageGb: 2000 }));
    const params = new URLSearchParams(query);
    expect(params.get("tier")).toBe("top");
    expect(params.get("gpu")).toBe("0");
    expect(params.get("ram")).toBe("64");
    expect(params.get("ssd")).toBe("2000");
  });

  it("serializes gaming advisory options without claiming FPS evidence", () => {
    const query = recommendQueryFor(stateWith({ usecase: "gaming", games: ["cyberpunk", "pubg"], graphicsPreset: "high", rayTracing: true, upscaling: "balanced" }));
    const params = new URLSearchParams(query);
    expect(params.get("games")).toBe("cyberpunk,pubg");
    expect(params.get("graphics")).toBe("high");
    expect(params.get("rt")).toBe("1");
    expect(params.get("upscaling")).toBe("balanced");
  });
});

describe("quote-onboarding persistence", () => {
  it("round-trips wizard state", () => {
    const state = stateWith({ step: "budget", intent: "new", mode: "task", usecase: "gaming", games: ["cyberpunk", "pubg"], budgetWon: 3_000_000 });
    expect(onboardingStateFromJson(onboardingStateToJson(state))).toEqual(state);
  });

  it("rejects invalid persisted payloads", () => {
    expect(onboardingStateFromJson(null)).toBeNull();
    expect(onboardingStateFromJson("not-json")).toBeNull();
    expect(onboardingStateFromJson('{"step":"bogus"}')).toBeNull();
    const dirty = onboardingStateFromJson('{"step":"games","games":["cyberpunk","hacked"],"budgetWon":-5}');
    expect(dirty?.games).toEqual(["cyberpunk"]);
    expect(dirty?.budgetWon).toBe(2_000_000);
    const oversized = onboardingStateFromJson(JSON.stringify({ step: "games", games: Array(8).fill("cyberpunk"), budgetWon: 99_000_000 }));
    expect(oversized?.games).toHaveLength(5);
    expect(oversized?.budgetWon).toBe(8_000_000);
  });
});
