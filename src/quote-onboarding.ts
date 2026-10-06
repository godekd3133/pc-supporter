import { GAMING_GRAPHICS_PRESET_LABELS, GAMING_UPSCALING_LABELS, RECOMMENDATION_PERFORMANCE_TIER_LABELS } from "../shared/types";
import type { BuildGenerationRequest, GamingMode, GpuVendorPreference, GamingGraphicsPreset, GamingRefreshRate, GamingResolution, GamingUpscaling, ListingPolicy, RecommendationFloorWon, RecommendationPerformanceTier, RecommendationPriority, RecommendationProfile } from "../shared/types";
import { GAMING_GAME_CATEGORY_LABELS, GAMING_GAMES, gamingAdvisoryTuningFor } from "../shared/gaming-catalog";
import type { GamingGameCategory, GamingGameId, GamingGameOption } from "../shared/gaming-catalog";
import type { GeneratorPresetConfig } from "../shared/generator-preset";

export type OnboardingStep = "intent" | "mode" | "upgrade" | "usecase" | "games" | "performance" | "graphics" | "works" | "intensity" | "spec" | "budget" | "summary";
export type OnboardingIntent = "new" | "upgrade" | "later";
export type OnboardingMode = "budget" | "target_fps" | "task" | "spec";
export type OnboardingUsecase = "gaming" | "work";
export type OnboardingGameCategory = GamingGameCategory;
export type OnboardingGame = GamingGameId;
export type OnboardingWork = "video" | "threed" | "dev" | "streaming" | "ai" | "audio" | "office";
export type OnboardingIntensity = "light" | "balanced" | "heavy";
export type OnboardingSpecTier = RecommendationPerformanceTier;
export const SPEC_TIER_LABELS = RECOMMENDATION_PERFORMANCE_TIER_LABELS;

export interface OnboardingState {
  step: OnboardingStep;
  intent?: OnboardingIntent;
  mode?: OnboardingMode;
  usecase?: OnboardingUsecase;
  games: OnboardingGame[];
  works: OnboardingWork[];
  intensity?: OnboardingIntensity;
  resolution: GamingResolution;
  refreshRate: GamingRefreshRate;
  targetFps?: number;
  gamingMode?: GamingMode;
  gpuVendorPreference: GpuVendorPreference;
  graphicsPreset: GamingGraphicsPreset;
  rayTracing: boolean;
  upscaling: GamingUpscaling;
  memoryGb: number;
  storageGb: number;
  memoryExplicit?: boolean;
  storageExplicit?: boolean;
  specTier: OnboardingSpecTier;
  specIncludeGpu: boolean;
  budgetWon: number;
  listingPolicy?: ListingPolicy;
}

export const ONBOARDING_STORAGE_KEY = "pc-supporter-quote-onboarding";

export const BUDGET_STOPS_WON = [800_000, 1_200_000, 1_600_000, 2_200_000, 4_000_000, 10_000_000] as const;
export const BUDGET_MIN_WON = 800_000;
export const BUDGET_MAX_WON = 10_000_000;
export const BUDGET_STEP_WON = 100_000;
export const MAX_ONBOARDING_GAMES = 5;

export const CURRENT_FPS_REFERENCE_GUIDANCE = "FPS 테스트가 있는 게임은 사이버펑크 2077·포르자 호라이즌 5·카운터 스트라이크 2·포트나이트·ARK: Survival Ascended·헬다이버즈 2예요. 일부 QHD·4K 옵션에서 레이 트레이싱과 업스케일링을 끈 결과입니다. 같은 게임·그래픽카드·옵션의 테스트가 없으면 FPS를 알 수 없다고 표시해요.";

export const ONBOARDING_GAME_CATEGORY_LABELS = GAMING_GAME_CATEGORY_LABELS;

export const ONBOARDING_GAME_CATEGORIES: readonly OnboardingGameCategory[] = ["competitive", "rpg", "aaa", "sandbox", "sports", "strategy", "domestic", "survival"];

export type OnboardingGameOption = GamingGameOption;
export const ONBOARDING_GAMES = GAMING_GAMES;

export interface OnboardingWorkOption {
  id: OnboardingWork;
  label: string;
  description: string;
  eyebrow: string;
  intensityQuestion: string;
  intensitySummary: string;
  profile: RecommendationProfile;
  rank: number;
}

export const ONBOARDING_WORKS: readonly OnboardingWorkOption[] = [
  {
    id: "video",
    label: "영상 편집",
    description: "FHD·4K 컷 편집과 효과 작업",
    eyebrow: "VIDEO EDITING",
    intensityQuestion: "영상 편집은 어느 정도 규모인가요?",
    intensitySummary: "영상 해상도와 편집 효과에 따라 필요한 사양이 달라져요.",
    profile: "creator",
    rank: 2
  },
  {
    id: "threed",
    label: "3D 모델링·렌더링",
    description: "모델링·씬 구성·반복 렌더링",
    eyebrow: "3D WORK",
    intensityQuestion: "3D 작업은 어느 정도 규모인가요?",
    intensitySummary: "모델링 규모와 렌더링 빈도에 따라 필요한 사양이 달라져요.",
    profile: "creator",
    rank: 3
  },
  {
    id: "dev",
    label: "개발·빌드",
    description: "IDE·빌드·컨테이너·가상 머신",
    eyebrow: "DEVELOPMENT",
    intensityQuestion: "개발 프로젝트 규모는 어느 정도인가요?",
    intensitySummary: "프로젝트 규모와 동시에 진행하는 작업에 따라 필요한 사양이 달라져요.",
    profile: "development",
    rank: 1
  },
  {
    id: "streaming",
    label: "방송·스트리밍",
    description: "송출·녹화와 게임 동시 실행",
    eyebrow: "STREAMING",
    intensityQuestion: "방송·스트리밍은 어느 정도 규모인가요?",
    intensitySummary: "송출 해상도와 게임 동시 실행 여부에 따라 필요한 사양이 달라져요.",
    profile: "creator",
    rank: 2
  },
  {
    id: "ai",
    label: "AI·머신러닝",
    description: "로컬 추론·모델 개발·학습",
    eyebrow: "AI / MACHINE LEARNING",
    intensityQuestion: "AI·머신러닝 작업은 어느 정도 규모인가요?",
    intensitySummary: "모델 크기와 추론·학습 여부에 따라 필요한 메모리와 그래픽 성능이 달라져요.",
    profile: "development",
    rank: 4
  },
  {
    id: "audio",
    label: "음악·오디오",
    description: "트랙·플러그인·가상악기 작업",
    eyebrow: "AUDIO WORK",
    intensityQuestion: "음악·오디오 작업은 어느 정도 규모인가요?",
    intensitySummary: "트랙 수와 플러그인·가상악기 사용량에 따라 필요한 사양이 달라져요.",
    profile: "creator",
    rank: 1
  },
  {
    id: "office",
    label: "사무·문서",
    description: "문서·웹·화상회의·멀티태스킹",
    eyebrow: "OFFICE",
    intensityQuestion: "사무·문서 작업은 어느 정도인가요?",
    intensitySummary: "함께 사용하는 프로그램 수와 문서 규모에 따라 필요한 사양이 달라져요.",
    profile: "office",
    rank: 0
  }
];

export interface OnboardingIntensityOption {
  id: OnboardingIntensity;
  label: string;
  description: string;
  recommended?: boolean;
  priority: RecommendationPriority;
  memoryGb: number;
  storageGb: number;
}

export const ONBOARDING_INTENSITIES: readonly OnboardingIntensityOption[] = [
  { id: "light", label: "가볍게", description: "간단한 작업 · 짧은 사용", priority: "budget", memoryGb: 16, storageGb: 500 },
  { id: "balanced", label: "균형 있게", description: "대부분의 일반 작업", recommended: true, priority: "balanced", memoryGb: 32, storageGb: 1000 },
  { id: "heavy", label: "무겁게", description: "큰 규모 · 장시간 작업", priority: "performance", memoryGb: 64, storageGb: 2000 }
];

export function initialOnboardingState(): OnboardingState {
  return {
    step: "intent",
    games: [],
    works: [],
    resolution: "4k",
    refreshRate: 144,
    gpuVendorPreference: "nvidia",
    graphicsPreset: "high",
    rayTracing: false,
    upscaling: "quality",
    memoryGb: 16,
    storageGb: 1000,
    specTier: "high",
    specIncludeGpu: true,
    budgetWon: 2_000_000
  };
}

export function onboardingStateToJson(state: OnboardingState): string {
  return JSON.stringify(state);
}

const STEPS: readonly OnboardingStep[] = ["intent", "mode", "upgrade", "usecase", "games", "performance", "graphics", "works", "intensity", "spec", "budget", "summary"];
const INTENTS: readonly OnboardingIntent[] = ["new", "upgrade", "later"];
const MODES: readonly OnboardingMode[] = ["budget", "target_fps", "task", "spec"];
const USECASES: readonly OnboardingUsecase[] = ["gaming", "work"];
const GAME_IDS: readonly OnboardingGame[] = ONBOARDING_GAMES.map((game) => game.id);
const WORK_IDS: readonly OnboardingWork[] = ONBOARDING_WORKS.map((work) => work.id);
const INTENSITY_IDS: readonly OnboardingIntensity[] = ["light", "balanced", "heavy"];
const SPEC_TIERS: readonly OnboardingSpecTier[] = ["entry", "high", "top"];
const RESOLUTIONS: readonly GamingResolution[] = ["1080p", "1440p", "4k"];
const REFRESH_RATES: readonly GamingRefreshRate[] = [60, 144, 240];
const GRAPHICS_PRESETS: readonly GamingGraphicsPreset[] = ["competitive", "balanced", "high"];
const UPSCALING_OPTIONS: readonly GamingUpscaling[] = ["native", "quality", "balanced"];
const MEMORY_OPTIONS = [16, 32, 64, 128] as const;
const STORAGE_OPTIONS = [500, 1000, 2000, 4000] as const;

export function onboardingStateFromJson(raw: string | null | undefined): OnboardingState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<OnboardingState>;
    if (!candidate.step || !STEPS.includes(candidate.step)) return null;
    const base = initialOnboardingState();
    return {
      step: candidate.step,
      intent: candidate.intent && INTENTS.includes(candidate.intent) ? candidate.intent : undefined,
      mode: candidate.mode && MODES.includes(candidate.mode) ? candidate.mode : undefined,
      usecase: candidate.usecase && USECASES.includes(candidate.usecase) ? candidate.usecase : undefined,
      games: Array.isArray(candidate.games) ? candidate.games.filter((game): game is OnboardingGame => GAME_IDS.includes(game as OnboardingGame)).slice(0, MAX_ONBOARDING_GAMES) : base.games,
      works: Array.isArray(candidate.works) ? candidate.works.filter((work): work is OnboardingWork => WORK_IDS.includes(work as OnboardingWork)) : base.works,
      intensity: candidate.intensity && INTENSITY_IDS.includes(candidate.intensity) ? candidate.intensity : undefined,
      resolution: candidate.resolution && RESOLUTIONS.includes(candidate.resolution) ? candidate.resolution : base.resolution,
      refreshRate: candidate.refreshRate && REFRESH_RATES.includes(candidate.refreshRate) ? candidate.refreshRate : base.refreshRate,
      targetFps: validTargetFps(candidate.targetFps) ? candidate.targetFps : undefined,
      gamingMode: candidate.gamingMode === "budget" || candidate.gamingMode === "target_fps" ? candidate.gamingMode : undefined,
      gpuVendorPreference: candidate.gpuVendorPreference === "amd" ? "amd" : "nvidia",
      graphicsPreset: candidate.graphicsPreset && GRAPHICS_PRESETS.includes(candidate.graphicsPreset) ? candidate.graphicsPreset : base.graphicsPreset,
      rayTracing: typeof candidate.rayTracing === "boolean" ? candidate.rayTracing : base.rayTracing,
      upscaling: candidate.upscaling && UPSCALING_OPTIONS.includes(candidate.upscaling) ? candidate.upscaling : base.upscaling,
      memoryExplicit: candidate.memoryExplicit === true ? true : undefined,
      storageExplicit: candidate.storageExplicit === true ? true : undefined,
      memoryGb: MEMORY_OPTIONS.includes(candidate.memoryGb as (typeof MEMORY_OPTIONS)[number]) ? Number(candidate.memoryGb) : base.memoryGb,
      storageGb: STORAGE_OPTIONS.includes(candidate.storageGb as (typeof STORAGE_OPTIONS)[number]) ? Number(candidate.storageGb) : base.storageGb,
      specTier: candidate.specTier && SPEC_TIERS.includes(candidate.specTier) ? candidate.specTier : base.specTier,
      specIncludeGpu: typeof candidate.specIncludeGpu === "boolean" ? candidate.specIncludeGpu : base.specIncludeGpu,
      // Saved drafts without a purchase condition used the generator's retail-only
      // default. Keep that condition when resuming or editing the draft.
      listingPolicy: candidate.listingPolicy === "include_bulk" || candidate.listingPolicy === "all" ? candidate.listingPolicy : "retail_only",
      budgetWon: Number.isInteger(candidate.budgetWon) && Number(candidate.budgetWon) > 0 ? clampBudget(Number(candidate.budgetWon)) : base.budgetWon
    };
  } catch {
    return null;
  }
}

// 자동 구성 프리셋을 온보딩 마법사로 가져올 때의 초기 상태.
// 마법사가 표현하지 못하는 조건(우선순위·HDD)은 주입하지 않고,
// 요약 화면에서 예산·성능 조건을 다시 고를 수 있게 summary 단계로 연다.
const PRESET_WORK_FALLBACK: Record<"office" | "development" | "creator", OnboardingWork> = {
  office: "office",
  development: "dev",
  creator: "video"
};

export function onboardingStateForGeneratorPreset(config: GeneratorPresetConfig): OnboardingState {
  const base = { ...initialOnboardingState(), listingPolicy: config.listingPolicy };
  const budgetWon = clampBudget(config.budgetWon);
  if (config.profile === "gaming") {
    const games = (config.gamingGameIds ?? [])
      .filter((id): id is OnboardingGame => GAME_IDS.includes(id as OnboardingGame))
      .slice(0, MAX_ONBOARDING_GAMES);
    return {
      ...base,
      step: "summary",
      intent: "new",
      mode: config.gamingMode === "budget" ? "budget" : "target_fps",
      gamingMode: config.gamingMode ?? "target_fps",
      targetFps: config.gamingTargetFps,
      gpuVendorPreference: config.gpuVendorPreference === "amd" ? "amd" : "nvidia",
      usecase: "gaming",
      games,
      resolution: config.gamingResolution,
      refreshRate: config.gamingRefreshRate,
      graphicsPreset: config.gamingGraphicsPreset ?? base.graphicsPreset,
      rayTracing: config.gamingRayTracing ?? false,
      upscaling: config.gamingUpscaling ?? base.upscaling,
      memoryGb: config.memoryCapacityGb,
      storageGb: config.storageCapacityGb,
      memoryExplicit: true,
      storageExplicit: true,
      budgetWon
    };
  }
  if (config.profile === "general") {
    return {
      ...base,
      step: "summary",
      intent: "new",
      mode: "spec",
      specTier: config.performanceTier ?? base.specTier,
      specIncludeGpu: config.includeGpu,
      memoryGb: config.memoryCapacityGb,
      storageGb: config.storageCapacityGb,
      budgetWon
    };
  }
  return {
    ...base,
    step: "summary",
    intent: "new",
    mode: "task",
    usecase: "work",
    works: [PRESET_WORK_FALLBACK[config.profile]],
    intensity: config.memoryCapacityGb >= 64 ? "heavy" : config.memoryCapacityGb <= 16 ? "light" : "balanced",
    memoryGb: config.memoryCapacityGb,
    storageGb: config.storageCapacityGb,
    budgetWon
  };
}

export function primaryWorkFor(works: readonly OnboardingWork[]): OnboardingWorkOption | undefined {
  return ONBOARDING_WORKS.filter((option) => works.includes(option.id)).sort((a, b) => b.rank - a.rank)[0];
}

export function gameOptionFor(id: OnboardingGame): OnboardingGameOption {
  return ONBOARDING_GAMES.find((game) => game.id === id) ?? ONBOARDING_GAMES[0];
}

export function intensityOptionFor(id: OnboardingIntensity | undefined): OnboardingIntensityOption {
  return ONBOARDING_INTENSITIES.find((option) => option.id === id) ?? ONBOARDING_INTENSITIES[1];
}

export function canAdvance(state: OnboardingState): boolean {
  switch (state.step) {
    case "intent": return state.intent !== undefined;
    case "mode": return state.mode !== undefined;
    case "usecase": return state.usecase !== undefined;
    case "games": return state.games.length > 0;
    case "works": return state.works.length > 0;
    case "intensity": return state.intensity !== undefined;
    case "performance": return validTargetFps(targetFpsFor(state));
    case "upgrade":
    case "graphics":
    case "spec":
    case "budget":
    case "summary": return true;
  }
}

export interface OnboardingFlowOptions { gamingTestbedPhase1?: boolean }

export function advanceOnboarding(state: OnboardingState, options: OnboardingFlowOptions = {}): OnboardingState {
  switch (state.step) {
    case "intent":
      if (state.intent === "new") return { ...state, step: "mode" };
      if (state.intent === "upgrade") return { ...state, step: "upgrade" };
      return state;
    case "mode":
      if (state.mode === "target_fps") return { ...state, gamingMode: "target_fps", usecase: "gaming", step: "games" };
      if (state.mode === "task") return { ...state, usecase: undefined, step: "usecase" };
      if (state.mode === "spec") return { ...state, usecase: undefined, step: "spec" };
      return {
        ...state,
        ...(options.gamingTestbedPhase1 ? { usecase: "gaming" as const } : {}),
        // The new budget-game route allows domestic new bulk listings. Explicit
        // purchase conditions, imported presets and restored drafts stay intact.
        ...(state.intent === "new" && (state.usecase === "gaming" || options.gamingTestbedPhase1) && state.listingPolicy === undefined ? { listingPolicy: "include_bulk" as const } : {}),
        step: "budget"
      };
    case "usecase":
      return { ...state, step: state.usecase === "work" ? "works" : options.gamingTestbedPhase1 ? "budget" : "games" };
    case "games": return { ...state, step: "performance" };
    case "works": return { ...state, step: "intensity" };
    case "performance": return { ...state, step: "graphics" };
    case "graphics": return { ...state, step: "budget" };
    case "intensity": return { ...state, step: "budget" };
    case "spec": return { ...state, step: "budget" };
    case "budget": return { ...state, step: "summary" };
    case "upgrade":
    case "summary": return state;
  }
}

export function backOnboarding(state: OnboardingState, options: OnboardingFlowOptions = {}): OnboardingState {
  switch (state.step) {
    case "mode": return { ...state, step: "intent" };
    case "upgrade": return { ...state, step: "intent" };
    case "usecase": return { ...state, step: "mode" };
    case "spec": return { ...state, step: "mode" };
    case "games": return { ...state, step: state.mode === "target_fps" ? "mode" : "usecase" };
    case "works": return { ...state, step: "usecase" };
    case "performance": return { ...state, step: "games" };
    case "graphics": return { ...state, step: "performance" };
    case "intensity": return { ...state, step: "works" };
    case "budget":
      if (state.mode === "budget") return { ...state, step: "mode" };
      if (state.usecase === "gaming") return { ...state, step: options.gamingTestbedPhase1 ? "usecase" : "graphics" };
      if (state.usecase === "work") return { ...state, step: "intensity" };
      if (state.mode === "spec") return { ...state, step: "spec" };
      return { ...state, step: "mode" };
    case "summary": return { ...state, step: "budget" };
    case "intent": return state;
  }
}

export interface OnboardingStepIndicator {
  eyebrow: string;
  index: number;
  total: number;
}

const STEP_LABELS: Record<OnboardingStep, string> = {
  intent: "시작 선택",
  mode: "견적 기준",
  upgrade: "업그레이드 안내",
  usecase: "용도 선택",
  games: "게임 선택",
  performance: "목표 성능",
  graphics: "그래픽 옵션",
  works: "작업 선택",
  intensity: "작업 강도",
  spec: "성능 입력",
  budget: "예산 선택",
  summary: "견적 확인"
};

export function stepLabelFor(step: OnboardingStep): string {
  return STEP_LABELS[step];
}

const DIRECT_GAMING_FLOW_STEPS: readonly OnboardingStep[] = ["intent", "mode", "games", "performance", "graphics", "budget", "summary"];
const GAMING_FLOW_STEPS: readonly OnboardingStep[] = ["intent", "mode", "usecase", "games", "performance", "graphics", "budget", "summary"];
const GAMING_BUDGET_FLOW_STEPS: readonly OnboardingStep[] = ["intent", "mode", "usecase", "budget", "summary"];
const WORK_FLOW_STEPS: readonly OnboardingStep[] = ["intent", "mode", "usecase", "works", "intensity", "budget", "summary"];
const SPEC_FLOW_STEPS: readonly OnboardingStep[] = ["intent", "mode", "spec", "budget", "summary"];
const BUDGET_FLOW_STEPS: readonly OnboardingStep[] = ["intent", "mode", "budget", "summary"];
const UPGRADE_FLOW_STEPS: readonly OnboardingStep[] = ["intent", "upgrade"];

function flowStepsFor(state: OnboardingState, options: OnboardingFlowOptions = {}): readonly OnboardingStep[] {
  if (state.step === "upgrade" || state.intent === "upgrade") return UPGRADE_FLOW_STEPS;
  if (state.mode === "budget") return BUDGET_FLOW_STEPS;
  if (state.mode === "target_fps") return DIRECT_GAMING_FLOW_STEPS;
  if (state.usecase === "gaming" || ["usecase", "games", "performance", "graphics"].includes(state.step)) return options.gamingTestbedPhase1 ? GAMING_BUDGET_FLOW_STEPS : GAMING_FLOW_STEPS;
  if (state.usecase === "work" || ["works", "intensity"].includes(state.step)) return WORK_FLOW_STEPS;
  if (state.mode === "spec" || state.step === "spec") return SPEC_FLOW_STEPS;
  return BUDGET_FLOW_STEPS;
}

export function stepIndicatorFor(state: OnboardingState, options: OnboardingFlowOptions = {}): OnboardingStepIndicator {
  const eyebrow = state.step === "intent" ? "START HERE"
    : state.step === "mode" ? "NEW QUOTE"
      : state.step === "upgrade" ? "UPGRADE"
        : state.step === "usecase" ? "USE CASE"
          : state.step === "games" || state.step === "performance" || state.step === "graphics" ? state.step === "games" ? "GAMING" : state.step === "performance" ? "PERFORMANCE" : "GRAPHICS OPTIONS"
            : state.step === "works" ? "WORK"
              : state.step === "intensity" ? primaryWorkFor(state.works)?.eyebrow ?? "WORK"
                : state.step === "spec" ? "PERFORMANCE"
                  : state.step === "budget" ? "BUDGET"
                    : "READY";
  const steps = flowStepsFor(state, options);
  const stepIndex = steps.indexOf(state.step);
  return { eyebrow, index: stepIndex >= 0 ? stepIndex + 1 : 1, total: steps.length };
}

export function validTargetFps(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 30 && value <= 500;
}

export function targetFpsFor(state: OnboardingState): number { return state.targetFps ?? state.refreshRate; }

export function gamingModeFor(state: OnboardingState, options: OnboardingFlowOptions = {}): GamingMode {
  return options.gamingTestbedPhase1 || state.mode === "budget" ? "budget" : state.gamingMode ?? "target_fps";
}

export interface BudgetEstimate {
  performance: string;
  gpu: string;
  memory: string;
  storage: string;
}

const GAMING_BUDGET_TIERS: readonly { minWon: number; estimate: BudgetEstimate }[] = [
  { minWon: 3_800_000, estimate: { performance: "4K · 144Hz 주사율 목표", gpu: "최상급 GPU", memory: "64GB", storage: "2TB SSD" } },
  { minWon: 3_000_000, estimate: { performance: "QHD · 240Hz 주사율 목표", gpu: "최상급 GPU", memory: "32GB", storage: "2TB SSD" } },
  { minWon: 2_000_000, estimate: { performance: "QHD · 144Hz 주사율 목표", gpu: "상급 GPU", memory: "32GB", storage: "1TB SSD" } },
  { minWon: 1_100_000, estimate: { performance: "FHD · 144Hz 주사율 목표", gpu: "표준 GPU", memory: "32GB", storage: "1TB SSD" } },
  { minWon: 0, estimate: { performance: "FHD · 60Hz 주사율 목표", gpu: "입문 GPU", memory: "16GB", storage: "500GB SSD" } }
];

const WORK_BUDGET_TIERS: readonly { minWon: number; estimate: BudgetEstimate }[] = [
  { minWon: 3_000_000, estimate: { performance: "전문가 작업", gpu: "최상급 GPU", memory: "128GB", storage: "4TB SSD" } },
  { minWon: 2_000_000, estimate: { performance: "무거운 작업", gpu: "상급 GPU", memory: "64GB", storage: "2TB SSD" } },
  { minWon: 1_000_000, estimate: { performance: "균형 작업", gpu: "중급 GPU", memory: "32GB", storage: "1TB SSD" } },
  { minWon: 0, estimate: { performance: "가벼운 작업", gpu: "내장 그래픽", memory: "16GB", storage: "500GB SSD" } }
];

const GENERAL_BUDGET_TIERS: readonly { minWon: number; estimate: BudgetEstimate }[] = [
  { minWon: 3_000_000, estimate: { performance: "상급 일반 구성", gpu: "상급 GPU", memory: "64GB", storage: "2TB SSD" } },
  { minWon: 2_000_000, estimate: { performance: "균형형 일반 구성", gpu: "상급 GPU", memory: "32GB", storage: "1TB SSD" } },
  { minWon: 1_200_000, estimate: { performance: "기본형 일반 구성", gpu: "입문 GPU", memory: "32GB", storage: "1TB SSD" } },
  { minWon: 0, estimate: { performance: "실속형 일반 구성", gpu: "내장 그래픽 또는 입문 GPU", memory: "16GB", storage: "500GB SSD" } }
];

const WORK_ESTIMATES: Record<OnboardingWork, Record<OnboardingIntensity, BudgetEstimate>> = {
  video: {
    light: { performance: "FHD·가벼운 컷 편집", gpu: "입문 GPU", memory: "16GB", storage: "500GB SSD" },
    balanced: { performance: "4K 편집·일반 효과", gpu: "중급 GPU", memory: "32GB", storage: "1TB SSD" },
    heavy: { performance: "4K·6K 편집·고급 효과", gpu: "상급 GPU", memory: "64GB", storage: "2TB SSD" }
  },
  threed: {
    light: { performance: "기본 모델링·소형 씬", gpu: "입문 GPU", memory: "32GB", storage: "1TB SSD" },
    balanced: { performance: "중형 씬·일반 렌더링", gpu: "상급 GPU", memory: "64GB", storage: "2TB SSD" },
    heavy: { performance: "대형 씬·반복 렌더링", gpu: "최상급 GPU", memory: "128GB", storage: "4TB SSD" }
  },
  dev: {
    light: { performance: "일반 프로젝트·단일 빌드", gpu: "내장 그래픽", memory: "16GB", storage: "500GB SSD" },
    balanced: { performance: "중형 프로젝트·병렬 빌드", gpu: "내장 그래픽", memory: "32GB", storage: "1TB SSD" },
    heavy: { performance: "대형 프로젝트·VM·병렬 빌드", gpu: "상급 GPU", memory: "64GB", storage: "2TB SSD" }
  },
  streaming: {
    light: { performance: "1080p 단일 송출", gpu: "표준 GPU", memory: "32GB", storage: "1TB SSD" },
    balanced: { performance: "1440p 송출·게임 동시 실행", gpu: "상급 GPU", memory: "32GB", storage: "2TB SSD" },
    heavy: { performance: "4K·다중 송출·녹화", gpu: "최상급 GPU", memory: "64GB", storage: "2TB SSD" }
  },
  ai: {
    light: { performance: "소형 모델 로컬 추론", gpu: "입문 GPU", memory: "32GB", storage: "1TB SSD" },
    balanced: { performance: "중형 모델 추론·개발", gpu: "상급 GPU", memory: "64GB", storage: "2TB SSD" },
    heavy: { performance: "로컬 학습·대형 모델", gpu: "최상급 GPU", memory: "128GB", storage: "4TB SSD" }
  },
  audio: {
    light: { performance: "소규모 트랙·기본 플러그인", gpu: "내장 그래픽", memory: "16GB", storage: "500GB SSD" },
    balanced: { performance: "중형 프로젝트·가상악기", gpu: "내장 그래픽", memory: "32GB", storage: "1TB SSD" },
    heavy: { performance: "대형 세션·다중 가상악기", gpu: "내장 그래픽", memory: "64GB", storage: "2TB SSD" }
  },
  office: {
    light: { performance: "문서·웹·화상회의", gpu: "내장 그래픽", memory: "16GB", storage: "500GB SSD" },
    balanced: { performance: "대용량 문서·멀티태스킹", gpu: "내장 그래픽", memory: "32GB", storage: "1TB SSD" },
    heavy: { performance: "다중 모니터·대용량 업무", gpu: "입문 GPU", memory: "64GB", storage: "2TB SSD" }
  }
};

export function budgetEstimateFor(budgetWon: number, usecase: OnboardingUsecase | undefined): BudgetEstimate {
  const tiers = usecase === "gaming" ? GAMING_BUDGET_TIERS : usecase === "work" ? WORK_BUDGET_TIERS : GENERAL_BUDGET_TIERS;
  return tiers.find((tier) => budgetWon >= tier.minWon)?.estimate ?? tiers[tiers.length - 1].estimate;
}

function generalBudgetPerformanceTierFor(budgetWon: number): RecommendationPerformanceTier | undefined {
  // At 2M and above the budget estimate promises an upper-tier GPU. Carry that
  // existing expectation into candidate ranking so the budget cap alone cannot
  // turn a balanced/upper general build into an old entry-level GPU draft.
  return budgetWon >= 2_000_000 ? "high" : undefined;
}

export function budgetEstimateForSelectedTarget(state: OnboardingState): BudgetEstimate {
  const estimate = budgetEstimateFor(state.budgetWon, state.usecase);
  if (state.usecase !== "gaming") return estimate;
  return {
    ...estimate,
    performance: `${resolutionLabelFor(state.resolution)} · 목표 ${targetFpsFor(state)} FPS`,
    gpu: "FPS 테스트와 비교해 선택",
    memory: state.memoryExplicit ? `${state.memoryGb}GB 이상` : "16GB부터 · 구성에 맞춰 조정",
    storage: state.storageExplicit ? `${state.storageGb >= 1000 ? `${state.storageGb / 1000}TB` : `${state.storageGb}GB`} SSD` : "1TB SSD"
  };
}

export function workEstimateFor(works: readonly OnboardingWork[], intensity: OnboardingIntensity | undefined): BudgetEstimate {
  const primary = primaryWorkFor(works)?.id ?? "office";
  return WORK_ESTIMATES[primary][intensity ?? "balanced"];
}

function capacityGbFromEstimateLabel(label: string): number {
  const match = label.match(/(\d+(?:\.\d+)?)\s*(TB|GB)/i);
  if (!match) return 32;
  const value = Number(match[1]);
  return match[2].toUpperCase() === "TB" ? value * 1000 : value;
}

const BASE_REQUIRED_BUDGET_WON: Record<GamingResolution, Record<GamingRefreshRate, number>> = {
  "1080p": { 60: 800_000, 144: 1_400_000, 240: 2_000_000 },
  "1440p": { 60: 1_400_000, 144: 2_000_000, 240: 2_800_000 },
  "4k": { 60: 2_600_000, 144: 3_500_000, 240: 4_500_000 }
};

export interface RequiredBudgetRange {
  minWon: number;
  maxWon: number;
}

export interface GamingBudgetOptions {
  graphicsPreset?: GamingGraphicsPreset;
  rayTracing?: boolean;
  upscaling?: GamingUpscaling;
}

function roundTo100k(won: number): number {
  return Math.round(won / 100_000) * 100_000;
}

// 카탈로그에서 실제로 만들 수 있는 최저 호환 구성이 참고 하한보다 비싸면
// 하한을 실측 최저가로 올린다 — 부품 풀로 만들 수 없는 목표를 "예산 여유"로
// 안내하면 온보딩에서 낮춘 예산이 자동 구성에서 반드시 실패한다.
function floorBoundedBudgetRange(range: RequiredBudgetRange, floorWon: number | undefined): RequiredBudgetRange {
  if (floorWon === undefined || !Number.isFinite(floorWon)) return range;
  const floorMinWon = Math.ceil(floorWon / BUDGET_STEP_WON) * BUDGET_STEP_WON;
  if (floorMinWon <= range.minWon) return range;
  return {
    minWon: floorMinWon,
    maxWon: Math.max(range.maxWon, Math.ceil(floorMinWon * 1.1 / BUDGET_STEP_WON) * BUDGET_STEP_WON)
  };
}

export function requiredGamingBudgetFor(resolution: GamingResolution, refreshRate: number, games: readonly OnboardingGame[], options: GamingBudgetOptions = {}, floorWon?: number): RequiredBudgetRange {
  const tuning = gamingAdvisoryTuningFor(resolution, { gameIds: games, ...options });
  const rates = BASE_REQUIRED_BUDGET_WON[resolution];
  const base = refreshRate <= 60 ? rates[60] * refreshRate / 60
    : refreshRate <= 144 ? rates[60] + (rates[144] - rates[60]) * (refreshRate - 60) / 84
      : rates[144] + (rates[240] - rates[144]) * (refreshRate - 144) / 96;
  const required = roundTo100k(base * tuning.demandMultiplier);
  return floorBoundedBudgetRange({ minWon: roundTo100k(required * 0.92), maxWon: roundTo100k(required * 1.08) }, floorWon);
}

export function gamingTargetShortfall(state: OnboardingState, floors?: RecommendationFloorWon, requestFloorWon?: number): RequiredBudgetRange | null {
  if (state.usecase !== "gaming") return null;
  const required = requiredGamingBudgetFor(state.resolution, targetFpsFor(state), state.games, {
    graphicsPreset: state.graphicsPreset,
    rayTracing: state.rayTracing,
    upscaling: state.upscaling
  }, requestFloorWon ?? floors?.gaming?.[state.resolution] ?? floors?.discreteGpu);
  return state.budgetWon < required.minWon ? required : null;
}

const WORK_REQUIRED_BUDGET_WON: Record<OnboardingWork, Record<OnboardingIntensity, number>> = {
  video: { light: 1_000_000, balanced: 1_700_000, heavy: 2_600_000 },
  threed: { light: 1_200_000, balanced: 2_000_000, heavy: 3_200_000 },
  dev: { light: 900_000, balanced: 1_400_000, heavy: 2_100_000 },
  streaming: { light: 1_200_000, balanced: 1_800_000, heavy: 2_600_000 },
  ai: { light: 1_500_000, balanced: 2_500_000, heavy: 4_000_000 },
  audio: { light: 1_000_000, balanced: 1_500_000, heavy: 2_200_000 },
  office: { light: 800_000, balanced: 1_000_000, heavy: 1_400_000 }
};

export function requiredSpecBudgetFor(specTier: OnboardingSpecTier, includeGpu: boolean, memoryGb: number, storageGb: number, floorWon?: number): RequiredBudgetRange {
  const tierBase = { entry: 900_000, high: 1_600_000, top: 2_700_000 }[specTier];
  const gpuCost = includeGpu ? 600_000 : 0;
  const memoryCost = memoryGb >= 128 ? 800_000 : memoryGb >= 64 ? 300_000 : 0;
  const storageCost = storageGb >= 4000 ? 500_000 : storageGb >= 2000 ? 200_000 : 0;
  const base = tierBase + gpuCost + memoryCost + storageCost;
  return floorBoundedBudgetRange({ minWon: roundTo100k(base * 0.9), maxWon: roundTo100k(base * 1.15) }, floorWon);
}

export function requiredWorkBudgetFor(works: readonly OnboardingWork[], intensity: OnboardingIntensity | undefined, floorWon?: number): RequiredBudgetRange {
  const primary = primaryWorkFor(works)?.id ?? "office";
  const base = WORK_REQUIRED_BUDGET_WON[primary][intensity ?? "balanced"];
  return floorBoundedBudgetRange({ minWon: roundTo100k(base * 0.9), maxWon: roundTo100k(base * 1.15) }, floorWon);
}

export function targetBudgetRangeFor(state: OnboardingState, floors?: RecommendationFloorWon, requestFloorWon?: number): RequiredBudgetRange | null {
  if (state.usecase === "gaming") {
    if (gamingModeFor(state) === "budget") return null;
    return requiredGamingBudgetFor(state.resolution, targetFpsFor(state), state.games, {
      graphicsPreset: state.graphicsPreset,
      rayTracing: state.rayTracing,
      upscaling: state.upscaling
    }, requestFloorWon ?? floors?.gaming?.[state.resolution] ?? floors?.discreteGpu);
  }
  if (state.usecase === "work") {
    const floorWon = requestFloorWon ?? (workEstimateFor(state.works, state.intensity).gpu === "내장 그래픽" ? floors?.integrated : floors?.discreteGpu);
    return requiredWorkBudgetFor(state.works, state.intensity, floorWon);
  }
  if (state.mode === "spec") return requiredSpecBudgetFor(state.specTier, state.specIncludeGpu, state.memoryGb, state.storageGb, requestFloorWon ?? (state.specIncludeGpu ? floors?.discreteGpu : floors?.integrated));
  return null;
}

export function resolutionLabelFor(resolution: GamingResolution): string {
  return resolution === "1080p" ? "FHD" : resolution === "1440p" ? "QHD" : "4K";
}

export function formatManWon(won: number): string {
  return `${Math.round(won / 10_000).toLocaleString("ko-KR")}만원`;
}

export function clampBudget(won: number): number {
  return Math.min(BUDGET_MAX_WON, Math.max(BUDGET_MIN_WON, roundTo100k(won)));
}

export interface RecommendParams {
  profile: RecommendationProfile;
  priority: RecommendationPriority;
  performanceTier?: RecommendationPerformanceTier;
  workType?: OnboardingWork;
  workIntensity?: OnboardingIntensity;
  budgetWon: number;
  includeGpu: boolean;
  gamingMode?: GamingMode;
  gamingTargetFps?: number;
  gpuVendorPreference?: GpuVendorPreference;
  gamingResolution?: GamingResolution;
  gamingRefreshRate?: GamingRefreshRate;
  gamingGameIds?: string[];
  gamingGraphicsPreset?: GamingGraphicsPreset;
  gamingRayTracing?: boolean;
  gamingUpscaling?: GamingUpscaling;
  memoryCapacityGb: number;
  storageCapacityGb: number;
}

export function listingPolicyFor(state: OnboardingState): ListingPolicy {
  return state.listingPolicy ?? "retail_only";
}

export function purchaseConditionSummaryFor(state: OnboardingState): string {
  const policy = listingPolicyFor(state);
  if (policy === "include_bulk") return "국내 신품 · 벌크 포함";
  if (policy === "all") return "전체 유통 조건";
  return "신품 · 정식 유통";
}

export function recommendParamsFor(state: OnboardingState, options: OnboardingFlowOptions = {}): RecommendParams {
  if (state.usecase === "gaming") {
    const mode = gamingModeFor(state, options);
    if (mode === "budget") return { profile: "gaming", gamingMode: "budget", gpuVendorPreference: state.gpuVendorPreference, priority: "performance", budgetWon: state.budgetWon, includeGpu: true, memoryCapacityGb: state.memoryExplicit ? state.memoryGb : 16, storageCapacityGb: state.storageExplicit ? state.storageGb : 1000 };
    // Game budgets start with 16GB; CPU/GPU performance and platform compatibility
    // determine necessary upgrades instead of a budget tier forcing larger memory.
    return {
      profile: "gaming",
      gamingMode: "target_fps",
      gamingTargetFps: targetFpsFor(state),
      gpuVendorPreference: state.gpuVendorPreference,
      priority: "performance",
      budgetWon: state.budgetWon,
      includeGpu: true,
      gamingResolution: state.resolution,
      gamingRefreshRate: state.refreshRate,
      gamingGameIds: state.games,
      gamingGraphicsPreset: state.graphicsPreset,
      gamingRayTracing: state.rayTracing,
      gamingUpscaling: state.upscaling,
      memoryCapacityGb: state.memoryExplicit ? state.memoryGb : 16,
      storageCapacityGb: state.storageExplicit ? state.storageGb : 1000
    };
  }
  if (state.usecase === "work") {
    const work = primaryWorkFor(state.works) ?? ONBOARDING_WORKS.find((option) => option.id === "office") ?? ONBOARDING_WORKS[0];
    const intensity = intensityOptionFor(state.intensity);
    const estimate = workEstimateFor(state.works, intensity.id);
    return {
      profile: work.profile,
      priority: intensity.priority,
      workType: work.id,
      workIntensity: intensity.id,
      budgetWon: state.budgetWon,
      includeGpu: estimate.gpu !== "내장 그래픽",
      memoryCapacityGb: capacityGbFromEstimateLabel(estimate.memory),
      storageCapacityGb: capacityGbFromEstimateLabel(estimate.storage)
    };
  }
  if (state.mode === "spec") {
    return {
      profile: "general",
      priority: state.specTier === "entry" ? "budget" : "performance",
      performanceTier: state.specTier,
      budgetWon: state.budgetWon,
      includeGpu: state.specIncludeGpu,
      memoryCapacityGb: state.memoryGb,
      storageCapacityGb: state.storageGb
    };
  }
  const budgetEstimate = budgetEstimateFor(state.budgetWon, undefined);
  return {
    profile: "general",
    priority: "balanced",
    performanceTier: generalBudgetPerformanceTierFor(state.budgetWon),
    budgetWon: state.budgetWon,
    includeGpu: budgetEstimate.gpu.includes("GPU"),
    memoryCapacityGb: capacityGbFromEstimateLabel(budgetEstimate.memory),
    storageCapacityGb: capacityGbFromEstimateLabel(budgetEstimate.storage)
  };
}

// 온보딩이 실제로 보낼 자동 구성 요청 — 최저 구성가 조회가 안내 수치가 아니라
// 이 요청의 풀·게이트 그대로를 기준으로 해야 한다.
export function recommendGenerationRequestFor(state: OnboardingState, options: OnboardingFlowOptions = {}): BuildGenerationRequest {
  const params = recommendParamsFor(state, options);
  const listingPolicy = listingPolicyFor(state);
  return {
    profile: params.profile,
    listingPolicy,
    includeNonRetail: listingPolicy !== "retail_only",
    ...(params.profile === "gaming" ? { gamingTestbedPhase1: true, gamingMode: params.gamingMode, gamingTargetFps: params.gamingTargetFps, gpuVendorPreference: params.gpuVendorPreference } : {}),
    priority: params.priority,
    performanceTier: params.performanceTier,
    budgetWon: params.budgetWon,
    includeGpu: params.includeGpu,
    gamingResolution: params.gamingResolution,
    gamingRefreshRate: params.gamingRefreshRate,
    gamingGameIds: params.gamingGameIds,
    gamingGraphicsPreset: params.gamingGraphicsPreset,
    gamingRayTracing: params.gamingRayTracing,
    gamingUpscaling: params.gamingUpscaling,
    memoryCapacityGb: params.memoryCapacityGb,
    storageCapacityGb: params.storageCapacityGb
  };
}

export function recommendQueryFor(state: OnboardingState, options: OnboardingFlowOptions = {}): string {
  const params = recommendParamsFor(state, options);
  const search = new URLSearchParams();
  search.set("profile", params.profile);
  search.set("listingPolicy", listingPolicyFor(state));
  if (params.priority !== "balanced") search.set("priority", params.priority);
  if (params.profile === "gaming") {
    search.set("gamingMode", params.gamingMode ?? "budget");
    search.set("gpuVendor", params.gpuVendorPreference ?? "nvidia");
    if (params.gamingTargetFps) search.set("targetFps", String(params.gamingTargetFps));
    // Keep the selected target explicit even when it matches the generator default.
    // The onboarding flow is a requirement handoff, so a shared URL must not rely on
    // a later generator default to reconstruct the selected refresh-rate target or graphics rule.
    if (params.gamingResolution) search.set("resolution", params.gamingResolution);
    if (params.gamingRefreshRate) search.set("refresh", String(params.gamingRefreshRate));
    if (params.gamingGameIds && params.gamingGameIds.length > 0) search.set("games", params.gamingGameIds.join(","));
    if (params.gamingGraphicsPreset) search.set("graphics", params.gamingGraphicsPreset);
    if (params.gamingRayTracing) search.set("rt", "1");
    if (params.gamingUpscaling) search.set("upscaling", params.gamingUpscaling);
  }
  if (params.profile === "general" && params.performanceTier) search.set("tier", params.performanceTier);
  if (params.workType && params.workIntensity) {
    search.set("work", params.workType);
    search.set("intensity", params.workIntensity);
  }
  search.set("ram", String(params.memoryCapacityGb));
  if (params.budgetWon !== 1_500_000) search.set("budget", String(params.budgetWon));
  if (!params.includeGpu) search.set("gpu", "0");
  if (params.storageCapacityGb !== 1000) search.set("ssd", String(params.storageCapacityGb));
  search.set("autorun", "1");
  return search.toString();
}

export function gamesSummaryFor(games: readonly OnboardingGame[]): string {
  if (games.length === 0) return "선택한 게임 없음";
  if (games.length === 1) return gameOptionFor(games[0]).label;
  return `${gameOptionFor(games[0]).label} 외 ${games.length - 1}개`;
}

export function gameLabelFor(id: string): string {
  return ONBOARDING_GAMES.find((game) => game.id === id)?.label ?? id;
}

export function gameLabelsFor(ids: readonly string[]): string[] {
  return ids.map(gameLabelFor);
}

export function targetSummaryFor(state: OnboardingState): string {
  if (state.usecase === "gaming" && gamingModeFor(state) === "budget") return "예산 안에서 GPU 성능 우선";
  if (state.usecase === "gaming") return `${gamesSummaryFor(state.games)} · ${resolutionLabelFor(state.resolution)} · 목표 ${targetFpsFor(state)} FPS · ${GAMING_GRAPHICS_PRESET_LABELS[state.graphicsPreset]} · ${GAMING_UPSCALING_LABELS[state.upscaling]}${state.rayTracing ? " · 레이 트레이싱" : ""}`;
  if (state.usecase === "work") {
    const work = primaryWorkFor(state.works);
    const intensity = intensityOptionFor(state.intensity);
    return `${work?.label ?? "작업"} · ${intensity.label}`;
  }
  if (state.mode === "spec") return `${SPEC_TIER_LABELS[state.specTier]} · ${state.memoryGb}GB · ${state.storageGb >= 1000 ? `${state.storageGb / 1000}TB` : `${state.storageGb}GB`} · ${state.specIncludeGpu ? "외장 GPU 포함" : "내장 그래픽"}`;
  return "예산 기준";
}
