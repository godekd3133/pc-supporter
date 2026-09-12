import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { IconType } from "react-icons";
import { FiActivity, FiAlertTriangle, FiArrowLeft, FiBox, FiCheck, FiCheckCircle, FiChevronDown, FiClock, FiCopy, FiCpu, FiDatabase, FiDownload, FiEdit3, FiExternalLink, FiHardDrive, FiInfo, FiLayers, FiLoader, FiLogOut, FiMonitor, FiPlus, FiPrinter, FiRefreshCw, FiSave, FiSearch, FiServer, FiShare2, FiShield, FiTrash2, FiTool, FiXCircle, FiZap } from "react-icons/fi";
import type { AccessoryCategory, AccessoryCrawlStatus, AccessoryItem, BenchmarkOverride, BenchmarkOverrideOperation, BenchmarkReviewQueue, BenchmarkScoreKey, BenchmarkSourceKind, CatalogChangeKind, CatalogChangeRecord, CrawlManifest, CrawlPageFailure, CrawlPageRetryRecord, CrawlResumePreview, CrawlStatus, DataQuality, M2SlotCoverage, M2SlotOverride, M2SlotProfile, M2SlotReviewTemplate, M2SlotReviewTemplateItem, Part, PartCategory, ServiceMeta } from "../shared/types";
import { catalogMissingFieldLabelFor } from "../shared/catalog-spec-coverage";
import type { CatalogPcieSlotCoverage, CatalogSpecCoverage } from "../shared/catalog-spec-coverage";
import type { CatalogCategoryIntegrityReviewPackage } from "../shared/catalog-category-integrity-review";
import { catalogWorkPriorityFor } from "../shared/catalog-work-priority";
import type { CatalogWorkPriority } from "../shared/catalog-work-priority";
import { accessoryCoverageGapFor, accessoryCoveragePercentFor, accessoryWorkPriorityFor } from "../shared/accessory-work-priority";
import type { AccessoryWorkPriority } from "../shared/accessory-work-priority";
import { ACCESSORY_CATEGORIES, ACCESSORY_CATEGORY_LABELS, ACCESSORY_PRICE_FILTER_LABELS, BENCHMARK_SOURCE_KIND_LABELS, CATEGORY_LABELS, DATA_FRESHNESS_LABELS, DATA_QUALITY_LABELS, LISTING_TYPE_LABELS, PART_CATEGORIES } from "../shared/types";
import { m2ReviewTemplatesToCsv, parseM2ReviewCsv } from "../shared/m2-csv";
import { benchmarkOverridesToCsv, benchmarkReviewItemsToCsv, parseBenchmarkOverridesCsv } from "../shared/benchmark-csv";
import { catalogChangeCsvFor, catalogChangeJsonFor } from "../shared/catalog-change-export";
import type { CatalogChangeExportFilters } from "../shared/catalog-change-export";
import { catalogChangePriceHistoryFor, catalogChangePriceHistoryWithinWindowFor, catalogChangePriceNearLowRankingsFor, catalogChangePriceOpportunitiesFor, catalogChangePriceVolatilityRankingsFor, catalogChangePriceWatchSignalsFor, catalogChangePriceWindowSummaryFor, catalogChangeTrendFor } from "../shared/catalog-change-analytics";
import type { CatalogChangePriceWatchSignal } from "../shared/catalog-change-analytics";
import { addCatalogWatchEntry, catalogWatchEntryKey, catalogWatchlistContains, catalogWatchlistFromJson, catalogWatchlistToJson, mergeCatalogWatchEntries, removeCatalogWatchEntry, updateCatalogWatchEntry } from "../shared/catalog-watchlist";
import type { CatalogWatchEntry } from "../shared/catalog-watchlist";
import { catalogWatchlistCsvFor, catalogWatchlistJsonFor } from "../shared/catalog-watchlist-export";
import type { CatalogWatchSnapshot } from "../shared/catalog-watchlist-export";
import { catalogWatchlistEntriesFromCsv, catalogWatchlistEntriesFromJson } from "../shared/catalog-watchlist-import";
import { catalogWatchlistShareHashFor, catalogWatchlistSharePayloadFromHash } from "../shared/catalog-watchlist-share";
import { catalogWatchSnapshotMatches, sortCatalogWatchSnapshots } from "../shared/catalog-watchlist-view";
import type { CatalogWatchlistStatusFilter, CatalogWatchlistSort } from "../shared/catalog-watchlist-view";
import { ApiError, api } from "./api";
import { safeExternalUrl } from "./safe-source-url";

import { catalogChangeDashboardSummary, catalogChangeMatches, catalogChangeMissingIncreased, catalogChangeQualityDegraded, prioritizedCatalogChanges } from "../shared/catalog-change-filters";
import type { CatalogChangeFilter, CatalogChangeKindFilter } from "../shared/catalog-change-filters";
import { SAVED_BUILD_VERSION_MIGRATION_CONFIRMATION, SAVED_BUILD_VERSION_ROLLBACK_CONFIRMATION } from "../shared/saved-build-version";
import type { SavedBuildVersionAudit, SavedBuildVersionBackupDetail, SavedBuildVersionBackupSummary, SavedBuildVersionMigrationMutationResult, SavedBuildVersionMigrationPreview, SavedBuildVersionMigrationRollbackResult } from "../shared/saved-build-version";

const M2SlotOverridePanel = lazy(() => import("./AdminM2Panels").then((module) => ({ default: module.M2SlotOverridePanel })));
const BenchmarkOverridePanel = lazy(() => import("./AdminBenchmarkPanel").then((module) => ({ default: module.BenchmarkOverridePanel })));
const GpuPhysicalOverridePanel = lazy(() => import("./AdminGpuPhysicalPanel").then((module) => ({ default: module.AdminGpuPhysicalPanel })));
const CaseRgbLoadOverridePanel = lazy(() => import("./AdminCaseRgbLoadPanel").then((module) => ({ default: module.CaseRgbLoadOverridePanel })));
const CoolingFanLoadOverridePanel = lazy(() => import("./AdminCoolingFanLoadPanel").then((module) => ({ default: module.CoolingFanLoadOverridePanel })));
const CatalogChangeHistoryPanel = lazy(() => import("./AdminCatalogChangePanel").then((module) => ({ default: module.CatalogChangeHistoryPanel })));
const CatalogSpecReviewPanel = lazy(() => import("./AdminCatalogSpecReviewPanel").then((module) => ({ default: module.AdminCatalogSpecReviewPanel })));
const CatalogSpecOverridePanel = lazy(() => import("./AdminCatalogSpecOverridePanel").then((module) => ({ default: module.AdminCatalogSpecOverridePanel })));
const AdminSeedCatalogPanel = lazy(() => import("./AdminSeedCatalogPanel").then((module) => ({ default: module.AdminSeedCatalogPanel })));
const AdminSeedCatalogMappingPanel = lazy(() => import("./AdminSeedCatalogMappingPanel").then((module) => ({ default: module.AdminSeedCatalogMappingPanel })));

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

type M2SlotBatchValidationItem = {
  partId: string;
  partName?: string;
  valid: boolean;
  complete: boolean;
  errors: string[];
};

type M2SlotBatchValidationResponse = {
  validCount: number;
  invalidCount: number;
  completeCount: number;
  incompleteCount: number;
  items: M2SlotBatchValidationItem[];
};

type BenchmarkOverrideValidationItem = {
  partId: string;
  partName?: string;
  category?: PartCategory;
  valid: boolean;
  errors: string[];
  operation?: BenchmarkOverrideOperation;
  changedFields?: string[];
};

type BenchmarkOverrideValidationResponse = {
  validCount: number;
  invalidCount: number;
  items: BenchmarkOverrideValidationItem[];
};

type BenchmarkOverrideListItem = BenchmarkOverride & {
  partName?: string;
  category?: PartCategory;
};

type CatalogChangeCategoryFilter = "all" | PartCategory | AccessoryCategory;

const BENCHMARK_SOURCE_COVERAGE_LABELS = [
  ["official", "제조사·공식"],
  ["independent_review", "독립 리뷰"],
  ["community_measurement", "사용자 실측"],
  ["other", "기타 분류"],
  ["unclassified", "출처 미분류"]
] as const;

function pciePowerKindLabel(kind: string) {
  if (kind === "12v2x6") return "16핀(12V2x6)";
  if (kind === "12vhpwr") return "16핀(12VHPWR)";
  if (kind === "pcie_8pin_6plus2") return "8핀(6+2)";
  if (kind === "pcie_6pin") return "6핀";
  return kind;
}

function formatPciePowerOptions(options: Array<Array<{ kind: string; count: number }>> | undefined) {
  if (options === undefined) return undefined;
  if (options.length === 0) return "없음";
  return options.map((option) => option.map((requirement) => `${pciePowerKindLabel(requirement.kind)} ${requirement.count}개`).join(" + ")).join(" 또는 ");
}

function formatPciePowerConnectors(connectors: Record<string, number | undefined> | undefined) {
  if (!connectors) return undefined;
  const values = Object.entries(connectors)
    .filter(([, count]) => count !== undefined)
    .map(([kind, count]) => `${pciePowerKindLabel(kind)} ${count}개`);
  return values.length > 0 ? values.join(" + ") : "확인된 커넥터 없음";
}

function formatM2SharingScopes(scopes: string[] | undefined) {
  if (!scopes || scopes.length === 0) return undefined;
  const labels: Record<string, string> = { pcie: "PCIe", sata: "SATA", usb4: "USB4", m2: "M.2 간" };
  return scopes.map((scope) => labels[scope] ?? scope).join(", ");
}

function formatM2SlotProfiles(profiles: M2SlotProfile[] | undefined) {
  if (!profiles || profiles.length === 0) return undefined;
  const connectionLabels: Record<string, string> = { cpu: "CPU", chipset: "칩셋", unknown: "연결 확인" };
  return profiles.map((profile) => `${profile.slotId} · ${profile.interfaces?.join("/") ?? "인터페이스 확인"}${profile.pcieGeneration !== undefined ? ` · PCIe ${profile.pcieGeneration.toFixed(1)}` : ""}${profile.connection ? ` · ${connectionLabels[profile.connection] ?? profile.connection}` : ""}`).join(" / ");
}


function partSummary(part: Part | undefined) {
  if (!part) return "아직 선택하지 않았습니다.";
  const effectiveMemoryLatency = memoryEffectiveLatencyForDisplay(part);
  const values = [
    part.specs.socket,
    part.specs.memoryType,
    (part.category === "memory" || part.category === "motherboard") && part.specs.memoryProfiles?.length ? part.specs.memoryProfiles.join(" / ") : undefined,
    part.category === "memory" && part.specs.memoryModuleCountPerKit !== undefined ? `킷 ${part.specs.memoryModuleCountPerKit}개 모듈` : undefined,
    part.category === "memory" && part.specs.memoryTiming ? part.specs.memoryTiming : part.category === "memory" && part.specs.memoryCasLatency !== undefined ? `CL${part.specs.memoryCasLatency}` : undefined,
    part.category === "memory" && effectiveMemoryLatency !== undefined ? `실효 ${effectiveMemoryLatency.toFixed(2)}ns` : undefined,
    part.category === "memory" && part.specs.memoryVoltageV !== undefined ? `${part.specs.memoryVoltageV}V` : undefined,
    part.category === "cpu" && part.specs.cinebenchR23Multi !== undefined ? `R23 멀티 ${part.specs.cinebenchR23Multi.toLocaleString("ko-KR")}` : undefined,
    part.category === "gpu" && part.specs.vramGb !== undefined ? `VRAM ${part.specs.vramGb}GB` : undefined,
    part.category === "gpu" && part.specs.gpuMemoryType ? part.specs.gpuMemoryType : undefined,
    part.category === "gpu" && part.specs.gpuBoostClockMhz !== undefined ? `부스트 ${part.specs.gpuBoostClockMhz.toLocaleString("ko-KR")}MHz` : undefined,
    part.category === "gpu" && part.specs.pciePowerOptions !== undefined ? `보조전원 ${formatPciePowerOptions(part.specs.pciePowerOptions)}` : undefined,
    part.category === "gpu" && part.specs.pciePowerAdapterOptions !== undefined ? `어댑터 ${formatPciePowerOptions(part.specs.pciePowerAdapterOptions)}` : undefined,
    part.category === "motherboard" && part.specs.m2PcieGenerations?.length ? `M.2 ${part.specs.m2PcieGenerations.map((generation) => `PCIe ${generation.toFixed(1)}`).join(" / ")}` : undefined,
    part.category === "motherboard" && part.specs.m2SlotProfiles?.length ? `슬롯별 M.2 매핑 ${part.specs.m2SlotProfiles.length}개` : undefined,
    part.category === "ssd" && part.specs.interface ? part.specs.interface : undefined,
    part.category === "ssd" && part.specs.capacityGb !== undefined ? `${part.specs.capacityGb}GB` : undefined,
    part.category === "ssd" && part.specs.m2PcieGeneration !== undefined ? `PCIe ${part.specs.m2PcieGeneration.toFixed(1)}` : undefined,
    part.category === "ssd" && part.specs.sequentialReadMbps !== undefined ? `읽기 ${part.specs.sequentialReadMbps.toLocaleString("ko-KR")}MB/s` : undefined,
    part.category === "ssd" && part.specs.ssdTbwTb !== undefined ? `TBW ${part.specs.ssdTbwTb}TB` : undefined,
    part.specs.wattageW ? `${part.specs.wattageW}W` : undefined,
    part.category === "psu" && part.specs.psuCableType ? `케이블 ${part.specs.psuCableType === "fully_modular" ? "풀모듈러" : part.specs.psuCableType === "semi_modular" ? "세미모듈러" : "일체형"}` : undefined,
    part.category === "psu" && part.specs.psuRailType ? `12V ${part.specs.psuRailType === "single" ? "싱글레일" : "다중레일"}` : undefined,
    part.category === "psu" && part.specs.psuIndependentPcieCableRuns !== undefined ? `독립 PCIe 런 ${part.specs.psuIndependentPcieCableRuns}개` : undefined,
    part.category === "psu" && part.specs.psuPcieCableTopology ? `PCIe ${part.specs.psuPcieCableTopology === "independent" ? "독립" : "분배"}` : undefined,
    part.specs.lengthMm ? `${part.specs.lengthMm}mm` : undefined,
    part.specs.formFactor
  ].filter(Boolean);
  return values.join(" · ") || "상세 스펙을 확인할 수 있습니다.";
}


function memoryEffectiveLatencyForDisplay(part: Part) {
  if (part.category !== "memory") return undefined;
  const speedMhz = part.specs.speedMhz;
  const memoryCasLatency = part.specs.memoryCasLatency;
  if (speedMhz !== undefined && speedMhz > 0 && memoryCasLatency !== undefined) {
    return Number(((memoryCasLatency * 2000) / speedMhz).toFixed(2));
  }
  return part.specs.memoryEffectiveLatencyNs;
}


type AdminSession = {
  enabled: boolean;
  authenticated: boolean;
  security?: {
    environment: "development" | "production";
    passwordConfigured: boolean;
    sessionSecretConfigured: boolean;
    productionReady: boolean;
  };
};

function AdminPanelLoading({ label }: { label: string }) {
  return <section className="admin-card admin-panel-loading" aria-busy="true"><FiLoader className="spin" /><span>{label} 패널을 불러오는 중...</span></section>;
}

function AdminCrawlResumeControl() {
  const [preview, setPreview] = useState<CrawlResumePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const mutationRequestRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    let requestVersion = 0;
    const loadPreview = () => {
      const currentVersion = ++requestVersion;
      setLoading(true);
      void api<CrawlResumePreview>("/api/admin/crawl/resume-preview")
        .then((value) => { if (!cancelled && requestVersion === currentVersion) setPreview(value); })
        .catch(() => { if (!cancelled && requestVersion === currentVersion) setPreview(null); })
        .finally(() => { if (!cancelled && requestVersion === currentVersion) setLoading(false); });
    };
    loadPreview();
    const handleStarted = () => {
      requestVersion += 1;
      mutationRequestRef.current += 1;
      setPreview(null);
      setLoading(false);
    };
    const handleCompleted = () => loadPreview();
    window.addEventListener("pc-supporter:catalog-crawl-started", handleStarted);
    window.addEventListener("pc-supporter:catalog-crawl-completed", handleCompleted);
    return () => {
      cancelled = true;
      mutationRequestRef.current += 1;
      window.removeEventListener("pc-supporter:catalog-crawl-started", handleStarted);
      window.removeEventListener("pc-supporter:catalog-crawl-completed", handleCompleted);
    };
  }, []);
  if (loading || !preview?.available || preview.running) return null;
  const scopeLabel = preview.category ? CATEGORY_LABELS[preview.category] : "전체 핵심 부품";
  const completedLabel = preview.completedCategories.length > 0
    ? preview.completedCategories.map((category) => CATEGORY_LABELS[category]).join(" · ")
    : "없음";
  const remainingLabel = preview.remainingCategories.map((category) => CATEGORY_LABELS[category]).join(" · ");
  async function resume() {
    if (!preview || starting) return;
    if (!window.confirm(`${scopeLabel} 수집을 재개할까요? 이미 목록과 상세 스펙이 완전히 확인된 범주는 건너뛰고, 미완료 범주(${remainingLabel})만 다시 수집합니다.`)) return;
    const requestVersion = ++mutationRequestRef.current;
    const isCurrent = () => mutationRequestRef.current === requestVersion;
    setStarting(true);
    try {
      await api("/api/admin/crawl", {
        method: "POST",
        body: JSON.stringify({ pages: 1, limitPerCategory: 0, details: true, all: true, resume: true, ...(preview.category ? { category: preview.category } : {}) })
      });
      if (!isCurrent()) return;
      setPreview(null);
      setStarting(false);
      window.dispatchEvent(new CustomEvent("pc-supporter:catalog-crawl-started"));
      window.dispatchEvent(new CustomEvent("pc-supporter:admin-toast", { detail: `${scopeLabel} 미완료 범주부터 전체 수집을 재개했습니다.` }));
    } catch (error: unknown) {
      if (!isCurrent()) return;
      setStarting(false);
      window.dispatchEvent(new CustomEvent("pc-supporter:admin-toast", { detail: error instanceof Error ? error.message : "중단된 수집을 재개하지 못했습니다." }));
    } finally {
      if (isCurrent()) setStarting(false);
    }
  }
  return <section className="admin-crawl-resume-control" data-testid="admin-crawl-resume-control" aria-live="polite">
    <div className="admin-crawl-resume-copy">
      <span className="eyebrow">RECOVERABLE CRAWL</span>
      <strong>중단된 전체 수집을 이어서 실행</strong>
      <p>{scopeLabel} · 완료 범주 {preview.completedCategories.length}개를 건너뛰고 미완료 {preview.remainingCategories.length}개 범주만 재개합니다.</p>
      <small>완료: {completedLabel} · 재개: {remainingLabel}</small>
    </div>
    <button className="button button-light" type="button" data-testid="admin-crawl-resume" onClick={() => void resume()} disabled={starting}>
      {starting ? <><FiLoader className="spin" /> 재개 준비 중...</> : <><FiRefreshCw /> 미완료 범주부터 재개</>}
    </button>
  </section>;
}

function crawlStatusLabel(status: CrawlStatus["status"]) {
  return status === "running" ? "실행 중" : status === "completed" ? "완료" : status === "failed" ? "실패" : status === "cancelled" ? "중단됨" : "대기";
}

function AdminCrawlProgressDetail() {
  const [status, setStatus] = useState<CrawlStatus | null>(null);
  const [retryHistory, setRetryHistory] = useState<CrawlPageRetryRecord[]>([]);
  const [retryingPageKey, setRetryingPageKey] = useState<string | null>(null);
  const [retryingBatch, setRetryingBatch] = useState(false);
  const [cancellingBatch, setCancellingBatch] = useState(false);
  const mutationRequestRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    let requestVersion = 0;
    let timer: number | undefined;
    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const refresh = () => {
      const currentVersion = ++requestVersion;
      void api<CrawlStatus>("/api/admin/crawl/status")
        .then((next) => {
          if (cancelled || requestVersion !== currentVersion) return;
          setStatus(next);
          clearTimer();
          if (next.status === "running") timer = window.setTimeout(refresh, 1600);
          void api<CrawlManifest>("/api/admin/crawl/manifest")
            .then((manifest) => { if (!cancelled && requestVersion === currentVersion) setRetryHistory(manifest.pageRetryHistory ?? []); })
            .catch(() => { if (!cancelled && requestVersion === currentVersion) setRetryHistory([]); });
        })
        .catch(() => undefined);
    };
    const refreshNow = () => {
      requestVersion += 1;
      mutationRequestRef.current += 1;
      clearTimer();
      refresh();
    };
    refresh();
    window.addEventListener("pc-supporter:catalog-crawl-started", refreshNow);
    window.addEventListener("pc-supporter:catalog-crawl-completed", refreshNow);
    return () => {
      cancelled = true;
      requestVersion += 1;
      mutationRequestRef.current += 1;
      clearTimer();
      window.removeEventListener("pc-supporter:catalog-crawl-started", refreshNow);
      window.removeEventListener("pc-supporter:catalog-crawl-completed", refreshNow);
    };
  }, []);

  if (!status) return null;
  const failedPages = status.failedPages ?? [];
  const hasTelemetry = status.status === "running"
    || status.currentCategory !== undefined
    || status.currentPage !== undefined
    || (status.pageRetries ?? 0) > 0
    || failedPages.length > 0;
  if (!hasTelemetry) return null;
  const currentCategory = status.currentCategory ?? status.category;
  const currentPage = status.currentPage ?? status.lastSuccessfulPage;
  const pageExpected = status.currentPagesExpected;
  const currentStatus = status;
  const visibleFailures = failedPages.slice(-5);
  const omittedFailureCount = Math.max(0, failedPages.length - visibleFailures.length);
  const retryableFailures = failedPages.filter((failure) => failure.stage === "list");
  async function retryPage(failure: CrawlPageFailure) {
    const pageKey = `${failure.category}-${failure.page}`;
    if (retryingPageKey || retryingBatch || currentStatus.status === "running" || failure.stage !== "list") return;
    if (!window.confirm(`${CATEGORY_LABELS[failure.category]} ${failure.page}페이지만 다시 수집할까요? 성공한 다른 페이지와 기존 카탈로그는 교체하지 않습니다.`)) return;
    const requestVersion = ++mutationRequestRef.current;
    const isCurrent = () => mutationRequestRef.current === requestVersion;
    setRetryingPageKey(pageKey);
    try {
      await api("/api/admin/crawl/retry-page", {
        method: "POST",
        body: JSON.stringify({ category: failure.category, page: failure.page, expectedManifestStartedAt: currentStatus.manifestStartedAt ?? currentStatus.startedAt, details: true })
      });
      if (!isCurrent()) return;
      setRetryingPageKey(null);
      window.dispatchEvent(new CustomEvent("pc-supporter:catalog-crawl-started"));
      window.dispatchEvent(new CustomEvent("pc-supporter:admin-toast", { detail: `${CATEGORY_LABELS[failure.category]} ${failure.page}페이지 단독 재시도를 시작했습니다.` }));
    } catch (error: unknown) {
      if (!isCurrent()) return;
      setRetryingPageKey(null);
      window.dispatchEvent(new CustomEvent("pc-supporter:admin-toast", { detail: error instanceof Error ? error.message : "실패 페이지를 재시도하지 못했습니다." }));
    } finally {
      if (isCurrent()) setRetryingPageKey(null);
    }
  }
  async function retryAllFailedPages() {
    if (retryingPageKey || retryingBatch || currentStatus.status === "running" || retryableFailures.length === 0) return;
    if (!window.confirm(`현재 확인된 목록 실패 페이지 ${retryableFailures.length}개를 순차적으로 다시 수집할까요? 성공한 다른 페이지와 기존 카탈로그는 교체하지 않습니다.`)) return;
    const requestVersion = ++mutationRequestRef.current;
    const isCurrent = () => mutationRequestRef.current === requestVersion;
    setRetryingBatch(true);
    try {
      await api("/api/admin/crawl/retry-failed-pages", {
        method: "POST",
        body: JSON.stringify({ expectedManifestStartedAt: currentStatus.manifestStartedAt ?? currentStatus.startedAt, details: true })
      });
      if (!isCurrent()) return;
      setRetryingBatch(false);
      window.dispatchEvent(new CustomEvent("pc-supporter:catalog-crawl-started"));
      window.dispatchEvent(new CustomEvent("pc-supporter:admin-toast", { detail: `실패 페이지 ${retryableFailures.length}개 일괄 재시도를 시작했습니다.` }));
    } catch (error: unknown) {
      if (!isCurrent()) return;
      setRetryingBatch(false);
      window.dispatchEvent(new CustomEvent("pc-supporter:admin-toast", { detail: error instanceof Error ? error.message : "실패 페이지 일괄 재시도를 시작하지 못했습니다." }));
    } finally {
      if (isCurrent()) setRetryingBatch(false);
    }
  }
  async function cancelBatch() {
    if (cancellingBatch || currentStatus.status !== "running" || currentStatus.operation !== "page-retry-batch") return;
    const requestVersion = ++mutationRequestRef.current;
    const isCurrent = () => mutationRequestRef.current === requestVersion;
    setCancellingBatch(true);
    try {
      await api("/api/admin/crawl/retry-failed-pages/cancel", { method: "POST" });
      if (!isCurrent()) return;
      setCancellingBatch(false);
      window.dispatchEvent(new CustomEvent("pc-supporter:admin-toast", { detail: "실패 페이지 일괄 재시도 중단을 요청했습니다." }));
    } catch (error: unknown) {
      if (!isCurrent()) return;
      setCancellingBatch(false);
      window.dispatchEvent(new CustomEvent("pc-supporter:admin-toast", { detail: error instanceof Error ? error.message : "일괄 재시도를 중단하지 못했습니다." }));
    } finally {
      if (isCurrent()) setCancellingBatch(false);
    }
  }
  const batchProgress = status.pageRetryBatch;
  const batchPercent = batchProgress && batchProgress.total > 0 ? Math.round((batchProgress.completed / batchProgress.total) * 100) : 0;
  const visibleRetryHistory = retryHistory.slice(-5).reverse();
  return <section className="admin-crawl-progress-detail" data-testid="admin-crawl-progress-detail" aria-live="polite">
    <div className="admin-crawl-progress-heading">
      <div>
        <p className="eyebrow">PAGE TELEMETRY</p>
        <strong>{currentCategory ? CATEGORY_LABELS[currentCategory] : "페이지 진행 정보"}</strong>
        <small>{status.status === "running" ? "현재 요청의 진행 상태를 실시간으로 저장합니다." : "마지막 수집 작업의 페이지 단위 결과입니다."}</small>
      </div>
      <span className={`admin-crawl-progress-status ${status.status}`}>{crawlStatusLabel(status.status)}</span>
    </div>
      <div className="admin-crawl-progress-metrics">
      <div><span>현재 페이지</span><strong>{currentPage !== undefined ? `${currentPage} / ${pageExpected && pageExpected > 0 ? pageExpected : "?"}` : "-"}</strong></div>
      <div><span>마지막 성공</span><strong>{status.lastSuccessfulPage !== undefined ? `${status.lastSuccessfulPage}페이지` : "-"}</strong></div>
      <div><span>페이지 재시도 누적</span><strong>{(status.pageRetries ?? 0).toLocaleString("ko-KR")}회</strong></div>
        <div><span>실패 페이지</span><strong className={failedPages.length > 0 ? "has-failures" : ""}>{failedPages.length.toLocaleString("ko-KR")}개</strong></div>
      </div>
    {batchProgress && <div className="admin-crawl-batch-progress" data-testid="admin-crawl-batch-progress">
      <div className="admin-crawl-batch-progress-heading"><div><span>RETRY QUEUE</span><strong>실패 페이지 일괄 복구</strong></div><div className="admin-crawl-batch-progress-actions"><b>{batchProgress.completed} / {batchProgress.total}</b>{status.status === "running" && status.operation === "page-retry-batch" && <button className="admin-crawl-cancel-batch" type="button" data-testid="admin-crawl-cancel-batch" onClick={() => void cancelBatch()} disabled={cancellingBatch}>{cancellingBatch ? <><FiLoader className="spin" /> 중단 요청 중...</> : <><FiXCircle /> 중단</>}</button>}</div></div>
      <div className="admin-crawl-batch-progress-track" role="progressbar" aria-label="실패 페이지 일괄 복구 진행률" aria-valuemin={0} aria-valuemax={batchProgress.total} aria-valuenow={batchProgress.completed}><i style={{ width: `${batchPercent}%` }} /></div>
      <small>{batchProgress.succeeded}개 성공 · {batchProgress.failed}개 실패 · {batchPercent}% 처리</small>
    </div>}
    {failedPages.length > 0 && <div className="admin-crawl-failed-pages">
      <div className="admin-crawl-failed-pages-heading"><div><span>FAILED PAGES</span><small>최종 실패 범주와 페이지</small></div>{retryableFailures.length > 0 && <button className="admin-crawl-retry-all" type="button" data-testid="admin-crawl-retry-all-pages" onClick={() => void retryAllFailedPages()} disabled={retryingPageKey !== null || retryingBatch || status.status === "running"}>{retryingBatch ? <><FiLoader className="spin" /> 일괄 재시도 중...</> : <><FiRefreshCw /> {retryableFailures.length}개 일괄 재시도</>}</button>}</div>
      <ul>
        {omittedFailureCount > 0 && <li className="admin-crawl-failed-pages-omitted">이전 실패 {omittedFailureCount}건 생략</li>}
        {visibleFailures.map((failure: CrawlPageFailure, index) => <li key={`${failure.category}-${failure.page}-${failure.occurredAt}-${index}`}>
          <div className="admin-crawl-failed-page-copy">
            <strong>{CATEGORY_LABELS[failure.category]} · {failure.page}페이지</strong>
            <span>{failure.attempts}회 시도 · {failure.message}</span>
          </div>
          {failure.stage === "list" && <button className="admin-crawl-retry-page" type="button" data-testid={`admin-crawl-retry-page-${failure.category}-${failure.page}`} onClick={() => void retryPage(failure)} disabled={retryingPageKey !== null || retryingBatch || status.status === "running"}>
            {retryingPageKey === `${failure.category}-${failure.page}` ? <><FiLoader className="spin" /> 재시도 중...</> : <><FiRefreshCw /> 이 페이지만 재시도</>}
          </button>}
        </li>)}
      </ul>
    </div>}
    {visibleRetryHistory.length > 0 && <div className="admin-crawl-retry-history" data-testid="admin-crawl-retry-history">
      <div className="admin-crawl-retry-history-heading"><span>RETRY HISTORY</span><small>최근 {Math.min(5, retryHistory.length)}건 · 전체 {retryHistory.length}건</small></div>
      <ul>{visibleRetryHistory.map((record) => <li className={record.succeeded ? "succeeded" : "failed"} key={`${record.category}-${record.page}-${record.finishedAt}`}><div><strong>{CATEGORY_LABELS[record.category]} · {record.page}페이지</strong><span>{record.attempts}회 시도 · {new Date(record.finishedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span></div><b>{record.succeeded ? "재시도 성공" : "재시도 실패"}</b></li>)}</ul>
    </div>}
  </section>;
}

function AdminSecurityNotice({ security }: { security?: AdminSession["security"] }) {
  if (!security) return null;
  let notice: React.ReactNode = null;
  if (security.environment === "production" && !security.productionReady) {
    const missing = [
      !security.passwordConfigured ? "ADMIN_PASSWORD" : undefined,
      !security.sessionSecretConfigured ? "ADMIN_SESSION_SECRET" : undefined
    ].filter((value): value is string => value !== undefined);
    notice = <div className="admin-security-notice production" data-testid="admin-security-notice" role="alert"><FiAlertTriangle /><div><strong>운영 보안 설정 확인 필요</strong><p>{missing.join(", ")}이(가) 설정되지 않았습니다. 운영 데이터 센터를 공개하기 전에 강한 관리자 비밀번호와 기본값이 아닌 세션 비밀키를 설정해 주세요.</p></div></div>;
  }
  if (security.environment === "development" && !security.passwordConfigured) {
    notice = <div className="admin-security-notice development" data-testid="admin-security-notice" role="status"><FiInfo /><div><strong>개발용 관리자 모드</strong><p>현재 <code>ADMIN_PASSWORD</code>가 없어 관리자 API 인증이 비활성화되어 있습니다. 로컬 확인용 상태이며, 운영 배포 전 <code>ADMIN_PASSWORD</code>와 기본값이 아닌 <code>ADMIN_SESSION_SECRET</code>을 설정해야 합니다.</p></div></div>;
  }
  return <>{notice}<AdminCrawlResumeControl /><AdminCrawlProgressDetail /></>;
}

function DeferredAdminPanel({ label, anchorId, children }: { label: string; anchorId?: string; children: React.ReactNode }) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof window === "undefined") {
      setShouldLoad(true);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) {
      setShouldLoad(true);
      return;
    }
    let observer: IntersectionObserver | undefined;
    let loaded = false;
    const stopWatching = () => {
      observer?.disconnect();
      window.removeEventListener("scroll", loadWhenNearViewport);
      window.removeEventListener("resize", loadWhenNearViewport);
    };
    const loadWhenNearViewport = () => {
      if (loaded) return;
      const rect = anchor.getBoundingClientRect();
      if (rect.top <= window.innerHeight + 720 && rect.bottom >= -720) {
        loaded = true;
        setShouldLoad(true);
        stopWatching();
      }
    };
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadWhenNearViewport();
      }, { rootMargin: "720px 0px" });
      observer.observe(anchor);
    }
    // IntersectionObserver can miss a target while a long document is being
    // smooth-scrolled or synchronously re-laid out. Keep the same threshold
    // as the observer and re-check on viewport movement as a deterministic
    // fallback for programmatic navigation.
    window.addEventListener("scroll", loadWhenNearViewport, { passive: true });
    window.addEventListener("resize", loadWhenNearViewport);
    loadWhenNearViewport();
    return stopWatching;
  }, []);
  useEffect(() => {
    if (!anchorId || typeof window === "undefined") return;
    const hash = `#${anchorId}`;
    const loadFromHash = () => {
      if (window.location.hash !== hash) return;
      setShouldLoad(true);
      window.setTimeout(() => {
        const target = anchorRef.current;
        target?.scrollIntoView({ block: "center" });
        target?.focus({ preventScroll: true });
      }, 0);
    };
    loadFromHash();
    window.addEventListener("hashchange", loadFromHash);
    return () => window.removeEventListener("hashchange", loadFromHash);
  }, [anchorId]);
  // Programmatic focus is also a deliberate navigation signal (for example,
  // from a priority-card deep link). Do not make keyboard/deep-link navigation
  // wait for an IntersectionObserver callback to mount the target panel.
  return <div id={anchorId} ref={anchorRef} tabIndex={anchorId ? -1 : undefined} onFocus={() => setShouldLoad(true)}>{shouldLoad ? children : <AdminPanelLoading label={label} />}</div>;
}

function dispatchAdminToast(message: string) {
  window.dispatchEvent(new CustomEvent("pc-supporter:admin-toast", { detail: message }));
}

function focusAdminPanel(anchorId: string) {
  const target = document.getElementById(anchorId);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.focus({ preventScroll: true });
}

function catalogSpecCoverageTone(coverage: CatalogSpecCoverage["categories"][number]) {
  if (coverage.total === 0) return "neutral";
  if (coverage.coveragePercent < 50) return "danger";
  if (coverage.coveragePercent < 90) return "warning";
  return "good";
}

const catalogSpecCoveragePriorityRank = { high: 0, medium: 1, low: 2, none: 3 } as const;
const catalogSpecCoveragePriorityLabels = { high: "우선 보강", medium: "보강 권장", low: "소수 누락", none: "양호" } as const;

function catalogWorkPriorityTitle(action: CatalogWorkPriority) {
  if (action.kind === "benchmark") return (action.category === "gpu" ? "GPU 3DMark" : "CPU Cinebench R23") + " 근거 보강";
  if (action.kind === "pcie") return "메인보드 PCIe 슬롯 정보 보강";
  const missingLabel = action.missingField ? catalogMissingFieldLabelFor(action.missingField) : "핵심 스펙";
  return CATEGORY_LABELS[action.category] + " " + missingLabel + " 보강";
}

function catalogWorkPrioritySummary(action: CatalogWorkPriority) {
  if (action.kind === "benchmark") return "완전 세트 " + action.complete.toLocaleString("ko-KR") + " / " + action.total.toLocaleString("ko-KR") + "개 · " + action.gapCount.toLocaleString("ko-KR") + "개 검수 필요";
  if (action.kind === "pcie") return "x" + (action.pcieRequiredWidth ?? 4) + " 이상 슬롯 조건의 원문 정보 확인 " + action.complete.toLocaleString("ko-KR") + " / " + action.total.toLocaleString("ko-KR") + "개 · " + action.gapCount.toLocaleString("ko-KR") + "개 검수 필요";
  return action.gapCount.toLocaleString("ko-KR") + "개 부분·확인 필요 · " + (action.missingFieldCount ?? action.gapCount).toLocaleString("ko-KR") + "개에서 " + (action.missingField ? catalogMissingFieldLabelFor(action.missingField) : "핵심 스펙") + " 누락";
}

function catalogWorkPriorityPath(action: CatalogWorkPriority) {
  if (action.kind === "pcie") return "/catalog?" + new URLSearchParams({ category: "motherboard", pcieSlotInfo: "missing" }).toString();
  const params = new URLSearchParams({ category: action.category, quality: "incomplete" });
  if (action.missingField) params.set("missingField", action.missingField);
  return "/catalog?" + params.toString();
}

function catalogWorkPriorityReviewPath(action: CatalogWorkPriority) {
  if (action.kind === "pcie") return "/admin?reviewEvidence=pcie#admin-catalog-spec-review";
  return "/admin#admin-catalog-spec-review";
}

function accessoryWorkPriorityPath(action: Pick<AccessoryWorkPriority, "category">) {
  return "/accessories?" + new URLSearchParams({ category: action.category, quality: "incomplete" }).toString();
}

function AccessoryDataPriorityCard({ action, onStartAccessoryCrawl, accessoryCrawlRunning }: { action: AccessoryWorkPriority; onStartAccessoryCrawl?: (category: AccessoryCategory) => void; accessoryCrawlRunning?: boolean }) {
  return <article className="catalog-data-priority-item accessory" data-testid={"admin-catalog-work-priority-" + action.id.replace(":", "-")}><div className="catalog-data-priority-item-heading"><span className="catalog-data-priority-kind accessory">주변 부품</span><strong>{ACCESSORY_CATEGORY_LABELS[action.category]} 상세 보강</strong></div><p>{action.gapCount.toLocaleString("ko-KR")}개 보강 필요 · 상품 미완료 {action.incompleteProductCount.toLocaleString("ko-KR")}개 · 스펙 미완료 {action.incompleteSpecCount.toLocaleString("ko-KR")}개 · {action.details ? "일부 상세 확인됨" : "상세 확인 배치 필요"}</p><small>완전 {action.complete.toLocaleString("ko-KR")} / {action.total.toLocaleString("ko-KR")}개 · coverage {action.coveragePercent}%</small><div className="catalog-data-priority-actions"><a className="text-button" data-testid="admin-catalog-work-priority-open-accessory" href={accessoryWorkPriorityPath(action)}><FiSearch /> 미완료 목록 보기</a>{onStartAccessoryCrawl && <button className="text-button" type="button" data-testid="admin-catalog-work-priority-start-accessory" data-category={action.category} onClick={() => onStartAccessoryCrawl(action.category)} disabled={accessoryCrawlRunning}><FiRefreshCw /> 상세 보강 배치</button>}</div></article>;
}

function accessoryCoverageTone(coverage: ServiceMeta["accessoryCoverage"]["categories"][number]) {
  const percent = accessoryCoveragePercentFor(coverage);
  if (percent < 50) return "danger";
  if (percent < 90 || coverage.listCoverage !== "complete" || coverage.storedSpecCoverage !== "complete") return "warning";
  return "good";
}

function AccessoryCoveragePanel({ coverage, onStartAccessoryCrawl, accessoryCrawlRunning }: { coverage?: ServiceMeta["accessoryCoverage"]; onStartAccessoryCrawl?: (category: AccessoryCategory) => void; accessoryCrawlRunning?: boolean }) {
  if (!coverage || coverage.categories.length === 0) return null;
  const totals = coverage.categories.reduce((summary, item) => ({
    stored: summary.stored + item.storedProductCount,
    live: summary.live + item.liveProducts,
    incompleteProducts: summary.incompleteProducts + item.incompleteProducts,
    incompleteSpecs: summary.incompleteSpecs + item.incompleteSpecs,
    priced: summary.priced + item.pricedProducts
  }), { stored: 0, live: 0, incompleteProducts: 0, incompleteSpecs: 0, priced: 0 });
  const sortedCategories = coverage.categories.slice().sort((left, right) => accessoryCoverageGapFor(right) - accessoryCoverageGapFor(left) || left.category.localeCompare(right.category));
  return <section className="accessory-spec-coverage" data-testid="admin-accessory-spec-coverage" aria-label="주변 부품 데이터 coverage"><div className="accessory-spec-coverage-heading"><div><span>PERIPHERAL COVERAGE</span><strong>주변 부품 데이터 범위</strong><small>목록·상세·스펙 근거를 범주별로 분리해 표시합니다. `최근 스펙 누락`은 마지막 수집 배치에서 확인된 값이며, 현재 원문에 없는 값을 자동으로 채우지 않습니다.</small></div><span>{coverage.categories.length}개 범주</span></div><div className="accessory-spec-coverage-stats"><span>저장 상품 <strong>{totals.stored.toLocaleString("ko-KR")}개</strong></span><span>live 상품 <strong>{totals.live.toLocaleString("ko-KR")}개</strong></span><span>상품 미완료 <strong>{totals.incompleteProducts.toLocaleString("ko-KR")}개</strong></span><span>최근 스펙 누락 <strong>{totals.incompleteSpecs.toLocaleString("ko-KR")}개</strong></span><span>가격 확인 <strong>{totals.priced.toLocaleString("ko-KR")}개</strong></span></div><div className="accessory-spec-coverage-list">{sortedCategories.map((item) => { const tone = accessoryCoverageTone(item); const gapCount = accessoryCoverageGapFor(item); const percent = accessoryCoveragePercentFor(item); return <article className={`accessory-spec-coverage-item ${tone}`} key={item.category}><div className="accessory-spec-coverage-item-heading"><strong>{ACCESSORY_CATEGORY_LABELS[item.category]}</strong><span>{percent}% 보강</span></div><div className="accessory-spec-coverage-track" role="progressbar" aria-label={`${ACCESSORY_CATEGORY_LABELS[item.category]} 주변 부품 coverage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${Math.min(100, percent)}%` }} /></div><div className="accessory-spec-coverage-item-meta"><span>보관 {item.storedProductCount.toLocaleString("ko-KR")}개</span><span>{gapCount > 0 ? `보강 ${gapCount.toLocaleString("ko-KR")}개` : "보강 gap 없음"}</span></div><small>live {item.liveProducts} · 상품 미완료 {item.incompleteProducts} · 최근 스펙 누락 {item.incompleteSpecs}</small><small>최근 상세 성공 {item.detailFetched} · 실패 {item.detailFailed} · 목록 {item.listCoverage === "complete" ? "완전" : "부분"}</small><small>상세 {item.details ? "실행" : "미실행"} · 가격 {item.pricedProducts}/{item.storedProductCount}</small><div className="accessory-spec-coverage-item-actions"><a className="text-button" data-testid="admin-accessory-spec-open-incomplete" href={accessoryWorkPriorityPath({ category: item.category })}><FiSearch /> 미완료 보기</a>{onStartAccessoryCrawl && <button className="text-button" type="button" data-testid="admin-accessory-spec-start-category" data-category={item.category} onClick={() => onStartAccessoryCrawl(item.category)} disabled={accessoryCrawlRunning}><FiRefreshCw /> 상세 보강</button>}</div></article>; })}</div><p className="accessory-spec-coverage-note"><FiInfo /> coverage는 현재 저장된 상품과 마지막 수집의 확인 범위를 나타냅니다. 보강 수치는 우선순위 제안이며, 실제 장착·커넥터·전원 호환은 각 제품 원문을 확인해야 합니다.</p></section>;
}

const PCIE_COVERAGE_WIDTHS = [16, 8, 4, 1] as const;

const CATEGORY_INTEGRITY_REVIEW_PAGE_LIMIT = 6;

function catalogCategoryIntegritySourceLabel(source: Part["source"]) {
  return source === "danawa" ? "다나와 원본" : source === "seed" ? "프로젝트 기준" : "수동 입력";
}

function catalogCategoryIntegrityReviewDate(value: string) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString("ko-KR") : "시점 확인 필요";
}

function CatalogCategoryIntegrityReviewQueue({ integrity }: { integrity?: ServiceMeta["catalogCategoryIntegrity"] }) {
  const [reviewPackage, setReviewPackage] = useState<CatalogCategoryIntegrityReviewPackage>();
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const reviewRequestVersionRef = useRef(0);

  useEffect(() => {
    const requestVersion = ++reviewRequestVersionRef.current;
    let active = true;
    if (!integrity || integrity.mismatchCount === 0) {
      setReviewPackage(undefined);
      setReviewError(null);
      setReviewLoading(false);
      return () => { active = false; };
    }
    setReviewLoading(true);
    setReviewError(null);
    api<CatalogCategoryIntegrityReviewPackage>(`/api/admin/catalog-category-integrity/review-package?limit=${CATEGORY_INTEGRITY_REVIEW_PAGE_LIMIT}&offset=0`)
      .then((nextPackage) => {
        if (active && reviewRequestVersionRef.current === requestVersion) setReviewPackage(nextPackage);
      })
      .catch((error: unknown) => {
        if (active && reviewRequestVersionRef.current === requestVersion) setReviewError(error instanceof Error ? error.message : "카테고리 불일치 원본 큐를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active && reviewRequestVersionRef.current === requestVersion) setReviewLoading(false);
      });
    return () => {
      active = false;
      if (reviewRequestVersionRef.current === requestVersion) reviewRequestVersionRef.current += 1;
    };
  }, [integrity?.mismatchCount, integrity?.ruleVersion]);

  async function loadNextPage() {
    const currentPackage = reviewPackage;
    const nextOffset = currentPackage?.nextOffset;
    if (currentPackage === undefined || nextOffset === undefined || reviewLoading) return;
    const requestVersion = ++reviewRequestVersionRef.current;
    setReviewLoading(true);
    setReviewError(null);
    try {
      const nextPackage = await api<CatalogCategoryIntegrityReviewPackage>(`/api/admin/catalog-category-integrity/review-package?limit=${CATEGORY_INTEGRITY_REVIEW_PAGE_LIMIT}&offset=${nextOffset}&queueFingerprint=${encodeURIComponent(currentPackage.queueFingerprint)}`);
      if (reviewRequestVersionRef.current !== requestVersion) return;
      if (nextPackage.queueChanged) {
        setReviewError("카탈로그가 갱신되어 검수 큐가 바뀌었습니다. 관리자 화면을 새로고침해 첫 페이지부터 다시 확인해 주세요.");
        return;
      }
      if (reviewRequestVersionRef.current === requestVersion) setReviewPackage(nextPackage);
    } catch (error: unknown) {
      if (reviewRequestVersionRef.current === requestVersion) setReviewError(error instanceof Error ? error.message : "다음 카테고리 불일치 원본을 불러오지 못했습니다.");
    } finally {
      if (reviewRequestVersionRef.current === requestVersion) setReviewLoading(false);
    }
  }

  if (!integrity || integrity.checkedCount === 0) return null;
  const mismatch = integrity.mismatchCount;
  return <div className="catalog-category-integrity-review" data-testid="admin-catalog-category-integrity-review" aria-label="카테고리 불일치 원본 검수 큐">
    <div className="catalog-category-integrity-review-heading"><div><span>RAW RECORD REVIEW</span><strong>분리된 원본 검수 큐</strong><small>자동 재분류·삭제 없이, 카테고리 불일치 근거와 원문을 확인하는 읽기 전용 큐입니다.</small></div><span>{mismatch > 0 ? `${mismatch.toLocaleString("ko-KR")}개 대상` : "검수 대상 없음"}</span></div>
    {reviewLoading && !reviewPackage && <p className="catalog-category-integrity-review-state"><FiLoader className="spin" /> 분리 원본을 불러오는 중...</p>}
    {reviewError && <div className="catalog-category-integrity-review-state error" role="alert"><FiAlertTriangle /><span>{reviewError}</span><button className="text-button" type="button" onClick={() => window.location.reload()}>다시 불러오기</button></div>}
    {reviewPackage && reviewPackage.items.length > 0 && <>
      <div className="catalog-category-integrity-review-summary"><span>검사 범위 <strong>{reviewPackage.checkedCount.toLocaleString("ko-KR")}개</strong></span><span>전체 큐 <strong>{reviewPackage.queueTotal.toLocaleString("ko-KR")}개</strong></span><span>현재 표시 <strong>{reviewPackage.offset + 1}–{reviewPackage.offset + reviewPackage.includedCount}</strong></span><span>fingerprint <strong>{reviewPackage.queueFingerprint}</strong></span></div>
      <div className="catalog-category-integrity-review-list">{reviewPackage.items.map((item) => { const sourceUrl = safeExternalUrl(item.sourceUrl); const listingLabel = item.listingType ? LISTING_TYPE_LABELS[item.listingType] : undefined; return <article className="catalog-category-integrity-review-item" data-testid="admin-catalog-category-integrity-item" data-signal={item.signal} key={item.partId}><div className="catalog-category-integrity-review-item-main"><div className="catalog-category-integrity-review-item-top"><span className="catalog-category-integrity-review-signal">{item.label}</span><span>{catalogCategoryIntegritySourceLabel(item.source)}</span></div><strong>{item.partName}</strong><small>{item.partId} · {item.sourceProductCode ? `원본 코드 ${item.sourceProductCode}` : "원본 코드 없음"} · {item.sourceCategoryId ? `원본 범주 ${item.sourceCategoryId}` : "원본 범주 없음"}</small><small>{item.reason} · 갱신 {catalogCategoryIntegrityReviewDate(item.updatedAt)} · {DATA_QUALITY_LABELS[item.dataQuality]}{listingLabel ? ` · ${listingLabel}` : ""}</small>{item.rawSpecExcerpt && <p><FiInfo /> 원문 발췌: {item.rawSpecExcerpt}</p>}</div><div className="catalog-category-integrity-review-item-side"><strong>{item.priceWon !== undefined ? `${item.priceWon.toLocaleString("ko-KR")}원` : "가격 미확인"}</strong><div><a className="text-button" href={item.catalogUrl}><FiSearch /> 상세</a>{sourceUrl && <a className="text-button" href={sourceUrl} target="_blank" rel="noreferrer"><FiExternalLink /> 원문</a>}</div></div></article>; })}</div>
      {reviewPackage.nextOffset !== undefined && <button className="button button-light catalog-category-integrity-review-next" type="button" onClick={() => void loadNextPage()} disabled={reviewLoading}>{reviewLoading ? <><FiLoader className="spin" /> 불러오는 중...</> : <><FiChevronDown /> 다음 {CATEGORY_INTEGRITY_REVIEW_PAGE_LIMIT}개</>}</button>}
    </>}
    {reviewPackage && reviewPackage.items.length === 0 && <p className="catalog-category-integrity-review-state"><FiCheckCircle /> 현재 검수 큐에 표시할 원본이 없습니다.</p>}
    <p className="catalog-category-integrity-review-note"><FiInfo /> 목록의 원본은 보존됩니다. 카테고리 변경은 원문 확인 후 별도 운영 절차에서 판단해야 하며, 이 화면에서는 어떤 레코드도 수정하지 않습니다.</p>
  </div>;
}

function CatalogCategoryIntegrityPanel({ integrity }: { integrity?: ServiceMeta["catalogCategoryIntegrity"] }) {
  if (!integrity || integrity.checkedCount === 0) return null;
  const mismatch = integrity.mismatchCount;
  return <div className={`catalog-category-integrity ${mismatch > 0 ? "warning" : "good"}`} data-testid="admin-catalog-category-integrity" aria-label="카탈로그 카테고리 정합성"><div className="catalog-category-integrity-heading"><div><span>CATEGORY INTEGRITY</span><strong>메인보드 카테고리 정합성</strong><small>제품 정체성이 명확히 다른 원본만 핵심 호환 후보와 PCIe evidence 대상에서 분리합니다.</small></div><span>{mismatch > 0 ? `${mismatch.toLocaleString("ko-KR")}개 분리` : "정합성 확인"}</span></div><div className="catalog-category-integrity-stats"><span>검사 범위 <strong>{integrity.checkedCount.toLocaleString("ko-KR")}개</strong></span><span>오염 후보 <strong>{mismatch.toLocaleString("ko-KR")}개</strong></span><span>규칙 버전 <strong>v{integrity.ruleVersion}</strong></span></div>{integrity.bySignal.length > 0 && <div className="catalog-category-integrity-signals">{integrity.bySignal.map((signal) => <span key={signal.signal}>{signal.label} <b>{signal.count.toLocaleString("ko-KR")}</b></span>)}</div>}<p><FiInfo /> 원본 레코드는 삭제하지 않고 보존합니다. `센서`·`모듈`·`전원부` 같은 일반 단어는 오탐을 막기 위해 분리 근거로 사용하지 않습니다.</p><CatalogCategoryIntegrityReviewQueue integrity={integrity} /></div>;
}

function catalogPcieCoverageTone(coverage: CatalogPcieSlotCoverage["byRequiredWidth"][16]) {
  if (coverage.total === 0) return "neutral";
  if (coverage.coveragePercent < 50) return "danger";
  if (coverage.coveragePercent < 90) return "warning";
  return "good";
}

function CatalogPcieSlotCoveragePanel({ coverage }: { coverage: CatalogSpecCoverage }) {
  const pcieCoverage = coverage.pcieSlotCoverage;
  if (!pcieCoverage) return null;
  const x4Coverage = pcieCoverage.byRequiredWidth[4];
  return <section className="catalog-pcie-slot-coverage" data-testid="admin-catalog-pcie-coverage" aria-label="메인보드 PCIe 슬롯 정보 coverage">
    <div className="catalog-pcie-slot-coverage-heading"><div><span>PCIE SLOT EVIDENCE</span><strong>메인보드 PCIe 슬롯 정보</strong><small>확장 슬롯 원문에서 확인한 폭 정보를 기준으로, 요구 폭별 조건 필터에 사용할 수 있는 범위를 표시합니다.</small></div><span>{pcieCoverage.total.toLocaleString("ko-KR")}개 보드</span></div>
    <div className="catalog-pcie-slot-coverage-summary"><span>x4 이상 조건 사용 가능 <strong>{x4Coverage.complete.toLocaleString("ko-KR")}개</strong></span><span>정보 부족 <strong>{x4Coverage.missing.toLocaleString("ko-KR")}개</strong></span><span>기준 coverage <strong>{x4Coverage.coveragePercent}%</strong></span></div>
    <div className="catalog-pcie-slot-coverage-list">{PCIE_COVERAGE_WIDTHS.map((requiredWidth) => { const item = pcieCoverage.byRequiredWidth[requiredWidth]; const tone = catalogPcieCoverageTone(item); return <article className={`catalog-pcie-slot-coverage-item ${tone}`} key={requiredWidth}><div className="catalog-pcie-slot-coverage-item-heading"><strong>x{requiredWidth} 이상 조건</strong><span>{item.total === 0 ? "대상 없음" : `${item.coveragePercent}% 확인`}</span></div><div className="catalog-pcie-slot-coverage-track" role="progressbar" aria-label={`PCIe x${requiredWidth} 이상 슬롯 정보 coverage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.total === 0 ? 0 : item.coveragePercent}><span style={{ width: `${item.total === 0 ? 0 : Math.min(100, item.coveragePercent)}%` }} /></div><small>정보 확인 {item.complete.toLocaleString("ko-KR")} · 정보 부족 {item.missing.toLocaleString("ko-KR")}</small></article>; })}</div>
    <div className="catalog-pcie-slot-coverage-actions"><a className="text-button" data-testid="admin-catalog-pcie-open-missing" href="/catalog?category=motherboard&pcieSlotInfo=missing"><FiSearch /> 정보 부족 보드 보기</a><a className="text-button" data-testid="admin-catalog-pcie-open-review" href="/admin?reviewEvidence=pcie#admin-catalog-spec-review"><FiRefreshCw /> PCIe 원문 보강 큐 열기</a><a className="text-button" data-testid="admin-catalog-pcie-open-x4" href="/catalog?category=motherboard&pcieSlotWidth=4&minPcieSlotCount=1"><FiLayers /> x4 이상 슬롯 보드 보기</a></div>
    <p className="catalog-pcie-slot-coverage-note"><FiInfo /> 이 coverage는 전체 카탈로그의 `완전` 수치를 바꾸지 않습니다. PCIe 조건을 적용할 때 원문 폭 정보가 모두 확인된 보드만 후보로 사용하며, 정보 부족 보드는 별도 보강 대상으로 확인합니다.</p>
    <CatalogCategoryIntegrityPanel integrity={coverage.categoryIntegrity} />
  </section>;
}

function CatalogDataPriorityPanel({ coverage, benchmarkCoverage, accessoryCoverage, onStartCategoryCrawl, onStartCategoryCrawlAll, categoryCrawlRunning, onStartAccessoryCrawl, accessoryCrawlRunning, onOpenBenchmarkReview }: { coverage?: CatalogSpecCoverage; benchmarkCoverage?: ServiceMeta["benchmarkCoverage"]; accessoryCoverage?: ServiceMeta["accessoryCoverage"]; onStartCategoryCrawl?: (category: PartCategory) => void; onStartCategoryCrawlAll?: (category: PartCategory) => void; categoryCrawlRunning?: boolean; onStartAccessoryCrawl?: (category: AccessoryCategory) => void; accessoryCrawlRunning?: boolean; onOpenBenchmarkReview?: () => void }) {
  const actions = catalogWorkPriorityFor(coverage, benchmarkCoverage, 5);
  const accessoryActions = accessoryWorkPriorityFor(accessoryCoverage, 4);
  const actionCount = actions.length + accessoryActions.length;
  if (actionCount === 0) return null;
  return <section className="catalog-data-priority-panel" data-testid="admin-catalog-work-priority" aria-label="다음 데이터 보강 작업"><div className="catalog-data-priority-heading"><div><p className="eyebrow">NEXT DATA WORK</p><strong>다음 보강 작업</strong><small>핵심·주변 부품의 스펙, PCIe evidence, benchmark coverage gap을 합쳐 우선순위를 계산합니다.</small></div><span>{actionCount}개 우선 작업</span></div><div className="catalog-data-priority-list">{actions.map((action) => <article className={"catalog-data-priority-item " + action.kind} data-testid={"admin-catalog-work-priority-" + action.id.replace(":", "-")} key={action.id}><div className="catalog-data-priority-item-heading"><span className={"catalog-data-priority-kind " + action.kind}>{action.kind === "benchmark" ? "성능 근거" : action.kind === "pcie" ? "PCIe 근거" : "스펙 완성도"}</span><strong>{catalogWorkPriorityTitle(action)}</strong></div><p>{catalogWorkPrioritySummary(action)}</p><small>완전 {action.complete.toLocaleString("ko-KR")} / {action.total.toLocaleString("ko-KR")}개 · coverage {action.coveragePercent}%</small><div className="catalog-data-priority-actions">{(action.kind === "spec" || action.kind === "pcie") && <a className="text-button" data-testid="admin-catalog-work-priority-open-missing" href={catalogWorkPriorityPath(action)}><FiSearch /> {action.kind === "pcie" ? "PCIe 정보 부족 보드 보기" : "누락 목록 보기"}</a>}{action.kind === "pcie" && <a className="text-button" data-testid="admin-catalog-work-priority-open-review" href={catalogWorkPriorityReviewPath(action)}><FiRefreshCw /> 원문 보강 큐 열기</a>}{(action.kind === "spec" || action.kind === "pcie") && onStartCategoryCrawl && <button className="text-button" type="button" data-testid="admin-catalog-work-priority-start-category" data-category={action.category} onClick={() => onStartCategoryCrawl(action.category)} disabled={categoryCrawlRunning}><FiRefreshCw /> 범주 빠른 수집</button>}{(action.kind === "spec" || action.kind === "pcie") && onStartCategoryCrawlAll && <button className="text-button exhaustive" type="button" data-testid="admin-catalog-work-priority-start-category-all" data-category={action.category} onClick={() => onStartCategoryCrawlAll(action.category)} disabled={categoryCrawlRunning} title="선택 범주의 목록과 상세 스펙을 끝까지 다시 수집합니다."><FiDatabase /> 범주 전체 수집</button>}{action.kind === "benchmark" && onOpenBenchmarkReview && <button className="text-button" type="button" data-testid="admin-catalog-work-priority-open-benchmark" onClick={onOpenBenchmarkReview}><FiSearch /> benchmark 검수 큐 열기</button>}</div></article>)}</div>{accessoryActions.length > 0 && <><div className="catalog-data-priority-subheading"><strong>주변 부품 보강</strong><span>{accessoryActions.length}개 우선 작업</span></div><div className="catalog-data-priority-list accessory">{accessoryActions.map((action) => <AccessoryDataPriorityCard action={action} onStartAccessoryCrawl={onStartAccessoryCrawl} accessoryCrawlRunning={accessoryCrawlRunning} key={action.id} />)}</div></>}<p className="catalog-data-priority-note"><FiInfo /> priority는 검수 순서 제안입니다. 값을 자동 확정하거나 benchmark·실제 성능을 추정하지 않습니다.</p></section>;
}

function CatalogSpecCoveragePanel({ coverage, benchmarkCoverage, accessoryCoverage, onStartCategoryCrawl, onStartCategoryCrawlAll, categoryCrawlRunning, onStartAccessoryCrawl, accessoryCrawlRunning, onOpenBenchmarkReview }: { coverage?: CatalogSpecCoverage; benchmarkCoverage?: ServiceMeta["benchmarkCoverage"]; accessoryCoverage?: ServiceMeta["accessoryCoverage"]; onStartCategoryCrawl?: (category: PartCategory) => void; onStartCategoryCrawlAll?: (category: PartCategory) => void; categoryCrawlRunning?: boolean; onStartAccessoryCrawl?: (category: AccessoryCategory) => void; accessoryCrawlRunning?: boolean; onOpenBenchmarkReview?: () => void }) {
  if (!coverage) return <section className="catalog-spec-coverage loading" data-testid="admin-catalog-spec-coverage" aria-label="카탈로그 스펙 완성도"><FiLoader className="spin" /> 카테고리별 스펙 완성도를 계산하는 중...</section>;
  const fresh = coverage.freshnessCounts.fresh;
  const aging = coverage.freshnessCounts.aging;
  const stale = coverage.freshnessCounts.stale;
  const unknown = coverage.freshnessCounts.unknown;
  return <><CatalogDataPriorityPanel coverage={coverage} benchmarkCoverage={benchmarkCoverage} accessoryCoverage={accessoryCoverage} onStartCategoryCrawl={onStartCategoryCrawl} onStartCategoryCrawlAll={onStartCategoryCrawlAll} categoryCrawlRunning={categoryCrawlRunning} onStartAccessoryCrawl={onStartAccessoryCrawl} accessoryCrawlRunning={accessoryCrawlRunning} onOpenBenchmarkReview={onOpenBenchmarkReview} /><section className="catalog-spec-coverage" data-testid="admin-catalog-spec-coverage" aria-label="카탈로그 스펙 완성도">
    <div className="catalog-spec-coverage-heading"><div><span>SPEC COMPLETENESS</span><strong>스펙 완성도·보강 우선순위</strong><small>현재 카탈로그의 `missingFields`와 데이터 품질을 기준으로 계산합니다. 정보가 없는 필드는 안전하다고 간주하지 않습니다.</small></div><span className={`catalog-spec-coverage-badge ${coverage.coveragePercent < 90 ? "review" : "good"}`}>{coverage.coveragePercent}% 완전</span></div>
    <div className="catalog-spec-coverage-stats"><span>전체 <strong>{coverage.total.toLocaleString("ko-KR")}개</strong></span><span>완전 <strong>{coverage.complete.toLocaleString("ko-KR")}개</strong></span><span>부분·확인 필요 <strong>{coverage.partial.toLocaleString("ko-KR")}개</strong></span><span>가격 미확인 <strong>{coverage.priceUnknown.toLocaleString("ko-KR")}개</strong></span></div>
    <div className="catalog-spec-coverage-freshness"><span>갱신 상태</span><strong>{DATA_FRESHNESS_LABELS.fresh} {fresh} · {DATA_FRESHNESS_LABELS.aging} {aging} · {DATA_FRESHNESS_LABELS.stale} {stale} · {DATA_FRESHNESS_LABELS.unknown} {unknown}</strong></div>
    <div className="catalog-spec-coverage-list">{coverage.categories.slice().sort((left, right) => catalogSpecCoveragePriorityRank[left.priority] - catalogSpecCoveragePriorityRank[right.priority] || right.partial - left.partial || left.category.localeCompare(right.category)).map((category) => { const tone = catalogSpecCoverageTone(category); const topMissing = category.missingFields.slice(0, 3).map((field) => `${catalogMissingFieldLabelFor(field.field)} ${field.count}`).join(" · "); return <article className={`catalog-spec-coverage-item ${tone}`} key={category.category}><div className="catalog-spec-coverage-item-heading"><strong>{CATEGORY_LABELS[category.category]}</strong></div><div className="catalog-spec-coverage-item-actions">{(category.priority === "high" || category.priority === "medium") && onStartCategoryCrawl && <button className="text-button" type="button" data-testid="admin-catalog-spec-start-category" data-category={category.category} onClick={() => onStartCategoryCrawl(category.category)} disabled={categoryCrawlRunning}><FiRefreshCw /> 범주 빠른 수집</button>}{(category.priority === "high" || category.priority === "medium") && onStartCategoryCrawlAll && <button className="text-button exhaustive" type="button" data-testid="admin-catalog-spec-start-category-all" data-category={category.category} onClick={() => onStartCategoryCrawlAll(category.category)} disabled={categoryCrawlRunning} title="선택 범주의 목록과 상세 스펙을 끝까지 다시 수집합니다."><FiDatabase /> 범주 전체 수집</button>}</div><div className="catalog-spec-coverage-item-meta"><span className={`catalog-spec-coverage-priority ${category.priority}`}>{catalogSpecCoveragePriorityLabels[category.priority]}</span><span>{category.total === 0 ? "대상 없음" : `${category.coveragePercent}% 완전`}</span></div><div className="catalog-spec-coverage-track" role="progressbar" aria-label={`${CATEGORY_LABELS[category.category]} 스펙 완성도`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={category.total === 0 ? 0 : category.coveragePercent}><span style={{ width: `${category.total === 0 ? 0 : Math.min(100, category.coveragePercent)}%` }} /></div><small>완전 {category.complete} · 부분 {category.partial} · 가격 확인 {category.priceKnown}</small><small>갱신 {DATA_FRESHNESS_LABELS.fresh} {DATA_FRESHNESS_LABELS.aging} · {DATA_FRESHNESS_LABELS.stale} {category.freshnessCounts.stale} · ${DATA_FRESHNESS_LABELS.unknown} ${unknown}</small><small>{topMissing ? `주요 누락 · ${topMissing}` : category.unnamedIncomplete > 0 ? `누락 필드 미기록 · ${category.unnamedIncomplete}개` : "필드 누락 없음"}</small>{category.missingFields.slice(0, 3).map((field) => <a className="catalog-spec-coverage-missing-link" data-testid="admin-catalog-spec-missing-field" href={`/catalog?category=${encodeURIComponent(category.category)}&quality=incomplete&missingField=${encodeURIComponent(field.field)}`} key={field.field}>누락 {catalogMissingFieldLabelFor(field.field)} 보기</a>)}</article>; })}</div>
    <p className="catalog-spec-coverage-note"><FiInfo /> `완전`은 필수 누락 필드가 없고 incomplete 품질이 아닌 항목입니다. 카테고리별 대상이 0개인 경우의 100%는 계산상 빈 집합이며 실제 부품 근거가 있다는 뜻이 아닙니다. 보강 우선순위는 주요 누락 필드와 부분 수가 많은 범주부터 확인하세요.</p>
  </section><CatalogPcieSlotCoveragePanel coverage={coverage} /><AccessoryCoveragePanel coverage={accessoryCoverage} onStartAccessoryCrawl={onStartAccessoryCrawl} accessoryCrawlRunning={accessoryCrawlRunning} /><DeferredAdminPanel label="카탈로그 스펙 보강 큐" anchorId="admin-catalog-spec-review"><Suspense fallback={<AdminPanelLoading label="카탈로그 스펙 보강 큐" />}><CatalogSpecReviewPanel onToast={dispatchAdminToast} /></Suspense></DeferredAdminPanel><DeferredAdminPanel label="제조사 근거 수동 스펙 보강"><Suspense fallback={<AdminPanelLoading label="제조사 근거 수동 스펙 보강" />}><CatalogSpecOverridePanel onToast={dispatchAdminToast} /></Suspense></DeferredAdminPanel></>;
}

type AdminBuildVersionAuditPanelProps = {
  audit: SavedBuildVersionAudit | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  migrationPreview: SavedBuildVersionMigrationPreview | null;
  migrationPreviewLoading: boolean;
  migrationPreviewError: string | null;
  onMigrationPreview: () => void;
  migrationApplyLoading: boolean;
  migrationApplyError: string | null;
  migrationApplyResult: SavedBuildVersionMigrationMutationResult | null;
  onApplyMigration: () => void;
  rollbackLoading: boolean;
  rollbackError: string | null;
  rollbackResult: SavedBuildVersionMigrationRollbackResult | null;
  onRollbackMigration: (backup?: SavedBuildVersionBackupSummary) => void;
  backups: SavedBuildVersionBackupSummary[];
  backupDetail: SavedBuildVersionBackupDetail | null;
  backupDetailLoading: boolean;
  backupDetailError: string | null;
  backupDetailId: string | null;
  onOpenBackupDetail: (backupId: string) => void;
  onCloseBackupDetail: () => void;
  onStartCategoryCrawl: (category: PartCategory) => void;
  categoryCrawlRunning: boolean;
};

const SAVED_BUILD_VERSION_METADATA_LABELS: Record<string, string> = { versionGroupId: "버전 그룹", versionNumber: "버전 번호", derivedFromBuildId: "부모 견적" };

function AdminBuildVersionBackupDetailPanel({ detail, loading, error, onClose }: { detail: SavedBuildVersionBackupDetail | null; loading: boolean; error: string | null; onClose: () => void }) {
  if (!loading && !error && !detail) return null;
  return <div className="version-backup-detail" data-testid="admin-build-version-backup-detail">
    <div className="version-audit-subheading"><strong>backup 상세 diff</strong><span>{detail ? `${detail.items.length}개 변경` : loading ? "불러오는 중" : "조회 실패"}</span><button className="icon-button" aria-label="backup 상세 diff 닫기" onClick={onClose}><FiXCircle /></button></div>
    {loading ? <p className="version-audit-empty"><FiLoader className="spin" /> backup의 버전 메타데이터 변경을 확인하고 있습니다.</p> : error ? <div className="version-audit-error"><FiAlertTriangle /><span>{error}</span></div> : detail && <>
      <div className="version-backup-detail-summary"><span>backup {detail.backupId.slice(0, 12)}</span><span>{new Date(detail.createdAt).toLocaleString("ko-KR")}</span><strong className={detail.rollbackAvailable ? "available" : "unavailable"}>{detail.rollbackAvailable ? "rollback 가능" : "현재 데이터 변경됨"}</strong></div>
      {detail.items.length === 0 ? <p className="version-audit-clear"><FiCheckCircle /> 변경된 버전 메타데이터가 없습니다.</p> : <div className="version-backup-detail-list">{detail.items.map((item) => <div className="version-backup-detail-row" key={item.buildId}><div className="version-backup-detail-name"><strong>{item.name}</strong><span>{item.changedFields.map((field) => SAVED_BUILD_VERSION_METADATA_LABELS[field] ?? field).join(" · ")}</span></div><div className="version-backup-detail-values"><span><small>그룹</small><code>{item.before.versionGroupId ?? "legacy"} → {item.after.versionGroupId ?? "legacy"}</code></span><span><small>버전</small><code>{item.before.versionNumber === undefined ? "없음" : `v${item.before.versionNumber}`} → v{item.after.versionNumber ?? "-"}</code></span>{item.before.derivedFromBuildId !== undefined || item.after.derivedFromBuildId !== undefined ? <span><small>부모</small><code>{item.before.derivedFromBuildId ?? "없음"} → {item.after.derivedFromBuildId ?? "없음"}</code></span> : null}</div></div>)}</div>}
      <p className="version-audit-note"><FiInfo /> 구성 부품·가격·owner token은 노출하지 않고 버전 메타데이터만 비교합니다. 현재 fingerprint {detail.currentFingerprint.slice(0, 12)}…</p>
    </>}
  </div>;
}

function AdminBuildVersionAuditPanel({ audit, loading, error, onRefresh, migrationPreview, migrationPreviewLoading, migrationPreviewError, onMigrationPreview, migrationApplyLoading, migrationApplyError, migrationApplyResult, onApplyMigration, rollbackLoading, rollbackError, rollbackResult, onRollbackMigration, backups, backupDetail, backupDetailLoading, backupDetailError, backupDetailId, onOpenBackupDetail, onCloseBackupDetail, onStartCategoryCrawl, categoryCrawlRunning }: AdminBuildVersionAuditPanelProps) {
  const statusLabel = audit?.status === "healthy" ? (audit.versionGapGroups.length > 0 ? "번호 누락 확인" : "무결성 정상") : audit?.status === "needs_migration" ? "legacy 정리 필요" : "무결성 확인 필요";
  const statusDescription = audit?.status === "healthy"
    ? audit.versionGapGroups.length > 0 ? "명시적 버전 메타데이터는 유효하지만 일부 그룹에 번호 간격이 있습니다. 초기 버전이 보존 정책으로 제외된 것인지 확인해 주세요." : "모든 저장 견적이 명시적인 버전 그룹과 버전 번호를 가지고 있습니다."
    : audit?.status === "needs_migration"
      ? "기존 저장 견적이 legacy fallback(v1)으로 남아 있습니다. 새로 저장되는 견적부터는 명시적 버전 메타데이터를 사용합니다."
      : "중복 버전 번호 또는 부모 견적 연결 오류가 발견되었습니다. 저장 데이터를 자동으로 고치지 않고 원인을 먼저 확인해야 합니다.";
  const seedCatalogPanel = <DeferredAdminPanel label="starter 기준값 대조"><Suspense fallback={<AdminPanelLoading label="starter 기준값 대조" />}><AdminSeedCatalogPanel /></Suspense></DeferredAdminPanel>;
  const seedMappingPanel = <DeferredAdminPanel label="starter 상품 코드 매핑 검수"><Suspense fallback={<AdminPanelLoading label="starter 상품 코드 매핑 검수" />}><AdminSeedCatalogMappingPanel onStartCategory={onStartCategoryCrawl} categoryCrawlRunning={categoryCrawlRunning} /></Suspense></DeferredAdminPanel>;

  if (!audit) {
    return <>{seedCatalogPanel}{seedMappingPanel}<section className="admin-card version-audit-card" data-testid="admin-build-version-audit"><div className="admin-card-heading"><div><p className="eyebrow">SAVED BUILD INTEGRITY</p><h3>저장 견적 버전 상태</h3></div><span className="job-status running">{loading ? "확인 중" : "확인 실패"}</span></div>{loading ? <p className="version-audit-empty"><FiLoader className="spin" /> 저장 견적 버전 메타데이터를 확인하고 있습니다.</p> : <div className="version-audit-error"><FiAlertTriangle /><span>{error ?? "저장 견적 버전 상태를 확인하지 못했습니다."}</span><button className="button button-secondary" onClick={onRefresh}><FiRefreshCw /> 다시 확인</button></div>}</section></>;
  }

  const issueCount = audit.legacyCount + audit.duplicateVersionKeys.length + audit.orphanParentIds.length + audit.crossGroupParentIds.length + audit.versionGapGroups.reduce((total, gap) => total + gap.missingVersions.length, 0);
  return <>{seedCatalogPanel}{seedMappingPanel}<section className={`admin-card version-audit-card ${audit.status}`} data-testid="admin-build-version-audit">
    <div className="admin-card-heading">
      <div><p className="eyebrow">SAVED BUILD INTEGRITY</p><h3>저장 견적 버전 상태</h3><p className="version-audit-description">{statusDescription}</p></div>
      <div className="version-audit-heading-actions"><span className={`version-audit-status ${audit.status}`}><i /> {statusLabel}</span><button className="button button-secondary version-audit-preview-button" onClick={onMigrationPreview} disabled={migrationPreviewLoading}><FiSearch className={migrationPreviewLoading ? "spin" : undefined} /> {migrationPreviewLoading ? "프리뷰 확인 중" : "마이그레이션 프리뷰"}</button><button className="icon-button" aria-label="저장 견적 버전 상태 새로고침" title="다시 확인" onClick={onRefresh} disabled={loading}><FiRefreshCw className={loading ? "spin" : undefined} /></button></div>
    </div>
    <div className="version-audit-stats">
      <div><strong>{audit.totalBuilds.toLocaleString("ko-KR")}</strong><span>전체 저장 견적</span></div>
      <div><strong>{audit.groupCount.toLocaleString("ko-KR")}</strong><span>버전 그룹</span></div>
      <div><strong>{audit.multiVersionGroupCount.toLocaleString("ko-KR")}</strong><span>복수 버전 그룹</span></div>
      <div><strong>v{audit.maxVersion}</strong><span>최대 버전</span></div>
      <div><strong>{issueCount.toLocaleString("ko-KR")}</strong><span>확인 항목</span></div>
    </div>
    <div className="version-audit-body">
      <div className="version-audit-findings">
        <div className="version-audit-subheading"><strong>검수 결과</strong><span>{audit.versionedCount}개 명시 · {audit.legacyCount}개 legacy fallback</span></div>
        {issueCount === 0 ? <p className="version-audit-clear"><FiCheckCircle /> 중복 버전과 부모 견적 연결 오류가 없습니다.</p> : <ul>
          {audit.legacyCount > 0 && <li><FiAlertTriangle /><span>명시적 버전 메타데이터가 없는 legacy 견적 <b>{audit.legacyCount}개</b></span></li>}
          {audit.duplicateVersionKeys.length > 0 && <li className="invalid"><FiXCircle /><span>중복 버전 키 <b>{audit.duplicateVersionKeys.slice(0, 3).join(", ")}</b>{audit.duplicateVersionKeys.length > 3 ? ` 외 ${audit.duplicateVersionKeys.length - 3}개` : ""}</span></li>}
          {audit.orphanParentIds.length > 0 && <li className="invalid"><FiXCircle /><span>존재하지 않는 부모 견적 참조 <b>{audit.orphanParentIds.slice(0, 3).join(", ")}</b>{audit.orphanParentIds.length > 3 ? ` 외 ${audit.orphanParentIds.length - 3}개` : ""}</span></li>}
          {audit.crossGroupParentIds.length > 0 && <li className="invalid"><FiXCircle /><span>다른 버전 그룹을 가리키는 자식 견적 <b>{audit.crossGroupParentIds.slice(0, 3).join(", ")}</b>{audit.crossGroupParentIds.length > 3 ? ` 외 ${audit.crossGroupParentIds.length - 3}개` : ""}</span></li>}
          {audit.versionGapGroups.length > 0 && <li className="gap"><FiInfo /><span>버전 번호가 비어 있는 그룹 <b>{audit.versionGapGroups.slice(0, 3).map((gap) => `${gap.versionGroupId}: v${gap.missingVersions.join(", v")}`).join(" · ")}</b>{audit.versionGapGroups.length > 3 ? ` 외 ${audit.versionGapGroups.length - 3}개` : ""}</span></li>}
        </ul>}
        <p className="version-audit-note"><FiInfo /> 이 화면은 읽기 전용 진단입니다. 마이그레이션이나 삭제는 수행하지 않습니다.</p>
      </div>
      <div className="version-audit-groups"><div className="version-audit-subheading"><strong>최근 버전 그룹</strong><span>{audit.groups.length}개 그룹</span></div>{audit.groups.length === 0 ? <p className="version-audit-empty">저장된 견적이 없습니다.</p> : <div className="version-audit-group-list">{audit.groups.slice(0, 5).map((group) => <div className="version-audit-group" key={group.versionGroupId}><div><strong>{group.buildCount > 1 ? `v${group.minVersion} → v${group.maxVersion}` : `v${group.maxVersion}`}</strong><span>{group.buildCount}개 · 최신 {new Date(group.latestUpdatedAt).toLocaleString("ko-KR")}</span></div><code title={group.versionGroupId}>{group.versionGroupId.slice(0, 14)}</code></div>)}</div>}</div>
    </div>
    {(migrationPreviewLoading || migrationPreviewError || migrationPreview) && <div className="version-migration-preview" data-testid="admin-build-version-migration-preview">
      <div className="version-audit-subheading"><strong>마이그레이션 프리뷰</strong><span>실제 저장 변경 없음</span></div>
      {migrationPreviewLoading ? <p className="version-audit-empty"><FiLoader className="spin" /> legacy 견적의 예상 버전 메타데이터를 계산하고 있습니다.</p> : migrationPreviewError ? <div className="version-audit-error"><FiAlertTriangle /><span>{migrationPreviewError}</span><button className="button button-secondary" onClick={onMigrationPreview}><FiSearch /> 다시 계산</button></div> : migrationPreview && <>
        <div className={`version-migration-summary ${migrationPreview.status}`}><span><b>{migrationPreview.changedCount}개</b> legacy 대상</span><span><b>{migrationPreview.items.length - migrationPreview.changedCount}개</b> 메타데이터 유지</span><strong>{migrationPreview.status === "ready" ? "적용 가능" : "수정 후 재검토"}</strong></div>
        {migrationPreview.blockers.length > 0 && <ul className="version-migration-blockers">{migrationPreview.blockers.slice(0, 4).map((blocker) => <li key={blocker}><FiXCircle /> {blocker}</li>)}</ul>}
        {migrationPreview.items.length > 0 && <div className="version-migration-list">{migrationPreview.items.slice(0, 8).map((item) => <div className="version-migration-row" key={item.buildId}><div><strong>{item.name}</strong><span>{item.kind === "legacy" ? "legacy fallback" : `현재 ${item.current.versionGroupId?.slice(0, 12) ?? "-"} · v${item.current.versionNumber ?? 1}`}</span></div><code>{item.proposed.versionGroupId.slice(0, 12)} · v{item.proposed.versionNumber}</code></div>)}</div>}
        {migrationPreview.items.length > 8 && <p className="version-migration-more">{migrationPreview.items.length - 8}개 항목은 요약에서 생략했습니다.</p>}
        {migrationPreview.status === "ready" && migrationPreview.changedCount > 0 && <div className="version-migration-actions"><button className="button button-primary" onClick={onApplyMigration} disabled={migrationApplyLoading || !migrationPreview.snapshotFingerprint}><FiEdit3 className={migrationApplyLoading ? "spin" : undefined} /> {migrationApplyLoading ? "적용 중..." : "프리뷰 결과 적용"}</button><span>최신 프리뷰 fingerprint와 관리자 확인 문구가 필요합니다.</span></div>}
      </>}
      <p className="version-audit-note"><FiInfo /> 이 프리뷰는 예상값만 계산합니다. 실제 마이그레이션·삭제·덮어쓰기는 실행하지 않습니다.</p>
    </div>}
    {!migrationApplyResult && backups.length > 0 && !rollbackResult && <div className="version-migration-history" data-testid="admin-build-version-backup-history"><div className="version-audit-subheading"><strong>최근 backup 이력</strong><span>{backups.length}개 보관</span></div><div className="version-migration-history-list">{backups.map((backup, index) => <div className="version-migration-history-row" key={backup.backupId}><div><strong>#{index + 1} · {backup.changedCount}개 변경</strong><span>{new Date(backup.createdAt).toLocaleString("ko-KR")} · {backup.resultingFingerprint.slice(0, 12)}</span></div><span className={backup.rollbackAvailable ? "version-migration-availability available" : "version-migration-availability unavailable"}>{backup.rollbackAvailable ? "rollback 가능" : "현재 변경됨"}</span><button className="button button-light version-migration-detail-button" onClick={() => onOpenBackupDetail(backup.backupId)} disabled={backupDetailLoading && backupDetailId === backup.backupId}>{backupDetailLoading && backupDetailId === backup.backupId ? <FiLoader className="spin" /> : <FiSearch />} {backupDetailLoading && backupDetailId === backup.backupId ? "불러오는 중..." : "상세 diff"}</button>{backup.rollbackAvailable && <button className="button button-light" onClick={() => onRollbackMigration(backup)} disabled={rollbackLoading}><FiRefreshCw className={rollbackLoading ? "spin" : undefined} /> {rollbackLoading ? "복구 중..." : "되돌리기"}</button>}</div>)}</div><p className="version-audit-note"><FiInfo /> 현재 fingerprint가 적용 후 값과 일치하는 backup만 rollback할 수 있습니다.</p></div>}
    <AdminBuildVersionBackupDetailPanel detail={backupDetail} loading={backupDetailLoading} error={backupDetailError} onClose={onCloseBackupDetail} />
    {migrationApplyError && <p className="version-migration-operation-error"><FiAlertTriangle /> {migrationApplyError}</p>}
    {migrationApplyResult && <div className="version-migration-operation success" data-testid="admin-build-version-migration-result"><div><FiCheckCircle /><span>{migrationApplyResult.status === "applied" ? <><strong>{migrationApplyResult.changedCount}개</strong> legacy 메타데이터를 적용했고 backup을 생성했습니다.</> : "이미 모든 저장 견적이 명시적 버전 메타데이터를 사용하고 있습니다."}</span></div>{migrationApplyResult.backupId && <button className="button button-light" onClick={() => onRollbackMigration()} disabled={rollbackLoading}><FiRefreshCw className={rollbackLoading ? "spin" : undefined} /> {rollbackLoading ? "복구 중..." : "마지막 적용 되돌리기"}</button>}</div>}
    {rollbackError && <p className="version-migration-operation-error"><FiAlertTriangle /> {rollbackError}</p>}
    {rollbackResult && <div className="version-migration-operation rollback" data-testid="admin-build-version-rollback-result"><div><FiCheckCircle /><span>마지막 버전 메타데이터 적용을 되돌렸습니다. legacy 상태를 복원했습니다.</span></div></div>}
  </section></>;
}

export function AdminView({ meta, onMetaRefresh, onToast }: { meta: ServiceMeta | null; onMetaRefresh: () => void; onToast: (message: string) => void }) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<CrawlStatus | null>(meta?.crawler ?? null);
  const [accessoryRunning, setAccessoryRunning] = useState(false);
  const [accessoryStatus, setAccessoryStatus] = useState<AccessoryCrawlStatus | null>(null);
  const [accessoryCategory, setAccessoryCategory] = useState<AccessoryCategory | "all">("all");
  const [accessoryOffset, setAccessoryOffset] = useState("0");
  const [accessoryBatchSize, setAccessoryBatchSize] = useState("30");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const mountedRef = useRef(false);
  const sessionMutationRef = useRef(0);
  const authRequiredRef = useRef(false);
  const crawlStatusPollRequestRef = useRef(0);
  const accessoryStatusPollRequestRef = useRef(0);
  const crawlMutationRequestRef = useRef(0);
  const accessoryCrawlMutationRequestRef = useRef(0);
  const [catalogChanges, setCatalogChanges] = useState<CatalogChangeRecord[]>([]);
  const [catalogChangesLoading, setCatalogChangesLoading] = useState(true);
  const [catalogChangesError, setCatalogChangesError] = useState<string | null>(null);
  const [catalogChangesRefreshKey, setCatalogChangesRefreshKey] = useState(0);
  const [catalogChangesLimit, setCatalogChangesLimit] = useState(24);
  const [catalogChangesFrom, setCatalogChangesFrom] = useState("");
  const [catalogChangesTo, setCatalogChangesTo] = useState("");
  const [catalogChangesCategory, setCatalogChangesCategory] = useState<CatalogChangeCategoryFilter>("all");
  const [versionAudit, setVersionAudit] = useState<SavedBuildVersionAudit | null>(null);
  const [versionAuditLoading, setVersionAuditLoading] = useState(false);
  const [versionAuditError, setVersionAuditError] = useState<string | null>(null);
  const [versionAuditRefreshKey, setVersionAuditRefreshKey] = useState(0);
  const [migrationPreview, setMigrationPreview] = useState<SavedBuildVersionMigrationPreview | null>(null);
  const [migrationPreviewLoading, setMigrationPreviewLoading] = useState(false);
  const [migrationPreviewError, setMigrationPreviewError] = useState<string | null>(null);
  const [migrationApplyLoading, setMigrationApplyLoading] = useState(false);
  const [migrationApplyError, setMigrationApplyError] = useState<string | null>(null);
  const [migrationApplyResult, setMigrationApplyResult] = useState<SavedBuildVersionMigrationMutationResult | null>(null);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [rollbackResult, setRollbackResult] = useState<SavedBuildVersionMigrationRollbackResult | null>(null);
  const migrationPreviewRequestRef = useRef(0);
  const migrationMutationRequestRef = useRef(0);
  const [backups, setBackups] = useState<SavedBuildVersionBackupSummary[]>([]);
  const [backupDetail, setBackupDetail] = useState<SavedBuildVersionBackupDetail | null>(null);
  const [backupDetailLoading, setBackupDetailLoading] = useState(false);
  const [backupDetailError, setBackupDetailError] = useState<string | null>(null);
  const [backupDetailId, setBackupDetailId] = useState<string | null>(null);
  const backupDetailRequestRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionMutationRef.current += 1;
    };
  }, []);
  useEffect(() => { setStatus(meta?.crawler ?? null); }, [meta]);
  useEffect(() => {
    const requestVersion = sessionMutationRef.current;
    let cancelled = false;
    void api<AdminSession>("/api/admin/session")
      .then((value) => {
        if (!cancelled && requestVersion === sessionMutationRef.current && !authRequiredRef.current) setSession(value);
      })
      .catch(() => {
        if (!cancelled && requestVersion === sessionMutationRef.current && !authRequiredRef.current) setSession({ enabled: false, authenticated: true });
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!session || (session.enabled && !session.authenticated)) return;
    const requestVersion = ++crawlStatusPollRequestRef.current;
    let cancelled = false;
    void api<CrawlStatus>("/api/admin/crawl/status")
      .then((next) => {
        if (cancelled || crawlStatusPollRequestRef.current !== requestVersion) return;
        setStatus(next);
        setRunning(next.status === "running");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (crawlStatusPollRequestRef.current === requestVersion) crawlStatusPollRequestRef.current += 1;
    };
  }, [meta, session]);
  useEffect(() => {
    const handleCatalogMetaRefresh = () => {
      if (authRequiredRef.current) return;
      onMetaRefresh();
    };
    const handleCatalogCrawlStarted = () => {
      if (authRequiredRef.current) return;
      crawlStatusPollRequestRef.current += 1;
      setRunning(true);
    };
    window.addEventListener("pc-supporter:catalog-meta-refresh", handleCatalogMetaRefresh);
    window.addEventListener("pc-supporter:catalog-crawl-started", handleCatalogCrawlStarted);
    return () => {
      window.removeEventListener("pc-supporter:catalog-meta-refresh", handleCatalogMetaRefresh);
      window.removeEventListener("pc-supporter:catalog-crawl-started", handleCatalogCrawlStarted);
    };
  }, [onMetaRefresh]);
  useEffect(() => {
    const handleAdminToast = (event: Event) => {
      if (authRequiredRef.current) return;
      const message = (event as CustomEvent<unknown>).detail;
      if (typeof message === "string" && message.length > 0) onToast(message);
    };
    window.addEventListener("pc-supporter:admin-toast", handleAdminToast);
    return () => window.removeEventListener("pc-supporter:admin-toast", handleAdminToast);
  }, [onToast]);
  useEffect(() => {
    const resetAdminSession = (nextSession: AdminSession, message: string) => {
      setRunning(false);
      setAccessoryRunning(false);
      sessionMutationRef.current += 1;
      crawlStatusPollRequestRef.current += 1;
      accessoryStatusPollRequestRef.current += 1;
      crawlMutationRequestRef.current += 1;
      accessoryCrawlMutationRequestRef.current += 1;
      migrationPreviewRequestRef.current += 1;
      migrationMutationRequestRef.current += 1;
      backupDetailRequestRef.current += 1;
      setMigrationPreview(null);
      setMigrationPreviewError(null);
      setMigrationApplyLoading(false);
      setMigrationApplyError(null);
      setMigrationApplyResult(null);
      setRollbackLoading(false);
      setRollbackError(null);
      setRollbackResult(null);
      setBackupDetailId(null);
      setBackupDetail(null);
      setBackupDetailError(null);
      setBackupDetailLoading(false);
      setLoginLoading(false);
      authRequiredRef.current = true;
      setSession(nextSession);
      onToast(message);
    };
    const handleAdminAuthRequired = () => {
      // A protected 401 is authoritative even if the initial session snapshot
      // was stale (for example after an operator changes the server config).
      resetAdminSession({ enabled: true, authenticated: false }, "관리자 세션이 만료되었습니다. 다시 로그인해 주세요.");
    };
    const handleAdminAuthMisconfigured = (event: Event) => {
      const security = (event as CustomEvent<{ security?: AdminSession["security"] }>).detail?.security;
      resetAdminSession({ enabled: true, authenticated: false, ...(security ? { security } : {}) }, "운영 관리자 인증 설정이 필요합니다. ADMIN_PASSWORD와 ADMIN_SESSION_SECRET을 확인해 주세요.");
    };
    window.addEventListener("pc-supporter:admin-auth-required", handleAdminAuthRequired);
    window.addEventListener("pc-supporter:admin-auth-misconfigured", handleAdminAuthMisconfigured);
    return () => {
      window.removeEventListener("pc-supporter:admin-auth-required", handleAdminAuthRequired);
      window.removeEventListener("pc-supporter:admin-auth-misconfigured", handleAdminAuthMisconfigured);
    };
  }, [onToast]);
  useEffect(() => {
    if (!session || (session.enabled && !session.authenticated)) return;
    const requestVersion = ++accessoryStatusPollRequestRef.current;
    let cancelled = false;
    void api<AccessoryCrawlStatus>("/api/admin/accessories/crawl/status")
      .then((value) => { if (!cancelled && accessoryStatusPollRequestRef.current === requestVersion) setAccessoryStatus(value); })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (accessoryStatusPollRequestRef.current === requestVersion) accessoryStatusPollRequestRef.current += 1;
    };
  }, [session]);
  useEffect(() => {
    if (!session || (session.enabled && !session.authenticated)) return;
    let cancelled = false;
    setVersionAuditLoading(true);
    setVersionAuditError(null);
    void api<SavedBuildVersionAudit>("/api/admin/build-versions/status")
      .then((value) => { if (!cancelled) setVersionAudit(value); })
      .catch((error: unknown) => { if (!cancelled) setVersionAuditError(error instanceof Error ? error.message : "저장 견적 버전 상태를 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setVersionAuditLoading(false); });
    return () => { cancelled = true; };
  }, [session, versionAuditRefreshKey]);
  useEffect(() => {
    migrationPreviewRequestRef.current += 1;
    setMigrationPreview(null);
    setMigrationPreviewError(null);
  }, [versionAuditRefreshKey]);
  useEffect(() => {
    if (!session || (session.enabled && !session.authenticated)) return;
    let cancelled = false;
    void api<{ items: SavedBuildVersionBackupSummary[] }>("/api/admin/build-versions/backups")
      .then((value) => { if (!cancelled) setBackups(value.items); })
      .catch(() => { if (!cancelled) setBackups([]); });
    return () => { cancelled = true; };
  }, [session, versionAuditRefreshKey]);
  async function loadMigrationPreview() {
    const requestVersion = ++migrationPreviewRequestRef.current;
    setMigrationPreviewLoading(true);
    setMigrationPreviewError(null);
    try {
      const preview = await api<SavedBuildVersionMigrationPreview>("/api/admin/build-versions/migration-preview");
      if (migrationPreviewRequestRef.current === requestVersion) setMigrationPreview(preview);
    } catch (error: unknown) {
      if (migrationPreviewRequestRef.current === requestVersion) setMigrationPreviewError(error instanceof Error ? error.message : "마이그레이션 프리뷰를 계산하지 못했습니다.");
    } finally {
      if (migrationPreviewRequestRef.current === requestVersion) setMigrationPreviewLoading(false);
    }
  }
  async function loadBackupDetail(backupId: string) {
    const requestId = backupDetailRequestRef.current + 1;
    backupDetailRequestRef.current = requestId;
    const sessionVersion = sessionMutationRef.current;
    const isCurrent = () => mountedRef.current && backupDetailRequestRef.current === requestId && sessionMutationRef.current === sessionVersion && !authRequiredRef.current;
    setBackupDetailId(backupId);
    setBackupDetailLoading(true);
    setBackupDetailError(null);
    try {
      const detail = await api<SavedBuildVersionBackupDetail>(`/api/admin/build-versions/backups/${encodeURIComponent(backupId)}`);
      if (isCurrent()) setBackupDetail(detail);
    } catch (error: unknown) {
      if (isCurrent()) setBackupDetailError(error instanceof Error ? error.message : "backup 상세 diff를 불러오지 못했습니다.");
    } finally {
      if (isCurrent()) setBackupDetailLoading(false);
    }
  }
  function closeBackupDetail() {
    backupDetailRequestRef.current += 1;
    setBackupDetailId(null);
    setBackupDetail(null);
    setBackupDetailError(null);
    setBackupDetailLoading(false);
  }
  async function applyMigration() {
    const expectedFingerprint = migrationPreview?.snapshotFingerprint;
    if (!migrationPreview || migrationPreview.status !== "ready" || migrationPreview.changedCount === 0 || !expectedFingerprint) {
      onToast("최신 마이그레이션 프리뷰를 먼저 계산해 주세요.");
      return;
    }
    if (!window.confirm(`legacy 저장 견적 ${migrationPreview.changedCount}개에 버전 메타데이터를 적용할까요? 원본 백업을 만든 뒤 진행합니다.`)) return;
    const requestVersion = ++migrationMutationRequestRef.current;
    const isCurrent = () => migrationMutationRequestRef.current === requestVersion;
    setMigrationApplyLoading(true);
    setMigrationApplyError(null);
    setRollbackError(null);
    setRollbackResult(null);
    try {
      const result = await api<SavedBuildVersionMigrationMutationResult>("/api/admin/build-versions/migrate", { method: "POST", body: JSON.stringify({ expectedFingerprint, confirmation: SAVED_BUILD_VERSION_MIGRATION_CONFIRMATION }) });
      if (!isCurrent()) return;
      setMigrationApplyResult(result);
      setMigrationPreview(null);
      closeBackupDetail();
      setVersionAuditRefreshKey((current) => current + 1);
      onMetaRefresh();
      onToast(result.status === "applied" ? "저장 견적 버전 메타데이터를 적용했습니다." : "이미 버전 메타데이터가 최신 상태입니다.");
    } catch (error: unknown) {
      if (isCurrent()) setMigrationApplyError(error instanceof Error ? error.message : "마이그레이션을 적용하지 못했습니다. 최신 프리뷰를 다시 계산해 주세요.");
    } finally {
      if (isCurrent()) setMigrationApplyLoading(false);
    }
  }
  async function rollbackMigration(backup?: SavedBuildVersionBackupSummary) {
    const rollbackTarget = migrationApplyResult?.backupId ? migrationApplyResult : backup?.rollbackAvailable ? backup : backups.find((candidate) => candidate.rollbackAvailable);
    if (!rollbackTarget) {
      onToast("현재 데이터가 바뀌었거나 복구할 수 있는 backup이 없습니다.");
      return;
    }
    if (!window.confirm("마지막 버전 메타데이터 적용을 되돌릴까요? 적용 후 저장 견적이 바뀌었다면 rollback이 차단됩니다.")) return;
    const requestVersion = ++migrationMutationRequestRef.current;
    const isCurrent = () => migrationMutationRequestRef.current === requestVersion;
    setRollbackLoading(true);
    setRollbackError(null);
    try {
      const result = await api<SavedBuildVersionMigrationRollbackResult>("/api/admin/build-versions/rollback", { method: "POST", body: JSON.stringify({ backupId: rollbackTarget.backupId, expectedFingerprint: rollbackTarget.resultingFingerprint, confirmation: SAVED_BUILD_VERSION_ROLLBACK_CONFIRMATION }) });
      if (!isCurrent()) return;
      setRollbackResult(result);
      setMigrationApplyResult(null);
      setBackups([]);
      closeBackupDetail();
      setVersionAuditRefreshKey((current) => current + 1);
      onMetaRefresh();
      onToast("마지막 버전 메타데이터 적용을 되돌렸습니다.");
    } catch (error: unknown) {
      if (isCurrent()) setRollbackError(error instanceof Error ? error.message : "rollback을 실행하지 못했습니다.");
    } finally {
      if (isCurrent()) setRollbackLoading(false);
    }
  }
  useEffect(() => {
    if (!session || (session.enabled && !session.authenticated) || (!running && status?.status !== "running")) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      const requestVersion = ++crawlStatusPollRequestRef.current;
      void api<CrawlStatus>("/api/admin/crawl/status").then((next) => {
        if (cancelled || crawlStatusPollRequestRef.current !== requestVersion) return;
        setStatus(next);
        if (next.status !== "running") {
          setRunning(false);
          onMetaRefresh();
          setCatalogChangesRefreshKey((current) => current + 1);
          window.dispatchEvent(new CustomEvent("pc-supporter:catalog-crawl-completed", { detail: next }));
        }
      }).catch(() => undefined);
    }, 1600);
    return () => {
      cancelled = true;
      crawlStatusPollRequestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [running, onMetaRefresh, session, status?.status]);
  useEffect(() => {
    if (!session || (session.enabled && !session.authenticated) || !accessoryRunning) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      const requestVersion = ++accessoryStatusPollRequestRef.current;
      void api<AccessoryCrawlStatus>("/api/admin/accessories/crawl/status").then((next) => {
        if (cancelled || accessoryStatusPollRequestRef.current !== requestVersion) return;
        setAccessoryStatus(next);
        if (next.status !== "running") {
          setAccessoryRunning(false);
          onMetaRefresh();
          setCatalogChangesRefreshKey((current) => current + 1);
        }
      }).catch(() => undefined);
    }, 1600);
    return () => {
      cancelled = true;
      accessoryStatusPollRequestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [accessoryRunning, onMetaRefresh, session]);
  useEffect(() => {
    if (!session || (session.enabled && !session.authenticated)) {
      setCatalogChangesLoading(false);
      return;
    }
    let cancelled = false;
    setCatalogChangesLoading(true);
    setCatalogChangesError(null);
    const query = new URLSearchParams({ limit: String(catalogChangesLimit) });
    if (catalogChangesFrom) query.set("from", `${catalogChangesFrom}T00:00:00+09:00`);
    if (catalogChangesTo) query.set("to", `${catalogChangesTo}T23:59:59.999+09:00`);
    if (catalogChangesCategory !== "all") query.set("category", catalogChangesCategory);
    void api<{ items: CatalogChangeRecord[] }>(`/api/admin/catalog-changes?${query.toString()}`)
      .then((payload) => { if (!cancelled) { setCatalogChanges(payload.items); setCatalogChangesError(null); } })
      .catch((error: unknown) => { if (!cancelled) setCatalogChangesError(error instanceof Error ? error.message : "카탈로그 변경 이력을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setCatalogChangesLoading(false); });
    return () => { cancelled = true; };
  }, [catalogChangesCategory, catalogChangesFrom, catalogChangesLimit, catalogChangesRefreshKey, catalogChangesTo, session]);
  async function startCrawl(all = false, category?: PartCategory) {
    if (category) {
      const confirmation = all
        ? `${CATEGORY_LABELS[category]} 전체 상품과 상세 스펙을 끝까지 수집할까요? 선택한 다나와 범주만 교체하고 seed·수동 검수 데이터는 보존합니다. 상품 수에 따라 오래 걸릴 수 있습니다.`
        : `${CATEGORY_LABELS[category]} live 상품을 빠르게 수집할까요? 기존 다나와 카탈로그가 갱신되고, 완료되면 매핑 후보와 원문 수집 큐가 자동으로 다시 계산됩니다.`;
      if (!window.confirm(confirmation)) return;
    }
    const requestVersion = ++crawlMutationRequestRef.current;
    const isCurrent = () => crawlMutationRequestRef.current === requestVersion && !authRequiredRef.current;
    setRunning(true);
    try {
      await api("/api/admin/crawl", { method: "POST", body: JSON.stringify({ pages: 1, limitPerCategory: all ? 0 : 16, details: true, all, ...(category ? { category } : {}) }) });
      if (!isCurrent()) return;
      window.dispatchEvent(new CustomEvent("pc-supporter:catalog-crawl-started"));
      onToast(category ? `${CATEGORY_LABELS[category]} 범주 ${all ? "전체" : "빠른"} 수집을 시작했습니다.` : all ? "다나와 전체 부품 수집을 시작했습니다." : "다나와 빠른 카탈로그 갱신을 시작했습니다.");
    } catch (error: unknown) {
      if (!isCurrent()) return;
      setRunning(false);
      if (error instanceof Error && error.message.includes("관리자")) setSession({ enabled: true, authenticated: false });
      if (!(error instanceof ApiError && error.status === 401)) onToast(error instanceof Error ? error.message : "크롤링을 시작하지 못했습니다.");
    }
  }
  async function startAccessoryCrawl(options: { all?: boolean; details?: boolean; onlyIncomplete?: boolean; offset?: number; limit?: number; category?: AccessoryCategory | "all" } = {}) {
    const all = options.all ?? false;
    const details = options.details ?? true;
    const onlyIncomplete = options.onlyIncomplete ?? false;
    const offset = options.offset ?? Number(accessoryOffset);
    const limit = options.limit ?? Number(accessoryBatchSize);
    const targetCategory = options.category ?? accessoryCategory;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      onToast("배치 시작 위치와 수집 수를 확인해 주세요.");
      return;
    }
    const requestVersion = ++accessoryCrawlMutationRequestRef.current;
    const isCurrent = () => accessoryCrawlMutationRequestRef.current === requestVersion && !authRequiredRef.current;
    setAccessoryRunning(true);
    try {
      await api("/api/admin/accessories/crawl", { method: "POST", body: JSON.stringify({ category: targetCategory, limitPerCategory: limit, offset: all || onlyIncomplete ? 0 : offset, onlyIncomplete, details, all, delayMs: 850 }) });
      if (!isCurrent()) return;
      const targetLabel = targetCategory === "all" ? "전체 주변 부품" : ACCESSORY_CATEGORY_LABELS[targetCategory]; onToast(all ? "주변 부품 목록 전체 동기화를 시작했습니다." : onlyIncomplete ? targetLabel + " 미확인 다음 배치를 시작했습니다." : targetLabel + " " + offset.toLocaleString("ko-KR") + "번부터 상세 보강을 시작했습니다.");
    } catch (error: unknown) {
      if (!isCurrent()) return;
      setAccessoryRunning(false);
      if (error instanceof Error && error.message.includes("관리자")) setSession({ enabled: true, authenticated: false });
      if (!(error instanceof ApiError && error.status === 401)) onToast(error instanceof Error ? error.message : "주변 부품 크롤링을 시작하지 못했습니다.");
    }
  }
  async function startNextAccessoryBatch() {
    const nextOffset = Number(accessoryOffset) + Number(accessoryBatchSize);
    setAccessoryOffset(String(nextOffset));
    await startAccessoryCrawl({ offset: nextOffset });
  }
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginLoading) return;
    const requestVersion = ++sessionMutationRef.current;
    const isCurrent = () => mountedRef.current && sessionMutationRef.current === requestVersion;
    setLoginLoading(true);
    try {
      const nextSession = await api<AdminSession>("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
      if (!isCurrent()) return;
      authRequiredRef.current = false;
      setSession(nextSession);
      setPassword("");
      setCatalogChangesRefreshKey((current) => current + 1);
      onToast("관리자 인증이 완료되었습니다.");
      onMetaRefresh();
    } catch (error: unknown) {
      if (isCurrent()) onToast(error instanceof Error ? error.message : "관리자 로그인에 실패했습니다.");
    } finally {
      if (isCurrent()) setLoginLoading(false);
    }
  }
  async function logout() {
    if (loginLoading) return;
    const requestVersion = ++sessionMutationRef.current;
    const isCurrent = () => mountedRef.current && sessionMutationRef.current === requestVersion;
    setLoginLoading(true);
    try {
      const nextSession = await api<AdminSession>("/api/admin/logout", { method: "POST" });
      if (!isCurrent()) return;
      setRunning(false);
      setAccessoryRunning(false);
      crawlStatusPollRequestRef.current += 1;
      accessoryStatusPollRequestRef.current += 1;
      crawlMutationRequestRef.current += 1;
      accessoryCrawlMutationRequestRef.current += 1;
      migrationPreviewRequestRef.current += 1;
      migrationMutationRequestRef.current += 1;
      setMigrationPreview(null);
      setMigrationPreviewError(null);
      setMigrationApplyLoading(false);
      setMigrationApplyError(null);
      setMigrationApplyResult(null);
      setRollbackLoading(false);
      setRollbackError(null);
      setRollbackResult(null);
      authRequiredRef.current = true;
      setSession(nextSession);
      setStatus(null);
      setAccessoryStatus(null);
      setPassword("");
      setVersionAudit(null);
      setVersionAuditError(null);
      setMigrationPreview(null);
      setMigrationPreviewError(null);
      setMigrationApplyError(null);
      setMigrationApplyResult(null);
      setRollbackError(null);
      setRollbackResult(null);
      setBackups([]);
      closeBackupDetail();
      setCatalogChanges([]);
      setCatalogChangesError(null);
      onToast("관리자 세션을 종료했습니다.");
    } catch (error: unknown) {
      if (isCurrent()) onToast(error instanceof Error ? error.message : "관리자 로그아웃에 실패했습니다.");
    } finally {
      if (isCurrent()) setLoginLoading(false);
    }
  }
  if (session?.enabled && !session.authenticated) return <div className="admin-page"><div className="workspace-heading"><div><button className="back-link" onClick={() => window.history.back()}><FiArrowLeft /> 이전으로</button><p className="eyebrow">CATALOG CONTROL CENTER</p><h1>관리자 인증</h1><p>다나와 수집과 카탈로그 변경은 관리자만 실행할 수 있습니다.</p></div><span className="admin-badge"><FiShield /> 보호됨</span></div>{session.security?.environment === "production" && !session.security.productionReady && <AdminSecurityNotice security={session.security} />}<section className="auth-card"><span className="auth-icon"><FiShield /></span><div><p className="eyebrow">ADMIN ACCESS</p><h2>데이터 센터에 로그인</h2><p>관리자 비밀번호는 브라우저에 저장되지 않습니다.</p></div><form onSubmit={login}><label htmlFor="admin-password">관리자 비밀번호</label><input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="비밀번호 입력" required /><button className="button button-primary full-width" type="submit" disabled={loginLoading}>{loginLoading ? <><FiLoader className="spin" /> 인증 중...</> : <><FiShield /> 로그인</>}</button></form><p className="auth-hint"><FiInfo /> 로컬 프로젝트에서는 `ADMIN_PASSWORD` 환경변수로 설정합니다.</p></section></div>;
  const currentStatus = status ?? { status: "idle" as const, mode: "sample" as const, categoriesCompleted: 0, categoriesTotal: 9, pagesVisited: 0, pagesExpected: 0, listedProducts: 0, productsSeen: 0, productsUpdated: 0, detailFetched: 0, detailFailed: 0, failedProducts: 0, missingProducts: 0, incompleteSpecs: 0, coverage: "partial" as const, specCoverage: "partial" as const };
 const currentAccessoryStatus: AccessoryCrawlStatus = accessoryStatus ?? { status: "idle", mode: "sample", details: true, onlyIncomplete: false, category: undefined, categoriesCompleted: 0, categoriesTotal: 10, pagesVisited: 0, pagesExpected: 0, listedProducts: 0, productsSeen: 0, expectedProducts: 0, productsUpdated: 0, detailFetched: 0, detailFailed: 0, missingProducts: 0, incompleteSpecs: 0, coverage: "partial", specCoverage: "partial" };
  return <div className="admin-page">
    <div className="workspace-heading"><div><button className="back-link" onClick={() => window.history.back()}><FiArrowLeft /> 이전으로</button><p className="eyebrow">CATALOG CONTROL CENTER</p><h1>부품 데이터 센터</h1><p>다나와 수집·정규화·근거 검수와 호환성 데이터 coverage를 관리합니다.</p></div><div className="admin-heading-actions"><span className="admin-badge"><FiShield /> {meta?.adminAuthEnabled ? "인증 보호됨" : "개발용 관리자"}</span>{session?.enabled && session.authenticated && <button className="text-button admin-logout-button" type="button" onClick={() => void logout()} disabled={loginLoading}><FiLogOut /> {loginLoading ? "종료 중..." : "로그아웃"}</button>}</div></div>
    <section className="admin-hero"><div className="admin-hero-icon"><FiDatabase /></div><div><p className="eyebrow">DANAWA INGESTION</p><h2>카탈로그 자동 갱신</h2><p>카테고리 목록과 상세 스펙을 수집하고, 누락 필드·출처·coverage를 분리해 추적합니다.</p></div><div className="crawl-actions"><button className="button button-secondary" onClick={() => void startCrawl(false)} disabled={running || currentStatus.status === "running"}>{running || currentStatus.status === "running" ? <><FiLoader className="spin" /> 갱신 중...</> : <><FiRefreshCw /> 빠른 갱신</>}</button><button className="button button-primary" onClick={() => void startCrawl(true)} disabled={running || currentStatus.status === "running"}><FiDatabase /> 전체 부품 수집</button></div></section>
    <AdminSecurityNotice security={session?.security} />
    {meta?.persistence?.fallbackReason === "database_unavailable" && <div className="persistence-warning" role="alert"><FiAlertTriangle /><div><strong>PostgreSQL 연결 실패</strong><p>현재 저장소는 JSON fallback입니다. 데이터가 DB에 저장된다고 가정하기 전에 연결 상태를 확인해 주세요.</p></div></div>}
    <AdminCrawlResumeControl /><AdminCrawlProgressDetail />
    <AdminBuildVersionAuditPanel audit={versionAudit} loading={versionAuditLoading} error={versionAuditError} onRefresh={() => setVersionAuditRefreshKey((current) => current + 1)} migrationPreview={migrationPreview} migrationPreviewLoading={migrationPreviewLoading} migrationPreviewError={migrationPreviewError} onMigrationPreview={() => void loadMigrationPreview()} migrationApplyLoading={migrationApplyLoading} migrationApplyError={migrationApplyError} migrationApplyResult={migrationApplyResult} onApplyMigration={() => void applyMigration()} rollbackLoading={rollbackLoading} rollbackError={rollbackError} rollbackResult={rollbackResult} onRollbackMigration={(backup) => void rollbackMigration(backup)} backups={backups} backupDetail={backupDetail} backupDetailLoading={backupDetailLoading} backupDetailError={backupDetailError} backupDetailId={backupDetailId} onOpenBackupDetail={(backupId) => void loadBackupDetail(backupId)} onCloseBackupDetail={closeBackupDetail} onStartCategoryCrawl={(category) => { void startCrawl(false, category); }} categoryCrawlRunning={running || currentStatus.status === "running"} />
    <CatalogSpecCoveragePanel coverage={meta?.catalogSpecCoverage} benchmarkCoverage={meta?.benchmarkCoverage} accessoryCoverage={meta?.accessoryCoverage} onStartCategoryCrawl={(category) => { void startCrawl(false, category); }} onStartCategoryCrawlAll={(category) => { void startCrawl(true, category); }} categoryCrawlRunning={running || currentStatus.status === "running"} onStartAccessoryCrawl={(category) => { void startAccessoryCrawl({ category, offset: 0, limit: 30 }); }} accessoryCrawlRunning={accessoryRunning || currentAccessoryStatus.status === "running"} onOpenBenchmarkReview={() => focusAdminPanel("admin-benchmark-review")} />
    <div className="admin-grid"><section className="admin-card"><div className="admin-card-heading"><div><p className="eyebrow">CATALOG SNAPSHOT</p><h3>현재 데이터</h3></div><FiActivity /></div><div className="admin-stats"><div><strong>{meta?.catalogCount ?? 0}</strong><span>전체 부품</span></div><div><strong>{meta?.catalogEligibleCount ?? meta?.catalogCount ?? 0}</strong><span>핵심 후보</span></div><div><strong>{meta?.engineVersion ?? "-"}</strong><span>검사 엔진</span></div><div><strong>{meta?.catalogCount ? Math.round((meta.priceCoverage.priced / meta.catalogCount) * 100) : 0}%</strong><span>가격 포함률</span></div></div><div className="data-health"><span><i className="health-dot live" /> live {meta?.qualityCounts.live ?? 0}</span><span><i className="health-dot incomplete" /> 확인 필요 {meta?.qualityCounts.incomplete ?? 0}</span><span><i className="health-dot seed" /> seed {meta?.qualityCounts.seed ?? 0}</span><span><i className="health-dot accessory" /> 주변 부품 {meta?.accessoryCount ?? 0}</span></div><div className="category-counts">{PART_CATEGORIES.map((category) => <div key={category}><span>{CATEGORY_LABELS[category]}</span><strong>{meta?.categoryCounts[category] ?? 0}</strong></div>)}</div><p className="admin-updated"><FiClock /> 마지막 카탈로그 수정 {meta ? new Date(meta.catalogUpdatedAt).toLocaleString("ko-KR") : "확인 중"}</p></section><section className="admin-card"><div className="admin-card-heading"><div><p className="eyebrow">CRAWL JOB</p><h3>수집 작업 상태</h3></div><span className={`job-status ${currentStatus.status} ${currentStatus.coverage}`}>{currentStatus.status === "running" ? "실행 중" : currentStatus.status === "completed" ? "완료" : currentStatus.status === "failed" ? "실패" : currentStatus.status === "cancelled" ? "중단됨" : "대기"}</span></div><div className="crawl-summary-line"><span>범주 <strong>{currentStatus.category ? CATEGORY_LABELS[currentStatus.category] : "전체 핵심 부품"}</strong></span><span>모드 <strong>{currentStatus.mode === "all" ? "전체" : "샘플"}</strong></span><span>목록 coverage <strong>{currentStatus.coverage === "complete" ? "완전" : "부분"}</strong></span><span>스펙 <strong>{currentStatus.specCoverage === "complete" ? "완전" : "부분"}</strong></span></div><div className="crawl-progress"><div><span>카테고리</span><strong>{currentStatus.categoriesCompleted} / {currentStatus.categoriesTotal}</strong></div><div className="progress-track"><span style={{ width: `${currentStatus.categoriesTotal ? (currentStatus.categoriesCompleted / currentStatus.categoriesTotal) * 100 : 0}%` }} /></div><div className="crawl-counts"><span>페이지 <strong>{currentStatus.pagesVisited} / {currentStatus.pagesExpected || "?"}</strong></span><span>목록 상품 <strong>{currentStatus.listedProducts}</strong></span><span>상세 성공 <strong>{currentStatus.detailFetched}</strong></span><span>상세 실패 <strong>{currentStatus.detailFailed}</strong></span></div></div><p className="crawl-message">{currentStatus.message ?? "아직 실행된 수집 작업이 없습니다."}</p>{currentStatus.error && <p className="crawl-error"><FiXCircle /> {currentStatus.error}</p>}</section></div>
    <DeferredAdminPanel label="변경 이력" anchorId="admin-catalog-change-log"><Suspense fallback={<AdminPanelLoading label="변경 이력" />}><CatalogChangeHistoryPanel records={catalogChanges} loading={catalogChangesLoading} error={catalogChangesError} historyLimit={catalogChangesLimit} fromDate={catalogChangesFrom} toDate={catalogChangesTo} categoryFilter={catalogChangesCategory} onHistoryLimitChange={setCatalogChangesLimit} onFromDateChange={setCatalogChangesFrom} onToDateChange={setCatalogChangesTo} onCategoryFilterChange={setCatalogChangesCategory} onRefresh={() => setCatalogChangesRefreshKey((current) => current + 1)} onToast={onToast} /></Suspense></DeferredAdminPanel>
    <DeferredAdminPanel label="M.2 매핑" anchorId="admin-m2-mapping"><Suspense fallback={<AdminPanelLoading label="M.2 매핑" />}><M2SlotOverridePanel onToast={onToast} onMetaRefresh={onMetaRefresh} /></Suspense></DeferredAdminPanel>
    <DeferredAdminPanel label="벤치마크 검수" anchorId="admin-benchmark-review"><Suspense fallback={<AdminPanelLoading label="벤치마크 검수" />}><BenchmarkOverridePanel onToast={onToast} onMetaRefresh={onMetaRefresh} storageMode={meta?.storageMode} /></Suspense></DeferredAdminPanel>
    <DeferredAdminPanel label="GPU 물리 검수" anchorId="admin-gpu-physical"><Suspense fallback={<AdminPanelLoading label="GPU 물리 검수" />}><GpuPhysicalOverridePanel onToast={onToast} onMetaRefresh={onMetaRefresh} /></Suspense></DeferredAdminPanel>
    <section className="admin-card accessory-admin-card">
        <DeferredAdminPanel label="케이스 RGB 부하 검수" anchorId="admin-case-rgb-load"><Suspense fallback={<AdminPanelLoading label="케이스 RGB 부하 검수" />}><CaseRgbLoadOverridePanel onToast={onToast} onMetaRefresh={onMetaRefresh} /></Suspense></DeferredAdminPanel>
        <DeferredAdminPanel label="쿨링팬 소비전류 검수" anchorId="admin-cooling-fan-load"><Suspense fallback={<AdminPanelLoading label="쿨링팬 소비전류 검수" />}><CoolingFanLoadOverridePanel onToast={onToast} onMetaRefresh={onMetaRefresh} /></Suspense></DeferredAdminPanel>
        <div className="admin-card-heading">
          <div><p className="eyebrow">PERIPHERAL INGESTION</p><h3>주변 부품 카탈로그 갱신</h3></div>
          <span className={currentAccessoryStatus.status === "running" ? "job-status running " + currentAccessoryStatus.coverage : "job-status " + currentAccessoryStatus.status + " " + currentAccessoryStatus.coverage}>{currentAccessoryStatus.status === "running" ? "실행 중" : currentAccessoryStatus.status === "completed" ? "완료" : currentAccessoryStatus.status === "failed" ? "실패" : "대기"}</span>
        </div>
        <p className="admin-card-description">핵심 호환 부품과 분리된 주변 부품만 수집합니다. 목록 전체와 상세 페이지의 성공 여부를 별도 manifest에 기록합니다.</p>
        <div className="accessory-admin-controls">
          <label><span>수집 범주</span><select value={accessoryCategory} onChange={(event) => setAccessoryCategory(event.target.value as AccessoryCategory | "all")} disabled={accessoryRunning || currentAccessoryStatus.status === "running"}><option value="all">전체 주변 부품</option>{ACCESSORY_CATEGORIES.map((itemCategory) => <option key={itemCategory} value={itemCategory}>{ACCESSORY_CATEGORY_LABELS[itemCategory]}</option>)}</select></label>
          <label><span>시작 위치</span><div className="accessory-offset-input"><input type="number" min="0" max="100000" step="30" value={accessoryOffset} onChange={(event) => setAccessoryOffset(event.target.value)} disabled={accessoryRunning || currentAccessoryStatus.status === "running"} /><em>번</em></div></label>
          <label><span>배치 수량</span><select value={accessoryBatchSize} onChange={(event) => setAccessoryBatchSize(event.target.value)} disabled={accessoryRunning || currentAccessoryStatus.status === "running"}><option value="10">10개</option><option value="30">30개</option><option value="60">60개</option><option value="100">100개</option></select></label>
        </div>
        <div className="accessory-admin-actions">
          <button className="button button-secondary" onClick={() => void startAccessoryCrawl()} disabled={accessoryRunning || currentAccessoryStatus.status === "running"}>{accessoryRunning || currentAccessoryStatus.status === "running" ? <><FiLoader className="spin" /> 배치 실행 중...</> : <><FiTool /> 상세 보강 배치</>}</button>
          <button className="button button-light" onClick={() => void startNextAccessoryBatch()} disabled={accessoryRunning || currentAccessoryStatus.status === "running"}>다음 배치 ({(Number(accessoryOffset) + Number(accessoryBatchSize)).toLocaleString("ko-KR")}번)</button>
          <button className="button button-light" onClick={() => void startAccessoryCrawl({ onlyIncomplete: true })} disabled={accessoryRunning || currentAccessoryStatus.status === "running"}><FiRefreshCw /> 미확인 다음 배치</button>
          <button className="button button-primary" onClick={() => void startAccessoryCrawl({ all: true, details: false, offset: 0 })} disabled={accessoryRunning || currentAccessoryStatus.status === "running"}><FiDatabase /> 목록 전체 동기화</button>
        </div>
        <div className="crawl-summary-line"><span>모드 <strong>{currentAccessoryStatus.mode === "all" ? "전체" : currentAccessoryStatus.onlyIncomplete ? "미확인 배치" : "배치"}</strong></span><span>상세 <strong>{currentAccessoryStatus.details ? "보강 실행" : "목록만"}</strong></span><span>coverage <strong className={currentAccessoryStatus.coverage}>{currentAccessoryStatus.coverage === "complete" ? "완전" : "부분"}</strong></span><span>스펙 <strong className={currentAccessoryStatus.specCoverage}>{currentAccessoryStatus.specCoverage === "complete" ? "완전" : "부분"}</strong></span></div>
        <div className="crawl-counts"><span>범주 <strong>{currentAccessoryStatus.categoriesCompleted} / {currentAccessoryStatus.categoriesTotal}</strong></span><span>상품 <strong>{currentAccessoryStatus.productsSeen.toLocaleString("ko-KR")} / {currentAccessoryStatus.expectedProducts.toLocaleString("ko-KR") || "?"}</strong></span><span>페이지 <strong>{currentAccessoryStatus.pagesVisited} / {currentAccessoryStatus.pagesExpected || "?"}</strong></span><span>목록 상품 <strong>{currentAccessoryStatus.listedProducts}</strong></span><span>상세 성공 <strong>{currentAccessoryStatus.detailFetched}</strong></span><span>상세 실패 <strong>{currentAccessoryStatus.detailFailed}</strong></span><span>반영 <strong>{currentAccessoryStatus.productsUpdated}</strong></span><span>누락 <strong>{currentAccessoryStatus.missingProducts}</strong></span></div>
        <p className="crawl-message">{currentAccessoryStatus.message ?? "아직 실행된 주변 부품 수집 작업이 없습니다."}</p>{currentAccessoryStatus.error && <p className="crawl-error"><FiXCircle /> {currentAccessoryStatus.error}</p>}
      </section><section className="pipeline-card"><div className="section-title-row"><div><p className="eyebrow">DATA PIPELINE</p><h2>수집부터 판정까지</h2></div><span className="muted-count">자동 갱신 주기: 24시간</span></div><div className="pipeline-flow"><PipelineStep Icon={FiSearch} title="다나와 목록" text="카테고리·상품 코드" /><span className="pipeline-arrow">→</span><PipelineStep Icon={FiDatabase} title="상세 스펙" text="메타·상품 정보" /><span className="pipeline-arrow">→</span><PipelineStep Icon={FiTool} title="정규화" text="소켓·단위·규격" /><span className="pipeline-arrow">→</span><PipelineStep Icon={FiShield} title="규칙 엔진" text="설명 가능한 판정" /></div><p className="pipeline-note"><FiInfo /> 요청 지연과 상세 페이지 보강을 적용합니다. 전체 모드에서 모든 목록·상품 상세가 성공해야 목록 coverage가 완전으로 표시됩니다. 원문에 없는 스펙은 별도 completeness로 추적합니다.</p></section></div>;
}

function PipelineStep({ Icon, title, text }: { Icon: IconType; title: string; text: string }) {
  return <div className="pipeline-step"><span><Icon /></span><strong>{title}</strong><small>{text}</small></div>;
}
