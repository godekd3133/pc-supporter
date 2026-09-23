import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { FiCheck, FiCheckCircle, FiClock, FiCopy, FiDownload, FiExternalLink, FiInfo, FiRefreshCw, FiRotateCcw, FiServer } from "react-icons/fi";
import { DATA_FRESHNESS_LABELS, isKnownPrice } from "../shared/types";
import type { SavedBuildPurchasePriceHistory, SavedBuildPurchaseProgress } from "../shared/types";
import type { PurchaseListRow } from "../shared/purchase-list";
import { purchaseListPriceEvidenceLabelFor, purchaseListPriceEvidenceSummaryFor, purchaseListRowKey, purchaseListTotals } from "../shared/purchase-list";
import { CATALOG_PRICE_EVIDENCE_DESCRIPTIONS } from "../shared/catalog-price-evidence";
import { purchaseListWatchTargetFor } from "../shared/purchase-list-watch";
import type { PurchaseListWatchTarget } from "../shared/purchase-list-watch";
import { purchaseListLivePriceDisplayFor, purchaseListLivePriceSummaryFor, purchaseListRowsWithLivePricesFor } from "../shared/purchase-list-live-price";
import type { PurchaseListLivePrice } from "../shared/purchase-list-live-price";
import { purchaseListPriceHistoryDisplayFor, purchaseListPriceHistoryFromJson, purchaseListPriceHistoryRecordFor, purchaseListPriceHistorySummaryFor, purchaseListPriceHistoryToJson, type PurchaseListPriceHistory } from "../shared/purchase-list-price-history";
import { parsePurchaseListPriceHistoryTransferJson, purchaseListPriceHistoryMergeFor, purchaseListPriceHistoryTransferDiffFor, purchaseListPriceHistoryTransferJsonFor, purchaseListPriceHistoryTransferMatchesCurrentFor } from "../shared/purchase-list-price-history-transfer";
import type { PurchaseListPriceHistoryTransferParseResult } from "../shared/purchase-list-price-history-transfer";
import { purchaseListPriceHistoryOverviewFor } from "../shared/purchase-list-price-history-summary";
import { purchaseListPriceHistoryCsvFor, purchaseListPriceHistorySnapshotsCsvFor } from "../shared/purchase-list-price-history-export";
import { purchaseListLivePriceDecisionFor } from "../shared/purchase-list-live-price-decision";
import { purchaseListDataFreshnessCountsFor, purchaseListPriceFilterCounts, purchaseListPriceFilterMatches, purchaseListRowMatchesQuery, type PurchaseListPriceFilter } from "../shared/purchase-list-price-filter";
import { parsePurchaseListProgressJson, purchaseListBudgetSummaryFor, purchaseListCheckedIdsFromJson, purchaseListCheckedIdsToJson, purchaseListCheckedIdsToggle, purchaseListExecutionProgressFor, purchaseListProgressAmountLabelFor, purchaseListProgressAmountsFor, purchaseListProgressFor, purchaseListProgressJsonFor, purchaseListProgressRevisionDiffFor, purchaseListProgressSyncComparisonFor, purchaseListProgressTransferDiffFor, purchaseListProgressTransferMatchesCurrentFor, purchaseListRowKeysFor } from "../shared/purchase-list-progress";
import type { PurchaseListExecutionProgress } from "../shared/purchase-list-progress";
import { purchaseListProgressHistoryCsvFor, purchaseListProgressHistoryJsonFor } from "../shared/purchase-list-progress-history";
import { purchaseListActionCenterFor } from "../shared/purchase-list-action-center";
import type { PurchaseListActionKind } from "../shared/purchase-list-action-center";
import { PURCHASE_ITEM_STATUS_LABELS, purchaseListItemStatusCountsFor, purchaseListItemStatusFor, purchaseListItemStatusIsPurchased, purchaseListItemStatusMatchesFilter, purchaseListItemStatusesFromJson, purchaseListItemStatusesJsonFor, purchaseListItemStatusesWithNextFor } from "../shared/purchase-list-status";
import type { PurchaseItemStatus, PurchaseListItemStatus } from "../shared/purchase-list-status";
import { uniqueRefreshTargets } from "../shared/refresh-targets";
import type { RefreshTarget } from "../shared/refresh-targets";
import type { CatalogRefreshReport } from "../shared/catalog-refresh-report";
import { ApiError, api } from "./api";
import { PurchaseListCatalogRefreshReport } from "./PurchaseListCatalogRefreshReport";
import { PurchaseListActionCenter } from "./PurchaseListActionCenter";
import { LOCAL_IMPORT_MAX_BYTES } from "../shared/file-import-limits";

function formatWon(value: number | undefined) {
  return !isKnownPrice(value) ? "가격 확인 중" : `${value.toLocaleString("ko-KR")}원`;
}

function formatBudgetWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function formatPriceHistoryDelta(value: number | undefined) {
  if (value === undefined) return "비교 보류";
  if (value > 0) return `+${value.toLocaleString("ko-KR")}원`;
  return `${value.toLocaleString("ko-KR")}원`;
}

function priceHistoryDeltaTone(value: number | undefined) {
  if (value === undefined) return "unknown";
  if (value > 0) return "increased";
  if (value < 0) return "decreased";
  return "same";
}

function priceHistoryServerSyncLabelFor(local: PurchaseListPriceHistory, server: PurchaseListPriceHistory) {
  const localIncoming = purchaseListPriceHistoryTransferDiffFor(server, local);
  const serverIncoming = purchaseListPriceHistoryTransferDiffFor(local, server);
  if (localIncoming.newObservationCount === 0 && serverIncoming.newObservationCount === 0 && localIncoming.mergedObservationCount === serverIncoming.mergedObservationCount) return "가격 기록이 같아요";
  const labels: string[] = [];
  if (localIncoming.newObservationCount > 0) labels.push(`이 기기에만 있는 가격 기록 ${localIncoming.newObservationCount}개`);
  if (serverIncoming.newObservationCount > 0) labels.push(`저장된 가격 기록 ${serverIncoming.newObservationCount}개`);
  return labels.join(" · ") || "가격 기록을 비교할 수 없어요";
}

function formatSyncTime(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "시간 미확인";
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function syncStateLabel(state: "synced" | "local-only" | "server-only" | "diverged") {
  if (state === "synced") return "저장된 상태와 같아요";
  if (state === "local-only") return "이 기기에만 완료 항목이 있어요";
  if (state === "server-only") return "저장된 상태에만 완료 항목이 있어요";
  return "완료 상태가 달라요";
}

function rowNamesForIds(ids: ReadonlyArray<string>, rows: ReadonlyArray<PurchaseListRow>, rowKeys: ReadonlyArray<string>) {
  const names = ids.map((id) => rowNameForId(id, rows, rowKeys));
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} 외 ${names.length - 3}개` : names.join(", ");
}

function rowNameForId(id: string, rows: ReadonlyArray<PurchaseListRow>, rowKeys: ReadonlyArray<string>) {
  const index = rowKeys.indexOf(id);
  if (index < 0) return id;
  const row = rows[index];
  return row ? [row.name, row.connectionTarget ? `연결 대상 ${row.connectionTarget}` : undefined].filter(Boolean).join(" · ") : id;
}

function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function apiErrorCode(error: unknown) {
  if (!(error instanceof ApiError) || typeof error.details !== "object" || error.details === null || Array.isArray(error.details)) return undefined;
  const code = (error.details as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

type LivePriceRefreshPayload = {
  part?: { priceWon?: number };
  item?: { priceWon?: number };
};

function livePriceEndpointFor(row: PurchaseListRow) {
  return row.sourceKind === "accessory" ? `/api/accessories/${encodeURIComponent(row.sourceId ?? "")}` : `/api/parts/${encodeURIComponent(row.sourceId ?? "")}`;
}

function livePriceFromRefreshPayloadFor(row: PurchaseListRow, payload: LivePriceRefreshPayload) {
  return row.sourceKind === "accessory" ? payload.item?.priceWon : payload.part?.priceWon;
}

function livePriceFailureFor(row: PurchaseListRow, reason: unknown, checkedAt: string): PurchaseListLivePrice {
  if (row.refreshable) {
    if (reason instanceof ApiError && reason.status === 404) return { status: "unavailable", checkedAt, source: "source-refresh", reason: "source-not-found" };
    if (reason instanceof ApiError && reason.status === 429) return { status: "unavailable", checkedAt, source: "source-refresh", reason: "source-refresh-blocked", ...(reason.retryAfterSeconds !== undefined ? { retryAfterSeconds: reason.retryAfterSeconds } : {}) };
    return { status: "error", checkedAt, source: "source-refresh", reason: "source-refresh-failed" };
  }
  return { status: reason instanceof ApiError && reason.status === 404 ? "unavailable" : "error", checkedAt };
}

type PurchaseProgressTransferPreview = {
  checkedIds: string[];
  ignoredIds: string[];
  rowKeys: string[];
  itemStates?: PurchaseListItemStatus[];
  exportedAt?: string;
};

function watchedRowKeysFor(rows: ReadonlyArray<PurchaseListRow>, isWatchedEntry?: (target: Pick<PurchaseListWatchTarget, "kind" | "itemId">) => boolean) {
  if (!isWatchedEntry) return [];
  return rows.map((row, index) => {
    const target = purchaseListWatchTargetFor(row);
    return target && isWatchedEntry(target) ? purchaseListRowKey(row, index) : undefined;
  }).filter((key): key is string => Boolean(key));
}

export function PurchaseListPanel({ rows, storageKey, inputFingerprint, budgetWon, savedBuildId, savedBuildOwnerToken, onCopy, onDownload, focusStatus, focusRowKey, onProgressChange, onServerProgressChange, onServerPriceHistoryChange, onWatchEntry, isWatchedEntry, onOpenCatalogItem, onRefreshAll, refreshingItemId, catalogRefreshReport }: { rows: PurchaseListRow[]; storageKey: string; inputFingerprint: string; budgetWon?: number; savedBuildId?: string; savedBuildOwnerToken?: string; onCopy: (checkedIds?: ReadonlySet<string>, rows?: PurchaseListRow[], itemStates?: ReadonlyArray<PurchaseListItemStatus>) => void; onDownload: (checkedIds?: ReadonlySet<string>, rows?: PurchaseListRow[], itemStates?: ReadonlyArray<PurchaseListItemStatus>) => void; focusStatus?: PurchaseItemStatus; focusRowKey?: string; onProgressChange?: (progress: PurchaseListExecutionProgress) => void; onServerProgressChange?: (progress?: SavedBuildPurchaseProgress) => void; onServerPriceHistoryChange?: (history?: SavedBuildPurchasePriceHistory) => void; onWatchEntry?: (target: PurchaseListWatchTarget) => boolean; isWatchedEntry?: (target: Pick<PurchaseListWatchTarget, "kind" | "itemId">) => boolean; onOpenCatalogItem?: (row: PurchaseListRow) => void; onRefreshAll?: (targets: RefreshTarget[]) => void; refreshingItemId?: string | null; catalogRefreshReport?: CatalogRefreshReport | null }) {
  const itemStatusStorageKey = `${storageKey}:item-statuses`;
  const [checkedIds, setCheckedIds] = useState<string[]>(() => purchaseListCheckedIdsFromJson(window.localStorage.getItem(storageKey)));
  const [itemStates, setItemStates] = useState<PurchaseListItemStatus[]>(() => purchaseListItemStatusesFromJson(window.localStorage.getItem(itemStatusStorageKey), storageKey));
  const itemStatesRef = useRef(itemStates);
  itemStatesRef.current = itemStates;
  const [hydratedStorageKey, setHydratedStorageKey] = useState(storageKey);
  const transferInputRef = useRef<HTMLInputElement>(null);
  const [transferPreview, setTransferPreview] = useState<PurchaseProgressTransferPreview | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [serverProgress, setServerProgress] = useState<SavedBuildPurchaseProgress | null>(null);
  const [serverProgressLoading, setServerProgressLoading] = useState(false);
  const [serverProgressSyncing, setServerProgressSyncing] = useState(false);
  const [serverProgressRestoring, setServerProgressRestoring] = useState(false);
  const [serverProgressError, setServerProgressError] = useState<string | null>(null);
  const [serverProgressRefreshNonce, setServerProgressRefreshNonce] = useState(0);
  const [serverPriceHistory, setServerPriceHistory] = useState<SavedBuildPurchasePriceHistory | null>(null);
  const [serverPriceHistorySaving, setServerPriceHistorySaving] = useState(false);
  const [serverPriceHistoryRestoring, setServerPriceHistoryRestoring] = useState(false);
  const [serverPriceHistoryRestoreRevision, setServerPriceHistoryRestoreRevision] = useState("");
  const [serverPriceHistoryError, setServerPriceHistoryError] = useState<string | null>(null);
  const [restoreRevision, setRestoreRevision] = useState("");
  const [livePrices, setLivePrices] = useState<Record<string, PurchaseListLivePrice>>({});
  const [livePriceLoading, setLivePriceLoading] = useState(false);
  const [livePriceCheckedAt, setLivePriceCheckedAt] = useState<string | null>(null);
  const [livePriceError, setLivePriceError] = useState<string | null>(null);
  const [livePriceCooldownUntil, setLivePriceCooldownUntil] = useState<number | null>(null);
  const [livePriceCooldownRemainingSeconds, setLivePriceCooldownRemainingSeconds] = useState(0);
  const [priceFilter, setPriceFilter] = useState<PurchaseListPriceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<PurchaseItemStatus | "all">("all");
  const [purchaseSearchQuery, setPurchaseSearchQuery] = useState("");
  const livePriceRequestRef = useRef(0);
  const serverMutationRequestRef = useRef(0);
  const serverContextKeyRef = useRef("");
  const [watchedRowKeys, setWatchedRowKeys] = useState<string[]>(() => watchedRowKeysFor(rows, isWatchedEntry));
  const [priceHistory, setPriceHistory] = useState<PurchaseListPriceHistory>(() => purchaseListPriceHistoryFromJson(window.localStorage.getItem(`${storageKey}:price-history`)));
  const [hydratedPriceHistoryKey, setHydratedPriceHistoryKey] = useState(storageKey);
  const priceHistoryTransferInputRef = useRef<HTMLInputElement>(null);
  const [priceHistoryTransferPreview, setPriceHistoryTransferPreview] = useState<PurchaseListPriceHistoryTransferParseResult | null>(null);
  const serverProgressChangeRef = useRef(onServerProgressChange);
  const serverPriceHistoryChangeRef = useRef(onServerPriceHistoryChange);
  serverProgressChangeRef.current = onServerProgressChange;
  serverPriceHistoryChangeRef.current = onServerPriceHistoryChange;
  const rowKeys = purchaseListRowKeysFor(rows);
  const serverContextKey = `${savedBuildId ?? ""}|${storageKey}|${inputFingerprint}|${rowKeys.join(",")}|${savedBuildOwnerToken ?? ""}`;
  serverContextKeyRef.current = serverContextKey;
  const displayRows = purchaseListRowsWithLivePricesFor(rows, livePrices);
  const priceEvidenceSummary = purchaseListPriceEvidenceSummaryFor(displayRows);
  const checkedIdSet = new Set(checkedIds);
  const statusCounts = purchaseListItemStatusCountsFor(rowKeys, itemStates, checkedIdSet);
  const progress = purchaseListProgressFor(rows, checkedIdSet);
  const executionProgress = purchaseListExecutionProgressFor(rows, checkedIdSet, itemStates);
  const progressAmounts = purchaseListProgressAmountsFor(displayRows, checkedIdSet);
  const budgetSummary = purchaseListBudgetSummaryFor(displayRows, budgetWon);
  const livePriceSummary = purchaseListLivePriceSummaryFor(rows, livePrices);
  const livePriceDecision = purchaseListLivePriceDecisionFor(rows, livePrices);
  const priceFilterCounts = purchaseListPriceFilterCounts(rows, livePrices, checkedIdSet, purchaseSearchQuery);
  const dataFreshnessCounts = purchaseListDataFreshnessCountsFor(rows);
  const visibleRows = displayRows.map((row, index) => ({ row, index })).filter(({ index }) => purchaseListRowMatchesQuery(rows[index]!, purchaseSearchQuery) && purchaseListPriceFilterMatches(priceFilter, rows[index]!, livePrices[rowKeys[index]!], checkedIdSet.has(rowKeys[index]!)) && purchaseListItemStatusMatchesFilter(statusFilter, purchaseListItemStatusFor(itemStates, rowKeys[index]!, checkedIdSet)));
  useEffect(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-testid="purchase-list-row"]')];
    visibleRows.forEach(({ index }, visibleIndex) => {
      const node = nodes[visibleIndex];
      const rowKey = rowKeys[index];
      if (node && rowKey) node.dataset.purchaseRowKey = rowKey;
    });
  }, [rowKeys.join("|"), visibleRows.length, purchaseSearchQuery, priceFilter, statusFilter]);
  useEffect(() => {
    if (!focusRowKey || hydratedStorageKey !== storageKey) return;
    const index = rowKeys.indexOf(focusRowKey);
    if (index < 0) return;
    let attempts = 0;
    const focusTarget = () => {
      const target = document.getElementById(`purchase-list-row-${index}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.focus({ preventScroll: true });
        return;
      }
      if (attempts >= 40) return;
      attempts += 1;
      window.setTimeout(focusTarget, 50);
    };
    const timer = window.setTimeout(focusTarget, 0);
    return () => window.clearTimeout(timer);
  }, [focusRowKey, hydratedStorageKey, rowKeys.join("|"), storageKey, visibleRows.length]);
  const priceReviewRows = rows.map((row, index) => ({ row, index })).filter(({ row, index }) => purchaseListPriceFilterMatches("needs_review", row, livePrices[rowKeys[index]!], false));
  const dataReviewRows = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.dataFreshness !== "fresh");
  const nextPurchaseActions = purchaseListActionCenterFor({ total: rows.length, dataReviewCount: dataReviewRows.length, priceReviewCount: priceReviewRows.length, statusCounts: { planned: statusCounts.planned, ordered: statusCounts.ordered, received: statusCounts.received, installed: statusCounts.installed } });
  const dataRefreshTargets = uniqueRefreshTargets(dataReviewRows.map(({ row }) => row.refreshable && row.sourceKind && row.sourceId ? { kind: row.sourceKind, id: row.sourceId } : undefined).filter((target): target is RefreshTarget => Boolean(target)));
  const priceFilterOptions: Array<[PurchaseListPriceFilter, string]> = [["all", "전체"], ["remaining", "구매 예정"], ["changed", "가격 변동"], ["decreased", "가격 인하"], ["increased", "가격 상승"], ["needs_review", "가격 정보 없음"]];
  const statusFilterOptions: Array<[PurchaseItemStatus | "all", string, number]> = [["all", "전체", statusCounts.total], ...Object.entries(PURCHASE_ITEM_STATUS_LABELS).map(([status, label]) => [status as PurchaseItemStatus, label, statusCounts[status as PurchaseItemStatus]] as [PurchaseItemStatus, string, number])];
  const scopedView = purchaseSearchQuery.trim().length > 0 || priceFilter !== "all" || statusFilter !== "all";
  const visibleExportRows = visibleRows.map(({ row, index }) => row.id ? row : { ...row, id: rowKeys[index] });

  function setItemStatesImmediately(next: PurchaseListItemStatus[]) {
    itemStatesRef.current = next;
    setItemStates(next);
  }

  function latestItemStatesFor(...groups: ReadonlyArray<ReadonlyArray<PurchaseListItemStatus>>) {
    const latest = new Map<string, PurchaseListItemStatus>();
    groups.flat().forEach((item) => {
      const existing = latest.get(item.rowKey);
      if (!existing || Date.parse(item.updatedAt) >= Date.parse(existing.updatedAt)) latest.set(item.rowKey, item);
    });
    return [...latest.values()];
  }

  useEffect(() => {
    setCheckedIds(purchaseListCheckedIdsFromJson(window.localStorage.getItem(storageKey)));
    setItemStatesImmediately(purchaseListItemStatusesFromJson(window.localStorage.getItem(itemStatusStorageKey), storageKey));
    setHydratedStorageKey(storageKey);
    setTransferPreview(null);
    setActionMessage(null);
    setLivePrices({});
    setLivePriceLoading(false);
    setLivePriceCheckedAt(null);
    setLivePriceError(null);
    setLivePriceCooldownUntil(null);
    setLivePriceCooldownRemainingSeconds(0);
    livePriceRequestRef.current += 1;
    setPriceFilter("all");
    setStatusFilter("all");
    setPurchaseSearchQuery("");
    setWatchedRowKeys(watchedRowKeysFor(rows, isWatchedEntry));
    setPriceHistory(purchaseListPriceHistoryFromJson(window.localStorage.getItem(`${storageKey}:price-history`)));
    setHydratedPriceHistoryKey(storageKey);
    setPriceHistoryTransferPreview(null);
  }, [itemStatusStorageKey, storageKey]);

  useEffect(() => {
    livePriceRequestRef.current += 1;
    setLivePrices({});
    setLivePriceLoading(false);
    setLivePriceCheckedAt(null);
    setLivePriceError(null);
    setLivePriceCooldownUntil(null);
    setLivePriceCooldownRemainingSeconds(0);
  }, [inputFingerprint]);

  useEffect(() => {
    if (livePriceCooldownUntil === null) {
      setLivePriceCooldownRemainingSeconds(0);
      return undefined;
    }
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((livePriceCooldownUntil - Date.now()) / 1_000));
      setLivePriceCooldownRemainingSeconds(remaining);
      if (remaining === 0) setLivePriceCooldownUntil(null);
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1_000);
    return () => window.clearInterval(timer);
  }, [livePriceCooldownUntil]);

  useEffect(() => {
    if (!focusStatus) return;
    setPriceFilter("all");
    setStatusFilter(focusStatus);
  }, [focusStatus]);

  useEffect(() => {
    let cancelled = false;
    if (!savedBuildId) {
      setServerProgress(null);
      setServerProgressError(null);
      setServerProgressLoading(false);
      setServerPriceHistory(null);
      setServerPriceHistoryError(null);
      return () => { cancelled = true; };
    }
    setServerProgressLoading(true);
    setServerProgressError(null);
    setServerPriceHistoryError(null);
    void api<{ purchaseProgress?: SavedBuildPurchaseProgress; purchasePriceHistory?: SavedBuildPurchasePriceHistory }>(`/api/builds/${encodeURIComponent(savedBuildId)}`, { retry: 1 })
      .then((saved) => { if (!cancelled) { setServerProgress(saved.purchaseProgress ?? null); if (saved.purchaseProgress?.itemStates) setItemStatesImmediately(latestItemStatesFor(itemStatesRef.current, purchaseListItemStatusesFromJson(window.localStorage.getItem(itemStatusStorageKey), storageKey), saved.purchaseProgress.itemStates)); serverProgressChangeRef.current?.(saved.purchaseProgress); setServerPriceHistory(saved.purchasePriceHistory ?? null); serverPriceHistoryChangeRef.current?.(saved.purchasePriceHistory); } })
      .catch((reason: unknown) => { if (!cancelled) { const message = reason instanceof Error ? reason.message : "저장 견적 서버 상태를 확인하지 못했습니다."; setServerProgressError(message); setServerPriceHistoryError(message); } })
      .finally(() => { if (!cancelled) setServerProgressLoading(false); });
    return () => { cancelled = true; };
  }, [serverContextKey, serverProgressRefreshNonce]);

  useEffect(() => {
    serverMutationRequestRef.current += 1;
    setServerProgress(null);
    setServerPriceHistory(null);
    setServerProgressError(null);
    setServerPriceHistoryError(null);
    setRestoreRevision("");
    setServerPriceHistoryRestoreRevision("");
    setServerProgressSyncing(false);
    setServerProgressRestoring(false);
    setServerPriceHistorySaving(false);
    setServerPriceHistoryRestoring(false);
  }, [serverContextKey]);

  useEffect(() => {
    if (hydratedStorageKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, purchaseListCheckedIdsToJson(checkedIds));
    } catch {
      // A full local storage bucket must not prevent the purchase list from rendering.
    }
  }, [checkedIds, hydratedStorageKey, storageKey]);

  useEffect(() => {
    if (hydratedStorageKey !== storageKey) return;
    try {
      window.localStorage.setItem(itemStatusStorageKey, purchaseListItemStatusesJsonFor(storageKey, itemStates));
    } catch {
      // A full local storage bucket must not prevent the purchase list from rendering.
    }
  }, [hydratedStorageKey, itemStates, itemStatusStorageKey, storageKey]);

  useEffect(() => {
    if (hydratedStorageKey !== storageKey) return;
    onProgressChange?.(executionProgress);
  }, [executionProgress.checked, executionProgress.percent, executionProgress.remaining, executionProgress.stageCounts.installed, executionProgress.stageCounts.ordered, executionProgress.stageCounts.planned, executionProgress.stageCounts.received, executionProgress.total, hydratedStorageKey, onProgressChange, storageKey]);

  useEffect(() => {
    if (hydratedPriceHistoryKey !== storageKey) return;
    try {
      window.localStorage.setItem(`${storageKey}:price-history`, purchaseListPriceHistoryToJson(priceHistory));
    } catch {
      // A full local storage bucket must not prevent the purchase list from rendering.
    }
  }, [hydratedPriceHistoryKey, priceHistory, storageKey]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) setCheckedIds(purchaseListCheckedIdsFromJson(event.newValue));
      if (event.key === itemStatusStorageKey) {
        if (event.newValue === null) {
          setItemStatesImmediately([]);
          return;
        }
        const incoming = purchaseListItemStatusesFromJson(event.newValue, storageKey);
        if (incoming.length > 0) setItemStatesImmediately(latestItemStatesFor(itemStatesRef.current, incoming));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [itemStatusStorageKey, storageKey]);

  useEffect(() => {
    setRestoreRevision("");
    setServerPriceHistoryRestoreRevision("");
  }, [serverProgress?.revision]);

  useEffect(() => {
    setServerPriceHistoryRestoreRevision("");
  }, [serverPriceHistory?.revision]);

  if (rows.length === 0) return null;
  const core = purchaseListTotals(displayRows, "핵심 부품");
  const accessories = purchaseListTotals(displayRows, "주변 부품");
  const totalComplete = core.priceComplete && accessories.priceComplete;
  const livePriceSourceSummary = [livePriceSummary.sourceConfirmedCount > 0 ? `페이지 확인 ${livePriceSummary.sourceConfirmedCount}개` : "", livePriceSummary.catalogConfirmedCount > 0 ? `저장 카탈로그 ${livePriceSummary.catalogConfirmedCount}개` : ""].filter(Boolean).join(" · ");

  function setRowStatus(index: number, status: PurchaseItemStatus) {
    const rowKey = rowKeys[index];
    if (!rowKey) return;
    const updatedAt = new Date().toISOString();
    const current = currentItemStatesForPersistence();
    setItemStatesImmediately(purchaseListItemStatusesWithNextFor(current, rowKey, status, updatedAt));
    setCheckedIds((current) => purchaseListCheckedIdsToggle(current, rowKey, purchaseListItemStatusIsPurchased(status)));
  }

  function toggleRow(index: number, checked: boolean) {
    setRowStatus(index, checked ? "received" : "planned");
  }

  function currentItemStatesForPersistence() {
    const stored = purchaseListItemStatusesFromJson(window.localStorage.getItem(itemStatusStorageKey), storageKey);
    return latestItemStatesFor(itemStatesRef.current, stored);
  }

  function setAllRowsStatus(status: PurchaseItemStatus) {
    const updatedAt = new Date().toISOString();
    setItemStatesImmediately(rowKeys.map((rowKey) => ({ rowKey, status, updatedAt })));
    setCheckedIds(purchaseListItemStatusIsPurchased(status) ? rowKeys : []);
  }

  function resetAllStatuses() {
    setItemStatesImmediately([]);
    setCheckedIds([]);
    try {
      window.localStorage.removeItem(itemStatusStorageKey);
    } catch {
      // The state reset still applies when browser storage is unavailable.
    }
  }

  function watchRow(row: PurchaseListRow, index: number) {
    const target = purchaseListWatchTargetFor(row);
    const rowKey = rowKeys[index];
    if (!target || !rowKey || !onWatchEntry) return;
    if (onWatchEntry(target)) {
      setWatchedRowKeys((current) => current.includes(rowKey) ? current : [...current, rowKey]);
      setActionMessage("가격 추적 목록에 등록했습니다. 가격 추적 화면에서 목표가와 알림 조건을 설정할 수 있습니다.");
    }
  }

  function copyVisibleRows() {
    if (visibleExportRows.length === 0) return;
    onCopy(checkedIdSet, visibleExportRows, currentItemStatesForPersistence());
  }

  function downloadVisibleRows() {
    if (visibleExportRows.length === 0) return;
    onDownload(checkedIdSet, visibleExportRows, currentItemStatesForPersistence());
  }

  function clearPriceHistory() {
    if (Object.keys(priceHistory).length === 0) return;
    setPriceHistory({});
    setPriceHistoryTransferPreview(null);
    setActionMessage("이 견적의 가격 기록을 초기화했습니다. 현재 가격 갱신 결과는 그대로 유지됩니다.");
  }

  function downloadPriceHistory() {
    if (Object.keys(priceHistory).length === 0) return;
    const content = purchaseListPriceHistoryTransferJsonFor(storageKey, rows, priceHistory);
    downloadTextFile(content, `pc-supporter-purchase-price-history-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8");
    setActionMessage("이 견적의 가격 이력을 JSON으로 저장했습니다.");
  }

  function downloadPriceHistoryCsv() {
    if (Object.keys(priceHistory).length === 0) return;
    const content = purchaseListPriceHistoryCsvFor(rows, priceHistory);
    downloadTextFile(content, `pc-supporter-purchase-price-history-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
    setActionMessage("이 견적의 가격 이력을 CSV로 저장했습니다.");
  }

  async function importPriceHistory(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > LOCAL_IMPORT_MAX_BYTES) {
      setPriceHistoryTransferPreview(null);
      setActionMessage("가격 이력 JSON은 1MB 이하 파일만 가져올 수 있습니다.");
      return;
    }
    try {
      const parsed = parsePurchaseListPriceHistoryTransferJson(await file.text(), storageKey, rows);
      if (parsed.errors.length > 0) {
        setPriceHistoryTransferPreview(null);
        setActionMessage(parsed.errors[0]);
        return;
      }
      setPriceHistoryTransferPreview(parsed);
      setActionMessage(null);
    } catch {
      setPriceHistoryTransferPreview(null);
      setActionMessage("가격 이력 JSON 파일을 읽지 못했습니다.");
    }
  }

  function applyPriceHistoryTransferPreview() {
    if (!priceHistoryTransferPreview) return;
    if (!purchaseListPriceHistoryTransferMatchesCurrentFor(rowKeys, priceHistoryTransferPreview.rowKeys)) {
      setPriceHistoryTransferPreview(null);
      setActionMessage("현재 견적의 구매 목록 행이 달라 가격 이력을 가져올 수 없습니다. 같은 견적에서 다시 내보내 주세요.");
      return;
    }
    const diff = purchaseListPriceHistoryTransferDiffFor(priceHistory, priceHistoryTransferPreview.history);
    setPriceHistory((current) => purchaseListPriceHistoryMergeFor(current, priceHistoryTransferPreview.history));
    setPriceHistoryTransferPreview(null);
    setActionMessage(`가격 이력을 병합했습니다. 새 샘플 ${diff.newObservationCount}개 · 병합 후 ${diff.mergedObservationCount}개${priceHistoryTransferPreview.ignoredRowKeys.length > 0 ? ` · 현재 없는 행 ${priceHistoryTransferPreview.ignoredRowKeys.length}개는 제외` : ""}`);
  }

  function downloadProgress() {
    const content = purchaseListProgressJsonFor(storageKey, rows, checkedIdSet, new Date().toISOString(), currentItemStatesForPersistence());
    downloadTextFile(content, `pc-supporter-purchase-progress-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8");
    setActionMessage("구매 완료 상태 JSON을 저장했습니다.");
  }

  async function refreshLivePrices(targets: Array<{ row: PurchaseListRow; index: number }> = rows.map((row, index) => ({ row, index })), refreshMode: "all" | "review" = "all") {
    const rowsToCheck = targets.filter(({ index }) => Boolean(rowKeys[index]));
    if (livePriceLoading || rowsToCheck.length === 0 || (livePriceCooldownUntil !== null && livePriceCooldownUntil > Date.now())) return;
    const requestId = livePriceRequestRef.current + 1;
    livePriceRequestRef.current = requestId;
    const checkedAt = new Date().toISOString();
    setLivePriceLoading(true);
    setLivePriceError(null);
    try {
      const refreshedLivePrices: Record<string, PurchaseListLivePrice> = {};
      const checkOne = async ({ row, index }: { row: PurchaseListRow; index: number }) => {
        const rowKey = rowKeys[index];
        if (!rowKey || !row.sourceKind || !row.sourceId) return [rowKey, { status: "error", checkedAt, reason: "source-missing" }] as const;
        try {
          if (row.refreshable) {
            const refreshed = await api<LivePriceRefreshPayload>(`${livePriceEndpointFor(row)}/refresh`, { method: "POST", retry: 0 });
            const currentPriceWon = livePriceFromRefreshPayloadFor(row, refreshed);
            if (!isKnownPrice(currentPriceWon)) return [rowKey, { status: "unavailable", checkedAt, source: "source-refresh", reason: "source-not-priced" }] as const;
            return [rowKey, { status: "available", currentUnitPriceWon: currentPriceWon, checkedAt, source: "source-refresh" }] as const;
          }
          const current = await api<{ priceWon?: number }>(livePriceEndpointFor(row), { retry: 1 });
          if (!isKnownPrice(current.priceWon)) return [rowKey, { status: "unavailable", checkedAt, source: "catalog", reason: "not-priced" }] as const;
          return [rowKey, { status: "available", currentUnitPriceWon: current.priceWon, checkedAt, source: "catalog" }] as const;
        } catch (reason: unknown) {
          return [rowKey, livePriceFailureFor(row, reason, checkedAt)] as const;
        }
      };
      const sourceRefreshRows = rowsToCheck.filter(({ row }) => row.refreshable);
      const catalogRows = rowsToCheck.filter(({ row }) => !row.refreshable);
      for (const target of sourceRefreshRows) {
        const [rowKey, live] = await checkOne(target);
        if (requestId !== livePriceRequestRef.current) return;
        if (rowKey) refreshedLivePrices[rowKey] = live;
      }
      for (let start = 0; start < catalogRows.length; start += 6) {
        const results = await Promise.all(catalogRows.slice(start, start + 6).map(checkOne));
        if (requestId !== livePriceRequestRef.current) return;
        results.forEach(([rowKey, live]) => { if (rowKey) refreshedLivePrices[rowKey] = live; });
      }
      if (requestId !== livePriceRequestRef.current) return;
      setLivePrices((current) => refreshMode === "all" ? refreshedLivePrices : { ...current, ...refreshedLivePrices });
      setLivePriceCheckedAt(checkedAt);
      const confirmedPrices = Object.fromEntries(Object.entries(refreshedLivePrices).filter(([, live]) => live.status === "available" && isKnownPrice(live.currentUnitPriceWon)).map(([rowKey, live]) => [rowKey, live.currentUnitPriceWon]));
      setPriceHistory((current) => purchaseListPriceHistoryRecordFor(current, confirmedPrices, checkedAt));
      const summary = purchaseListLivePriceSummaryFor(rows, refreshedLivePrices);
      const actionLabel = refreshMode === "review" ? "가격 재확인 완료" : "현재 가격 갱신 완료";
      const sourceSummary = [summary.sourceConfirmedCount > 0 ? `페이지 확인 ${summary.sourceConfirmedCount}개` : "", summary.catalogConfirmedCount > 0 ? `저장 카탈로그 ${summary.catalogConfirmedCount}개` : ""].filter(Boolean).join(" · ");
      const retryAfterSeconds = Object.values(refreshedLivePrices).reduce((maximum, live) => Math.max(maximum, live.retryAfterSeconds ?? 0), 0);
      if (retryAfterSeconds > 0) {
        setLivePriceCooldownUntil(Date.now() + retryAfterSeconds * 1_000);
        setLivePriceCooldownRemainingSeconds(retryAfterSeconds);
      } else {
        setLivePriceCooldownUntil(null);
        setLivePriceCooldownRemainingSeconds(0);
      }
      setActionMessage(`${actionLabel} · 대상 ${rowsToCheck.length}개 · 확인 ${summary.availableCount}개 · 변동 ${summary.changedCount}개${sourceSummary ? ` · ${sourceSummary}` : ""}${summary.discoveredCount > 0 ? ` · 새 가격 ${summary.discoveredCount}개` : ""}${summary.unavailableCount > 0 ? ` · 확인 불가 ${summary.unavailableCount}개` : ""}${summary.errorCount > 0 ? ` · 실패 ${summary.errorCount}개` : ""}${retryAfterSeconds > 0 ? ` · 정보 재확인 ${retryAfterSeconds}초 대기` : ""}`);
    } catch (error: unknown) {
      if (requestId === livePriceRequestRef.current) setLivePriceError(error instanceof Error ? error.message : "현재 가격을 다시 확인하지 못했습니다.");
    } finally {
      if (requestId === livePriceRequestRef.current) setLivePriceLoading(false);
    }
  }

  function downloadServerProgressHistoryJson() {
    if (!serverProgress) return;
    downloadTextFile(purchaseListProgressHistoryJsonFor(serverProgress), `pc-supporter-purchase-progress-history-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8");
    setActionMessage("서버 구매 진행률 이력을 JSON으로 저장했습니다.");
  }

  function downloadServerProgressHistoryCsv() {
    if (!serverProgress) return;
    downloadTextFile(purchaseListProgressHistoryCsvFor(serverProgress, rows), `pc-supporter-purchase-progress-history-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
    setActionMessage("서버 구매 진행률 이력을 CSV로 저장했습니다.");
  }

  function downloadServerPriceHistoryCsv() {
    if (!serverPriceHistory) return;
    downloadTextFile(purchaseListPriceHistorySnapshotsCsvFor(serverPriceHistory, rows), `pc-supporter-purchase-price-history-server-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
    setActionMessage("서버 가격 이력을 CSV로 저장했습니다.");
  }

  async function importProgressFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > LOCAL_IMPORT_MAX_BYTES) {
      setTransferPreview(null);
      setActionMessage("구매 진행률 JSON은 1MB 이하 파일만 가져올 수 있습니다.");
      return;
    }
    try {
      const parsed = parsePurchaseListProgressJson(await file.text(), storageKey, rows);
      if (parsed.errors.length > 0) {
        setActionMessage(parsed.errors[0]);
        setTransferPreview(null);
        return;
      }
      setTransferPreview({ checkedIds: parsed.checkedIds, ignoredIds: parsed.ignoredIds, rowKeys: parsed.rowKeys, ...(parsed.itemStates ? { itemStates: parsed.itemStates } : {}), exportedAt: parsed.exportedAt });
      setActionMessage(null);
    } catch {
      setActionMessage("구매 목록 진행률 JSON 파일을 읽지 못했습니다.");
      setTransferPreview(null);
    }
  }

  function applyProgressTransferPreview() {
    if (!transferPreview) return;
    if (!purchaseListProgressTransferMatchesCurrentFor(rowKeys, transferPreview.rowKeys)) {
      setTransferPreview(null);
      setActionMessage("현재 견적의 구매 목록 행이 달라 진행률을 가져올 수 없습니다. 같은 견적에서 다시 내보내 주세요.");
      return;
    }
    setCheckedIds(transferPreview.checkedIds);
    setItemStatesImmediately(transferPreview.itemStates ?? []);
    setActionMessage(`${transferPreview.checkedIds.length}개 구매 완료 상태를 가져왔습니다.${transferPreview.ignoredIds.length > 0 ? ` 현재 없는 행 ${transferPreview.ignoredIds.length}개는 무시했습니다.` : ""}`);
    setTransferPreview(null);
  }

  const serverProgressRowsMatch = Boolean(serverProgress && purchaseListProgressTransferMatchesCurrentFor(rowKeys, serverProgress.rowKeys));
  const serverProgressMatches = Boolean(serverProgress && serverProgress.inputFingerprint === inputFingerprint && serverProgressRowsMatch);
  const serverProgressSummary = serverProgressMatches ? purchaseListProgressFor(rows, new Set(serverProgress?.checkedIds ?? [])) : null;
  const serverProgressComparison = serverProgressMatches && serverProgress ? purchaseListProgressSyncComparisonFor(checkedIds, serverProgress.checkedIds) : null;
  const serverSyncAvailable = Boolean(savedBuildId && savedBuildOwnerToken && inputFingerprint);
  const restorableServerHistory = serverProgress?.history?.filter((entry) => entry.inputFingerprint === inputFingerprint && purchaseListProgressTransferMatchesCurrentFor(rowKeys, entry.rowKeys)) ?? [];
  const selectedRestoreEntry = restorableServerHistory.find((entry) => String(entry.revision) === restoreRevision);
  const restoreDiff = selectedRestoreEntry && serverProgress ? purchaseListProgressRevisionDiffFor(serverProgress, selectedRestoreEntry) : null;

  function refreshServerProgress() {
    if (!savedBuildId || serverProgressLoading || serverProgressSyncing) return;
    setServerProgressRefreshNonce((current) => current + 1);
  }

  function loadServerProgress() {
    if (!serverProgress || !serverProgressMatches) return;
    const currentKeys = new Set(rowKeys);
    const nextCheckedIds = serverProgress.checkedIds.filter((id) => currentKeys.has(id));
    setCheckedIds(nextCheckedIds);
    if (serverProgress.itemStates) setItemStatesImmediately(serverProgress.itemStates.filter((item) => currentKeys.has(item.rowKey)));
    setActionMessage(`저장 견적 서버에서 ${nextCheckedIds.length}개 구매 완료 상태를 불러왔습니다.`);
  }

  function focusPurchaseRow(rowKey: string) {
    const index = rowKeys.indexOf(rowKey);
    if (index < 0) return;
    const target = document.getElementById(`purchase-list-row-${index}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }

  function focusPurchaseAction(kind: PurchaseListActionKind) {
    if (kind === "data-review") setPriceFilter("data_review");
    if (kind === "price-review") setPriceFilter("needs_review");
    if (kind === "order") { setPriceFilter("all"); setStatusFilter("planned"); }
    if (kind === "receive") { setPriceFilter("all"); setStatusFilter("ordered"); }
    if (kind === "install") { setPriceFilter("all"); setStatusFilter("received"); }
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-testid="purchase-list-items"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function syncServerProgress() {
    if (!savedBuildId || !savedBuildOwnerToken || !inputFingerprint || rows.length === 0 || serverProgressSyncing) return;
    const requestId = ++serverMutationRequestRef.current;
    const contextKey = serverContextKey;
    const isCurrent = () => serverMutationRequestRef.current === requestId && serverContextKeyRef.current === contextKey;
    setServerProgressSyncing(true);
    setServerProgressError(null);
    try {
      const itemStatesForSync = currentItemStatesForPersistence();
      const saved = await api<{ purchaseProgress?: SavedBuildPurchaseProgress }>(`/api/builds/${encodeURIComponent(savedBuildId)}/purchase-progress`, {
        method: "PUT",
        headers: { "X-Share-Owner-Token": savedBuildOwnerToken },
        body: JSON.stringify({ expectedRevision: serverProgress?.revision ?? null, progress: { inputFingerprint, rowKeys, checkedIds: rowKeys.filter((key) => checkedIdSet.has(key)), ...(itemStatesForSync.length > 0 ? { itemStates: itemStatesForSync.filter((item) => rowKeys.includes(item.rowKey)) } : {}) } }),
        retry: 0
      });
      if (!isCurrent()) return;
      setServerProgress(saved.purchaseProgress ?? null);
      if (saved.purchaseProgress?.itemStates) setItemStatesImmediately(saved.purchaseProgress.itemStates);
      serverProgressChangeRef.current?.(saved.purchaseProgress);
      setActionMessage(`현재 구매 완료 상태 ${progress.checked}개를 저장 견적 서버에 저장했습니다.`);
    } catch (reason: unknown) {
      if (!isCurrent()) return;
      if (reason instanceof ApiError && reason.status === 409 && apiErrorCode(reason) === "PURCHASE_PROGRESS_CONFLICT") {
        setActionMessage("서버 구매 진행률이 먼저 변경되어 저장을 막았습니다. 최신 서버 상태를 다시 확인했으며, 브라우저 상태는 바꾸지 않았습니다.");
        setServerProgressRefreshNonce((current) => current + 1);
      } else {
        setServerProgressError(reason instanceof Error ? reason.message : "구매 진행률을 저장 견적 서버에 저장하지 못했습니다.");
      }
    } finally {
      if (isCurrent()) setServerProgressSyncing(false);
    }
  }

  function loadServerPriceHistory() {
    if (!serverPriceHistory || !serverPriceHistoryMatches) return;
    setPriceHistory(serverPriceHistory.priceHistory);
    setPriceHistoryTransferPreview(null);
    setActionMessage(`저장된 가격 이력 버전 ${serverPriceHistory.revision} 상태를 불러왔습니다.`);
  }

  async function syncServerPriceHistory() {
    if (!savedBuildId || !savedBuildOwnerToken || !inputFingerprint || priceHistoryRowCount === 0 || serverPriceHistorySaving) return;
    const requestId = ++serverMutationRequestRef.current;
    const contextKey = serverContextKey;
    const isCurrent = () => serverMutationRequestRef.current === requestId && serverContextKeyRef.current === contextKey;
    setServerPriceHistorySaving(true);
    setServerPriceHistoryError(null);
    try {
      const saved = await api<{ purchasePriceHistory?: SavedBuildPurchasePriceHistory }>(`/api/builds/${encodeURIComponent(savedBuildId)}/purchase-price-history`, {
        method: "PUT",
        headers: { "X-Share-Owner-Token": savedBuildOwnerToken },
        body: JSON.stringify({ expectedRevision: serverPriceHistory?.revision ?? null, priceHistory: { inputFingerprint, rowKeys, priceHistory } }),
        retry: 0
      });
      if (!isCurrent()) return;
      setServerPriceHistory(saved.purchasePriceHistory ?? null);
      serverPriceHistoryChangeRef.current?.(saved.purchasePriceHistory);
      setActionMessage(`가격 이력을 저장 견적 서버에 저장했습니다. 버전 ${saved.purchasePriceHistory?.revision ?? "?"}`);
    } catch (reason: unknown) {
      if (!isCurrent()) return;
      if (reason instanceof ApiError && reason.status === 409 && apiErrorCode(reason) === "PURCHASE_PRICE_HISTORY_CONFLICT") {
        setActionMessage("서버 가격 이력이 먼저 변경되어 저장을 막았습니다. 최신 서버 상태를 다시 확인했으며, 브라우저 기록은 바꾸지 않았습니다.");
        setServerProgressRefreshNonce((current) => current + 1);
      } else {
        setServerPriceHistoryError(reason instanceof Error ? reason.message : "가격 이력을 서버에 저장하지 못했습니다.");
      }
    } finally {
      if (isCurrent()) setServerPriceHistorySaving(false);
    }
  }

  async function restoreServerPriceHistory() {
    if (!savedBuildId || !savedBuildOwnerToken || !serverPriceHistory || !serverPriceHistoryMatches || !selectedServerPriceHistoryRestoreEntry || !serverPriceHistoryRestoreDiff || serverPriceHistoryRestoring) return;
    const targetRevision = Number(serverPriceHistoryRestoreRevision);
    if (!Number.isInteger(targetRevision) || targetRevision < 1 || (serverPriceHistoryRestoreDiff.newObservationCount === 0 && serverPriceHistoryRestoreDiff.mergedObservationCount === serverPriceHistoryRestoreDiff.currentObservationCount)) return;
    const currentServerPriceHistory = serverPriceHistory;
    const requestId = ++serverMutationRequestRef.current;
    const contextKey = serverContextKey;
    const isCurrent = () => serverMutationRequestRef.current === requestId && serverContextKeyRef.current === contextKey;
    setServerPriceHistoryRestoring(true);
    setServerPriceHistoryError(null);
    try {
      const saved = await api<{ purchasePriceHistory?: SavedBuildPurchasePriceHistory }>(`/api/builds/${encodeURIComponent(savedBuildId)}/purchase-price-history/restore`, {
        method: "POST",
        headers: { "X-Share-Owner-Token": savedBuildOwnerToken },
        body: JSON.stringify({ expectedRevision: currentServerPriceHistory.revision, revision: targetRevision, rowKeys }),
        retry: 0
      });
      const restored = saved.purchasePriceHistory;
      if (!isCurrent()) return;
      if (!restored) {
        setServerPriceHistoryError("선택한 가격 이력을 복원했지만 서버 상태를 확인하지 못했습니다.");
        setServerProgressRefreshNonce((current) => current + 1);
        return;
      }
      setServerPriceHistory(restored);
      serverPriceHistoryChangeRef.current?.(restored);
      setPriceHistory(restored.priceHistory);
      setPriceHistoryTransferPreview(null);
      setActionMessage(`서버 가격 이력 버전 ${targetRevision} 상태를 새 버전 ${restored.revision}으로 복원했습니다. 브라우저 기록도 복원된 상태에 맞췄습니다.`);
    } catch (reason: unknown) {
      if (!isCurrent()) return;
      const code = apiErrorCode(reason);
      if (reason instanceof ApiError && reason.status === 409 && (code === "PURCHASE_PRICE_HISTORY_CONFLICT" || code === "PURCHASE_PRICE_HISTORY_HISTORY_UNAVAILABLE")) {
        setActionMessage("서버 가격 이력이 먼저 변경되어 복원을 막았습니다. 최신 서버 상태를 다시 확인했으며, 브라우저 기록은 바꾸지 않았습니다.");
        setServerProgressRefreshNonce((current) => current + 1);
      } else {
        setServerPriceHistoryError(reason instanceof Error ? reason.message : "가격 이력을 복원하지 못했습니다.");
      }
    } finally {
      if (isCurrent()) setServerPriceHistoryRestoring(false);
    }
  }

  async function restoreServerProgress() {
    if (!savedBuildId || !savedBuildOwnerToken || !serverProgress || !serverProgressMatches || !restoreDiff || (restoreDiff.addedIds.length === 0 && restoreDiff.removedIds.length === 0 && restoreDiff.statusChanges.length === 0) || serverProgressRestoring) return;
    const targetRevision = Number(restoreRevision);
    if (!Number.isInteger(targetRevision) || targetRevision < 1) return;
    const currentServerProgress = serverProgress;
    const requestId = ++serverMutationRequestRef.current;
    const contextKey = serverContextKey;
    const isCurrent = () => serverMutationRequestRef.current === requestId && serverContextKeyRef.current === contextKey;
    setServerProgressRestoring(true);
    setServerProgressError(null);
    try {
      const saved = await api<{ purchaseProgress?: SavedBuildPurchaseProgress }>(`/api/builds/${encodeURIComponent(savedBuildId)}/purchase-progress/restore`, {
        method: "POST",
        headers: { "X-Share-Owner-Token": savedBuildOwnerToken },
        body: JSON.stringify({ expectedRevision: currentServerProgress.revision, revision: targetRevision, rowKeys }),
        retry: 0
      });
      const restored = saved.purchaseProgress;
      if (!isCurrent()) return;
      if (!restored) {
        setServerProgressError("선택한 구매 진행률을 복원했지만 서버 상태를 확인하지 못했습니다.");
        setServerProgressRefreshNonce((current) => current + 1);
        return;
      }
      setServerProgress(restored);
      serverProgressChangeRef.current?.(restored);
      setCheckedIds(restored.checkedIds);
      if (restored.itemStates) setItemStatesImmediately(restored.itemStates);
      setTransferPreview(null);
      setActionMessage(`서버 구매 진행률 버전 ${targetRevision} 상태를 새 버전 ${restored.revision}으로 복원했습니다. 브라우저 상태도 복원된 상태에 맞췄습니다.`);
    } catch (reason: unknown) {
      if (!isCurrent()) return;
      const code = apiErrorCode(reason);
      if (reason instanceof ApiError && reason.status === 409 && (code === "PURCHASE_PROGRESS_CONFLICT" || code === "PURCHASE_PROGRESS_HISTORY_UNAVAILABLE")) {
        setActionMessage("서버 진행률 이력이 먼저 변경되어 복원을 막았습니다. 최신 서버 상태를 다시 확인했으며, 브라우저 상태는 바꾸지 않았습니다.");
        setServerProgressRefreshNonce((current) => current + 1);
      } else {
        setServerProgressError(reason instanceof Error ? reason.message : "구매 진행률을 복원하지 못했습니다.");
      }
    } finally {
      if (isCurrent()) setServerProgressRestoring(false);
    }
  }

  const transferDiff = transferPreview ? purchaseListProgressTransferDiffFor(checkedIds, transferPreview.checkedIds) : null;
  const serverProgressStatusText = serverProgressLoading
    ? "저장된 진행률을 불러오는 중..."
    : serverProgressError
      ? "저장된 진행률을 불러오지 못했어요."
      : serverProgress && serverProgress.inputFingerprint !== inputFingerprint
        ? "다른 견적에서 저장한 진행률이에요."
        : serverProgress && !serverProgressRowsMatch
          ? "부품 구성이 달라 진행률을 이어갈 수 없어요."
          : serverProgressMatches && serverProgressSummary && serverProgressComparison
            ? `${syncStateLabel(serverProgressComparison.state)} · 서버 저장 ${serverProgressSummary.checked} / ${serverProgressSummary.total}개 · ${formatSyncTime(serverProgress?.updatedAt)}`
            : "저장된 진행률이 없어요.";
  const localOnlyNames = serverProgressComparison && serverProgressComparison.localOnlyIds.length > 0 ? rowNamesForIds(serverProgressComparison.localOnlyIds, rows, rowKeys) : "";
  const serverOnlyNames = serverProgressComparison && serverProgressComparison.serverOnlyIds.length > 0 ? rowNamesForIds(serverProgressComparison.serverOnlyIds, rows, rowKeys) : "";
  const budgetTone = budgetSummary?.priceComplete ? budgetSummary.withinBudget ? "within" : "over" : "unknown";
  const budgetStatusText = !budgetSummary ? "" : !budgetSummary.priceComplete ? "가격 정보 없음" : budgetSummary.deltaWon === 0 ? "예산에 맞음" : budgetSummary.withinBudget ? `${Math.abs(budgetSummary.deltaWon ?? 0).toLocaleString("ko-KR")}원 여유` : `${Math.abs(budgetSummary.deltaWon ?? 0).toLocaleString("ko-KR")}원 초과`;
  const priceHistoryRowCount = Object.keys(priceHistory).length;
  const serverPriceHistoryRowsMatch = Boolean(serverPriceHistory && purchaseListPriceHistoryTransferMatchesCurrentFor(rowKeys, serverPriceHistory.rowKeys));
  const serverPriceHistoryMatches = Boolean(serverPriceHistory && serverPriceHistory.inputFingerprint === inputFingerprint && serverPriceHistoryRowsMatch);
  const serverPriceHistorySyncAvailable = Boolean(savedBuildId && savedBuildOwnerToken && inputFingerprint && priceHistoryRowCount > 0);
  const serverPriceHistorySyncSummary = serverPriceHistoryMatches && serverPriceHistory ? priceHistoryServerSyncLabelFor(priceHistory, serverPriceHistory.priceHistory) : "";
  const restorableServerPriceHistory = serverPriceHistory?.history?.filter((entry) => entry.inputFingerprint === inputFingerprint && purchaseListPriceHistoryTransferMatchesCurrentFor(rowKeys, entry.rowKeys)) ?? [];
  const selectedServerPriceHistoryRestoreEntry = restorableServerPriceHistory.find((entry) => String(entry.revision) === serverPriceHistoryRestoreRevision);
  const serverPriceHistoryRestoreDiff = selectedServerPriceHistoryRestoreEntry && serverPriceHistory ? purchaseListPriceHistoryTransferDiffFor(serverPriceHistory.priceHistory, selectedServerPriceHistoryRestoreEntry.priceHistory) : null;
  const serverPriceHistoryStatusText = serverProgressLoading
    ? "가격 이력을 불러오는 중..."
    : serverPriceHistoryRestoring
      ? "가격 이력을 복원하는 중..."
    : serverPriceHistoryError
      ? "가격 이력을 불러오지 못했어요."
      : serverPriceHistory && serverPriceHistory.inputFingerprint !== inputFingerprint
        ? "다른 견적에서 저장한 가격 이력이에요."
        : serverPriceHistory && !serverPriceHistoryRowsMatch
          ? "부품 구성이 달라 진행률을 이어갈 수 없어요."
          : serverPriceHistory && serverPriceHistoryMatches
            ? `저장 버전 ${serverPriceHistory.revision} · 기록 ${Object.keys(serverPriceHistory.priceHistory).length}개 · ${formatSyncTime(serverPriceHistory.updatedAt)}`
            : "저장된 가격 이력이 없어요.";
  const priceHistoryOverview = purchaseListPriceHistoryOverviewFor(rows, priceHistory);
  const priceHistoryTransferMatches = priceHistoryTransferPreview ? purchaseListPriceHistoryTransferMatchesCurrentFor(rowKeys, priceHistoryTransferPreview.rowKeys) : false;
  const priceHistoryTransferDiff = priceHistoryTransferPreview ? purchaseListPriceHistoryTransferDiffFor(priceHistory, priceHistoryTransferPreview.history) : null;

  return (
    <section className="purchase-list-panel" aria-label="구매 목록" data-testid="purchase-list-panel" tabIndex={-1}>
      <div className="purchase-list-heading">
        <div><h2>구매 목록</h2><p>선택한 핵심·주변 부품을 구매용 목록으로 정리합니다.</p></div>
        <div className="purchase-list-heading-status"><strong>{progress.checked} / {progress.total}개 구매 완료</strong><span>{progress.percent}%</span></div>
        <div className="purchase-list-actions"><button className="button button-small button-light" type="button" onClick={() => onCopy(checkedIdSet, displayRows, currentItemStatesForPersistence())}><FiCopy /> 목록 복사</button><button className="button button-small button-light" type="button" onClick={() => onDownload(checkedIdSet, displayRows, currentItemStatesForPersistence())}><FiDownload /> CSV 저장</button>{scopedView && <><button className="button button-small button-light" type="button" data-testid="purchase-list-visible-copy" onClick={copyVisibleRows} disabled={visibleExportRows.length === 0}><FiCopy /> 표시 목록 복사</button><button className="button button-small button-light" type="button" data-testid="purchase-list-visible-csv" onClick={downloadVisibleRows} disabled={visibleExportRows.length === 0}><FiDownload /> 표시 목록 CSV</button></>}<button className="button button-small button-light" type="button" data-testid="purchase-list-live-price-refresh" title="상품 페이지가 연결된 부품의 가격을 갱신합니다." onClick={() => void refreshLivePrices()} disabled={livePriceLoading || livePriceCooldownRemainingSeconds > 0}>{livePriceLoading ? <><FiRefreshCw className="spin" /> 가격 확인 중...</> : livePriceCooldownRemainingSeconds > 0 ? <><FiClock /> {livePriceCooldownRemainingSeconds}초 후 다시 확인</> : <><FiRefreshCw /> 현재 가격 갱신</>}</button></div>
      </div>
      {(livePriceCheckedAt || priceHistoryRowCount > 0) && <p className="purchase-list-live-price-status" data-testid="purchase-list-live-price-status" role="status">{livePriceCheckedAt ? <>가격을 불러온 시각 {formatSyncTime(livePriceCheckedAt)} · 확인 {livePriceSummary.availableCount}개 · 변동 {livePriceSummary.changedCount}개{livePriceSourceSummary ? ` · ${livePriceSourceSummary}` : ""}{livePriceSummary.discoveredCount > 0 ? ` · 새 가격 ${livePriceSummary.discoveredCount}개` : ""}{livePriceSummary.unavailableCount > 0 ? ` · 확인 불가 ${livePriceSummary.unavailableCount}개` : ""}{livePriceSummary.errorCount > 0 ? ` · 실패 ${livePriceSummary.errorCount}개` : ""}</> : "이 견적의 가격 기록"}{priceHistoryRowCount > 0 && <> · 기록 {priceHistoryRowCount}개</>}{priceHistoryRowCount > 0 && <button className="purchase-list-price-history-clear" type="button" onClick={clearPriceHistory}>기록 지우기</button>}</p>}
      {livePriceCheckedAt && <section className={`purchase-list-live-price-decision ${livePriceDecision.state}`} aria-label="현재 가격 판단 요약" data-testid="purchase-list-live-price-decision"><div className="purchase-list-live-price-decision-heading"><div><strong>{livePriceDecision.label}</strong><small>{livePriceDecision.summary}</small></div><span>{livePriceDecision.availableCount} / {rows.length}개 가격 확인</span></div><div className="purchase-list-live-price-decision-facts"><span>변동 행 <b>{livePriceDecision.changedRowCount}개</b></span>{livePriceDecision.decreasedTotalPriceWon !== undefined && <span className="decreased">인하 <b>{livePriceDecision.decreasedTotalPriceWon.toLocaleString("ko-KR")}원</b></span>}{livePriceDecision.increasedTotalPriceWon !== undefined && <span className="increased">상승 <b>+{livePriceDecision.increasedTotalPriceWon.toLocaleString("ko-KR")}원</b></span>}{rows.length - livePriceDecision.availableCount > 0 && <span className="review">재확인 <b>{rows.length - livePriceDecision.availableCount}개</b></span>}</div></section>}
      {rows.length > 0 && <section className={priceReviewRows.length > 0 ? "purchase-list-price-review" : "purchase-list-price-review clear"} aria-label="구매 목록 가격 재확인 목록" data-testid="purchase-list-price-review"><div className="purchase-list-price-review-heading"><div><strong>{livePriceCheckedAt ? "가격 재확인 목록" : "가격 확인 목록"}</strong><small>{livePriceCheckedAt ? (priceReviewRows.length > 0 ? "가격을 불러오지 못한 항목만 다시 봅니다." : "현재 구매 목록의 가격 확인이 완료되었습니다.") : "가격이 등록되지 않은 구매 항목을 모아 보여줘요."}</small></div><span>{priceReviewRows.length}개</span></div><div className="purchase-list-price-review-actions"><button className="text-button" type="button" data-testid="purchase-list-price-review-filter" onClick={() => setPriceFilter("needs_review")} disabled={priceReviewRows.length === 0}>가격 미확인만 보기</button><button className="button button-small button-light" type="button" data-testid="purchase-list-price-review-refresh" onClick={() => void refreshLivePrices(priceReviewRows, "review")} disabled={livePriceLoading || livePriceCooldownRemainingSeconds > 0 || priceReviewRows.length === 0}>{livePriceLoading ? <><FiRefreshCw className="spin" /> 확인 중...</> : livePriceCooldownRemainingSeconds > 0 ? <><FiClock /> {livePriceCooldownRemainingSeconds}초 후 다시 확인</> : <><FiRefreshCw /> {livePriceCheckedAt ? "가격 다시 불러오기" : "가격 확인 시작"}</>}</button></div></section>}



      {catalogRefreshReport && <PurchaseListCatalogRefreshReport report={catalogRefreshReport} onRetryFailed={onRefreshAll} retrying={refreshingItemId !== null} />}
      <PurchaseListActionCenter actions={nextPurchaseActions} total={rows.length} onAction={focusPurchaseAction} />
      <div className="purchase-list-search" data-testid="purchase-list-search"><label><span>구매 항목 검색</span><input type="search" aria-label="구매 목록 검색" placeholder="부품명·범주·연결 대상·ID 검색" value={purchaseSearchQuery} onChange={(event) => setPurchaseSearchQuery(event.target.value)} /></label><small>{purchaseSearchQuery.trim() ? `${priceFilterCounts.all}개 검색됨` : `${rows.length}개 항목`}</small></div>
      <div className="purchase-list-price-filters" role="group" aria-label="구매 목록 표시 필터" data-testid="purchase-list-price-filters"><span>표시</span>{priceFilterOptions.map(([value, label]) => <button className={priceFilter === value ? "selected" : ""} type="button" data-testid={`purchase-list-filter-${value}`} aria-pressed={priceFilter === value} disabled={value !== "all" && priceFilterCounts[value] === 0} onClick={() => setPriceFilter(value)} key={value}>{label} <b>{priceFilterCounts[value]}</b></button>)}</div>
      <div className="purchase-list-price-history-tools" aria-label="가격 이력 전송"><input ref={priceHistoryTransferInputRef} className="purchase-list-transfer-input" type="file" accept=".json,application/json" aria-label="가격 이력 JSON 파일 가져오기" onChange={(event) => void importPriceHistory(event)} /><button className="text-button" type="button" data-testid="purchase-list-price-history-export" onClick={downloadPriceHistory} disabled={priceHistoryRowCount === 0}><FiDownload /> 기록 JSON 저장</button><button className="text-button" type="button" data-testid="purchase-list-price-history-csv-export" onClick={downloadPriceHistoryCsv} disabled={priceHistoryRowCount === 0}><FiDownload /> 기록 CSV 저장</button><button className="text-button" type="button" data-testid="purchase-list-price-history-import" onClick={() => priceHistoryTransferInputRef.current?.click()}><FiDownload /> 기록 JSON 가져오기</button></div>
      {priceHistoryTransferPreview && priceHistoryTransferDiff && <div className="purchase-list-transfer-preview purchase-list-price-history-transfer-preview" data-testid="purchase-list-price-history-transfer-preview" role="region" aria-label="가격 이력 JSON 가져오기 미리보기"><div className="purchase-list-transfer-heading"><div><strong>가격 이력 가져오기 미리보기</strong><small>내보낸 시각 {priceHistoryTransferPreview.exportedAt ?? "알 수 없음"} · 파일 행 {priceHistoryTransferPreview.rowKeys.length}개</small></div><span>{priceHistoryTransferMatches ? "확인 필요" : "행 구성 불일치"}</span></div><div className="purchase-list-transfer-stats"><span>현재 기록 행 <b>{priceHistoryTransferDiff.currentRowCount}개</b></span><span>가져올 기록 행 <b>{priceHistoryTransferDiff.incomingRowCount}개</b></span><span>새 샘플 <b>{priceHistoryTransferDiff.newObservationCount}개</b></span><span>병합 후 샘플 <b>{priceHistoryTransferDiff.mergedObservationCount}개</b></span>{priceHistoryTransferPreview.ignoredRowKeys.length > 0 && <span>현재 없는 행 <b>{priceHistoryTransferPreview.ignoredRowKeys.length}개</b></span>}</div><p>{priceHistoryTransferMatches ? "현재 가격 이력을 즉시 바꾸지 않았습니다. 현재 견적의 가격 이력에 합쳐집니다. 같은 시각의 중복 샘플은 하나로 합치고 각 행은 최근 20회만 유지합니다." : "현재 견적의 구매 목록 행 구성이 달라 가져오기를 잠갔습니다. 같은 견적에서 다시 내보낸 JSON만 가져올 수 있습니다."}</p><div className="purchase-list-transfer-actions"><button className="text-button" type="button" onClick={() => setPriceHistoryTransferPreview(null)}>취소</button><button className="button button-primary" type="button" onClick={applyPriceHistoryTransferPreview} disabled={!priceHistoryTransferMatches}>이 기록 병합</button></div></div>}
      {priceHistoryRowCount > 0 && <div className="purchase-list-price-history-overview" data-testid="purchase-list-price-history-overview"><div className="purchase-list-price-history-overview-heading"><div><strong>가격 이력 요약</strong><small>이 견적의 브라우저 기록 · {priceHistoryOverview.rowCount}개 행 중 {priceHistoryOverview.latestKnownRowCount}개 행 확인</small></div><span>최소 {priceHistoryOverview.minSampleCount}회 · 최대 {priceHistoryOverview.maxSampleCount}회</span></div><div className="purchase-list-price-history-overview-grid"><div><span>최신 기록 총액</span><strong>{priceHistoryOverview.latestPriceComplete ? formatBudgetWon(priceHistoryOverview.latestTotalPriceWon!) : "일부 가격 정보 없음"}</strong><small>{priceHistoryOverview.latestKnownRowCount} / {priceHistoryOverview.rowCount}개 행</small></div><div><span>이전 총액</span><strong>{priceHistoryOverview.previousPriceComplete ? formatBudgetWon(priceHistoryOverview.previousTotalPriceWon!) : "이전 가격 기록 없음"}</strong><small>{priceHistoryOverview.previousKnownRowCount} / {priceHistoryOverview.rowCount}개 행</small></div><div className={priceHistoryDeltaTone(priceHistoryOverview.deltaFromPreviousTotalPriceWon)}><span>총액 변화</span><strong>{formatPriceHistoryDelta(priceHistoryOverview.deltaFromPreviousTotalPriceWon)}</strong><small>{priceHistoryOverview.changedRowCount}개 행 변동</small></div></div></div>}
      {livePriceError && <p className="purchase-list-live-price-error" role="alert">{livePriceError}</p>}
      <div className="purchase-list-progress" data-testid="purchase-list-progress">
        <div className="purchase-list-progress-heading"><span>구매 진행률</span><b>{progress.remaining === 0 ? "모두 완료" : progress.remaining + "개 남음"}</b></div>
        <div className="purchase-list-progress-bar" role="progressbar" aria-label={"구매 목록 " + progress.percent + "% 완료"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: progress.percent + "%" }} /></div>
        <div className="purchase-list-progress-amounts" data-testid="purchase-list-progress-amounts"><div><span>구매 완료 금액</span><strong>{purchaseListProgressAmountLabelFor(progressAmounts.checkedTotalPriceWon, progressAmounts.checkedPriceComplete, progressAmounts.checkedRowCount)}</strong><small>{progressAmounts.checkedRowCount}개 완료</small></div><div><span>남은 금액</span><strong>{purchaseListProgressAmountLabelFor(progressAmounts.remainingTotalPriceWon, progressAmounts.remainingPriceComplete, progressAmounts.remainingRowCount)}</strong><small>{progressAmounts.remainingRowCount}개 남음</small></div></div>
        {budgetSummary && <div className={`purchase-list-budget ${budgetTone}`} data-testid="purchase-list-budget"><div><span>목표 예산</span><strong>{formatBudgetWon(budgetSummary.budgetWon)}</strong></div><div><span>예상 합계</span><strong>{budgetSummary.priceComplete ? formatBudgetWon(budgetSummary.totalPriceWon) : "가격 정보 없음"}</strong></div><div><span>예산 상태</span><strong>{budgetStatusText}</strong></div></div>}
        <div className="purchase-list-progress-actions"><button className="text-button" type="button" onClick={() => setAllRowsStatus("received")} disabled={progress.remaining === 0}><FiCheckCircle /> 모두 수령 완료</button><button className="text-button" type="button" onClick={resetAllStatuses} disabled={progress.checked === 0 && itemStates.length === 0}><FiRefreshCw /> 구매 상태 초기화</button><button className="text-button" type="button" onClick={downloadProgress}><FiDownload /> JSON 저장</button><input ref={transferInputRef} className="purchase-list-transfer-input" type="file" accept=".json,application/json" aria-label="구매 목록 진행률 JSON 파일 가져오기" onChange={(event) => void importProgressFile(event)} /><button className="text-button" type="button" onClick={() => transferInputRef.current?.click()}><FiDownload /> JSON 가져오기</button></div>
        <div className="purchase-list-status-board" data-testid="purchase-list-status-board"><div className="purchase-list-status-board-heading"><div><strong>구매 단계</strong><small>주문·수령·조립을 분리해 실제 진행 상황을 기록합니다.</small></div><span>{statusCounts.installed} / {statusCounts.total}개 조립 완료</span></div><div className="purchase-list-status-options" role="group" aria-label="구매 단계 필터">{statusFilterOptions.map(([value, label, count]) => <button className={statusFilter === value ? "selected" : ""} type="button" data-testid={`purchase-list-status-filter-${value}`} aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)} disabled={value !== "all" && count === 0} key={value}>{label} <b>{count}</b></button>)}</div></div>
        {savedBuildId && <div className="purchase-list-server-sync" data-testid="purchase-list-server-sync">
          <div><strong>저장 견적 구매 진행률</strong><small>{serverProgressStatusText}{savedBuildOwnerToken ? " · 저장 가능" : " · 조회 전용"}</small><div className="purchase-list-server-price-history-copy"><strong>저장된 가격 이력</strong><small>{serverPriceHistoryStatusText}{serverPriceHistorySyncSummary ? ` · ${serverPriceHistorySyncSummary}` : ""}{savedBuildOwnerToken ? " · 저장 가능" : " · 조회 전용"}</small></div></div>
          <div className="purchase-list-server-sync-actions">{savedBuildId && <button className="text-button" type="button" data-testid="purchase-list-server-refresh" onClick={refreshServerProgress} disabled={serverProgressLoading || serverProgressSyncing || serverProgressRestoring || serverPriceHistorySaving}><FiRefreshCw className={serverProgressLoading ? "spin" : undefined} /> 저장 상태 새로고침</button>}{serverProgressMatches && <button className="text-button" type="button" onClick={loadServerProgress} disabled={serverProgressLoading || serverProgressSyncing || serverProgressRestoring || serverPriceHistorySaving}><FiDownload /> 저장 상태 불러오기</button>}{serverSyncAvailable && <button className="text-button" type="button" onClick={() => void syncServerProgress()} disabled={serverProgressLoading || serverProgressSyncing || serverProgressRestoring || serverPriceHistorySaving}>{serverProgressSyncing ? <><FiRefreshCw className="spin" /> 저장 중...</> : <><FiServer /> 현재 상태 저장</>}</button>}{serverPriceHistory && <button className="text-button" type="button" data-testid="purchase-list-price-history-server-csv-export" onClick={downloadServerPriceHistoryCsv} disabled={serverProgressLoading || serverProgressSyncing || serverProgressRestoring || serverPriceHistorySaving}><FiDownload /> 가격 이력 CSV 저장</button>}{serverPriceHistoryMatches && <button className="text-button" type="button" data-testid="purchase-list-price-history-server-load" onClick={loadServerPriceHistory} disabled={serverProgressLoading || serverProgressSyncing || serverProgressRestoring || serverPriceHistorySaving}><FiDownload /> 가격 이력 불러오기</button>}{serverPriceHistorySyncAvailable && <button className="text-button" type="button" data-testid="purchase-list-price-history-server-save" onClick={() => void syncServerPriceHistory()} disabled={serverProgressLoading || serverProgressSyncing || serverProgressRestoring || serverPriceHistorySaving}>{serverPriceHistorySaving ? <><FiRefreshCw className="spin" /> 이력 저장 중...</> : <><FiServer /> 가격 이력 저장</>}</button>}</div>
          {serverPriceHistory && serverPriceHistoryMatches && restorableServerPriceHistory.length > 0 && <div className="purchase-list-price-history-server-history" data-testid="purchase-list-price-history-server-history">
            <div className="purchase-list-price-history-server-history-heading"><div><strong>이전 가격 이력</strong><small>복원하면 현재 상태를 이력으로 남기고 선택한 상태를 새 버전으로 저장합니다.</small></div></div>
            {selectedServerPriceHistoryRestoreEntry && serverPriceHistoryRestoreDiff && <div className="purchase-list-price-history-server-restore-preview" data-testid="purchase-list-price-history-server-restore-preview" role="status"><div><strong>복원 전 가격 샘플 비교</strong><small>현재 버전 {serverPriceHistory.revision} → 복원 버전 {selectedServerPriceHistoryRestoreEntry.revision}</small></div><div className="purchase-list-restore-preview-stats"><span>현재 샘플 <b>{serverPriceHistoryRestoreDiff.currentObservationCount}개</b></span><span>복원 대상 샘플 <b>{serverPriceHistoryRestoreDiff.incomingObservationCount}개</b></span><span>새 샘플 <b>{serverPriceHistoryRestoreDiff.newObservationCount}개</b></span><span>병합 후 샘플 <b>{serverPriceHistoryRestoreDiff.mergedObservationCount}개</b></span></div><p>현재 서버 이력을 즉시 바꾸지 않았습니다. 복원하면 현재 버전을 이력으로 남기고 선택한 상태를 새 버전으로 저장합니다.</p></div>}
            <div className="purchase-list-price-history-server-history-controls"><label htmlFor="purchase-list-price-history-restore-revision">복원할 가격 이력<select id="purchase-list-price-history-restore-revision" aria-label="복원할 가격 이력 버전" value={serverPriceHistoryRestoreRevision} onChange={(event) => setServerPriceHistoryRestoreRevision(event.currentTarget.value)}><option value="">이전 상태 선택</option>{restorableServerPriceHistory.map((entry) => <option value={String(entry.revision)} key={entry.revision}>버전 {entry.revision} · {Object.values(entry.priceHistory).reduce((total, observations) => total + observations.length, 0)}개 샘플 · {formatSyncTime(entry.updatedAt)}</option>)}</select></label>{savedBuildOwnerToken ? <button className="text-button" type="button" data-testid="purchase-list-price-history-server-restore" onClick={() => void restoreServerPriceHistory()} disabled={!serverPriceHistoryRestoreRevision || !serverPriceHistoryRestoreDiff || (serverPriceHistoryRestoreDiff.newObservationCount === 0 && serverPriceHistoryRestoreDiff.mergedObservationCount === serverPriceHistoryRestoreDiff.currentObservationCount) || serverProgressLoading || serverProgressSyncing || serverProgressRestoring || serverPriceHistorySaving || serverPriceHistoryRestoring}>{serverPriceHistoryRestoring ? "가격 이력 복원 중..." : "선택 상태로 복원"}</button> : <span>조회 전용</span>}</div>
          </div>}
          {serverProgress && serverProgressMatches && restorableServerHistory.length > 0 && <div className="purchase-list-server-history" data-testid="purchase-list-server-history"><div className="purchase-list-server-history-heading"><div><strong>이전 구매 진행률</strong><small>복원하면 현재 상태를 이력으로 남기고 선택한 상태를 새 버전으로 저장합니다.</small></div><div className="purchase-list-server-history-actions"><button className="text-button" type="button" data-testid="purchase-list-history-json" onClick={downloadServerProgressHistoryJson}><FiDownload /> 이력 JSON</button><button className="text-button" type="button" data-testid="purchase-list-history-csv" onClick={downloadServerProgressHistoryCsv}><FiDownload /> 이력 CSV</button></div></div>{selectedRestoreEntry && restoreDiff && <div className="purchase-list-restore-preview" data-testid="purchase-list-restore-preview" role="status"><div><strong>복원 전 변경 미리보기</strong><small>현재 버전 {restoreDiff.fromRevision} → 복원 버전 {restoreDiff.toRevision}</small></div><div className="purchase-list-restore-preview-stats"><span>현재 완료 <b>{restoreDiff.fromCheckedCount}개</b></span><span>복원 후 완료 <b>{restoreDiff.toCheckedCount}개</b></span><span>완료 추가 <b>{restoreDiff.addedIds.length}개</b></span><span>완료 해제 <b>{restoreDiff.removedIds.length}개</b></span><span>단계 변경 <b>{restoreDiff.statusChanges.length}개</b></span><span>유지 <b>{restoreDiff.unchangedIds.length}개</b></span></div>{restoreDiff.addedIds.length === 0 && restoreDiff.removedIds.length === 0 && restoreDiff.statusChanges.length === 0 ? <p>구매 단계 변경이 없습니다. 새 버전을 만들 필요가 없다면 복원하지 않아도 됩니다.</p> : <div className="purchase-list-restore-preview-changes">{restoreDiff.addedIds.length > 0 && <div className="purchase-list-restore-preview-change-group added"><span>복원 후 완료</span>{restoreDiff.addedIds.map((id) => <button className="text-button" type="button" key={id} onClick={() => focusPurchaseRow(id)}>{rowNameForId(id, rows, rowKeys)}</button>)}</div>}{restoreDiff.removedIds.length > 0 && <div className="purchase-list-restore-preview-change-group removed"><span>복원 후 해제</span>{restoreDiff.removedIds.map((id) => <button className="text-button" type="button" key={id} onClick={() => focusPurchaseRow(id)}>{rowNameForId(id, rows, rowKeys)}</button>)}</div>}{restoreDiff.statusChanges.length > 0 && <div className="purchase-list-restore-preview-change-group status"><span>구매 단계 변경</span>{restoreDiff.statusChanges.map((change) => <button className="text-button" type="button" key={change.rowKey} onClick={() => focusPurchaseRow(change.rowKey)}>{rowNameForId(change.rowKey, rows, rowKeys)} · {PURCHASE_ITEM_STATUS_LABELS[change.from]} → {PURCHASE_ITEM_STATUS_LABELS[change.to]}</button>)}</div>}</div>}</div>}<div className="purchase-list-server-history-controls"><label htmlFor="purchase-list-restore-revision">복원할 상태<select id="purchase-list-restore-revision" aria-label="복원할 구매 진행률 버전" value={restoreRevision} onChange={(event) => setRestoreRevision(event.currentTarget.value)}><option value="">이전 상태 선택</option>{restorableServerHistory.map((entry) => <option value={String(entry.revision)} key={entry.revision}>버전 {entry.revision} · {entry.checkedIds.length} / {entry.rowKeys.length}개 · {formatSyncTime(entry.updatedAt)}</option>)}</select></label>{savedBuildOwnerToken ? <button className="text-button" type="button" onClick={() => void restoreServerProgress()} disabled={!restoreRevision || !restoreDiff || (restoreDiff.addedIds.length === 0 && restoreDiff.removedIds.length === 0 && restoreDiff.statusChanges.length === 0) || serverProgressLoading || serverProgressSyncing || serverProgressRestoring}>{serverProgressRestoring ? <><FiRefreshCw className="spin" /> 복원 중...</> : <><FiRotateCcw /> 선택 상태로 복원</>}</button> : <span>조회 전용</span>}</div></div>}
          {serverProgressError && <p role="alert">{serverProgressError}</p>}
          {serverPriceHistoryError && <p role="alert">{serverPriceHistoryError}</p>}
        </div>}
        {actionMessage && <p className="purchase-list-action-message" role="status">{actionMessage}</p>}
        {transferPreview && transferDiff && <div className="purchase-list-transfer-preview" role="region" aria-label="구매 목록 진행률 JSON 가져오기 미리보기"><div className="purchase-list-transfer-heading"><div><strong>구매 완료 상태 가져오기 미리보기</strong><small>내보낸 시각 {transferPreview.exportedAt ?? "알 수 없음"} · 파일 행 {transferPreview.rowKeys.length}개</small></div><span>확인 필요</span></div><div className="purchase-list-transfer-stats"><span>현재 완료 <b>{transferDiff.currentCheckedCount}개</b></span><span>가져올 완료 <b>{transferDiff.incomingCheckedCount}개</b></span><span>새로 체크 <b>{transferDiff.addedCount}개</b></span><span>해제 <b>{transferDiff.removedCount}개</b></span><span>유지 <b>{transferDiff.unchangedCount}개</b></span>{transferPreview.ignoredIds.length > 0 && <span>현재 없는 행 <b>{transferPreview.ignoredIds.length}개</b></span>}</div><p>가져올 구매 상태를 검토한 뒤 현재 목록에 반영해 주세요.</p><div className="purchase-list-transfer-actions"><button className="text-button" type="button" onClick={() => setTransferPreview(null)}>취소</button><button className="button button-primary" type="button" onClick={applyProgressTransferPreview}>이 상태로 가져오기</button></div></div>}
      </div>
      {visibleRows.length === 0 ? <div className="purchase-list-items-empty" role="status">검색·표시 조건에 맞는 구매 항목이 없습니다.<button className="text-button" type="button" onClick={() => { setPurchaseSearchQuery(""); setPriceFilter("all"); setStatusFilter("all"); }}>전체 보기</button></div> : <div className="purchase-list-items" data-testid="purchase-list-items">{visibleRows.map(({ row, index }) => { const sourceRow = rows[index] ?? row; const rowKey = rowKeys[index]; const itemStatus = purchaseListItemStatusFor(itemStates, rowKey, checkedIdSet); const checked = purchaseListItemStatusIsPurchased(itemStatus); const livePriceDisplay = purchaseListLivePriceDisplayFor(sourceRow, livePrices[rowKey]); const priceHistorySummary = purchaseListPriceHistorySummaryFor(priceHistory, rowKey); const priceHistoryDisplay = purchaseListPriceHistoryDisplayFor(priceHistorySummary); const watchTarget = purchaseListWatchTargetFor(sourceRow); const watched = Boolean(watchTarget && (watchedRowKeys.includes(rowKey) || isWatchedEntry?.(watchTarget))); return <div id={`purchase-list-row-${index}`} data-testid="purchase-list-row" tabIndex={-1} className={`purchase-list-row ${checked ? "purchased" : ""} status-${itemStatus}`} key={rowKey}><label className="purchase-list-row-check" aria-label={row.name + " 구매 완료"}><input type="checkbox" checked={checked} onChange={(event) => toggleRow(index, event.currentTarget.checked)} /><span><FiCheck /></span></label><div><span>{row.section} · {row.categoryLabel}</span><strong>{row.name}</strong>{row.connectionTarget && <small className="purchase-list-connection-target" data-testid="purchase-list-connection-target">연결 대상 · {row.connectionTarget}</small>}<small><select className={`purchase-list-status-select ${itemStatus}`} aria-label={`${row.name} 구매 단계`} value={itemStatus} onChange={(event) => setRowStatus(index, event.currentTarget.value as PurchaseItemStatus)}>{Object.entries(PURCHASE_ITEM_STATUS_LABELS).map(([status, label]) => <option value={status} key={status}>{label}</option>)}</select>{row.quantity}개 · 1개 {formatWon(row.unitPriceWon)}{row.listingType ? " · " + row.listingType : ""}{livePriceDisplay && <b className={`purchase-list-live-price ${livePriceDisplay.tone}`}>{livePriceDisplay.label}</b>}{priceHistoryDisplay && priceHistorySummary.sampleCount >= 2 && <b className={`purchase-list-price-history ${priceHistoryDisplay.tone}`}>{priceHistoryDisplay.label}</b>}{row.sourceUrl && <a href={row.sourceUrl} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a>}{onOpenCatalogItem && row.sourceKind && row.sourceId && <button className="purchase-list-catalog-link" type="button" data-testid={`purchase-list-open-catalog-${row.sourceKind}-${row.sourceId}`} onClick={() => onOpenCatalogItem(row)}>상세 보기 <FiExternalLink /></button>}{watchTarget && onWatchEntry && <button className={watched ? "purchase-list-watch-button watched" : "purchase-list-watch-button"} type="button" onClick={() => watchRow(sourceRow, index)} disabled={watched} aria-label={`${row.name} 가격 추적 ${watched ? "등록됨" : "등록"}`}>{watched ? <><FiCheck /> 추적 중</> : <><FiClock /> 가격 추적</>}</button>}</small></div><em>{row.totalPriceWon !== undefined ? formatWon(row.totalPriceWon) : "가격 정보 없음"}</em></div>; })}</div>}
      <div className="purchase-list-totals"><div><span>핵심 부품</span><strong>{core.priceComplete ? formatWon(core.totalPriceWon) : "가격 정보 없음"}</strong></div><div><span>주변 부품</span><strong>{accessories.priceComplete ? accessories.totalPriceWon > 0 ? formatWon(accessories.totalPriceWon) : "없음" : "가격 정보 없음"}</strong></div><div><span>전체 합계</span><strong>{totalComplete ? formatWon(core.totalPriceWon + accessories.totalPriceWon) : "가격 정보 없음"}</strong></div></div>
    </section>
  );
}
