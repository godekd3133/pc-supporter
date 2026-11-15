// Build workspace route view for /build and /recommend. Loaded lazily.
// Conditions (auto-build form) on the left, the editable parts list in the
// middle and a sticky summary on the right. Running auto-build fills the
// parts list in place; while that generated draft still matches the list,
// the per-part up/down step asks the engine to rebuild dependent parts.
import { lazy, Suspense, useRef } from "react";
import type { ComponentProps } from "react";
import { FiActivity, FiDatabase, FiDownload, FiLoader, FiRefreshCw, FiSave } from "react-icons/fi";
import type { BuildHistoryEntry } from "../shared/build-history";
import { buildPreflightFor } from "../shared/build-preflight";
import { LOCAL_IMPORT_MAX_BYTES } from "../shared/file-import-limits";
import type { RefreshTarget } from "../shared/refresh-targets";
import { type AccessoryItem, type BuildGenerationRequest, type BuildGenerationResult, type BuildSelection, type CpuGpuBalanceAssessment, type Part, type PartCategory, type RecommendationPreferences, type ServiceMeta, PART_CATEGORIES, isKnownPrice } from "../shared/types";
import { BuildGeneratorView } from "./BuildGeneratorView";
import { accessorySelections, replaceSelectionAt, selectionList } from "./build-edit";
import type { SampleBuildsPayload } from "../shared/sample-builds";
import { PurchaseCheckPanel, SampleBuildTierPanel, usePurchaseCheckItems, type ActiveSampleContext } from "./SampleBuildPanels";
import { samplePartsByCategory, sampleStepFor } from "./sample-part-steps";
import { AiChatPanel } from "./AiChatPanel";
import { ComponentCard, M2SlotSelectionEditor, type PartStepOverride, UpgradeEntryBanner } from "./EditorView";
import { CpuGpuBalanceRow } from "./GeneratorBalanceControls";
import { generatorPartAdjustmentRequestFor } from "./generator-balance";
import { ChangeHistoryPanel, RequestErrorNotice } from "./notices";
import { AccessoryVisual } from "./part-visuals";
import { PerformanceIndexMetricsPanel, PerformanceIndexPanel } from "./ResultPanels";

const LazyCompatibilityCheckProgress = lazy(() => import("./CompatibilityCheckProgress").then((module) => ({ default: module.CompatibilityCheckProgress })));
const LazyAccessoryCartPanel = lazy(() => import("./AccessoryCartPanel").then((module) => ({ default: module.AccessoryCartPanel })));

type GeneratorProps = Omit<ComponentProps<typeof BuildGeneratorView>, "parts" | "summary" | "headingActions" | "notice" | "title" | "conditionsInitiallyOpen" | "preferences" | "onPreferencesChange" | "onBack">;

export function BuildWorkspaceView({
  generator,
  sample,
  activeDraft,
  conditionsInitiallyOpen,
  onAdjustActiveDraft,
  onSaveDraft,
  cpuGpuBalance,
  build,
  setBuild,
  partMap,
  accessoryMap,
  meta,
  checking,
  checkError,
  hasLastResult,
  upgradeEntry,
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
  generator: GeneratorProps;
  /** 견본견적이 담긴 동안의 등급 바꾸기 / 견본 부품 안에서의 ± 조정. */
  sample?: { payload: SampleBuildsPayload; context: ActiveSampleContext; onChangeSample: (sampleId: string) => void };
  /** The applied auto-build result, only while it still matches the parts list. */
  activeDraft: BuildGenerationResult | null;
  conditionsInitiallyOpen: boolean;
  onAdjustActiveDraft: (request: BuildGenerationRequest) => Promise<void>;
  onSaveDraft?: (draft: BuildGenerationResult) => void;
  /** CPU/GPU balance from a compatibility result that still matches the build. */
  cpuGpuBalance?: CpuGpuBalanceAssessment;
  build: BuildSelection;
  setBuild: React.Dispatch<React.SetStateAction<BuildSelection>>;
  partMap: Map<string, Part>;
  accessoryMap: Map<string, AccessoryItem>;
  meta: ServiceMeta | null;
  checking: boolean;
  checkError: string | null;
  hasLastResult: boolean;
  upgradeEntry: boolean;
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
  const importInputRef = useRef<HTMLInputElement>(null);
  const busy = checking || generator.loading;
  const canRefreshCatalog = meta?.adminAuthEnabled === false || meta?.adminSessionAuthenticated === true;
  const preflight = buildPreflightFor(build, partMap, accessoryMap);
  const selections = PART_CATEGORIES.flatMap((category) => selectionList(build, category));
  const partsTotal = selections.reduce((total, selection) => { const price = partMap.get(selection.partId)?.priceWon; return isKnownPrice(price) ? total + price * selection.quantity : total; }, 0);
  const unpricedCount = selections.filter((selection) => !isKnownPrice(partMap.get(selection.partId)?.priceWon)).length;
  const budgetWon = recommendationPreferences.budgetWon;
  const balance = activeDraft?.cpuGpuBalance ?? cpuGpuBalance;
  const budgetDelta = !sample && budgetWon !== undefined && budgetWon > 0 && selections.length > 0 ? budgetWon - partsTotal : undefined;
  const generatedWarnings = activeDraft?.warnings ?? [];
  const purchaseCheck = usePurchaseCheckItems(build, !activeDraft);
  const purchaseCheckItems = activeDraft ? generatedWarnings : purchaseCheck.items;
  const sampleParts = sample ? samplePartsByCategory(sample.payload) : undefined;

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

  // One control per part: the engine's dependency-aware step while the generated
  // draft is active, the client-side tier step otherwise.
  const sampleStepOverride = sample && sampleParts ? (category: PartCategory, index: number, direction: "up" | "down"): PartStepOverride | undefined => {
    if (index !== 0) return undefined;
    const step = sampleStepFor(sample.payload, build, partMap, category, direction, sampleParts);
    return {
      target: step.target,
      apply: step.target && !busy ? () => setBuild((current) => replaceSelectionAt(current, category, 0, step.target!.id)) : undefined,
      reason: step.reason
    };
  } : undefined;
  const stepOverride = sampleStepOverride ?? (activeDraft ? (category: PartCategory, index: number, direction: "up" | "down"): PartStepOverride | undefined => {
    const tier = activeDraft.partTiers?.[category];
    if (index !== 0 || !tier) return undefined;
    const request = generatorPartAdjustmentRequestFor(activeDraft, category, direction);
    const targetId = direction === "up" ? tier.upId : tier.downId;
    const unavailable = direction === "up" ? tier.upUnavailableReason : tier.downUnavailableReason;
    return {
      target: targetId ? partMap.get(targetId) : undefined,
      apply: request && !busy ? () => void onAdjustActiveDraft(request).catch(() => undefined) : undefined,
      reason: request ? undefined : unavailable ?? (direction === "up" ? "더 높은 단계 부품이 없어요" : "더 낮은 단계 부품이 없어요")
    };
  } : undefined);

  const headingActions = <div className="build-editor-actions">
    <input ref={importInputRef} className="build-transfer-input" type="file" accept=".json,application/json" aria-label="견적 JSON 파일 가져오기" onChange={(event) => void importBuildFile(event)} disabled={busy} />
    <button className="button button-light" type="button" onClick={() => importInputRef.current?.click()} disabled={busy}><FiDatabase /> 가져오기</button>
    <button className="button button-light" type="button" onClick={onExportBuild} disabled={busy}><FiDownload /> 내보내기</button>
    <button className="button button-ghost" type="button" onClick={onReset} disabled={busy}><FiRefreshCw /> 초기화</button>
  </div>;

  const parts = <div className={generator.loading ? "build-workspace-parts loading" : "build-workspace-parts"} aria-busy={generator.loading}>
    <div className="build-workspace-parts-head">
      <h2>부품 구성</h2>
      <span className="build-workspace-required">필수 <b>{preflight.requiredSelectedCount}</b> / {preflight.requiredTotal}</span>
      {generator.loading && <span className="build-workspace-generating" role="status"><FiLoader className="spin" /> 구성을 다시 맞추는 중</span>}
    </div>
    {sample && <SampleBuildTierPanel payload={sample.payload} context={sample.context} build={build} partMap={partMap} busy={busy} onChangeSample={sample.onChangeSample} />}
    {checking && <Suspense fallback={<div className="compatibility-check-progress" data-testid="compatibility-check-progress" role="status"><FiLoader className="spin" /> 호환 결과를 준비하고 있어요...</div>}><LazyCompatibilityCheckProgress /></Suspense>}
    <section className="component-list">
      {PART_CATEGORIES.map((category) => <ComponentCard key={category} category={category} build={build} setBuild={setBuild} partMap={partMap} onOpenPicker={onOpenPicker} stepOverride={stepOverride} />)}
      <M2SlotSelectionEditor build={build} setBuild={setBuild} partMap={partMap} />
      <Suspense fallback={<div className="accessory-cart-panel loading" aria-label="주변 부품 목록 로딩" role="status">추가한 주변 부품을 준비하는 중...</div>}><LazyAccessoryCartPanel selections={accessorySelections(build)} accessoryMap={accessoryMap} partMap={partMap} ssdSelections={build.ssd} onChangeQuantity={onChangeAccessoryQuantity} onChangeTarget={onChangeAccessoryTarget} onChangeHubTarget={onChangeAccessoryHubTarget} onChangeRgbController={onChangeRgbController} rgbControllerAccessoryId={build.rgbControllerAccessoryId} rgbDeviceCount={build.case ? partMap.get(build.case.partId)?.specs.rgbDeviceCount : undefined} onRemove={onRemoveAccessory} AccessoryVisual={AccessoryVisual} /></Suspense>
      <ChangeHistoryPanel entries={changeHistory} onRestore={onRestoreChange} restoring={busy} />
    </section>
    <AiChatPanel build={build} />
    <div className="build-workspace-mobile-bar">
      <div><span>합계</span><strong>{partsTotal.toLocaleString("ko-KR")}원</strong></div>
      <button className="button button-primary" type="button" onClick={onCheck} disabled={busy}>{checking ? <><FiLoader className="spin" /> 확인 중</> : <><FiActivity /> 견적 완성하기</>}</button>
    </div>
  </div>;

  const summary = <div className="sticky-summary build-workspace-summary-card">
    <div className="build-editor-total" data-testid="build-editor-total"><span>부품 합계</span><strong>{partsTotal.toLocaleString("ko-KR")}<small>원</small></strong>{unpricedCount > 0 && <small className="build-editor-total-note">가격 정보 없는 부품 {unpricedCount}개 제외</small>}</div>
    {budgetDelta !== undefined && <div className="build-workspace-budget"><span>예산 {budgetWon!.toLocaleString("ko-KR")}원</span><em className={budgetDelta >= 0 ? "within" : "over"}>{budgetDelta >= 0 ? `${budgetDelta.toLocaleString("ko-KR")}원 여유` : `${Math.abs(budgetDelta).toLocaleString("ko-KR")}원 초과`}</em></div>}
    {balance && balance.evidence !== "unknown" && <CpuGpuBalanceRow assessment={balance} hasGpu={Boolean(build.gpu)} />}
    {activeDraft?.performanceMetrics ? <PerformanceIndexMetricsPanel report={activeDraft.performanceMetrics} hasGpu={Boolean(build.gpu)} /> : <PerformanceIndexPanel build={build} partMap={partMap} />}
    <PurchaseCheckPanel items={purchaseCheckItems} loading={!activeDraft && purchaseCheck.loading} />
    <button className="button button-primary full-width build-workspace-check" type="button" onClick={onCheck} disabled={busy}>{checking ? <><FiLoader className="spin" /> 호환 확인 중...</> : <><FiActivity /> 견적 완성하기</>}</button>
    {activeDraft && onSaveDraft && <button className="text-button build-workspace-save" type="button" onClick={() => onSaveDraft(activeDraft)} disabled={busy}><FiSave /> 새 견적으로 저장</button>}
    {checkError && <RequestErrorNotice message={checkError} onRetry={onCheck} retrying={checking} hasLastResult={hasLastResult} />}
  </div>;

  return <BuildGeneratorView
    {...generator}
    title="견적 만들기"
    hideConditions
    conditionsInitiallyOpen={conditionsInitiallyOpen}
    preferences={recommendationPreferences}
    onPreferencesChange={onRecommendationPreferencesChange}
    notice={upgradeEntry ? <UpgradeEntryBanner /> : undefined}
    headingActions={headingActions}
    parts={parts}
    summary={summary}
    onBack={onBack}
  />;
}
