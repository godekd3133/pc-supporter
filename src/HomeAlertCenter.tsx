// Home alert list. Lazy because most visitors have no alerts.
import { FiAlertTriangle, FiBell, FiCheckCircle, FiTag, FiTrendingUp, FiXCircle } from "react-icons/fi";
import { savedBuildMonitorSummaryForDisplay, savedBuildMonitorTitleForDisplay } from "../shared/saved-build-monitor-copy";
import type { AlertCenterItem } from "./HomeView";

export function HomeAlertCenter({ items, unreadCount, hasBuildAlerts, hasWatchlistAlerts, onOpenHistory, onOpenWatchlist }: { items: AlertCenterItem[]; unreadCount: number; hasBuildAlerts: boolean; hasWatchlistAlerts: boolean; onOpenHistory: () => void; onOpenWatchlist: () => void }) {
  if (items.length === 0) return null;
  return <section className="home-alerts" aria-label="알림 센터" data-testid="home-alert-center">
    <div className="home-alerts-heading"><div><h2>알림</h2></div>{unreadCount > 0 && <span className="home-alerts-badge" data-testid="home-alert-unread-count">읽지 않은 알림 {unreadCount}개</span>}</div>
    <div className="home-alerts-list" aria-live="polite">{items.map((item) => {
      const ItemIcon = item.source === "build"
        ? (item.kind === "critical" || item.kind === "review" ? FiAlertTriangle : item.kind === "failed" ? FiXCircle : item.kind === "improved" ? FiCheckCircle : item.kind === "alternative" ? FiTrendingUp : FiBell)
        : FiTag;
      return <article className={`home-alerts-item ${item.read ? "" : "unread"}`} data-testid={`home-alert-${item.id}`} key={item.id}>
        <span className={`home-alerts-item-icon ${item.source}`}><ItemIcon /></span>
        <div className="home-alerts-item-copy"><div className="home-alerts-item-title"><strong>{savedBuildMonitorTitleForDisplay(item.title)}</strong><span>{item.source === "build" ? "저장한 견적" : "가격 추적"} / {item.sourceLabel}</span></div><p>{savedBuildMonitorSummaryForDisplay(item.message)}</p>{item.alternative && <div className="home-alerts-alternative"><span>{item.alternative.currentPartName}</span><b>→</b><strong>{item.alternative.candidatePartName}</strong>{item.alternative.priceDeltaWon !== undefined && <em>{item.alternative.priceDeltaWon < 0 ? `${Math.abs(item.alternative.priceDeltaWon).toLocaleString("ko-KR")}원 절약` : `가격 ${item.alternative.priceDeltaWon > 0 ? "+" : ""}${item.alternative.priceDeltaWon.toLocaleString("ko-KR")}원`}</em>}</div>}<small>{new Date(item.createdAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}{item.read ? "" : " / 아직 안 봄"}</small></div>
      </article>;
    })}</div>
    <div className="home-alerts-actions">{hasBuildAlerts && <button className="button button-light" type="button" data-testid="home-alert-open-history" onClick={onOpenHistory}><FiBell /> 저장한 견적 알림 보기</button>}{hasWatchlistAlerts && <button className="button button-light" type="button" data-testid="home-alert-open-watchlist" onClick={onOpenWatchlist}><FiTag /> 가격 추적 보기</button>}</div>
  </section>;
}
