import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { IconType } from "react-icons";
import { FiActivity, FiAlertTriangle, FiArrowLeft, FiBox, FiCheck, FiCheckCircle, FiChevronDown, FiClock, FiCopy, FiCpu, FiDatabase, FiDownload, FiEdit3, FiExternalLink, FiHardDrive, FiInfo, FiLayers, FiLoader, FiMonitor, FiPlus, FiPrinter, FiRefreshCw, FiSave, FiSearch, FiServer, FiShare2, FiShield, FiTrash2, FiTool, FiXCircle, FiZap } from "react-icons/fi";
import type { AccessoryCategory, AccessoryCrawlStatus, AccessoryItem, BenchmarkOverride, BenchmarkOverrideOperation, BenchmarkReviewQueue, BenchmarkScoreKey, BenchmarkSourceKind, CatalogChangeKind, CatalogChangeRecord, CrawlStatus, DataQuality, M2SlotCoverage, M2SlotOverride, M2SlotProfile, M2SlotReviewTemplate, M2SlotReviewTemplateItem, Part, PartCategory, ServiceMeta } from "../shared/types";
import { ACCESSORY_CATEGORIES, ACCESSORY_CATEGORY_LABELS, ACCESSORY_PRICE_FILTER_LABELS, BENCHMARK_SOURCE_KIND_LABELS, CATEGORY_LABELS, LISTING_TYPE_LABELS, PART_CATEGORIES } from "../shared/types";
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
import { api } from "./api";
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
};

function AdminPanelLoading({ label }: { label: string }) {
  return <section className="admin-card admin-panel-loading" aria-busy="true"><FiLoader className="spin" /><span>{label} 패널을 불러오는 중...</span></section>;
}

function DeferredAdminPanel({ label, children }: { label: string; children: React.ReactNode }) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: "720px 0px" });
    observer.observe(anchor);
    return () => observer.disconnect();
  }, []);
  return <div ref={anchorRef}>{shouldLoad ? children : <AdminPanelLoading label={label} />}</div>;
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

function AdminBuildVersionAuditPanel({ audit, loading, error, onRefresh, migrationPreview, migrationPreviewLoading, migrationPreviewError, onMigrationPreview, migrationApplyLoading, migrationApplyError, migrationApplyResult, onApplyMigration, rollbackLoading, rollbackError, rollbackResult, onRollbackMigration, backups, backupDetail, backupDetailLoading, backupDetailError, backupDetailId, onOpenBackupDetail, onCloseBackupDetail }: AdminBuildVersionAuditPanelProps) {
  const statusLabel = audit?.status === "healthy" ? (audit.versionGapGroups.length > 0 ? "번호 누락 확인" : "무결성 정상") : audit?.status === "needs_migration" ? "legacy 정리 필요" : "무결성 확인 필요";
  const statusDescription = audit?.status === "healthy"
    ? audit.versionGapGroups.length > 0 ? "명시적 버전 메타데이터는 유효하지만 일부 그룹에 번호 간격이 있습니다. 초기 버전이 보존 정책으로 제외된 것인지 확인해 주세요." : "모든 저장 견적이 명시적인 버전 그룹과 버전 번호를 가지고 있습니다."
    : audit?.status === "needs_migration"
      ? "기존 저장 견적이 legacy fallback(v1)으로 남아 있습니다. 새로 저장되는 견적부터는 명시적 버전 메타데이터를 사용합니다."
      : "중복 버전 번호 또는 부모 견적 연결 오류가 발견되었습니다. 저장 데이터를 자동으로 고치지 않고 원인을 먼저 확인해야 합니다.";

  if (!audit) {
    return <section className="admin-card version-audit-card" data-testid="admin-build-version-audit"><div className="admin-card-heading"><div><p className="eyebrow">SAVED BUILD INTEGRITY</p><h3>저장 견적 버전 상태</h3></div><span className="job-status running">{loading ? "확인 중" : "확인 실패"}</span></div>{loading ? <p className="version-audit-empty"><FiLoader className="spin" /> 저장 견적 버전 메타데이터를 확인하고 있습니다.</p> : <div className="version-audit-error"><FiAlertTriangle /><span>{error ?? "저장 견적 버전 상태를 확인하지 못했습니다."}</span><button className="button button-secondary" onClick={onRefresh}><FiRefreshCw /> 다시 확인</button></div>}</section>;
  }

  const issueCount = audit.legacyCount + audit.duplicateVersionKeys.length + audit.orphanParentIds.length + audit.crossGroupParentIds.length + audit.versionGapGroups.reduce((total, gap) => total + gap.missingVersions.length, 0);
  return <section className={`admin-card version-audit-card ${audit.status}`} data-testid="admin-build-version-audit">
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
  </section>;
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
  const [backups, setBackups] = useState<SavedBuildVersionBackupSummary[]>([]);
  const [backupDetail, setBackupDetail] = useState<SavedBuildVersionBackupDetail | null>(null);
  const [backupDetailLoading, setBackupDetailLoading] = useState(false);
  const [backupDetailError, setBackupDetailError] = useState<string | null>(null);
  const [backupDetailId, setBackupDetailId] = useState<string | null>(null);
  const backupDetailRequestRef = useRef(0);
  useEffect(() => { setStatus(meta?.crawler ?? null); }, [meta]);
  useEffect(() => { void api<AdminSession>("/api/admin/session").then(setSession).catch(() => setSession({ enabled: false, authenticated: true })); }, []);
  useEffect(() => { void api<AccessoryCrawlStatus>("/api/admin/accessories/crawl/status").then(setAccessoryStatus).catch(() => undefined); }, []);
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
    if (!session || (session.enabled && !session.authenticated)) return;
    let cancelled = false;
    void api<{ items: SavedBuildVersionBackupSummary[] }>("/api/admin/build-versions/backups")
      .then((value) => { if (!cancelled) setBackups(value.items); })
      .catch(() => { if (!cancelled) setBackups([]); });
    return () => { cancelled = true; };
  }, [session, versionAuditRefreshKey]);
  async function loadMigrationPreview() {
    setMigrationPreviewLoading(true);
    setMigrationPreviewError(null);
    try {
      setMigrationPreview(await api<SavedBuildVersionMigrationPreview>("/api/admin/build-versions/migration-preview"));
    } catch (error: unknown) {
      setMigrationPreviewError(error instanceof Error ? error.message : "마이그레이션 프리뷰를 계산하지 못했습니다.");
    } finally {
      setMigrationPreviewLoading(false);
    }
  }
  async function loadBackupDetail(backupId: string) {
    const requestId = backupDetailRequestRef.current + 1;
    backupDetailRequestRef.current = requestId;
    setBackupDetailId(backupId);
    setBackupDetailLoading(true);
    setBackupDetailError(null);
    try {
      const detail = await api<SavedBuildVersionBackupDetail>(`/api/admin/build-versions/backups/${encodeURIComponent(backupId)}`);
      if (requestId === backupDetailRequestRef.current) setBackupDetail(detail);
    } catch (error: unknown) {
      if (requestId === backupDetailRequestRef.current) setBackupDetailError(error instanceof Error ? error.message : "backup 상세 diff를 불러오지 못했습니다.");
    } finally {
      if (requestId === backupDetailRequestRef.current) setBackupDetailLoading(false);
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
    setMigrationApplyLoading(true);
    setMigrationApplyError(null);
    setRollbackError(null);
    setRollbackResult(null);
    try {
      const result = await api<SavedBuildVersionMigrationMutationResult>("/api/admin/build-versions/migrate", { method: "POST", body: JSON.stringify({ expectedFingerprint, confirmation: SAVED_BUILD_VERSION_MIGRATION_CONFIRMATION }) });
      setMigrationApplyResult(result);
      setMigrationPreview(null);
      closeBackupDetail();
      setVersionAuditRefreshKey((current) => current + 1);
      onMetaRefresh();
      onToast(result.status === "applied" ? "저장 견적 버전 메타데이터를 적용했습니다." : "이미 버전 메타데이터가 최신 상태입니다.");
    } catch (error: unknown) {
      setMigrationApplyError(error instanceof Error ? error.message : "마이그레이션을 적용하지 못했습니다. 최신 프리뷰를 다시 계산해 주세요.");
    } finally {
      setMigrationApplyLoading(false);
    }
  }
  async function rollbackMigration(backup?: SavedBuildVersionBackupSummary) {
    const rollbackTarget = migrationApplyResult?.backupId ? migrationApplyResult : backup?.rollbackAvailable ? backup : backups.find((candidate) => candidate.rollbackAvailable);
    if (!rollbackTarget) {
      onToast("현재 데이터가 바뀌었거나 복구할 수 있는 backup이 없습니다.");
      return;
    }
    if (!window.confirm("마지막 버전 메타데이터 적용을 되돌릴까요? 적용 후 저장 견적이 바뀌었다면 rollback이 차단됩니다.")) return;
    setRollbackLoading(true);
    setRollbackError(null);
    try {
      const result = await api<SavedBuildVersionMigrationRollbackResult>("/api/admin/build-versions/rollback", { method: "POST", body: JSON.stringify({ backupId: rollbackTarget.backupId, expectedFingerprint: rollbackTarget.resultingFingerprint, confirmation: SAVED_BUILD_VERSION_ROLLBACK_CONFIRMATION }) });
      setRollbackResult(result);
      setMigrationApplyResult(null);
      setBackups([]);
      closeBackupDetail();
      setVersionAuditRefreshKey((current) => current + 1);
      onMetaRefresh();
      onToast("마지막 버전 메타데이터 적용을 되돌렸습니다.");
    } catch (error: unknown) {
      setRollbackError(error instanceof Error ? error.message : "rollback을 실행하지 못했습니다.");
    } finally {
      setRollbackLoading(false);
    }
  }
  useEffect(() => { if (!running) return; const timer = window.setInterval(() => { void api<CrawlStatus>("/api/admin/crawl/status").then((next) => { setStatus(next); if (next.status !== "running") { setRunning(false); onMetaRefresh(); setCatalogChangesRefreshKey((current) => current + 1); } }); }, 1600); return () => window.clearInterval(timer); }, [running, onMetaRefresh]);
  useEffect(() => { if (!accessoryRunning) return; const timer = window.setInterval(() => { void api<AccessoryCrawlStatus>("/api/admin/accessories/crawl/status").then((next) => { setAccessoryStatus(next); if (next.status !== "running") { setAccessoryRunning(false); onMetaRefresh(); setCatalogChangesRefreshKey((current) => current + 1); } }); }, 1600); return () => window.clearInterval(timer); }, [accessoryRunning, onMetaRefresh]);
  useEffect(() => {
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
  }, [catalogChangesCategory, catalogChangesFrom, catalogChangesLimit, catalogChangesRefreshKey, catalogChangesTo]);
  async function startCrawl(all = false) { setRunning(true); try { await api("/api/admin/crawl", { method: "POST", body: JSON.stringify({ pages: 1, limitPerCategory: all ? 0 : 16, details: true, all }) }); onToast(all ? "다나와 전체 부품 수집을 시작했습니다." : "다나와 빠른 카탈로그 갱신을 시작했습니다."); } catch (error: unknown) { setRunning(false); if (error instanceof Error && error.message.includes("관리자")) setSession({ enabled: true, authenticated: false }); onToast(error instanceof Error ? error.message : "크롤링을 시작하지 못했습니다."); } }
  async function startAccessoryCrawl(options: { all?: boolean; details?: boolean; onlyIncomplete?: boolean; offset?: number; limit?: number } = {}) {
    const all = options.all ?? false;
    const details = options.details ?? true;
    const onlyIncomplete = options.onlyIncomplete ?? false;
    const offset = options.offset ?? Number(accessoryOffset);
    const limit = options.limit ?? Number(accessoryBatchSize);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      onToast("배치 시작 위치와 수집 수를 확인해 주세요.");
      return;
    }
    setAccessoryRunning(true);
    try {
      await api("/api/admin/accessories/crawl", { method: "POST", body: JSON.stringify({ category: accessoryCategory, limitPerCategory: limit, offset: all || onlyIncomplete ? 0 : offset, onlyIncomplete, details, all, delayMs: 850 }) });
      onToast(all ? "주변 부품 목록 전체 동기화를 시작했습니다." : onlyIncomplete ? "미확인 주변 부품 다음 배치를 시작했습니다." : `${offset.toLocaleString("ko-KR")}번부터 주변 부품 상세 보강을 시작했습니다.`);
    } catch (error: unknown) {
      setAccessoryRunning(false);
      if (error instanceof Error && error.message.includes("관리자")) setSession({ enabled: true, authenticated: false });
      onToast(error instanceof Error ? error.message : "주변 부품 크롤링을 시작하지 못했습니다.");
    }
  }
  async function startNextAccessoryBatch() {
    const nextOffset = Number(accessoryOffset) + Number(accessoryBatchSize);
    setAccessoryOffset(String(nextOffset));
    await startAccessoryCrawl({ offset: nextOffset });
  }
  async function login(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setLoginLoading(true); try { const nextSession = await api<AdminSession>("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) }); setSession(nextSession); setPassword(""); setCatalogChangesRefreshKey((current) => current + 1); onToast("관리자 인증이 완료되었습니다."); onMetaRefresh(); } catch (error: unknown) { onToast(error instanceof Error ? error.message : "관리자 로그인에 실패했습니다."); } finally { setLoginLoading(false); } }
  if (session?.enabled && !session.authenticated) return <div className="admin-page"><div className="workspace-heading"><div><button className="back-link" onClick={() => window.history.back()}><FiArrowLeft /> 이전으로</button><p className="eyebrow">CATALOG CONTROL CENTER</p><h1>관리자 인증</h1><p>다나와 수집과 카탈로그 변경은 관리자만 실행할 수 있습니다.</p></div><span className="admin-badge"><FiShield /> 보호됨</span></div><section className="auth-card"><span className="auth-icon"><FiShield /></span><div><p className="eyebrow">ADMIN ACCESS</p><h2>데이터 센터에 로그인</h2><p>관리자 비밀번호는 브라우저에 저장되지 않습니다.</p></div><form onSubmit={login}><label htmlFor="admin-password">관리자 비밀번호</label><input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="비밀번호 입력" required /><button className="button button-primary full-width" type="submit" disabled={loginLoading}>{loginLoading ? <><FiLoader className="spin" /> 인증 중...</> : <><FiShield /> 로그인</>}</button></form><p className="auth-hint"><FiInfo /> 로컬 프로젝트에서는 `ADMIN_PASSWORD` 환경변수로 설정합니다.</p></section></div>;
  const currentStatus = status ?? { status: "idle" as const, mode: "sample" as const, categoriesCompleted: 0, categoriesTotal: 9, pagesVisited: 0, pagesExpected: 0, listedProducts: 0, productsSeen: 0, productsUpdated: 0, detailFetched: 0, detailFailed: 0, failedProducts: 0, missingProducts: 0, incompleteSpecs: 0, coverage: "partial" as const, specCoverage: "partial" as const };
 const currentAccessoryStatus: AccessoryCrawlStatus = accessoryStatus ?? { status: "idle", mode: "sample", details: true, onlyIncomplete: false, category: undefined, categoriesCompleted: 0, categoriesTotal: 10, pagesVisited: 0, pagesExpected: 0, listedProducts: 0, productsSeen: 0, expectedProducts: 0, productsUpdated: 0, detailFetched: 0, detailFailed: 0, missingProducts: 0, incompleteSpecs: 0, coverage: "partial", specCoverage: "partial" };
  return <div className="admin-page"><div className="workspace-heading"><div><button className="back-link" onClick={() => window.history.back()}><FiArrowLeft /> 이전으로</button><p className="eyebrow">CATALOG CONTROL CENTER</p><h1>부품 데이터 센터</h1><p>다나와 페이지를 수집하고, 표준 스펙으로 정규화해 호환성 검사에 공급합니다.</p></div><span className="admin-badge"><FiShield /> {meta?.adminAuthEnabled ? "인증 보호됨" : "개발용 관리자"}</span></div><section className="admin-hero"><div className="admin-hero-icon"><FiDatabase /></div><div><p className="eyebrow">DANAWA INGESTION</p><h2>카탈로그 자동 갱신</h2><p>카테고리 목록을 보이는 상품부터 끝까지 읽고, 상세 스펙을 보강한 뒤 누락 필드와 출처를 함께 저장합니다.</p></div><div className="crawl-actions"><button className="button button-secondary" onClick={() => void startCrawl(false)} disabled={running || currentStatus.status === "running"}>{running || currentStatus.status === "running" ? <><FiLoader className="spin" /> 갱신 중...</> : <><FiRefreshCw /> 빠른 갱신</>}</button><button className="button button-primary" onClick={() => void startCrawl(true)} disabled={running || currentStatus.status === "running"}><FiDatabase /> 전체 부품 수집</button></div></section>{meta?.persistence?.fallbackReason === "database_unavailable" && <div className="persistence-warning" role="alert"><FiAlertTriangle /><div><strong>PostgreSQL 연결 실패</strong><p>DATABASE_URL이 설정되어 있지만 현재 저장소는 JSON fallback입니다. 데이터가 DB에 저장되고 있다고 가정하기 전에 연결 상태를 확인해 주세요.</p></div></div>}<AdminBuildVersionAuditPanel audit={versionAudit} loading={versionAuditLoading} error={versionAuditError} onRefresh={() => setVersionAuditRefreshKey((current) => current + 1)} migrationPreview={migrationPreview} migrationPreviewLoading={migrationPreviewLoading} migrationPreviewError={migrationPreviewError} onMigrationPreview={() => void loadMigrationPreview()} migrationApplyLoading={migrationApplyLoading} migrationApplyError={migrationApplyError} migrationApplyResult={migrationApplyResult} onApplyMigration={() => void applyMigration()} rollbackLoading={rollbackLoading} rollbackError={rollbackError} rollbackResult={rollbackResult} onRollbackMigration={() => void rollbackMigration()} backups={backups} backupDetail={backupDetail} backupDetailLoading={backupDetailLoading} backupDetailError={backupDetailError} backupDetailId={backupDetailId} onOpenBackupDetail={(backupId) => void loadBackupDetail(backupId)} onCloseBackupDetail={closeBackupDetail} /><div className="admin-grid"><section className="admin-card"><div className="admin-card-heading"><div><p className="eyebrow">CATALOG SNAPSHOT</p><h3>현재 데이터</h3></div><FiActivity /></div><div className="admin-stats"><div><strong>{meta?.catalogCount ?? 0}</strong><span>전체 부품</span></div><div><strong>{meta ? Object.values(meta.categoryCounts).filter((count) => count > 0).length : 0}</strong><span>활성 카테고리</span></div><div><strong>{meta?.engineVersion ?? "-"}</strong><span>검사 엔진</span></div><div><strong>{meta?.catalogCount ? Math.round((meta.priceCoverage.priced / meta.catalogCount) * 100) : 0}%</strong><span>가격 포함률</span></div></div><div className="data-health"><span><i className="health-dot live" /> live {meta?.qualityCounts.live ?? 0}</span><span><i className="health-dot incomplete" /> 확인 필요 {meta?.qualityCounts.incomplete ?? 0}</span><span><i className="health-dot seed" /> seed {meta?.qualityCounts.seed ?? 0}</span><span><i className="health-dot accessory" /> 주변 부품 {meta?.accessoryCount ?? 0}</span></div><div className="benchmark-coverage" aria-label="벤치마크 근거 coverage"><div className="benchmark-coverage-heading"><div><span>PERFORMANCE EVIDENCE</span><strong>CPU Cinebench R23</strong></div><span>{meta?.benchmarkCoverage ? `${Math.round((meta.benchmarkCoverage.cpu.cinebenchR23Complete / Math.max(meta.benchmarkCoverage.cpu.total, 1)) * 100)}% 완전` : "확인 중"}</span></div><div className="benchmark-coverage-grid"><div><span>전체 CPU</span><strong>{meta?.benchmarkCoverage?.cpu.total?.toLocaleString("ko-KR") ?? "-"}</strong></div><div><span>R23 싱글</span><strong>{meta?.benchmarkCoverage?.cpu.cinebenchR23Single?.toLocaleString("ko-KR") ?? "-"}</strong></div><div><span>R23 멀티</span><strong>{meta?.benchmarkCoverage?.cpu.cinebenchR23Multi?.toLocaleString("ko-KR") ?? "-"}</strong></div><div><span>싱글+멀티</span><strong>{meta?.benchmarkCoverage?.cpu.cinebenchR23Complete?.toLocaleString("ko-KR") ?? "-"}</strong></div></div><div className="benchmark-coverage-subheading"><div><span>GPU · 3DMark</span><strong>Time Spy · Port Royal</strong></div><span>{meta?.benchmarkCoverage ? `${Math.round((meta.benchmarkCoverage.gpu.threeDMarkComplete / Math.max(meta.benchmarkCoverage.gpu.total, 1)) * 100)}% 완전` : "확인 중"}</span></div><div className="benchmark-coverage-grid benchmark-coverage-gpu-grid"><div><span>전체 GPU</span><strong>{meta?.benchmarkCoverage?.gpu.total?.toLocaleString("ko-KR") ?? "-"}</strong></div><div><span>Time Spy</span><strong>{meta?.benchmarkCoverage?.gpu.threeDMarkTimeSpy?.toLocaleString("ko-KR") ?? "-"}</strong></div><div><span>Port Royal</span><strong>{meta?.benchmarkCoverage?.gpu.threeDMarkPortRoyal?.toLocaleString("ko-KR") ?? "-"}</strong></div><div><span>완전 세트</span><strong>{meta?.benchmarkCoverage?.gpu.threeDMarkComplete?.toLocaleString("ko-KR") ?? "-"}</strong></div></div><p>벤치마크 근거 포함 필터는 Cinebench R23 또는 3DMark 데이터가 있는 후보를 우선 확인합니다. 현재 원문에 없는 벤치마크 점수는 추정하지 않습니다.</p><div className="benchmark-source-coverage" aria-label="벤치마크 출처 분포"><div className="benchmark-source-coverage-heading"><div><span>SOURCE QUALITY</span><strong>출처 유형 분포</strong></div><small>점수가 하나 이상 확인된 부품 기준</small></div><div className="benchmark-source-coverage-grid">{(["cpu", "gpu"] as const).map((category) => { const coverage = meta?.benchmarkCoverage?.sourceCoverage?.[category]; const classified = Math.max(0, (coverage?.benchmarked ?? 0) - (coverage?.unclassified ?? 0)); return <div className="benchmark-source-coverage-column" key={category}><div><strong>{category === "cpu" ? "CPU" : "GPU"}</strong><span>{coverage?.benchmarked ?? 0}개 보유 · 완전 {coverage?.complete ?? 0}개 · {coverage?.benchmarked ? Math.round((classified / coverage.benchmarked) * 100) : 0}% 분류됨</span></div><div className="benchmark-source-coverage-list">{BENCHMARK_SOURCE_COVERAGE_LABELS.map(([kind, label]) => <span key={kind}><i className={"benchmark-source-dot " + kind} />{label}<b>{coverage?.[kind] ?? 0}</b></span>)}</div></div>; })}</div></div></div><div className="category-counts">{PART_CATEGORIES.map((category) => <div key={category}><span>{CATEGORY_LABELS[category]}</span><strong>{meta?.categoryCounts[category] ?? 0}</strong></div>)}</div><p className="admin-updated"><FiClock /> 마지막 카탈로그 수정 {meta ? new Date(meta.catalogUpdatedAt).toLocaleString("ko-KR") : "확인 중"}</p><p className="storage-mode"><FiDatabase /> 저장소: {meta?.storageMode === "postgres" ? "PostgreSQL" : "로컬 JSON fallback"}</p></section><section className="admin-card"><div className="admin-card-heading"><div><p className="eyebrow">CRAWL JOB</p><h3>수집 작업 상태</h3></div><span className={`job-status ${currentStatus.status} ${currentStatus.coverage}`}>{currentStatus.status === "running" ? "실행 중" : currentStatus.status === "completed" ? "완료" : currentStatus.status === "failed" ? "실패" : "대기"}</span></div><div className="crawl-summary-line"><span>모드 <strong>{currentStatus.mode === "all" ? "전체" : "샘플"}</strong></span><span>목록 coverage <strong className={currentStatus.coverage}>{currentStatus.coverage === "complete" ? "완전" : "부분"}</strong></span><span>스펙 completeness <strong className={currentStatus.specCoverage}>{currentStatus.specCoverage === "complete" ? "완전" : "부분"}</strong></span></div><div className="crawl-progress"><div><span>카테고리</span><strong>{currentStatus.categoriesCompleted} / {currentStatus.categoriesTotal}</strong></div><div className="progress-track"><span style={{ width: `${currentStatus.categoriesTotal ? (currentStatus.categoriesCompleted / currentStatus.categoriesTotal) * 100 : 0}%` }} /></div><div className="crawl-counts"><span>페이지 <strong>{currentStatus.pagesVisited} / {currentStatus.pagesExpected || "?"}</strong></span><span>목록 상품 <strong>{currentStatus.listedProducts}</strong></span><span>상세 성공 <strong>{currentStatus.detailFetched}</strong></span><span>상세 실패 <strong>{currentStatus.detailFailed}</strong></span><span>상품 누락 <strong>{currentStatus.missingProducts}</strong></span><span>수집 시점 스펙 누락 <strong>{currentStatus.incompleteSpecs}</strong></span></div></div><p className="crawl-message">{currentStatus.message ?? "아직 실행된 수집 작업이 없습니다."}</p>{currentStatus.error && <p className="crawl-error"><FiXCircle /> {currentStatus.error}</p>}</section></div><DeferredAdminPanel label="변경 이력"><Suspense fallback={<AdminPanelLoading label="변경 이력" />}><CatalogChangeHistoryPanel records={catalogChanges} loading={catalogChangesLoading} error={catalogChangesError} historyLimit={catalogChangesLimit} fromDate={catalogChangesFrom} toDate={catalogChangesTo} categoryFilter={catalogChangesCategory} onHistoryLimitChange={setCatalogChangesLimit} onFromDateChange={setCatalogChangesFrom} onToDateChange={setCatalogChangesTo} onCategoryFilterChange={setCatalogChangesCategory} onRefresh={() => setCatalogChangesRefreshKey((current) => current + 1)} onToast={onToast} /></Suspense></DeferredAdminPanel><DeferredAdminPanel label="M.2 매핑"><Suspense fallback={<AdminPanelLoading label="M.2 매핑" />}><M2SlotOverridePanel onToast={onToast} onMetaRefresh={onMetaRefresh} /></Suspense></DeferredAdminPanel><DeferredAdminPanel label="벤치마크 검수"><Suspense fallback={<AdminPanelLoading label="벤치마크 검수" />}><BenchmarkOverridePanel onToast={onToast} onMetaRefresh={onMetaRefresh} storageMode={meta?.storageMode} /></Suspense></DeferredAdminPanel><DeferredAdminPanel label="GPU 물리 검수"><Suspense fallback={<AdminPanelLoading label="GPU 물리 검수" />}><GpuPhysicalOverridePanel onToast={onToast} onMetaRefresh={onMetaRefresh} /></Suspense></DeferredAdminPanel><section className="admin-card accessory-admin-card">
        <DeferredAdminPanel label="케이스 RGB 부하 검수"><Suspense fallback={<AdminPanelLoading label="케이스 RGB 부하 검수" />}><CaseRgbLoadOverridePanel onToast={onToast} onMetaRefresh={onMetaRefresh} /></Suspense></DeferredAdminPanel>
        <DeferredAdminPanel label="쿨링팬 소비전류 검수"><Suspense fallback={<AdminPanelLoading label="쿨링팬 소비전류 검수" />}><CoolingFanLoadOverridePanel onToast={onToast} onMetaRefresh={onMetaRefresh} /></Suspense></DeferredAdminPanel>
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
