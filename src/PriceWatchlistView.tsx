import { useEffect, useRef, useState } from "react";
import { FiArrowLeft, FiBell, FiCheck, FiClock, FiExternalLink, FiInfo, FiLoader, FiPlus, FiRefreshCw, FiSearch, FiServer, FiTag, FiTrash2, FiXCircle } from "react-icons/fi";
import type { AccessoryCategory, AccessoryItem, Part, PartCategory } from "../shared/types";
import { ACCESSORY_CATEGORIES, ACCESSORY_CATEGORY_LABELS, CATEGORY_LABELS, isKnownPrice, PART_CATEGORIES } from "../shared/types";
import { addCatalogWatchEntry, catalogWatchlistContains, catalogWatchlistFromJson, catalogWatchlistToJson, removeCatalogWatchEntry, updateCatalogWatchEntry } from "../shared/catalog-watchlist";
import type { CatalogWatchEntry } from "../shared/catalog-watchlist";
import { ApiError, api } from "./api";
import { DEFAULT_PRICE_ALERT_POLICY, PRICE_ALERT_DROP_THRESHOLDS, priceAlertPolicyFromUnknown, priceAlertPolicyText, priceAlertsFor } from "./price-alerts";
import type { PriceAlertPolicy, PriceObservation, PriceWatchAlert } from "./price-alerts";
import { autoRefreshEnabledFromStorage, autoRefreshMinutesFromStorage, priceAlertsFromJson, priceAlertsToJson, priceBaselineFromJson, priceBaselineToJson } from "./price-monitor-storage";
import { savedWatchlistLinksFromJson, savedWatchlistLinksToJson } from "./watchlist-link-storage";
import type { SavedWatchlistLink } from "./watchlist-link-storage";
import { safeExternalUrl } from "./safe-source-url";
import { recommendedTargetPriceFromHistory } from "./price-target";
import { priceWatchEntriesFor } from "./price-watchlist-view";
import type { PriceWatchSort, PriceWatchStatusFilter } from "./price-watchlist-view";

const CATALOG_WATCHLIST_STORAGE_KEY = "pc-supporter-catalog-watchlist";
const CATALOG_WATCH_THRESHOLD_STORAGE_KEY = "pc-supporter-catalog-watch-threshold";
const SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY = "pc-supporter-saved-watchlist-owner-tokens";
const SAVED_WATCHLIST_LINK_STORAGE_KEY = "pc-supporter-saved-watchlist-link";
const PRICE_MONITOR_BASELINE_STORAGE_KEY = "pc-supporter-price-monitor-baseline";
const PRICE_MONITOR_ALERTS_STORAGE_KEY = "pc-supporter-price-monitor-alerts";
const PRICE_MONITOR_AUTO_REFRESH_STORAGE_KEY = "pc-supporter-price-monitor-auto-refresh";
const PRICE_MONITOR_INTERVAL_STORAGE_KEY = "pc-supporter-price-monitor-interval";
const PRICE_ALERT_POLICY_STORAGE_KEY = "pc-supporter-price-alert-policy";
const PRICE_HISTORY_WINDOW_STORAGE_KEY = "pc-supporter-price-history-window";
const WATCH_THRESHOLDS = [5, 10, 20] as const;
type WatchThreshold = (typeof WATCH_THRESHOLDS)[number];
const PRICE_HISTORY_WINDOWS = [7, 30, 90] as const;
type PriceHistoryWindow = (typeof PRICE_HISTORY_WINDOWS)[number];
type ShareExpiryDays = "keep" | "never" | 7 | 30;
type SavedWatchlist = {
  id: string;
  name: string;
  entries: CatalogWatchEntry[];
  nearLowThresholdPercent: WatchThreshold;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  alertPreferences?: PriceAlertPolicy;
};
type SavedWatchlistCreateResponse = SavedWatchlist & { ownerToken: string };
type LivePrice = { priceWon?: number; status: "available" | "unavailable" | "error"; sourceUrl?: string };
type PublicPriceHistoryItem = {
  kind: "part" | "accessory";
  itemId: string;
  windowDays: number;
  points: Array<{ changeId: string; changedAt: string; priceWon: number; deltaWon?: number }>;
  summary: {
    sampleCount: number;
    latestPriceWon?: number;
    minPriceWon?: number;
    maxPriceWon?: number;
    fromHighPercent?: number;
    currentPositionPercent?: number;
    hasDropThenRebound: boolean;
  };
};

function formatWon(value: number | undefined) {
  return isKnownPrice(value) ? value.toLocaleString("ko-KR") + "원" : "가격 확인 필요";
}

function priceAlertPolicyFromStorage(raw: string | null): PriceAlertPolicy {
  if (!raw) return DEFAULT_PRICE_ALERT_POLICY;
  try {
    return priceAlertPolicyFromUnknown(JSON.parse(raw));
  } catch {
    return DEFAULT_PRICE_ALERT_POLICY;
  }
}

function shareExpiryPayloadFor(value: ShareExpiryDays) {
  return value === "never" || value === "keep" ? undefined : value;
}

function priceHistoryWindowFromStorage(raw: string | null): PriceHistoryWindow {
  const value = Number(raw);
  return value === 7 || value === 30 || value === 90 ? value : 30;
}

function PriceWatchlistEntryFilters({ query, status, sort, total, visible, onQueryChange, onStatusChange, onSortChange }: { query: string; status: PriceWatchStatusFilter; sort: PriceWatchSort; total: number; visible: number; onQueryChange: (value: string) => void; onStatusChange: (value: PriceWatchStatusFilter) => void; onSortChange: (value: PriceWatchSort) => void }) {
  return <div className="price-watchlist-entry-filters" aria-label="가격 추적 목록 도구"><label><span>목록 검색</span><input aria-label="가격 추적 목록 검색" type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="부품명·ID·분류" /></label><label><span>상태</span><select aria-label="가격 추적 목록 상태" value={status} onChange={(event) => onStatusChange(event.target.value as PriceWatchStatusFilter)}><option value="all">모든 항목</option><option value="alerts">알림 있음</option><option value="available">가격 확인 가능</option><option value="unavailable">가격 확인 불가</option><option value="error">일시 조회 오류</option></select></label><label><span>정렬</span><select aria-label="가격 추적 목록 정렬" value={sort} onChange={(event) => onSortChange(event.target.value as PriceWatchSort)}><option value="added_desc">최근 등록</option><option value="price_asc">현재가 낮은 순</option><option value="price_desc">현재가 높은 순</option><option value="target_gap_asc">목표가 차액 순</option></select></label><span className="price-watchlist-entry-count">{visible} / {total}개</span></div>;
}

function PriceAlertPreferencesPanel({ value, onChange, disabled }: { value: PriceAlertPolicy; onChange: (next: PriceAlertPolicy) => void; disabled: boolean }) {
  return <div className="price-watchlist-alert-preferences" aria-label="가격 추적 알림 설정"><div className="price-watchlist-alert-preferences-heading"><div><strong>가격 알림 조건</strong><small>현재가 새로고침과 새로 저장하는 서버 목록에 함께 적용됩니다.</small></div><span>{priceAlertPolicyText(value)}</span></div><div className="price-watchlist-alert-preferences-controls"><label><input type="checkbox" aria-label="가격 추적 목표가 도달 알림" checked={value.targetReached} onChange={(event) => onChange({ ...value, targetReached: event.target.checked })} disabled={disabled} /><span>목표가 도달 알림</span></label><label><input type="checkbox" aria-label="가격 추적 가격 하락 알림" checked={value.priceDrop} onChange={(event) => onChange({ ...value, priceDrop: event.target.checked })} disabled={disabled} /><span>가격 하락 알림</span></label><label><input type="checkbox" aria-label="가격 추적 가격 확인 상태 알림" checked={value.priceAvailability} onChange={(event) => onChange({ ...value, priceAvailability: event.target.checked })} disabled={disabled} /><span>가격 확인 상태 알림</span></label><label><span>하락 알림 최소 변동</span><select aria-label="가격 추적 하락 알림 최소 변동" value={value.minimumDropPercent} onChange={(event) => onChange({ ...value, minimumDropPercent: Number(event.target.value) as PriceAlertPolicy["minimumDropPercent"] })} disabled={disabled || !value.priceDrop}>{PRICE_ALERT_DROP_THRESHOLDS.map((threshold) => <option value={threshold} key={threshold}>{threshold === 0 ? "모든 하락" : threshold + "% 이상"}</option>)}</select></label></div></div>;
}

function readOwnerTokens() {
  try {
    const raw = window.localStorage.getItem(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {} as Record<string, string>;
    const entries = Object.entries(parsed).filter((row): row is [string, string] => typeof row[0] === "string" && typeof row[1] === "string" && row[1].length >= 40).slice(0, 20);
    return Object.fromEntries(entries);
  } catch {
    return {} as Record<string, string>;
  }
}

function writeOwnerTokens(tokens: Record<string, string>) {
  try {
    window.localStorage.setItem(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(tokens).slice(0, 20))));
  } catch {
    // A full local storage bucket must not prevent price tracking from working.
  }
}

function readSavedLinks() {
  return savedWatchlistLinksFromJson(window.localStorage.getItem(SAVED_WATCHLIST_LINK_STORAGE_KEY));
}

function writeSavedLinks(links: SavedWatchlistLink[]) {
  try {
    if (links.length > 0) window.localStorage.setItem(SAVED_WATCHLIST_LINK_STORAGE_KEY, savedWatchlistLinksToJson(links));
    else window.localStorage.removeItem(SAVED_WATCHLIST_LINK_STORAGE_KEY);
  } catch {
    // A full local storage bucket must not prevent price tracking from working.
  }
}

export function PriceWatchlistView({ onBack, onToast }: { onBack: () => void; onToast: (message: string) => void }) {
  const [kind, setKind] = useState<"part" | "accessory">("part");
  const [partCategory, setPartCategory] = useState<PartCategory>("cpu");
  const [accessoryCategory, setAccessoryCategory] = useState<AccessoryCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Array<Part | AccessoryItem>>([]);
  const [total, setTotal] = useState(0);
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchRetryNonce, setSearchRetryNonce] = useState(0);
  const [searchLoading, setSearchLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [watchEntries, setWatchEntries] = useState<CatalogWatchEntry[]>(() => typeof window === "undefined" ? [] : catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)));
  const [watchListQuery, setWatchListQuery] = useState("");
  const [watchListStatus, setWatchListStatus] = useState<PriceWatchStatusFilter>("all");
  const [watchListSort, setWatchListSort] = useState<PriceWatchSort>("added_desc");
  const [currentPrices, setCurrentPrices] = useState<Record<string, LivePrice>>({});
  const [priceHistories, setPriceHistories] = useState<Record<string, PublicPriceHistoryItem>>({});
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceRefreshNonce, setPriceRefreshNonce] = useState(0);
  const [priceCheckedAt, setPriceCheckedAt] = useState<string | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() => typeof window !== "undefined" && autoRefreshEnabledFromStorage(window.localStorage.getItem(PRICE_MONITOR_AUTO_REFRESH_STORAGE_KEY)));
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState<5 | 15 | 30>(() => typeof window === "undefined" ? 15 : autoRefreshMinutesFromStorage(window.localStorage.getItem(PRICE_MONITOR_INTERVAL_STORAGE_KEY)));
  const [priceAlerts, setPriceAlerts] = useState<PriceWatchAlert[]>(() => typeof window === "undefined" ? [] : priceAlertsFromJson(window.localStorage.getItem(PRICE_MONITOR_ALERTS_STORAGE_KEY)));
  const [alertPreferences, setAlertPreferences] = useState<PriceAlertPolicy>(() => typeof window === "undefined" ? DEFAULT_PRICE_ALERT_POLICY : priceAlertPolicyFromStorage(window.localStorage.getItem(PRICE_ALERT_POLICY_STORAGE_KEY)));
  const [priceHistoryDays, setPriceHistoryDays] = useState<PriceHistoryWindow>(() => typeof window === "undefined" ? 30 : priceHistoryWindowFromStorage(window.localStorage.getItem(PRICE_HISTORY_WINDOW_STORAGE_KEY)));
  const previousPricesRef = useRef<Record<string, PriceObservation>>(typeof window === "undefined" ? {} : priceBaselineFromJson(window.localStorage.getItem(PRICE_MONITOR_BASELINE_STORAGE_KEY)));
  const [watchThreshold, setWatchThreshold] = useState<WatchThreshold>(() => {
    if (typeof window === "undefined") return 10;
    const value = Number(window.localStorage.getItem(CATALOG_WATCH_THRESHOLD_STORAGE_KEY));
    return value === 5 || value === 10 || value === 20 ? value : 10;
  });
  const [watchlistName, setWatchlistName] = useState("내 가격 추적 목록");
  const [watchlistExpiryDays, setWatchlistExpiryDays] = useState<ShareExpiryDays>("never");
  const [savingWatchlist, setSavingWatchlist] = useState(false);
  const [updatingWatchlist, setUpdatingWatchlist] = useState(false);
  const [revokingWatchlist, setRevokingWatchlist] = useState(false);
  const [savedLinks, setSavedLinks] = useState<SavedWatchlistLink[]>(() => typeof window === "undefined" ? [] : readSavedLinks());
  const savedLink = savedLinks[0] ?? null;
  const [editingSavedLinkId, setEditingSavedLinkId] = useState<string | null>(null);

  useEffect(() => { window.localStorage.setItem(CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistToJson(watchEntries)); }, [watchEntries]);
  useEffect(() => { window.localStorage.setItem(CATALOG_WATCH_THRESHOLD_STORAGE_KEY, String(watchThreshold)); }, [watchThreshold]);
  useEffect(() => { writeSavedLinks(savedLinks); }, [savedLinks]);
  useEffect(() => { window.localStorage.setItem(PRICE_MONITOR_ALERTS_STORAGE_KEY, priceAlertsToJson(priceAlerts)); }, [priceAlerts]);
  useEffect(() => { window.localStorage.setItem(PRICE_MONITOR_AUTO_REFRESH_STORAGE_KEY, String(autoRefreshEnabled)); }, [autoRefreshEnabled]);
  useEffect(() => { window.localStorage.setItem(PRICE_MONITOR_INTERVAL_STORAGE_KEY, String(autoRefreshMinutes)); }, [autoRefreshMinutes]);
  useEffect(() => { window.localStorage.setItem(PRICE_ALERT_POLICY_STORAGE_KEY, JSON.stringify(alertPreferences)); }, [alertPreferences]);
  useEffect(() => { window.localStorage.setItem(PRICE_HISTORY_WINDOW_STORAGE_KEY, String(priceHistoryDays)); }, [priceHistoryDays]);
  useEffect(() => {
    if (savedLinks.length === 0) return;
    let cancelled = false;
    void Promise.all(savedLinks.map(async (link) => {
      try {
        const saved = await api<SavedWatchlist>("/api/watchlists/" + encodeURIComponent(link.id));
        const { expiresAt: _linkExpiresAt, alertPreferences: _linkAlertPreferences, ...linkWithoutMutableMetadata } = link;
        return { ...linkWithoutMutableMetadata, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt, ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), alertPreferences: priceAlertPolicyFromUnknown(saved.alertPreferences) };
      } catch (error: unknown) {
        if (error instanceof Error && /(찾을 수|만료)/.test(error.message)) {
          const tokens = readOwnerTokens();
          delete tokens[link.id];
          writeOwnerTokens(tokens);
          return null;
        }
        return link;
      }
    })).then((next) => {
      if (cancelled) return;
      const normalized = next.filter((link): link is SavedWatchlistLink => link !== null);
      if (JSON.stringify(normalized) !== JSON.stringify(savedLinks)) setSavedLinks(normalized);
    });
    return () => { cancelled = true; };
  }, [savedLinks.map((link) => link.id).join(",")]);
  useEffect(() => {
    if (!savedLink) return;
    const token = readOwnerTokens()[savedLink.id];
    if (!token) return;
    let cancelled = false;
    void api<{ items: PriceWatchAlert[]; alertPreferences?: PriceAlertPolicy }>("/api/watchlists/" + encodeURIComponent(savedLink.id) + "/alerts", { headers: { "X-Share-Owner-Token": token } }).then((payload) => {
      if (cancelled) return;
      if (payload.alertPreferences) setAlertPreferences(priceAlertPolicyFromUnknown(payload.alertPreferences));
      setPriceAlerts((current) => {
        const merged = new Map<string, PriceWatchAlert>();
        current.concat(payload.items).forEach((alert) => merged.set(alert.id, alert));
        return [...merged.values()].slice(0, 20);
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [savedLink?.id]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError(null);
      const params = new URLSearchParams({ q: query, limit: "24", offset: String(searchOffset), sort: "price_asc" });
      const request = kind === "part"
        ? api<{ items: Part[]; total: number }>("/api/parts?category=" + encodeURIComponent(partCategory) + "&" + params.toString() + "&listingPolicy=all")
        : api<{ items: AccessoryItem[]; total: number }>("/api/accessories?category=" + encodeURIComponent(accessoryCategory) + "&" + params.toString() + "&priceFilter=all");
      void request.then((payload) => {
        if (cancelled) return;
        setItems((current) => searchOffset === 0 ? payload.items : current.concat(payload.items.filter((item) => !current.some((existing) => existing.id === item.id))));
        setTotal(payload.total);
      }).catch((reason: unknown) => {
        if (!cancelled) setSearchError(reason instanceof Error ? reason.message : "부품 검색에 실패했습니다.");
      }).finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [accessoryCategory, kind, partCategory, query, searchOffset, searchRetryNonce]);
  useEffect(() => {
    let cancelled = false;
    if (watchEntries.length === 0) {
      setCurrentPrices({});
      setPriceCheckedAt(null);
      previousPricesRef.current = {};
      window.localStorage.removeItem(PRICE_MONITOR_BASELINE_STORAGE_KEY);
      setPriceAlerts([]);
      return;
    }
    setPriceLoading(true);
    void (async () => {
      const results: Array<readonly [string, LivePrice]> = [];
      for (let index = 0; index < watchEntries.length; index += 6) {
        const batch = await Promise.all(watchEntries.slice(index, index + 6).map(async (entry) => {
          try {
            const endpoint = entry.kind === "accessory" ? "/api/accessories/" + encodeURIComponent(entry.itemId) : "/api/parts/" + encodeURIComponent(entry.itemId);
            const item = await api<Part | AccessoryItem>(endpoint);
            const sourceUrl = safeExternalUrl(item.danawaUrl);
            const status = isKnownPrice(item.priceWon) ? "available" : "unavailable";
            return [entry.kind + ":" + entry.itemId, { priceWon: item.priceWon, status, ...(sourceUrl ? { sourceUrl } : {}) }] as const;
          } catch (error: unknown) {
            const status = error instanceof ApiError && error.status === 404 ? "unavailable" : "error";
            return [entry.kind + ":" + entry.itemId, { status }] as const;
          }
        }));
        results.push(...batch);
      }
      if (!cancelled) {
        const nextPrices = Object.fromEntries(results);
        const previousPrices = previousPricesRef.current;
        const refreshedAt = new Date().toISOString();
        const nextAlerts = priceAlertsFor(watchEntries.map((entry) => ({ itemKey: entry.kind + ":" + entry.itemId, itemName: entry.itemName, targetPriceWon: entry.targetPriceWon })), previousPrices, nextPrices, refreshedAt, alertPreferences);
        const nextBaseline: Record<string, PriceObservation> = {};
        watchEntries.forEach((entry) => {
          const key = entry.kind + ":" + entry.itemId;
          const observation = nextPrices[key];
          if (!observation || observation.status === "error") {
            const previous = previousPrices[key];
            if (previous) nextBaseline[key] = previous;
          } else {
            nextBaseline[key] = observation;
          }
        });
        previousPricesRef.current = nextBaseline;
        window.localStorage.setItem(PRICE_MONITOR_BASELINE_STORAGE_KEY, priceBaselineToJson(nextBaseline));
        setCurrentPrices(nextPrices);
        setPriceCheckedAt(refreshedAt);
        if (nextAlerts.length > 0) {
          setPriceAlerts((current) => nextAlerts.concat(current).slice(0, 20));
          onToast("가격 알림: " + nextAlerts[0].message);
        }
        setPriceLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [alertPreferences, priceRefreshNonce, watchEntries]);
  useEffect(() => {
    if (!autoRefreshEnabled || watchEntries.length === 0) return;
    const timer = window.setInterval(() => setPriceRefreshNonce((current) => current + 1), autoRefreshMinutes * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefreshEnabled, autoRefreshMinutes, watchEntries.length]);
  useEffect(() => {
    let cancelled = false;
    if (watchEntries.length === 0) {
      setPriceHistories({});
      return;
    }
    const ids = watchEntries.map((entry) => entry.kind + ":" + entry.itemId).join(",");
    void api<{ items: PublicPriceHistoryItem[] }>("/api/price-history?ids=" + encodeURIComponent(ids) + "&days=" + priceHistoryDays).then((payload) => {
      if (!cancelled) setPriceHistories(Object.fromEntries(payload.items.map((item) => [item.kind + ":" + item.itemId, item])));
    }).catch(() => {
      if (!cancelled) setPriceHistories({});
    });
    return () => { cancelled = true; };
  }, [priceHistoryDays, priceRefreshNonce, watchEntries]);

  function categoryLabel(item: Part | AccessoryItem) {
    return item.category in CATEGORY_LABELS ? CATEGORY_LABELS[item.category as PartCategory] : ACCESSORY_CATEGORY_LABELS[item.category as AccessoryCategory];
  }
  function qualityLabel(item: Part | AccessoryItem) {
    return item.dataQuality === "live" ? "다나와 최신" : item.dataQuality === "manual" ? "수동 검수" : item.dataQuality === "seed" ? "프로젝트 데이터" : "일부 정보 부족";
  }
  function entryKey(entry: Pick<CatalogWatchEntry, "kind" | "itemId">) {
    return entry.kind + ":" + entry.itemId;
  }
  function historySignals(entry: CatalogWatchEntry) {
    const summary = priceHistories[entryKey(entry)]?.summary;
    if (!summary || summary.sampleCount < 2) return [] as string[];
    return [
      ...(summary.currentPositionPercent !== undefined && summary.currentPositionPercent <= watchThreshold ? ["최저가 근접"] : []),
      ...(summary.fromHighPercent !== undefined && summary.fromHighPercent < 0 ? ["최고가 대비 하락"] : []),
      ...(summary.hasDropThenRebound ? ["하락 후 재상승"] : [])
    ];
  }
  function historyBarHeight(history: PublicPriceHistoryItem, priceWon: number) {
    const prices = history.points.map((point) => point.priceWon);
    const minPriceWon = Math.min(...prices);
    const maxPriceWon = Math.max(...prices);
    if (maxPriceWon === minPriceWon) return 52;
    return 18 + ((priceWon - minPriceWon) / (maxPriceWon - minPriceWon)) * 82;
  }
  const activeSignalCount = watchEntries.filter((entry) => {
    const live = currentPrices[entryKey(entry)];
    const targetReached = live?.status === "available" && live.priceWon !== undefined && entry.targetPriceWon !== undefined && live.priceWon <= entry.targetPriceWon;
    return targetReached || historySignals(entry).length > 0;
  }).length;
  const unreadAlertCount = priceAlerts.filter((alert) => !alert.readAt).length;
  const alertItemKeys = new Set(priceAlerts.map((alert) => alert.itemKey));
  const visibleWatchEntries = priceWatchEntriesFor(watchEntries, currentPrices, { query: watchListQuery, status: watchListStatus, sort: watchListSort, alertKeys: alertItemKeys });
  function resetWatchListView() {
    setWatchListQuery("");
    setWatchListStatus("all");
    setWatchListSort("added_desc");
  }
  function toggleWatch(item: Part | AccessoryItem) {
    const entry = { itemId: item.id, itemName: item.name, category: item.category, kind } as CatalogWatchEntry;
    const watched = catalogWatchlistContains(watchEntries, entry);
    setWatchEntries((current) => watched ? removeCatalogWatchEntry(current, entry) : addCatalogWatchEntry(current, { ...entry, addedAt: new Date().toISOString() }));
    onToast(watched ? item.name + "을(를) 가격 추적에서 제거했습니다." : item.name + "을(를) 가격 추적에 추가했습니다.");
  }
  function updateTarget(entry: CatalogWatchEntry, rawValue: string) {
    const targetPriceWon = rawValue.trim() === "" ? undefined : Number(rawValue);
    if (targetPriceWon !== undefined && (!Number.isFinite(targetPriceWon) || targetPriceWon <= 0)) return;
    setWatchEntries((current) => updateCatalogWatchEntry(current, entry, { targetPriceWon }));
  }
  function suggestTargetFromHistory(entry: CatalogWatchEntry, history: PublicPriceHistoryItem | undefined) {
    if (!history) return;
    const targetPriceWon = recommendedTargetPriceFromHistory(history.summary);
    if (targetPriceWon === undefined) return;
    setWatchEntries((current) => updateCatalogWatchEntry(current, entry, { targetPriceWon }));
    onToast(`${entry.itemName} 목표가를 최근 ${history.windowDays}일 최저가 ${formatWon(targetPriceWon)}로 설정했습니다.`);
  }
  async function saveWatchlist() {
    if (watchEntries.length === 0) {
      onToast("저장할 가격 추적 항목이 없습니다.");
      return;
    }
    setSavingWatchlist(true);
    try {
      const saved = await api<SavedWatchlistCreateResponse>("/api/watchlists", { method: "POST", body: JSON.stringify({ name: watchlistName.trim() || "내 가격 추적 목록", entries: watchEntries, nearLowThresholdPercent: watchThreshold, expiresInDays: shareExpiryPayloadFor(watchlistExpiryDays), alertPreferences }) });
      writeOwnerTokens({ [saved.id]: saved.ownerToken, ...readOwnerTokens() });
      const nextLink = { id: saved.id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt, ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), ...(saved.alertPreferences ? { alertPreferences: saved.alertPreferences } : {}) };
      const nextLinks = [nextLink, ...savedLinks.filter((link) => link.id !== saved.id)].slice(0, 20);
      setSavedLinks(nextLinks);
      setEditingSavedLinkId(saved.id);
      setWatchlistExpiryDays(saved.expiresAt ? "keep" : "never");
      writeSavedLinks(nextLinks);
      const url = window.location.origin + "/watchlist/" + saved.id;
      try {
        await navigator.clipboard.writeText(url);
        onToast("가격 추적 목록을 저장하고 공유 링크를 복사했습니다.");
      } catch {
        onToast("가격 추적 목록을 저장했습니다: " + url);
      }
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "가격 추적 목록을 저장하지 못했습니다.");
    } finally {
      setSavingWatchlist(false);
    }
  }
  async function loadWatchlistForEdit(id: string) {
    try {
      const saved = await api<SavedWatchlist>("/api/watchlists/" + encodeURIComponent(id));
      const target = savedLinks.find((link) => link.id === id);
      const { expiresAt: _targetExpiresAt, alertPreferences: _targetAlertPreferences, ...targetWithoutMutableMetadata } = target ?? { id };
      const loadedLink = target ? { ...targetWithoutMutableMetadata, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt, ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), alertPreferences: priceAlertPolicyFromUnknown(saved.alertPreferences) } : null;
      const nextLinks = loadedLink ? [loadedLink, ...savedLinks.filter((link) => link.id !== id)] : savedLinks;
      setSavedLinks(nextLinks);
      setEditingSavedLinkId(id);
      setWatchEntries(saved.entries);
      setWatchThreshold(saved.nearLowThresholdPercent);
      setAlertPreferences(priceAlertPolicyFromUnknown(saved.alertPreferences));
      setWatchlistName(saved.name);
      setWatchlistExpiryDays(saved.expiresAt ? "keep" : "never");
      onToast("이 서버 목록을 편집 대상으로 불러왔습니다. 수정 후 서버 목록 업데이트를 눌러 주세요.");
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "서버 가격 목록을 불러오지 못했습니다.");
    }
  }
  async function updateWatchlist() {
    if (!savedLink || editingSavedLinkId !== savedLink.id) {
      onToast("먼저 편집할 서버 가격 목록을 불러와 주세요.");
      return;
    }
    const token = readOwnerTokens()[savedLink.id];
    if (!token) {
      onToast("이 가격 추적 목록을 수정할 소유 토큰이 없습니다.");
      return;
    }
    if (watchEntries.length === 0) {
      onToast("서버 목록에는 하나 이상의 가격 추적 항목이 필요합니다.");
      return;
    }
    setUpdatingWatchlist(true);
    try {
      const saved = await api<SavedWatchlist>("/api/watchlists/" + encodeURIComponent(savedLink.id), { method: "PATCH", headers: { "X-Share-Owner-Token": token }, body: JSON.stringify({ name: watchlistName.trim() || "내 가격 추적 목록", entries: watchEntries, nearLowThresholdPercent: watchThreshold, alertPreferences, ...(watchlistExpiryDays !== "keep" ? { expiresInDays: watchlistExpiryDays === "never" ? null : watchlistExpiryDays } : {}) }) });
      const nextLinks = savedLinks.map((link) => {
        if (link.id !== saved.id) return link;
        const { expiresAt: _linkExpiresAt, alertPreferences: _linkAlertPreferences, ...linkWithoutMutableMetadata } = link;
        return { ...linkWithoutMutableMetadata, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt, ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), alertPreferences: priceAlertPolicyFromUnknown(saved.alertPreferences) };
      });
      setSavedLinks(nextLinks);
      setEditingSavedLinkId(saved.id);
      setWatchlistExpiryDays(saved.expiresAt ? "keep" : "never");
      onToast("기존 서버 가격 목록을 업데이트했습니다.");
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "서버 가격 목록을 업데이트하지 못했습니다.");
    } finally {
      setUpdatingWatchlist(false);
    }
  }
  async function revokeWatchlistById(id: string) {
    if (revokingWatchlist || updatingWatchlist) return;
    const token = readOwnerTokens()[id];
    if (!token) {
      onToast("이 가격 추적 목록을 취소할 소유 토큰이 없습니다.");
      return;
    }
    if (!window.confirm("이 가격 추적 공유 목록을 취소할까요? 전달된 링크도 더 이상 열리지 않습니다.")) return;
    setRevokingWatchlist(true);
    try {
      await api("/api/watchlists/" + encodeURIComponent(id), { method: "DELETE", headers: { "X-Share-Owner-Token": token } });
      const tokens = readOwnerTokens();
      delete tokens[id];
      writeOwnerTokens(tokens);
      const nextLinks = savedLinks.filter((link) => link.id !== id);
      setSavedLinks(nextLinks);
      if (editingSavedLinkId === id) setEditingSavedLinkId(null);
      writeSavedLinks(nextLinks);
      onToast("가격 추적 공유 목록을 취소했습니다.");
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "가격 추적 공유 목록을 취소하지 못했습니다.");
    } finally {
      setRevokingWatchlist(false);
    }
  }
  async function updateAlertStates(action: "read" | "dismiss") {
    if (priceAlerts.length === 0) return;
    const alertIds = priceAlerts.map((alert) => alert.id);
    const token = savedLink ? readOwnerTokens()[savedLink.id] : undefined;
    if (savedLink && token) {
      try {
        await api("/api/watchlists/" + encodeURIComponent(savedLink.id) + "/alerts/" + action, { method: "POST", headers: { "X-Share-Owner-Token": token }, body: JSON.stringify({ alertIds }) });
      } catch (error: unknown) {
        onToast(error instanceof Error ? error.message : "가격 알림 상태를 저장하지 못했습니다.");
        return;
      }
    }
    if (action === "dismiss") {
      setPriceAlerts([]);
      return;
    }
    const readAt = new Date().toISOString();
    setPriceAlerts((current) => current.map((alert) => ({ ...alert, readAt: alert.readAt ?? readAt })));
  }
  async function copySavedLink(id: string) {
    const url = window.location.origin + "/watchlist/" + id;
    try {
      await navigator.clipboard.writeText(url);
      onToast("가격 추적 공유 링크를 복사했습니다.");
    } catch {
      onToast("가격 추적 공유 링크: " + url);
    }
  }

  return <div className="price-watchlist-page"><div className="workspace-heading"><div><button className="back-link" type="button" onClick={onBack}><FiArrowLeft /> 홈으로</button><p className="eyebrow">PRICE TRACKER</p><h1>가격 추적</h1><p>부품을 검색해 관심 목록에 담고 목표가와 현재 가격을 한 화면에서 관리합니다.</p></div><span className="admin-badge"><FiClock /> 현재가 모니터링</span></div><div className="price-watchlist-grid"><section className="price-watchlist-search-card"><div className="price-watchlist-section-heading"><div><p className="eyebrow">CATALOG SEARCH</p><h2>추적할 부품 찾기</h2><p>핵심·주변 부품을 별도 카탈로그에서 검색합니다.</p></div><span>{total.toLocaleString("ko-KR")}개</span></div><div className="price-watchlist-search-tools"><label><span>대상</span><select aria-label="가격 추적 검색 대상" value={kind} onChange={(event) => { setKind(event.target.value as "part" | "accessory"); setSearchOffset(0); }}><option value="part">핵심 부품</option><option value="accessory">주변 부품</option></select></label>{kind === "part" ? <label><span>분류</span><select aria-label="가격 추적 핵심 부품 분류" value={partCategory} onChange={(event) => { setPartCategory(event.target.value as PartCategory); setSearchOffset(0); }}>{PART_CATEGORIES.map((category) => <option value={category} key={category}>{CATEGORY_LABELS[category]}</option>)}</select></label> : <label><span>분류</span><select aria-label="가격 추적 주변 부품 분류" value={accessoryCategory} onChange={(event) => { setAccessoryCategory(event.target.value as AccessoryCategory | "all"); setSearchOffset(0); }}><option value="all">전체 주변 부품</option>{ACCESSORY_CATEGORIES.map((category) => <option value={category} key={category}>{ACCESSORY_CATEGORY_LABELS[category]}</option>)}</select></label>}<label className="price-watchlist-search-query"><span>검색</span><input aria-label="가격 추적 부품 검색" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSearchOffset(0); }} placeholder="모델명·브랜드 검색" /></label></div>{searchLoading && items.length === 0 ? <div className="price-watchlist-state"><FiLoader className="spin" /> 부품을 찾는 중...</div> : searchError && items.length === 0 ? <div className="price-watchlist-state error" role="alert"><FiXCircle /><span>{searchError}</span><button className="text-button" type="button" onClick={() => setSearchRetryNonce((current) => current + 1)}>다시 시도</button></div> : items.length === 0 ? <div className="price-watchlist-state"><FiSearch /> 검색 결과가 없습니다.</div> : <div className="price-watchlist-search-results">{items.map((item) => { const entry = { itemId: item.id, kind, category: item.category }; const watched = catalogWatchlistContains(watchEntries, entry); const sourceUrl = safeExternalUrl(item.danawaUrl); return <article className={watched ? "price-watchlist-search-item watched" : "price-watchlist-search-item"} key={kind + ":" + item.id}><div><strong>{item.name}</strong><small>{categoryLabel(item)} · {qualityLabel(item)} · {item.rawSpecText || "상세 스펙 확인 필요"}</small></div><div className="price-watchlist-search-side"><strong>{formatWon(item.priceWon)}</strong>{sourceUrl && <a className="price-watchlist-source-link" href={sourceUrl} target="_blank" rel="noreferrer">원문 <FiExternalLink /></a>}<button className="button button-small" type="button" onClick={() => toggleWatch(item)}>{watched ? <><FiCheck /> 추적 중</> : <><FiPlus /> 추적 추가</>}</button></div></article>; })}</div>}{items.length < total && <button className="button button-light full-width" type="button" onClick={() => setSearchOffset((current) => current + 24)} disabled={searchLoading}>{searchLoading ? <><FiLoader className="spin" /> 불러오는 중...</> : "더 많은 부품 불러오기 (" + items.length.toLocaleString("ko-KR") + " / " + total.toLocaleString("ko-KR") + ")"}</button>}{searchError && items.length > 0 && <p className="price-watchlist-inline-error" role="alert"><FiXCircle /> {searchError} <button className="text-button" type="button" onClick={() => setSearchRetryNonce((current) => current + 1)}>다시 시도</button></p>}</section><section className="price-watchlist-tracker-card"><div className="price-watchlist-section-heading"><div><p className="eyebrow">MY TRACKING LIST</p><h2>내 가격 추적 목록</h2><p>현재 가격과 목표가 도달 여부를 직접 확인합니다.</p></div><button className="button button-light" type="button" onClick={() => setPriceRefreshNonce((current) => current + 1)} disabled={priceLoading || watchEntries.length === 0}>{priceLoading ? <><FiLoader className="spin" /> 확인 중...</> : <><FiRefreshCw /> 현재가 새로고침</>}</button></div>{priceCheckedAt && <p className="price-watchlist-checked"><FiClock /> 마지막 확인 {new Date(priceCheckedAt).toLocaleString("ko-KR")}</p>}<div className="price-watchlist-monitor-controls"><label><input type="checkbox" aria-label="가격 추적 자동 확인" checked={autoRefreshEnabled} onChange={(event) => { setAutoRefreshEnabled(event.target.checked); if (event.target.checked) setPriceRefreshNonce((current) => current + 1); }} /><span>페이지를 열어 둔 동안 자동 확인</span></label>{autoRefreshEnabled && <label className="price-watchlist-monitor-interval"><span>주기</span><select aria-label="가격 추적 자동 확인 주기" value={autoRefreshMinutes} onChange={(event) => setAutoRefreshMinutes(Number(event.target.value) as 5 | 15 | 30)}><option value={5}>5분</option><option value={15}>15분</option><option value={30}>30분</option></select></label>}<label className="price-watchlist-history-window"><span>가격 이력</span><select aria-label="가격 추적 가격 이력 기간" value={priceHistoryDays} onChange={(event) => setPriceHistoryDays(Number(event.target.value) as PriceHistoryWindow)}><option value={7}>7일</option><option value={30}>30일</option><option value={90}>90일</option></select></label><span className="price-watchlist-monitor-status">{autoRefreshEnabled ? "자동 확인 " + autoRefreshMinutes + "분마다" : "자동 확인 꺼짐"}</span></div><PriceAlertPreferencesPanel value={alertPreferences} onChange={setAlertPreferences} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist} />{priceAlerts.length > 0 && <div className="price-watchlist-alerts"><div className="price-watchlist-alerts-heading"><strong><FiBell /> 최근 가격 알림{unreadAlertCount > 0 ? " · 미읽음 " + unreadAlertCount : ""}</strong><div className="price-watchlist-alert-actions"><button className="text-button" type="button" onClick={() => void updateAlertStates("read")} disabled={unreadAlertCount === 0}>모두 읽음</button><button className="text-button" type="button" onClick={() => void updateAlertStates("dismiss")}>알림 지우기</button></div></div>{priceAlerts.map((alert) => <article className={(alert.kind === "target" ? "price-watchlist-alert target" : alert.kind === "availability" ? "price-watchlist-alert availability" : "price-watchlist-alert") + (alert.readAt ? " read" : "")} key={alert.id}><FiBell /><div><strong>{alert.kind === "target" ? "목표가 도달" : alert.kind === "availability" ? "가격 확인 상태 변경" : "가격 하락 감지"}</strong><span>{alert.message}</span><small>{new Date(alert.createdAt).toLocaleString("ko-KR")}</small></div></article>)}</div>}{watchEntries.length > 0 && <PriceWatchlistEntryFilters query={watchListQuery} status={watchListStatus} sort={watchListSort} total={watchEntries.length} visible={visibleWatchEntries.length} onQueryChange={setWatchListQuery} onStatusChange={setWatchListStatus} onSortChange={setWatchListSort} />}{watchEntries.length === 0 ? <div className="price-watchlist-empty\"><FiTag /><strong>아직 추적 중인 부품이 없습니다.</strong><span>왼쪽에서 CPU, 그래픽카드, SSD, 주변 부품을 검색해 추가해 보세요.</span></div> : visibleWatchEntries.length === 0 ? <div className="price-watchlist-filter-empty"><FiSearch /> 조건에 맞는 가격 추적 항목이 없습니다.<button className="text-button" type="button" onClick={resetWatchListView}>필터 초기화</button></div> : <div className="price-watchlist-tracked-list">{visibleWatchEntries.map((entry) => { const live = currentPrices[entryKey(entry)]; const targetReached = live?.status === "available" && live.priceWon !== undefined && entry.targetPriceWon !== undefined && live.priceWon <= entry.targetPriceWon; const targetGapWon = live?.priceWon !== undefined && entry.targetPriceWon !== undefined ? live.priceWon - entry.targetPriceWon : undefined; const history = priceHistories[entryKey(entry)]; const signals = historySignals(entry); return <article className="price-watchlist-tracked-item" key={entryKey(entry)}><div className="price-watchlist-tracked-copy"><strong>{entry.itemName}</strong><small>{entry.kind === "accessory" ? "주변 부품" : "핵심 부품"} · {entry.category}</small></div><label><span>목표가</span><input aria-label={entry.itemName + " 목표가"} type="number" min="1" step="1000" value={entry.targetPriceWon ?? ""} placeholder="미설정" onChange={(event) => updateTarget(entry, event.target.value)} />{history && recommendedTargetPriceFromHistory(history.summary) !== undefined && <button className="price-watchlist-target-suggest" type="button" aria-label={entry.itemName + " 최근 " + history.windowDays + "일 최저가로 목표가 설정"} onClick={() => suggestTargetFromHistory(entry, history)}>최근 {history.windowDays}일 최저가 {formatWon(recommendedTargetPriceFromHistory(history.summary))}</button>}</label><div className="price-watchlist-current"><span>현재가</span><strong>{live?.status === "error" ? "일시 확인 오류" : live?.status === "unavailable" ? "가격 확인 불가" : live?.priceWon !== undefined ? formatWon(live.priceWon) : "미확인"}</strong>{live?.sourceUrl && <a className="price-watchlist-source-link" href={live.sourceUrl} target="_blank" rel="noreferrer">원문 보기 <FiExternalLink /></a>}{targetReached && <em>목표가 도달</em>}{targetGapWon !== undefined && !targetReached && <small className="price-watchlist-target-gap">목표가까지 +{formatWon(targetGapWon)}</small>}{history && history.summary.sampleCount >= 2 && <div className="price-watchlist-history"><small>최근 {history.windowDays}일 {history.summary.sampleCount}회{history.summary.minPriceWon !== undefined ? " · 최저가 " + formatWon(history.summary.minPriceWon) : ""}{history.summary.fromHighPercent !== undefined ? " · 최고가 대비 " + history.summary.fromHighPercent.toFixed(1) + "%" : ""}</small>{signals.length > 0 && <div className="price-watchlist-history-signals">{signals.map((signal) => <em key={signal}>{signal}</em>)}</div>}<div className="price-watchlist-sparkline" role="img" aria-label={entry.itemName + " 최근 " + history.windowDays + "일 가격 추세"}>{history.points.map((point) => <span key={point.changeId} style={{ height: historyBarHeight(history, point.priceWon) + "%" }} title={point.priceWon.toLocaleString("ko-KR") + "원"} />)}</div></div>}</div><button className="text-button" type="button" onClick={() => setWatchEntries((current) => removeCatalogWatchEntry(current, entry))}>제거</button></article>; })}</div>}<p className="price-watchlist-alert-summary"><FiTag /> 현재 기준 활성 가격 신호 {activeSignalCount}개</p><div className="price-watchlist-server-tools"><label><span>공유 목록 이름</span><input aria-label="가격 추적 공유 목록 이름" type="text" maxLength={60} value={watchlistName} onChange={(event) => setWatchlistName(event.target.value)} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist} /></label><label><span>최저가 근접 기준</span><select aria-label="가격 추적 최저가 근접 기준" value={watchThreshold} onChange={(event) => setWatchThreshold(Number(event.target.value) as WatchThreshold)} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist}><option value={5}>5%</option><option value={10}>10%</option><option value={20}>20%</option></select></label><label><span>공유 링크 유효기간</span><select aria-label="가격 추적 공유 링크 유효기간" value={watchlistExpiryDays} onChange={(event) => setWatchlistExpiryDays(event.target.value === "keep" ? "keep" : event.target.value === "7" ? 7 : event.target.value === "30" ? 30 : "never")} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist}>{watchlistExpiryDays === "keep" && <option value="keep">현재 만료 유지{savedLink?.expiresAt ? ` · ${new Date(savedLink.expiresAt).toLocaleString("ko-KR")}` : ""}</option>}<option value="never">무기한</option><option value="7">7일</option><option value="30">30일</option></select></label><button className="button button-secondary" type="button" onClick={() => void (editingSavedLinkId === savedLink?.id ? updateWatchlist() : saveWatchlist())} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist || watchEntries.length === 0}>{savingWatchlist ? <><FiLoader className="spin" /> 저장 중...</> : updatingWatchlist ? <><FiLoader className="spin" /> 업데이트 중...</> : editingSavedLinkId === savedLink?.id ? <><FiServer /> 서버 목록 업데이트</> : <><FiServer /> 서버 저장·공유</>}</button>{editingSavedLinkId === savedLink?.id && <button className="button button-light" type="button" onClick={() => void saveWatchlist()} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist || watchEntries.length === 0}>새 목록으로 저장</button>}</div>{savedLinks.length > 0 && <section className="price-watchlist-saved-links" aria-label="내 서버 가격 추적 목록"><div className="price-watchlist-saved-links-heading"><strong><FiServer /> 내 서버 가격 목록</strong><span>{savedLinks.length} / 20</span></div>{savedLinks.map((link) => { const url = window.location.origin + "/watchlist/" + link.id; return <article className={savedLink?.id === link.id ? "price-watchlist-saved-link active" : "price-watchlist-saved-link"} key={link.id}><div className="price-watchlist-saved-link-meta"><strong>{link.name ?? "가격 추적 목록"}</strong><small>{link.createdAt ? "저장 " + new Date(link.createdAt).toLocaleString("ko-KR") + " · " : ""}{link.updatedAt ? "수정 " + new Date(link.updatedAt).toLocaleString("ko-KR") + " · " : ""}{link.expiresAt ? "만료 " + new Date(link.expiresAt).toLocaleString("ko-KR") : "무기한"}{link.alertPreferences ? " · 알림 " + priceAlertPolicyText(link.alertPreferences) : ""}</small></div><label><span>공유 링크</span><input aria-label={(link.name ?? "가격 추적 목록") + " 공유 링크"} type="text" value={url} readOnly onFocus={(event) => event.currentTarget.select()} /></label><div className="price-watchlist-saved-link-actions"><a className="text-button" href={url}>열기</a><button className="text-button" type="button" onClick={() => void loadWatchlistForEdit(link.id)} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist}>{editingSavedLinkId === link.id ? "편집 중" : "편집"}</button><button className="text-button" type="button" onClick={() => void copySavedLink(link.id)}>다시 복사</button><button className="text-button danger-text-button" type="button" onClick={() => void revokeWatchlistById(link.id)} disabled={revokingWatchlist || updatingWatchlist}>{revokingWatchlist ? <><FiLoader className="spin" /> 취소 중...</> : <><FiTrash2 /> 공유 취소</>}</button></div></article>; })}</section>}<p className="price-watchlist-note"><FiInfo /> 저장 목록과 현재가 재조회 결과를 구분해서 표시합니다. 가격 이력·하락 신호는 요청한 항목만 공개하고 전체 변경 로그는 노출하지 않습니다. 페이지를 열어 둔 동안 자동 확인을 켜면 baseline 대비 하락·목표가 도달 전환을 in-app 알림으로 기록합니다.</p></section></div></div>;
}
