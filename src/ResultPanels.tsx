// Extracted from App.tsx to keep the entry chunk lean. Loaded lazily.
import type { BuildHistoryEntry } from "../shared/build-history";
import { buildScenarioComparisonFor } from "../shared/build-scenario";
import { CATALOG_PRICE_EVIDENCE_LABELS, catalogPriceEvidenceDescriptionFor, catalogPriceEvidenceFor, catalogPriceEvidenceLabelFor } from "../shared/catalog-price-evidence";
import { type CatalogWatchEntry, CATALOG_WATCHLIST_STORAGE_KEY, addCatalogWatchEntry, catalogWatchEntryKey, catalogWatchlistContains, catalogWatchlistFromJson, catalogWatchlistToJson } from "../shared/catalog-watchlist";
import { type PriceWatchDecisionHistory, priceWatchDecisionFor } from "../shared/price-watch-decision";
import { repairPlanBuildFor } from "../shared/repair-plan-build";
import { repairPlanPerformanceRetentionFor } from "../shared/repair-plan-performance";
import { type AccessoryCategory, type AccessoryItem, type AccessoryRecommendation, type AccessorySelection, type BuildSelection, type BuildMetrics, type CompatibilityLink, type CompatibilityResult, type Finding, type M2SlotAssignment, type Part, type PartCategory, type RecommendationPlan, type RecommendationPreferences, type UpgradeCompatibilityEvidence, type UpgradeExpansionEvidence, type UpgradeBudgetEvidence, type UpgradeRecommendation, ACCESSORY_CATEGORIES, ACCESSORY_CATEGORY_LABELS, CATEGORY_LABELS, DATA_FRESHNESS_LABELS, DATA_QUALITY_LABELS, GAMING_REFRESH_RATE_LABELS, GAMING_RESOLUTION_LABELS, GAMING_RESOLUTION_VRAM_TARGETS, isKnownPrice, LISTING_TYPE_LABELS, PART_CATEGORIES } from "../shared/types";
import { valueScoreText } from "../shared/value-score";
import type { RepairPlanComparisonViewState } from "./RepairPlanComparison";
import { api } from "./api";
import { safeExternalUrl } from "./safe-source-url";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { IconType } from "react-icons";
import { FiActivity, FiArrowLeft, FiBox, FiCheck, FiCheckCircle, FiChevronDown, FiClock, FiCpu, FiDatabase, FiEdit3, FiExternalLink, FiHardDrive, FiInfo, FiLayers, FiLoader, FiMonitor, FiPlus, FiRefreshCw, FiSearch, FiShare2, FiTool, FiXCircle, FiZap } from "react-icons/fi";
import { formatPriceDelta, formatSpecValue, formatWon, similarityEvidenceText, suggestionSpecRows } from "./app-format";
import { type BuildScenarioPreviewState } from "./app-types";
import { accessorySelections, selectionList } from "./build-edit";
import { ChangeHistoryPanel, RequestErrorNotice } from "./notices";
import { AccessoryVisual, CATEGORY_META, CategoryIcon, type PartWatchHandler, partIsWatched, PartVisual, PartWatchButton } from "./part-visuals";
import { repairPlanKey, scenarioRiskText, scenarioStatusLabel, sharedPhysicalEvidenceSourceIdentity, sharedPhysicalEvidenceSources } from "./result-shared";

export { PartVisual, PartWatchButton } from "./part-visuals";

const LazyRepairPlanComparisonPanel = lazy(() => import("./RepairPlanComparison").then((module) => ({ default: module.RepairPlanComparisonPanel })));
const LazyRepairPlanSummaryTable = lazy(() => import("./RepairPlanSummary").then((module) => ({ default: module.RepairPlanSummaryTable })));

export function StaleResultView({ build, partMap, lastCheckedAt, entries, onRestore, checking, checkError, onBack, onEdit, onCheck }: { build: BuildSelection; partMap: Map<string, Part>; lastCheckedAt: string; entries: BuildHistoryEntry[]; onRestore: (entry: BuildHistoryEntry) => void; checking: boolean; checkError: string | null; onBack: () => void; onEdit: () => void; onCheck: () => void }) {
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

export function BuildScenarioPreviewPanel({ preview, currentResult, onApply, onRetry, onClose }: { preview: BuildScenarioPreviewState; currentResult: CompatibilityResult; onApply: () => void; onRetry: () => void; onClose: () => void }) {
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

export function BuildHealthPanel({ metrics, gpuSelected, psuSelected, caseSelected }: { metrics: BuildMetrics; gpuSelected: boolean; psuSelected: boolean; caseSelected: boolean }) {
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

export function M2SlotAssignmentPanel({ assignments, mode }: { assignments: M2SlotAssignment[]; mode?: BuildMetrics["m2SlotAssignmentMode"] }) {
  const connectionLabels: Record<string, string> = { cpu: "CPU 직결", chipset: "칩셋", unknown: "연결 주체 확인" };
  const isManual = mode === "manual";
  return <section className="m2-assignment-panel"><div className="m2-assignment-heading"><div><p className="eyebrow">M.2 SLOT PLAN</p><h2>{isManual ? "수동 지정 슬롯 배치" : "자동 계산 슬롯 배치"}</h2><p>{isManual ? "사용자가 지정한 슬롯 위치를 제조사 매뉴얼 등록 정보와 비교했습니다." : "관리자가 등록한 제조사 매뉴얼 정보를 기준으로 SSD 연결 위치를 계산했습니다."}</p></div><FiHardDrive /></div><div className="m2-assignment-list">{assignments.map((assignment) => <div className="m2-assignment-row" key={`${assignment.slotId}-${assignment.partId}`}><span className="m2-assignment-slot">{assignment.slotId}</span><div><strong>{assignment.partName}</strong><small>{assignment.interface ?? "인터페이스 확인"} · 슬롯 PCIe {assignment.slotPcieGeneration?.toFixed(1) ?? "확인 필요"} · 실제 링크 PCIe {assignment.linkGeneration?.toFixed(1) ?? "확인 필요"} · {assignment.connection ? connectionLabels[assignment.connection] ?? assignment.connection : "연결 주체 확인"}</small><small>{assignment.sharedWith && assignment.sharedWith.length > 0 ? `공유 대상: ${assignment.sharedWith.join(", ")}` : "공유 대상 없음으로 등록"}</small></div></div>)}</div><p className="m2-assignment-note"><FiInfo /> 슬롯별 매뉴얼 override 기준의 배치 결과이며, 실제 조립 전 보드 매뉴얼과 장착 위치를 다시 확인해 주세요.</p></section>;
}

export function BuildWatchlistPanel({ build, partMap, accessoryMap, onToast }: { build: BuildSelection; partMap: ReadonlyMap<string, Part>; accessoryMap: ReadonlyMap<string, AccessoryItem>; onToast: (message: string) => void }) {
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

export function upgradeCompatibilityText(evidence: UpgradeCompatibilityEvidence) {
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

export function upgradeCompatibilityStatus(evidence: UpgradeCompatibilityEvidence) {
  if (evidence.blockerCount > 0) return `차단 오류 ${evidence.blockerCount}개`;
  if (evidence.unknownCount > 0) return `확인 필요 ${evidence.unknownCount}개`;
  if (evidence.warningCount > 0) return `주의 ${evidence.warningCount}개`;
  return "호환 상태 유지";
}

export function upgradeBudgetText(evidence: UpgradeBudgetEvidence | undefined) {
  if (!evidence) return undefined;
  if (!evidence.priceComplete || evidence.afterCoreTotalPriceWon === undefined) {
    return `목표 ${formatWon(evidence.budgetWon)} · 핵심 금액 확인 필요`;
  }
  const difference = evidence.withinBudget
    ? evidence.budgetWon - evidence.afterCoreTotalPriceWon
    : evidence.afterCoreTotalPriceWon - evidence.budgetWon;
  return `적용 후 핵심 ${formatWon(evidence.afterCoreTotalPriceWon)} · 목표 ${formatWon(evidence.budgetWon)} · ${formatWon(difference)} ${evidence.withinBudget ? "여유" : "초과"}`;
}

export type UpgradeSortMode = "recommended" | "performance" | "value" | "saving" | "expansion" | "reliability";

export function upgradeValueScore(recommendation: UpgradeRecommendation) {
  if (recommendation.priceDeltaWon === undefined) return undefined;
  if (recommendation.priceDeltaWon <= 0) return 1_000 + recommendation.improvementPercent;
  return recommendation.improvementPercent / Math.max(0.1, recommendation.priceDeltaWon / 100_000);
}

export function upgradeExpansionText(evidence: UpgradeExpansionEvidence | undefined) {
  if (!evidence) return "확장성 비교 불가 · 부품 적용 후 다시 확인";
  const coverage = `비교 부품 ${evidence.candidateKnownDimensionCount}/${evidence.candidateTotalDimensionCount}개 지표`;
  if (evidence.candidateScore === undefined) return `확장성 비교 불가 · ${coverage}`;
  if (evidence.scoreDelta === undefined || evidence.baselineScore === undefined) return `교체 후 확장성 ${evidence.candidateScore}점 · ${coverage}`;
  return `확장성 ${evidence.baselineScore}점 → ${evidence.candidateScore}점 · ${evidence.scoreDelta >= 0 ? "+" : ""}${evidence.scoreDelta}점 · ${coverage}`;
}

export function upgradeExpansionTone(evidence: UpgradeExpansionEvidence | undefined) {
  if (evidence?.scoreDelta === undefined) return "unknown";
  return evidence.scoreDelta > 0 ? "positive" : evidence.scoreDelta < 0 ? "negative" : "neutral";
}

export function upgradeRecommendationTrustScore(recommendation: UpgradeRecommendation) {
  if (!recommendation.recommendationTrust) return Number.NEGATIVE_INFINITY;
  const levelScore = { high: 3, medium: 2, low: 1 }[recommendation.recommendationTrust.level];
  return levelScore * 100 + recommendation.recommendationTrust.score;
}

export function sortedUpgradeRecommendations(recommendations: UpgradeRecommendation[], sortMode: UpgradeSortMode) {
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

export function upgradePhysicalEvidenceLabel(status: NonNullable<UpgradeRecommendation["physicalEvidence"]>["status"]) {
  return status === "verified" ? "규격 일치" : status === "review" ? "사양 미등록" : "해당 없음";
}

export function upgradePhysicalEvidenceText(evidence: UpgradeRecommendation["physicalEvidence"]) {
  if (!evidence || evidence.status === "not_applicable") return undefined;
  return evidence.summary;
}

export function UpgradePhysicalEvidence({ evidence }: { evidence: UpgradeRecommendation["physicalEvidence"] }) {
  if (!evidence || evidence.status === "not_applicable") return null;
  return <div className={"upgrade-physical-evidence " + evidence.status} aria-label="업그레이드 부품 장착 규격"><div><strong>장착 규격</strong><span>{upgradePhysicalEvidenceLabel(evidence.status)}</span></div><p>{evidence.summary}</p></div>;
}

export function UpgradeRecommendationPanel({ recommendations, onApply, onPreview, onWatchPart }: { recommendations: UpgradeRecommendation[]; onApply: (recommendation: UpgradeRecommendation) => void; onPreview: (recommendation: UpgradeRecommendation) => void; onWatchPart: PartWatchHandler }) {
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

  return <section className="upgrade-recommendation-panel" data-testid="upgrade-recommendation-panel" data-upgrade-sort={sortMode} tabIndex={-1}>

    <div className="upgrade-recommendation-heading"><div><p className="eyebrow">COMPATIBLE UPGRADES</p><h2>호환 유지 업그레이드</h2><p>지금 구성에 새 문제를 만들지 않으면서 성능·용량·확장성이 나아지는 부품이에요.</p><small className="upgrade-recommendation-sort-note">개선 점수·우선순위·호환 유지 여부를 함께 계산한 결과 · 최대 3개 비교</small></div><span className="upgrade-recommendation-icon"><FiZap /></span></div>
    <div className="upgrade-category-filters" role="group" aria-label="업그레이드 부품 분류"><button className={categoryFilter === "all" ? "selected" : ""} type="button" aria-pressed={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>전체 {recommendations.length}</button>{availableCategories.map((category) => { const count = recommendations.filter((recommendation) => recommendation.category === category).length; return <button className={categoryFilter === category ? "selected" : ""} type="button" aria-pressed={categoryFilter === category} onClick={() => setCategoryFilter(category)} key={category}>{CATEGORY_LABELS[category]} {count}</button>; })}</div>
    <div className="upgrade-recommendation-sort"><label><span>부품 정렬</span><select aria-label="업그레이드 부품 정렬" value={sortMode} onChange={(event) => setSortMode(event.target.value as UpgradeSortMode)}><option value="recommended">추천 순</option><option value="performance">성능 개선 폭</option><option value="expansion">확장성 개선 폭</option><option value="value">가성비</option><option value="saving">추가 지출 낮은 순</option></select></label><small>{sortMode === "recommended" ? "서버가 계산한 호환·우선순위 순서" : sortMode === "performance" ? "비교 가능한 스펙 개선 비율이 큰 순" : sortMode === "expansion" ? "부품 적용 후 확장성 점수 변화가 큰 순" : sortMode === "value" ? "가격 변화 대비 개선 효율이 높은 순" : "교체 후 추가 지출이 낮은 순"}</small></div>
    <div className="upgrade-recommendation-list">{visibleRecommendations.map((recommendation, index) => { const id = `${recommendation.category}-${recommendation.part.id}`; const compared = compareIds.includes(id); const budgetClass = recommendation.budgetEvidence?.priceComplete ? recommendation.budgetEvidence.withinBudget ? "within" : "over" : "unknown"; const expanded = expandedId === id; const sourceUrl = safeExternalUrl(recommendation.part.danawaUrl); return <article className={compared ? "upgrade-recommendation-card compared" : "upgrade-recommendation-card"} key={id}><div className="upgrade-recommendation-top"><div className="upgrade-recommendation-badges"><span className="category-badge">{CATEGORY_LABELS[recommendation.category]}</span>{index === 0 && categoryFilter === "all" && <span className="upgrade-rank-badge">우선 추천</span>}</div></div><div className="upgrade-recommendation-body"><span className="upgrade-recommendation-image"><PartVisual part={recommendation.part} /></span><div className="upgrade-recommendation-copy"><strong>{recommendation.part.name}</strong><small>현재: {recommendation.currentPartName}</small><button className="upgrade-detail-toggle" type="button" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : id)}>{expanded ? "상세 스펙 닫기" : "상세 스펙 보기"} <FiChevronDown /></button><p>{recommendation.reason}</p><em>개선 지표: {recommendation.improvedDimensions.join(" · ")}</em><em>{recommendation.performanceSummary}</em>{recommendation.gpuTarget && <em className={`upgrade-gpu-target ${recommendation.gpuTarget.candidateFit}`}>{recommendation.gpuTarget.summary}</em>}<em className="upgrade-compatibility">{upgradeCompatibilityStatus(recommendation.compatibilityEvidence)} · {upgradeCompatibilityText(recommendation.compatibilityEvidence)}</em>{recommendation.expansionEvidence && <em className={`upgrade-expansion ${upgradeExpansionTone(recommendation.expansionEvidence)}`}>{upgradeExpansionText(recommendation.expansionEvidence)}</em>}{recommendation.budgetEvidence && <em className={`upgrade-budget ${budgetClass}`}>{upgradeBudgetText(recommendation.budgetEvidence)}</em>}</div><div className="upgrade-recommendation-side"><strong>{formatWon(recommendation.part.priceWon)}</strong><small>{recommendation.quantity > 1 ? `수량 ${recommendation.quantity}개 · ` : ""}{formatPriceDelta(recommendation.priceDeltaWon)}</small>{sourceUrl && <a className="upgrade-source-link" href={sourceUrl} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a>}<PartWatchButton part={recommendation.part} onWatch={onWatchPart} /><button className={compared ? "button button-small upgrade-compare-button selected" : "button button-small upgrade-compare-button"} type="button" onClick={() => toggleCompare(recommendation)} disabled={!compared && compareIds.length >= 3} aria-pressed={compared}><FiLayers /> {compared ? "비교 중" : "비교"}</button><button className="button button-small upgrade-preview-button" type="button" onClick={() => onPreview(recommendation)}><FiActivity /> 미리 적용</button><button className="button button-small button-fix" type="button" onClick={() => onApply(recommendation)}><FiZap /> 적용 후 재검사</button></div></div>{expanded && <UpgradeRecommendationDetail recommendation={recommendation} />}</article>; })}</div>
    {visibleRecommendations.some((recommendation) => recommendation.physicalEvidence && recommendation.physicalEvidence.status !== "not_applicable") && <section className="upgrade-physical-evidence-overview" aria-label="업그레이드 부품 장착 정보"><div><strong>업그레이드 부품 장착 규격</strong></div><div className="upgrade-physical-evidence-overview-list">{visibleRecommendations.filter((recommendation) => recommendation.physicalEvidence && recommendation.physicalEvidence.status !== "not_applicable").map((recommendation) => <article key={`${recommendation.category}-${recommendation.part.id}`}><strong>{recommendation.part.name}</strong><UpgradePhysicalEvidence evidence={recommendation.physicalEvidence} /></article>)}</div></section>}
    {comparedRecommendations.length >= 2 && <UpgradeRecommendationComparison recommendations={comparedRecommendations} />}
    <p className="upgrade-recommendation-note"><FiInfo /> 개선 점수는 실제 FPS나 벤치 순위가 아니라 카탈로그에서 확인한 같은 범주 스펙의 상대 변화입니다. 비교표의 호환 여유는 부품을 견적 전체에 적용해 계산한 결과예요. 사기 전에 제조사 안내와 실제 사용 목적을 확인해 주세요.</p>
  </section>;
}

export function upgradePartQualityLabel(part: Part) {
  return DATA_QUALITY_LABELS[part.dataQuality];
}

export function UpgradeRecommendationDetail({ recommendation }: { recommendation: UpgradeRecommendation }) {
  const part = recommendation.part;
  const sourceUrl = safeExternalUrl(part.danawaUrl);
  return <div className="upgrade-recommendation-detail">
    <div className="upgrade-detail-grid">{suggestionSpecRows(part).map(([label, value]) => <div className="upgrade-detail-row" key={label}><span>{label}</span><strong>{formatSpecValue(value)}</strong></div>)}</div>
    {part.missingFields.length > 0 && <p className="upgrade-detail-missing">사양 미등록 {part.missingFields.length}개</p>}
    <div className="upgrade-detail-footer"><span>{part.listingType && part.listingType !== "retail" ? LISTING_TYPE_LABELS[part.listingType] : ""}</span>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">상품 페이지 보기 <FiExternalLink /></a>}</div>
  </div>;
}

export function UpgradeRecommendationComparison({ recommendations }: { recommendations: UpgradeRecommendation[] }) {
  return <div className="upgrade-comparison"><div className="upgrade-comparison-heading"><div><strong>업그레이드 부품 비교</strong><span>{recommendations.length}개 선택</span></div><FiLayers /></div><div className="upgrade-comparison-table-wrap"><table><caption>각 부품을 현재 구성에 적용해 계산한 비교예요.</caption><thead><tr><th scope="col">비교 항목</th>{recommendations.map((recommendation) => <th scope="col" key={`${recommendation.category}-${recommendation.part.id}`}>{recommendation.part.name}</th>)}</tr></thead><tbody><tr><th scope="row">현재 부품</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-current`}>{recommendation.currentPartName}</td>)}</tr><tr><th scope="row">분류</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-category`}>{CATEGORY_LABELS[recommendation.category]}</td>)}</tr><tr><th scope="row">수량</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-quantity`}>{recommendation.quantity}개</td>)}</tr><tr><th scope="row">개선 지표</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-dimensions`}>{recommendation.improvedDimensions.join(" · ")}</td>)}</tr><tr><th scope="row">비교 변화</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-improvement`}>+{recommendation.improvementPercent.toFixed(1)}%<br /><small>{recommendation.performanceSummary}</small></td>)}</tr><tr><th scope="row">가격</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-price`}>{recommendation.currentPriceWon !== undefined ? `${formatWon(recommendation.currentPriceWon)} → ` : "현재 가격 확인 필요 → "}{formatWon(recommendation.part.priceWon)}</td>)}</tr><tr><th scope="row">가격 변화</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-delta`}>{formatPriceDelta(recommendation.priceDeltaWon)}</td>)}</tr>{recommendations.some((recommendation) => recommendation.budgetEvidence) && <tr><th scope="row">예산</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-budget`}>{upgradeBudgetText(recommendation.budgetEvidence) ?? "목표 예산 미설정"}</td>)}</tr>}<tr><th scope="row">호환 여유</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-compatibility`}><strong>{upgradeCompatibilityStatus(recommendation.compatibilityEvidence)}</strong><br /><small>{upgradeCompatibilityText(recommendation.compatibilityEvidence)}</small></td>)}</tr>{recommendations.some((recommendation) => recommendation.expansionEvidence) && <tr><th scope="row">확장성 변화</th>{recommendations.map((recommendation) => <td className={`upgrade-expansion-cell ${upgradeExpansionTone(recommendation.expansionEvidence)}`} key={`${recommendation.part.id}-expansion`}>{upgradeExpansionText(recommendation.expansionEvidence)}</td>)}</tr>}{recommendations.some((recommendation) => recommendation.gpuTarget) && <tr><th scope="row">GPU 목표</th>{recommendations.map((recommendation) => <td key={`${recommendation.part.id}-target`}>{recommendation.gpuTarget?.summary ?? "해당 없음"}</td>)}</tr>}</tbody></table></div></div>;
}

export type AccessoryRecommendationSort = "recommended" | "price_asc" | "confidence";

export function accessoryRecommendationUpdatedLabel(item: AccessoryItem) {
  const date = new Date(item.updatedAt);
  return Number.isNaN(date.getTime()) ? "확인 필요" : date.toLocaleDateString("ko-KR");
}

export function accessoryRecommendationSpecRows(category: AccessoryCategory) {
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

export function AccessoryRecommendationPanel({ recommendations, selectedAccessories, onAddAccessory, onWatchAccessory, isAccessoryWatched }: { recommendations: AccessoryRecommendation[]; selectedAccessories: AccessorySelection[]; onAddAccessory: (item: AccessoryItem) => void; onWatchAccessory?: (item: AccessoryItem, targetPriceWon?: number) => boolean; isAccessoryWatched?: (item: AccessoryItem) => boolean }) {
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
    <div className="peripheral-recommendation-heading"><div><p className="eyebrow">PERIPHERAL ADD-ONS</p><h2>현재 구성에 맞는 주변 부품</h2><p>현재 견적에 더할 수 있는 주변 부품을 추천해요.</p></div><span className="peripheral-recommendation-icon"><FiTool /></span></div>
    <div className="peripheral-recommendation-controls"><div className="peripheral-recommendation-filters" role="group" aria-label="주변 부품 추천 범주"><button className={categoryFilter === "all" ? "selected" : ""} type="button" data-testid="accessory-recommendation-filter-all" aria-pressed={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>전체 {recommendations.length}</button>{availableCategories.map((category) => { const count = recommendations.filter((recommendation) => recommendation.category === category).length; return <button className={categoryFilter === category ? "selected" : ""} type="button" data-testid={`accessory-recommendation-filter-${category}`} aria-pressed={categoryFilter === category} onClick={() => setCategoryFilter(category)} key={category}>{ACCESSORY_CATEGORY_LABELS[category]} {count}</button>; })}</div><label className="peripheral-recommendation-sort"><span>추천 정렬</span><select aria-label="주변 부품 추천 정렬" data-testid="accessory-recommendation-sort" value={sortMode} onChange={(event) => setSortMode(event.target.value as AccessoryRecommendationSort)}><option value="recommended">추천 순</option><option value="price_asc">가격 낮은 순</option></select></label><a className="peripheral-recommendation-catalog-link" href="/accessories"><FiSearch /> 전체 카탈로그</a></div>
    <div className="peripheral-recommendation-compare-status">{compareIds.length > 0 ? <><FiLayers /> 같은 범주 부품 비교 {compareIds.length} / 3{compareCategory ? ` · ${ACCESSORY_CATEGORY_LABELS[compareCategory]}` : ""}</> : <><FiLayers /> 부품을 고르면 같은 범주끼리 최대 3개를 비교할 수 있어요.</>}</div>
    <div className="peripheral-recommendation-list">{visibleRecommendations.map((recommendation) => <AccessoryRecommendationCard key={recommendation.id} recommendation={recommendation} selected={selectedAccessories.some((selection) => selection.accessoryId === recommendation.item.id)} compared={compareIds.includes(recommendation.id)} compareDisabled={!compareIds.includes(recommendation.id) && (compareIds.length >= 3 || Boolean(compareCategory && compareCategory !== recommendation.category))} onToggleCompare={() => toggleCompare(recommendation)} onAddAccessory={onAddAccessory} onWatchAccessory={onWatchAccessory} isAccessoryWatched={isAccessoryWatched} />)}</div>
    {visibleRecommendations.length === 0 && <div className="peripheral-recommendation-empty"><FiSearch /> 선택한 범주에 맞는 추천 부품이 없어요. 전체 추천으로 돌아가 보세요.</div>}
    {comparedRecommendations.length >= 2 && <AccessoryRecommendationComparison recommendations={comparedRecommendations} />}
    <p className="peripheral-recommendation-note">주변 부품은 필요에 따라 견적에 추가할 수 있어요.</p>
  </section>;
}

export type AccessoryRecommendationPriceHistory = {
  itemId: string;
  windowDays: 7 | 30 | 90;
  points: Array<{ changeId: string; changedAt: string; priceWon: number }>;
  summary: PriceWatchDecisionHistory & { maxPriceWon?: number };
};

export function accessoryRecommendationPriceHistoryText(history: AccessoryRecommendationPriceHistory | undefined, currentPriceWon: number | undefined) {
  if (!history) return "가격 이력 확인 중";
  if (history.summary.sampleCount === 0) return `최근 ${history.windowDays}일 기록 없음 · 현재가만 확인`;
  const facts = [`최근 ${history.windowDays}일 ${history.summary.sampleCount}회`];
  if (history.summary.minPriceWon !== undefined) facts.push(`최저 ${formatWon(history.summary.minPriceWon)}`);
  if (currentPriceWon !== undefined && history.summary.currentPositionPercent !== undefined) facts.push(`현재 위치 ${history.summary.currentPositionPercent.toFixed(1)}%`);
  return facts.join(" · ");
}

export function AccessoryRecommendationComparison({ recommendations }: { recommendations: AccessoryRecommendation[] }) {
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
    { label: "마지막 갱신", value: (recommendation: AccessoryRecommendation) => accessoryRecommendationUpdatedLabel(recommendation.item) },
    { label: "필수 누락", value: (recommendation: AccessoryRecommendation) => recommendation.item.missingFields.length > 0 ? `${recommendation.item.missingFields.length}개` : "없음" },
    ...accessoryRecommendationSpecRows(category).map((row) => ({ label: row.label, value: (recommendation: AccessoryRecommendation) => row.value(recommendation.item) })),
    { label: "추천 이유", value: (recommendation: AccessoryRecommendation) => recommendation.reason },
    { label: "맞는 이유", value: (recommendation: AccessoryRecommendation) => recommendation.fitBasis }
  ];
  return <section className="peripheral-recommendation-comparison" data-testid="accessory-recommendation-comparison" aria-label="주변 부품 추천 비교"><div className="peripheral-recommendation-comparison-heading"><div><span>READ-ONLY COMPARISON</span><strong>{ACCESSORY_CATEGORY_LABELS[category]} 부품 비교</strong><small>선택한 부품의 저장된 데이터만 나란히 비교해요. 이 표는 견적을 변경하거나 호환성을 새로 정하지 않아요.</small></div><div className="peripheral-recommendation-comparison-heading-actions"><label><span>가격 이력</span><select aria-label="주변 부품 추천 가격 이력 기간" data-testid="accessory-recommendation-history-days" value={historyDays} onChange={(event) => setHistoryDays(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>7일</option><option value={30}>30일</option><option value={90}>90일</option></select></label><span>{recommendations.length}개 선택</span></div></div>{historyError && <p className="peripheral-recommendation-comparison-history-error" role="status"><FiInfo /> 가격 이력을 불러오지 못해 현재 가격과 저장된 추천 이유만 표시해요. {historyError}</p>}{historyLoading && <p className="peripheral-recommendation-comparison-history-loading" role="status"><FiLoader className="spin" /> 최근 가격 이력을 확인하는 중...</p>}<div className="peripheral-recommendation-comparison-table-wrap"><table><caption>주변 부품 추천 비교</caption><thead><tr><th scope="col">비교 항목</th>{recommendations.map((recommendation) => <th scope="col" key={recommendation.id}>{recommendation.item.name}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{recommendations.map((recommendation) => <td key={`${recommendation.id}-${row.label}`}>{row.value(recommendation)}</td>)}</tr>)}</tbody></table></div></section>;
}

export function AccessoryRecommendationCard({ recommendation, selected, compared, compareDisabled, onToggleCompare, onAddAccessory, onWatchAccessory, isAccessoryWatched }: { recommendation: AccessoryRecommendation; selected: boolean; compared: boolean; compareDisabled: boolean; onToggleCompare: () => void; onAddAccessory: (item: AccessoryItem) => void; onWatchAccessory?: (item: AccessoryItem, targetPriceWon?: number) => boolean; isAccessoryWatched?: (item: AccessoryItem) => boolean }) {
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
    <div className="peripheral-recommendation-top"><span className="category-badge">{ACCESSORY_CATEGORY_LABELS[recommendation.category]}</span><span>{recommendation.priority === "recommended" ? "추천" : "선택"}</span></div>
    <div className="peripheral-recommendation-body"><span className="peripheral-recommendation-image"><AccessoryVisual item={recommendation.item} /></span><div className="peripheral-recommendation-copy"><strong>{recommendation.item.name}</strong><p>{recommendation.reason}</p><small>{recommendation.fitBasis}</small>{recommendation.category === "storage_accessory" && recommendation.item.specs.adapterStorageDeviceCount !== undefined && <em className="peripheral-recommendation-capacity" data-testid="accessory-recommendation-capacity">어댑터 1개당 M.2 SSD 최대 {recommendation.item.specs.adapterStorageDeviceCount}개</em>}{recommendation.category === "storage_accessory" && recommendation.item.specs.adapterPcieSlotWidth !== undefined && <em className="peripheral-recommendation-capacity peripheral-recommendation-pcie-slot" data-testid="accessory-recommendation-pcie-slot">PCIe 슬롯 x{recommendation.item.specs.adapterPcieSlotWidth} 필요</em>}</div><div className="peripheral-recommendation-side"><strong>{formatWon(recommendation.item.priceWon)}</strong>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">상품 페이지 <FiExternalLink /></a>}<a className="peripheral-recommendation-catalog-item-link" data-testid="accessory-recommendation-open-catalog" href={catalogUrl}><FiSearch /> 카탈로그</a><button className={compared ? "button button-small accessory-compare-button selected" : "button button-small accessory-compare-button"} type="button" data-testid="accessory-recommendation-compare" onClick={onToggleCompare} disabled={compareDisabled} aria-pressed={compared} title={compareDisabled && !compared ? "같은 범주의 부품만 비교할 수 있어요." : undefined}><FiLayers /> {compared ? "비교 중" : "비교"}</button><button className="button button-small accessory-add-button" type="button" onClick={() => onAddAccessory(recommendation.item)} disabled={selected}>{selected ? <><FiCheck /> 추가됨</> : <><FiPlus /> 견적에 추가</>}</button>{onWatchAccessory && <div className="peripheral-recommendation-watch"><label><span>목표가</span><input type="number" min="1" step="1000" placeholder="선택" value={targetPriceDraft} data-testid="accessory-recommendation-watch-target" aria-label={`${recommendation.item.name} 추천 목표가`} onChange={(event) => { setTargetPriceDraft(event.target.value); setWatchError(null); }} /></label><button className="text-button" type="button" data-testid="accessory-recommendation-watch" onClick={savePriceWatch}>{watching ? "목표가 저장" : "가격 추적"}</button></div>}{watchError && <small className="peripheral-recommendation-watch-error" role="alert">{watchError}</small>}</div></div>
    <details className="peripheral-recommendation-details" data-testid="accessory-recommendation-details"><summary>상세 사양 보기 <FiChevronDown /></summary><div className="peripheral-recommendation-detail-grid">{accessoryRecommendationSpecRows(recommendation.category).map((row) => <div key={row.label}><span>{row.label}</span><strong>{row.value(recommendation.item)}</strong></div>)}</div></details>
  </article>;
}

export function CompatibilityMap({ links, findings = [], onFocusFinding }: { links: CompatibilityLink[]; findings?: Finding[]; onFocusFinding?: (ruleId: string) => void }) {
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

export function RepairPlanPanel({ plans, build, currentResult, partMap, onApply, onSavePlan, onFocusFinding }: { plans: RecommendationPlan[]; build: BuildSelection; currentResult: CompatibilityResult; partMap: ReadonlyMap<string, Part>; onApply: (plan: RecommendationPlan) => void; onSavePlan: (build: BuildSelection, preferences: RecommendationPreferences, label: string) => void; onFocusFinding?: (ruleId: string) => void }) {
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
  return <section className="repair-plan-panel" data-testid="repair-plan-panel" tabIndex={-1}><div className="repair-plan-heading"><div><p className="eyebrow">AUTO REPAIR PLANS</p><h2>한 번에 해결하는 추천 플랜</h2><p>호환 오류를 가장 많이 줄이면서 성능과 가격 변화를 함께 비교합니다.</p></div><span className="repair-plan-heading-icon"><FiZap /></span></div>{!hasFullyCompatiblePlan && <div className="repair-plan-goal-note" role="status"><FiInfo /><div><strong>완전 호환 플랜을 자동으로 정하지 않았어요.</strong><p>{fullPlanNote}</p></div></div>}<Suspense fallback={<div className="repair-plan-summary loading" data-testid="repair-plan-summary-loading">플랜 요약을 불러오는 중...</div>}><LazyRepairPlanSummaryTable plans={plans} build={build} onFocusPlan={focusPlan} /></Suspense><div className="repair-plan-grid">{plans.map((plan, index) => { const performanceRetention = repairPlanPerformanceRetentionFor(build, plan); return <article id={"repair-plan-card-" + index} className={index === 0 ? "repair-plan-card featured" : "repair-plan-card"} key={`${plan.label}-${plan.changes.map((change) => change.toPart.id).join("-")}`}><div className="repair-plan-top"><span className="repair-plan-label">{index === 0 ? `추천 1순위 · ${plan.label}` : plan.label}</span></div><h3>{plan.title}</h3><p className="repair-plan-reason">{plan.reason}</p><p className="repair-plan-profile"><FiActivity /> {plan.profileSummary}</p><p className={`repair-plan-performance-retention ${performanceRetention.status}`}><FiActivity /> {performanceRetention.summary}</p><div className="repair-plan-resolved"><span>해결 범위</span><div>{plan.resolvedFindingTitles.slice(0, 4).map((title) => <em key={title}>{title}</em>)}{plan.resolvedFindingTitles.length > 4 && <em>외 {plan.resolvedFindingTitles.length - 4}개</em>}</div></div>{plan.remainingFindingTitles && plan.remainingFindingTitles.length > 0 && <div className="repair-plan-remaining"><span>적용 후 남는 문제</span><div>{plan.remainingFindingTitles.slice(0, 3).map((title, index) => remainingFindingChip(plan, title, index))}{plan.remainingFindingTitles.length > 3 && <em>{"외 " + (plan.remainingFindingTitles.length - 3) + "개"}</em>}</div></div>}<div className="repair-plan-stats"><span><strong>{plan.resolvedBlockers}</strong> 차단 오류 해결</span><span><strong>{plan.remainingBlockers}</strong>개 남음</span><span><strong>{plan.remainingWarnings}</strong>개 주의 남음</span><span><strong>{plan.remainingUnknown}</strong>개 확인 필요</span><span><strong>{formatPriceDelta(plan.priceDeltaWon)}</strong> 가격 변화</span>{plan.budgetWon !== undefined && <span><strong>{!plan.priceComplete ? "확인 필요" : plan.withinBudget ? "예산 내" : `${formatPriceDelta(plan.budgetDeltaWon)} 초과`}</strong> 목표 예산</span>}</div><div className="repair-plan-changes">{plan.changes.map((change) => <div className="repair-plan-change" key={`${change.category}-${change.kind}-${change.toPart.id}-${change.toQuantity ?? ""}`}><span className="repair-plan-change-icon"><CategoryIcon category={change.category} /></span><div><small>{change.fromPartName ?? `${CATEGORY_LABELS[change.category]} 미선택`}</small><strong>{change.kind === "change_quantity" ? `수량 ${change.fromQuantity ?? "?"}개 → ${change.toQuantity ?? "?"}개` : `→ ${change.toPart.name}`}</strong>{change.toPart.listingType && change.toPart.listingType !== "retail" && <small>{LISTING_TYPE_LABELS[change.toPart.listingType]}</small>}<small>{change.performanceSummary}</small></div><em>{formatPriceDelta(change.priceDeltaWon)}</em></div>)}</div><div className="repair-plan-footer"><span>적용 후 {plan.priceComplete ? formatWon(plan.afterTotalPriceWon) : "가격 일부 확인 필요"}</span><div className="repair-plan-footer-actions"><button className="button button-small button-light" type="button" onClick={() => void comparePlan(plan)} disabled={comparisonState?.status === "loading"}><FiActivity /> {comparisonPlan === plan ? "비교 중" : "현재와 비교"}</button><button className="button button-small button-fix" type="button" onClick={() => onApply(plan)}>이 플랜 적용 <FiExternalLink /></button></div></div></article>; })}</div>{comparisonReady && <Suspense fallback={<div className="repair-plan-comparison loading" aria-label="수리 플랜 전체 비교" data-testid="repair-plan-comparison" role="status"><div className="repair-plan-comparison-heading"><div><p className="eyebrow">PLAN COMPARISON</p><h2>비교 화면을 불러오는 중...</h2><p>수리 플랜 적용 후 전체 견적을 준비합니다.</p></div><FiLoader className="spin" /></div></div>}><LazyRepairPlanComparisonPanel plan={comparisonPlan} state={comparisonState} currentBuild={build} currentResult={comparisonState.status === "ready" ? comparisonState.currentResult : currentResult} partMap={partMap} onApply={() => onApply(comparisonPlan)} onSavePlan={onSavePlan} onRetry={() => void comparePlan(comparisonPlan)} onClose={() => { requestSequenceRef.current += 1; setComparisonPlan(null); setComparisonState(null); }} /></Suspense>}</section>;
}
