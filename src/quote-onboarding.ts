import { GAMING_GRAPHICS_PRESET_LABELS, GAMING_UPSCALING_LABELS, RECOMMENDATION_PERFORMANCE_TIER_LABELS } from "../shared/types";
import type { GamingGraphicsPreset, GamingRefreshRate, GamingResolution, GamingUpscaling, RecommendationPerformanceTier, RecommendationPriority, RecommendationProfile } from "../shared/types";
import { GAMING_GAME_CATEGORY_LABELS, GAMING_GAMES, gamingAdvisoryTuningFor } from "../shared/gaming-catalog";
import type { GamingGameCategory, GamingGameId, GamingGameOption } from "../shared/gaming-catalog";

export type OnboardingStep = "intent" | "mode" | "upgrade" | "usecase" | "games" | "performance" | "graphics" | "works" | "intensity" | "spec" | "budget" | "summary";
export type OnboardingIntent = "new" | "upgrade" | "later";
export type OnboardingMode = "budget" | "task" | "spec";
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
  graphicsPreset: GamingGraphicsPreset;
  rayTracing: boolean;
  upscaling: GamingUpscaling;
  memoryGb: number;
  storageGb: number;
  specTier: OnboardingSpecTier;
  specIncludeGpu: boolean;
  budgetWon: number;
}

export const ONBOARDING_STORAGE_KEY = "pc-supporter-quote-onboarding";

export const BUDGET_STOPS_WON = [1_500_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000, 6_000_000] as const;
export const BUDGET_MIN_WON = 800_000;
export const BUDGET_MAX_WON = 8_000_000;
export const BUDGET_STEP_WON = 100_000;
export const MAX_ONBOARDING_GAMES = 5;

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
  gpuFor: Record<OnboardingIntensity, boolean>;
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
    rank: 2,
    gpuFor: { light: true, balanced: true, heavy: true }
  },
  {
    id: "threed",
    label: "3D 모델링·렌더링",
    description: "모델링·씬 구성·반복 렌더링",
    eyebrow: "3D WORK",
    intensityQuestion: "3D 작업은 어느 정도 규모인가요?",
    intensitySummary: "모델링 규모와 렌더링 빈도에 따라 필요한 사양이 달라져요.",
    profile: "creator",
    rank: 3,
    gpuFor: { light: true, balanced: true, heavy: true }
  },
  {
    id: "dev",
    label: "개발·빌드",
    description: "IDE·빌드·컨테이너·가상 머신",
    eyebrow: "DEVELOPMENT",
    intensityQuestion: "개발 프로젝트 규모는 어느 정도인가요?",
    intensitySummary: "프로젝트 규모와 동시에 진행하는 작업에 따라 필요한 사양이 달라져요.",
    profile: "development",
    rank: 1,
    gpuFor: { light: false, balanced: false, heavy: true }
  },
  {
    id: "streaming",
    label: "방송·스트리밍",
    description: "송출·녹화와 게임 동시 실행",
    eyebrow: "STREAMING",
    intensityQuestion: "방송·스트리밍은 어느 정도 규모인가요?",
    intensitySummary: "송출 해상도와 게임 동시 실행 여부에 따라 필요한 사양이 달라져요.",
    profile: "creator",
    rank: 2,
    gpuFor: { light: true, balanced: true, heavy: true }
  },
  {
    id: "ai",
    label: "AI·머신러닝",
    description: "로컬 추론·모델 개발·학습",
    eyebrow: "AI / MACHINE LEARNING",
    intensityQuestion: "AI·머신러닝 작업은 어느 정도 규모인가요?",
    intensitySummary: "모델 크기와 추론·학습 여부에 따라 필요한 메모리와 그래픽 성능이 달라져요.",
    profile: "development",
    rank: 4,
    gpuFor: { light: true, balanced: true, heavy: true }
  },
  {
    id: "audio",
    label: "음악·오디오",
    description: "트랙·플러그인·가상악기 작업",
    eyebrow: "AUDIO WORK",
    intensityQuestion: "음악·오디오 작업은 어느 정도 규모인가요?",
    intensitySummary: "트랙 수와 플러그인·가상악기 사용량에 따라 필요한 사양이 달라져요.",
    profile: "creator",
    rank: 1,
    gpuFor: { light: false, balanced: false, heavy: false }
  },
  {
    id: "office",
    label: "사무·문서",
    description: "문서·웹·화상회의·멀티태스킹",
    eyebrow: "OFFICE",
    intensityQuestion: "사무·문서 작업은 어느 정도인가요?",
    intensitySummary: "함께 사용하는 프로그램 수와 문서 규모에 따라 필요한 사양이 달라져요.",
    profile: "office",
    rank: 0,
    gpuFor: { light: false, balanced: false, heavy: false }
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
    graphicsPreset: "high",
    rayTracing: false,
    upscaling: "quality",
    memoryGb: 32,
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
const MODES: readonly OnboardingMode[] = ["budget", "task", "spec"];
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
      graphicsPreset: candidate.graphicsPreset && GRAPHICS_PRESETS.includes(candidate.graphicsPreset) ? candidate.graphicsPreset : base.graphicsPreset,
      rayTracing: typeof candidate.rayTracing === "boolean" ? candidate.rayTracing : base.rayTracing,
      upscaling: candidate.upscaling && UPSCALING_OPTIONS.includes(candidate.upscaling) ? candidate.upscaling : base.upscaling,
      memoryGb: MEMORY_OPTIONS.includes(candidate.memoryGb as (typeof MEMORY_OPTIONS)[number]) ? Number(candidate.memoryGb) : base.memoryGb,
      storageGb: STORAGE_OPTIONS.includes(candidate.storageGb as (typeof STORAGE_OPTIONS)[number]) ? Number(candidate.storageGb) : base.storageGb,
      specTier: candidate.specTier && SPEC_TIERS.includes(candidate.specTier) ? candidate.specTier : base.specTier,
      specIncludeGpu: typeof candidate.specIncludeGpu === "boolean" ? candidate.specIncludeGpu : base.specIncludeGpu,
      budgetWon: Number.isInteger(candidate.budgetWon) && Number(candidate.budgetWon) > 0 ? clampBudget(Number(candidate.budgetWon)) : base.budgetWon
    };
  } catch {
    return null;
  }
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
    case "upgrade":
    case "performance":
    case "graphics":
    case "spec":
    case "budget":
    case "summary": return true;
  }
}

export function advanceOnboarding(state: OnboardingState): OnboardingState {
  switch (state.step) {
    case "intent":
      if (state.intent === "new") return { ...state, step: "mode" };
      if (state.intent === "upgrade") return { ...state, step: "upgrade" };
      return state;
    case "mode":
      if (state.mode === "task") return { ...state, step: "usecase" };
      if (state.mode === "spec") return { ...state, step: "spec" };
      return { ...state, step: "budget" };
    case "usecase":
      return { ...state, step: state.usecase === "work" ? "works" : "games" };
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

export function backOnboarding(state: OnboardingState): OnboardingState {
  switch (state.step) {
    case "mode": return { ...state, step: "intent" };
    case "upgrade": return { ...state, step: "intent" };
    case "usecase": return { ...state, step: "mode" };
    case "spec": return { ...state, step: "mode" };
    case "games": return { ...state, step: "usecase" };
    case "works": return { ...state, step: "usecase" };
    case "performance": return { ...state, step: "games" };
    case "graphics": return { ...state, step: "performance" };
    case "intensity": return { ...state, step: "works" };
    case "budget":
      if (state.usecase === "gaming") return { ...state, step: "graphics" };
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

const GAMING_FLOW_STEPS: readonly OnboardingStep[] = ["intent", "mode", "usecase", "games", "performance", "graphics", "budget", "summary"];
const WORK_FLOW_STEPS: readonly OnboardingStep[] = ["intent", "mode", "usecase", "works", "intensity", "budget", "summary"];
const SPEC_FLOW_STEPS: readonly OnboardingStep[] = ["intent", "mode", "spec", "budget", "summary"];
const BUDGET_FLOW_STEPS: readonly OnboardingStep[] = ["intent", "mode", "budget", "summary"];
const UPGRADE_FLOW_STEPS: readonly OnboardingStep[] = ["intent", "upgrade"];

function flowStepsFor(state: OnboardingState): readonly OnboardingStep[] {
  if (state.step === "upgrade" || state.intent === "upgrade") return UPGRADE_FLOW_STEPS;
  if (state.usecase === "gaming" || ["usecase", "games", "performance", "graphics"].includes(state.step)) return GAMING_FLOW_STEPS;
  if (state.usecase === "work" || ["works", "intensity"].includes(state.step)) return WORK_FLOW_STEPS;
  if (state.mode === "spec" || state.step === "spec") return SPEC_FLOW_STEPS;
  return BUDGET_FLOW_STEPS;
}

export function stepIndicatorFor(state: OnboardingState): OnboardingStepIndicator {
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
  const steps = flowStepsFor(state);
  const stepIndex = steps.indexOf(state.step);
  return { eyebrow, index: stepIndex >= 0 ? stepIndex + 1 : 1, total: steps.length };
}

export interface BudgetEstimate {
  performance: string;
  gpu: string;
  memory: string;
  storage: string;
}

const GAMING_BUDGET_TIERS: readonly { minWon: number; estimate: BudgetEstimate }[] = [
  { minWon: 3_800_000, estimate: { performance: "4K · 144 FPS", gpu: "최상급 GPU", memory: "64GB", storage: "2TB SSD" } },
  { minWon: 3_000_000, estimate: { performance: "QHD · 240 FPS", gpu: "최상급 GPU", memory: "32GB", storage: "2TB SSD" } },
  { minWon: 2_000_000, estimate: { performance: "QHD · 144 FPS", gpu: "상급 GPU", memory: "32GB", storage: "1TB SSD" } },
  { minWon: 1_100_000, estimate: { performance: "FHD · 144 FPS", gpu: "표준 GPU", memory: "32GB", storage: "1TB SSD" } },
  { minWon: 0, estimate: { performance: "FHD · 60 FPS", gpu: "입문 GPU", memory: "16GB", storage: "500GB SSD" } }
];

const WORK_BUDGET_TIERS: readonly { minWon: number; estimate: BudgetEstimate }[] = [
  { minWon: 3_000_000, estimate: { performance: "전문가 작업", gpu: "최상급 GPU", memory: "128GB", storage: "4TB SSD" } },
  { minWon: 2_000_000, estimate: { performance: "무거운 작업", gpu: "상급 GPU", memory: "64GB", storage: "2TB SSD" } },
  { minWon: 1_000_000, estimate: { performance: "균형 작업", gpu: "중급 GPU", memory: "32GB", storage: "1TB SSD" } },
  { minWon: 0, estimate: { performance: "가벼운 작업", gpu: "내장 그래픽", memory: "16GB", storage: "500GB SSD" } }
];

const GENERAL_BUDGET_TIERS: readonly { minWon: number; estimate: BudgetEstimate }[] = [
  { minWon: 3_000_000, estimate: { performance: "상급 일반 구성", gpu: "상급 GPU", memory: "64GB", storage: "2TB SSD" } },
  { minWon: 2_000_000, estimate: { performance: "균형형 일반 구성", gpu: "표준 GPU", memory: "32GB", storage: "1TB SSD" } },
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

export function requiredGamingBudgetFor(resolution: GamingResolution, refreshRate: GamingRefreshRate, games: readonly OnboardingGame[], options: GamingBudgetOptions = {}): RequiredBudgetRange {
  const tuning = gamingAdvisoryTuningFor(resolution, { gameIds: games, ...options });
  const required = roundTo100k(BASE_REQUIRED_BUDGET_WON[resolution][refreshRate] * tuning.demandMultiplier);
  return { minWon: roundTo100k(required * 0.92), maxWon: roundTo100k(required * 1.08) };
}

export function gamingTargetShortfall(state: OnboardingState): RequiredBudgetRange | null {
  if (state.usecase !== "gaming") return null;
  const required = requiredGamingBudgetFor(state.resolution, state.refreshRate, state.games, {
    graphicsPreset: state.graphicsPreset,
    rayTracing: state.rayTracing,
    upscaling: state.upscaling
  });
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

export function requiredSpecBudgetFor(specTier: OnboardingSpecTier, includeGpu: boolean, memoryGb: number, storageGb: number): RequiredBudgetRange {
  const tierBase = { entry: 900_000, high: 1_600_000, top: 2_700_000 }[specTier];
  const gpuCost = includeGpu ? 600_000 : 0;
  const memoryCost = memoryGb >= 128 ? 800_000 : memoryGb >= 64 ? 300_000 : 0;
  const storageCost = storageGb >= 4000 ? 500_000 : storageGb >= 2000 ? 200_000 : 0;
  const base = tierBase + gpuCost + memoryCost + storageCost;
  return { minWon: roundTo100k(base * 0.9), maxWon: roundTo100k(base * 1.15) };
}

export function requiredWorkBudgetFor(works: readonly OnboardingWork[], intensity: OnboardingIntensity | undefined): RequiredBudgetRange {
  const primary = primaryWorkFor(works)?.id ?? "office";
  const base = WORK_REQUIRED_BUDGET_WON[primary][intensity ?? "balanced"];
  return { minWon: roundTo100k(base * 0.9), maxWon: roundTo100k(base * 1.15) };
}

export function targetBudgetRangeFor(state: OnboardingState): RequiredBudgetRange | null {
  if (state.usecase === "gaming") {
    return requiredGamingBudgetFor(state.resolution, state.refreshRate, state.games, {
      graphicsPreset: state.graphicsPreset,
      rayTracing: state.rayTracing,
      upscaling: state.upscaling
    });
  }
  if (state.usecase === "work") return requiredWorkBudgetFor(state.works, state.intensity);
  if (state.mode === "spec") return requiredSpecBudgetFor(state.specTier, state.specIncludeGpu, state.memoryGb, state.storageGb);
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
  gamingResolution?: GamingResolution;
  gamingRefreshRate?: GamingRefreshRate;
  gamingGameIds?: string[];
  gamingGraphicsPreset?: GamingGraphicsPreset;
  gamingRayTracing?: boolean;
  gamingUpscaling?: GamingUpscaling;
  memoryCapacityGb: number;
  storageCapacityGb: number;
}

export function recommendParamsFor(state: OnboardingState): RecommendParams {
  if (state.usecase === "gaming") {
    return {
      profile: "gaming",
      priority: "performance",
      budgetWon: state.budgetWon,
      includeGpu: true,
      gamingResolution: state.resolution,
      gamingRefreshRate: state.refreshRate,
      gamingGameIds: state.games,
      gamingGraphicsPreset: state.graphicsPreset,
      gamingRayTracing: state.rayTracing,
      gamingUpscaling: state.upscaling,
      // 64GB는 3.8M 최상위 게이밍 티어에서만 나온다 — 표시 라벨을 역산하지 않고 티어 경계를 직접 둔다.
      memoryCapacityGb: state.budgetWon >= 3_800_000 ? 64 : 32,
      storageCapacityGb: state.budgetWon >= 3_000_000 ? 2000 : 1000
    };
  }
  if (state.usecase === "work") {
    const work = primaryWorkFor(state.works) ?? ONBOARDING_WORKS.find((option) => option.id === "office") ?? ONBOARDING_WORKS[0];
    const intensity = intensityOptionFor(state.intensity);
    return {
      profile: work.profile,
      priority: intensity.priority,
      workType: work.id,
      workIntensity: intensity.id,
      budgetWon: state.budgetWon,
      includeGpu: work.gpuFor[intensity.id],
      memoryCapacityGb: intensity.memoryGb,
      storageCapacityGb: intensity.storageGb
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
    budgetWon: state.budgetWon,
    includeGpu: budgetEstimate.gpu.includes("GPU"),
    memoryCapacityGb: capacityGbFromEstimateLabel(budgetEstimate.memory),
    storageCapacityGb: capacityGbFromEstimateLabel(budgetEstimate.storage)
  };
}

export function recommendQueryFor(state: OnboardingState): string {
  const params = recommendParamsFor(state);
  const search = new URLSearchParams();
  search.set("profile", params.profile);
  if (params.priority !== "balanced") search.set("priority", params.priority);
  if (params.profile === "gaming") {
    // Keep the selected target explicit even when it matches the generator default.
    // The onboarding flow is a requirement handoff, so a shared URL must not rely on
    // a later generator default to reconstruct 144 FPS or the selected graphics rule.
    if (params.gamingResolution) search.set("resolution", params.gamingResolution);
    if (params.gamingRefreshRate) search.set("refresh", String(params.gamingRefreshRate));
    if (params.gamingGameIds && params.gamingGameIds.length > 0) search.set("games", params.gamingGameIds.join(","));
    if (params.gamingGraphicsPreset) search.set("graphics", params.gamingGraphicsPreset);
    if (params.gamingRayTracing) search.set("rt", "1");
    if (params.gamingUpscaling) search.set("upscaling", params.gamingUpscaling);
  }
  if (params.profile === "general" && state.mode === "spec" && params.performanceTier) search.set("tier", params.performanceTier);
  if (params.workType && params.workIntensity) {
    search.set("work", params.workType);
    search.set("intensity", params.workIntensity);
  }
  if (params.memoryCapacityGb !== 32) search.set("ram", String(params.memoryCapacityGb));
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
  if (state.usecase === "gaming") return `${gamesSummaryFor(state.games)} · ${resolutionLabelFor(state.resolution)} · ${state.refreshRate} FPS · ${GAMING_GRAPHICS_PRESET_LABELS[state.graphicsPreset]} · ${GAMING_UPSCALING_LABELS[state.upscaling]}${state.rayTracing ? " · 레이 트레이싱" : ""}`;
  if (state.usecase === "work") {
    const work = primaryWorkFor(state.works);
    const intensity = intensityOptionFor(state.intensity);
    return `${work?.label ?? "작업"} · ${intensity.label}`;
  }
  if (state.mode === "spec") return `${SPEC_TIER_LABELS[state.specTier]} · ${state.memoryGb}GB · ${state.storageGb >= 1000 ? `${state.storageGb / 1000}TB` : `${state.storageGb}GB`} · ${state.specIncludeGpu ? "외장 GPU 포함" : "내장 그래픽"}`;
  return "예산 기준";
}
