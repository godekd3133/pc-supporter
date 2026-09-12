import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { FiActivity, FiAlertTriangle, FiArrowLeft, FiArrowRight, FiCheckCircle, FiCopy, FiCpu, FiDownload, FiEdit3, FiExternalLink, FiInfo, FiLoader, FiPrinter, FiRefreshCw, FiSave, FiShare2, FiTool, FiTrash2, FiXCircle } from "react-icons/fi";
import type { AccessoryItem, AccessorySelection, BuildSelection, CompatibilityResult, Finding, Part, PartCategory, PartSelection, RecommendationPlan, RecommendationPreferences, SavedBuild, SavedBuildCheckSnapshot, SavedBuildPurchasePriceHistory, SavedBuildPurchaseProgress, SimilarityEvidence, UpgradeBudgetEvidence, UpgradeBundleRecommendation, UpgradeCompatibilityEvidence, UpgradeExpansionEvidence, UpgradeRecommendation } from "../shared/types";
import type { BuildHistoryEntry } from "../shared/build-history";
import type { BuildPriceSnapshot } from "../shared/build-price-summary";
import type { FindingFilter } from "../shared/finding-filters";
import type { AssemblyVerificationSurfaceSummary } from "../shared/assembly-verification";
import type { PurchaseChecklistProgress } from "../shared/purchase-checklist";
import type { PurchaseListExecutionProgress } from "../shared/purchase-list-progress";
import type { PurchaseItemStatus } from "../shared/purchase-list-status";
import type { PurchaseListRow } from "../shared/purchase-list";
import type { PurchaseListWatchTarget } from "../shared/purchase-list-watch";
import type { CatalogRefreshReport } from "../shared/catalog-refresh-report";
import type { RefreshTarget } from "../shared/refresh-targets";
import type { AlternativeComparisonCandidate } from "../shared/alternative-comparison-export";
import type { ResultFindingSuggestion } from "./ResultFindings";
import type { CandidateApplicationEvidence } from "../shared/candidate-application";
import type { BuildChangeResultComparison } from "../shared/build-change-result";
import { BuildChangeResultSummary } from "./BuildChangeResultSummary";
import type { UpgradeBundleScenarioPreviewState } from "./UpgradeBundleScenarioPreview";
import type { ResultSection } from "./result-view-state";
import type { UnknownPriceItem } from "./BuildPriceSummary";

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

type AlternativeComparisonShareContext = {
  name?: string;
  category?: string;
  currentPartName?: string;
  currentPartSummary?: string;
  currentPartPrice?: string;
  catalogSnapshotAt?: string;
  engineVersion?: string;
};

type AlternativeComparisonShareResult = {
  id: string;
  url: string;
  ownerToken: string;
  expiresAt?: string;
};

type PartWatchHandler = (part: Part) => boolean;
type AlternativeComparisonShareHandler = (candidates: AlternativeComparisonCandidate[], context?: AlternativeComparisonShareContext) => Promise<AlternativeComparisonShareResult | undefined>;
type AlternativeComparisonRevokeHandler = (share: AlternativeComparisonShareResult) => Promise<boolean>;

type ResultViewComponent = (props: any) => ReactNode;

export type ResultViewDependencies = {
  StaleResultView: ResultViewComponent;
  RequestErrorNotice: ResultViewComponent;
  BuildScenarioPreviewPanel: ResultViewComponent;
  LazyResultQuickNav: ResultViewComponent;
  LazySavedBuildRecheckDiffPanel: ResultViewComponent;
  LazyPurchaseReadinessPanel: ResultViewComponent;
  LazyBuildActionCenterPanel: ResultViewComponent;
  LazyAssemblyPlanPanel: ResultViewComponent;
  LazyUpgradeBundleScenarioPreviewPanel: ResultViewComponent;
  LazyPurchaseChecklistPanel: ResultViewComponent;
  LazyAssemblyVerificationPanel: ResultViewComponent;
  LazyRecommendationSearchNotice: ResultViewComponent;
  LazyBuildResourceSummaryPanel: ResultViewComponent;
  LazyBuildConnectivityPanel: ResultViewComponent;
  LazyGpuFitSummaryPanel: ResultViewComponent;
  LazyPurchaseListPanel: ResultViewComponent;
  LazyBenchmarkEvidencePanel: ResultViewComponent;
  LazyUpgradeBundlePanel: ResultViewComponent;
  LazyAccessoryCartPanel: ResultViewComponent;
  ResultFindingCard: ResultViewComponent;
  BuildPriceSummaryPanel: ResultViewComponent;
  RecommendationControls: ResultViewComponent;
  BuildHealthPanel: ResultViewComponent;
  M2SlotAssignmentPanel: ResultViewComponent;
  DataHealthPanel: ResultViewComponent;
  BuildWatchlistPanel: ResultViewComponent;
  ChangeHistoryPanel: ResultViewComponent;
  BuildAnalysisPanel: ResultViewComponent;
  UpgradeRecommendationPanel: ResultViewComponent;
  UpgradeRecommendationDetail: ResultViewComponent;
  AccessoryRecommendationPanel: ResultViewComponent;
  CompatibilityMap: ResultViewComponent;
  RepairPlanPanel: ResultViewComponent;
  SavedBuildCheckTimeline: ResultViewComponent;
  PartVisual: ResultViewComponent;
  AccessoryVisual: ResultViewComponent;
  PartWatchButton: ResultViewComponent;
  PartEvidence: ResultViewComponent;
  CategoryIcon: ResultViewComponent;
  purchaseListRowsFor: (build: BuildSelection, partMap: Map<string, Part>, accessoryMap: Map<string, AccessoryItem>) => PurchaseListRow[];
  selectionList: (build: BuildSelection, category: PartCategory) => PartSelection[];
  accessorySelections: (build: BuildSelection) => AccessorySelection[];
  unknownPriceItemsFor: (build: BuildSelection, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>) => UnknownPriceItem[];
  buildPriceSnapshotFor: (build: BuildSelection, partMap: ReadonlyMap<string, Part>, accessoryMap: ReadonlyMap<string, AccessoryItem>, extraParts?: Part[]) => BuildPriceSnapshot;
  upgradeBundlesFromPayload: (...args: any[]) => any;
  formatWon: (value: number | undefined) => string;
  formatPriceDelta: (value: number | undefined) => string;
  formatSignedPercent: (value: number) => string;
  formatSpecValue: (value: unknown) => string;
  partSummary: (part: Part | undefined) => string;
  similarityEvidenceText: (evidence?: SimilarityEvidence) => string;
  suggestionSpecRows: (part: Part) => Array<[string, unknown]>;
  upgradeCompatibilityStatus: (evidence: UpgradeCompatibilityEvidence) => string;
  upgradeCompatibilityText: (evidence: UpgradeCompatibilityEvidence) => string;
  upgradeBudgetText: (evidence: UpgradeBudgetEvidence | undefined) => string | undefined;
  upgradeExpansionText: (evidence: UpgradeExpansionEvidence | undefined) => string | undefined;
  upgradeExpansionTone: (evidence: UpgradeExpansionEvidence | undefined) => string;
  resultFindingFilterFromSearch: (search: string) => FindingFilter;
  resultSectionFromHash: (hash: string) => ResultSection | undefined;
  resultSectionTargetIds: Record<ResultSection, string>;
  resultViewUrlFor: (pathname: string, search: string, filter: FindingFilter, section: ResultSection) => string;
  findingFilterCounts: (findings: Finding[]) => Record<FindingFilter, number>;
  filteredFindingsFor: (findings: Finding[], filter: FindingFilter) => Finding[];
  FINDING_FILTERS: readonly FindingFilter[];
  RULE_GUIDES: Readonly<Record<string, string>>;
  CATEGORY_LABELS: Readonly<Record<PartCategory, string>>;
  LISTING_TYPE_LABELS: Readonly<Record<string, string>>;
  PART_CATEGORIES: readonly PartCategory[];
};
export type ResultViewProps = { build: BuildSelection; result: CompatibilityResult | null; resultIsStale: boolean; savedCheckHistory: SavedBuildCheckSnapshot[] | null; changeHistory: BuildHistoryEntry[]; onRestoreChange: (entry: BuildHistoryEntry) => void; partMap: Map<string, Part>; accessoryMap: Map<string, AccessoryItem>; shareId: string | null; decisionNote?: string; shareExpiresAt: string | null; shareOwnerToken?: string | null; shareOwnerTokenAvailable: boolean; recordingSavedCheck: boolean; revokingShare: boolean; checking: boolean; checkError: string | null; scenarioPreview: BuildScenarioPreviewState | null; buildChangeResultComparison?: BuildChangeResultComparison | null; onCopyBuildChangeResultComparison?: () => void; onDownloadBuildChangeResultComparison?: () => void; onSaveBuildChangeResultAsDecisionNote?: () => void; purchaseChecklistKey: string; upgradeBundleScenarioPreview: UpgradeBundleScenarioPreviewState | null; onPreviewSuggestion: (category: PartCategory, part: Part, quantity?: number, affectedPartIds?: string[], evidence?: CandidateApplicationEvidence) => void; onCompareSuggestions?: (suggestions: ResultFindingSuggestion[], affectedPartIds: string[]) => void; onDismissScenarioPreview: () => void; onDismissBuildChangeResultComparison?: () => void; onPreviewUpgradeBundle: (bundle: UpgradeBundleRecommendation) => void; onDismissUpgradeBundleScenarioPreview: () => void; onEdit: () => void; onCloneSharedBuild: () => void; onBack: () => void; onCheck: () => void; initialFindingRuleId?: string | null; onInitialFindingFocus?: () => void; onRecordSavedCheck?: () => void; onAssemblyVerificationSynced?: (saved: SavedBuild) => void; onPurchaseProgressSynced?: (progress?: SavedBuildPurchaseProgress) => void; onPurchasePriceHistorySynced?: (history?: SavedBuildPurchasePriceHistory) => void; onWatchEntry: (target: PurchaseListWatchTarget, targetPriceWon?: number) => boolean; isWatchedEntry: (target: Pick<PurchaseListWatchTarget, "kind" | "itemId">) => boolean; onRevokeShare: () => void; onSave: () => void; onCopyReport: () => void; onCopyResultLink: () => void; onDownloadReport: () => void; catalogRefreshReport?: CatalogRefreshReport | null; onRefreshCatalogItem: (target: RefreshTarget) => void; onRefreshAll: (targets: RefreshTarget[]) => void; refreshingPartId: string | null; onOpenPicker: (category: PartCategory, findingRuleId?: string, findingTitle?: string, affectedPartIds?: string[]) => void; onApplySuggestion: (category: PartCategory, part: Part, quantity?: number, affectedPartIds?: string[], evidence?: CandidateApplicationEvidence) => void; onApplyUpgradeBundle: (bundle: UpgradeBundleRecommendation) => void; onCopyPurchaseList: (checkedIds?: ReadonlySet<string>, rows?: PurchaseListRow[]) => void; onDownloadPurchaseList: (checkedIds?: ReadonlySet<string>, rows?: PurchaseListRow[]) => void; onOpenCatalogItem: (row: PurchaseListRow) => void; onApplyRepairPlan: (plan: RecommendationPlan) => void; onSavePlan: (build: BuildSelection, preferences: RecommendationPreferences, label: string, parentBuildId?: string) => void; onAddAccessory: (item: AccessoryItem) => void; onChangeAccessoryQuantity: (index: number, quantity: number) => void; onChangeAccessoryTarget: (index: number, targetPartId: string | undefined) => void; onChangeAccessoryHubTarget: (index: number, targetAccessoryId: string | undefined) => void; onChangeRgbController: (targetAccessoryId: string | undefined) => void; onRemoveAccessory: (index: number) => void; onToast: (message: string) => void; onWatchPart: PartWatchHandler; onShareComparison: AlternativeComparisonShareHandler; onRevokeComparison: AlternativeComparisonRevokeHandler; recommendationPreferences: RecommendationPreferences; onRecommendationPreferencesChange: (next: RecommendationPreferences) => void; onRecommendationPreferencesCommit: (next: RecommendationPreferences) => void
  dependencies: ResultViewDependencies;
};

export function ResultView(props: ResultViewProps) {
  const { dependencies, ...view } = props;
  const { build, result, resultIsStale, savedCheckHistory, changeHistory, onRestoreChange, partMap, accessoryMap, shareId, decisionNote, shareExpiresAt, shareOwnerToken, shareOwnerTokenAvailable, recordingSavedCheck, revokingShare, checking, checkError, scenarioPreview, buildChangeResultComparison, onCopyBuildChangeResultComparison, onDownloadBuildChangeResultComparison, onSaveBuildChangeResultAsDecisionNote, purchaseChecklistKey, upgradeBundleScenarioPreview, onPreviewSuggestion, onCompareSuggestions, onDismissScenarioPreview, onDismissBuildChangeResultComparison, onPreviewUpgradeBundle, onDismissUpgradeBundleScenarioPreview, onEdit, onCloneSharedBuild, onBack, onCheck, initialFindingRuleId, onInitialFindingFocus, onRecordSavedCheck, onAssemblyVerificationSynced, onPurchaseProgressSynced, onPurchasePriceHistorySynced, onWatchEntry, isWatchedEntry, onRevokeShare, onSave, onCopyReport, onCopyResultLink, onDownloadReport, catalogRefreshReport, onRefreshCatalogItem, onRefreshAll, refreshingPartId, onOpenPicker, onApplySuggestion, onApplyUpgradeBundle, onCopyPurchaseList, onDownloadPurchaseList, onOpenCatalogItem, onApplyRepairPlan, onSavePlan, onAddAccessory, onChangeAccessoryQuantity, onChangeAccessoryTarget, onChangeAccessoryHubTarget, onChangeRgbController, onRemoveAccessory, onToast, onWatchPart, onShareComparison, onRevokeComparison, recommendationPreferences, onRecommendationPreferencesChange, onRecommendationPreferencesCommit } = view;
  const { StaleResultView, RequestErrorNotice, BuildScenarioPreviewPanel, LazyResultQuickNav, LazySavedBuildRecheckDiffPanel, LazyPurchaseReadinessPanel, LazyBuildActionCenterPanel, LazyAssemblyPlanPanel, LazyUpgradeBundleScenarioPreviewPanel, LazyPurchaseChecklistPanel, LazyAssemblyVerificationPanel, LazyRecommendationSearchNotice, LazyBuildResourceSummaryPanel, LazyBuildConnectivityPanel, LazyGpuFitSummaryPanel, LazyPurchaseListPanel, LazyBenchmarkEvidencePanel, LazyUpgradeBundlePanel, LazyAccessoryCartPanel, ResultFindingCard, BuildPriceSummaryPanel, RecommendationControls, BuildHealthPanel, M2SlotAssignmentPanel, DataHealthPanel, BuildWatchlistPanel, ChangeHistoryPanel, BuildAnalysisPanel, UpgradeRecommendationPanel, UpgradeRecommendationDetail, AccessoryRecommendationPanel, CompatibilityMap, RepairPlanPanel, SavedBuildCheckTimeline, PartVisual, AccessoryVisual, PartWatchButton, PartEvidence, CategoryIcon, purchaseListRowsFor, selectionList, accessorySelections, unknownPriceItemsFor, buildPriceSnapshotFor, upgradeBundlesFromPayload, formatWon, formatPriceDelta, formatSignedPercent, formatSpecValue, partSummary, similarityEvidenceText, suggestionSpecRows, upgradeCompatibilityStatus, upgradeCompatibilityText, upgradeBudgetText, upgradeExpansionText, upgradeExpansionTone, resultFindingFilterFromSearch, resultSectionFromHash, resultSectionTargetIds, resultViewUrlFor, findingFilterCounts, filteredFindingsFor, FINDING_FILTERS, RULE_GUIDES, CATEGORY_LABELS, LISTING_TYPE_LABELS, PART_CATEGORIES } = dependencies;

const [findingFilter, setFindingFilter] = useState<FindingFilter>(() => resultFindingFilterFromSearch(window.location.search));
const [purchaseChecklistProgress, setPurchaseChecklistProgress] = useState<PurchaseChecklistProgress | null>(null);
const [purchaseListProgress, setPurchaseListProgress] = useState<PurchaseListExecutionProgress | null>(null);
const [purchaseListFocusStatus, setPurchaseListFocusStatus] = useState<PurchaseItemStatus | null>(null);
const [assemblyVerificationSummary, setAssemblyVerificationSummary] = useState<AssemblyVerificationSurfaceSummary | null>(null);
const onPurchaseListProgressChange = useCallback((progress: PurchaseListExecutionProgress) => {
  setPurchaseListProgress(progress);
}, []);
const savedVerificationHistory = useMemo(() => {
  const latestSnapshot = savedCheckHistory?.at(-1);
  return latestSnapshot?.assemblyVerificationHistory ?? (latestSnapshot?.assemblyVerification ? [latestSnapshot.assemblyVerification] : undefined);
}, [savedCheckHistory]);
useEffect(() => { setFindingFilter(resultFindingFilterFromSearch(window.location.search)); }, [result?.checkedAt]);
useEffect(() => { setPurchaseChecklistProgress(null); setPurchaseListProgress(null); setPurchaseListFocusStatus(null); setAssemblyVerificationSummary(null); }, [purchaseChecklistKey, result?.checkedAt]);
useEffect(() => {
  if (!scenarioPreview) return;
  const timer = window.setTimeout(() => {
    document.querySelector<HTMLElement>('[data-testid="build-scenario-preview"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 0);
  return () => window.clearTimeout(timer);
}, [scenarioPreview?.title]);
useEffect(() => {
  if (!result || resultIsStale) return;
  const focusHashTarget = () => {
    const section = resultSectionFromHash(window.location.hash);
    const targetId = section ? resultSectionTargetIds[section] : undefined;
    if (targetId) focusSection(targetId);
  };
  const onPopState = () => {
    setFindingFilter(resultFindingFilterFromSearch(window.location.search));
    focusHashTarget();
  };
  window.addEventListener("popstate", onPopState);
  focusHashTarget();
  return () => window.removeEventListener("popstate", onPopState);
}, [result?.checkedAt, resultIsStale]);
useEffect(() => {
  if (!result || resultIsStale || !initialFindingRuleId) return;
  focusFinding(initialFindingRuleId);
  onInitialFindingFocus?.();
}, [initialFindingRuleId, result?.checkedAt, resultIsStale]);
const findingCounts = result ? findingFilterCounts(result.findings) : { all: 0, blocker: 0, warning: 0, unknown: 0, info: 0 };
const visibleFindings = result ? filteredFindingsFor(result.findings, findingFilter) : [];
const findingFilterLabels: Record<FindingFilter, string> = { all: "전체", blocker: "차단 오류", warning: "주의", unknown: "확인 필요", info: "정보" };
function syncResultLocation(filter: FindingFilter, section: ResultSection) {
  const nextUrl = resultViewUrlFor(window.location.pathname, window.location.search, filter, section);
  const currentUrl = window.location.pathname + window.location.search + window.location.hash;
  if (currentUrl !== nextUrl) window.history.pushState(window.history.state, "", nextUrl);
}
function selectFindingFilter(filter: FindingFilter) {
  setFindingFilter(filter);
  syncResultLocation(filter, "findings");
}
function focusFindingFilter(filter: Exclude<FindingFilter, "all">) {
  selectFindingFilter(filter);
  focusSection("result-findings");
}
function focusFinding(ruleId: string) {
  selectFindingFilter("all");
  let attempts = 0;
  const focusTarget = () => {
    const target = document.getElementById(`finding-${ruleId}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
      return;
    }
    if (attempts >= 40) return;
    attempts += 1;
    window.setTimeout(focusTarget, 50);
  };
  window.setTimeout(focusTarget, 0);
}
function focusResultSection(targetId: string) {
  const section = (Object.entries(resultSectionTargetIds).find(([, candidate]) => candidate === targetId)?.[0] ?? undefined) as ResultSection | undefined;
  if (section) syncResultLocation(findingFilter, section);
  focusSection(targetId);
}
function focusSection(targetId: string) {
  let attempts = 0;
  let timer: number | undefined;
  const focusTarget = () => {
    const target = document.querySelector<HTMLElement>(`[data-testid="${targetId}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.focus({ preventScroll: true });
      return;
    }
    if (attempts >= 40) return;
    attempts += 1;
    timer = window.setTimeout(focusTarget, 50);
  };
  timer = window.setTimeout(focusTarget, 0);
}
async function addAccessoryAndFocus(item: AccessoryItem) {
  try {
    // The app-level handler rechecks the build before the result view receives
    // the updated selection. Keep this component compatible with existing
    // void callbacks while still awaiting that runtime Promise when present.
    const pending = onAddAccessory(item) as unknown;
    if (pending && typeof (pending as PromiseLike<void>).then === "function") {
      await pending;
    }
  } finally {
    focusSection("accessory-cart-panel");
  }
}
function focusRepairPlans() {
  const repairPlans = document.querySelector<HTMLElement>(".repair-plan-panel");
  if (repairPlans) {
    repairPlans.scrollIntoView({ behavior: "smooth", block: "start" });
    repairPlans.focus({ preventScroll: true });
    return;
  }
  onEdit();
}
if (!result) return <div className="empty-result"><FiActivity /><h1>아직 검사 결과가 없습니다.</h1><p>먼저 부품을 선택하고 호환성 검사를 실행해 주세요.</p><button className="button button-primary" onClick={onEdit}>견적 작성하기</button></div>;
if (resultIsStale) return <StaleResultView build={build} partMap={partMap} lastCheckedAt={result.checkedAt} checking={checking} checkError={checkError} entries={changeHistory} onRestore={onRestoreChange} onBack={onBack} onEdit={onEdit} onCheck={onCheck} />;
const accessoryStatus = result.accessoryCompatibility?.status;
const displayStatus: CompatibilityResult["status"] = result.status === "incompatible" || accessoryStatus === "incompatible"
  ? "incompatible"
  : result.status === "needs_review" || accessoryStatus === "needs_review"
    ? "needs_review"
    : "compatible";
const statusCopy = displayStatus === "incompatible"
  ? result.status === "incompatible" ? "호환이 불가능합니다." : "핵심 부품 확인과 함께 주변 부품을 수정해야 합니다."
  : displayStatus === "needs_review"
    ? result.status === "needs_review" ? "확인이 필요한 항목이 있습니다." : "핵심 부품은 호환되지만 주변 부품 확인이 필요합니다."
    : result.warningCount > 0 ? "호환 가능하지만 주의 항목이 있습니다." : "호환이 가능합니다.";
const statusDescription = displayStatus === "incompatible"
  ? result.status === "incompatible" ? "선택한 부품 조합에서 함께 사용할 수 없는 문제가 발견되었습니다." : "핵심 부품 규칙은 통과했지만 선택한 주변 부품의 장착 규격이 맞지 않습니다. 아래 주변 부품 점검을 확인해 주세요."
  : displayStatus === "needs_review"
    ? result.status === "needs_review" ? "차단 오류는 없지만 데이터가 부족해 완전히 확정하지 못한 항목이 있습니다." : "핵심 부품 규칙은 통과했지만 주변 부품 규격·수량을 확정할 정보가 부족합니다."
    : result.warningCount > 0 ? `차단 오류는 없지만 ${result.warningCount}개 주의 항목을 구매·조립 전에 확인해 주세요.` : "현재 등록된 부품 정보와 검사 규칙 기준으로 함께 사용할 수 있습니다.";
const coreTotalPriceWon = result.coreTotalPriceWon ?? Math.max(0, result.totalPriceWon - (result.accessoryTotalPriceWon ?? 0));
const corePriceComplete = result.corePriceComplete ?? result.priceComplete;
const accessoryTotalPriceWon = result.accessoryTotalPriceWon ?? 0;
const accessoryPriceComplete = result.accessoryPriceComplete ?? true;
const localPriceSnapshot = buildPriceSnapshotFor(build, partMap, accessoryMap);
const resultPriceSnapshot: BuildPriceSnapshot = {
  ...localPriceSnapshot,
  coreTotalPriceWon,
  corePriceComplete,
  accessoryTotalPriceWon,
  accessoryPriceComplete,
  totalPriceWon: result.totalPriceWon,
  priceComplete: result.priceComplete,
  unknownPriceCount: result.dataHealth?.unpricedCount ?? Math.max(localPriceSnapshot.unknownPriceCount, result.priceComplete ? 0 : 1)
};
const upgradeBundles = upgradeBundlesFromPayload(result.upgradeBundlePayload) ?? result.upgradeBundles;
const metricCards: Array<{ filter: Exclude<FindingFilter, "all">; tone: "danger" | "warning" | "unknown"; label: string; count: number; detail: string }> = [
  { filter: "blocker", tone: "danger", label: "차단 오류", count: result.blockerCount, detail: "반드시 해결해야 합니다" },
  { filter: "warning", tone: "warning", label: "주의 사항", count: result.warningCount, detail: "성능·안정성 확인 권장" },
  { filter: "unknown", tone: "unknown", label: "확인 필요", count: result.unknownCount, detail: "데이터가 부족합니다" }
];
return (
  <div className="result-page">
    <div className="mobile-result-toolbar"><button className="mobile-result-back" type="button" onClick={onBack} aria-label="홈으로"><FiArrowLeft /></button><div><span className="mobile-kicker">CHECK / RESULT</span><strong>검사 결과</strong></div><button className="mobile-result-share" type="button" onClick={onCopyResultLink} aria-label="결과 링크 복사"><FiShare2 /></button></div>
    <div className="result-toolbar">
      <button className="back-link" onClick={onBack}><FiArrowLeft /> 홈으로</button>
      <div className="result-actions"><button className="button button-ghost" onClick={onSave}><FiSave /> 견적 저장·공유</button>{shareId && shareOwnerTokenAvailable && <button className="button button-light" type="button" onClick={onRevokeShare} disabled={revokingShare}>{revokingShare ? <><FiLoader className="spin" /> 취소 중...</> : <><FiTrash2 /> 공유 링크 취소</>}</button>}<button className="button button-light result-link-copy-button" type="button" onClick={onCopyResultLink}><FiShare2 /> 결과 링크 복사</button><button className="button button-light" onClick={onCopyReport}><FiCopy /> 리포트 복사</button><button className="button button-light" onClick={onDownloadReport}><FiDownload /> JSON 저장</button><button className="button button-light result-print-button" type="button" onClick={() => window.print()}><FiPrinter /> 인쇄·PDF</button><button className="button button-secondary" data-testid={shareId && !shareOwnerTokenAvailable ? "shared-build-clone" : undefined} onClick={shareId && !shareOwnerTokenAvailable ? onCloneSharedBuild : onEdit}>{shareId && !shareOwnerTokenAvailable ? <><FiCopy /> 내 견적으로 복제</> : <><FiEdit3 /> 견적 수정</>}</button></div>
    </div>
    {checkError && <RequestErrorNotice message={checkError} onRetry={onCheck} retrying={checking} hasLastResult />}
    <section className={`result-hero ${displayStatus}`}>
      <div className="result-hero-main"><span className="result-status-icon">{displayStatus === "compatible" ? <FiCheckCircle /> : displayStatus === "needs_review" ? <FiAlertTriangle /> : <FiXCircle />}</span><div><p className="eyebrow">CHECK RESULT</p><h1>{statusCopy}</h1><p>{statusDescription}</p>{decisionNote && <div className="result-decision-note" data-testid="result-decision-note"><FiInfo /><div><span>선택 메모</span><strong>{decisionNote}</strong></div></div>}</div></div>
      <div className="result-version"><span>검사 시각</span><strong>{new Date(result.checkedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</strong><small>엔진 {result.engineVersion}</small><small>카탈로그 {new Date(result.catalogSnapshotAt).toLocaleDateString("ko-KR")}</small></div>
    </section>
    <div className="mobile-result-metric-strip" aria-label="검사 결과 요약">{metricCards.map((metric) => <button className={`mobile-result-metric ${metric.tone}`} type="button" aria-label={`${metric.label} ${metric.count}개. 해당 상세 판정 보기`} aria-pressed={findingFilter === metric.filter} disabled={metric.count === 0} onClick={() => focusFindingFilter(metric.filter)} key={metric.filter}><span>{metric.label}</span><strong>{metric.count}</strong></button>)}</div>
    <div className="mobile-result-actions"><button className="mobile-primary-action" type="button" onClick={onEdit}><FiEdit3 /><span>견적 수정하기</span><FiArrowRight className="mobile-result-action-arrow" /></button><div><button className="mobile-secondary-action" type="button" onClick={onSave}><FiSave /><span>견적 저장·공유</span><FiArrowRight className="mobile-result-action-arrow" /></button><button className="mobile-secondary-action" type="button" onClick={onCopyResultLink}><FiShare2 /><span>결과 링크 복사</span><FiArrowRight className="mobile-result-action-arrow" /></button></div></div>
    <details className="mobile-result-tools"><summary>리포트·공유 도구 더 보기</summary><div><button className="button button-light" type="button" onClick={onCopyReport}><FiCopy /> 리포트 복사</button><button className="button button-light" type="button" onClick={onDownloadReport}><FiDownload /> JSON 저장</button><button className="button button-light" type="button" onClick={() => window.print()}><FiPrinter /> 인쇄·PDF</button>{shareId && shareOwnerTokenAvailable && <button className="button button-light" type="button" onClick={onRevokeShare} disabled={revokingShare}>{revokingShare ? "취소 중..." : "공유 링크 취소"}</button>}</div></details>
    <Suspense fallback={null}><LazyResultQuickNav result={result} onFocusSection={focusResultSection} /></Suspense>
    {buildChangeResultComparison && <BuildChangeResultSummary comparison={buildChangeResultComparison} onDismiss={onDismissBuildChangeResultComparison ?? (() => undefined)} onCopy={onCopyBuildChangeResultComparison ?? (() => undefined)} onDownloadJson={onDownloadBuildChangeResultComparison ?? (() => undefined)} onSaveWithDecisionNote={onSaveBuildChangeResultAsDecisionNote} onFocusFinding={focusFinding} decisionSaveLabel={shareId && shareOwnerTokenAvailable ? "새 버전으로 저장" : "선택 이유에 첨부해 저장"} />}
    {shareId && savedCheckHistory && savedCheckHistory.length > 0 && <Suspense fallback={null}><LazySavedBuildRecheckDiffPanel snapshot={savedCheckHistory[savedCheckHistory.length - 1]} result={result} partMap={partMap} onFocusFinding={focusFinding} onPreviewSuggestion={onPreviewSuggestion} onFocusRepairPlans={focusRepairPlans} onFocusSection={focusResultSection} /></Suspense>}
    <div className="result-layout">
      <section className="findings-section">
        <div className="result-metrics">{metricCards.map((metric) => <button className={`metric-card ${metric.tone}${findingFilter === metric.filter ? " selected" : ""}`} type="button" aria-label={`${metric.label} ${metric.count}개. 해당 상세 판정 보기`} aria-pressed={findingFilter === metric.filter} disabled={metric.count === 0} onClick={() => focusFindingFilter(metric.filter)} key={metric.filter}><span>{metric.label}</span><strong>{metric.count}</strong><small>{metric.detail}</small></button>)}</div>
        <Suspense fallback={<div className="purchase-readiness-panel loading" aria-label="구매 준비도 로딩" role="status"><FiLoader className="spin" /> 구매 준비도와 최종 구매 판단을 준비하는 중...</div>}><LazyPurchaseReadinessPanel result={result} onEdit={onEdit} build={build} onChangeAccessoryHubTarget={onChangeAccessoryHubTarget} checklistProgress={purchaseChecklistProgress ?? undefined} purchaseProgress={purchaseListProgress ?? undefined} assemblyVerification={assemblyVerificationSummary ?? undefined} onFocusChecklist={() => focusResultSection("purchase-checklist")} onFocusPurchaseList={(status: PurchaseItemStatus | undefined) => { setPurchaseListFocusStatus(status ?? null); focusResultSection("purchase-list-panel"); }} onFocusAssemblyVerification={() => focusResultSection("assembly-verification-panel")} /></Suspense>
        <Suspense fallback={<div className="build-action-center loading" aria-label="우선 조치 목록 로딩" role="status"><FiLoader className="spin" /> 우선 조치 목록을 준비하는 중...</div>}><LazyBuildActionCenterPanel build={build} result={result} partMap={partMap} checklistStorageKey={`pc-supporter-purchase-checklist:${purchaseChecklistKey}:${result.engineVersion}:${result.catalogSnapshotAt}`} onFocusFinding={focusFinding} onFocusSection={focusResultSection} onFocusRepairPlans={focusRepairPlans} /></Suspense>
        <Suspense fallback={<div className="assembly-plan-panel loading" aria-label="구매·조립 실행 순서 로딩" role="status"><FiLoader className="spin" /> 구매·조립 실행 순서를 준비하는 중...</div>}><LazyAssemblyPlanPanel build={build} result={result} checklistProgress={purchaseChecklistProgress ?? undefined} purchaseProgress={purchaseListProgress ?? undefined} assemblyVerification={assemblyVerificationSummary ?? undefined} onFocusSection={focusResultSection} onFocusRepairPlans={focusRepairPlans} /></Suspense>
        {scenarioPreview && <BuildScenarioPreviewPanel preview={scenarioPreview} currentResult={result} onApply={() => onApplySuggestion(scenarioPreview.category, scenarioPreview.part, scenarioPreview.quantity, scenarioPreview.affectedPartIds, scenarioPreview.candidateEvidence)} onRetry={() => onPreviewSuggestion(scenarioPreview.category, scenarioPreview.part, scenarioPreview.quantity, scenarioPreview.affectedPartIds, scenarioPreview.candidateEvidence)} onClose={onDismissScenarioPreview} />}
        {upgradeBundleScenarioPreview && <Suspense fallback={<div className="upgrade-bundle-scenario-preview loading" aria-label="업그레이드 조합 가상 검증 로딩" role="status"><FiLoader className="spin" /> 업그레이드 조합을 검증하는 중...</div>}><LazyUpgradeBundleScenarioPreviewPanel state={upgradeBundleScenarioPreview} currentResult={result} onApply={() => onApplyUpgradeBundle(upgradeBundleScenarioPreview.bundle)} onRetry={() => onPreviewUpgradeBundle(upgradeBundleScenarioPreview.bundle)} onClose={onDismissUpgradeBundleScenarioPreview} formatWon={formatWon} /></Suspense>}
        <Suspense fallback={<div className="purchase-checklist-panel loading" aria-label="구매 전 실행 체크리스트 로딩" role="status"><FiLoader className="spin" /> 구매 전 체크리스트를 준비하는 중...</div>}><LazyPurchaseChecklistPanel build={build} result={result} partMap={partMap} storageKey={`pc-supporter-purchase-checklist:${purchaseChecklistKey}:${result.engineVersion}:${result.catalogSnapshotAt}`} onFocusFinding={focusFinding} onFocusSection={focusResultSection} onProgressChange={setPurchaseChecklistProgress} /></Suspense>
        <Suspense fallback={<div className="assembly-verification-panel loading" aria-label="실제 조립 검증 로그 로딩" role="status"><FiLoader className="spin" /> 실제 조립 검증 로그를 준비하는 중...</div>}><LazyAssemblyVerificationPanel storageKey={`pc-supporter-assembly-verification:${purchaseChecklistKey}:${result.engineVersion}:${result.catalogSnapshotAt}`} savedBuildId={shareId ?? undefined} savedBuildOwnerToken={shareOwnerToken ?? undefined} savedVerificationHistory={savedVerificationHistory} onServerSync={onAssemblyVerificationSynced} onSummaryChange={setAssemblyVerificationSummary} /></Suspense>
        {savedCheckHistory && savedCheckHistory.length > 0 && <SavedBuildCheckTimeline history={savedCheckHistory} buildId={shareId ?? undefined} partMap={partMap} accessoryMap={accessoryMap} canRecord={shareOwnerTokenAvailable && Boolean(shareId)} recording={recordingSavedCheck} onRecordCheck={onRecordSavedCheck} />}
        <RecommendationControls preferences={recommendationPreferences} onChange={onRecommendationPreferencesChange} onCommit={onRecommendationPreferencesCommit} commitOnChange={false} compact disabled={checking} />
        {result.recommendationSearch && <Suspense fallback={null}><LazyRecommendationSearchNotice search={result.recommendationSearch} findings={result.findings} onOpenPicker={onOpenPicker} /></Suspense>}
        <BuildHealthPanel metrics={result.metrics} gpuSelected={Boolean(build.gpu)} psuSelected={Boolean(build.psu)} caseSelected={Boolean(build.case)} />
        <Suspense fallback={<div className="build-resource-summary-panel loading" aria-label="전력·냉각 여유 로딩" role="status"><FiLoader className="spin" /> 전력·냉각 여유를 계산하는 중...</div>}><LazyBuildResourceSummaryPanel metrics={result.metrics} /></Suspense>
        <Suspense fallback={<div className="build-connectivity-panel loading" aria-label="팬·RGB 연결 자원 로딩" role="status"><FiLoader className="spin" /> 팬·RGB 연결 자원을 준비하는 중...</div>}><LazyBuildConnectivityPanel motherboard={build.motherboard ? partMap.get(build.motherboard.partId)?.specs : undefined} computerCase={build.case ? partMap.get(build.case.partId)?.specs : undefined} findings={result.findings} onFocusFinding={focusFinding} /></Suspense>
        {result.gpuFit && build.gpu && partMap.has(build.gpu.partId) && <Suspense fallback={<div className="gpu-fit-summary-panel loading" aria-label="GPU 실장·전원 요약 로딩" role="status">GPU 실장·전원 요약을 준비하는 중...</div>}><LazyGpuFitSummaryPanel fit={result.gpuFit} gpu={partMap.get(build.gpu.partId)!} computerCase={build.case ? partMap.get(build.case.partId) : undefined} psu={build.psu ? partMap.get(build.psu.partId) : undefined} /></Suspense>}
        {result.metrics.m2SlotAssignments && result.metrics.m2SlotAssignments.length > 0 && <M2SlotAssignmentPanel assignments={result.metrics.m2SlotAssignments} mode={result.metrics.m2SlotAssignmentMode} />}
        {result.dataHealth && <DataHealthPanel health={result.dataHealth} partMap={partMap} accessoryMap={accessoryMap} onRefresh={onRefreshCatalogItem} onRefreshAll={onRefreshAll} refreshingPartId={refreshingPartId} />}
        <Suspense fallback={<div className="purchase-list-panel loading" aria-label="구매 목록 로딩" role="status"><FiLoader className="spin" /> 구매 목록을 준비하는 중...</div>}><LazyPurchaseListPanel rows={purchaseListRowsFor(build, partMap, accessoryMap)} storageKey={`pc-supporter-purchase-list:${purchaseChecklistKey}:${result.engineVersion}:${result.catalogSnapshotAt}`} inputFingerprint={purchaseChecklistKey} budgetWon={recommendationPreferences.budgetWon} savedBuildId={shareId ?? undefined} savedBuildOwnerToken={shareOwnerToken ?? undefined} onCopy={onCopyPurchaseList} onDownload={onDownloadPurchaseList} focusStatus={purchaseListFocusStatus ?? undefined} onProgressChange={onPurchaseListProgressChange} onServerProgressChange={onPurchaseProgressSynced} onServerPriceHistoryChange={onPurchasePriceHistorySynced} onWatchEntry={onWatchEntry} isWatchedEntry={isWatchedEntry} onOpenCatalogItem={onOpenCatalogItem} onRefreshAll={onRefreshAll} refreshingItemId={refreshingPartId} catalogRefreshReport={catalogRefreshReport} /></Suspense>
        <BuildWatchlistPanel build={build} partMap={partMap} accessoryMap={accessoryMap} onToast={onToast} />
        <ChangeHistoryPanel entries={changeHistory} onRestore={onRestoreChange} restoring={checking} />
        <BuildAnalysisPanel analysis={result.analysis} />
        {(build.cpu || build.gpu) && <Suspense fallback={<div className="benchmark-evidence-panel loading" aria-label="원본 benchmark 근거 로딩" role="status"><FiLoader className="spin" /> 원본 benchmark 근거를 준비하는 중...</div>}><LazyBenchmarkEvidencePanel cpu={build.cpu ? partMap.get(build.cpu.partId) : undefined} gpu={build.gpu ? partMap.get(build.gpu.partId) : undefined} snapshot={result.benchmarkSnapshot} /></Suspense>}
        {result.upgradeRecommendations && result.upgradeRecommendations.length > 0 && <UpgradeRecommendationPanel recommendations={result.upgradeRecommendations} onApply={(recommendation: UpgradeRecommendation) => onApplySuggestion(recommendation.category, recommendation.part, undefined, [recommendation.currentPartId])} onPreview={(recommendation: UpgradeRecommendation) => onPreviewSuggestion(recommendation.category, recommendation.part, undefined, [recommendation.currentPartId])} onWatchPart={onWatchPart} />}
        {upgradeBundles && upgradeBundles.length > 0 && <Suspense fallback={<div className="upgrade-bundle-panel loading" aria-label="업그레이드 조합 패널 로딩" role="status"><FiLoader className="spin" /> 업그레이드 조합을 준비하는 중...</div>}><LazyUpgradeBundlePanel bundles={upgradeBundles} searchSummary={result.upgradeBundleSearch} catalogSnapshotAt={result.catalogSnapshotAt} onApply={onApplyUpgradeBundle} onPreview={onPreviewUpgradeBundle} formatPriceDelta={formatPriceDelta} upgradeCompatibilityStatus={upgradeCompatibilityStatus} upgradeCompatibilityText={upgradeCompatibilityText} upgradeBudgetText={upgradeBudgetText} upgradeExpansionText={upgradeExpansionText} upgradeExpansionTone={upgradeExpansionTone} Detail={UpgradeRecommendationDetail} /></Suspense>}
        {result.accessoryRecommendations && result.accessoryRecommendations.length > 0 && <AccessoryRecommendationPanel recommendations={result.accessoryRecommendations} selectedAccessories={accessorySelections(build)} onAddAccessory={addAccessoryAndFocus} onWatchAccessory={(item: AccessoryItem, targetPriceWon?: number) => onWatchEntry({ itemId: item.id, itemName: item.name, category: item.category, kind: "accessory" }, targetPriceWon)} isAccessoryWatched={(item: AccessoryItem) => isWatchedEntry({ itemId: item.id, kind: "accessory" })} />}
        <Suspense fallback={<div className="accessory-cart-panel loading" aria-label="주변 부품 목록 로딩" role="status">추가한 주변 부품을 준비하는 중...</div>}><LazyAccessoryCartPanel selections={accessorySelections(build)} accessoryMap={accessoryMap} partMap={partMap} ssdSelections={build.ssd} onChangeQuantity={onChangeAccessoryQuantity} onChangeTarget={onChangeAccessoryTarget} onChangeHubTarget={onChangeAccessoryHubTarget} onChangeRgbController={onChangeRgbController} rgbControllerAccessoryId={build.rgbControllerAccessoryId} rgbDeviceCount={build.case ? partMap.get(build.case.partId)?.specs.rgbDeviceCount : undefined} onRemove={onRemoveAccessory} AccessoryVisual={AccessoryVisual} /></Suspense>
        {result.links.length > 0 && <CompatibilityMap links={result.links} findings={result.findings} onFocusFinding={focusFinding} />}
        {result.repairPlans && result.repairPlans.length > 0 && <RepairPlanPanel plans={result.repairPlans} build={build} currentResult={result} partMap={partMap} onApply={onApplyRepairPlan} onSavePlan={(nextBuild: BuildSelection, nextPreferences: RecommendationPreferences, label: string) => onSavePlan(nextBuild, nextPreferences, label, shareOwnerTokenAvailable && shareId ? shareId : undefined)} onFocusFinding={(ruleId: string) => { setFindingFilter("all"); window.setTimeout(() => document.getElementById("finding-" + ruleId)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0); }} />}
        {result.findings.length === 0 ? <div className="success-empty" data-testid="result-findings" tabIndex={-1}><FiCheckCircle /><h2>모든 규칙을 통과했습니다.</h2><p>선택한 구성에서 현재 확인 가능한 충돌이 없습니다.</p><button className="button button-secondary" onClick={onEdit}>부품 구성 다시 보기</button></div> : <div className="findings-list" data-testid="result-findings" tabIndex={-1}><div className="section-title-row"><div><p className="eyebrow">DETAILED MESSAGE</p><h2>검사 결과 상세</h2></div><span className="muted-count">{visibleFindings.length} / {result.findings.length}개 항목</span></div><div className="finding-filter-controls" role="group" aria-label="검사 결과 필터">{FINDING_FILTERS.map((filter: FindingFilter) => <button className={findingFilter === filter ? "finding-filter-button selected" : "finding-filter-button"} type="button" aria-pressed={findingFilter === filter} disabled={filter !== "all" && findingCounts[filter] === 0} onClick={() => selectFindingFilter(filter)} key={filter}>{findingFilterLabels[filter]} <strong>{findingCounts[filter]}</strong></button>)}</div>{visibleFindings.length === 0 ? <div className="finding-filter-empty"><FiInfo /><span>선택한 심각도의 판정 항목이 없습니다.</span><button className="text-button" type="button" onClick={() => selectFindingFilter("all")}>전체 보기</button></div> : visibleFindings.map((finding: Finding) => <Suspense key={`${result.checkedAt}-${finding.id}`} fallback={<div className="finding-card-loading" aria-busy="true"><FiLoader className="spin" /> 판정 상세를 불러오는 중...</div>}><ResultFindingCard finding={finding} partMap={partMap} onOpenPicker={onOpenPicker} onEdit={onEdit} onApplySuggestion={onApplySuggestion} onPreviewSuggestion={onPreviewSuggestion} onCompareSuggestions={onCompareSuggestions} onFocusRepairPlans={focusRepairPlans} onToast={onToast} onWatchPart={onWatchPart} onShareComparison={onShareComparison} onRevokeComparison={onRevokeComparison} disabled={checking} ruleGuides={RULE_GUIDES} partSummary={partSummary} formatWon={formatWon} formatPriceDelta={formatPriceDelta} formatSignedPercent={formatSignedPercent} formatSpecValue={formatSpecValue} similarityEvidenceText={similarityEvidenceText} suggestionSpecRows={suggestionSpecRows} PartVisual={PartVisual} PartWatchButton={PartWatchButton} /></Suspense>)}</div>}
      </section>
      <aside className="result-sidebar"><div className="sticky-summary"><div className="summary-header"><div><p className="eyebrow">YOUR BUILD</p><h2>선택한 견적</h2></div><span className="summary-pulse"><FiCpu /></span></div><div className="build-mini-list">{PART_CATEGORIES.map((category: PartCategory) => { const selections = selectionList(build, category) as PartSelection[]; return <div className="build-mini-row" key={category}><span className="mini-category-icon"><CategoryIcon category={category} /></span><div><strong>{CATEGORY_LABELS[category]}</strong><span>{selections.length === 0 ? "미선택" : selections.map((selection: PartSelection) => `${partMap.get(selection.partId)?.name ?? selection.partId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`).join(", ")}</span></div></div>; })}{accessorySelections(build).length > 0 && <div className="build-mini-row"><span className="mini-category-icon"><FiTool /></span><div><strong>주변 부품</strong><span>{accessorySelections(build).length}종 · {accessorySelections(build).reduce((total: number, selection: AccessorySelection) => total + selection.quantity, 0)}개</span></div></div>}</div><div className="summary-divider" /><BuildPriceSummaryPanel snapshot={resultPriceSnapshot} budgetWon={recommendationPreferences.budgetWon} unknownItems={unknownPriceItemsFor(build, partMap, accessoryMap)} onRefresh={onRefreshCatalogItem} refreshingItemId={refreshingPartId} compact testId="result-price-summary" /><button className="button button-primary full-width" onClick={onEdit}><FiEdit3 /> 오류 수정하기</button><button className="button button-light full-width" onClick={onCheck} disabled={checking}>{checking ? <><FiLoader className="spin" /> 다시 검사 중...</> : <><FiRefreshCw /> 같은 구성 다시 검사</>}</button>{shareId && <p className="share-ready"><FiShare2 /> 공유 링크가 생성되었습니다. {shareExpiresAt ? `만료 ${new Date(shareExpiresAt).toLocaleString("ko-KR")}` : "무기한"}</p>}</div></aside>
    </div>
  </div>
);
}
