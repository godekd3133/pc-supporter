import { useCallback, useEffect, useState } from "react";
import { FiArrowRight, FiCheck, FiClock, FiSave } from "react-icons/fi";
import type { SavedBuild } from "../shared/types";
import { isKnownPrice } from "../shared/types";
import { CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistFromJson } from "../shared/catalog-watchlist";
import { safeLocalStorage } from "./safe-storage";
import {
  ENGAGEMENT_FLAGS_STORAGE_KEY,
  journeyStepsFor,
  nextJourneyAction,
  readEngagementFlags,
  type JourneyAction,
  type JourneyActionKind,
  type JourneyInput
} from "./user-journey";
import { trackUsageEvent } from "./usage-events";

// 홈 로비의 여정 카드 — 견적 생성·저장·비교·가격 추적 단계 진행 상황과
// 다음 행동 CTA를 보여준다. 재방문 유저에게는 최근 저장 견적 바로 열기를 제공한다.

function readWatchlistCount() {
  try {
    return catalogWatchlistFromJson(safeLocalStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)).length;
  } catch {
    return 0;
  }
}

function useJourneyInput(hasDraft: boolean, hasResult: boolean, savedBuildCount: number): JourneyInput {
  // storage 이벤트·포커스 복귀 시 플래그/워치리스트를 다시 읽는다.
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  void revision;
  const flags = readEngagementFlags();
  return {
    hasDraft,
    hasResult,
    savedBuildCount,
    watchlistCount: readWatchlistCount(),
    trendViewed: flags.trendViewedAt !== undefined
  };
}

function formatWon(value: number | undefined) {
  return value === undefined ? null : `${value.toLocaleString("ko-KR")}원`;
}

export function HomeJourneyPanel({ hasDraft, hasResult, savedBuilds, compact = false, onAction, onOpenSavedBuild }: {
  hasDraft: boolean;
  hasResult: boolean;
  savedBuilds: SavedBuild[];
  compact?: boolean;
  onAction: (action: JourneyActionKind) => void;
  onOpenSavedBuild?: (saved: SavedBuild) => void;
}) {
  const input = useJourneyInput(hasDraft, hasResult, savedBuilds.length);
  const steps = journeyStepsFor(input);
  const next = nextJourneyAction(input);
  const doneCount = steps.filter((step) => step.done).length;
  const allDone = next.step === "loop";
  const recentBuilds = savedBuilds.slice(0, 3);

  const runAction = useCallback((action: JourneyAction) => {
    trackUsageEvent("next_step_click", { step: action.step, surface: compact ? "home-mobile" : "home" });
    onAction(action.action);
  }, [compact, onAction]);

  return <section className={`home-journey${compact ? " compact" : ""}`} aria-label="견적 여정" data-testid="home-journey">
    <div className="home-journey-heading">
      <div>
        <h2>견적 여정</h2>
        <p>{allDone ? "모든 단계를 경험했어요. 가격 변화를 확인하며 타이밍을 잡아보세요." : `여정 ${doneCount}/${steps.length} 단계 진행 중`}</p>
      </div>
      <span className="home-journey-progress" role="img" aria-label={`${steps.length}단계 중 ${doneCount}단계 완료`}>{doneCount}/{steps.length}</span>
    </div>
    <ol className="home-journey-steps" aria-label="여정 단계">
      {steps.map((step) => {
        const active = next?.step === step.id;
        return <li key={step.id} className={`home-journey-step${step.done ? " done" : ""}${active ? " active" : ""}`}>
          <span className="home-journey-step-icon" aria-hidden="true">{step.done ? <FiCheck /> : <FiClock />}</span>
          <span className="home-journey-step-label">{step.label}</span>
        </li>;
      })}
    </ol>
    <div className="home-journey-next" data-testid="home-journey-next">
      <div className="home-journey-next-copy"><strong>{next.title}</strong><small>{next.description}</small></div>
      <button className="button button-primary button-small" type="button" data-testid="home-journey-cta" onClick={() => runAction(next)}>{next.ctaLabel} <FiArrowRight /></button>
    </div>
    {!compact && recentBuilds.length > 0 && onOpenSavedBuild && <div className="home-journey-recent" aria-label="최근 저장 견적">
      <span className="home-journey-recent-label"><FiSave /> 최근 저장 견적</span>
      <div className="home-journey-recent-list">
        {recentBuilds.map((saved) => <button className="home-journey-recent-item" type="button" key={saved.id} data-testid={`home-journey-recent-${saved.id}`} onClick={() => { trackUsageEvent("next_step_click", { step: "saved_build_open", surface: compact ? "home-mobile" : "home" }); onOpenSavedBuild(saved); }}>
          <strong>{saved.name}</strong>
          <small>{isKnownPrice(saved.summary?.totalPriceWon) ? formatWon(saved.summary?.totalPriceWon) : "가격 미상"} · {new Date(saved.updatedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}</small>
        </button>)}
      </div>
    </div>}
  </section>;
}

// 플래그 키 재수출 — 배선 지점에서 같은 키를 쓰도록 한다.
export { ENGAGEMENT_FLAGS_STORAGE_KEY };
