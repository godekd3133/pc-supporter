import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import { FiActivity, FiAlertTriangle, FiArrowLeft, FiArrowRight, FiBox, FiBriefcase, FiCheck, FiClock, FiCode, FiDatabase, FiFileText, FiFilm, FiInfo, FiMinus, FiMonitor, FiMusic, FiPlay, FiPlus, FiRadio, FiSearch, FiSliders, FiTarget, FiZap } from "react-icons/fi";
import { GAMING_GRAPHICS_PRESET_LABELS, GAMING_UPSCALING_LABELS } from "../shared/types";
import type { GamingGraphicsPreset, GamingRefreshRate, GamingResolution, GamingUpscaling } from "../shared/types";
import {
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
  budgetEstimateFor,
  canAdvance,
  clampBudget,
  formatManWon,
  gameLabelFor,
  gamesSummaryFor,
  initialOnboardingState,
  intensityOptionFor,
  onboardingStateFromJson,
  onboardingStateToJson,
  primaryWorkFor,
  recommendQueryFor,
  resolutionLabelFor,
  gamingTargetShortfall,
  SPEC_TIER_LABELS,
  targetBudgetRangeFor,
  stepIndicatorFor,
  stepLabelFor,
  targetSummaryFor,
  workEstimateFor
} from "./quote-onboarding";
import type { OnboardingGame, OnboardingGameCategory, OnboardingIntensity, OnboardingSpecTier, OnboardingState, OnboardingStep, OnboardingWork, RequiredBudgetRange } from "./quote-onboarding";

type IntentId = "new" | "upgrade" | "later";
type ModeId = "budget" | "task" | "spec";
type UsecaseId = "gaming" | "work";

const INTENT_OPTIONS: { id: IntentId; title: string; description: string; Icon: IconType }[] = [
  { id: "new", title: "새로운 견적을 맞추고 싶어요", description: "게임·작업·예산을 몇 가지 질문으로 정리해요.", Icon: FiFileText },
  { id: "upgrade", title: "이미 가지고 있는 컴퓨터를 업그레이드하고 싶어요", description: "현재 부품을 확인하고 바꾸면 좋은 후보를 찾아요.", Icon: FiMonitor },
  { id: "later", title: "나중에 할래요", description: "홈으로 돌아가고, 준비되면 다시 시작할 수 있어요.", Icon: FiClock }
];

const MODE_OPTIONS: { id: ModeId; title: string; description: string; Icon: IconType }[] = [
  { id: "budget", title: "예산으로 맞출래요", description: "금액을 정하면 예상 성능·RAM·SSD를 바로 보여줘요.", Icon: FiDatabase },
  { id: "task", title: "특정 작업이나 게임을 할 거예요", description: "게임·작업과 목표 성능을 고르면 필요한 사양을 계산해요.", Icon: FiPlay },
  { id: "spec", title: "생각해둔 성능이 있어요", description: "성능 등급·외장 GPU·RAM·SSD를 직접 입력해요.", Icon: FiMonitor }
];

const USECASE_OPTIONS: { id: UsecaseId; title: string; description: string; Icon: IconType }[] = [
  { id: "gaming", title: "게임", description: "원하는 게임과 해상도를 골라주세요", Icon: FiPlay },
  { id: "work", title: "작업", description: "영상 편집·3D·개발 같은 작업을 골라주세요", Icon: FiMonitor }
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
  competitive: "프레임 우선 · 시각 효과를 낮춰 고주사율에 유리해요.",
  balanced: "품질과 프레임을 균형 있게 맞춰요.",
  high: "시각 효과 우선 · 더 높은 GPU 여유가 필요할 수 있어요."
};

const GAMING_UPSCALING_GUIDANCE: Record<GamingUpscaling, string> = {
  native: "화질 우선 · 업스케일링 없이 렌더링해요.",
  quality: "화질과 프레임을 함께 고려하는 참고 기준이에요.",
  balanced: "프레임 여유를 더 확보하는 대신 화질이 달라질 수 있어요."
};

function storageLabel(gb: number) {
  return gb >= 1000 ? `${gb / 1000}TB` : `${gb}GB`;
}

function budgetRangeStatusFor(range: RequiredBudgetRange, budgetWon: number): "below" | "within" | "above" {
  if (budgetWon < range.minWon) return "below";
  if (budgetWon > range.maxWon) return "above";
  return "within";
}

function budgetRangeStatusLabel(status: "below" | "within" | "above") {
  return status === "below" ? "조금 더 필요해요" : status === "above" ? "여유 있는 예산이에요" : "권장 범위 안이에요";
}

function BudgetRangeCard({ range, budgetWon, compact = false, gaming = false, onAdjust, onEditTarget }: { range: RequiredBudgetRange; budgetWon: number; compact?: boolean; gaming?: boolean; onAdjust?: (budgetWon: number) => void; onEditTarget?: () => void }) {
  const status = budgetRangeStatusFor(range, budgetWon);
  const adjustment = status === "below"
    ? { label: `권장 최저 예산(${formatManWon(range.minWon)})으로 맞추기`, budgetWon: range.minWon }
    : status === "above"
      ? { label: `권장 상한(${formatManWon(range.maxWon)})으로 맞추기`, budgetWon: range.maxWon }
      : null;
  return (
    <section className={`onboarding-budget-range ${compact ? "compact" : ""} status-${status}`} aria-label="조건별 예상 가격대">
      <div className="onboarding-budget-range-top">
        <div>
          <span>이 조건의 예상 가격대</span>
          <strong>{formatManWon(range.minWon)} ~ {formatManWon(range.maxWon)}</strong>
        </div>
        <em>{budgetRangeStatusLabel(status)}</em>
      </div>
      <p>{status === "below" ? "선택한 예산으로는 목표에 여유가 적어요. 예산을 올리거나 목표 성능을 낮추면 더 안정적인 조합을 찾을 수 있어요." : status === "above" ? "현재 목표보다 여유 있는 예산이에요. 부품 안정성·저장공간·소음까지 넓혀볼 수 있어요." : "선택한 목표를 현재 카탈로그에서 맞춰볼 수 있는 구간이에요."}</p>
      {(onAdjust && adjustment || onEditTarget && status === "below") && <div className="onboarding-budget-range-actions">
        {onAdjust && adjustment && <button type="button" className="onboarding-budget-range-action" data-testid="onboarding-budget-range-adjust" onClick={() => onAdjust(clampBudget(adjustment.budgetWon))}>{adjustment.label}</button>}
        {onEditTarget && status === "below" && <button type="button" className="onboarding-budget-range-edit" data-testid="onboarding-budget-range-edit-target" onClick={onEditTarget}>목표 성능 다시 고르기</button>}
      </div>}
    </section>
  );
}

function GamingTargetContract({ state, showBudgetHint = false }: { state: OnboardingState; showBudgetHint?: boolean }) {
  const range = showBudgetHint ? targetBudgetRangeFor(state) : null;
  return (
    <section className="onboarding-target-contract" aria-label="게이밍 성능 목표 기준">
      <div className="onboarding-target-contract-heading"><div><span>GAMING TARGET</span><strong>평균 FPS {state.refreshRate} 목표</strong></div><FiTarget aria-hidden="true" /></div>
      <div className="onboarding-target-contract-tags"><span>{resolutionLabelFor(state.resolution)}</span><span>{state.refreshRate} FPS</span><span>{GAMING_GRAPHICS_PRESET_LABELS[state.graphicsPreset]}</span><span>{GAMING_UPSCALING_LABELS[state.upscaling]}</span>{state.rayTracing && <span>레이 트레이싱</span>}</div>
      {range && <div className="onboarding-target-contract-budget"><span>예상 PC 가격대</span><strong>{formatManWon(range.minWon)} ~ {formatManWon(range.maxWon)}</strong></div>}
    </section>
  );
}

function readStoredOnboarding(): { state: OnboardingState; hasDraft: boolean } {
  try {
    const stored = onboardingStateFromJson(window.sessionStorage.getItem(ONBOARDING_STORAGE_KEY));
    return { state: stored ?? initialOnboardingState(), hasDraft: Boolean(stored && stored.step !== "intent") };
  } catch {
    return { state: initialOnboardingState(), hasDraft: false };
  }
}

function OptionRow({ title, description, Icon, selected, recommended, checkStyle, onClick }: { title: string; description?: string; Icon?: IconType; selected: boolean; recommended?: boolean; checkStyle?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`onboarding-option${selected ? " selected" : ""}`} onClick={onClick} aria-pressed={selected}>
      {Icon && <span className="onboarding-option-icon"><Icon /></span>}
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

function ChipRow({ label, options, value, onChange }: { label: string; options: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="onboarding-chip-group">
      <span className="onboarding-chip-label">{label}</span>
      <div className="onboarding-chip-row" role="group" aria-label={label}>
        {options.map((option) => (
          <button key={option.id} type="button" className={`onboarding-chip${value === option.id ? " selected" : ""}`} onClick={() => onChange(option.id)} aria-pressed={value === option.id}>
            <span className={`onboarding-check${value === option.id ? " on" : ""}`} aria-hidden="true">{value === option.id && <FiCheck />}</span>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function QuoteOnboardingView({ onFinish, onUpgrade, onSkip, onHome }: { onFinish: (query: string) => void; onUpgrade: () => void; onSkip: () => void; onHome: () => void }) {
  const [storedOnboarding] = useState(readStoredOnboarding);
  const [state, setState] = useState<OnboardingState>(storedOnboarding.state);
  const [showResume, setShowResume] = useState(storedOnboarding.hasDraft);
  const [gameQuery, setGameQuery] = useState("");
  const [gameCategory, setGameCategory] = useState<OnboardingGameCategory | "all">("all");
  const [gameLimitReached, setGameLimitReached] = useState(false);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(ONBOARDING_STORAGE_KEY, onboardingStateToJson(state));
    } catch {
      // A full session bucket must not break the wizard.
    }
  }, [state]);

  const indicator = showResume ? { eyebrow: "SAVED DRAFT", index: 1, total: 1 } : stepIndicatorFor(state);
  const update = (patch: Partial<OnboardingState>) => setState((current) => ({ ...current, ...patch }));
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
    if (showResume) { onHome(); return; }
    if (state.step === "intent") onHome();
    else setState((current) => backOnboarding(current));
  }

  function goNext() {
    if (showResume) { setShowResume(false); return; }
    if (state.step === "intent" && state.intent === "later") { onSkip(); return; }
    if (state.step === "upgrade") { onUpgrade(); return; }
    if (state.step === "summary") { onFinish(recommendQueryFor(state)); return; }
    setState((current) => advanceOnboarding(current));
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
  const estimate = state.mode === "spec"
    ? { performance: SPEC_TIER_LABELS[state.specTier], gpu: state.specIncludeGpu ? "외장 GPU" : "내장 그래픽", memory: `${state.memoryGb}GB`, storage: storageLabel(state.storageGb) }
    : state.usecase === "work"
      ? workEstimateFor(state.works, state.intensity)
    : budgetEstimateFor(state.budgetWon, state.usecase);
  const shortfall = gamingTargetShortfall(state);
  const targetBudgetRange = targetBudgetRangeFor(state);
  const primaryWork = primaryWorkFor(state.works);
  const estimateRows: [IconType, string, string][] = [
    [FiActivity, "목표 성능", estimate.performance],
    [FiMonitor, "그래픽", estimate.gpu],
    [FiDatabase, "메모리", estimate.memory],
    [FiZap, "저장공간", estimate.storage]
  ];

  let body: ReactNode = null;
  let ctaLabel = showResume ? "이어서 시작하기" : "다음";

  if (showResume) {
    const resumeGame = state.intent === "upgrade"
      ? "PC 업그레이드"
      : state.usecase === "gaming"
        ? (state.games.length > 0 ? gamesSummaryFor(state.games) : "게임 선택 전")
        : state.usecase === "work"
          ? `${primaryWork?.label ?? "작업"} · ${intensityOptionFor(state.intensity).label}`
          : state.mode === "spec"
            ? "직접 성능 입력"
            : "예산 기준 구성";
    const resumeTarget = state.intent === "upgrade"
      ? "현재 부품 점검"
      : state.usecase === "gaming"
        ? `${resolutionLabelFor(state.resolution)} · ${state.refreshRate} FPS`
        : state.usecase === "work" || state.mode === "spec"
          ? targetSummaryFor(state)
          : "조건 확인 전";
    body = (
      <div className="onboarding-draft">
        <h3>저장된 견적 조건</h3>
        <div className="onboarding-draft-rows">
          <div className="onboarding-draft-row"><span className="onboarding-estimate-icon"><FiPlay /></span><span>게임·작업</span><strong>{resumeGame}</strong></div>
          <div className="onboarding-draft-row"><span className="onboarding-estimate-icon"><FiActivity /></span><span>목표 성능</span><strong>{resumeTarget}</strong></div>
          <div className="onboarding-draft-row"><span className="onboarding-estimate-icon"><FiDatabase /></span><span>예산</span><strong>{formatManWon(state.budgetWon)}</strong></div>
          <div className="onboarding-draft-row"><span className="onboarding-estimate-icon"><FiMonitor /></span><span>현재 단계</span><strong>{stepLabelFor(state.step)}</strong></div>
        </div>
        <button type="button" className="onboarding-secondary-action" onClick={restartOnboarding}>처음부터 시작하기</button>
        <p className="onboarding-note">처음부터 시작하면 저장된 조건은 지워지고 새로 진행해요.</p>
      </div>
    );
  } else if (state.step === "intent") {
    ctaLabel = state.intent === "later" ? "홈으로 돌아가기" : state.intent === "upgrade" ? "다음" : "새 견적 시작하기";
    body = (
      <div className="onboarding-options">
        {INTENT_OPTIONS.map((option) => (
          <OptionRow key={option.id} title={option.title} description={option.description} Icon={option.Icon} selected={state.intent === option.id} onClick={() => update({ intent: option.id })} />
        ))}
      </div>
    );
  } else if (state.step === "mode") {
    body = (
      <div className="onboarding-options">
        {MODE_OPTIONS.map((option) => (
          <OptionRow key={option.id} title={option.title} description={option.description} Icon={option.Icon} selected={state.mode === option.id} onClick={() => update({ mode: option.id })} />
        ))}
      </div>
    );
  } else if (state.step === "upgrade") {
    ctaLabel = "현재 부품 고르기";
    body = (
      <div className="onboarding-steps-list">
        {[
          "지금 쓰는 CPU·메인보드·그래픽카드 등을 골라주세요.",
          "호환성 검사를 누르면 현재 구성의 문제를 확인해요.",
          "결과 화면에서 바꾸면 좋은 부품과 업그레이드 묶음을 보여드려요."
        ].map((line, index) => (
          <div className="onboarding-steps-item" key={line}><span className="onboarding-steps-number">{index + 1}</span><p>{line}</p></div>
        ))}
      </div>
    );
  } else if (state.step === "usecase") {
    body = (
      <div className="onboarding-options">
        {USECASE_OPTIONS.map((option) => (
          <OptionRow key={option.id} title={option.title} description={option.description} Icon={option.Icon} selected={state.usecase === option.id} onClick={() => update({ usecase: option.id })} />
        ))}
      </div>
    );
  } else if (state.step === "games") {
    body = (
      <>
        <label className="onboarding-game-search">
          <FiSearch aria-hidden="true" />
          <input type="search" value={gameQuery} onChange={(event) => setGameQuery(event.target.value)} placeholder="게임 이름 검색" aria-label="게임 이름 검색" />
        </label>
        <div className="onboarding-game-categories" role="group" aria-label="게임 카테고리">
          <button type="button" className={`onboarding-game-category${gameCategory === "all" ? " selected" : ""}`} onClick={() => setGameCategory("all")}>전체</button>
          {ONBOARDING_GAME_CATEGORIES.map((category) => (
            <button type="button" className={`onboarding-game-category${gameCategory === category ? " selected" : ""}`} key={category} onClick={() => setGameCategory(category)}>
              {ONBOARDING_GAME_CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>
        <div className="onboarding-game-selection-summary">
          <strong>{state.games.length}개 선택</strong>
          <span>{state.games.length >= MAX_ONBOARDING_GAMES ? "가장 높은 목표를 기준으로 계산해요." : "게임은 여러 개 선택할 수 있어요."}</span>
        </div>
        {state.games.length > 0 && <div className="onboarding-game-selected-list" aria-label="선택한 게임">
          {state.games.map((id) => <span className="onboarding-game-selected-chip" key={id}>{gameLabelFor(id)}<button type="button" onClick={() => toggleGame(id)} aria-label={`${gameLabelFor(id)} 선택 해제`}>×</button></span>)}
        </div>}
        <div className="onboarding-options">
          {visibleGames.map((game) => (
            <OptionRow key={game.id} title={game.label} selected={state.games.includes(game.id)} checkStyle onClick={() => toggleGame(game.id)} />
          ))}
        </div>
        {visibleGames.length === 0 && <p className="onboarding-game-empty"><FiSearch /> 일치하는 게임이 없어요. 한글 이름이나 영문 게임 ID로 다시 검색해 보세요.</p>}
        {gameLimitReached && <p className="onboarding-warning"><FiAlertTriangle /> 한 대의 PC로 비교할 게임은 최대 {MAX_ONBOARDING_GAMES}개까지예요. 새 게임을 고르려면 먼저 하나를 해제해 주세요.</p>}
      </>
    );
  } else if (state.step === "performance") {
    body = (
      <>
        <p className="onboarding-callout"><FiInfo /> 선택한 목표를 만족하는 조합만 추천해요.</p>
        <ChipRow label="해상도" options={RESOLUTION_OPTIONS.map((option) => ({ id: option.id, label: option.label }))} value={state.resolution} onChange={(id) => update({ resolution: id as GamingResolution })} />
        <ChipRow label="목표 프레임" options={REFRESH_OPTIONS.map((option) => ({ id: String(option.id), label: option.label }))} value={String(state.refreshRate)} onChange={(id) => update({ refreshRate: Number(id) as GamingRefreshRate })} />
        <p className="onboarding-pill"><FiPlay /> {gamesSummaryFor(state.games)} · {resolutionLabelFor(state.resolution)} · {state.refreshRate} FPS</p>
        <GamingTargetContract state={state} />
        <p className="onboarding-note">실제 FPS는 게임 옵션·패치·드라이버에 따라 달라질 수 있어요.</p>
      </>
    );
  } else if (state.step === "graphics") {
    ctaLabel = "다음 · 예산 정하기";
    body = (
      <>
        <p className="onboarding-pill"><FiPlay /> {gamesSummaryFor(state.games)} · {resolutionLabelFor(state.resolution)} · {state.refreshRate} FPS</p>
        <ChipRow label="그래픽 품질" options={Object.entries(GAMING_GRAPHICS_PRESET_LABELS).map(([id, label]) => ({ id, label }))} value={state.graphicsPreset} onChange={(id) => update({ graphicsPreset: id as GamingGraphicsPreset })} />
        <p className="onboarding-choice-note"><FiInfo /> {GAMING_GRAPHICS_GUIDANCE[state.graphicsPreset]}</p>
        <ChipRow label="업스케일링" options={Object.entries(GAMING_UPSCALING_LABELS).map(([id, label]) => ({ id, label }))} value={state.upscaling} onChange={(id) => update({ upscaling: id as GamingUpscaling })} />
        <p className="onboarding-choice-note"><FiInfo /> {GAMING_UPSCALING_GUIDANCE[state.upscaling]}</p>
        <OptionRow
          title="레이 트레이싱"
          description="실제 FPS 데이터가 없으면 확인 필요로 표시해요."
          Icon={FiZap}
          selected={state.rayTracing}
          checkStyle
          onClick={() => update({ rayTracing: !state.rayTracing })}
        />
        {state.rayTracing && <p className="onboarding-warning"><FiAlertTriangle /> 레이 트레이싱은 같은 목표 FPS에서도 더 높은 GPU 등급이 필요할 수 있어요.</p>}
        <GamingTargetContract state={state} showBudgetHint />

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
        <div className="onboarding-options">
          {ONBOARDING_INTENSITIES.map((option) => {
            const estimate = workEstimateFor(state.works, option.id);
            return <OptionRow
              key={option.id}
              title={option.label}
              description={`${option.description} · 예상 ${estimate.performance} · ${estimate.gpu} · ${estimate.memory} · ${estimate.storage}`}
              Icon={INTENSITY_ICONS[option.id]}
              selected={state.intensity === option.id}
              recommended={option.recommended}
              checkStyle
              onClick={() => update({ intensity: option.id })}
            />;
          })}
        </div>
        {state.intensity && primaryWork && <p className="onboarding-pill"><FiSliders /> {primaryWork.label} · {intensityOptionFor(state.intensity).label}</p>}
      </>
    );
  } else if (state.step === "spec") {
    body = (
      <>
        <ChipRow label="원하는 성능 등급" options={SPEC_TIER_OPTIONS} value={state.specTier} onChange={(id) => update({ specTier: id as OnboardingSpecTier })} />
        <OptionRow title="외장 그래픽카드 포함" description="게임·3D·GPU 가속 작업을 함께 고려해요." Icon={FiMonitor} selected={state.specIncludeGpu} checkStyle onClick={() => update({ specIncludeGpu: !state.specIncludeGpu })} />
        <ChipRow label="메모리" options={MEMORY_OPTIONS.map((gb) => ({ id: String(gb), label: `${gb}GB` }))} value={String(state.memoryGb)} onChange={(id) => update({ memoryGb: Number(id) })} />
        <ChipRow label="저장공간" options={STORAGE_OPTIONS.map((gb) => ({ id: String(gb), label: storageLabel(gb) }))} value={String(state.storageGb)} onChange={(id) => update({ storageGb: Number(id) })} />
        <p className="onboarding-note">선택한 성능 등급·GPU 포함 여부·메모리·저장공간을 추천 조건으로 전달해요.</p>
      </>
    );
  } else if (state.step === "budget") {
    ctaLabel = "다음 · 조건 확인";
    body = (
      <>
        {(state.usecase || state.mode === "spec" || state.mode === "budget") && <p className="onboarding-pill"><FiPlay /> 현재 목표 · {state.usecase === "gaming" ? `${resolutionLabelFor(state.resolution)} · ${state.refreshRate} FPS · ${GAMING_GRAPHICS_PRESET_LABELS[state.graphicsPreset]} · ${GAMING_UPSCALING_LABELS[state.upscaling]}${state.rayTracing ? " · 레이 트레이싱" : ""}` : state.usecase === "work" || state.mode === "spec" ? targetSummaryFor(state) : "예산 중심 기본 구성"}</p>}
        <div className="onboarding-budget-card">
          <div className="onboarding-budget-heading"><strong>예산 선택</strong><span>(만원)</span></div>
          <div className="onboarding-budget-control">
            <button type="button" className="onboarding-budget-step" onClick={() => update({ budgetWon: clampBudget(state.budgetWon - BUDGET_STEP_WON) })} aria-label="예산 10만원 줄이기"><FiMinus /></button>
            <strong className="onboarding-budget-value">{formatManWon(state.budgetWon)}</strong>
            <button type="button" className="onboarding-budget-step" onClick={() => update({ budgetWon: clampBudget(state.budgetWon + BUDGET_STEP_WON) })} aria-label="예산 10만원 늘리기"><FiPlus /></button>
          </div>
          <div className="onboarding-budget-stops" role="group" aria-label="빠른 예산 선택">
            {BUDGET_STOPS_WON.map((stop) => (
              <button key={stop} type="button" className={`onboarding-budget-stop${state.budgetWon === stop ? " selected" : ""}`} onClick={() => update({ budgetWon: stop })}>{formatManWon(stop)}</button>
            ))}
          </div>
        </div>
        {targetBudgetRange && <BudgetRangeCard
          range={targetBudgetRange}
          budgetWon={state.budgetWon}
          gaming={state.usecase === "gaming"}
          onAdjust={(budgetWon) => update({ budgetWon })}
          onEditTarget={() => editSummaryStep(state.usecase === "gaming" ? "performance" : state.usecase === "work" ? "intensity" : state.mode === "spec" ? "spec" : "mode")}
        />}
        <div className="onboarding-estimate">
          <h3>이 금액에서 예상되는 수준</h3>
          <div className="onboarding-estimate-rows">
            {estimateRows.map(([Icon, label, value]) => (
              <div className="onboarding-estimate-row" key={label}><span className="onboarding-estimate-icon"><Icon /></span><span>{label}</span><strong>{value}</strong></div>
            ))}
          </div>
        </div>
        {shortfall && (
          <p className="onboarding-warning"><FiAlertTriangle /> 선택한 예산이 목표 성능의 권장 범위보다 낮아요. 예산을 올리거나 목표를 낮춰보세요.</p>
        )}
      </>
    );
  } else if (state.step === "summary") {
    ctaLabel = "이 조건으로 견적 생성하기";
    const summaryRows: { Icon: IconType; label: string; value: string; editStep?: OnboardingStep }[] = state.usecase === "gaming"
      ? [
          { Icon: FiPlay, label: "게임", value: gamesSummaryFor(state.games), editStep: "games" },
          { Icon: FiActivity, label: "목표 성능", value: `${resolutionLabelFor(state.resolution)} · ${state.refreshRate} FPS`, editStep: "performance" },
          { Icon: FiSliders, label: "그래픽 옵션", value: `${GAMING_GRAPHICS_PRESET_LABELS[state.graphicsPreset]} · ${GAMING_UPSCALING_LABELS[state.upscaling]}${state.rayTracing ? " · 레이 트레이싱" : ""}`, editStep: "graphics" },
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
          <div><h3>선택한 조건</h3><p>바꿀 항목은 바로 수정할 수 있어요.</p></div>
          <span>최종 확인</span>
        </div>
        <div className="onboarding-estimate-rows">
          {summaryRows.map(({ Icon, label, value, editStep }) => (
            <div className={`onboarding-estimate-row${editStep ? " editable" : ""}`} key={label}>
              <span className="onboarding-estimate-icon"><Icon /></span><span>{label}</span><strong>{value}</strong>
              {editStep && <button type="button" className="onboarding-summary-edit" onClick={() => editSummaryStep(editStep)}>{label} 변경</button>}
            </div>
          ))}
        </div>
        {targetBudgetRange && <BudgetRangeCard range={targetBudgetRange} budgetWon={state.budgetWon} gaming={state.usecase === "gaming"} compact />}
        {shortfall && (
          <p className="onboarding-warning"><FiAlertTriangle /> 선택한 예산이 목표 성능의 권장 범위보다 낮아요. 예산을 올리거나 목표를 낮춰보세요.</p>
        )}
        <p className="onboarding-note">다음 화면에서 실제 부품 조합을 바로 만들어 드려요.</p>
      </div>
    );
  }

  const headings: Record<string, { title: string; description: string }> = {
    intent: { title: "어떤 PC가 필요하세요?", description: "원하는 방식으로 몇 가지만 알려주시면 맞춰드릴게요." },
    mode: { title: "새 견적은 어떤 방식으로 맞춰볼까요?", description: "아는 만큼만 골라도 괜찮아요. 나중에 기준을 바꿀 수 있어요." },
    upgrade: { title: "지금 쓰는 PC 부품을 골라주세요", description: "현재 구성을 입력하고 검사하면, 바꾸면 좋은 부품과 업그레이드 묶음을 보여드려요." },
    usecase: { title: "무엇을 주로 할까요?", description: "가장 많이 하는 일을 기준으로 필요한 부품을 계산해요." },
    games: { title: "어떤 게임을 할 건가요?", description: "자주 하는 게임을 골라주면 그 게임에서 목표 성능이 나오도록 맞춰볼게요." },
    performance: { title: "원하는 성능을 골라주세요", description: "선택한 게임과 해상도에서 목표 프레임을 확인할게요." },
    graphics: { title: "게임 옵션도 정해주세요", description: "같은 4K · 144 FPS라도 그래픽 옵션에 따라 필요한 부품이 달라져요." },
    works: { title: "주로 어떤 작업을 할 건가요?", description: "여러 개를 골라도 괜찮아요. 가장 무거운 작업을 기준으로 맞춰드릴게요." },
    intensity: { title: primaryWork?.intensityQuestion ?? "작업을 어느 정도로 할까요?", description: primaryWork?.intensitySummary ?? "작업 강도를 기준으로 맞춰드려요." },
    spec: { title: "생각해둔 성능을 알려주세요", description: "성능 등급·외장 GPU·메모리·저장공간을 골라주세요." },
    budget: { title: "예산은 어디까지 생각하세요?", description: "금액을 바꾸면 예상 가능한 성능과 부품 구성이 같이 바뀌어요." },
    summary: { title: "이 조건으로 맞춰볼까요?", description: "선택한 내용을 확인하고 견적 생성으로 넘어가요." }
  };
  const heading = showResume
    ? { title: "전에 고르던 조건이 있어요.", description: "이어서 진행하면 저장해둔 게임·성능·예산 조건을 그대로 불러와요." }
    : headings[state.step];

  return (
    <div className="onboarding-page">
      <button type="button" className="onboarding-back" onClick={goBack} aria-label={showResume || state.step === "intent" ? "홈으로" : "이전 단계로"}><FiArrowLeft /></button>
      <p className="onboarding-eyebrow">{indicator.eyebrow} · {indicator.index} / {indicator.total}</p>
      <div className="onboarding-progress" role="progressbar" aria-label={`온보딩 진행률 ${indicator.index} / ${indicator.total}`} aria-valuemin={1} aria-valuemax={indicator.total} aria-valuenow={indicator.index} data-testid="onboarding-progress"><span style={{ width: `${Math.round((indicator.index / indicator.total) * 100)}%` }} /></div>
      <h1 className="onboarding-title">{heading.title}</h1>
      <p className="onboarding-desc">{heading.description}</p>
      {body}
      <div className="onboarding-cta-bar">
        <button type="button" className="onboarding-cta" onClick={goNext} disabled={nextDisabled}>
          {ctaLabel} <FiArrowRight />
        </button>
      </div>
    </div>
  );
}
