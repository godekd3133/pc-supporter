import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { FiCheckCircle, FiClock, FiDownload, FiInfo, FiLoader, FiRefreshCw, FiSearch, FiServer, FiTrash2, FiXCircle } from "react-icons/fi";
import type { AccessoryCategory, CatalogChangeKind, CatalogChangeRecord, PartCategory } from "../shared/types";
import { ACCESSORY_CATEGORIES, ACCESSORY_CATEGORY_LABELS, CATEGORY_LABELS, PART_CATEGORIES } from "../shared/types";
import { catalogChangeCsvFor, catalogChangeJsonFor } from "../shared/catalog-change-export";
import type { CatalogChangeExportFilters } from "../shared/catalog-change-export";
import { catalogChangePriceHistoryFor, catalogChangePriceHistoryWithinWindowFor, catalogChangePriceNearLowRankingsFor, catalogChangePriceOpportunitiesFor, catalogChangePriceVolatilityRankingsFor, catalogChangePriceWatchSignalsFor, catalogChangePriceWindowSummaryFor, catalogChangeTrendFor } from "../shared/catalog-change-analytics";
import type { CatalogChangePriceWatchSignal } from "../shared/catalog-change-analytics";
import { catalogChangeDashboardSummary, catalogChangeMatches, catalogChangeMissingIncreased, catalogChangeQualityDegraded, prioritizedCatalogChanges } from "../shared/catalog-change-filters";
import type { CatalogChangeFilter, CatalogChangeKindFilter } from "../shared/catalog-change-filters";
import { addCatalogWatchEntry, catalogWatchEntryKey, catalogWatchlistContains, catalogWatchlistFromJson, catalogWatchlistToJson, mergeCatalogWatchEntries, removeCatalogWatchEntry, updateCatalogWatchEntry } from "../shared/catalog-watchlist";
import type { CatalogWatchEntry } from "../shared/catalog-watchlist";
import { catalogWatchlistCsvFor, catalogWatchlistJsonFor } from "../shared/catalog-watchlist-export";
import type { CatalogWatchSnapshot } from "../shared/catalog-watchlist-export";
import { catalogWatchlistEntriesFromCsv, catalogWatchlistEntriesFromJson } from "../shared/catalog-watchlist-import";
import { catalogWatchlistShareHashFor, catalogWatchlistSharePayloadFromHash } from "../shared/catalog-watchlist-share";
import { catalogWatchSnapshotMatches, sortCatalogWatchSnapshots } from "../shared/catalog-watchlist-view";
import type { CatalogWatchlistStatusFilter, CatalogWatchlistSort } from "../shared/catalog-watchlist-view";
import { api } from "./api";
import { safeExternalUrl } from "./safe-source-url";

const CATALOG_WATCHLIST_STORAGE_KEY = "pc-supporter-catalog-watchlist";
const CATALOG_WATCH_THRESHOLD_STORAGE_KEY = "pc-supporter-catalog-watch-threshold";
const CATALOG_WATCH_THRESHOLDS = [5, 10, 20] as const;
type CatalogWatchThreshold = (typeof CATALOG_WATCH_THRESHOLDS)[number];
type SavedWatchlistExpiryDays = "never" | 7 | 30;
type SavedCatalogWatchlist = {
  id: string;
  name: string;
  entries: CatalogWatchEntry[];
  nearLowThresholdPercent: CatalogWatchThreshold;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  alertPreferences?: unknown;
};

type CatalogChangeCategoryFilter = "all" | PartCategory | AccessoryCategory;

type CatalogChangeHistoryPanelProps = {
  records: CatalogChangeRecord[];
  loading: boolean;
  error: string | null;
  historyLimit: number;
  fromDate: string;
  toDate: string;
  categoryFilter: CatalogChangeCategoryFilter;
  onHistoryLimitChange: (value: number) => void;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  onCategoryFilterChange: (value: CatalogChangeCategoryFilter) => void;
  onRefresh: () => void;
  onToast: (message: string) => void;
};

export function CatalogChangeHistoryPanel({ records, loading, error, historyLimit, fromDate, toDate, categoryFilter, onHistoryLimitChange, onFromDateChange, onToDateChange, onCategoryFilterChange, onRefresh, onToast }: CatalogChangeHistoryPanelProps) {
  const [kindFilter, setKindFilter] = useState<CatalogChangeKindFilter>("all");
  const [changeFilter, setChangeFilter] = useState<CatalogChangeFilter>("all");
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [watchEntries, setWatchEntries] = useState<CatalogWatchEntry[]>(() => typeof window === "undefined" ? [] : catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)));
  const [watchThreshold, setWatchThreshold] = useState<CatalogWatchThreshold>(() => {
    if (typeof window === "undefined") return 10;
    const value = Number(window.localStorage.getItem(CATALOG_WATCH_THRESHOLD_STORAGE_KEY));
    return value === 5 || value === 10 || value === 20 ? value : 10;
  });
  const [shareLinkUrl, setShareLinkUrl] = useState<string | null>(null);
  const [shareLinkTruncatedCount, setShareLinkTruncatedCount] = useState(0);
  const [watchlistName, setWatchlistName] = useState("내 관심 가격 목록");
  const [watchlistExpiryDays, setWatchlistExpiryDays] = useState<SavedWatchlistExpiryDays>("never");
  const [savingWatchlist, setSavingWatchlist] = useState(false);
  const [revokingWatchlist, setRevokingWatchlist] = useState(false);
  const [savedWatchlistUrl, setSavedWatchlistUrl] = useState<string | null>(null);
  const [savedWatchlistId, setSavedWatchlistId] = useState<string | null>(null);
  const [savedWatchlistExpiresAt, setSavedWatchlistExpiresAt] = useState<string | null>(null);
  const [watchQuery, setWatchQuery] = useState("");
  const [watchStatusFilter, setWatchStatusFilter] = useState<CatalogWatchlistStatusFilter>("all");
  const [watchSort, setWatchSort] = useState<CatalogWatchlistSort>("added_desc");
  const watchImportRef = useRef<HTMLInputElement>(null);
  useEffect(() => { window.localStorage.setItem(CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistToJson(watchEntries)); }, [watchEntries]);
  useEffect(() => { window.localStorage.setItem(CATALOG_WATCH_THRESHOLD_STORAGE_KEY, String(watchThreshold)); }, [watchThreshold]);
  useEffect(() => {
    const shared = catalogWatchlistSharePayloadFromHash(window.location.hash);
    if (shared.errors.length > 0) {
      onToast(`관심 목록 공유 링크를 열지 못했습니다: ${shared.errors[0]}`);
      return;
    }
    if (shared.entries.length === 0) return;
    setWatchEntries((current) => mergeCatalogWatchEntries(current, shared.entries));
    if (shared.nearLowThresholdPercent !== undefined) setWatchThreshold(shared.nearLowThresholdPercent);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    onToast(`${shared.entries.length}개 관심 가격 항목을 공유 링크에서 병합했습니다.`);
  }, [onToast]);
  const visibleRecords = useMemo(() => records.filter((record) => catalogChangeMatches(record, kindFilter, changeFilter)), [changeFilter, kindFilter, records]);
  const summary = useMemo(() => catalogChangeDashboardSummary(visibleRecords), [visibleRecords]);
  const priorityRecords = useMemo(() => prioritizedCatalogChanges(visibleRecords, 6), [visibleRecords]);
  const trend = useMemo(() => catalogChangeTrendFor(visibleRecords, { days: 7 }), [visibleRecords]);
  const trendMax = useMemo(() => Math.max(1, ...trend.points.map((point) => Math.max(point.priceUpWon, point.priceDownWon))), [trend]);
  const priceOpportunities = useMemo(() => catalogChangePriceOpportunitiesFor(visibleRecords, 6), [visibleRecords]);
  const priceVolatilityRankings = useMemo(() => catalogChangePriceVolatilityRankingsFor(visibleRecords, 5), [visibleRecords]);
  const priceNearLowRankings = useMemo(() => catalogChangePriceNearLowRankingsFor(visibleRecords, 5), [visibleRecords]);
  const watchedProfiles = useMemo(() => watchEntries.map((entry) => {
    const itemRecords = visibleRecords.filter((record) => record.kind === entry.kind && record.itemId === entry.itemId);
    const history = catalogChangePriceHistoryFor(itemRecords);
    const summary = catalogChangePriceWindowSummaryFor(history, { days: 30 });
    return { entry, inScope: itemRecords.length > 0, summary, signals: catalogChangePriceWatchSignalsFor(summary, watchThreshold, entry.targetPriceWon) };
  }), [visibleRecords, watchEntries, watchThreshold]);
  const watchSnapshots = useMemo<CatalogWatchSnapshot[]>(() => watchedProfiles.map((profile) => ({ entry: profile.entry, currentDataStatus: profile.summary.latestPriceWon === undefined ? profile.inScope ? "price_unavailable" : "out_of_scope" : "available", targetPriceWon: profile.entry.targetPriceWon, sampleCount: profile.summary.sampleCount, latestPriceWon: profile.summary.latestPriceWon, minPriceWon: profile.summary.minPriceWon, maxPriceWon: profile.summary.maxPriceWon, fromHighDeltaWon: profile.summary.fromHighDeltaWon, fromHighPercent: profile.summary.fromHighPercent, currentPositionPercent: profile.summary.currentPositionPercent, signals: profile.signals.map((signal) => watchSignalLabel(signal)) })), [watchedProfiles]);
  const visibleWatchSnapshots = useMemo(() => sortCatalogWatchSnapshots(watchSnapshots.filter((snapshot) => catalogWatchSnapshotMatches(snapshot, watchQuery, watchStatusFilter)), watchSort), [watchQuery, watchSort, watchSnapshots, watchStatusFilter]);
  const visibleWatchedProfiles = useMemo(() => {
    const profilesByKey = new Map(watchedProfiles.map((profile) => [catalogWatchEntryKey(profile.entry), profile]));
    return visibleWatchSnapshots.flatMap((snapshot) => {
      const profile = profilesByKey.get(catalogWatchEntryKey(snapshot.entry));
      return profile ? [profile] : [];
    });
  }, [visibleWatchSnapshots, watchedProfiles]);
  const visibleActiveWatchCount = useMemo(() => visibleWatchedProfiles.filter((profile) => profile.signals.length > 0).length, [visibleWatchedProfiles]);
  const selectedRecord = useMemo(() => visibleRecords.find((record) => record.id === selectedChangeId), [selectedChangeId, visibleRecords]);
  const selectedHistory = useMemo(() => selectedRecord ? visibleRecords.filter((record) => record.itemId === selectedRecord.itemId).sort((left, right) => right.changedAt.localeCompare(left.changedAt)) : [], [selectedRecord, visibleRecords]);
  const allPriceHistory = useMemo(() => catalogChangePriceHistoryFor(selectedHistory), [selectedHistory]);
  const priceHistory = useMemo(() => catalogChangePriceHistoryWithinWindowFor(allPriceHistory, { days: 30 }), [allPriceHistory]);
  const priceHistorySummary = useMemo(() => catalogChangePriceWindowSummaryFor(allPriceHistory, { days: 30 }), [allPriceHistory]);
  const priceHistoryMin = useMemo(() => priceHistory.length > 0 ? Math.min(...priceHistory.map((point) => point.priceWon)) : 0, [priceHistory]);
  const priceHistoryMax = useMemo(() => priceHistory.length > 0 ? Math.max(...priceHistory.map((point) => point.priceWon)) : 0, [priceHistory]);
  function categoryLabel(category: CatalogChangeRecord["category"]) {
    return category in CATEGORY_LABELS ? CATEGORY_LABELS[category as PartCategory] : ACCESSORY_CATEGORY_LABELS[category as AccessoryCategory];
  }
  function qualityLabel(value: CatalogChangeRecord["nextDataQuality"]) {
    return value === "live" ? "live" : value === "manual" ? "수동 검수" : value === "seed" ? "seed" : "확인 필요";
  }
  function priceText(record: CatalogChangeRecord) {
    if (record.previousPriceWon === undefined || record.nextPriceWon === undefined) return "가격 확인 필요";
    const delta = record.priceDeltaWon;
    if (delta === undefined) return `${record.previousPriceWon.toLocaleString("ko-KR")}원 → ${record.nextPriceWon.toLocaleString("ko-KR")}원 · 가격 변화 확인 필요`;
    if (delta === 0) return `${record.nextPriceWon.toLocaleString("ko-KR")}원 · 변화 없음`;
    return `${record.previousPriceWon.toLocaleString("ko-KR")}원 → ${record.nextPriceWon.toLocaleString("ko-KR")}원 · ${delta > 0 ? "+" : ""}${delta.toLocaleString("ko-KR")}원`;
  }
  function priceTone(record: CatalogChangeRecord) {
    const delta = record.priceDeltaWon;
    return delta === undefined || delta === 0 ? "catalog-change-price" : delta > 0 ? "catalog-change-price up" : "catalog-change-price down";
  }
  function priceValue(value: number | undefined) {
    return value === undefined ? "가격 확인 필요" : `${value.toLocaleString("ko-KR")}원`;
  }
  function signedWon(value: number) {
    return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}원`;
  }
  function signedPercent(value: number) {
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  }
  function missingText(fields: string[]) {
    return fields.length > 0 ? fields.join(" · ") : "필수 누락 없음";
  }
  function priceHistoryBarHeight(value: number) {
    if (priceHistoryMax === priceHistoryMin) return 52;
    return 18 + ((value - priceHistoryMin) / (priceHistoryMax - priceHistoryMin)) * 82;
  }
  function isWatched(kind: CatalogChangeKind, itemId: string) {
    return catalogWatchlistContains(watchEntries, { kind, itemId });
  }
  function watchButtonLabel(kind: CatalogChangeKind, itemId: string) {
    return isWatched(kind, itemId) ? "관심 해제" : "관심 등록";
  }
  function watchSignalLabel(signal: CatalogChangePriceWatchSignal) {
    switch (signal) {
      case "near_low":
        return "최저가 근접";
      case "below_high":
        return "최고가 대비 하락";
      case "rebound":
        return "하락 후 재상승";
      case "target_reached":
        return "목표가 도달";
    }
  }
  function watchKindFor(itemId: string): CatalogChangeKind {
    return visibleRecords.find((record) => record.itemId === itemId)?.kind ?? "part";
  }
  function toggleWatch(item: Pick<CatalogWatchEntry, "itemId" | "itemName" | "category" | "kind">) {
    const watched = isWatched(item.kind, item.itemId);
    setWatchEntries((current) => watched ? removeCatalogWatchEntry(current, item) : addCatalogWatchEntry(current, { ...item, addedAt: new Date().toISOString() }));
    setShareLinkUrl(null);
    setShareLinkTruncatedCount(0);
    setSavedWatchlistUrl(null);
    setSavedWatchlistId(null);
    setSavedWatchlistExpiresAt(null);
    onToast(watched ? `${item.itemName}을(를) 관심 목록에서 제거했습니다.` : `${item.itemName}을(를) 관심 가격에 등록했습니다.`);
  }
  function updateWatchTarget(entry: CatalogWatchEntry, rawValue: string) {
    const targetPriceWon = rawValue.trim() === "" ? undefined : Number(rawValue);
    if (targetPriceWon !== undefined && (!Number.isFinite(targetPriceWon) || targetPriceWon <= 0)) return;
    setWatchEntries((current) => updateCatalogWatchEntry(current, entry, { targetPriceWon }));
    setShareLinkUrl(null);
    setShareLinkTruncatedCount(0);
    setSavedWatchlistUrl(null);
    setSavedWatchlistId(null);
    setSavedWatchlistExpiresAt(null);
  }
  function updateWatchThreshold(value: number) {
    if (value !== 5 && value !== 10 && value !== 20) return;
    setWatchThreshold(value);
    setShareLinkUrl(null);
    setShareLinkTruncatedCount(0);
    setSavedWatchlistUrl(null);
    setSavedWatchlistId(null);
    setSavedWatchlistExpiresAt(null);
  }
  function downloadWatchlistExport(format: "csv" | "json") {
    if (watchSnapshots.length === 0) {
      onToast("내보낼 관심 가격 항목이 없습니다.");
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
    onToast(`${watchSnapshots.length}개 관심 가격 항목을 ${format.toUpperCase()}로 저장했습니다.`);
  }
  async function importWatchlistFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const raw = await file.text();
      const result = file.name.toLocaleLowerCase().endsWith(".csv") ? catalogWatchlistEntriesFromCsv(raw) : catalogWatchlistEntriesFromJson(raw);
      if (result.errors.length > 0) {
        onToast(`관심 목록을 가져오지 못했습니다: ${result.errors.slice(0, 3).join(" · ")}`);
        return;
      }
      if (result.entries.length === 0) {
        onToast("가져올 관심 가격 항목이 없습니다.");
        return;
      }
      setWatchEntries((current) => mergeCatalogWatchEntries(current, result.entries));
      if (result.nearLowThresholdPercent !== undefined) setWatchThreshold(result.nearLowThresholdPercent);
      setShareLinkUrl(null);
      setShareLinkTruncatedCount(0);
      setSavedWatchlistUrl(null);
      setSavedWatchlistId(null);
      setSavedWatchlistExpiresAt(null);
      onToast(`${result.entries.length}개 관심 가격 항목을 가져와 병합했습니다.`);
    } catch {
      onToast("관심 목록 파일을 읽지 못했습니다.");
    }
  }
  async function copyShareLinkUrl(url: string, truncatedCount = 0) {
    const truncatedMessage = truncatedCount > 0 ? ` ${truncatedCount}개는 URL 길이 제한으로 포함하지 않았습니다.` : "";
    try {
      await navigator.clipboard.writeText(url);
      onToast(`관심 가격 공유 링크를 복사했습니다.${truncatedMessage}`);
    } catch {
      onToast(`관심 가격 공유 링크가 생성되었습니다: ${url}${truncatedMessage}`);
    }
  }
  async function copyWatchlistShareLink() {
    if (watchEntries.length === 0) {
      onToast("공유할 관심 가격 항목이 없습니다.");
      return;
    }
    const built = catalogWatchlistShareHashFor(watchEntries, watchThreshold);
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}${built.hash}`;
    setShareLinkUrl(url);
    setShareLinkTruncatedCount(built.truncatedCount);
    await copyShareLinkUrl(url, built.truncatedCount);
  }
  async function saveWatchlistToServer() {
    if (watchEntries.length === 0) {
      onToast("저장할 관심 가격 항목이 없습니다.");
      return;
    }
    setSavingWatchlist(true);
    try {
      const saved = await api<SavedCatalogWatchlist>("/api/watchlists", { method: "POST", body: JSON.stringify({ name: watchlistName.trim() || "관심 가격 목록", entries: watchEntries, nearLowThresholdPercent: watchThreshold, expiresInDays: watchlistExpiryDays === "never" ? undefined : watchlistExpiryDays }) });
      const url = `${window.location.origin}/watchlist/${saved.id}`;
      setSavedWatchlistUrl(url);
      setSavedWatchlistId(saved.id);
      setSavedWatchlistExpiresAt(saved.expiresAt ?? null);
      try {
        await navigator.clipboard.writeText(url);
        onToast("관심 가격 목록을 서버에 저장하고 공유 링크를 복사했습니다.");
      } catch {
        onToast(`관심 가격 목록을 서버에 저장했습니다: ${url}`);
      }
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "관심 가격 목록을 서버에 저장하지 못했습니다.");
    } finally {
      setSavingWatchlist(false);
    }
  }
  async function copySavedWatchlistLink() {
    if (!savedWatchlistUrl) return;
    try {
      await navigator.clipboard.writeText(savedWatchlistUrl);
      onToast("서버 공유 링크를 복사했습니다.");
    } catch {
      onToast(`서버 공유 링크: ${savedWatchlistUrl}`);
    }
  }
  async function revokeSavedWatchlist() {
    if (!savedWatchlistId || revokingWatchlist) return;
    if (!window.confirm("이 서버 공유 목록을 취소할까요? 이미 전달된 링크도 더 이상 열리지 않습니다.")) return;
    setRevokingWatchlist(true);
    try {
      await api(`/api/watchlists/${encodeURIComponent(savedWatchlistId)}`, { method: "DELETE" });
      setSavedWatchlistUrl(null);
      setSavedWatchlistId(null);
      setSavedWatchlistExpiresAt(null);
      onToast("서버 공유 목록을 취소했습니다.");
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "서버 공유 목록을 취소하지 못했습니다.");
    } finally {
      setRevokingWatchlist(false);
    }
  }
  function resetFilters() {
    setKindFilter("all");
    setChangeFilter("all");
    onCategoryFilterChange("all");
  }
  function resetWatchView() {
    setWatchQuery("");
    setWatchStatusFilter("all");
    setWatchSort("added_desc");
  }
  function changeRiskLabel(record: CatalogChangeRecord) {
    const risks = [
      ...(catalogChangeQualityDegraded(record) ? ["품질 저하"] : []),
      ...(catalogChangeMissingIncreased(record) ? ["누락 증가"] : [])
    ];
    return risks.length > 0 ? risks.join(" · ") : undefined;
  }
  function downloadExport(format: "csv" | "json") {
    if (visibleRecords.length === 0) {
      onToast("내보낼 변경 이력이 없습니다.");
      return;
    }
    const filters: CatalogChangeExportFilters = { kind: kindFilter, change: changeFilter, limit: historyLimit, ...(fromDate ? { from: fromDate } : {}), ...(toDate ? { to: toDate } : {}) };
    const content = format === "csv" ? catalogChangeCsvFor(visibleRecords) : catalogChangeJsonFor(visibleRecords, filters);
    const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-catalog-changes-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    onToast(`${visibleRecords.length}건의 변경 이력을 ${format.toUpperCase()}로 저장했습니다.`);
  }
  return <section className="admin-card catalog-change-card">
    <div className="admin-card-heading"><div><p className="eyebrow">CATALOG CHANGE LOG</p><h3>최근 원문 갱신 이력</h3></div><div className="catalog-change-heading-actions"><span>{visibleRecords.length} / {records.length}건 표시</span><button className="text-button" type="button" onClick={onRefresh} disabled={loading}>{loading ? <><FiLoader className="spin" /> 불러오는 중...</> : <><FiRefreshCw /> 새로고침</>}</button></div></div>
    <p className="admin-card-description">원문 재확인 이력을 기간·부품 범위·변화 유형으로 좁혀 확인합니다. 현재 조회 결과는 CSV 또는 원본 JSON으로 내보낼 수 있습니다.</p>
    {loading ? <div className="catalog-change-state"><FiLoader className="spin" /> 변경 이력을 불러오는 중...</div> : <>
      <div className="catalog-change-filters" aria-label="변경 로그 조회 및 필터">
        <label className="catalog-change-filter"><span>조회 건수</span><select aria-label="변경 로그 조회 건수" value={historyLimit} onChange={(event) => onHistoryLimitChange(Number(event.target.value))}><option value={24}>최근 24건</option><option value={50}>최근 50건</option><option value={100}>최근 100건</option></select></label>
        <label className="catalog-change-filter"><span>시작일</span><input aria-label="변경 로그 시작일" type="date" value={fromDate} max={toDate || undefined} onChange={(event) => onFromDateChange(event.target.value)} /></label>
        <label className="catalog-change-filter"><span>종료일</span><input aria-label="변경 로그 종료일" type="date" value={toDate} min={fromDate || undefined} onChange={(event) => onToDateChange(event.target.value)} /></label>
        <label className="catalog-change-filter"><span>범위</span><select aria-label="변경 로그 범위" value={kindFilter} onChange={(event) => setKindFilter(event.target.value as CatalogChangeKindFilter)}><option value="all">전체 부품</option><option value="part">핵심 부품</option><option value="accessory">주변 부품</option></select></label>
        <label className="catalog-change-filter"><span>분류</span><select aria-label="변경 로그 카테고리" value={categoryFilter} onChange={(event) => onCategoryFilterChange(event.target.value as CatalogChangeCategoryFilter)}><option value="all">전체 분류</option><optgroup label="핵심 부품">{PART_CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</optgroup><optgroup label="주변 부품">{ACCESSORY_CATEGORIES.map((category) => <option key={category} value={category}>{ACCESSORY_CATEGORY_LABELS[category]}</option>)}</optgroup></select></label>
        <label className="catalog-change-filter"><span>변화 유형</span><select aria-label="변경 로그 변화 유형" value={changeFilter} onChange={(event) => setChangeFilter(event.target.value as CatalogChangeFilter)}><option value="all">전체 변화</option><option value="price_up">가격 상승</option><option value="price_down">가격 하락</option><option value="price_newly_known">가격 신규 확인</option><option value="quality_improved">품질 개선</option><option value="quality_degraded">품질 저하</option><option value="missing_reduced">누락 감소</option><option value="missing_increased">누락 증가</option><option value="spec">스펙 변경</option><option value="benchmark">벤치마크 보강</option></select></label>
        <div className="catalog-change-filter-actions"><button className="button button-light" type="button" onClick={() => downloadExport("csv")} disabled={visibleRecords.length === 0}><FiDownload /> CSV 저장</button><button className="button button-light" type="button" onClick={() => downloadExport("json")} disabled={visibleRecords.length === 0}><FiDownload /> JSON 저장</button></div>
      </div>
      {error ? <div className="catalog-change-state error" role="alert"><FiXCircle /><span>{error}</span><button className="text-button" type="button" onClick={onRefresh}>다시 불러오기</button></div> : <>
        <div className="catalog-change-priority" aria-label="변경 로그 우선 확인 큐">
          <div className="catalog-change-priority-heading"><div><p className="eyebrow">ATTENTION QUEUE</p><strong>우선 확인 큐</strong><small>품질 저하·누락 증가·가격 상승처럼 운영 확인이 필요한 기록을 먼저 보여줍니다.</small></div><span>{priorityRecords.length}건</span></div>
          {priorityRecords.length === 0 ? <p className="catalog-change-priority-empty"><FiCheckCircle /> 현재 조회 범위에 즉시 확인이 필요한 회귀가 없습니다.</p> : <div className="catalog-change-priority-list">{priorityRecords.map((item) => <article className="catalog-change-priority-item" key={item.record.id}><div><span className="catalog-change-risk">{item.reasons.join(" · ")}</span><strong>{item.record.itemName}</strong><small>{categoryLabel(item.record.category)} · {new Date(item.record.changedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</small></div><em>{item.score}점</em></article>)}</div>}
        </div>
        <div className="catalog-change-summary" aria-label="현재 조회 변경 요약">
          <div><span>가격 상승</span><strong>{summary.priceUp}</strong></div>
          <div><span>가격 하락</span><strong>{summary.priceDown}</strong></div>
          <div><span>가격 신규 확인</span><strong>{summary.priceNewlyKnown}</strong></div>
          <div><span>품질 개선</span><strong>{summary.qualityImproved}</strong></div>
          <div className="catalog-change-summary-risk"><span>품질 저하</span><strong>{summary.qualityDegraded}</strong></div>
          <div><span>누락 감소</span><strong>{summary.missingReduced}</strong></div>
          <div className="catalog-change-summary-risk"><span>누락 증가</span><strong>{summary.missingIncreased}</strong></div>
          <div><span>스펙 변경</span><strong>{summary.specChanged}</strong></div>
          <div><span>벤치마크 보강</span><strong>{summary.benchmarkChanged}</strong></div>
        </div>
        <section className="catalog-change-trend" aria-label="가격 변화 추이"><div className="catalog-change-trend-heading"><div><p className="eyebrow">PRICE MOVEMENT</p><strong>최근 7일 가격 변화</strong><small>현재 조회·필터 결과에서 가격을 양쪽 모두 확인할 수 있었던 기록의 증감을 합산합니다. 상품 간 가격지수는 아닙니다.</small></div><span>{trend.priceChangeCount}건 비교 가능</span></div>{trend.priceChangeCount === 0 ? <p className="catalog-change-trend-empty"><FiInfo /> 비교 가능한 가격 증감 기록이 없습니다.</p> : <><div className="catalog-change-trend-chart" role="img" aria-label="최근 7일 가격 상승 및 하락 금액 막대 그래프">{trend.points.map((point) => <div className="catalog-change-trend-point" key={point.date}><div className="catalog-change-trend-bars" aria-hidden="true"><span className="up" style={{ height: `${(point.priceUpWon / trendMax) * 100}%` }} title={`상승 ${point.priceUpWon.toLocaleString("ko-KR")}원`} /><span className="down" style={{ height: `${(point.priceDownWon / trendMax) * 100}%` }} title={`하락 ${point.priceDownWon.toLocaleString("ko-KR")}원`} /></div><strong>{point.date.slice(5).replace("-", "/")}</strong><small>{point.priceChangeCount}건</small></div>)}</div><div className="catalog-change-trend-legend"><span><i className="up" /> 상승 {signedWon(trend.priceUpWon)} · {trend.priceUpCount}건</span><span><i className="down" /> 하락 {signedWon(-trend.priceDownWon)} · {trend.priceDownCount}건</span><strong>순변화 {signedWon(trend.netDeltaWon)}</strong></div></>}</section>
        <section className="catalog-change-opportunities" aria-label="가격 하락 검토 큐"><div className="catalog-change-opportunities-heading"><div><p className="eyebrow">PRICE OPPORTUNITY</p><strong>가격 하락 검토</strong><small>같은 부품에서 2개 이상의 가격 샘플이 있고, 최근 확인 가격이 과거 최고가보다 낮은 경우만 표시합니다. 할인 확정이 아닌 추가 확인 신호입니다.</small></div><span>{priceOpportunities.length}건</span></div>{priceOpportunities.length === 0 ? <p className="catalog-change-opportunities-empty"><FiInfo /> 현재 조회 범위에 조건을 만족하는 가격 하락 신호가 없습니다.</p> : <div className="catalog-change-opportunities-list">{priceOpportunities.map((opportunity) => <article className="catalog-change-opportunity" key={opportunity.itemId}><div><strong>{opportunity.itemName}</strong><small>{categoryLabel(opportunity.category)} · 가격 확인 {opportunity.sampleCount}회 · 최근 {new Date(opportunity.latestChangedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</small><button className="text-button catalog-watch-inline" type="button" onClick={() => toggleWatch({ itemId: opportunity.itemId, itemName: opportunity.itemName, category: opportunity.category, kind: watchKindFor(opportunity.itemId) })}>{watchButtonLabel(watchKindFor(opportunity.itemId), opportunity.itemId)}</button></div><div className="catalog-change-opportunity-side"><span>{signedWon(opportunity.fromHighDeltaWon)} ({signedPercent(opportunity.fromHighPercent)})</span><small>최고가 대비 · {opportunity.currentPositionPercent === undefined ? "현재 위치 계산 불가" : "현재 위치 " + opportunity.currentPositionPercent.toFixed(1) + "%"}</small>{opportunity.hasDropThenRebound && <em>하락 후 재상승</em>}</div><button className="text-button" type="button" onClick={() => setSelectedChangeId(opportunity.latestChangeId)}>상세 비교</button></article>)}</div>}</section>
        <section className="catalog-change-rankings" aria-label="가격 변화 순위"><div className="catalog-change-rankings-heading"><div><p className="eyebrow">PRICE RANKINGS</p><strong>부품별 가격 신호 순위</strong><small>최근 30일 안에서 가격 샘플이 2개 이상인 동일 부품만 비교합니다.</small></div><span>상위 5개</span></div><div className="catalog-change-rankings-grid"><div className="catalog-change-ranking-column"><div className="catalog-change-ranking-column-heading"><strong>변동 폭 큰 부품</strong><small>최저가↔최고가 범위</small></div>{priceVolatilityRankings.length === 0 ? <p className="catalog-change-ranking-empty"><FiInfo /> 비교 가능한 변동 폭이 없습니다.</p> : <div className="catalog-change-ranking-list">{priceVolatilityRankings.map((item) => <article className="catalog-change-ranking-item" key={item.itemId}><div><strong>{item.itemName}</strong><small>{categoryLabel(item.category)} · 가격 확인 {item.sampleCount}회</small><button className="text-button catalog-watch-inline" type="button" onClick={() => toggleWatch({ itemId: item.itemId, itemName: item.itemName, category: item.category, kind: watchKindFor(item.itemId) })}>{watchButtonLabel(watchKindFor(item.itemId), item.itemId)}</button></div><div className="catalog-change-ranking-metric"><strong>{signedWon(item.rangeWon)} ({signedPercent(item.rangePercent ?? 0)})</strong><small>30일 변동폭</small></div><button className="text-button" type="button" onClick={() => setSelectedChangeId(item.latestChangeId)}>상세 비교</button></article>)}</div>}</div><div className="catalog-change-ranking-column"><div className="catalog-change-ranking-column-heading"><strong>최저가 근접 부품</strong><small>현재가의 가격 범위 위치</small></div>{priceNearLowRankings.length === 0 ? <p className="catalog-change-ranking-empty"><FiInfo /> 비교 가능한 최저가 위치가 없습니다.</p> : <div className="catalog-change-ranking-list">{priceNearLowRankings.map((item) => <article className="catalog-change-ranking-item" key={item.itemId}><div><strong>{item.itemName}</strong><small>{categoryLabel(item.category)} · 최근 {priceValue(item.latestPriceWon)}</small><button className="text-button catalog-watch-inline" type="button" onClick={() => toggleWatch({ itemId: item.itemId, itemName: item.itemName, category: item.category, kind: watchKindFor(item.itemId) })}>{watchButtonLabel(watchKindFor(item.itemId), item.itemId)}</button></div><div className="catalog-change-ranking-metric"><strong>{item.currentPositionPercent?.toFixed(1)}%</strong><small>최저가↔최고가 중 현재 위치</small>{item.hasDropThenRebound && <em>하락 후 재상승</em>}</div><button className="text-button" type="button" onClick={() => setSelectedChangeId(item.latestChangeId)}>상세 비교</button></article>)}</div>}</div></div></section>
        <section className="catalog-watchlist" aria-label="관심 가격 목록"><input ref={watchImportRef} className="catalog-watchlist-import-input" type="file" accept=".json,.csv,text/csv,application/json" aria-label="관심 가격 목록 파일 가져오기" onChange={(event) => void importWatchlistFile(event)} /><div className="catalog-watchlist-heading"><div><p className="eyebrow">WATCHLIST</p><strong>관심 가격 목록</strong><small>이 브라우저에 저장해 둔 부품의 현재 가격 신호를 다시 확인합니다.</small></div><div className="catalog-watchlist-heading-side"><label><span>최저가 근접 기준</span><select aria-label="관심 가격 최저가 근접 기준" value={watchThreshold} onChange={(event) => updateWatchThreshold(Number(event.target.value))}><option value={5}>5%</option><option value={10}>10%</option><option value={20}>20%</option></select></label><span>{visibleWatchSnapshots.length} / {watchEntries.length}개 · 신호 {visibleActiveWatchCount}개</span><div className="catalog-watchlist-export-actions"><button className="button button-light" type="button" onClick={() => watchImportRef.current?.click()}>가져오기</button><button className="button button-light" type="button" onClick={() => void copyWatchlistShareLink()}>공유 링크</button><button className="button button-light" type="button" onClick={() => downloadWatchlistExport("csv")} disabled={watchSnapshots.length === 0}>CSV</button><button className="button button-light" type="button" onClick={() => downloadWatchlistExport("json")} disabled={watchSnapshots.length === 0}>JSON</button></div></div></div>{shareLinkUrl && <div className="catalog-watchlist-share-preview"><label><span>공유 링크 주소</span><input aria-label="관심 가격 공유 링크 주소" type="text" value={shareLinkUrl} readOnly onFocus={(event) => event.currentTarget.select()} /></label><button className="text-button" type="button" onClick={() => void copyShareLinkUrl(shareLinkUrl, shareLinkTruncatedCount)}>다시 복사</button>{shareLinkTruncatedCount > 0 && <small>{shareLinkTruncatedCount}개 항목은 URL 길이 제한으로 링크에 포함되지 않았습니다.</small>}</div>}{watchEntries.length > 0 && <div className="catalog-watchlist-tools"><label><span>검색</span><input aria-label="관심 가격 검색" type="search" value={watchQuery} onChange={(event) => setWatchQuery(event.target.value)} placeholder="부품명·ID·카테고리" /></label><label><span>상태</span><select aria-label="관심 가격 상태 필터" value={watchStatusFilter} onChange={(event) => setWatchStatusFilter(event.target.value as CatalogWatchlistStatusFilter)}><option value="all">모든 관심</option><option value="signals">활성 신호 있음</option><option value="target_reached">목표가 도달</option><option value="available">가격 이력 확인</option><option value="price_unavailable">가격 미확인</option><option value="out_of_scope">범위 밖</option></select></label><label><span>정렬</span><select aria-label="관심 가격 정렬" value={watchSort} onChange={(event) => setWatchSort(event.target.value as CatalogWatchlistSort)}><option value="added_desc">최근 등록</option><option value="signal_desc">신호 우선</option><option value="price_asc">현재가 낮은 순</option><option value="target_gap_asc">목표가 차액 순</option></select></label></div>}{watchEntries.length > 0 && <div className="catalog-watchlist-server-save"><label><span>서버 저장 이름</span><input aria-label="관심 가격 목록 이름" type="text" maxLength={60} value={watchlistName} onChange={(event) => setWatchlistName(event.target.value)} placeholder="예: 4K 게이밍 관심 부품" disabled={savingWatchlist || revokingWatchlist} /></label><label><span>공유 링크 유효기간</span><select aria-label="관심 가격 서버 공유 링크 유효기간" value={watchlistExpiryDays} onChange={(event) => setWatchlistExpiryDays(event.target.value === "7" ? 7 : event.target.value === "30" ? 30 : "never")} disabled={savingWatchlist || revokingWatchlist}><option value="never">무기한</option><option value="7">7일</option><option value="30">30일</option></select></label><button className="button button-secondary" type="button" onClick={() => void saveWatchlistToServer()} disabled={savingWatchlist || revokingWatchlist}>{savingWatchlist ? <><FiLoader className="spin" /> 저장 중...</> : <><FiServer /> 서버에 저장</>}</button></div>}{savedWatchlistUrl && <div className="catalog-watchlist-server-link"><label><span>서버 공유 링크</span><input aria-label="서버 관심 가격 공유 링크 주소" type="text" value={savedWatchlistUrl} readOnly onFocus={(event) => event.currentTarget.select()} /></label><div className="catalog-watchlist-server-link-actions"><button className="text-button" type="button" onClick={() => void copySavedWatchlistLink()}>다시 복사</button><button className="text-button danger-text-button" type="button" onClick={() => void revokeSavedWatchlist()} disabled={revokingWatchlist}>{revokingWatchlist ? <><FiLoader className="spin" /> 취소 중...</> : <><FiTrash2 /> 공유 저장 취소</>}</button></div><small>{savedWatchlistExpiresAt ? `이 링크는 ${new Date(savedWatchlistExpiresAt).toLocaleString("ko-KR")}에 만료됩니다.` : "이 링크는 무기한 유지됩니다. 필요하면 공유 저장 취소로 즉시 폐기할 수 있습니다."}</small></div>}{watchEntries.length === 0 ? <p className="catalog-watchlist-empty"><FiInfo /> 가격 순위나 검토 큐에서 관심 등록을 눌러 보관할 수 있습니다.</p> : visibleWatchedProfiles.length === 0 ? <p className="catalog-watchlist-filter-empty"><FiSearch /> 선택한 조건에 맞는 관심 항목이 없습니다.<button className="text-button" type="button" onClick={resetWatchView}>관심 목록 필터 초기화</button></p> : <div className="catalog-watchlist-list">{visibleWatchedProfiles.map((profile) => <article className="catalog-watchlist-item" key={catalogWatchEntryKey(profile.entry)}><div><strong>{profile.entry.itemName}</strong><small>{profile.entry.kind === "accessory" ? "주변 부품" : "핵심 부품"} · {categoryLabel(profile.entry.category)} · 등록 {new Date(profile.entry.addedAt).toLocaleDateString("ko-KR")}</small></div><label className="catalog-watchlist-target"><span>목표가</span><input aria-label={`${profile.entry.itemName} 목표가`} type="number" min="1" step="1000" placeholder="원" value={profile.entry.targetPriceWon ?? ""} onChange={(event) => updateWatchTarget(profile.entry, event.target.value)} /></label>{profile.summary.latestPriceWon === undefined ? <span className="catalog-watchlist-missing">{profile.inScope ? "현재 조회 범위에 가격 미확인" : "현재 조회 범위에 가격 이력 없음"}</span> : <div className="catalog-watchlist-metric"><strong>{priceValue(profile.summary.latestPriceWon)}</strong><small>{profile.summary.sampleCount >= 2 && profile.summary.fromHighDeltaWon !== undefined && profile.summary.fromHighPercent !== undefined ? "최고가 대비 " + signedWon(profile.summary.fromHighDeltaWon) + " (" + signedPercent(profile.summary.fromHighPercent) + ")" : "가격 확인 " + profile.summary.sampleCount + "회"}</small><div className="catalog-watchlist-signals">{profile.signals.length > 0 ? profile.signals.map((signal) => <span key={signal}>{watchSignalLabel(signal)}</span>) : <span className="inactive">현재 기준 신호 없음</span>}</div></div>}<button className="text-button" type="button" onClick={() => toggleWatch(profile.entry)}>관심 해제</button></article>)}</div>}<p className="catalog-watchlist-note"><FiInfo /> 현재 선택한 조회 기간·카테고리 범위 밖의 부품은 가격 이력 없음으로 보이며, 관심 등록 자체는 유지됩니다.</p></section>
        {selectedRecord && <section className="catalog-change-detail" aria-label="변경 상세 비교">
          <div className="catalog-change-detail-heading"><div><p className="eyebrow">CHANGE DETAIL</p><h4>{selectedRecord.itemName}</h4><small>{selectedRecord.kind === "accessory" ? "주변 부품" : "핵심 부품"} · {categoryLabel(selectedRecord.category)} · {new Date(selectedRecord.changedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</small></div><button className="text-button catalog-watch-detail-button" type="button" onClick={() => toggleWatch({ itemId: selectedRecord.itemId, itemName: selectedRecord.itemName, category: selectedRecord.category, kind: selectedRecord.kind })}>{watchButtonLabel(selectedRecord.kind, selectedRecord.itemId)}</button><button className="text-button" type="button" onClick={() => setSelectedChangeId(null)}>닫기</button></div>
          <div className="catalog-change-detail-diff"><div><span>이전 상태</span><strong>{qualityLabel(selectedRecord.previousDataQuality)}</strong><small>{priceValue(selectedRecord.previousPriceWon)}</small><p>누락: {missingText(selectedRecord.previousMissingFields)}</p></div><b aria-hidden="true">→</b><div><span>현재 상태</span><strong>{qualityLabel(selectedRecord.nextDataQuality)}</strong><small>{priceValue(selectedRecord.nextPriceWon)}</small><p>누락: {missingText(selectedRecord.nextMissingFields)}</p></div></div>
          <div className="catalog-change-price-history"><div className="catalog-change-price-history-heading"><span>이 부품의 가격 흐름</span><small>가격 확인 {priceHistory.length}회</small></div>{priceHistory.length < 2 ? <p className="catalog-change-price-history-empty"><FiInfo /> 비교 가능한 가격 이력이 2개 미만입니다.</p> : <><div className="catalog-change-price-history-chart" role="img" aria-label={`${selectedRecord.itemName} 가격 이력 그래프`}>{priceHistory.map((point) => <div className="catalog-change-price-history-point" key={point.changeId}><div className="catalog-change-price-history-bar" style={{ height: `${priceHistoryBarHeight(point.priceWon)}%` }} title={`${point.priceWon.toLocaleString("ko-KR")}원`} /><strong>{point.priceWon.toLocaleString("ko-KR")}원</strong><small>{new Date(point.changedAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}</small></div>)}</div><div className="catalog-change-price-history-summary"><span>최저 {priceValue(priceHistoryMin)}</span><span>최고 {priceValue(priceHistoryMax)}</span><strong>최근 {priceValue(priceHistory[priceHistory.length - 1].priceWon)}</strong></div><div className="catalog-change-price-history-metrics"><div><span>최초 → 최근</span><strong>{signedWon(priceHistorySummary.netDeltaWon ?? 0)} <small>({signedPercent(priceHistorySummary.netChangePercent ?? 0)})</small></strong></div><div><span>최고가 대비 최근</span><strong>{signedWon(priceHistorySummary.fromHighDeltaWon ?? 0)} <small>({signedPercent(priceHistorySummary.fromHighPercent ?? 0)})</small></strong></div></div><div className="catalog-change-price-window-insights"><div><span>30일 변동폭</span><strong>{priceValue(priceHistorySummary.rangeWon ?? 0)} <small>({signedPercent(priceHistorySummary.rangePercent ?? 0)})</small></strong></div><div><span>현재 가격 위치</span><strong>{priceHistorySummary.currentPositionPercent === undefined ? "가격대 동일" : priceHistorySummary.currentPositionPercent.toFixed(1) + "%"}</strong></div><div><span>패턴</span><strong>{priceHistorySummary.hasDropThenRebound ? "하락 후 재상승 감지" : "재상승 미확인"}</strong></div></div></>}</div>
          <div className="catalog-change-detail-fields"><span>변경 영역</span><strong>{selectedRecord.changedFields.length > 0 ? selectedRecord.changedFields.join(" · ") : "값 변화 없음"}</strong></div>
          {selectedHistory.length > 1 && <div className="catalog-change-timeline"><span>같은 부품 조회 기록</span>{selectedHistory.map((history) => <button className={history.id === selectedRecord.id ? "selected" : ""} type="button" key={history.id} onClick={() => setSelectedChangeId(history.id)}><small>{new Date(history.changedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</small><strong>{history.changedFields.length > 0 ? history.changedFields.join(" · ") : "값 변화 없음"}</strong></button>)}</div>}
        </section>}
        {records.length === 0 ? <div className="catalog-change-state"><FiClock /> 아직 기록된 원문 갱신이 없습니다.</div> : visibleRecords.length === 0 ? <div className="catalog-change-state"><FiSearch /><span>선택한 필터에 맞는 변경이 없습니다.</span><button className="text-button" type="button" onClick={resetFilters}>필터 초기화</button></div> : <div className="catalog-change-list">{visibleRecords.map((record) => <article className="catalog-change-item" key={record.id}><div className="catalog-change-item-main"><div className="catalog-change-item-top"><span className={record.kind === "accessory" ? "catalog-change-kind accessory" : "catalog-change-kind"}>{record.kind === "accessory" ? "주변 부품" : "핵심 부품"}</span><span>{categoryLabel(record.category)}</span><small>{new Date(record.changedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</small></div><strong>{record.itemName}</strong><div className="catalog-change-item-meta">{changeRiskLabel(record) && <span className="catalog-change-risk">{changeRiskLabel(record)}</span>}<span className="catalog-change-quality">{qualityLabel(record.previousDataQuality)} → {qualityLabel(record.nextDataQuality)}</span><span className={priceTone(record)}>{priceText(record)}</span></div><small className="catalog-change-fields">{record.changedFields.length > 0 ? `변경: ${record.changedFields.join(" · ")}` : "원문 재확인 · 값 변화 없음"}{record.nextMissingFields.length > 0 ? ` · 현재 누락 ${record.nextMissingFields.length}개` : " · 필수 누락 없음"}</small><button className="text-button catalog-change-detail-button" type="button" onClick={() => setSelectedChangeId(record.id)}>{selectedRecord?.id === record.id ? "상세 비교 중" : "상세 비교"}</button></div></article>)}</div>}
      </>}
    </>}
  </section>;
}

