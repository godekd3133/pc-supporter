import { FiArrowRight, FiGitBranch, FiSave, FiTag, FiTrendingUp, FiZap } from "react-icons/fi";
import type { IconType } from "react-icons";
import { CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistFromJson } from "../shared/catalog-watchlist";
import { safeLocalStorage } from "./safe-storage";
import { readEngagementFlags, resultNextActionsFor, type JourneyAction, type JourneyActionKind } from "./user-journey";
import { trackUsageEvent } from "./usage-events";

// 결과 화면의 "다음에 해볼 것" 스트립 — 저장·재구성·비교·가격 추적으로
// 루프를 이어준다. 표시할 액션은 여정 상태에서 우선순위로 고른다.

const ACTION_ICONS: Record<JourneyActionKind, IconType> = {
  save: FiSave,
  start: FiZap,
  history: FiGitBranch,
  watchlist: FiTag,
  "result-trend": FiTrendingUp,
  resume: FiArrowRight,
  result: FiArrowRight
};

function readWatchlistCount() {
  try {
    return catalogWatchlistFromJson(safeLocalStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)).length;
  } catch {
    return 0;
  }
}

export function ResultNextSteps({ saved, savedBuildCount, onSave, onStartNew, onOpenHistory, onOpenWatchlist }: {
  saved: boolean;
  savedBuildCount: number;
  onSave: () => void;
  onStartNew?: () => void;
  onOpenHistory?: () => void;
  onOpenWatchlist?: () => void;
}) {
  const flags = readEngagementFlags();
  const actions = resultNextActionsFor(
    { hasDraft: true, hasResult: true, savedBuildCount, watchlistCount: readWatchlistCount(), trendViewed: flags.trendViewedAt !== undefined },
    { saved, comparable: savedBuildCount >= 2 }
  ).filter((action) => {
    if (action.action === "start") return Boolean(onStartNew);
    if (action.action === "history") return Boolean(onOpenHistory);
    if (action.action === "watchlist") return Boolean(onOpenWatchlist);
    return true;
  });
  if (actions.length === 0) return null;

  function runAction(action: JourneyAction) {
    trackUsageEvent("next_step_click", { step: action.step, surface: "result" });
    switch (action.action) {
      case "save": onSave(); return;
      case "start": onStartNew?.(); return;
      case "history": onOpenHistory?.(); return;
      case "watchlist": onOpenWatchlist?.(); return;
      case "result-trend": document.getElementById("build-price-trend")?.scrollIntoView({ behavior: "smooth", block: "start" }); return;
      default: return;
    }
  }

  return <section className="result-next-steps" aria-label="다음에 해볼 것" data-testid="result-next-steps">
    <div className="result-next-steps-heading"><p className="eyebrow">다음에 해볼 것</p></div>
    <div className="result-next-steps-list">
      {actions.map((action) => {
        const Icon = ACTION_ICONS[action.action];
        return <button className="result-next-step" type="button" key={`${action.step}-${action.action}`} data-testid={`result-next-step-${action.step}`} onClick={() => runAction(action)}>
          <span className="result-next-step-icon" aria-hidden="true"><Icon /></span>
          <span className="result-next-step-copy"><strong>{action.title}</strong><small>{action.description}</small></span>
          <FiArrowRight className="result-next-step-arrow" aria-hidden="true" />
        </button>;
      })}
    </div>
  </section>;
}
