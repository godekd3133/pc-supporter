// Home lobby: saved builds with today's price against the saved total and unread monitor alerts.
import { useEffect, useMemo, useState } from "react";
import { FiArrowRight, FiBell, FiChevronDown, FiChevronUp } from "react-icons/fi";
import { PART_CATEGORIES, isKnownPrice, type Part, type SavedBuild } from "../shared/types";
import { savedBuildMonitorAlertMatches, type SavedBuildMonitorAlert } from "../shared/saved-build-monitor-alerts";
import { api } from "./api";
import { selectionList } from "./build-edit";

const INITIAL_BUILDS = 5;
const BATCH_LIMIT = 100;

type Row = { saved: SavedBuild; savedTotal?: number; currentTotal?: number; unread: number };

function partIdsOf(saved: SavedBuild) {
  return PART_CATEGORIES.flatMap((category) => selectionList(saved.selection, category).map((selection) => selection.partId));
}

function keyPartsOf(saved: SavedBuild) {
  const lines = saved.summary?.coreLines ?? [];
  return ["cpu", "gpu"].map((category) => lines.find((line) => line.category === category)?.name).filter(Boolean).join(" / ");
}

export function HomeSavedBuildPrices({ savedBuilds, monitorAlerts = [], compact = false, onOpenSavedBuild, onOpenHistory }: { savedBuilds: SavedBuild[]; monitorAlerts?: SavedBuildMonitorAlert[]; compact?: boolean; onOpenSavedBuild?: (saved: SavedBuild) => void; onOpenHistory: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const builds = useMemo(() => expanded ? savedBuilds : savedBuilds.slice(0, INITIAL_BUILDS), [expanded, savedBuilds]);
  const ids = useMemo(() => [...new Set(builds.flatMap(partIdsOf))].slice(0, BATCH_LIMIT), [builds]);
  const [prices, setPrices] = useState<Map<string, number | undefined> | null>(null);
  const unreadByBuild = useMemo(() => {
    const counts = new Map<string, number>();
    for (const alert of monitorAlerts) if (savedBuildMonitorAlertMatches(alert, "unread")) counts.set(alert.buildId, (counts.get(alert.buildId) ?? 0) + 1);
    return counts;
  }, [monitorAlerts]);

  useEffect(() => {
    if (ids.length === 0) return undefined;
    let active = true;
    api<{ items: Part[] }>(`/api/parts/batch?ids=${encodeURIComponent(ids.join(","))}`, { retry: 1 })
      .then((payload) => { if (active) setPrices((current) => new Map([...(current ?? []), ...payload.items.map((part) => [part.id, part.priceWon] as const)])); })
      .catch(() => { if (active) setPrices((current) => current ?? new Map()); });
    return () => { active = false; };
  }, [ids]);

  if (savedBuilds.length === 0) return null;

  const rows: Row[] = builds.map((saved) => {
    const lines = PART_CATEGORIES.flatMap((category) => selectionList(saved.selection, category));
    const current = prices ? lines.map((line) => ({ price: prices.get(line.partId), quantity: line.quantity })) : [];
    const complete = prices !== null && lines.length > 0 && current.every((line) => isKnownPrice(line.price));
    const currentTotal = complete ? current.reduce((total, line) => total + (line.price ?? 0) * line.quantity, 0) : undefined;
    const savedTotal = isKnownPrice(saved.summary?.coreTotalPriceWon) ? saved.summary!.coreTotalPriceWon : undefined;
    return { saved, savedTotal, currentTotal, unread: unreadByBuild.get(saved.id) ?? 0 };
  });
  const totalUnread = savedBuilds.reduce((sum, saved) => sum + (unreadByBuild.get(saved.id) ?? 0), 0);
  const hiddenCount = savedBuilds.length - INITIAL_BUILDS;

  return <section className={`home-saved-prices home-saved-lobby${compact ? " compact" : ""}`} aria-label="저장한 견적" data-testid="home-saved-prices">
    <div className="home-saved-prices-heading">
      <h2>저장한 견적 <span className="home-saved-lobby-count">{savedBuilds.length}</span></h2>
      {totalUnread > 0 && <span className="home-saved-lobby-alerts"><FiBell aria-hidden="true" /> 새 알림 {totalUnread}</span>}
      <button className="text-button" type="button" data-testid="home-saved-open-history" onClick={onOpenHistory}>전체 보기 <FiArrowRight aria-hidden="true" /></button>
    </div>
    <div className="home-saved-lobby-columns" aria-hidden="true"><span>견적</span><span>오늘 가격</span><span>저장 대비</span></div>
    <ul className={expanded ? "expanded" : undefined}>
      {rows.map(({ saved, savedTotal, currentTotal, unread }) => {
        const delta = savedTotal !== undefined && currentTotal !== undefined ? currentTotal - savedTotal : undefined;
        const tone = delta === undefined ? "pending" : delta < 0 ? "down" : delta > 0 ? "up" : "same";
        const keyParts = keyPartsOf(saved);
        return <li key={saved.id}>
          <button type="button" onClick={() => onOpenSavedBuild?.(saved)} disabled={!onOpenSavedBuild} aria-label={`${saved.name} 열기${unread > 0 ? `, 새 알림 ${unread}건` : ""}`}>
            <span className="home-saved-prices-name">
              <strong>{saved.name}{unread > 0 && <em className="home-saved-lobby-badge">알림 {unread > 99 ? "99+" : unread}</em>}</strong>
              <small>{new Date(saved.updatedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} 저장{keyParts ? ` / ${keyParts}` : ""}</small>
            </span>
            <span className="home-saved-prices-now">{currentTotal !== undefined ? `${currentTotal.toLocaleString("ko-KR")}원` : prices ? "가격 일부 없음" : "확인 중"}{savedTotal !== undefined && <small>저장 {savedTotal.toLocaleString("ko-KR")}원</small>}</span>
            <span className={`home-saved-prices-delta ${tone}`}>{delta === undefined ? "-" : delta === 0 ? "변동 없음" : `${delta < 0 ? "▼" : "▲"} ${Math.abs(delta).toLocaleString("ko-KR")}원`}</span>
          </button>
        </li>;
      })}
    </ul>
    {hiddenCount > 0 && <button className="home-saved-lobby-more" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? <>접기 <FiChevronUp aria-hidden="true" /></> : <>{hiddenCount}개 더 보기 <FiChevronDown aria-hidden="true" /></>}</button>}
  </section>;
}
