import { safeLocalStorage } from "./safe-storage";

// 사용 여정 루프: 견적 만들기 → 가격 추적 등록 → 가격 추이 확인 → 다시 견적 만들기.
// 로컬 상태로부터 유저의 여정 진행을 계산한다. 서버 계측과 무관하게 클라이언트가 즉시
// 판정할 수 있도록 실제 데이터(저장 견적 수·워치리스트 수)를 우선 사용하고,
// 행위 기반 단계(추이 조회)만 localStorage 플래그를 쓴다.

export type JourneyStepId = "first_build" | "watching" | "trend";

export type JourneyActionKind = "start" | "resume" | "watchlist" | "result-trend" | "history" | "save" | "result";

export type JourneyInput = {
  hasDraft: boolean;
  hasResult: boolean;
  savedBuildCount: number;
  watchlistCount: number;
  trendViewed: boolean;
};

export type JourneyStep = {
  id: JourneyStepId;
  label: string;
  done: boolean;
};

export type JourneyAction = {
  // step은 여정 단계 id 또는 보조 행동의 의미값(saved/compared/loop)으로 기록된다.
  step: JourneyStepId | "loop" | "saved" | "compared";
  title: string;
  description: string;
  ctaLabel: string;
  action: JourneyActionKind;
};

export const JOURNEY_STEP_ORDER: readonly JourneyStepId[] = ["first_build", "watching", "trend"];

export const JOURNEY_STEP_LABELS: Readonly<Record<JourneyStepId, string>> = {
  first_build: "견적 만들기",
  watching: "가격 추적하기",
  trend: "가격 추이 확인"
};

export function journeyStepsFor(input: JourneyInput): JourneyStep[] {
  // 첫 단계는 "완성된 견적" 기준 — 초안만 있으면 아직 이어서 만들기 단계다.
  const started = input.hasResult || input.savedBuildCount > 0;
  return [
    { id: "first_build", label: JOURNEY_STEP_LABELS.first_build, done: started },
    { id: "watching", label: JOURNEY_STEP_LABELS.watching, done: input.watchlistCount > 0 },
    { id: "trend", label: JOURNEY_STEP_LABELS.trend, done: input.trendViewed }
  ];
}

// 다음 단계 CTA — 첫 미완료 단계를 고르고, 모두 완료했으면 루프 재시작을 제안한다.
export function nextJourneyAction(input: JourneyInput): JourneyAction {
  const steps = journeyStepsFor(input);
  const next = steps.find((step) => !step.done);
  if (!next) {
    return { step: "loop", title: "여정을 완료했어요", description: "가격이 내릴 때 다른 조건의 견적도 구성해 보세요.", ctaLabel: "새 견적 만들기", action: "start" };
  }
  switch (next.id) {
    case "first_build":
      return input.hasDraft
        ? { step: next.id, title: "작성 중인 견적이 있어요", description: "이어서 부품을 고르고 호환 결과를 확인하세요.", ctaLabel: "견적 이어서 만들기", action: "resume" }
        : { step: next.id, title: "첫 견적을 만들어 보세요", description: "용도와 예산을 정하면 부품을 추천하고 호환을 확인해요.", ctaLabel: "새 견적 시작하기", action: "start" };
    case "watching":
      return { step: next.id, title: "마음에 드는 부품의 가격을 추적해 보세요", description: "목표가를 정하면 가격이 내릴 때 알림을 받을 수 있어요.", ctaLabel: "가격 추적 시작하기", action: "watchlist" };
    case "trend":
      return input.hasResult
        ? { step: next.id, title: "견적의 가격 추이를 확인해 보세요", description: "구성 부품의 가격이 어떻게 변했는지 지난 추이로 볼 수 있어요.", ctaLabel: "가격 추이 보기", action: "result-trend" }
        : { step: next.id, title: "가격 추이를 확인해 보세요", description: "추적 중인 부품의 가격 변화를 확인해 보세요.", ctaLabel: "가격 추적 열기", action: "watchlist" };
  }
}

// 결과 화면의 "다음에 해볼 것" — 루프의 다음 단계를 우선하고 저장·비교는 보조로 채운다.
export function resultNextActionsFor(input: JourneyInput, options: { saved: boolean; comparable: boolean }): JourneyAction[] {
  const actions: JourneyAction[] = [];
  if (!options.saved) {
    actions.push({ step: "saved", title: "견적 저장·공유", description: "저장하면 나중에 다시 열고 다른 견적과 비교할 수 있어요.", ctaLabel: "견적 저장하기", action: "save" });
  }
  if (input.watchlistCount === 0) {
    actions.push({ step: "watching", title: "가격 추적 시작", description: "이 견적 부품의 가격이 내리면 알림을 받아요.", ctaLabel: "가격 추적 보기", action: "watchlist" });
  } else if (!input.trendViewed) {
    actions.push({ step: "trend", title: "가격 추이 보기", description: "이 견적의 부품 가격 변화를 추이로 확인해요.", ctaLabel: "가격 추이 보기", action: "result-trend" });
  }
  actions.push({ step: "loop", title: "새 견적 만들기", description: "예산이나 우선순위를 바꿔 다른 구성을 만들어 보세요.", ctaLabel: "새 견적 시작", action: "start" });
  if (options.comparable && actions.length < 3) {
    actions.push({ step: "compared", title: "저장 견적과 비교", description: "저장해 둔 견적과 부품·가격을 나란히 비교해요.", ctaLabel: "비교하기", action: "history" });
  }
  return actions.slice(0, 3);
}

// ─── 행위 플래그 저장소 ─────────────────────────────────────────────

export const ENGAGEMENT_FLAGS_STORAGE_KEY = "pc-supporter-engagement-flags";

type EngagementFlags = { comparedAt?: string; trendViewedAt?: string };

export function readEngagementFlags(): EngagementFlags {
  try {
    const raw = safeLocalStorage.getItem(ENGAGEMENT_FLAGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const candidate = parsed as Partial<Record<keyof EngagementFlags, unknown>>;
    return {
      ...(typeof candidate.comparedAt === "string" ? { comparedAt: candidate.comparedAt } : {}),
      ...(typeof candidate.trendViewedAt === "string" ? { trendViewedAt: candidate.trendViewedAt } : {})
    };
  } catch {
    return {};
  }
}

export function markEngagementFlag(flag: keyof EngagementFlags) {
  try {
    const next = { ...readEngagementFlags(), [flag]: new Date().toISOString() };
    safeLocalStorage.setItem(ENGAGEMENT_FLAGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 저장이 막혀도 여정 진행 자체는 로컬 데이터로 계속 판정된다.
  }
}
