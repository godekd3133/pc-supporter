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
  FiKey,
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
import { ACCESSORY_CATEGORIES, ACCESSORY_CATEGORY_LABELS, ACCESSORY_PRICE_FILTER_LABELS, BENCHMARK_SOURCE_KIND_LABELS, CATEGORY_LABELS, DATA_FRESHNESS_LABELS, DATA_QUALITY_LABELS, GAMING_REFRESH_RATE_LABELS, GAMING_RESOLUTION_LABELS, GAMING_RESOLUTION_VRAM_TARGETS, isCatalogDataQualityChangeField, isKnownPrice, LISTING_POLICY_LABELS, LISTING_TYPE_LABELS, PART_CATEGORIES, RECOMMENDATION_PRIORITY_DESCRIPTIONS, RECOMMENDATION_PRIORITY_LABELS, RECOMMENDATION_PROFILE_LABELS, RECOMMENDATION_VARIANT_PRIORITIES } from "../shared/types";
import { m2ReviewTemplatesToCsv, parseM2ReviewCsv } from "../shared/m2-csv";
import { trackUsageEvent } from "./usage-events";
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
import { savedWatchlistLinksFromJson } from "./watchlist-link-storage";
import type { SavedWatchlistLink } from "./watchlist-link-storage";
import type { GeneratorBudgetResult, GeneratorVariantResult } from "./BuildGeneratorView";
import { GENERATOR_VARIANTS_DRAFT_TRANSFER_KEY, generatorVariantsDraftTransferFromUnknown, type GeneratorVariantsDraftTransferOrigin } from "../shared/generator-variants-share";
import type { SavedBuildOrigin } from "../shared/saved-build-origin";
import type { PickerCandidateMode, PickerPart } from "./PartPicker";
import type { CatalogPart } from "./CatalogView";
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
import { eul, eun } from "../shared/josa";
import { formatPriceDelta, formatSignedPercent, formatSpecValue, formatWon, partSummary, similarityEvidenceText, suggestionSpecRows } from "./app-format";
import { RecommendationControls } from "./RecommendationControls";
import { type SavedBuildOpenFocus, type BuildScenarioPreviewState } from "./app-types";
import { accessorySelections, addAccessoryToBuild, catalogRefreshReportForInput, defaultAccessoryTargetAccessoryId, defaultAccessoryTargetPartId, purchaseListRowsFor, removeAccessoryFromBuild, removeSelection, replaceAffectedPartsInBuild, selectionList, unknownPriceItemsFor, updateAccessoryHubTarget, updateAccessoryQuantity, updateAccessoryTarget, updateQuantity, updateRgbControllerTarget, upgradeBundleBuildFor, withSelectedPart } from "./build-edit";
import { ChangeHistoryPanel, RequestErrorNotice } from "./notices";
import { AccessoryVisual, CATEGORY_META, CategoryIcon, PartEvidence, accessoryIsWatched, partIsWatched, PartVisual, PartWatchButton } from "./part-visuals";
import { readSavedBuildOwnerTokens, writeSavedBuildOwnerTokens, rememberSavedBuildOwnerToken, readSavedBuildOwnerToken, readSavedBuildIds, writeSavedBuildIds, SAVED_BUILD_OWNER_TOKENS_STORAGE_KEY, SAVED_BUILD_IDS_STORAGE_KEY, LOCAL_SAVED_STATE_LIMIT } from "./saved-build-storage";


const PriceWatchlistView = lazy(() => import("./PriceWatchlistView").then((module) => ({ default: module.PriceWatchlistView })));
const BuildGeneratorView = lazy(() => import("./BuildGeneratorView").then((module) => ({ default: module.BuildGeneratorView })));
const PartPicker = lazy(() => import("./PartPicker").then((module) => ({ default: module.PartPicker })));
const ResultFindingCard = lazy(() => import("./ResultFindings").then((module) => ({ default: module.ResultFindingCard })));
const AdminView = lazy(() => import("./AdminView").then((module) => ({ default: module.AdminView })));
const LazyRepairPlanComparisonPanel = lazy(() => import("./RepairPlanComparison").then((module) => ({ default: module.RepairPlanComparisonPanel })));
const LazyRepairPlanSummaryTable = lazy(() => import("./RepairPlanSummary").then((module) => ({ default: module.RepairPlanSummaryTable })));
const LazyRecommendationSearchNotice = lazy(() => import("./RecommendationSearchNotice").then((module) => ({ default: module.RecommendationSearchNotice })));
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
const LazySharedGeneratorVariantsView = lazy(() => import("./SharedGeneratorVariantsView").then((module) => ({ default: module.SharedGeneratorVariantsView })));
const LazyHomeView = lazy(() => import("./HomeView").then((module) => ({ default: module.HomeView })));
const LazySaveBuildDialog = lazy(() => import("./SavedBuildDialogs").then((module) => ({ default: module.SaveBuildDialog })));
const LazyEditSavedBuildMetadataDialog = lazy(() => import("./SavedBuildDialogs").then((module) => ({ default: module.EditSavedBuildMetadataDialog })));
const LazyRecoveryCodeDialog = lazy(() => import("./SavedBuildDialogs").then((module) => ({ default: module.RecoveryCodeDialog })));
const LazyRecoverOwnershipDialog = lazy(() => import("./SavedBuildDialogs").then((module) => ({ default: module.RecoverOwnershipDialog })));
const LazyEditorView = lazy(() => import("./EditorView").then((module) => ({ default: module.EditorView })));
const LazyHistoryView = lazy(() => import("./HistoryView").then((module) => ({ default: module.HistoryView })));
const LazyQuoteOnboardingView = lazy(() => import("./QuoteOnboardingView").then((module) => ({ default: module.QuoteOnboardingView })));
const LazyAccessoryView = lazy(() => import("./AccessoryView").then((module) => ({ default: module.AccessoryView })));
const LazyHomeSavedBuildVersionSharePanel = lazy(() => import("./HomeSavedBuildVersionSharePanel").then((module) => ({ default: module.HomeSavedBuildVersionSharePanel })));
const LazySharedAlternativeComparisonView = lazy(() => import("./SharedAlternativeComparisonView").then((module) => ({ default: module.SharedAlternativeComparisonView })));
const LazySharedSavedBuildVersionView = lazy(() => import("./SharedSavedBuildVersionView").then((module) => ({ default: module.SharedSavedBuildVersionView })));
const LazySharedWatchlistView = lazy(() => import("./SharedWatchlistView").then((module) => ({ default: module.SharedWatchlistView })));
const LazyResultQuickNav = lazy(() => import("./ResultQuickNav").then((module) => ({ default: module.ResultQuickNav })));
const LazyResultView = lazy(() => import("./ResultView").then((module) => ({ default: module.ResultView })));
const LazySavedBuildRecheckDiffPanel = lazy(() => import("./SavedBuildRecheckDiffPanel").then((module) => ({ default: module.SavedBuildRecheckDiffPanel })));
const LazySavedBuildMonitorAlertsPanel = lazy(() => import("./SavedBuildMonitorAlertsPanel").then((module) => ({ default: module.SavedBuildMonitorAlertsPanel })));

type View = "home" | "start" | "generator" | "editor" | "result" | "history" | "admin" | "accessories" | "catalog" | "pricewatchlist" | "watchlist" | "budget" | "generator-variants" | "comparison" | "version-comparison";
type BuildChangeDialogProps = { change: PendingBuildChange; checking: boolean; onClose: () => void; onConfirm: () => void; formatPriceDelta: (value: number | undefined) => string };

const CATALOG_WATCH_THRESHOLD_STORAGE_KEY = "pc-supporter-catalog-watch-threshold";
const SAVED_BUILD_METADATA_SYNC_STORAGE_KEY = "pc-supporter-saved-build-metadata-sync";
const SAVED_BUILD_MONITOR_ALERTS_STORAGE_KEY = "pc-supporter-saved-build-monitor-alerts";
const SAVED_BUILD_SERVER_ALERT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const BROWSER_NOTIFICATION_ENABLED_STORAGE_KEY = "pc-supporter-browser-notification-enabled";
const BROWSER_NOTIFICATION_DELIVERED_STORAGE_KEY = "pc-supporter-browser-notification-delivered";
const SAVED_WATCHLIST_OWNER_TOKENS_STORAGE_KEY = "pc-supporter-saved-watchlist-owner-tokens";
const SAVED_WATCHLIST_LINK_STORAGE_KEY = "pc-supporter-saved-watchlist-link";
const BUDGET_LADDER_LOCAL_SHARES_STORAGE_KEY = "pc-supporter-budget-ladder-shares";
const ALTERNATIVE_COMPARISON_LOCAL_SHARES_STORAGE_KEY = "pc-supporter-alternative-comparison-shares";
const SAVED_BUILD_VERSION_LOCAL_SHARES_STORAGE_KEY = "pc-supporter-saved-build-version-shares";

type SavedBuildCreateResponse = SavedBuild & {
  ownerToken: string;
  recoveryCode?: string;
};

type SavedWatchlistCreateResponse = SavedCatalogWatchlist & {
  ownerToken: string;
};

type SavedWatchlistLinkState = {
  id: string;
  expiresAt?: string;
};

type SavedWatchlistExpiryDays = "never" | 7 | 30;

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
  origin?: SavedBuildOrigin;
};

function savedBuildOriginForGeneratorVariantsTransfer(origin: GeneratorVariantsDraftTransferOrigin, priority: RecommendationPriority): SavedBuildOrigin {
  return {
    kind: "shared_generator_variants",
    sourceShareId: origin.shareId,
    ...(origin.shareName ? { sourceShareName: origin.shareName } : {}),
    sourcePriority: priority,
    sourceCatalogSnapshotAt: origin.catalogSnapshotAt,
    ...(origin.currentRecheckedAt ? { currentRecheckedAt: origin.currentRecheckedAt } : {})
  };
}

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
  if (path.startsWith("/generator-variants/")) return "generator-variants";
  if (path.startsWith("/compare/")) return "comparison";
  if (path.startsWith("/version-comparison/")) return "version-comparison";
  if (path === "/watchlist" || path === "/watchlist/") return "pricewatchlist";
  if (path.startsWith("/accessories")) return "accessories";
  if (path.startsWith("/history")) return "history";
  if (path.startsWith("/recommend")) return "generator";
  if (path.startsWith("/start")) return "start";
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

function readLocalSavedWatchlistLinks(): SavedWatchlistLink[] {
  try {
    return savedWatchlistLinksFromJson(window.localStorage.getItem(SAVED_WATCHLIST_LINK_STORAGE_KEY));
  } catch {
    return [];
  }
}

type WatchlistAlertBundle = {
  watchlistId: string;
  watchlistName?: string;
  items: HomeAlertItem[];
  unreadCount: number;
};

type HomeAlertItem = {
  id: string;
  itemKey: string;
  message: string;
  kind: "drop" | "target" | "availability";
  createdAt: string;
  readAt?: string;
};

type UnifiedAlertItem = {
  id: string;
  source: "build" | "watchlist";
  sourceLabel: string;
  kind: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
};

const WATCHLIST_ALERT_KIND_LABELS: Record<HomeAlertItem["kind"], string> = {
  drop: "가격 하락",
  target: "목표가 도달",
  availability: "판매 상태 변화"
};

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

function forgetSavedBuild(id: string) {
  writeSavedBuildIds(readSavedBuildIds().filter((savedId) => savedId !== id));
  const tokens = readSavedBuildOwnerTokens();
  delete tokens[id];
  writeSavedBuildOwnerTokens(tokens);
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
  const [watchlistAlertBundles, setWatchlistAlertBundles] = useState<WatchlistAlertBundle[]>([]);
  const watchlistAlertSyncVersionRef = useRef(0);
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
  const [recoveryCodeNotice, setRecoveryCodeNotice] = useState<{ code: string; buildName: string } | null>(null);
  const [recoveryCodeBusy, setRecoveryCodeBusy] = useState(false);
  const [myPcBusyId, setMyPcBusyId] = useState<string | null>(null);
  const [recoverOwnershipTarget, setRecoverOwnershipTarget] = useState<{ id: string; name?: string } | null | "open">(null);
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
  const watchlistUnreadAlertCount = useMemo(() => watchlistAlertBundles.reduce((sum, bundle) => sum + bundle.unreadCount, 0), [watchlistAlertBundles]);
  const homeAlertItems = useMemo<UnifiedAlertItem[]>(() => [
    ...savedBuildMonitorAlerts.filter((alert) => !alert.dismissedAt).map((alert) => ({ id: `build:${alert.id}`, source: "build" as const, sourceLabel: alert.buildName, kind: alert.kind, title: alert.title, message: alert.message, createdAt: alert.createdAt, read: Boolean(alert.readAt) })),
    ...watchlistAlertBundles.flatMap((bundle) => bundle.items.map((alert) => ({ id: `watchlist:${bundle.watchlistId}:${alert.id}`, source: "watchlist" as const, sourceLabel: bundle.watchlistName ?? "가격 추적", kind: alert.kind, title: WATCHLIST_ALERT_KIND_LABELS[alert.kind] ?? alert.kind, message: alert.message, createdAt: alert.createdAt, read: Boolean(alert.readAt) })))
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5), [savedBuildMonitorAlerts, watchlistAlertBundles]);
  const homeUnreadAlertCount = savedBuildUnreadAlertCount + watchlistUnreadAlertCount;
  const homeHasBuildAlerts = useMemo(() => savedBuildMonitorAlerts.some((alert) => !alert.dismissedAt), [savedBuildMonitorAlerts]);
  const homeHasWatchlistAlerts = useMemo(() => watchlistAlertBundles.some((bundle) => bundle.items.length > 0), [watchlistAlertBundles]);
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
    trackUsageEvent("app_open");
  }, []);

  useEffect(() => {
    if (view !== "editor" || new URLSearchParams(window.location.search).get("entry") !== "shared-generator") return;
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(GENERATOR_VARIANTS_DRAFT_TRANSFER_KEY);
      if (raw) window.sessionStorage.removeItem(GENERATOR_VARIANTS_DRAFT_TRANSFER_KEY);
    } catch {
      setToast("공유된 현재 결과를 편집기로 가져오지 못했습니다.");
      return;
    }
    if (!raw) return;
    try {
      const transfer = generatorVariantsDraftTransferFromUnknown(JSON.parse(raw));
      if (!transfer) {
        setToast("공유된 현재 결과의 draft를 읽지 못했습니다.");
        return;
      }
      if (transfer.mode === "save") {
        void saveGeneratedDraft(transfer.draft, transfer.origin ? savedBuildOriginForGeneratorVariantsTransfer(transfer.origin, transfer.draft.priority) : undefined);
      } else {
        void applyGeneratedDraft(transfer.draft, transfer.mode === "check");
      }
    } catch {
      setToast("공유된 현재 결과를 읽지 못했습니다.");
    }
  }, [view, locationKey]);

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
    let cancelled = false;
    let running = false;
    const syncWatchlistAlerts = async () => {
      if (cancelled || running) return;
      running = true;
      const syncVersion = ++watchlistAlertSyncVersionRef.current;
      try {
        const ownedLinks = readLocalSavedWatchlistLinks().filter((link) => Boolean(readSavedWatchlistOwnerToken(link.id)));
        const bundles = await Promise.all(ownedLinks.map(async (link) => {
          const token = readSavedWatchlistOwnerToken(link.id);
          if (!token) return undefined;
          try {
            const value = await api<{ items: HomeAlertItem[]; unreadCount: number }>(`/api/watchlists/${encodeURIComponent(link.id)}/alerts`, { headers: { "X-Share-Owner-Token": token }, retry: 1 });
            return { watchlistId: link.id, ...(link.name ? { watchlistName: link.name } : {}), items: value.items, unreadCount: value.unreadCount } satisfies WatchlistAlertBundle;
          } catch {
            return undefined;
          }
        }));
        if (cancelled || watchlistAlertSyncVersionRef.current !== syncVersion) return;
        setWatchlistAlertBundles(bundles.filter((bundle): bundle is WatchlistAlertBundle => bundle !== undefined));
      } finally {
        running = false;
      }
    };
    void syncWatchlistAlerts();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncWatchlistAlerts();
    }, SAVED_BUILD_SERVER_ALERT_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [view]);

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
      const upgradeEntry = new URLSearchParams(window.location.search).get("entry") === "upgrade";
      navigate(upgradeEntry ? "/result?entry=upgrade" : "/result", "result", { preservePendingCheck: true, preserveCatalogRefresh: options.catalogRefreshRequest !== undefined });
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
    try {
      const payload = await api<{ variants: GeneratorVariantResult[] }>("/api/builds/recommend/variants", {
        method: "POST",
        body: JSON.stringify(request),
        retry: 2,
        retryOnRateLimit: true
      });
      const receivedVariants = Array.isArray(payload.variants) ? payload.variants : [];
      const variants = RECOMMENDATION_VARIANT_PRIORITIES.map((priority) => receivedVariants.find((variant) => variant.priority === priority) ?? { priority, error: "서버가 이 비교 기준의 결과를 반환하지 않았습니다." });
      await Promise.all(variants.filter((variant) => variant.draft).map(async (variant) => {
        try {
          await rememberBuildSelection(variant.draft!.selection);
        } catch {
          // The generated comparison remains usable when local history storage is unavailable.
        }
      }));
      if (!isCurrent()) return;
      setGeneratorVariants(variants);
      if (isCurrent() && variants.every((variant) => !variant.draft)) setToast("세 가지 기준에서 모두 자동 구성을 만들지 못했습니다.");
    } catch (error: unknown) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : "세 가지 자동 구성 결과를 만들지 못했습니다.";
      setGeneratorError(message);
      setGeneratorDiagnostics(diagnosticsFromError(error));
      setGeneratorRecoveryOptions(recoveryOptionsFromError(error));
      setToast(message);
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
    const nextPreferences = { ...recommendationPreferences, profile: draft.profile, priority: draft.priority, performanceTier: draft.performanceTier, gamingResolution: draft.profile === "gaming" ? draft.gamingResolution : undefined, gamingRefreshRate: draft.profile === "gaming" ? draft.gamingRefreshRate : undefined, gamingGameIds: draft.profile === "gaming" ? draft.gamingGameIds : undefined, gamingGraphicsPreset: draft.profile === "gaming" ? draft.gamingGraphicsPreset : undefined, gamingRayTracing: draft.profile === "gaming" ? draft.gamingRayTracing : undefined, gamingUpscaling: draft.profile === "gaming" ? draft.gamingUpscaling : undefined, budgetWon: draft.budgetWon, listingPolicy: draft.listingPolicy };
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
      performanceTier: request.performanceTier,
      gamingResolution: request.profile === "gaming" ? request.gamingResolution ?? "1440p" : undefined,
      gamingRefreshRate: request.profile === "gaming" ? request.gamingRefreshRate ?? 144 : undefined,
      gamingGameIds: request.profile === "gaming" ? request.gamingGameIds : undefined,
      gamingGraphicsPreset: request.profile === "gaming" ? request.gamingGraphicsPreset : undefined,
      gamingRayTracing: request.profile === "gaming" ? request.gamingRayTracing : undefined,
      gamingUpscaling: request.profile === "gaming" ? request.gamingUpscaling : undefined
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

  async function saveGeneratedDraft(draft: BuildGenerationResult, origin?: SavedBuildOrigin) {
    const { generatedDraftSaveTargetFor } = await import("./generated-draft-save-target");
    requestSaveBuild(generatedDraftSaveTargetFor(draft, shareId && shareOwnerToken ? shareId : undefined, origin));
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
        body: JSON.stringify({ name, selection: targetBuild, recommendationPreferences: targetPreferences, expiresInDays: saveExpiryDays === "never" ? undefined : saveExpiryDays, ...(decisionNote ? { decisionNote } : {}), ...(target?.origin ? { origin: target.origin } : {}), ...(refreshReport ? { catalogRefreshReport: refreshReport } : {}), ...(parentOwnerToken && target?.parentBuildId ? { parentBuildId: target.parentBuildId } : {}) })
      });
      if (!isCurrent()) return;
      invalidateSavedBuildReads();
      setShareId(saved.id);
      setShareExpiresAt(saved.expiresAt ?? null);
      rememberSavedBuildOwnerToken(saved.id, saved.ownerToken);
      setShareOwnerToken(saved.ownerToken);
      if (saved.recoveryCode) setRecoveryCodeNotice({ code: saved.recoveryCode, buildName: name });
      rememberSavedBuildId(saved.id);
      const { ownerToken: _ownerToken, recoveryCode: _recoveryCode, ...publicSaved } = saved;
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

  async function issueRecoveryCodeFor(saved: SavedBuild) {
    if (recoveryCodeBusy) return;
    const token = readSavedBuildOwnerToken(saved.id);
    if (!token) {
      setToast("이 견적의 owner token이 이 브라우저에 없어 복구 코드를 만들 수 없습니다.");
      return;
    }
    setRecoveryCodeBusy(true);
    try {
      const result = await api<{ recoveryCode: string }>(`/api/builds/${encodeURIComponent(saved.id)}/recovery-code`, { method: "POST", headers: { "X-Share-Owner-Token": token }, retry: 0 });
      setRecoveryCodeNotice({ code: result.recoveryCode, buildName: saved.name });
    } catch (error: unknown) {
      setToast(error instanceof Error ? error.message : "복구 코드를 만들지 못했습니다.");
    } finally {
      setRecoveryCodeBusy(false);
    }
  }

  function savedBuildOwnershipRecovered(id: string, ownerToken: string) {
    rememberSavedBuildOwnerToken(id, ownerToken);
    rememberSavedBuildId(id);
    invalidateSavedBuildReads();
    void refreshSavedBuildsForBrowser();
    setToast("이 브라우저에서 견적 소유권을 되찾았습니다.");
  }

  async function toggleMyPcFor(saved: SavedBuild) {
    if (myPcBusyId) return;
    const token = readSavedBuildOwnerToken(saved.id);
    if (!token) {
      setToast("이 견적의 owner token이 이 브라우저에 없어 내 PC로 등록할 수 없습니다.");
      return;
    }
    const promote = !saved.myPcAt;
    setMyPcBusyId(saved.id);
    try {
      const updated = await api<SavedBuild>(`/api/builds/${encodeURIComponent(saved.id)}/my-pc`, { method: "PUT", headers: { "X-Share-Owner-Token": token }, body: JSON.stringify({ owned: promote }), retry: 0 });
      invalidateSavedBuildReads();
      setSavedBuilds((current) => current.map((item) => item.id === updated.id ? updated : item));
      setToast(promote ? `"${saved.name}"을 내 PC로 등록했습니다. 이제 더 좋은 부품이 카탈로그에 들어오면 알려드립니다.` : `"${saved.name}"의 내 PC 등록을 해제했습니다.`);
    } catch (error: unknown) {
      setToast(error instanceof Error ? error.message : "내 PC 등록을 변경하지 못했습니다.");
    } finally {
      setMyPcBusyId(null);
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
      setToast(`${CATEGORY_LABELS[part.category]} · ${eun(part.name)} 이미 현재 견적에 선택되어 있습니다.`);
      return;
    }
    updateBuildPart(part.category, { partId: part.id, quantity: 1 }, part);
    setToast(`${CATEGORY_LABELS[part.category]} · ${eul(part.name)} 현재 견적에 ${["memory", "ssd", "hdd"].includes(part.category) ? "추가" : "선택"}했습니다. 견적 검사에서 전체 호환성을 확인해 주세요.`);
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
      summary: `${eul(`${part.name}${quantityText}`)} 현재 견적에 미리 적용합니다. 현재 선택·검사 결과는 바뀌지 않습니다.`,
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
    setToast(`${eul(saved.name)} 현재 카탈로그 기준으로 다시 검사해 불러오는 중입니다.`);
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
      setToast(`${eul(item.name)} 견적에 추가하고 다시 검사했습니다.`);
      return;
    }
    setBuild(nextBuild);
    setToast(`${eul(item.name)} 견적에 추가했습니다.`);
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
    RequestErrorNotice,
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
    ChangeHistoryPanel,
    AccessoryVisual,
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

  const routeHasUpgradeEntry = new URLSearchParams(window.location.search).get("entry") === "upgrade";
  const upgradeEntry = view === "editor" && routeHasUpgradeEntry;
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
      alertItems={homeAlertItems}
      alertUnreadCount={homeUnreadAlertCount}
      hasBuildAlerts={homeHasBuildAlerts}
      hasWatchlistAlerts={homeHasWatchlistAlerts}
      onStart={() => navigate("/build", "editor")}
      onGuidedStart={() => navigate("/start", "start")}
      onGenerate={() => openGenerator()}
      onDemo={() => loadDemoBuild(demoBuild(), "문제가 있는 예시 견적을 불러왔습니다. 호환성 오류와 대체 부품을 확인해 보세요.")}
      onCompatibleDemo={() => loadDemoBuild(compatibleDemoBuild(), "문제 없는 예시 견적을 불러왔습니다. 업그레이드 부품과 조합 비교를 확인해 보세요.")}
      onResume={() => navigate("/build", "editor")}
      onOpenResult={() => navigate("/result", "result")}
      onOpenHistory={() => navigate("/history", "history")}
      onOpenWatchlist={() => navigate("/watchlist", "pricewatchlist")}
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
  ) : view === "start" ? (
    <Suspense fallback={<div className="shared-build-state"><FiLoader className="spin" /><span>시작 화면을 불러오는 중...</span></div>}>
      <LazyQuoteOnboardingView
        onFinish={(query) => navigate(`/recommend?${query}`, "generator")}
        onUpgrade={() => { navigate("/build?entry=upgrade", "editor"); setToast("지금 쓰는 부품을 골라 주세요. 검사 후 바꾸면 좋은 부품을 보여드려요."); }}
        onSkip={() => navigate("/", "home")}
        onHome={() => navigate("/", "home")}
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
    <Suspense fallback={<div className="shared-build-state"><FiLoader className="spin" /><span>견적 편집 화면을 불러오는 중...</span></div>}><LazyEditorView
      build={build}
      setBuild={setBuild}
      partMap={partMap}
      accessoryMap={accessoryMap}
      meta={meta}
      checking={checking}
      checkError={checkError}
      hasLastResult={Boolean(result)}
      upgradeEntry={upgradeEntry}
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
    /></Suspense>
  ) : view === "catalog" ? (
    <Suspense fallback={<div className="shared-build-state"><FiLoader className="spin" /><span>부품 카탈로그를 불러오는 중...</span></div>}><LazyCatalogView meta={meta} build={build} partMap={partMap} profile={recommendationPreferences.profile} gamingResolution={recommendationPreferences.gamingResolution} gamingRefreshRate={recommendationPreferences.gamingRefreshRate} onAddPart={addCatalogPart} onCompareParts={compareCatalogScenarios} compareReady={Boolean(result && !resultIsStale)} onWatchPart={watchPart} isPartWatched={partIsWatched} onOpenWatchlist={() => navigate("/watchlist", "pricewatchlist")} onOpenBuild={() => navigate("/build", "editor")} onOpenAccessories={(query) => navigate(query?.trim() ? `/accessories?q=${encodeURIComponent(query.trim())}` : "/accessories", "accessories")} onShareComparison={shareAlternativeComparison} onRevokeComparison={revokeAlternativeComparison} onToast={setToast} onBack={() => navigate("/", "home")} /></Suspense>
  ) : view === "accessories" ? (
    <Suspense fallback={<div className="accessory-page accessory-page-loading" role="status"><FiLoader className="spin" /> 주변 부품 카탈로그를 불러오는 중...</div>}><LazyAccessoryView meta={meta} accessoryItems={accessoryItems} selectedAccessories={accessorySelections(build)} onAddAccessory={(item) => void addAccessory(item)} onWatchAccessory={watchAccessory} isAccessoryWatched={accessoryIsWatched} onOpenWatchlist={() => navigate("/watchlist", "pricewatchlist")} onOpenBuild={() => navigate("/build", "editor")} onBack={() => navigate("/", "home")} onToast={setToast} formatWon={formatWon} AccessoryVisual={AccessoryVisual} /></Suspense>
  ) : view === "pricewatchlist" ? (
    <Suspense fallback={<div className="shared-build-state"><FiLoader className="spin" /><span>가격 추적 화면을 불러오는 중...</span></div>}><PriceWatchlistView onBack={() => navigate("/", "home")} onToast={setToast} /></Suspense>
  ) : view === "budget" ? (
    <Suspense fallback={<div className="shared-budget-ladder-state"><FiLoader className="spin" /> 공유 예산 비교 화면을 불러오는 중...</div>}><LazySharedBudgetLadderView onBack={() => navigate("/", "home")} onToast={setToast} onApplyDraft={applyGeneratedDraft} onApplyMergedSelection={applyMergedGeneratedSelection} onPreviewMergedSelection={previewMergedGeneratedSelection} onBudgetLadderShareSaved={rememberBudgetLadderShare} onBudgetLadderShareRevoked={forgetBudgetLadderShare} /></Suspense>
  ) : view === "generator-variants" ? (
    <Suspense fallback={<div className="shared-generator-variants-state"><FiLoader className="spin" /> 공유 자동 구성 비교 화면을 불러오는 중...</div>}><LazySharedGeneratorVariantsView onBack={() => navigate("/", "home")} onToast={setToast} /></Suspense>
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
    <Suspense fallback={<div className="shared-build-state"><FiLoader className="spin" /><span>저장된 견적을 불러오는 중...</span></div>}><LazyHistoryView
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
      onOpenRecoverOwnership={(saved) => setRecoverOwnershipTarget(saved ? { id: saved.id, name: saved.name } : "open")}
      onIssueRecoveryCode={(saved) => void issueRecoveryCodeFor(saved)}
      onToggleMyPc={(saved) => toggleMyPcFor(saved)}
      myPcBusyId={myPcBusyId}
      recoveryCodeBusy={recoveryCodeBusy}
      onToast={setToast}
    /></Suspense>
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
      onEdit={() => navigate(routeHasUpgradeEntry ? "/build?entry=upgrade" : "/build", "editor")}
      upgradeEntry={view === "result" && routeHasUpgradeEntry}
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
      <Suspense fallback={<AppHeaderLoadingFallback />}><LazyAppHeader view={view} networkOnline={networkOnline} apiStatus={apiStatusDetails} bootstrapLoading={bootstrapLoading} bootstrapErrorCount={bootstrapIssues.length} savedBuildUnreadAlertCount={savedBuildUnreadAlertCount} watchlistUnreadAlertCount={watchlistUnreadAlertCount} catalogRefreshProgress={catalogRefreshProgress} onHome={() => navigate("/", "home")} onBuild={() => navigate("/build", "editor")} onGenerate={() => openGenerator()} onCatalog={() => navigate("/catalog", "catalog")} onAccessories={() => navigate("/accessories", "accessories")} onPriceWatchlist={() => navigate("/watchlist", "pricewatchlist")} onHistory={() => navigate("/history", "history")} /></Suspense>
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
      {saveDialogOpen && <Suspense fallback={<div className="modal-backdrop" role="presentation"><section className="save-build-dialog" role="status"><FiLoader className="spin" /></section></div>}><LazySaveBuildDialog name={saveName} decisionNote={saveDecisionNote} targetLabel={saveBuildTarget?.label} targetKind={saveBuildTarget?.kind} saving={saving} expiryDays={saveExpiryDays} onChange={setSaveName} onDecisionNoteChange={setSaveDecisionNote} onExpiryChange={setSaveExpiryDays} onClose={() => { setSaveDialogOpen(false); setSaveBuildTarget(null); }} onSubmit={() => void saveBuild()} /></Suspense>}
      {recoveryCodeNotice && <Suspense fallback={<div className="modal-backdrop" role="presentation"><section className="save-build-dialog" role="status"><FiLoader className="spin" /></section></div>}><LazyRecoveryCodeDialog code={recoveryCodeNotice.code} buildName={recoveryCodeNotice.buildName} onClose={() => setRecoveryCodeNotice(null)} /></Suspense>}
      {recoverOwnershipTarget !== null && <Suspense fallback={<div className="modal-backdrop" role="presentation"><section className="save-build-dialog" role="status"><FiLoader className="spin" /></section></div>}><LazyRecoverOwnershipDialog target={recoverOwnershipTarget === "open" ? null : recoverOwnershipTarget} onClose={() => setRecoverOwnershipTarget(null)} onToast={setToast} onRecovered={savedBuildOwnershipRecovered} /></Suspense>}
      {metadataEditTarget && <Suspense fallback={<div className="modal-backdrop" role="presentation"><section className="save-build-dialog" role="status"><FiLoader className="spin" /></section></div>}><LazyEditSavedBuildMetadataDialog name={metadataEditName} decisionNote={metadataEditDecisionNote} saving={metadataSaving} onChange={setMetadataEditName} onDecisionNoteChange={setMetadataEditDecisionNote} onClose={() => { metadataMutationRequestRef.current += 1; setMetadataEditTarget(null); }} onSubmit={() => void updateSavedBuildMetadata()} /></Suspense>}
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

export default App;
