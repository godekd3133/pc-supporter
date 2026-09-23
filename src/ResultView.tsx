import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FiActivity, FiAlertTriangle, FiArrowLeft, FiArrowRight, FiCheckCircle, FiCopy, FiCpu, FiDownload, FiEdit3, FiExternalLink, FiGitBranch, FiInfo, FiLoader, FiMoreHorizontal, FiPrinter, FiRefreshCw, FiSave, FiShare2, FiTool, FiTrash2, FiXCircle, FiZap } from "react-icons/fi";
import type { AccessoryItem, AccessorySelection, BuildSelection, CompatibilityResult, Finding, Part, PartCategory, PartSelection, RecommendationPlan, RecommendationPreferences, SavedBuild, SavedBuildCheckSnapshot, SavedBuildPurchasePriceHistory, SavedBuildPurchaseProgress, SimilarityEvidence, UpgradeBudgetEvidence, UpgradeBundleRecommendation, UpgradeCompatibilityEvidence, UpgradeExpansionEvidence, UpgradeRecommendation } from "../shared/types";
import type { BuildHistoryEntry } from "../shared/build-history";
import type { BuildTransferDiffRow } from "../shared/build-transfer-diff";
import type { SavedBuildVersionDelta } from "../shared/saved-build-version-delta";
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
import type { SavedBuildOrigin } from "../shared/saved-build-origin";
import { savedBuildOriginDetailFor, savedBuildOriginLabelFor } from "../shared/saved-build-origin";
import { BuildChangeResultSummary } from "./BuildChangeResultSummary";
import { BuildPriceTrendPanel } from "./BuildPriceTrendPanel";
import type { UpgradeBundleScenarioPreviewState } from "./UpgradeBundleScenarioPreview";
import type { ResultSection } from "./result-view-state";
import type { UnknownPriceItem } from "./BuildPriceSummary";
import { PartVisual, PartWatchButton } from "./part-visuals";
import { AccessoryRecommendationPanel, BuildHealthPanel, BuildScenarioPreviewPanel, BuildWatchlistPanel, CompatibilityMap, M2SlotAssignmentPanel, RepairPlanPanel, StaleResultView, UpgradeRecommendationDetail, UpgradeRecommendationPanel, upgradeBudgetText, upgradeCompatibilityStatus, upgradeCompatibilityText, upgradeExpansionText, upgradeExpansionTone } from "./ResultPanels";
import { GamingPerformanceEvidencePanel } from "./GamingPerformanceEvidencePanel";
import { SavedBuildCheckTimeline } from "./SavedCheckTimeline";
import { api } from "./api";
import { GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY } from "../shared/generator-variants-local-share";

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
  RequestErrorNotice: ResultViewComponent;
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
  ChangeHistoryPanel: ResultViewComponent;
  AccessoryVisual: ResultViewComponent;
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
export type ResultViewSavedVersionContext = { versionNumber: number; parentName?: string; derivedFromBuildId?: string; versionGroupId?: string; delta?: SavedBuildVersionDelta; selectionChanges?: Array<Pick<BuildTransferDiffRow, "label" | "before" | "after">> };
export type ResultViewProps = { build: BuildSelection; result: CompatibilityResult | null; resultIsStale: boolean; savedCheckHistory: SavedBuildCheckSnapshot[] | null; changeHistory: BuildHistoryEntry[]; onRestoreChange: (entry: BuildHistoryEntry) => void; partMap: Map<string, Part>; accessoryMap: Map<string, AccessoryItem>; shareId: string | null; decisionNote?: string; origin?: SavedBuildOrigin; savedVersionContext?: ResultViewSavedVersionContext; onOpenHistory?: () => void; shareExpiresAt: string | null; shareOwnerToken?: string | null; shareOwnerTokenAvailable: boolean; recordingSavedCheck: boolean; revokingShare: boolean; checking: boolean; checkError: string | null; scenarioPreview: BuildScenarioPreviewState | null; buildChangeResultComparison?: BuildChangeResultComparison | null; onCopyBuildChangeResultComparison?: () => void; onDownloadBuildChangeResultComparison?: () => void; onSaveBuildChangeResultAsDecisionNote?: () => void; purchaseChecklistKey: string; upgradeBundleScenarioPreview: UpgradeBundleScenarioPreviewState | null; onPreviewSuggestion: (category: PartCategory, part: Part, quantity?: number, affectedPartIds?: string[], evidence?: CandidateApplicationEvidence) => void; onCompareSuggestions?: (suggestions: ResultFindingSuggestion[], affectedPartIds: string[]) => void; onDismissScenarioPreview: () => void; onDismissBuildChangeResultComparison?: () => void; onPreviewUpgradeBundle: (bundle: UpgradeBundleRecommendation) => void; onDismissUpgradeBundleScenarioPreview: () => void; onEdit: () => void; upgradeEntry?: boolean; onCloneSharedBuild: () => void; onBack: () => void; onCheck: () => void; initialFindingRuleId?: string | null; onInitialFindingFocus?: () => void; onRecordSavedCheck?: () => void; onAssemblyVerificationSynced?: (saved: SavedBuild) => void; onPurchaseProgressSynced?: (progress?: SavedBuildPurchaseProgress) => void; onPurchasePriceHistorySynced?: (history?: SavedBuildPurchasePriceHistory) => void; onWatchEntry: (target: PurchaseListWatchTarget, targetPriceWon?: number) => boolean; isWatchedEntry: (target: Pick<PurchaseListWatchTarget, "kind" | "itemId">) => boolean; onRevokeShare: () => void; onSave: () => void; onCopyReport: () => void; onCopyResultLink: () => void; onDownloadReport: () => void; catalogRefreshReport?: CatalogRefreshReport | null; onRefreshCatalogItem: (target: RefreshTarget) => void; onRefreshAll: (targets: RefreshTarget[]) => void; refreshingPartId: string | null; onOpenPicker: (category: PartCategory, findingRuleId?: string, findingTitle?: string, affectedPartIds?: string[]) => void; onApplySuggestion: (category: PartCategory, part: Part, quantity?: number, affectedPartIds?: string[], evidence?: CandidateApplicationEvidence) => void; onApplyUpgradeBundle: (bundle: UpgradeBundleRecommendation) => void; onCopyPurchaseList: (checkedIds?: ReadonlySet<string>, rows?: PurchaseListRow[]) => void; onDownloadPurchaseList: (checkedIds?: ReadonlySet<string>, rows?: PurchaseListRow[]) => void; onOpenCatalogItem: (row: PurchaseListRow) => void; onApplyRepairPlan: (plan: RecommendationPlan) => void; onSavePlan: (build: BuildSelection, preferences: RecommendationPreferences, label: string, parentBuildId?: string) => void; onAddAccessory: (item: AccessoryItem) => void; onChangeAccessoryQuantity: (index: number, quantity: number) => void; onChangeAccessoryTarget: (index: number, targetPartId: string | undefined) => void; onChangeAccessoryHubTarget: (index: number, targetAccessoryId: string | undefined) => void; onChangeRgbController: (targetAccessoryId: string | undefined) => void; onRemoveAccessory: (index: number) => void; onToast: (message: string) => void; onWatchPart: PartWatchHandler; onShareComparison: AlternativeComparisonShareHandler; onRevokeComparison: AlternativeComparisonRevokeHandler; recommendationPreferences: RecommendationPreferences; onRecommendationPreferencesChange: (next: RecommendationPreferences) => void; onRecommendationPreferencesCommit: (next: RecommendationPreferences) => void
  dependencies: ResultViewDependencies;
};

function signedResultDelta(value: number | undefined) {
  if (value === undefined) return "확인 필요";
  return value === 0 ? "변화 없음" : `${value > 0 ? "+" : ""}${value}`;
}

function resultFindingChangeLabel(change: NonNullable<SavedBuildVersionDelta["findingChanges"]>[number]["change"]) {
  return change === "resolved" ? "해결" : change === "new" ? "신규" : change === "severity_changed" ? "중요도 변경" : "내용 변경";
}

function ResultVersionChangeDetails({ context, partMap, accessoryPurchaseRows, onFocusSection, onFocusAccessoryPurchase }: { context: ResultViewSavedVersionContext; partMap: ReadonlyMap<string, Part>; accessoryPurchaseRows: PurchaseListRow[]; onFocusSection: (targetId: string) => void; onFocusAccessoryPurchase: (accessoryId: string) => void }) {
  const coreFindingChanges = context.delta?.findingChanges ?? [];
  const accessoryFindingChanges = context.delta?.accessoryFindingChanges ?? [];
  return <section className="result-version-change-details" data-testid="result-version-change-details" aria-label="부모 버전 대비 실제 변경 항목">
    <div className="result-version-change-column">
      <strong>변경된 구성</strong>
      {(context.selectionChanges?.length ?? 0) > 0 ? context.selectionChanges?.slice(0, 3).map((change) => <span key={change.label}><b>{change.label}</b>{change.before} → {change.after}</span>) : <span className="empty">구성 변화 없음</span>}
    </div>
    <div className="result-version-change-column">
      <strong>변경된 호환성 결과</strong>
      {coreFindingChanges.length > 0 ? coreFindingChanges.slice(0, 3).map((change) => <span key={`${change.change}-${change.title}`}><em className={change.change}>{resultFindingChangeLabel(change.change)}</em>{change.title}{change.affectedPartIds.length > 0 && <small>영향 부품 · {change.affectedPartIds.slice(0, 3).map((partId) => partMap.get(partId)?.name ?? partId).join(", ")}{change.affectedPartIds.length > 3 ? ` 외 ${change.affectedPartIds.length - 3}개` : ""}</small>}</span>) : accessoryFindingChanges.length === 0 && <span className="empty">저장 검사 항목 변화 없음</span>}
      {accessoryFindingChanges.length > 0 && <div className="result-version-accessory-findings"><strong>주변 부품 결과</strong>{accessoryFindingChanges.slice(0, 3).map((change, index) => <span key={`${change.change}-${change.accessoryId}-${change.title}`}><em className={change.change}>{resultFindingChangeLabel(change.change)}</em>{change.title}<small>{change.accessoryName}{change.relatedPartIds.length > 0 ? ` · 연결 부품 ${change.relatedPartIds.slice(0, 3).map((partId) => partMap.get(partId)?.name ?? partId).join(", ")}` : ""}{accessoryPurchaseRows.some((row) => row.sourceId === change.accessoryId) ? " · 구매 목록 항목 확인 가능" : ""}</small><div className="result-version-accessory-actions"><button className="text-button" type="button" data-testid={`result-version-accessory-purchase-${change.accessoryId}-${index}`} onClick={() => onFocusAccessoryPurchase(change.accessoryId)}>구매 목록 보기 <FiExternalLink /></button><button className="text-button" type="button" data-testid={`result-version-accessory-connection-${change.accessoryId}-${index}`} onClick={() => onFocusSection("build-connectivity-panel")}>연결 자원 보기 <FiTool /></button></div></span>)}</div>}
    </div>
  </section>;
}

function UpgradeEntryResultSummary({ result, bundleCount }: { result: CompatibilityResult; bundleCount: number }) {
  const recommendationCount = result.upgradeRecommendations?.length ?? 0;
  const issueCount = result.blockerCount + result.warningCount + result.unknownCount;
  const issueText = result.blockerCount > 0
    ? `호환을 막는 문제 ${result.blockerCount}개를 먼저 해결해야 해요.`
    : issueCount > 0
      ? `현재 구성에서 확인할 항목 ${issueCount}개를 찾았어요.`
      : "현재 구성에서 차단되는 호환 문제는 찾지 못했어요.";
  const focusRecommendations = () => {
    const details = document.querySelector<HTMLDetailsElement>(".result-more-details");
    if (details) details.open = true;
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>("[data-testid=upgrade-recommendation-panel]");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    }, 0);
  };
  return <section className="upgrade-entry-result-summary" data-testid="upgrade-entry-result-summary" aria-label="업그레이드 검사 요약">
    <div className="upgrade-entry-result-summary-heading"><div><p className="eyebrow">UPGRADE PLAN</p><h2>지금 구성에서 바꿔볼 순서</h2><p>현재 부품을 기준으로 문제 원인과 호환을 유지하는 업그레이드 선택지를 정리했어요.</p></div><FiRefreshCw /></div>
    <div className="upgrade-entry-result-summary-steps"><div className={issueCount > 0 ? "review" : "done"}><span><FiAlertTriangle /></span><div><strong>1. 현재 상태 확인</strong><small>{issueText}</small></div><em>{issueCount > 0 ? "확인 필요" : "문제 없음"}</em></div><div className={recommendationCount > 0 ? "ready" : "empty"}><span><FiZap /></span><div><strong>2. 교체 후보 비교</strong><small>{recommendationCount > 0 ? `부품 단위 추천 ${recommendationCount}개${bundleCount > 0 ? ` · 조합 추천 ${bundleCount}개` : ""}` : "현재 데이터로 안전한 교체 후보를 만들지 못했어요."}</small></div><em>{recommendationCount > 0 ? "준비됨" : "확인 필요"}</em></div><div className="next"><span><FiCheckCircle /></span><div><strong>3. 새 구성 적용</strong><small>원하는 부품을 견적에 적용해요.</small></div><em>다음 단계</em></div></div>{recommendationCount > 0 && <button className="button button-secondary upgrade-entry-result-summary-cta" type="button" onClick={focusRecommendations}><FiArrowRight /> 업그레이드 후보 바로 보기</button>}<p className="upgrade-entry-result-summary-note"><FiInfo /> 선택한 부품과 예상 가격을 확인해 주세요.</p>
  </section>;
}

export function ResultView(props: ResultViewProps) {
  const { dependencies, ...view } = props;
  const { build, result, resultIsStale, savedCheckHistory, changeHistory, onRestoreChange, partMap, accessoryMap, shareId, decisionNote, origin, savedVersionContext, onOpenHistory, shareExpiresAt, shareOwnerToken, shareOwnerTokenAvailable, recordingSavedCheck, revokingShare, checking, checkError, scenarioPreview, buildChangeResultComparison, onCopyBuildChangeResultComparison, onDownloadBuildChangeResultComparison, onSaveBuildChangeResultAsDecisionNote, purchaseChecklistKey, upgradeBundleScenarioPreview, onPreviewSuggestion, onCompareSuggestions, onDismissScenarioPreview, onDismissBuildChangeResultComparison, onPreviewUpgradeBundle, onDismissUpgradeBundleScenarioPreview, onEdit, upgradeEntry, onCloneSharedBuild, onBack, onCheck, initialFindingRuleId, onInitialFindingFocus, onRecordSavedCheck, onAssemblyVerificationSynced, onPurchaseProgressSynced, onPurchasePriceHistorySynced, onWatchEntry, isWatchedEntry, onRevokeShare, onSave, onCopyReport, onCopyResultLink, onDownloadReport, catalogRefreshReport, onRefreshCatalogItem, onRefreshAll, refreshingPartId, onOpenPicker, onApplySuggestion, onApplyUpgradeBundle, onCopyPurchaseList, onDownloadPurchaseList, onOpenCatalogItem, onApplyRepairPlan, onSavePlan, onAddAccessory, onChangeAccessoryQuantity, onChangeAccessoryTarget, onChangeAccessoryHubTarget, onChangeRgbController, onRemoveAccessory, onToast, onWatchPart, onShareComparison, onRevokeComparison, recommendationPreferences, onRecommendationPreferencesChange, onRecommendationPreferencesCommit } = view;
  const { RequestErrorNotice, LazyResultQuickNav, LazySavedBuildRecheckDiffPanel, LazyPurchaseReadinessPanel, LazyBuildActionCenterPanel, LazyAssemblyPlanPanel, LazyUpgradeBundleScenarioPreviewPanel, LazyPurchaseChecklistPanel, LazyAssemblyVerificationPanel, LazyRecommendationSearchNotice, LazyBuildResourceSummaryPanel, LazyBuildConnectivityPanel, LazyGpuFitSummaryPanel, LazyPurchaseListPanel, LazyBenchmarkEvidencePanel, LazyUpgradeBundlePanel, LazyAccessoryCartPanel, ResultFindingCard, BuildPriceSummaryPanel, RecommendationControls, ChangeHistoryPanel, AccessoryVisual, PartEvidence, CategoryIcon, purchaseListRowsFor, selectionList, accessorySelections, unknownPriceItemsFor, buildPriceSnapshotFor, upgradeBundlesFromPayload, formatWon, formatPriceDelta, formatSignedPercent, formatSpecValue, partSummary, similarityEvidenceText, suggestionSpecRows, resultFindingFilterFromSearch, resultSectionFromHash, resultSectionTargetIds, resultViewUrlFor, findingFilterCounts, filteredFindingsFor, FINDING_FILTERS, RULE_GUIDES, CATEGORY_LABELS, LISTING_TYPE_LABELS, PART_CATEGORIES } = dependencies;

const [findingFilter, setFindingFilter] = useState<FindingFilter>(() => resultFindingFilterFromSearch(window.location.search));
const [purchaseChecklistProgress, setPurchaseChecklistProgress] = useState<PurchaseChecklistProgress | null>(null);
const [purchaseListProgress, setPurchaseListProgress] = useState<PurchaseListExecutionProgress | null>(null);
const [purchaseListFocusStatus, setPurchaseListFocusStatus] = useState<PurchaseItemStatus | null>(null);
const [purchaseFocusRowKey, setPurchaseFocusRowKey] = useState<string | undefined>(undefined);
  const [assemblyVerificationSummary, setAssemblyVerificationSummary] = useState<AssemblyVerificationSurfaceSummary | null>(null);
  const [originAvailability, setOriginAvailability] = useState<"none" | "checking" | "active" | "unavailable">("none");
  const originSourceShareId = origin?.kind === "shared_generator_variants" ? origin.sourceShareId : undefined;
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
    if (!originSourceShareId) {
      setOriginAvailability("none");
      return;
    }
    let cancelled = false;
    const refresh = () => {
      setOriginAvailability("checking");
      void api(`/api/generator-variants/${encodeURIComponent(originSourceShareId)}`, { retry: 0 })
        .then(() => { if (!cancelled) setOriginAvailability("active"); })
        .catch(() => { if (!cancelled) setOriginAvailability("unavailable"); });
    };
    const onStorage = (event: StorageEvent) => { if (event.key === GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY) refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60_000);
    refresh();
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [originSourceShareId]);
const moreToolsRef = useRef<HTMLDetailsElement | null>(null);
useEffect(() => {
  const closeOnOutsidePointer = (event: PointerEvent) => {
    const details = moreToolsRef.current;
    if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
  };
  const closeOnEscape = (event: KeyboardEvent) => {
    const details = moreToolsRef.current;
    if (event.key === "Escape" && details?.open) details.open = false;
  };
  document.addEventListener("pointerdown", closeOnOutsidePointer);
  document.addEventListener("keydown", closeOnEscape);
  return () => {
    document.removeEventListener("pointerdown", closeOnOutsidePointer);
    document.removeEventListener("keydown", closeOnEscape);
  };
}, []);
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
function openAncestorDetails(target: HTMLElement) {
  let details = target.closest("details");
  while (details) {
    if (!details.open) details.open = true;
    details = details.parentElement?.closest("details") ?? null;
  }
}
function focusSection(targetId: string) {
  let attempts = 0;
  let timer: number | undefined;
  const focusTarget = () => {
    const target = document.querySelector<HTMLElement>(`[data-testid="${targetId}"]`);
    if (target) {
      openAncestorDetails(target);
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
function focusAccessoryPurchase(accessoryId: string) {
  const rowIndex = accessoryPurchaseRows.findIndex((row) => row.sourceKind === "accessory" && row.sourceId === accessoryId);
  const purchaseRow = rowIndex >= 0 ? accessoryPurchaseRows[rowIndex] : undefined;
  setPurchaseFocusRowKey(purchaseRow?.id);
  focusResultSection("purchase-list-panel");
  if (rowIndex < 0) return;
  let attempts = 0;
  const focusTarget = () => {
    const target = [...document.querySelectorAll<HTMLElement>('[data-testid="purchase-list-row"]')].find((row) => row.dataset.purchaseRowKey === purchaseRow?.id) ?? [...document.querySelectorAll<HTMLElement>('[data-testid="purchase-list-row"]')].find((row) => row.querySelector("strong")?.textContent?.trim() === purchaseRow?.name) ?? document.getElementById(`purchase-list-row-${rowIndex}`);
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
    openAncestorDetails(repairPlans);
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
  ? result.status === "incompatible" ? "같이 쓸 수 없는 부품이 있어요." : "주변 부품도 확인이 필요해요."
  : displayStatus === "needs_review"
    ? result.status === "needs_review" ? "호환 여부를 알 수 없는 부품이 있어요." : "주변 부품의 장착 규격이 맞지 않아요."
    : result.warningCount > 0 ? "쓸 수 있지만 확인할 항목이 있어요." : "같이 쓸 수 있는 조합이에요.";
const statusDescription = displayStatus === "incompatible"
  ? result.status === "incompatible" ? "호환되지 않는 부품을 확인하고 바꿔보세요." : "주변 부품의 장착 규격을 확인해 주세요."
  : displayStatus === "needs_review"
    ? result.status === "needs_review" ? "부품 사양이 부족해 호환 여부를 알 수 없어요." : "주변 부품의 규격과 수량을 살펴봐 주세요."
    : result.warningCount > 0 ? `구매 전에 살펴볼 항목이 ${result.warningCount}개 있어요.` : "현재 구성으로 사용할 수 있어요.";
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
const accessoryPurchaseRows = purchaseListRowsFor(build, partMap, accessoryMap).filter((row) => row.sourceKind === "accessory");
  const metricCards: Array<{ filter: Exclude<FindingFilter, "all">; tone: "danger" | "warning" | "unknown"; label: string; count: number }> = [
  { filter: "blocker", tone: "danger", label: "호환 오류", count: result.blockerCount },
  { filter: "warning", tone: "warning", label: "주의", count: result.warningCount },
  { filter: "unknown", tone: "unknown", label: "정보 부족", count: result.unknownCount }
];
return (
  <div className="result-page">
    <div className="mobile-result-toolbar"><button className="mobile-result-back" type="button" onClick={onBack} aria-label="홈으로"><FiArrowLeft /></button><div><span className="mobile-kicker">호환 결과</span><strong>호환 결과</strong></div><button className="mobile-result-share" type="button" onClick={onCopyResultLink} aria-label="결과 링크 복사"><FiShare2 /></button></div>
    <div className="result-toolbar">
      <button className="back-link" onClick={onBack}><FiArrowLeft /> 홈으로</button>
      <div className="result-actions">
        <button className="button button-ghost" onClick={onSave}><FiSave /> 견적 저장·공유</button>
        <button className="button button-secondary" data-testid={shareId && !shareOwnerTokenAvailable ? "shared-build-clone" : undefined} onClick={shareId && !shareOwnerTokenAvailable ? onCloneSharedBuild : onEdit}>{shareId && !shareOwnerTokenAvailable ? <><FiCopy /> 내 견적으로 복제</> : <><FiEdit3 /> 견적 수정</>}</button>
        <details className="result-more-tools" ref={moreToolsRef}>
          <summary><FiMoreHorizontal /> 더 보기</summary>
          <div onClick={() => { if (moreToolsRef.current) moreToolsRef.current.open = false; }}>
            {shareId && shareOwnerTokenAvailable && <button className="button button-light" type="button" onClick={onRevokeShare} disabled={revokingShare}>{revokingShare ? <><FiLoader className="spin" /> 취소 중...</> : <><FiTrash2 /> 공유 링크 취소</>}</button>}
            <button className="button button-light result-link-copy-button" type="button" onClick={onCopyResultLink}><FiShare2 /> 결과 링크 복사</button>
            <button className="button button-light" onClick={onCopyReport}><FiCopy /> 리포트 복사</button>
            <button className="button button-light" onClick={onDownloadReport}><FiDownload /> JSON 저장</button>
            <button className="button button-light result-print-button" type="button" onClick={() => window.print()}><FiPrinter /> 인쇄·PDF</button>
          </div>
        </details>
      </div>
    </div>
    {checkError && <RequestErrorNotice message={checkError} onRetry={onCheck} retrying={checking} hasLastResult />}
    <section className={`result-hero ${displayStatus}`}>
      <div className="result-hero-main"><span className="result-status-icon">{displayStatus === "compatible" ? <FiCheckCircle /> : displayStatus === "needs_review" ? <FiAlertTriangle /> : <FiXCircle />}</span><div><p className="eyebrow">호환 결과</p><h1>{statusCopy}</h1><p>{statusDescription}</p>{decisionNote && <div className="result-decision-note" data-testid="result-decision-note"><FiInfo /><div><span>선택 메모</span><strong>{decisionNote}</strong></div></div>}</div></div>

    </section>
    {savedVersionContext && <section className="result-version-context" data-testid="result-version-context" aria-label="저장 견적 버전 정보"><FiGitBranch /><div><span>저장 견적 버전</span><strong>v{savedVersionContext.versionNumber} · {savedVersionContext.parentName ? `${savedVersionContext.parentName}에서 파생` : "첫 저장 견적"}</strong><small>현재 결과는 저장 시점 검사와 함께 히스토리에서 다른 버전과 비교할 수 있어요.</small></div>{onOpenHistory && <button className="text-button" type="button" data-testid="result-version-context-open-history" onClick={onOpenHistory}>버전 비교 열기 <FiExternalLink /></button>}</section>}
    {savedVersionContext?.delta && (() => { const delta = savedVersionContext.delta; const transition = delta.transition; return <section className={`result-version-delta ${transition?.direction ?? "unknown"}`} data-testid="result-version-delta" aria-label="부모 버전 대비 변경 요약"><div><span>부모 버전 대비</span><strong>{delta.selectionChangedCategoryCount > 0 ? `구성 ${delta.selectionChangedCategoryCount}개 범주 변경` : "구성 변화 없음"}{transition ? ` · 호환 불가 ${signedResultDelta(transition.blockerDelta)} · 주의 ${signedResultDelta(transition.warningDelta)} · 정보 부족 ${signedResultDelta(transition.unknownDelta)}` : " · 이전 결과 없음"}</strong><small>{transition?.priceDeltaWon !== undefined ? `금액 ${signedResultDelta(transition.priceDeltaWon)}원` : "금액 확인 필요"}{delta.resolvedFindingCount !== undefined ? ` · 항목 해결 ${delta.resolvedFindingCount} · 신규 ${delta.newFindingCount} · 변경 ${delta.changedFindingCount}` : ""}</small></div><FiActivity /></section>; })()}
    {savedVersionContext?.delta && <ResultVersionChangeDetails context={savedVersionContext} partMap={partMap} accessoryPurchaseRows={accessoryPurchaseRows} onFocusSection={focusResultSection} onFocusAccessoryPurchase={focusAccessoryPurchase} />}
    {upgradeEntry && <UpgradeEntryResultSummary result={result} bundleCount={upgradeBundles?.length ?? 0} />}
    <GamingPerformanceEvidencePanel assessment={result.gamingPerformanceAssessment} />
    <div className="mobile-result-metric-strip" aria-label="검사 결과 요약">{metricCards.map((metric) => <button className={`mobile-result-metric ${metric.tone}`} type="button" aria-label={`${metric.label} ${metric.count}개. 해당 상세 결과 보기`} aria-pressed={findingFilter === metric.filter} disabled={metric.count === 0} onClick={() => focusFindingFilter(metric.filter)} key={metric.filter}><span>{metric.label}</span><strong>{metric.count}</strong></button>)}</div>
    <div className="mobile-result-actions"><button className="mobile-primary-action" type="button" onClick={onEdit}><FiEdit3 /><span>견적 수정하기</span><FiArrowRight className="mobile-result-action-arrow" /></button><div><button className="mobile-secondary-action" type="button" onClick={onSave}><FiSave /><span>견적 저장·공유</span><FiArrowRight className="mobile-result-action-arrow" /></button><button className="mobile-secondary-action" type="button" onClick={onCopyResultLink}><FiShare2 /><span>결과 링크 복사</span><FiArrowRight className="mobile-result-action-arrow" /></button></div></div>
    <details className="mobile-result-tools"><summary>리포트·공유 도구 더 보기</summary><div><button className="button button-light" type="button" onClick={onCopyReport}><FiCopy /> 리포트 복사</button><button className="button button-light" type="button" onClick={onDownloadReport}><FiDownload /> JSON 저장</button><button className="button button-light" type="button" onClick={() => window.print()}><FiPrinter /> 인쇄·PDF</button>{shareId && shareOwnerTokenAvailable && <button className="button button-light" type="button" onClick={onRevokeShare} disabled={revokingShare}>{revokingShare ? "취소 중..." : "공유 링크 취소"}</button>}</div></details>
    <Suspense fallback={null}><LazyResultQuickNav result={result} onFocusSection={focusResultSection} /></Suspense>
    <BuildPriceTrendPanel build={build} partMap={partMap} accessoryMap={accessoryMap} snapshot={resultPriceSnapshot} />
    {buildChangeResultComparison && <BuildChangeResultSummary comparison={buildChangeResultComparison} onDismiss={onDismissBuildChangeResultComparison ?? (() => undefined)} onCopy={onCopyBuildChangeResultComparison ?? (() => undefined)} onDownloadJson={onDownloadBuildChangeResultComparison ?? (() => undefined)} onSaveWithDecisionNote={onSaveBuildChangeResultAsDecisionNote} onFocusFinding={focusFinding} decisionSaveLabel={shareId && shareOwnerTokenAvailable ? "새 버전으로 저장" : "선택 이유에 첨부해 저장"} />}
    {shareId && savedCheckHistory && savedCheckHistory.length > 0 && <Suspense fallback={null}><LazySavedBuildRecheckDiffPanel snapshot={savedCheckHistory[savedCheckHistory.length - 1]} result={result} partMap={partMap} onFocusFinding={focusFinding} onPreviewSuggestion={onPreviewSuggestion} onFocusRepairPlans={focusRepairPlans} onFocusSection={focusResultSection} /></Suspense>}
    <div className="result-layout">
      <section className="findings-section">
        <div className="result-metrics">{metricCards.map((metric) => <button className={`metric-card ${metric.tone}${findingFilter === metric.filter ? " selected" : ""}`} type="button" aria-label={`${metric.label} ${metric.count}개. 해당 상세 결과 보기`} aria-pressed={findingFilter === metric.filter} disabled={metric.count === 0} onClick={() => focusFindingFilter(metric.filter)} key={metric.filter}><span>{metric.label}</span><strong>{metric.count}</strong></button>)}</div>
        <Suspense fallback={<div className="purchase-readiness-panel loading" aria-label="구매 준비 상태 로딩" role="status"><FiLoader className="spin" /> 구매 준비 상태를 확인하는 중...</div>}><LazyPurchaseReadinessPanel result={result} onEdit={onEdit} build={build} onChangeAccessoryHubTarget={onChangeAccessoryHubTarget} checklistProgress={purchaseChecklistProgress ?? undefined} purchaseProgress={purchaseListProgress ?? undefined} assemblyVerification={assemblyVerificationSummary ?? undefined} onFocusChecklist={() => focusResultSection("purchase-checklist")} onFocusPurchaseList={(status: PurchaseItemStatus | undefined) => { setPurchaseListFocusStatus(status ?? null); focusResultSection("purchase-list-panel"); }} onFocusAssemblyVerification={() => focusResultSection("assembly-verification-panel")} /></Suspense>
        <Suspense fallback={<div className="build-action-center loading" aria-label="먼저 할 일 목록 로딩" role="status"><FiLoader className="spin" /> 먼저 할 일 목록을 준비하는 중...</div>}><LazyBuildActionCenterPanel build={build} result={result} partMap={partMap} checklistStorageKey={`pc-supporter-purchase-checklist:${purchaseChecklistKey}:${result.engineVersion}:${result.catalogSnapshotAt}`} onFocusFinding={focusFinding} onFocusSection={focusResultSection} onFocusRepairPlans={focusRepairPlans} /></Suspense>
        <details className="result-assembly-details">
          <summary><span>구매·조립 순서</span><FiMoreHorizontal /></summary>
          <div className="result-assembly-details-body">
            <Suspense fallback={<div className="assembly-plan-panel loading" aria-label="구매·조립 순서 로딩" role="status"><FiLoader className="spin" /> 구매·조립 순서를 준비하는 중...</div>}><LazyAssemblyPlanPanel build={build} result={result} checklistProgress={purchaseChecklistProgress ?? undefined} purchaseProgress={purchaseListProgress ?? undefined} assemblyVerification={assemblyVerificationSummary ?? undefined} onFocusSection={focusResultSection} onFocusRepairPlans={focusRepairPlans} /></Suspense>
          </div>
        </details>
        {scenarioPreview && <BuildScenarioPreviewPanel preview={scenarioPreview} currentResult={result} onApply={() => onApplySuggestion(scenarioPreview.category, scenarioPreview.part, scenarioPreview.quantity, scenarioPreview.affectedPartIds, scenarioPreview.candidateEvidence)} onRetry={() => onPreviewSuggestion(scenarioPreview.category, scenarioPreview.part, scenarioPreview.quantity, scenarioPreview.affectedPartIds, scenarioPreview.candidateEvidence)} onClose={onDismissScenarioPreview} />}
        {upgradeBundleScenarioPreview && <Suspense fallback={<div className="upgrade-bundle-scenario-preview loading" aria-label="업그레이드 조합 미리 확인 로딩" role="status"><FiLoader className="spin" /> 업그레이드 조합을 미리 확인하는 중...</div>}><LazyUpgradeBundleScenarioPreviewPanel state={upgradeBundleScenarioPreview} currentResult={result} onApply={() => onApplyUpgradeBundle(upgradeBundleScenarioPreview.bundle)} onRetry={() => onPreviewUpgradeBundle(upgradeBundleScenarioPreview.bundle)} onClose={onDismissUpgradeBundleScenarioPreview} formatWon={formatWon} /></Suspense>}
        <details className="result-more-details">
          <summary><span><FiInfo /> 세부 정보·구매 도구</span><FiMoreHorizontal /></summary>
          <div className="result-more-details-body">
        <Suspense fallback={<div className="purchase-checklist-panel loading" aria-label="구매 전 체크리스트 로딩" role="status"><FiLoader className="spin" /> 구매 전 체크리스트를 준비하는 중...</div>}><LazyPurchaseChecklistPanel build={build} result={result} partMap={partMap} storageKey={`pc-supporter-purchase-checklist:${purchaseChecklistKey}:${result.engineVersion}:${result.catalogSnapshotAt}`} onFocusFinding={focusFinding} onFocusSection={focusResultSection} onProgressChange={setPurchaseChecklistProgress} /></Suspense>

        {savedCheckHistory && savedCheckHistory.length > 0 && <SavedBuildCheckTimeline history={savedCheckHistory} buildId={shareId ?? undefined} partMap={partMap} accessoryMap={accessoryMap} canRecord={shareOwnerTokenAvailable && Boolean(shareId)} recording={recordingSavedCheck} onRecordCheck={onRecordSavedCheck} />}
        <RecommendationControls preferences={recommendationPreferences} onChange={onRecommendationPreferencesChange} onCommit={onRecommendationPreferencesCommit} commitOnChange={false} compact disabled={checking} />
        {result.recommendationSearch && <Suspense fallback={null}><LazyRecommendationSearchNotice search={result.recommendationSearch} findings={result.findings} onOpenPicker={onOpenPicker} /></Suspense>}
        <BuildHealthPanel metrics={result.metrics} gpuSelected={Boolean(build.gpu)} psuSelected={Boolean(build.psu)} caseSelected={Boolean(build.case)} />
        <Suspense fallback={<div className="build-resource-summary-panel loading" aria-label="전력·냉각 여유 로딩" role="status"><FiLoader className="spin" /> 전력·냉각 여유를 계산하는 중...</div>}><LazyBuildResourceSummaryPanel metrics={result.metrics} /></Suspense>
        <Suspense fallback={<div className="build-connectivity-panel loading" aria-label="팬·RGB 연결 로딩" role="status"><FiLoader className="spin" /> 팬·RGB 연결을 준비하는 중...</div>}><LazyBuildConnectivityPanel motherboard={build.motherboard ? partMap.get(build.motherboard.partId)?.specs : undefined} computerCase={build.case ? partMap.get(build.case.partId)?.specs : undefined} findings={result.findings} onFocusFinding={focusFinding} /></Suspense>
        {result.gpuFit && build.gpu && partMap.has(build.gpu.partId) && <Suspense fallback={<div className="gpu-fit-summary-panel loading" aria-label="GPU 장착·전원 요약 로딩" role="status">GPU 장착·전원 요약을 준비하는 중...</div>}><LazyGpuFitSummaryPanel fit={result.gpuFit} gpu={partMap.get(build.gpu.partId)!} computerCase={build.case ? partMap.get(build.case.partId) : undefined} psu={build.psu ? partMap.get(build.psu.partId) : undefined} /></Suspense>}
        {result.metrics.m2SlotAssignments && result.metrics.m2SlotAssignments.length > 0 && <M2SlotAssignmentPanel assignments={result.metrics.m2SlotAssignments} mode={result.metrics.m2SlotAssignmentMode} />}

        <Suspense fallback={<div className="purchase-list-panel loading" aria-label="구매 목록 로딩" role="status"><FiLoader className="spin" /> 구매 목록을 준비하는 중...</div>}><LazyPurchaseListPanel rows={purchaseListRowsFor(build, partMap, accessoryMap)} storageKey={`pc-supporter-purchase-list:${purchaseChecklistKey}:${result.engineVersion}:${result.catalogSnapshotAt}`} inputFingerprint={purchaseChecklistKey} budgetWon={recommendationPreferences.budgetWon} savedBuildId={shareId ?? undefined} savedBuildOwnerToken={shareOwnerToken ?? undefined} onCopy={onCopyPurchaseList} onDownload={onDownloadPurchaseList} focusStatus={purchaseListFocusStatus ?? undefined} focusRowKey={purchaseFocusRowKey} onProgressChange={onPurchaseListProgressChange} onServerProgressChange={onPurchaseProgressSynced} onServerPriceHistoryChange={onPurchasePriceHistorySynced} onWatchEntry={onWatchEntry} isWatchedEntry={isWatchedEntry} onOpenCatalogItem={onOpenCatalogItem} onRefreshAll={onRefreshAll} refreshingItemId={refreshingPartId} catalogRefreshReport={catalogRefreshReport} /></Suspense>
        <BuildWatchlistPanel build={build} partMap={partMap} accessoryMap={accessoryMap} onToast={onToast} />
        <ChangeHistoryPanel entries={changeHistory} onRestore={onRestoreChange} restoring={checking} />
        {(build.cpu || build.gpu) && <Suspense fallback={<div className="benchmark-evidence-panel loading" aria-label="성능 점수 로딩" role="status"><FiLoader className="spin" /> CPU·GPU 점수를 불러오는 중...</div>}><LazyBenchmarkEvidencePanel cpu={build.cpu ? partMap.get(build.cpu.partId) : undefined} gpu={build.gpu ? partMap.get(build.gpu.partId) : undefined} snapshot={result.benchmarkSnapshot} /></Suspense>}
        {result.upgradeRecommendations && result.upgradeRecommendations.length > 0 && <UpgradeRecommendationPanel recommendations={result.upgradeRecommendations} onApply={(recommendation: UpgradeRecommendation) => onApplySuggestion(recommendation.category, recommendation.part, undefined, [recommendation.currentPartId])} onPreview={(recommendation: UpgradeRecommendation) => onPreviewSuggestion(recommendation.category, recommendation.part, undefined, [recommendation.currentPartId])} onWatchPart={onWatchPart} />}
        {upgradeBundles && upgradeBundles.length > 0 && <Suspense fallback={<div className="upgrade-bundle-panel loading" aria-label="업그레이드 조합 패널 로딩" role="status"><FiLoader className="spin" /> 업그레이드 조합을 준비하는 중...</div>}><LazyUpgradeBundlePanel bundles={upgradeBundles} searchSummary={result.upgradeBundleSearch} catalogSnapshotAt={result.catalogSnapshotAt} onApply={onApplyUpgradeBundle} onPreview={onPreviewUpgradeBundle} formatPriceDelta={formatPriceDelta} upgradeCompatibilityStatus={upgradeCompatibilityStatus} upgradeCompatibilityText={upgradeCompatibilityText} upgradeBudgetText={upgradeBudgetText} upgradeExpansionText={upgradeExpansionText} upgradeExpansionTone={upgradeExpansionTone} Detail={UpgradeRecommendationDetail} /></Suspense>}
        {result.accessoryRecommendations && result.accessoryRecommendations.length > 0 && <AccessoryRecommendationPanel recommendations={result.accessoryRecommendations} selectedAccessories={accessorySelections(build)} onAddAccessory={addAccessoryAndFocus} onWatchAccessory={(item: AccessoryItem, targetPriceWon?: number) => onWatchEntry({ itemId: item.id, itemName: item.name, category: item.category, kind: "accessory" }, targetPriceWon)} isAccessoryWatched={(item: AccessoryItem) => isWatchedEntry({ itemId: item.id, kind: "accessory" })} />}
        <Suspense fallback={<div className="accessory-cart-panel loading" aria-label="주변 부품 목록 로딩" role="status">추가한 주변 부품을 준비하는 중...</div>}><LazyAccessoryCartPanel selections={accessorySelections(build)} accessoryMap={accessoryMap} partMap={partMap} ssdSelections={build.ssd} onChangeQuantity={onChangeAccessoryQuantity} onChangeTarget={onChangeAccessoryTarget} onChangeHubTarget={onChangeAccessoryHubTarget} onChangeRgbController={onChangeRgbController} rgbControllerAccessoryId={build.rgbControllerAccessoryId} rgbDeviceCount={build.case ? partMap.get(build.case.partId)?.specs.rgbDeviceCount : undefined} onRemove={onRemoveAccessory} AccessoryVisual={AccessoryVisual} /></Suspense>
        {result.links.length > 0 && <CompatibilityMap links={result.links} findings={result.findings} onFocusFinding={focusFinding} />}
        {result.repairPlans && result.repairPlans.length > 0 && <RepairPlanPanel plans={result.repairPlans} build={build} currentResult={result} partMap={partMap} onApply={onApplyRepairPlan} onSavePlan={(nextBuild: BuildSelection, nextPreferences: RecommendationPreferences, label: string) => onSavePlan(nextBuild, nextPreferences, label, shareOwnerTokenAvailable && shareId ? shareId : undefined)} onFocusFinding={(ruleId: string) => { setFindingFilter("all"); window.setTimeout(() => document.getElementById("finding-" + ruleId)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0); }} />}
          </div>
        </details>
        {result.findings.length === 0 ? <div className="success-empty" data-testid="result-findings" tabIndex={-1}><FiCheckCircle /><h2>모든 규칙을 통과했습니다.</h2><button className="button button-secondary" onClick={onEdit}>부품 구성 다시 보기</button></div> : <div className="findings-list" data-testid="result-findings" tabIndex={-1}><div className="section-title-row"><div><p className="eyebrow">DETAILED MESSAGE</p><h2>검사 결과 상세</h2></div><span className="muted-count">{visibleFindings.length} / {result.findings.length}개 항목</span></div><div className="finding-filter-controls" role="group" aria-label="검사 결과 필터">{FINDING_FILTERS.map((filter: FindingFilter) => <button className={findingFilter === filter ? "finding-filter-button selected" : "finding-filter-button"} type="button" aria-pressed={findingFilter === filter} disabled={filter !== "all" && findingCounts[filter] === 0} onClick={() => selectFindingFilter(filter)} key={filter}>{findingFilterLabels[filter]} <strong>{findingCounts[filter]}</strong></button>)}</div>{visibleFindings.length === 0 ? <div className="finding-filter-empty"><FiInfo /><span>선택한 중요도의 결과 항목이 없습니다.</span><button className="text-button" type="button" onClick={() => selectFindingFilter("all")}>전체 보기</button></div> : visibleFindings.map((finding: Finding) => <Suspense key={`${result.checkedAt}-${finding.id}`} fallback={<div className="finding-card-loading" aria-busy="true"><FiLoader className="spin" /> 결과 상세를 불러오는 중...</div>}><ResultFindingCard finding={finding} partMap={partMap} onOpenPicker={onOpenPicker} onEdit={onEdit} onApplySuggestion={onApplySuggestion} onPreviewSuggestion={onPreviewSuggestion} onCompareSuggestions={onCompareSuggestions} onFocusRepairPlans={focusRepairPlans} onToast={onToast} onWatchPart={onWatchPart} onShareComparison={onShareComparison} onRevokeComparison={onRevokeComparison} disabled={checking} ruleGuides={RULE_GUIDES} partSummary={partSummary} formatWon={formatWon} formatPriceDelta={formatPriceDelta} formatSignedPercent={formatSignedPercent} formatSpecValue={formatSpecValue} similarityEvidenceText={similarityEvidenceText} suggestionSpecRows={suggestionSpecRows} PartVisual={PartVisual} PartWatchButton={PartWatchButton} /></Suspense>)}</div>}
      </section>
      <aside className="result-sidebar"><div className="sticky-summary"><div className="summary-header"><div><p className="eyebrow">현재 견적</p><h2>선택한 견적</h2></div><span className="summary-pulse"><FiCpu /></span></div><div className="build-mini-list">{PART_CATEGORIES.map((category: PartCategory) => { const selections = selectionList(build, category) as PartSelection[]; return <div className="build-mini-row" key={category}><span className="mini-category-icon"><CategoryIcon category={category} /></span><div><strong>{CATEGORY_LABELS[category]}</strong><span>{selections.length === 0 ? "미선택" : selections.map((selection: PartSelection) => `${partMap.get(selection.partId)?.name ?? selection.partId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`).join(", ")}</span></div></div>; })}{accessorySelections(build).length > 0 && <div className="build-mini-row"><span className="mini-category-icon"><FiTool /></span><div><strong>주변 부품</strong><span>{accessorySelections(build).length}종 · {accessorySelections(build).reduce((total: number, selection: AccessorySelection) => total + selection.quantity, 0)}개</span></div></div>}</div><div className="summary-divider" /><BuildPriceSummaryPanel snapshot={resultPriceSnapshot} budgetWon={recommendationPreferences.budgetWon} unknownItems={unknownPriceItemsFor(build, partMap, accessoryMap)} onRefresh={onRefreshCatalogItem} refreshingItemId={refreshingPartId} compact testId="result-price-summary" /><button className="button button-primary full-width" onClick={onEdit}><FiEdit3 /> 오류 수정하기</button><button className="button button-light full-width" onClick={onCheck} disabled={checking}>{checking ? <><FiLoader className="spin" /> 다시 검사 중...</> : <><FiRefreshCw /> 같은 구성 다시 검사</>}</button></div></aside>
    </div>
  </div>
);
}
