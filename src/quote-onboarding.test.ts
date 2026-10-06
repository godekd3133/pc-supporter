import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { QuoteOnboardingView } from "./QuoteOnboardingView";
import { BuildGeneratorView } from "./BuildGeneratorView";
import { safeSessionStorage } from "./safe-storage";
import {
  advanceOnboarding,
  backOnboarding,
  budgetEstimateFor,
  budgetEstimateForSelectedTarget,
  canAdvance,
  clampBudget,
  gamingTargetShortfall,
  initialOnboardingState,
  ONBOARDING_GAME_CATEGORIES,
  ONBOARDING_GAMES,
  ONBOARDING_INTENSITIES,
  ONBOARDING_WORKS,
  ONBOARDING_STORAGE_KEY,
  onboardingStateForGeneratorPreset,
  onboardingStateFromJson,
  onboardingStateToJson,
  purchaseConditionSummaryFor,
  recommendGenerationRequestFor,
  recommendParamsFor,
  recommendQueryFor,
  requiredWorkBudgetFor,
  requiredGamingBudgetFor,
  requiredSpecBudgetFor,
  stepIndicatorFor,
  targetBudgetRangeFor,
  targetSummaryFor,
  targetFpsFor,
  validTargetFps,
  workEstimateFor
} from "./quote-onboarding";
import type { OnboardingState } from "./quote-onboarding";
import type { GeneratorPresetConfig } from "../shared/generator-preset";

function stateWith(patch: Partial<OnboardingState>): OnboardingState {
  return { ...initialOnboardingState(), ...patch };
}

describe("quote-onboarding flow", () => {
  it("renders choices that advance directly without a next action", () => {
    const markup = renderToStaticMarkup(createElement(QuoteOnboardingView, { onFinish: () => undefined, onUpgrade: () => undefined, onSkip: () => undefined, onHome: () => undefined }));

    expect(markup).toContain('data-testid="onboarding-progress"');
    expect(markup).toContain('aria-valuetext="단계 1, 총 4단계"');
    expect(markup).toContain('id="onboarding-title"');
    expect(markup).toContain('role="radiogroup" aria-labelledby="onboarding-title"');
    expect(markup.match(/type="radio" name="onboarding-intent"/g)).toHaveLength(3);
    expect(markup).not.toContain('aria-pressed="false"');
    expect(markup).not.toContain('class="onboarding-cta"');
  });

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

  it("uses the phase-one budget gaming route without game or FPS requirements", () => {
    const options = { gamingTestbedPhase1: true };
    const budget = advanceOnboarding(stateWith({ step: "mode", mode: "budget", usecase: "work" }), options);
    expect(budget).toMatchObject({ step: "budget", usecase: "gaming" });
    expect(backOnboarding(budget, options).step).toBe("mode");
    const gaming = advanceOnboarding(stateWith({ step: "usecase", mode: "task", usecase: "gaming" }), options);
    expect(gaming.step).toBe("budget");
    expect(backOnboarding(gaming, options).step).toBe("usecase");
    expect(stepIndicatorFor(gaming, options)).toMatchObject({ index: 4, total: 5 });
    const request = recommendGenerationRequestFor({ ...gaming, games: ["cyberpunk"], budgetWon: 1_200_000 }, options);
    expect(request).toMatchObject({ profile: "gaming", budgetWon: 1_200_000, memoryCapacityGb: 16 });
    expect(request.gamingGameIds).toBeUndefined();
    expect(request.gamingRefreshRate).toBeUndefined();
    const query = new URLSearchParams(recommendQueryFor(gaming, options));
    expect(query.has("games")).toBe(false);
    expect(query.has("refresh")).toBe(false);
    expect(advanceOnboarding(stateWith({ step: "mode", mode: "spec", usecase: "gaming" }), options).usecase).toBeUndefined();
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
    expect(estimate.performance).toBe("QHD · 144Hz 주사율 목표");
    expect(estimate.gpu).toBe("상급 GPU");
    expect(estimate.memory).toBe("32GB");
    expect(estimate.storage).toBe("1TB SSD");
  });

  it("uses a general PC tier when the user chooses budget without a use case", () => {
    const estimate = budgetEstimateFor(2_000_000, undefined);
    expect(estimate).toMatchObject({ performance: "균형형 일반 구성", gpu: "상급 GPU", memory: "32GB", storage: "1TB SSD" });
    expect(estimate.performance).not.toContain("작업");
  });

  it("turns the selected work and intensity into a concrete reference spec", () => {
    expect(workEstimateFor(["video"], "heavy")).toEqual({ performance: "4K·6K 편집·고급 효과", gpu: "상급 GPU", memory: "64GB", storage: "2TB SSD" });
    expect(workEstimateFor(["audio"], "balanced")).toMatchObject({ performance: "중형 프로젝트·가상악기", gpu: "내장 그래픽", memory: "32GB", storage: "1TB SSD" });
    expect(workEstimateFor(["office", "threed"], "heavy").performance).toBe("대형 씬·반복 렌더링");
  });

  it("raises the gaming tier as budget grows", () => {
    expect(budgetEstimateFor(4_000_000, "gaming").performance).toBe("4K · 144Hz 주사율 목표");
    expect(budgetEstimateFor(900_000, "gaming").performance).toBe("FHD · 60Hz 주사율 목표");
  });

  it("keeps the selected gaming target in the budget estimate when the budget reaches a higher tier", () => {
    const state = stateWith({ usecase: "gaming", resolution: "1440p", refreshRate: 144, budgetWon: 3_000_000 });
    expect(budgetEstimateForSelectedTarget(state)).toMatchObject({
      performance: "QHD · 목표 144 FPS",
      gpu: "FPS 테스트와 비교해 선택",
      memory: "16GB부터 · 구성에 맞춰 조정",
      storage: "1TB SSD"
    });
  });

  it("labels the selected FPS as a goal without implying a measured result", () => {
    const summary = targetSummaryFor(stateWith({ usecase: "gaming", refreshRate: 144, targetFps: 120 }));
    expect(summary).toContain("목표 120 FPS");
    expect(summary).not.toContain("실측");
    expect(budgetEstimateFor(2_000_000, "gaming").performance).not.toContain("FPS");
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

  it("raises the displayed floor to the catalog minimum instead of promising headroom", () => {
    // 가벼운 게임 FHD·60Hz 참고 범위(50~60만원대)가 카탈로그 실측 최저가보다
    // 낮으면 "예산 여유" 안내는 거짓이 된다 — 하한을 실측 최저가로 올려 잡는다.
    const floors = { gaming: { "1080p": 936_330 } };
    const range = requiredGamingBudgetFor("1080p", 60, ["league"], {}, 936_330);
    expect(range.minWon).toBe(1_000_000);
    expect(range.maxWon).toBeGreaterThanOrEqual(range.minWon);

    const state = stateWith({ usecase: "gaming", games: ["league"], resolution: "1080p", refreshRate: 60, budgetWon: 800_000 });
    expect(gamingTargetShortfall(state, floors)?.minWon).toBe(1_000_000);
    expect(targetBudgetRangeFor(state, floors)?.minWon).toBe(1_000_000);
    expect(targetBudgetRangeFor(stateWith({ ...state, budgetWon: 1_000_000 }), floors)?.minWon).toBe(1_000_000);
  });

  it("keeps the static range when the catalog floor is below it", () => {
    const range = requiredGamingBudgetFor("4k", 144, ["cyberpunk"], {}, 936_330);
    expect(range.minWon).toBe(requiredGamingBudgetFor("4k", 144, ["cyberpunk"]).minWon);
    expect(targetBudgetRangeFor(stateWith({ usecase: "work", works: ["threed"], intensity: "heavy" }), { discreteGpu: 936_330 })).toEqual(requiredWorkBudgetFor(["threed"], "heavy"));
  });

  it("prefers the exact request floor over profile-class floors so suggested budgets cannot fail again", () => {
    // spec 최상급 등급은 정적 범위(수백만원대)보다 훨씬 비싼 실측 최저가를 가진다 —
    // 프로필 평균 하한이 아니라 그 요청 자체의 최저가로 안내해야 실패를 되풀이하지 않는다.
    const specTop = stateWith({ mode: "spec", specTier: "top", specIncludeGpu: true, memoryGb: 32, storageGb: 1000 });
    const range = targetBudgetRangeFor(specTop, { discreteGpu: 936_330 }, 10_267_150);
    expect(range?.minWon).toBe(10_300_000);

    // 가벼운 게임의 정적 범위는 실제 요청 최저가보다 낮을 수 있다 — 실제 요청
    // (예산 티어가 올라 32GB/1TB를 요구)의 floor로 하한을 올려 잡는다.
    const gamingLow = stateWith({ usecase: "gaming", games: ["league"], resolution: "1080p", refreshRate: 60, budgetWon: 1_400_000 });
    expect(gamingTargetShortfall(gamingLow, { gaming: { "1080p": 936_330 } }, 1_601_330)?.minWon).toBe(1_700_000);

    // 요청 floor가 정적 범위 안이면 범위를 줄이지 않는다 — 바닥을 올리기만 한다.
    const staticOnly = requiredGamingBudgetFor("4k", 144, ["cyberpunk"], { graphicsPreset: "high", rayTracing: true, upscaling: "native" }, 1_601_330);
    expect(staticOnly.minWon).toBe(requiredGamingBudgetFor("4k", 144, ["cyberpunk"], { graphicsPreset: "high", rayTracing: true, upscaling: "native" }).minWon);
  });

  it("clamps the budget control range", () => {
    expect(clampBudget(100_000)).toBe(800_000);
    expect(clampBudget(9_000_000)).toBe(9_000_000);
    expect(clampBudget(11_000_000)).toBe(10_000_000);
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

  it("starts game targets with 16GB instead of spending GPU budget on tier-based memory increases", () => {
    // Budget alone must not force RAM upgrades ahead of the GPU.
    const low = recommendParamsFor(stateWith({ usecase: "gaming", games: ["league"], resolution: "1080p", refreshRate: 60, budgetWon: 800_000 }));
    expect(low.memoryCapacityGb).toBe(16);
    expect(low.storageCapacityGb).toBe(1000);
    expect(low.includeGpu).toBe(true);

    const mid = recommendParamsFor(stateWith({ usecase: "gaming", games: ["league"], budgetWon: 1_200_000 }));
    expect(mid.memoryCapacityGb).toBe(16);
    expect(mid.storageCapacityGb).toBe(1000);
  });

  it("maps the wizard state to the generation request the floor probe must mirror", () => {
    const request = recommendGenerationRequestFor(stateWith({ usecase: "gaming", games: ["cyberpunk"], resolution: "4k", refreshRate: 144, graphicsPreset: "high", rayTracing: true, upscaling: "native", budgetWon: 2_000_000 }));
    expect(request).toMatchObject({
      profile: "gaming",
      includeGpu: true,
      budgetWon: 2_000_000,
      gamingResolution: "4k",
      gamingRefreshRate: 144,
      gamingGameIds: ["cyberpunk"],
      gamingGraphicsPreset: "high",
      gamingRayTracing: true,
      gamingUpscaling: "native",
      memoryCapacityGb: 16,
      storageCapacityGb: 1000
    });

    const spec = recommendGenerationRequestFor(stateWith({ mode: "spec", specTier: "top", specIncludeGpu: true, memoryGb: 128, storageGb: 4000 }));
    expect(spec).toMatchObject({ profile: "general", performanceTier: "top", includeGpu: true, memoryCapacityGb: 128, storageCapacityGb: 4000 });
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

  it("keeps every displayed work estimate aligned with the generator request", () => {
    const capacityGb = (label: string) => {
      const value = Number(label.match(/\d+/)?.[0] ?? 0);
      return label.includes("TB") ? value * 1000 : value;
    };

    for (const work of ONBOARDING_WORKS) {
      for (const intensity of ONBOARDING_INTENSITIES) {
        const state = stateWith({ usecase: "work", works: [work.id], intensity: intensity.id });
        const estimate = workEstimateFor(state.works, state.intensity);
        const params = recommendParamsFor(state);
        const query = new URLSearchParams(recommendQueryFor(state));
        const scenario = `${work.id}/${intensity.id}`;
        const expectedMemoryGb = capacityGb(estimate.memory);
        const expectedStorageGb = capacityGb(estimate.storage);
        const expectedGpu = estimate.gpu !== "내장 그래픽";

        expect(params.memoryCapacityGb, scenario).toBe(expectedMemoryGb);
        expect(params.storageCapacityGb, scenario).toBe(expectedStorageGb);
        expect(params.includeGpu, scenario).toBe(expectedGpu);
        expect(Number(query.get("ram") ?? 32), `${scenario} URL RAM`).toBe(expectedMemoryGb);
        expect(Number(query.get("ssd") ?? 1000), `${scenario} URL SSD`).toBe(expectedStorageGb);
        expect(query.get("gpu") !== "0", `${scenario} URL GPU`).toBe(expectedGpu);
      }
    }
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
    expect(budget).toMatchObject({ profile: "general", performanceTier: "high", budgetWon: 4_000_000, includeGpu: true, memoryCapacityGb: 64, storageCapacityGb: 2000 });
  });

  it("carries the balanced general budget's upper GPU target into the candidate request", () => {
    const balanced = recommendParamsFor(stateWith({ mode: "budget", budgetWon: 2_000_000 }));
    const basic = recommendParamsFor(stateWith({ mode: "budget", budgetWon: 1_500_000 }));
    expect(balanced).toMatchObject({ performanceTier: "high", includeGpu: true, memoryCapacityGb: 32, storageCapacityGb: 1000 });
    expect(basic.performanceTier).toBeUndefined();
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

  it("serializes the budget-derived general performance target for the generator", () => {
    const params = new URLSearchParams(recommendQueryFor(stateWith({ mode: "budget", budgetWon: 2_000_000 })));
    expect(params.get("profile")).toBe("general");
    expect(params.get("tier")).toBe("high");
    expect(params.get("budget")).toBe("2000000");
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

function presetConfigWith(patch: Partial<GeneratorPresetConfig>): GeneratorPresetConfig {
  return {
    profile: "general",
    priority: "balanced",
    gamingResolution: "1440p",
    gamingRefreshRate: 144,
    memoryCapacityGb: 32,
    budgetWon: 1_500_000,
    includeGpu: true,
    storageCapacityGb: 1000,
    hddCount: 0,
    hddCapacityGb: 4000,
    listingPolicy: "retail_only",
    ...patch
  };
}

describe("quote-onboarding generator presets", () => {
  it("maps a gaming preset into the gaming wizard branch at the summary step", () => {
    const state = onboardingStateForGeneratorPreset(presetConfigWith({
      profile: "gaming",
      priority: "performance",
      gamingResolution: "1080p",
      gamingRefreshRate: 60,
      gamingGameIds: ["league", "cyberpunk"],
      gamingGraphicsPreset: "competitive",
      gamingRayTracing: true,
      gamingUpscaling: "native",
      budgetWon: 1_200_000
    }));
    expect(state).toMatchObject({
      step: "summary",
      intent: "new",
      mode: "target_fps",
      gamingMode: "target_fps",
      gpuVendorPreference: "nvidia",
      usecase: "gaming",
      games: ["league", "cyberpunk"],
      resolution: "1080p",
      refreshRate: 60,
      graphicsPreset: "competitive",
      rayTracing: true,
      upscaling: "native",
      budgetWon: 1_200_000
    });
  });

  it("maps a general preset into the spec branch with tier, GPU, memory and storage", () => {
    const state = onboardingStateForGeneratorPreset(presetConfigWith({
      profile: "general",
      performanceTier: "top",
      includeGpu: false,
      memoryCapacityGb: 64,
      storageCapacityGb: 2000
    }));
    expect(state).toMatchObject({
      step: "summary",
      mode: "spec",
      specTier: "top",
      specIncludeGpu: false,
      memoryGb: 64,
      storageGb: 2000,
      budgetWon: 1_500_000
    });
  });

  it("maps work profiles onto a representative work and derives intensity from memory", () => {
    expect(onboardingStateForGeneratorPreset(presetConfigWith({ profile: "development", memoryCapacityGb: 64 }))).toMatchObject({ usecase: "work", works: ["dev"], intensity: "heavy" });
    expect(onboardingStateForGeneratorPreset(presetConfigWith({ profile: "office", memoryCapacityGb: 16 }))).toMatchObject({ usecase: "work", works: ["office"], intensity: "light" });
    expect(onboardingStateForGeneratorPreset(presetConfigWith({ profile: "creator", memoryCapacityGb: 32 }))).toMatchObject({ usecase: "work", works: ["video"], intensity: "balanced" });
  });

  it("clamps preset budgets into the wizard range and drops unknown game ids", () => {
    const state = onboardingStateForGeneratorPreset(presetConfigWith({ profile: "gaming", gamingGameIds: ["league", "not-a-real-game"], budgetWon: 100 }));
    expect(state.games).toEqual(["league"]);
    expect(state.budgetWon).toBe(800_000);
    expect(onboardingStateForGeneratorPreset(presetConfigWith({ profile: "gaming", gamingGameIds: ["bogus"], budgetWon: 99_000_000 }))).toMatchObject({ games: [], budgetWon: 10_000_000 });
  });

  it("produces a state that survives persistence and can finish the wizard", () => {
    const state = onboardingStateForGeneratorPreset(presetConfigWith({ profile: "gaming", gamingGameIds: ["pubg"] }));
    expect(onboardingStateFromJson(onboardingStateToJson(state))).toEqual({ ...state, listingPolicy: "retail_only" });
    expect(canAdvance(state)).toBe(true);
    expect(stepIndicatorFor(state).eyebrow).toBe("READY");
  });
});

describe("quote-onboarding persistence", () => {
  it("round-trips wizard state", () => {
    const state = stateWith({ step: "budget", intent: "new", mode: "task", usecase: "gaming", games: ["cyberpunk", "pubg"], budgetWon: 3_000_000 });
    expect(onboardingStateFromJson(onboardingStateToJson(state))).toEqual({ ...state, listingPolicy: "retail_only" });
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
    expect(oversized?.budgetWon).toBe(10_000_000);
  });
});


describe("phase-two gaming targets", () => {
  it("offers a direct game-target branch and retains budget-only generation", () => {
    const target = advanceOnboarding(stateWith({ step: "mode", mode: "target_fps" }));
    expect(target).toMatchObject({ step: "games", usecase: "gaming", gamingMode: "target_fps" });
    expect(backOnboarding(target).step).toBe("mode");
    expect(stepIndicatorFor(target)).toMatchObject({ index: 3, total: 7 });
    const budget = stateWith({ mode: "budget", usecase: "gaming", gamingMode: "budget", games: ["cyberpunk"], gpuVendorPreference: "amd" });
    const request = recommendGenerationRequestFor(budget);
    expect(request).toMatchObject({ gamingMode: "budget", gpuVendorPreference: "amd", memoryCapacityGb: 16 });
    expect(request.gamingGameIds).toBeUndefined();
    expect(request.gamingTargetFps).toBeUndefined();
    expect(targetBudgetRangeFor(budget)).toBeNull();
  });

  it("keeps custom target FPS distinct from monitor refresh in both payload and URL", () => {
    const state = stateWith({ mode: "target_fps", usecase: "gaming", games: ["cyberpunk", "pubg"], targetFps: 120, refreshRate: 144, resolution: "1440p", gpuVendorPreference: "amd", graphicsPreset: "high", rayTracing: true, upscaling: "native" });
    expect(recommendGenerationRequestFor(state)).toMatchObject({ gamingMode: "target_fps", gamingTargetFps: 120, gamingRefreshRate: 144, gpuVendorPreference: "amd", gamingGameIds: ["cyberpunk", "pubg"], gamingRayTracing: true });
    const query = new URLSearchParams(recommendQueryFor(state));
    expect(Object.fromEntries(query)).toMatchObject({ gamingMode: "target_fps", targetFps: "120", refresh: "144", gpuVendor: "amd", games: "cyberpunk,pubg", graphics: "high", rt: "1", upscaling: "native" });
    expect(targetSummaryFor(state)).toContain("목표 120 FPS");
    expect(targetFpsFor(state)).toBe(120);
  });

  it("validates custom target FPS and restores new settings without changing old drafts", () => {
    for (const fps of [30, 60, 120, 500]) expect(validTargetFps(fps)).toBe(true);
    for (const fps of [0, 29, 501, 60.5, NaN, Infinity]) expect(validTargetFps(fps)).toBe(false);
    expect(canAdvance(stateWith({ step: "performance", targetFps: 0 }))).toBe(false);
    const state = stateWith({ step: "graphics", mode: "target_fps", usecase: "gaming", gamingMode: "target_fps", targetFps: 120, gpuVendorPreference: "amd", games: ["pubg"] });
    expect(onboardingStateFromJson(onboardingStateToJson(state))).toEqual({ ...state, listingPolicy: "retail_only" });
    expect(onboardingStateFromJson('{"step":"performance","refreshRate":60}')?.gpuVendorPreference).toBe("nvidia");
    expect(onboardingStateFromJson('{"step":"performance","refreshRate":60}')?.targetFps).toBeUndefined();
  });

  it("restores a target preset with its vendor and custom FPS", () => {
    const state = onboardingStateForGeneratorPreset(presetConfigWith({ profile: "gaming", gamingMode: "target_fps", gamingTargetFps: 120, gpuVendorPreference: "amd", gamingGameIds: ["pubg"], gamingRefreshRate: 144 }));
    expect(state).toMatchObject({ step: "summary", mode: "target_fps", gamingMode: "target_fps", targetFps: 120, refreshRate: 144, gpuVendorPreference: "amd" });
  });
});

describe("budget gaming purchase-condition handoff", () => {
  function freshBudgetState(): OnboardingState {
    const mode = advanceOnboarding({ ...initialOnboardingState(), intent: "new" });
    return advanceOnboarding({ ...mode, mode: "budget", usecase: "gaming", gamingMode: "budget", budgetWon: 800_000 });
  }

  it("allows domestic new bulk listings for a newly selected 80만원 game budget without reducing the SSD target", () => {
    const state = freshBudgetState();
    expect(state).toMatchObject({ step: "budget", listingPolicy: "include_bulk" });
    expect(recommendGenerationRequestFor(state)).toMatchObject({ profile: "gaming", gamingMode: "budget", gamingTestbedPhase1: true, budgetWon: 800_000, memoryCapacityGb: 16, storageCapacityGb: 1000, listingPolicy: "include_bulk", includeNonRetail: true });
    expect(new URLSearchParams(recommendQueryFor(state)).get("listingPolicy")).toBe("include_bulk");
    expect(purchaseConditionSummaryFor(state)).toBe("국내 신품 · 벌크 포함");
    expect(onboardingStateFromJson(onboardingStateToJson(state))).toEqual(state);
  });

  it.each(["target_fps", "task", "spec"] as const)("keeps the existing retail-only default for a new %s route", (mode) => {
    const state = advanceOnboarding({ ...initialOnboardingState(), step: "mode", intent: "new", mode });
    expect(recommendGenerationRequestFor(state)).toMatchObject({ listingPolicy: "retail_only", includeNonRetail: false });
    expect(new URLSearchParams(recommendQueryFor(state)).get("listingPolicy")).toBe("retail_only");
  });

  it("preserves the retail-only condition of an older saved budget draft when the user edits its mode", () => {
    const saved = onboardingStateFromJson(JSON.stringify({ step: "mode", intent: "new", mode: "budget", usecase: "gaming", budgetWon: 800_000 }));
    expect(saved).not.toBeNull();
    const state = advanceOnboarding(saved!);
    expect(recommendGenerationRequestFor(state)).toMatchObject({ listingPolicy: "retail_only", includeNonRetail: false, storageCapacityGb: 1000 });
  });

  it.each(["retail_only", "include_bulk", "all"] as const)("preserves an explicit %s policy through preset editing, storage and the generator URL", (listingPolicy) => {
    const preset = onboardingStateForGeneratorPreset(presetConfigWith({ profile: "gaming", gamingMode: "budget", budgetWon: 800_000, listingPolicy }));
    const state = advanceOnboarding({ ...onboardingStateFromJson(onboardingStateToJson(preset))!, step: "mode" });
    expect(recommendGenerationRequestFor(state)).toMatchObject({ listingPolicy, includeNonRetail: listingPolicy !== "retail_only" });
    expect(new URLSearchParams(recommendQueryFor(state)).get("listingPolicy")).toBe(listingPolicy);
  });

  it.each(["budget", "summary"] as const)("shows the purchase condition on the %s screen", (step) => {
    const state = { ...freshBudgetState(), step };
    const storageSpy = vi.spyOn(safeSessionStorage, "getItem").mockImplementation((key) => key === ONBOARDING_STORAGE_KEY ? onboardingStateToJson(state) : null);
    vi.stubGlobal("window", { location: { search: "?preset" } });
    try {
      const markup = renderToStaticMarkup(createElement(QuoteOnboardingView, { onFinish: () => undefined, onUpgrade: () => undefined, onSkip: () => undefined, onHome: () => undefined }));
      expect(markup).toContain("구매 조건");
      expect(markup).toContain("국내 신품 · 벌크 포함");
      if (step === "budget") expect(markup).toContain("1TB");
    } finally {
      storageSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it.each(["retail_only", "include_bulk", "all"] as const)("restores %s in the actual generator consumer", (listingPolicy) => {
    const state = { ...freshBudgetState(), listingPolicy };
    vi.stubGlobal("window", { location: { search: `?${recommendQueryFor(state)}` } });
    try {
      const markup = renderToStaticMarkup(createElement(BuildGeneratorView, {
        initialProfile: "general", draft: null, variants: [], budgetLadder: [], loading: false,
        onGenerate: async () => undefined, onGenerateVariants: async () => undefined,
        onGenerateBudgetLadder: async () => undefined, onApply: async () => undefined,
        onToast: () => undefined, onBudgetLadderShareSaved: () => undefined,
        onBudgetLadderShareRevoked: () => undefined, onEditPresetInOnboarding: () => undefined,
        onBack: () => undefined
      }));
      expect(markup).toContain(`<option value="${listingPolicy}" selected="">`);
      expect(markup).toContain('value="800000"');
      expect(markup).toContain('<option value="1000" selected="">');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


describe("explicit gaming capacities in preset editing", () => {
  it("preserves intentionally selected RAM and SSD amounts while editing target FPS", () => {
    const state = onboardingStateForGeneratorPreset(presetConfigWith({ profile: "gaming", gamingMode: "target_fps", gamingTargetFps: 120, gamingGameIds: ["pubg"], memoryCapacityGb: 64, storageCapacityGb: 2000 }));
    expect(recommendGenerationRequestFor(state)).toMatchObject({ gamingTargetFps: 120, memoryCapacityGb: 64, storageCapacityGb: 2000 });
    expect(budgetEstimateForSelectedTarget(state)).toMatchObject({ gpu: "FPS 테스트와 비교해 선택", memory: "64GB 이상", storage: "2TB SSD" });
    expect(onboardingStateFromJson(onboardingStateToJson(state))).toEqual(state);
  });
});

describe("explicit RAM requirement URL handoff", () => {
  it("preserves 32GB when a generated game target is edited instead of relying on a changed generator default", () => {
    const state = { ...initialOnboardingState(), usecase: "gaming" as const, mode: "target_fps" as const, gamingMode: "target_fps" as const, games: ["cyberpunk" as const], memoryGb: 32 as const, memoryExplicit: true };
    expect(recommendGenerationRequestFor(state).memoryCapacityGb).toBe(32);
    expect(new URLSearchParams(recommendQueryFor(state)).get("ram")).toBe("32");
  });
});
