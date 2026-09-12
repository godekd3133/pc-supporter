import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { FiArrowLeft, FiCheck, FiClock, FiCopy, FiDatabase, FiExternalLink, FiInfo, FiLoader, FiPlus, FiRefreshCw, FiSearch, FiShield, FiTool, FiXCircle } from "react-icons/fi";
import type { AccessoryCategory, AccessoryItem, AccessoryPriceFilter, AccessoryRefreshResponse, AccessorySelection, CatalogChangeValueDiff, DataFreshness, DataQuality, ServiceMeta } from "../shared/types";
import { ACCESSORY_CATEGORIES, ACCESSORY_CATEGORY_LABELS, ACCESSORY_PRICE_FILTER_LABELS, DATA_FRESHNESS_LABELS, DATA_QUALITY_LABELS, LISTING_TYPE_LABELS } from "../shared/types";
import { CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistContains, catalogWatchlistFromJson } from "../shared/catalog-watchlist";
import { ACCESSORY_CATALOG_CACHE_STORAGE_KEY, accessoryCatalogCacheSnapshotFromJson, accessoryCatalogCacheToJson, accessoryCatalogCachedFallbackFor, mergeAccessoryCatalogCache } from "../shared/accessory-catalog-cache";
import { classifyDataFreshness } from "../shared/data-freshness";
import { CATALOG_CACHE_CHANGED_EVENT } from "../shared/catalog-cache-status";
import { CATALOG_PRICE_EVIDENCE_DESCRIPTIONS, CATALOG_PRICE_EVIDENCE_LABELS, catalogPriceEvidenceFor } from "../shared/catalog-price-evidence";
import { api } from "./api";
import { RetryAfterButton } from "./RetryAfterButton";
import { safeExternalUrl } from "./safe-source-url";
import { CatalogRefreshDiffPanel } from "./CatalogRefreshDiffPanel";

const LazyAccessoryDetailPanel = lazy(() => import("./AccessoryDetailPanel").then((module) => ({ default: module.AccessoryDetailPanel })));

type AccessoryVisualRenderer = ComponentType<{ item: AccessoryItem }>;

function initialAccessoryParam(name: string) {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get(name) ?? undefined;
}

function initialAccessoryQuery() {
  if (typeof window === "undefined") return "";
  return initialAccessoryParam("q")?.trim().slice(0, 160) ?? "";
}

function initialAccessoryBrand() {
  if (typeof window === "undefined") return "";
  return initialAccessoryParam("brand")?.trim().slice(0, 80) ?? "";
}

function initialAccessoryItemId() {
  return initialAccessoryParam("itemId")?.trim().slice(0, 160) || undefined;
}

function initialAccessoryCategory() {
  const value = initialAccessoryParam("category");
  return ACCESSORY_CATEGORIES.includes(value as AccessoryCategory) ? value as AccessoryCategory : "all" as const;
}

function initialAccessoryQuality() {
  const value = initialAccessoryParam("quality");
  return value === "live" || value === "seed" || value === "manual" || value === "incomplete" ? value : "all" as const;
}

function initialAccessoryFreshness() {
  const value = initialAccessoryParam("freshness");
  return value === "fresh" || value === "aging" || value === "stale" || value === "unknown" ? value : "all" as const;
}

function initialAccessorySort() {
  const value = initialAccessoryParam("sort");
  return value === "price_asc" || value === "price_desc" || value === "name" || value === "updated" ? value : "price_asc" as const;
}

function initialAccessoryPriceFilter() {
  const value = initialAccessoryParam("priceFilter");
  return value === "priced" || value === "under_10000" || value === "10000_50000" || value === "over_50000" ? value : "all" as const;
}

function accessoryIsWatched(item: AccessoryItem) {
  if (typeof window === "undefined") return false;
  return catalogWatchlistContains(catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)), { kind: "accessory", itemId: item.id });
}

function AccessoryWatchButton({ item, onWatch }: { item: AccessoryItem; onWatch: (item: AccessoryItem) => boolean }) {
  const [watching, setWatching] = useState(() => accessoryIsWatched(item));
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CATALOG_WATCHLIST_STORAGE_KEY) return;
      setWatching(catalogWatchlistContains(catalogWatchlistFromJson(event.newValue), { kind: "accessory", itemId: item.id }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [item.id]);
  function addToWatchlist() {
    if (onWatch(item)) setWatching(true);
  }
  return <button className={watching ? "text-button accessory-watch-button watched" : "text-button accessory-watch-button"} type="button" onClick={addToWatchlist} disabled={watching} aria-label={`${item.name} 가격 추적 ${watching ? "등록됨" : "등록"}`}><FiClock /> {watching ? "추적 중" : "가격 추적"}</button>;
}

function AccessoryFetchErrorNotice({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return <div className="fetch-error" role="alert"><div className="fetch-error-copy"><FiXCircle /><div><strong>주변 부품 목록을 불러오지 못했습니다.</strong><p>{message}</p><small>입력한 검색 조건과 선택 상태는 유지됩니다.</small></div></div><RetryAfterButton className="button button-small button-light" message={message} onRetry={onRetry} retrying={retrying} idleContent={<><FiRefreshCw /> 다시 불러오기</>} retryingContent={<><FiLoader className="spin" /> 불러오는 중...</>} testId="fetch-retry-button" /></div>;
}

function AccessoryCachedCatalogNotice({ visibleCount, total, latestUpdatedAt, cachedAt }: { visibleCount: number; total: number; latestUpdatedAt?: string; cachedAt?: string }) {
  const updatedAt = latestUpdatedAt ? new Date(latestUpdatedAt) : undefined;
  const updatedLabel = updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toLocaleDateString("ko-KR") : "갱신 시점 확인 필요";
  const cachedAtDate = cachedAt ? new Date(cachedAt) : undefined;
  const cachedLabel = cachedAtDate && !Number.isNaN(cachedAtDate.getTime()) ? cachedAtDate.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "기록 시각 확인 필요";
  const cacheFreshness = cachedAt ? classifyDataFreshness(cachedAt) : "unknown";
  const cacheFreshnessLabel = cacheFreshness === "fresh" ? "최근 캐시" : cacheFreshness === "aging" ? "갱신 권장" : cacheFreshness === "stale" ? "오래된 캐시" : "시각 미확인";
  return <div className={"accessory-cached-fallback " + cacheFreshness} data-testid="accessory-cached-fallback" role="status"><span className="accessory-cached-fallback-icon"><FiDatabase /></span><div><strong>브라우저에 저장된 주변 부품을 임시 표시합니다.</strong><p>서버 목록 요청이 실패해 마지막으로 확인된 {visibleCount.toLocaleString("ko-KR")} / {total.toLocaleString("ko-KR")}개 항목을 보여줍니다.</p><small>캐시 저장 {cachedLabel} · 원본 부품 갱신 {updatedLabel} · 탐색용 목록이며 최신 가격·원문·호환성은 서버 재연결 후 다시 확인합니다.</small></div><span className={"accessory-cached-fallback-badge " + cacheFreshness}>탐색 전용 · {cacheFreshnessLabel}</span></div>;
}

function AccessoryCachedCatalogList({ items, selectedAccessories, onAddAccessory, onWatchAccessory, onOpenDetail, formatWon, AccessoryVisual }: { items: AccessoryItem[]; selectedAccessories: AccessorySelection[]; onAddAccessory: (item: AccessoryItem) => void; onWatchAccessory?: (item: AccessoryItem) => boolean; onOpenDetail: (item: AccessoryItem) => void; formatWon: (value: number | undefined) => string; AccessoryVisual: AccessoryVisualRenderer }) {
  return <div className="accessory-list accessory-list-cached" data-testid="accessory-cached-catalog-list">{items.map((item) => {
    const selected = selectedAccessories.some((selection) => selection.accessoryId === item.id);
    const priceEvidence = catalogPriceEvidenceFor(item);
    return <article className={selected ? "accessory-item selected" : "accessory-item"} key={item.id}><span className="accessory-item-icon"><AccessoryVisual item={item} /></span><div className="accessory-item-main"><strong>{item.name}</strong><small>{item.rawSpecText || "저장된 기본 스펙을 확인해 주세요."}</small><span className="data-badges"><em className={"quality-badge " + item.dataQuality}>{DATA_QUALITY_LABELS[item.dataQuality]}</em><em className="category-badge">{ACCESSORY_CATEGORY_LABELS[item.category]}</em><em className="listing-badge">{LISTING_TYPE_LABELS.accessory}</em><em className={`catalog-price-evidence ${priceEvidence}`} data-testid={`accessory-price-evidence-${item.id}`} title={CATALOG_PRICE_EVIDENCE_DESCRIPTIONS[priceEvidence]}>{CATALOG_PRICE_EVIDENCE_LABELS[priceEvidence]}</em>{item.missingFields.length > 0 && <em className="missing-badge">누락 {item.missingFields.length}</em>}</span></div><div className="accessory-item-side"><button className="text-button accessory-detail-toggle" type="button" data-testid={"accessory-cached-detail-" + item.id} onClick={() => onOpenDetail(item)}>상세 보기</button><strong>{formatWon(item.priceWon)}</strong>{onWatchAccessory && <AccessoryWatchButton item={item} onWatch={onWatchAccessory} />}<button className="button button-small accessory-catalog-add" type="button" onClick={() => onAddAccessory(item)} disabled={selected}>{selected ? <><FiCheck /> 추가됨</> : <><FiPlus /> 견적에 추가</>}</button></div></article>;
  })}</div>;
}

export function AccessoryView({ meta, accessoryItems = [], selectedAccessories, onAddAccessory, onWatchAccessory, isAccessoryWatched, onOpenWatchlist, onOpenBuild, onBack, onToast, formatWon, AccessoryVisual }: { meta: ServiceMeta | null; accessoryItems?: AccessoryItem[]; selectedAccessories: AccessorySelection[]; onAddAccessory: (item: AccessoryItem) => void; onWatchAccessory?: (item: AccessoryItem) => boolean; isAccessoryWatched?: (item: AccessoryItem) => boolean; onOpenWatchlist: () => void; onOpenBuild: () => void; onBack: () => void; onToast: (message: string) => void; formatWon: (value: number | undefined) => string; AccessoryVisual: AccessoryVisualRenderer }) {
  const [query, setQuery] = useState(initialAccessoryQuery);
  const [brand, setBrand] = useState(initialAccessoryBrand);
  const [category, setCategory] = useState<AccessoryCategory | "all">(initialAccessoryCategory);
  const [quality, setQuality] = useState<"all" | DataQuality>(initialAccessoryQuality);
  const [freshness, setFreshness] = useState<"all" | DataFreshness>(initialAccessoryFreshness);
  const [sort, setSort] = useState<"price_asc" | "price_desc" | "name" | "updated">(initialAccessorySort);
  const [priceFilter, setPriceFilter] = useState<AccessoryPriceFilter>(initialAccessoryPriceFilter);
  const [items, setItems] = useState<AccessoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [freshnessExcludedCount, setFreshnessExcludedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [refreshingAccessoryId, setRefreshingAccessoryId] = useState<string | null>(null);
  const [refreshAccessoryFeedback, setRefreshAccessoryFeedback] = useState<{ itemId: string; tone: "success" | "error"; message: string; valueDiffs?: CatalogChangeValueDiff[] } | null>(null);
  const [cachedSnapshot, setCachedSnapshot] = useState(() => {
    try {
      return typeof window === "undefined" ? { schemaVersion: 1 as const, items: [] as AccessoryItem[] } : accessoryCatalogCacheSnapshotFromJson(window.localStorage.getItem(ACCESSORY_CATALOG_CACHE_STORAGE_KEY));
    } catch {
      return { schemaVersion: 1 as const, items: [] as AccessoryItem[] };
    }
  });
  const cachedItems = cachedSnapshot.items;
  const [itemId, setItemId] = useState<string | undefined>(initialAccessoryItemId);
  const [selectedAccessoryId, setSelectedAccessoryId] = useState<string | null>(initialAccessoryItemId() ?? null);
  const requestVersionRef = useRef(0);
  const accessoryDetailRequestVersionRef = useRef(0);
  const requestAbortControllerRef = useRef<AbortController | null>(null);
  const refreshRequestVersionRef = useRef(0);
  const previousAccessoryQueryRef = useRef<string | null>(null);
  const previousAccessoryUrlRef = useRef<string | null>(null);
  const restoreAccessoryUrlRef = useRef(false);
  const accessoryQueryHistoryActiveRef = useRef(false);
  const accessoryQueryHistoryTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== ACCESSORY_CATALOG_CACHE_STORAGE_KEY) return;
      setCachedSnapshot(accessoryCatalogCacheSnapshotFromJson(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (accessoryItems.length === 0) return;
    setCachedSnapshot((current) => ({ schemaVersion: 1, items: mergeAccessoryCatalogCache(current.items, accessoryItems), cachedAt: new Date().toISOString() }));
  }, [accessoryItems]);

  useEffect(() => {
    try {
      if (cachedSnapshot.items.length > 0) {
        window.localStorage.setItem(ACCESSORY_CATALOG_CACHE_STORAGE_KEY, accessoryCatalogCacheToJson(cachedSnapshot.items, cachedSnapshot.cachedAt));
        window.dispatchEvent(new Event(CATALOG_CACHE_CHANGED_EVENT));
      }
    } catch {
      // The in-memory cache still provides a fallback when storage is unavailable.
    }
  }, [cachedSnapshot]);

  function rememberAccessoryItems(incoming: ReadonlyArray<AccessoryItem>) {
    setCachedSnapshot((current) => ({ schemaVersion: 1, items: mergeAccessoryCatalogCache(current.items, incoming), cachedAt: new Date().toISOString() }));
  }

  useEffect(() => {
    if (typeof window === "undefined" || !window.location.pathname.startsWith("/accessories")) return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (brand.trim()) params.set("brand", brand.trim());
    if (itemId) params.set("itemId", itemId);
    if (category !== "all") params.set("category", category);
    if (quality !== "all") params.set("quality", quality);
    if (freshness !== "all") params.set("freshness", freshness);
    if (priceFilter !== "all") params.set("priceFilter", priceFilter);
    if (sort !== "price_asc") params.set("sort", sort);
    const nextSearch = params.toString();
    const nextUrl = `/accessories${nextSearch ? `?${nextSearch}` : ""}`;
    const currentUrl = window.location.pathname + window.location.search;
    const accessoryTextFilterKey = [query, brand].join("\u0001");
    const queryChanged = previousAccessoryQueryRef.current !== null && previousAccessoryQueryRef.current !== accessoryTextFilterKey;
    const clearQueryHistoryTimer = () => {
      if (accessoryQueryHistoryTimerRef.current !== null) {
        window.clearTimeout(accessoryQueryHistoryTimerRef.current);
        accessoryQueryHistoryTimerRef.current = null;
      }
    };
    if (restoreAccessoryUrlRef.current) {
      clearQueryHistoryTimer();
      accessoryQueryHistoryActiveRef.current = false;
      restoreAccessoryUrlRef.current = false;
      if (currentUrl !== nextUrl) window.history.replaceState(window.history.state, "", nextUrl);
      previousAccessoryQueryRef.current = accessoryTextFilterKey;
    } else if (queryChanged) {
      if (currentUrl !== nextUrl) {
        if (accessoryQueryHistoryActiveRef.current) window.history.replaceState(window.history.state, "", nextUrl);
        else if (previousAccessoryUrlRef.current === null) window.history.replaceState(window.history.state, "", nextUrl);
        else window.history.pushState(window.history.state, "", nextUrl);
      }
      previousAccessoryUrlRef.current = nextUrl;
      accessoryQueryHistoryActiveRef.current = true;
      clearQueryHistoryTimer();
      accessoryQueryHistoryTimerRef.current = window.setTimeout(() => {
        accessoryQueryHistoryActiveRef.current = false;
        accessoryQueryHistoryTimerRef.current = null;
      }, 800);
      previousAccessoryQueryRef.current = accessoryTextFilterKey;
      return;
    } else if (currentUrl !== nextUrl) {
      clearQueryHistoryTimer();
      accessoryQueryHistoryActiveRef.current = false;
      if (previousAccessoryUrlRef.current === null) window.history.replaceState(window.history.state, "", nextUrl);
      else window.history.pushState(window.history.state, "", nextUrl);
    }
    previousAccessoryUrlRef.current = nextUrl;
    previousAccessoryQueryRef.current = accessoryTextFilterKey;
  }, [brand, category, freshness, itemId, priceFilter, quality, query, sort]);

  useEffect(() => {
    setItems([]);
    setTotal(0);
    setFreshnessExcludedCount(0);
    setLoading(true);
    setError(null);
    setLoadingMore(false);
    setLoadMoreError(null);
  }, [brand, category, freshness, priceFilter, quality, query, sort]);

  useEffect(() => {
    const onPopState = () => {
      if (!window.location.pathname.startsWith("/accessories")) return;
      restoreAccessoryUrlRef.current = true;
      setQuery(initialAccessoryQuery());
      setBrand(initialAccessoryBrand());
      setItemId(initialAccessoryItemId());
      setSelectedAccessoryId(initialAccessoryItemId() ?? null);
      setCategory(initialAccessoryCategory());
      setQuality(initialAccessoryQuality());
      setFreshness(initialAccessoryFreshness());
      setSort(initialAccessorySort());
      setPriceFilter(initialAccessoryPriceFilter());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    refreshRequestVersionRef.current += 1;
  }, [itemId, selectedAccessoryId]);

  useEffect(() => {
    const requestVersion = ++accessoryDetailRequestVersionRef.current;
    if (!itemId) return;
    if (items.some((item) => item.id === itemId)) {
      setSelectedAccessoryId(itemId);
      return;
    }
    if (cachedItems.some((item) => item.id === itemId)) {
      setSelectedAccessoryId(itemId);
      return;
    }
    let cancelled = false;
    void api<AccessoryItem>(`/api/accessories/${encodeURIComponent(itemId)}`, { retry: 2, retryOnRateLimit: true })
      .then((item) => {
        if (cancelled || accessoryDetailRequestVersionRef.current !== requestVersion) return;
        rememberAccessoryItems([item]);
        setItems((current) => current.some((candidate) => candidate.id === item.id) ? current.map((candidate) => candidate.id === item.id ? item : candidate) : [item, ...current]);
        setSelectedAccessoryId(item.id);
      })
      .catch(() => {
        if (!cancelled && accessoryDetailRequestVersionRef.current === requestVersion) onToast("요청한 주변 부품 상세를 불러오지 못했습니다.");
      });
    return () => { cancelled = true; };
  }, [cachedItems, itemId, items, onToast]);

  useEffect(() => {
    let cancelled = false;
    const requestVersion = ++requestVersionRef.current;
    const controller = new AbortController();
    requestAbortControllerRef.current?.abort();
    requestAbortControllerRef.current = controller;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setItems([]);
      setTotal(0);
      setFreshnessExcludedCount(0);
      setLoadingMore(false);
      setLoadMoreError(null);
      setError(null);
      void api<{ items: AccessoryItem[]; total: number; freshnessExcludedCount?: number }>(`/api/accessories?q=${encodeURIComponent(query)}&brand=${encodeURIComponent(brand)}&category=${category}&quality=${quality}&freshness=${freshness}&sort=${sort}&priceFilter=${priceFilter}&offset=0&limit=50`, { signal: controller.signal })
        .then((payload) => {
          if (cancelled || requestVersionRef.current !== requestVersion) return;
          rememberAccessoryItems(payload.items);
          setItems(payload.items);
          setTotal(payload.total);
          setFreshnessExcludedCount(payload.freshnessExcludedCount ?? 0);
        })
        .catch((reason: unknown) => {
          if (!cancelled && requestVersionRef.current === requestVersion) setError(reason instanceof Error ? reason.message : "주변 부품을 불러오지 못했습니다.");
        })
        .finally(() => {
          if (!cancelled && requestVersionRef.current === requestVersion) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      refreshRequestVersionRef.current += 1;
      if (requestAbortControllerRef.current === controller) {
        controller.abort();
        requestAbortControllerRef.current = null;
      }
      window.clearTimeout(timer);
    };
  }, [query, brand, category, quality, freshness, sort, priceFilter, retryNonce]);

  async function copyAccessorySearchLink() {
    const url = window.location.origin + window.location.pathname + window.location.search;
    const isCurrent = () => mountedRef.current && window.location.pathname + window.location.search === new URL(url).pathname + new URL(url).search;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(url);
      if (isCurrent()) onToast("현재 주변 부품 검색 조건 링크를 복사했습니다.");
    } catch {
      if (isCurrent()) onToast("현재 주변 부품 검색 조건 링크: " + url);
    }
  }

  function clearAccessoryDetailSelection() {
    accessoryDetailRequestVersionRef.current += 1;
    setItemId(undefined);
    setSelectedAccessoryId(null);
  }

  async function loadMore() {
    if (loadingMore || items.length >= total) return;
    const requestVersion = requestVersionRef.current;
    const offset = items.length;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const payload = await api<{ items: AccessoryItem[]; total: number; freshnessExcludedCount?: number }>(`/api/accessories?q=${encodeURIComponent(query)}&brand=${encodeURIComponent(brand)}&category=${category}&quality=${quality}&freshness=${freshness}&sort=${sort}&priceFilter=${priceFilter}&offset=${offset}&limit=50`, { signal: requestAbortControllerRef.current?.signal });
      if (!mountedRef.current || requestVersionRef.current !== requestVersion) return;
      rememberAccessoryItems(payload.items);
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...payload.items.filter((item) => !known.has(item.id))];
      });
      setTotal(payload.total);
      setFreshnessExcludedCount(payload.freshnessExcludedCount ?? 0);
    } catch (reason: unknown) {
      if (mountedRef.current && requestVersionRef.current === requestVersion) setLoadMoreError(reason instanceof Error ? reason.message : "추가 주변 부품을 불러오지 못했습니다.");
    } finally {
      if (mountedRef.current && requestVersionRef.current === requestVersion) setLoadingMore(false);
    }
  }

  function accessoryCanRefresh(item: AccessoryItem) {
    return item.source === "danawa" && Boolean(item.sourceProductCode && safeExternalUrl(item.danawaUrl));
  }

  async function refreshAccessory(item: AccessoryItem) {
    if (!accessoryCanRefresh(item) || refreshingAccessoryId) return;
    const requestVersion = ++refreshRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && refreshRequestVersionRef.current === requestVersion;
    setRefreshingAccessoryId(item.id);
    setRefreshAccessoryFeedback(null);
    try {
      const payload = await api<AccessoryRefreshResponse>(`/api/accessories/${encodeURIComponent(item.id)}/refresh`, { method: "POST", retry: 0 });
      if (!isCurrent()) return;
      const refreshedItem: AccessoryItem = { ...payload.item, dataFreshness: classifyDataFreshness(payload.item.updatedAt) };
      rememberAccessoryItems([refreshedItem]);
      setItems((current) => current.map((candidate) => candidate.id === refreshedItem.id ? refreshedItem : candidate));
      setRefreshAccessoryFeedback({ itemId: refreshedItem.id, tone: "success", message: `${refreshedItem.name} 원문 확인 완료 · ${payload.changedFields.length > 0 ? `${payload.changedFields.length}개 영역 갱신` : "변경된 영역 없음"}`, valueDiffs: payload.valueDiffs ?? [] });
      setRetryNonce((current) => current + 1);
    } catch (reason: unknown) {
      if (!isCurrent()) return;
      setRefreshAccessoryFeedback({ itemId: item.id, tone: "error", message: reason instanceof Error ? reason.message : "주변 부품 상세 원문을 다시 확인하지 못했습니다." });
    } finally {
      if (isCurrent()) setRefreshingAccessoryId(null);
    }
  }

  const cachedCatalog = useMemo(() => mergeAccessoryCatalogCache(cachedItems, accessoryItems), [cachedItems, accessoryItems]);
  const cachedFallback = useMemo(() => accessoryCatalogCachedFallbackFor(cachedCatalog, {
    category,
    query,
    brand,
    quality,
    freshness,
    priceFilter,
    sort,
    limit: 50
  }), [cachedCatalog, category, query, brand, quality, freshness, priceFilter, sort]);
  const showCachedFallback = Boolean(error) && cachedFallback.total > 0;
  const visibleItems = showCachedFallback ? cachedFallback.items : items;
  const visibleTotal = showCachedFallback ? cachedFallback.total : total;
  const cachedLatestUpdatedAt = cachedCatalog.reduce<string | undefined>((latest, item) => !latest || item.updatedAt > latest ? item.updatedAt : latest, undefined);
  useEffect(() => {
    if (!showCachedFallback) return;
    setItems(cachedFallback.items);
    setTotal(cachedFallback.total);
  }, [showCachedFallback, cachedFallback]);
  useEffect(() => {
    if (!error) return;
    const retryWhenOnline = () => {
      if (navigator.onLine) setRetryNonce((current) => current + 1);
    };
    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, [error]);

  const selectedCoverage = category === "all" ? undefined : meta?.accessoryCoverage.categories.find((coverage) => coverage.category === category);
  const selectedCategorySeedCount = category === "all" ? 0 : meta?.accessoryCategoryQualityCounts?.[category]?.seed ?? 0;
  const coverageSummary = selectedCoverage
    ? `목록 ${selectedCoverage.listCoverage === "complete" ? "전체 확인" : "부분 확인"} · 저장 ${selectedCoverage.storedProductCount.toLocaleString("ko-KR")} / 기대 ${selectedCoverage.totalProductCount?.toLocaleString("ko-KR") ?? "?"}개 · starter ${selectedCategorySeedCount.toLocaleString("ko-KR")}개 · 상세 확인 ${selectedCoverage.liveProducts.toLocaleString("ko-KR")}개 · ${selectedCoverage.storedSpecCoverage === "complete" ? "저장 스펙 완전" : "저장 스펙 일부 부족"}`
    : meta
      ? (() => {
          const coverages = meta.accessoryCoverage.categories;
          const expected = coverages.reduce((totalCount, coverage) => totalCount + (coverage.totalProductCount ?? 0), 0);
          const stored = coverages.reduce((totalCount, coverage) => totalCount + coverage.storedProductCount, 0);
          const live = coverages.reduce((totalCount, coverage) => totalCount + coverage.liveProducts, 0);
          const missing = coverages.reduce((totalCount, coverage) => totalCount + coverage.missingProducts, 0);
          return `10개 범주 목록 기대 ${expected.toLocaleString("ko-KR")}개 · 저장 ${stored.toLocaleString("ko-KR")}개 · starter ${meta.accessoryQualityCounts.seed.toLocaleString("ko-KR")}개 · 상세 확인 ${live.toLocaleString("ko-KR")}개 · 목록 누락 ${missing.toLocaleString("ko-KR")}개`;
        })()
      : "수집 coverage를 확인하는 중입니다.";
  const selectedAccessory = visibleItems.find((item) => item.id === selectedAccessoryId) ?? cachedItems.find((item) => item.id === selectedAccessoryId) ?? null;
  const selectedAccessoryIsCached = Boolean(selectedAccessory && (showCachedFallback || !items.some((item) => item.id === selectedAccessory.id)));

  const selectedRefreshFeedback = selectedAccessory && refreshAccessoryFeedback?.itemId === selectedAccessory.id ? refreshAccessoryFeedback : null;
  const selectedAccessoryCanRefresh = Boolean(selectedAccessory && accessoryCanRefresh(selectedAccessory));
  const accessoryBrandOptions = useMemo(() => {
    const source = category === "all"
      ? Object.values(meta?.accessoryBrandCounts ?? {}).flat()
      : meta?.accessoryBrandCounts?.[category] ?? [];
    const counts = new Map<string, { brand: string; count: number }>();
    for (const option of source) {
      const key = option.brand.trim().toLocaleLowerCase("ko-KR");
      const current = counts.get(key);
      if (current) current.count += option.count;
      else counts.set(key, { brand: option.brand, count: option.count });
    }
    return [...counts.values()].sort((left, right) => right.count - left.count || left.brand.localeCompare(right.brand, "ko-KR")).slice(0, 80);
  }, [category, meta?.accessoryBrandCounts]);

  return <div className="accessory-page">
    <div className="workspace-heading"><div><button className="back-link" onClick={onBack}><FiArrowLeft /> 홈으로</button><p className="eyebrow">PERIPHERAL CATALOG</p><h1>주변 부품 카탈로그</h1><p>핵심 호환 부품과 분리한 주변 부품을 범주별로 검색하고 원문 정보를 확인합니다.</p></div></div>
    <section className="accessory-banner"><span className="accessory-banner-icon"><FiTool /></span><div><strong>{category === "all" ? "전체 주변 부품" : ACCESSORY_CATEGORY_LABELS[category]} {total.toLocaleString("ko-KR")}개</strong><p>저장장치 주변기기·쿨링·방열·그래픽카드 지지대·UPS는 핵심 호환 후보와 분리해 관리합니다.</p><small className="accessory-coverage-note"><FiShield /> {coverageSummary}</small></div>{selectedAccessories.length > 0 && <div className="accessory-quote-cta"><span><FiCheck /> 견적에 {selectedAccessories.length}종 추가됨</span><button className="button button-small" type="button" onClick={onOpenBuild}>견적 보기 <FiExternalLink /></button></div>}</section>
    <section className={showCachedFallback ? "accessory-browser cached" : "accessory-browser"}>
      <div className="accessory-browser-heading"><div><p className="eyebrow">ACCESSORY SEARCH</p><h2>필요한 주변 부품 찾기</h2></div><span className="muted-count">{items.length.toLocaleString("ko-KR")} / {total.toLocaleString("ko-KR")}개</span><button className="text-button accessory-filter-link-button" type="button" data-testid="accessory-copy-filter-link" onClick={() => void copyAccessorySearchLink()}><FiCopy /> 조건 링크 복사</button></div>
      <label className="accessory-search"><FiSearch /><input value={query} onChange={(event) => { clearAccessoryDetailSelection(); setQuery(event.target.value); }} placeholder="컨버터, 케이블, 도킹, 브라켓 검색" /></label>
      <div className="accessory-brand-filter-panel" aria-label="주변 부품 제조사 필터" data-testid="accessory-brand-filter"><label><span>MANUFACTURER FILTER · 제조사</span><input aria-label="주변 부품 제조사 필터" list="accessory-brand-options" type="search" value={brand} onChange={(event) => { clearAccessoryDetailSelection(); setBrand(event.target.value.slice(0, 80)); }} placeholder="예: ASUS · CORSAIR · 삼성" /></label><datalist id="accessory-brand-options">{accessoryBrandOptions.map((option) => <option value={option.brand} label={`${option.count}개`} key={option.brand} />)}</datalist>{accessoryBrandOptions.length > 0 && <div className="accessory-brand-suggestions" role="group" aria-label="주변 부품 제조사 빠른 선택">{accessoryBrandOptions.slice(0, 6).map((option) => <button className={brand.trim().toLocaleLowerCase("ko-KR") === option.brand.toLocaleLowerCase("ko-KR") ? "selected" : ""} type="button" aria-pressed={brand.trim().toLocaleLowerCase("ko-KR") === option.brand.toLocaleLowerCase("ko-KR")} onClick={() => { clearAccessoryDetailSelection(); setBrand(option.brand); }} key={option.brand}>{option.brand}<small>{option.count}</small></button>)}</div>}{brand.trim() && <button className="text-button" type="button" onClick={() => { clearAccessoryDetailSelection(); setBrand(""); }}>제조사 초기화</button>}</div>
      <p className="accessory-price-evidence-legend" data-testid="accessory-price-evidence-legend"><FiInfo /> 가격 숫자는 근거 유형을 함께 봐야 합니다. 목록·상세의 `다나와 수집가`·`수동 확인가`·`프로젝트 기준가`·`기록가 · 재확인` 배지를 확인하고, 기준가는 실제 판매가로 확정하지 마세요.</p>
      <div className="accessory-filters"><label><span>분류</span><select aria-label="주변 부품 분류" value={category} onChange={(event) => { clearAccessoryDetailSelection(); setCategory(event.target.value as AccessoryCategory | "all"); }}><option value="all">전체 주변 부품 {meta ? `(${meta.accessoryCount.toLocaleString("ko-KR")})` : ""}</option>{ACCESSORY_CATEGORIES.map((itemCategory) => <option key={itemCategory} value={itemCategory}>{ACCESSORY_CATEGORY_LABELS[itemCategory]} {meta ? `(${(meta.accessoryCategoryCounts[itemCategory] ?? 0).toLocaleString("ko-KR")})` : ""}</option>)}</select></label><label><span>데이터</span><select aria-label="주변 부품 데이터 품질" value={quality} onChange={(event) => { clearAccessoryDetailSelection(); setQuality(event.target.value as "all" | DataQuality); }}><option value="all">전체 데이터</option>{Object.entries(DATA_QUALITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>가격</span><select aria-label="주변 부품 가격 상태" value={priceFilter} onChange={(event) => { clearAccessoryDetailSelection(); setPriceFilter(event.target.value as AccessoryPriceFilter); }}><option value="all">{ACCESSORY_PRICE_FILTER_LABELS.all}</option><option value="priced">{ACCESSORY_PRICE_FILTER_LABELS.priced}</option><option value="under_10000">{ACCESSORY_PRICE_FILTER_LABELS.under_10000}</option><option value="10000_50000">{ACCESSORY_PRICE_FILTER_LABELS["10000_50000"]}</option><option value="over_50000">{ACCESSORY_PRICE_FILTER_LABELS.over_50000}</option></select></label><label><span>정렬</span><select aria-label="주변 부품 정렬" value={sort} onChange={(event) => { clearAccessoryDetailSelection(); setSort(event.target.value as typeof sort); }}><option value="price_asc">가격 낮은 순</option><option value="price_desc">가격 높은 순</option><option value="name">이름 순</option><option value="updated">최근 갱신</option></select></label><label className="accessory-freshness-filter"><span>갱신 상태</span><select aria-label="주변 부품 데이터 갱신 상태" value={freshness} onChange={(event) => { clearAccessoryDetailSelection(); setFreshness(event.target.value as "all" | DataFreshness); }}><option value="all">전체 상태</option><option value="fresh">{DATA_FRESHNESS_LABELS.fresh}</option><option value="aging">{DATA_FRESHNESS_LABELS.aging}</option><option value="stale">{DATA_FRESHNESS_LABELS.stale}</option><option value="unknown">{DATA_FRESHNESS_LABELS.unknown}</option></select></label></div>
      {loading ? <div className="accessory-state"><FiLoader className="spin" /> 주변 부품 목록을 불러오는 중...</div> : error ? <AccessoryFetchErrorNotice message={error} onRetry={() => setRetryNonce((current) => current + 1)} retrying={loading} /> : items.length === 0 ? <div className="accessory-state"><FiSearch /> 검색 결과가 없습니다.</div> : <div className="accessory-list">{items.map((item) => { const selected = selectedAccessories.some((selection) => selection.accessoryId === item.id); const sourceUrl = safeExternalUrl(item.danawaUrl); const priceEvidence = catalogPriceEvidenceFor(item); return <article className={selected ? "accessory-item selected" : "accessory-item"} key={item.id}><span className="accessory-item-icon"><AccessoryVisual item={item} /></span><div className="accessory-item-main"><strong>{item.name}</strong><small>{item.rawSpecText || "원문 스펙을 확인해 주세요."}</small><span className="data-badges">{item.dataFreshness && <em className={`freshness-badge ${item.dataFreshness}`}>{DATA_FRESHNESS_LABELS[item.dataFreshness]}</em>}<em className={`quality-badge ${item.dataQuality}`}>{DATA_QUALITY_LABELS[item.dataQuality]}</em><em className="category-badge">{ACCESSORY_CATEGORY_LABELS[item.category]}</em><em className="listing-badge">{LISTING_TYPE_LABELS.accessory}</em><em className={`catalog-price-evidence ${priceEvidence}`} data-testid={`accessory-price-evidence-${item.id}`} title={CATALOG_PRICE_EVIDENCE_DESCRIPTIONS[priceEvidence]}>{CATALOG_PRICE_EVIDENCE_LABELS[priceEvidence]}</em>{item.missingFields.length > 0 && <em className="missing-badge">누락 {item.missingFields.length}</em>}</span></div><div className="accessory-item-side"><button className="text-button accessory-detail-toggle" type="button" data-testid={`accessory-detail-${item.id}`} onClick={() => { setSelectedAccessoryId(item.id); setItemId(item.id); }}>상세 보기</button><strong>{formatWon(item.priceWon)}</strong>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">원문 <FiExternalLink /></a>}{onWatchAccessory && <AccessoryWatchButton item={item} onWatch={onWatchAccessory} />}<button className="button button-small accessory-catalog-add" type="button" onClick={() => onAddAccessory(item)} disabled={selected}>{selected ? <><FiCheck /> 추가됨</> : <><FiPlus /> 견적에 추가</>}</button></div></article>; })}</div>}
      {items.length < total && <button className="button button-light full-width accessory-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <><FiLoader className="spin" /> 추가 항목 불러오는 중...</> : <>더 많은 주변 부품 불러오기 ({items.length.toLocaleString("ko-KR")} / {total.toLocaleString("ko-KR")})</>}</button>}
      {showCachedFallback && <AccessoryCachedCatalogNotice visibleCount={visibleItems.length} total={visibleTotal} latestUpdatedAt={cachedLatestUpdatedAt} cachedAt={cachedSnapshot.cachedAt} />}
      {showCachedFallback && <AccessoryCachedCatalogList items={visibleItems} selectedAccessories={selectedAccessories} onAddAccessory={onAddAccessory} onWatchAccessory={onWatchAccessory} onOpenDetail={(item) => { setSelectedAccessoryId(item.id); setItemId(item.id); }} formatWon={formatWon} AccessoryVisual={AccessoryVisual} />}
      {loadMoreError && <div className="catalog-more-error"><span>{loadMoreError}</span><button className="text-button" type="button" onClick={() => void loadMore()}>다시 불러오기</button></div>}
      {freshness !== "all" && <p className="accessory-freshness-summary">{DATA_FRESHNESS_LABELS[freshness]} · {total.toLocaleString("ko-KR")}개 표시{freshnessExcludedCount > 0 ? ` · 다른 갱신 상태 ${freshnessExcludedCount.toLocaleString("ko-KR")}개 제외` : ""}</p>}
    </section>
    {selectedAccessory && <Suspense fallback={<div className="accessory-detail-panel accessory-detail-loading" role="status"><FiLoader className="spin" /> 주변 부품 상세를 불러오는 중...</div>}><LazyAccessoryDetailPanel item={selectedAccessory} selected={selectedAccessories.some((selection) => selection.accessoryId === selectedAccessory.id)} isWatched={isAccessoryWatched?.(selectedAccessory) ?? accessoryIsWatched(selectedAccessory)} isCachedFallback={selectedAccessoryIsCached} cachedAt={cachedSnapshot.cachedAt} refreshing={refreshingAccessoryId === selectedAccessory.id} onRefresh={selectedAccessoryCanRefresh ? () => void refreshAccessory(selectedAccessory) : undefined} refreshMessage={selectedRefreshFeedback?.tone === "success" ? selectedRefreshFeedback.message : undefined} refreshError={selectedRefreshFeedback?.tone === "error" ? selectedRefreshFeedback.message : undefined} refreshDiffs={selectedRefreshFeedback?.tone === "success" ? selectedRefreshFeedback.valueDiffs : undefined} onAdd={() => onAddAccessory(selectedAccessory)} onWatch={() => onWatchAccessory ? onWatchAccessory(selectedAccessory) : false} onOpenWatchlist={onOpenWatchlist} onClose={() => { setSelectedAccessoryId(null); setItemId(undefined); }} /></Suspense>}
  </div>;
}
