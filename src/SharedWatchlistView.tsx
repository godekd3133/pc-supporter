import { useEffect, useRef, useState } from "react";
import { FiArrowLeft, FiClock, FiDownload, FiExternalLink, FiInfo, FiLoader, FiRefreshCw, FiShare2, FiXCircle } from "react-icons/fi";
import type { AccessoryItem, Part } from "../shared/types";
import { isKnownPrice } from "../shared/types";
import type { CatalogWatchEntry } from "../shared/catalog-watchlist";
import { priceWatchDecisionCountsFor, priceWatchDecisionFor } from "../shared/price-watch-decision";
import type { PriceWatchDecisionHistory, PriceWatchDecisionState } from "../shared/price-watch-decision";
import { ApiError, api } from "./api";
import { priceAlertPolicyText } from "./price-alerts";
import type { PriceAlertPolicy } from "./price-alerts";
import { safeExternalUrl } from "./safe-source-url";

export type SavedCatalogWatchlist = {
  id: string;
  name: string;
  entries: CatalogWatchEntry[];
  nearLowThresholdPercent: 5 | 10 | 20;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  alertPreferences?: PriceAlertPolicy;
};

type SharedWatchlistPriceHistory = {
  kind: "part" | "accessory";
  itemId: string;
  windowDays: 7 | 30 | 90;
  points: Array<{ changeId: string; changedAt: string; priceWon: number; deltaWon?: number }>;
  summary: PriceWatchDecisionHistory;
};

type SharedWatchlistLivePrice = {
  priceWon?: number;
  status: "available" | "unavailable" | "error";
  sourceUrl?: string;
};

type SharedWatchlistPriceHistoryWindow = 7 | 30 | 90;

const SHARED_WATCHLIST_DECISION_LABELS: Record<PriceWatchDecisionState, string> = { target: "목표가 도달", buy: "구매 검토", wait: "하락 대기", observe: "재상승 관찰", tracking: "목표가 관찰 중", unavailable: "가격 확인 필요", error: "확인 오류" };

function sharedWatchlistDecisionStatesFor(saved: SavedCatalogWatchlist, livePrices: Record<string, SharedWatchlistLivePrice>, priceHistories: Record<string, SharedWatchlistPriceHistory>) {
  return Object.fromEntries(saved.entries.map((entry) => {
    const key = entry.kind + ":" + entry.itemId;
    const live = livePrices[key];
    const history = priceHistories[key];
    return [key, priceWatchDecisionFor({ currentStatus: live?.status ?? "unknown", currentPriceWon: live?.priceWon, targetPriceWon: entry.targetPriceWon, nearLowThresholdPercent: saved.nearLowThresholdPercent, history: history?.summary }).state];
  }));
}

function formatWon(value: number | undefined) {
  return isKnownPrice(value) ? value.toLocaleString("ko-KR") + "원" : "가격 확인 필요";
}

function historyBarHeight(history: SharedWatchlistPriceHistory, priceWon: number) {
  const prices = history.points.map((point) => point.priceWon);
  const minPriceWon = Math.min(...prices);
  const maxPriceWon = Math.max(...prices);
  if (maxPriceWon === minPriceWon) return 52;
  return 18 + ((priceWon - minPriceWon) / (maxPriceWon - minPriceWon)) * 82;
}

export function SharedWatchlistView({ onBack, onImport }: { onBack: () => void; onImport: (saved: SavedCatalogWatchlist) => void }) {
  const [saved, setSaved] = useState<SavedCatalogWatchlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [livePrices, setLivePrices] = useState<Record<string, SharedWatchlistLivePrice>>({});
  const [livePriceLoading, setLivePriceLoading] = useState(false);
  const [livePriceCheckedAt, setLivePriceCheckedAt] = useState<string | null>(null);
  const [priceHistories, setPriceHistories] = useState<Record<string, SharedWatchlistPriceHistory>>({});
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);
  const [priceHistoryError, setPriceHistoryError] = useState<string | null>(null);
  const [priceHistoryRefreshNonce, setPriceHistoryRefreshNonce] = useState(0);
  const [priceHistoryDays, setPriceHistoryDays] = useState<SharedWatchlistPriceHistoryWindow>(30);
  const livePriceRequestVersionRef = useRef(0);
  const livePriceAbortControllerRef = useRef<AbortController | null>(null);
  const watchlistId = window.location.pathname.split("/").filter(Boolean).at(-1) ?? "";
  const decisionCounts = saved ? priceWatchDecisionCountsFor(sharedWatchlistDecisionStatesFor(saved, livePrices, priceHistories)) : null;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    livePriceRequestVersionRef.current += 1;
    setLoading(true);
    setError(null);
    setSaved(null);
    setLivePrices({});
    setLivePriceLoading(false);
    setLivePriceCheckedAt(null);
    setPriceHistories({});
    setPriceHistoryError(null);
    void api<SavedCatalogWatchlist>("/api/watchlists/" + encodeURIComponent(watchlistId), { signal: controller.signal })
      .then((value) => { if (!cancelled) setSaved(value); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "공유 관심 가격 목록을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); livePriceAbortControllerRef.current?.abort(); livePriceAbortControllerRef.current = null; livePriceRequestVersionRef.current += 1; };
  }, [retryNonce, watchlistId]);

  useEffect(() => {
    let cancelled = false;
    if (!saved || saved.entries.length === 0) {
      setPriceHistories({});
      setPriceHistoryError(null);
      setPriceHistoryLoading(false);
      return () => { cancelled = true; };
    }
    setPriceHistoryLoading(true);
    setPriceHistoryError(null);
    const ids = saved.entries.map((entry) => entry.kind + ":" + entry.itemId).join(",");
    const controller = new AbortController();
    void api<{ items: SharedWatchlistPriceHistory[] }>("/api/price-history?ids=" + encodeURIComponent(ids) + "&days=" + priceHistoryDays, { retry: 1, signal: controller.signal })
      .then((payload) => { if (!cancelled) setPriceHistories(Object.fromEntries(payload.items.map((item) => [item.kind + ":" + item.itemId, item]))); })
      .catch((reason: unknown) => { if (!cancelled) { setPriceHistories({}); setPriceHistoryError(reason instanceof Error ? reason.message : "가격 이력을 확인하지 못했습니다."); } })
      .finally(() => { if (!cancelled) setPriceHistoryLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [priceHistoryDays, priceHistoryRefreshNonce, saved?.id]);

  async function refreshLivePrices() {
    if (!saved || livePriceLoading) return;
    const requestVersion = ++livePriceRequestVersionRef.current;
    const controller = new AbortController();
    livePriceAbortControllerRef.current = controller;
    setLivePriceLoading(true);
    try {
      const entries = await Promise.all(saved.entries.map(async (entry) => {
        try {
          const endpoint = entry.kind === "accessory" ? "/api/accessories/" + encodeURIComponent(entry.itemId) : "/api/parts/" + encodeURIComponent(entry.itemId);
          const item = await api<Part | AccessoryItem>(endpoint, { signal: controller.signal });
          const sourceUrl = safeExternalUrl(item.danawaUrl);
          const status = isKnownPrice(item.priceWon) ? "available" : "unavailable";
          return [entry.kind + ":" + entry.itemId, { priceWon: item.priceWon, status, ...(sourceUrl ? { sourceUrl } : {}) }] as const;
        } catch (reason: unknown) {
          const status = reason instanceof ApiError && reason.status === 404 ? "unavailable" : "error";
          return [entry.kind + ":" + entry.itemId, { status }] as const;
        }
      }));
      if (livePriceRequestVersionRef.current !== requestVersion) return;
      setLivePrices(Object.fromEntries(entries));
      setLivePriceCheckedAt(new Date().toISOString());
      setPriceHistoryRefreshNonce((current) => current + 1);
    } finally {
      if (livePriceAbortControllerRef.current === controller) livePriceAbortControllerRef.current = null;
      if (livePriceRequestVersionRef.current === requestVersion) setLivePriceLoading(false);
    }
  }

  return <div className="shared-watchlist-page"><div className="workspace-heading"><div><button className="back-link" type="button" onClick={onBack}><FiArrowLeft /> 홈으로</button><p className="eyebrow">SHARED WATCHLIST</p><h1>{saved?.name ?? (loading ? "관심 가격 목록을 불러오는 중" : "공유 관심 가격 목록")}</h1><p>저장 시점의 관심 항목과 목표가를 확인하고 내 관심 목록에 병합할 수 있습니다.</p></div><span className="admin-badge"><FiShare2 /> 저장된 스냅샷</span></div>{loading ? <div className="shared-watchlist-state"><FiLoader className="spin" /> 공유 관심 가격 목록을 불러오는 중...</div> : error ? <div className="shared-watchlist-state error" role="alert"><FiXCircle /><span>{error}</span><div className="shared-watchlist-error-actions"><button className="button button-light" type="button" data-testid="shared-watchlist-retry" onClick={() => setRetryNonce((current) => current + 1)}><FiRefreshCw /> 다시 시도</button><button className="text-button" type="button" onClick={onBack}>홈으로</button></div></div> : saved && <section className="shared-watchlist-card"><div className="shared-watchlist-card-heading"><div><p className="eyebrow">WATCHLIST SNAPSHOT</p><h2>{saved.name}</h2><small>저장 {new Date(saved.createdAt).toLocaleString("ko-KR")} · 수정 {new Date(saved.updatedAt).toLocaleString("ko-KR")} · 최저가 근접 기준 {saved.nearLowThresholdPercent}% · 알림 {priceAlertPolicyText(saved.alertPreferences)} · {saved.expiresAt ? "만료 " + new Date(saved.expiresAt).toLocaleString("ko-KR") : "무기한"}</small></div><div className="shared-watchlist-card-actions"><button className="button button-secondary" type="button" onClick={() => void refreshLivePrices()} disabled={livePriceLoading}>{livePriceLoading ? <><FiLoader className="spin" /> 확인 중...</> : <><FiRefreshCw /> 현재 가격 다시 확인</>}</button><button className="button button-primary" type="button" onClick={() => onImport(saved)}><FiDownload /> 내 관심 목록에 추가</button></div></div>{livePriceCheckedAt && <p className="shared-watchlist-live-status"><FiClock /> 현재 가격 확인 {new Date(livePriceCheckedAt).toLocaleString("ko-KR")}{priceHistoryLoading ? " · 가격 이력 확인 중..." : priceHistoryError ? " · 가격 이력 확인 실패" : " · 가격 이력 " + priceHistoryDays + "일 반영"}</p>}{saved && <div className="shared-watchlist-history-controls"><label><span>가격 이력 기간</span><select aria-label="공유 가격 이력 기간" value={priceHistoryDays} onChange={(event) => setPriceHistoryDays(Number(event.target.value) as SharedWatchlistPriceHistoryWindow)}><option value={7}>7일</option><option value={30}>30일</option><option value={90}>90일</option></select></label><small>기간을 바꿔도 저장된 공유 저장본과 개인 목록은 변경되지 않습니다.</small></div>}{priceHistoryError && <p className="shared-watchlist-price-history-error" role="alert"><FiXCircle /> {priceHistoryError}</p>}{decisionCounts && <div className="price-watchlist-decision-overview shared-watchlist-decision-overview" aria-label="공유 목록 현재 판단 분포" data-testid="shared-watchlist-decision-overview"><strong>현재 판단 분포</strong><div>{(Object.keys(SHARED_WATCHLIST_DECISION_LABELS) as PriceWatchDecisionState[]).map((state) => <span className={state} key={state}>{SHARED_WATCHLIST_DECISION_LABELS[state]} <b>{decisionCounts[state]}</b></span>)}</div></div>}<div className="shared-watchlist-entries">{saved.entries.map((entry) => { const key = entry.kind + ":" + entry.itemId; const live = livePrices[key]; const history = priceHistories[key]; const decision = priceWatchDecisionFor({ currentStatus: live?.status ?? "unknown", currentPriceWon: live?.priceWon, targetPriceWon: entry.targetPriceWon, nearLowThresholdPercent: saved.nearLowThresholdPercent, history: history?.summary }); const targetGapWon = live?.status === "available" && live.priceWon !== undefined && entry.targetPriceWon !== undefined && live.priceWon > entry.targetPriceWon ? live.priceWon - entry.targetPriceWon : undefined; return <article className="shared-watchlist-entry" key={key}><div><span>{entry.kind === "accessory" ? "주변 부품" : "핵심 부품"} · {entry.category}</span><strong>{entry.itemName}</strong><small>{entry.itemId}</small></div><div className="shared-watchlist-entry-prices"><div>{entry.targetPriceWon !== undefined ? <><span>목표가</span><strong>{entry.targetPriceWon.toLocaleString("ko-KR")}원</strong></> : <span>목표가 미설정</span>}</div><div className="shared-watchlist-entry-current"><span>현재 가격</span>{live?.status === "available" ? <strong>{live.priceWon !== undefined ? live.priceWon.toLocaleString("ko-KR") + "원" : "가격 확인 필요"}</strong> : live?.status === "unavailable" ? <strong>가격 확인 불가</strong> : live?.status === "error" ? <strong>일시 확인 오류</strong> : <strong>미확인</strong>}{live?.sourceUrl && <a className="shared-watchlist-source-link" href={live.sourceUrl} target="_blank" rel="noreferrer">원문 보기 <FiExternalLink /></a>}<em className={"shared-watchlist-decision " + decision.state} data-testid="shared-watchlist-decision">{decision.label}</em><small className="shared-watchlist-decision-summary">{decision.summary}</small>{targetGapWon !== undefined && <small className="shared-watchlist-target-gap">목표가까지 +{formatWon(targetGapWon)}</small>}{history && history.summary.sampleCount >= 2 && <div className="shared-watchlist-history" data-testid="shared-watchlist-price-history"><small className="shared-watchlist-history-summary">최근 {history.windowDays}일 {history.summary.sampleCount}회 · {history.summary.minPriceWon !== undefined ? "최저 " + formatWon(history.summary.minPriceWon) : "최저가 확인 필요"}{history.summary.currentPositionPercent !== undefined ? " · 현재 위치 " + history.summary.currentPositionPercent.toFixed(1) + "%" : ""}</small>{history.points.length > 0 && <div className="price-watchlist-sparkline" role="img" aria-label={entry.itemName + " 최근 " + history.windowDays + "일 공유 가격 추세"}>{history.points.map((point) => <span key={point.changeId} style={{ height: historyBarHeight(history, point.priceWon) + "%" }} title={point.priceWon.toLocaleString("ko-KR") + "원"} />)}</div>}</div>}</div></div></article>; })}</div><p className="shared-watchlist-note"><FiInfo /> 저장된 목록과 현재 가격·가격 이력 재조회를 분리해서 표시합니다. 목표가·가격 하락 알림 설정은 이 목록에 저장되어 서버 알림함과 가격 추적 화면에 함께 적용됩니다. 결정 상태는 현재가·목표가·공유 화면의 확인된 가격 이력으로 보수적으로 계산하며, 주문·재고·배송을 확정하지 않습니다. 내 목록에 추가하면 데이터 센터에서 전체 신호를 다시 계산합니다.</p></section>}</div>;
}
