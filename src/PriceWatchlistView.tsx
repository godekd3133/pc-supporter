import { safeLocalStorage } from "./safe-storage";
import "./price-watchlist-view.css";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import { FiArrowLeft, FiBell, FiCheck, FiCheckCircle, FiClock, FiCopy, FiDownload, FiExternalLink, FiInfo, FiLoader, FiPlus, FiRefreshCw, FiSearch, FiServer, FiTag, FiTrash2, FiUpload, FiXCircle } from "react-icons/fi";
import type { AccessoryCategory, AccessoryItem, Part, PartCategory } from "../shared/types";
import { ACCESSORY_CATEGORIES, ACCESSORY_CATEGORY_LABELS, CATEGORY_LABELS, DATA_FRESHNESS_LABELS, isKnownPrice, PART_CATEGORIES } from "../shared/types";
import { addCatalogWatchEntry, catalogWatchlistContains, catalogWatchlistFromJson, catalogWatchlistToJson, mergeCatalogWatchEntries, removeCatalogWatchEntry, updateCatalogWatchEntry } from "../shared/catalog-watchlist";
import type { CatalogWatchEntry } from "../shared/catalog-watchlist";
import { catalogWatchlistEntriesFromCsv, catalogWatchlistEntriesFromJson } from "../shared/catalog-watchlist-import";
import { catalogWatchlistCsvFor, catalogWatchlistJsonFor } from "../shared/catalog-watchlist-export";
import type { CatalogWatchSnapshot } from "../shared/catalog-watchlist-export";
import { api } from "./api";
import { hasOwnerSessionResource, markOwnerSessionResource, ownerCredentialAvailable, ownerRequestOptions, ownerSessionCreateOptions, ownerSessionModeSupported, removeOwnerSessionResource, retryOwnerSessionMigration, SAVED_WATCHLIST_LINK_STORAGE_KEY, SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY } from "./owner-session";
import { DEFAULT_PRICE_ALERT_POLICY, PRICE_ALERT_DROP_THRESHOLDS, priceAlertPolicyFromUnknown, priceAlertPolicyText, priceAlertsFor } from "./price-alerts";
import type { PriceAlertPolicy, PriceObservation, PriceWatchAlert } from "./price-alerts";
import { autoRefreshEnabledFromStorage, autoRefreshMinutesFromStorage, priceAlertsFromJson, priceAlertsToJson, priceBaselineFromJson, priceBaselineToJson } from "./price-monitor-storage";
import { savedWatchlistLinksFromJson, savedWatchlistLinksToJson } from "./watchlist-link-storage";
import type { SavedWatchlistLink } from "./watchlist-link-storage";
import { safeExternalUrl } from "./safe-source-url";
import { recommendedTargetPriceFromHistory } from "./price-target";
import { catalogWatchlistImportDiffFor, priceWatchDecisionCountsFor, priceWatchEntriesFor, priceWatchlistCapabilitiesFor, priceWatchlistStatusForMode, readPriceWatchCatalogPrices } from "./price-watchlist-view";
import type { CatalogWatchlistImportDiff, PriceWatchLivePrice, PriceWatchSort, PriceWatchStatusFilter } from "./price-watchlist-view";
import { priceWatchDecisionFor } from "../shared/price-watch-decision";
import { useModalAccessibility } from "./use-modal-accessibility";
import { LOCAL_IMPORT_MAX_BYTES } from "../shared/file-import-limits";
import { eul } from "../shared/josa";

const CATALOG_WATCHLIST_STORAGE_KEY = "pc-supporter-catalog-watchlist";
const CATALOG_WATCH_THRESHOLD_STORAGE_KEY = "pc-supporter-catalog-watch-threshold";
const PRICE_MONITOR_BASELINE_STORAGE_KEY = "pc-supporter-price-monitor-baseline";
const PRICE_MONITOR_ALERTS_STORAGE_KEY = "pc-supporter-price-monitor-alerts";
const PRICE_MONITOR_AUTO_REFRESH_STORAGE_KEY = "pc-supporter-price-monitor-auto-refresh";
const PRICE_MONITOR_INTERVAL_STORAGE_KEY = "pc-supporter-price-monitor-interval";
const PRICE_ALERT_POLICY_STORAGE_KEY = "pc-supporter-price-alert-policy";
const PRICE_HISTORY_WINDOW_STORAGE_KEY = "pc-supporter-price-history-window";
const WATCH_THRESHOLDS = [5, 10, 20] as const;
type WatchThreshold = (typeof WATCH_THRESHOLDS)[number];

function watchThresholdFromStorage(raw: string | null): WatchThreshold {
  const value = Number(raw);
  return value === 5 || value === 10 || value === 20 ? value : 10;
}
const PRICE_HISTORY_WINDOWS = [7, 30, 90] as const;
type PriceHistoryWindow = (typeof PRICE_HISTORY_WINDOWS)[number];
const PRICE_WATCH_DECISION_LABELS = { target: "목표가 도달", buy: "구매 검토", wait: "하락 대기", observe: "재상승 관찰", tracking: "목표가 관찰 중", unavailable: "-", error: "확인 오류" } as const;
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
type SavedWatchlistCreateResponse = SavedWatchlist & ({ ownerManaged: true; ownerToken?: never } | { ownerManaged?: false; ownerToken: string });
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

type WatchlistImportPreview = {
  fileName: string;
  entries: CatalogWatchEntry[];
  nearLowThresholdPercent?: 5 | 10 | 20;
};

function formatWon(value: number | undefined) {
  return isKnownPrice(value) ? value.toLocaleString("ko-KR") + "원" : "-";
}

function priceCheckLabel(price: PriceWatchLivePrice) {
  const checkedAt = price.priceCheckedAt ? dateTimeLabel(price.priceCheckedAt) : "날짜 기록 없음";
  const sourceLabel = price.source === "danawa" ? "상품 페이지 확인" : price.source === "manual" ? "직접 입력" : price.source === "seed" ? "기본 카탈로그 기준" : "출처 정보 없음";
  const freshnessLabel = price.dataFreshness && price.dataFreshness !== "fresh" ? ` · ${DATA_FRESHNESS_LABELS[price.dataFreshness]}` : "";
  return `${sourceLabel} · ${checkedAt}${freshnessLabel}`;
}

function dateTimeLabel(value: string | undefined) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("ko-KR") : "기록 없음";
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

function initialPriceWatchParam(name: string) {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get(name) ?? undefined;
}

function initialPriceWatchKind() {
  return initialPriceWatchParam("kind") === "accessory" ? "accessory" as const : "part" as const;
}

function initialPriceWatchPartCategory() {
  const value = initialPriceWatchParam("category");
  return PART_CATEGORIES.includes(value as PartCategory) ? value as PartCategory : "cpu" as const;
}

function initialPriceWatchAccessoryCategory() {
  const value = initialPriceWatchParam("category");
  return value === "all" || ACCESSORY_CATEGORIES.includes(value as AccessoryCategory) ? value as AccessoryCategory | "all" : "all" as const;
}

function initialPriceWatchSearchQuery() {
  return initialPriceWatchParam("q")?.trim().slice(0, 160) ?? "";
}

function initialPriceWatchListQuery() {
  return initialPriceWatchParam("listQ")?.trim().slice(0, 160) ?? "";
}

function initialPriceWatchListStatus() {
  const value = initialPriceWatchParam("listStatus");
  return ["alerts", "target", "buy", "wait", "observe", "tracking", "available", "unavailable", "error"].includes(value ?? "") ? value as PriceWatchStatusFilter : "all" as const;
}

function initialPriceWatchListSort() {
  const value = initialPriceWatchParam("listSort");
  return value === "price_asc" || value === "price_desc" || value === "target_gap_asc" || value === "added_desc" ? value : "added_desc" as const;
}

function PriceWatchlistEntryFilters({ query, status, sort, total, visible, allowAlerts, allowHistory, onQueryChange, onStatusChange, onSortChange }: { query: string; status: PriceWatchStatusFilter; sort: PriceWatchSort; total: number; visible: number; allowAlerts: boolean; allowHistory: boolean; onQueryChange: (value: string) => void; onStatusChange: (value: PriceWatchStatusFilter) => void; onSortChange: (value: PriceWatchSort) => void }) {
  return <div className="price-watchlist-entry-filters" aria-label="가격 추적 목록 도구"><label><span>목록 검색</span><input aria-label="가격 추적 목록 검색" type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="부품명·ID·분류" /></label><label><span>상태</span><select aria-label="가격 추적 목록 상태" value={status} onChange={(event) => onStatusChange(event.target.value as PriceWatchStatusFilter)}><option value="all">모든 항목</option>{allowAlerts && <option value="alerts">알림 있음</option>}<option value="target">목표가 도달</option>{allowHistory && <><option value="buy">구매 검토</option><option value="wait">가격 하락 대기</option><option value="observe">재상승 관찰</option></>}<option value="tracking">목표가 관찰 중</option><option value="available">가격 확인 가능</option><option value="unavailable">가격 확인 불가</option><option value="error">일시 조회 오류</option></select></label><label><span>정렬</span><select aria-label="가격 추적 목록 정렬" value={sort} onChange={(event) => onSortChange(event.target.value as PriceWatchSort)}><option value="added_desc">최근 등록</option><option value="price_asc">저장 가격 낮은 순</option><option value="price_desc">저장 가격 높은 순</option><option value="target_gap_asc">목표가 차액 순</option></select></label><span className="price-watchlist-entry-count">{visible} / {total}개</span></div>;
}

function PriceAlertPreferencesPanel({ value, onChange, disabled }: { value: PriceAlertPolicy; onChange: (next: PriceAlertPolicy) => void; disabled: boolean }) {
  return <div className="price-watchlist-alert-preferences" aria-label="가격 추적 알림 설정"><div className="price-watchlist-alert-preferences-heading"><div><strong>가격 알림 조건</strong><small>현재 목록과 새로 저장하는 목록에 적용됩니다.</small></div><span>{priceAlertPolicyText(value)}</span></div><div className="price-watchlist-alert-preferences-controls"><label><input type="checkbox" aria-label="가격 추적 목표가 도달 알림" checked={value.targetReached} onChange={(event) => onChange({ ...value, targetReached: event.target.checked })} disabled={disabled} /><span>목표가 도달 알림</span></label><label><input type="checkbox" aria-label="가격 추적 가격 하락 알림" checked={value.priceDrop} onChange={(event) => onChange({ ...value, priceDrop: event.target.checked })} disabled={disabled} /><span>가격 하락 알림</span></label><label><input type="checkbox" aria-label="가격 추적 가격 정보를 찾을 수 없을 때 알림" checked={value.priceAvailability} onChange={(event) => onChange({ ...value, priceAvailability: event.target.checked })} disabled={disabled} /><span>가격 정보를 찾을 수 없을 때 알림</span></label><label><span>하락 알림 최소 변동</span><select aria-label="가격 추적 하락 알림 최소 변동" value={value.minimumDropPercent} onChange={(event) => onChange({ ...value, minimumDropPercent: Number(event.target.value) as PriceAlertPolicy["minimumDropPercent"] })} disabled={disabled || !value.priceDrop}>{PRICE_ALERT_DROP_THRESHOLDS.map((threshold) => <option value={threshold} key={threshold}>{threshold === 0 ? "모든 하락" : threshold + "% 이상"}</option>)}</select></label></div></div>;
}

function WatchlistImportPreviewDialog({ preview, currentEntries, onClose, onConfirm }: { preview: WatchlistImportPreview; currentEntries: CatalogWatchEntry[]; onClose: () => void; onConfirm: () => void }) {
  useModalAccessibility({ onClose, selector: '[aria-labelledby="price-watchlist-import-title"]' });
  const diff: CatalogWatchlistImportDiff = catalogWatchlistImportDiffFor(currentEntries, preview.entries);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="build-import-dialog price-watchlist-import-dialog" role="dialog" aria-modal="true" aria-labelledby="price-watchlist-import-title" data-testid="price-watchlist-import-preview"><div className="modal-header"><div><h2 id="price-watchlist-import-title">가격 추적 목록 가져오기</h2><p>{preview.fileName}을 현재 목록과 병합하기 전에 변경 내용을 확인합니다.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="가격 추적 가져오기 미리보기 닫기"><FiXCircle /></button></div><div className="build-import-stats price-watchlist-import-stats"><div><span>현재 목록</span><strong>{diff.currentCount}개</strong></div><div><span>파일 항목</span><strong>{diff.incomingCount}개</strong></div><div><span>새 항목</span><strong>{diff.newCount}개</strong></div><div><span>겹치는 항목</span><strong>{diff.sharedCount}개</strong></div><div><span>병합 후</span><strong>{diff.resultingCount}개</strong></div></div>{diff.targetChangedCount > 0 && <p className="price-watchlist-import-change" role="status"><FiRefreshCw /> 겹치는 항목 중 {diff.targetChangedCount}개의 목표가가 파일 값으로 갱신됩니다.</p>}{diff.droppedByLimit > 0 && <p className="price-watchlist-import-warning" role="alert"><FiInfo /> 최대 50개 제한으로 {diff.droppedByLimit}개 항목은 병합 후 목록에서 제외됩니다.</p>}<p className="price-watchlist-import-threshold"><span>최저가 근접 기준</span><strong>{preview.nearLowThresholdPercent ?? 10}%</strong><small>파일에 저장된 기준이 있으면 현재 기준을 이 값으로 바꿉니다.</small></p><p className="price-watchlist-import-note"><FiInfo /> 현재 가격·가격 이력·알림 기록·공유 관리 권한은 가져오지 않습니다. 확인하면 파일의 추적 항목과 목표가만 현재 브라우저 목록에 병합합니다.</p><div className="build-import-actions price-watchlist-import-actions"><button className="button button-light" type="button" onClick={onClose}>취소</button><button className="button button-primary" type="button" data-testid="price-watchlist-import-confirm" onClick={onConfirm}><FiCheckCircle /> 이 내용으로 병합</button></div></section></div>;
}

function readOwnerTokens() {
  try {
    const raw = safeLocalStorage.getItem(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY);
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
    safeLocalStorage.setItem(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(tokens).slice(0, 20))));
  } catch {
    // A full local storage bucket must not prevent price tracking from working.
  }
}

function readSavedLinks() {
  return savedWatchlistLinksFromJson(safeLocalStorage.getItem(SAVED_WATCHLIST_LINK_STORAGE_KEY));
}

function writeSavedLinks(links: SavedWatchlistLink[]) {
  try {
    if (links.length > 0) safeLocalStorage.setItem(SAVED_WATCHLIST_LINK_STORAGE_KEY, savedWatchlistLinksToJson(links));
    else safeLocalStorage.removeItem(SAVED_WATCHLIST_LINK_STORAGE_KEY);
  } catch {
    // A full local storage bucket must not prevent price tracking from working.
  }
}

export function PriceWatchlistView({ onBack, onToast }: { onBack: () => void; onToast: (message: string) => void }) {
  const capabilities = priceWatchlistCapabilitiesFor();
  const [kind, setKind] = useState<"part" | "accessory">(initialPriceWatchKind);
  const [partCategory, setPartCategory] = useState<PartCategory>(initialPriceWatchPartCategory);
  const [accessoryCategory, setAccessoryCategory] = useState<AccessoryCategory | "all">(initialPriceWatchAccessoryCategory);
  const [query, setQuery] = useState(initialPriceWatchSearchQuery);
  const [items, setItems] = useState<Array<Part | AccessoryItem>>([]);
  const [total, setTotal] = useState(0);
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchRetryNonce, setSearchRetryNonce] = useState(0);
  const [searchLoading, setSearchLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [watchEntries, setWatchEntries] = useState<CatalogWatchEntry[]>(() => typeof window === "undefined" ? [] : catalogWatchlistFromJson(safeLocalStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)));
  const [watchListQuery, setWatchListQuery] = useState(initialPriceWatchListQuery);
  const [watchListStatus, setWatchListStatus] = useState<PriceWatchStatusFilter>(() => priceWatchlistStatusForMode(initialPriceWatchListStatus(), capabilities));
  const [watchListSort, setWatchListSort] = useState<PriceWatchSort>(initialPriceWatchListSort);
  const [currentPrices, setCurrentPrices] = useState<Record<string, PriceWatchLivePrice>>({});
  const [priceHistories, setPriceHistories] = useState<Record<string, PublicPriceHistoryItem>>({});
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceRefreshNonce, setPriceRefreshNonce] = useState(0);
  const [priceListReadAt, setPriceListReadAt] = useState<string | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() => typeof window !== "undefined" && autoRefreshEnabledFromStorage(safeLocalStorage.getItem(PRICE_MONITOR_AUTO_REFRESH_STORAGE_KEY)));
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState<5 | 15 | 30>(() => typeof window === "undefined" ? 15 : autoRefreshMinutesFromStorage(safeLocalStorage.getItem(PRICE_MONITOR_INTERVAL_STORAGE_KEY)));
  const [priceAlerts, setPriceAlerts] = useState<PriceWatchAlert[]>(() => typeof window === "undefined" ? [] : priceAlertsFromJson(safeLocalStorage.getItem(PRICE_MONITOR_ALERTS_STORAGE_KEY)));
  const [alertPreferences, setAlertPreferences] = useState<PriceAlertPolicy>(() => typeof window === "undefined" ? DEFAULT_PRICE_ALERT_POLICY : priceAlertPolicyFromStorage(safeLocalStorage.getItem(PRICE_ALERT_POLICY_STORAGE_KEY)));
  const [priceHistoryDays, setPriceHistoryDays] = useState<PriceHistoryWindow>(() => typeof window === "undefined" ? 30 : priceHistoryWindowFromStorage(safeLocalStorage.getItem(PRICE_HISTORY_WINDOW_STORAGE_KEY)));
  const previousPricesRef = useRef<Record<string, PriceObservation>>(typeof window === "undefined" ? {} : priceBaselineFromJson(safeLocalStorage.getItem(PRICE_MONITOR_BASELINE_STORAGE_KEY)));
  const [watchThreshold, setWatchThreshold] = useState<WatchThreshold>(() => typeof window === "undefined" ? 10 : watchThresholdFromStorage(safeLocalStorage.getItem(CATALOG_WATCH_THRESHOLD_STORAGE_KEY)));
  const [watchlistName, setWatchlistName] = useState("내 가격 추적 목록");
  const [watchlistExpiryDays, setWatchlistExpiryDays] = useState<ShareExpiryDays>("never");
  const [watchlistImportPreview, setWatchlistImportPreview] = useState<WatchlistImportPreview | null>(null);
  const watchlistImportInputRef = useRef<HTMLInputElement>(null);
  const [savingWatchlist, setSavingWatchlist] = useState(false);
  const [updatingWatchlist, setUpdatingWatchlist] = useState(false);
  const [revokingWatchlist, setRevokingWatchlist] = useState(false);
  const [savedLinks, setSavedLinks] = useState<SavedWatchlistLink[]>(() => typeof window === "undefined" ? [] : readSavedLinks());
  const savedWatchlistEditRequestRef = useRef(0);
  const priceAlertMutationVersionRef = useRef(0);
  const priceAlertContextKeyRef = useRef("");
  const savedWatchlistMutationVersionRef = useRef(0);
  const savedWatchlistContextKeyRef = useRef("");
  const mountedRef = useRef(true);
  const [editingSavedLinkId, setEditingSavedLinkId] = useState<string | null>(null);
  const savedLink = savedLinks[0] ?? null;
  const savedLinkOwnerToken = savedLink ? readOwnerTokens()[savedLink.id] ?? "" : "";
  const savedLinkOwnerManaged = savedLink ? hasOwnerSessionResource("watchlist", savedLink.id) : false;
  const priceAlertContextKey = `${savedLink?.id ?? "local"}:${savedLink?.updatedAt ?? ""}:${savedLinkOwnerToken || (savedLinkOwnerManaged ? "session" : "")}`;
  priceAlertContextKeyRef.current = priceAlertContextKey;
  const savedWatchlistContextKey = `${savedLink?.id ?? ""}:${savedLink?.updatedAt ?? ""}:${savedLinkOwnerToken || (savedLinkOwnerManaged ? "session" : "")}|${editingSavedLinkId ?? ""}`;
  savedWatchlistContextKeyRef.current = savedWatchlistContextKey;
  const savedLinksSyncKey = savedLinks.map((link) => JSON.stringify(link)).join("|");
  const previousWatchlistQueryKeyRef = useRef<string | null>(null);
  const previousWatchlistUrlRef = useRef<string | null>(null);
  const restoreWatchlistUrlRef = useRef(false);
  const watchlistQueryHistoryActiveRef = useRef(false);
  const watchlistQueryHistoryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const path = window.location.pathname;
    if (path !== "/watchlist" && path !== "/watchlist/") return;
    const params = new URLSearchParams();
    if (kind !== "part") params.set("kind", kind);
    if (kind === "part" && partCategory !== "cpu") params.set("category", partCategory);
    if (kind === "accessory" && accessoryCategory !== "all") params.set("category", accessoryCategory);
    if (query.trim()) params.set("q", query.trim());
    if (watchListQuery.trim()) params.set("listQ", watchListQuery.trim());
    if (watchListStatus !== "all") params.set("listStatus", watchListStatus);
    if (watchListSort !== "added_desc") params.set("listSort", watchListSort);
    const nextSearch = params.toString();
    const nextUrl = `/watchlist${nextSearch ? `?${nextSearch}` : ""}`;
    const currentUrl = window.location.pathname + window.location.search;
    const queryKey = JSON.stringify([query, watchListQuery]);
    const queryChanged = previousWatchlistQueryKeyRef.current !== null && previousWatchlistQueryKeyRef.current !== queryKey;
    const clearQueryHistoryTimer = () => {
      if (watchlistQueryHistoryTimerRef.current !== null) {
        window.clearTimeout(watchlistQueryHistoryTimerRef.current);
        watchlistQueryHistoryTimerRef.current = null;
      }
    };
    if (restoreWatchlistUrlRef.current) {
      clearQueryHistoryTimer();
      watchlistQueryHistoryActiveRef.current = false;
      restoreWatchlistUrlRef.current = false;
      if (currentUrl !== nextUrl) window.history.replaceState(window.history.state, "", nextUrl);
      previousWatchlistQueryKeyRef.current = queryKey;
    } else if (queryChanged) {
      if (currentUrl !== nextUrl) {
        if (watchlistQueryHistoryActiveRef.current) window.history.replaceState(window.history.state, "", nextUrl);
        else if (previousWatchlistUrlRef.current === null) window.history.replaceState(window.history.state, "", nextUrl);
        else window.history.pushState(window.history.state, "", nextUrl);
      }
      previousWatchlistUrlRef.current = nextUrl;
      watchlistQueryHistoryActiveRef.current = true;
      clearQueryHistoryTimer();
      watchlistQueryHistoryTimerRef.current = window.setTimeout(() => {
        watchlistQueryHistoryActiveRef.current = false;
        watchlistQueryHistoryTimerRef.current = null;
      }, 800);
      previousWatchlistQueryKeyRef.current = queryKey;
      return;
    } else if (currentUrl !== nextUrl) {
      clearQueryHistoryTimer();
      watchlistQueryHistoryActiveRef.current = false;
      if (previousWatchlistUrlRef.current === null) window.history.replaceState(window.history.state, "", nextUrl);
      else window.history.pushState(window.history.state, "", nextUrl);
    }
    previousWatchlistUrlRef.current = nextUrl;
    previousWatchlistQueryKeyRef.current = queryKey;
  }, [accessoryCategory, kind, partCategory, query, watchListQuery, watchListSort, watchListStatus]);

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname;
      if (path !== "/watchlist" && path !== "/watchlist/") return;
      restoreWatchlistUrlRef.current = true;
      setKind(initialPriceWatchKind());
      setPartCategory(initialPriceWatchPartCategory());
      setAccessoryCategory(initialPriceWatchAccessoryCategory());
      setQuery(initialPriceWatchSearchQuery());
      setWatchListQuery(initialPriceWatchListQuery());
      setWatchListStatus(priceWatchlistStatusForMode(initialPriceWatchListStatus(), capabilities));
      setWatchListSort(initialPriceWatchListSort());
      setSearchOffset(0);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => { safeLocalStorage.setItem(CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistToJson(watchEntries)); }, [watchEntries]);
  useEffect(() => { safeLocalStorage.setItem(CATALOG_WATCH_THRESHOLD_STORAGE_KEY, String(watchThreshold)); }, [watchThreshold]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CATALOG_WATCHLIST_STORAGE_KEY) {
        setWatchEntries(catalogWatchlistFromJson(event.newValue));
        return;
      }
      if (event.key === CATALOG_WATCH_THRESHOLD_STORAGE_KEY) {
        setWatchThreshold(watchThresholdFromStorage(event.newValue));
        return;
      }
      if (event.key === SAVED_WATCHLIST_LINK_STORAGE_KEY) {
        if (!capabilities.serverSharing) return;
        const nextLinks = savedWatchlistLinksFromJson(event.newValue);
        setSavedLinks(nextLinks);
        setEditingSavedLinkId((current) => current && nextLinks.some((link) => link.id === current) ? current : null);
        return;
      }
      if (event.key === SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY) {
        if (capabilities.serverSharing) setSavedLinks((current) => [...current]);
      }
      if (event.key === PRICE_MONITOR_BASELINE_STORAGE_KEY) {
        if (!capabilities.alerts) return;
        previousPricesRef.current = priceBaselineFromJson(event.newValue);
        return;
      }
      if (event.key === PRICE_MONITOR_ALERTS_STORAGE_KEY) {
        if (!capabilities.alerts) return;
        setPriceAlerts(priceAlertsFromJson(event.newValue));
        return;
      }
      if (event.key === PRICE_MONITOR_AUTO_REFRESH_STORAGE_KEY) {
        if (!capabilities.automaticRefresh) return;
        const enabled = autoRefreshEnabledFromStorage(event.newValue);
        setAutoRefreshEnabled(enabled);
        if (enabled) setPriceRefreshNonce((current) => current + 1);
        return;
      }
      if (event.key === PRICE_MONITOR_INTERVAL_STORAGE_KEY) {
        if (!capabilities.automaticRefresh) return;
        setAutoRefreshMinutes(autoRefreshMinutesFromStorage(event.newValue));
        return;
      }
      if (event.key === PRICE_ALERT_POLICY_STORAGE_KEY) {
        if (!capabilities.alerts) return;
        setAlertPreferences(priceAlertPolicyFromStorage(event.newValue));
        return;
      }
      if (event.key === PRICE_HISTORY_WINDOW_STORAGE_KEY && capabilities.priceHistory) setPriceHistoryDays(priceHistoryWindowFromStorage(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [capabilities.alerts, capabilities.automaticRefresh, capabilities.priceHistory, capabilities.serverSharing]);
  useEffect(() => { if (capabilities.serverSharing) writeSavedLinks(savedLinks); }, [capabilities.serverSharing, savedLinks]);
  useEffect(() => { if (capabilities.alerts) safeLocalStorage.setItem(PRICE_MONITOR_ALERTS_STORAGE_KEY, priceAlertsToJson(priceAlerts)); }, [capabilities.alerts, priceAlerts]);
  useEffect(() => { if (capabilities.automaticRefresh) safeLocalStorage.setItem(PRICE_MONITOR_AUTO_REFRESH_STORAGE_KEY, String(autoRefreshEnabled)); }, [autoRefreshEnabled, capabilities.automaticRefresh]);
  useEffect(() => { if (capabilities.automaticRefresh) safeLocalStorage.setItem(PRICE_MONITOR_INTERVAL_STORAGE_KEY, String(autoRefreshMinutes)); }, [autoRefreshMinutes, capabilities.automaticRefresh]);
  useEffect(() => { if (capabilities.alerts) safeLocalStorage.setItem(PRICE_ALERT_POLICY_STORAGE_KEY, JSON.stringify(alertPreferences)); }, [alertPreferences, capabilities.alerts]);
  useEffect(() => { if (capabilities.priceHistory) safeLocalStorage.setItem(PRICE_HISTORY_WINDOW_STORAGE_KEY, String(priceHistoryDays)); }, [capabilities.priceHistory, priceHistoryDays]);
  useEffect(() => {
    if (!capabilities.serverSharing || savedLinks.length === 0) return;
    let cancelled = false;
    void Promise.all(savedLinks.map(async (link) => {
      try {
        const saved = await api<SavedWatchlist>("/api/watchlists/" + encodeURIComponent(link.id));
        const { expiresAt: _linkExpiresAt, alertPreferences: _linkAlertPreferences, ...linkWithoutMutableMetadata } = link;
        return { ...linkWithoutMutableMetadata, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt, ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), alertPreferences: priceAlertPolicyFromUnknown(saved.alertPreferences) };
      } catch (error: unknown) {
        if (cancelled) return link;
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
  }, [capabilities.serverSharing, savedLinksSyncKey]);
  useEffect(() => {
    savedWatchlistMutationVersionRef.current += 1;
    setSavingWatchlist(false);
    setUpdatingWatchlist(false);
    setRevokingWatchlist(false);
  }, [savedWatchlistContextKey]);
  useEffect(() => {
    if (!capabilities.alerts || !savedLink) return;
    const token = savedLinkOwnerToken;
    const ownerManaged = savedLinkOwnerManaged;
    if (!ownerCredentialAvailable("watchlist", savedLink.id, { ownerToken: token, owned: ownerManaged })) return;
    let cancelled = false;
    void api<{ items: PriceWatchAlert[]; alertPreferences?: PriceAlertPolicy }>("/api/watchlists/" + encodeURIComponent(savedLink.id) + "/alerts", ownerRequestOptions("watchlist", savedLink.id, { ownerToken: token, owned: ownerManaged })).then((payload) => {
      if (cancelled) return;
      if (payload.alertPreferences) setAlertPreferences(priceAlertPolicyFromUnknown(payload.alertPreferences));
      setPriceAlerts((current) => {
        const merged = new Map<string, PriceWatchAlert>();
        current.concat(payload.items).forEach((alert) => merged.set(alert.id, alert));
        return [...merged.values()].slice(0, 20);
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [capabilities.alerts, priceAlertContextKey]);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError(null);
      if (searchOffset === 0) {
        setItems([]);
        setTotal(0);
      }
      const params = new URLSearchParams({ q: query, limit: "24", offset: String(searchOffset), sort: "price_asc" });
      const request = kind === "part"
        ? api<{ items: Part[]; total: number }>("/api/parts?category=" + encodeURIComponent(partCategory) + "&" + params.toString() + "&listingPolicy=all&priceStatus=known", { signal: controller.signal })
        : api<{ items: AccessoryItem[]; total: number }>("/api/accessories?category=" + encodeURIComponent(accessoryCategory) + "&" + params.toString() + "&priceFilter=priced", { signal: controller.signal });
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
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [accessoryCategory, kind, partCategory, query, searchOffset, searchRetryNonce]);
  useEffect(() => {
    setItems([]);
    setTotal(0);
    setSearchError(null);
  }, [accessoryCategory, kind, partCategory, query]);
  useEffect(() => {
    let cancelled = false;
    if (watchEntries.length === 0) {
      setPriceLoading(false);
      setCurrentPrices({});
      setPriceListReadAt(null);
      if (capabilities.alerts) {
        previousPricesRef.current = {};
        safeLocalStorage.removeItem(PRICE_MONITOR_BASELINE_STORAGE_KEY);
        setPriceAlerts([]);
      }
      return;
    }
    const controller = new AbortController();
    setPriceLoading(true);
    void (async () => {
      const nextPrices = await readPriceWatchCatalogPrices(watchEntries, (entry, signal) => {
        const endpoint = entry.kind === "accessory" ? "/api/accessories/" + encodeURIComponent(entry.itemId) : "/api/parts/" + encodeURIComponent(entry.itemId);
        return api<Part | AccessoryItem>(endpoint, { signal });
      }, controller.signal);
      if (!cancelled) {
        const refreshedAt = new Date().toISOString();
        const nextAlerts = capabilities.alerts
          ? priceAlertsFor(watchEntries.map((entry) => ({ itemKey: entry.kind + ":" + entry.itemId, itemName: entry.itemName, targetPriceWon: entry.targetPriceWon })), previousPricesRef.current, nextPrices, refreshedAt, alertPreferences)
          : [];
        if (capabilities.alerts) {
          const nextBaseline: Record<string, PriceObservation> = {};
          watchEntries.forEach((entry) => {
            const key = entry.kind + ":" + entry.itemId;
            const observation = nextPrices[key];
            if (!observation || observation.status === "error") {
              const previous = previousPricesRef.current[key];
              if (previous) nextBaseline[key] = previous;
            } else {
              nextBaseline[key] = observation;
            }
          });
          previousPricesRef.current = nextBaseline;
          safeLocalStorage.setItem(PRICE_MONITOR_BASELINE_STORAGE_KEY, priceBaselineToJson(nextBaseline));
        }
        setCurrentPrices(nextPrices);
        setPriceListReadAt(refreshedAt);
        if (capabilities.alerts && nextAlerts.length > 0) {
          setPriceAlerts((current) => nextAlerts.concat(current).slice(0, 20));
          onToast("가격 알림: " + nextAlerts[0].message);
        }
        setPriceLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [alertPreferences, capabilities.alerts, priceRefreshNonce, watchEntries]);
  useEffect(() => {
    if (!capabilities.automaticRefresh || !autoRefreshEnabled || watchEntries.length === 0) return;
    const timer = window.setInterval(() => setPriceRefreshNonce((current) => current + 1), autoRefreshMinutes * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefreshEnabled, autoRefreshMinutes, capabilities.automaticRefresh, watchEntries.length]);
  useEffect(() => {
    let cancelled = false;
    if (!capabilities.priceHistory || watchEntries.length === 0) {
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
  }, [capabilities.priceHistory, priceHistoryDays, priceRefreshNonce, watchEntries]);

  function categoryLabel(item: Part | AccessoryItem) {
    return item.category in CATEGORY_LABELS ? CATEGORY_LABELS[item.category as PartCategory] : ACCESSORY_CATEGORY_LABELS[item.category as AccessoryCategory];
  }
  function qualityLabel(item: Part | AccessoryItem) {
    return item.dataQuality === "live" ? "다나와 최신" : item.dataQuality === "manual" ? "직접 확인" : item.dataQuality === "seed" ? "기본 정보" : "일부 정보 부족";
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
  const decisionStates = Object.fromEntries(watchEntries.flatMap((entry) => {
    const live = currentPrices[entryKey(entry)];
    if (!live) return [];
    const decision = priceWatchDecisionFor({ currentStatus: live.status, currentPriceWon: live.priceWon, targetPriceWon: entry.targetPriceWon, nearLowThresholdPercent: watchThreshold, history: priceHistories[entryKey(entry)]?.summary });
    return [[entryKey(entry), decision.state] as const];
  }));
  const decisionCounts = priceWatchDecisionCountsFor(decisionStates);
  const watchSnapshots: CatalogWatchSnapshot[] = watchEntries.map((entry) => {
    const live = currentPrices[entryKey(entry)];
    const history = priceHistories[entryKey(entry)];
    const decision = priceWatchDecisionFor({ currentStatus: live?.status ?? "unknown", currentPriceWon: live?.priceWon, targetPriceWon: entry.targetPriceWon, nearLowThresholdPercent: watchThreshold, history: history?.summary });
    return {
      entry,
      currentDataStatus: live?.status === "available" ? "available" : "price_unavailable",
      targetPriceWon: entry.targetPriceWon,
      sampleCount: history?.summary.sampleCount ?? 0,
      ...(history?.summary.latestPriceWon !== undefined ? { latestPriceWon: history.summary.latestPriceWon } : {}),
      ...(history?.summary.minPriceWon !== undefined ? { minPriceWon: history.summary.minPriceWon } : {}),
      ...(history?.summary.maxPriceWon !== undefined ? { maxPriceWon: history.summary.maxPriceWon } : {}),
      ...(history?.summary.fromHighPercent !== undefined ? { fromHighPercent: history.summary.fromHighPercent } : {}),
      ...(history?.summary.currentPositionPercent !== undefined ? { currentPositionPercent: history.summary.currentPositionPercent } : {}),
      signals: [decision.label, ...historySignals(entry).filter((signal) => signal !== decision.label)]
    };
  });
  const visibleWatchEntries = priceWatchEntriesFor(watchEntries, currentPrices, { query: watchListQuery, status: watchListStatus, sort: watchListSort, alertKeys: alertItemKeys, decisionStates });
  function resetWatchListView() {
    setWatchListQuery("");
    setWatchListStatus("all");
    setWatchListSort("added_desc");
  }
  function toggleWatch(item: Part | AccessoryItem) {
    const entry = { itemId: item.id, itemName: item.name, category: item.category, kind } as CatalogWatchEntry;
    const watched = catalogWatchlistContains(watchEntries, entry);
    setWatchEntries((current) => watched ? removeCatalogWatchEntry(current, entry) : addCatalogWatchEntry(current, { ...entry, addedAt: new Date().toISOString() }));
    onToast(watched ? eul(item.name) + " 가격 추적에서 제거했습니다." : eul(item.name) + " 가격 추적에 추가했습니다.");
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
  function downloadWatchlistExport(format: "csv" | "json") {
    if (watchEntries.length === 0) {
      onToast("저장할 가격 추적 항목이 없습니다.");
      return;
    }
    const content = format === "csv" ? catalogWatchlistCsvFor(watchSnapshots) : catalogWatchlistJsonFor(watchSnapshots, { nearLowThresholdPercent: watchThreshold });
    const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-price-watchlist-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    onToast(`${watchEntries.length}개 가격 추적 항목을 ${format.toUpperCase()}으로 저장했습니다.`);
  }
  async function importWatchlistFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > LOCAL_IMPORT_MAX_BYTES) {
      onToast("가격 추적 파일은 1MB 이하만 가져올 수 있습니다.");
      return;
    }
    try {
      const raw = await file.text();
      const result = file.name.toLocaleLowerCase().endsWith(".csv") ? catalogWatchlistEntriesFromCsv(raw) : catalogWatchlistEntriesFromJson(raw);
      if (result.errors.length > 0) {
        onToast(`가격 추적 목록을 가져오지 못했습니다: ${result.errors.slice(0, 3).join(" · ")}`);
        return;
      }
      if (result.entries.length === 0) {
        onToast("가져올 가격 추적 항목이 없습니다.");
        return;
      }
      setWatchlistImportPreview({ fileName: file.name, entries: result.entries, nearLowThresholdPercent: result.nearLowThresholdPercent });
    } catch {
      onToast("가격 추적 JSON 파일을 읽지 못했습니다.");
    }
  }
  function applyWatchlistImport() {
    if (!watchlistImportPreview) return;
    const { entries, nearLowThresholdPercent } = watchlistImportPreview;
    setWatchEntries((current) => mergeCatalogWatchEntries(current, entries));
    if (nearLowThresholdPercent !== undefined) setWatchThreshold(nearLowThresholdPercent);
    setWatchlistImportPreview(null);
    onToast(`${entries.length}개 가격 추적 항목을 현재 목록에 병합했습니다.`);
  }
  async function saveWatchlist() {
    if (!capabilities.serverSharing) return;
    if (watchEntries.length === 0) {
      onToast("저장할 가격 추적 항목이 없습니다.");
      return;
    }
    const mutationVersion = ++savedWatchlistMutationVersionRef.current;
    const contextKey = savedWatchlistContextKey;
    const isCurrent = () => mountedRef.current && savedWatchlistMutationVersionRef.current === mutationVersion && savedWatchlistContextKeyRef.current === contextKey;
    setSavingWatchlist(true);
    try {
      const saved = await api<SavedWatchlistCreateResponse>("/api/watchlists", { method: "POST", ...ownerSessionCreateOptions(), body: JSON.stringify({ name: watchlistName.trim() || "내 가격 추적 목록", entries: watchEntries, nearLowThresholdPercent: watchThreshold, expiresInDays: shareExpiryPayloadFor(watchlistExpiryDays), alertPreferences }) });
      if (!isCurrent()) return;
      if (saved.ownerManaged) markOwnerSessionResource("watchlist", saved.id);
      if (saved.ownerToken) writeOwnerTokens({ [saved.id]: saved.ownerToken, ...readOwnerTokens() });
      if (saved.ownerToken && ownerSessionModeSupported()) void retryOwnerSessionMigration().catch(() => undefined);
      const nextLink = { id: saved.id, name: saved.name, createdAt: saved.createdAt, updatedAt: saved.updatedAt, ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), ...(saved.alertPreferences ? { alertPreferences: saved.alertPreferences } : {}) };
      const nextLinks = [nextLink, ...savedLinks.filter((link) => link.id !== saved.id)].slice(0, 20);
      setSavedLinks(nextLinks);
      setEditingSavedLinkId(saved.id);
      setWatchlistExpiryDays(saved.expiresAt ? "keep" : "never");
      writeSavedLinks(nextLinks);
      const url = window.location.origin + "/watchlist/" + saved.id;
      try {
        await navigator.clipboard.writeText(url);
        if (mountedRef.current) onToast("가격 추적 목록을 저장하고 공유 링크를 복사했습니다.");
      } catch {
        if (mountedRef.current) onToast("가격 추적 목록을 저장했습니다: " + url);
      }
    } catch (error: unknown) {
      if (isCurrent()) onToast(error instanceof Error ? error.message : "가격 추적 목록을 저장하지 못했습니다.");
    } finally {
      if (isCurrent()) setSavingWatchlist(false);
    }
  }
  async function loadWatchlistForEdit(id: string) {
    if (!capabilities.serverSharing) return;
    const requestVersion = ++savedWatchlistEditRequestRef.current;
    try {
      const saved = await api<SavedWatchlist>("/api/watchlists/" + encodeURIComponent(id));
      if (!mountedRef.current || savedWatchlistEditRequestRef.current !== requestVersion) return;
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
      onToast("가격 목록을 불러왔어요. 수정한 뒤 업데이트해 주세요.");
    } catch (error: unknown) {
      if (mountedRef.current && savedWatchlistEditRequestRef.current === requestVersion) onToast(error instanceof Error ? error.message : "서버 가격 목록을 불러오지 못했습니다.");
    }
  }
  async function updateWatchlist() {
    if (!capabilities.serverSharing) return;
    if (!savedLink || editingSavedLinkId !== savedLink.id) {
      onToast("먼저 편집할 서버 가격 목록을 불러와 주세요.");
      return;
    }
    const token = readOwnerTokens()[savedLink.id];
    const ownerManaged = hasOwnerSessionResource("watchlist", savedLink.id);
    if (!ownerCredentialAvailable("watchlist", savedLink.id, { ownerToken: token, owned: ownerManaged })) {
      onToast("이 가격 추적 목록을 수정할 소유 토큰이 없습니다.");
      return;
    }
    if (watchEntries.length === 0) {
      onToast("가격 목록에 추적 항목을 하나 이상 추가해 주세요.");
      return;
    }
    const mutationVersion = ++savedWatchlistMutationVersionRef.current;
    const contextKey = savedWatchlistContextKey;
    const isCurrent = () => mountedRef.current && savedWatchlistMutationVersionRef.current === mutationVersion && savedWatchlistContextKeyRef.current === contextKey;
    setUpdatingWatchlist(true);
    try {
      const saved = await api<SavedWatchlist>("/api/watchlists/" + encodeURIComponent(savedLink.id), { method: "PATCH", ...ownerRequestOptions("watchlist", savedLink.id, { ownerToken: token, owned: ownerManaged }), body: JSON.stringify({ name: watchlistName.trim() || "내 가격 추적 목록", entries: watchEntries, nearLowThresholdPercent: watchThreshold, alertPreferences, ...(watchlistExpiryDays !== "keep" ? { expiresInDays: watchlistExpiryDays === "never" ? null : watchlistExpiryDays } : {}) }) });
      if (!isCurrent()) return;
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
      if (isCurrent()) onToast(error instanceof Error ? error.message : "서버 가격 목록을 업데이트하지 못했습니다.");
    } finally {
      if (isCurrent()) setUpdatingWatchlist(false);
    }
  }
  async function revokeWatchlistById(id: string) {
    if (!capabilities.serverSharing) return;
    if (revokingWatchlist || updatingWatchlist) return;
    const token = readOwnerTokens()[id];
    const ownerManaged = hasOwnerSessionResource("watchlist", id);
    if (!ownerCredentialAvailable("watchlist", id, { ownerToken: token, owned: ownerManaged })) {
      onToast("이 가격 추적 목록을 취소할 소유 토큰이 없습니다.");
      return;
    }
    if (!window.confirm("이 가격 추적 공유 목록을 취소할까요? 전달된 링크도 더 이상 열리지 않습니다.")) return;
    const mutationVersion = ++savedWatchlistMutationVersionRef.current;
    const contextKey = savedWatchlistContextKey;
    const isCurrent = () => mountedRef.current && savedWatchlistMutationVersionRef.current === mutationVersion && savedWatchlistContextKeyRef.current === contextKey;
    setRevokingWatchlist(true);
    try {
      await api("/api/watchlists/" + encodeURIComponent(id), { method: "DELETE", ...ownerRequestOptions("watchlist", id, { ownerToken: token, owned: ownerManaged }) });
      if (!isCurrent()) return;
      const tokens = readOwnerTokens();
      delete tokens[id];
      writeOwnerTokens(tokens);
      removeOwnerSessionResource("watchlist", id);
      const nextLinks = savedLinks.filter((link) => link.id !== id);
      setSavedLinks(nextLinks);
      if (editingSavedLinkId === id) setEditingSavedLinkId(null);
      writeSavedLinks(nextLinks);
      onToast("가격 추적 공유 목록을 취소했습니다.");
    } catch (error: unknown) {
      if (isCurrent()) onToast(error instanceof Error ? error.message : "가격 추적 공유 목록을 취소하지 못했습니다.");
    } finally {
      if (isCurrent()) setRevokingWatchlist(false);
    }
  }
  async function updateAlertStates(action: "read" | "dismiss") {
    if (!capabilities.alerts) return;
    if (priceAlerts.length === 0) return;
    const alertIds = priceAlerts.map((alert) => alert.id);
    const mutationVersion = ++priceAlertMutationVersionRef.current;
    const contextKey = priceAlertContextKey;
    const isCurrent = () => mountedRef.current && priceAlertMutationVersionRef.current === mutationVersion && priceAlertContextKeyRef.current === contextKey;
    const token = savedLink ? readOwnerTokens()[savedLink.id] : undefined;
    const ownerManaged = savedLink ? hasOwnerSessionResource("watchlist", savedLink.id) : false;
    if (savedLink && ownerCredentialAvailable("watchlist", savedLink.id, { ownerToken: token, owned: ownerManaged })) {
      try {
        await api("/api/watchlists/" + encodeURIComponent(savedLink.id) + "/alerts/" + action, { method: "POST", ...ownerRequestOptions("watchlist", savedLink.id, { ownerToken: token, owned: ownerManaged }), body: JSON.stringify({ alertIds }) });
      } catch (error: unknown) {
        if (isCurrent()) onToast(error instanceof Error ? error.message : "가격 알림 상태를 저장하지 못했습니다.");
        return;
      }
    }
    if (!isCurrent()) return;
    if (action === "dismiss") {
      setPriceAlerts((current) => current.filter((alert) => !alertIds.includes(alert.id)));
      return;
    }
    const readAt = new Date().toISOString();
    setPriceAlerts((current) => current.map((alert) => ({ ...alert, readAt: alert.readAt ?? readAt })));
  }
  async function copyWatchlistSearchLink() {
    const url = window.location.origin + window.location.pathname + window.location.search;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(url);
      if (mountedRef.current) onToast("현재 가격 추적 검색 조건 링크를 복사했습니다.");
    } catch {
      if (mountedRef.current) onToast("현재 가격 추적 검색 조건 링크: " + url);
    }
  }

  async function copySavedLink(id: string) {
    if (!capabilities.serverSharing) return;
    const url = window.location.origin + "/watchlist/" + id;
    try {
      await navigator.clipboard.writeText(url);
      if (mountedRef.current) onToast("가격 추적 공유 링크를 복사했습니다.");
    } catch {
      if (mountedRef.current) onToast("가격 추적 공유 링크: " + url);
    }
  }

  return <><div className="price-watchlist-page"><div className="workspace-heading"><div><button className="back-link" type="button" onClick={onBack}><FiArrowLeft /> 홈으로</button><h1>가격 추적</h1><p>관심 부품을 등록하고 목표가를 설정하세요. 저장된 가격의 출처와 확인 날짜도 함께 보여드려요.</p></div><span className="admin-badge"><FiClock /> 저장된 가격</span></div><div className="mobile-price-watch-summary"><div><span className="mobile-kicker">가격 추적</span><strong>{watchEntries.length}개 추적 중</strong><small>{watchEntries.length > 0 ? "등록한 부품의 가격을 확인하세요." : "관심 부품을 추가하면 가격 판단을 시작할 수 있어요."}</small></div><button className="button button-light" type="button" onClick={() => setPriceRefreshNonce((current) => current + 1)} disabled={priceLoading || watchEntries.length === 0}>{priceLoading ? <><FiLoader className="spin" /> 확인 중...</> : <><FiRefreshCw /> 저장 가격 다시 확인</>}</button></div><div className="price-watchlist-grid"><section className="price-watchlist-search-card"><div className="price-watchlist-section-heading"><div><h2>추적할 부품 찾기</h2><p>핵심·주변 부품을 별도 카탈로그에서 검색합니다.</p></div><span>{total.toLocaleString("ko-KR")}개</span><button className="text-button price-watchlist-filter-link-button" type="button" data-testid="price-watchlist-copy-filter-link" onClick={() => void copyWatchlistSearchLink()}><FiCopy /> 조건 링크 복사</button></div><div className="price-watchlist-search-tools"><label><span>대상</span><select aria-label="가격 추적 검색 대상" value={kind} onChange={(event) => { setKind(event.target.value as "part" | "accessory"); setSearchOffset(0); }}><option value="part">핵심 부품</option><option value="accessory">주변 부품</option></select></label>{kind === "part" ? <label><span>분류</span><select aria-label="가격 추적 핵심 부품 분류" value={partCategory} onChange={(event) => { setPartCategory(event.target.value as PartCategory); setSearchOffset(0); }}>{PART_CATEGORIES.map((category) => <option value={category} key={category}>{CATEGORY_LABELS[category]}</option>)}</select></label> : <label><span>분류</span><select aria-label="가격 추적 주변 부품 분류" value={accessoryCategory} onChange={(event) => { setAccessoryCategory(event.target.value as AccessoryCategory | "all"); setSearchOffset(0); }}><option value="all">전체 주변 부품</option>{ACCESSORY_CATEGORIES.map((category) => <option value={category} key={category}>{ACCESSORY_CATEGORY_LABELS[category]}</option>)}</select></label>}<label className="price-watchlist-search-query"><span>검색</span><input aria-label="가격 추적 부품 검색" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSearchOffset(0); }} placeholder="모델명·브랜드 검색" /></label></div>{searchLoading && items.length === 0 ? <div className="price-watchlist-state"><FiLoader className="spin" /> 부품을 찾는 중...</div> : searchError && items.length === 0 ? <div className="price-watchlist-state error" role="alert"><FiXCircle /><span>{searchError}</span><button className="text-button" type="button" onClick={() => setSearchRetryNonce((current) => current + 1)}>다시 시도</button></div> : items.length === 0 ? <div className="price-watchlist-state"><FiSearch /> 검색 결과가 없습니다.</div> : <div className="price-watchlist-search-results">{items.map((item) => { const entry = { itemId: item.id, kind, category: item.category }; const watched = catalogWatchlistContains(watchEntries, entry); const sourceUrl = safeExternalUrl(item.danawaUrl); return <article className={watched ? "price-watchlist-search-item watched" : "price-watchlist-search-item"} key={kind + ":" + item.id}><div><strong>{item.name}</strong><small>{categoryLabel(item)} · {qualityLabel(item)} · {item.rawSpecText || "상세 스펙 정보 부족"}</small></div><div className="price-watchlist-search-side"><strong>{formatWon(item.priceWon)}</strong>{sourceUrl && <a className="price-watchlist-source-link" href={sourceUrl} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a>}<button className="button button-small" type="button" onClick={() => toggleWatch(item)}>{watched ? <><FiCheck /> 추적 중</> : <><FiPlus /> 추적 추가</>}</button></div></article>; })}</div>}{items.length < total && <button className="button button-light full-width" type="button" onClick={() => setSearchOffset((current) => current + 24)} disabled={searchLoading}>{searchLoading ? <><FiLoader className="spin" /> 불러오는 중...</> : "더 많은 부품 불러오기 (" + items.length.toLocaleString("ko-KR") + " / " + total.toLocaleString("ko-KR") + ")"}</button>}{searchError && items.length > 0 && <p className="price-watchlist-inline-error" role="alert"><FiXCircle /> {searchError} <button className="text-button" type="button" onClick={() => setSearchRetryNonce((current) => current + 1)}>다시 시도</button></p>}</section><section className="price-watchlist-tracker-card"><div className="price-watchlist-section-heading"><div><h2>내 가격 추적 목록</h2><p>저장된 가격과 목표가를 비교합니다.</p></div><div className="price-watchlist-tracker-actions"><input ref={watchlistImportInputRef} className="price-watchlist-import-input" type="file" accept=".json,.csv,text/csv,application/json" aria-label="가격 추적 CSV·JSON 파일 가져오기" onChange={(event) => void importWatchlistFile(event)} /><button className="button button-light" type="button" data-testid="price-watchlist-import" onClick={() => watchlistImportInputRef.current?.click()}><FiUpload /> CSV·JSON 가져오기</button><button className="button button-light" type="button" data-testid="price-watchlist-export-csv" onClick={() => downloadWatchlistExport("csv")} disabled={watchEntries.length === 0}><FiDownload /> CSV 저장</button><button className="button button-light" type="button" data-testid="price-watchlist-export" onClick={() => downloadWatchlistExport("json")} disabled={watchEntries.length === 0}><FiDownload /> JSON 저장</button><button className="button button-light" type="button" onClick={() => setPriceRefreshNonce((current) => current + 1)} disabled={priceLoading || watchEntries.length === 0}>{priceLoading ? <><FiLoader className="spin" /> 확인 중...</> : <><FiRefreshCw /> 저장 가격 다시 확인</>}</button></div></div>{priceListReadAt && <p className="price-watchlist-checked"><FiClock /> 목록을 불러온 시각 {dateTimeLabel(priceListReadAt)}</p>}{priceListReadAt && watchEntries.length > 0 && <div className="price-watchlist-decision-overview" aria-label="현재 가격 판단 분포" data-testid="price-watchlist-decision-overview"><strong>현재 판단 분포</strong><div>{(Object.keys(PRICE_WATCH_DECISION_LABELS) as Array<keyof typeof PRICE_WATCH_DECISION_LABELS>).filter((state) => capabilities.priceHistory || !["buy", "wait", "observe"].includes(state)).map((state) => <button className={state} data-testid={"price-watchlist-decision-" + state} disabled={decisionCounts[state] === 0} key={state} type="button" aria-pressed={watchListStatus === state} onClick={() => setWatchListStatus(state)}>{PRICE_WATCH_DECISION_LABELS[state]} <b>{decisionCounts[state]}</b></button>)}</div></div>}{capabilities.automaticRefresh && <div className="price-watchlist-monitor-controls"><label><input type="checkbox" aria-label="저장된 가격 자동 확인" checked={autoRefreshEnabled} onChange={(event) => { setAutoRefreshEnabled(event.target.checked); if (event.target.checked) setPriceRefreshNonce((current) => current + 1); }} /><span>화면을 열어 둔 동안 카탈로그를 다시 불러오기</span></label>{autoRefreshEnabled && <label className="price-watchlist-monitor-interval"><span>주기</span><select aria-label="가격 추적 자동 확인 주기" value={autoRefreshMinutes} onChange={(event) => setAutoRefreshMinutes(Number(event.target.value) as 5 | 15 | 30)}><option value={5}>5분</option><option value={15}>15분</option><option value={30}>30분</option></select></label>}<label className="price-watchlist-history-window"><span>가격 이력</span><select aria-label="가격 추적 가격 이력 기간" value={priceHistoryDays} onChange={(event) => setPriceHistoryDays(Number(event.target.value) as PriceHistoryWindow)}><option value={7}>7일</option><option value={30}>30일</option><option value={90}>90일</option></select></label><span className="price-watchlist-monitor-status">{autoRefreshEnabled ? "저장된 가격 자동 확인 " + autoRefreshMinutes + "분마다" : "자동 새로고침 꺼짐"}</span></div>}{capabilities.alerts && <PriceAlertPreferencesPanel value={alertPreferences} onChange={setAlertPreferences} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist} />}{capabilities.alerts && priceAlerts.length > 0 && <div className="price-watchlist-alerts"><div className="price-watchlist-alerts-heading"><strong><FiBell /> 최근 가격 알림{unreadAlertCount > 0 ? " · 미읽음 " + unreadAlertCount : ""}</strong><div className="price-watchlist-alert-actions"><button className="text-button" type="button" onClick={() => void updateAlertStates("read")} disabled={unreadAlertCount === 0}>모두 읽음</button><button className="text-button" type="button" onClick={() => void updateAlertStates("dismiss")}>알림 지우기</button></div></div>{priceAlerts.map((alert) => <article className={(alert.kind === "target" ? "price-watchlist-alert target" : alert.kind === "availability" ? "price-watchlist-alert availability" : "price-watchlist-alert") + (alert.readAt ? " read" : "")} key={alert.id}><FiBell /><div><strong>{alert.kind === "target" ? "목표가 도달" : alert.kind === "availability" ? "가격 확인 상태 변경" : "가격 하락 감지"}</strong><span>{alert.message}</span><small>{new Date(alert.createdAt).toLocaleString("ko-KR")}</small></div></article>)}</div>}{watchEntries.length > 0 && <PriceWatchlistEntryFilters query={watchListQuery} status={watchListStatus} sort={watchListSort} total={watchEntries.length} visible={visibleWatchEntries.length} allowAlerts={capabilities.alerts} allowHistory={capabilities.priceHistory} onQueryChange={setWatchListQuery} onStatusChange={setWatchListStatus} onSortChange={setWatchListSort} />}{watchEntries.length === 0 ? <div className="price-watchlist-empty\"><FiTag /><strong>아직 추적 중인 부품이 없습니다.</strong><span>왼쪽에서 CPU, 그래픽카드, SSD, 주변 부품을 검색해 추가해 보세요.</span></div> : visibleWatchEntries.length === 0 ? <div className="price-watchlist-filter-empty"><FiSearch /> 조건에 맞는 가격 추적 항목이 없습니다.<button className="text-button" type="button" onClick={resetWatchListView}>필터 초기화</button></div> : <div className="price-watchlist-tracked-list">{visibleWatchEntries.map((entry) => { const live = currentPrices[entryKey(entry)]; const targetReached = live?.status === "available" && live.priceWon !== undefined && entry.targetPriceWon !== undefined && live.priceWon <= entry.targetPriceWon; const targetGapWon = live?.priceWon !== undefined && entry.targetPriceWon !== undefined ? live.priceWon - entry.targetPriceWon : undefined; const history = priceHistories[entryKey(entry)]; const signals = historySignals(entry); const decision = priceWatchDecisionFor({ currentStatus: live?.status ?? "unknown", currentPriceWon: live?.priceWon, targetPriceWon: entry.targetPriceWon, nearLowThresholdPercent: watchThreshold, history: history?.summary }); return <article className="price-watchlist-tracked-item" key={entryKey(entry)}><div className="price-watchlist-tracked-copy"><strong>{entry.itemName}</strong><small>{entry.kind === "accessory" ? "주변 부품" : "핵심 부품"} · {entry.category}</small></div><label><span>목표가</span><input aria-label={entry.itemName + " 목표가"} type="number" min="1" step="1000" value={entry.targetPriceWon ?? ""} placeholder="미설정" onChange={(event) => updateTarget(entry, event.target.value)} />{history && recommendedTargetPriceFromHistory(history.summary) !== undefined && <button className="price-watchlist-target-suggest" type="button" aria-label={entry.itemName + " 최근 " + history.windowDays + "일 최저가로 목표가 설정"} onClick={() => suggestTargetFromHistory(entry, history)}>최근 {history.windowDays}일 최저가 {formatWon(recommendedTargetPriceFromHistory(history.summary))}</button>}</label><div className="price-watchlist-current"><span>카탈로그 가격</span><strong>{live?.status === "error" ? "일시 확인 오류" : live?.status === "unavailable" ? "가격 확인 불가" : live?.priceWon !== undefined ? formatWon(live.priceWon) : "미확인"}</strong><em className={`price-watchlist-decision ${decision.state}`}>{decision.label}</em><small className="price-watchlist-decision-summary">{decision.summary}</small>{live && <small className="price-watchlist-decision-summary">{live.status === "error" ? "가격 정보를 불러오지 못했어요." : priceCheckLabel(live)}</small>}{live?.sourceUrl && <a className="price-watchlist-source-link" href={live.sourceUrl} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a>}{targetGapWon !== undefined && !targetReached && <small className="price-watchlist-target-gap">목표가까지 +{formatWon(targetGapWon)}</small>}{history && history.summary.sampleCount >= 2 && <div className="price-watchlist-history"><small>최근 {history.windowDays}일 {history.summary.sampleCount}회{history.summary.minPriceWon !== undefined ? " · 최저가 " + formatWon(history.summary.minPriceWon) : ""}{history.summary.fromHighPercent !== undefined ? " · 최고가 대비 " + history.summary.fromHighPercent.toFixed(1) + "%" : ""}</small>{signals.length > 0 && <div className="price-watchlist-history-signals">{signals.map((signal) => <em key={signal}>{signal}</em>)}</div>}<div className="price-watchlist-sparkline" role="img" aria-label={entry.itemName + " 최근 " + history.windowDays + "일 가격 추세"}>{history.points.map((point) => <span key={point.changeId} style={{ height: historyBarHeight(history, point.priceWon) + "%" }} title={point.priceWon.toLocaleString("ko-KR") + "원"} />)}</div></div>}</div><button className="text-button" type="button" onClick={() => setWatchEntries((current) => removeCatalogWatchEntry(current, entry))}>제거</button></article>; })}</div>}<p className="price-watchlist-alert-summary"><FiTag />{" 현재 기준 활성 가격 신호 " + activeSignalCount + "개"}</p>{capabilities.serverSharing && <div className="price-watchlist-server-tools"><label><span>공유 목록 이름</span><input aria-label="가격 추적 공유 목록 이름" type="text" maxLength={60} value={watchlistName} onChange={(event) => setWatchlistName(event.target.value)} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist} /></label><label><span>최저가 근접 기준</span><select aria-label="가격 추적 최저가 근접 기준" value={watchThreshold} onChange={(event) => setWatchThreshold(Number(event.target.value) as WatchThreshold)} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist}><option value={5}>5%</option><option value={10}>10%</option><option value={20}>20%</option></select></label><label><span>공유 링크 유효기간</span><select aria-label="가격 추적 공유 링크 유효기간" value={watchlistExpiryDays} onChange={(event) => setWatchlistExpiryDays(event.target.value === "keep" ? "keep" : event.target.value === "7" ? 7 : event.target.value === "30" ? 30 : "never")} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist}>{watchlistExpiryDays === "keep" && <option value="keep">현재 만료 유지{savedLink?.expiresAt ? ` · ${new Date(savedLink.expiresAt).toLocaleString("ko-KR")}` : ""}</option>}<option value="never">무기한</option><option value="7">7일</option><option value="30">30일</option></select></label><button className="button button-secondary" type="button" onClick={() => void (editingSavedLinkId === savedLink?.id ? updateWatchlist() : saveWatchlist())} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist || watchEntries.length === 0}>{savingWatchlist ? <><FiLoader className="spin" /> 저장 중...</> : updatingWatchlist ? <><FiLoader className="spin" /> 업데이트 중...</> : editingSavedLinkId === savedLink?.id ? <><FiServer /> 목록 업데이트</> : <><FiServer /> 목록 저장·공유</>}</button>{editingSavedLinkId === savedLink?.id && <button className="button button-light" type="button" onClick={() => void saveWatchlist()} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist || watchEntries.length === 0}>새 목록으로 저장</button>}</div>}{capabilities.serverSharing && savedLinks.length > 0 && <section className="price-watchlist-saved-links" aria-label="내 서버 가격 추적 목록"><div className="price-watchlist-saved-links-heading"><strong><FiServer /> 내 가격 목록</strong><span>{savedLinks.length} / 20</span></div>{savedLinks.map((link) => { const url = window.location.origin + "/watchlist/" + link.id; return <article className={savedLink?.id === link.id ? "price-watchlist-saved-link active" : "price-watchlist-saved-link"} key={link.id}><div className="price-watchlist-saved-link-meta"><strong>{link.name ?? "가격 추적 목록"}</strong><small>{link.createdAt ? "저장 " + new Date(link.createdAt).toLocaleString("ko-KR") + " · " : ""}{link.updatedAt ? "수정 " + new Date(link.updatedAt).toLocaleString("ko-KR") + " · " : ""}{link.expiresAt ? "만료 " + new Date(link.expiresAt).toLocaleString("ko-KR") : "무기한"}{link.alertPreferences ? " · 알림 " + priceAlertPolicyText(link.alertPreferences) : ""}</small></div><label><span>공유 링크</span><input aria-label={(link.name ?? "가격 추적 목록") + " 공유 링크"} type="text" value={url} readOnly onFocus={(event) => event.currentTarget.select()} /></label><div className="price-watchlist-saved-link-actions"><a className="text-button" href={url}>열기</a><button className="text-button" type="button" onClick={() => void loadWatchlistForEdit(link.id)} disabled={savingWatchlist || updatingWatchlist || revokingWatchlist}>{editingSavedLinkId === link.id ? "편집 중" : "편집"}</button><button className="text-button" type="button" onClick={() => void copySavedLink(link.id)}>다시 복사</button><button className="text-button danger-text-button" type="button" onClick={() => void revokeWatchlistById(link.id)} disabled={revokingWatchlist || updatingWatchlist}>{revokingWatchlist ? <><FiLoader className="spin" /> 취소 중...</> : <><FiTrash2 /> 공유 취소</>}</button></div></article>; })}</section>}</section></div></div>{watchlistImportPreview && <WatchlistImportPreviewDialog preview={watchlistImportPreview} currentEntries={watchEntries} onClose={() => setWatchlistImportPreview(null)} onConfirm={applyWatchlistImport} />}</>;
}
