import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type { IconType } from "react-icons";
import {
  FiActivity,
  FiAlertTriangle,
  FiArrowRight,
  FiArrowLeft,
  FiBox,
  FiCheck,
  FiCheckCircle,
  FiChevronDown,
  FiClock,
  FiCopy,
  FiCpu,
  FiDatabase,
  FiDownload,
  FiEdit3,
  FiExternalLink,
  FiHardDrive,
  FiInfo,
  FiLayers,
  FiLoader,
  FiBookmark,
  FiMenu,
  FiMonitor,
  FiMoreHorizontal,
  FiPlus,
  FiPrinter,
  FiRefreshCw,
  FiSave,
  FiSearch,
  FiServer,
  FiShare2,
  FiShield,
  FiTrash2,
  FiTool,
  FiXCircle,
  FiZap
} from "react-icons/fi";
import type {
  AccessoryCategory,
  AccessoryCrawlStatus,
  AccessoryItem,
  AccessoryPriceFilter,
  AccessoryRecommendation,
  AccessoryRefreshResponse,
  AccessorySelection,
  AlternativeRiskCounts,
  BenchmarkOverride,
  BenchmarkOverrideOperation,
  BenchmarkReviewQueue,
  BenchmarkScoreKey,
  BenchmarkSourceKind,
  BuildAnalysis,
  BuildAnalysisBalance,
  BuildAnalysisInsight,
  BuildDataHealth,
  BuildGenerationRequest,
  BuildGenerationDiagnostic,
  BuildGenerationRecoveryOption,
  BuildGenerationResult,
  BuildSelection,
  BuildMetrics,
  CatalogChangeKind,
  CatalogChangeValueDiff,
  CatalogChangeRecord,
  CompatibilityLink,
  CompatibilityResult,
  CrawlStatus,
  DataFreshness,
  DataQuality,
  Finding,
  GamingResolution,
  GamingRefreshRate,
  ListingPolicy,
  M2SlotCoverage,
  M2SlotOverride,
  M2SlotReviewTemplate,
  M2SlotReviewTemplateItem,
  M2SlotAssignment,
  M2SlotProfile,
  Part,
  PartCategory,
  PartRefreshResponse,
  PartSelection,
  PhysicalEvidenceSource,
  RecommendationPlan,
  RecommendationProfile,
  RecommendationPriority,
  RecommendationPreferences,
  RecommendationTrustEvidence,
  SavedBuildPurchasePriceHistory,
  SavedBuild,
  SavedBuildCheckFindingSummary,
  SavedBuildCheckSnapshot,
  ServiceMeta,
  SimilarityEvidence,
  UpgradeCompatibilityEvidence,
  UpgradeExpansionEvidence,
  UpgradeBudgetEvidence,
  UpgradeBundleRecommendation,
  UpgradeRecommendation
} from "../shared/types";
import { ACCESSORY_CATEGORIES, ACCESSORY_CATEGORY_LABELS, ACCESSORY_PRICE_FILTER_LABELS, BENCHMARK_SOURCE_KIND_LABELS, CATEGORY_LABELS, DATA_FRESHNESS_LABELS, DATA_QUALITY_LABELS, GAMING_REFRESH_RATE_LABELS, GAMING_RESOLUTION_LABELS, GAMING_RESOLUTION_VRAM_TARGETS, isCatalogDataQualityChangeField, isKnownPrice, LISTING_POLICY_LABELS, LISTING_TYPE_LABELS, PART_CATEGORIES, RECOMMENDATION_PRIORITY_DESCRIPTIONS, RECOMMENDATION_PRIORITY_LABELS, RECOMMENDATION_PROFILE_LABELS } from "../shared/types";
import { m2ReviewTemplatesToCsv, parseM2ReviewCsv } from "../shared/m2-csv";
import { benchmarkOverridesToCsv, benchmarkReviewItemsToCsv, parseBenchmarkOverridesCsv } from "../shared/benchmark-csv";
import { similarityBasisLabelFor, similarityReferenceUsedCategoryFor } from "../shared/similarity-evidence";
import { CATALOG_PRICE_EVIDENCE_LABELS, catalogPriceEvidenceDescriptionFor, catalogPriceEvidenceFor, catalogPriceEvidenceLabelFor } from "../shared/catalog-price-evidence";
import { catalogChangeFieldLabelFor, catalogMissingFieldLabelFor } from "../shared/catalog-spec-coverage";
import { purchaseListCsvFor, purchaseListTextFor, purchaseListTotals } from "../shared/purchase-list";
import type { PurchaseListRow } from "../shared/purchase-list";
import type { PurchaseListWatchTarget } from "../shared/purchase-list-watch";
import { purchaseListCheckedIdsFromJson, purchaseListCheckedIdsToJson, purchaseListCheckedIdsToggle, purchaseListProgressFor, purchaseListRowKeysFor } from "../shared/purchase-list-progress";
import type { PurchaseListExecutionProgress } from "../shared/purchase-list-progress";
import { savedBuildPurchaseProgressMatchesFilter, savedBuildPurchaseProgressSummaryFor } from "../shared/saved-build-purchase-progress";
import type { SavedBuildPurchaseProgressFilter } from "../shared/saved-build-purchase-progress";
import type { SavedBuildPurchaseProgress } from "../shared/types";
import type { PurchaseChecklistProgress } from "../shared/purchase-checklist";
import type { AssemblyVerificationSurfaceSummary } from "../shared/assembly-verification";
import { buildPriceSnapshotFor } from "../shared/build-price-summary";
import type { BuildPriceSnapshot } from "../shared/build-price-summary";
import type { CatalogRefreshReport, CatalogRefreshReportFailure, CatalogRefreshReportItem } from "../shared/catalog-refresh-report";
import { buildCompatibilityInputFingerprint } from "../shared/build-fingerprint";
import { appendBuildHistoryEntry, buildInputChangeLabel } from "../shared/build-history";
import type { BuildHistoryEntry, BuildInputSnapshot } from "../shared/build-history";
import { buildPreflightFor } from "../shared/build-preflight";
import type { BuildPreflight } from "../shared/build-preflight";
import { buildTransferJsonFor, parseBuildTransfer } from "../shared/build-transfer";
import type { BuildTransferEnvelope } from "../shared/build-transfer";
import { buildTransferDiffFor } from "../shared/build-transfer-diff";
import type { BuildTransferDiffRow } from "../shared/build-transfer-diff";
import { buildDraftSyncFor, parseBuildDraftStorage, recommendationPreferencesSyncFor, type BuildDraftLoadResult } from "../shared/build-draft";
import { buildScenarioComparisonFor } from "../shared/build-scenario";
import { catalogRefreshFindingImpactsFor } from "../shared/catalog-refresh-impact";
import { classifyDataFreshness } from "../shared/data-freshness";
import { mergeCatalogRecords } from "../shared/catalog-record-merge";
import { valueScoreText } from "../shared/value-score";
import { repairPlanBuildFor } from "../shared/repair-plan-build";
import { repairPlanPerformanceRetentionFor } from "../shared/repair-plan-performance";
import { savedBuildCheckDiffFor, savedBuildCheckFindingDiffFor, savedBuildCheckSnapshotDiffFor, savedBuildCheckTransitionSummaryFor } from "../shared/saved-build-check";
import type { SavedBuildCheckFindingDiff, SavedBuildCheckTransitionSummary } from "../shared/saved-build-check";
import { buildBenchmarkDecisionImpactText, buildBenchmarkImpactStatusText, buildBenchmarkSnapshotStatusText } from "../shared/build-benchmark-snapshot";
import { savedBuildComparisonRowDiffFor } from "../shared/saved-build-comparison-diff";
import { upgradeBundlePartNeedsHydration, upgradeBundlesFromPayload } from "../shared/upgrade-bundle-transport";
import { hydrateBuildSelection } from "../shared/build-selection-hydration";
import { savedBuildMonitorAssessmentFor } from "../shared/saved-build-monitor";
import type { SavedBuildMonitorItem, SavedBuildMonitorResponse } from "../shared/saved-build-monitor";
import { savedBuildPriorityMatches, savedBuildPriorityRowsFor } from "../shared/saved-build-priority";
import type { SavedBuildPriorityFilter, SavedBuildPriorityRow } from "../shared/saved-build-priority";
import { savedBuildNextActionFor } from "../shared/saved-build-priority-action";
import type { SavedBuildPriorityAction } from "../shared/saved-build-priority-action";
import { savedBuildVersionGroupsFor, savedBuildVersionLabelFor } from "../shared/saved-build-version";
import type { SavedBuildVersionGroup } from "../shared/saved-build-version";
import { dismissSavedBuildMonitorAlerts, markSavedBuildMonitorAlertsRead, mergeSavedBuildMonitorAlerts, savedBuildMonitorAlertFor, savedBuildMonitorAlertMatches } from "../shared/saved-build-monitor-alerts";
import type { SavedBuildMonitorAlert } from "../shared/saved-build-monitor-alerts";
import { SAVED_BUILD_SERVER_MONITOR_ALERT_POLICIES, SAVED_BUILD_SERVER_MONITOR_INTERVALS, savedBuildMonitorAlertAllowed } from "../shared/saved-build-monitor-subscription";
import type { SavedBuildMonitorSubscriptionResponse, SavedBuildServerMonitorAlertPolicy, SavedBuildServerMonitorInterval } from "../shared/saved-build-monitor-subscription";
import { savedBuildCatalogChangeValueDiffsFor } from "../shared/saved-build-change-causes";
import { catalogChangeImpactsFor } from "../shared/catalog-change-impact";
import type { CatalogChangeImpact } from "../shared/catalog-change-impact";
import { compatibilityReportJsonFor, compatibilityReportTextFor } from "../shared/compatibility-report";
import type { CompatibilityReportViewState } from "../shared/compatibility-report";
import { buildChangeResultDecisionNoteFor, buildChangeResultExportFor, buildChangeResultTextFor } from "../shared/build-change-result";
import type { BuildChangeResultComparison } from "../shared/build-change-result";
import { budgetLadderLocalShareRemember, budgetLadderLocalShareRemove, budgetLadderLocalSharesFromJson, budgetLadderLocalSharesToJson } from "../shared/budget-ladder-local-history";
import type { BudgetLadderLocalShareEntry } from "../shared/budget-ladder-local-history";
import { uniqueRefreshTargets } from "../shared/refresh-targets";
import type { RefreshTarget } from "../shared/refresh-targets";
import { catalogChangeDashboardSummary, catalogChangeMatches, catalogChangeMissingIncreased, catalogChangeQualityDegraded, prioritizedCatalogChanges } from "../shared/catalog-change-filters";
import type { CatalogChangeFilter, CatalogChangeKindFilter } from "../shared/catalog-change-filters";
import { filteredFindingsFor, findingFilterCounts, FINDING_FILTERS } from "../shared/finding-filters";
import type { FindingFilter } from "../shared/finding-filters";
import { catalogChangeCsvFor, catalogChangeJsonFor } from "../shared/catalog-change-export";
import type { CatalogChangeExportFilters } from "../shared/catalog-change-export";
import { catalogChangePriceHistoryFor, catalogChangePriceHistoryWithinWindowFor, catalogChangePriceNearLowRankingsFor, catalogChangePriceOpportunitiesFor, catalogChangePriceVolatilityRankingsFor, catalogChangePriceWatchSignalsFor, catalogChangePriceWindowSummaryFor, catalogChangeTrendFor } from "../shared/catalog-change-analytics";
import { priceWatchDecisionFor } from "../shared/price-watch-decision";
import type { PriceWatchDecisionHistory } from "../shared/price-watch-decision";
import type { CatalogChangePriceWatchSignal } from "../shared/catalog-change-analytics";
import { CATALOG_WATCHLIST_STORAGE_KEY, addCatalogWatchEntry, catalogWatchEntryKey, catalogWatchlistContains, catalogWatchlistFromJson, mergeCatalogWatchEntries, removeCatalogWatchEntry, catalogWatchlistToJson } from "../shared/catalog-watchlist";
import type { CatalogWatchEntry } from "../shared/catalog-watchlist";
import { catalogWatchlistCsvFor, catalogWatchlistJsonFor } from "../shared/catalog-watchlist-export";
import type { CatalogWatchSnapshot } from "../shared/catalog-watchlist-export";
import { catalogWatchlistEntriesFromCsv, catalogWatchlistEntriesFromJson } from "../shared/catalog-watchlist-import";
import { catalogWatchlistShareHashFor, catalogWatchlistSharePayloadFromHash } from "../shared/catalog-watchlist-share";
import { catalogWatchSnapshotMatches, sortCatalogWatchSnapshots } from "../shared/catalog-watchlist-view";
import type { CatalogWatchlistSort, CatalogWatchlistStatusFilter } from "../shared/catalog-watchlist-view";
import { alternativeComparisonLocalShareRemember, alternativeComparisonLocalShareRemove, alternativeComparisonLocalSharesFromJson, alternativeComparisonLocalSharesToJson } from "../shared/alternative-comparison-local-history";
import type { AlternativeComparisonLocalShareEntry } from "../shared/alternative-comparison-local-history";
import { savedBuildVersionLocalShareRemember, savedBuildVersionLocalShareRemove, savedBuildVersionLocalSharesFromJson, savedBuildVersionLocalSharesToJson } from "../shared/saved-build-version-local-history";
import type { SavedBuildVersionLocalShareEntry } from "../shared/saved-build-version-local-history";
import type { AlternativeComparisonCandidate } from "../shared/alternative-comparison-export";
import type { AlternativeComparisonSnapshot } from "../shared/alternative-comparison-share";
import type { SavedBuildVersionComparisonShareSnapshot } from "../shared/saved-build-version-share";
import { ApiError, api, apiStatusDetailsSnapshot, subscribeApiStatus } from "./api";
import type { ApiStatusDetails } from "./api";
import type { CatalogRefreshProgress } from "./AppHeader";
import { useModalAccessibility } from "./use-modal-accessibility";
import { RetryAfterButton } from "./RetryAfterButton";
import { resultFindingFilterFromSearch, resultFindingRuleFromSearch, resultSectionFromHash, resultViewUrlFor } from "./result-view-state";
import type { ResultSection } from "./result-view-state";
import { savedBuildShareUrlFor } from "./saved-build-share-url";
import { browserNotificationEnabledFromStorage, browserNotificationIdsFromJson, browserNotificationIdsToJson, browserNotificationPermissionFromUnknown, browserNotificationPermissionLabel, mergeBrowserNotificationIds } from "./browser-notification";
import type { BrowserNotificationPermission } from "./browser-notification";
import { safeExternalUrl, safeHttpsUrl } from "./safe-source-url";
import { CatalogSpecProvenance } from "./CatalogSpecProvenance";
import { savedBuildMonitorAlertsFromJson, savedBuildMonitorAlertsToJson, savedBuildMonitorAutoRefreshEnabledFromStorage, savedBuildMonitorAutoRefreshMinutesFromStorage } from "./saved-build-monitor-storage";
import type { GeneratorBudgetResult, GeneratorVariantResult } from "./BuildGeneratorView";
import type { PickerCandidateMode, PickerPart } from "./PartPicker";
import type { CatalogPart } from "./CatalogView";
import { SAVED_BUILD_DECISION_NOTE_MAX_LENGTH, SAVED_BUILD_NAME_MAX_LENGTH } from "../shared/saved-build-decision-note";
import type { SavedBuildMetadataHistoryEntry } from "../shared/saved-build-decision-note";
import type { PurchaseItemStatus, PurchaseListItemStatus } from "../shared/purchase-list-status";
import type { RepairPlanComparisonViewState } from "./RepairPlanComparison";
import type { CandidateScenarioCompareItem, CandidateScenarioCompareState, CandidateScenarioInput } from "./CandidateScenarioComparison";
import type { ResultFindingSuggestion } from "./ResultFindings";
import type { PendingBuildChange } from "./BuildChangeDecisionDialog";
import { candidateApplicationBlockedFor, candidateApplicationReviewFor, type CandidateApplicationEvidence } from "../shared/candidate-application";
import { BuildPriceSummaryPanel, type UnknownPriceItem } from "./BuildPriceSummary";
import { PurchaseListCatalogRefreshReport } from "./PurchaseListCatalogRefreshReport";
import type { ResultViewDependencies } from "./ResultView";
import type { SavedBuildLiveCheck } from "./SavedBuildComparisonDecision";
import type { UpgradeBundleScenarioPreviewState } from "./UpgradeBundleScenarioPreview";
import type { SavedCatalogWatchlist } from "./SharedWatchlistView";
import { LOCAL_IMPORT_MAX_BYTES } from "../shared/file-import-limits";

const PriceWatchlistView = lazy(() => import("./PriceWatchlistView").then((module) => ({ default: module.PriceWatchlistView })));
const BuildGeneratorView = lazy(() => import("./BuildGeneratorView").then((module) => ({ default: module.BuildGeneratorView })));
const PartPicker = lazy(() => import("./PartPicker").then((module) => ({ default: module.PartPicker })));
const ResultFindingCard = lazy(() => import("./ResultFindings").then((module) => ({ default: module.ResultFindingCard })));
const AdminView = lazy(() => import("./AdminView").then((module) => ({ default: module.AdminView })));
const LazyRepairPlanComparisonPanel = lazy(() => import("./RepairPlanComparison").then((module) => ({ default: module.RepairPlanComparisonPanel })));
const LazyRepairPlanSummaryTable = lazy(() => import("./RepairPlanSummary").then((module) => ({ default: module.RepairPlanSummaryTable })));
const LazyRecommendationSearchNotice = lazy(() => import("./RecommendationSearchNotice").then((module) => ({ default: module.RecommendationSearchNotice })));
const LazyCompatibilityCheckProgress = lazy(() => import("./CompatibilityCheckProgress").then((module) => ({ default: module.CompatibilityCheckProgress })));
const LazyAppHeader = lazy(() => import("./AppHeader").then((module) => ({ default: module.AppHeader })).catch(() => ({ default: AppHeaderLoadingFallback })));
const LazyCatalogView = lazy(() => import("./CatalogView").then((module) => ({ default: module.CatalogView })));
const LazyCandidateScenarioComparisonPanel = lazy(() => import("./CandidateScenarioComparison").then((module) => ({ default: module.CandidateScenarioComparisonPanel })));
const LazySavedBuildPriorityPanel = lazy(() => import("./SavedBuildInsights").then((module) => ({ default: module.SavedBuildPriorityPanel })));
const LazySavedBuildVersionPanel = lazy(() => import("./SavedBuildInsights").then((module) => ({ default: module.SavedBuildVersionPanel })));
const LazySavedBuildComparisonDecisionSummary = lazy(() => import("./SavedBuildComparisonDecision").then((module) => ({ default: module.SavedBuildComparisonDecisionSummary })));
const LazyPurchaseChecklistPanel = lazy(() => import("./PurchaseChecklist").then((module) => ({ default: module.PurchaseChecklistPanel })));
const LazyPurchaseListPanel = lazy(() => import("./PurchaseListPanel").then((module) => ({ default: module.PurchaseListPanel })));
const LazySavedBuildPurchaseProgressComparison = lazy(() => import("./SavedBuildPurchaseProgressComparison").then((module) => ({ default: module.SavedBuildPurchaseProgressComparison })));
const LazySavedBuildPurchasePriceHistoryComparison = lazy(() => import("./SavedBuildPurchasePriceHistoryComparison").then((module) => ({ default: module.SavedBuildPurchasePriceHistoryComparison })));
const LazySavedBuildPurchasePriceHistoryPanel = lazy(() => import("./SavedBuildPurchasePriceHistoryPanel").then((module) => ({ default: module.SavedBuildPurchasePriceHistoryPanel })));
const LazyPurchaseReadinessPanel = lazy(() => import("./PurchaseReadinessPanel").then((module) => ({ default: module.PurchaseReadinessPanel })));
const LazyAccessoryCartPanel = lazy(() => import("./AccessoryCartPanel").then((module) => ({ default: module.AccessoryCartPanel })));
const LazyGpuFitSummaryPanel = lazy(() => import("./GpuFitSummaryPanel").then((module) => ({ default: module.GpuFitSummaryPanel })));
const LazyBenchmarkEvidencePanel = lazy(() => import("./BenchmarkEvidencePanel").then((module) => ({ default: module.BenchmarkEvidencePanel })));
const LazyBuildConnectivityPanel = lazy(() => import("./BuildConnectivityPanel").then((module) => ({ default: module.BuildConnectivityPanel })));
const LazyBuildResourceSummaryPanel = lazy(() => import("./BuildResourceSummaryPanel").then((module) => ({ default: module.BuildResourceSummaryPanel })));
const LazyBuildActionCenterPanel = lazy(() => import("./BuildActionCenter").then((module) => ({ default: module.BuildActionCenterPanel })));
const LazyAssemblyPlanPanel = lazy(() => import("./AssemblyPlanPanel").then((module) => ({ default: module.AssemblyPlanPanel })));
const LazyAssemblyVerificationPanel = lazy(() => import("./AssemblyVerificationPanel").then((module) => ({ default: module.AssemblyVerificationPanel })));
const LazyUpgradeBundleScenarioPreviewPanel = lazy(() => import("./UpgradeBundleScenarioPreview").then((module) => ({ default: module.UpgradeBundleScenarioPreviewPanel })));
const LazyUpgradeBundlePanel = lazy(() => import("./UpgradeBundlePanel").then((module) => ({ default: module.UpgradeBundlePanel })));
const LazySharedBudgetLadderView = lazy(() => import("./SharedBudgetLadderView").then((module) => ({ default: module.SharedBudgetLadderView })));
const LazyHomeView = lazy(() => import("./HomeView").then((module) => ({ default: module.HomeView })));
const LazyAccessoryView = lazy(() => import("./AccessoryView").then((module) => ({ default: module.AccessoryView })));
const LazyHomeSavedBuildVersionSharePanel = lazy(() => import("./HomeSavedBuildVersionSharePanel").then((module) => ({ default: module.HomeSavedBuildVersionSharePanel })));
const LazySharedAlternativeComparisonView = lazy(() => import("./SharedAlternativeComparisonView").then((module) => ({ default: module.SharedAlternativeComparisonView })));
const LazySharedSavedBuildVersionView = lazy(() => import("./SharedSavedBuildVersionView").then((module) => ({ default: module.SharedSavedBuildVersionView })));
const LazySharedWatchlistView = lazy(() => import("./SharedWatchlistView").then((module) => ({ default: module.SharedWatchlistView })));
const LazyResultQuickNav = lazy(() => import("./ResultQuickNav").then((module) => ({ default: module.ResultQuickNav })));
const LazyResultView = lazy(() => import("./ResultView").then((module) => ({ default: module.ResultView })));
const LazySavedBuildRecheckDiffPanel = lazy(() => import("./SavedBuildRecheckDiffPanel").then((module) => ({ default: module.SavedBuildRecheckDiffPanel })));
const LazySavedBuildMonitorAlertsPanel = lazy(() => import("./SavedBuildMonitorAlertsPanel").then((module) => ({ default: module.SavedBuildMonitorAlertsPanel })));

type View = "home" | "generator" | "editor" | "result" | "history" | "admin" | "accessories" | "catalog" | "pricewatchlist" | "watchlist" | "budget" | "comparison" | "version-comparison";
type SavedBuildOpenFocus = "purchase-list" | { type: "finding"; ruleId: string };
type BuildChangeDialogProps = { change: PendingBuildChange; checking: boolean; onClose: () => void; onConfirm: () => void; formatPriceDelta: (value: number | undefined) => string };

const CATALOG_WATCH_THRESHOLD_STORAGE_KEY = "pc-supporter-catalog-watch-threshold";
const SAVED_BUILD_IDS_STORAGE_KEY = "pc-supporter-saved-build-ids";
const SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY = "pc-supporter-saved-build-owner-tokens";
const SAVED_BUILD_METADATA_SYNC_STORAGE_KEY = "pc-supporter-saved-build-metadata-sync";
const SAVED_BUILD_MONITOR_ALERTS_STORAGE_KEY = "pc-supporter-saved-build-monitor-alerts";
const SAVED_BUILD_MONITOR_AUTO_REFRESH_STORAGE_KEY = "pc-supporter-saved-build-monitor-auto-refresh";
const SAVED_BUILD_MONITOR_INTERVAL_STORAGE_KEY = "pc-supporter-saved-build-monitor-interval";
const SAVED_BUILD_SERVER_ALERT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const BROWSER_NOTIFICATION_ENABLED_STORAGE_KEY = "pc-supporter-browser-notification-enabled";
const BROWSER_NOTIFICATION_DELIVERED_STORAGE_KEY = "pc-supporter-browser-notification-delivered";
const SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY = "pc-supporter-saved-watchlist-owner-tokens";
const SAVED_WATCHLIST_LINK_STORAGE_KEY = "pc-supporter-saved-watchlist-link";
const BUDGET_LADDER_LOCAL_SHARES_STORAGE_KEY = "pc-supporter-budget-ladder-shares";
const ALTERNATIVE_COMPARISON_LOCAL_SHARES_STORAGE_KEY = "pc-supporter-alternative-comparison-shares";
const SAVED_BUILD_VERSION_LOCAL_SHARES_STORAGE_KEY = "pc-supporter-saved-build-version-shares";
const LOCAL_SAVED_STATE_LIMIT = 20;

type SavedBuildCreateResponse = SavedBuild & {
  ownerToken: string;
};

type SavedWatchlistCreateResponse = SavedCatalogWatchlist & {
  ownerToken: string;
};

type SavedWatchlistLinkState = {
  id: string;
  expiresAt?: string;
};

type SavedWatchlistExpiryDays = "never" | 7 | 30;

type SavedBuildMetadataHistoryResponse = {
  buildId: string;
  current: { name: string; decisionNote?: string };
  total: number;
  items: SavedBuildMetadataHistoryEntry[];
};

type SavedBuildMetadataHistoryViewState =
  | { status: "loading" }
  | { status: "ready"; value: SavedBuildMetadataHistoryResponse }
  | { status: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function currentBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return browserNotificationPermissionFromUnknown(window.Notification.permission);
}

function recoveryOptionsFromError(error: unknown): BuildGenerationRecoveryOption[] {
  if (!(error instanceof ApiError) || !isRecord(error.details) || !Array.isArray(error.details.recoveryOptions)) return [];
  return error.details.recoveryOptions.filter((value): value is BuildGenerationRecoveryOption => {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.label !== "string" || typeof value.summary !== "string" || !Array.isArray(value.changedFields) || !value.changedFields.every((field) => typeof field === "string") || !isRecord(value.request) || !isRecord(value.preview)) return false;
    const request = value.request;
    const preview = value.preview;
    return ["general", "gaming", "creator", "development", "office"].includes(String(request.profile))
      && Number.isInteger(request.budgetWon) && Number(request.budgetWon) > 0
      && typeof request.includeGpu === "boolean"
      && [16, 32, 64, 128].includes(Number(request.memoryCapacityGb))
      && Number.isInteger(request.storageCapacityGb) && Number(request.storageCapacityGb) > 0
      && Number.isInteger(request.hddCount) && Number(request.hddCount) >= 0 && Number(request.hddCount) <= 8
      && Number.isInteger(request.hddCapacityGb) && Number(request.hddCapacityGb) > 0
      && ["retail_only", "include_bulk", "all"].includes(String(request.listingPolicy))
      && typeof preview.totalPriceWon === "number" && typeof preview.budgetDeltaWon === "number"
      && typeof preview.withinBudget === "boolean" && typeof preview.priceComplete === "boolean"
      && ["compatible", "incompatible", "needs_review"].includes(String(preview.status))
      && Number.isInteger(preview.blockerCount) && Number.isInteger(preview.warningCount) && Number.isInteger(preview.unknownCount);
  }).slice(0, 6);
}

function diagnosticsFromError(error: unknown): BuildGenerationDiagnostic[] {
  if (!(error instanceof ApiError) || !isRecord(error.details) || !Array.isArray(error.details.diagnostics)) return [];
  return error.details.diagnostics.filter((value): value is BuildGenerationDiagnostic => {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string" || typeof value.summary !== "string" || !Array.isArray(value.facts)) return false;
    return value.facts.every((fact) => isRecord(fact) && typeof fact.label === "string" && typeof fact.value === "string")
      && (value.recommendation === undefined || typeof value.recommendation === "string");
  }).slice(0, 3);
}

type AlternativeComparisonShareContext = {
  name?: string;
  category?: string;
  currentPartName?: string;
  currentPartSummary?: string;
  currentPartPrice?: string;
  catalogSnapshotAt?: string;
  engineVersion?: string;
};

type AlternativeComparisonCreateResponse = AlternativeComparisonSnapshot & {
  ownerToken: string;
};

type AlternativeComparisonShareResult = {
  id: string;
  url: string;
  ownerToken: string;
  expiresAt?: string;
};

type AlternativeComparisonShareHandler = (candidates: AlternativeComparisonCandidate[], context?: AlternativeComparisonShareContext) => Promise<AlternativeComparisonShareResult | undefined>;
type AlternativeComparisonRevokeHandler = (share: AlternativeComparisonShareResult) => Promise<boolean>;
type PartWatchHandler = (part: Part) => boolean;

type PickerState = {
  category: PartCategory;
  findingRuleId?: string;
  findingTitle?: string;
  affectedPartIds?: string[];
  initialCandidateMode?: PickerCandidateMode;
};

type SaveBuildTarget = {
  build: BuildSelection;
  preferences: RecommendationPreferences;
  label: string;
  kind?: "repair_plan" | "candidate" | "generated";
  parentBuildId?: string;
};

type BuildScenarioPreviewState = {
  status: "loading" | "ready" | "error";
  title: string;
  summary: string;
  category: PartCategory;
  part: Part;
  quantity?: number;
  affectedPartIds: string[];
  nextBuild: BuildSelection;
  candidateEvidence?: CandidateApplicationEvidence;
  result?: CompatibilityResult;
  error?: string;
};

type BootstrapResource = "parts" | "meta" | "savedBuilds";

type BootstrapIssue = {
  resource: BootstrapResource;
  label: string;
  message: string;
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

const DEFAULT_RECOMMENDATION_PREFERENCES: RecommendationPreferences = {
  priority: "balanced",
  profile: "general",
  listingPolicy: "retail_only",
  gamingResolution: "1440p"
};

const RULE_GUIDES: Record<string, string> = {
  "required-cpu": "검사를 시작하려면 CPU가 선택되어 있는지 확인합니다.",
  "required-cooler": "CPU를 냉각할 쿨러가 선택되어 있는지 확인합니다. CPU에 기본 쿨러가 포함된 경우에는 예외로 처리합니다.",
  "required-motherboard": "CPU와 메모리의 연결 기준이 되는 메인보드가 선택되어 있는지 확인합니다.",
  "required-memory": "운영에 필요한 메모리 모듈이 하나 이상 선택되어 있는지 확인합니다.",
  "required-case": "부품의 실제 장착 공간을 계산하려면 케이스가 선택되어 있는지 확인합니다.",
  "required-psu": "CPU와 그래픽카드에 전력을 공급할 파워서플라이가 선택되어 있는지 확인합니다.",
  "cpu-motherboard-socket": "CPU 소켓과 메인보드 소켓이 동일한지 비교합니다. 소켓이 다르면 물리적으로 장착할 수 없습니다.",
  "cpu-motherboard-power": "CPU의 확인된 최대 전력과 메인보드 전원부의 확인된 공급 범위를 비교합니다.",
  "memory-type": "CPU·메인보드가 요구하는 메모리 세대와 선택한 RAM의 규격이 동일한지 비교합니다.",
  "memory-form-factor": "메인보드 메모리 슬롯과 RAM 모듈의 DIMM/SO-DIMM 물리 규격이 같은지 확인합니다.",
  "memory-capacity": "선택한 RAM 모듈 용량의 합이 메인보드의 최대 지원 용량을 넘지 않는지 확인합니다.",
  "memory-slots": "선택한 RAM 수량과 킷당 물리 모듈 수를 곱한 값이 메인보드의 물리 슬롯 수를 넘지 않는지 확인합니다.",
  "memory-dual-channel": "RAM 수량과 킷당 물리 모듈 수를 계산해 2개 모듈 듀얼채널 구성을 권장합니다. 호환 차단이 아니라 성능 주의 항목입니다.",
  "memory-speed": "RAM 속도와 메인보드 상한을 비교하고, EXPO/XMP 프로파일이 확인된 고속 RAM은 CPU 공식 지원 상한도 함께 고려해 둘 중 더 낮은 확인값을 유효 상한으로 사용합니다.",
  "memory-profile": "RAM에 표시된 EXPO/XMP 프로파일과 메인보드 상세 정보에 확인된 지원 프로파일과 겹치는지 확인합니다. 불일치는 물리적 불호환으로 단정하지 않고 기본 속도 동작·수동 설정 가능성을 주의로 표시합니다.",
  "memory-mixing": "서로 다른 RAM 상품의 용량·속도·CL·전압·프로파일을 비교합니다. 차이가 있거나 정보가 부족하면 혼용 안정성을 보수적으로 표시합니다.",
  "m2-slots": "선택한 M.2 SSD 수량과 메인보드의 M.2 슬롯 수를 비교합니다.",
  "m2-interface": "SATA 방식 M.2 SSD를 선택한 경우 메인보드 상세 정보에서 SATA M.2 연결을 지원하는지 확인합니다.",
  "m2-pcie-generation": "NVMe SSD가 요구하는 PCIe 세대와 메인보드 M.2가 확인한 세대를 비교합니다. SSD 세대가 더 높아도 장착 차단이 아니라 메인보드 세대로 링크되는 성능 주의로 표시합니다.",
  "m2-slot-topology": "여러 M.2 SSD를 사용할 때 메인보드 상세 정보에서 각 슬롯의 PCIe 세대·CPU 직결 여부·레인 공유 조건이 분리되어 확인되는지 검사합니다. 집계 정보만 있으면 임의로 슬롯을 배정하지 않고 확인 필요로 표시합니다.",
  "m2-slot-selection": "사용자가 지정한 M.2 슬롯 수·슬롯 ID·SSD 수량이 현재 선택과 일치하는지 확인합니다. 다른 메인보드나 SSD로 바꾸면 이전 배치를 지우고 다시 지정해야 합니다.",
  "m2-slot-routing": "등록된 M.2 슬롯의 인터페이스 조건과 SSD 연결 방식이 맞는지 확인합니다. 수동 배치에서는 지정한 위치를 그대로 검사합니다.",
  "m2-slot-sharing": "관리자가 등록한 M.2 슬롯의 공유 대상과 현재 선택한 GPU·SATA 저장장치를 비교합니다. 비활성화·링크 폭 변경 조건이 매뉴얼에 명확히 등록되지 않으면 확인 필요로 표시합니다.",
  "m2-pcie-lane-sharing": "메인보드 M.2 연결 구간에 명시된 PCIe 레인 공유 신호를 확인합니다. 이 정보만으로는 공유 슬롯·조건·비활성화를 정하지 않고 확인 필요로 표시합니다.",
  "sata-ports": "SATA SSD와 HDD가 사용하는 포트 수가 메인보드의 SATA 포트 수를 넘지 않는지 확인합니다.",
  "hdd-interface": "내장 HDD가 일반 SATA인지 확인합니다. SAS 등 별도 HBA·RAID 컨트롤러가 필요한 HDD는 일반 SATA 메인보드에 직접 연결할 수 없습니다.",
  "case-hdd-bays": "HDD 수량과 케이스의 3.5인치 장착 베이 수를 비교합니다.",
  "case-motherboard-form-factor": "메인보드 폼팩터가 케이스가 지원하는 폼팩터 목록에 포함되는지 확인합니다.",
  "case-fan-headers": "케이스에 기본 장착된 팬 수와 메인보드의 확인된 팬 헤더 수를 비교합니다. 직접 연결이 부족하면 팬 허브가 필요할 수 있습니다.",
  "case-rgb-headers": "케이스 RGB 장치 수와 메인보드의 RGB/ARGB 헤더 정보를 비교하되, 5V·12V 전압과 허브 연결은 제조사 페이지에서 다시 확인합니다.",
  "case-rgb-voltage": "케이스 RGB 장치의 5V ARGB·12V RGB 타입과 메인보드의 같은 전압 헤더 정보를 비교합니다. 전압이 다르면 직접 연결하지 말고 컨트롤러 제조사 페이지를 확인해 주세요.",
  "cpu-cooler-socket": "CPU 소켓이 쿨러의 지원 소켓 목록에 포함되는지 확인합니다.",
  "cpu-cooler-capacity": "CPU 기준 전력과 쿨러의 확인된 냉각 지원 용량을 비교합니다.",
  "case-cooler-height": "쿨러 높이가 케이스의 허용 높이를 넘지 않는지 확인합니다.",
  "case-radiator-support": "수랭 쿨러의 라디에이터 크기가 케이스의 지원 크기 목록에 포함되는지 확인하고, 양쪽 위치 정보가 확인되면 전면·상단 등 장착 위치까지 대조합니다.",
  "display-output": "외장 그래픽카드가 없을 때 CPU가 내장 그래픽을 제공하는지 확인합니다.",
  "gpu-motherboard-pcie": "그래픽카드의 PCIe 장착 폭과 메인보드의 PCIe x16/x8 슬롯 수를 비교합니다. PCIe 세대 차이 자체는 이 규칙에서 불호환으로 판단하지 않습니다.",
  "gpu-thickness": "그래픽카드 두께가 55mm 이상이면 인접 슬롯·케이스 구조물 간섭을 주의 항목으로 표시합니다. 실제 슬롯 점유 수는 제조사 페이지에서 한 번 더 확인해 주세요.",
  "gpu-case-length": "그래픽카드 길이와 케이스의 최대 GPU 허용 길이를 비교합니다.",
  "gpu-cable-clearance": "확인된 GPU 전원 케이블 굽힘 여유와 케이스 측면 공간이 모두 맞을 때만 케이블 간섭 여부를 알려드립니다.",
  "gpu-psu-power": "그래픽카드·CPU의 권장 파워 용량과 선택한 파워의 정격 출력을 비교합니다.",
  "gpu-psu-connector": "그래픽카드가 요구하는 PCIe 보조전원 커넥터와 파워서플라이에서 확인된 제공 커넥터 수를 비교합니다. 어댑터가 필요한 경우 제품 페이지에 명시된 경로만 인정합니다.",
  "gpu-psu-cable-topology": "커넥터 수량이 맞아도 여러 8핀 커넥터를 독립 케이블로 연결할 수 있는지 또는 제조사 허용 분배 경로인지 확인합니다.",
  "psu-case-length": "파워서플라이 깊이와 케이스의 파워 장착 허용 길이를 비교합니다.",
  "psu-case-form-factor": "파워서플라이의 ATX/SFX 규격이 케이스의 지원 파워 규격 목록에 포함되는지 확인합니다.",
  "psu-data-quality": "파워서플라이의 정격 출력 등 필수 전력 정보가 확인된 데이터인지 점검합니다. 정보 부족은 확인 필요로 표시합니다."
};

function readRecommendationPreferences(): RecommendationPreferences {
  try {
    const raw = window.localStorage.getItem("pc-supporter-recommendation-preferences");
    if (!raw) return DEFAULT_RECOMMENDATION_PREFERENCES;
    const value = JSON.parse(raw) as Partial<RecommendationPreferences>;
    const priority = value.priority === "budget" || value.priority === "performance" || value.priority === "reliability" ? value.priority : "balanced";
    const profile = value.profile === "gaming" || value.profile === "creator" || value.profile === "development" || value.profile === "office"
      ? value.profile
      : "general";
    const listingPolicy = value.listingPolicy === "include_bulk" || value.listingPolicy === "all"
      ? value.listingPolicy
      : "retail_only";
    const budgetWon = typeof value.budgetWon === "number" && Number.isInteger(value.budgetWon) && value.budgetWon > 0
      ? value.budgetWon
      : undefined;
    const gamingResolution = value.gamingResolution === "1080p" || value.gamingResolution === "4k" ? value.gamingResolution : "1440p";
    const gamingRefreshRate = value.gamingRefreshRate === 60 || value.gamingRefreshRate === 240 ? value.gamingRefreshRate : 144;
    const base: RecommendationPreferences = budgetWon === undefined ? { priority, profile, listingPolicy, gamingResolution } : { priority, profile, budgetWon, listingPolicy, gamingResolution };
    return profile === "gaming" ? { ...base, gamingRefreshRate } : base;
  } catch {
    return DEFAULT_RECOMMENDATION_PREFERENCES;
  }
}

type CategoryMeta = {
  label: string;
  helper: string;
  required: boolean;
  multiple: boolean;
  Icon: IconType;
};

const CATEGORY_META: Record<PartCategory, CategoryMeta> = {
  cpu: {
    label: "CPU",
    helper: "프로세서와 소켓 규격을 선택하세요.",
    required: true,
    multiple: false,
    Icon: FiCpu
  },
  cooler: {
    label: "CPU 쿨러",
    helper: "CPU 소켓과 냉각 여유를 검사합니다.",
    required: true,
    multiple: false,
    Icon: FiTool
  },
  motherboard: {
    label: "메인보드",
    helper: "CPU, RAM, 저장장치 슬롯의 기준입니다.",
    required: true,
    multiple: false,
    Icon: FiServer
  },
  memory: {
    label: "RAM",
    helper: "메모리 규격, 총 용량, 슬롯 수를 검사합니다.",
    required: true,
    multiple: true,
    Icon: FiDatabase
  },
  gpu: {
    label: "그래픽카드",
    helper: "전력과 케이스 장착 길이를 검사합니다.",
    required: false,
    multiple: false,
    Icon: FiMonitor
  },
  ssd: {
    label: "SSD",
    helper: "M.2 슬롯과 SATA 포트 사용량을 검사합니다.",
    required: false,
    multiple: true,
    Icon: FiHardDrive
  },
  hdd: {
    label: "HDD",
    helper: "케이스 베이와 SATA 포트 사용량을 검사합니다.",
    required: false,
    multiple: true,
    Icon: FiHardDrive
  },
  case: {
    label: "케이스",
    helper: "메인보드, GPU, 쿨러, 저장장치 공간을 검사합니다.",
    required: true,
    multiple: false,
    Icon: FiBox
  },
  psu: {
    label: "파워서플라이",
    helper: "시스템 전력 공급 여유와 데이터 상태를 검사합니다.",
    required: true,
    multiple: false,
    Icon: FiZap
  }
};

const emptyBuild = (): BuildSelection => ({
  memory: [],
  ssd: [],
  hdd: [],
  accessories: [],
  useIntegratedGraphics: true
});

const BUILD_DRAFT_STORAGE_KEY = "pc-supporter-draft";
const INVALID_BUILD_DRAFT_BACKUP_STORAGE_KEY = "pc-supporter-invalid-draft-backup";
const INVALID_BUILD_DRAFT_BACKUP_MAX_BYTES = 512_000;

function readBuildDraftStorageRaw() {
  try {
    return window.localStorage.getItem(BUILD_DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
}

const demoBuild = (): BuildSelection => ({
  cpu: { partId: "cpu-7500f", quantity: 1 },
  cooler: { partId: "cooler-small-am5", quantity: 1 },
  motherboard: { partId: "mb-a620-small", quantity: 1 },
  memory: [{ partId: "memory-ddr5-32-7200", quantity: 4 }],
  gpu: { partId: "gpu-rtx-5090", quantity: 1 },
  ssd: [{ partId: "ssd-nvme-1tb", quantity: 4 }],
  hdd: [{ partId: "hdd-seagate-4tb", quantity: 4 }],
  case: { partId: "case-compact-matx", quantity: 1 },
  psu: { partId: "psu-650w", quantity: 1 },
  accessories: [],
  useIntegratedGraphics: false
});

const compatibleDemoBuild = (): BuildSelection => ({
  cpu: { partId: "cpu-7800x3d", quantity: 1 },
  cooler: { partId: "cooler-tower-am5-1700", quantity: 1 },
  motherboard: { partId: "mb-b650-4x3", quantity: 1 },
  memory: [{ partId: "memory-ddr5-16-5600", quantity: 2 }],
  gpu: { partId: "gpu-rtx-4060", quantity: 1 },
  ssd: [{ partId: "ssd-nvme-1tb", quantity: 1 }],
  hdd: [{ partId: "hdd-seagate-4tb", quantity: 1 }],
  case: { partId: "case-full-airflow", quantity: 1 },
  psu: { partId: "psu-1000w", quantity: 1 },
  accessories: [],
  useIntegratedGraphics: false
});

function currentView() : View {
  const path = window.location.pathname;
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/watchlist/")) return "watchlist";
  if (path.startsWith("/budget-ladder/")) return "budget";
  if (path.startsWith("/compare/")) return "comparison";
  if (path.startsWith("/version-comparison/")) return "version-comparison";
  if (path === "/watchlist" || path === "/watchlist/") return "pricewatchlist";
  if (path.startsWith("/accessories")) return "accessories";
  if (path.startsWith("/history")) return "history";
  if (path.startsWith("/recommend")) return "generator";
  if (path.startsWith("/result") || path.startsWith("/share")) return "result";
  if (path.startsWith("/build")) return "editor";
  if (path.startsWith("/catalog")) return "catalog";
  return "home";
}

const resultSectionTargetIds: Record<ResultSection, string> = {
  findings: "result-findings",
  "purchase-list": "purchase-list-panel",
  "purchase-checklist": "purchase-checklist",
  "purchase-decision": "purchase-decision-gate",
  actions: "build-action-center"
};

function compatibilityReportViewStateForLocation(): CompatibilityReportViewState {
  const findingFilter = resultFindingFilterFromSearch(window.location.search);
  const section = resultSectionFromHash(window.location.hash);
  return {
    path: `${window.location.pathname}${findingFilter === "all" ? "" : `?finding=${encodeURIComponent(findingFilter)}`}${section ? `#${section}` : ""}`,
    findingFilter,
    ...(section ? { section } : {})
  };
}

function readLastCompatibilityResult(): CompatibilityResult | null {
  try {
    const raw = window.sessionStorage.getItem("pc-supporter-last-compatibility-result");
    return raw ? JSON.parse(raw) as CompatibilityResult : null;
  } catch {
    return null;
  }
}

function readLastCompatibilityInputFingerprint() {
  try {
    return window.sessionStorage.getItem("pc-supporter-last-compatibility-input");
  } catch {
    return null;
  }
}

function readBuildHistory(): BuildHistoryEntry[] {
  try {
    const raw = window.sessionStorage.getItem("pc-supporter-build-history");
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    if (parsed.length > LOCAL_SAVED_STATE_LIMIT) return [];
    return parsed.filter((entry): entry is BuildHistoryEntry => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Partial<BuildHistoryEntry>;
      return typeof candidate.id === "string"
        && typeof candidate.label === "string"
        && typeof candidate.changedAt === "string"
        && Boolean(candidate.snapshot)
        && typeof candidate.snapshot === "object"
        && Boolean(candidate.snapshot.build)
        && typeof candidate.snapshot.build === "object"
        && Boolean(candidate.snapshot.recommendationPreferences)
        && typeof candidate.snapshot.recommendationPreferences === "object";
    }).slice(0, LOCAL_SAVED_STATE_LIMIT);
  } catch {
    return [];
  }
}

function readSavedBuildIds() {
  try {
    const raw = window.localStorage.getItem(SAVED_BUILD_IDS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [] as string[];
    if (parsed.length > LOCAL_SAVED_STATE_LIMIT) return [] as string[];
    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, LOCAL_SAVED_STATE_LIMIT);
  } catch {
    return [] as string[];
  }
}

function writeSavedBuildIds(ids: string[]) {
  try {
    const nextIds = [...new Set(ids)].slice(0, LOCAL_SAVED_STATE_LIMIT);
    window.localStorage.setItem(SAVED_BUILD_IDS_STORAGE_KEY, JSON.stringify(nextIds));
    const allowedIds = new Set(nextIds);
    const tokens = readSavedBuildOwnerTokens();
    writeSavedBuildOwnerTokens(Object.fromEntries(Object.entries(tokens).filter(([id]) => allowedIds.has(id))));
  } catch {
    // A full local storage bucket must not prevent the editor from working.
  }
}

function readSavedBuildOwnerTokens() {
  try {
    const raw = window.localStorage.getItem(SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {} as Record<string, string>;
    const entries = Object.entries(parsed);
    if (entries.length > LOCAL_SAVED_STATE_LIMIT) return {} as Record<string, string>;
    return Object.fromEntries(entries.filter(([id, token]) => typeof id === "string" && typeof token === "string" && token.length >= 40).slice(0, LOCAL_SAVED_STATE_LIMIT));
  } catch {
    return {} as Record<string, string>;
  }
}

function writeSavedBuildOwnerTokens(tokens: Record<string, string>) {
  try {
    window.localStorage.setItem(SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(tokens).slice(0, LOCAL_SAVED_STATE_LIMIT))));
  } catch {
    // A full local storage bucket must not prevent the editor from working.
  }
}

function rememberSavedBuildOwnerToken(id: string, token: string) {
  if (!id.trim() || !token.trim()) return;
  writeSavedBuildOwnerTokens({ [id]: token, ...readSavedBuildOwnerTokens() });
}

function readSavedBuildOwnerToken(id: string) {
  return readSavedBuildOwnerTokens()[id];
}

function forgetSavedBuild(id: string) {
  writeSavedBuildIds(readSavedBuildIds().filter((savedId) => savedId !== id));
  const tokens = readSavedBuildOwnerTokens();
  delete tokens[id];
  writeSavedBuildOwnerTokens(tokens);
}

function readSavedWatchlistOwnerTokens() {
  try {
    const raw = window.localStorage.getItem(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {} as Record<string, string>;
    const entries = Object.entries(parsed);
    if (entries.length > LOCAL_SAVED_STATE_LIMIT) return {} as Record<string, string>;
    return Object.fromEntries(entries.filter(([id, token]) => typeof id === "string" && typeof token === "string" && token.length >= 40).slice(0, LOCAL_SAVED_STATE_LIMIT));
  } catch {
    return {} as Record<string, string>;
  }
}

function writeSavedWatchlistOwnerTokens(tokens: Record<string, string>) {
  try {
    window.localStorage.setItem(SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(tokens).slice(0, LOCAL_SAVED_STATE_LIMIT))));
  } catch {
    // A full local storage bucket must not prevent price tracking from working.
  }
}

function rememberSavedWatchlistOwnerToken(id: string, token: string) {
  if (!id.trim() || !token.trim()) return;
  writeSavedWatchlistOwnerTokens({ [id]: token, ...readSavedWatchlistOwnerTokens() });
}

function readSavedWatchlistOwnerToken(id: string) {
  return readSavedWatchlistOwnerTokens()[id];
}

function readSavedWatchlistLink() {
  try {
    const raw = window.localStorage.getItem(SAVED_WATCHLIST_LINK_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = parsed as Partial<SavedWatchlistLinkState>;
    return typeof candidate.id === "string" && candidate.id.trim() ? { id: candidate.id, ...(typeof candidate.expiresAt === "string" ? { expiresAt: candidate.expiresAt } : {}) } : null;
  } catch {
    return null;
  }
}

function writeSavedWatchlistLink(link: SavedWatchlistLinkState | null) {
  try {
    if (link) window.localStorage.setItem(SAVED_WATCHLIST_LINK_STORAGE_KEY, JSON.stringify(link));
    else window.localStorage.removeItem(SAVED_WATCHLIST_LINK_STORAGE_KEY);
  } catch {
    // A full local storage bucket must not prevent price tracking from working.
  }
}

function formatWon(value: number | undefined) {
  return !isKnownPrice(value) ? "가격 확인 중" : `${value.toLocaleString("ko-KR")}원`;
}

function formatPriceDelta(value: number | undefined) {
  if (value === undefined) return "가격 확인 필요";
  if (value === 0) return "현재와 같은 가격";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}원`;
}

function formatSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatSpecValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "확인 필요";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "있음" : "없음";
  return String(value);
}

function partIsWatched(part: Part) {
  if (typeof window === "undefined") return false;
  return catalogWatchlistContains(catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)), { kind: "part", itemId: part.id });
}

function PartWatchButton({ part, onWatch }: { part: Part; onWatch: PartWatchHandler }) {
  const [watching, setWatching] = useState(() => partIsWatched(part));
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CATALOG_WATCHLIST_STORAGE_KEY) return;
      setWatching(catalogWatchlistContains(catalogWatchlistFromJson(event.newValue), { kind: "part", itemId: part.id }));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [part.id]);
  function addToWatchlist() {
    if (onWatch(part)) setWatching(true);
  }
  return <button className={watching ? "text-button part-watch-button watched" : "text-button part-watch-button"} type="button" data-item-id={part.id} onClick={addToWatchlist} disabled={watching} aria-label={`${part.name} 가격 추적 ${watching ? "등록됨" : "등록"}`}><FiClock /> {watching ? "추적 중" : "가격 추적"}</button>;
}

function accessoryIsWatched(item: AccessoryItem) {
  if (typeof window === "undefined") return false;
  return catalogWatchlistContains(catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)), { kind: "accessory", itemId: item.id });
}

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

function formatPciePowerAdapterOptions(options: Array<Array<{ kind: string; count: number }>> | undefined) {
  const formatted = formatPciePowerOptions(options);
  return formatted ? `어댑터 경로 · ${formatted}` : undefined;
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

function formatRadiatorPosition(position: string | undefined) {
  return position === "front" ? "전면" : position === "top" ? "상단" : position === "bottom" ? "하단" : position === "side" ? "측면" : position === "rear" ? "후면" : undefined;
}

function formatRadiatorSupports(supports: Array<{ position?: unknown; sizesMm?: unknown }> | undefined) {
  if (!supports || supports.length === 0) return undefined;
  return supports.map((support) => {
    const position = typeof support.position === "string" ? support.position : "확인 필요";
    const sizes = Array.isArray(support.sizesMm) ? support.sizesMm.filter((size): size is number => typeof size === "number" && Number.isFinite(size)).map((size) => `${size}mm`).join(", ") : "확인 필요";
    return `${formatRadiatorPosition(position) ?? position} · ${sizes}`;
  }).join(" / ");
}

function selectionList(build: BuildSelection, category: PartCategory): PartSelection[] {
  if (category === "memory") return build.memory;
  if (category === "ssd") return build.ssd;
  if (category === "hdd") return build.hdd;
  const selection = build[category];
  return selection ? [selection] : [];
}

function withSelectedPart(
  build: BuildSelection,
  category: PartCategory,
  selection: PartSelection | undefined
): BuildSelection {
  if (category === "memory" || category === "ssd" || category === "hdd") {
    const list = selectionList(build, category);
    const nextList = selection
      ? [...list, selection]
      : list;
    return {
      ...build,
      [category]: nextList,
      ...(category === "ssd" ? { m2SlotSelection: undefined } : {})
    } as BuildSelection;
  }
  return {
    ...build,
    [category]: selection,
    ...(category === "motherboard" ? { m2SlotSelection: undefined } : {}),
    ...(category === "gpu" && selection ? { useIntegratedGraphics: false } : {})
  } as BuildSelection;
}

function replacePartInBuild(build: BuildSelection, category: PartCategory, partId: string, quantityOverride?: number) {
  if (category === "memory" || category === "ssd" || category === "hdd") {
    const current = selectionList(build, category);
    return {
      ...build,
      [category]: [{ partId, quantity: quantityOverride ?? current[0]?.quantity ?? 1 }],
      ...(category === "ssd" ? { m2SlotSelection: undefined } : {})
    } as BuildSelection;
  }
  return {
    ...build,
    [category]: { partId, quantity: quantityOverride ?? build[category]?.quantity ?? 1 },
    ...(category === "motherboard" ? { m2SlotSelection: undefined } : {})
  } as BuildSelection;
}

function upgradeBundleBuildFor(build: BuildSelection, bundle: UpgradeBundleRecommendation) {
  return bundle.changes.reduce(
    (current, change) => replacePartInBuild(current, change.category, change.part.id, change.quantity),
    build
  );
}

function replaceAffectedPartsInBuild(build: BuildSelection, category: PartCategory, partId: string, affectedPartIds: string[], quantityOverride?: number) {
  if (affectedPartIds.length === 0) return replacePartInBuild(build, category, partId, quantityOverride);
  if (category === "memory" || category === "ssd" || category === "hdd") {
    const affected = new Set(affectedPartIds);
    const current = selectionList(build, category);
    const replaced = current.map((selection) => affected.has(selection.partId)
      ? { partId, quantity: quantityOverride ?? selection.quantity }
      : selection);
    return replaced.some((selection) => selection.partId === partId)
      ? {
          ...build,
          [category]: replaced,
          ...(category === "ssd" ? { m2SlotSelection: undefined } : {})
        } as BuildSelection
      : replacePartInBuild(build, category, partId, quantityOverride);
  }
  return replacePartInBuild(build, category, partId, quantityOverride);
}

function updateQuantity(build: BuildSelection, category: PartCategory, index: number, quantity: number) {
  const nextQuantity = Math.max(1, Math.min(99, Math.floor(quantity || 1)));
  if (category === "memory" || category === "ssd" || category === "hdd") {
    const next = selectionList(build, category).map((selection, selectionIndex) =>
      selectionIndex === index ? { ...selection, quantity: nextQuantity } : selection
    );
    return {
      ...build,
      [category]: next,
      ...(category === "ssd" ? { m2SlotSelection: undefined } : {})
    } as BuildSelection;
  }
  const selection = selectionList(build, category)[0];
  return selection ? ({ ...build, [category]: { ...selection, quantity: nextQuantity } } as BuildSelection) : build;
}

function removeSelection(build: BuildSelection, category: PartCategory, index: number) {
  if (category === "memory" || category === "ssd" || category === "hdd") {
    const next = selectionList(build, category).filter((_, selectionIndex) => selectionIndex !== index);
    return {
      ...build,
      [category]: next,
      ...(category === "ssd" ? { m2SlotSelection: undefined } : {})
    } as BuildSelection;
  }
  return {
    ...build,
    [category]: undefined,
    ...(category === "motherboard" ? { m2SlotSelection: undefined } : {}),
    ...(category === "gpu" ? { useIntegratedGraphics: true } : {})
  } as BuildSelection;
}

function accessorySelections(build: BuildSelection): AccessorySelection[] {
  return build.accessories ?? [];
}

function unknownPriceItemsFor(build: BuildSelection, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>): UnknownPriceItem[] {
  const items = new Map<string, UnknownPriceItem>();
  for (const category of PART_CATEGORIES) {
    for (const selection of selectionList(build, category)) {
      const part = partMap.get(selection.partId);
      if (isKnownPrice(part?.priceWon)) continue;
      const item = {
        id: selection.partId,
        name: part?.name ?? selection.partId,
        kind: "part",
        sourceUrl: part?.danawaUrl,
        ...(part?.source === "danawa" && part.danawaUrl ? { refreshTarget: { kind: "part", id: part.id } } : {})
      } satisfies UnknownPriceItem;
      items.set(`part:${item.id}`, item);
    }
  }
  for (const selection of accessorySelections(build)) {
    const item = accessoryMap.get(selection.accessoryId);
    if (isKnownPrice(item?.priceWon)) continue;
    const unknownItem = {
      id: selection.accessoryId,
      name: item?.name ?? selection.accessoryId,
      kind: "accessory",
      sourceUrl: item?.danawaUrl,
      ...(item?.source === "danawa" && item.danawaUrl ? { refreshTarget: { kind: "accessory", id: item.id } } : {})
    } satisfies UnknownPriceItem;
    items.set(`accessory:${unknownItem.id}`, unknownItem);
  }
  return [...items.values()];
}

function catalogRefreshReportForInput(report: CatalogRefreshReport | null, build: BuildSelection, preferences: RecommendationPreferences) {
  if (!report) return undefined;
  return report.inputFingerprint === buildCompatibilityInputFingerprint(build, preferences) ? report : undefined;
}

function isM2TargetableAccessory(item: AccessoryItem | undefined) {
  if (!item) return false;
  return item.category === "m2_heatsink"
    || (item.category === "storage_accessory" && /m\.2/i.test(`${item.name} ${item.rawSpecText ?? ""}`));
}

function isFanTargetableAccessory(item: AccessoryItem | undefined) {
  return item?.category === "cooling_fan";
}

function selectedM2TargetOptions(build: BuildSelection, partMap: ReadonlyMap<string, Part>) {
  return build.ssd
    .map((selection) => ({ selection, part: partMap.get(selection.partId) }))
    .filter((entry): entry is { selection: PartSelection; part: Part } => Boolean(entry.part && entry.part.specs.formFactor?.toLocaleLowerCase("ko-KR").includes("m.2")));
}

function defaultAccessoryTargetPartId(build: BuildSelection, item: AccessoryItem, partMap: ReadonlyMap<string, Part>) {
  if (!isM2TargetableAccessory(item)) return undefined;
  const targets = selectedM2TargetOptions(build, partMap);
  return targets.length === 1 ? targets[0].part.id : undefined;
}

function defaultAccessoryTargetAccessoryId(build: BuildSelection, item: AccessoryItem, accessoryMap: ReadonlyMap<string, AccessoryItem>) {
  if (!isFanTargetableAccessory(item)) return undefined;
  const hubs = accessorySelections(build)
    .map((selection) => ({ selection, item: accessoryMap.get(selection.accessoryId) }))
    .filter((entry): entry is { selection: AccessorySelection; item: AccessoryItem } => entry.item?.category === "fan_hub");
  return hubs.length === 1 ? hubs[0].selection.accessoryId : undefined;
}

function accessoryConnectionTargetFor(build: BuildSelection, selection: AccessorySelection, item: AccessoryItem | undefined, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>) {
  if (isM2TargetableAccessory(item)) {
    if (selection.targetPartId) return `SSD ${partMap.get(selection.targetPartId)?.name ?? `대상 확인 필요 · ${selection.targetPartId}`}`;
    return selectedM2TargetOptions(build, partMap).length > 0 ? "선택한 M.2 SSD 전체" : "M.2 SSD 미지정";
  }
  if (isFanTargetableAccessory(item)) {
    if (selection.targetAccessoryId) return `팬 허브 ${accessoryMap.get(selection.targetAccessoryId)?.name ?? `대상 확인 필요 · ${selection.targetAccessoryId}`}`;
    const hubs = accessorySelections(build)
      .map((hubSelection) => ({ selection: hubSelection, item: accessoryMap.get(hubSelection.accessoryId) }))
      .filter((entry): entry is { selection: AccessorySelection; item: AccessoryItem } => entry.item?.category === "fan_hub");
    if (hubs.length === 1) return `팬 허브 ${hubs[0].item.name}`;
    return hubs.length > 1 ? "팬 허브 지정 필요" : "팬 허브 미지정";
  }
  return undefined;
}

function addAccessoryToBuild(build: BuildSelection, accessoryId: string, targetPartId?: string, targetAccessoryId?: string): BuildSelection {
  const current = accessorySelections(build);
  const existing = current.find((selection) => selection.accessoryId === accessoryId);
  return {
    ...build,
    accessories: existing
      ? current.map((selection) => selection.accessoryId === accessoryId
        ? { ...selection, quantity: Math.min(99, selection.quantity + 1), ...(selection.targetPartId || !targetPartId ? {} : { targetPartId }), ...(selection.targetAccessoryId || !targetAccessoryId ? {} : { targetAccessoryId }) }
        : selection)
      : [...current, { accessoryId, quantity: 1, ...(targetPartId ? { targetPartId } : {}), ...(targetAccessoryId ? { targetAccessoryId } : {}) }]
  };
}

function updateAccessoryQuantity(build: BuildSelection, index: number, quantity: number): BuildSelection {
  const nextQuantity = Math.max(1, Math.min(99, Math.floor(quantity || 1)));
  return {
    ...build,
    accessories: accessorySelections(build).map((selection, selectionIndex) => selectionIndex === index ? { ...selection, quantity: nextQuantity } : selection)
  };
}

function updateAccessoryTarget(build: BuildSelection, index: number, targetPartId: string | undefined): BuildSelection {
  return {
    ...build,
    accessories: accessorySelections(build).map((selection, selectionIndex) => {
      if (selectionIndex !== index) return selection;
      const next = { ...selection };
      if (targetPartId) next.targetPartId = targetPartId;
      else delete next.targetPartId;
      return next;
    })
  };
}

function updateAccessoryHubTarget(build: BuildSelection, index: number, targetAccessoryId: string | undefined): BuildSelection {
  return {
    ...build,
    accessories: accessorySelections(build).map((selection, selectionIndex) => {
      if (selectionIndex !== index) return selection;
      const next = { ...selection };
      if (targetAccessoryId) next.targetAccessoryId = targetAccessoryId;
      else delete next.targetAccessoryId;
      return next;
    })
  };
}

function updateRgbControllerTarget(build: BuildSelection, targetAccessoryId: string | undefined): BuildSelection {
  return {
    ...build,
    ...(targetAccessoryId ? { rgbControllerAccessoryId: targetAccessoryId } : { rgbControllerAccessoryId: undefined })
  };
}

function removeAccessoryFromBuild(build: BuildSelection, index: number): BuildSelection {
  return {
    ...build,
    accessories: accessorySelections(build).filter((_, selectionIndex) => selectionIndex !== index)
  };
}

function BootstrapNotice({ issues, online, apiStatus, onRetry, onRetryAll, retryingResource, retryingAll }: { issues: BootstrapIssue[]; online: boolean; apiStatus: ApiStatusDetails; onRetry: (resource: BootstrapResource) => void; onRetryAll: () => void; retryingResource: BootstrapResource | null; retryingAll: boolean }) {
  const apiUnavailable = apiStatus.status === "offline";
  const apiDegraded = apiStatus.status === "degraded";
  const headline = !online ? "네트워크 연결이 끊겼습니다." : apiUnavailable ? "API 서버에 연결할 수 없습니다." : apiDegraded ? "API 서버 응답이 지연되고 있습니다." : "서비스 일부 정보를 불러오지 못했습니다.";
  const description = !online ? "입력한 견적·로컬 프리셋·마지막 성공 결과는 유지됩니다. 연결이 돌아오면 읽기 데이터만 다시 동기화하세요." : apiUnavailable ? "브라우저 연결은 온라인이지만 API 서버 응답을 확인하지 못했습니다. 입력과 로컬 상태는 유지되며 다시 동기화할 수 있습니다." : apiDegraded ? "API 서버가 5xx 응답을 반환했습니다. 잠시 후 실패한 읽기 데이터를 다시 동기화해 주세요." : "이미 입력한 견적은 유지되며, 실패한 항목만 다시 동기화할 수 있습니다.";
  return <div className={online ? "bootstrap-notice" : "bootstrap-notice offline"} role="alert">
    <div className="bootstrap-notice-copy"><FiXCircle /><div><strong>{headline}</strong><p>{description}</p>{apiStatus.fallbackAt && <small className="bootstrap-fallback-note">마지막 확인 데이터 · {new Date(apiStatus.fallbackAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</small>}{issues.length > 0 && <ul>{issues.map((issue) => <li key={issue.resource}><span><strong>{issue.label}</strong>: {issue.message}</span><button className="text-button" type="button" onClick={() => onRetry(issue.resource)} disabled={retryingResource === issue.resource || !online}>{retryingResource === issue.resource ? <><FiLoader className="spin" /> 동기화 중...</> : <><FiRefreshCw /> 다시 동기화</>}</button></li>)}</ul>}{(!online || apiUnavailable || apiDegraded || issues.length > 1) && <button className="button button-small button-light bootstrap-retry-all" type="button" onClick={onRetryAll} disabled={!online || retryingAll}>{retryingAll ? <><FiLoader className="spin" /> 전체 동기화 중...</> : <><FiRefreshCw /> {!online ? "연결 후 전체 다시 동기화" : apiUnavailable ? "API 다시 연결" : apiDegraded ? "API 다시 확인" : "실패 항목 전체 다시 동기화"}</>}</button>}</div></div>
  </div>;
}

function DraftSyncNotice({ build, preferences, onApply, onDismiss }: { build?: BuildSelection; preferences?: RecommendationPreferences; onApply: () => void; onDismiss: () => void }) {
  const sourceBuild = build ?? emptyBuild();
  const selectedCategories = PART_CATEGORIES.filter((category) => selectionList(sourceBuild, category).length > 0).length;
  const selectedParts = PART_CATEGORIES.reduce((count, category) => count + selectionList(sourceBuild, category).length, 0);
  const accessoryCount = accessorySelections(sourceBuild).length;
  const peripheralText = accessoryCount > 0 ? " · 주변 부품 " + accessoryCount + "종" : "";
  const incomingSummary = [
    build ? selectedParts + "개 부품 · " + selectedCategories + "개 범주" + peripheralText : undefined,
    preferences ? "추천 기준 " + RECOMMENDATION_PROFILE_LABELS[preferences.profile] : undefined
  ].filter((value): value is string => Boolean(value)).join(" · ");
  const summaryText = incomingSummary || "변경 내용";
  return <section className="draft-sync-notice" role="status" aria-label="다른 탭 견적 변경 알림"><div className="draft-sync-notice-copy"><FiRefreshCw /><div><strong>다른 탭에서 견적 또는 추천 기준이 변경되었습니다.</strong><p>현재 입력을 자동으로 덮어쓰지 않았습니다. 다른 탭에서 변경된 내용({summaryText})을 확인한 뒤 선택해 주세요.</p></div></div><div className="draft-sync-notice-actions"><button className="button button-small button-primary" type="button" onClick={onApply}>다른 탭 변경 불러오기</button><button className="text-button" type="button" onClick={onDismiss}>현재 입력 유지</button></div></section>;
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
    part.category === "gpu" && part.specs.pciePowerAdapterOptions !== undefined ? formatPciePowerAdapterOptions(part.specs.pciePowerAdapterOptions) : undefined,
    part.category === "gpu" && part.specs.gpuSlotOccupancy !== undefined ? `물리 슬롯 ${part.specs.gpuSlotOccupancy}` : undefined,
    part.category === "gpu" && part.specs.gpuCableBendClearanceMm !== undefined ? `케이블 여유 ${part.specs.gpuCableBendClearanceMm}mm` : undefined,
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
    part.category === "case" && part.specs.caseSidePanelClearanceMm !== undefined ? `케이블 측면 ${part.specs.caseSidePanelClearanceMm}mm` : undefined,
    part.specs.lengthMm ? `${part.specs.lengthMm}mm` : undefined,
    part.specs.formFactor
  ].filter(Boolean);
  return values.join(" · ") || "상세 스펙을 확인할 수 있습니다.";
}

function purchaseListRowsFor(build: BuildSelection, partMap: Map<string, Part>, accessoryMap: Map<string, AccessoryItem>) {
  const rows: PurchaseListRow[] = [];
  for (const category of PART_CATEGORIES) {
    for (const selection of selectionList(build, category)) {
      const part = partMap.get(selection.partId);
      const unitPriceWon = part?.priceWon;
      rows.push({
        id: `part:${category}:${selection.partId}`,
        sourceKind: "part",
        sourceId: selection.partId,
        sourceCategory: category,
        section: "핵심 부품",
        categoryLabel: CATEGORY_LABELS[category],
        name: part?.name ?? selection.partId,
        quantity: selection.quantity,
        ...(unitPriceWon !== undefined ? { unitPriceWon } : {}),
        ...(isKnownPrice(unitPriceWon) ? { totalPriceWon: unitPriceWon * selection.quantity } : {}),
        priceEvidence: part ? catalogPriceEvidenceFor(part) : "unknown",
        ...(part?.dataFreshness ? { dataFreshness: part.dataFreshness } : {}),
        ...(part?.source === "danawa" && part.danawaUrl ? { refreshable: true } : {}),
        listingType: part?.listingType ? LISTING_TYPE_LABELS[part.listingType] : LISTING_TYPE_LABELS.retail,
        ...(part?.danawaUrl ? { sourceUrl: safeExternalUrl(part.danawaUrl) } : {})
      });
    }
  }
  for (const [index, selection] of accessorySelections(build).entries()) {
    const item = accessoryMap.get(selection.accessoryId);
    const unitPriceWon = item?.priceWon;
    const connectionTarget = accessoryConnectionTargetFor(build, selection, item, partMap, accessoryMap);
    rows.push({
      id: `accessory:${selection.accessoryId}:${selection.targetPartId ?? ""}:${selection.targetAccessoryId ?? ""}:${index}`,
      sourceKind: "accessory",
      sourceId: selection.accessoryId,
      ...(item ? { sourceCategory: item.category } : {}),
      section: "주변 부품",
      categoryLabel: item ? ACCESSORY_CATEGORY_LABELS[item.category] : "주변 부품",
      name: item?.name ?? selection.accessoryId,
      quantity: selection.quantity,
      ...(unitPriceWon !== undefined ? { unitPriceWon } : {}),
      ...(isKnownPrice(unitPriceWon) ? { totalPriceWon: unitPriceWon * selection.quantity } : {}),
      priceEvidence: item ? catalogPriceEvidenceFor(item) : "unknown",
      ...(item?.dataFreshness ? { dataFreshness: item.dataFreshness } : {}),
      ...(item?.source === "danawa" && item.danawaUrl ? { refreshable: true } : {}),
      listingType: LISTING_TYPE_LABELS.accessory,
      ...(connectionTarget ? { connectionTarget } : {}),
      ...(item?.danawaUrl ? { sourceUrl: safeExternalUrl(item.danawaUrl) } : {})
    });
  }
  return rows;
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

function AppHeaderLoadingFallback() {
  return <header className="topbar" aria-hidden="true" data-testid="app-header-loading-fallback">
    <div className="topbar-inner">
      <span className="mobile-header-menu"><FiMenu /></span>
      <span className="brand">
        <span className="brand-mark"><FiCpu /></span>
        <span><strong>PC Supporter</strong></span>
      </span>
      <span className="topbar-status loading"><span className="status-dot loading" /> 서비스 동기화 중</span>
    </div>
    <nav className="mobile-bottom-nav" aria-hidden="true">
      <span className="mobile-bottom-nav-item"><FiSearch /><span>검사</span></span>
      <span className="mobile-bottom-nav-item"><FiLayers /><span>카탈로그</span></span>
      <span className="mobile-bottom-nav-item"><span className="mobile-bottom-nav-icon"><FiBookmark /></span><span>저장</span></span>
      <span className="mobile-bottom-nav-item"><FiMoreHorizontal /><span>더보기</span></span>
    </nav>
  </header>;
}

function App() {
  const initialDraftLoad = parseBuildDraftStorage(readBuildDraftStorageRaw());
  const [view, setView] = useState<View>(currentView);
  const [locationKey, setLocationKey] = useState(() => `${window.location.pathname}${window.location.search}${window.location.hash}`);
  const [networkOnline, setNetworkOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [apiStatusDetails, setApiStatusDetails] = useState<ApiStatusDetails>(apiStatusDetailsSnapshot);
  const [build, setBuild] = useState<BuildSelection>(() => initialDraftLoad.build);
  const [result, setResult] = useState<CompatibilityResult | null>(readLastCompatibilityResult);
  const [checkedInputFingerprint, setCheckedInputFingerprint] = useState<string | null>(readLastCompatibilityInputFingerprint);
  const [parts, setParts] = useState<Part[]>([]);
  const [accessoryItems, setAccessoryItems] = useState<AccessoryItem[]>([]);
  const [meta, setMeta] = useState<ServiceMeta | null>(null);
  const [savedBuilds, setSavedBuilds] = useState<SavedBuild[]>([]);
  const [savedBuildMonitorAlerts, setSavedBuildMonitorAlerts] = useState<SavedBuildMonitorAlert[]>(() => savedBuildMonitorAlertsFromJson(window.localStorage.getItem(SAVED_BUILD_MONITOR_ALERTS_STORAGE_KEY)));
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState<BrowserNotificationPermission>(currentBrowserNotificationPermission);
  const [browserNotificationEnabled, setBrowserNotificationEnabled] = useState(() => browserNotificationEnabledFromStorage(window.localStorage.getItem(BROWSER_NOTIFICATION_ENABLED_STORAGE_KEY)));
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [checking, setChecking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatorDraft, setGeneratorDraft] = useState<BuildGenerationResult | null>(null);
  const [generatorVariants, setGeneratorVariants] = useState<GeneratorVariantResult[]>([]);
  const [generatorBudgetLadder, setGeneratorBudgetLadder] = useState<GeneratorBudgetResult[]>([]);
  const [generatorError, setGeneratorError] = useState<string | null>(null);
  const [generatorDiagnostics, setGeneratorDiagnostics] = useState<BuildGenerationDiagnostic[]>([]);
  const [generatorRecoveryOptions, setGeneratorRecoveryOptions] = useState<BuildGenerationRecoveryOption[]>([]);
  const [budgetLadderShares, setBudgetLadderShares] = useState<BudgetLadderLocalShareEntry[]>(() => budgetLadderLocalSharesFromJson(window.localStorage.getItem(BUDGET_LADDER_LOCAL_SHARES_STORAGE_KEY)));
  const [alternativeComparisonShares, setAlternativeComparisonShares] = useState<AlternativeComparisonLocalShareEntry[]>(() => alternativeComparisonLocalSharesFromJson(window.localStorage.getItem(ALTERNATIVE_COMPARISON_LOCAL_SHARES_STORAGE_KEY)));
  const [savedBuildVersionShares, setSavedBuildVersionShares] = useState<SavedBuildVersionLocalShareEntry[]>(() => savedBuildVersionLocalSharesFromJson(window.localStorage.getItem(SAVED_BUILD_VERSION_LOCAL_SHARES_STORAGE_KEY)));
  const localShareMutationContextRef = useRef(0);
  const [toast, setToast] = useState<string | null>(null);
  const [draftRecovery, setDraftRecovery] = useState<BuildDraftLoadResult | null>(() => initialDraftLoad.status === "recovered" ? initialDraftLoad : null);
  const [incomingDraft, setIncomingDraft] = useState<BuildSelection | null>(null);
  const [incomingPreferences, setIncomingPreferences] = useState<RecommendationPreferences | null>(null);
  const [refreshingPartId, setRefreshingPartId] = useState<string | null>(null);
  const [catalogRefreshProgress, setCatalogRefreshProgress] = useState<CatalogRefreshProgress | null>(null);
  const [catalogRefreshReport, setCatalogRefreshReport] = useState<CatalogRefreshReport | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [shareOwnerToken, setShareOwnerToken] = useState<string | null>(null);
  const [revokingShare, setRevokingShare] = useState(false);
  const [recordingCheckId, setRecordingCheckId] = useState<string | null>(null);
  const [openingSavedBuildId, setOpeningSavedBuildId] = useState<string | null>(null);
  const [pendingResultFindingRuleId, setPendingResultFindingRuleId] = useState<string | null>(() => resultFindingRuleFromSearch(window.location.search));
  const [savedCheckHistory, setSavedCheckHistory] = useState<SavedBuildCheckSnapshot[] | null>(null);
  const [shareLoading, setShareLoading] = useState(() => window.location.pathname.startsWith("/share/"));
  const [shareLoadError, setShareLoadError] = useState<string | null>(null);
  const [shareLoadRetryNonce, setShareLoadRetryNonce] = useState(0);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveBuildTarget, setSaveBuildTarget] = useState<SaveBuildTarget | null>(null);
  const [buildImportPreview, setBuildImportPreview] = useState<BuildTransferEnvelope | null>(null);
  const [pendingBuildChange, setPendingBuildChange] = useState<PendingBuildChange | null>(null);
  const [buildChangeDialogComponent, setBuildChangeDialogComponent] = useState<ComponentType<BuildChangeDialogProps> | null>(null);
  const [buildChangeResultComparison, setBuildChangeResultComparison] = useState<BuildChangeResultComparison | null>(null);
  const [scenarioPreview, setScenarioPreview] = useState<BuildScenarioPreviewState | null>(null);
  const [upgradeBundleScenarioPreview, setUpgradeBundleScenarioPreview] = useState<UpgradeBundleScenarioPreviewState | null>(null);
  const [candidateScenarioComparison, setCandidateScenarioComparison] = useState<CandidateScenarioCompareState | null>(null);
  const [saveName, setSaveName] = useState("나의 PC 견적");
  const [saveDecisionNote, setSaveDecisionNote] = useState("");
  const [saveExpiryDays, setSaveExpiryDays] = useState<SavedWatchlistExpiryDays>("never");
  const [metadataEditTarget, setMetadataEditTarget] = useState<SavedBuild | null>(null);
  const [metadataEditName, setMetadataEditName] = useState("");
  const [metadataEditDecisionNote, setMetadataEditDecisionNote] = useState("");
  const [metadataSaving, setMetadataSaving] = useState(false);
  const metadataMutationRequestRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [recommendationPreferences, setRecommendationPreferences] = useState<RecommendationPreferences>(readRecommendationPreferences);
  const [changeHistory, setChangeHistory] = useState<BuildHistoryEntry[]>(readBuildHistory);
  const [bootstrapIssues, setBootstrapIssues] = useState<BootstrapIssue[]>([]);
  const [bootstrapRetryRequest, setBootstrapRetryRequest] = useState<{ nonce: number; resource: BootstrapResource | null }>({ nonce: 0, resource: null });
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const bootstrapIssuesRef = useRef<BootstrapIssue[]>([]);
  const previousInputSnapshotRef = useRef<BuildInputSnapshot | null>(null);
  const currentBuildRef = useRef(build);
  const currentPreferencesRef = useRef(recommendationPreferences);
  const partsRequestRef = useRef(0);
  const metaRefreshRequestRef = useRef(0);
  const savedBuildsRequestRef = useRef(0);
  const skipNextHistoryRef = useRef(false);
  const historySequenceRef = useRef(0);
  const checkRequestSequenceRef = useRef(0);
  const catalogRefreshRequestRef = useRef(0);
  const routeRequestSequenceRef = useRef(0);
  const selectionHydrationAbortControllerRef = useRef<AbortController | null>(null);
  const buildHydrationAbortControllerRef = useRef<AbortController | null>(null);
  const saveBuildRequestRef = useRef(0);
  const savedBuildMutationRequestRef = useRef(0);
  const generatorRequestRef = useRef(0);
  const savedBuildVersionShareInFlightRef = useRef(false);
  const alternativeComparisonShareInFlightRef = useRef(new Set<string>());
  const alternativeComparisonRevokeInFlightRef = useRef(new Map<string, number>());
  const savedBuildVersionRevokeInFlightRef = useRef(new Set<string>());
  const buildChangeDialogRequestRef = useRef(0);
  const scenarioRequestSequenceRef = useRef(0);
  const openingSavedBuildIdRef = useRef<string | null>(null);
  const openingSavedBuildRequestRef = useRef(0);
  const savedBuildServerAlertSyncVersionRef = useRef(0);
  const deliveredBrowserNotificationIdsRef = useRef(new Set(browserNotificationIdsFromJson(window.localStorage.getItem(BROWSER_NOTIFICATION_DELIVERED_STORAGE_KEY))));

  const partMap = useMemo(() => new Map(parts.map((part) => [part.id, part])), [parts]);
  const accessoryMap = useMemo(() => new Map(accessoryItems.map((item) => [item.id, item])), [accessoryItems]);
  const savedBuildUnreadAlertCount = useMemo(() => savedBuildMonitorAlerts.filter((alert) => savedBuildMonitorAlertMatches(alert, "unread")).length, [savedBuildMonitorAlerts]);
  const ownerSavedBuildKey = useMemo(() => savedBuilds.filter((saved) => Boolean(readSavedBuildOwnerToken(saved.id))).map((saved) => saved.id).join(","), [savedBuilds]);
  const ownerSavedBuildContextKey = useMemo(() => savedBuilds
    .filter((saved) => Boolean(readSavedBuildOwnerToken(saved.id)))
    .map((saved) => `${saved.id}:${saved.updatedAt}:${readSavedBuildOwnerToken(saved.id) ?? ""}`)
    .join("|"), [savedBuilds]);
  const currentInputFingerprint = useMemo(
    () => buildCompatibilityInputFingerprint(build, recommendationPreferences),
    [build, recommendationPreferences]
  );
  const resultIsStale = Boolean(result) && checkedInputFingerprint !== currentInputFingerprint;

  const refreshMeta = useCallback(async () => {
    const requestVersion = ++metaRefreshRequestRef.current;
    try {
      const nextMeta = await api<ServiceMeta>("/api/meta");
      if (metaRefreshRequestRef.current === requestVersion) setMeta(nextMeta);
    } catch {
      // Meta refresh is best effort; keep the current snapshot until a newer
      // request succeeds or bootstrap retry is requested.
    }
  }, []);

  useEffect(() => {
    bootstrapIssuesRef.current = bootstrapIssues;
  }, [bootstrapIssues]);

  useEffect(() => {
    const onOnline = () => {
      setNetworkOnline(true);
      if (bootstrapIssuesRef.current.length > 0) setBootstrapRetryRequest((current) => ({ resource: null, nonce: current.nonce + 1 }));
    };
    const onOffline = () => setNetworkOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => subscribeApiStatus(setApiStatusDetails), []);

  useEffect(() => {
    currentBuildRef.current = build;
  }, [build]);

  useEffect(() => {
    currentPreferencesRef.current = recommendationPreferences;
  }, [recommendationPreferences]);

  useEffect(() => {
    const onDraftStorage = (event: StorageEvent) => {
      if (event.key === BUILD_DRAFT_STORAGE_KEY) {
        const sync = buildDraftSyncFor(currentBuildRef.current, event.newValue);
        if (sync.status === "changed") setIncomingDraft(sync.build);
      }
      if (event.key === "pc-supporter-recommendation-preferences") {
        const sync = recommendationPreferencesSyncFor(currentPreferencesRef.current, event.newValue);
        if (sync.status === "changed") setIncomingPreferences(sync.preferences);
      }
      if (event.key === SAVED_BUILD_IDS_STORAGE_KEY) {
        void refreshSavedBuildsForBrowser()
          .catch(() => {
            // A different tab may save while the API is temporarily unavailable.
            // Keep the current list and let the normal bootstrap/retry path recover it.
          });
      }
      if (event.key === SAVED_BUILD_METADATA_SYNC_STORAGE_KEY) {
        void refreshSavedBuildsForBrowser()
          .catch(() => {
            // Metadata edits are best effort across tabs; the editing tab already has the response.
          });
      }
      if (event.key === SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY) {
        void refreshSavedBuildsForBrowser()
          .catch(() => {
            // Owner-token rotation is best effort across tabs; the owning tab already has the response.
          });
      }
    };
    window.addEventListener("storage", onDraftStorage);
    return () => window.removeEventListener("storage", onDraftStorage);
  }, []);

  useEffect(() => {
    if (!draftRecovery) return;
    let backupSaved = false;
    try {
      const raw = readBuildDraftStorageRaw();
      if (raw && raw.length <= INVALID_BUILD_DRAFT_BACKUP_MAX_BYTES) {
        window.localStorage.setItem(INVALID_BUILD_DRAFT_BACKUP_STORAGE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), errors: draftRecovery.errors, raw }));
        backupSaved = true;
      }
    } catch {
      // A broken or full local storage bucket must not prevent safe recovery.
    }
    setToast(backupSaved ? "저장된 견적 형식을 읽지 못해 안전한 빈 견적으로 복구했습니다. 기존 값은 브라우저 백업에 보관했습니다." : "저장된 견적 형식을 읽지 못해 안전한 빈 견적으로 복구했습니다.");
    setDraftRecovery(null);
  }, [draftRecovery]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SAVED_BUILD_MONITOR_ALERTS_STORAGE_KEY, savedBuildMonitorAlertsToJson(savedBuildMonitorAlerts));
    } catch {
      // A full local storage bucket must not prevent the rest of the service from working.
    }
  }, [savedBuildMonitorAlerts]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === SAVED_BUILD_MONITOR_ALERTS_STORAGE_KEY) setSavedBuildMonitorAlerts(savedBuildMonitorAlertsFromJson(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(BUDGET_LADDER_LOCAL_SHARES_STORAGE_KEY, budgetLadderLocalSharesToJson(budgetLadderShares));
    } catch {
      // A full local storage bucket must not prevent the rest of the service from working.
    }
  }, [budgetLadderShares]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === BUDGET_LADDER_LOCAL_SHARES_STORAGE_KEY) {
        localShareMutationContextRef.current += 1;
        setBudgetLadderShares(budgetLadderLocalSharesFromJson(event.newValue));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ALTERNATIVE_COMPARISON_LOCAL_SHARES_STORAGE_KEY, alternativeComparisonLocalSharesToJson(alternativeComparisonShares));
    } catch {
      // A full local storage bucket must not prevent the comparison workflow from working.
    }
  }, [alternativeComparisonShares]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === ALTERNATIVE_COMPARISON_LOCAL_SHARES_STORAGE_KEY) {
        localShareMutationContextRef.current += 1;
        setAlternativeComparisonShares(alternativeComparisonLocalSharesFromJson(event.newValue));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SAVED_BUILD_VERSION_LOCAL_SHARES_STORAGE_KEY, savedBuildVersionLocalSharesToJson(savedBuildVersionShares));
    } catch {
      // A full local storage bucket must not prevent the version comparison workflow from working.
    }
  }, [savedBuildVersionShares]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === SAVED_BUILD_VERSION_LOCAL_SHARES_STORAGE_KEY) {
        localShareMutationContextRef.current += 1;
        setSavedBuildVersionShares(savedBuildVersionLocalSharesFromJson(event.newValue));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(BROWSER_NOTIFICATION_ENABLED_STORAGE_KEY, String(browserNotificationEnabled));
    } catch {
      // Browser notification preference is optional and must not block the service.
    }
  }, [browserNotificationEnabled]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== BROWSER_NOTIFICATION_ENABLED_STORAGE_KEY) return;
      setBrowserNotificationEnabled(browserNotificationEnabledFromStorage(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const refreshPermission = () => setBrowserNotificationPermission(currentBrowserNotificationPermission());
    window.addEventListener("focus", refreshPermission);
    document.addEventListener("visibilitychange", refreshPermission);
    return () => {
      window.removeEventListener("focus", refreshPermission);
      document.removeEventListener("visibilitychange", refreshPermission);
    };
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== BROWSER_NOTIFICATION_DELIVERED_STORAGE_KEY) return;
      const delivered = deliveredBrowserNotificationIdsRef.current;
      delivered.clear();
      browserNotificationIdsFromJson(event.newValue).forEach((id) => delivered.add(id));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!browserNotificationEnabled || browserNotificationPermission !== "granted" || !("Notification" in window)) return;
    const delivered = deliveredBrowserNotificationIdsRef.current;
    const newAlerts = savedBuildMonitorAlerts.filter((alert) => !alert.readAt && !alert.dismissedAt && !delivered.has(alert.id));
    if (newAlerts.length === 0) return;
    const deliveredNow: string[] = [];
    for (const alert of newAlerts) {
      try {
        const notification = new window.Notification(`PC Supporter · ${alert.buildName}`, {
          body: `${alert.title} · ${alert.message}${alert.findingTitles && alert.findingTitles.length > 0 ? ` · 영향받는 항목: ${alert.findingTitles.slice(0, 2).join(", ")}` : ""}`,
          tag: alert.id
        });
        notification.onclick = () => {
          notification.close();
          window.focus();
          const findingRuleId = alert.findingRuleIds?.[0];
          const findingQuery = findingRuleId ? `?findingRule=${encodeURIComponent(findingRuleId)}` : "";
          window.location.assign(`/share/${encodeURIComponent(alert.buildId)}${findingQuery}#findings`);
        };
        deliveredNow.push(alert.id);
      } catch {
        // Permission can change between the state check and constructor call.
      }
    }
    if (deliveredNow.length > 0) {
      const nextDelivered = mergeBrowserNotificationIds([...delivered], deliveredNow);
      delivered.clear();
      nextDelivered.forEach((id) => delivered.add(id));
      try {
        window.localStorage.setItem(BROWSER_NOTIFICATION_DELIVERED_STORAGE_KEY, browserNotificationIdsToJson(nextDelivered));
      } catch {
        // Delivery ledger persistence is best effort.
      }
    }
  }, [browserNotificationEnabled, browserNotificationPermission, savedBuildMonitorAlerts]);

  useEffect(() => {
    if (!ownerSavedBuildKey) return;
    let cancelled = false;
    const syncVersion = ++savedBuildServerAlertSyncVersionRef.current;
    let syncRunning = false;
    const syncServerAlerts = async () => {
      if (cancelled || syncRunning) return;
      syncRunning = true;
      try {
        const ownerIds = ownerSavedBuildKey.split(",").filter(Boolean);
        const values = await Promise.all(ownerIds.map(async (id) => {
          const token = readSavedBuildOwnerToken(id);
          if (!token) return undefined;
          try {
            return await api<SavedBuildMonitorSubscriptionResponse>(`/api/builds/${encodeURIComponent(id)}/monitor`, { headers: { "X-Share-Owner-Token": token }, retry: 1 });
          } catch {
            return undefined;
          }
        }));
        if (cancelled || savedBuildServerAlertSyncVersionRef.current !== syncVersion) return;
        const serverAlerts = values.flatMap((value) => value?.subscription.alerts ?? []);
        setSavedBuildMonitorAlerts((current) => {
          const next = mergeSavedBuildMonitorAlerts(current, serverAlerts);
          return JSON.stringify(next) === JSON.stringify(current) ? current : next;
        });
      } finally {
        syncRunning = false;
      }
    };
    void syncServerAlerts();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncServerAlerts();
    }, SAVED_BUILD_SERVER_ALERT_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ownerSavedBuildContextKey]);

  useEffect(() => {
    const currentSnapshot: BuildInputSnapshot = { build, recommendationPreferences };
    const previousSnapshot = previousInputSnapshotRef.current;
    previousInputSnapshotRef.current = currentSnapshot;
    if (!previousSnapshot) return;
    if (skipNextHistoryRef.current) {
      skipNextHistoryRef.current = false;
      return;
    }
    const previousFingerprint = buildCompatibilityInputFingerprint(previousSnapshot.build, previousSnapshot.recommendationPreferences);
    if (previousFingerprint === currentInputFingerprint) return;
    historySequenceRef.current += 1;
    const entry: BuildHistoryEntry = {
      id: `${Date.now()}-${historySequenceRef.current}`,
      label: buildInputChangeLabel(previousSnapshot, currentSnapshot),
      snapshot: previousSnapshot,
      changedAt: new Date().toISOString()
    };
    setChangeHistory((current) => appendBuildHistoryEntry(current, entry, currentSnapshot));
  }, [build, recommendationPreferences, currentInputFingerprint]);

  function rememberParts(nextParts: Part[]) {
    if (nextParts.length === 0) return;
    setParts((current) => mergeCatalogRecords(current, nextParts));
  }

  function rememberAccessories(nextItems: AccessoryItem[]) {
    if (nextItems.length === 0) return;
    setAccessoryItems((current) => mergeCatalogRecords(current, nextItems));
  }

  function rememberSavedBuildId(id: string) {
    if (!id.trim()) return;
    writeSavedBuildIds([id, ...readSavedBuildIds()]);
  }

  async function loadSavedBuildsForBrowser() {
    const ids = readSavedBuildIds();
    if (ids.length === 0) return { items: [] as SavedBuild[] };
    const payload = await api<{ items: SavedBuild[] }>(`/api/builds?ids=${encodeURIComponent(ids.join(","))}`);
    return payload;
  }

  async function refreshSavedBuildsForBrowser(): Promise<boolean> {
    const requestVersion = ++savedBuildsRequestRef.current;
    const routeRequestSequence = routeRequestSequenceRef.current;
    const payload = await loadSavedBuildsForBrowser();
    if (savedBuildsRequestRef.current !== requestVersion || routeRequestSequenceRef.current !== routeRequestSequence) return false;
    writeSavedBuildIds(payload.items.map((item) => item.id));
    setSavedBuilds(payload.items);
    return true;
  }

  function invalidateSavedBuildReads() {
    savedBuildsRequestRef.current += 1;
  }

  function abortSelectionHydration() {
    selectionHydrationAbortControllerRef.current?.abort();
    buildHydrationAbortControllerRef.current?.abort();
  }

  async function rememberBuildSelection(nextBuild: BuildSelection, signal?: AbortSignal) {
    await hydrateBuildSelection(nextBuild, partMap, accessoryMap, api, rememberParts, rememberAccessories, signal);
  }

  function openBuildChangePreview(title: string, summary: string, nextBuild: BuildSelection, extraParts: Part[] = [], candidateEvidence?: CandidateApplicationEvidence) {
    const knownParts = new Map([...parts, ...extraParts].map((part) => [part.id, part]));
    const diff = buildTransferDiffFor(
      build,
      recommendationPreferences,
      nextBuild,
      recommendationPreferences,
      {
        partName: (partId) => knownParts.get(partId)?.name,
        accessoryName: (accessoryId) => accessoryMap.get(accessoryId)?.name
      }
    );
    if (diff.rows.length === 0) {
      setToast("적용할 변경 사항이 없습니다.");
      return;
    }
    const candidateReview = candidateApplicationReviewFor(candidateEvidence);
    setPendingBuildChange({
      title,
      summary,
      nextBuild,
      rows: diff.rows,
      beforePrice: buildPriceSnapshotFor(build, partMap, accessoryMap, extraParts),
      afterPrice: buildPriceSnapshotFor(nextBuild, partMap, accessoryMap, extraParts),
      budgetWon: recommendationPreferences.budgetWon,
      ...(result ? { beforeResult: result } : {}),
      ...(candidateReview ? { candidateReview } : {})
    });
  }

  async function confirmBuildChange() {
    const pending = pendingBuildChange;
    if (!pending || checking) return;
    const routeRequestSequence = routeRequestSequenceRef.current;
    setPendingBuildChange(null);
    await rememberBuildSelection(pending.nextBuild);
    if (routeRequestSequenceRef.current !== routeRequestSequence) return;
    const checked = await checkBuild(pending.nextBuild);
    if (!checked) return;
    setToast(`${pending.title} 적용 후 다시 검사했습니다.`);
    if (checked && pending.beforeResult) {
      setBuildChangeResultComparison({ title: pending.title, summary: pending.summary, rows: pending.rows, beforeResult: pending.beforeResult, afterResult: checked });
    }
  }

  useEffect(() => {
    if (view !== "result" || !result) return;
    void import("./BuildChangeDecisionDialog").catch(() => undefined);
  }, [result, view]);

  useEffect(() => {
    const requestVersion = ++buildChangeDialogRequestRef.current;
    if (!pendingBuildChange) {
      setBuildChangeDialogComponent(null);
      return;
    }
    let cancelled = false;
    setBuildChangeDialogComponent(null);
    void import("./BuildChangeDecisionDialog")
      .then((module) => {
        if (!cancelled && buildChangeDialogRequestRef.current === requestVersion) {
          setBuildChangeDialogComponent(() => module.BuildChangeDecisionDialog);
        }
      })
      .catch(() => {
        if (!cancelled && buildChangeDialogRequestRef.current === requestVersion) setBuildChangeDialogComponent(null);
      });
    return () => { cancelled = true; };
  }, [pendingBuildChange]);

  useEffect(() => {
    let cancelled = false;
    setBootstrapLoading(true);
    const requestedResource = bootstrapRetryRequest.resource;
    setBootstrapIssues((current) => requestedResource ? current.filter((issue) => issue.resource !== requestedResource) : []);
    const loadResource = async <T,>(resource: BootstrapResource, label: string, request: Promise<T>, onSuccess: (value: T) => void) => {
      const requestVersion = resource === "parts"
        ? ++partsRequestRef.current
        : resource === "meta"
          ? ++metaRefreshRequestRef.current
          : ++savedBuildsRequestRef.current;
      const requestIsCurrent = () => resource === "parts"
        ? partsRequestRef.current === requestVersion
        : resource === "meta"
          ? metaRefreshRequestRef.current === requestVersion
          : savedBuildsRequestRef.current === requestVersion;
      try {
        const value = await request;
        if (!cancelled && requestIsCurrent()) {
          onSuccess(value);
          setBootstrapIssues((current) => current.filter((issue) => issue.resource !== resource));
        }
      } catch (error: unknown) {
        if (!cancelled && requestIsCurrent()) {
          const message = error instanceof Error ? error.message : "알 수 없는 오류";
          setBootstrapIssues((current) => [...current.filter((issue) => issue.resource !== resource), { resource, label, message }]);
        }
      }
    };
    const tasks: Array<Promise<void>> = [];
    if (!requestedResource || requestedResource === "parts") {
      tasks.push(loadResource("parts", "부품 목록", api<{ items: Part[] }>("/api/parts?limit=100"), (payload) => rememberParts(payload.items)));
    }
    if (!requestedResource || requestedResource === "meta") {
      tasks.push(loadResource("meta", "서비스 메타데이터", api<ServiceMeta>("/api/meta"), setMeta));
    }
    if (!requestedResource || requestedResource === "savedBuilds") {
      tasks.push(loadResource("savedBuilds", "저장 견적", loadSavedBuildsForBrowser(), (payload) => {
        writeSavedBuildIds(payload.items.map((item) => item.id));
        setSavedBuilds(payload.items);
      }));
    }
    void Promise.all(tasks).finally(() => {
      if (!cancelled) setBootstrapLoading(false);
    });
    return () => { cancelled = true; };
  }, [bootstrapRetryRequest]);

  useEffect(() => {
    const hydrationController = new AbortController();
    buildHydrationAbortControllerRef.current = hydrationController;
    void rememberBuildSelection(build, hydrationController.signal).catch(() => {
      // Draft hydration is best effort; route-owned cancellation must not surface
      // as an editor error.
    });
    return () => {
      hydrationController.abort();
      if (buildHydrationAbortControllerRef.current === hydrationController) buildHydrationAbortControllerRef.current = null;
    };
  }, [build]);

  useEffect(() => {
    const onPopState = () => {
      const nextView = currentView();
      abortSelectionHydration();
      routeRequestSequenceRef.current += 1;
      checkRequestSequenceRef.current += 1;
      catalogRefreshRequestRef.current += 1;
      generatorRequestRef.current += 1;
      saveBuildRequestRef.current += 1;
      savedBuildMutationRequestRef.current += 1;
      metadataMutationRequestRef.current += 1;
      setChecking(false);
      setRefreshingPartId(null);
      setCatalogRefreshProgress(null);
      setSaving(false);
      setSaveDialogOpen(false);
      setSaveBuildTarget(null);
      resetRouteTransientState();
      setRevokingShare(false);
      setRecordingCheckId(null);
      setMetadataSaving(false);
      setMetadataEditTarget(null);
      openingSavedBuildRequestRef.current += 1;
      openingSavedBuildIdRef.current = null;
      setOpeningSavedBuildId(null);
      setGenerating(false);
      setView(nextView);
      setLocationKey(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(BUILD_DRAFT_STORAGE_KEY, JSON.stringify(build));
    } catch {
      // Draft persistence is best effort; a blocked or full storage bucket must not stop the editor.
    }
  }, [build]);

  useEffect(() => {
    window.localStorage.setItem("pc-supporter-recommendation-preferences", JSON.stringify(recommendationPreferences));
  }, [recommendationPreferences]);

  useEffect(() => {
    try {
      if (result) window.sessionStorage.setItem("pc-supporter-last-compatibility-result", JSON.stringify(result));
      else window.sessionStorage.removeItem("pc-supporter-last-compatibility-result");
      if (result && checkedInputFingerprint) window.sessionStorage.setItem("pc-supporter-last-compatibility-input", checkedInputFingerprint);
      else window.sessionStorage.removeItem("pc-supporter-last-compatibility-input");
    } catch {
      // A full session storage bucket must not prevent the editor from working.
    }
  }, [result, checkedInputFingerprint]);

  useEffect(() => {
    try {
      if (changeHistory.length > 0) window.sessionStorage.setItem("pc-supporter-build-history", JSON.stringify(changeHistory));
      else window.sessionStorage.removeItem("pc-supporter-build-history");
    } catch {
      // A full session storage bucket must not prevent the editor from working.
    }
  }, [changeHistory]);

  useEffect(() => {
    const match = window.location.pathname.match(/^\/share\/([^/]+)/);
    if (!match) {
      setShareLoading(false);
      setShareLoadError(null);
      if (!window.location.pathname.startsWith("/result")) {
        setShareId(null);
        setShareExpiresAt(null);
        setShareOwnerToken(null);
      }
      return;
    }
    const sharePath = `/share/${match[1]}`;
    let cancelled = false;
    const isActive = () => !cancelled && window.location.pathname === sharePath;
    setShareLoading(true);
    setShareLoadError(null);
    setShareOwnerToken(null);
    void api<SavedBuild>(`/api/builds/${encodeURIComponent(match[1])}`)
      .then(async (saved) => {
        if (!isActive()) return;
        const nextPreferences = saved.recommendationPreferences ?? recommendationPreferences;
        setShareId(match[1]);
        setShareExpiresAt(saved.expiresAt ?? null);
        setShareOwnerToken(readSavedBuildOwnerToken(saved.id) ?? null);
        rememberSavedBuildId(saved.id);
        setSavedBuilds((current) => [saved, ...current.filter((item) => item.id !== saved.id)].slice(0, 20));
        setBuild(saved.selection);
        setRecommendationPreferences(nextPreferences);
        await rememberBuildSelection(saved.selection);
        if (!isActive()) return;
        const checked = await api<CompatibilityResult>("/api/compatibility/check", {
          method: "POST",
          body: JSON.stringify({ ...saved.selection, recommendationPreferences: nextPreferences }),
          retry: 2,
          retryOnRateLimit: true
        });
        if (!isActive()) return;
        setResult(checked);
        setSavedCheckHistory(saved.checkHistory ?? (saved.checkSnapshot ? [saved.checkSnapshot] : null));
        setCheckedInputFingerprint(buildCompatibilityInputFingerprint(saved.selection, nextPreferences));
        setCheckError(null);
        setShareLoadError(null);
        setView("result");
      })
      .catch((error: unknown) => {
        if (!isActive()) return;
        const message = error instanceof Error ? error.message : "공유 견적을 불러오지 못했습니다.";
        setShareLoadError(message);
        setCheckError(message);
        setToast(message);
      })
      .finally(() => { if (isActive()) setShareLoading(false); });
    return () => { cancelled = true; };
  }, [locationKey, shareLoadRetryNonce]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function requestBrowserNotifications() {
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => routeRequestSequenceRef.current === routeRequestSequence;
    if (!("Notification" in window)) {
      if (!isCurrent()) return;
      setBrowserNotificationPermission("unsupported");
      setToast("이 브라우저는 데스크톱 알림을 지원하지 않습니다.");
      return;
    }
    try {
      const permission = await window.Notification.requestPermission();
      if (!isCurrent()) return;
      const normalized = browserNotificationPermissionFromUnknown(permission);
      setBrowserNotificationPermission(normalized);
      if (normalized === "granted") {
        setBrowserNotificationEnabled(true);
        setToast("브라우저 데스크톱 알림을 허용했습니다. 새 저장 견적 위험을 알려드립니다.");
      } else if (normalized === "denied") {
        setBrowserNotificationEnabled(false);
        setToast("브라우저 알림이 차단되었습니다. 브라우저 설정에서 허용할 수 있습니다.");
      } else {
        setToast("브라우저 알림 권한을 완료하지 못했습니다.");
      }
    } catch {
      if (isCurrent()) setToast("브라우저 알림 권한을 요청하지 못했습니다.");
    }
  }

  function navigate(path: string, nextView: View, options: { preservePendingCheck?: boolean; preserveCatalogRefresh?: boolean } = {}) {
    abortSelectionHydration();
    routeRequestSequenceRef.current += 1;
    if (!options.preservePendingCheck) {
      checkRequestSequenceRef.current += 1;
      setChecking(false);
    }
    if (!options.preserveCatalogRefresh) {
      catalogRefreshRequestRef.current += 1;
      setRefreshingPartId(null);
      setCatalogRefreshProgress(null);
    }
    saveBuildRequestRef.current += 1;
    savedBuildMutationRequestRef.current += 1;
    metadataMutationRequestRef.current += 1;
    setSaving(false);
    setSaveDialogOpen(false);
    setSaveBuildTarget(null);
    resetRouteTransientState();
    setRevokingShare(false);
    setRecordingCheckId(null);
    setMetadataSaving(false);
    setMetadataEditTarget(null);
    openingSavedBuildRequestRef.current += 1;
    openingSavedBuildIdRef.current = null;
    setOpeningSavedBuildId(null);
    if (nextView !== "generator") {
      generatorRequestRef.current += 1;
      setGenerating(false);
    }
    window.history.pushState({}, "", path);
    setView(nextView);
    setLocationKey(path);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function openGenerator(priority?: RecommendationPriority) {
    generatorRequestRef.current += 1;
    setGenerating(false);
    setGeneratorDraft(null);
    setGeneratorVariants([]);
    setGeneratorBudgetLadder([]);
    setGeneratorError(null);
    setGeneratorDiagnostics([]);
    setGeneratorRecoveryOptions([]);
    navigate(`/recommend${priority ? `?priority=${encodeURIComponent(priority)}` : ""}`, "generator");
  }

  function resetRouteTransientState() {
    scenarioRequestSequenceRef.current += 1;
    setToast(null);
    setPicker(null);
    setBuildImportPreview(null);
    setPendingBuildChange(null);
    setScenarioPreview(null);
    setUpgradeBundleScenarioPreview(null);
    setCandidateScenarioComparison(null);
  }

  function openPurchaseListItem(row: PurchaseListRow) {
    const sourceId = row.sourceId?.trim();
    if (!sourceId || !row.sourceKind) {
      setToast("이 구매 항목의 카탈로그 상세를 찾을 수 없습니다.");
      return;
    }
    if (row.sourceKind === "part") {
      const category = PART_CATEGORIES.includes(row.sourceCategory as PartCategory) ? row.sourceCategory as PartCategory : undefined;
      if (!category) {
        setToast("핵심 부품 분류를 확인할 수 없어 카탈로그 상세를 열지 못했습니다.");
        return;
      }
      navigate(`/catalog?category=${encodeURIComponent(category)}&partId=${encodeURIComponent(sourceId)}`, "catalog");
      return;
    }
    navigate(`/accessories?itemId=${encodeURIComponent(sourceId)}`, "accessories");
  }

  function rememberBudgetLadderShare(entry: BudgetLadderLocalShareEntry) {
    setBudgetLadderShares((current) => budgetLadderLocalShareRemember(current, entry));
  }

  function forgetBudgetLadderShare(id: string) {
    setBudgetLadderShares((current) => budgetLadderLocalShareRemove(current, id));
  }

  function rememberAlternativeComparisonShare(entry: AlternativeComparisonLocalShareEntry) {
    setAlternativeComparisonShares((current) => alternativeComparisonLocalShareRemember(current, entry));
  }

  function forgetAlternativeComparisonShare(id: string) {
    setAlternativeComparisonShares((current) => alternativeComparisonLocalShareRemove(current, id));
  }

  function rememberSavedBuildVersionShare(entry: SavedBuildVersionLocalShareEntry) {
    setSavedBuildVersionShares((current) => savedBuildVersionLocalShareRemember(current, entry));
  }

  function forgetSavedBuildVersionShare(id: string) {
    setSavedBuildVersionShares((current) => savedBuildVersionLocalShareRemove(current, id));
  }

  async function copyAlternativeComparisonShare(entry: AlternativeComparisonLocalShareEntry) {
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => routeRequestSequenceRef.current === routeRequestSequence;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(entry.url);
      if (!isCurrent()) return;
      setToast("부품 비교 공유 링크를 복사했어요.");
    } catch {
      if (isCurrent()) setToast(`부품 비교 공유 링크: ${entry.url}`);
    }
  }

  async function copyBudgetLadderShare(entry: BudgetLadderLocalShareEntry) {
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => routeRequestSequenceRef.current === routeRequestSequence;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(entry.url);
      if (!isCurrent()) return;
      setToast("예산 비교 공유 링크를 복사했습니다.");
    } catch {
      if (isCurrent()) setToast(`예산 비교 공유 링크: ${entry.url}`);
    }
  }

  async function copySavedBuildVersionShare(entry: SavedBuildVersionLocalShareEntry) {
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => routeRequestSequenceRef.current === routeRequestSequence;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(entry.url);
      if (!isCurrent()) return;
      setToast("견적 버전 비교 공유 링크를 복사했습니다.");
    } catch {
      if (isCurrent()) setToast(`견적 버전 비교 공유 링크: ${entry.url}`);
    }
  }

  function importSavedWatchlist(saved: SavedCatalogWatchlist) {
    try {
      const current = catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY));
      window.localStorage.setItem(CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistToJson(mergeCatalogWatchEntries(current, saved.entries)));
      window.localStorage.setItem(CATALOG_WATCH_THRESHOLD_STORAGE_KEY, String(saved.nearLowThresholdPercent));
      setToast(`${saved.entries.length}개 저장 관심 가격 항목을 내 목록에 병합했습니다.`);
      navigate("/admin", "admin");
    } catch {
      setToast("저장된 관심 가격 목록을 내 브라우저에 반영하지 못했습니다.");
    }
  }

  async function checkBuild(nextBuild = build, nextPreferences = recommendationPreferences, options: { catalogRefreshRequest?: number } = {}) {
    if (options.catalogRefreshRequest === undefined) {
      catalogRefreshRequestRef.current += 1;
      setRefreshingPartId(null);
      setCatalogRefreshProgress(null);
    } else if (catalogRefreshRequestRef.current !== options.catalogRefreshRequest) {
      return undefined;
    }
    const requestSequence = ++checkRequestSequenceRef.current;
    const routeRequestSequence = routeRequestSequenceRef.current;
    scenarioRequestSequenceRef.current += 1;
    setScenarioPreview(null);
    setCandidateScenarioComparison(null);
    setBuildChangeResultComparison(null);
    setChecking(true);
    setCheckError(null);
    setCatalogRefreshReport(null);
    selectionHydrationAbortControllerRef.current?.abort();
    const hydrationController = new AbortController();
    selectionHydrationAbortControllerRef.current = hydrationController;
    try {
      await rememberBuildSelection(nextBuild, hydrationController.signal);
      if (checkRequestSequenceRef.current !== requestSequence || routeRequestSequenceRef.current !== routeRequestSequence) return;
      const checked = await api<CompatibilityResult>("/api/compatibility/check", {
        method: "POST",
        body: JSON.stringify({ ...nextBuild, recommendationPreferences: nextPreferences }),
        retry: 2,
        retryOnRateLimit: true,
        signal: hydrationController.signal
      });
      if (checkRequestSequenceRef.current !== requestSequence || routeRequestSequenceRef.current !== routeRequestSequence) return;
      setBuild(nextBuild);
      setResult(checked);
      setSavedCheckHistory(null);
      setCheckedInputFingerprint(buildCompatibilityInputFingerprint(nextBuild, nextPreferences));
      setCheckError(null);
      setChecking(false);
      navigate("/result", "result", { preservePendingCheck: true, preserveCatalogRefresh: options.catalogRefreshRequest !== undefined });
      return checked;
    } catch (error: unknown) {
      if (checkRequestSequenceRef.current !== requestSequence || routeRequestSequenceRef.current !== routeRequestSequence) return;
      const message = error instanceof Error ? error.message : "검사에 실패했습니다.";
      setCheckError(message);
      setToast(message);
      return undefined;
    } finally {
      if (selectionHydrationAbortControllerRef.current === hydrationController) selectionHydrationAbortControllerRef.current = null;
      if (checkRequestSequenceRef.current === requestSequence && routeRequestSequenceRef.current === routeRequestSequence) setChecking(false);
    }
  }

  async function refreshCatalogTarget(target: RefreshTarget) {
    if (target.kind === "part") {
      const previousPart = partMap.get(target.id);
      const payload = await api<PartRefreshResponse>(`/api/parts/${encodeURIComponent(target.id)}/refresh`, { method: "POST", retry: 0 });
      rememberParts([payload.part]);
      const reportItem: CatalogRefreshReportItem = { target, name: payload.part.name, changedFields: payload.changedFields, ...(payload.valueDiffs && payload.valueDiffs.length > 0 ? { valueDiffs: payload.valueDiffs } : {}), refreshedAt: payload.refreshedAt, previousDataQuality: payload.previousDataQuality, nextDataQuality: payload.part.dataQuality, previousMissingCount: payload.previousMissingFields.length, nextMissingCount: payload.part.missingFields.length, previousPriceWon: previousPart?.priceWon, nextPriceWon: payload.part.priceWon };
      return { name: payload.part.name, changedFields: payload.changedFields, reportItem };
    }
    const previousAccessory = accessoryMap.get(target.id);
    const payload = await api<AccessoryRefreshResponse>(`/api/accessories/${encodeURIComponent(target.id)}/refresh`, { method: "POST", retry: 0 });
    rememberAccessories([payload.item]);
    const reportItem: CatalogRefreshReportItem = { target, name: payload.item.name, changedFields: payload.changedFields, ...(payload.valueDiffs && payload.valueDiffs.length > 0 ? { valueDiffs: payload.valueDiffs } : {}), refreshedAt: payload.refreshedAt, previousDataQuality: payload.previousDataQuality, nextDataQuality: payload.item.dataQuality, previousMissingCount: payload.previousMissingFields.length, nextMissingCount: payload.item.missingFields.length, previousPriceWon: previousAccessory?.priceWon, nextPriceWon: payload.item.priceWon };
    return { name: payload.item.name, changedFields: payload.changedFields, reportItem };
  }

  function catalogRefreshTargetName(target: RefreshTarget) {
    const item = target.kind === "part" ? partMap.get(target.id) : accessoryMap.get(target.id);
    return item?.name ?? (target.kind === "part" ? "핵심 부품" : "주변 부품");
  }

  async function refreshCatalogItem(target: RefreshTarget) {
    if (refreshingPartId) return;
    const refreshRequest = ++catalogRefreshRequestRef.current;
    const isCurrent = () => catalogRefreshRequestRef.current === refreshRequest;
    setRefreshingPartId(target.id);
    setCatalogRefreshProgress({ requestedCount: 1, completedCount: 0, successCount: 0, failureCount: 0, currentName: catalogRefreshTargetName(target) });
    const inputFingerprint = buildCompatibilityInputFingerprint(build, recommendationPreferences);
    try {
      const refreshed = await refreshCatalogTarget(target);
      if (!isCurrent()) return;
      const report: CatalogRefreshReport = { inputFingerprint, status: "success", requestedCount: 1, successCount: 1, failureCount: 0, items: [refreshed.reportItem], failures: [], completedAt: new Date().toISOString() };
      setCheckedInputFingerprint(null);
      void refreshMeta();
      const changedSummary = refreshed.changedFields.length > 0 ? `${refreshed.changedFields.length}개 영역 갱신` : "변경된 영역 없음";
      setCatalogRefreshProgress(null);
      const checked = await checkBuild(build, recommendationPreferences, { catalogRefreshRequest: refreshRequest });
      if (!isCurrent()) return;
      if (checked) setToast(`${refreshed.name} 정보 확인 완료 · ${changedSummary} · 현재 구성 재검사했습니다.`);
      setCatalogRefreshReport(report);
    } catch (error: unknown) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : "부품 상세 정보를 다시 확인하지 못했습니다.";
      setCatalogRefreshReport({ inputFingerprint, status: "failed", requestedCount: 1, successCount: 0, failureCount: 1, items: [], failures: [{ target, message }], completedAt: new Date().toISOString() });
      setToast(message);
    } finally {
      if (isCurrent()) setRefreshingPartId(null);
    }
  }

  async function refreshAllCatalogItems(targets: RefreshTarget[]) {
    if (refreshingPartId) return;
    const refreshRequest = ++catalogRefreshRequestRef.current;
    const isCurrent = () => catalogRefreshRequestRef.current === refreshRequest;
    const uniqueTargets = uniqueRefreshTargets(targets);
    if (uniqueTargets.length === 0) {
      setToast("재확인할 부품이 없습니다.");
      return;
    }
    const inputFingerprint = buildCompatibilityInputFingerprint(build, recommendationPreferences);
    let successCount = 0;
    let changedFieldCount = 0;
    const reportItems: CatalogRefreshReportItem[] = [];
    const failures: CatalogRefreshReportFailure[] = [];
    const progressFor = (completedCount: number, currentTarget?: RefreshTarget): CatalogRefreshProgress => ({
      requestedCount: uniqueTargets.length,
      completedCount,
      successCount,
      failureCount: failures.length,
      currentName: currentTarget ? catalogRefreshTargetName(currentTarget) : null
    });
    setCatalogRefreshProgress(progressFor(0, uniqueTargets[0]));
    try {
      for (let index = 0; index < uniqueTargets.length; index += 1) {
        if (!isCurrent()) return;
        const target = uniqueTargets[index];
        setRefreshingPartId(target.id);
        setCatalogRefreshProgress(progressFor(index, target));
        try {
          const refreshed = await refreshCatalogTarget(target);
          if (!isCurrent()) return;
          successCount += 1;
          changedFieldCount += refreshed.changedFields.length;
          reportItems.push(refreshed.reportItem);
        } catch (error: unknown) {
          failures.push({ target, message: error instanceof Error ? error.message : "정보 확인 실패" });
        }
        setCatalogRefreshProgress(progressFor(index + 1, uniqueTargets[index + 1]));
      }
      if (!isCurrent()) return;
      setRefreshingPartId(null);
      setCatalogRefreshProgress(null);
      if (successCount === 0) {
        setCatalogRefreshReport({ inputFingerprint, status: "failed", requestedCount: uniqueTargets.length, successCount: 0, failureCount: failures.length, items: [], failures, completedAt: new Date().toISOString() });
        setToast(failures[0]?.message ?? "주변 부품 정보를 다시 확인하지 못했습니다.");
        return;
      }
      setCheckedInputFingerprint(null);
      void refreshMeta();
      const failureSummary = failures.length > 0 ? ` · 실패 ${failures.length}개` : "";
      const checked = await checkBuild(build, recommendationPreferences, { catalogRefreshRequest: refreshRequest });
      if (!isCurrent()) return;
      if (checked) setToast(`${successCount}개 부품 정보 확인 완료 · ${changedFieldCount}개 영역 갱신${failureSummary} · 현재 구성 재검사했습니다.`);
      setCatalogRefreshReport({ inputFingerprint, status: failures.length > 0 ? "partial" : "success", requestedCount: uniqueTargets.length, successCount, failureCount: failures.length, items: reportItems, failures, completedAt: new Date().toISOString() });
    } finally {
      if (isCurrent()) {
        setRefreshingPartId(null);
        setCatalogRefreshProgress(null);
      }
    }
  }

  async function copyPurchaseList(checkedIds?: ReadonlySet<string>, rowsOverride?: PurchaseListRow[], itemStates?: ReadonlyArray<PurchaseListItemStatus>) {
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => routeRequestSequenceRef.current === routeRequestSequence;
    const rows = rowsOverride ?? purchaseListRowsFor(build, partMap, accessoryMap);
    if (rows.length === 0) {
      setToast("복사할 구매 목록이 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(purchaseListTextFor(rows, checkedIds, itemStates));
      if (!isCurrent()) return;
      setToast("구매 목록을 클립보드에 복사했습니다.");
    } catch {
      if (isCurrent()) setToast("구매 목록 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }

  function downloadPurchaseList(checkedIds?: ReadonlySet<string>, rowsOverride?: PurchaseListRow[], itemStates?: ReadonlyArray<PurchaseListItemStatus>) {
    const rows = rowsOverride ?? purchaseListRowsFor(build, partMap, accessoryMap);
    if (rows.length === 0) {
      setToast("다운로드할 구매 목록이 없습니다.");
      return;
    }
    const blob = new Blob([purchaseListCsvFor(rows, checkedIds, itemStates)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-purchase-list-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("구매 목록 CSV를 저장했습니다.");
  }

  async function copyCompatibilityReport() {
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => routeRequestSequenceRef.current === routeRequestSequence;
    if (!result || resultIsStale) {
      setToast("현재 구성으로 먼저 다시 검사해 주세요.");
      return;
    }
    try {
      await navigator.clipboard.writeText(compatibilityReportTextFor(result, build, partMap, accessoryMap, compatibilityReportViewStateForLocation(), savedCheckHistory?.at(-1)));
      if (!isCurrent()) return;
      setToast("호환성 검사 리포트를 클립보드에 복사했습니다.");
    } catch {
      if (isCurrent()) setToast("호환성 검사 리포트 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }

  function downloadCompatibilityReport() {
    if (!result || resultIsStale) {
      setToast("현재 구성으로 먼저 다시 검사해 주세요.");
      return;
    }
    const blob = new Blob([compatibilityReportJsonFor(result, build, recommendationPreferences, partMap, compatibilityReportViewStateForLocation(), savedCheckHistory?.at(-1))], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-compatibility-report-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("호환성 검사 JSON 리포트를 저장했습니다.");
  }

  async function copyBuildChangeResultComparison() {
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => routeRequestSequenceRef.current === routeRequestSequence;
    if (!buildChangeResultComparison) return;
    try {
      await navigator.clipboard.writeText(buildChangeResultTextFor(buildChangeResultComparison));
      if (!isCurrent()) return;
      setToast("적용 후 검사 비교를 클립보드에 복사했습니다.");
    } catch {
      if (isCurrent()) setToast("적용 후 검사 비교 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }

  function downloadBuildChangeResultComparison() {
    if (!buildChangeResultComparison) return;
    const blob = new Blob([JSON.stringify(buildChangeResultExportFor(buildChangeResultComparison), null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-build-change-result-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("적용 후 검사 비교 JSON을 저장했습니다.");
  }

  function saveBuildChangeResultAsDecisionNote() {
    if (!buildChangeResultComparison) return;
    const target = shareId && shareOwnerToken
      ? { build, preferences: recommendationPreferences, label: "적용 후 비교 새 버전", kind: "candidate" as const, parentBuildId: shareId }
      : undefined;
    setSaveBuildTarget(target ?? null);
    setSaveName(target?.label ?? "나의 PC 견적");
    setSaveDecisionNote(buildChangeResultDecisionNoteFor(buildChangeResultComparison));
    setSaveExpiryDays("never");
    setSaveDialogOpen(true);
  }

  async function copyResultLink() {
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => routeRequestSequenceRef.current === routeRequestSequence;
    if (!result || resultIsStale) {
      setToast("현재 구성으로 먼저 다시 검사해 주세요.");
      return;
    }
    const viewState = compatibilityReportViewStateForLocation();
    const url = shareId
      ? savedBuildShareUrlFor(window.location.origin, shareId, viewState)
      : window.location.origin + viewState.path;
    try {
      await navigator.clipboard.writeText(url);
      if (!isCurrent()) return;
      setToast("현재 결과 링크를 클립보드에 복사했습니다.");
    } catch {
      if (isCurrent()) setToast(`결과 링크를 복사하지 못했습니다. 주소를 직접 복사해 주세요: ${url}`);
    }
  }

  async function shareAlternativeComparison(candidates: AlternativeComparisonCandidate[], context: AlternativeComparisonShareContext = {}) {
    const routeRequestSequence = routeRequestSequenceRef.current;
    const shareKey = JSON.stringify({
      candidates: candidates.map((candidate) => ({ category: candidate.category, partId: candidate.partId, name: candidate.name })),
      context
    });
    if (alternativeComparisonShareInFlightRef.current.has(shareKey)) return undefined;
    alternativeComparisonShareInFlightRef.current.add(shareKey);
    try {
      const liveContext = result && !resultIsStale ? { catalogSnapshotAt: result.catalogSnapshotAt, engineVersion: result.engineVersion } : {};
      const saved = await api<AlternativeComparisonCreateResponse>("/api/comparisons", {
        method: "POST",
        body: JSON.stringify({
          name: "PC Supporter 비교",
          ...liveContext,
          ...context,
          candidates,
          expiresInDays: 30
        }),
        retry: 0
      });
      if (routeRequestSequenceRef.current !== routeRequestSequence) return undefined;
      const url = `${window.location.origin}/compare/${saved.id}`;
      try {
        await navigator.clipboard.writeText(url);
        if (routeRequestSequenceRef.current !== routeRequestSequence) return undefined;
        setToast("부품 비교 공유 링크를 클립보드에 복사했어요.");
      } catch {
        if (routeRequestSequenceRef.current !== routeRequestSequence) return undefined;
        setToast(`부품 비교 링크가 만들어졌어요: ${url}`);
      }
      const share = { id: saved.id, url, ownerToken: saved.ownerToken, ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}) };
      rememberAlternativeComparisonShare({
        id: saved.id,
        url,
        name: saved.name,
        createdAt: saved.createdAt,
        ...(saved.category ? { category: saved.category } : {}),
        ...(saved.currentPartName ? { currentPartName: saved.currentPartName } : {}),
        ...(saved.currentPartSummary ? { currentPartSummary: saved.currentPartSummary } : {}),
        ...(saved.currentPartPrice ? { currentPartPrice: saved.currentPartPrice } : {}),
        ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}),
        ownerToken: saved.ownerToken
      });
      return share;
    } catch (error: unknown) {
      if (routeRequestSequenceRef.current === routeRequestSequence) setToast(error instanceof Error ? error.message : "부품 비교 공유 링크를 만들지 못했어요.");
      return undefined;
    } finally {
      alternativeComparisonShareInFlightRef.current.delete(shareKey);
    }
  }

  async function revokeAlternativeComparison(share: AlternativeComparisonShareResult) {
    const routeRequestSequence = routeRequestSequenceRef.current;
    if (alternativeComparisonRevokeInFlightRef.current.get(share.id) === routeRequestSequence) return false;
    if (!window.confirm("이 부품 비교 공유 링크를 취소할까요? 이미 전달된 링크도 더 이상 열리지 않아요.")) return false;
    alternativeComparisonRevokeInFlightRef.current.set(share.id, routeRequestSequence);
    const requestContextVersion = localShareMutationContextRef.current;
    const isCurrent = () => routeRequestSequenceRef.current === routeRequestSequence
      && alternativeComparisonRevokeInFlightRef.current.get(share.id) === routeRequestSequence
      && localShareMutationContextRef.current === requestContextVersion;
    try {
      await api(`/api/comparisons/${encodeURIComponent(share.id)}`, { method: "DELETE", headers: { "X-Share-Owner-Token": share.ownerToken }, retry: 0 });
      if (!isCurrent()) return false;
      forgetAlternativeComparisonShare(share.id);
      setToast("부품 비교 공유 링크를 취소했어요.");
      return true;
    } catch (error: unknown) {
      if (isCurrent()) setToast(error instanceof Error ? error.message : "부품 비교 공유 링크를 취소하지 못했어요.");
      return false;
    } finally {
      if (alternativeComparisonRevokeInFlightRef.current.get(share.id) === routeRequestSequence) alternativeComparisonRevokeInFlightRef.current.delete(share.id);
    }
  }

  async function revokeSavedBuildVersionShare(entry: SavedBuildVersionLocalShareEntry) {
    const routeRequestSequence = routeRequestSequenceRef.current;
    const requestContextVersion = localShareMutationContextRef.current;
    if (!entry.ownerToken) {
      setToast("이 링크에는 취소용 owner token이 없어 서버에서 취소할 수 없습니다.");
      return false;
    }
    if (savedBuildVersionRevokeInFlightRef.current.has(entry.id)) return false;
    savedBuildVersionRevokeInFlightRef.current.add(entry.id);
    const isCurrent = () => routeRequestSequenceRef.current === routeRequestSequence
      && localShareMutationContextRef.current === requestContextVersion
      && savedBuildVersionRevokeInFlightRef.current.has(entry.id);
    try {
      await api(`/api/version-comparisons/${encodeURIComponent(entry.id)}`, { method: "DELETE", headers: { "X-Share-Owner-Token": entry.ownerToken }, retry: 0 });
      if (!isCurrent()) return false;
      forgetSavedBuildVersionShare(entry.id);
      setToast("견적 버전 비교 공유 링크를 취소했습니다.");
      return true;
    } catch (error: unknown) {
      if (isCurrent()) setToast(error instanceof Error ? error.message : "견적 버전 비교 공유 링크를 취소하지 못했습니다.");
      return false;
    } finally {
      savedBuildVersionRevokeInFlightRef.current.delete(entry.id);
    }
  }

  async function shareSavedBuildVersionComparison(before: SavedBuild, after: SavedBuild): Promise<void> {
    const routeRequestSequence = routeRequestSequenceRef.current;
    const ownerToken = readSavedBuildOwnerToken(after.id);
    if (!ownerToken) {
      setToast("이후 버전 견적의 소유 토큰이 이 브라우저에 없어 버전 비교를 공유할 수 없습니다.");
      return;
    }
    if (savedBuildVersionShareInFlightRef.current) return;
    savedBuildVersionShareInFlightRef.current = true;
    try {
      const saved = await api<SavedBuildVersionComparisonShareSnapshot & { ownerToken: string }>("/api/version-comparisons", {
        method: "POST",
        headers: { "X-Share-Owner-Token": ownerToken },
        body: JSON.stringify({
          name: `${savedBuildVersionLabelFor(before)} · ${before.name} → ${savedBuildVersionLabelFor(after)} · ${after.name}`,
          beforeBuildId: before.id,
          afterBuildId: after.id,
          expiresInDays: 30
        }),
        retry: 0
      });
      if (routeRequestSequenceRef.current !== routeRequestSequence) return;
      const url = `${window.location.origin}/version-comparison/${encodeURIComponent(saved.id)}`;
      let copied = false;
      try {
        if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
      }
      if (routeRequestSequenceRef.current !== routeRequestSequence) return;
      setToast(copied ? "견적 버전 비교 공유 링크를 클립보드에 복사했습니다." : `견적 버전 비교 링크가 생성되었습니다: ${url}`);
      rememberSavedBuildVersionShare({
        id: saved.id,
        url,
        name: saved.name,
        createdAt: saved.createdAt,
        beforeLabel: saved.payload.before.label,
        beforeName: saved.payload.before.name,
        beforeBuildId: saved.payload.before.id,
        afterLabel: saved.payload.after.label,
        afterName: saved.payload.after.name,
        afterBuildId: saved.payload.after.id,
        ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}),
        ownerToken: saved.ownerToken
      });
      return;
    } catch (error: unknown) {
      if (routeRequestSequenceRef.current === routeRequestSequence) setToast(error instanceof Error ? error.message : "견적 버전 비교 공유 링크를 만들지 못했습니다.");
      return;
    } finally {
      savedBuildVersionShareInFlightRef.current = false;
    }
  }

  async function generateDraft(request: BuildGenerationRequest) {
    const requestVersion = ++generatorRequestRef.current;
    const isCurrent = () => generatorRequestRef.current === requestVersion;
    setGenerating(true);
    setGeneratorDraft(null);
    setGeneratorVariants([]);
    setGeneratorBudgetLadder([]);
    setGeneratorError(null);
    setGeneratorDiagnostics([]);
    setGeneratorRecoveryOptions([]);
    try {
      const draft = await api<BuildGenerationResult>("/api/builds/recommend", {
        method: "POST",
        body: JSON.stringify(request),
        retry: 2,
        retryOnRateLimit: true
      });
      await rememberBuildSelection(draft.selection);
      if (!isCurrent()) return;
      setGeneratorDraft(draft);
    } catch (error: unknown) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : "자동 견적을 생성하지 못했습니다.";
      setGeneratorError(message);
      setGeneratorDiagnostics(diagnosticsFromError(error));
      setGeneratorRecoveryOptions(recoveryOptionsFromError(error));
      setToast(message);
    } finally {
      if (isCurrent()) setGenerating(false);
    }
  }

  async function generateDraftVariants(request: BuildGenerationRequest) {
    const requestVersion = ++generatorRequestRef.current;
    const isCurrent = () => generatorRequestRef.current === requestVersion;
    setGenerating(true);
    setGeneratorDraft(null);
    setGeneratorVariants([]);
    setGeneratorBudgetLadder([]);
    setGeneratorError(null);
    setGeneratorDiagnostics([]);
    setGeneratorRecoveryOptions([]);
    const priorities: RecommendationPriority[] = ["balanced", "budget", "performance"];
    try {
      const variants = await Promise.all(priorities.map(async (priority): Promise<GeneratorVariantResult> => {
        try {
          const draft = await api<BuildGenerationResult>("/api/builds/recommend", {
            method: "POST",
            body: JSON.stringify({ ...request, priority }),
            retry: 2,
            retryOnRateLimit: true
          });
          await rememberBuildSelection(draft.selection);
          return { priority, draft };
        } catch (error: unknown) {
          return { priority, error: error instanceof Error ? error.message : "이 기준의 자동 구성을 만들지 못했습니다.", diagnostics: diagnosticsFromError(error) };
        }
      }));
      if (!isCurrent()) return;
      setGeneratorVariants(variants);
      if (isCurrent() && variants.every((variant) => !variant.draft)) setToast("세 가지 기준에서 모두 자동 구성을 만들지 못했습니다.");
    } finally {
      if (isCurrent()) setGenerating(false);
    }
  }

  async function generateDraftBudgetLadder(request: BuildGenerationRequest) {
    const requestVersion = ++generatorRequestRef.current;
    const isCurrent = () => generatorRequestRef.current === requestVersion;
    setGenerating(true);
    setGeneratorDraft(null);
    setGeneratorVariants([]);
    setGeneratorBudgetLadder([]);
    setGeneratorError(null);
    setGeneratorDiagnostics([]);
    setGeneratorRecoveryOptions([]);
    try {
      const payload = await api<{ scenarios: GeneratorBudgetResult[] }>("/api/builds/recommend/budget-ladder", {
        method: "POST",
        body: JSON.stringify(request),
        retry: 2,
        retryOnRateLimit: true
      });
      const results = await Promise.all(payload.scenarios.map(async (scenario) => {
        if (scenario.draft) await rememberBuildSelection(scenario.draft.selection);
        return scenario;
      }));
      if (!isCurrent()) return;
      setGeneratorBudgetLadder(results);
      if (isCurrent() && results.every((scenario) => !scenario.draft)) setToast("세 예산 구간에서 모두 자동 구성을 만들지 못했습니다.");
    } finally {
      if (isCurrent()) setGenerating(false);
    }
  }

  async function applyGeneratedDraft(draft: BuildGenerationResult, checkNow: boolean) {
    selectionHydrationAbortControllerRef.current?.abort();
    const hydrationController = new AbortController();
    selectionHydrationAbortControllerRef.current = hydrationController;
    const requestVersion = generatorRequestRef.current;
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => generatorRequestRef.current === requestVersion && routeRequestSequenceRef.current === routeRequestSequence && !hydrationController.signal.aborted;
    setGeneratorError(null);
    setGeneratorDiagnostics([]);
    setGeneratorRecoveryOptions([]);
    await rememberBuildSelection(draft.selection, hydrationController.signal);
    if (!isCurrent()) return;
    const nextPreferences = { ...recommendationPreferences, profile: draft.profile, priority: draft.priority, gamingResolution: draft.gamingResolution, gamingRefreshRate: draft.profile === "gaming" ? draft.gamingRefreshRate : undefined, budgetWon: draft.budgetWon, listingPolicy: draft.listingPolicy };
    setBuild(draft.selection);
    setRecommendationPreferences(nextPreferences);
    if (checkNow) {
      if (!isCurrent()) return;
      await checkBuild(draft.selection, nextPreferences);
    } else {
      if (!isCurrent()) return;
      setToast("자동 견적을 편집기로 가져왔습니다.");
      navigate("/build", "editor");
    }
  }

  function recommendationPreferencesForGenerationRequest(request: BuildGenerationRequest): RecommendationPreferences {
    return {
      ...recommendationPreferences,
      profile: request.profile,
      priority: request.priority ?? "balanced",
      budgetWon: request.budgetWon,
      listingPolicy: request.listingPolicy ?? (request.includeNonRetail ? "all" : "retail_only"),
      gamingResolution: request.profile === "gaming" ? request.gamingResolution ?? "1440p" : undefined,
      gamingRefreshRate: request.profile === "gaming" ? request.gamingRefreshRate ?? 144 : undefined
    };
  }

  async function previewMergedGeneratedSelection(selection: BuildSelection, request: BuildGenerationRequest, signal: AbortSignal) {
    const nextPreferences = recommendationPreferencesForGenerationRequest(request);
    return api<CompatibilityResult>("/api/compatibility/check", {
      method: "POST",
      body: JSON.stringify({ ...selection, recommendationPreferences: nextPreferences }),
      retry: 1,
      retryOnRateLimit: true,
      signal
    });
  }

  async function applyMergedGeneratedSelection(selection: BuildSelection, request: BuildGenerationRequest, checkNow: boolean) {
    const hydrationController = new AbortController();
    selectionHydrationAbortControllerRef.current = hydrationController;
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => routeRequestSequenceRef.current === routeRequestSequence;
    await rememberBuildSelection(selection, hydrationController.signal);
    if (!isCurrent()) return;
    const nextPreferences = recommendationPreferencesForGenerationRequest(request);
    setBuild(selection);
    setRecommendationPreferences(nextPreferences);
    if (checkNow) {
      if (!isCurrent()) return;
      await checkBuild(selection, nextPreferences);
    } else {
      if (!isCurrent()) return;
      setToast("버전별 부분 병합 결과를 편집기로 가져왔습니다. 전체 호환성 검사를 실행해 주세요.");
      navigate("/build", "editor");
    }
  }

  async function saveGeneratedDraft(draft: BuildGenerationResult) {
    const { generatedDraftSaveTargetFor } = await import("./generated-draft-save-target");
    requestSaveBuild(generatedDraftSaveTargetFor(draft, shareId && shareOwnerToken ? shareId : undefined));
  }

  function exportBuildDraft() {
    const content = buildTransferJsonFor(build, recommendationPreferences);
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-build-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    setToast("현재 견적과 추천 기준을 JSON 파일로 저장했습니다.");
  }

  function importBuildDraft(raw: string) {
    const parsed = parseBuildTransfer(raw);
    if (!parsed.envelope) {
      setToast(`견적 JSON을 가져오지 못했습니다: ${parsed.errors.slice(0, 2).join(" · ")}`);
      return;
    }
    setBuildImportPreview(parsed.envelope);
    setToast("견적 JSON을 확인했습니다. 현재 견적을 교체하기 전에 미리보기를 확인해 주세요.");
  }

  function applyImportedBuild(next: BuildTransferEnvelope) {
    setBuild(next.selection);
    setRecommendationPreferences(next.recommendationPreferences);
    setResult(null);
    setBuildChangeResultComparison(null);
    setSavedCheckHistory(null);
    setCheckedInputFingerprint(null);
    setCheckError(null);
    setBuildImportPreview(null);
    void rememberBuildSelection(next.selection);
    navigate("/build", "editor");
    setToast("견적 JSON을 가져왔습니다. 카탈로그 상태를 확인한 뒤 다시 검사해 주세요.");
  }

  function requestSaveBuild(target?: SaveBuildTarget) {
    setSaveBuildTarget(target ?? null);
    setSaveName(target?.label ?? "나의 PC 견적");
    setSaveDecisionNote("");
    setSaveExpiryDays("never");
    setSaveDialogOpen(true);
  }

  function requestEditSavedBuildMetadata(saved: SavedBuild) {
    if (!readSavedBuildOwnerToken(saved.id)) {
      setToast("이 견적의 설명을 수정할 수 있는 소유 토큰이 이 브라우저에 없습니다.");
      return;
    }
    metadataMutationRequestRef.current += 1;
    setMetadataEditTarget(saved);
    setMetadataEditName(saved.name);
    setMetadataEditDecisionNote(saved.decisionNote ?? "");
  }

  async function updateSavedBuildMetadata() {
    const target = metadataEditTarget;
    if (!target || metadataSaving) return;
    const token = readSavedBuildOwnerToken(target.id);
    if (!token) {
      setToast("이 견적의 설명을 수정할 수 있는 소유 토큰이 이 브라우저에 없습니다.");
      return;
    }
    const name = metadataEditName.trim();
    if (!name) {
      setToast("견적 이름을 입력해 주세요.");
      return;
    }
    const requestVersion = ++metadataMutationRequestRef.current;
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => metadataMutationRequestRef.current === requestVersion && routeRequestSequenceRef.current === routeRequestSequence;
    invalidateSavedBuildReads();
    setMetadataSaving(true);
    try {
      const updated = await api<SavedBuild>(`/api/builds/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        headers: { "X-Share-Owner-Token": token },
        body: JSON.stringify({ name, decisionNote: metadataEditDecisionNote.trim() }),
        retry: 0
      });
      if (!isCurrent()) return;
      invalidateSavedBuildReads();
      setSavedBuilds((current) => current.map((item) => item.id === updated.id ? updated : item));
      try {
        window.localStorage.setItem(SAVED_BUILD_METADATA_SYNC_STORAGE_KEY, JSON.stringify({ id: updated.id, updatedAt: updated.updatedAt, nonce: Date.now() }));
      } catch {
        // Cross-tab metadata refresh is best effort and must not block the successful edit.
      }
      setMetadataEditTarget(null);
      setToast("저장 견적 이름과 선택 이유를 수정했습니다.");
    } catch (error: unknown) {
      if (isCurrent()) setToast(error instanceof Error ? error.message : "저장 견적 설명을 수정하지 못했습니다.");
    } finally {
      if (isCurrent()) setMetadataSaving(false);
    }
  }

  async function saveBuild() {
    const name = saveName.trim() || "나의 PC 견적";
    const decisionNote = saveDecisionNote.trim();
    const target = saveBuildTarget;
    const targetBuild = target?.build ?? build;
    const targetPreferences = target?.preferences ?? recommendationPreferences;
    const refreshReport = catalogRefreshReportForInput(catalogRefreshReport, targetBuild, targetPreferences);
    const parentOwnerToken = target?.parentBuildId ? readSavedBuildOwnerToken(target.parentBuildId) : undefined;
    const requestVersion = ++saveBuildRequestRef.current;
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => saveBuildRequestRef.current === requestVersion && routeRequestSequenceRef.current === routeRequestSequence;
    invalidateSavedBuildReads();
    setSaving(true);
    try {
      const saved = await api<SavedBuildCreateResponse>("/api/builds", {
        method: "POST",
        ...(parentOwnerToken ? { headers: { "X-Share-Owner-Token": parentOwnerToken } } : {}),
        body: JSON.stringify({ name, selection: targetBuild, recommendationPreferences: targetPreferences, expiresInDays: saveExpiryDays === "never" ? undefined : saveExpiryDays, ...(decisionNote ? { decisionNote } : {}), ...(refreshReport ? { catalogRefreshReport: refreshReport } : {}), ...(parentOwnerToken && target?.parentBuildId ? { parentBuildId: target.parentBuildId } : {}) })
      });
      if (!isCurrent()) return;
      invalidateSavedBuildReads();
      setShareId(saved.id);
      setShareExpiresAt(saved.expiresAt ?? null);
      rememberSavedBuildOwnerToken(saved.id, saved.ownerToken);
      setShareOwnerToken(saved.ownerToken);
      rememberSavedBuildId(saved.id);
      const { ownerToken: _ownerToken, ...publicSaved } = saved;
      setSavedBuilds((current) => [publicSaved, ...current.filter((item) => item.id !== saved.id)].slice(0, 20));
      setSavedCheckHistory(saved.checkHistory ?? (saved.checkSnapshot ? [saved.checkSnapshot] : null));
      setSaveDialogOpen(false);
      setSaveBuildTarget(null);
      const url = savedBuildShareUrlFor(window.location.origin, saved.id, compatibilityReportViewStateForLocation());
      if (target) {
        const opened = await openSavedBuild(publicSaved);
        if (!opened && !isCurrent()) return;
        const continuationRequestVersion = saveBuildRequestRef.current;
        const continuationRouteRequestSequence = routeRequestSequenceRef.current;
        const isContinuationCurrent = () => saveBuildRequestRef.current === continuationRequestVersion
          && routeRequestSequenceRef.current === continuationRouteRequestSequence;
        const savedTargetLabel = target.kind === "candidate" ? "비교 구성" : target.kind === "generated" ? "자동 구성" : "수리 플랜";
        try {
          await navigator.clipboard.writeText(url);
          if (!isContinuationCurrent()) return;
          setToast(opened ? `${savedTargetLabel}을 새 견적으로 저장하고 결과를 열었습니다. 공유 링크도 복사했습니다.` : `${savedTargetLabel}을 새 견적으로 저장했습니다. 결과를 자동으로 열지 못했지만 공유 링크를 복사했습니다.`);
        } catch {
          if (isContinuationCurrent()) setToast(opened ? `${savedTargetLabel}을 새 견적으로 저장하고 결과를 열었습니다: ${url}` : `${savedTargetLabel}을 새 견적으로 저장했습니다: ${url}`);
        }
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        if (!isCurrent()) return;
        setToast("검사 기록과 함께 저장했습니다. 공유 링크를 클립보드에 복사했습니다.");
      } catch {
        if (isCurrent()) setToast(`검사 기록과 함께 저장했습니다. 공유 링크가 생성되었습니다: ${url}`);
      }
    } catch (error: unknown) {
      if (isCurrent()) setToast(error instanceof Error ? error.message : "견적 저장에 실패했습니다.");
    } finally {
      if (isCurrent()) setSaving(false);
    }
  }

  async function revokeSavedBuildById(id: string, tokenOverride?: string) {
    if (revokingShare) return;
    const token = tokenOverride ?? readSavedBuildOwnerToken(id);
    if (!token) {
      setToast("이 견적을 취소할 수 있는 소유 토큰이 이 브라우저에 없습니다.");
      return;
    }
    if (!window.confirm("이 공유 견적을 취소할까요? 이미 전달된 링크도 더 이상 열리지 않습니다.")) return;
    const requestVersion = ++savedBuildMutationRequestRef.current;
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => savedBuildMutationRequestRef.current === requestVersion && routeRequestSequenceRef.current === routeRequestSequence;
    invalidateSavedBuildReads();
    setRevokingShare(true);
    try {
      await api(`/api/builds/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "X-Share-Owner-Token": token } });
      if (!isCurrent()) return;
      invalidateSavedBuildReads();
      forgetSavedBuild(id);
      setSavedBuilds((current) => current.filter((item) => item.id !== id));
      if (shareId === id) {
        setShareId(null);
        setShareExpiresAt(null);
        setShareOwnerToken(null);
      }
      setToast("공유 견적 링크를 취소했습니다.");
      if (shareId === id) navigate("/build", "editor");
    } catch (error: unknown) {
      if (isCurrent()) setToast(error instanceof Error ? error.message : "공유 견적 링크를 취소하지 못했습니다.");
    } finally {
      if (isCurrent()) setRevokingShare(false);
    }
  }

  async function recordSavedBuildCheck(id: string) {
    if (recordingCheckId) return;
    const token = readSavedBuildOwnerToken(id);
    if (!token) {
      setToast("현재 검사 기록을 추가하려면 이 브라우저의 견적 소유 토큰이 필요합니다.");
      return;
    }
    const requestVersion = ++savedBuildMutationRequestRef.current;
    const routeRequestSequence = routeRequestSequenceRef.current;
    const isCurrent = () => savedBuildMutationRequestRef.current === requestVersion && routeRequestSequenceRef.current === routeRequestSequence;
    invalidateSavedBuildReads();
    setRecordingCheckId(id);
    const refreshReport = catalogRefreshReportForInput(catalogRefreshReport, build, recommendationPreferences);
    try {
      const saved = await api<SavedBuild>(`/api/builds/${encodeURIComponent(id)}/check`, {
        method: "POST",
        headers: { "X-Share-Owner-Token": token },
        ...(refreshReport ? { body: JSON.stringify({ catalogRefreshReport: refreshReport }) } : {}),
        retry: 0
      });
      if (!isCurrent()) return;
      invalidateSavedBuildReads();
      setSavedBuilds((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (shareId === saved.id) setSavedCheckHistory(saved.checkHistory ?? (saved.checkSnapshot ? [saved.checkSnapshot] : null));
      setToast(`현재 카탈로그 기준 검사 기록을 추가했습니다. 총 ${saved.checkHistory?.length ?? 1}회 기록입니다.`);
    } catch (error: unknown) {
      if (isCurrent()) setToast(error instanceof Error ? error.message : "검사 기록을 추가하지 못했습니다.");
    } finally {
      if (isCurrent()) setRecordingCheckId(null);
    }
  }

  function revokeSharedBuild() {
    if (!shareId || !shareOwnerToken) return;
    void revokeSavedBuildById(shareId, shareOwnerToken);
  }

  function updateBuildPart(category: PartCategory, selection: PartSelection | undefined, part?: Part) {
    if (part) rememberParts([part]);
    checkRequestSequenceRef.current += 1;
    setCheckError(null);
    setBuild((current) => withSelectedPart(current, category, selection));
    setPicker(null);
    if (view === "result") navigate("/build", "editor");
  }

  function addCatalogPart(part: Part) {
    const current = selectionList(build, part.category);
    if (current.some((selection) => selection.partId === part.id) && !["memory", "ssd", "hdd"].includes(part.category)) {
      setToast(`${CATEGORY_LABELS[part.category]} · ${part.name}은 이미 현재 견적에 선택되어 있습니다.`);
      return;
    }
    updateBuildPart(part.category, { partId: part.id, quantity: 1 }, part);
    setToast(`${CATEGORY_LABELS[part.category]} · ${part.name}을 현재 견적에 ${["memory", "ssd", "hdd"].includes(part.category) ? "추가" : "선택"}했습니다. 견적 검사에서 전체 호환성을 확인해 주세요.`);
  }

  function selectPickerPart(part: Part) {
    if (!picker) return;
    const pickerPart = part as PickerPart;
    const candidateEvidence: CandidateApplicationEvidence = {
      ...(pickerPart.candidateRisk ? { risk: pickerPart.candidateRisk } : {}),
      ...(pickerPart.decision ? { decision: pickerPart.decision } : {}),
      ...(pickerPart.candidateReasons ? { reasons: pickerPart.candidateReasons } : {}),
      ...(pickerPart.remainingBlockers !== undefined ? { remainingBlockers: pickerPart.remainingBlockers } : {}),
      ...(pickerPart.remainingWarnings !== undefined ? { remainingWarnings: pickerPart.remainingWarnings } : {}),
      ...(pickerPart.remainingUnknown !== undefined ? { remainingUnknown: pickerPart.remainingUnknown } : {})
    };
    if (candidateApplicationBlockedFor(candidateEvidence)) {
      setToast("차단 오류가 확인된 부품은 자동으로 적용하지 않아요. 다른 부품을 고르거나 이유를 확인해 주세요.");
      return;
    }
    if (picker.findingRuleId) {
      const nextBuild = replaceAffectedPartsInBuild(build, picker.category, part.id, picker.affectedPartIds ?? [], pickerPart.recommendedQuantity);
      setPicker(null);
      if (view === "result") {
        const quantityText = pickerPart.recommendedQuantity !== undefined && picker.category === "memory" ? ` ${pickerPart.recommendedQuantity}킷` : "";
        openBuildChangePreview("대체 부품 적용", `${part.name}${quantityText}을 이 문제의 대체 부품으로 적용해요. 확인 후 견적 전체를 다시 검사해요.`, nextBuild, [part], candidateEvidence);
      } else {
        rememberParts([part]);
        setCheckError(null);
        setBuild(nextBuild);
      }
      return;
    }
    updateBuildPart(picker.category, { partId: part.id, quantity: pickerPart.recommendedQuantity ?? 1 }, part);
  }

  function applySuggestion(category: PartCategory, part: Part, quantity?: number, affectedPartIds: string[] = [], candidateEvidence?: CandidateApplicationEvidence) {
    if (candidateApplicationBlockedFor(candidateEvidence)) {
      setToast("차단 오류가 확인된 부품은 적용하지 않아요. 다른 부품을 고르거나 이유를 확인해 주세요.");
      return;
    }
    scenarioRequestSequenceRef.current += 1;
    setScenarioPreview(null);
    const nextBuild = replaceAffectedPartsInBuild(build, category, part.id, affectedPartIds, quantity);
    const quantityText = quantity !== undefined && category === "memory" ? ` ${quantity}킷` : "";
    openBuildChangePreview("대체 부품 적용", `${part.name}${quantityText}을 적용합니다. 확인 후 전체 호환성 규칙으로 다시 검사합니다.`, nextBuild, [part], candidateEvidence);
  }

  async function previewSuggestion(category: PartCategory, part: Part, quantity?: number, affectedPartIds: string[] = [], candidateEvidence?: CandidateApplicationEvidence) {
    setPicker(null);
    setCandidateScenarioComparison(null);
    const nextBuild = replaceAffectedPartsInBuild(build, category, part.id, affectedPartIds, quantity);
    const requestSequence = ++scenarioRequestSequenceRef.current;
    const quantityText = quantity !== undefined && category === "memory" ? ` ${quantity}킷` : "";
    setScenarioPreview({
      status: "loading",
      title: `${CATEGORY_LABELS[category]} · ${part.name}`,
      summary: `${part.name}${quantityText}을 현재 견적에 미리 적용합니다. 현재 선택·검사 결과는 바뀌지 않습니다.`,
      category,
      part,
      ...(quantity !== undefined ? { quantity } : {}),
      affectedPartIds,
      nextBuild,
      ...(candidateEvidence ? { candidateEvidence } : {})
    });
    try {
      await rememberBuildSelection(nextBuild);
      const checked = await api<CompatibilityResult>("/api/compatibility/check", {
        method: "POST",
        body: JSON.stringify({ ...nextBuild, recommendationPreferences }),
        retry: 2,
        retryOnRateLimit: true
      });
      if (scenarioRequestSequenceRef.current !== requestSequence) return;
      setScenarioPreview((current) => current ? { ...current, status: "ready", result: checked, error: undefined } : current);
    } catch (error: unknown) {
      if (scenarioRequestSequenceRef.current !== requestSequence) return;
      setScenarioPreview((current) => current ? { ...current, status: "error", error: error instanceof Error ? error.message : "미리 적용한 구성을 확인하지 못했습니다." } : current);
    }
  }

  async function compareCandidateScenarios(inputs: CandidateScenarioInput[]) {
    if (inputs.length < 2) return;
    const requestSequence = ++scenarioRequestSequenceRef.current;
    const baselineResult = result;
    setPicker(null);
    setScenarioPreview(null);
    const category = inputs[0]?.category ?? "gpu";
    const initialItems: CandidateScenarioCompareItem[] = inputs.map((input, index) => {
      const currentSelections = selectionList(build, input.category)
        .map((selection) => ({ part: partMap.get(selection.partId), quantity: selection.quantity }))
        .filter((selection): selection is { part: Part; quantity: number } => Boolean(selection.part));
      return {
        id: `${index}-${input.category}-${input.part.id}`,
        category: input.category,
        part: input.part,
        currentParts: currentSelections.map(({ part }) => part),
        currentPartQuantities: currentSelections.map(({ quantity }) => quantity),
        ...(input.risk ? { risk: input.risk } : {}),
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.affectedPartIds && input.affectedPartIds.length > 0 ? { affectedPartIds: input.affectedPartIds } : {}),
        nextBuild: replaceAffectedPartsInBuild(build, input.category, input.part.id, input.affectedPartIds ?? [], input.quantity),
        status: "loading" as const
      };
    });
    setCandidateScenarioComparison({ category, items: initialItems });
    const evaluatedItems = await Promise.all(initialItems.map(async (item) => {
      try {
        await rememberBuildSelection(item.nextBuild);
        const checked = await api<CompatibilityResult>("/api/compatibility/check", {
          method: "POST",
          body: JSON.stringify({ ...item.nextBuild, recommendationPreferences }),
          retry: 2,
          retryOnRateLimit: true
        });
        return { ...item, status: "ready" as const, result: checked, comparison: buildScenarioComparisonFor(baselineResult ?? checked, checked), error: undefined };
      } catch (error: unknown) {
        return { ...item, status: "error" as const, error: error instanceof Error ? error.message : "미리 비교에 실패했습니다." };
      }
    }));
    if (scenarioRequestSequenceRef.current === requestSequence) setCandidateScenarioComparison({ category, items: evaluatedItems });
  }

  async function comparePickerScenarios(category: PartCategory, partsToCompare: PickerPart[], affectedPartIds: string[] = []) {
    await compareCandidateScenarios(partsToCompare.map((part) => ({
      category,
      part,
      ...(part.candidateRisk ? { risk: part.candidateRisk } : {}),
      ...(part.recommendedQuantity !== undefined ? { quantity: part.recommendedQuantity } : {}),
      ...(affectedPartIds.length > 0 ? { affectedPartIds } : {})
    })));
  }

  function compareCatalogScenarios(category: PartCategory, partsToCompare: CatalogPart[]) {
    if (!result || resultIsStale) {
      setToast("현재 견적을 먼저 검사한 뒤 부품 미리 비교를 시작해 주세요.");
      return;
    }
    void compareCandidateScenarios(partsToCompare.map((part) => ({
      category,
      part,
      ...(part.candidateRisk ? { risk: part.candidateRisk } : {}),
      ...(part.recommendedQuantity !== undefined ? { quantity: part.recommendedQuantity } : {})
    })));
  }

  function compareSuggestionScenarios(suggestions: ResultFindingSuggestion[], affectedPartIds: string[]) {
    void compareCandidateScenarios(suggestions.map((suggestion) => ({
      category: suggestion.part.category,
      part: suggestion.part,
      // Result suggestions are filtered for whole-build safety, but a review candidate must keep its own evidence state.
      risk: suggestion.candidateRisk ?? "safe",
      ...(suggestion.recommendedQuantity !== undefined ? { quantity: suggestion.recommendedQuantity } : {}),
      ...(affectedPartIds.length > 0 ? { affectedPartIds } : {})
    })));
  }

  async function retryCandidateScenario(itemId: string) {
    const currentState = candidateScenarioComparison;
    const target = currentState?.items.find((item) => item.id === itemId);
    if (!currentState || !target) return;
    const requestSequence = ++scenarioRequestSequenceRef.current;
    setCandidateScenarioComparison({ ...currentState, items: currentState.items.map((item) => item.id === itemId ? { ...item, status: "loading" as const, error: undefined } : item) });
    try {
      await rememberBuildSelection(target.nextBuild);
      const checked = await api<CompatibilityResult>("/api/compatibility/check", {
        method: "POST",
        body: JSON.stringify({ ...target.nextBuild, recommendationPreferences }),
        retry: 2,
        retryOnRateLimit: true
      });
      if (scenarioRequestSequenceRef.current !== requestSequence) return;
      setCandidateScenarioComparison((current) => current ? { ...current, items: current.items.map((item) => item.id === itemId ? { ...item, status: "ready", result: checked, comparison: buildScenarioComparisonFor(result ?? checked, checked), error: undefined } : item) } : current);
    } catch (error: unknown) {
      if (scenarioRequestSequenceRef.current !== requestSequence) return;
      setCandidateScenarioComparison((current) => current ? { ...current, items: current.items.map((item) => item.id === itemId ? { ...item, status: "error", error: error instanceof Error ? error.message : "미리 비교에 실패했습니다." } : item) } : current);
    }
  }

  function applyCandidateScenario(item: CandidateScenarioCompareItem) {
    if (item.status !== "ready" || !item.result) {
      setToast("미리 비교가 끝난 부품만 적용할 수 있어요.");
      return;
    }
    if (item.risk === "unsafe" || (!item.risk && item.result.blockerCount > 0)) {
      setToast("전체 구성에서 차단 오류가 확인된 부품은 적용하지 않아요.");
      return;
    }
    scenarioRequestSequenceRef.current += 1;
    setCandidateScenarioComparison(null);
    const quantityText = item.quantity !== undefined && item.category === "memory" ? ` ${item.quantity}킷` : "";
    const candidateRisk = item.risk ?? item.part.candidateRisk;
    openBuildChangePreview("부품 미리 적용", `${item.part.name}${quantityText}을 전체 미리 비교 결과 기준으로 적용합니다. 확인 후 전체 호환성 규칙으로 다시 검사합니다.`, item.nextBuild, [item.part], {
      ...(candidateRisk ? { risk: candidateRisk } : {}),
      ...(item.part.decision ? { decision: item.part.decision } : {}),
      ...(item.part.candidateReasons ? { reasons: item.part.candidateReasons } : {}),
      remainingBlockers: item.result.blockerCount,
      remainingWarnings: item.result.warningCount,
      remainingUnknown: item.result.unknownCount
    });
  }

  function saveCandidateScenario(item: CandidateScenarioCompareItem) {
    if (item.status !== "ready" || !item.result) {
      setToast("미리 비교가 끝난 부품만 저장할 수 있어요.");
      return;
    }
    if (item.risk === "unsafe" || (!item.risk && item.result.blockerCount > 0)) {
      setToast("전체 구성에서 차단 오류가 확인된 부품은 새 견적으로 저장하지 않아요.");
      return;
    }
    scenarioRequestSequenceRef.current += 1;
    setCandidateScenarioComparison(null);
    requestSaveBuild({
      build: item.nextBuild,
      preferences: recommendationPreferences,
      label: `${CATEGORY_LABELS[item.category]} 부품 적용 견적`,
      kind: "candidate",
      ...(shareId && shareOwnerToken ? { parentBuildId: shareId } : {})
    });
  }

  function applyUpgradeBundle(bundle: UpgradeBundleRecommendation) {
    scenarioRequestSequenceRef.current += 1;
    setUpgradeBundleScenarioPreview(null);
    const nextBuild = upgradeBundleBuildFor(build, bundle);
    openBuildChangePreview("업그레이드 조합 적용", `${bundle.changes.length}개 부품 조합을 적용합니다. ${bundle.reason} 확인 후 전체 호환성 규칙으로 다시 검사합니다.`, nextBuild, bundle.changes.map((change) => change.part));
  }

  async function previewUpgradeBundle(bundle: UpgradeBundleRecommendation) {
    const nextBuild = upgradeBundleBuildFor(build, bundle);
    const requestSequence = ++scenarioRequestSequenceRef.current;
    setScenarioPreview(null);
    setCandidateScenarioComparison(null);
    setUpgradeBundleScenarioPreview({ status: "loading", bundle, nextBuild });
    try {
      await rememberBuildSelection(nextBuild);
      const checked = await api<CompatibilityResult>("/api/compatibility/check", {
        method: "POST",
        body: JSON.stringify({ ...nextBuild, recommendationPreferences }),
        retry: 2,
        retryOnRateLimit: true
      });
      if (scenarioRequestSequenceRef.current !== requestSequence) return;
      setUpgradeBundleScenarioPreview((current) => current ? { ...current, status: "ready", result: checked, error: undefined } : current);
    } catch (error: unknown) {
      if (scenarioRequestSequenceRef.current !== requestSequence) return;
      setUpgradeBundleScenarioPreview((current) => current ? { ...current, status: "error", error: error instanceof Error ? error.message : "업그레이드 조합을 미리 확인하지 못했습니다." } : current);
    }
  }

  function applyRepairPlan(plan: RecommendationPlan) {
    const nextBuild = repairPlanBuildFor(build, plan);
    openBuildChangePreview("수리 플랜 적용", `${plan.changes.length}개 변경으로 차단 오류 ${plan.resolvedBlockers}개를 줄이는 플랜입니다. 확인 후 전체 호환성 규칙으로 다시 검사합니다.`, nextBuild, plan.changes.map((change) => change.toPart));
  }

  async function restoreBuildHistory(entry: BuildHistoryEntry) {
    const snapshot = entry.snapshot;
    setBuild(snapshot.build);
    setRecommendationPreferences(snapshot.recommendationPreferences);
    const checked = await checkBuild(snapshot.build, snapshot.recommendationPreferences);
    if (!checked) return;
    setToast(`${entry.label} 전 구성으로 복원하고 다시 검사했습니다.`);
  }

  async function openSavedBuild(saved: SavedBuild, focus?: SavedBuildOpenFocus) {
    if (openingSavedBuildIdRef.current) return false;
    const requestVersion = ++openingSavedBuildRequestRef.current;
    abortSelectionHydration();
    const hydrationController = new AbortController();
    selectionHydrationAbortControllerRef.current = hydrationController;
    const isCurrent = () => openingSavedBuildRequestRef.current === requestVersion && !hydrationController.signal.aborted;
    openingSavedBuildIdRef.current = saved.id;
    setOpeningSavedBuildId(saved.id);
    setPendingResultFindingRuleId(focus && typeof focus !== "string" && focus.type === "finding" ? focus.ruleId : null);
    setToast(`${saved.name}을 현재 카탈로그 기준으로 다시 검사해 불러오는 중입니다.`);
    const nextPreferences = saved.recommendationPreferences ?? recommendationPreferences;
    setBuild(saved.selection);
    setRecommendationPreferences(nextPreferences);
    setCatalogRefreshReport(null);
    try {
      await rememberBuildSelection(saved.selection, hydrationController.signal);
      if (!isCurrent()) return false;
      const checked = await api<CompatibilityResult>("/api/compatibility/check", {
        method: "POST",
        body: JSON.stringify({ ...saved.selection, recommendationPreferences: nextPreferences }),
        retry: 2,
        retryOnRateLimit: true,
        signal: hydrationController.signal
      });
      if (!isCurrent()) return false;
      setResult(checked);
      setSavedCheckHistory(saved.checkHistory ?? (saved.checkSnapshot ? [saved.checkSnapshot] : null));
      setCheckedInputFingerprint(buildCompatibilityInputFingerprint(saved.selection, nextPreferences));
      setCheckError(null);
      setShareId(saved.id);
      setShareExpiresAt(saved.expiresAt ?? null);
      setShareOwnerToken(readSavedBuildOwnerToken(saved.id) ?? null);
      navigate(focus === "purchase-list" ? "/result#purchase-list" : "/result", "result");
      setToast(null);
      return true;
    } catch (error: unknown) {
      if (!isCurrent()) return false;
      const message = error instanceof Error ? error.message : "저장된 견적을 검사하지 못했습니다.";
      setCheckError(message);
      setToast(message);
      setPendingResultFindingRuleId(null);
      return false;
    } finally {
      if (openingSavedBuildRequestRef.current === requestVersion) {
        openingSavedBuildIdRef.current = null;
        setOpeningSavedBuildId(null);
      }
      if (selectionHydrationAbortControllerRef.current === hydrationController) selectionHydrationAbortControllerRef.current = null;
    }
  }

  function cloneSharedBuildToDraft() {
    if (!shareId) {
      navigate("/build", "editor");
      return;
    }
    const sourceName = savedBuilds.find((saved) => saved.id === shareId)?.name ?? "공유 견적";
    setShareId(null);
    setShareExpiresAt(null);
    setShareOwnerToken(null);
    setSavedCheckHistory(null);
    setResult(null);
    setBuildChangeResultComparison(null);
    setCheckedInputFingerprint(null);
    setCheckError(null);
    setCatalogRefreshReport(null);
    setPendingResultFindingRuleId(null);
    setScenarioPreview(null);
    setCandidateScenarioComparison(null);
    setUpgradeBundleScenarioPreview(null);
    setChangeHistory([]);
    void rememberBuildSelection(build);
    navigate("/build", "editor");
    setToast(`${sourceName}을 현재 브라우저의 새 초안으로 복제했습니다. 원본 공유 견적과 저장 기록은 변경되지 않습니다.`);
  }

  function updateCurrentSavedBuildPurchaseProgress(progress?: SavedBuildPurchaseProgress) {
    if (!shareId) return;
    setSavedBuilds((current) => current.map((item) => {
      if (item.id !== shareId) return item;
      const { purchaseProgress: _previousProgress, ...withoutProgress } = item;
      return progress ? { ...withoutProgress, purchaseProgress: progress } : withoutProgress;
    }));
  }

  function updateCurrentSavedBuildPurchasePriceHistory(history?: SavedBuildPurchasePriceHistory) {
    if (!shareId) return;
    setSavedBuilds((current) => current.map((item) => {
      if (item.id !== shareId) return item;
      const { purchasePriceHistory: _previousHistory, ...withoutHistory } = item;
      return history ? { ...withoutHistory, purchasePriceHistory: history } : withoutHistory;
    }));
  }

  function isCatalogWatchEntryWatched(target: Pick<CatalogWatchEntry, "kind" | "itemId">) {
    try {
      return catalogWatchlistContains(catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY)), target);
    } catch {
      return false;
    }
  }

  function watchCatalogEntry(target: PurchaseListWatchTarget, targetPriceWon?: number) {
    try {
      if (targetPriceWon !== undefined && !isKnownPrice(targetPriceWon)) {
        setToast("목표가는 1원 이상의 숫자로 입력해 주세요.");
        return false;
      }
      const current = catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY));
      const alreadyWatched = catalogWatchlistContains(current, target);
      const next = addCatalogWatchEntry(current, {
        ...target,
        addedAt: new Date().toISOString(),
        ...(targetPriceWon !== undefined ? { targetPriceWon } : {})
      });
      window.localStorage.setItem(CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistToJson(next));
      setToast(alreadyWatched
        ? (targetPriceWon !== undefined ? "가격 추적 중인 부품의 목표가를 갱신했습니다." : "이미 가격 추적 중인 부품입니다. 가격 추적 화면에서 목표가를 설정할 수 있습니다.")
        : "가격 추적에 등록했습니다. 가격 추적 화면에서 목표가와 알림 조건을 설정할 수 있습니다.");
      return true;
    } catch {
      setToast("가격 추적 목록에 부품을 등록하지 못했습니다.");
      return false;
    }
  }

  function watchPart(part: Part) {
    return watchCatalogEntry({ itemId: part.id, itemName: part.name, category: part.category, kind: "part" });
  }

  function watchAccessory(item: AccessoryItem) {
    return watchCatalogEntry({ itemId: item.id, itemName: item.name, category: item.category, kind: "accessory" });
  }

  async function addAccessory(item: AccessoryItem) {
    rememberAccessories([item]);
    const nextBuild = addAccessoryToBuild(build, item.id, defaultAccessoryTargetPartId(build, item, partMap), defaultAccessoryTargetAccessoryId(build, item, accessoryMap));
    if (view === "result") {
      const checked = await checkBuild(nextBuild);
      if (!checked) return;
      setToast(`${item.name}을 견적에 추가하고 다시 검사했습니다.`);
      return;
    }
    setBuild(nextBuild);
    setToast(`${item.name}을 견적에 추가했습니다.`);
  }

  async function changeAccessoryQuantity(index: number, quantity: number) {
    const nextBuild = updateAccessoryQuantity(build, index, quantity);
    setBuild(nextBuild);
    if (view === "result") await checkBuild(nextBuild);
  }

  async function changeAccessoryTarget(index: number, targetPartId: string | undefined) {
    const nextBuild = updateAccessoryTarget(build, index, targetPartId);
    setBuild(nextBuild);
    if (view === "result") await checkBuild(nextBuild);
  }

  async function changeAccessoryHubTarget(index: number, targetAccessoryId: string | undefined) {
    const nextBuild = updateAccessoryHubTarget(build, index, targetAccessoryId);
    setBuild(nextBuild);
    if (view === "result") await checkBuild(nextBuild);
  }

  async function changeRgbControllerTarget(targetAccessoryId: string | undefined) {
    const nextBuild = updateRgbControllerTarget(build, targetAccessoryId);
    setBuild(nextBuild);
    if (view === "result") await checkBuild(nextBuild);
  }

  async function removeAccessory(index: number) {
    const nextBuild = removeAccessoryFromBuild(build, index);
    setBuild(nextBuild);
    if (view === "result") await checkBuild(nextBuild);
  }

  function loadDemoBuild(nextBuild: BuildSelection, message: string) {
    scenarioRequestSequenceRef.current += 1;
    setPicker(null);
    setCandidateScenarioComparison(null);
    setScenarioPreview(null);
    setUpgradeBundleScenarioPreview(null);
    setPendingBuildChange(null);
    setBuild(nextBuild);
    setResult(null);
    setBuildChangeResultComparison(null);
    setSavedCheckHistory(null);
    setCheckedInputFingerprint(null);
    setCheckError(null);
    navigate("/build", "editor");
    setToast(message);
  }

  const resultViewDependencies: ResultViewDependencies = {
    StaleResultView,
    RequestErrorNotice,
    BuildScenarioPreviewPanel,
    LazyResultQuickNav,
    LazySavedBuildRecheckDiffPanel,
    LazyPurchaseReadinessPanel,
    LazyBuildActionCenterPanel,
    LazyAssemblyPlanPanel,
    LazyUpgradeBundleScenarioPreviewPanel,
    LazyPurchaseChecklistPanel,
    LazyAssemblyVerificationPanel,
    LazyRecommendationSearchNotice,
    LazyBuildResourceSummaryPanel,
    LazyBuildConnectivityPanel,
    LazyGpuFitSummaryPanel,
    LazyPurchaseListPanel,
    LazyBenchmarkEvidencePanel,
    LazyUpgradeBundlePanel,
    LazyAccessoryCartPanel,
    ResultFindingCard,
    BuildPriceSummaryPanel,
    RecommendationControls,
    BuildHealthPanel,
    M2SlotAssignmentPanel,
    DataHealthPanel,
    BuildWatchlistPanel,
    ChangeHistoryPanel,
    BuildAnalysisPanel,
    UpgradeRecommendationPanel,
    UpgradeRecommendationDetail,
    AccessoryRecommendationPanel,
    CompatibilityMap,
    RepairPlanPanel,
    SavedBuildCheckTimeline,
    PartVisual,
    AccessoryVisual,
    PartWatchButton,
    PartEvidence,
    CategoryIcon,
    purchaseListRowsFor,
    selectionList,
    accessorySelections,
    unknownPriceItemsFor,
    buildPriceSnapshotFor,
    upgradeBundlesFromPayload,
    formatWon,
    formatPriceDelta,
    formatSignedPercent,
    formatSpecValue,
    partSummary,
    similarityEvidenceText,
    suggestionSpecRows,
    upgradeCompatibilityStatus,
    upgradeCompatibilityText,
    upgradeBudgetText,
    upgradeExpansionText,
    upgradeExpansionTone,
    resultFindingFilterFromSearch,
    resultSectionFromHash,
    resultSectionTargetIds,
    resultViewUrlFor,
    findingFilterCounts,
    filteredFindingsFor,
    FINDING_FILTERS,
    RULE_GUIDES,
    CATEGORY_LABELS,
    LISTING_TYPE_LABELS,
    PART_CATEGORIES
  };

  const content = view === "home" ? (
    <Suspense fallback={<div className="home-page home-page-loading" role="status"><FiLoader className="spin" /> 홈 화면을 불러오는 중...</div>}>
      <LazyHomeView
      meta={meta}
      bootstrapLoading={bootstrapLoading}
      bootstrapErrorCount={bootstrapIssues.length}
      build={build}
      result={result}
      resultIsStale={resultIsStale}
      partMap={partMap}
      budgetLadderShares={budgetLadderShares}
      alternativeComparisonShares={alternativeComparisonShares}
      savedBuildVersionShares={savedBuildVersionShares}
      onStart={() => navigate("/build", "editor")}
      onGenerate={() => openGenerator()}
      onDemo={() => loadDemoBuild(demoBuild(), "문제가 있는 예시 견적을 불러왔습니다. 호환성 오류와 대체 부품을 확인해 보세요.")}
      onCompatibleDemo={() => loadDemoBuild(compatibleDemoBuild(), "문제 없는 예시 견적을 불러왔습니다. 업그레이드 부품과 조합 비교를 확인해 보세요.")}
      onResume={() => navigate("/build", "editor")}
      onOpenResult={() => navigate("/result", "result")}
      onOpenHistory={() => navigate("/history", "history")}
      onCopyBudgetLadderShare={copyBudgetLadderShare}
      onRemoveBudgetLadderShare={forgetBudgetLadderShare}
      onToastBudgetLadderShare={setToast}
      onCopyAlternativeComparisonShare={copyAlternativeComparisonShare}
      onRemoveAlternativeComparisonShare={forgetAlternativeComparisonShare}
      onRevokeAlternativeComparisonShare={async (entry) => entry.ownerToken ? revokeAlternativeComparison({ id: entry.id, url: entry.url, ownerToken: entry.ownerToken }) : false}
      onToastAlternativeComparisonShare={setToast}
      onCopySavedBuildVersionShare={copySavedBuildVersionShare}
      onRemoveSavedBuildVersionShare={forgetSavedBuildVersionShare}
      onRevokeSavedBuildVersionShare={revokeSavedBuildVersionShare}
      onToastSavedBuildVersionShare={setToast}
      onToast={setToast}
      />
    </Suspense>
  ) : view === "generator" ? (
    <Suspense fallback={<div className="shared-build-state"><FiLoader className="spin" /><span>자동 구성 화면을 불러오는 중...</span></div>}>
      <BuildGeneratorView
        initialProfile={recommendationPreferences.profile}
        draft={generatorDraft}
        variants={generatorVariants}
        budgetLadder={generatorBudgetLadder}
        requestError={generatorError}
        diagnostics={generatorDiagnostics}
        recoveryOptions={generatorRecoveryOptions}
        loading={generating}
        onGenerate={generateDraft}
        onGenerateVariants={generateDraftVariants}
        onGenerateBudgetLadder={generateDraftBudgetLadder}
        onApply={applyGeneratedDraft}
        onSave={(draft) => void saveGeneratedDraft(draft)}
        onToast={setToast}
        onBudgetLadderShareSaved={rememberBudgetLadderShare}
        onBudgetLadderShareRevoked={forgetBudgetLadderShare}
        onBack={() => navigate("/", "home")}
      />
    </Suspense>
  ) : view === "editor" ? (
    <EditorView
      build={build}
      setBuild={setBuild}
      partMap={partMap}
      accessoryMap={accessoryMap}
      meta={meta}
      checking={checking}
      checkError={checkError}
      hasLastResult={Boolean(result)}
      recommendationPreferences={recommendationPreferences}
      changeHistory={changeHistory}
      onRecommendationPreferencesChange={setRecommendationPreferences}
      onRestoreChange={(entry) => void restoreBuildHistory(entry)}
      onOpenPicker={(category) => setPicker({ category })}
      onChangeAccessoryQuantity={(index, quantity) => void changeAccessoryQuantity(index, quantity)}
      onChangeAccessoryTarget={(index, targetPartId) => void changeAccessoryTarget(index, targetPartId)}
      onChangeAccessoryHubTarget={(index, targetAccessoryId) => void changeAccessoryHubTarget(index, targetAccessoryId)}
      onChangeRgbController={(targetAccessoryId) => void changeRgbControllerTarget(targetAccessoryId)}
      onRemoveAccessory={(index) => void removeAccessory(index)}
      onCheck={() => void checkBuild()}
      onExportBuild={exportBuildDraft}
      onImportBuild={importBuildDraft}
      onToast={setToast}
      onRefreshCatalogItem={(target) => void refreshCatalogItem(target)}
      onRefreshAllCatalogItems={(targets) => void refreshAllCatalogItems(targets)}
      refreshingPartId={refreshingPartId}
      onReset={() => {
        checkRequestSequenceRef.current += 1;
        setBuild(emptyBuild());
        setResult(null);
        setBuildChangeResultComparison(null);
        setSavedCheckHistory(null);
        setCheckedInputFingerprint(null);
        setCheckError(null);
        setToast("견적을 초기화했습니다.");
      }}
      onBack={() => navigate("/", "home")}
    />
  ) : view === "catalog" ? (
    <Suspense fallback={<div className="shared-build-state"><FiLoader className="spin" /><span>부품 카탈로그를 불러오는 중...</span></div>}><LazyCatalogView meta={meta} build={build} partMap={partMap} profile={recommendationPreferences.profile} gamingResolution={recommendationPreferences.gamingResolution} gamingRefreshRate={recommendationPreferences.gamingRefreshRate} onAddPart={addCatalogPart} onCompareParts={compareCatalogScenarios} compareReady={Boolean(result && !resultIsStale)} onWatchPart={watchPart} isPartWatched={partIsWatched} onOpenWatchlist={() => navigate("/watchlist", "pricewatchlist")} onOpenBuild={() => navigate("/build", "editor")} onOpenAccessories={(query) => navigate(query?.trim() ? `/accessories?q=${encodeURIComponent(query.trim())}` : "/accessories", "accessories")} onShareComparison={shareAlternativeComparison} onRevokeComparison={revokeAlternativeComparison} onToast={setToast} onBack={() => navigate("/", "home")} /></Suspense>
  ) : view === "accessories" ? (
    <Suspense fallback={<div className="accessory-page accessory-page-loading" role="status"><FiLoader className="spin" /> 주변 부품 카탈로그를 불러오는 중...</div>}><LazyAccessoryView meta={meta} accessoryItems={accessoryItems} selectedAccessories={accessorySelections(build)} onAddAccessory={(item) => void addAccessory(item)} onWatchAccessory={watchAccessory} isAccessoryWatched={accessoryIsWatched} onOpenWatchlist={() => navigate("/watchlist", "pricewatchlist")} onOpenBuild={() => navigate("/build", "editor")} onBack={() => navigate("/", "home")} onToast={setToast} formatWon={formatWon} AccessoryVisual={AccessoryVisual} /></Suspense>
  ) : view === "pricewatchlist" ? (
    <Suspense fallback={<div className="shared-build-state"><FiLoader className="spin" /><span>가격 추적 화면을 불러오는 중...</span></div>}><PriceWatchlistView onBack={() => navigate("/", "home")} onToast={setToast} /></Suspense>
  ) : view === "budget" ? (
    <Suspense fallback={<div className="shared-budget-ladder-state"><FiLoader className="spin" /> 공유 예산 비교 화면을 불러오는 중...</div>}><LazySharedBudgetLadderView onBack={() => navigate("/", "home")} onToast={setToast} onApplyDraft={applyGeneratedDraft} onApplyMergedSelection={applyMergedGeneratedSelection} onPreviewMergedSelection={previewMergedGeneratedSelection} onBudgetLadderShareSaved={rememberBudgetLadderShare} onBudgetLadderShareRevoked={forgetBudgetLadderShare} /></Suspense>
  ) : view === "version-comparison" ? (
    <Suspense fallback={<div className="shared-version-comparison-state"><FiLoader className="spin" /> 공유 견적 버전 비교 화면을 불러오는 중...</div>}><LazySharedSavedBuildVersionView onBack={() => navigate("/", "home")} onToast={setToast} /></Suspense>
  ) : view === "comparison" ? (
    <Suspense fallback={<div className="shared-comparison-state"><FiLoader className="spin" /> 공유 부품 비교 화면을 불러오는 중...</div>}><LazySharedAlternativeComparisonView onBack={() => navigate("/", "home")} onToast={setToast} /></Suspense>
  ) : view === "watchlist" ? (
    <Suspense fallback={<div className="shared-watchlist-state"><FiLoader className="spin" /> 공유 가격 추적 목록을 불러오는 중...</div>}><LazySharedWatchlistView onBack={() => navigate("/", "home")} onImport={importSavedWatchlist} /></Suspense>
  ) : view === "admin" ? (
    <Suspense fallback={<div className="shared-build-state"><FiLoader className="spin" /><span>데이터 센터를 불러오는 중...</span></div>}><AdminView
      meta={meta}
      onMetaRefresh={refreshMeta}
      onToast={setToast}
    /></Suspense>
  ) : view === "history" ? (
    <HistoryView
      builds={savedBuilds}
      currentBuild={build}
      currentPreferences={recommendationPreferences}
      partMap={partMap}
      accessoryMap={accessoryMap}
      monitorAlerts={savedBuildMonitorAlerts}
      onMonitorAlertsChange={setSavedBuildMonitorAlerts}
      browserNotificationPermission={browserNotificationPermission}
      browserNotificationEnabled={browserNotificationEnabled}
      onRequestBrowserNotifications={requestBrowserNotifications}
      onBrowserNotificationsEnabledChange={setBrowserNotificationEnabled}
      onBack={() => navigate("/", "home")}
      onOpen={(saved, focus) => void openSavedBuild(saved, focus)}
      onRefreshSavedBuilds={refreshSavedBuildsForBrowser}
      onStart={() => navigate("/build", "editor")}
      onRevoke={(id) => void revokeSavedBuildById(id)}
      revokingShare={revokingShare}
      onEditMetadata={requestEditSavedBuildMetadata}
      onRecordCheck={(id) => void recordSavedBuildCheck(id)}
      recordingCheckId={recordingCheckId}
      openingBuildId={openingSavedBuildId}
      onShareVersionComparison={shareSavedBuildVersionComparison}
      onToast={setToast}
    />
  ) : shareLoading ? (
    <div className="shared-build-state"><FiLoader className="spin" /><span>공유 견적을 불러오는 중...</span></div>
  ) : shareLoadError ? (
    <SharedBuildErrorView message={shareLoadError} onRetry={() => setShareLoadRetryNonce((current) => current + 1)} onBack={() => navigate("/", "home")} />
  ) : (
    <LazyResultView
      dependencies={resultViewDependencies}
      build={build}
      result={result}
      savedCheckHistory={savedCheckHistory}
      resultIsStale={resultIsStale}
      partMap={partMap}
      accessoryMap={accessoryMap}
      shareId={shareId}
      shareExpiresAt={shareExpiresAt}
      decisionNote={shareId ? savedBuilds.find((saved) => saved.id === shareId)?.decisionNote : undefined}
      shareOwnerToken={shareOwnerToken}
      shareOwnerTokenAvailable={Boolean(shareOwnerToken)}
      recordingSavedCheck={Boolean(shareId && recordingCheckId === shareId)}
      revokingShare={revokingShare}
      checking={checking}
      checkError={checkError}
      scenarioPreview={scenarioPreview}
      buildChangeResultComparison={buildChangeResultComparison}
      onCopyBuildChangeResultComparison={() => void copyBuildChangeResultComparison()}
      onDownloadBuildChangeResultComparison={downloadBuildChangeResultComparison}
      onSaveBuildChangeResultAsDecisionNote={saveBuildChangeResultAsDecisionNote}
      purchaseChecklistKey={currentInputFingerprint}
      upgradeBundleScenarioPreview={upgradeBundleScenarioPreview}
      onPreviewSuggestion={(category, part, quantity, affectedPartIds, evidence) => void previewSuggestion(category, part, quantity, affectedPartIds, evidence)}
      onCompareSuggestions={(suggestions, affectedPartIds) => compareSuggestionScenarios(suggestions, affectedPartIds)}
      onPreviewUpgradeBundle={(bundle) => void previewUpgradeBundle(bundle)}
      onDismissUpgradeBundleScenarioPreview={() => { scenarioRequestSequenceRef.current += 1; setUpgradeBundleScenarioPreview(null); }}
      onDismissScenarioPreview={() => { scenarioRequestSequenceRef.current += 1; setScenarioPreview(null); }}
      onDismissBuildChangeResultComparison={() => setBuildChangeResultComparison(null)}
      onEdit={() => navigate("/build", "editor")}
      onCloneSharedBuild={cloneSharedBuildToDraft}
      onBack={() => navigate("/", "home")}
      onCheck={() => void checkBuild()}
      initialFindingRuleId={pendingResultFindingRuleId}
      onInitialFindingFocus={() => setPendingResultFindingRuleId(null)}
      onRecordSavedCheck={shareId && shareOwnerToken ? () => void recordSavedBuildCheck(shareId) : undefined}
      onAssemblyVerificationSynced={(saved) => { setSavedBuilds((current) => current.map((item) => item.id === saved.id ? saved : item)); if (shareId === saved.id) setSavedCheckHistory(saved.checkHistory ?? (saved.checkSnapshot ? [saved.checkSnapshot] : null)); setToast("실측 로그를 저장 견적의 읽기 전용 이력에 기록했습니다."); }}
      onPurchaseProgressSynced={updateCurrentSavedBuildPurchaseProgress}
      onPurchasePriceHistorySynced={updateCurrentSavedBuildPurchasePriceHistory}
      onWatchEntry={watchCatalogEntry}
      isWatchedEntry={isCatalogWatchEntryWatched}
      onRevokeShare={() => void revokeSharedBuild()}
      onSave={requestSaveBuild}
      onCopyResultLink={() => void copyResultLink()}
      onCopyReport={() => void copyCompatibilityReport()}
      onDownloadReport={downloadCompatibilityReport}
      catalogRefreshReport={catalogRefreshReport}
      onRefreshCatalogItem={(target) => void refreshCatalogItem(target)}
      onRefreshAll={(targets) => void refreshAllCatalogItems(targets)}
      refreshingPartId={refreshingPartId}
      onOpenPicker={(category, findingRuleId, findingTitle, affectedPartIds) => setPicker({ category, findingRuleId: findingRuleId?.replace(/^precision:/, ""), findingTitle, affectedPartIds, ...(findingRuleId?.startsWith("precision:") ? { initialCandidateMode: "precision" as const } : {}) })}
      onApplySuggestion={(category, part, quantity, affectedPartIds, evidence) => void applySuggestion(category, part, quantity, affectedPartIds, evidence)}
      onApplyUpgradeBundle={(bundle) => void applyUpgradeBundle(bundle)}
      onApplyRepairPlan={(plan) => void applyRepairPlan(plan)}
      onSavePlan={(nextBuild, nextPreferences, label, parentBuildId) => requestSaveBuild({ build: nextBuild, preferences: nextPreferences, label, ...(parentBuildId ? { parentBuildId } : {}) })}
          onCopyPurchaseList={(checkedIds?: ReadonlySet<string>, rows?: PurchaseListRow[], itemStates?: ReadonlyArray<PurchaseListItemStatus>) => void copyPurchaseList(checkedIds, rows, itemStates)}
      onDownloadPurchaseList={downloadPurchaseList}
      onOpenCatalogItem={openPurchaseListItem}
      changeHistory={changeHistory}
      onRestoreChange={(entry) => void restoreBuildHistory(entry)}
      onAddAccessory={addAccessory}
      onChangeAccessoryQuantity={(index, quantity) => void changeAccessoryQuantity(index, quantity)}
      onChangeAccessoryTarget={(index, targetPartId) => void changeAccessoryTarget(index, targetPartId)}
      onChangeAccessoryHubTarget={(index, targetAccessoryId) => void changeAccessoryHubTarget(index, targetAccessoryId)}
      onChangeRgbController={(targetAccessoryId) => void changeRgbControllerTarget(targetAccessoryId)}
      onRemoveAccessory={(index) => void removeAccessory(index)}
      onToast={setToast}
      onWatchPart={watchPart}
      onShareComparison={shareAlternativeComparison}
      onRevokeComparison={revokeAlternativeComparison}
      recommendationPreferences={recommendationPreferences}
      onRecommendationPreferencesChange={setRecommendationPreferences}
      onRecommendationPreferencesCommit={(next) => { setRecommendationPreferences(next); void checkBuild(build, next); }}
    />
  );

  const BuildChangeDialog = buildChangeDialogComponent;
  return (
    <div className="app-shell" data-route-key={locationKey}>
      <a className="skip-to-content" href="#main-content">본문으로 건너뛰기</a>
      <Suspense fallback={<AppHeaderLoadingFallback />}><LazyAppHeader view={view} networkOnline={networkOnline} apiStatus={apiStatusDetails} bootstrapLoading={bootstrapLoading} bootstrapErrorCount={bootstrapIssues.length} savedBuildUnreadAlertCount={savedBuildUnreadAlertCount} catalogRefreshProgress={catalogRefreshProgress} onHome={() => navigate("/", "home")} onBuild={() => navigate("/build", "editor")} onGenerate={() => openGenerator()} onCatalog={() => navigate("/catalog", "catalog")} onAccessories={() => navigate("/accessories", "accessories")} onPriceWatchlist={() => navigate("/watchlist", "pricewatchlist")} onHistory={() => navigate("/history", "history")} /></Suspense>
      <main className="page-container" id="main-content" tabIndex={-1}>{(incomingDraft || incomingPreferences) && <DraftSyncNotice build={incomingDraft ?? undefined} preferences={incomingPreferences ?? undefined} onApply={() => { skipNextHistoryRef.current = true; if (incomingDraft) setBuild(incomingDraft); if (incomingPreferences) setRecommendationPreferences(incomingPreferences); setResult(null); setCheckedInputFingerprint(null); setChangeHistory([]); setIncomingDraft(null); setIncomingPreferences(null); setToast("다른 탭에서 변경한 견적 또는 추천 기준을 불러왔습니다. 현재 기준으로 다시 검사해 주세요."); }} onDismiss={() => { setIncomingDraft(null); setIncomingPreferences(null); }} />}{(bootstrapIssues.length > 0 || !networkOnline || apiStatusDetails.status === "offline" || apiStatusDetails.status === "degraded") && <BootstrapNotice issues={bootstrapIssues} online={networkOnline} apiStatus={apiStatusDetails} onRetry={(resource) => setBootstrapRetryRequest((current) => ({ resource, nonce: current.nonce + 1 }))} onRetryAll={() => setBootstrapRetryRequest((current) => ({ resource: null, nonce: current.nonce + 1 }))} retryingResource={bootstrapLoading ? bootstrapRetryRequest.resource : null} retryingAll={bootstrapLoading && bootstrapRetryRequest.resource === null} />}<div className={`route-stage route-stage-${view}`} key={view}>{content}</div></main>
      {candidateScenarioComparison && result && <Suspense fallback={<div className="modal-backdrop" role="presentation"><section className="candidate-scenario-dialog candidate-scenario-dialog-loading" role="dialog" aria-modal="true" aria-label="부품 미리 비교 불러오는 중"><FiLoader className="spin" /> 선택한 부품을 전체 구성에 적용하는 중...</section></div>}><LazyCandidateScenarioComparisonPanel state={candidateScenarioComparison} currentResult={result} onApply={applyCandidateScenario} onSave={saveCandidateScenario} onRetry={(itemId) => void retryCandidateScenario(itemId)} onClose={() => { scenarioRequestSequenceRef.current += 1; setCandidateScenarioComparison(null); }} onWatchPart={watchPart} onShareComparison={shareAlternativeComparison} onRevokeComparison={revokeAlternativeComparison} onToast={setToast} formatWon={formatWon} /></Suspense>}
      {picker && (
        <PartPicker
          key={`${picker.category}-${picker.findingRuleId ?? "catalog"}`}
          category={picker.category}
          build={build}
          partMap={partMap}
          profile={recommendationPreferences.profile}
          recommendationListingPolicy={recommendationPreferences.listingPolicy}
          gamingResolution={recommendationPreferences.gamingResolution}
          gamingRefreshRate={recommendationPreferences.gamingRefreshRate}
          benchmarkCoverage={meta?.benchmarkCoverage}
          brandOptions={meta?.catalogBrandCounts?.[picker.category] ?? []}
          findingRuleId={picker.findingRuleId}
          findingTitle={picker.findingTitle}
          initialCandidateMode={picker.initialCandidateMode}
          affectedPartIds={picker.affectedPartIds}
          selected={selectionList(build, picker.category)}
          onClose={() => setPicker(null)}
          onSelect={selectPickerPart}
          onToast={setToast}
          onWatchPart={watchPart}
          onShareComparison={shareAlternativeComparison}
          onRevokeComparison={revokeAlternativeComparison}
          onPreview={view === "result" && result && !resultIsStale ? previewSuggestion : undefined}
          onCompareScenarios={view === "result" && result && !resultIsStale ? comparePickerScenarios : undefined}
          partSummary={partSummary}
          formatWon={formatWon}
          formatSpecValue={formatSpecValue}
          similarityEvidenceText={similarityEvidenceText}
          PartVisual={PartVisual}
          PartEvidence={PartEvidence}
          PartWatchButton={PartWatchButton}
        />
      )}
      {saveDialogOpen && <SaveBuildDialog name={saveName} decisionNote={saveDecisionNote} targetLabel={saveBuildTarget?.label} targetKind={saveBuildTarget?.kind} saving={saving} expiryDays={saveExpiryDays} onChange={setSaveName} onDecisionNoteChange={setSaveDecisionNote} onExpiryChange={setSaveExpiryDays} onClose={() => { setSaveDialogOpen(false); setSaveBuildTarget(null); }} onSubmit={() => void saveBuild()} />}
      {metadataEditTarget && <EditSavedBuildMetadataDialog name={metadataEditName} decisionNote={metadataEditDecisionNote} saving={metadataSaving} onChange={setMetadataEditName} onDecisionNoteChange={setMetadataEditDecisionNote} onClose={() => { metadataMutationRequestRef.current += 1; setMetadataEditTarget(null); }} onSubmit={() => void updateSavedBuildMetadata()} />}
      {buildImportPreview && <BuildImportPreviewDialog envelope={buildImportPreview} currentBuild={build} currentPreferences={recommendationPreferences} partMap={partMap} accessoryMap={accessoryMap} onClose={() => setBuildImportPreview(null)} onConfirm={applyImportedBuild} />}
      {pendingBuildChange && (BuildChangeDialog ? <BuildChangeDialog change={pendingBuildChange} checking={checking} onClose={() => setPendingBuildChange(null)} onConfirm={() => void confirmBuildChange()} formatPriceDelta={formatPriceDelta} /> : <div className="modal-backdrop" role="presentation"><section className="shared-build-state" role="status" data-testid="build-change-dialog-loading"><FiLoader className="spin" /> 변경 미리보기를 준비하는 중...</section></div>)}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function SharedBuildErrorView({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => void }) {
  return <div className="shared-build-page"><div className="workspace-heading"><div><button className="back-link" type="button" onClick={onBack}><FiArrowLeft /> 홈으로</button><p className="eyebrow">SHARED BUILD</p><h1>공유 견적을 열 수 없습니다.</h1><p>링크가 만료되었거나 현재 카탈로그 기준으로 공유 견적을 불러오지 못했습니다.</p></div><span className="admin-badge"><FiShare2 /> 공유 링크</span></div><div className="shared-build-state error" role="alert"><FiXCircle /><div><strong>{message}</strong><p>공유 링크의 상태를 다시 확인한 뒤 재시도해 주세요.</p></div><div className="shared-build-actions"><button className="button button-secondary" type="button" onClick={onRetry}><FiRefreshCw /> 다시 시도</button><button className="button button-light" type="button" onClick={onBack}>홈으로</button></div></div></div>;
}

function BuildImportPreviewDialog({ envelope, currentBuild, currentPreferences, partMap, accessoryMap, onClose, onConfirm }: { envelope: BuildTransferEnvelope; currentBuild: BuildSelection; currentPreferences: RecommendationPreferences; partMap: Map<string, Part>; accessoryMap: Map<string, AccessoryItem>; onClose: () => void; onConfirm: (envelope: BuildTransferEnvelope) => void }) {
  useModalAccessibility({ onClose, selector: '[aria-labelledby="build-import-preview-title"]' });
  const preflight = buildPreflightFor(envelope.selection, partMap, accessoryMap);
  const diff = buildTransferDiffFor(currentBuild, currentPreferences, envelope.selection, envelope.recommendationPreferences, { partName: (partId) => partMap.get(partId)?.name, accessoryName: (accessoryId) => accessoryMap.get(accessoryId)?.name });
  const statusLabel: Record<BuildPreflight["status"], string> = { ready: "검사 준비 완료", needs_selection: "필수 선택 확인 필요", needs_data_review: "데이터 확인 필요" };
  const selectedCoreCategories = PART_CATEGORIES.filter((category) => selectionList(envelope.selection, category).length > 0).length;
  const m2SlotCount = Object.keys(envelope.selection.m2SlotSelection ?? {}).length;
  const preferenceText = `${RECOMMENDATION_PROFILE_LABELS[envelope.recommendationPreferences.profile]} · ${RECOMMENDATION_PRIORITY_LABELS[envelope.recommendationPreferences.priority]} · ${LISTING_POLICY_LABELS[envelope.recommendationPreferences.listingPolicy ?? "retail_only"]}${envelope.recommendationPreferences.profile === "gaming" ? ` · ${GAMING_RESOLUTION_LABELS[envelope.recommendationPreferences.gamingResolution ?? "1440p"]} · ${GAMING_REFRESH_RATE_LABELS[envelope.recommendationPreferences.gamingRefreshRate ?? 144]}` : ""}`;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="build-import-dialog" role="dialog" aria-modal="true" aria-labelledby="build-import-preview-title"><div className="modal-header"><div><p className="eyebrow">IMPORT PREVIEW</p><h2 id="build-import-preview-title">견적 JSON 미리보기</h2><p>현재 편집기 값을 바꾸기 전에 가져올 구성을 확인합니다.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="견적 JSON 미리보기 닫기"><FiXCircle /></button></div><div className={`build-import-status ${preflight.status}`}><strong>{statusLabel[preflight.status]}</strong><span>schemaVersion {envelope.schemaVersion}</span></div><div className="build-import-stats"><div><span>선택 카테고리</span><strong>{selectedCoreCategories}개</strong></div><div><span>선택 부품</span><strong>{preflight.selectedPartCount}개</strong></div><div><span>주변 부품</span><strong>{preflight.selectedAccessoryCount}개</strong></div><div><span>M.2 수동 배치</span><strong>{m2SlotCount}개</strong></div></div><div className="build-import-preferences"><span>추천 기준</span><strong>{preferenceText}</strong>{envelope.recommendationPreferences.budgetWon !== undefined && <small>목표 예산 {envelope.recommendationPreferences.budgetWon.toLocaleString("ko-KR")}원</small>}</div>{diff.changedCount > 0 ? <div className="build-import-diff"><div className="build-import-diff-heading"><strong>가져오기 변경 예정</strong><span>{diff.changedCount}개 항목</span></div><div className="build-import-diff-list">{diff.rows.map((row) => <div className="build-import-diff-row" key={row.id}><span>{row.label}</span><small>{row.before} → {row.after}</small></div>)}</div></div> : <p className="build-import-diff-clear"><FiCheckCircle /> 현재 편집기와 구성·추천 기준이 같습니다.</p>}{preflight.issues.length > 0 ? <div className="build-import-issues"><strong>가져온 구성에서 확인할 항목</strong>{preflight.issues.slice(0, 5).map((issue) => <p key={issue.id}><b>{issue.label}</b> · {issue.message}</p>)}{preflight.issues.length > 5 && <small>그 외 {preflight.issues.length - 5}개 항목은 편집기 사전 점검에서 확인합니다.</small>}</div> : <p className="build-import-clear"><FiCheckCircle /> 현재 카탈로그에서 선택한 부품 기본 정보를 확인할 수 있습니다.</p>}<p className="build-import-note"><FiInfo /> 확인하면 현재 편집기 구성을 이 파일의 구성으로 교체합니다. 저장된 공유 견적이나 서버 데이터는 삭제·변경하지 않으며, 가져온 뒤 호환성 검사는 자동 실행하지 않습니다.</p><div className="build-import-actions"><button className="button button-light" type="button" onClick={onClose}>취소</button><button className="button button-primary" type="button" onClick={() => onConfirm(envelope)}>이 구성으로 가져오기</button></div></section></div>;
}

function SaveBuildDialog({ name, decisionNote, targetLabel, targetKind, saving, expiryDays, onChange, onDecisionNoteChange, onExpiryChange, onClose, onSubmit }: { name: string; decisionNote: string; targetLabel?: string; targetKind?: SaveBuildTarget["kind"]; saving: boolean; expiryDays: SavedWatchlistExpiryDays; onChange: (value: string) => void; onDecisionNoteChange: (value: string) => void; onExpiryChange: (value: SavedWatchlistExpiryDays) => void; onClose: () => void; onSubmit: () => void }) {
  useModalAccessibility({ onClose, closeOnEscape: !saving, selector: '[aria-labelledby="save-build-dialog-title"]' });
  const targetTitle = targetKind === "candidate" ? "비교 구성 새 견적으로 저장" : targetKind === "generated" ? "자동 구성 새 견적 저장" : "수리 플랜 새 견적 저장";
  const targetInfo = targetKind === "candidate" ? "현재 견적은 그대로 두고, 비교한 구성이 따로 저장돼요." : targetKind === "generated" ? "현재 견적은 유지되고, 자동 구성 결과가 별도 저장됩니다." : "현재 견적은 유지되고, 비교한 수리 플랜 구성이 별도 저장됩니다.";
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="save-build-dialog" role="dialog" aria-modal="true" aria-labelledby="save-build-dialog-title"><div className="modal-header"><div><p className="eyebrow">SAVE BUILD</p><h2 id="save-build-dialog-title">{targetLabel ? targetTitle : "견적 저장·공유"}</h2><p>{targetLabel ? `${targetLabel}을 현재 견적과 별도의 새 견적으로 저장합니다.` : "이름과 선택 이유를 남기고 공유 링크 유효기간을 정합니다."}</p></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="견적 저장 창 닫기"><FiXCircle /></button></div><form className="save-build-form" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(); }}><label htmlFor="save-build-name">견적 이름</label><input id="save-build-name" data-modal-autofocus maxLength={SAVED_BUILD_NAME_MAX_LENGTH} value={name} onChange={(event) => onChange(event.target.value)} placeholder="예: 4K 게이밍 PC" disabled={saving} /><label htmlFor="save-build-decision-note">선택 이유 <span>(선택)</span></label><textarea id="save-build-decision-note" maxLength={SAVED_BUILD_DECISION_NOTE_MAX_LENGTH} rows={3} value={decisionNote} onChange={(event) => onDecisionNoteChange(event.target.value)} placeholder="예: QHD 게이밍, 그래픽카드 교체 여유, 예산 우선" disabled={saving} /><small className="save-build-note-counter">{decisionNote.length}/{SAVED_BUILD_DECISION_NOTE_MAX_LENGTH} · 공유 링크에도 함께 표시됩니다.</small><label htmlFor="save-build-expiry">공유 링크 유효기간</label><select id="save-build-expiry" aria-label="견적 공유 링크 유효기간" value={expiryDays} onChange={(event) => onExpiryChange(event.target.value === "7" ? 7 : event.target.value === "30" ? 30 : "never")} disabled={saving}><option value="never">무기한</option><option value="7">7일</option><option value="30">30일</option></select><p><FiInfo /> {targetLabel ? targetInfo : "현재 부품, 주변 부품, 추천 기준과 저장 순간의 검사 요약이 함께 보존됩니다."} {decisionNote.trim() ? "선택 이유는 공유 견적과 이력에서 다시 확인할 수 있습니다." : "선택 이유를 남기면 나중에 견적을 고른 기준을 다시 확인할 수 있습니다."} 만료된 링크는 다시 열 수 없습니다.</p><div className="save-build-actions"><button className="button button-light" type="button" onClick={onClose} disabled={saving}>취소</button><button className="button button-primary" type="submit" disabled={saving || !name.trim()}>{saving ? <><FiLoader className="spin" /> 저장 중...</> : <><FiSave /> 저장하고 링크 복사</>}</button></div></form></section></div>;
}

function EditSavedBuildMetadataDialog({ name, decisionNote, saving, onChange, onDecisionNoteChange, onClose, onSubmit }: { name: string; decisionNote: string; saving: boolean; onChange: (value: string) => void; onDecisionNoteChange: (value: string) => void; onClose: () => void; onSubmit: () => void }) {
  useModalAccessibility({ onClose, closeOnEscape: !saving, selector: '[aria-labelledby="edit-saved-build-dialog-title"]' });
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="save-build-dialog edit-saved-build-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-saved-build-dialog-title" data-testid="edit-saved-build-dialog"><div className="modal-header"><div><p className="eyebrow">EDIT BUILD CONTEXT</p><h2 id="edit-saved-build-dialog-title">저장 견적 설명 수정</h2><p>부품 구성과 저장 당시 검사 기록은 유지하고, 이름과 선택 이유만 수정합니다.</p></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="저장 견적 설명 수정 창 닫기"><FiXCircle /></button></div><form className="save-build-form" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(); }}><label htmlFor="edit-saved-build-name">견적 이름</label><input id="edit-saved-build-name" data-modal-autofocus maxLength={SAVED_BUILD_NAME_MAX_LENGTH} value={name} onChange={(event) => onChange(event.target.value)} placeholder="예: QHD 게이밍 PC" disabled={saving} /><label htmlFor="edit-saved-build-decision-note">선택 이유 <span>(선택)</span></label><textarea id="edit-saved-build-decision-note" maxLength={SAVED_BUILD_DECISION_NOTE_MAX_LENGTH} rows={4} value={decisionNote} onChange={(event) => onDecisionNoteChange(event.target.value)} placeholder="예: 소음과 업그레이드 여유를 우선" disabled={saving} /><small className="save-build-note-counter">{decisionNote.length}/{SAVED_BUILD_DECISION_NOTE_MAX_LENGTH} · 공유 결과에도 함께 표시됩니다.</small><p><FiInfo /> 선택 이유를 비우면 기존 메모를 삭제합니다. 저장된 부품 구성·검사 기록·구매 기록은 변경하지 않습니다.</p><div className="save-build-actions"><button className="button button-light" type="button" onClick={onClose} disabled={saving}>취소</button><button className="button button-primary" type="submit" disabled={saving || !name.trim()}>{saving ? <><FiLoader className="spin" /> 저장 중...</> : <><FiSave /> 변경사항 저장</>}</button></div></form></section></div>;
}

function RequestErrorNotice({ message, onRetry, retrying, hasLastResult }: { message: string; onRetry: () => void; retrying: boolean; hasLastResult: boolean }) {
  return <div className="request-error" role="alert">
    <div className="request-error-copy"><FiXCircle /><div><strong>잠시 문제가 생겼어요.</strong></div></div>
    <RetryAfterButton className="button button-small button-light" message={message} onRetry={onRetry} retrying={retrying} idleContent={<><FiRefreshCw /> 다시 시도</>} retryingContent={<><FiLoader className="spin" /> 재시도 중...</>} testId="request-retry-button" />
  </div>;
}

function MobileEditorSurface({ build, partMap, accessoryMap, checking, checkError, hasLastResult, recommendationPreferences, onRecommendationPreferencesChange, onOpenPicker, onCheck, onExportBuild, onImportBuild, onReset, onRefreshCatalogItem, onRefreshAllCatalogItems, refreshingPartId, onToast }: {
  build: BuildSelection;
  partMap: Map<string, Part>;
  accessoryMap: Map<string, AccessoryItem>;
  checking: boolean;
  checkError: string | null;
  hasLastResult: boolean;
  recommendationPreferences: RecommendationPreferences;
  onRecommendationPreferencesChange: (next: RecommendationPreferences) => void;
  onOpenPicker: (category: PartCategory) => void;
  onCheck: () => void;
  onExportBuild: () => void;
  onImportBuild: (raw: string) => void;
  onReset: () => void;
  onRefreshCatalogItem: (target: RefreshTarget) => void;
  onRefreshAllCatalogItems: (targets: RefreshTarget[]) => void;
  refreshingPartId: string | null;
  onToast: (message: string) => void;
}) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const preflight = buildPreflightFor(build, partMap, accessoryMap);
  const selectedCount = preflight.requiredSelectedCount;
  const progress = preflight.requiredTotal > 0 ? Math.round((selectedCount / preflight.requiredTotal) * 100) : 0;

  async function importBuildFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > LOCAL_IMPORT_MAX_BYTES) {
      onToast("견적 JSON 파일은 1MB 이하만 가져올 수 있습니다.");
      return;
    }
    try {
      onImportBuild(await file.text());
    } catch {
      onToast("견적 JSON 파일을 읽지 못했습니다.");
    }
  }

  return <section className="mobile-editor-surface" aria-label="모바일 견적 편집">
    <div className="mobile-editor-heading"><div><span className="mobile-kicker">BUILD / EDIT</span><h1>견적 구성</h1></div><span className="mobile-editor-count"><strong>{selectedCount}</strong><small>/ {preflight.requiredTotal} 필수</small></span></div>
    <div className="mobile-editor-tools"><input ref={importInputRef} type="file" accept=".json,application/json" aria-label="견적 JSON 파일 가져오기" onChange={(event) => void importBuildFile(event)} disabled={checking} /><button type="button" onClick={() => importInputRef.current?.click()} disabled={checking}><FiDatabase /> 가져오기</button><button type="button" onClick={onExportBuild} disabled={checking}><FiDownload /> 저장</button><button type="button" onClick={onReset} disabled={checking}><FiRefreshCw /> 초기화</button></div>
    <div className="mobile-editor-progress"><div><span>검사 준비</span><strong>{selectedCount} / {preflight.requiredTotal}</strong></div><div className="mobile-progress-track"><span style={{ width: `${progress}%` }} /></div></div>
    <section className="mobile-editor-list" aria-label="부품 선택 목록"><div className="mobile-section-heading"><div><span className="mobile-kicker">COMPONENTS</span><h2>부품 선택</h2></div></div><div className="mobile-editor-rows">{PART_CATEGORIES.map((category) => { const categoryMeta = CATEGORY_META[category]; const selections = selectionList(build, category); const boxedCooler = category === "cooler" && build.cpu ? partMap.get(build.cpu.partId)?.specs.coolerIncluded === true : false; const chosen = selections.length > 0 || boxedCooler; const summary = selections.length === 0 ? boxedCooler ? "선택한 CPU에 기본 포함" : categoryMeta.required ? "필수 부품을 선택해 주세요" : "선택 사항" : selections.map((selection) => `${partMap.get(selection.partId)?.name ?? selection.partId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`).join(", "); const RowIcon = categoryMeta.Icon; return <button className={`mobile-editor-row ${chosen ? "chosen" : ""}`} type="button" key={category} onClick={() => onOpenPicker(category)}><span className="mobile-editor-row-icon"><RowIcon /></span><span className="mobile-editor-row-copy"><strong>{categoryMeta.label}{categoryMeta.required && <em>필수</em>}</strong><small>{summary}</small></span>{!chosen && <span className={`mobile-editor-row-state ${categoryMeta.required ? "required" : "optional"}`}>{categoryMeta.required ? "필수" : "선택"}</span>}<FiArrowRight className="mobile-editor-row-arrow" /></button>; })}</div></section>
    <details className="mobile-editor-advanced"><summary><span><FiActivity /> 추천 기준·가격·데이터 확인</span></summary><div className="mobile-editor-advanced-content"><RecommendationControls preferences={recommendationPreferences} onChange={onRecommendationPreferencesChange} disabled={checking} /><BuildPriceSummaryPanel snapshot={buildPriceSnapshotFor(build, partMap, accessoryMap)} budgetWon={recommendationPreferences.budgetWon} unknownItems={unknownPriceItemsFor(build, partMap, accessoryMap)} onRefresh={onRefreshCatalogItem} refreshingItemId={refreshingPartId} /><BuildPreflightPanel preflight={preflight} onRefresh={onRefreshCatalogItem} onRefreshAll={onRefreshAllCatalogItems} refreshingPartId={refreshingPartId} /></div></details>
    {checkError && <RequestErrorNotice message={checkError} onRetry={onCheck} retrying={checking} hasLastResult={hasLastResult} />}
    <div className="mobile-editor-submit"><button className="mobile-primary-action" type="button" onClick={onCheck} disabled={checking || preflight.status !== "ready"}>{checking ? <><FiLoader className="spin" /><span>검사 중...</span></> : <><FiSearch /><span>호환성 검사하기</span><FiArrowRight /></>}</button></div>
  </section>;
}

function EditorView({
  build,
  setBuild,
  partMap,
  accessoryMap,
  meta,
  checking,
  checkError,
  hasLastResult,
  recommendationPreferences,
  changeHistory,
  onRecommendationPreferencesChange,
  onRestoreChange,
  onOpenPicker,
  onChangeAccessoryQuantity,
  onChangeAccessoryTarget,
  onChangeAccessoryHubTarget,
  onChangeRgbController,
  onRemoveAccessory,
  onCheck,
  onExportBuild,
  onImportBuild,
  onToast,
  onRefreshCatalogItem,
  onRefreshAllCatalogItems,
  refreshingPartId,
  onReset,
  onBack
}: {
  build: BuildSelection;
  setBuild: React.Dispatch<React.SetStateAction<BuildSelection>>;
  partMap: Map<string, Part>;
  accessoryMap: Map<string, AccessoryItem>;
  meta: ServiceMeta | null;
  checking: boolean;
  checkError: string | null;
  hasLastResult: boolean;
  recommendationPreferences: RecommendationPreferences;
  changeHistory: BuildHistoryEntry[];
  onRecommendationPreferencesChange: (next: RecommendationPreferences) => void;
  onRestoreChange: (entry: BuildHistoryEntry) => void;
  onOpenPicker: (category: PartCategory) => void;
  onChangeAccessoryQuantity: (index: number, quantity: number) => void;
  onChangeAccessoryTarget: (index: number, targetPartId: string | undefined) => void;
  onChangeAccessoryHubTarget: (index: number, targetAccessoryId: string | undefined) => void;
  onChangeRgbController: (targetAccessoryId: string | undefined) => void;
  onRemoveAccessory: (index: number) => void;
  onCheck: () => void;
  onExportBuild: () => void;
  onImportBuild: (raw: string) => void;
  onToast: (message: string) => void;
  onRefreshCatalogItem: (target: RefreshTarget) => void;
  onRefreshAllCatalogItems: (targets: RefreshTarget[]) => void;
  refreshingPartId: string | null;
  onReset: () => void;
  onBack: () => void;
}) {
  const preflight = buildPreflightFor(build, partMap, accessoryMap);
  const buildImportInputRef = useRef<HTMLInputElement>(null);
  async function importBuildFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > LOCAL_IMPORT_MAX_BYTES) {
      onToast("견적 JSON 파일은 1MB 이하만 가져올 수 있습니다.");
      return;
    }
    try {
      onImportBuild(await file.text());
    } catch {
      onToast("견적 JSON 파일을 읽지 못했습니다.");
    }
  }
  const requiredCount = preflight.requiredTotal;
  const selectedCount = preflight.requiredSelectedCount;
  return (
    <div className="workspace-page">
      <MobileEditorSurface build={build} partMap={partMap} accessoryMap={accessoryMap} checking={checking} checkError={checkError} hasLastResult={hasLastResult} recommendationPreferences={recommendationPreferences} onRecommendationPreferencesChange={onRecommendationPreferencesChange} onOpenPicker={onOpenPicker} onCheck={onCheck} onExportBuild={onExportBuild} onImportBuild={onImportBuild} onReset={onReset} onRefreshCatalogItem={onRefreshCatalogItem} onRefreshAllCatalogItems={onRefreshAllCatalogItems} refreshingPartId={refreshingPartId} onToast={onToast} />
      <div className="desktop-editor-surface">
      <div className="workspace-heading">
        <div><button className="back-link" onClick={onBack}><FiArrowLeft /> 홈으로</button><p className="eyebrow">BUILD EDITOR</p><h1>내 견적 구성</h1><p>부품을 고르면, 함께 쓸 수 있는지 바로 확인할 수 있어요.</p></div>
        <div className="build-editor-actions"><input ref={buildImportInputRef} className="build-transfer-input" type="file" accept=".json,application/json" aria-label="견적 JSON 파일 가져오기" onChange={(event) => void importBuildFile(event)} disabled={checking} /><button className="button button-light" type="button" onClick={() => buildImportInputRef.current?.click()} disabled={checking}><FiDatabase /> 견적 JSON 가져오기</button><button className="button button-light" type="button" onClick={onExportBuild} disabled={checking}><FiDownload /> 견적 JSON 저장</button><button className="button button-ghost" type="button" onClick={onReset} disabled={checking}><FiRefreshCw /> 초기화</button></div>
      </div>
      <div className="progress-strip"><div><span className="progress-label">필수 부품 선택</span><strong>{selectedCount} / {requiredCount}</strong></div><div className="progress-track"><span style={{ width: `${(selectedCount / requiredCount) * 100}%` }} /></div></div>
      {checking && <Suspense fallback={<div className="compatibility-check-progress" data-testid="compatibility-check-progress" role="status"><FiLoader className="spin" /> 검사 준비 중...</div>}><LazyCompatibilityCheckProgress /></Suspense>}
      <div className="editor-layout">
        <section className="component-list">
          <div className="section-title-row"><div><p className="eyebrow">COMPONENTS</p><h2>부품 선택</h2></div></div>
          {PART_CATEGORIES.map((category) => (
            <ComponentCard key={category} category={category} build={build} setBuild={setBuild} partMap={partMap} onOpenPicker={onOpenPicker} />
          ))}
          <M2SlotSelectionEditor build={build} setBuild={setBuild} partMap={partMap} />
          <Suspense fallback={<div className="accessory-cart-panel loading" aria-label="주변 부품 목록 로딩" role="status">추가한 주변 부품을 준비하는 중...</div>}><LazyAccessoryCartPanel selections={accessorySelections(build)} accessoryMap={accessoryMap} partMap={partMap} ssdSelections={build.ssd} onChangeQuantity={onChangeAccessoryQuantity} onChangeTarget={onChangeAccessoryTarget} onChangeHubTarget={onChangeAccessoryHubTarget} onChangeRgbController={onChangeRgbController} rgbControllerAccessoryId={build.rgbControllerAccessoryId} rgbDeviceCount={build.case ? partMap.get(build.case.partId)?.specs.rgbDeviceCount : undefined} onRemove={onRemoveAccessory} AccessoryVisual={AccessoryVisual} /></Suspense>
          <ChangeHistoryPanel entries={changeHistory} onRestore={onRestoreChange} restoring={checking} />
        </section>
        <aside className="summary-sidebar">
          <div className="sticky-summary">
            <div className="summary-header"><div><p className="eyebrow">LIVE SUMMARY</p><h2>검사 준비 상태</h2></div><span className="summary-pulse"><FiActivity /></span></div>
            <div className="summary-list">{PART_CATEGORIES.map((category) => { const boxed = category === "cooler" && build.cpu ? partMap.get(build.cpu.partId)?.specs.coolerIncluded === true : false; const chosen = selectionList(build, category).length > 0 || boxed; return <div className={chosen ? "summary-row chosen" : "summary-row"} key={category}><span className="summary-check">{chosen ? <FiCheck /> : <span />}</span><span>{CATEGORY_LABELS[category]}</span></div>; })}</div>
            <div className="summary-divider" />
            <div className="graphics-mode"><div><span className="mini-label">그래픽 출력</span><strong>{build.gpu ? "외장 그래픽카드" : build.useIntegratedGraphics ? "CPU 내장 그래픽" : "선택 필요"}</strong></div><FiMonitor /></div>
            <details className="desktop-summary-details">
              <summary><span><FiActivity /> 추천·가격·확인 정보</span><FiChevronDown /></summary>
              <div className="desktop-summary-details-body">
                <RecommendationControls preferences={recommendationPreferences} onChange={onRecommendationPreferencesChange} disabled={checking} />
                <BuildPriceSummaryPanel snapshot={buildPriceSnapshotFor(build, partMap, accessoryMap)} budgetWon={recommendationPreferences.budgetWon} unknownItems={unknownPriceItemsFor(build, partMap, accessoryMap)} onRefresh={onRefreshCatalogItem} refreshingItemId={refreshingPartId} />
                <BuildPreflightPanel preflight={preflight} onRefresh={onRefreshCatalogItem} onRefreshAll={onRefreshAllCatalogItems} refreshingPartId={refreshingPartId} />
              </div>
            </details>
            <button className="button button-primary full-width" onClick={onCheck} disabled={checking}>{checking ? <><FiLoader className="spin" /> 검사 중...</> : <><FiActivity /> 호환성 검사하기</>}</button>
            {checkError && <RequestErrorNotice message={checkError} onRetry={onCheck} retrying={checking} hasLastResult={hasLastResult} />}
          </div>
        </aside>
      </div>
      </div>
    </div>
  );
}

function BuildPreflightPanel({ preflight, onRefresh, onRefreshAll, refreshingPartId }: { preflight: BuildPreflight; onRefresh: (target: RefreshTarget) => void; onRefreshAll: (targets: RefreshTarget[]) => void; refreshingPartId: string | null }) {
  const statusCopy: Record<BuildPreflight["status"], string> = {
    ready: "검사 준비 완료",
    needs_selection: "필수 부품 선택 필요",
    needs_data_review: "선택 데이터 확인 필요"
  };
  const issueKindCopy: Record<BuildPreflight["issues"][number]["kind"], string> = {
    selection: "선택",
    catalog: "카탈로그",
    data: "스펙",
    price: "가격"
  };
  return <section className={`build-preflight ${preflight.status}`} aria-label="검사 전 사전 점검">
    <div className="build-preflight-heading"><div><span className="mini-label">PREFLIGHT</span><strong>검사 전 사전 점검</strong></div><div className="build-preflight-heading-actions"><span className="build-preflight-status">{statusCopy[preflight.status]}</span>{preflight.refreshTargets.length > 0 && <button className="text-button build-preflight-refresh-all" type="button" onClick={() => onRefreshAll(preflight.refreshTargets)} disabled={refreshingPartId !== null}>{refreshingPartId !== null ? <><FiLoader className="spin" /> 확인 중...</> : <><FiRefreshCw /> 확인 대상 {preflight.refreshTargets.length}개 모두 확인</>}</button>}</div></div>
    <div className="build-preflight-stats"><div><span>필수 선택</span><strong>{preflight.requiredSelectedCount} / {preflight.requiredTotal}</strong></div><div><span>선택 부품</span><strong>{preflight.selectedPartCount + preflight.selectedAccessoryCount}개</strong></div><div><span>데이터 확인</span><strong>{preflight.dataReviewCount}개</strong></div><div><span>가격 미확인</span><strong>{preflight.unpricedCount}개</strong></div></div>
    {preflight.issues.length > 0 ? <div className="build-preflight-issues">{preflight.issues.slice(0, 4).map((issue) => <div className="build-preflight-issue" key={issue.id}><span>{issueKindCopy[issue.kind]}</span><div><strong>{issue.label}</strong><small>{issue.message}</small></div>{issue.target && <button className="text-button build-preflight-refresh" type="button" onClick={() => onRefresh(issue.target!)} disabled={refreshingPartId !== null}>{refreshingPartId === issue.target.id ? <><FiLoader className="spin" /> 확인 중...</> : <><FiRefreshCw /> 정보 다시 확인</>}</button>}</div>)}{preflight.issues.length > 4 && <small className="build-preflight-more">그 외 {preflight.issues.length - 4}개 항목은 검사 결과에서 상세 확인할 수 있습니다.</small>}</div> : <p className="build-preflight-clear"><FiCheckCircle /> 선택된 부품의 기본 데이터가 준비되었습니다.</p>}
    <p className="build-preflight-note"><FiInfo /> 사전 점검은 입력·정보 준비 상태만 봐요. 실제 부품 호환성은 검사 버튼을 눌러 확인해 주세요.</p>
  </section>;
}

function RecommendationControls({ preferences, onChange, onCommit, commitOnChange = true, compact = false, disabled = false }: { preferences: RecommendationPreferences; onChange: (next: RecommendationPreferences) => void; onCommit?: (next: RecommendationPreferences) => void; commitOnChange?: boolean; compact?: boolean; disabled?: boolean }) {
  const [draftBudget, setDraftBudget] = useState(preferences.budgetWon?.toString() ?? "");
  useEffect(() => { setDraftBudget(preferences.budgetWon?.toString() ?? ""); }, [preferences.budgetWon]);
  function preferencesWithBudget(raw: string) {
    const numericBudget = raw === "" ? undefined : Number(raw);
    const budgetWon = numericBudget === undefined || !Number.isFinite(numericBudget) ? undefined : Math.max(0, Math.floor(numericBudget));
    return budgetWon === undefined ? { ...preferences, budgetWon: undefined } : { ...preferences, budgetWon };
  }
  function commitBudget() {
    if (!commitOnChange) onCommit?.(preferencesWithBudget(draftBudget));
  }
  return <section className={compact ? "recommendation-controls compact" : "recommendation-controls"} aria-label="추천 기준 설정">
    <div className="recommendation-controls-heading"><div><span className="mini-label">RECOMMENDATION</span><strong>추천 기준</strong></div><FiActivity /></div>
    <label><span>사용 목적</span><select value={preferences.profile} disabled={disabled} onChange={(event) => { const profile = event.target.value as RecommendationProfile; const next = profile === "gaming" ? { ...preferences, profile, gamingRefreshRate: preferences.gamingRefreshRate ?? 144 } : { ...preferences, profile, gamingRefreshRate: undefined }; onChange(next); if (!commitOnChange) onCommit?.(next); }}><option value="general">{RECOMMENDATION_PROFILE_LABELS.general}</option><option value="gaming">{RECOMMENDATION_PROFILE_LABELS.gaming}</option><option value="creator">{RECOMMENDATION_PROFILE_LABELS.creator}</option><option value="development">{RECOMMENDATION_PROFILE_LABELS.development}</option><option value="office">{RECOMMENDATION_PROFILE_LABELS.office}</option></select></label>
    {preferences.profile === "gaming" && <label><span>게임 해상도 <em>게이밍 기준</em></span><select value={preferences.gamingResolution ?? "1440p"} disabled={disabled} onChange={(event) => { const next = { ...preferences, gamingResolution: event.target.value as GamingResolution }; onChange(next); if (!commitOnChange) onCommit?.(next); }}><option value="1080p">{GAMING_RESOLUTION_LABELS["1080p"]}</option><option value="1440p">{GAMING_RESOLUTION_LABELS["1440p"]}</option><option value="4k">{GAMING_RESOLUTION_LABELS["4k"]}</option></select></label>}
    {preferences.profile === "gaming" && <label><span>목표 주사율 <em>성능 가중치</em></span><select aria-label="목표 주사율" value={preferences.gamingRefreshRate ?? 144} disabled={disabled} onChange={(event) => { const next = { ...preferences, gamingRefreshRate: Number(event.target.value) as GamingRefreshRate }; onChange(next); if (!commitOnChange) onCommit?.(next); }}><option value="60">{GAMING_REFRESH_RATE_LABELS[60]}</option><option value="144">{GAMING_REFRESH_RATE_LABELS[144]}</option><option value="240">{GAMING_REFRESH_RATE_LABELS[240]}</option></select></label>}
    <label><span>우선순위</span><select data-testid="recommendation-priority" value={preferences.priority} disabled={disabled} onChange={(event) => { const next = { ...preferences, priority: event.target.value as RecommendationPreferences["priority"] }; onChange(next); if (!commitOnChange) onCommit?.(next); }}><option value="balanced">{RECOMMENDATION_PRIORITY_LABELS.balanced}</option><option value="budget">{RECOMMENDATION_PRIORITY_LABELS.budget}</option><option value="performance">{RECOMMENDATION_PRIORITY_LABELS.performance}</option><option value="reliability">{RECOMMENDATION_PRIORITY_LABELS.reliability}</option></select></label>
    <label><span>구매 조건</span><select value={preferences.listingPolicy ?? "retail_only"} disabled={disabled} onChange={(event) => { const next = { ...preferences, listingPolicy: event.target.value as ListingPolicy }; onChange(next); if (!commitOnChange) onCommit?.(next); }}><option value="retail_only">{LISTING_POLICY_LABELS.retail_only}</option><option value="include_bulk">{LISTING_POLICY_LABELS.include_bulk}</option><option value="all">{LISTING_POLICY_LABELS.all}</option></select></label>
    <label><span>목표 예산 <em>선택</em></span><input type="number" inputMode="numeric" min="0" step="10000" disabled={disabled} value={draftBudget} onChange={(event) => { const next = preferencesWithBudget(event.target.value); setDraftBudget(event.target.value); onChange(next); if (commitOnChange) onCommit?.(next); }} onBlur={commitBudget} onKeyDown={(event) => { if (event.key === "Enter") commitBudget(); }} placeholder="예: 1500000" /></label>
    <p><strong>{RECOMMENDATION_PRIORITY_LABELS[preferences.priority]}</strong> · {RECOMMENDATION_PRIORITY_DESCRIPTIONS[preferences.priority]} 게임 해상도는 권장 VRAM 기준에, 목표 주사율은 CPU·GPU 성능 비교 가중치에 적용됩니다. 실제 FPS나 호환성 결과를 보장하거나 바꾸지는 않아요.</p>
  </section>;
}

function ComponentCard({ category, build, setBuild, partMap, onOpenPicker }: { category: PartCategory; build: BuildSelection; setBuild: React.Dispatch<React.SetStateAction<BuildSelection>>; partMap: Map<string, Part>; onOpenPicker: (category: PartCategory) => void }) {
  const meta = CATEGORY_META[category];
  const selections = selectionList(build, category);
  const Icon = meta.Icon;
  const boxedCooler = category === "cooler" && build.cpu ? partMap.get(build.cpu.partId)?.specs.coolerIncluded === true : false;
  const [expandedPartId, setExpandedPartId] = useState<string | null>(null);
  return (
    <article className={selections.length > 0 || boxedCooler ? "component-card selected" : "component-card"}>
      <div className="component-card-top"><div className="component-heading"><span className="component-icon"><Icon /></span><div><div className="component-label-row"><h3>{meta.label}</h3>{meta.required && !boxedCooler ? <span className="required-badge">필수</span> : <span className="optional-badge">선택</span>}</div><p>{meta.helper}</p></div></div><span className={selections.length > 0 || boxedCooler ? "selection-state selected-state" : "selection-state"}>{selections.length > 0 ? <FiCheck /> : boxedCooler ? <><FiCheck /> CPU 기본 포함</> : "미선택"}</span></div>
      <div className="component-card-body">
        {selections.length === 0 ? boxedCooler ? <div className="included-selection"><FiCheck /><span>선택한 CPU에 기본 쿨러가 포함되어 있습니다.</span><button className="text-button" onClick={() => onOpenPicker(category)}>별도 쿨러 선택 <FiPlus /></button></div> : <div className="empty-selection"><span>선택된 부품이 없습니다.</span><button className="button button-small button-light" onClick={() => onOpenPicker(category)}><FiPlus /> {meta.multiple ? "부품 추가" : "부품 선택"}</button></div> : <div className="selected-lines">{selections.map((selection, index) => { const part = partMap.get(selection.partId); const expanded = expandedPartId === selection.partId; const quantityLabel = category === "memory" && (part?.specs.memoryModuleCountPerKit ?? 1) > 1 ? "킷 수량" : "수량"; return <div className={expanded ? "selected-line expanded" : "selected-line"} key={`${selection.partId}-${index}`}><div className="selected-line-main"><div className="selected-line-info"><strong>{part?.name ?? selection.partId}</strong><span>{partSummary(part)}</span>{part && <button className="text-button part-detail-toggle" type="button" aria-expanded={expanded} onClick={() => setExpandedPartId(expanded ? null : selection.partId)}>{expanded ? "상세 스펙 닫기" : "상세 스펙 보기"} <FiChevronDown /></button>}</div><div className="selected-line-controls"><label className="quantity-control"><span>{quantityLabel}</span><input type="number" inputMode="numeric" min="1" max="99" value={selection.quantity} onChange={(event) => setBuild((current) => updateQuantity(current, category, index, Number(event.target.value)))} aria-label={`${meta.label} ${quantityLabel}`} /></label><button className="icon-button danger-button" onClick={() => setBuild((current) => removeSelection(current, category, index))} aria-label={`${part?.name ?? meta.label} 삭제`}><FiTrash2 /></button></div></div>{part && expanded && <PartEvidence part={part} />}</div>; })}<button className="text-button" onClick={() => onOpenPicker(category)}><FiPlus /> {meta.multiple ? "다른 부품 추가" : "다른 부품으로 변경"}</button></div>}
        {category === "gpu" && <label className={build.gpu ? "graphics-toggle disabled" : "graphics-toggle"}><input type="checkbox" checked={build.useIntegratedGraphics} disabled={Boolean(build.gpu)} onChange={(event) => setBuild((current) => ({ ...current, useIntegratedGraphics: event.target.checked }))} /><span className="toggle-ui" /><span><strong>CPU 내장 그래픽만 사용</strong><small>{build.gpu ? "외장 그래픽카드가 선택되어 있습니다." : "외장 그래픽카드 없이 화면을 출력합니다."}</small></span></label>}
      </div>
    </article>
  );
}

function M2SlotSelectionEditor({ build, setBuild, partMap }: { build: BuildSelection; setBuild: React.Dispatch<React.SetStateAction<BuildSelection>>; partMap: Map<string, Part> }) {
  const motherboard = build.motherboard ? partMap.get(build.motherboard.partId) : undefined;
  const profiles = motherboard?.specs.m2SlotProfiles?.slice().sort((left, right) => left.slotId.localeCompare(right.slotId)) ?? [];
  const selectedM2Parts = [...new Map(
    build.ssd
      .map((selection) => ({ selection, part: partMap.get(selection.partId) }))
      .filter(({ part }) => part?.specs.formFactor?.toLowerCase().includes("m.2"))
      .map(({ selection, part }) => [part!.id, { part: part!, quantity: selection.quantity }] as const)
  ).values()];
  if (!motherboard || profiles.length === 0 || selectedM2Parts.length === 0) return null;

  const selection = build.m2SlotSelection ?? {};
  const assignedSlotCount = Object.keys(selection).length;
  const m2UnitCount = selectedM2Parts.reduce((total, item) => total + item.quantity, 0);
  const interfaceLabel = (part: Part) => part.specs.interface ?? "인터페이스 확인";
  const capacityLabel = (part: Part) => part.specs.capacityGb !== undefined ? `${part.specs.capacityGb}GB` : "용량 확인";
  function updateSlot(slotId: string, partId: string) {
    setBuild((current) => {
      const nextSelection = { ...(current.m2SlotSelection ?? {}) };
      if (partId) nextSelection[slotId] = partId;
      else delete nextSelection[slotId];
      return {
        ...current,
        m2SlotSelection: Object.keys(nextSelection).length > 0 ? nextSelection : undefined
      };
    });
  }
  function useAutomaticPlacement() {
    setBuild((current) => {
      const next = { ...current };
      delete next.m2SlotSelection;
      return next;
    });
  }
  return <section className={assignedSlotCount > 0 ? "m2-selection-editor selected" : "m2-selection-editor"} aria-label="M.2 슬롯 배치 선택">
    <div className="m2-selection-heading"><div><p className="eyebrow">M.2 SLOT PLACEMENT</p><h2>SSD 슬롯 배치</h2><p>{motherboard.name}의 등록된 슬롯 정보를 기준으로 SSD 연결 위치를 직접 지정할 수 있습니다.</p></div><span className="m2-selection-icon"><FiHardDrive /></span></div>
    <div className="m2-selection-toolbar"><span className={assignedSlotCount === m2UnitCount ? "m2-selection-count complete" : "m2-selection-count"}>{assignedSlotCount > 0 ? `수동 지정 ${assignedSlotCount} / ${m2UnitCount}개` : "자동 배치"}</span><button className="text-button" type="button" onClick={useAutomaticPlacement} disabled={assignedSlotCount === 0}><FiRefreshCw /> 최적 배치 사용</button></div>
    <div className="m2-selection-list">{profiles.map((profile) => <label className="m2-selection-row" key={profile.slotId}><span className="m2-selection-slot">{profile.slotId}</span><span className="m2-selection-spec">{profile.interfaces?.join(" / ") ?? "인터페이스 확인"}{profile.pcieGeneration !== undefined ? ` · PCIe ${profile.pcieGeneration.toFixed(1)}` : " · 세대 확인"}{profile.connection === "cpu" ? " · CPU 직결" : profile.connection === "chipset" ? " · 칩셋" : " · 연결 확인"}</span><select aria-label={`${profile.slotId} SSD 배치`} value={selection[profile.slotId] ?? ""} onChange={(event) => updateSlot(profile.slotId, event.target.value)}><option value="">자동 배치</option>{selectedM2Parts.map(({ part, quantity }) => <option value={part.id} key={part.id}>{part.name} · {interfaceLabel(part)} · {capacityLabel(part)}{quantity > 1 ? ` ×${quantity}` : ""}</option>)}</select></label>)}</div>
    <p className="m2-selection-note"><FiInfo /> 모든 슬롯을 비워 두면 성능·연결 조건에 맞춰 자동으로 배치해요. 하나라도 직접 지정하면 선택한 M.2 SSD 수량만큼 슬롯을 모두 지정해야 하고, SSD 수량이나 메인보드를 바꾸면 안전을 위해 자동 배치로 돌아갑니다.</p>
  </section>;
}

function PartEvidence({ part }: { part: Part }) {
  const [rawOpen, setRawOpen] = useState(false);
  const qualityLabel = DATA_QUALITY_LABELS[part.dataQuality];
  const priceEvidence = catalogPriceEvidenceFor(part);
  const sourceUrl = safeExternalUrl(part.danawaUrl);
  return <div className="part-evidence" aria-label={`${part.name} 상세 스펙`}>
    <div className="part-evidence-meta"><span><FiDatabase /> {qualityLabel}</span><span className={`part-evidence-price ${priceEvidence}`} title={catalogPriceEvidenceDescriptionFor(part)}>{isKnownPrice(part.priceWon) ? `가격 ${formatWon(part.priceWon)}` : "가격 확인 필요"} · {catalogPriceEvidenceLabelFor(part)}</span><span>{part.updatedAt ? `갱신 ${new Date(part.updatedAt).toLocaleDateString("ko-KR")}` : "갱신 시점 없음"}</span></div>
    <CatalogSpecProvenance part={part} compact />
    <div className="part-evidence-grid">{suggestionSpecRows(part).map(([label, value]) => <div className="part-evidence-row" key={label}><span>{label}</span><strong>{formatSpecValue(value)}</strong></div>)}</div>
    {part.missingFields.length > 0 && <p className="part-evidence-missing"><FiInfo /> 확인되지 않은 항목: {part.missingFields.map((field) => catalogMissingFieldLabelFor(field)).join(", ")}</p>}
    <div className="part-evidence-actions">{part.rawSpecText && <button className="text-button" type="button" aria-expanded={rawOpen} onClick={() => setRawOpen((current) => !current)}>{rawOpen ? "수집된 스펙 닫기" : "수집된 스펙 보기"} <FiChevronDown /></button>}{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">다나와 보기 <FiExternalLink /></a>}</div>
    {rawOpen && part.rawSpecText && <pre className="part-evidence-raw">{part.rawSpecText}</pre>}
  </div>;
}

function sharedPhysicalEvidenceSources(sources: PhysicalEvidenceSource[] | undefined) {
  return (sources ?? []).flatMap((source) => {
    const note = typeof source.note === "string" && source.note.trim() ? source.note.trim() : undefined;
    if (!note || !["gpu", "case", "psu"].includes(source.category)) return [];
    const manufacturerModel = source.manufacturerModel?.trim();
    const manufacturerRevision = source.manufacturerRevision?.trim();
    const updatedAt = typeof source.updatedAt === "string" && source.updatedAt.trim() ? source.updatedAt.trim() : undefined;
    const url = safeHttpsUrl(source.url);
    return [{ category: source.category, note, ...(manufacturerModel ? { manufacturerModel } : {}), ...(manufacturerRevision ? { manufacturerRevision } : {}), ...(updatedAt ? { updatedAt } : {}), ...(url ? { url } : {}) } satisfies PhysicalEvidenceSource];
  });
}

function sharedPhysicalEvidenceSourceLabel(category: PhysicalEvidenceSource["category"]) {
  return category === "gpu" ? "GPU" : category === "case" ? "케이스" : "PSU";
}

function sharedPhysicalEvidenceSourceIdentity(source: PhysicalEvidenceSource) {
  return `${sharedPhysicalEvidenceSourceLabel(source.category)}${source.manufacturerModel ? ` · ${source.manufacturerModel}` : ""}${source.manufacturerRevision ? ` · ${source.manufacturerRevision}` : ""}`;
}

function StaleResultView({ build, partMap, lastCheckedAt, entries, onRestore, checking, checkError, onBack, onEdit, onCheck }: { build: BuildSelection; partMap: Map<string, Part>; lastCheckedAt: string; entries: BuildHistoryEntry[]; onRestore: (entry: BuildHistoryEntry) => void; checking: boolean; checkError: string | null; onBack: () => void; onEdit: () => void; onCheck: () => void }) {
  return <div className="result-page stale-result-page">
    <div className="result-toolbar">
      <button className="back-link" onClick={onBack}><FiArrowLeft /> 홈으로</button>
      <div className="result-actions"><button className="button button-secondary" onClick={onEdit}><FiEdit3 /> 견적 수정</button></div>
    </div>
    {checkError && <RequestErrorNotice message={checkError} onRetry={onCheck} retrying={checking} hasLastResult />}
    <section className="stale-result-hero" role="alert">
      <span className="stale-result-icon"><FiRefreshCw /></span>
      <div>
        <p className="eyebrow">RECHECK REQUIRED</p>
        <h1>현재 구성은 아직 검사되지 않았습니다.</h1>
        <p>부품 수량·선택 또는 추천 기준이 마지막 검사 이후 바뀌었습니다. 이전 결과와 추천 부품은 지금 구성에 적용하지 않아요. 다시 검사한 뒤 확인해 주세요.</p>
        <small>마지막 성공 검사: {new Date(lastCheckedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</small>
      </div>
      <button className="button button-primary" onClick={onCheck} disabled={checking}>{checking ? <><FiLoader className="spin" /> 검사 중...</> : <><FiActivity /> 현재 구성 다시 검사</>}</button>
    </section>
    <section className="stale-build-panel" aria-label="현재 선택된 구성">
      <div className="stale-build-heading"><div><p className="eyebrow">CURRENT INPUT</p><h2>현재 선택된 구성</h2><p>아래 입력을 기준으로 새 결과를 계산합니다.</p></div><FiCpu /></div>
      <div className="stale-build-grid">{PART_CATEGORIES.map((category) => {
        const selections = selectionList(build, category);
        return <div className="stale-build-item" key={category}><span>{CATEGORY_LABELS[category]}</span><strong>{selections.length === 0 ? "미선택" : selections.map((selection) => `${partMap.get(selection.partId)?.name ?? selection.partId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`).join(", ")}</strong></div>;
      })}{accessorySelections(build).length > 0 && <div className="stale-build-item"><span>주변 부품</span><strong>{accessorySelections(build).length}종 · {accessorySelections(build).reduce((total, selection) => total + selection.quantity, 0)}개</strong></div>}</div>
      <p className="stale-result-note"><FiInfo /> 다시 검사하기 전까지 이전 결과의 수정 제안·대체 부품·업그레이드 추천은 숨겨 둬요. 오래된 결과와 섞이지 않게 하려는 거예요.</p>
    </section>
    <ChangeHistoryPanel entries={entries} onRestore={onRestore} restoring={checking} />
  </div>;
}

function ChangeHistoryPanel({ entries, onRestore, restoring }: { entries: BuildHistoryEntry[]; onRestore: (entry: BuildHistoryEntry) => void; restoring: boolean }) {
  if (entries.length === 0) return null;
  return <section className="change-history-panel" aria-label="견적 변경 이력">
    <div className="change-history-heading"><div><p className="eyebrow">BUILD HISTORY</p><h2>변경 이력</h2><p>부품을 시험하거나 수량을 바꾼 뒤 이전 구성으로 되돌릴 수 있어요.</p></div><span className="change-history-icon"><FiClock /></span></div>
    <div className="change-history-list">{entries.slice(0, 6).map((entry, index) => <article className="change-history-item" key={entry.id}><div className="change-history-item-copy"><span>{index === 0 ? "최근 변경" : `${index + 1}단계 전`}</span><strong>{entry.label}</strong><small>{new Date(entry.changedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</small></div><button className="button button-small button-light" type="button" onClick={() => onRestore(entry)} disabled={restoring}><FiRefreshCw /> {restoring ? "검사 중..." : "이전 구성 복원"}</button></article>)}</div>
    <p className="change-history-note"><FiInfo /> 복원은 선택 부품과 추천 기준을 함께 되돌린 뒤 현재 카탈로그 기준으로 자동 재검사합니다.</p>
  </section>;
}

function scenarioStatusLabel(status: CompatibilityResult["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function scenarioRiskText(result: CompatibilityResult) {
  return `차단 ${result.blockerCount}개 · 주의 ${result.warningCount}개 · 확인 필요 ${result.unknownCount}개`;
}

function BuildScenarioPreviewPanel({ preview, currentResult, onApply, onRetry, onClose }: { preview: BuildScenarioPreviewState; currentResult: CompatibilityResult; onApply: () => void; onRetry: () => void; onClose: () => void }) {
  if (preview.status === "loading") {
    return <section className="build-scenario-preview loading" aria-label="구성 미리 보기" data-testid="build-scenario-preview" role="status"><div className="build-scenario-preview-heading"><div><p className="eyebrow">WHAT-IF CHECK</p><h2>구성을 미리 확인하는 중...</h2><p>{preview.summary}</p></div><FiLoader className="spin" /></div><div className="build-scenario-loading-line"><FiActivity /> 견적은 바꾸지 않고 전체 호환성을 다시 계산해요.</div></section>;
  }
  if (preview.status === "error" || !preview.result) {
    return <section className="build-scenario-preview error" aria-label="구성 미리 보기" data-testid="build-scenario-preview" role="alert"><div className="build-scenario-preview-heading"><div><p className="eyebrow">WHAT-IF CHECK</p><h2>구성을 미리 확인하지 못했습니다.</h2><p>{preview.error ?? "부품을 전체 견적에 적용하지 못했어요."}</p></div><FiXCircle /></div><div className="build-scenario-preview-actions"><button className="button button-light" type="button" onClick={onRetry}><FiRefreshCw /> 다시 확인</button><button className="button button-light" type="button" onClick={onClose}>닫기</button></div></section>;
  }
  const nextResult = preview.result;
  const comparison = buildScenarioComparisonFor(currentResult, nextResult);
  const nextFindings = nextResult.findings.filter((finding) => finding.severity !== "info").slice(0, 3);
  const directionLabel = comparison.direction === "improved" ? "위험 감소" : comparison.direction === "worsened" ? "위험 증가" : comparison.direction === "changed" ? "일부 항목 변화" : "변화 없음";
  const scenarioOutcomeNote = comparison.direction === "improved"
    ? comparison.unknownDelta > 0
      ? `전체 위험은 줄었지만 확인 필요 항목이 ${comparison.unknownDelta}개 늘었습니다. 사기 전에 해당 내용을 한 번 더 확인해 주세요.`
      : comparison.warningDelta > 0
        ? `차단 위험은 줄었지만 주의 항목이 ${comparison.warningDelta}개 늘었습니다. 성능·안정성 조건을 함께 확인해 주세요.`
        : "전체 위험이 줄었습니다. 남은 항목이 있다면 아래 목록을 확인해 주세요."
    : comparison.direction === "worsened"
      ? "부품 적용 뒤 위험이 늘어 실제로 적용하지 않는 편이 안전해요."
      : comparison.direction === "changed"
        ? "결과나 가격이 바뀌었지만 위험 수준은 같아요. 바뀐 이유를 확인해 주세요."
        : "현재 구성과 위험·가격 결과가 같아 교체 이점이 확인되지 않습니다.";
  return <section className={`build-scenario-preview ${comparison.direction}`} aria-label="구성 미리 보기" data-testid="build-scenario-preview">
    <div className="build-scenario-preview-heading"><div><p className="eyebrow">WHAT-IF CHECK</p><h2>구성 미리 보기</h2><p>{preview.summary}</p></div><div className="build-scenario-preview-heading-actions"><span className={`build-scenario-direction ${comparison.direction}`}>{directionLabel}</span><button className="icon-button" type="button" onClick={onClose} aria-label="구성 미리 보기 닫기"><FiXCircle /></button></div></div>
    <div className="build-scenario-candidate"><span>{CATEGORY_LABELS[preview.category]}</span><strong>{preview.part.name}</strong><small>부품을 전체 조합에 적용한 결과 · 실제 견적은 아직 바뀌지 않음</small></div>
    <div className="build-scenario-comparison"><div><span>현재 구성</span><strong>{scenarioStatusLabel(comparison.currentStatus)}</strong><small>{scenarioRiskText(currentResult)}</small>{currentResult.priceComplete ? <small>총액 {formatWon(currentResult.totalPriceWon)}</small> : <small>총액 가격 확인 필요</small>}</div><b>→</b><div className="next"><span>미리 적용</span><strong>{scenarioStatusLabel(comparison.nextStatus)}</strong><small>{scenarioRiskText(nextResult)}</small>{nextResult.priceComplete ? <small>총액 {formatWon(nextResult.totalPriceWon)}</small> : <small>총액 가격 확인 필요</small>}</div></div>
    <div className="build-scenario-summary"><strong>{comparison.summary}</strong><span>{scenarioOutcomeNote}</span></div>
    <div className="build-scenario-findings"><div><strong>미리 적용 후 남는 확인 항목</strong><span>{nextFindings.length > 0 ? `${nextResult.findings.filter((finding) => finding.severity !== "info").length}개 중 최대 3개 표시` : "차단·주의·확인 필요 없음"}</span></div>{nextFindings.length > 0 && <ul>{nextFindings.map((finding) => <li key={finding.id}><b>{finding.severity === "blocker" ? "차단" : finding.severity === "warning" ? "주의" : "확인"}</b>{finding.title}</li>)}</ul>}</div>
    <div className="build-scenario-preview-actions"><button className="button button-light" type="button" onClick={onClose}>계속 비교</button><button className="button button-primary" type="button" onClick={onApply}><FiActivity /> 이 구성 적용 후 다시 검사</button></div>
    <p className="build-scenario-note"><FiInfo /> 이 화면은 부품을 적용해 보기만 한 결과예요. 적용 버튼을 누르기 전까지 선택·저장 견적·검사 결과는 바뀌지 않아요.</p>
  </section>;
}

function BuildHealthPanel({ metrics, gpuSelected, psuSelected, caseSelected }: { metrics: BuildMetrics; gpuSelected: boolean; psuSelected: boolean; caseSelected: boolean }) {
  const healthItems = [
    {
      label: "전력 여유",
      value: metrics.powerHeadroomW === undefined ? "확인 필요" : `${metrics.powerHeadroomW.toLocaleString("ko-KR")}W`,
      detail: metrics.psuWattageW !== undefined && metrics.recommendedPsuW !== undefined ? `${metrics.psuWattageW}W 파워 · 권장 ${metrics.recommendedPsuW}W` : "PSU 데이터를 더 확인해야 합니다",
      Icon: FiZap,
      tone: metrics.powerHeadroomW !== undefined && metrics.powerHeadroomW < 0 ? "danger" : metrics.powerHeadroomW !== undefined && metrics.powerHeadroomW < 120 ? "warning" : "good"
    },
    {
      label: "메모리 사용",
      value: metrics.totalMemoryGb === undefined ? "확인 필요" : `${metrics.totalMemoryGb}GB`,
      detail: metrics.memorySlotsUsed !== undefined && metrics.memorySlotsTotal !== undefined ? `${metrics.memorySlotsUsed} / ${metrics.memorySlotsTotal} 슬롯` : "메모리 슬롯 데이터를 더 확인해야 합니다",
      Icon: FiDatabase,
      tone: metrics.memorySlotsUsed !== undefined && metrics.memorySlotsTotal !== undefined && metrics.memorySlotsUsed > metrics.memorySlotsTotal ? "danger" : "good"
    },
    {
      label: "M.2 슬롯",
      value: metrics.m2Used === undefined ? "확인 필요" : `${metrics.m2Used}개 사용`,
      detail: metrics.m2Used !== undefined && metrics.m2SlotsTotal !== undefined ? `${metrics.m2Used} / ${metrics.m2SlotsTotal} 슬롯` : "M.2 스펙을 더 확인해야 합니다",
      Icon: FiHardDrive,
      tone: metrics.m2Used !== undefined && metrics.m2SlotsTotal !== undefined && metrics.m2Used > metrics.m2SlotsTotal ? "danger" : "good"
    },
    {
      label: "GPU 장착 길이",
      value: metrics.gpuLengthMm === undefined ? "미선택" : `${metrics.gpuLengthMm}mm`,
      detail: metrics.gpuLengthMm !== undefined && metrics.maxGpuLengthMm !== undefined ? `케이스 허용 ${metrics.maxGpuLengthMm}mm` : "GPU 또는 케이스 정보를 확인해야 합니다",
      Icon: FiMonitor,
      tone: metrics.gpuLengthMm !== undefined && metrics.maxGpuLengthMm !== undefined && metrics.gpuLengthMm > metrics.maxGpuLengthMm ? "danger" : "good"
    },
    {
      label: "GPU 두께",
      value: metrics.gpuThicknessMm === undefined ? gpuSelected ? "확인 필요" : "미선택" : `${metrics.gpuThicknessMm}mm`,
      detail: metrics.gpuThicknessMm === undefined ? "GPU 두께 정보를 확인해야 합니다" : metrics.gpuThicknessMm >= 55 ? "두꺼운 GPU · 주변 슬롯 간섭 확인" : "인접 슬롯 간섭 기준 이내",
      Icon: FiLayers,
      tone: gpuSelected && (metrics.gpuThicknessMm === undefined || metrics.gpuThicknessMm >= 55) ? "warning" : "good"
    },
    {
      label: "PSU 장착 여유",
      value: metrics.psuClearanceMm === undefined ? psuSelected && caseSelected ? "확인 필요" : "미선택" : `${metrics.psuClearanceMm}mm`,
      detail: metrics.psuClearanceMm !== undefined && metrics.psuDepthMm !== undefined && metrics.maxPsuLengthMm !== undefined ? `${metrics.psuDepthMm}mm PSU · 케이스 ${metrics.maxPsuLengthMm}mm` : "PSU·케이스 장착 치수를 확인해야 합니다",
      Icon: FiBox,
      tone: metrics.psuClearanceMm !== undefined && metrics.psuClearanceMm < 0 ? "danger" : psuSelected && caseSelected && metrics.psuClearanceMm === undefined ? "warning" : "good"
    }
  ];
  return <section className="health-panel" data-testid="data-health-panel"><div className="health-heading"><div><p className="eyebrow">BUILD TELEMETRY</p><h2>구성 자원 확인</h2></div><span><FiActivity /> 규칙으로 확인</span></div><div className="health-grid">{healthItems.map(({ label, value, detail, Icon, tone }) => <div className={`health-item ${tone}`} key={label}><span className="health-icon"><Icon /></span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>)}</div></section>;
}

function M2SlotAssignmentPanel({ assignments, mode }: { assignments: M2SlotAssignment[]; mode?: BuildMetrics["m2SlotAssignmentMode"] }) {
  const connectionLabels: Record<string, string> = { cpu: "CPU 직결", chipset: "칩셋", unknown: "연결 주체 확인" };
  const isManual = mode === "manual";
  return <section className="m2-assignment-panel"><div className="m2-assignment-heading"><div><p className="eyebrow">M.2 SLOT PLAN</p><h2>{isManual ? "수동 지정 슬롯 배치" : "자동 계산 슬롯 배치"}</h2><p>{isManual ? "사용자가 지정한 슬롯 위치를 제조사 매뉴얼 등록 정보와 비교했습니다." : "관리자가 등록한 제조사 매뉴얼 정보를 기준으로 SSD 연결 위치를 계산했습니다."}</p></div><FiHardDrive /></div><div className="m2-assignment-list">{assignments.map((assignment) => <div className="m2-assignment-row" key={`${assignment.slotId}-${assignment.partId}`}><span className="m2-assignment-slot">{assignment.slotId}</span><div><strong>{assignment.partName}</strong><small>{assignment.interface ?? "인터페이스 확인"} · 슬롯 PCIe {assignment.slotPcieGeneration?.toFixed(1) ?? "확인 필요"} · 실제 링크 PCIe {assignment.linkGeneration?.toFixed(1) ?? "확인 필요"} · {assignment.connection ? connectionLabels[assignment.connection] ?? assignment.connection : "연결 주체 확인"}</small><small>{assignment.sharedWith && assignment.sharedWith.length > 0 ? `공유 대상: ${assignment.sharedWith.join(", ")}` : "공유 대상 없음으로 등록"}</small></div></div>)}</div><p className="m2-assignment-note"><FiInfo /> 슬롯별 매뉴얼 override 기준의 배치 결과이며, 실제 조립 전 보드 매뉴얼과 장착 위치를 다시 확인해 주세요.</p></section>;
}

function DataHealthPanel({ health, partMap, accessoryMap, onRefresh, onRefreshAll, refreshingPartId }: { health: BuildDataHealth; partMap: ReadonlyMap<string, Part>; accessoryMap: ReadonlyMap<string, AccessoryItem>; onRefresh: (target: RefreshTarget) => void; onRefreshAll: (targets: RefreshTarget[]) => void; refreshingPartId: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const statusLabel = health.overall === "verified" ? "정보 상태 양호" : health.overall === "mixed" ? "일부 확인 필요" : "재확인 권장";
  const freshnessLabels: Record<BuildDataHealth["items"][number]["freshness"], string> = { fresh: "최근 확인", aging: "갱신 권장", stale: "오래된 정보", unknown: "시점 확인 필요" };
  const issueCount = health.agingCount + health.staleCount + health.unknownFreshnessCount + health.incompleteCount + health.unpricedCount;
  function categoryLabel(category: BuildDataHealth["items"][number]["category"]) {
    return category in CATEGORY_LABELS ? CATEGORY_LABELS[category as PartCategory] : ACCESSORY_CATEGORY_LABELS[category as AccessoryCategory];
  }
  function targetFor(item: BuildDataHealth["items"][number]) {
    const part = partMap.get(item.id);
    const accessory = accessoryMap.get(item.id);
    const sourceItem = part ?? accessory;
    if (!sourceItem || sourceItem.source !== "danawa") return undefined;
    if (item.dataQuality !== "incomplete" && item.missingFields.length === 0 && item.priceKnown && item.freshness === "fresh") return undefined;
    return { kind: part ? "part" as const : "accessory" as const, id: item.id };
  }
  const refreshTargets = uniqueRefreshTargets(health.items.map(targetFor).filter((target): target is RefreshTarget => Boolean(target)));
  return <section className={expanded ? "data-health-panel expanded" : "data-health-panel"}>
    <div className="data-health-heading"><div><p className="eyebrow">DATA CONFIDENCE</p><h2>부품 정보 상태</h2><p>선택한 부품의 스펙·가격·갱신 시점을 함께 확인합니다.</p></div><div className="data-health-heading-actions"><span className={`data-health-status ${health.overall}`}>{statusLabel}</span>{refreshTargets.length > 0 && <button className="button button-small data-refresh-all-button" type="button" onClick={() => onRefreshAll(refreshTargets)} disabled={refreshingPartId !== null}><FiRefreshCw /> {refreshingPartId !== null ? "확인 중..." : `다시 확인할 항목 ${refreshTargets.length}개 모두 확인`}</button>}</div></div>
    <div className="data-health-stats"><div><span>선택 항목</span><strong>{health.selectedCount}개</strong><small>수량 {health.selectedQuantity}개</small></div><div><span>최근 확인</span><strong>{health.freshCount}개</strong><small>3일 이내</small></div><div><span>다시 확인 필요</span><strong>{issueCount}개</strong><small>{health.staleCount + health.unknownFreshnessCount > 0 ? "오래된 정보 포함" : "부분 정보 포함"}</small></div><div><span>가격 미확인</span><strong>{health.unpricedCount}개</strong><small>{health.oldestUpdatedAt ? `최고 오래된 갱신 ${new Date(health.oldestUpdatedAt).toLocaleDateString("ko-KR")}` : "갱신 시점 확인 필요"}</small></div></div>
    <button className="data-health-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? "부품별 상태 닫기" : "부품별 상태 보기"}<FiChevronDown /></button>
    {expanded && <div className="data-health-list">{health.items.length === 0 ? <p className="data-health-empty">아직 선택한 부품이 없습니다.</p> : health.items.map((item) => {
      const target = targetFor(item);
      return <div className="data-health-item" key={`${item.category}-${item.id}`}><div><strong>{item.name}</strong><small>{categoryLabel(item.category)} · {item.dataQuality === "incomplete" ? "일부 스펙 부족" : "스펙 확인"}</small></div><div className="data-health-item-meta"><span className={`data-freshness ${item.freshness}`}>{freshnessLabels[item.freshness]}</span>{!item.priceKnown && <span className="data-price-unknown">가격 미확인</span>}{item.missingFields.length > 0 && <span className="data-missing">누락 {item.missingFields.length}개</span>}{target && <button className="text-button data-refresh-button" type="button" onClick={() => onRefresh(target)} disabled={refreshingPartId !== null}>{refreshingPartId === item.id ? <><FiLoader className="spin" /> 확인 중...</> : <><FiRefreshCw /> 정보 다시 확인</>}</button>}<small>{item.updatedAt ? `갱신 ${new Date(item.updatedAt).toLocaleDateString("ko-KR")}` : "갱신 시점 없음"}</small></div></div>;
    })}</div>}
    <p className="data-health-note"><FiInfo /> 최근 확인은 3일 이내, 갱신 권장은 14일 이내 기준입니다. 다나와에서 가져온 부품은 다시 확인으로 상세 스펙을 보강할 수 있어요. 모두 확인은 최대 12개씩 순서대로 처리한 뒤 견적을 한 번만 다시 검사합니다.</p>
  </section>;
}

function BuildWatchlistPanel({ build, partMap, accessoryMap, onToast }: { build: BuildSelection; partMap: ReadonlyMap<string, Part>; accessoryMap: ReadonlyMap<string, AccessoryItem>; onToast: (message: string) => void }) {
  const candidates = new Map<string, { entry: CatalogWatchEntry; priceKnown: boolean }>();
  let unknownCatalogCount = 0;
  for (const category of PART_CATEGORIES) {
    for (const selection of selectionList(build, category)) {
      const part = partMap.get(selection.partId);
      if (!part) {
        unknownCatalogCount += 1;
        continue;
      }
      const entry: CatalogWatchEntry = { itemId: part.id, itemName: part.name, category: part.category, kind: "part", addedAt: new Date().toISOString() };
      candidates.set(catalogWatchEntryKey(entry), { entry, priceKnown: isKnownPrice(part.priceWon) });
    }
  }
  for (const selection of accessorySelections(build)) {
    const item = accessoryMap.get(selection.accessoryId);
    if (!item) {
      unknownCatalogCount += 1;
      continue;
    }
    const entry: CatalogWatchEntry = { itemId: item.id, itemName: item.name, category: item.category, kind: "accessory", addedAt: new Date().toISOString() };
    candidates.set(catalogWatchEntryKey(entry), { entry, priceKnown: isKnownPrice(item.priceWon) });
  }
  if (candidates.size === 0) return null;
  const coreCount = [...candidates.values()].filter(({ entry }) => entry.kind === "part").length;
  const accessoryCount = candidates.size - coreCount;
  const unpricedCount = [...candidates.values()].filter(({ priceKnown }) => !priceKnown).length;

  function watchAll() {
    try {
      const current = catalogWatchlistFromJson(window.localStorage.getItem(CATALOG_WATCHLIST_STORAGE_KEY));
      const currentKeys = new Set(current.map(catalogWatchEntryKey));
      const next = [...candidates.values()].reduce((entries, candidate) => addCatalogWatchEntry(entries, candidate.entry), current);
      const nextKeys = new Set(next.map(catalogWatchEntryKey));
      const addedCount = [...candidates.keys()].filter((key) => !currentKeys.has(key) && nextKeys.has(key)).length;
      const alreadyTrackedCount = [...candidates.keys()].filter((key) => currentKeys.has(key)).length;
      const omittedCount = candidates.size - addedCount - alreadyTrackedCount;
      window.localStorage.setItem(CATALOG_WATCHLIST_STORAGE_KEY, catalogWatchlistToJson(next));
      const parts: string[] = [`새로 등록 ${addedCount}개`];
      if (alreadyTrackedCount > 0) parts.push(`이미 추적 중 ${alreadyTrackedCount}개`);
      if (omittedCount > 0) parts.push(`목록 한도로 제외 ${omittedCount}개`);
      if (unpricedCount > 0) parts.push(`가격 미확인 ${unpricedCount}개`);
      if (unknownCatalogCount > 0) parts.push(`카탈로그 미확인 ${unknownCatalogCount}개`);
      onToast(`${parts.join(" · ")} · 가격 추적 화면에서 목표가와 알림 조건을 설정해 주세요.`);
    } catch {
      onToast("견적 전체를 가격 추적에 등록하지 못했습니다.");
    }
  }

  return <section className="build-watchlist-panel" aria-label="견적 전체 가격 추적"><div><p className="eyebrow">PRICE WATCH</p><h2>견적 전체 가격 추적</h2><p>선택한 부품을 한 번에 관심 목록에 담고 가격 변화를 지켜볼 수 있어요.</p><small>{coreCount}개 핵심 부품{accessoryCount > 0 ? ` · ${accessoryCount}개 주변 부품` : ""}{unpricedCount > 0 ? ` · 가격 미확인 ${unpricedCount}개도 추적 가능` : ""}</small></div><button className="button button-secondary" type="button" onClick={watchAll}><FiClock /> 전체 추적 등록</button></section>;
}

function BuildAnalysisPanel({ analysis }: { analysis: BuildAnalysis }) {
  const confidenceLabel = analysis.confidence === "high" ? "정보 충분" : analysis.confidence === "limited" ? "일부 스펙 기준" : "계산 불가";
  const severityLabel: Record<BuildAnalysis["bottlenecks"][number]["severity"], string> = {
    critical: "우선 해결",
    warning: "주의",
    info: "확장성"
  };
  return <section className="analysis-panel">
    <div className="analysis-heading"><div><p className="eyebrow">BUILD ANALYSIS</p><h2>구성 성능·병목 요약</h2><p>{analysis.scoreBasis}</p></div><span className={`analysis-score-badge ${analysis.overallScore === undefined ? "unknown" : analysis.overallScore >= 80 ? "high" : analysis.overallScore >= 60 ? "medium" : "low"}`}><strong>{analysis.overallScore ?? "-"}</strong><small>{analysis.overallScore === undefined ? "계산 불가" : `${analysis.scoreLabel} · ${confidenceLabel}`}</small></span></div>
    {analysis.factors.length > 0 && <div className="analysis-factors">{analysis.factors.map((factor) => <div className="analysis-factor" key={factor.category}><div className="analysis-factor-top"><span>{factor.label}</span><strong>{factor.score === undefined ? "확인 필요" : `${factor.score}점`}</strong></div><div className="analysis-track"><span className={factor.score === undefined ? "missing" : ""} style={{ width: `${factor.score ?? 0}%` }} /></div><small>{factor.basis}</small></div>)}</div>}
    {(analysis.strengths.length > 0 || analysis.focusAreas.length > 0) && <BuildAnalysisInsights strengths={analysis.strengths} focusAreas={analysis.focusAreas} />}
    {analysis.balance && <BuildBalancePanel balance={analysis.balance} />}
    {analysis.gpuTarget && <div className={`analysis-gpu-target ${analysis.gpuTarget.currentFit}`}><div><span>게이밍 목표</span><strong>{GAMING_RESOLUTION_LABELS[analysis.gpuTarget.resolution]}{analysis.gpuTarget.refreshRate ? ` · ${GAMING_REFRESH_RATE_LABELS[analysis.gpuTarget.refreshRate]}` : ""} · 권장 VRAM {GAMING_RESOLUTION_VRAM_TARGETS[analysis.gpuTarget.resolution]}GB</strong></div><em>{analysis.gpuTarget.summary}</em></div>}
    {analysis.bottlenecks.length > 0 && <div className="analysis-bottlenecks"><div className="analysis-subheading"><strong>먼저 확인할 신호</strong><span>{analysis.bottlenecks.length}개</span></div>{analysis.bottlenecks.slice(0, 4).map((bottleneck) => <article className={`analysis-bottleneck ${bottleneck.severity}`} key={bottleneck.id}><span className="analysis-bottleneck-label">{severityLabel[bottleneck.severity]}</span><div><strong>{bottleneck.title}</strong><p>{bottleneck.message}</p>{(bottleneck.actual || bottleneck.limit) && <small>{bottleneck.actual ?? "확인 필요"}{bottleneck.limit ? ` · 기준 ${bottleneck.limit}` : ""}</small>}</div></article>)}</div>}
    <div className="analysis-actions"><div className="analysis-subheading"><strong>다음 행동</strong><span>추천 순서</span></div>{analysis.nextActions.map((action, index) => <p key={action}><b>{index + 1}</b>{action}</p>)}</div>
    <p className="analysis-note"><FiInfo /> 이 점수는 실제 FPS·렌더링 벤치마크가 아니라, 현재 카탈로그에서 확인된 스펙을 사용 목적별 가중치로 비교한 참고값입니다.</p>
  </section>;
}

function BuildBalancePanel({ balance }: { balance: BuildAnalysisBalance }) {
  const statusLabel = balance.status === "balanced" ? "균형 범위" : balance.status === "cpu_limited" ? "CPU 병목 가능성" : "GPU 병목 가능성";
  return <div className={`analysis-balance ${balance.status}`}><div className="analysis-balance-heading"><div><span>CPU · GPU 밸런스 신호</span><strong>{statusLabel}</strong></div><em>상대 점수 차이 {balance.gap}점</em></div><div className="analysis-balance-bars"><div><div className="analysis-balance-label"><span>CPU</span><strong>{balance.cpuScore}점</strong></div><div className="analysis-track"><span style={{ width: `${balance.cpuScore}%` }} /></div></div><div><div className="analysis-balance-label"><span>GPU</span><strong>{balance.gpuScore}점</strong></div><div className="analysis-track"><span style={{ width: `${balance.gpuScore}%` }} /></div></div></div><p>{balance.summary}</p></div>;
}

function BuildAnalysisInsights({ strengths, focusAreas }: { strengths: BuildAnalysisInsight[]; focusAreas: BuildAnalysisInsight[] }) {
  return <div className="analysis-insights">{strengths.length > 0 && <div className="analysis-insight-group strengths"><div className="analysis-insight-heading"><strong>현재 구성의 강점</strong><span>{strengths.length}개</span></div>{strengths.map((insight) => <div className="analysis-insight" key={insight.category}><div><strong>{insight.title}</strong><p>{insight.summary}</p></div><em>{insight.score}점</em></div>)}</div>}{focusAreas.length > 0 && <div className="analysis-insight-group focus"><div className="analysis-insight-heading"><strong>먼저 볼 영역</strong><span>{focusAreas.length}개</span></div>{focusAreas.map((insight) => <div className="analysis-insight" key={insight.category}><div><strong>{insight.title}</strong><p>{insight.summary}</p></div><em>{insight.score}점</em></div>)}</div>}</div>;
}

function upgradeCompatibilityText(evidence: UpgradeCompatibilityEvidence) {
  const details: string[] = [];
  if (evidence.powerHeadroomW !== undefined) details.push(`전력 ${evidence.powerHeadroomW}W 여유`);
  if (evidence.coolerHeadroomW !== undefined) details.push(`냉각 ${evidence.coolerHeadroomW}W 여유`);
  if (evidence.gpuClearanceMm !== undefined) details.push(`GPU 길이 ${evidence.gpuClearanceMm}mm 여유`);
  if (evidence.coolerClearanceMm !== undefined) details.push(`쿨러 높이 ${evidence.coolerClearanceMm}mm 여유`);
  if (evidence.psuClearanceMm !== undefined) details.push(`PSU 길이 ${evidence.psuClearanceMm}mm 여유`);
  if (evidence.memoryHeadroomGb !== undefined) details.push(`메모리 ${evidence.memoryHeadroomGb}GB 여유`);
  if (evidence.memorySlotHeadroom !== undefined) details.push(`RAM ${evidence.memorySlotHeadroom}슬롯 여유`);
  if (evidence.m2Headroom !== undefined) details.push(`M.2 ${evidence.m2Headroom}슬롯 여유`);
  if (evidence.sataHeadroom !== undefined) details.push(`SATA ${evidence.sataHeadroom}포트 여유`);
  if (evidence.hddBayHeadroom !== undefined) details.push(`HDD 베이 ${evidence.hddBayHeadroom}개 여유`);
  return details.length > 0 ? details.join(" · ") : "추가 여유 데이터 확인 필요";
}

function upgradeCompatibilityStatus(evidence: UpgradeCompatibilityEvidence) {
  if (evidence.blockerCount > 0) return `차단 오류 ${evidence.blockerCount}개`;
  if (evidence.unknownCount > 0) return `확인 필요 ${evidence.unknownCount}개`;
  if (evidence.warningCount > 0) return `주의 ${evidence.warningCount}개`;
  return "호환 상태 유지";
}

function upgradeBudgetText(evidence: UpgradeBudgetEvidence | undefined) {
  if (!evidence) return undefined;
  if (!evidence.priceComplete || evidence.afterCoreTotalPriceWon === undefined) {
    return `목표 ${formatWon(evidence.budgetWon)} · 핵심 금액 확인 필요`;
  }
  const difference = evidence.withinBudget
    ? evidence.budgetWon - evidence.afterCoreTotalPriceWon
    : evidence.afterCoreTotalPriceWon - evidence.budgetWon;
  return `적용 후 핵심 ${formatWon(evidence.afterCoreTotalPriceWon)} · 목표 ${formatWon(evidence.budgetWon)} · ${formatWon(difference)} ${evidence.withinBudget ? "여유" : "초과"}`;
}

type UpgradeSortMode = "recommended" | "performance" | "value" | "saving" | "expansion" | "reliability";

function upgradeValueScore(recommendation: UpgradeRecommendation) {
  if (recommendation.priceDeltaWon === undefined) return undefined;
  if (recommendation.priceDeltaWon <= 0) return 1_000 + recommendation.improvementPercent;
  return recommendation.improvementPercent / Math.max(0.1, recommendation.priceDeltaWon / 100_000);
}

function upgradeExpansionText(evidence: UpgradeExpansionEvidence | undefined) {
  if (!evidence) return "확장성 비교 불가 · 부품 적용 후 다시 확인";
  const coverage = `비교 부품 ${evidence.candidateKnownDimensionCount}/${evidence.candidateTotalDimensionCount}개 지표`;
  if (evidence.candidateScore === undefined) return `확장성 비교 불가 · ${coverage}`;
  if (evidence.scoreDelta === undefined || evidence.baselineScore === undefined) return `교체 후 확장성 ${evidence.candidateScore}점 · ${coverage}`;
  return `확장성 ${evidence.baselineScore}점 → ${evidence.candidateScore}점 · ${evidence.scoreDelta >= 0 ? "+" : ""}${evidence.scoreDelta}점 · ${coverage}`;
}

function upgradeExpansionTone(evidence: UpgradeExpansionEvidence | undefined) {
  if (evidence?.scoreDelta === undefined) return "unknown";
  return evidence.scoreDelta > 0 ? "positive" : evidence.scoreDelta < 0 ? "negative" : "neutral";
}

function upgradeRecommendationTrustScore(recommendation: UpgradeRecommendation) {
  if (!recommendation.recommendationTrust) return Number.NEGATIVE_INFINITY;
  const levelScore = { high: 3, medium: 2, low: 1 }[recommendation.recommendationTrust.level];
  return levelScore * 100 + recommendation.recommendationTrust.score;
}

function sortedUpgradeRecommendations(recommendations: UpgradeRecommendation[], sortMode: UpgradeSortMode) {
  return recommendations
    .map((recommendation, index) => ({ recommendation, index }))
    .sort((left, right) => {
      if (sortMode === "recommended") return left.index - right.index;
      if (sortMode === "performance") return right.recommendation.improvementPercent - left.recommendation.improvementPercent || left.index - right.index;
      if (sortMode === "expansion") {
        const leftDelta = left.recommendation.expansionEvidence?.scoreDelta ?? Number.NEGATIVE_INFINITY;
        const rightDelta = right.recommendation.expansionEvidence?.scoreDelta ?? Number.NEGATIVE_INFINITY;
        const leftCandidateScore = left.recommendation.expansionEvidence?.candidateScore ?? Number.NEGATIVE_INFINITY;
        const rightCandidateScore = right.recommendation.expansionEvidence?.candidateScore ?? Number.NEGATIVE_INFINITY;
        return rightDelta - leftDelta || rightCandidateScore - leftCandidateScore || right.recommendation.improvementPercent - left.recommendation.improvementPercent || left.index - right.index;
      }
      if (sortMode === "saving") {
        const leftDelta = left.recommendation.priceDeltaWon ?? Number.MAX_SAFE_INTEGER;
        const rightDelta = right.recommendation.priceDeltaWon ?? Number.MAX_SAFE_INTEGER;
        return leftDelta - rightDelta || right.recommendation.improvementPercent - left.recommendation.improvementPercent || left.index - right.index;
      }
      if (sortMode === "reliability") {
        return upgradeRecommendationTrustScore(right.recommendation) - upgradeRecommendationTrustScore(left.recommendation)
          || right.recommendation.similarityEvidence.comparedDimensions - left.recommendation.similarityEvidence.comparedDimensions
          || left.index - right.index;
      }
      const leftValue = upgradeValueScore(left.recommendation) ?? Number.NEGATIVE_INFINITY;
      const rightValue = upgradeValueScore(right.recommendation) ?? Number.NEGATIVE_INFINITY;
      return rightValue - leftValue || right.recommendation.improvementPercent - left.recommendation.improvementPercent || left.index - right.index;
    })
    .map((entry) => entry.recommendation);
}

const recommendationTrustLabels: Record<RecommendationTrustEvidence["level"], string> = { high: "높음", medium: "보통", low: "낮음" };
const recommendationFreshnessLabels: Record<RecommendationTrustEvidence["freshness"], string> = { fresh: "최근 갱신", aging: "갱신 권장", stale: "오래된 데이터", unknown: "갱신 시점 불명" };

function recommendationTrustText(trust: RecommendationTrustEvidence | undefined) {
  return trust ? `${recommendationTrustLabels[trust.level]} ${trust.score}점` : "산정 불가";
}

function recommendationTrustDetail(trust: RecommendationTrustEvidence) {
  const compatibility = trust.compatibility === "verified" ? "호환 확인됨" : "호환 추가 확인";
  const comparison = trust.totalDimensions > 0 ? `비교 ${trust.comparedDimensions}/${trust.totalDimensions}` : "성능 비교 없음";
  const price = trust.priceEvidence ? CATALOG_PRICE_EVIDENCE_LABELS[trust.priceEvidence] : trust.priceKnown ? "가격 기록 있음" : "가격 기록 없음";
  const fullBuild = trust.fullBuildStatus === "clean" ? "전체 견적 정리됨" : `전체 견적 남은 차단 ${trust.remainingBlockerCount}개·주의 ${trust.remainingWarningCount}개·확인 필요 ${trust.remainingUnknownCount}개`;
  const benchmark = trust.benchmarkBacked ? `벤치마크 ${trust.benchmarkSourceKind ? BENCHMARK_SOURCE_KIND_LABELS[trust.benchmarkSourceKind] : "출처 확인 필요"}` : undefined;
  const benchmarkFreshness = benchmark && trust.benchmarkFreshness ? ` · 자료 ${recommendationFreshnessLabels[trust.benchmarkFreshness]}` : "";
  const catalogSpecSource = trust.catalogSpecSourceCheckNeedsReview === undefined ? "" : trust.catalogSpecSourceCheckNeedsReview ? " · 제조사 정보 다시 확인 필요" : " · 제조사 정보 확인됨";
  return `${compatibility} · ${comparison} · ${recommendationFreshnessLabels[trust.freshness]} · ${price}${benchmark ? ` · ${benchmark}${benchmarkFreshness}` : ""}${catalogSpecSource} · ${fullBuild}`;
}

function upgradePhysicalEvidenceLabel(status: NonNullable<UpgradeRecommendation["physicalEvidence"]>["status"]) {
  return status === "verified" ? "확인됨" : status === "review" ? "확인 필요" : "미적용";
}

function upgradePhysicalEvidenceText(evidence: UpgradeRecommendation["physicalEvidence"]) {
  if (!evidence || evidence.status === "not_applicable") return undefined;
  const sourceCount = sharedPhysicalEvidenceSources(evidence.sources).length;
  return `장착 정보 · ${upgradePhysicalEvidenceLabel(evidence.status)}${sourceCount > 0 ? ` · 출처 ${sourceCount}건` : " · 출처 메모 없음"} · ${evidence.summary}`;
}

function UpgradePhysicalEvidence({ evidence }: { evidence: UpgradeRecommendation["physicalEvidence"] }) {
  const text = upgradePhysicalEvidenceText(evidence);
  if (!evidence || !text) return null;
  const sources = sharedPhysicalEvidenceSources(evidence.sources);
  return <div className={`upgrade-physical-evidence ${evidence.status}`} aria-label="업그레이드 부품 장착 정보"><div><strong>장착 정보</strong><span>{upgradePhysicalEvidenceLabel(evidence.status)}</span></div><p>{evidence.summary}</p>{sources.length > 0 ? <div className="upgrade-physical-evidence-sources">{sources.map((source) => <small key={`${source.category}-${source.note}-${source.url ?? ""}`}><b>{sharedPhysicalEvidenceSourceIdentity(source)}</b> {source.note}{source.updatedAt ? ` · 정보 갱신 ${new Date(source.updatedAt).toLocaleDateString("ko-KR")}` : ""}{source.url && <a href={source.url} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a>}</small>)}</div> : <small className="upgrade-physical-evidence-sources-empty">출처 메모가 없어요 · 제조사 페이지에서 확인해 주세요</small>}</div>;
}

function UpgradeRecommendationPanel({ recommendations, onApply, onPreview, onWatchPart }: { recommendations: UpgradeRecommendation[]; onApply: (recommendation: UpgradeRecommendation) => void; onPreview: (recommendation: UpgradeRecommendation) => void; onWatchPart: PartWatchHandler }) {
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<PartCategory | "all">("all");
  const [sortMode, setSortMode] = useState<UpgradeSortMode>("recommended");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const availableCategories = PART_CATEGORIES.filter((category) => recommendations.some((recommendation) => recommendation.category === category));
  const filteredRecommendations = categoryFilter === "all"
    ? recommendations
    : recommendations.filter((recommendation) => recommendation.category === categoryFilter);
  const visibleRecommendations = sortedUpgradeRecommendations(filteredRecommendations, sortMode);
  const comparedRecommendations = recommendations.filter((recommendation) => compareIds.includes(`${recommendation.category}-${recommendation.part.id}`));

  function toggleCompare(recommendation: UpgradeRecommendation) {
    const id = `${recommendation.category}-${recommendation.part.id}`;
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return current.length >= 3 ? current : [...current, id];
    });
  }

  return <section className="upgrade-recommendation-panel" data-upgrade-sort={sortMode}>
    <p className="upgrade-price-evidence-legend" data-testid="upgrade-price-evidence-legend"><FiInfo /> 가격은 출처를 함께 봐야 해요. 다나와 가격은 카탈로그 기록이고, 참고 가격은 실제 판매가가 아닙니다. 사기 전에 판매 페이지와 재고를 다시 확인해 주세요.</p>
    <div className="upgrade-recommendation-heading"><div><p className="eyebrow">COMPATIBLE UPGRADES</p><h2>호환 유지 업그레이드</h2><p>지금 구성에 새 문제를 만들지 않으면서 성능·용량·확장성이 나아지는 부품이에요.</p><small className="upgrade-recommendation-sort-note">개선 점수·우선순위·호환 유지 여부를 함께 계산한 결과 · 최대 3개 비교</small></div><span className="upgrade-recommendation-icon"><FiZap /></span></div>
    <div className="upgrade-category-filters" role="group" aria-label="업그레이드 부품 분류"><button className={categoryFilter === "all" ? "selected" : ""} type="button" aria-pressed={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>전체 {recommendations.length}</button>{availableCategories.map((category) => { const count = recommendations.filter((recommendation) => recommendation.category === category).length; return <button className={categoryFilter === category ? "selected" : ""} type="button" aria-pressed={categoryFilter === category} onClick={() => setCategoryFilter(category)} key={category}>{CATEGORY_LABELS[category]} {count}</button>; })}</div>
    <div className="upgrade-recommendation-sort"><label><span>부품 정렬</span><select aria-label="업그레이드 부품 정렬" value={sortMode} onChange={(event) => setSortMode(event.target.value as UpgradeSortMode)}><option value="recommended">추천 순</option><option value="reliability">정보 충분한 순</option><option value="performance">성능 개선 폭</option><option value="expansion">확장성 개선 폭</option><option value="value">가성비</option><option value="saving">추가 지출 낮은 순</option></select></label><small>{sortMode === "recommended" ? "서버가 계산한 호환·우선순위 순서" : sortMode === "reliability" ? "추천 점수·비교 정보가 충분한 순" : sortMode === "performance" ? "비교 가능한 스펙 개선 비율이 큰 순" : sortMode === "expansion" ? "부품 적용 후 확장성 점수 변화가 큰 순" : sortMode === "value" ? "가격 변화 대비 개선 효율이 높은 순" : "교체 후 추가 지출이 낮은 순"}</small></div>
    <div className="upgrade-recommendation-list">{visibleRecommendations.map((recommendation, index) => { const id = `${recommendation.category}-${recommendation.part.id}`; const compared = compareIds.includes(id); const budgetClass = recommendation.budgetEvidence?.priceComplete ? recommendation.budgetEvidence.withinBudget ? "within" : "over" : "unknown"; const expanded = expandedId === id; const sourceUrl = safeExternalUrl(recommendation.part.danawaUrl); return <article className={compared ? "upgrade-recommendation-card compared" : "upgrade-recommendation-card"} key={id}><div className="upgrade-recommendation-top"><div className="upgrade-recommendation-badges"><span className="category-badge">{CATEGORY_LABELS[recommendation.category]}</span>{index === 0 && categoryFilter === "all" && <span className="upgrade-rank-badge">우선 추천</span>}{recommendation.recommendationTrust && <span className={`upgrade-trust-badge ${recommendation.recommendationTrust.level}`}>추천 {recommendationTrustText(recommendation.recommendationTrust)}</span>}</div><span className="upgrade-score">개선 점수 {recommendation.upgradeScore}점 · 비교 변화 +{recommendation.improvementPercent.toFixed(1)}%</span></div><div className="upgrade-recommendation-body"><span className="upgrade-recommendation-image"><PartVisual part={recommendation.part} /></span><div className="upgrade-recommendation-copy"><strong>{recommendation.part.name}</strong><small>현재: {recommendation.currentPartName}</small><button className="upgrade-detail-toggle" type="button" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : id)}>{expanded ? "상세 스펙 닫기" : "상세 스펙 보기"} <FiChevronDown /></button><p>{recommendation.reason}</p><em>개선 지표: {recommendation.improvedDimensions.join(" · ")}</em><em>{recommendation.performanceSummary}</em>{recommendation.gpuTarget && <em className={`upgrade-gpu-target ${recommendation.gpuTarget.candidateFit}`}>{recommendation.gpuTarget.summary}</em>}<em className="upgrade-compatibility">{upgradeCompatibilityStatus(recommendation.compatibilityEvidence)} · {upgradeCompatibilityText(recommendation.compatibilityEvidence)}</em>{recommendation.expansionEvidence && <em className={`upgrade-expansion ${upgradeExpansionTone(recommendation.expansionEvidence)}`}>{upgradeExpansionText(recommendation.expansionEvidence)}</em>}{recommendation.budgetEvidence && <em className={`upgrade-budget ${budgetClass}`}>{upgradeBudgetText(recommendation.budgetEvidence)}</em>}{recommendation.recommendationTrust && <em className={`upgrade-recommendation-trust ${recommendation.recommendationTrust.level}`}>추천 점수 {recommendationTrustText(recommendation.recommendationTrust)} · {recommendationTrustDetail(recommendation.recommendationTrust)}</em>}<em>유사도 {recommendation.similarityLabel} {recommendation.similarityScore}점 · {similarityEvidenceText(recommendation.similarityEvidence)}</em></div><div className="upgrade-recommendation-side"><strong>{formatWon(recommendation.part.priceWon)}</strong><small>{recommendation.quantity > 1 ? `수량 ${recommendation.quantity}개 · ` : ""}{formatPriceDelta(recommendation.priceDeltaWon)}</small>{sourceUrl && <a className="upgrade-source-link" href={sourceUrl} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a>}<PartWatchButton part={recommendation.part} onWatch={onWatchPart} /><button className={compared ? "button button-small upgrade-compare-button selected" : "button button-small upgrade-compare-button"} type="button" onClick={() => toggleCompare(recommendation)} disabled={!compared && compareIds.length >= 3} aria-pressed={compared}><FiLayers /> {compared ? "비교 중" : "비교"}</button><button className="button button-small upgrade-preview-button" type="button" onClick={() => onPreview(recommendation)}><FiActivity /> 미리 적용</button><button className="button button-small button-fix" type="button" onClick={() => onApply(recommendation)}><FiZap /> 적용 후 재검사</button></div></div>{expanded && <UpgradeRecommendationDetail recommendation={recommendation} />}</article>; })}</div>
    {visibleRecommendations.some((recommendation) => recommendation.physicalEvidence && recommendation.physicalEvidence.status !== "not_applicable") && <section className="upgrade-physical-evidence-overview" aria-label="업그레이드 부품 장착 정보"><div><strong>업그레이드 부품 장착 정보</strong><span>GPU·케이스·PSU 부품의 구매 전 확인 상태</span></div><div className="upgrade-physical-evidence-overview-list">{visibleRecommendations.filter((recommendation) => recommendation.physicalEvidence && recommendation.physicalEvidence.status !== "not_applicable").map((recommendation) => <article key={`${recommendation.category}-${recommendation.part.id}`}><strong>{recommendation.part.name}</strong><UpgradePhysicalEvidence evidence={recommendation.physicalEvidence} /></article>)}</div></section>}
    {comparedRecommendations.length >= 2 && <UpgradeRecommendationComparison recommendations={comparedRecommendations} />}
    <p className="upgrade-recommendation-note"><FiInfo /> 개선 점수는 실제 FPS나 벤치 순위가 아니라 카탈로그에서 확인한 같은 범주 스펙의 상대 변화입니다. 비교표의 호환 여유는 부품을 견적 전체에 적용해 계산한 결과예요. 사기 전에 제조사 안내와 실제 사용 목적을 확인해 주세요.</p>
  </section>;
}

function upgradePartQualityLabel(part: Part) {
  return DATA_QUALITY_LABELS[part.dataQuality];
}

function UpgradeRecommendationDetail({ recommendation }: { recommendation: UpgradeRecommendation }) {
  const part = recommendation.part;
  const sourceUrl = safeExternalUrl(part.danawaUrl);
  const priceEvidence = catalogPriceEvidenceFor(part);
  return <div className="upgrade-recommendation-detail">{recommendation.recommendationTrust && <div className={`recommendation-trust ${recommendation.recommendationTrust.level}`} aria-label="추천 점수"><div className="recommendation-trust-heading"><strong>추천 점수</strong><span>{recommendationTrustText(recommendation.recommendationTrust)}</span></div><p>{recommendationTrustDetail(recommendation.recommendationTrust)}</p><ul>{recommendation.recommendationTrust.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><small>현재 카탈로그에서 확인된 정보가 얼마나 충분한지 보여주는 점수입니다. 성능 보장은 아니에요.</small></div>}<p className={`upgrade-price-evidence ${priceEvidence}`} data-testid="upgrade-price-evidence" title={catalogPriceEvidenceDescriptionFor(part)}><FiInfo /> 가격 출처 · <strong>{catalogPriceEvidenceLabelFor(part)}</strong> · {catalogPriceEvidenceDescriptionFor(part)}</p><div className="upgrade-detail-grid">{suggestionSpecRows(part).map(([label, value]) => <div className="upgrade-detail-row" key={label}><span>{label}</span><strong>{formatSpecValue(value)}</strong></div>)}</div>{part.rawSpecText && <div className="upgrade-raw-spec"><span>저장된 스펙 정보</span><p>{part.rawSpecText}</p></div>}<div className="upgrade-detail-footer"><span><FiDatabase /> {upgradePartQualityLabel(part)}{part.missingFields.length > 0 ? ` · 누락 ${part.missingFields.length}개` : " · 필수 스펙 확인"} · {part.updatedAt ? `갱신 ${new Date(part.updatedAt).toLocaleDateString("ko-KR")}` : "갱신 시점 없음"}{part.listingType && part.listingType !== "retail" ? ` · ${LISTING_TYPE_LABELS[part.listingType]}` : ""}</span>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">다나와 상품 페이지 보기 <FiExternalLink /></a>}</div></div>;
}

function UpgradeRecommendationComparison({ recommendations }: { recommendations: UpgradeRecommendation[] }) {
  return <div className="upgrade-comparison"><div className="upgrade-comparison-heading"><div><strong>업그레이드 부품 비교</strong><span>{recommendations.length}개 선택</span></div><FiLayers /></div><div className="upgrade-comparison-table-wrap"><table><caption>각 부품을 현재 구성에 적용해 계산한 비교예요.</caption><thead><tr><th scope="col">비교 항목</th>{recommendations.map((recommendation) => <th scope="col" key={`${recommendation.category}-${recommendation.part.id}`}>{recommendation.part.name}</th>)}</tr></thead><tbody><tr><th scope="row">현재 부품</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-current`}>{recommendation.currentPartName}</td>)}</tr><tr><th scope="row">분류</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-category`}>{CATEGORY_LABELS[recommendation.category]}</td>)}</tr><tr><th scope="row">수량</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-quantity`}>{recommendation.quantity}개</td>)}</tr><tr><th scope="row">개선 지표</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-dimensions`}>{recommendation.improvedDimensions.join(" · ")}</td>)}</tr><tr><th scope="row">비교 변화</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-improvement`}>+{recommendation.improvementPercent.toFixed(1)}%<br /><small>{recommendation.performanceSummary}</small></td>)}</tr><tr><th scope="row">가격</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-price`}>{recommendation.currentPriceWon !== undefined ? `${formatWon(recommendation.currentPriceWon)} → ` : "현재 가격 확인 필요 → "}{formatWon(recommendation.part.priceWon)}</td>)}</tr><tr><th scope="row">가격 변화</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-delta`}>{formatPriceDelta(recommendation.priceDeltaWon)}</td>)}</tr>{recommendations.some((recommendation) => recommendation.budgetEvidence) && <tr><th scope="row">예산</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-budget`}>{upgradeBudgetText(recommendation.budgetEvidence) ?? "목표 예산 미설정"}</td>)}</tr>}<tr><th scope="row">호환 여유</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-compatibility`}><strong>{upgradeCompatibilityStatus(recommendation.compatibilityEvidence)}</strong><br /><small>{upgradeCompatibilityText(recommendation.compatibilityEvidence)}</small></td>)}</tr>{recommendations.some((recommendation) => recommendation.expansionEvidence) && <tr><th scope="row">확장성 변화</th>{recommendations.map((recommendation) => <td className={`upgrade-expansion-cell ${upgradeExpansionTone(recommendation.expansionEvidence)}`} key={`${recommendation.part.id}-expansion`}>{upgradeExpansionText(recommendation.expansionEvidence)}</td>)}</tr>}{recommendations.some((recommendation) => recommendation.gpuTarget) && <tr><th scope="row">GPU 목표</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-target`}>{recommendation.gpuTarget?.summary ?? "해당 없음"}</td>)}</tr>}<tr><th scope="row">유사도</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-similarity`}>{recommendation.similarityLabel} {recommendation.similarityScore}점<br /><small>{similarityEvidenceText(recommendation.similarityEvidence)}</small></td>)}</tr>{recommendations.some((recommendation) => recommendation.recommendationTrust) && <tr><th scope="row">추천 점수</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-trust`}>{recommendation.recommendationTrust ? <><strong>{recommendationTrustText(recommendation.recommendationTrust)}</strong><br /><small>{recommendationTrustDetail(recommendation.recommendationTrust)}</small></> : "산정 불가"}</td>)}</tr>}</tbody></table></div></div>;
}

type AccessoryRecommendationSort = "recommended" | "price_asc" | "confidence";

function accessoryRecommendationUpdatedLabel(item: AccessoryItem) {
  const date = new Date(item.updatedAt);
  return Number.isNaN(date.getTime()) ? "확인 필요" : date.toLocaleDateString("ko-KR");
}

function accessoryRecommendationSpecRows(category: AccessoryCategory) {
  const rows: Array<{ label: string; value: (item: AccessoryItem) => string }> = [];
  const joinedDimensions = (item: AccessoryItem) => [item.specs.lengthMm, item.specs.widthMm, item.specs.thicknessMm].filter((value) => value !== undefined).map((value) => `${value}mm`).join(" × ") || "확인 필요";
  if (category === "cooling_fan") {
    rows.push(
      { label: "팬 크기", value: joinedDimensions },
      { label: "팬 개수", value: (item) => item.specs.fanCount === undefined ? "확인 필요" : `${item.specs.fanCount}개` },
      { label: "팬 소비전류", value: (item) => item.specs.fanCurrentA === undefined ? "확인 필요" : `${item.specs.fanCurrentA.toFixed(2)}A/팬` },
      { label: "RGB 장치 전압", value: (item) => item.specs.rgbDeviceVoltage ?? "확인 필요" }
    );
  } else if (category === "storage_accessory" || category === "m2_heatsink") {
    rows.push({ label: "인터페이스", value: (item) => item.specs.interface ?? "확인 필요" });
    if (category === "storage_accessory") {
      rows.push(
        { label: "어댑터 동시 장착 최대", value: (item) => item.specs.adapterStorageDeviceCount === undefined ? "확인 필요" : `${item.specs.adapterStorageDeviceCount}개` },
        { label: "PCIe 요구 슬롯 폭", value: (item) => item.specs.adapterPcieSlotWidth === undefined ? "확인 필요" : `x${item.specs.adapterPcieSlotWidth}` }
      );
    }
    rows.push(
      { label: "지원 규격", value: (item) => item.specs.supportedFormFactors?.join(" · ") || item.specs.formFactor || "확인 필요" },
      { label: "폼팩터", value: (item) => item.specs.formFactor ?? "확인 필요" }
    );
  } else if (category === "thermal_grease") {
    rows.push({ label: "열전도율", value: (item) => item.specs.thermalConductivityWmK === undefined ? "확인 필요" : `${item.specs.thermalConductivityWmK.toFixed(1)} W/mK` });
  } else if (category === "gpu_cooler" || category === "memory_cooler") {
    rows.push(
      { label: "팬 개수", value: (item) => item.specs.fanCount === undefined ? "확인 필요" : `${item.specs.fanCount}개` },
      { label: "팬 소비전류", value: (item) => item.specs.fanCurrentA === undefined ? "확인 필요" : `${item.specs.fanCurrentA.toFixed(2)}A/팬` },
      { label: "RGB 장치 전압", value: (item) => item.specs.rgbDeviceVoltage ?? "확인 필요" },
      { label: "팬 크기", value: joinedDimensions }
    );
  } else if (category === "thermal_pad") {
    rows.push({ label: "패드 두께", value: (item) => item.specs.thicknessMm === undefined ? "확인 필요" : `${item.specs.thicknessMm}mm` });
  } else if (category === "fan_hub") {
    rows.push(
      { label: "팬 출력 포트", value: (item) => item.specs.fanPortCount === undefined ? "확인 필요" : `${item.specs.fanPortCount}개` },
      { label: "RGB 출력 포트", value: (item) => item.specs.rgbPortCount === undefined ? "확인 필요" : `${item.specs.rgbPortCount}개` },
      { label: "RGB 전압", value: (item) => item.specs.rgbDeviceVoltage ?? "확인 필요" },
      { label: "외부 출력", value: (item) => item.specs.outputW === undefined ? "확인 필요" : `${item.specs.outputW}W` }
    );
  } else if (category === "ups") {
    rows.push(
      { label: "출력", value: (item) => item.specs.outputW === undefined ? "확인 필요" : `${item.specs.outputW}W` },
      { label: "용량", value: (item) => item.specs.capacityVa === undefined ? "확인 필요" : `${item.specs.capacityVa}VA` },
      { label: "콘센트", value: (item) => item.specs.outletCount === undefined ? "확인 필요" : `${item.specs.outletCount}개` }
    );
  } else {
    rows.push(
      { label: "규격", value: (item) => item.specs.formFactor ?? "확인 필요" },
      { label: "크기", value: joinedDimensions }
    );
  }
  return rows;
}

function AccessoryRecommendationPanel({ recommendations, selectedAccessories, onAddAccessory, onWatchAccessory, isAccessoryWatched }: { recommendations: AccessoryRecommendation[]; selectedAccessories: AccessorySelection[]; onAddAccessory: (item: AccessoryItem) => void; onWatchAccessory?: (item: AccessoryItem, targetPriceWon?: number) => boolean; isAccessoryWatched?: (item: AccessoryItem) => boolean }) {
  const [categoryFilter, setCategoryFilter] = useState<AccessoryCategory | "all">("all");
  const [sortMode, setSortMode] = useState<AccessoryRecommendationSort>("recommended");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const availableCategories = useMemo(() => ACCESSORY_CATEGORIES.filter((category) => recommendations.some((recommendation) => recommendation.category === category)), [recommendations]);
  useEffect(() => {
    if (categoryFilter !== "all" && !availableCategories.includes(categoryFilter)) setCategoryFilter("all");
  }, [availableCategories, categoryFilter]);
  const visibleRecommendations = useMemo(() => {
    const confidenceRank: Record<AccessoryRecommendation["confidence"], number> = { high: 0, medium: 1, low: 2 };
    const priorityRank: Record<AccessoryRecommendation["priority"], number> = { recommended: 0, optional: 1 };
    const filtered = recommendations.filter((recommendation) => categoryFilter === "all" || recommendation.category === categoryFilter);
    if (sortMode === "recommended") return filtered;
    return filtered
      .map((recommendation, index) => ({ recommendation, index }))
      .sort((left, right) => {
        if (sortMode === "price_asc") {
          const leftPrice = left.recommendation.item.priceWon;
          const rightPrice = right.recommendation.item.priceWon;
          const leftKnown = isKnownPrice(leftPrice);
          const rightKnown = isKnownPrice(rightPrice);
          if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
          if (isKnownPrice(leftPrice) && isKnownPrice(rightPrice) && leftPrice !== rightPrice) return leftPrice - rightPrice;
        }
        if (sortMode === "confidence") {
          const confidenceDelta = confidenceRank[left.recommendation.confidence] - confidenceRank[right.recommendation.confidence];
          if (confidenceDelta !== 0) return confidenceDelta;
        }
        return priorityRank[left.recommendation.priority] - priorityRank[right.recommendation.priority] || left.index - right.index;
      })
      .map(({ recommendation }) => recommendation);
  }, [categoryFilter, recommendations, sortMode]);
  const comparedRecommendations = useMemo(() => recommendations.filter((recommendation) => compareIds.includes(recommendation.id)), [compareIds, recommendations]);
  const compareCategory = comparedRecommendations[0]?.category;
  function toggleCompare(recommendation: AccessoryRecommendation) {
    setCompareIds((current) => {
      if (current.includes(recommendation.id)) return current.filter((id) => id !== recommendation.id);
      const selected = recommendations.filter((candidate) => current.includes(candidate.id));
      if (selected.length >= 3 || selected[0]?.category && selected[0].category !== recommendation.category) return current;
      return [...current, recommendation.id];
    });
  }
  return <section className="peripheral-recommendation-panel" data-testid="peripheral-recommendation-panel">
    <div className="peripheral-recommendation-heading"><div><p className="eyebrow">PERIPHERAL ADD-ONS</p><h2>현재 구성에 맞는 주변 부품</h2><p>선택한 핵심 부품의 확인된 스펙을 기준으로 조립·정비에 도움이 될 수 있는 주변 부품을 제안합니다. 팬 헤더·RGB 전압이 부족할 때는 보완 컨트롤러를 우선 표시합니다.</p></div><span className="peripheral-recommendation-icon"><FiTool /></span></div>
    <div className="peripheral-recommendation-controls"><div className="peripheral-recommendation-filters" role="group" aria-label="주변 부품 추천 범주"><button className={categoryFilter === "all" ? "selected" : ""} type="button" data-testid="accessory-recommendation-filter-all" aria-pressed={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>전체 {recommendations.length}</button>{availableCategories.map((category) => { const count = recommendations.filter((recommendation) => recommendation.category === category).length; return <button className={categoryFilter === category ? "selected" : ""} type="button" data-testid={`accessory-recommendation-filter-${category}`} aria-pressed={categoryFilter === category} onClick={() => setCategoryFilter(category)} key={category}>{ACCESSORY_CATEGORY_LABELS[category]} {count}</button>; })}</div><label className="peripheral-recommendation-sort"><span>추천 정렬</span><select aria-label="주변 부품 추천 정렬" data-testid="accessory-recommendation-sort" value={sortMode} onChange={(event) => setSortMode(event.target.value as AccessoryRecommendationSort)}><option value="recommended">추천 순</option><option value="price_asc">가격 낮은 순</option><option value="confidence">정보 충분한 순</option></select></label><a className="peripheral-recommendation-catalog-link" href="/accessories"><FiSearch /> 전체 카탈로그</a></div>
    <div className="peripheral-recommendation-compare-status">{compareIds.length > 0 ? <><FiLayers /> 같은 범주 부품 비교 {compareIds.length} / 3{compareCategory ? ` · ${ACCESSORY_CATEGORY_LABELS[compareCategory]}` : ""}</> : <><FiLayers /> 부품을 고르면 같은 범주끼리 최대 3개를 비교할 수 있어요.</>}</div>
    <div className="peripheral-recommendation-list">{visibleRecommendations.map((recommendation) => <AccessoryRecommendationCard key={recommendation.id} recommendation={recommendation} selected={selectedAccessories.some((selection) => selection.accessoryId === recommendation.item.id)} compared={compareIds.includes(recommendation.id)} compareDisabled={!compareIds.includes(recommendation.id) && (compareIds.length >= 3 || Boolean(compareCategory && compareCategory !== recommendation.category))} onToggleCompare={() => toggleCompare(recommendation)} onAddAccessory={onAddAccessory} onWatchAccessory={onWatchAccessory} isAccessoryWatched={isAccessoryWatched} />)}</div>
    {visibleRecommendations.length === 0 && <div className="peripheral-recommendation-empty"><FiSearch /> 선택한 범주에 맞는 추천 부품이 없어요. 전체 추천으로 돌아가 보세요.</div>}
    {comparedRecommendations.length >= 2 && <AccessoryRecommendationComparison recommendations={comparedRecommendations} />}
    <p className="peripheral-recommendation-note"><FiInfo /> {visibleRecommendations.length}개 / 전체 {recommendations.length}개 추천 표시 · 주변 부품은 핵심 호환성과 별도의 보완 제안이에요. 케이스 내부 간섭·전원·커넥터는 사기 전에 제조사 페이지를 확인해 주세요.</p>
  </section>;
}

type AccessoryRecommendationPriceHistory = {
  itemId: string;
  windowDays: 7 | 30 | 90;
  points: Array<{ changeId: string; changedAt: string; priceWon: number }>;
  summary: PriceWatchDecisionHistory & { maxPriceWon?: number };
};

function accessoryRecommendationPriceHistoryText(history: AccessoryRecommendationPriceHistory | undefined, currentPriceWon: number | undefined) {
  if (!history) return "가격 이력 확인 중";
  if (history.summary.sampleCount === 0) return `최근 ${history.windowDays}일 기록 없음 · 현재가만 확인`;
  const facts = [`최근 ${history.windowDays}일 ${history.summary.sampleCount}회`];
  if (history.summary.minPriceWon !== undefined) facts.push(`최저 ${formatWon(history.summary.minPriceWon)}`);
  if (currentPriceWon !== undefined && history.summary.currentPositionPercent !== undefined) facts.push(`현재 위치 ${history.summary.currentPositionPercent.toFixed(1)}%`);
  return facts.join(" · ");
}

function AccessoryRecommendationComparison({ recommendations }: { recommendations: AccessoryRecommendation[] }) {
  const category = recommendations[0]?.category;
  if (!category) return null;
  const [historyDays, setHistoryDays] = useState<7 | 30 | 90>(30);
  const [priceHistories, setPriceHistories] = useState<Record<string, AccessoryRecommendationPriceHistory>>({});
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError(null);
    setPriceHistories({});
    const ids = recommendations.map((recommendation) => `accessory:${recommendation.item.id}`).join(",");
    void api<{ items: AccessoryRecommendationPriceHistory[] }>(`/api/price-history?ids=${encodeURIComponent(ids)}&days=${historyDays}`, { retry: 1, signal: controller.signal })
      .then((payload) => {
        if (cancelled) return;
        setPriceHistories(Object.fromEntries(payload.items.map((item) => [item.itemId, item])));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setHistoryError(reason instanceof Error ? reason.message : "가격 이력을 확인하지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [historyDays, recommendations]);
  const rows = [
    { label: "가격", value: (recommendation: AccessoryRecommendation) => formatWon(recommendation.item.priceWon) },
    { label: "가격 행동", value: (recommendation: AccessoryRecommendation) => priceWatchDecisionFor({ currentStatus: isKnownPrice(recommendation.item.priceWon) ? "available" : "unavailable", currentPriceWon: recommendation.item.priceWon, history: priceHistories[recommendation.item.id]?.summary }).label },
    { label: "최근 가격 이력", value: (recommendation: AccessoryRecommendation) => accessoryRecommendationPriceHistoryText(priceHistories[recommendation.item.id], recommendation.item.priceWon) },
    { label: "데이터 상태", value: (recommendation: AccessoryRecommendation) => DATA_QUALITY_LABELS[recommendation.item.dataQuality] },
    { label: "마지막 갱신", value: (recommendation: AccessoryRecommendation) => accessoryRecommendationUpdatedLabel(recommendation.item) },
    { label: "필수 누락", value: (recommendation: AccessoryRecommendation) => recommendation.item.missingFields.length > 0 ? `${recommendation.item.missingFields.length}개` : "없음" },
    ...accessoryRecommendationSpecRows(category).map((row) => ({ label: row.label, value: (recommendation: AccessoryRecommendation) => row.value(recommendation.item) })),
    { label: "추천 이유", value: (recommendation: AccessoryRecommendation) => recommendation.reason },
    { label: "맞는 이유", value: (recommendation: AccessoryRecommendation) => recommendation.fitBasis }
  ];
  return <section className="peripheral-recommendation-comparison" data-testid="accessory-recommendation-comparison" aria-label="주변 부품 추천 비교"><div className="peripheral-recommendation-comparison-heading"><div><span>READ-ONLY COMPARISON</span><strong>{ACCESSORY_CATEGORY_LABELS[category]} 부품 비교</strong><small>선택한 부품의 저장된 데이터만 나란히 비교해요. 이 표는 견적을 변경하거나 호환성을 새로 정하지 않아요.</small></div><div className="peripheral-recommendation-comparison-heading-actions"><label><span>가격 이력</span><select aria-label="주변 부품 추천 가격 이력 기간" data-testid="accessory-recommendation-history-days" value={historyDays} onChange={(event) => setHistoryDays(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>7일</option><option value={30}>30일</option><option value={90}>90일</option></select></label><span>{recommendations.length}개 선택</span></div></div>{historyError && <p className="peripheral-recommendation-comparison-history-error" role="status"><FiInfo /> 가격 이력을 불러오지 못해 현재 가격과 저장된 추천 이유만 표시해요. {historyError}</p>}{historyLoading && <p className="peripheral-recommendation-comparison-history-loading" role="status"><FiLoader className="spin" /> 최근 가격 이력을 확인하는 중...</p>}<div className="peripheral-recommendation-comparison-table-wrap"><table><caption>주변 부품 추천 비교</caption><thead><tr><th scope="col">비교 항목</th>{recommendations.map((recommendation) => <th scope="col" key={recommendation.id}>{recommendation.item.name}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{recommendations.map((recommendation) => <td key={`${recommendation.id}-${row.label}`}>{row.value(recommendation)}</td>)}</tr>)}</tbody></table></div><p className="peripheral-recommendation-comparison-note"><FiInfo /> 가격 이력이 2회 미만이면 구매 행동을 추정하지 않고 기록 없음으로 표시합니다. 현재 가격은 카탈로그 확인값이며, 실제 결제 가격·재고·배송비를 보장하지 않습니다.</p></section>;
}

function AccessoryRecommendationCard({ recommendation, selected, compared, compareDisabled, onToggleCompare, onAddAccessory, onWatchAccessory, isAccessoryWatched }: { recommendation: AccessoryRecommendation; selected: boolean; compared: boolean; compareDisabled: boolean; onToggleCompare: () => void; onAddAccessory: (item: AccessoryItem) => void; onWatchAccessory?: (item: AccessoryItem, targetPriceWon?: number) => boolean; isAccessoryWatched?: (item: AccessoryItem) => boolean }) {
  const sourceUrl = safeExternalUrl(recommendation.item.danawaUrl);
  const catalogUrl = `/accessories?category=${encodeURIComponent(recommendation.category)}&itemId=${encodeURIComponent(recommendation.item.id)}`;
  const [watching, setWatching] = useState(() => isAccessoryWatched?.(recommendation.item) ?? false);
  const [targetPriceDraft, setTargetPriceDraft] = useState("");
  const [watchError, setWatchError] = useState<string | null>(null);
  useEffect(() => {
    setWatching(isAccessoryWatched?.(recommendation.item) ?? false);
  }, [isAccessoryWatched, recommendation.item]);
  function savePriceWatch() {
    if (!onWatchAccessory) return;
    const rawTargetPrice = targetPriceDraft.trim();
    const targetPriceWon = rawTargetPrice === "" ? undefined : Number(rawTargetPrice);
    if (targetPriceWon !== undefined && !isKnownPrice(targetPriceWon)) {
      setWatchError("목표가는 1원 이상의 숫자로 입력해 주세요.");
      return;
    }
    if (onWatchAccessory(recommendation.item, targetPriceWon)) {
      setWatching(true);
      setWatchError(null);
    }
  }
  return <article className={selected ? "peripheral-recommendation selected" : "peripheral-recommendation"}>
    <div className="peripheral-recommendation-top"><span className="category-badge">{ACCESSORY_CATEGORY_LABELS[recommendation.category]}</span>{recommendation.item.dataFreshness && <span className={`freshness-badge ${recommendation.item.dataFreshness}`}>{DATA_FRESHNESS_LABELS[recommendation.item.dataFreshness]}</span>}<span className={"peripheral-confidence " + recommendation.confidence}>{recommendation.priority === "recommended" ? "추천" : "선택"} · {recommendation.confidence === "high" ? "정보 충분" : recommendation.confidence === "medium" ? "조건부" : "참고"}</span></div>
    <div className="peripheral-recommendation-body"><span className="peripheral-recommendation-image"><AccessoryVisual item={recommendation.item} /></span><div className="peripheral-recommendation-copy"><strong>{recommendation.item.name}</strong><p>{recommendation.reason}</p><small>{recommendation.fitBasis}</small>{recommendation.category === "storage_accessory" && recommendation.item.specs.adapterStorageDeviceCount !== undefined && <em className="peripheral-recommendation-capacity" data-testid="accessory-recommendation-capacity">어댑터 1개당 M.2 SSD 최대 {recommendation.item.specs.adapterStorageDeviceCount}개</em>}{recommendation.category === "storage_accessory" && recommendation.item.specs.adapterPcieSlotWidth !== undefined && <em className="peripheral-recommendation-capacity peripheral-recommendation-pcie-slot" data-testid="accessory-recommendation-pcie-slot">PCIe 슬롯 x{recommendation.item.specs.adapterPcieSlotWidth} 필요</em>}</div><div className="peripheral-recommendation-side"><strong>{formatWon(recommendation.item.priceWon)}</strong>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a>}<a className="peripheral-recommendation-catalog-item-link" data-testid="accessory-recommendation-open-catalog" href={catalogUrl}><FiSearch /> 카탈로그</a><button className={compared ? "button button-small accessory-compare-button selected" : "button button-small accessory-compare-button"} type="button" data-testid="accessory-recommendation-compare" onClick={onToggleCompare} disabled={compareDisabled} aria-pressed={compared} title={compareDisabled && !compared ? "같은 범주의 부품만 비교할 수 있어요." : undefined}><FiLayers /> {compared ? "비교 중" : "비교"}</button><button className="button button-small accessory-add-button" type="button" onClick={() => onAddAccessory(recommendation.item)} disabled={selected}>{selected ? <><FiCheck /> 추가됨</> : <><FiPlus /> 견적에 추가</>}</button>{onWatchAccessory && <div className="peripheral-recommendation-watch"><label><span>목표가</span><input type="number" min="1" step="1000" placeholder="선택" value={targetPriceDraft} data-testid="accessory-recommendation-watch-target" aria-label={`${recommendation.item.name} 추천 목표가`} onChange={(event) => { setTargetPriceDraft(event.target.value); setWatchError(null); }} /></label><button className="text-button" type="button" data-testid="accessory-recommendation-watch" onClick={savePriceWatch}>{watching ? "목표가 저장" : "가격 추적"}</button></div>}{watchError && <small className="peripheral-recommendation-watch-error" role="alert">{watchError}</small>}</div></div>
    <details className="peripheral-recommendation-details" data-testid="accessory-recommendation-details"><summary>스펙·이유 보기 <FiChevronDown /></summary><div className="peripheral-recommendation-detail-grid"><div><span>데이터 상태</span><strong>{DATA_QUALITY_LABELS[recommendation.item.dataQuality]}</strong></div><div><span>마지막 갱신</span><strong>{accessoryRecommendationUpdatedLabel(recommendation.item)}</strong></div><div><span>필수 누락</span><strong>{recommendation.item.missingFields.length > 0 ? `${recommendation.item.missingFields.length}개` : "없음"}</strong></div></div><div className="peripheral-recommendation-raw-spec"><span>저장된 스펙 정보</span><p>{recommendation.item.rawSpecText || "저장된 스펙 정보가 없어요. 제조사·판매처 페이지를 확인해 주세요."}</p></div></details>
  </article>;
}

function CompatibilityMap({ links, findings = [], onFocusFinding }: { links: CompatibilityLink[]; findings?: Finding[]; onFocusFinding?: (ruleId: string) => void }) {
  const statusCopy: Record<CompatibilityLink["status"], string> = {
    compatible: "호환",
    issue: "문제 있음",
    unknown: "확인 필요",
    not_applicable: "미검사"
  };
  const statusIcon: Record<CompatibilityLink["status"], IconType> = {
    compatible: FiCheckCircle,
    issue: FiXCircle,
    unknown: FiInfo,
    not_applicable: FiClock
  };

  return <section className="compatibility-map" data-testid="compatibility-map" tabIndex={-1}>
    <div className="compatibility-map-heading">
      <div><p className="eyebrow">COMPATIBILITY MAP</p><h2>부품 연결 상태</h2><p>추천 부품을 고를 때 영향을 주는 연결 관계를 규칙별로 요약해요.</p></div>
      <span className="compatibility-map-icon"><FiShare2 /></span>
    </div>
    <div className="compatibility-link-grid">
      {links.map((link) => {
        const FromIcon = CATEGORY_META[link.fromCategory].Icon;
        const ToIcon = CATEGORY_META[link.toCategory].Icon;
        const StatusIcon = statusIcon[link.status];
        const focusableRuleIds = [...new Set(link.ruleIds)].filter((ruleId) => findings.some((finding) => finding.ruleId === ruleId));
        return <article className={`compatibility-link ${link.status}`} key={link.id}>
          <div className="compatibility-link-top">
            <div className="compatibility-link-parts"><span><FromIcon /> {CATEGORY_LABELS[link.fromCategory]}</span><b>↔</b><span><ToIcon /> {CATEGORY_LABELS[link.toCategory]}</span></div>
            <span className={`compatibility-link-status ${link.status}`}><StatusIcon /> {statusCopy[link.status]}</span>
          </div>
          <strong>{link.label}</strong>
          <p>{link.summary}</p>
          {onFocusFinding && focusableRuleIds.length > 0 && <button className="text-button compatibility-link-action" type="button" onClick={() => onFocusFinding(focusableRuleIds[0])}>관련 결과 {focusableRuleIds.length > 1 ? `${focusableRuleIds.length}개 ` : ""}보기 <FiExternalLink /></button>}
        </article>;
      })}
    </div>
    <p className="compatibility-map-note"><FiInfo /> “문제 있음”은 차단 오류 또는 주의 항목이 연결된 상태이며, “확인 필요”는 현재 카탈로그 정보만으로는 알 수 없는 상태예요.</p>
  </section>;
}

type SavedBuildCatalogCauseState = {
  key: string;
  status: "idle" | "loading" | "ready" | "error";
  items: CatalogChangeRecord[];
  message?: string;
};

function currentDraftComparisonFor(build: BuildSelection, preferences: RecommendationPreferences, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>): SavedBuild {
  const price = buildPriceSnapshotFor(build, partMap, accessoryMap);
  const coreLines = PART_CATEGORIES.flatMap((category) => selectionList(build, category).map((selection) => ({
    category,
    name: partMap.get(selection.partId)?.name ?? selection.partId,
    quantity: selection.quantity
  })));
  const accessoryLines = accessorySelections(build).map((selection) => ({
    category: accessoryMap.get(selection.accessoryId)?.category,
    name: accessoryMap.get(selection.accessoryId)?.name ?? selection.accessoryId,
    quantity: selection.quantity
  }));
  return {
    id: "current-draft",
    name: "현재 편집기 견적",
    selection: build,
    recommendationPreferences: preferences,
    summary: {
      totalPriceWon: price.totalPriceWon,
      coreTotalPriceWon: price.coreTotalPriceWon,
      accessoryTotalPriceWon: price.accessoryTotalPriceWon,
      priceComplete: price.priceComplete,
      accessoryCount: accessoryLines.length,
      accessoryQuantity: accessoryLines.reduce((total, line) => total + line.quantity, 0),
      coreLines,
      accessoryLines
    },
    createdAt: "current-draft",
    updatedAt: "current-draft"
  };
}

function BuildComparisonPanel({ builds, onOpenBuild, openingBuildId }: { builds: SavedBuild[]; onOpenBuild?: (build: SavedBuild, focus?: "purchase-list") => void; openingBuildId?: string | null }) {
  const [liveChecks, setLiveChecks] = useState<Record<string, SavedBuildLiveCheck>>({});
  const [reloadToken, setReloadToken] = useState(0);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [showDifferencesOnly, setShowDifferencesOnly] = useState(false);
  const comparisonKey = JSON.stringify(builds.map((saved) => ({ id: saved.id, updatedAt: saved.updatedAt, selection: saved.selection, recommendationPreferences: saved.recommendationPreferences })));

  useEffect(() => {
    let cancelled = false;
    const initialChecks = Object.fromEntries(builds.map((saved) => [saved.id, { status: "loading" as const }])) as Record<string, SavedBuildLiveCheck>;
    setLiveChecks(initialChecks);
    setExportMessage(null);
    void Promise.all(builds.map(async (saved) => {
      try {
        const result = await api<CompatibilityResult>("/api/compatibility/check", {
          method: "POST",
          body: JSON.stringify({ ...saved.selection, recommendationPreferences: saved.recommendationPreferences }),
          retry: 1,
          retryOnRateLimit: true
        });
        return [saved.id, { status: "ready" as const, result }] as const;
      } catch (error: unknown) {
        return [saved.id, { status: "error" as const, message: error instanceof Error ? error.message : "현재 카탈로그 기준 재검사에 실패했습니다." }] as const;
      }
    })).then((entries) => {
      if (!cancelled) setLiveChecks(Object.fromEntries(entries) as Record<string, SavedBuildLiveCheck>);
    });
    return () => {
      cancelled = true;
    };
  }, [comparisonKey, reloadToken]);

  const rows: Array<{ label: string; values: string[] }> = [
    { label: "저장 시점 전체 금액", values: builds.map((saved) => savedPriceText(saved, "totalPriceWon")) },
    { label: "저장 시점 핵심 부품 금액", values: builds.map((saved) => savedPriceText(saved, "coreTotalPriceWon")) },
    { label: "저장 시점 주변 부품 금액", values: builds.map((saved) => savedPriceText(saved, "accessoryTotalPriceWon")) },
    { label: "저장 당시 검사 상태", values: builds.map((saved) => saved.checkSnapshot ? savedCheckStatusText(saved.checkSnapshot.status) : saved.id === "current-draft" ? "저장 전 구성" : "검사 기록 없음") },
    { label: "저장 당시 위험 카운트", values: builds.map((saved) => saved.checkSnapshot ? savedCheckRiskText(saved.checkSnapshot) : "기록 없음") },
    { label: "저장 당시 상대 분석", values: builds.map((saved) => saved.checkSnapshot ? savedCheckAnalysisText(saved.checkSnapshot) : "기록 없음") },
    { label: "저장 당시 검사 기준", values: builds.map((saved) => saved.checkSnapshot ? savedCheckReferenceText(saved.checkSnapshot) : "기록 없음") },
    { label: "추천 기준", values: builds.map(savedPreferenceText) },
    ...PART_CATEGORIES.map((category) => ({ label: CATEGORY_LABELS[category], values: builds.map((saved) => savedCoreLineText(saved, category)) })),
    { label: "주변 부품", values: builds.map(savedAccessoryLineText) }
  ];

  function liveStatusFor(check: SavedBuildLiveCheck | undefined) {
    if (!check || check.status === "loading") return "현재 카탈로그 재검사 중...";
    if (check.status === "error") return "재검사 실패 · " + check.message;
    return check.result.status === "compatible" ? "호환 가능" : check.result.status === "needs_review" ? "확인 필요" : "호환 불가";
  }

  function liveRiskFor(check: SavedBuildLiveCheck | undefined) {
    if (!check || check.status === "loading") return "계산 중...";
    if (check.status === "error") return "확인 불가";
    return check.result.blockerCount + " 차단 · " + check.result.warningCount + " 주의 · " + check.result.unknownCount + " 확인 필요";
  }

  function liveAnalysisFor(check: SavedBuildLiveCheck | undefined) {
    if (!check || check.status === "loading") return "계산 중...";
    if (check.status === "error") return "확인 불가";
    const analysis = check.result.analysis;
    return analysis.overallScore === undefined ? analysis.scoreLabel : analysis.overallScore + "점 · " + analysis.scoreLabel;
  }

  function livePriceFor(check: SavedBuildLiveCheck | undefined) {
    if (!check || check.status === "loading") return "계산 중...";
    if (check.status === "error") return "확인 불가";
    return check.result.priceComplete ? formatWon(check.result.totalPriceWon) : "가격 확인 필요";
  }

  const liveRows: Array<{ label: string; values: string[] }> = [
    { label: "현재 호환 상태", values: builds.map((saved) => liveStatusFor(liveChecks[saved.id])) },
    { label: "현재 위험 카운트", values: builds.map((saved) => liveRiskFor(liveChecks[saved.id])) },
    { label: "현재 상대 분석", values: builds.map((saved) => liveAnalysisFor(liveChecks[saved.id])) },
    { label: "현재 총액", values: builds.map((saved) => livePriceFor(liveChecks[saved.id])) },
    { label: "현재 검사 버전", values: builds.map((saved) => {
      const check = liveChecks[saved.id];
      if (!check || check.status === "loading") return "확인 중...";
      if (check.status === "error") return "확인 불가";
      return check.result.engineVersion + " · " + new Date(check.result.checkedAt).toLocaleString("ko-KR");
    }) },
    { label: "스냅샷 대비 변화", values: builds.map((saved) => savedCheckDriftText(saved, liveChecks[saved.id])) }
  ];

  const allComparisonRows = [...rows, ...liveRows];
  const changedRowCount = allComparisonRows.filter((row) => savedBuildComparisonRowDiffFor(row.values).changed).length;
  const changedCellCount = allComparisonRows.reduce((count, row) => count + savedBuildComparisonRowDiffFor(row.values).changedIndexes.length, 0);
  const visibleSnapshotRows = showDifferencesOnly ? rows.filter((row) => savedBuildComparisonRowDiffFor(row.values).changed) : rows;
  const visibleLiveRows = showDifferencesOnly ? liveRows.filter((row) => savedBuildComparisonRowDiffFor(row.values).changed) : liveRows;

  const isReloading = builds.some((saved) => liveChecks[saved.id]?.status === "loading");

  const comparisonExportInput = { buildNames: builds.map((saved) => saved.name), snapshotRows: rows, currentRows: liveRows };

  async function copyComparison() {
    try {
      const { savedBuildComparisonTextFor } = await import("../shared/saved-build-comparison-export");
      await navigator.clipboard.writeText(savedBuildComparisonTextFor(comparisonExportInput));
      setExportMessage("저장 견적 비교표를 클립보드에 복사했습니다.");
    } catch {
      setExportMessage("저장 견적 비교표 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }

  async function downloadComparison(format: "csv" | "json") {
    const { savedBuildComparisonCsvFor, savedBuildComparisonJsonFor } = await import("../shared/saved-build-comparison-export");
    const content = format === "csv" ? savedBuildComparisonCsvFor(comparisonExportInput) : savedBuildComparisonJsonFor(comparisonExportInput);
    const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-build-comparison-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    setExportMessage(`저장 견적 비교표 ${format.toUpperCase()}를 저장했습니다.`);
  }

  function renderRow(row: { label: string; values: string[] }, section: "snapshot" | "live") {
    const diff = savedBuildComparisonRowDiffFor(row.values);
    return <tr className={diff.changed ? "has-diff" : undefined} key={`${section}-${row.label}`}><th scope="row">{row.label}</th>{row.values.map((value, index) => <td className={diff.changedIndexes.includes(index) ? "changed" : undefined} data-comparison-diff={diff.changedIndexes.includes(index) ? "changed" : "same-as-baseline"} key={row.label + "-" + builds[index].id}>{value}</td>)}</tr>;
  }

  const includesCurrentDraft = builds.some((saved) => saved.id === "current-draft");
  const baselineName = builds[0]?.name ?? "첫 번째 견적";
  return <section className="history-comparison" aria-label="견적 검사 기록 비교"><div className="history-comparison-heading"><div><p className="eyebrow">BUILD COMPARISON</p><h2>{includesCurrentDraft ? "견적 검사 기록 비교" : "저장 견적 비교"}</h2><p>저장 당시 검사 스냅샷과 현재 카탈로그 기준의 호환·성능·금액을 함께 비교합니다.</p></div><div className="history-comparison-heading-actions"><span>{builds.length}개 선택</span><button className="text-button history-comparison-export-button" type="button" onClick={() => void copyComparison()}><FiCopy /> 비교 복사</button><button className="text-button history-comparison-export-button" type="button" onClick={() => void downloadComparison("csv")}><FiDownload /> CSV 저장</button><button className="text-button history-comparison-export-button" type="button" onClick={() => void downloadComparison("json")}><FiDownload /> JSON 저장</button><button className="button button-light" type="button" onClick={() => setReloadToken((current) => current + 1)} disabled={isReloading}><FiRefreshCw /> {isReloading ? "재검사 중..." : "현재 기준 다시 검사"}</button></div></div>{exportMessage && <p className="history-comparison-export-message" role="status">{exportMessage}</p>}<Suspense fallback={<div className="history-comparison-decision" role="status"><p className="history-comparison-decision-note">결정 요약을 불러오는 중...</p></div>}><LazySavedBuildComparisonDecisionSummary builds={builds} liveChecks={liveChecks} formatWon={formatWon} onOpenBuild={onOpenBuild} openingBuildId={openingBuildId} /></Suspense><div className="history-comparison-diff-toolbar"><div className="history-comparison-diff-summary"><FiLayers /><div><strong>비교 기준 · {baselineName}</strong><small>기준 견적과 다른 값 {changedCellCount}개 셀 · {changedRowCount}개 항목</small></div></div><div className="history-comparison-diff-controls" role="group" aria-label="비교표 표시 방식"><button className={!showDifferencesOnly ? "selected" : ""} type="button" aria-pressed={!showDifferencesOnly} onClick={() => setShowDifferencesOnly(false)}>전체 {allComparisonRows.length}</button><button className={showDifferencesOnly ? "selected" : ""} type="button" aria-pressed={showDifferencesOnly} onClick={() => setShowDifferencesOnly(true)} disabled={changedRowCount === 0}>차이만 {changedRowCount}</button></div></div>{showDifferencesOnly && <p className="history-comparison-diff-status" role="status"><FiInfo /> 첫 번째 견적과 값이 다른 항목만 표시하고 있습니다. 비교표의 기준 열은 강조하지 않습니다.</p>}<div className="history-comparison-table-wrap"><table><caption>{showDifferencesOnly ? "첫 번째 견적과 다른 항목만 표시한 비교 표" : "저장 당시 검사 스냅샷과 현재 카탈로그 재검사 결과 비교 표"}</caption><thead><tr><th scope="col">비교 항목</th>{builds.map((saved, index) => <th scope="col" key={saved.id}><span className="history-comparison-column-name">{saved.name}</span>{index === 0 && <small className="history-comparison-column-baseline">비교 기준</small>}</th>)}</tr></thead><tbody>{visibleSnapshotRows.length > 0 ? visibleSnapshotRows.map((row) => renderRow(row, "snapshot")) : <tr><td className="history-comparison-empty" colSpan={builds.length + 1}>기준 견적과 다른 저장 시점 항목이 없습니다.</td></tr>}</tbody><tbody className="history-comparison-live-body"><tr><th colSpan={builds.length + 1}>CURRENT CATALOG CHECK · 현재 카탈로그 재검사</th></tr>{visibleLiveRows.length > 0 ? visibleLiveRows.map((row) => renderRow(row, "live")) : <tr><td className="history-comparison-empty" colSpan={builds.length + 1}>기준 견적과 다른 현재 재검사 항목이 없습니다.</td></tr>}</tbody></table></div><p className="history-comparison-note"><FiInfo /> 저장 순간 서버가 만든 요약 스냅샷과 현재 카탈로그 재검사를 분리해서 보여줍니다. 재검사는 읽기 전용이며 저장된 견적·현재 편집기·공유 데이터는 변경하지 않습니다. 두 번째 열 이후 기준과 다른 값만 셀 단위로 강조하며, export에는 전체 항목을 포함합니다.</p></section>;
}
function repairPlanKey(plan: RecommendationPlan) {
  return plan.changes.map((change) => `${change.category}:${change.kind}:${change.toPart.id}:${change.toQuantity ?? ""}`).sort().join("|");
}

function RepairPlanPanel({ plans, build, currentResult, partMap, onApply, onSavePlan, onFocusFinding }: { plans: RecommendationPlan[]; build: BuildSelection; currentResult: CompatibilityResult; partMap: ReadonlyMap<string, Part>; onApply: (plan: RecommendationPlan) => void; onSavePlan: (build: BuildSelection, preferences: RecommendationPreferences, label: string) => void; onFocusFinding?: (ruleId: string) => void }) {
  const [comparisonPlan, setComparisonPlan] = useState<RecommendationPlan | null>(null);
  const [comparisonState, setComparisonState] = useState<RepairPlanComparisonViewState | null>(null);
  const requestSequenceRef = useRef(0);
  useEffect(() => { setComparisonPlan(null); setComparisonState(null); }, [currentResult.checkedAt]);
  async function comparePlan(plan: RecommendationPlan) {
    const initialNextBuild = repairPlanBuildFor(build, plan);
    const requestSequence = ++requestSequenceRef.current;
    setComparisonPlan(plan);
    setComparisonState({ status: "loading", nextBuild: initialNextBuild, currentResult });
    try {
      const latestCurrent = await api<CompatibilityResult>("/api/compatibility/check", {
        method: "POST",
        body: JSON.stringify({ ...build, recommendationPreferences: currentResult.recommendationPreferences }),
        retry: 2,
        retryOnRateLimit: true
      });
      const latestPlan = latestCurrent.repairPlans?.find((candidate) => repairPlanKey(candidate) === repairPlanKey(plan))
        ?? latestCurrent.repairPlans?.[0]
        ?? plan;
      const nextBuild = repairPlanBuildFor(build, latestPlan);
      const checked = await api<CompatibilityResult>("/api/compatibility/check", {
        method: "POST",
        body: JSON.stringify({ ...nextBuild, recommendationPreferences: latestCurrent.recommendationPreferences }),
        retry: 2,
        retryOnRateLimit: true
      });
      if (requestSequenceRef.current === requestSequence) {
        setComparisonPlan(latestPlan);
        setComparisonState({ status: "ready", nextBuild, currentResult: latestCurrent, result: checked });
      }
    } catch (error: unknown) {
      if (requestSequenceRef.current === requestSequence) setComparisonState({ status: "error", nextBuild: initialNextBuild, currentResult, message: error instanceof Error ? error.message : "수리 플랜 비교에 실패했습니다." });
    }
  }
  function focusPlan(index: number) {
    document.getElementById(`repair-plan-card-${index}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function focusRemainingFinding(ruleId: string) {
    if (onFocusFinding) {
      onFocusFinding(ruleId);
      return;
    }
    document.getElementById(`finding-${ruleId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function remainingFindingChip(plan: RecommendationPlan, title: string, index: number) {
    const ruleId = plan.remainingFindingRuleIds?.[index];
    return ruleId ? <button key={title} className="repair-plan-remaining-button" type="button" aria-label={`남은 문제 상세: ${title}`} onClick={() => focusRemainingFinding(ruleId)}>{title}</button> : <em key={title}>{title}</em>;
  }
  const hasFullyCompatiblePlan = plans.some((plan) => plan.remainingBlockers === 0 && plan.remainingWarnings === 0 && plan.remainingUnknown === 0);
  const unresolvedUnknownTitles = currentResult.findings.filter((finding) => finding.severity === "unknown").map((finding) => finding.title).slice(0, 2);
  const fullPlanNote = unresolvedUnknownTitles.length > 0
    ? `확인 필요 데이터(${unresolvedUnknownTitles.join(" · ")})가 남아 완전 호환으로 판단할 수 없어요. 해당 부품의 실제 정보를 확인한 뒤 다시 검사해 주세요.`
    : "지금 부품 범위에서 모든 차단 오류·주의·확인 필요 항목을 한 번에 없애는 플랜을 찾지 못했어요. 각 플랜의 잔여 문제를 확인해 개별 조정해 주세요.";
  const comparisonReady = comparisonPlan && comparisonState;
  return <section className="repair-plan-panel" data-testid="repair-plan-panel" tabIndex={-1}><div className="repair-plan-heading"><div><p className="eyebrow">AUTO REPAIR PLANS</p><h2>한 번에 해결하는 추천 플랜</h2><p>호환 오류를 가장 많이 줄이면서 성능과 가격 변화를 함께 비교합니다.</p></div><span className="repair-plan-heading-icon"><FiZap /></span></div>{!hasFullyCompatiblePlan && <div className="repair-plan-goal-note" role="status"><FiInfo /><div><strong>완전 호환 플랜을 자동으로 정하지 않았어요.</strong><p>{fullPlanNote}</p></div></div>}<Suspense fallback={<div className="repair-plan-summary loading" data-testid="repair-plan-summary-loading">플랜 요약을 불러오는 중...</div>}><LazyRepairPlanSummaryTable plans={plans} build={build} onFocusPlan={focusPlan} /></Suspense><div className="repair-plan-grid">{plans.map((plan, index) => { const performanceRetention = repairPlanPerformanceRetentionFor(build, plan); return <article id={"repair-plan-card-" + index} className={index === 0 ? "repair-plan-card featured" : "repair-plan-card"} key={`${plan.label}-${plan.changes.map((change) => change.toPart.id).join("-")}`}><div className="repair-plan-top"><span className="repair-plan-label">{index === 0 ? `추천 1순위 · ${plan.label}` : plan.label}</span><span className="repair-plan-similarity">{plan.similarityLabel} {plan.similarityScore}점 · 스펙 유사도{plan.similarityEvidence ? ` · ${similarityEvidenceText(plan.similarityEvidence)}` : ""}</span></div><h3>{plan.title}</h3><p className="repair-plan-reason">{plan.reason}</p><p className="repair-plan-profile"><FiActivity /> {plan.profileSummary}</p><p className={`repair-plan-performance-retention ${performanceRetention.status}`}><FiActivity /> {performanceRetention.summary}</p><div className="repair-plan-resolved"><span>해결 범위</span><div>{plan.resolvedFindingTitles.slice(0, 4).map((title) => <em key={title}>{title}</em>)}{plan.resolvedFindingTitles.length > 4 && <em>외 {plan.resolvedFindingTitles.length - 4}개</em>}</div></div>{plan.remainingFindingTitles && plan.remainingFindingTitles.length > 0 && <div className="repair-plan-remaining"><span>적용 후 남는 문제</span><div>{plan.remainingFindingTitles.slice(0, 3).map((title, index) => remainingFindingChip(plan, title, index))}{plan.remainingFindingTitles.length > 3 && <em>{"외 " + (plan.remainingFindingTitles.length - 3) + "개"}</em>}</div></div>}<div className="repair-plan-stats"><span><strong>{plan.resolvedBlockers}</strong> 차단 오류 해결</span><span><strong>{plan.remainingBlockers}</strong>개 남음</span><span><strong>{plan.remainingWarnings}</strong>개 주의 남음</span><span><strong>{plan.remainingUnknown}</strong>개 확인 필요</span><span><strong>{formatPriceDelta(plan.priceDeltaWon)}</strong> 가격 변화</span>{plan.budgetWon !== undefined && <span><strong>{!plan.priceComplete ? "확인 필요" : plan.withinBudget ? "예산 내" : `${formatPriceDelta(plan.budgetDeltaWon)} 초과`}</strong> 목표 예산</span>}</div><div className="repair-plan-changes">{plan.changes.map((change) => <div className="repair-plan-change" key={`${change.category}-${change.kind}-${change.toPart.id}-${change.toQuantity ?? ""}`}><span className="repair-plan-change-icon"><CategoryIcon category={change.category} /></span><div><small>{change.fromPartName ?? `${CATEGORY_LABELS[change.category]} 미선택`}</small><strong>{change.kind === "change_quantity" ? `수량 ${change.fromQuantity ?? "?"}개 → ${change.toQuantity ?? "?"}개` : `→ ${change.toPart.name}`}</strong>{change.toPart.listingType && change.toPart.listingType !== "retail" && <small>{LISTING_TYPE_LABELS[change.toPart.listingType]}</small>}<small>{change.performanceSummary}</small>{change.similarityEvidence && <small>{similarityEvidenceText(change.similarityEvidence)}</small>}{change.recommendationTrust && <small>추천 점수 {recommendationTrustText(change.recommendationTrust)} · {recommendationTrustDetail(change.recommendationTrust)}</small>}{change.valueScore !== undefined && change.valueLabel && <small>{change.valueLabel} {valueScoreText(change.valueScore)}</small>}</div><em>{formatPriceDelta(change.priceDeltaWon)}</em></div>)}</div><div className="repair-plan-footer"><span>적용 후 {plan.priceComplete ? formatWon(plan.afterTotalPriceWon) : "가격 일부 확인 필요"}</span><div className="repair-plan-footer-actions"><button className="button button-small button-light" type="button" onClick={() => void comparePlan(plan)} disabled={comparisonState?.status === "loading"}><FiActivity /> {comparisonPlan === plan ? "비교 중" : "현재와 비교"}</button><button className="button button-small button-fix" type="button" onClick={() => onApply(plan)}>이 플랜 적용 <FiExternalLink /></button></div></div></article>; })}</div>{comparisonReady && <Suspense fallback={<div className="repair-plan-comparison loading" aria-label="수리 플랜 전체 비교" data-testid="repair-plan-comparison" role="status"><div className="repair-plan-comparison-heading"><div><p className="eyebrow">PLAN COMPARISON</p><h2>비교 화면을 불러오는 중...</h2><p>수리 플랜 적용 후 전체 견적을 준비합니다.</p></div><FiLoader className="spin" /></div></div>}><LazyRepairPlanComparisonPanel plan={comparisonPlan} state={comparisonState} currentBuild={build} currentResult={comparisonState.status === "ready" ? comparisonState.currentResult : currentResult} partMap={partMap} onApply={() => onApply(comparisonPlan)} onSavePlan={onSavePlan} onRetry={() => void comparePlan(comparisonPlan)} onClose={() => { requestSequenceRef.current += 1; setComparisonPlan(null); setComparisonState(null); }} /></Suspense>}</section>;
}

function SavedBuildMonitorCardState({ item, loading }: { item: SavedBuildMonitorItem | undefined; loading: boolean }) {
  if (!item) {
    return loading ? <div className="history-health-card-state loading" role="status"><FiLoader className="spin" /><span>현재 카탈로그 기준 점검 중...</span></div> : null;
  }
  if (item.status !== "ready") {
    return <div className="history-health-card-state failed" role="alert" data-testid="saved-build-health-failed"><FiXCircle /><div><strong>현재 상태 확인 실패</strong><p>{item.message}</p></div></div>;
  }
  const assessment = savedBuildMonitorAssessmentFor(item.snapshot, item.transition);
  const HealthIcon = assessment.level === "critical" || assessment.level === "review"
    ? FiAlertTriangle
    : assessment.level === "stable" || assessment.level === "improved"
      ? FiCheckCircle
      : FiActivity;
  return <div className={`history-health-card-state ${assessment.level}`} data-testid={`saved-build-health-${assessment.level}`}>
    <HealthIcon />
    <div>
      <div className="history-health-card-heading"><strong>{assessment.label}</strong><span>{savedCheckStatusText(item.snapshot.status)}</span></div>
      <p>{assessment.summary}</p>
      <small>현재 점검 {new Date(item.snapshot.checkedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })} · {item.snapshot.priceComplete ? formatWon(item.snapshot.totalPriceWon) : "가격 확인 필요"}</small>
    </div>
  </div>;
}

type SavedBuildServerMonitorViewState =
  | { status: "loading" }
  | { status: "ready"; value: SavedBuildMonitorSubscriptionResponse }
  | { status: "error"; message: string };

type SavedBuildPriorityActionViewState =
  | { status: "loading" }
  | { status: "ready"; value: SavedBuildPriorityAction }
  | { status: "error"; message: string };

function serverMonitorIntervalText(minutes: SavedBuildServerMonitorInterval) {
  return minutes === 60 ? "1시간" : minutes === 360 ? "6시간" : "24시간";
}

function serverMonitorAlertPolicyText(policy: SavedBuildServerMonitorAlertPolicy) {
  return policy === "critical" ? "위험 악화만" : policy === "risk" ? "위험 변화" : "모든 변화";
}

function SavedBuildServerMonitorPanel({ builds, states, busyBuildId, onConfigure, onRun, onReload }: { builds: SavedBuild[]; states: Record<string, SavedBuildServerMonitorViewState>; busyBuildId: string | null; onConfigure: (build: SavedBuild, enabled: boolean, intervalMinutes: SavedBuildServerMonitorInterval, alertPolicy: SavedBuildServerMonitorAlertPolicy) => void; onRun: (build: SavedBuild) => void; onReload: () => void }) {
  return <section className="history-server-monitor" aria-label="소유자 서버 백그라운드 점검" data-testid="saved-build-server-monitor">
    <div className="history-server-monitor-heading"><div><p className="eyebrow">SERVER BACKGROUND MONITOR</p><h2><FiServer /> 서버 백그라운드 점검</h2><p>이 브라우저가 owner token을 가진 견적만 서버에서 1·6·24시간 주기로 점검합니다.</p></div><button className="button button-light" type="button" onClick={onReload} disabled={busyBuildId !== null}><FiRefreshCw /> 상태 새로고침</button></div>
    <div className="history-server-monitor-list">{builds.map((build) => {
      const state = states[build.id];
      if (!state || state.status === "loading") return <article className="history-server-monitor-row loading" key={build.id}><FiLoader className="spin" /><div><strong>{build.name}</strong><span>서버 모니터링 상태를 불러오는 중...</span></div></article>;
      if (state.status === "error") return <article className="history-server-monitor-row error" key={build.id}><FiXCircle /><div><strong>{build.name}</strong><span>{state.message}</span></div><button className="text-button" type="button" onClick={onReload}>다시 시도</button></article>;
      const subscription = state.value.subscription;
      const busy = busyBuildId === build.id;
      return <article className={subscription.enabled ? "history-server-monitor-row enabled" : "history-server-monitor-row"} key={build.id}>
        <span className="history-server-monitor-icon"><FiServer /></span>
        <div className="history-server-monitor-copy"><div><strong>{build.name}</strong><em>{subscription.enabled ? "서버 점검 사용 중" : "서버 점검 꺼짐"}</em></div><small>{subscription.lastCheckedAt ? `마지막 성공 ${new Date(subscription.lastCheckedAt).toLocaleString("ko-KR")}` : "아직 서버 점검 기록 없음"}{subscription.nextCheckAt && subscription.enabled ? ` · 다음 예정 ${new Date(subscription.nextCheckAt).toLocaleString("ko-KR")}` : ""} · 서버 알림 {subscription.alerts.filter((alert) => !alert.dismissedAt).length}건 · 정책 {serverMonitorAlertPolicyText(subscription.alertPolicy)}</small>{subscription.lastError && <p><FiAlertTriangle /> 최근 오류 · {subscription.lastError}</p>}</div>
        <div className="history-server-monitor-controls"><label><input type="checkbox" aria-label={`${build.name} 서버 백그라운드 점검`} checked={subscription.enabled} onChange={(event) => onConfigure(build, event.target.checked, subscription.intervalMinutes, subscription.alertPolicy)} disabled={busy} /><span>{subscription.enabled ? "사용 중" : "사용"}</span></label><select aria-label={`${build.name} 서버 점검 주기`} value={subscription.intervalMinutes} onChange={(event) => onConfigure(build, subscription.enabled, Number(event.target.value) as SavedBuildServerMonitorInterval, subscription.alertPolicy)} disabled={busy}>{SAVED_BUILD_SERVER_MONITOR_INTERVALS.map((minutes) => <option value={minutes} key={minutes}>{serverMonitorIntervalText(minutes)}</option>)}</select><select aria-label={`${build.name} 서버 알림 정책`} value={subscription.alertPolicy} onChange={(event) => onConfigure(build, subscription.enabled, subscription.intervalMinutes, event.target.value as SavedBuildServerMonitorAlertPolicy)} disabled={busy}>{SAVED_BUILD_SERVER_MONITOR_ALERT_POLICIES.map((policy) => <option value={policy} key={policy}>{serverMonitorAlertPolicyText(policy)}</option>)}</select><button className="button button-small button-light" type="button" onClick={() => onRun(build)} disabled={busy}>{busy ? <><FiLoader className="spin" /> 처리 중...</> : <><FiRefreshCw /> 지금 점검</>}</button></div>
      </article>;
    })}</div>
    <p className="history-server-monitor-note"><FiShield /> 구독 설정·서버 알림은 owner token으로 보호되며 공개 공유 응답에는 포함되지 않습니다. 현재 scheduler는 단일 서버 프로세스 기준입니다.</p>
  </section>;
}

function priorityRiskDeltaText(row: SavedBuildPriorityRow) {
  if (row.riskDelta === undefined) return "이전 점검 없음";
  if (row.riskDelta === 0) return "직전 점검과 동일";
  return `직전 점검 대비 위험 ${row.riskDelta > 0 ? "+" : ""}${row.riskDelta}`;
}

function SavedBuildRiskTrend({ row }: { row: SavedBuildPriorityRow }) {
  if (row.trend.length === 0) return <div className="saved-build-priority-trend empty"><span>검사 추이 없음</span></div>;
  const maxRisk = Math.max(1, ...row.trend.map((point) => point.riskScore));
  const points = row.trend.map((point, index) => {
    const x = row.trend.length === 1 ? 60 : (index / (row.trend.length - 1)) * 120;
    const y = 24 - (point.riskScore / maxRisk) * 19;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const latest = row.trend.at(-1)!;
  return <div className="saved-build-priority-trend"><svg viewBox="0 0 120 28" role="img" aria-label={`${row.name} 최근 위험 점수 추이`} preserveAspectRatio="none"><polyline points={points} fill="none" vectorEffect="non-scaling-stroke" /></svg><small>{row.trend.length}회 기록 · 위험 점수 {latest.riskScore}</small></div>;
}

function SavedBuildPriorityPanel({ rows, actionStates, openingBuildId, onAnalyzeAction, onOpen }: { rows: SavedBuildPriorityRow[]; actionStates: Record<string, SavedBuildPriorityActionViewState>; openingBuildId: string | null; onAnalyzeAction: (id: string) => void; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<SavedBuildPriorityFilter>("all");
  const attentionCount = rows.filter((row) => savedBuildPriorityMatches(row, "attention")).length;
  const changedCount = rows.filter((row) => savedBuildPriorityMatches(row, "changed")).length;
  const stableCount = rows.filter((row) => savedBuildPriorityMatches(row, "stable")).length;
  const filterOptions: Array<{ id: SavedBuildPriorityFilter; label: string; count: number }> = [
    { id: "all", label: "전체", count: rows.length },
    { id: "attention", label: "우선 확인", count: attentionCount },
    { id: "changed", label: "변화 감지", count: changedCount },
    { id: "stable", label: "안정·첫 기준", count: stableCount }
  ];
  const visibleRows = rows.filter((row) => savedBuildPriorityMatches(row, filter));
  return <section className="saved-build-priority-panel" aria-label="저장 견적 우선 확인 보드" data-testid="saved-build-priority-board">
    <div className="saved-build-priority-heading"><div><p className="eyebrow">PRIORITY QUEUE</p><h2>먼저 확인할 견적</h2><p>저장 시점·현재 점검·검사 이력을 합쳐 위험이 큰 견적과 변화가 생긴 견적을 먼저 보여줍니다.</p></div><span className="saved-build-priority-icon"><FiActivity /></span></div>
    <div className="saved-build-priority-stats"><div className="attention"><span>우선 확인</span><strong>{attentionCount}</strong><small>차단·검토·점검 실패</small></div><div className="changed"><span>변화 감지</span><strong>{changedCount}</strong><small>직전 기록과 달라짐</small></div><div className="stable"><span>안정·첫 기준</span><strong>{stableCount}</strong><small>추이 기준 포함</small></div></div>
    <div className="saved-build-priority-filters" role="group" aria-label="견적 우선순위 필터">{filterOptions.map((option) => <button className={filter === option.id ? "selected" : ""} type="button" aria-pressed={filter === option.id} data-testid={`saved-build-priority-filter-${option.id}`} onClick={() => setFilter(option.id)} key={option.id}>{option.label}<span>{option.count}</span></button>)}</div>
    {visibleRows.length === 0 ? <div className="saved-build-priority-empty"><FiInfo /><span>선택한 조건에 맞는 저장 견적이 없습니다.</span></div> : <div className="saved-build-priority-list">{visibleRows.map((row, index) => {
      const currentStatus = row.status ? savedCheckStatusText(row.status) : "점검 결과 없음";
      const riskText = row.snapshot ? savedCheckRiskText(row.snapshot) : "현재 위험 카운트 확인 필요";
      const riskTone = row.level === "critical" || row.level === "failed" ? "attention" : row.level === "review" ? "review" : row.level === "changed" ? "changed" : "stable";
      const actionState = actionStates[row.id];
      const actionValue = actionState?.status === "ready" ? actionState.value : undefined;
      return <article className={`saved-build-priority-row ${riskTone}`} data-testid={`saved-build-priority-row-${row.id}`} key={row.id}>
        <span className="saved-build-priority-rank">{index + 1}</span>
        <div className="saved-build-priority-main"><div className="saved-build-priority-title"><strong>{row.name}</strong><span className={`saved-build-priority-label ${riskTone}`}>{row.label}</span></div><small>{currentStatus} · {riskText}{row.lastCheckedAt ? ` · ${new Date(row.lastCheckedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}` : ""}</small>{row.primaryFinding && <p><FiAlertTriangle /> {row.primaryFinding.title}</p>}{row.priceDeltaWon !== undefined && <em>직전 기록 대비 가격 {formatPriceDelta(row.priceDeltaWon)}</em>}{row.level === "failed" && <p><FiXCircle /> 현재 점검을 완료하지 못했습니다. 다시 확인해 주세요.</p>}</div>
        <SavedBuildRiskTrend row={row} />
        <div className="saved-build-priority-action"><span>{priorityRiskDeltaText(row)}</span><button className="text-button" type="button" onClick={() => onAnalyzeAction(row.id)} disabled={actionState?.status === "loading"}>{actionState?.status === "loading" ? <><FiLoader className="spin" /> 할 일 계산 중...</> : actionState?.status === "ready" ? <><FiRefreshCw /> 다시 계산</> : <><FiZap /> 다음 할 일 분석</>}</button><button className="text-button" type="button" onClick={() => onOpen(row.id)} disabled={openingBuildId !== null}>{openingBuildId === row.id ? <><FiLoader className="spin" /> 불러오는 중...</> : <><FiExternalLink /> 견적 보기</>}</button></div>
        {actionState?.status === "error" && <div className="saved-build-priority-action-detail error" role="alert"><FiXCircle /><span>{actionState.message}</span><button className="text-button" type="button" onClick={() => onAnalyzeAction(row.id)}>다시 시도</button></div>}
        {actionValue && <div className="saved-build-priority-action-detail" data-testid={`saved-build-priority-action-${row.id}`}><div className="saved-build-priority-action-heading"><strong>{actionValue.title}</strong><span>{actionValue.kind === "repair_plan" ? "전체 수리 플랜" : actionValue.kind === "analysis" ? "분석 제안" : "추가 부품 없음"}</span></div>{actionValue.nextAction && <p className="saved-build-priority-action-next"><FiZap /> <strong>먼저 확인</strong> {actionValue.nextAction}</p>}{actionValue.changes.length > 0 && <div className="saved-build-priority-action-changes">{actionValue.changes.slice(0, 3).map((change) => <span key={`${change.category}-${change.toPartName}-${change.toQuantity ?? ""}`}><b>{CATEGORY_LABELS[change.category]}</b>{change.kind === "change_quantity" ? `${change.fromQuantity ?? "?"}개 → ${change.toQuantity ?? "?"}개` : `${change.fromPartName ?? "현재 선택"} → ${change.toPartName}`}{change.priceDeltaWon !== undefined ? ` · ${formatPriceDelta(change.priceDeltaWon)}` : ""}</span>)}</div>}<div className="saved-build-priority-action-stats"><span><strong>{actionValue.resolvedBlockers}</strong>개 차단 감소</span><span><strong>{actionValue.remainingBlockers}</strong>개 차단 남음</span><span><strong>{actionValue.remainingWarnings}</strong>개 주의 남음</span><span><strong>{actionValue.remainingUnknown}</strong>개 확인 필요</span>{actionValue.priceDeltaWon !== undefined && <span><strong>{formatPriceDelta(actionValue.priceDeltaWon)}</strong> 총액 변화</span>}{actionValue.afterTotalPriceWon !== undefined && <span><strong>{actionValue.priceComplete ? formatWon(actionValue.afterTotalPriceWon) : "가격 확인 필요"}</strong> 적용 후 금액</span>}</div><p className="saved-build-priority-action-summary">{actionValue.summary}</p></div>}
      </article>;
    })}</div>}
    <p className="saved-build-priority-note"><FiInfo /> 위험 점수는 차단 100점·주의 10점·확인 필요 1점으로 계산한 정렬용 신호입니다. 실제 구매 가능 여부를 대신하지 않아요. 각 행의 견적 보기에서 전체 내용과 대체 부품을 확인해 주세요.</p>
  </section>;
}

function SavedBuildVersionPanel({ groups, openingBuildId, onOpen }: { groups: SavedBuildVersionGroup[]; openingBuildId: string | null; onOpen: (build: SavedBuild, focus?: "purchase-list") => void }) {
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.versionGroupId ?? "");
  useEffect(() => {
    if (!groups.some((group) => group.versionGroupId === selectedGroupId)) setSelectedGroupId(groups[0]?.versionGroupId ?? "");
  }, [groups, selectedGroupId]);
  const selectedGroup = groups.find((group) => group.versionGroupId === selectedGroupId) ?? groups[0];
  if (!selectedGroup) return null;
  const versionsForComparison = selectedGroup.builds.slice(-2).map((build) => ({ ...build, name: `${savedBuildVersionLabelFor(build)} · ${build.name}` }));
  return <section className="saved-build-version-panel" aria-label="저장 견적 버전 비교" data-testid="saved-build-version-panel">
    <div className="saved-build-version-heading"><div><p className="eyebrow">BUILD VERSIONS</p><h2>견적 버전 비교</h2><p>수리 플랜이나 수정 후 새로 저장한 견적을 원본과 분리해, 최신 두 버전을 같은 기준으로 비교합니다.</p></div><span className="saved-build-version-icon"><FiLayers /></span></div>
    {groups.length > 1 && <div className="saved-build-version-groups" role="group" aria-label="견적 버전 그룹">{groups.map((group) => <button className={group.versionGroupId === selectedGroup.versionGroupId ? "selected" : ""} type="button" aria-pressed={group.versionGroupId === selectedGroup.versionGroupId} data-testid={`saved-build-version-group-${group.versionGroupId}`} onClick={() => setSelectedGroupId(group.versionGroupId)} key={group.versionGroupId}>{group.builds[0]?.name ?? "견적"}<span>{group.builds.length}개 버전</span></button>)}</div>}
    <div className="saved-build-version-list">{selectedGroup.builds.map((build) => <article className="saved-build-version-row" key={build.id}><span className="saved-build-version-number">{savedBuildVersionLabelFor(build)}</span><div><strong>{build.name}</strong><small>{build.checkSnapshot ? `${savedCheckStatusText(build.checkSnapshot.status)} · ${savedCheckRiskText(build.checkSnapshot)}` : "검사 기록 없음"} · {new Date(build.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</small></div><button className="text-button" type="button" onClick={() => onOpen(build)} disabled={openingBuildId !== null}>{openingBuildId === build.id ? <><FiLoader className="spin" /> 불러오는 중...</> : <><FiExternalLink /> 버전 열기</>}</button></article>)}</div>
    {versionsForComparison.length === 2 && <BuildComparisonPanel builds={versionsForComparison} onOpenBuild={onOpen} openingBuildId={openingBuildId} />}
    <p className="saved-build-version-note"><FiInfo /> 버전 비교는 저장된 스냅샷과 현재 카탈로그 재검사를 함께 사용합니다. 비교만으로 기존 버전이나 공유 링크를 변경하지 않습니다.</p>
  </section>;
}

function HistoryView({ builds, currentBuild, currentPreferences, partMap, accessoryMap, monitorAlerts, onMonitorAlertsChange, browserNotificationPermission, browserNotificationEnabled, onRequestBrowserNotifications, onBrowserNotificationsEnabledChange, onBack, onOpen, onRefreshSavedBuilds, onStart, onRevoke, onEditMetadata, revokingShare, onRecordCheck, recordingCheckId, openingBuildId, onShareVersionComparison, onToast }: { builds: SavedBuild[]; currentBuild: BuildSelection; currentPreferences: RecommendationPreferences; partMap: ReadonlyMap<string, Part>; accessoryMap: ReadonlyMap<string, AccessoryItem>; monitorAlerts: SavedBuildMonitorAlert[]; onMonitorAlertsChange: (alerts: SavedBuildMonitorAlert[]) => void; browserNotificationPermission: BrowserNotificationPermission; browserNotificationEnabled: boolean; onRequestBrowserNotifications: () => Promise<void>; onBrowserNotificationsEnabledChange: (enabled: boolean) => void; onBack: () => void; onOpen: (saved: SavedBuild, focus?: SavedBuildOpenFocus) => void; onRefreshSavedBuilds: () => Promise<boolean>; onStart: () => void; onRevoke: (id: string) => void; onEditMetadata: (saved: SavedBuild) => void; revokingShare: boolean; onRecordCheck: (id: string) => void; recordingCheckId: string | null; openingBuildId: string | null; onShareVersionComparison: (before: SavedBuild, after: SavedBuild) => void | Promise<void>; onToast: (message: string) => void }) {
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [historyDetailsOpen, setHistoryDetailsOpen] = useState(false);
  const [purchaseProgressFilter, setPurchaseProgressFilter] = useState<SavedBuildPurchaseProgressFilter>("all");
  const [purchaseProgressRefreshing, setPurchaseProgressRefreshing] = useState(false);
  const [monitorItems, setMonitorItems] = useState<Record<string, SavedBuildMonitorItem>>({});
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [monitorCheckedAt, setMonitorCheckedAt] = useState<string | null>(null);
  const [monitorRefreshNonce, setMonitorRefreshNonce] = useState(0);
  const [monitorAutoRefreshEnabled, setMonitorAutoRefreshEnabled] = useState(() => typeof window !== "undefined" && savedBuildMonitorAutoRefreshEnabledFromStorage(window.localStorage.getItem(SAVED_BUILD_MONITOR_AUTO_REFRESH_STORAGE_KEY)));
  const [monitorAutoRefreshMinutes, setMonitorAutoRefreshMinutes] = useState<5 | 15 | 30>(() => typeof window === "undefined" ? 15 : savedBuildMonitorAutoRefreshMinutesFromStorage(window.localStorage.getItem(SAVED_BUILD_MONITOR_INTERVAL_STORAGE_KEY)));
  const [serverMonitorStates, setServerMonitorStates] = useState<Record<string, SavedBuildServerMonitorViewState>>({});
  const [serverMonitorBusyBuildId, setServerMonitorBusyBuildId] = useState<string | null>(null);
  const [serverMonitorReloadNonce, setServerMonitorReloadNonce] = useState(0);
  const [priorityActionStates, setPriorityActionStates] = useState<Record<string, SavedBuildPriorityActionViewState>>({});
  const [metadataHistoryStates, setMetadataHistoryStates] = useState<Record<string, SavedBuildMetadataHistoryViewState>>({});
  const monitorAlertsRef = useRef(monitorAlerts);
  const historyMountedRef = useRef(false);
  const priorityActionJobsRef = useRef(new Map<string, number>());
  const priorityActionEpochRef = useRef(0);
  const monitorAlertMutationVersionRef = useRef(0);
  const monitorAlertContextKeyRef = useRef("");
  const serverMonitorMutationVersionRef = useRef(0);
  const serverMonitorContextKeyRef = useRef("");
  const metadataHistoryRequestVersionRef = useRef<Record<string, number>>({});
  const metadataHistoryBuildKeyRef = useRef(new Map<string, string>());
  const priorityActionContextKey = JSON.stringify(builds.map((saved) => ({ id: saved.id, updatedAt: saved.updatedAt, input: buildCompatibilityInputFingerprint(saved.selection, saved.recommendationPreferences ?? currentPreferences) })));
  const priorityActionContextKeyRef = useRef(priorityActionContextKey);
  const committedPriorityActionContextKeyRef = useRef(priorityActionContextKey);
  priorityActionContextKeyRef.current = priorityActionContextKey;
  const currentDraft = currentDraftComparisonFor(currentBuild, currentPreferences, partMap, accessoryMap);
  const availableBuildIds = useMemo(() => new Set(builds.map((saved) => saved.id)), [builds]);
  const ownedBuilds = useMemo(() => builds.filter((saved) => Boolean(readSavedBuildOwnerToken(saved.id))), [builds]);
  const ownedBuildKey = ownedBuilds.map((saved) => saved.id).join(",");
  const serverMonitorContextKey = ownedBuilds.map((saved) => `${saved.id}:${saved.updatedAt}`).join("|");
  serverMonitorContextKeyRef.current = serverMonitorContextKey;
  monitorAlertContextKeyRef.current = serverMonitorContextKey;
  const serverMonitorPolicyKey = ownedBuilds.map((saved) => {
    const state = serverMonitorStates[saved.id];
    return `${saved.id}:${state?.status === "ready" ? state.value.subscription.alertPolicy : "unknown"}`;
  }).join("|");
  const hasCurrentSelection = PART_CATEGORIES.some((category) => selectionList(currentBuild, category).length > 0) || accessorySelections(currentBuild).length > 0;
  const compareBuilds = [currentDraft, ...builds].filter((build) => compareIds.includes(build.id));
  const comparedSavedBuilds = compareBuilds.filter((build) => build.id !== currentDraft.id);
  const monitorRequest = builds.map((saved) => ({ id: saved.id, name: saved.name, baseline: saved.checkSnapshot?.checkedAt ?? saved.checkHistory?.at(-1)?.checkedAt ?? "" }));
  const monitorKey = JSON.stringify(monitorRequest);
  const priorityRows = useMemo(() => savedBuildPriorityRowsFor(builds.map((build) => {
    const serverState = serverMonitorStates[build.id];
    return {
      id: build.id,
      name: build.name,
      checkSnapshot: build.checkSnapshot,
      checkHistory: build.checkHistory,
      current: monitorItems[build.id],
      serverSnapshot: serverState?.status === "ready" ? serverState.value.subscription.lastSnapshot : undefined
    };
  })), [builds, monitorItems, serverMonitorStates]);
  const versionGroups = useMemo(() => savedBuildVersionGroupsFor(builds).filter((group) => group.builds.length > 1), [builds]);
  const purchaseProgressRows = useMemo(() => builds.map((build) => ({ build, summary: savedBuildPurchaseProgressSummaryFor(build.purchaseProgress) })), [builds]);
  const purchaseProgressFilterOptions: Array<{ id: SavedBuildPurchaseProgressFilter; label: string; count: number }> = [
    { id: "all", label: "전체", count: builds.length },
    { id: "recorded", label: "서버 기록 있음", count: purchaseProgressRows.filter(({ summary }) => summary.status !== "unrecorded").length },
    { id: "in-progress", label: "구매 진행 중", count: purchaseProgressRows.filter(({ summary }) => summary.status === "in-progress").length },
    { id: "completed", label: "모두 구매 완료", count: purchaseProgressRows.filter(({ summary }) => summary.status === "completed").length },
    { id: "unrecorded", label: "진행률 기록 없음", count: purchaseProgressRows.filter(({ summary }) => summary.status === "unrecorded").length }
  ];
  const visiblePurchaseBuilds = purchaseProgressRows.filter(({ summary }) => savedBuildPurchaseProgressMatchesFilter(summary, purchaseProgressFilter));

  useEffect(() => {
    monitorAlertsRef.current = monitorAlerts;
  }, [monitorAlerts]);

  useEffect(() => {
    historyMountedRef.current = true;
    return () => {
      historyMountedRef.current = false;
      monitorAlertMutationVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (ownedBuilds.length === 0) {
      setServerMonitorStates({});
      return;
    }
    let cancelled = false;
    setServerMonitorStates(Object.fromEntries(ownedBuilds.map((build) => [build.id, { status: "loading" as const }])));
    void Promise.all(ownedBuilds.map(async (build) => {
      const token = readSavedBuildOwnerToken(build.id);
      if (!token) return [build.id, { status: "error" as const, message: "이 브라우저의 owner token을 찾을 수 없습니다." }] as const;
      try {
        const value = await api<SavedBuildMonitorSubscriptionResponse>(`/api/builds/${encodeURIComponent(build.id)}/monitor`, { headers: { "X-Share-Owner-Token": token }, retry: 1 });
        return [build.id, { status: "ready" as const, value }] as const;
      } catch (error: unknown) {
        return [build.id, { status: "error" as const, message: error instanceof Error ? error.message : "서버 모니터링 상태를 불러오지 못했습니다." }] as const;
      }
    })).then((entries) => {
      if (cancelled) return;
      const nextStates = Object.fromEntries(entries) as Record<string, SavedBuildServerMonitorViewState>;
      setServerMonitorStates(nextStates);
      const serverAlerts = entries.flatMap(([, state]) => state.status === "ready" ? state.value.subscription.alerts : []);
      const nextAlerts = mergeSavedBuildMonitorAlerts(monitorAlertsRef.current.filter((alert) => {
        const state = nextStates[alert.buildId];
        return state?.status !== "ready" || savedBuildMonitorAlertAllowed(state.value.subscription.alertPolicy, alert.kind);
      }), serverAlerts);
      if (JSON.stringify(nextAlerts) !== JSON.stringify(monitorAlertsRef.current)) {
        monitorAlertsRef.current = nextAlerts;
        onMonitorAlertsChange(nextAlerts);
      }
    });
    return () => { cancelled = true; };
  }, [ownedBuildKey, serverMonitorReloadNonce]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SAVED_BUILD_MONITOR_AUTO_REFRESH_STORAGE_KEY, String(monitorAutoRefreshEnabled));
      window.localStorage.setItem(SAVED_BUILD_MONITOR_INTERVAL_STORAGE_KEY, String(monitorAutoRefreshMinutes));
    } catch {
      // Monitoring still works manually when browser settings cannot be persisted.
    }
  }, [monitorAutoRefreshEnabled, monitorAutoRefreshMinutes]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === SAVED_BUILD_MONITOR_AUTO_REFRESH_STORAGE_KEY) {
        const enabled = savedBuildMonitorAutoRefreshEnabledFromStorage(event.newValue);
        setMonitorAutoRefreshEnabled(enabled);
        if (enabled) setMonitorRefreshNonce((current) => current + 1);
      } else if (event.key === SAVED_BUILD_MONITOR_INTERVAL_STORAGE_KEY) {
        setMonitorAutoRefreshMinutes(savedBuildMonitorAutoRefreshMinutesFromStorage(event.newValue));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!monitorAutoRefreshEnabled || builds.length === 0) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setMonitorRefreshNonce((current) => current + 1);
    }, monitorAutoRefreshMinutes * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [monitorAutoRefreshEnabled, monitorAutoRefreshMinutes, builds.length]);

  useEffect(() => {
    if (monitorRequest.length === 0) {
      setMonitorItems({});
      setMonitorError(null);
      setMonitorCheckedAt(null);
      return;
    }
    let cancelled = false;
    setMonitorLoading(true);
    setMonitorError(null);
    void api<SavedBuildMonitorResponse>("/api/builds/check-preview", {
      method: "POST",
      body: JSON.stringify({ ids: monitorRequest.map((item) => item.id) }),
      retry: 1,
      retryOnRateLimit: true
    }).then((payload) => {
      if (cancelled) return;
      setMonitorItems(Object.fromEntries(payload.items.map((item) => [item.id, item])));
      setMonitorCheckedAt(payload.checkedAt);
      const requestedById = new Map(monitorRequest.map((item) => [item.id, item]));
      const incomingAlerts = payload.items.map((item) => {
        const build = requestedById.get(item.id);
        const state = serverMonitorStates[item.id];
        const alert = build ? savedBuildMonitorAlertFor(build, item, payload.checkedAt) : undefined;
        return alert && (state?.status !== "ready" || savedBuildMonitorAlertAllowed(state.value.subscription.alertPolicy, alert.kind)) ? alert : undefined;
      }).filter((alert): alert is SavedBuildMonitorAlert => alert !== undefined);
      const previousAlerts = monitorAlertsRef.current;
      const previousIds = new Set(previousAlerts.map((alert) => alert.id));
      const addedCount = incomingAlerts.filter((alert) => !previousIds.has(alert.id)).length;
      const nextAlerts = mergeSavedBuildMonitorAlerts(previousAlerts, incomingAlerts);
      if (JSON.stringify(nextAlerts) !== JSON.stringify(previousAlerts)) {
        monitorAlertsRef.current = nextAlerts;
        onMonitorAlertsChange(nextAlerts);
      }
      if (addedCount > 0) onToast(`저장 견적 변화 알림 ${addedCount}건을 추가했습니다.`);
    }).catch((error: unknown) => {
      if (!cancelled) setMonitorError(error instanceof Error ? error.message : "저장 견적 전체 점검에 실패했습니다.");
    }).finally(() => {
      if (!cancelled) setMonitorLoading(false);
    });
    return () => { cancelled = true; };
  }, [monitorKey, monitorRefreshNonce, serverMonitorPolicyKey]);

  useEffect(() => {
    priorityActionEpochRef.current += 1;
    setPriorityActionStates({});
  }, [monitorCheckedAt]);

  useEffect(() => {
    if (committedPriorityActionContextKeyRef.current === priorityActionContextKey) return;
    committedPriorityActionContextKeyRef.current = priorityActionContextKey;
    priorityActionEpochRef.current += 1;
    priorityActionJobsRef.current.clear();
    setPriorityActionStates({});
  }, [priorityActionContextKey]);

  useEffect(() => {
    serverMonitorMutationVersionRef.current += 1;
    setServerMonitorBusyBuildId(null);
  }, [serverMonitorContextKey]);

  useEffect(() => {
    monitorAlertMutationVersionRef.current += 1;
  }, [serverMonitorContextKey]);

  useEffect(() => {
    const nextBuildKeys = new Map(builds.map((build) => [build.id, build.updatedAt]));
    const previousBuildKeys = metadataHistoryBuildKeyRef.current;
    const changedIds = new Set<string>();
    previousBuildKeys.forEach((updatedAt, id) => {
      if (nextBuildKeys.get(id) !== updatedAt) {
        metadataHistoryRequestVersionRef.current[id] = (metadataHistoryRequestVersionRef.current[id] ?? 0) + 1;
        changedIds.add(id);
      }
    });
    metadataHistoryBuildKeyRef.current = nextBuildKeys;
    if (changedIds.size > 0) {
      setMetadataHistoryStates((current) => {
        const next = { ...current };
        changedIds.forEach((id) => delete next[id]);
        return next;
      });
    }
  }, [builds]);

  const readyMonitorItems = builds
    .map((saved) => monitorItems[saved.id])
    .filter((item): item is Extract<SavedBuildMonitorItem, { status: "ready" }> => item?.status === "ready");
  const monitorAssessments = readyMonitorItems.map((item) => savedBuildMonitorAssessmentFor(item.snapshot, item.transition));
  const criticalCount = monitorAssessments.filter((assessment) => assessment.level === "critical").length;
  const reviewCount = monitorAssessments.filter((assessment) => assessment.level === "review").length;
  const changedCount = monitorAssessments.filter((assessment) => ["improved", "changed", "baseline"].includes(assessment.level)).length;
  const stableCount = monitorAssessments.filter((assessment) => assessment.level === "stable").length;
  const failedCount = builds.filter((saved) => monitorItems[saved.id] && monitorItems[saved.id].status !== "ready").length;
  const visibleMonitorAlerts = monitorAlerts.filter((alert) => !alert.dismissedAt && (availableBuildIds.has(alert.buildId) || !alert.readAt || alert.kind === "failed"));

  function replaceMonitorAlerts(next: SavedBuildMonitorAlert[]) {
    monitorAlertsRef.current = next;
    onMonitorAlertsChange(next);
  }

  function applyServerMonitorResponse(value: SavedBuildMonitorSubscriptionResponse) {
    setServerMonitorStates((current) => ({ ...current, [value.buildId]: { status: "ready", value } }));
    const nextAlerts = mergeSavedBuildMonitorAlerts(
      monitorAlertsRef.current.filter((alert) => alert.buildId !== value.buildId || savedBuildMonitorAlertAllowed(value.subscription.alertPolicy, alert.kind)),
      value.subscription.alerts
    );
    if (JSON.stringify(nextAlerts) !== JSON.stringify(monitorAlertsRef.current)) replaceMonitorAlerts(nextAlerts);
  }

  async function configureServerMonitor(build: SavedBuild, enabled: boolean, intervalMinutes: SavedBuildServerMonitorInterval, alertPolicy: SavedBuildServerMonitorAlertPolicy) {
    if (serverMonitorBusyBuildId) return;
    const token = readSavedBuildOwnerToken(build.id);
    if (!token) {
      onToast("서버 모니터링 설정에 필요한 owner token이 없습니다.");
      return;
    }
    const currentState = serverMonitorStates[build.id];
    const wasEnabled = currentState?.status === "ready" && currentState.value.subscription.enabled;
    const mutationVersion = ++serverMonitorMutationVersionRef.current;
    const contextKey = serverMonitorContextKey;
    const isCurrent = () => serverMonitorMutationVersionRef.current === mutationVersion && serverMonitorContextKeyRef.current === contextKey;
    setServerMonitorBusyBuildId(build.id);
    try {
      const configured = await api<SavedBuildMonitorSubscriptionResponse>(`/api/builds/${encodeURIComponent(build.id)}/monitor`, { method: "PUT", headers: { "X-Share-Owner-Token": token }, body: JSON.stringify({ enabled, intervalMinutes, alertPolicy }), retry: 0 });
      if (!isCurrent()) return;
      applyServerMonitorResponse(configured);
      if (enabled && !wasEnabled) {
        const checked = await api<SavedBuildMonitorSubscriptionResponse>(`/api/builds/${encodeURIComponent(build.id)}/monitor/run`, { method: "POST", headers: { "X-Share-Owner-Token": token }, retry: 0 });
        if (!isCurrent()) return;
        applyServerMonitorResponse(checked);
      }
      if (isCurrent()) onToast(enabled ? `${build.name} 서버 점검을 ${serverMonitorIntervalText(intervalMinutes)} · ${serverMonitorAlertPolicyText(alertPolicy)}로 설정했습니다.` : `${build.name} 서버 백그라운드 점검을 껐습니다.`);
    } catch (error: unknown) {
      if (isCurrent()) onToast(error instanceof Error ? error.message : "서버 모니터링 설정에 실패했습니다.");
    } finally {
      if (isCurrent()) setServerMonitorBusyBuildId(null);
    }
  }

  async function runServerMonitorNow(build: SavedBuild) {
    if (serverMonitorBusyBuildId) return;
    const token = readSavedBuildOwnerToken(build.id);
    if (!token) {
      onToast("서버 점검에 필요한 owner token이 없습니다.");
      return;
    }
    const mutationVersion = ++serverMonitorMutationVersionRef.current;
    const contextKey = serverMonitorContextKey;
    const isCurrent = () => serverMonitorMutationVersionRef.current === mutationVersion && serverMonitorContextKeyRef.current === contextKey;
    setServerMonitorBusyBuildId(build.id);
    try {
      const checked = await api<SavedBuildMonitorSubscriptionResponse>(`/api/builds/${encodeURIComponent(build.id)}/monitor/run`, { method: "POST", headers: { "X-Share-Owner-Token": token }, retry: 0 });
      if (!isCurrent()) return;
      applyServerMonitorResponse(checked);
      if (isCurrent()) onToast(`${build.name} 서버 점검을 완료했습니다.`);
    } catch (error: unknown) {
      if (isCurrent()) onToast(error instanceof Error ? error.message : "서버 점검에 실패했습니다.");
    } finally {
      if (isCurrent()) setServerMonitorBusyBuildId(null);
    }
  }

  async function syncServerMonitorAlertState(action: "read" | "dismiss", alerts: SavedBuildMonitorAlert[]) {
    const mutationVersion = ++monitorAlertMutationVersionRef.current;
    const contextKey = serverMonitorContextKey;
    const isCurrent = () => historyMountedRef.current && monitorAlertMutationVersionRef.current === mutationVersion && monitorAlertContextKeyRef.current === contextKey;
    const grouped = new Map<string, string[]>();
    for (const alert of alerts) grouped.set(alert.buildId, [...(grouped.get(alert.buildId) ?? []), alert.id]);
    const results = await Promise.all([...grouped.entries()].map(async ([buildId, alertIds]) => {
      const token = readSavedBuildOwnerToken(buildId);
      if (!token) return undefined;
      try {
        const value = await api<SavedBuildMonitorSubscriptionResponse & { updated: number }>(`/api/builds/${encodeURIComponent(buildId)}/monitor/alerts/${action}`, { method: "POST", headers: { "X-Share-Owner-Token": token }, body: JSON.stringify({ alertIds }), retry: 0 });
        return value;
      } catch {
        return null;
      }
    }));
    if (!isCurrent()) return;
    results.filter((value): value is SavedBuildMonitorSubscriptionResponse & { updated: number } => Boolean(value)).forEach(applyServerMonitorResponse);
    if (results.some((value) => value === null) && isCurrent()) onToast("일부 서버 모니터 알림 상태를 동기화하지 못했습니다. 로컬 알림 상태는 유지됩니다.");
  }

  function markAllMonitorAlertsRead() {
    const targets = visibleMonitorAlerts.filter((alert) => !alert.readAt);
    replaceMonitorAlerts(markSavedBuildMonitorAlertsRead(monitorAlertsRef.current, new Date().toISOString()));
    if (targets.length > 0) void syncServerMonitorAlertState("read", targets);
  }

  function dismissMonitorAlerts(ids: string[]) {
    const targets = monitorAlertsRef.current.filter((alert) => ids.includes(alert.id));
    replaceMonitorAlerts(dismissSavedBuildMonitorAlerts(monitorAlertsRef.current, ids, new Date().toISOString()));
    if (targets.length > 0) void syncServerMonitorAlertState("dismiss", targets);
  }

  function openMonitorAlertBuild(alert: SavedBuildMonitorAlert, findingRuleId?: string) {
    const saved = builds.find((build) => build.id === alert.buildId);
    if (!saved) {
      onToast("이 알림의 저장 견적이 만료되었거나 현재 브라우저 기록에 없습니다.");
      return;
    }
    const readAt = new Date().toISOString();
    replaceMonitorAlerts(monitorAlertsRef.current.map((item) => item.id === alert.id && !item.readAt ? { ...item, readAt } : item));
    if (!alert.readAt) void syncServerMonitorAlertState("read", [alert]);
    onOpen(saved, findingRuleId ? { type: "finding", ruleId: findingRuleId } : undefined);
  }

  function toggleCompare(id: string) {
    setCompareIds((current) => current.includes(id)
      ? current.filter((itemId) => itemId !== id)
      : current.length >= 3 ? current : [...current, id]);
  }

  async function refreshPurchaseProgress() {
    if (purchaseProgressRefreshing) return;
    setPurchaseProgressRefreshing(true);
    try {
      const applied = await onRefreshSavedBuilds();
      if (applied) onToast("저장 견적의 구매 진행률을 다시 확인했습니다.");
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "저장 견적 구매 진행률을 다시 확인하지 못했습니다.");
    } finally {
      setPurchaseProgressRefreshing(false);
    }
  }

  async function toggleMetadataHistory(saved: SavedBuild) {
    const currentState = metadataHistoryStates[saved.id];
    if (currentState?.status === "ready") {
      metadataHistoryRequestVersionRef.current[saved.id] = (metadataHistoryRequestVersionRef.current[saved.id] ?? 0) + 1;
      setMetadataHistoryStates((current) => {
        const next = { ...current };
        delete next[saved.id];
        return next;
      });
      return;
    }
    if (currentState?.status === "loading") return;
    const token = readSavedBuildOwnerToken(saved.id);
    if (!token) {
      onToast("이 견적의 설명 변경 이력을 조회할 수 있는 소유 토큰이 이 브라우저에 없습니다.");
      return;
    }
    const requestVersion = (metadataHistoryRequestVersionRef.current[saved.id] ?? 0) + 1;
    metadataHistoryRequestVersionRef.current[saved.id] = requestVersion;
    const isCurrent = () => metadataHistoryRequestVersionRef.current[saved.id] === requestVersion;
    setMetadataHistoryStates((current) => ({ ...current, [saved.id]: { status: "loading" } }));
    try {
      const value = await api<SavedBuildMetadataHistoryResponse>(`/api/builds/${encodeURIComponent(saved.id)}/metadata-history`, { headers: { "X-Share-Owner-Token": token }, retry: 1 });
      if (!isCurrent()) return;
      setMetadataHistoryStates((current) => ({ ...current, [saved.id]: { status: "ready", value } }));
    } catch (error: unknown) {
      if (!isCurrent()) return;
      setMetadataHistoryStates((current) => ({ ...current, [saved.id]: { status: "error", message: error instanceof Error ? error.message : "설명 변경 이력을 불러오지 못했습니다." } }));
    }
  }

  async function analyzePriorityAction(id: string) {
    if (priorityActionJobsRef.current.has(id)) return;
    const saved = builds.find((build) => build.id === id);
    if (!saved) {
      setPriorityActionStates((current) => ({ ...current, [id]: { status: "error", message: "저장 견적을 찾을 수 없습니다." } }));
      return;
    }
    const requestEpoch = priorityActionEpochRef.current;
    const requestContextKey = priorityActionContextKey;
    priorityActionJobsRef.current.set(id, requestEpoch);
    const isCurrent = () => historyMountedRef.current && priorityActionEpochRef.current === requestEpoch && priorityActionContextKeyRef.current === requestContextKey;
    setPriorityActionStates((current) => ({ ...current, [id]: { status: "loading" } }));
    try {
      const checked = await api<CompatibilityResult>("/api/compatibility/check", {
        method: "POST",
        body: JSON.stringify({ ...saved.selection, recommendationPreferences: saved.recommendationPreferences ?? currentPreferences }),
        retry: 2,
        retryOnRateLimit: true
      });
      if (isCurrent()) setPriorityActionStates((current) => ({ ...current, [id]: { status: "ready", value: savedBuildNextActionFor(checked) } }));
    } catch (error: unknown) {
      if (isCurrent()) setPriorityActionStates((current) => ({ ...current, [id]: { status: "error", message: error instanceof Error ? error.message : "다음 할 일을 계산하지 못했습니다." } }));
    } finally {
      if (priorityActionJobsRef.current.get(id) === requestEpoch) priorityActionJobsRef.current.delete(id);
    }
  }

  return <div className={historyDetailsOpen ? "history-page history-details-open" : "history-page"}>
    <div className="workspace-heading"><div><button className="back-link" onClick={onBack}><FiArrowLeft /> 홈으로</button><p className="eyebrow">SAVED BUILDS</p><h1>저장된 견적</h1><p>저장된 견적을 열고, 필요한 것만 확인해 보세요.</p></div><div className="history-heading-actions"><button className="button button-light history-details-toggle" type="button" aria-expanded={historyDetailsOpen} onClick={() => setHistoryDetailsOpen((current) => !current)}><FiMoreHorizontal /> {historyDetailsOpen ? "핵심 정보만 보기" : "점검·비교 상세"}</button><button className="button button-primary" onClick={onStart}><FiPlus /> 새 견적 만들기</button></div></div>
    {builds.length > 0 && <section className="history-health-panel" aria-label="저장 견적 전체 건강 점검" data-testid="saved-build-health-dashboard">
      <div className="history-health-heading">
        <div><p className="eyebrow">BUILD HEALTH MONITOR</p><h2>전체 견적 건강 점검</h2><p>최대 20개 저장 견적을 같은 현재 카탈로그 기준으로 읽기 전용 검사해, 먼저 볼 견적을 분류합니다.</p></div>
        <button className="button button-light" type="button" onClick={() => setMonitorRefreshNonce((current) => current + 1)} disabled={monitorLoading}><FiRefreshCw className={monitorLoading ? "spin" : undefined} /> {monitorLoading ? "전체 점검 중..." : "전체 상태 다시 확인"}</button>
      </div>
      {monitorError && <div className="history-health-error" role="alert"><FiXCircle /><span>{monitorError}</span><button className="text-button" type="button" onClick={() => setMonitorRefreshNonce((current) => current + 1)}>다시 시도</button></div>}
      {(readyMonitorItems.length > 0 || failedCount > 0) && <div className="history-health-summary" aria-live="polite">
        <div className="critical"><span>구매 전 수정</span><strong>{criticalCount}</strong></div>
        <div className="review"><span>확인 필요</span><strong>{reviewCount}</strong></div>
        <div className="changed"><span>변화·첫 기준</span><strong>{changedCount}</strong></div>
        <div className="stable"><span>안정</span><strong>{stableCount}</strong></div>
        <div className="failed"><span>확인 실패</span><strong>{failedCount}</strong></div>
      </div>}
      <div className="history-health-monitor-controls">
        <label><input type="checkbox" aria-label="저장 견적 자동 점검" checked={monitorAutoRefreshEnabled} onChange={(event) => { setMonitorAutoRefreshEnabled(event.target.checked); if (event.target.checked) setMonitorRefreshNonce((current) => current + 1); }} /><span>페이지를 열어 둔 동안 자동 점검</span></label>
        {monitorAutoRefreshEnabled && <label className="history-health-monitor-interval"><span>주기</span><select aria-label="저장 견적 자동 점검 주기" value={monitorAutoRefreshMinutes} onChange={(event) => setMonitorAutoRefreshMinutes(Number(event.target.value) as 5 | 15 | 30)}><option value={5}>5분</option><option value={15}>15분</option><option value={30}>30분</option></select></label>}
        <span className="history-health-monitor-status">{monitorAutoRefreshEnabled ? `자동 점검 ${monitorAutoRefreshMinutes}분마다` : "자동 점검 꺼짐"}</span>
      </div>
      <p className="history-health-note"><FiShield /> 이 점검은 저장 데이터와 공유 링크를 변경하지 않습니다. 검사 이력 추가는 이 브라우저가 소유 토큰을 가진 견적에서만 별도로 실행됩니다.{monitorCheckedAt ? ` · 마지막 전체 점검 ${new Date(monitorCheckedAt).toLocaleString("ko-KR")}` : ""}</p>
    </section>}
    {builds.length > 0 && !monitorLoading && <Suspense fallback={<div className="shared-build-state" data-testid="saved-build-priority-loading"><FiLoader className="spin" /><span>저장 견적 우선순위 보드를 불러오는 중...</span></div>}><LazySavedBuildPriorityPanel rows={priorityRows} actionStates={priorityActionStates} openingBuildId={openingBuildId} onAnalyzeAction={(id) => void analyzePriorityAction(id)} onOpen={(id) => { const saved = builds.find((build) => build.id === id); if (saved) onOpen(saved); }} /></Suspense>}
    {versionGroups.length > 0 && <Suspense fallback={<div className="shared-build-state" data-testid="saved-build-version-loading"><FiLoader className="spin" /><span>견적 버전 비교를 불러오는 중...</span></div>}><LazySavedBuildVersionPanel groups={versionGroups} openingBuildId={openingBuildId} onOpen={onOpen} onShareVersionComparison={onShareVersionComparison} BuildComparisonPanel={BuildComparisonPanel} partMap={partMap} accessoryMap={accessoryMap} fallbackPreferences={currentPreferences} /></Suspense>}
    {ownedBuilds.length > 0 && <SavedBuildServerMonitorPanel builds={ownedBuilds} states={serverMonitorStates} busyBuildId={serverMonitorBusyBuildId} onConfigure={(build, enabled, intervalMinutes, alertPolicy) => void configureServerMonitor(build, enabled, intervalMinutes, alertPolicy)} onRun={(build) => void runServerMonitorNow(build)} onReload={() => setServerMonitorReloadNonce((current) => current + 1)} />}
    {ownedBuilds.length === 0 && builds.length > 0 && <section className="history-server-monitor locked" aria-label="서버 백그라운드 점검 사용 안내" data-testid="saved-build-server-monitor-locked"><span className="history-server-monitor-icon"><FiShield /></span><div><p className="eyebrow">SERVER BACKGROUND MONITOR</p><h2>새로 저장한 내 견적부터 서버 점검을 사용할 수 있습니다.</h2><p>이 브라우저에 owner token이 없는 기존·공유 견적은 읽기 전용으로 유지됩니다. 현재 견적을 새 링크로 저장하면 1·6·24시간 구독 설정이 열립니다.</p></div></section>}
    {(builds.length > 0 || visibleMonitorAlerts.length > 0) && <Suspense fallback={<div className="history-monitor-alerts loading" aria-label="저장 견적 알림함 로딩" role="status"><FiLoader className="spin" /> 저장 견적 알림함을 불러오는 중...</div>}><LazySavedBuildMonitorAlertsPanel alerts={visibleMonitorAlerts} availableBuildIds={availableBuildIds} openingBuildId={openingBuildId} browserNotificationPermission={browserNotificationPermission} browserNotificationEnabled={browserNotificationEnabled} onRequestBrowserNotifications={() => void onRequestBrowserNotifications()} onBrowserNotificationsEnabledChange={onBrowserNotificationsEnabledChange} onReadAll={markAllMonitorAlertsRead} onDismissAll={() => dismissMonitorAlerts(visibleMonitorAlerts.map((alert) => alert.id))} onDismiss={(id) => dismissMonitorAlerts([id])} onOpenBuild={openMonitorAlertBuild} /></Suspense>}
    {hasCurrentSelection && <section className="history-current-compare" aria-label="현재 편집기 견적 비교"><div><p className="eyebrow">CURRENT DRAFT</p><h2>현재 편집기 견적</h2><p>아직 저장하지 않은 현재 구성을 저장 견적과 최대 2개까지 비교할 수 있습니다.</p><small>{currentDraft.summary?.priceComplete && isKnownPrice(currentDraft.summary.totalPriceWon) ? `현재 합계 ${formatWon(currentDraft.summary.totalPriceWon)}` : "현재 금액 확인 필요"} · 추천 기준 {savedPreferenceText(currentDraft)}</small></div><button className={compareIds.includes(currentDraft.id) ? "history-compare-toggle selected" : "history-compare-toggle"} type="button" aria-pressed={compareIds.includes(currentDraft.id)} disabled={!compareIds.includes(currentDraft.id) && compareIds.length >= 3} onClick={() => toggleCompare(currentDraft.id)}>{compareIds.includes(currentDraft.id) ? "현재 견적 비교 중" : "현재 견적 비교"}</button></section>}
    {compareIds.length > 0 && <p className="history-compare-selection-note" role="status">{compareIds.length} / 3개 견적을 비교 대상으로 선택했습니다. 현재 편집기 견적과 저장 견적을 합쳐 최대 3개까지 비교할 수 있습니다.</p>}
    {builds.length > 0 && <section className="history-purchase-progress-filter" aria-label="저장 견적 구매 진행률 필터" data-testid="saved-build-purchase-progress-filter"><div><p className="eyebrow">BUYING PROGRESS</p><h2>구매 진행률 보기</h2><p>결과 화면을 열지 않아도 서버에 기록된 구매 상태를 견적별로 확인합니다.</p><button className="text-button history-purchase-progress-filter-refresh" type="button" data-testid="saved-build-purchase-progress-refresh" onClick={() => void refreshPurchaseProgress()} disabled={purchaseProgressRefreshing}>{purchaseProgressRefreshing ? <><FiRefreshCw className="spin" /> 확인 중...</> : <><FiRefreshCw /> 서버 구매 상태 새로고침</>}</button></div><div className="history-purchase-progress-filter-options" role="group" aria-label="구매 진행률 필터">{purchaseProgressFilterOptions.map((option) => <button className={purchaseProgressFilter === option.id ? "selected" : ""} type="button" aria-pressed={purchaseProgressFilter === option.id} data-testid={`saved-build-purchase-progress-filter-${option.id}`} onClick={() => setPurchaseProgressFilter(option.id)} key={option.id}>{option.label}<span>{option.count}</span></button>)}</div></section>}
    <Suspense fallback={null}><LazySavedBuildPurchasePriceHistoryPanel builds={builds} /></Suspense>
    {builds.length === 0 ? <div className="empty-result"><FiSave /><h2>저장된 견적이 없습니다.</h2><p>견적을 검사한 뒤 저장하면 이곳에서 다시 열 수 있습니다.</p><button className="button button-primary" onClick={onStart}>첫 견적 만들기</button></div> : visiblePurchaseBuilds.length === 0 ? <div className="history-purchase-progress-empty" data-testid="saved-build-purchase-progress-empty"><FiInfo /><div><strong>선택한 구매 진행률 견적이 없습니다.</strong><span>다른 필터를 선택하거나 전체 견적을 확인해 주세요.</span></div><button className="text-button" type="button" onClick={() => setPurchaseProgressFilter("all")}>전체 견적 보기</button></div> : <div className="history-grid">{visiblePurchaseBuilds.map(({ build: saved, summary: purchaseProgress }) => {
      const selectedCount = PART_CATEGORIES.filter((category) => selectionList(saved.selection, category).length > 0).length;
      const accessoryCount = accessorySelections(saved.selection).length;
      const preferences = saved.recommendationPreferences;
      const summary = saved.summary;
      const owned = Boolean(readSavedBuildOwnerToken(saved.id));
      const selectedForCompare = compareIds.includes(saved.id);
      const monitorItem = monitorItems[saved.id];
      const monitorAssessment = monitorItem?.status === "ready" ? savedBuildMonitorAssessmentFor(monitorItem.snapshot, monitorItem.transition) : undefined;
      const metadataHistory = metadataHistoryStates[saved.id];
      const purchaseProgressLabel = purchaseProgress.status === "completed" ? "모두 구매 완료" : purchaseProgress.status === "in-progress" ? "구매 진행 중" : "서버 기록 없음";
      return <article className="history-card" key={saved.id}>
        <div className="history-card-top"><span className="history-icon"><FiSave /></span><span className="history-date">{new Date(saved.updatedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</span><button className={selectedForCompare ? "history-compare-toggle selected" : "history-compare-toggle"} type="button" aria-pressed={selectedForCompare} disabled={!selectedForCompare && compareIds.length >= 3} onClick={() => toggleCompare(saved.id)}>{selectedForCompare ? "비교 중" : "비교"}</button></div>
        <h2>{saved.name}</h2>
        {saved.decisionNote && <div className="history-card-decision-note" data-testid="saved-build-decision-note"><FiInfo /><div><span>선택 메모</span><strong>{saved.decisionNote}</strong></div></div>}
        <p>{selectedCount}개 카테고리 선택{accessoryCount > 0 ? ` · 주변 부품 ${accessoryCount}종` : ""}{summary ? ` · ${summary.priceComplete && isKnownPrice(summary.totalPriceWon) ? formatWon(summary.totalPriceWon) : "견적 금액 확인 필요"}` : ""}{preferences ? ` · ${RECOMMENDATION_PROFILE_LABELS[preferences.profile]} · ${LISTING_POLICY_LABELS[preferences.listingPolicy ?? "retail_only"]}` : ""} · 공유 가능한 견적 · {saved.expiresAt ? `만료 ${new Date(saved.expiresAt).toLocaleString("ko-KR")}` : "공유 무기한"}</p>
        <div className="history-preview">{PART_CATEGORIES.filter((category) => selectionList(saved.selection, category).length > 0).slice(0, 5).map((category) => <span key={category}><CategoryIcon category={category} /> {CATEGORY_LABELS[category]}</span>)}{accessoryCount > 0 && <span><FiTool /> 주변 {accessoryCount}종</span>}{summary && <span><FiDatabase /> {summary.priceComplete && isKnownPrice(summary.totalPriceWon) ? formatWon(summary.totalPriceWon) : "금액 확인 필요"}</span>}{selectedCount > 5 && <span>+{selectedCount - 5}</span>}</div>
        <div className={`history-card-purchase-progress ${purchaseProgress.status}`} data-testid={`saved-build-purchase-progress-${saved.id}`}><div className="history-card-purchase-progress-heading"><span>구매 진행률</span><div><strong>{purchaseProgress.status === "unrecorded" ? "기록 없음" : `${purchaseProgress.checked} / ${purchaseProgress.total}개`}</strong><button className="text-button history-card-purchase-progress-open" type="button" data-testid={`saved-build-purchase-list-${saved.id}`} onClick={() => onOpen(saved, "purchase-list")} disabled={openingBuildId !== null}>{openingBuildId === saved.id ? <><FiLoader className="spin" /> 여는 중...</> : <><FiExternalLink /> 구매 목록 보기</>}</button></div></div>{purchaseProgress.status !== "unrecorded" && <div className="history-card-purchase-progress-bar" role="progressbar" aria-label={`${saved.name} 구매 진행률 ${purchaseProgress.percent}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={purchaseProgress.percent}><span style={{ width: `${purchaseProgress.percent}%` }} /></div>}<small>{purchaseProgressLabel}{purchaseProgress.status !== "unrecorded" ? ` · 주문 ${purchaseProgress.stageCounts.ordered} · 수령 ${purchaseProgress.stageCounts.received} · 조립 ${purchaseProgress.stageCounts.installed}` : ""}{purchaseProgress.revision !== undefined ? ` · revision ${purchaseProgress.revision}` : ""}{purchaseProgress.historyCount > 0 ? ` · 이전 이력 ${purchaseProgress.historyCount}개` : ""}{purchaseProgress.updatedAt ? ` · ${new Date(purchaseProgress.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}` : ""}</small></div>
        <SavedBuildMonitorCardState item={monitorItem} loading={monitorLoading} />
        {saved.checkSnapshot && <SavedBuildCheckBadge snapshot={saved.checkSnapshot} />}
        {saved.checkHistory && saved.checkHistory.length > 0 && <SavedBuildCheckTimeline history={saved.checkHistory} partMap={partMap} showDiff={false} />}
        <button className="button button-secondary full-width" onClick={() => onOpen(saved)} disabled={openingBuildId !== null}>{openingBuildId === saved.id ? <><FiLoader className="spin" /> 결과 불러오는 중...</> : <><FiExternalLink /> 결과 다시 보기</>}</button>
        {owned && <div className="history-card-actions"><button className="text-button history-edit-metadata-button" type="button" data-testid={`saved-build-edit-metadata-${saved.id}`} onClick={() => onEditMetadata(saved)} disabled={revokingShare || recordingCheckId !== null || openingBuildId !== null}><FiEdit3 /> 설명 수정</button><button className="text-button history-metadata-history-button" type="button" data-testid={`saved-build-metadata-history-${saved.id}`} onClick={() => void toggleMetadataHistory(saved)} disabled={revokingShare || recordingCheckId !== null || openingBuildId !== null || metadataHistory?.status === "loading"}>{metadataHistory?.status === "loading" ? <><FiLoader className="spin" /> 이력 불러오는 중...</> : metadataHistory?.status === "ready" ? <><FiClock /> 변경 이력 닫기</> : <><FiClock /> 변경 이력 보기</>}</button><button className="text-button history-record-check-button" type="button" onClick={() => onRecordCheck(saved.id)} disabled={recordingCheckId !== null || revokingShare || openingBuildId !== null}>{recordingCheckId === saved.id ? <><FiLoader className="spin" /> 검사 기록 추가 중...</> : <><FiRefreshCw /> {monitorAssessment?.recordRecommended ? "현재 변화 기록 남기기" : "현재 기준 다시 기록"}</>}</button><button className="text-button history-revoke-button" type="button" onClick={() => onRevoke(saved.id)} disabled={revokingShare || recordingCheckId !== null || openingBuildId !== null}>{revokingShare ? <><FiLoader className="spin" /> 취소 중...</> : <><FiTrash2 /> 공유 링크 취소</>}</button></div>}
        {owned && metadataHistory && <SavedBuildMetadataHistoryPanel buildId={saved.id} state={metadataHistory} onRetry={() => void toggleMetadataHistory(saved)} />}
      </article>;
    })}</div>}
    {compareBuilds.length >= 2 && <BuildComparisonPanel builds={compareBuilds} onOpenBuild={onOpen} openingBuildId={openingBuildId} />}
    {comparedSavedBuilds.length >= 2 && <Suspense fallback={<div className="shared-build-state" data-testid="saved-build-purchase-progress-comparison-loading"><FiLoader className="spin" /><span>구매 진행률 비교를 불러오는 중...</span></div>}><LazySavedBuildPurchaseProgressComparison builds={comparedSavedBuilds} /></Suspense>}
    {comparedSavedBuilds.length >= 2 && <Suspense fallback={<div className="shared-build-state" data-testid="saved-build-purchase-price-history-comparison-loading"><FiLoader className="spin" /><span>가격 이력 비교를 불러오는 중...</span></div>}><LazySavedBuildPurchasePriceHistoryComparison builds={comparedSavedBuilds} /></Suspense>}
  </div>;
}

function SavedBuildMetadataHistoryPanel({ buildId, state, onRetry }: { buildId: string; state: SavedBuildMetadataHistoryViewState; onRetry: () => void }) {
  if (state.status === "loading") return <div className="saved-build-metadata-history loading" data-testid={`saved-build-metadata-history-panel-${buildId}`} role="status"><FiLoader className="spin" /><span>이전 설명 변경 이력을 불러오는 중...</span></div>;
  if (state.status === "error") return <div className="saved-build-metadata-history error" data-testid={`saved-build-metadata-history-panel-${buildId}`} role="alert"><FiXCircle /><span>{state.message}</span><button className="text-button" type="button" onClick={onRetry}>다시 시도</button></div>;
  return <section className="saved-build-metadata-history" data-testid={`saved-build-metadata-history-panel-${buildId}`} aria-label="저장 견적 설명 변경 이력"><div className="saved-build-metadata-history-heading"><div><span>OWNER-ONLY CONTEXT HISTORY</span><strong>설명 변경 이력</strong></div><em>{state.value.total}회</em></div>{state.value.items.length === 0 ? <p className="saved-build-metadata-history-empty"><FiInfo /> 아직 이름이나 선택 이유를 수정한 기록이 없습니다.</p> : <div className="saved-build-metadata-history-list">{state.value.items.map((entry) => <article key={`${entry.changedAt}-${entry.nextName}`}><div className="saved-build-metadata-history-meta"><span>{new Date(entry.changedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</span><strong>{entry.changedFields.map((field) => field === "name" ? "이름" : "선택 이유").join(" · ")} 변경</strong></div><div className="saved-build-metadata-history-diff"><div><small>변경 전</small><strong>{entry.previousName}</strong><span>{entry.previousDecisionNote ?? "메모 없음"}</span></div><b aria-hidden="true">→</b><div><small>변경 후</small><strong>{entry.nextName}</strong><span>{entry.nextDecisionNote ?? "메모 없음"}</span></div></div></article>)}</div>}<p className="saved-build-metadata-history-note"><FiShield /> 이 영역은 소유자 인증으로 조회한 이전 설명이며, 공유 응답에는 포함되지 않습니다.</p></section>;
}

function savedCoreLineText(saved: SavedBuild, category: PartCategory) {
  const summaryLines = saved.summary?.coreLines.filter((line) => line.category === category) ?? [];
  if (summaryLines.length > 0) return summaryLines.map((line) => `${line.name}${line.quantity > 1 ? ` ×${line.quantity}` : ""}`).join(", ");
  const selections = selectionList(saved.selection, category);
  return selections.length > 0 ? selections.map((selection) => `${selection.partId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`).join(", ") : "미선택";
}

function savedAccessoryLineText(saved: SavedBuild) {
  const summaryLines = saved.summary?.accessoryLines ?? [];
  if (summaryLines.length > 0) return summaryLines.map((line) => `${line.name}${line.quantity > 1 ? ` ×${line.quantity}` : ""}`).join(", ");
  const selections = accessorySelections(saved.selection);
  return selections.length > 0 ? selections.map((selection) => `${selection.accessoryId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`).join(", ") : "미선택";
}

function savedPreferenceText(saved: SavedBuild) {
  const preferences = saved.recommendationPreferences;
  if (!preferences) return "기본 기준";
  return `${RECOMMENDATION_PROFILE_LABELS[preferences.profile]} · ${RECOMMENDATION_PRIORITY_LABELS[preferences.priority]} · ${LISTING_POLICY_LABELS[preferences.listingPolicy ?? "retail_only"]}`;
}

function savedCheckStatusText(status: NonNullable<SavedBuild["checkSnapshot"]>["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function savedCheckRiskText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  const accessory = snapshot.accessoryCompatibility;
  const base = `${snapshot.blockerCount} 차단 · ${snapshot.warningCount} 주의 · ${snapshot.unknownCount} 확인 필요`;
  const withAccessory = !accessory || (accessory.blockerCount === 0 && accessory.warningCount === 0 && accessory.unknownCount === 0)
    ? base
    : `${base} · 주변 ${accessory.blockerCount} 차단 · ${accessory.warningCount} 주의 · ${accessory.unknownCount} 확인 필요`;
  const resourceState = snapshot.resourceBudget?.state;
  if (resourceState === "danger") return `${withAccessory} · 전력·냉각 기준 미달`;
  if (resourceState === "warning") return `${withAccessory} · 전력·냉각 여유 좁음`;
  if (resourceState === "unknown") return `${withAccessory} · 전력·냉각 확인 필요`;
  return withAccessory;
}

function savedCheckAnalysisText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  return snapshot.analysisScore === undefined ? snapshot.analysisScoreLabel : `${snapshot.analysisScore}점 · ${snapshot.analysisScoreLabel}`;
}

function savedCheckPriceText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  return snapshot.priceComplete && isKnownPrice(snapshot.totalPriceWon) ? formatWon(snapshot.totalPriceWon) : "가격 확인 필요";
}

function savedCheckCatalogRefreshSummary(report: CatalogRefreshReport) {
  const status = report.status === "success" ? "정보 확인 완료" : report.status === "partial" ? "일부 정보 확인" : "정보 확인 실패";
  return `${status} · 성공 ${report.successCount}개 · 실패 ${report.failureCount}개`;
}

function savedCheckCatalogRefreshPriceText(item: CatalogRefreshReport["items"][number]) {
  const beforeKnown = isKnownPrice(item.previousPriceWon);
  const afterKnown = isKnownPrice(item.nextPriceWon);
  if (!beforeKnown && !afterKnown) return "가격 확인 필요";
  if (!beforeKnown) return `확인 필요 → ${formatWon(item.nextPriceWon!)}`;
  if (!afterKnown) return `${formatWon(item.previousPriceWon!)} → 확인 필요`;
  if (item.previousPriceWon === item.nextPriceWon) return `${formatWon(item.nextPriceWon!)} · 변화 없음`;
  const delta = item.nextPriceWon! - item.previousPriceWon!;
  return `${formatWon(item.previousPriceWon!)} → ${formatWon(item.nextPriceWon!)} · ${delta > 0 ? "+" : ""}${formatWon(delta)}`;
}

function SavedBuildCheckRefreshEvidence({ report }: { report: CatalogRefreshReport }) {
  return <details className={`history-check-refresh-report ${report.status}`} data-testid="saved-build-check-refresh-report"><summary><FiRefreshCw /> 정보 다시 확인 내용 · {savedCheckCatalogRefreshSummary(report)}</summary><div className="history-check-refresh-report-body">{report.items.slice(0, 6).map((item) => <article key={`${item.target.kind}-${item.target.id}`}><div><strong>{item.name}</strong><small>{item.target.kind === "part" ? "핵심 부품" : "주변 부품"} · {new Date(item.refreshedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</small></div><div className="history-check-refresh-report-facts"><span><b>가격</b>{savedCheckCatalogRefreshPriceText(item)}</span><span><b>데이터</b>{DATA_QUALITY_LABELS[item.previousDataQuality]} → {DATA_QUALITY_LABELS[item.nextDataQuality]}</span><span><b>누락</b>{item.previousMissingCount}개 → {item.nextMissingCount}개</span></div><small>{item.changedFields.length > 0 ? `변경 영역 · ${item.changedFields.map((field) => catalogChangeFieldLabelFor(field)).join(" · ")}` : "변경된 영역 없음"}</small></article>)}{report.items.length > 6 && <small>그 외 성공 항목 {report.items.length - 6}개</small>}{report.failures.length > 0 && <div className="history-check-refresh-report-failures"><strong>확인 실패</strong>{report.failures.slice(0, 4).map((failure) => <p key={`${failure.target.kind}-${failure.target.id}`}><b>{failure.target.kind === "part" ? "핵심 부품" : "주변 부품"}</b> · {failure.message}</p>)}</div>}<p><FiInfo /> 정보 다시 확인 내용은 이 검사와 같은 견적에 묶여 저장됩니다.</p></div></details>;
}

function SavedBuildCheckRefreshImpactPanel({ report, findingChanges }: { report: CatalogRefreshReport; findingChanges: SavedBuildCheckFindingDiff[] }) {
  const impacts = catalogRefreshFindingImpactsFor(report, findingChanges);
  const linkedCount = impacts.reduce((total, impact) => total + impact.findingChanges.length, 0);
  return <section className={`history-check-refresh-impact ${report.status}`} aria-label="정보 다시 확인과 결과 변화 연결" data-testid="saved-build-check-refresh-impact"><div className="history-check-refresh-impact-heading"><div><p className="eyebrow">REFRESH → RESULT IMPACT</p><strong>정보 다시 확인과 결과 변화 연결</strong><small>다시 확인한 부품과 결과가 바뀐 부품이 겹치는 경우만 연결해요.</small></div><span>{linkedCount}개 연결</span></div>{report.failures.length > 0 && <p className="history-check-refresh-impact-failure"><FiAlertTriangle /> 확인에 실패한 {report.failures.length}개는 결과 변화와 연결할 수 없어요.</p>}<div className="history-check-refresh-impact-list">{impacts.map(({ item, findingChanges: linkedChanges }) => <article className={linkedChanges.length > 0 ? "linked" : "unlinked"} key={`${item.target.kind}-${item.target.id}`}><div className="history-check-refresh-impact-item-heading"><strong>{item.name}</strong><span>{linkedChanges.length > 0 ? `연결 변화 ${linkedChanges.length}개` : "연결된 변화 없음"}</span></div><small>정보 변경 · {item.changedFields.length > 0 ? item.changedFields.map((field) => catalogChangeFieldLabelFor(field)).join(" · ") : "변경된 영역 없음"}</small>{linkedChanges.length > 0 ? <ul>{linkedChanges.slice(0, 4).map((change) => <li key={`${change.key}-${change.change}`}><b>{savedCheckFindingChangeText(change.change)}</b><span>{(change.after ?? change.before)?.title ?? change.key}</span></li>)}</ul> : <p>두 검사 사이에 이 부품과 겹치는 결과 변화가 없어요. 정보 변경이 원인이라고 단정하지 않아요.</p>}</article>)}</div>{impacts.length === 0 && report.failures.length === 0 && <p className="history-check-refresh-impact-empty"><FiInfo /> 확인에 성공한 항목이 없어 결과 변화를 연결할 수 없어요.</p>}<p className="history-check-refresh-impact-note"><FiInfo /> 영향이 있을 만한 연결을 보여주는 참고 정보예요. 정보 변경이 결과 변화의 원인이라고 단정하는 건 아니에요.</p></section>;
}

function savedCheckResourceText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  const resource = snapshot.resourceBudget;
  if (!resource) return "미적용";
  const headroomText = (value: number | undefined) => value === undefined ? "확인 필요" : value >= 0 ? `${value}W 여유` : `${Math.abs(value)}W 부족`;
  return `전력 ${headroomText(resource.powerHeadroomW)} · 냉각 ${headroomText(resource.coolerHeadroomW)}`;
}

function savedCheckReferenceText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  const catalogDate = new Date(snapshot.catalogSnapshotAt);
  const catalogLabel = Number.isNaN(catalogDate.getTime()) ? snapshot.catalogSnapshotAt : catalogDate.toLocaleDateString("ko-KR");
  return `버전 ${snapshot.engineVersion} · 카탈로그 ${catalogLabel}`;
}

function savedCheckBenchmarkText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  const benchmark = snapshot.benchmarkSnapshot;
  if (!benchmark) return "벤치마크 기록 없음";
  return `벤치마크 ${buildBenchmarkSnapshotStatusText(benchmark.status)} · ${benchmark.presentScoreCount}/${benchmark.expectedScoreCount}개 점수`;
}

function savedAssemblyVerificationText(snapshot: NonNullable<SavedBuild["checkSnapshot"]>) {
  const verification = snapshot.assemblyVerification;
  if (!verification) return undefined;
  const stateLabel = verification.state === "passed" ? "실측 통과" : verification.state === "failed" ? "실패 항목 있음" : verification.state === "in_progress" ? "실측 진행 중" : "실측 기록 없음";
  const toolLabel: Record<string, string> = { occt: "OCCT", cinebench: "Cinebench", "3dmark": "3DMark", crystaldiskmark: "CrystalDiskMark", other: "기타" };
  const scenarioLabel: Record<string, string> = { idle: "유휴", cpu: "CPU 부하", gpu: "GPU 부하", mixed: "혼합 부하", storage: "저장장치 부하", custom: "사용자 지정" };
  const conditions = [
    verification.loadTool !== "not_recorded" ? toolLabel[verification.loadTool] ?? verification.loadTool : undefined,
    verification.loadScenario !== "not_recorded" ? scenarioLabel[verification.loadScenario] ?? verification.loadScenario : undefined,
    verification.testDurationMinutes !== undefined ? `${verification.testDurationMinutes}분` : undefined,
    verification.ambientTempC !== undefined ? `주변 ${verification.ambientTempC}°C` : undefined,
    verification.cpuMaxTempC !== undefined ? `CPU 최고 ${verification.cpuMaxTempC}°C` : undefined,
    verification.gpuMaxTempC !== undefined ? `GPU 최고 ${verification.gpuMaxTempC}°C` : undefined,
    verification.noiseLevel !== "not_recorded" ? `소음 ${verification.noiseLevel === "quiet" ? "조용함" : verification.noiseLevel === "normal" ? "보통" : "큼"}` : undefined,
    verification.measurementSeriesPointCount !== undefined ? `시계열 ${verification.measurementSeriesPointCount}점` : undefined,
    verification.measurementSource === "csv" ? `CSV ${verification.measurementSourceLabel ?? "가져옴"} · ${verification.measurementSampleCount ?? "-"}샘플` : verification.measurementSource === "manual" ? "직접 입력" : undefined
  ].filter(Boolean);
  const runCount = snapshot.assemblyVerificationHistory?.length ?? 1;
  return `실측 ${runCount}회차 · ${stateLabel} · ${verification.checked}/${verification.total}개${conditions.length > 0 ? ` · ${conditions.join(" · ")}` : ""}`;
}

function savedCheckFindingSeverityText(severity: SavedBuildCheckFindingSummary["severity"]) {
  return severity === "blocker" ? "차단 오류" : severity === "warning" ? "주의" : severity === "unknown" ? "확인 필요" : "정보";
}

function savedCheckFindingChangeText(change: SavedBuildCheckFindingDiff["change"]) {
  return change === "resolved" ? "해결됨" : change === "new" ? "새로 발생" : change === "severity_changed" ? "중요도 변경" : change === "details_changed" ? "결과 내용 변경" : "변화 없음";
}

function savedCheckFindingForChange(change: SavedBuildCheckFindingDiff) {
  return change.after ?? change.before;
}

function savedCheckFindingAffectedText(finding: SavedBuildCheckFindingSummary | undefined, partMap?: ReadonlyMap<string, Part>) {
  if (!finding || finding.affectedPartIds.length === 0) return undefined;
  return finding.affectedPartIds.map((partId) => partMap?.get(partId)?.name ?? partId).join(", ");
}

function savedCheckCatalogCauseCategoryText(record: CatalogChangeRecord) {
  return record.kind === "accessory" ? ACCESSORY_CATEGORY_LABELS[record.category as AccessoryCategory] ?? record.category : CATEGORY_LABELS[record.category as PartCategory] ?? record.category;
}

function savedCheckCatalogCauseReason(record: CatalogChangeRecord) {
  const reasons: string[] = [];
  if (record.changedFields.includes("가격") || record.priceDeltaWon !== undefined) reasons.push(record.priceDeltaWon === undefined ? "가격 확인 상태 변경" : `가격 ${formatPriceDelta(record.priceDeltaWon)}`);
  if (record.changedFields.includes("원문 스펙") || record.changedFields.includes("정규화 스펙")) reasons.push("스펙 변경");
  if (record.changedFields.some(isCatalogDataQualityChangeField)) reasons.push(`데이터 상태 ${record.previousDataQuality ? DATA_QUALITY_LABELS[record.previousDataQuality] : "기록 없음"} → ${DATA_QUALITY_LABELS[record.nextDataQuality]}`);
  if (record.changedFields.includes("누락 필드")) reasons.push(`누락 필드 ${record.previousMissingFields.length}개 → ${record.nextMissingFields.length}개`);
  if (record.changedFields.includes("벤치마크 보강")) reasons.push("벤치마크 보강");
  return reasons.length > 0 ? reasons.join(" · ") : "카탈로그 값 변경";
}

function savedCheckCatalogCauseDateText(record: CatalogChangeRecord) {
  const changedAt = new Date(record.changedAt);
  return Number.isNaN(changedAt.getTime()) ? record.changedAt : changedAt.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

const CATALOG_SPEC_LABELS: Record<string, string> = {
  socket: "소켓",
  cores: "코어",
  threads: "스레드",
  boostClockGhz: "부스트 클럭",
  cinebenchR23Single: "Cinebench R23 싱글",
  cinebenchR23Multi: "Cinebench R23 멀티",
  maxMemorySpeedMhz: "메모리 지원 속도",
  memoryType: "메모리 타입",
  coolerIncluded: "기본 쿨러 포함",
  tdpW: "TDP",
  pptW: "PPT",
  powerW: "소비전력",
  recommendedPsuW: "권장 파워",
  wattageW: "정격 출력",
  capacityGb: "용량",
  speedMhz: "메모리 속도",
  memoryCasLatency: "CAS 레이턴시",
  memoryVoltageV: "메모리 전압",
  m2PcieGeneration: "M.2 PCIe 세대",
  vramGb: "VRAM",
  lengthMm: "길이",
  thicknessMm: "두께",
  maxGpuLengthMm: "GPU 허용 길이",
  maxCoolerHeightMm: "쿨러 허용 높이",
  supportedSockets: "지원 소켓",
  memoryProfiles: "메모리 프로파일",
  memoryFormFactor: "메모리 슬롯 규격",
  memoryModuleCountPerKit: "킷당 모듈 수",
  memoryTiming: "메모리 타이밍",
  memoryEffectiveLatencyNs: "실효 CAS 지연",
  maxMemoryGb: "최대 메모리",
  memorySlots: "메모리 슬롯",
  m2Slots: "M.2 슬롯",
  m2Interfaces: "M.2 연결",
  m2PcieGenerations: "M.2 PCIe 세대",
  pcieX16Slots: "PCIe x16 슬롯",
  pcieX8Slots: "PCIe x8 슬롯",
  pcieX4Slots: "PCIe x4 슬롯",
  pcieX1Slots: "PCIe x1 슬롯",
  pcieSlotWidth: "PCIe 장착 폭",
  adapterPcieSlotWidth: "PCIe 어댑터 요구 폭",
  pciePowerOptions: "GPU 보조전원 요구",
  pciePowerAdapterOptions: "GPU 어댑터 전원 경로",
  gpuSlotOccupancy: "GPU 물리 슬롯 점유",
  gpuCableBendClearanceMm: "GPU 케이블 굽힘 여유",
  pciePowerConnectors: "PSU 보조전원 커넥터",
  sataPorts: "SATA 포트",
  interface: "인터페이스",
  formFactor: "폼팩터",
  sequentialReadMbps: "순차 읽기",
  sequentialWriteMbps: "순차 쓰기",
  ssdReadIops: "읽기 IOPS",
  ssdWriteIops: "쓰기 IOPS",
  ssdController: "SSD 컨트롤러",
  ssdNandType: "NAND",
  ssdTbwTb: "TBW",
  gpuVendor: "GPU 제조사",
  gpuArchitectureFamily: "GPU 아키텍처",
  gpuMemoryType: "GPU 메모리",
  gpuBoostClockMhz: "GPU 부스트 클럭",
  gpuStreamProcessors: "스트림 프로세서",
  gpuMemoryBandwidthGbps: "VRAM 대역폭",
  gpu3dmarkTimeSpyScore: "3DMark Time Spy",
  gpu3dmarkPortRoyalScore: "3DMark Port Royal",
  motherboardFormFactors: "지원 메인보드 규격",
  supportedPsuFormFactors: "지원 파워 규격",
  maxPsuLengthMm: "PSU 허용 길이",
  caseSidePanelClearanceMm: "케이스 측면 케이블 여유",
  coolerType: "쿨러 타입",
  radiatorSizeMm: "라디에이터",
  radiatorSizesMm: "지원 라디에이터",
  radiatorPosition: "라디에이터 장착 위치",
  radiatorSupports: "위치별 라디에이터 지원",
  hddBays: "HDD 베이",
  ssdBays: "SSD 베이",
  maxCoolingW: "냉각 지원",
  efficiency: "효율",
  psuFormFactor: "PSU 폼팩터",
  psuCableType: "PSU 케이블 구조",
  psuRailType: "PSU 12V 레일",
  psuIndependentPcieCableRuns: "PSU 독립 PCIe 케이블 런",
  psuPcieCableTopology: "PSU PCIe 케이블 분배 구조",
  fanCount: "팬 수",
  fanPortCount: "팬 헤더",
  rgb5vPortCount: "5V ARGB 헤더",
  rgb12vPortCount: "12V RGB 헤더",
  rgbDeviceVoltage: "RGB 전압",
  rgbDeviceCurrentA: "RGB 장치당 소비전류",
  rgbDevicePowerW: "RGB 장치당 소비전력",
  rgbControllerIncluded: "RGB 컨트롤러"
};

function catalogSpecFieldLabel(key: string) {
  if (CATALOG_SPEC_LABELS[key]) return CATALOG_SPEC_LABELS[key];
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
}

function parseCatalogSpecObject(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function catalogSpecValueText(key: string, value: unknown, exists: boolean) {
  if (!exists) return "필드 없음";
  if (value === null || value === undefined || value === "") return "확인 정보 없음";
  if (key === "boostClockGhz") return `${value}GHz`;
  if (key === "maxMemorySpeedMhz" || key === "speedMhz") return `${value}MHz`;
  if (key === "gpuBoostClockMhz") return `${value}MHz`;
  if (key === "tdpW" || key === "pptW" || key === "powerW" || key === "recommendedPsuW" || key === "wattageW") return `${value}W`;
  if (key === "capacityGb" || key === "vramGb" || key === "maxMemoryGb") return `${value}GB`;
  if (key === "memoryVoltageV") return `${value}V`;
  if (key === "memoryCasLatency") return `CL${value}`;
  if (key === "m2PcieGeneration") return `PCIe ${value}`;
  if (key === "psuCableType") return value === "fully_modular" ? "풀모듈러" : value === "semi_modular" ? "세미모듈러" : value === "fixed" ? "케이블 일체형" : String(value);
  if (key === "psuRailType") return value === "single" ? "12V 싱글레일" : value === "multi" ? "12V 다중레일" : String(value);
  if (key === "radiatorPosition") return formatRadiatorPosition(String(value)) ?? String(value);
  if (key === "radiatorSupports" && Array.isArray(value)) return formatRadiatorSupports(value as Array<{ position?: unknown; sizesMm?: unknown }>) ?? "확인 정보 없음";
  if (key === "psuIndependentPcieCableRuns") return `${value}개`;
  if (key === "psuPcieCableTopology") return value === "independent" ? "독립 케이블" : value === "shared" ? "분배·공유 케이블" : String(value);
  if (key === "pcieSlotWidth" || key === "adapterPcieSlotWidth") return `x${value}`;
  if (["memoryModuleCountPerKit", "memorySlots", "m2Slots", "pcieX16Slots", "pcieX8Slots", "pcieX4Slots", "pcieX1Slots", "hddBays", "ssdBays", "fanCount", "fanPortCount", "rgb5vPortCount", "rgb12vPortCount"].includes(key)) return `${value}개`;
  if (key === "gpuSlotOccupancy") return `${value} 슬롯`;
  if (key === "gpuMemoryBandwidthGbps") return `${value}GB/s`;
  if (key === "gpuStreamProcessors" || key.endsWith("Score")) return Number(value).toLocaleString("ko-KR");
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" && item !== null ? JSON.stringify(item) : String(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  if (key.endsWith("Mm")) return `${value}mm`;
  return formatSpecValue(value);
}

function savedCatalogCauseValueDiffsFor(record: CatalogChangeRecord): CatalogChangeValueDiff[] {
  return savedBuildCatalogChangeValueDiffsFor(record).flatMap((diff) => {
    if (diff.field !== "정규화 스펙") return [diff];
    const previous = parseCatalogSpecObject(diff.previous);
    const next = parseCatalogSpecObject(diff.next);
    if (!previous || !next) return [diff];
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
      .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
      .slice(0, 12);
    return keys.length > 0
      ? keys.map((key) => ({
        field: `정규화 스펙 · ${catalogSpecFieldLabel(key)}`,
        previous: catalogSpecValueText(key, previous[key], Object.prototype.hasOwnProperty.call(previous, key)),
        next: catalogSpecValueText(key, next[key], Object.prototype.hasOwnProperty.call(next, key))
      }))
      : [diff];
  });
}

const CATALOG_SPEC_ORDER_BY_CATEGORY: Record<string, string[]> = {
  cpu: ["socket", "cores", "threads", "boostClockGhz", "tdpW", "pptW", "maxMemorySpeedMhz", "cinebenchR23Single", "cinebenchR23Multi"],
  cooler: ["supportedSockets", "maxCoolingW", "maxCoolerHeightMm", "radiatorSizeMm", "radiatorPosition", "coolerType"],
  motherboard: ["socket", "memoryType", "memoryFormFactor", "maxMemoryGb", "memorySlots", "maxMemorySpeedMhz", "m2Slots", "m2Interfaces", "m2PcieGenerations", "pcieX16Slots", "pcieX8Slots", "pcieX4Slots", "pcieX1Slots", "sataPorts"],
  memory: ["memoryType", "memoryProfiles", "capacityGb", "memoryModuleCountPerKit", "speedMhz", "memoryCasLatency", "memoryVoltageV"],
  gpu: ["gpuVendor", "gpuArchitectureFamily", "gpuMemoryType", "vramGb", "gpuBoostClockMhz", "gpuStreamProcessors", "gpuMemoryBandwidthGbps", "pciePowerOptions", "pciePowerAdapterOptions", "powerW", "recommendedPsuW", "lengthMm", "thicknessMm", "gpuSlotOccupancy", "gpuCableBendClearanceMm"],
  ssd: ["interface", "formFactor", "m2PcieGeneration", "capacityGb", "sequentialReadMbps", "sequentialWriteMbps", "ssdReadIops", "ssdWriteIops", "ssdController", "ssdNandType", "ssdTbwTb"],
  hdd: ["interface", "formFactor", "capacityGb"],
  case: ["motherboardFormFactors", "maxGpuLengthMm", "caseSidePanelClearanceMm", "maxCoolerHeightMm", "maxPsuLengthMm", "supportedPsuFormFactors", "radiatorSupports", "hddBays", "ssdBays"],
  psu: ["wattageW", "psuDepthMm", "pciePowerConnectors", "psuCableType", "psuRailType", "psuIndependentPcieCableRuns", "psuPcieCableTopology", "efficiency", "psuFormFactor"]
};

function catalogSpecKeyForLabel(label: string) {
  const entry = Object.entries(CATALOG_SPEC_LABELS).find(([, value]) => value === label);
  return entry?.[0];
}

function catalogCauseDiffLabel(diff: CatalogChangeValueDiff) {
  return diff.field.startsWith("정규화 스펙 · ") ? diff.field.slice("정규화 스펙 · ".length) : diff.field;
}

function catalogCauseDiffPriority(record: CatalogChangeRecord, diff: CatalogChangeValueDiff) {
  const key = diff.field.startsWith("정규화 스펙 · ") ? catalogSpecKeyForLabel(catalogCauseDiffLabel(diff)) : undefined;
  if (!key) return 200;
  const order = CATALOG_SPEC_ORDER_BY_CATEGORY[record.category] ?? [];
  const index = order.indexOf(key);
  return index >= 0 ? index : 100;
}

function SavedCatalogCauseDiffRows({ record, diffs }: { record: CatalogChangeRecord; diffs: CatalogChangeValueDiff[] }) {
  const ordered = diffs.slice().sort((left, right) => catalogCauseDiffPriority(record, left) - catalogCauseDiffPriority(record, right) || left.field.localeCompare(right.field));
  return <div className="history-check-cause-values-list">{ordered.map((diff) => <div className="history-check-cause-value" key={diff.field}><span>{catalogCauseDiffLabel(diff)}</span><small><em>{diff.previous ?? "확인 정보 없음"}</em><b>→</b><em>{diff.next ?? "확인 정보 없음"}</em></small></div>)}</div>;
}

function savedCheckCatalogCauseSourceUrl(record: CatalogChangeRecord, partMap?: ReadonlyMap<string, Part>, accessoryMap?: ReadonlyMap<string, AccessoryItem>) {
  const item = record.kind === "accessory" ? accessoryMap?.get(record.itemId) : partMap?.get(record.itemId);
  return safeExternalUrl(item?.danawaUrl);
}

function savedCatalogCauseImpactKindText(kind: CatalogChangeImpact["kind"]) {
  return kind === "compatibility" ? "호환성 규칙" : kind === "analysis" ? "성능 분석" : kind === "purchase" ? "구매 금액" : "데이터 상태";
}

function savedCheckDriftText(saved: SavedBuild, check: SavedBuildLiveCheck | undefined) {
  const snapshot = saved.checkSnapshot;
  if (!snapshot) return saved.id === "current-draft" ? "저장 전 구성" : "저장 당시 검사 기록 없음";
  if (!check || check.status === "loading") return "현재 기준 재검사 중...";
  if (check.status === "error") return "현재 기준 재검사 실패";
  const diff = savedBuildCheckDiffFor(snapshot, check.result);
  if (!diff.hasChanges) return "저장할 때와 같은 결과";
  const changes: string[] = [];
  if (diff.statusChanged) changes.push("결과 변경");
  if (diff.riskChanged) changes.push("위험 카운트 변경");
  if (diff.accessoryRiskChanged) changes.push("주변 부품 위험 변경");
  if (diff.priceChanged || diff.priceCompletenessChanged) changes.push("가격 변경");
  if (diff.resourceBudgetChanged) changes.push("전력·냉각 예산 변경");
  if (diff.benchmarkChanged) changes.push("벤치마크 변경");
  else if (diff.benchmarkNeedsReview) changes.push("벤치마크 확인 필요");
  if (diff.engineChanged) changes.push("검사 버전 변경");
  if (diff.catalogChanged) changes.push("카탈로그 기준 변경");
  return changes.join(" · ");
}

function SavedBuildCheckBadge({ snapshot }: { snapshot: NonNullable<SavedBuild["checkSnapshot"]> }) {
  const checkedAt = new Date(snapshot.checkedAt);
  const checkedLabel = Number.isNaN(checkedAt.getTime()) ? snapshot.checkedAt : checkedAt.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
  return <div className={`history-check-snapshot ${snapshot.status}`} data-testid="saved-build-check-snapshot"><span className="history-check-snapshot-icon"><FiActivity /></span><div><strong>저장 당시 검사 · {savedCheckStatusText(snapshot.status)}</strong><small>{checkedLabel} · {savedCheckRiskText(snapshot)} · 분석 {savedCheckAnalysisText(snapshot)}</small><small>{savedCheckReferenceText(snapshot)} · 합계 {savedCheckPriceText(snapshot)} · 전력·냉각 {savedCheckResourceText(snapshot)}</small><small>{savedCheckBenchmarkText(snapshot)}</small>{snapshot.actionCenterSummary && <small>먼저 할 일 · {snapshot.actionCenterSummary}</small>}{snapshot.catalogRefreshReport && <small>정보 다시 확인 · {savedCheckCatalogRefreshSummary(snapshot.catalogRefreshReport)}</small>}{savedAssemblyVerificationText(snapshot) && <small>{savedAssemblyVerificationText(snapshot)}</small>}</div></div>;
}

function SavedCatalogCauseValueDiffs({ record, compact = false, relatedRuleIds = [] }: { record: CatalogChangeRecord; compact?: boolean; relatedRuleIds?: string[] }) {
  const diffs = savedCatalogCauseValueDiffsFor(record);
  if (diffs.length === 0) return <small className="history-check-cause-values-missing">이전·현재 값이 보존되지 않은 구버전 변경 로그입니다.</small>;
  const groupLabel = savedCheckCatalogCauseCategoryText(record);
  const specDiffs = diffs.filter((diff) => diff.field.startsWith("정규화 스펙 · "));
  const priceAndDataDiffs = diffs.filter((diff) => !diff.field.startsWith("정규화 스펙 · ") && diff.field !== "원문 스펙");
  const rawSpecDiffs = diffs.filter((diff) => diff.field === "원문 스펙");
  const allImpacts = [...new Map(diffs.flatMap((diff) => catalogChangeImpactsFor(record, diff)).map((impact) => [impact.id, impact])).values()];
  const exactImpacts = relatedRuleIds.length > 0 ? allImpacts.filter((impact) => impact.ruleIds.some((ruleId) => relatedRuleIds.includes(ruleId))) : [];
  const impacts = exactImpacts.length > 0 ? exactImpacts : allImpacts;
  return <details className={compact ? "history-check-cause-values compact" : "history-check-cause-values"}><summary>{groupLabel} · 변경 값 표 ({diffs.length}개)</summary>{specDiffs.length > 0 && <div className="history-check-cause-group"><strong>핵심 규격 변화</strong><SavedCatalogCauseDiffRows record={record} diffs={specDiffs} /></div>}{priceAndDataDiffs.length > 0 && <div className="history-check-cause-group"><strong>가격·데이터 변화</strong><SavedCatalogCauseDiffRows record={record} diffs={priceAndDataDiffs} /></div>}{rawSpecDiffs.length > 0 && <div className="history-check-cause-group"><strong>수집된 스펙 변화</strong><SavedCatalogCauseDiffRows record={record} diffs={rawSpecDiffs} /></div>}{impacts.length > 0 && <div className="history-check-cause-impact"><strong>{exactImpacts.length > 0 ? "이 결과에 연결된 영향" : "영향이 있을 수 있는 항목"}</strong>{impacts.map((impact) => <div className="history-check-cause-impact-row" key={impact.id}><span>{savedCatalogCauseImpactKindText(impact.kind)}</span><div><strong>{impact.label}</strong><small>{impact.summary}</small>{impact.ruleIds.length > 0 && <small>규칙 · {impact.ruleIds.join(" · ")}</small>}</div></div>)}<small className="history-check-cause-impact-note"><FiRefreshCw /> 값이 바뀌었으니 현재 기준으로 다시 검사해 주세요.</small></div>}</details>;
}

function SavedCatalogCauseSourceLink({ record, partMap, accessoryMap }: { record: CatalogChangeRecord; partMap?: ReadonlyMap<string, Part>; accessoryMap?: ReadonlyMap<string, AccessoryItem> }) {
  const sourceUrl = savedCheckCatalogCauseSourceUrl(record, partMap, accessoryMap);
  return sourceUrl ? <a className="history-check-cause-source" href={sourceUrl} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a> : null;
}

function savedCheckFindingFactText(fact: SavedBuildCheckFindingSummary["facts"][number] | undefined) {
  if (!fact) return "기록 없음";
  const actual = fact.actual ?? "확인 정보 없음";
  return fact.expected ? `${actual} · 기대값 ${fact.expected}` : actual;
}

function SavedCheckFindingFactDiff({ before, after }: { before?: SavedBuildCheckFindingSummary; after?: SavedBuildCheckFindingSummary }) {
  const beforeFacts = before?.facts ?? [];
  const afterFacts = after?.facts ?? [];
  const labels = [...new Set([...beforeFacts.map((fact) => fact.label), ...afterFacts.map((fact) => fact.label)])];
  if (labels.length === 0) return null;
  const beforeByLabel = new Map(beforeFacts.map((fact) => [fact.label, fact]));
  const afterByLabel = new Map(afterFacts.map((fact) => [fact.label, fact]));
  return <div className="history-check-finding-facts"><strong>결과 값 비교</strong><div className="history-check-finding-facts-grid"><span>항목</span><span>변경 전</span><span>변경 후</span>{labels.map((label) => <Fragment key={label}><b>{label}</b><small>{savedCheckFindingFactText(beforeByLabel.get(label))}</small><small>{savedCheckFindingFactText(afterByLabel.get(label))}</small></Fragment>)}</div></div>;
}

function SavedBuildCheckTransitionSummary({ summary, before, after }: { summary: SavedBuildCheckTransitionSummary; before: SavedBuildCheckSnapshot; after: SavedBuildCheckSnapshot }) {
  const directionLabel = summary.direction === "improved" ? "개선" : summary.direction === "regressed" ? "악화" : summary.direction === "changed" ? "변경" : "동일";
  const headline = summary.direction === "improved" ? "검사 결과가 개선되었습니다." : summary.direction === "regressed" ? "검사 결과가 악화되었습니다." : summary.direction === "changed" ? "검사 결과에 변화가 있습니다." : "검사 결과가 동일합니다.";
  const lines: string[] = [];
  if (summary.statusChanged) lines.push(`전체 결과 ${savedCheckStatusText(before.status)} → ${savedCheckStatusText(after.status)}`);
  if (summary.resolvedFindingCount > 0) lines.push(`해결된 항목 ${summary.resolvedFindingCount}개`);
  if (summary.newFindingCount > 0) lines.push(`새로 생긴 항목 ${summary.newFindingCount}개`);
  if (summary.severityChangedFindingCount > 0) lines.push(`중요도가 바뀐 항목 ${summary.severityChangedFindingCount}개`);
  if (summary.detailsChangedFindingCount > 0) lines.push(`내용이 바뀐 항목 ${summary.detailsChangedFindingCount}개`);
  if (summary.blockerDelta !== 0) lines.push(`차단 오류 ${before.blockerCount}개 → ${after.blockerCount}개`);
  if (summary.warningDelta !== 0) lines.push(`주의 항목 ${before.warningCount}개 → ${after.warningCount}개`);
  if (summary.unknownDelta !== 0) lines.push(`확인 필요 ${before.unknownCount}개 → ${after.unknownCount}개`);
  if (summary.accessoryBlockerDelta !== 0) lines.push(`주변 부품 차단 ${before.accessoryCompatibility?.blockerCount ?? 0}개 → ${after.accessoryCompatibility?.blockerCount ?? 0}개`);
  if (summary.accessoryWarningDelta !== 0) lines.push(`주변 부품 주의 ${before.accessoryCompatibility?.warningCount ?? 0}개 → ${after.accessoryCompatibility?.warningCount ?? 0}개`);
  if (summary.accessoryUnknownDelta !== 0) lines.push(`주변 부품 확인 필요 ${before.accessoryCompatibility?.unknownCount ?? 0}개 → ${after.accessoryCompatibility?.unknownCount ?? 0}개`);
  if (summary.resourceBudgetChanged) {
    const resourceDelta = [
      summary.powerHeadroomDeltaW !== undefined ? `전력 ${summary.powerHeadroomDeltaW > 0 ? "+" : ""}${summary.powerHeadroomDeltaW}W` : undefined,
      summary.coolerHeadroomDeltaW !== undefined ? `냉각 ${summary.coolerHeadroomDeltaW > 0 ? "+" : ""}${summary.coolerHeadroomDeltaW}W` : undefined
    ].filter((value): value is string => Boolean(value));
    lines.push(`전력·냉각 예산 ${savedCheckResourceText(before)} → ${savedCheckResourceText(after)}${resourceDelta.length > 0 ? ` (${resourceDelta.join(" · ")})` : ""}`);
  }
  if (summary.benchmarkChanged || summary.benchmarkNeedsReview) {
    const impact = summary.benchmarkImpact;
    const detail = impact.changedScoreCount > 0 ? ` · 점수 ${impact.changedScoreCount}개 변경` : impact.benchmarkDateChanged ? " · 자료 시점 변경" : "";
    lines.push(`CPU·GPU ${buildBenchmarkImpactStatusText(impact.status)} · ${buildBenchmarkDecisionImpactText(impact.decisionImpact)}${detail}`);
  }
  if (summary.priceDeltaWon !== undefined && summary.priceDeltaWon !== 0) lines.push(`전체 금액 ${savedCheckPriceText(before)} → ${savedCheckPriceText(after)} (${formatPriceDelta(summary.priceDeltaWon)})`);
  else if (summary.priceCompletenessChanged) lines.push(`가격 상태 ${before.priceComplete ? "확인됨" : "확인 필요"} → ${after.priceComplete ? "확인됨" : "확인 필요"}`);
  if (summary.catalogChanged) lines.push("카탈로그 기준이 바뀌어 현재 기준으로 다시 확인했습니다.");
  if (summary.engineChanged) lines.push(`검사 버전 ${before.engineVersion} → ${after.engineVersion}`);
  if (lines.length === 0) lines.push("두 시점의 검사 상태·위험 카운트·가격·전력·냉각 예산·벤치마크 변화가 없습니다.");
  const accessoryBlockerCount = after.accessoryCompatibility?.blockerCount ?? 0;
  const accessoryReviewCount = (after.accessoryCompatibility?.warningCount ?? 0) + (after.accessoryCompatibility?.unknownCount ?? 0);
  const nextAction = after.status === "incompatible"
    ? `차단 오류 ${after.blockerCount}개를 해결한 뒤 현재 구성으로 다시 검사하세요.`
    : accessoryBlockerCount > 0
      ? `주변 부품 차단 ${accessoryBlockerCount}개를 수정한 뒤 현재 구성으로 다시 검사하세요.`
    : after.status === "needs_review"
      ? `확인 필요 ${after.unknownCount}개를 제조사·판매처에서 확인한 뒤 구매를 결정해 주세요.`
      : accessoryReviewCount > 0
        ? `주변 부품 주의·확인 필요 ${accessoryReviewCount}개를 제조사·판매처에서 확인한 뒤 구매를 결정해 주세요.`
      : after.warningCount > 0
        ? `호환성은 통과했지만 주의 항목 ${after.warningCount}개를 조립 전에 확인해 주세요.`
        : after.resourceBudget?.state === "danger"
          ? "전력·냉각 여유가 부족해요. 부품이나 냉각·전원 조건을 바꾼 뒤 다시 검사해 주세요."
        : after.resourceBudget?.state === "warning" || after.resourceBudget?.state === "unknown"
          ? "전력·냉각 여유나 스펙 수치를 사기 전에 확인해 주세요."
        : "현재 카탈로그 기준으로는 호환돼요. 제조사 안내와 실제 조립 조건을 마지막으로 확인해 주세요.";
  return <section className={`history-check-transition-summary ${summary.direction}`} aria-label="결과 변화 요약" data-testid="saved-build-check-transition-summary"><div className="history-check-transition-heading"><div><p className="eyebrow">DECISION SUMMARY</p><strong>{headline}</strong></div><span>{directionLabel}</span></div><ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul><p className="history-check-transition-action"><FiZap /> 다음 행동 · {nextAction}</p></section>;
}

function SavedBuildCheckTimeline({ history, buildId, partMap, accessoryMap, showDiff = true, canRecord = false, recording = false, onRecordCheck }: { history: NonNullable<SavedBuild["checkHistory"]>; buildId?: string; partMap?: ReadonlyMap<string, Part>; accessoryMap?: ReadonlyMap<string, AccessoryItem>; showDiff?: boolean; canRecord?: boolean; recording?: boolean; onRecordCheck?: () => void }) {
  const [beforeIndex, setBeforeIndex] = useState(Math.max(0, history.length - 2));
  const [afterIndex, setAfterIndex] = useState(Math.max(0, history.length - 1));
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [catalogCauseState, setCatalogCauseState] = useState<SavedBuildCatalogCauseState>({ key: "", status: "idle", items: [] });
  const latestCheckedAt = history[history.length - 1]?.checkedAt ?? "";
  useEffect(() => {
    setBeforeIndex(Math.max(0, history.length - 2));
    setAfterIndex(Math.max(0, history.length - 1));
  }, [history.length, latestCheckedAt]);
  const entries = history.slice().reverse();
  const before = history[beforeIndex] ?? history[0];
  const after = history[afterIndex] ?? history[history.length - 1];
  const catalogCauseKey = buildId && before && after && before.checkedAt !== after.checkedAt ? `${buildId}:${before.checkedAt}:${after.checkedAt}` : "none";
  useEffect(() => {
    if (catalogCauseKey === "none" || !buildId || !before || !after) {
      setCatalogCauseState({ key: catalogCauseKey, status: "idle", items: [] });
      return;
    }
    let cancelled = false;
    setCatalogCauseState({ key: catalogCauseKey, status: "loading", items: [] });
    const timestamps = [before.checkedAt, after.checkedAt].sort();
    void api<{ items: CatalogChangeRecord[] }>(`/api/builds/${encodeURIComponent(buildId)}/check-causes?from=${encodeURIComponent(timestamps[0])}&to=${encodeURIComponent(timestamps[1])}`, { retry: 1 })
      .then((payload) => {
        if (!cancelled) setCatalogCauseState({ key: catalogCauseKey, status: "ready", items: Array.isArray(payload.items) ? payload.items : [] });
      })
      .catch((error: unknown) => {
        if (!cancelled) setCatalogCauseState({ key: catalogCauseKey, status: "error", items: [], message: error instanceof Error ? error.message : "카탈로그 변경 원인을 확인하지 못했습니다." });
      });
    return () => { cancelled = true; };
  }, [catalogCauseKey, buildId, before?.checkedAt, after?.checkedAt]);
  const topLevelDiff = before && after ? savedBuildCheckSnapshotDiffFor(before, after) : undefined;
  const transitionSummary = before && after ? savedBuildCheckTransitionSummaryFor(before, after) : undefined;
  const findingDiff = before && after ? savedBuildCheckFindingDiffFor(before, after) : undefined;
  const findingChanges = findingDiff?.changes ?? [];
  const changedFindings = findingChanges.filter((change) => change.change !== "unchanged");
  const visibleFindingChanges = showUnchanged ? findingChanges : changedFindings;
  const findingChangeCount = (change: SavedBuildCheckFindingDiff["change"]) => findingChanges.filter((item) => item.change === change).length;
  const dateLabelFor = (snapshot: SavedBuildCheckSnapshot) => {
    const checkedAt = new Date(snapshot.checkedAt);
    return Number.isNaN(checkedAt.getTime()) ? snapshot.checkedAt : checkedAt.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  };
  return (
    <section className="history-check-timeline" aria-label="검사 타임라인" data-testid="saved-build-check-timeline" tabIndex={-1}>
      <div className="history-check-timeline-heading">
        <div><p className="eyebrow">CHECK TIMELINE</p><strong>검사 타임라인</strong></div>
        <div className="history-check-timeline-heading-actions"><span>{history.length}회</span>{canRecord && onRecordCheck && <button className="button button-small button-light" type="button" onClick={onRecordCheck} disabled={recording}>{recording ? <><FiLoader className="spin" /> 재검사 중...</> : <><FiRefreshCw /> 현재 기준 재검사·기록</>}</button>}</div>
      </div>
      <div className="history-check-timeline-list">
        {entries.slice(0, 4).map((snapshot, index) => (
          <article className={`history-check-timeline-entry ${snapshot.status}`} key={`${snapshot.checkedAt}-${snapshot.engineVersion}-${index}`}>
            <span className="history-check-timeline-dot" />
            <div>
              <strong>{index === 0 ? "최근 검사 · " : ""}{savedCheckStatusText(snapshot.status)}</strong>
              <small>{dateLabelFor(snapshot)} · {savedCheckRiskText(snapshot)} · 합계 {savedCheckPriceText(snapshot)}</small>
              <small>{savedCheckReferenceText(snapshot)}</small>
              <small>{savedCheckBenchmarkText(snapshot)}</small>
              {snapshot.actionCenterSummary && <small>먼저 할 일 · {snapshot.actionCenterSummary}</small>}
              {snapshot.catalogRefreshReport && <SavedBuildCheckRefreshEvidence report={snapshot.catalogRefreshReport} />}
              {savedAssemblyVerificationText(snapshot) && <small>{savedAssemblyVerificationText(snapshot)}</small>}
            </div>
          </article>
        ))}
      </div>
      {history.length > 4 && <small className="history-check-timeline-more">이전 검사 {history.length - 4}회는 아래 시점 선택에서 비교할 수 있습니다.</small>}
      {showDiff && history.length > 1 && before && after && (
        <div className="history-check-diff" data-testid="saved-build-check-diff">
          <div className="history-check-diff-heading">
            <div><p className="eyebrow">CHECK DIFF</p><strong>검사 결과 상세 비교</strong><small>두 검사 시점을 선택해 규칙별 변화 원인과 카탈로그 정보를 확인합니다.</small></div>
          </div>
          <div className="history-check-diff-selects">
            <label>기준 검사
              <select aria-label="기준 검사" value={beforeIndex} onChange={(event) => setBeforeIndex(Number(event.target.value))}>
                {history.map((snapshot, index) => <option value={index} key={`before-${snapshot.checkedAt}-${index}`}>검사 {index + 1} · {dateLabelFor(snapshot)} · {savedCheckStatusText(snapshot.status)}</option>)}
              </select>
            </label>
            <span>→</span>
            <label>비교 검사
              <select aria-label="비교 검사" value={afterIndex} onChange={(event) => setAfterIndex(Number(event.target.value))}>
                {history.map((snapshot, index) => <option value={index} key={`after-${snapshot.checkedAt}-${index}`}>검사 {index + 1} · {dateLabelFor(snapshot)} · {savedCheckStatusText(snapshot.status)}</option>)}
              </select>
            </label>
          </div>
          <div className="history-check-period-summary" data-testid="saved-build-check-period-summary">
            <div className="history-check-period before"><span>변경 전 · 검사 {beforeIndex + 1}</span><strong>{savedCheckStatusText(before.status)}</strong><small>{dateLabelFor(before)} · {savedCheckRiskText(before)} · {savedCheckPriceText(before)}</small></div>
            <b aria-hidden="true">→</b>
            <div className="history-check-period after"><span>변경 후 · 검사 {afterIndex + 1}</span><strong>{savedCheckStatusText(after.status)}</strong><small>{dateLabelFor(after)} · {savedCheckRiskText(after)} · {savedCheckPriceText(after)}</small></div>
          </div>
          {transitionSummary && <SavedBuildCheckTransitionSummary summary={transitionSummary} before={before} after={after} />}
          {after.catalogRefreshReport && findingDiff?.available && <SavedBuildCheckRefreshImpactPanel report={after.catalogRefreshReport} findingChanges={findingChanges} />}
          {topLevelDiff && <div className="history-check-diff-overview"><span className={topLevelDiff.statusChanged ? "changed" : ""}>결과 {topLevelDiff.statusChanged ? "변경" : "동일"}</span><span className={topLevelDiff.riskChanged ? "changed" : ""}>위험 카운트 {topLevelDiff.riskChanged ? "변경" : "동일"}</span><span className={topLevelDiff.accessoryRiskChanged ? "changed" : ""}>주변 부품 {topLevelDiff.accessoryRiskChanged ? "변경" : "동일"}</span><span className={topLevelDiff.priceChanged || topLevelDiff.priceCompletenessChanged ? "changed" : ""}>가격 {topLevelDiff.priceChanged || topLevelDiff.priceCompletenessChanged ? "변경" : "동일"}</span><span className={topLevelDiff.resourceBudgetChanged ? "changed" : ""}>전력·냉각 {topLevelDiff.resourceBudgetChanged ? "변경" : "동일"}</span><span className={topLevelDiff.benchmarkChanged || topLevelDiff.benchmarkNeedsReview ? "changed" : ""}>벤치마크 {topLevelDiff.benchmarkChanged ? "변경" : topLevelDiff.benchmarkNeedsReview ? "확인 필요" : "동일"}</span><span className={topLevelDiff.catalogChanged ? "changed" : ""}>카탈로그 {topLevelDiff.catalogChanged ? "기준 변경" : "동일"}</span></div>}
          {catalogCauseState.status === "loading" && <p className="history-check-cause-state"><FiLoader className="spin" /> 선택한 부품의 카탈로그 변경 내역을 확인하는 중...</p>}
          {catalogCauseState.status === "error" && <p className="history-check-cause-state error"><FiAlertTriangle /> 카탈로그 변경 내역을 확인하지 못했습니다. {catalogCauseState.message}</p>}
          {catalogCauseState.status === "ready" && catalogCauseState.items.length === 0 && <p className="history-check-cause-state"><FiInfo /> 두 검사 사이에 선택한 부품의 카탈로그 변경이 없어요. 변경이 원인이라고 단정하지 않아요.</p>}
          {catalogCauseState.status === "ready" && catalogCauseState.items.length > 0 && (
            <div className="history-check-cause-panel" data-testid="saved-build-catalog-causes">
              <div className="history-check-cause-heading"><div><p className="eyebrow">CATALOG CHANGES</p><strong>기록된 카탈로그 변경</strong><small>두 검사 사이에 선택한 부품에서 실제로 기록된 변경만 보여드려요.</small></div><span>{catalogCauseState.items.length}건</span></div>
              <div className="history-check-cause-list">
                {catalogCauseState.items.slice(0, 8).map((record) => <article className="history-check-cause-item" key={record.id}><div><strong>{record.itemName}</strong><small>{record.kind === "accessory" ? "주변 부품" : "핵심 부품"} · {savedCheckCatalogCauseCategoryText(record)} · {savedCheckCatalogCauseDateText(record)}</small></div><p>{savedCheckCatalogCauseReason(record)}</p><small>변경 영역 · {record.changedFields.length > 0 ? record.changedFields.map((field) => catalogChangeFieldLabelFor(field)).join(" · ") : "값 변화 없음"}</small><SavedCatalogCauseValueDiffs record={record} /><SavedCatalogCauseSourceLink record={record} partMap={partMap} accessoryMap={accessoryMap} /></article>)}
              </div>
              {catalogCauseState.items.length > 8 && <small className="history-check-cause-more">그 외 {catalogCauseState.items.length - 8}건은 카탈로그 변경 로그에서 확인할 수 있습니다.</small>}
            </div>
          )}
          {findingDiff?.available ? (
            <>
              <div className="history-check-diff-summary"><span className="resolved">해결 {findingChangeCount("resolved")}</span><span className="new">신규 {findingChangeCount("new")}</span><span className="severity_changed">중요도 변경 {findingChangeCount("severity_changed")}</span><span className="details_changed">내용 변경 {findingChangeCount("details_changed")}</span><label><input type="checkbox" checked={showUnchanged} onChange={(event) => setShowUnchanged(event.target.checked)} /> 변화 없음 포함</label></div>
              {visibleFindingChanges.length > 0 ? <div className="history-check-diff-list">{visibleFindingChanges.map((change) => {
                const beforeFinding = change.before;
                const afterFinding = change.after;
                const finding = afterFinding ?? beforeFinding;
                const affected = savedCheckFindingAffectedText(finding, partMap);
                const relatedCatalogCauses = catalogCauseState.status === "ready" ? catalogCauseState.items.filter((record) => new Set([...(beforeFinding?.affectedPartIds ?? []), ...(afterFinding?.affectedPartIds ?? [])]).has(record.itemId)).slice(0, 3) : [];
                return <article className={`history-check-diff-finding ${change.change}`} key={`${change.key}-${change.change}`}><span className="history-check-diff-label">{savedCheckFindingChangeText(change.change)}</span><div className="history-check-diff-finding-content"><div className="history-check-diff-finding-versions"><div className="history-check-diff-finding-version before"><span>변경 전</span>{beforeFinding ? <><strong>{beforeFinding.title}</strong><small>{savedCheckFindingSeverityText(beforeFinding.severity)} · {beforeFinding.message}</small></> : <small>이 검사에서 이 규칙은 기록되지 않았습니다.</small>}</div><b aria-hidden="true">→</b><div className="history-check-diff-finding-version after"><span>변경 후</span>{afterFinding ? <><strong>{afterFinding.title}</strong><small>{savedCheckFindingSeverityText(afterFinding.severity)} · {afterFinding.message}</small></> : <small>이 검사에서 이 규칙은 기록되지 않았습니다.</small>}</div></div><SavedCheckFindingFactDiff before={beforeFinding} after={afterFinding} />{affected && <small>영향 부품 · {affected}</small>}{relatedCatalogCauses.length > 0 && <div className="history-check-diff-related-causes"><span>관련 카탈로그 변경</span>{relatedCatalogCauses.map((record) => <div className="history-check-diff-related-cause" key={record.id}><small>{record.itemName} · {savedCheckCatalogCauseReason(record)} · {savedCheckCatalogCauseDateText(record)}</small><SavedCatalogCauseValueDiffs record={record} compact relatedRuleIds={[change.key]} /><SavedCatalogCauseSourceLink record={record} partMap={partMap} accessoryMap={accessoryMap} /></div>)}</div>}</div></article>;
              })}</div> : <p className="history-check-diff-empty"><FiCheckCircle /> 선택한 시점 사이에 규칙별 변화가 없습니다.</p>}
            </>
          ) : <p className="history-check-diff-unavailable"><FiInfo /> 이 기록은 전체 결과·가격 요약만 저장된 옛 버전이라 항목별 비교를 보여드릴 수 없어요.</p>}
        </div>
      )}
      {showDiff && history.length === 1 && <p className="history-check-diff-unavailable"><FiInfo /> 검사 기록을 더 저장하면 두 시점의 항목별 변화와 가격 차이를 비교할 수 있어요.</p>}
    </section>
  );
}

function savedPriceText(saved: SavedBuild, key: "totalPriceWon" | "coreTotalPriceWon" | "accessoryTotalPriceWon") {
  const summary = saved.summary;
  if (!summary) return "확인 필요";
  if (key !== "accessoryTotalPriceWon" && (!summary.priceComplete || !isKnownPrice(summary[key]))) return "가격 확인 필요";
  if (key === "accessoryTotalPriceWon" && summary.accessoryCount > 0 && !summary.priceComplete) return "가격 확인 필요";
  return key === "accessoryTotalPriceWon" && summary.accessoryCount === 0 ? "없음" : formatWon(summary[key]);
}

function similarityEvidenceText(evidence?: SimilarityEvidence) {
  if (!evidence || evidence.totalDimensions === 0 || evidence.comparedDimensions === 0) return "공통 스펙 확인 불가";
  const confidenceLabel = evidence.confidence === "high" ? "정보 충분" : evidence.confidence === "limited" ? "정보 제한" : "확인 필요";
  const basisLabel = similarityBasisLabelFor(evidence);
  const referenceCategory = similarityReferenceUsedCategoryFor(evidence);
  const referenceLabel = referenceCategory ? ` · ${referenceCategory === "gpu" ? "GPU" : "CPU"} 계열 참조 사용` : "";
  return `${confidenceLabel}${basisLabel === "비교 정보 확인 필요" ? "" : ` · ${basisLabel}`} · 공통 스펙 ${evidence.comparedDimensions}/${evidence.totalDimensions}개${referenceLabel}`;
}

function suggestionSpecRows(part: Part): Array<[string, unknown]> {
  const specs = part.specs;
  const rowsByCategory: Record<PartCategory, Array<[string, unknown]>> = {
    cpu: [["소켓", specs.socket], ["코어 / 스레드", specs.cores !== undefined && specs.threads !== undefined ? `${specs.cores} / ${specs.threads}` : undefined], ["부스트 클럭", specs.boostClockGhz !== undefined ? `${specs.boostClockGhz}GHz` : undefined], ["Cinebench R23 싱글", specs.cinebenchR23Single !== undefined ? specs.cinebenchR23Single.toLocaleString("ko-KR") : undefined], ["Cinebench R23 멀티", specs.cinebenchR23Multi !== undefined ? specs.cinebenchR23Multi.toLocaleString("ko-KR") : undefined], ["기준 전력", (specs.pptW ?? specs.tdpW) !== undefined ? `${specs.pptW ?? specs.tdpW}W` : undefined]],
    cooler: [["지원 소켓", specs.supportedSockets], ["냉각 지원", specs.maxCoolingW !== undefined ? `${specs.maxCoolingW}W` : undefined], ["최대 높이", specs.maxCoolerHeightMm !== undefined ? `${specs.maxCoolerHeightMm}mm` : undefined], ["라디에이터", specs.radiatorSizeMm !== undefined ? `${specs.radiatorSizeMm}mm` : undefined], ["라디에이터 위치", formatRadiatorPosition(specs.radiatorPosition)]],
    motherboard: [["소켓", specs.socket], ["메모리", specs.memoryType], ["메모리 프로파일", specs.memoryProfiles], ["메모리 슬롯 규격", specs.memoryFormFactor], ["최대 메모리", specs.maxMemoryGb !== undefined ? `${specs.maxMemoryGb}GB` : undefined], ["RAM 슬롯", specs.memorySlots], ["M.2 슬롯", specs.m2Slots], ["M.2 연결", specs.m2Interfaces], ["M.2 PCIe 세대", specs.m2PcieGenerations?.map((generation) => `PCIe ${generation.toFixed(1)}`)], ["M.2 슬롯별 연결", formatM2SlotProfiles(specs.m2SlotProfiles)], ["M.2 공유 범위", formatM2SharingScopes(specs.m2LaneSharingScopes)], ["PCIe x16 슬롯", specs.pcieX16Slots], ["PCIe x8 슬롯", specs.pcieX8Slots], ["PCIe x4 슬롯", specs.pcieX4Slots], ["PCIe x1 슬롯", specs.pcieX1Slots], ["5V ARGB 헤더", specs.rgb5vPortCount], ["12V RGB 헤더", specs.rgb12vPortCount], ["폼팩터", specs.formFactor]],
    memory: [["메모리", specs.memoryType], ["프로파일", specs.memoryProfiles], ["용량", specs.capacityGb !== undefined ? `${specs.capacityGb}GB` : undefined], ["모듈 수/킷", specs.memoryModuleCountPerKit !== undefined ? `${specs.memoryModuleCountPerKit}개` : undefined], ["속도", specs.speedMhz !== undefined ? `${specs.speedMhz}MHz` : undefined], ["메모리 타이밍", specs.memoryTiming], ["CAS 레이턴시", specs.memoryCasLatency !== undefined ? `CL${specs.memoryCasLatency}` : undefined], ["실효 CAS 지연(계산)", memoryEffectiveLatencyForDisplay(part) !== undefined ? `${memoryEffectiveLatencyForDisplay(part)!.toFixed(2)}ns` : undefined], ["전압", specs.memoryVoltageV !== undefined ? `${specs.memoryVoltageV}V` : undefined], ["규격", specs.formFactor]],
    gpu: [["GPU 계열", specs.gpuVendor && specs.gpuArchitectureFamily ? `${specs.gpuVendor.toUpperCase()} · ${specs.gpuArchitectureFamily}` : specs.gpuVendor?.toUpperCase()], ["GPU 메모리", specs.gpuMemoryType], ["VRAM", specs.vramGb !== undefined ? `${specs.vramGb}GB` : undefined], ["부스트 클럭", specs.gpuBoostClockMhz !== undefined ? `${specs.gpuBoostClockMhz.toLocaleString("ko-KR")}MHz` : undefined], ["스트림 프로세서", specs.gpuStreamProcessors !== undefined ? specs.gpuStreamProcessors.toLocaleString("ko-KR") : undefined], ["VRAM 대역폭", specs.gpuMemoryBandwidthGbps !== undefined ? `${specs.gpuMemoryBandwidthGbps.toLocaleString("ko-KR")}GB/s` : undefined], ["PCIe 장착 폭", specs.pcieSlotWidth !== undefined ? `x${specs.pcieSlotWidth}` : undefined], ["보조전원", formatPciePowerOptions(specs.pciePowerOptions)], ["어댑터 경로", formatPciePowerAdapterOptions(specs.pciePowerAdapterOptions)], ["소비전력", specs.powerW !== undefined ? `${specs.powerW}W` : undefined], ["권장 파워", specs.recommendedPsuW !== undefined ? `${specs.recommendedPsuW}W` : undefined], ["길이", specs.lengthMm !== undefined ? `${specs.lengthMm}mm` : undefined], ["두께", specs.thicknessMm !== undefined ? `${specs.thicknessMm}mm` : undefined], ["물리 슬롯 점유", specs.gpuSlotOccupancy !== undefined ? `${specs.gpuSlotOccupancy} 슬롯` : undefined], ["케이블 굽힘 여유", specs.gpuCableBendClearanceMm !== undefined ? `${specs.gpuCableBendClearanceMm}mm` : undefined]],
    ssd: [["인터페이스", specs.interface], ["폼팩터", specs.formFactor], ["PCIe 세대", specs.m2PcieGeneration !== undefined ? `PCIe ${specs.m2PcieGeneration.toFixed(1)}` : undefined], ["용량", specs.capacityGb !== undefined ? `${specs.capacityGb}GB` : undefined], ["순차 읽기", specs.sequentialReadMbps !== undefined ? `${specs.sequentialReadMbps}MB/s` : undefined], ["순차 쓰기", specs.sequentialWriteMbps !== undefined ? `${specs.sequentialWriteMbps}MB/s` : undefined], ["읽기 IOPS", specs.ssdReadIops !== undefined ? `${specs.ssdReadIops.toLocaleString("ko-KR")}` : undefined], ["쓰기 IOPS", specs.ssdWriteIops !== undefined ? `${specs.ssdWriteIops.toLocaleString("ko-KR")}` : undefined], ["컨트롤러", specs.ssdController], ["NAND", specs.ssdNandType], ["TBW", specs.ssdTbwTb !== undefined ? `${specs.ssdTbwTb}TB` : undefined]],
    hdd: [["인터페이스", specs.interface], ["폼팩터", specs.formFactor], ["용량", specs.capacityGb !== undefined ? `${specs.capacityGb}GB` : undefined]],
    case: [["지원 메인보드", specs.motherboardFormFactors], ["GPU 허용 길이", specs.maxGpuLengthMm !== undefined ? `${specs.maxGpuLengthMm}mm` : undefined], ["측면 케이블 여유", specs.caseSidePanelClearanceMm !== undefined ? `${specs.caseSidePanelClearanceMm}mm` : undefined], ["쿨러 허용 높이", specs.maxCoolerHeightMm !== undefined ? `${specs.maxCoolerHeightMm}mm` : undefined], ["PSU 허용 길이", specs.maxPsuLengthMm !== undefined ? `${specs.maxPsuLengthMm}mm` : undefined], ["지원 파워 규격", specs.supportedPsuFormFactors], ["위치별 라디에이터", formatRadiatorSupports(specs.radiatorSupports)], ["RGB 전압", specs.rgbDeviceVoltage], ["RGB 장치당 소비전류", specs.rgbDeviceCurrentA !== undefined ? `${specs.rgbDeviceCurrentA}A` : undefined], ["RGB 장치당 소비전력", specs.rgbDevicePowerW !== undefined ? `${specs.rgbDevicePowerW}W` : undefined], ["RGB 컨트롤러", specs.rgbControllerIncluded], ["HDD 베이", specs.hddBays]],
    psu: [["정격 출력", specs.wattageW !== undefined ? `${specs.wattageW}W` : undefined], ["PSU 깊이", specs.psuDepthMm !== undefined ? `${specs.psuDepthMm}mm` : undefined], ["PCIe 보조전원", formatPciePowerConnectors(specs.pciePowerConnectors)], ["케이블 구조", specs.psuCableType === "fully_modular" ? "풀모듈러" : specs.psuCableType === "semi_modular" ? "세미모듈러" : specs.psuCableType === "fixed" ? "케이블 일체형" : undefined], ["12V 레일", specs.psuRailType === "single" ? "싱글레일" : specs.psuRailType === "multi" ? "다중레일" : undefined], ["독립 PCIe 케이블 런", specs.psuIndependentPcieCableRuns !== undefined ? `${specs.psuIndependentPcieCableRuns}개` : undefined], ["PCIe 분배 구조", specs.psuPcieCableTopology === "independent" ? "독립 케이블" : specs.psuPcieCableTopology === "shared" ? "분배·공유 케이블" : undefined], ["효율", specs.efficiency], ["폼팩터", specs.psuFormFactor]]
  };
  return rowsByCategory[part.category].filter(([, value]) => value !== undefined && value !== "");
}

function PartVisual({ part }: { part: Part }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = safeExternalUrl(part.imageUrl);
  if (imageUrl && !failed) return <img src={imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return <CategoryIcon category={part.category} />;
}

function AccessoryVisual({ item }: { item: AccessoryItem }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = safeExternalUrl(item.imageUrl);
  if (imageUrl && !failed) return <img src={imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return <FiTool />;
}

function CategoryIcon({ category }: { category: PartCategory }) {
  const Icon = CATEGORY_META[category].Icon;
  return <Icon />;
}

export default App;
