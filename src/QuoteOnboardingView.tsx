import { safeSessionStorage } from "./safe-storage";
import { useEffect, useRef, useState } from "react";
import { trackUsageEvent } from "./usage-events";
import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import { FiActivity, FiAlertTriangle, FiArrowLeft, FiArrowRight, FiBox, FiBriefcase, FiCheck, FiClock, FiCode, FiDatabase, FiFileText, FiFilm, FiInfo, FiMinus, FiMonitor, FiMusic, FiPlay, FiPlus, FiRadio, FiSearch, FiSliders, FiTarget, FiZap } from "react-icons/fi";
import "./quote-onboarding.css";
import { GpuVendorToggle } from "./GpuVendorToggle";
import { api } from "./api";
import { GAMING_GRAPHICS_PRESET_LABELS, GAMING_UPSCALING_LABELS } from "../shared/types";
import type { GamingGraphicsPreset, GamingRefreshRate, GamingResolution, GamingUpscaling, RecommendationFloorWon } from "../shared/types";
import {
  BUDGET_MAX_WON,
  CURRENT_FPS_REFERENCE_GUIDANCE,
  BUDGET_STEP_WON,
  BUDGET_STOPS_WON,
  MAX_ONBOARDING_GAMES,
  ONBOARDING_GAMES,
  ONBOARDING_GAME_CATEGORIES,
  ONBOARDING_GAME_CATEGORY_LABELS,
  ONBOARDING_INTENSITIES,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_WORKS,
  advanceOnboarding,
  backOnboarding,
  budgetEstimateForSelectedTarget,
  canAdvance,
  clampBudget,
  formatManWon,
  gameLabelFor,
  gamesSummaryFor,
  gamingModeFor,
  targetFpsFor,
  initialOnboardingState,
  intensityOptionFor,
  onboardingStateFromJson,
  onboardingStateToJson,
  primaryWorkFor,
  purchaseConditionSummaryFor,
  recommendGenerationRequestFor,
  recommendQueryFor,
  resolutionLabelFor,
  SPEC_TIER_LABELS,
  targetBudgetRangeFor,
  stepIndicatorFor,
  stepLabelFor,
  targetSummaryFor,
  workEstimateFor
} from "./quote-onboarding";
import type { OnboardingGame, OnboardingGameCategory, OnboardingIntensity, OnboardingSpecTier, OnboardingState, OnboardingStep, OnboardingWork, RequiredBudgetRange } from "./quote-onboarding";

type IntentId = "new" | "upgrade" | "later";
type ModeId = "budget" | "target_fps" | "task" | "spec";
type UsecaseId = "gaming" | "work";

const INTENT_OPTIONS: { id: IntentId; title: string; description: string; Icon: IconType }[] = [
  { id: "new", title: "새 PC 견적 보기", description: "게임과 작업, 예산에 맞춰 부품을 골라요.", Icon: FiFileText },
  { id: "upgrade", title: "쓰던 PC 업그레이드하기", description: "현재 부품의 호환을 확인하고 교체할 부품을 비교해요.", Icon: FiMonitor },
  { id: "later", title: "나중에 하기", description: "홈으로 돌아가 언제든 다시 시작할 수 있어요.", Icon: FiClock }
];

const MODE_OPTIONS: { id: ModeId; title: string; description: string; Icon: IconType }[] = [
  { id: "budget", title: "예산에 맞는 게임 견적", description: "80만원부터 1,000만원까지 GPU 성능을 우선해 골라요.", Icon: FiDatabase },
  { id: "target_fps", title: "게임과 목표 FPS로 고르기", description: "게임·해상도·목표 프레임에 맞춰 필요한 성능을 비교해요.", Icon: FiTarget },
  { id: "task", title: "용도를 기준으로 고르기", description: "게임과 작업에 맞는 PC를 골라요.", Icon: FiPlay },
  { id: "spec", title: "원하는 사양 직접 입력하기", description: "성능 등급과 그래픽·메모리·저장공간을 정해요.", Icon: FiMonitor }
];

const USECASE_OPTIONS: { id: UsecaseId; title: string; description: string; Icon: IconType }[] = [
  { id: "gaming", title: "게임", description: "주로 할 게임과 원하는 프레임을 정해요.", Icon: FiPlay },
  { id: "work", title: "작업", description: "영상 편집·3D·개발 등 주된 작업을 골라요.", Icon: FiMonitor }
];

const WORK_ICONS: Record<OnboardingWork, IconType> = {
  video: FiFilm,
  threed: FiBox,
  dev: FiCode,
  streaming: FiRadio,
  ai: FiActivity,
  audio: FiMusic,
  office: FiBriefcase
};

const INTENSITY_ICONS: Record<OnboardingIntensity, IconType> = {
  light: FiFileText,
  balanced: FiSliders,
  heavy: FiFilm
};

const RESOLUTION_OPTIONS: { id: GamingResolution; label: string }[] = [
  { id: "1080p", label: "FHD" },
  { id: "1440p", label: "QHD" },
  { id: "4k", label: "4K" }
];

const REFRESH_OPTIONS: { id: GamingRefreshRate; label: string }[] = [
  { id: 60, label: "60 FPS" },
  { id: 144, label: "144 FPS" },
  { id: 240, label: "240 FPS" }
];

const MEMORY_OPTIONS = [16, 32, 64, 128] as const;
const STORAGE_OPTIONS = [500, 1000, 2000, 4000] as const;
const SPEC_TIER_OPTIONS: { id: OnboardingSpecTier; label: string }[] = [
  { id: "entry", label: "기본" },
  { id: "high", label: "상급" },
  { id: "top", label: "최상급" }
];

const GAMING_GRAPHICS_GUIDANCE: Record<GamingGraphicsPreset, string> = {
  competitive: "그래픽 효과를 낮춰 FPS를 높이는 설정이에요.",
  balanced: "화질과 프레임을 함께 고려하는 설정이에요.",
  high: "그래픽 효과를 높여요. 더 빠른 그래픽카드가 필요할 수 있어요."
};

const GAMING_UPSCALING_GUIDANCE: Record<GamingUpscaling, string> = {
  native: "선택한 해상도 그대로 그려요. 업스케일링을 쓰지 않아요.",
  quality: "낮은 해상도로 그린 뒤 확대해요. 화질을 최대한 유지하면서 FPS를 높여요.",
  balanced: "품질 설정보다 FPS를 높이지만, 화질은 더 낮아질 수 있어요."
};

function storageLabel(gb: number) {
  return gb >= 1000 ? `${gb / 1000}TB` : `${gb}GB`;
}

function budgetRangeStatusFor(range: RequiredBudgetRange, budgetWon: number): "below" | "within" | "above" {
  if (budgetWon < range.minWon) return "below";
  if (budgetWon > range.maxWon) return "above";
  return "within";
}

function budgetRangeStatusLabel(status: "below" | "within" | "above", gaming = false) {
  if (gaming) return status === "below" ? "예상 가격보다 낮아요" : status === "above" ? "예상 가격보다 높아요" : "예상 가격대 안";
  return status === "below" ? "예산이 부족해요" : status === "above" ? "예산에 여유가 있어요" : "가격대에 들어요";
}

function BudgetRangeCard({ range, budgetWon, compact = false, gaming = false, floorWon, suggestedBudgetWon, floorChecked, floorFailed, onAdjust, onEditTarget }: { range: RequiredBudgetRange; budgetWon: number; compact?: boolean; gaming?: boolean; floorWon?: number; suggestedBudgetWon?: number; floorChecked?: boolean; floorFailed?: boolean; onAdjust?: (budgetWon: number) => void; onEditTarget?: () => void }) {
  const status = budgetRangeStatusFor(range, budgetWon);
  // 카탈로그 실측 최저가가 잡힌 경우 그 요청과 같은 부품 기준을 표시한다 —
  // 추천 예산이 다시 실패로 돌아가는 루프를 막으려면 제안값도 같은 실측 기준이어야 한다.
  const floorBelowBudget = floorWon !== undefined && floorWon > budgetWon;
  const adjustment = status === "below" || floorBelowBudget
    ? (suggestedBudgetWon !== undefined && suggestedBudgetWon <= BUDGET_MAX_WON
        ? { label: `${formatManWon(suggestedBudgetWon)}으로 예산 올리기`, budgetWon: suggestedBudgetWon }
        : floorBelowBudget
          ? null
          : { label: `${formatManWon(range.minWon)}으로 예산 올리기`, budgetWon: range.minWon })
    : status === "above"
      ? { label: `${formatManWon(range.maxWon)}으로 예산 낮추기`, budgetWon: range.maxWon }
      : null;
  return (
    <section className={`onboarding-budget-range ${compact ? "compact" : ""} status-${status}`} aria-label="예상 가격대">
      <div className="onboarding-budget-range-top">
        <div>
          <span>{gaming ? "이 게임 설정의 예상 가격대" : "PC 가격대"}</span>
          <strong>{formatManWon(range.minWon)} ~ {formatManWon(range.maxWon)}</strong>
        </div>
        <em>{budgetRangeStatusLabel(status, gaming)}</em>
      </div>
      <p>{gaming ? "게임과 옵션으로 계산한 예상 금액이에요. 견적이 나오면 FPS 테스트의 설정과 사용 부품을 함께 확인해 주세요." : status === "below" ? "지금 예산으로는 선택한 성능이 어려울 수 있어요. 예산을 올리거나 성능을 낮춰보세요." : status === "above" ? "선택한 성능에 비해 예산이 넉넉해요." : "설정한 예산이 가격대에 들어요."}</p>
      {floorWon !== undefined && <p className="onboarding-note">{gaming ? "테스트에 쓴 CPU·GPU로 맞춘 견적은" : "현재 판매 부품으로 맞춘 가장 저렴한 견적은"} 약 {formatManWon(floorWon)}이에요.{floorBelowBudget && suggestedBudgetWon === undefined ? floorWon > BUDGET_MAX_WON ? " 예산 상한을 넘어요. 목표 FPS나 옵션을 낮춰보세요." : " 현재 예산보다 비싸요. 예산이나 원하는 성능을 바꿔보세요." : ""}{gaming ? " RAM과 테스트 환경이 달라, 이 PC에서도 같은 FPS가 나오는지는 확인되지 않았어요." : " 재고는 구매 전에 확인해 주세요."}</p>}
      {gaming && floorChecked && floorWon === undefined && <p className="onboarding-note">같은 게임·옵션의 FPS 테스트로 비교할 수 있는 견적 가격은 아직 없어요.</p>}
      {gaming && floorFailed && <p className="onboarding-note">부품 가격을 불러오지 못했어요. 견적을 만든 뒤 가격과 FPS 테스트 결과를 확인해 주세요.</p>}
      {(onAdjust && adjustment || onEditTarget && (status === "below" || gaming)) && <div className="onboarding-budget-range-actions">
        {onAdjust && adjustment && <button type="button" className="onboarding-budget-range-action" data-testid="onboarding-budget-range-adjust" onClick={() => onAdjust(clampBudget(adjustment.budgetWon))}>{adjustment.label}</button>}
        {onEditTarget && (status === "below" || gaming) && <button type="button" className="onboarding-budget-range-edit" data-testid="onboarding-budget-range-edit-target" onClick={onEditTarget}>목표 성능 다시 고르기</button>}
      </div>}
    </section>
  );
}

function GamingTargetSummary({ state, showBudgetHint = false, floors, requestFloorWon }: { state: OnboardingState; showBudgetHint?: boolean; floors?: RecommendationFloorWon; requestFloorWon?: number }) {
  const range = showBudgetHint ? targetBudgetRangeFor(state, floors, requestFloorWon) : null;
  return (
    <section className="onboarding-target-contract" aria-label="선택한 게임 설정">
      <div className="onboarding-target-contract-heading"><div><span>목표 프레임</span><strong>{targetFpsFor(state)} FPS</strong></div><FiTarget aria-hidden="true" /></div>
      <div className="onboarding-target-contract-tags"><span>{resolutionLabelFor(state.resolution)}</span><span>{GAMING_GRAPHICS_PRESET_LABELS[state.graphicsPreset]}</span><span>{GAMING_UPSCALING_LABELS[state.upscaling]}</span>{state.rayTracing && <span>레이 트레이싱</span>}</div>
      {range && <>
        <div className="onboarding-target-contract-budget"><span>예상 가격대</span><strong>{formatManWon(range.minWon)} ~ {formatManWon(range.maxWon)}</strong></div>
        <p className="onboarding-note">예상 금액이에요. 실제 FPS는 견적이 나온 뒤 테스트에 쓴 부품과 옵션을 함께 확인해 주세요.</p>
      </>}
    </section>
  );
}

function readStoredOnboarding(): { state: OnboardingState; hasDraft: boolean } {
  try {
    const stored = onboardingStateFromJson(safeSessionStorage.getItem(ONBOARDING_STORAGE_KEY));
    return { state: stored ?? initialOnboardingState(), hasDraft: Boolean(stored && stored.step !== "intent") };
  } catch {
    return { state: initialOnboardingState(), hasDraft: false };
  }
}

// /start?preset — 자동 구성 프리셋이 온보딩 상태로 주입된 진입은
// "작성 중인 견적" 확인 화면을 건너뛰고 주입된 단계에서 바로 시작한다.
function onboardingSkipsResume() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("preset");
}

function OptionRow({ title, description, Icon, selected, recommended, checkStyle, onClick }: { title: string; description?: string; Icon?: IconType; selected: boolean; recommended?: boolean; checkStyle?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`onboarding-option${selected ? " selected" : ""}`} onClick={onClick} aria-pressed={selected}>
      {Icon && <span className="onboarding-option-icon" aria-hidden="true"><Icon /></span>}
      <span className="onboarding-option-copy">
        <strong>{title}{recommended && <em className="onboarding-recommend">추천</em>}</strong>
        {description && <small>{description}</small>}
      </span>
      {checkStyle
        ? <span className={`onboarding-check${selected ? " on" : ""}`} aria-hidden="true">{selected && <FiCheck />}</span>
        : <FiArrowRight className="onboarding-option-arrow" aria-hidden="true" />}
    </button>
  );
}

function RadioOptionRow({ name, value, title, description, Icon, selected, recommended, checkStyle, onChange }: { name: string; value: string; title: string; description?: string; Icon?: IconType; selected: boolean; recommended?: boolean; checkStyle?: boolean; onChange: () => void }) {
  return (
    <label className={`onboarding-option onboarding-option-radio-row${selected ? " selected" : ""}`}>
      <input className="onboarding-radio-input onboarding-option-radio" type="radio" name={name} value={value} checked={selected} onChange={onChange} onClick={() => { if (selected) onChange(); }} />
      {Icon && <span className="onboarding-option-icon" aria-hidden="true"><Icon /></span>}
      <span className="onboarding-option-copy">
        <strong>{title}{recommended && <em className="onboarding-recommend">추천</em>}</strong>
        {description && <small>{description}</small>}
      </span>
      {checkStyle
        ? <span className={`onboarding-check${selected ? " on" : ""}`} aria-hidden="true">{selected && <FiCheck />}</span>
        : <FiArrowRight className="onboarding-option-arrow" aria-hidden="true" />}
    </label>
  );
}

function ChipRow({ name, label, options, value, onChange }: { name: string; label: string; options: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  const labelId = `${name}-label`;
  return (
    <div className="onboarding-chip-group">
      <span className="onboarding-chip-label" id={labelId}>{label}</span>
      <div className="onboarding-chip-row" role="radiogroup" aria-labelledby={labelId}>
        {options.map((option) => (
          <label key={option.id} className={`onboarding-chip onboarding-chip-radio-row${value === option.id ? " selected" : ""}`}>
            <input className="onboarding-radio-input onboarding-chip-radio" type="radio" name={name} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} onClick={() => { if (value === option.id) onChange(option.id); }} />
            <span className={`onboarding-check${value === option.id ? " on" : ""}`} aria-hidden="true">{value === option.id && <FiCheck />}</span>
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function QuoteOnboardingView({ onFinish, onUpgrade, onSkip, onHome, floors }: { onFinish: (query: string) => void; onUpgrade: () => void; onSkip: () => void; onHome: () => void; floors?: RecommendationFloorWon }) {
  const flowOptions = {};
  const [storedOnboarding] = useState(readStoredOnboarding);
  const [state, setState] = useState<OnboardingState>(() => {
    const stored = storedOnboarding.state;
    if (stored.mode === "budget" && stored.intent !== "upgrade") return { ...stored, usecase: "gaming" };
    if (stored.usecase === "gaming" && !stored.gamingMode && stored.games.length === 0 && ["budget", "summary"].includes(stored.step)) return { ...stored, mode: "budget", gamingMode: "budget" };
    return stored;
  });
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [showResume, setShowResume] = useState(storedOnboarding.hasDraft && !onboardingSkipsResume());
  const [gameQuery, setGameQuery] = useState("");
  const [gameCategory, setGameCategory] = useState<OnboardingGameCategory | "all">("all");
  const [gameLimitReached, setGameLimitReached] = useState(false);
  // 카탈로그 실측 최저가 — 안내 범위가 실제로 만들 수 없는 예산을 약속하지 않도록
  // 지금 선택 조건의 요청 그대로 서버에 묻는다.
  const [requestFloor, setRequestFloor] = useState<{ floorWon?: number; suggestedBudgetWon?: number; checked?: boolean; failed?: boolean }>({});

  useEffect(() => {
    try {
      safeSessionStorage.setItem(ONBOARDING_STORAGE_KEY, onboardingStateToJson(state));
    } catch {
      // A full session bucket must not break the wizard.
    }
  }, [state]);

  const floorProbeRelevant = state.usecase === "gaming" || state.usecase === "work" || state.mode === "spec";
  const requestFloorApplies = floorProbeRelevant && (state.step === "budget" || state.step === "summary" || (state.usecase === "gaming" && state.step === "graphics"));
  useEffect(() => {
    if (!requestFloorApplies) { setRequestFloor({}); return; }
    let cancelled = false;
    const controller = new AbortController();
    setRequestFloor({});
    const floorForBudget = async (budgetWon: number) => {
      const response = await api<{ floorWon: number | null }>("/api/builds/recommend/floor", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify(recommendGenerationRequestFor({ ...state, budgetWon }, flowOptions))
      });
      return response.floorWon ?? undefined;
    };
    void (async () => {
      try {
        const floorWon = await floorForBudget(state.budgetWon);
        if (cancelled) return;
        let suggestedBudgetWon: number | undefined;
        if (floorWon !== undefined && floorWon > state.budgetWon) {
          // 제안 예산에서는 요청 스펙이 달라질 수 있다(예: RAM 16GB → 32GB 티어 경계).
          // 제안값이 그대로 만든 요청의 최저가를 넘는지 다시 확인해야 루프가 끊긴다.
          let candidate = Math.ceil(floorWon / BUDGET_STEP_WON) * BUDGET_STEP_WON;
          for (let attempt = 0; attempt < 3 && candidate <= BUDGET_MAX_WON && !cancelled; attempt += 1) {
            const probe = await floorForBudget(candidate);
            if (probe === undefined) break;
            if (probe <= candidate) { suggestedBudgetWon = candidate; break; }
            candidate = Math.ceil(probe / BUDGET_STEP_WON) * BUDGET_STEP_WON;
          }
        }
        if (!cancelled) setRequestFloor({ floorWon, suggestedBudgetWon, checked: true });
      } catch {
        if (!cancelled) setRequestFloor({ failed: true });
      }
    })();
    return () => { cancelled = true; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestFloorApplies, state.budgetWon, state.usecase, state.mode, JSON.stringify(state.games), state.resolution, state.refreshRate, state.targetFps, state.gamingMode, state.gpuVendorPreference, state.graphicsPreset, state.rayTracing, state.upscaling, JSON.stringify(state.works), state.intensity, state.specTier, state.specIncludeGpu, state.memoryGb, state.storageGb, state.listingPolicy]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    headingRef.current?.focus({ preventScroll: true });
  }, [state.step, showResume]);

  // 온보딩 퍼널 — 스텝 진입과 작성 재개 화면 도달을 익명 이벤트로 기록한다.
  useEffect(() => {
    if (showResume) {
      trackUsageEvent("onboarding_resume", { step: state.step });
      return;
    }
    trackUsageEvent("onboarding_step", {
      step: state.step,
      ...(state.intent ? { intent: state.intent } : {}),
      ...(state.usecase ? { usecase: state.usecase } : {}),
      ...(state.mode ? { mode: state.mode } : {})
    });
  }, [state.step, showResume]);

  const indicator = showResume ? { eyebrow: "작성 중", index: 1, total: 1 } : stepIndicatorFor(state, flowOptions);
  const update = (patch: Partial<OnboardingState>) => setState((current) => ({ ...current, ...patch }));
  // 단일 선택(라디오) 스텝은 고르는 즉시 다음으로 진행한다 — 굳이 "다음" 버튼을
  // 두 번 누르게 할 필요가 없다.
  const selectAndAdvance = (patch: Partial<OnboardingState>) => setState((current) => {
    const firstGameTarget = patch.gamingMode === "target_fps" && current.gamingMode !== "target_fps" && current.games.length === 0;
    return advanceOnboarding({ ...current, ...(firstGameTarget ? { resolution: "1440p" as const, graphicsPreset: "high" as const, rayTracing: false, upscaling: "native" as const } : {}), ...patch }, flowOptions);
  });
  const pickOnStep = (_control: string, patch: Partial<OnboardingState>) => update(patch);
  const toggleGame = (id: OnboardingGame) => {
    if (state.games.includes(id)) {
      setGameLimitReached(false);
      setState((current) => ({ ...current, games: current.games.filter((game) => game !== id) }));
      return;
    }
    if (state.games.length >= MAX_ONBOARDING_GAMES) {
      setGameLimitReached(true);
      return;
    }
    setGameLimitReached(false);
    setState((current) => ({ ...current, games: [...current.games, id] }));
  };
  const toggleWork = (id: OnboardingWork) => setState((current) => ({ ...current, works: current.works.includes(id) ? current.works.filter((work) => work !== id) : [...current.works, id] }));

  const normalizedGameQuery = gameQuery.trim().toLocaleLowerCase("ko-KR");
  const visibleGames = ONBOARDING_GAMES.filter((game) => {
    const categoryMatches = gameCategory === "all" || game.category === gameCategory;
    const searchableGameText = `${game.label} ${game.id}`.toLocaleLowerCase("ko-KR");
    const queryMatches = normalizedGameQuery.length === 0 || searchableGameText.includes(normalizedGameQuery);
    return categoryMatches && queryMatches;
  });

  function goBack() {
    if (showResume) { trackUsageEvent("onboarding_exit", { step: state.step, reason: "home" }); onHome(); return; }
    if (state.step === "intent") { trackUsageEvent("onboarding_exit", { step: "intent", reason: "home" }); onHome(); }
    else setState((current) => backOnboarding(current, flowOptions));
  }

  function goNext() {
    if (showResume) { setShowResume(false); return; }
    if (state.step === "intent" && state.intent === "later") { trackUsageEvent("onboarding_exit", { step: "intent", reason: "skip" }); onSkip(); return; }
    if (state.step === "upgrade") { trackUsageEvent("onboarding_exit", { step: "upgrade", reason: "upgrade" }); onUpgrade(); return; }
    if (state.step === "summary") {
      trackUsageEvent("onboarding_complete", { ...(state.intent ? { intent: state.intent } : {}), ...(state.usecase ? { usecase: state.usecase } : {}), ...(state.mode ? { mode: state.mode } : {}) });
      onFinish(recommendQueryFor(state, flowOptions));
      return;
    }
    setState((current) => advanceOnboarding(current, flowOptions));
  }

  function restartOnboarding() {
    setState(initialOnboardingState());
    setGameQuery("");
    setGameCategory("all");
    setGameLimitReached(false);
    setShowResume(false);
  }

  function editSummaryStep(step: OnboardingStep) {
    setState((current) => ({ ...current, step }));
  }

  const nextDisabled = showResume ? false : !canAdvance(state);
  const phase1Gaming = state.usecase === "gaming" && gamingModeFor(state) === "budget";
  const estimate = phase1Gaming
    ? { performance: "예산에 맞는 게임 구성", gpu: "GPU 성능 우선", memory: state.memoryExplicit ? `${state.memoryGb}GB 이상` : "16GB부터 · 구성에 맞춰 조정", storage: state.storageExplicit ? `${storageLabel(state.storageGb)} SSD` : "1TB SSD" }
    : state.mode === "spec"
    ? { performance: SPEC_TIER_LABELS[state.specTier], gpu: state.specIncludeGpu ? "외장 GPU" : "내장 그래픽", memory: `${state.memoryGb}GB`, storage: storageLabel(state.storageGb) }
    : state.usecase === "work"
      ? workEstimateFor(state.works, state.intensity)
    : budgetEstimateForSelectedTarget(state);
  const targetBudgetRange = phase1Gaming ? null : targetBudgetRangeFor(state, floors, requestFloor.floorWon);
  const primaryWork = primaryWorkFor(state.works);
  const estimateRows: [IconType, string, string][] = [
    [FiActivity, "목표 성능", estimate.performance],
    [FiMonitor, "그래픽", estimate.gpu],
    [FiDatabase, "메모리", estimate.memory],
    [FiZap, "저장공간", estimate.storage],
    [FiBox, "구매 조건", purchaseConditionSummaryFor(state)]
  ];

  let body: ReactNode = null;
  let ctaLabel = showResume ? "이어서 작성하기" : "다음";

  if (showResume) {
    const resumeGame = state.intent === "upgrade"
      ? "PC 업그레이드"
      : state.usecase === "gaming"
        ? phase1Gaming ? "예산에 맞는 게임용 PC" : gamesSummaryFor(state.games)
        : state.usecase === "work"
          ? `${primaryWork?.label ?? "작업"} · ${intensityOptionFor(state.intensity).label}`
          : state.mode === "spec"
            ? "직접 성능 입력"
            : "예산 기준 구성";
    const resumeTarget = state.intent === "upgrade"
      ? "현재 부품 점검"
      : state.usecase === "gaming"
        ? phase1Gaming ? "그래픽카드 성능 우선" : targetSummaryFor(state)
        : state.usecase === "work" || state.mode === "spec"
          ? targetSummaryFor(state)
          : "예산 미정";
    body = (
      <div className="onboarding-draft">
        <h3>작성 중인 견적</h3>
        <div className="onboarding-draft-rows">
          <div className="onboarding-draft-row"><span className="onboarding-estimate-icon"><FiPlay /></span><span>게임·작업</span><strong>{resumeGame}</strong></div>
          <div className="onboarding-draft-row"><span className="onboarding-estimate-icon"><FiActivity /></span><span>목표 성능</span><strong>{resumeTarget}</strong></div>
          <div className="onboarding-draft-row"><span className="onboarding-estimate-icon"><FiDatabase /></span><span>예산</span><strong>{formatManWon(state.budgetWon)}</strong></div>
          <div className="onboarding-draft-row"><span className="onboarding-estimate-icon"><FiMonitor /></span><span>현재 단계</span><strong>{stepLabelFor(state.step)}</strong></div>
        </div>
        <button type="button" className="onboarding-secondary-action" onClick={restartOnboarding}>내용을 지우고 새로 시작하기</button>
        <p className="onboarding-note">새로 시작하면 이 탭에 입력한 내용은 지워져요.</p>
      </div>
    );
  } else if (state.step === "intent") {
    ctaLabel = state.intent === "later" ? "홈으로 돌아가기" : state.intent === "upgrade" ? "다음" : "새 견적 시작하기";
    body = (
      <div className="onboarding-options" role="radiogroup" aria-labelledby="onboarding-title">
        {INTENT_OPTIONS.map((option) => (
          <RadioOptionRow key={option.id} name="onboarding-intent" value={option.id} title={option.title} description={option.description} Icon={option.Icon} selected={state.intent === option.id} onChange={() => {
            if (option.id === "later") {
              trackUsageEvent("onboarding_exit", { step: "intent", reason: "skip" });
              onSkip();
              return;
            }
            selectAndAdvance({ intent: option.id });
          }} />
        ))}
      </div>
    );
  } else if (state.step === "mode") {
    ctaLabel = "이 기준으로 계속";
    body = (
      <div className="onboarding-options" role="radiogroup" aria-labelledby="onboarding-title">
        {MODE_OPTIONS.map((option) => (
          <RadioOptionRow key={option.id} name="onboarding-mode" value={option.id} title={option.title} description={option.description} Icon={option.Icon} selected={state.mode === option.id} onChange={() => selectAndAdvance({ mode: option.id, ...(option.id === "budget" ? { usecase: "gaming", gamingMode: "budget" } : option.id === "target_fps" ? { usecase: "gaming", gamingMode: "target_fps" } : { gamingMode: undefined }) })} />
        ))}
      </div>
    );
  } else if (state.step === "upgrade") {
    ctaLabel = "현재 부품 고르기";
    body = (
      <div className="onboarding-steps-list">
        {[
          "지금 쓰는 CPU·메인보드·그래픽카드 등을 골라주세요.",
          "호환 결과에서 현재 구성의 문제를 볼 수 있어요.",
          "호환 결과에서 교체할 부품과 업그레이드 조합을 볼 수 있어요."
        ].map((line, index) => (
          <div className="onboarding-steps-item" key={line}><span className="onboarding-steps-number">{index + 1}</span><p>{line}</p></div>
        ))}
      </div>
    );
  } else if (state.step === "usecase") {
    body = (
      <div className="onboarding-options" role="radiogroup" aria-labelledby="onboarding-title">
        {USECASE_OPTIONS.map((option) => (
          <RadioOptionRow key={option.id} name="onboarding-usecase" value={option.id} title={option.title} description={option.description} Icon={option.Icon} selected={state.usecase === option.id} onChange={() => selectAndAdvance({ usecase: option.id, gamingMode: option.id === "gaming" ? "target_fps" : undefined })} />
        ))}
      </div>
    );
  } else if (state.step === "games") {
    body = (
      <>
        <p className="onboarding-note">{CURRENT_FPS_REFERENCE_GUIDANCE}</p>
        <label className="onboarding-game-search">
          <FiSearch aria-hidden="true" />
          <input type="search" value={gameQuery} onChange={(event) => setGameQuery(event.target.value)} placeholder="게임 이름 검색" aria-label="게임 이름 검색" />
        </label>
        <div className="onboarding-game-categories" role="radiogroup" aria-label="게임 카테고리">
          {[
            { id: "all", label: "전체" },
            ...ONBOARDING_GAME_CATEGORIES.map((category) => ({ id: category, label: ONBOARDING_GAME_CATEGORY_LABELS[category] }))
          ].map((category) => (
            <label className={`onboarding-game-category onboarding-game-category-radio-row${gameCategory === category.id ? " selected" : ""}`} key={category.id}>
              <input className="onboarding-radio-input onboarding-game-category-radio" type="radio" name="onboarding-game-category" value={category.id} checked={gameCategory === category.id} onChange={() => setGameCategory(category.id as OnboardingGameCategory | "all")} />
              <span>{category.label}</span>
            </label>
          ))}
        </div>
        <div className="onboarding-game-selection-summary" aria-live="polite">
          <strong>{state.games.length}개 선택</strong>
          <span>{state.games.length >= MAX_ONBOARDING_GAMES ? "선택한 모든 게임에서 목표 FPS를 비교해요." : "게임은 여러 개 선택할 수 있어요."}</span>
        </div>
        {state.games.length > 0 && <div className="onboarding-game-selected-list" aria-label="선택한 게임">
          {state.games.map((id) => <span className="onboarding-game-selected-chip" key={id}>{gameLabelFor(id)}<button type="button" onClick={() => toggleGame(id)} aria-label={`${gameLabelFor(id)} 선택 해제`}>×</button></span>)}
        </div>}
        <div className="onboarding-options">
          {visibleGames.map((game) => (
            <OptionRow key={game.id} title={game.label} selected={state.games.includes(game.id)} checkStyle onClick={() => toggleGame(game.id)} />
          ))}
        </div>
        {visibleGames.length === 0 && <p className="onboarding-game-empty"><FiSearch /> 일치하는 게임이 없어요. 다른 이름으로 검색해 보세요.</p>}
        {gameLimitReached && <p className="onboarding-warning" role="alert"><FiAlertTriangle /> 한 대의 PC로 비교할 게임은 최대 {MAX_ONBOARDING_GAMES}개까지예요. 새 게임을 고르려면 먼저 하나를 해제해 주세요.</p>}
      </>
    );
  } else if (state.step === "performance") {
    body = (
      <>
        <p className="onboarding-callout"><FiInfo /> 해상도와 목표 프레임은 견적에 반영돼요. 실제 게임 프레임은 게임 설정과 사용 환경에 따라 달라질 수 있어요.</p>
        <ChipRow name="onboarding-resolution" label="해상도" options={RESOLUTION_OPTIONS.map((option) => ({ id: option.id, label: option.label }))} value={state.resolution} onChange={(id) => pickOnStep("resolution", { resolution: id as GamingResolution })} />
        <ChipRow name="onboarding-target-fps" label="목표 프레임" options={REFRESH_OPTIONS.map((option) => ({ id: String(option.id), label: option.label }))} value={String(targetFpsFor(state))} onChange={(id) => pickOnStep("targetFps", { targetFps: Number(id), refreshRate: Number(id) as GamingRefreshRate })} />
        <label className="onboarding-target-fps-input"><span>다른 목표 FPS 직접 입력</span><input type="number" min="30" max="500" step="1" inputMode="numeric" value={state.targetFps === 0 ? "" : targetFpsFor(state)} onChange={(event) => update({ targetFps: Number(event.target.value) })} aria-describedby="onboarding-target-fps-range" /><small id="onboarding-target-fps-range">30~500 FPS 사이의 정수를 입력해 주세요.</small></label>
        <p className="onboarding-pill"><FiPlay /> {gamesSummaryFor(state.games)} · {resolutionLabelFor(state.resolution)} · 목표 {targetFpsFor(state)} FPS</p>
        <GamingTargetSummary state={state} />
      </>
    );
  } else if (state.step === "graphics") {
    ctaLabel = "다음 · 예산 정하기";
    body = (
      <>
        <p className="onboarding-pill"><FiPlay /> {gamesSummaryFor(state.games)} · {resolutionLabelFor(state.resolution)} · 목표 {targetFpsFor(state)} FPS</p>
        <ChipRow name="onboarding-graphics-preset" label="그래픽 품질" options={Object.entries(GAMING_GRAPHICS_PRESET_LABELS).map(([id, label]) => ({ id, label }))} value={state.graphicsPreset} onChange={(id) => pickOnStep("graphicsPreset", { graphicsPreset: id as GamingGraphicsPreset })} />
        <p className="onboarding-choice-note"><FiInfo /> {GAMING_GRAPHICS_GUIDANCE[state.graphicsPreset]}</p>
        <ChipRow name="onboarding-upscaling" label="업스케일링" options={Object.entries(GAMING_UPSCALING_LABELS).map(([id, label]) => ({ id, label }))} value={state.upscaling} onChange={(id) => pickOnStep("upscaling", { upscaling: id as GamingUpscaling })} />
        <p className="onboarding-choice-note"><FiInfo /> {GAMING_UPSCALING_GUIDANCE[state.upscaling]}</p>
        <OptionRow
          title="레이 트레이싱"
          description="켜면 GPU 부하가 커져요. 목표 FPS에 따라 필요한 그래픽카드가 달라질 수 있어요."
          Icon={FiZap}
          selected={state.rayTracing}
          checkStyle
          onClick={() => update({ rayTracing: !state.rayTracing })}
        />
        {state.rayTracing && <p className="onboarding-warning"><FiAlertTriangle /> 레이 트레이싱은 같은 FPS 목표에서도 더 높은 GPU 등급이 필요할 수 있어요.</p>}
        <GamingTargetSummary state={state} showBudgetHint floors={floors} requestFloorWon={requestFloor.floorWon} />

      </>
    );
  } else if (state.step === "works") {
    body = (
      <>
        <div className="onboarding-options">
          {ONBOARDING_WORKS.map((work) => (
            <OptionRow key={work.id} title={work.label} description={work.description} Icon={WORK_ICONS[work.id]} selected={state.works.includes(work.id)} checkStyle onClick={() => toggleWork(work.id)} />
          ))}
        </div>
        {state.works.length > 0 && (
          <div className="onboarding-selected-chips">
            {state.works.map((id) => (
              <span className="onboarding-selected-chip" key={id}>{ONBOARDING_WORKS.find((work) => work.id === id)?.label} 선택됨 <button type="button" onClick={() => toggleWork(id)} aria-label={`${ONBOARDING_WORKS.find((work) => work.id === id)?.label} 선택 해제`}>×</button></span>
            ))}
          </div>
        )}
      </>
    );
  } else if (state.step === "intensity") {
    ctaLabel = "다음 · 예산 정하기";
    body = (
      <>
        <div className="onboarding-options" role="radiogroup" aria-labelledby="onboarding-title">
          {ONBOARDING_INTENSITIES.map((option) => {
            const estimate = workEstimateFor(state.works, option.id);
            return <RadioOptionRow
              key={option.id}
              name="onboarding-work-intensity"
              value={option.id}
              title={option.label}
              description={`${option.description} · 예상 ${estimate.performance} · ${estimate.gpu} · ${estimate.memory} · ${estimate.storage}`}
              Icon={INTENSITY_ICONS[option.id]}
              selected={state.intensity === option.id}
              recommended={option.recommended}
              checkStyle
              onChange={() => selectAndAdvance({ intensity: option.id })}
            />;
          })}
        </div>
        {state.intensity && primaryWork && <p className="onboarding-pill"><FiSliders /> {primaryWork.label} · {intensityOptionFor(state.intensity).label}</p>}
      </>
    );
  } else if (state.step === "spec") {
    body = (
      <>
        <ChipRow name="onboarding-spec-tier" label="원하는 성능 등급" options={SPEC_TIER_OPTIONS} value={state.specTier} onChange={(id) => pickOnStep("specTier", { specTier: id as OnboardingSpecTier })} />
        <OptionRow title="외장 그래픽카드 포함" description="게임·3D·GPU 가속 작업을 함께 고려해요." Icon={FiMonitor} selected={state.specIncludeGpu} checkStyle onClick={() => update({ specIncludeGpu: !state.specIncludeGpu })} />
        <ChipRow name="onboarding-memory" label="메모리" options={MEMORY_OPTIONS.map((gb) => ({ id: String(gb), label: `${gb}GB` }))} value={String(state.memoryGb)} onChange={(id) => pickOnStep("memoryGb", { memoryGb: Number(id) })} />
        <ChipRow name="onboarding-storage" label="저장공간" options={STORAGE_OPTIONS.map((gb) => ({ id: String(gb), label: storageLabel(gb) }))} value={String(state.storageGb)} onChange={(id) => pickOnStep("storageGb", { storageGb: Number(id) })} />
        <p className="onboarding-note">선택한 성능 등급과 부품 정보가 추천에 반영돼요.</p>
      </>
    );
  } else if (state.step === "budget") {
    ctaLabel = "예상 구성 확인";
    body = (
      <>
        {(state.usecase || state.mode === "spec" || state.mode === "budget") && <p className="onboarding-pill"><FiPlay /> {phase1Gaming ? "게임용 PC · 그래픽카드 성능 우선" : state.usecase || state.mode === "spec" ? targetSummaryFor(state) : "예산 중심 기본 구성"}</p>}
        <div className="onboarding-budget-card">
          <div className="onboarding-budget-heading"><strong>예산 선택</strong><span>(만원)</span></div>
          <div className="onboarding-budget-control">
            <button type="button" className="onboarding-budget-step" onClick={() => update({ budgetWon: clampBudget(state.budgetWon - BUDGET_STEP_WON) })} aria-label="예산 10만원 줄이기"><FiMinus /></button>
            <strong className="onboarding-budget-value" aria-live="polite" aria-atomic="true">{formatManWon(state.budgetWon)}</strong>
            <button type="button" className="onboarding-budget-step" onClick={() => update({ budgetWon: clampBudget(state.budgetWon + BUDGET_STEP_WON) })} aria-label="예산 10만원 늘리기"><FiPlus /></button>
          </div>
          <div className="onboarding-budget-stops" role="radiogroup" aria-label="빠른 예산 선택">
            {BUDGET_STOPS_WON.map((stop) => (
              <label key={stop} className={`onboarding-budget-stop${state.budgetWon === stop ? " selected" : ""}`}>
                <input className="onboarding-radio-input onboarding-budget-stop-radio" type="radio" name="onboarding-budget-preset" value={String(stop)} checked={state.budgetWon === stop} onChange={() => selectAndAdvance({ budgetWon: stop })} onClick={() => { if (state.budgetWon === stop) selectAndAdvance({ budgetWon: stop }); }} />
                <span>{formatManWon(stop)}</span>
              </label>
            ))}
          </div>
        </div>
        {state.usecase === "gaming" && <GpuVendorToggle value={state.gpuVendorPreference} onChange={(gpuVendorPreference) => update({ gpuVendorPreference })} />}
        {targetBudgetRange && <BudgetRangeCard
          range={targetBudgetRange}
          budgetWon={state.budgetWon}
          gaming={state.usecase === "gaming"}
          floorWon={requestFloor.floorWon}
          suggestedBudgetWon={requestFloor.suggestedBudgetWon}
          floorChecked={requestFloor.checked}
          floorFailed={requestFloor.failed}
          onAdjust={(budgetWon) => update({ budgetWon })}
          onEditTarget={() => editSummaryStep(state.usecase === "gaming" ? "performance" : state.usecase === "work" ? "intensity" : state.mode === "spec" ? "spec" : "mode")}
        />}
        <div className="onboarding-estimate">
          <h3>예상 사양</h3>
          <div className="onboarding-estimate-rows">
            {estimateRows.map(([Icon, label, value]) => (
              <div className="onboarding-estimate-row" key={label}><span className="onboarding-estimate-icon"><Icon /></span><span>{label}</span><strong>{value}</strong></div>
            ))}
          </div>
        </div>
      </>
    );
  } else if (state.step === "summary") {
    ctaLabel = "견적 만들기";
    const summaryRows: { Icon: IconType; label: string; value: string; editStep?: OnboardingStep }[] = state.usecase === "gaming"
      ? [
          { Icon: FiPlay, label: "용도", value: "게임", editStep: state.mode === "budget" ? "mode" : "usecase" },
          ...(phase1Gaming ? [{ Icon: FiActivity, label: "우선할 부품", value: "그래픽카드" }] : [
            { Icon: FiPlay, label: "게임", value: state.games.map(gameLabelFor).join(", "), editStep: "games" as const },
            { Icon: FiActivity, label: "목표 프레임", value: `${resolutionLabelFor(state.resolution)} · ${targetFpsFor(state)} FPS`, editStep: "performance" as const },
            { Icon: FiSliders, label: "게임 옵션", value: `${GAMING_GRAPHICS_PRESET_LABELS[state.graphicsPreset]} · ${GAMING_UPSCALING_LABELS[state.upscaling]}${state.rayTracing ? " · 레이 트레이싱" : ""}`, editStep: "graphics" as const }
          ]),
          { Icon: FiMonitor, label: "그래픽카드 제조사", value: state.gpuVendorPreference === "amd" ? "AMD" : "NVIDIA", editStep: "budget" },
          { Icon: FiDatabase, label: "예산", value: formatManWon(state.budgetWon), editStep: "budget" },
          { Icon: FiZap, label: "예상 수준", value: `${estimate.performance} · ${estimate.gpu}` }
        ]
      : state.usecase === "work"
        ? [
            { Icon: FiPlay, label: "작업", value: state.works.map((id) => ONBOARDING_WORKS.find((work) => work.id === id)?.label).filter(Boolean).join(", ") || "작업", editStep: "works" },
            { Icon: FiSliders, label: "작업 강도", value: intensityOptionFor(state.intensity).label, editStep: "intensity" },
            { Icon: FiDatabase, label: "예산", value: formatManWon(state.budgetWon), editStep: "budget" },
            { Icon: FiZap, label: "예상 수준", value: `${estimate.performance} · ${estimate.gpu} · ${estimate.memory} · ${estimate.storage}` }
          ]
        : state.mode === "spec"
          ? [
              { Icon: FiZap, label: "성능 등급", value: SPEC_TIER_LABELS[state.specTier], editStep: "spec" },
              { Icon: FiMonitor, label: "그래픽", value: state.specIncludeGpu ? "외장 GPU 포함" : "내장 그래픽", editStep: "spec" },
              { Icon: FiDatabase, label: "메모리 · 저장공간", value: `${state.memoryGb}GB · ${storageLabel(state.storageGb)}`, editStep: "spec" },
              { Icon: FiActivity, label: "예산", value: formatManWon(state.budgetWon), editStep: "budget" }
            ]
        : [
              { Icon: FiDatabase, label: "예산", value: formatManWon(state.budgetWon), editStep: "budget" },
              { Icon: FiZap, label: "예상 수준", value: `${estimate.performance} · ${estimate.gpu}` },
              { Icon: FiMonitor, label: "메모리 · 저장공간", value: `${estimate.memory} · ${estimate.storage}` }
            ];
    body = (
      <div className="onboarding-estimate">
        <div className="onboarding-summary-heading">
          <div><h3>선택한 내용</h3><p>예산과 예상 성능은 언제든 바꿀 수 있어요.</p></div>
        </div>
        <div className="onboarding-estimate-rows">
          <div className="onboarding-estimate-row"><span className="onboarding-estimate-icon"><FiBox /></span><span>구매 조건</span><strong>{purchaseConditionSummaryFor(state)}</strong></div>
          {summaryRows.map(({ Icon, label, value, editStep }) => (
            <div className={`onboarding-estimate-row${editStep ? " editable" : ""}`} key={label}>
              <span className="onboarding-estimate-icon"><Icon /></span><span>{label}</span><strong>{value}</strong>
              {editStep && <button type="button" className="onboarding-summary-edit" aria-label={`${label} 변경`} onClick={() => editSummaryStep(editStep)}>{label} 변경</button>}
            </div>
          ))}
        </div>
        {phase1Gaming && <p className="onboarding-note">선택 가능한 부품에서 예산에 맞춰 골라요. 게임과 목표 FPS를 정하려면 위의 “용도 변경”에서 “게임과 목표 FPS로 고르기”를 선택해 주세요.</p>}
        {targetBudgetRange && <BudgetRangeCard range={targetBudgetRange} budgetWon={state.budgetWon} gaming={state.usecase === "gaming"} floorWon={requestFloor.floorWon} suggestedBudgetWon={requestFloor.suggestedBudgetWon} floorChecked={requestFloor.checked} floorFailed={requestFloor.failed} onAdjust={(budgetWon) => update({ budgetWon })} compact />}
      </div>
    );
  }

  const headings: Record<string, { title: string; description: string }> = {
    intent: { title: "어떤 PC 견적을 볼까요?", description: "새 PC 견적을 만들거나, 쓰던 PC를 업그레이드할 수 있어요." },
    mode: { title: "어떤 기준으로 부품을 고를까요?", description: "예산에 맞는 게임 견적, 용도별 견적, 원하는 사양 중 선택하세요." },
    upgrade: { title: "지금 쓰는 PC 부품을 골라주세요", description: "현재 부품을 입력하면 호환 문제와 교체 후보를 확인할 수 있습니다." },
    usecase: { title: "어떤 용도로 쓸 PC인가요?", description: "게임과 작업 중 주된 용도를 골라주세요." },
    games: { title: "주로 할 게임을 골라주세요", description: `게임은 최대 ${MAX_ONBOARDING_GAMES}개까지 고를 수 있어요. 해상도와 목표 FPS는 다음 화면에서 정합니다.` },
    performance: { title: "게임 성능 목표를 정해주세요", description: "화면 해상도와 원하는 FPS를 정해 주세요." },
    graphics: { title: "게임 옵션도 정해주세요", description: "화질과 프레임 중 원하는 쪽을 정해주세요. 필요한 부품은 선택에 따라 달라져요." },
    works: { title: "주로 하는 작업을 골라주세요", description: "여러 작업을 선택할 수 있습니다. 가장 높은 작업 강도에 맞춰 사양을 계산합니다." },
    intensity: { title: primaryWork?.intensityQuestion ?? "작업 규모는 어느 정도인가요?", description: primaryWork?.intensitySummary ?? "작업 강도에 따라 예상 사양이 달라져요." },
    spec: { title: "성능 목표를 정하세요", description: "성능 등급·외장 GPU·메모리·저장공간을 선택하세요." },
    budget: { title: "예산을 정해주세요", description: "예산은 최대 금액으로 적용해요. 부품 구성에 따라 남는 금액이 생길 수 있습니다." },
    summary: { title: "견적 내용을 확인하세요", description: "선택한 항목을 확인하고 부품 추천으로 넘어갈 수 있어요." }
  };
  const heading = showResume
    ? { title: "작성 중인 견적이 있어요", description: "입력한 게임·성능·예산이 남아 있어요. 이어서 작성할 수 있어요." }
    : headings[state.step];

  return (
    <div className="onboarding-page" data-onboarding-step={state.step}>
      <button type="button" className="onboarding-back" onClick={goBack} aria-label={showResume || state.step === "intent" ? "홈으로" : "이전 단계로"}><FiArrowLeft aria-hidden="true" /></button>
      <p className="onboarding-eyebrow">견적 설정 · {indicator.index} / {indicator.total}</p>
      <div className="onboarding-progress" role="progressbar" aria-label={`견적 진행률 ${indicator.index} / ${indicator.total}`} aria-valuetext={`단계 ${indicator.index}, 총 ${indicator.total}단계`} aria-valuemin={1} aria-valuemax={indicator.total} aria-valuenow={indicator.index} data-testid="onboarding-progress"><span style={{ width: `${Math.round((indicator.index / indicator.total) * 100)}%` }} /></div>
      <h1 ref={headingRef} id="onboarding-title" className="onboarding-title" tabIndex={-1}>{heading.title}</h1>
      <p className="onboarding-desc">{heading.description}</p>
      {body}
      {(showResume || !["intent", "mode", "usecase", "intensity"].includes(state.step)) && <div className="onboarding-cta-bar">
        <button type="button" className="onboarding-cta" onClick={goNext} disabled={nextDisabled}>
          {ctaLabel} <FiArrowRight />
        </button>
      </div>}
    </div>
  );
}
