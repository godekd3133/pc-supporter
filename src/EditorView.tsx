// Editor route view. Loaded lazily for the /build route.
import type { BuildHistoryEntry } from "../shared/build-history";
import { type BuildPreflight, buildPreflightFor } from "../shared/build-preflight";
import { buildPriceSnapshotFor } from "../shared/build-price-summary";
import { LOCAL_IMPORT_MAX_BYTES } from "../shared/file-import-limits";
import type { RefreshTarget } from "../shared/refresh-targets";
import { type AccessoryItem, type BuildSelection, type Part, type PartCategory, type RecommendationPreferences, type ServiceMeta, CATEGORY_LABELS, PART_CATEGORIES } from "../shared/types";
import { BuildPriceSummaryPanel } from "./BuildPriceSummary";
import { partSummary } from "./app-format";
import { accessorySelections, removeSelection, selectionList, unknownPriceItemsFor, updateQuantity } from "./build-edit";
import { ChangeHistoryPanel, RequestErrorNotice } from "./notices";
import { AccessoryVisual, CATEGORY_META, PartEvidence } from "./part-visuals";
import { lazy, Suspense, useRef, useState } from "react";
import { FiActivity, FiArrowRight, FiArrowLeft, FiCheck, FiCheckCircle, FiChevronDown, FiDatabase, FiDownload, FiHardDrive, FiInfo, FiLoader, FiMonitor, FiPlus, FiRefreshCw, FiSearch, FiTrash2 } from "react-icons/fi";
import { RecommendationControls } from "./RecommendationControls";

const LazyCompatibilityCheckProgress = lazy(() => import("./CompatibilityCheckProgress").then((module) => ({ default: module.CompatibilityCheckProgress })));
const LazyAccessoryCartPanel = lazy(() => import("./AccessoryCartPanel").then((module) => ({ default: module.AccessoryCartPanel })));

export function MobileEditorSurface({ build, partMap, accessoryMap, checking, checkError, hasLastResult, recommendationPreferences, onRecommendationPreferencesChange, onOpenPicker, onCheck, onExportBuild, onImportBuild, onReset, onRefreshCatalogItem, onRefreshAllCatalogItems, refreshingPartId, onToast }: {
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
    <div className="mobile-editor-heading"><div><h1>견적 구성</h1></div><span className="mobile-editor-count"><strong>{selectedCount}</strong><small>/ {preflight.requiredTotal} 필수</small></span></div>
    <div className="mobile-editor-tools"><input ref={importInputRef} type="file" accept=".json,application/json" aria-label="견적 JSON 파일 가져오기" onChange={(event) => void importBuildFile(event)} disabled={checking} /><button type="button" onClick={() => importInputRef.current?.click()} disabled={checking}><FiDatabase /> 가져오기</button><button type="button" onClick={onExportBuild} disabled={checking}><FiDownload /> 저장</button><button type="button" onClick={onReset} disabled={checking}><FiRefreshCw /> 초기화</button></div>
    <div className="mobile-editor-progress"><div><span>검사 준비</span><strong>{selectedCount} / {preflight.requiredTotal}</strong></div><div className="mobile-progress-track"><span style={{ width: `${progress}%` }} /></div></div>
    <section className="mobile-editor-list" aria-label="부품 선택 목록"><div className="mobile-section-heading"><div><h2>부품 선택</h2></div></div><div className="mobile-editor-rows">{PART_CATEGORIES.map((category) => { const categoryMeta = CATEGORY_META[category]; const selections = selectionList(build, category); const boxedCooler = category === "cooler" && build.cpu ? partMap.get(build.cpu.partId)?.specs.coolerIncluded === true : false; const chosen = selections.length > 0 || boxedCooler; const summary = selections.length === 0 ? boxedCooler ? "선택한 CPU에 기본 포함" : categoryMeta.required ? "필수 부품을 선택해 주세요" : "선택 사항" : selections.map((selection) => `${partMap.get(selection.partId)?.name ?? selection.partId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""}`).join(", "); const RowIcon = categoryMeta.Icon; return <button className={`mobile-editor-row ${chosen ? "chosen" : ""}`} type="button" key={category} onClick={() => onOpenPicker(category)}><span className="mobile-editor-row-icon"><RowIcon /></span><span className="mobile-editor-row-copy"><strong>{categoryMeta.label}{categoryMeta.required && <em>필수</em>}</strong><small>{summary}</small></span>{!chosen && <span className={`mobile-editor-row-state ${categoryMeta.required ? "required" : "optional"}`}>{categoryMeta.required ? "필수" : "선택"}</span>}<FiArrowRight className="mobile-editor-row-arrow" /></button>; })}</div></section>
    <details className="mobile-editor-advanced"><summary><span><FiActivity /> 추천 기준·가격·데이터 확인</span></summary><div className="mobile-editor-advanced-content"><RecommendationControls preferences={recommendationPreferences} onChange={onRecommendationPreferencesChange} disabled={checking} /><BuildPriceSummaryPanel snapshot={buildPriceSnapshotFor(build, partMap, accessoryMap)} budgetWon={recommendationPreferences.budgetWon} unknownItems={unknownPriceItemsFor(build, partMap, accessoryMap)} onRefresh={onRefreshCatalogItem} refreshingItemId={refreshingPartId} /><BuildPreflightPanel preflight={preflight} onRefresh={onRefreshCatalogItem} onRefreshAll={onRefreshAllCatalogItems} refreshingPartId={refreshingPartId} /></div></details>
    {checkError && <RequestErrorNotice message={checkError} onRetry={onCheck} retrying={checking} hasLastResult={hasLastResult} />}
    <div className="mobile-editor-submit"><button className="mobile-primary-action" type="button" onClick={onCheck} disabled={checking || preflight.status !== "ready"}>{checking ? <><FiLoader className="spin" /><span>검사 중...</span></> : <><FiSearch /><span>호환성 검사하기</span><FiArrowRight /></>}</button></div>
  </section>;
}

export function UpgradeEntryBanner() {
  return <section className="upgrade-entry-banner" data-testid="upgrade-entry-banner" aria-label="업그레이드 진입 안내">
    <div className="upgrade-entry-banner-mark"><FiRefreshCw /></div>
    <div className="upgrade-entry-banner-copy"><p className="eyebrow">PC 업그레이드</p><h2>지금 쓰는 PC부터 확인해 볼게요</h2><p>현재 CPU·메인보드·메모리·그래픽카드를 골라주시면 호환성 문제와 바꾸면 좋은 업그레이드 조합을 순서대로 보여드려요.</p><div className="upgrade-entry-banner-steps"><span><b>1</b>현재 부품 선택</span><span><b>2</b>호환성 검사</span><span><b>3</b>업그레이드 비교</span></div></div>
  </section>;
}

export function EditorView({
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
      {upgradeEntry && <UpgradeEntryBanner />}
      <MobileEditorSurface build={build} partMap={partMap} accessoryMap={accessoryMap} checking={checking} checkError={checkError} hasLastResult={hasLastResult} recommendationPreferences={recommendationPreferences} onRecommendationPreferencesChange={onRecommendationPreferencesChange} onOpenPicker={onOpenPicker} onCheck={onCheck} onExportBuild={onExportBuild} onImportBuild={onImportBuild} onReset={onReset} onRefreshCatalogItem={onRefreshCatalogItem} onRefreshAllCatalogItems={onRefreshAllCatalogItems} refreshingPartId={refreshingPartId} onToast={onToast} />
      <div className="desktop-editor-surface">
      <div className="workspace-heading">
        <div><button className="back-link" onClick={onBack}><FiArrowLeft /> 홈으로</button><h1>내 견적 구성</h1><p>부품을 고르면, 함께 쓸 수 있는지 바로 확인할 수 있어요.</p></div>
        <div className="build-editor-actions"><input ref={buildImportInputRef} className="build-transfer-input" type="file" accept=".json,application/json" aria-label="견적 JSON 파일 가져오기" onChange={(event) => void importBuildFile(event)} disabled={checking} /><button className="button button-light" type="button" onClick={() => buildImportInputRef.current?.click()} disabled={checking}><FiDatabase /> 견적 JSON 가져오기</button><button className="button button-light" type="button" onClick={onExportBuild} disabled={checking}><FiDownload /> 견적 JSON 저장</button><button className="button button-ghost" type="button" onClick={onReset} disabled={checking}><FiRefreshCw /> 초기화</button></div>
      </div>
      <div className="progress-strip"><div><span className="progress-label">필수 부품 선택</span><strong>{selectedCount} / {requiredCount}</strong></div><div className="progress-track"><span style={{ width: `${(selectedCount / requiredCount) * 100}%` }} /></div></div>
      {checking && <Suspense fallback={<div className="compatibility-check-progress" data-testid="compatibility-check-progress" role="status"><FiLoader className="spin" /> 검사 준비 중...</div>}><LazyCompatibilityCheckProgress /></Suspense>}
      <div className="editor-layout">
        <section className="component-list">
          <div className="section-title-row"><div><h2>부품 선택</h2></div></div>
          {PART_CATEGORIES.map((category) => (
            <ComponentCard key={category} category={category} build={build} setBuild={setBuild} partMap={partMap} onOpenPicker={onOpenPicker} />
          ))}
          <M2SlotSelectionEditor build={build} setBuild={setBuild} partMap={partMap} />
          <Suspense fallback={<div className="accessory-cart-panel loading" aria-label="주변 부품 목록 로딩" role="status">추가한 주변 부품을 준비하는 중...</div>}><LazyAccessoryCartPanel selections={accessorySelections(build)} accessoryMap={accessoryMap} partMap={partMap} ssdSelections={build.ssd} onChangeQuantity={onChangeAccessoryQuantity} onChangeTarget={onChangeAccessoryTarget} onChangeHubTarget={onChangeAccessoryHubTarget} onChangeRgbController={onChangeRgbController} rgbControllerAccessoryId={build.rgbControllerAccessoryId} rgbDeviceCount={build.case ? partMap.get(build.case.partId)?.specs.rgbDeviceCount : undefined} onRemove={onRemoveAccessory} AccessoryVisual={AccessoryVisual} /></Suspense>
          <ChangeHistoryPanel entries={changeHistory} onRestore={onRestoreChange} restoring={checking} />
        </section>
        <aside className="summary-sidebar">
          <div className="sticky-summary">
            <div className="summary-header"><div><h2>검사 준비 상태</h2></div><span className="summary-pulse"><FiActivity /></span></div>
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

export function BuildPreflightPanel({ preflight, onRefresh, onRefreshAll, refreshingPartId }: { preflight: BuildPreflight; onRefresh: (target: RefreshTarget) => void; onRefreshAll: (targets: RefreshTarget[]) => void; refreshingPartId: string | null }) {
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
    <div className="build-preflight-heading"><div><strong>검사 전 사전 점검</strong></div><div className="build-preflight-heading-actions"><span className="build-preflight-status">{statusCopy[preflight.status]}</span>{preflight.refreshTargets.length > 0 && <button className="text-button build-preflight-refresh-all" type="button" onClick={() => onRefreshAll(preflight.refreshTargets)} disabled={refreshingPartId !== null}>{refreshingPartId !== null ? <><FiLoader className="spin" /> 확인 중...</> : <><FiRefreshCw /> 확인 대상 {preflight.refreshTargets.length}개 모두 확인</>}</button>}</div></div>
    <div className="build-preflight-stats"><div><span>필수 선택</span><strong>{preflight.requiredSelectedCount} / {preflight.requiredTotal}</strong></div><div><span>선택 부품</span><strong>{preflight.selectedPartCount + preflight.selectedAccessoryCount}개</strong></div><div><span>데이터 확인</span><strong>{preflight.dataReviewCount}개</strong></div><div><span>가격 미확인</span><strong>{preflight.unpricedCount}개</strong></div></div>
    {preflight.issues.length > 0 ? <div className="build-preflight-issues">{preflight.issues.slice(0, 4).map((issue) => <div className="build-preflight-issue" key={issue.id}><span>{issueKindCopy[issue.kind]}</span><div><strong>{issue.label}</strong><small>{issue.message}</small></div>{issue.target && <button className="text-button build-preflight-refresh" type="button" onClick={() => onRefresh(issue.target!)} disabled={refreshingPartId !== null}>{refreshingPartId === issue.target.id ? <><FiLoader className="spin" /> 확인 중...</> : <><FiRefreshCw /> 정보 다시 확인</>}</button>}</div>)}{preflight.issues.length > 4 && <small className="build-preflight-more">그 외 {preflight.issues.length - 4}개 항목은 검사 결과에서 상세 확인할 수 있습니다.</small>}</div> : <p className="build-preflight-clear"><FiCheckCircle /> 선택된 부품의 기본 데이터가 준비되었습니다.</p>}
    <p className="build-preflight-note"><FiInfo /> 사전 점검은 입력·정보 준비 상태만 봐요. 실제 부품 호환성은 검사 버튼을 눌러 확인해 주세요.</p>
  </section>;
}

export function ComponentCard({ category, build, setBuild, partMap, onOpenPicker }: { category: PartCategory; build: BuildSelection; setBuild: React.Dispatch<React.SetStateAction<BuildSelection>>; partMap: Map<string, Part>; onOpenPicker: (category: PartCategory) => void }) {
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

export function M2SlotSelectionEditor({ build, setBuild, partMap }: { build: BuildSelection; setBuild: React.Dispatch<React.SetStateAction<BuildSelection>>; partMap: Map<string, Part> }) {
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
    <div className="m2-selection-heading"><div><p className="eyebrow">M.2 슬롯</p><h2>SSD 슬롯 배치</h2><p>{motherboard.name}의 등록된 슬롯 정보를 기준으로 SSD 연결 위치를 직접 지정할 수 있습니다.</p></div><span className="m2-selection-icon"><FiHardDrive /></span></div>
    <div className="m2-selection-toolbar"><span className={assignedSlotCount === m2UnitCount ? "m2-selection-count complete" : "m2-selection-count"}>{assignedSlotCount > 0 ? `수동 지정 ${assignedSlotCount} / ${m2UnitCount}개` : "자동 배치"}</span><button className="text-button" type="button" onClick={useAutomaticPlacement} disabled={assignedSlotCount === 0}><FiRefreshCw /> 최적 배치 사용</button></div>
    <div className="m2-selection-list">{profiles.map((profile) => <label className="m2-selection-row" key={profile.slotId}><span className="m2-selection-slot">{profile.slotId}</span><span className="m2-selection-spec">{profile.interfaces?.join(" / ") ?? "인터페이스 확인"}{profile.pcieGeneration !== undefined ? ` · PCIe ${profile.pcieGeneration.toFixed(1)}` : " · 세대 확인"}{profile.connection === "cpu" ? " · CPU 직결" : profile.connection === "chipset" ? " · 칩셋" : " · 연결 확인"}</span><select aria-label={`${profile.slotId} SSD 배치`} value={selection[profile.slotId] ?? ""} onChange={(event) => updateSlot(profile.slotId, event.target.value)}><option value="">자동 배치</option>{selectedM2Parts.map(({ part, quantity }) => <option value={part.id} key={part.id}>{part.name} · {interfaceLabel(part)} · {capacityLabel(part)}{quantity > 1 ? ` ×${quantity}` : ""}</option>)}</select></label>)}</div>
    <p className="m2-selection-note"><FiInfo /> 모든 슬롯을 비워 두면 성능·연결 조건에 맞춰 자동으로 배치해요. 하나라도 직접 지정하면 선택한 M.2 SSD 수량만큼 슬롯을 모두 지정해야 하고, SSD 수량이나 메인보드를 바꾸면 안전을 위해 자동 배치로 돌아갑니다.</p>
  </section>;
}

