import { useEffect, useRef, useState } from "react";
import { FiActivity, FiArrowLeft, FiCopy, FiDownload, FiInfo, FiLoader, FiRefreshCw, FiShare2, FiTrash2, FiXCircle } from "react-icons/fi";
import { BUDGET_LADDER_BANDS, type BudgetLadderExportItem, type BudgetLadderExportPayload, type BudgetLadderOutcome } from "../shared/budget-ladder";
import { budgetLadderBaseRequestFor, budgetLadderCsvForPayload, budgetLadderExportPayloadFor, budgetLadderScenariosFor, budgetLadderTextForPayload } from "../shared/budget-ladder";
import { budgetLadderVersionChangedRowsFor, budgetLadderVersionRequestText, budgetLadderVersionRowsFor } from "../shared/budget-ladder-version-comparison";
import { budgetLadderDerivedSnapshotNameFor } from "../shared/budget-ladder-share";
import type { BudgetLadderShareLineageResponse, BudgetLadderShareSnapshot } from "../shared/budget-ladder-share";
import type { BudgetLadderLocalShareEntry } from "../shared/budget-ladder-local-history";
import type { BuildGenerationDiagnostic, BuildGenerationRequest, BuildGenerationResult, BuildSelection, CompatibilityResult, PartCategory, PartSelection } from "../shared/types";
import { CATEGORY_LABELS, PART_CATEGORIES } from "../shared/types";
import { ApiError, api } from "./api";

type BudgetLadderRefreshState = {
  status: "idle" | "loading" | "ready" | "error";
  payload?: BudgetLadderExportPayload;
  outcomes?: BudgetLadderOutcome[];
  catalogSnapshotAt?: string;
  error?: string;
};

type BudgetLadderShareLink = {
  id: string;
  url: string;
  ownerToken: string;
  expiresAt?: string;
  parentId?: string;
  versionNumber?: number;
};

type BudgetLadderMergePreviewState = {
  status: "idle" | "loading" | "ready" | "error";
  result?: CompatibilityResult;
  error?: string;
};

type BudgetLadderShareResponse = BudgetLadderShareSnapshot & {
  ownerToken: string;
};

function sharedBudgetLadderResultText(item: BudgetLadderExportItem) {
  if (item.totalPriceWon === undefined) return "-";
  if (item.priceComplete === false) return "일부 가격 정보 없음";
  if (item.withinBudget === true) return `${Math.abs(item.budgetDeltaWon ?? 0).toLocaleString("ko-KR")}원 여유`;
  if (item.withinBudget === false) return `${(item.budgetDeltaWon ?? 0).toLocaleString("ko-KR")}원 초과`;
  return "예산 상태 정보 부족";
}

function sharedBudgetLadderRiskText(item: BudgetLadderExportItem) {
  if (item.blockerCount === undefined && item.warningCount === undefined && item.unknownCount === undefined) return "-";
  return `차단 ${item.blockerCount ?? 0} · 주의 ${item.warningCount ?? 0} · 정보 부족 ${item.unknownCount ?? 0}`;
}

function sharedBudgetLadderLineText(item: BudgetLadderExportItem, category: PartCategory) {
  return item.lines?.find((line) => line.category === category)?.text ?? "미포함";
}

function sharedBudgetLadderStatusTone(status: BudgetLadderExportItem["status"]) {
  return status === "호환 가능" ? "good" : status === "생성 실패" ? "error" : "review";
}

function refreshDiagnosticsFromError(error: unknown): BuildGenerationDiagnostic[] | undefined {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== "object" || Array.isArray(error.details)) return undefined;
  const details = error.details as Record<string, unknown>;
  if (!Array.isArray(details.diagnostics)) return undefined;
  const diagnostics = details.diagnostics.slice(0, 2).flatMap((value): BuildGenerationDiagnostic[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.summary !== "string" || !Array.isArray(item.facts)) return [];
    const facts = item.facts.slice(0, 4).flatMap((fact) => {
      if (!fact || typeof fact !== "object" || Array.isArray(fact)) return [];
      const entry = fact as Record<string, unknown>;
      return typeof entry.label === "string" && typeof entry.value === "string" ? [{ label: entry.label, value: entry.value }] : [];
    });
    return facts.length === Math.min(4, item.facts.length)
      ? [{ id: item.id, title: item.title, summary: item.summary, facts, ...(typeof item.recommendation === "string" ? { recommendation: item.recommendation } : {}) }]
      : [];
  });
  return diagnostics.length > 0 ? diagnostics : undefined;
}

function refreshErrorText(error: unknown) {
  return error instanceof Error ? error.message : "현재 등록된 부품 정보로 다시 생성하지 못했습니다.";
}

function sharedBudgetLadderDiagnosticText(item: BudgetLadderExportItem) {
  return (item.diagnostics ?? []).slice(0, 2).flatMap((diagnostic) => [diagnostic.title, diagnostic.summary, ...diagnostic.facts.slice(0, 4).map((fact) => `${fact.label} ${fact.value}`), ...(diagnostic.recommendation ? [`권장 ${diagnostic.recommendation}`] : [])]).join(" · ");
}

function sharedBudgetLadderSignedWon(value: number) {
  return value === 0 ? "변화 없음" : `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}원`;
}

function sharedBudgetLadderSignedCount(value: number) {
  return value === 0 ? "변화 없음" : `${value > 0 ? "+" : ""}${value}`;
}

function sharedBudgetLadderChangedLines(before: BudgetLadderExportItem, after: BudgetLadderExportItem) {
  if (before.status === "생성 실패" || after.status === "생성 실패") return [];
  return PART_CATEGORIES.flatMap((category) => {
    const beforeText = sharedBudgetLadderLineText(before, category);
    const afterText = sharedBudgetLadderLineText(after, category);
    return beforeText === afterText ? [] : [{ category, label: CATEGORY_LABELS[category], before: beforeText, after: afterText }];
  });
}

function targetSelectionFor(snapshot: BudgetLadderShareSnapshot) {
  return snapshot.payload.items.find((item) => item.id === "target")?.selection;
}

function selectionCategoryFor(selection: BuildSelection, category: PartCategory): PartSelection | PartSelection[] | undefined {
  if (category === "memory" || category === "ssd" || category === "hdd") return selection[category].map((item) => ({ ...item }));
  const single = selection[category] as PartSelection | undefined;
  return single ? { ...single } : undefined;
}

function cloneBuildSelection(selection: BuildSelection): BuildSelection {
  return {
    ...selection,
    ...(selection.cpu ? { cpu: { ...selection.cpu } } : {}),
    ...(selection.cooler ? { cooler: { ...selection.cooler } } : {}),
    ...(selection.motherboard ? { motherboard: { ...selection.motherboard } } : {}),
    ...(selection.gpu ? { gpu: { ...selection.gpu } } : {}),
    ...(selection.case ? { case: { ...selection.case } } : {}),
    ...(selection.psu ? { psu: { ...selection.psu } } : {}),
    memory: selection.memory.map((item) => ({ ...item })),
    ssd: selection.ssd.map((item) => ({ ...item })),
    hdd: selection.hdd.map((item) => ({ ...item })),
    accessories: (selection.accessories ?? []).map((item) => ({ ...item }))
  };
}

function assignSelectionCategory(selection: BuildSelection, category: PartCategory, value: PartSelection | PartSelection[] | undefined) {
  if (category === "memory" || category === "ssd" || category === "hdd") {
    selection[category] = Array.isArray(value) ? value.map((item) => ({ ...item })) : [];
    return;
  }
  if (Array.isArray(value)) return;
  switch (category) {
    case "cpu": selection.cpu = value; break;
    case "cooler": selection.cooler = value; break;
    case "motherboard": selection.motherboard = value; break;
    case "gpu": selection.gpu = value; break;
    case "case": selection.case = value; break;
    case "psu": selection.psu = value; break;
  }
}

function SharedBudgetLadderRefreshComparison({ before, after, outcomes, catalogSnapshotAt, onApplyDraft, applying, onSaveSnapshot, savedSnapshot, savingSnapshot, onRevokeSnapshot }: { before: BudgetLadderExportPayload; after: BudgetLadderExportPayload; outcomes: BudgetLadderOutcome[]; catalogSnapshotAt?: string; onApplyDraft: (draft: BuildGenerationResult, checkNow: boolean) => Promise<void>; applying: boolean; onSaveSnapshot: () => Promise<void>; savedSnapshot: BudgetLadderShareLink | null; savingSnapshot: boolean; onRevokeSnapshot: () => Promise<void> }) {
  return <section className="shared-budget-ladder-refresh" aria-label="예산 비교 결과 다시 보기">
    <div className="shared-budget-ladder-refresh-heading">
      <div><p className="eyebrow">예산별 비교</p><h3>지금 부품으로 다시 만든 결과</h3><p>공유 당시와 지금의 금액·부품 구성을 비교해요.</p></div>
      <span><FiRefreshCw /> {catalogSnapshotAt ? `가격·사양 업데이트 ${new Date(catalogSnapshotAt).toLocaleString("ko-KR")}` : "업데이트 시각 없음"}</span>
    </div>
    <div className="shared-budget-ladder-refresh-grid">
      {before.items.map((beforeItem) => {
        const afterItem = after.items.find((item) => item.id === beforeItem.id);
        const afterOutcome = outcomes.find((outcome) => outcome.id === beforeItem.id);
        const changedLines = afterItem ? sharedBudgetLadderChangedLines(beforeItem, afterItem) : [];
        const canCompareDetails = Boolean(afterItem && beforeItem.status !== "생성 실패" && afterItem.status !== "생성 실패");
        const totalDelta = canCompareDetails && beforeItem.totalPriceWon !== undefined && afterItem?.totalPriceWon !== undefined ? afterItem.totalPriceWon - beforeItem.totalPriceWon : undefined;
        const scoreDelta = canCompareDetails && beforeItem.analysisScore !== undefined && afterItem?.analysisScore !== undefined ? afterItem.analysisScore - beforeItem.analysisScore : undefined;
        const riskDelta = canCompareDetails && afterItem
          ? `차단 ${sharedBudgetLadderSignedCount((afterItem.blockerCount ?? 0) - (beforeItem.blockerCount ?? 0))} · 주의 ${sharedBudgetLadderSignedCount((afterItem.warningCount ?? 0) - (beforeItem.warningCount ?? 0))} · 정보 부족 ${sharedBudgetLadderSignedCount((afterItem.unknownCount ?? 0) - (beforeItem.unknownCount ?? 0))}`
          : "비교 불가";
        return <article className={afterItem?.status === "생성 실패" ? "failed" : ""} key={beforeItem.id}>
          <div className="shared-budget-ladder-refresh-card-top"><strong>{beforeItem.label}</strong><span>{beforeItem.status} → {afterItem?.status ?? "현재 결과 없음"}</span></div>
          {beforeItem.status === "생성 실패"
            ? <p className="shared-budget-ladder-refresh-failure"><FiXCircle /> 공유 당시 이 구간을 만들지 못했어요: {beforeItem.error ?? "공유 당시 이 구간을 생성하지 못했습니다."} · 현재 결과 {afterItem?.status ?? "없음"}{beforeItem.diagnostics?.length ? ` · ${sharedBudgetLadderDiagnosticText(beforeItem)}` : ""}</p>
            : afterItem?.status === "생성 실패"
              ? <p className="shared-budget-ladder-refresh-failure"><FiXCircle /> {afterItem.error ?? "현재 부품으로 이 구간을 만들지 못했어요."}{afterItem.diagnostics?.length ? ` · ${sharedBudgetLadderDiagnosticText(afterItem)}` : ""}</p>
            : <>
              <div className="shared-budget-ladder-refresh-metrics">
                <div><span>예상 합계</span><strong>{beforeItem.totalPriceWon === undefined ? "-" : `${beforeItem.totalPriceWon.toLocaleString("ko-KR")}원`} <em>→ {afterItem?.totalPriceWon === undefined ? "-" : `${afterItem.totalPriceWon.toLocaleString("ko-KR")}원`}</em></strong><small>{totalDelta === undefined ? "비교 불가" : sharedBudgetLadderSignedWon(totalDelta)}</small></div>
                <div><span>호환 상태</span><strong>{afterItem?.status ?? "결과 없음"}</strong><small>{changedLines.length}개 부품 변경</small></div>
                <div><span>예산 결과</span><strong>{sharedBudgetLadderResultText(beforeItem)} <em>→ {afterItem ? sharedBudgetLadderResultText(afterItem) : "-"}</em></strong><small>{beforeItem.priceComplete === false || afterItem?.priceComplete === false ? "일부 가격 정보 없음" : "가격 정보 있음"}</small></div>
              </div>
              {changedLines.length > 0
                ? <div className="shared-budget-ladder-refresh-lines"><span>변경된 부품</span>{changedLines.map((line) => <small key={line.category}><b>{line.label}</b> {line.before} → {line.after}</small>)}</div>
                : <p className="shared-budget-ladder-refresh-same"><FiActivity /> 부품과 수량 구성이 같습니다.</p>}
              {afterOutcome?.draft && <div className="shared-budget-ladder-refresh-actions"><button className="button button-light" type="button" onClick={() => void onApplyDraft(afterOutcome.draft!, false)} disabled={applying}><FiActivity /> 현재 결과 편집하기</button><button className="button button-primary" type="button" onClick={() => void onApplyDraft(afterOutcome.draft!, true)} disabled={applying}><FiRefreshCw /> 현재 결과 검사하기</button></div>}
            </>}
        </article>;
      })}
    </div>
    <p className="shared-budget-ladder-refresh-note"><FiInfo /> 공유한 견적은 그대로 보관돼요. 새 결과를 저장하면 별도 견적으로 추가돼요.</p>
    <div className="shared-budget-ladder-refresh-save"><div><strong>현재 결과 공유</strong><span>현재 결과를 새 공유 링크로 저장해요.</span></div><button className="button button-secondary" type="button" onClick={() => void onSaveSnapshot()} disabled={savingSnapshot}><FiShare2 /> {savingSnapshot ? "저장 중..." : "새 공유 링크 만들기"}</button>{savedSnapshot && <div className="shared-budget-ladder-refresh-share-preview" role="status"><label><span>v{savedSnapshot.versionNumber ?? 1} 새 공유 링크 · {savedSnapshot.expiresAt ? `${new Date(savedSnapshot.expiresAt).toLocaleString("ko-KR")} 만료` : "무기한"}</span><input aria-label="현재 결과 공유 링크" type="text" value={savedSnapshot.url} readOnly onFocus={(event) => event.currentTarget.select()} /></label><div>{savedSnapshot.parentId && <a className="text-button" href={`/budget-ladder/${encodeURIComponent(savedSnapshot.parentId)}`}><FiArrowLeft /> 이전 결과 보기</a>}<a className="text-button" href={savedSnapshot.url}><FiShare2 /> 열기</a><button className="text-button danger-text-button" type="button" onClick={() => void onRevokeSnapshot()}><FiTrash2 /> 공유 취소</button></div></div>}</div>
  </section>;
}

function SharedBudgetLadderLineage({ lineage }: { lineage: BudgetLadderShareLineageResponse }) {
  if (lineage.entries.length < 2) return null;
  return <nav className="shared-budget-ladder-lineage" aria-label="예산 비교 버전 이력"><div><strong>예산 비교 버전 이력</strong><span>이전 결과와 새로 만든 결과를 따로 보관해요.</span></div><div className="shared-budget-ladder-lineage-list">{lineage.entries.map((entry) => entry.expired ? <span className="expired" key={entry.id}>v{entry.versionNumber} · 만료</span> : <a className={entry.id === lineage.currentId ? "current" : ""} href={`/budget-ladder/${encodeURIComponent(entry.id)}`} key={entry.id}>v{entry.versionNumber}{entry.id === lineage.currentId ? " · 현재" : " · 이전"}</a>)}</div></nav>;
}

const BUDGET_LADDER_TREND_COLORS = ["#6f9bbd", "#6f9b87", "#9b7fb0"];

function SharedBudgetLadderVersionTrendGraph({ snapshots, metric, title, description }: { snapshots: BudgetLadderShareSnapshot[]; metric: "total" | "analysis"; title: string; description: string }) {
  const series = BUDGET_LADDER_BANDS.map((band, seriesIndex) => ({
    band,
    color: BUDGET_LADDER_TREND_COLORS[seriesIndex],
    values: snapshots.map((snapshot) => {
      const item = snapshot.payload.items.find((entry) => entry.id === band.id);
      return metric === "total" ? item?.totalPriceWon : item?.analysisScore;
    })
  }));
  const knownValues = series.flatMap((entry) => entry.values.filter((value): value is number => value !== undefined));
  if (knownValues.length === 0) return <div className="shared-budget-ladder-trend-card"><strong>{title}</strong><span>{description}</span><p>비교 가능한 값이 없습니다.</p></div>;
  const minimum = Math.min(...knownValues);
  const maximum = Math.max(...knownValues);
  const padding = minimum === maximum ? Math.max(1, Math.abs(minimum) * 0.1) : (maximum - minimum) * 0.08;
  const range = maximum - minimum + padding * 2;
  const xFor = (index: number) => snapshots.length === 1 ? 50 : 10 + (index / (snapshots.length - 1)) * 80;
  const yFor = (value: number) => 37 - ((value - minimum + padding) / range) * 29;
  const formatValue = (value: number) => metric === "total" ? `${Math.round(value / 1_000).toLocaleString("ko-KR")}k` : `${value}점`;
  const segmentsFor = (values: Array<number | undefined>) => {
    const segments: string[] = [];
    let current: string[] = [];
    values.forEach((value, index) => {
      if (value === undefined) {
        if (current.length > 1) segments.push(current.join(" "));
        current = [];
        return;
      }
      current.push(`${xFor(index)},${yFor(value)}`);
    });
    if (current.length > 1) segments.push(current.join(" "));
    return segments;
  };
  return <div className="shared-budget-ladder-trend-card"><div className="shared-budget-ladder-trend-card-heading"><div><strong>{title}</strong><span>{description}</span></div><small>{formatValue(minimum)}–{formatValue(maximum)}</small></div><svg viewBox="0 0 100 44" role="img" aria-label={`${title} 그래프`} preserveAspectRatio="none"><title>{title}</title><path d="M10 8H90 M10 22H90 M10 37H90" fill="none" stroke="currentColor" strokeDasharray="1 2" />{series.map((entry) => <g key={entry.band.id} style={{ color: entry.color }}>{segmentsFor(entry.values).map((segment, index) => <polyline key={`${entry.band.id}-segment-${index}`} points={segment} fill="none" vectorEffect="non-scaling-stroke" />)}{entry.values.map((value, index) => value === undefined ? null : <circle key={`${entry.band.id}-point-${index}`} cx={xFor(index)} cy={yFor(value)} r="1.5"><title>{entry.band.label} · v{snapshots[index].versionNumber ?? 1} · {formatValue(value)}</title></circle>)}</g>)}</svg><div className="shared-budget-ladder-trend-x-labels">{snapshots.map((snapshot) => <span key={snapshot.id}><b>v{snapshot.versionNumber ?? 1}</b><small>{new Date(snapshot.createdAt).toLocaleDateString("ko-KR")}</small></span>)}</div><div className="shared-budget-ladder-trend-legend">{series.map((entry) => <span key={entry.band.id}><i style={{ backgroundColor: entry.color }} />{entry.band.label}</span>)}</div></div>;
}

function SharedBudgetLadderVersionTrendCharts({ snapshots }: { snapshots: BudgetLadderShareSnapshot[] }) {
  return <section className="shared-budget-ladder-version-trends" aria-label="버전별 예산 비교 추이"><div className="shared-budget-ladder-version-trends-heading"><div><p className="eyebrow">저장 버전별 금액</p><h3>버전별 변화 추이</h3><p>저장한 견적의 예산별 예상 금액을 비교해요.</p></div><span>{snapshots.length}개 버전</span></div><div className="shared-budget-ladder-version-trends-grid"><SharedBudgetLadderVersionTrendGraph snapshots={snapshots} metric="total" title="예상 합계 추이" description="단위: 천원 · 저장 당시 합계" /></div></section>;
}

function SharedBudgetLadderVersionComparison({ lineage, currentSnapshot, onApplyVersion, onApplyMergedSelection, onPreviewMergedSelection }: { lineage: BudgetLadderShareLineageResponse; currentSnapshot: BudgetLadderShareSnapshot; onApplyVersion: (snapshot: BudgetLadderShareSnapshot) => Promise<void>; onApplyMergedSelection: (selection: BuildSelection, request: BuildGenerationRequest, checkNow: boolean) => Promise<void>; onPreviewMergedSelection: (selection: BuildSelection, request: BuildGenerationRequest, signal: AbortSignal) => Promise<CompatibilityResult> }) {
  const availableEntries = lineage.entries.filter((entry) => !entry.expired).sort((left, right) => left.versionNumber - right.versionNumber || left.createdAt.localeCompare(right.createdAt));
  const defaultIds = availableEntries.slice(-3).map((entry) => entry.id);
  if (!defaultIds.includes(currentSnapshot.id)) defaultIds.splice(0, 1, currentSnapshot.id);
  const [selectedIds, setSelectedIds] = useState(defaultIds);
  const [snapshots, setSnapshots] = useState<Record<string, BudgetLadderShareSnapshot>>({ [currentSnapshot.id]: currentSnapshot });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDifferencesOnly, setShowDifferencesOnly] = useState(false);
  const [applyingVersionId, setApplyingVersionId] = useState<string | null>(null);
  const applyRequestVersionRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      applyRequestVersionRef.current += 1;
    };
  }, []);
  const availableEntryKey = availableEntries.map((entry) => `${entry.id}:${entry.updatedAt}`).join("|");

  useEffect(() => {
    const nextIds = availableEntries.length >= 2 ? defaultIds : [];
    applyRequestVersionRef.current += 1;
    setSelectedIds((current) => current.length === nextIds.length && current.every((id, index) => id === nextIds[index]) ? current : nextIds);
    setSnapshots({ [currentSnapshot.id]: currentSnapshot });
    setShowDifferencesOnly(false);
    setApplyingVersionId(null);
    setError(null);
  }, [availableEntryKey, currentSnapshot]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    if (availableEntries.length < 2) {
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError(null);
    const selectedIdsForRequest = Array.from(new Set([currentSnapshot.id, ...selectedIds.filter((id) => availableEntries.some((entry) => entry.id === id))]));
    void Promise.all(selectedIdsForRequest.map(async (id) => {
      if (id === currentSnapshot.id) return currentSnapshot;
      return api<BudgetLadderShareSnapshot>(`/api/budget-ladders/${encodeURIComponent(id)}`, { signal: controller.signal });
    }))
      .then((values) => {
        if (cancelled) return;
        setSnapshots((current) => ({ ...current, ...Object.fromEntries(values.map((value) => [value.id, value])) }));
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "선택한 예산 비교 버전을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [availableEntryKey, currentSnapshot, selectedIds.join(",")]);

  const selectedSnapshots = selectedIds.map((id) => snapshots[id]).filter((value): value is BudgetLadderShareSnapshot => Boolean(value));
  const selectedEntryFor = (id: string) => availableEntries.find((entry) => entry.id === id);
  const setVersion = (index: number, id: string) => setSelectedIds((current) => current.map((value, currentIndex) => currentIndex === index ? id : value));
  const rows = budgetLadderVersionRowsFor(selectedSnapshots);
  const changedRows = budgetLadderVersionChangedRowsFor(rows);
  const visibleRows = showDifferencesOnly ? changedRows : rows;
  async function applyVersion(snapshot: BudgetLadderShareSnapshot) {
    const requestVersion = ++applyRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && applyRequestVersionRef.current === requestVersion;
    setApplyingVersionId(snapshot.id);
    try {
      await onApplyVersion(snapshot);
    } finally {
      if (isCurrent()) setApplyingVersionId(null);
    }
  }
  if (availableEntries.length < 2) return null;
  return <section className="shared-budget-ladder-version-comparison" aria-label="예산 비교 버전 상세 비교">
    <div className="shared-budget-ladder-version-comparison-heading"><div><h3>버전별 예산 비교</h3><p>같은 예산 비교에서 버전을 최대 3개 골라 조건·금액·호환 상태·부품 구성을 비교해요.</p></div><span>{availableEntries.length}개 버전 중 {selectedIds.length}개 선택</span></div>
    <div className="shared-budget-ladder-version-controls" role="group" aria-label="비교할 예산 버전 선택">{selectedIds.map((id, index) => <label key={`version-select-${index}`}><span>비교 열 {index + 1}</span><select aria-label={`비교 버전 ${index + 1}`} value={id} onChange={(event) => { setShowDifferencesOnly(false); setVersion(index, event.target.value); }}>{availableEntries.map((entry) => <option value={entry.id} disabled={selectedIds.includes(entry.id) && entry.id !== id} key={entry.id}>v{entry.versionNumber} · {entry.id === lineage.currentId ? "현재 링크" : entry.name}</option>)}</select></label>)}</div>
    <div className="shared-budget-ladder-version-toolbar"><span>결과가 달라진 행 {changedRows.length}개</span><button className={showDifferencesOnly ? "selected" : ""} type="button" aria-pressed={showDifferencesOnly} onClick={() => setShowDifferencesOnly((current) => !current)} disabled={changedRows.length === 0}>변경된 항목만 보기</button></div>
    {loading && <div className="shared-budget-ladder-version-state" role="status"><FiLoader className="spin" /> 선택한 예산 비교를 불러오는 중...</div>}
    {error && <div className="shared-budget-ladder-version-state error" role="alert"><FiXCircle /> {error}</div>}
    {!loading && !error && selectedSnapshots.length === selectedIds.length && <div className="shared-budget-ladder-version-table-wrap"><table><caption>{showDifferencesOnly ? "선택한 버전 사이에서 결과가 달라진 항목만 표시합니다." : "선택한 예산 비교의 저장 당시 결과입니다."}</caption><thead><tr><th scope="col">비교 항목</th>{selectedSnapshots.map((snapshot) => <th scope="col" key={snapshot.id}><span>v{snapshot.versionNumber ?? 1}</span><small>{selectedEntryFor(snapshot.id)?.id === lineage.currentId ? "현재 링크" : "저장 결과"}</small></th>)}</tr></thead><tbody>{visibleRows.length > 0 ? visibleRows.map((row) => <tr key={row.id}><th scope="row">{row.label}</th>{row.values.map((value, index) => <td className={row.diffable && row.changed && index > 0 ? "changed" : undefined} key={`${row.id}-${selectedSnapshots[index].id}`}>{value}</td>)}</tr>) : <tr><td className="shared-budget-ladder-version-empty" colSpan={selectedSnapshots.length + 1}>선택한 버전 사이에 달라진 결과 항목이 없습니다.</td></tr>}</tbody></table></div>}
    {!loading && !error && selectedSnapshots.length === selectedIds.length && <SharedBudgetLadderVersionTrendCharts snapshots={selectedSnapshots} />}
    {!loading && !error && selectedSnapshots.length === selectedIds.length && <SharedBudgetLadderPartialMergePanel snapshots={selectedSnapshots} onApplyMergedSelection={onApplyMergedSelection} onPreviewMergedSelection={onPreviewMergedSelection} />}
    {!loading && !error && selectedSnapshots.length === selectedIds.length && <div className="shared-budget-ladder-version-apply-actions" aria-label="선택 버전 적용">{selectedSnapshots.map((snapshot) => <button className="button button-light" type="button" key={`${snapshot.id}-apply`} onClick={() => void applyVersion(snapshot)} disabled={!snapshot.request || applyingVersionId !== null}><FiActivity /> {applyingVersionId === snapshot.id ? "적용 준비 중..." : `v${snapshot.versionNumber ?? 1} 조건으로 현재 구성 시작`}</button>)}</div>}
    <p className="shared-budget-ladder-version-note"><FiInfo /> 저장한 버전의 예산과 부품 구성을 비교해요. 최신 부품 정보로 보려면 각 버전에서 ‘현재 정보로 다시 만들기’를 선택하세요.</p>
  </section>;
}

function SharedBudgetLadderPartialMergePanel({ snapshots, onApplyMergedSelection, onPreviewMergedSelection }: { snapshots: BudgetLadderShareSnapshot[]; onApplyMergedSelection: (selection: BuildSelection, request: BuildGenerationRequest, checkNow: boolean) => Promise<void>; onPreviewMergedSelection: (selection: BuildSelection, request: BuildGenerationRequest, signal: AbortSignal) => Promise<CompatibilityResult> }) {
  const sourceSnapshots = snapshots.filter((snapshot) => Boolean(targetSelectionFor(snapshot)));
  const fallbackSourceId = sourceSnapshots.at(-1)?.id ?? "";
  const [sourceIds, setSourceIds] = useState<Record<PartCategory, string>>(() => Object.fromEntries(PART_CATEGORIES.map((category) => [category, fallbackSourceId])) as Record<PartCategory, string>);
  const [applying, setApplying] = useState(false);
  const [previewState, setPreviewState] = useState<BudgetLadderMergePreviewState>({ status: "idle" });
  const previewRequestVersionRef = useRef(0);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const applyRequestVersionRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      previewAbortControllerRef.current?.abort();
      previewAbortControllerRef.current = null;
      previewRequestVersionRef.current += 1;
      applyRequestVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!fallbackSourceId) return;
    previewRequestVersionRef.current += 1;
    previewAbortControllerRef.current?.abort();
    previewAbortControllerRef.current = null;
    applyRequestVersionRef.current += 1;
    setSourceIds((current) => Object.fromEntries(PART_CATEGORIES.map((category) => {
      const source = sourceSnapshots.find((snapshot) => snapshot.id === current[category]);
      return [category, source ? current[category] : fallbackSourceId];
    })) as Record<PartCategory, string>);
    setPreviewState({ status: "idle" });
    setApplying(false);
  }, [sourceSnapshots.map((snapshot) => snapshot.id).join(","), fallbackSourceId]);

  if (sourceSnapshots.length === 0) return <section className="shared-budget-ladder-merge" aria-label="예산 비교 부품 선택"><div className="shared-budget-ladder-merge-heading"><div><h3>부품별로 버전 골라 쓰기</h3><p>이전 버전은 부품 정보가 부족해 조합을 만들 수 없어요.</p></div></div><p className="shared-budget-ladder-merge-unavailable"><FiInfo /> 새로 저장한 견적부터 부품별로 골라 쓸 수 있어요.</p></section>;

  function mergedSelectionFor() {
    const base = targetSelectionFor(sourceSnapshots.at(-1)!);
    if (!base) return undefined;
    const merged = cloneBuildSelection(base);
    PART_CATEGORIES.forEach((category) => {
      const source = sourceSnapshots.find((snapshot) => snapshot.id === sourceIds[category]) ?? sourceSnapshots.at(-1)!;
      const sourceSelection = targetSelectionFor(source);
      if (sourceSelection) assignSelectionCategory(merged, category, selectionCategoryFor(sourceSelection, category));
    });
    delete merged.m2SlotSelection;
    return merged;
  }

  async function applyMerged(checkNow: boolean) {
    const merged = mergedSelectionFor();
    const request = sourceSnapshots.at(-1)?.request;
    if (!merged || !request) return;
    if (previewState.status !== "ready") {
      setPreviewState({ status: "error", error: "선택한 부품 조합을 먼저 검사해 주세요." });
      return;
    }
    const requestVersion = ++applyRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && applyRequestVersionRef.current === requestVersion;
    setApplying(true);
    try {
      await onApplyMergedSelection(merged, request, checkNow);
    } finally {
      if (isCurrent()) setApplying(false);
    }
  }

  async function previewMerged() {
    const merged = mergedSelectionFor();
    const request = sourceSnapshots.at(-1)?.request;
    if (!merged || !request) return;
    const requestVersion = ++previewRequestVersionRef.current;
    const isCurrent = () => mountedRef.current && previewRequestVersionRef.current === requestVersion;
    previewAbortControllerRef.current?.abort();
    const controller = new AbortController();
    previewAbortControllerRef.current = controller;
    setPreviewState({ status: "loading" });
    try {
      const result = await onPreviewMergedSelection(merged, request, controller.signal);
      if (!isCurrent() || controller.signal.aborted) return;
      setPreviewState({ status: "ready", result });
    } catch (reason: unknown) {
      if (!isCurrent() || controller.signal.aborted) return;
      setPreviewState({ status: "error", error: reason instanceof Error ? reason.message : "선택한 부품 조합을 검사하지 못했어요." });
    } finally {
      if (previewAbortControllerRef.current === controller) previewAbortControllerRef.current = null;
    }
  }

  const sourceLabelFor = (category: PartCategory) => {
    const source = sourceSnapshots.find((snapshot) => snapshot.id === sourceIds[category]) ?? sourceSnapshots.at(-1)!;
    return `v${source.versionNumber ?? 1} · ${sharedBudgetLadderLineText(source.payload.items.find((item) => item.id === "target") ?? source.payload.items[0], category)}`;
  };
  const previewResult = previewState.result;
  const previewStatusText = previewResult?.status === "compatible" ? "호환 가능" : previewResult?.status === "needs_review" ? "정보 부족" : previewResult ? "검토 필요" : "";
  return <section className="shared-budget-ladder-merge" aria-label="예산 비교 부품 선택"><div className="shared-budget-ladder-merge-heading"><div><h3>부품별로 버전 골라 쓰기</h3><p>예: CPU는 v1, GPU는 v3에서 골라 새 견적을 만들어요.</p></div><span>{sourceSnapshots.length}개 버전 사용 가능</span></div><div className="shared-budget-ladder-merge-controls">{PART_CATEGORIES.map((category) => <label key={category}><span>{CATEGORY_LABELS[category]} 적용 버전</span><select aria-label={`${CATEGORY_LABELS[category]} 적용 버전`} value={sourceIds[category]} onChange={(event) => { previewRequestVersionRef.current += 1; applyRequestVersionRef.current += 1; setApplying(false); setPreviewState({ status: "idle" }); setSourceIds((current) => ({ ...current, [category]: event.target.value })); }}>{sourceSnapshots.map((snapshot) => <option value={snapshot.id} key={`${category}-${snapshot.id}`}>v{snapshot.versionNumber ?? 1} · {sharedBudgetLadderLineText(snapshot.payload.items.find((item) => item.id === "target") ?? snapshot.payload.items[0], category)}</option>)}</select><small>{sourceLabelFor(category)}</small></label>)}</div><p className="shared-budget-ladder-merge-note"><FiInfo /> 버전마다 메인보드·SSD·메모리 조합이 다를 수 있어요. 적용 전 호환성을 다시 확인하고, M.2 슬롯은 자동으로 배치합니다.</p><button className="button button-secondary shared-budget-ladder-merge-preview-button" type="button" onClick={() => void previewMerged()} disabled={applying || previewState.status === "loading"}><FiRefreshCw /> {previewState.status === "loading" ? "호환 결과 계산 중..." : "선택 조합 호환 확인"}</button>{previewState.status === "error" && <p className="shared-budget-ladder-merge-preview-error" role="alert"><FiXCircle /> {previewState.error}</p>}{previewResult && <div className={`shared-budget-ladder-merge-preview ${previewResult.status}`} aria-label="선택 조합 호환 확인 결과"><div><strong>미리 보기 · {previewStatusText}</strong><span>{previewResult.priceComplete ? `${previewResult.totalPriceWon.toLocaleString("ko-KR")}원` : "가격 정보 없음"}</span></div><p>차단 {previewResult.blockerCount}개 · 주의 {previewResult.warningCount}개 · 정보 부족 {previewResult.unknownCount}개 · 현재 견적은 아직 바뀌지 않았습니다.</p>{previewResult.findings.filter((finding) => finding.severity !== "info").slice(0, 3).map((finding) => <small key={finding.id}><b>{finding.severity === "blocker" ? "차단" : finding.severity === "warning" ? "주의" : "확인"}</b> {finding.title}</small>)}</div>}<div className="shared-budget-ladder-merge-actions"><button className="button button-light" type="button" onClick={() => void applyMerged(false)} disabled={applying || previewState.status !== "ready"}><FiActivity /> 선택한 구성 편집하기</button><button className="button button-primary" type="button" onClick={() => void applyMerged(true)} disabled={applying || previewState.status !== "ready"}><FiRefreshCw /> 선택 조합 적용 후 결과 보기</button></div></section>;
}

export function SharedBudgetLadderView({ onBack, onToast, onApplyDraft, onApplyMergedSelection, onPreviewMergedSelection, onBudgetLadderShareSaved, onBudgetLadderShareRevoked }: { onBack: () => void; onToast: (message: string) => void; onApplyDraft: (draft: BuildGenerationResult, checkNow: boolean) => Promise<void>; onApplyMergedSelection: (selection: BuildSelection, request: BuildGenerationRequest, checkNow: boolean) => Promise<void>; onPreviewMergedSelection: (selection: BuildSelection, request: BuildGenerationRequest, signal: AbortSignal) => Promise<CompatibilityResult>; onBudgetLadderShareSaved: (share: BudgetLadderLocalShareEntry) => void; onBudgetLadderShareRevoked: (id: string) => void }) {
  const shareId = window.location.pathname.split("/").filter(Boolean).at(-1) ?? "";
  const [snapshot, setSnapshot] = useState<BudgetLadderShareSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<BudgetLadderRefreshState>({ status: "idle" });
  const [applyingDraft, setApplyingDraft] = useState(false);
  const [savedRefreshSnapshot, setSavedRefreshSnapshot] = useState<BudgetLadderShareLink | null>(null);
  const [savingRefreshSnapshot, setSavingRefreshSnapshot] = useState(false);
  const [lineage, setLineage] = useState<BudgetLadderShareLineageResponse | null>(null);
  const refreshRequestVersionRef = useRef(0);
  const refreshAbortControllerRef = useRef<AbortController | null>(null);
  const versionApplyAbortControllerRef = useRef<AbortController | null>(null);
  const snapshotSaveAbortControllerRef = useRef<AbortController | null>(null);
  const mutationRequestVersionRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshAbortControllerRef.current?.abort();
      refreshAbortControllerRef.current = null;
      versionApplyAbortControllerRef.current?.abort();
      versionApplyAbortControllerRef.current = null;
      snapshotSaveAbortControllerRef.current?.abort();
      snapshotSaveAbortControllerRef.current = null;
      refreshRequestVersionRef.current += 1;
      mutationRequestVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    refreshRequestVersionRef.current += 1;
    setLoading(true);
    setRefreshState({ status: "idle" });
    setSavedRefreshSnapshot(null);
    setSavingRefreshSnapshot(false);
    setApplyingDraft(false);
    void api<BudgetLadderShareSnapshot>(`/api/budget-ladders/${encodeURIComponent(shareId)}`, { signal: controller.signal })
      .then((value) => { if (!cancelled) { setSnapshot(value); setLineage(null); setRefreshState({ status: "idle" }); setSavedRefreshSnapshot(null); setError(null); void api<BudgetLadderShareLineageResponse>(`/api/budget-ladders/${encodeURIComponent(shareId)}/lineage`, { signal: controller.signal }).then((entries) => { if (!cancelled) setLineage(entries); }).catch(() => undefined); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "공유 예산 구간 비교를 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); refreshAbortControllerRef.current?.abort(); refreshAbortControllerRef.current = null; versionApplyAbortControllerRef.current?.abort(); versionApplyAbortControllerRef.current = null; snapshotSaveAbortControllerRef.current?.abort(); snapshotSaveAbortControllerRef.current = null; refreshRequestVersionRef.current += 1; mutationRequestVersionRef.current += 1; };
  }, [shareId]);

  async function refreshAgainstCurrentCatalog() {
    if (!snapshot?.request) {
      setRefreshState({ status: "error", error: "이 공유 견적에는 다시 만들 조건이 저장되지 않았어요." });
      return;
    }
    refreshAbortControllerRef.current?.abort();
    const controller = new AbortController();
    refreshAbortControllerRef.current = controller;
    const requestVersion = ++refreshRequestVersionRef.current;
    setRefreshState({ status: "loading" });
    setSavedRefreshSnapshot(null);
    try {
      const scenarios = budgetLadderScenariosFor(snapshot.request);
      const outcomes = await Promise.all(scenarios.map(async (scenario): Promise<BudgetLadderOutcome> => {
        try {
          const draft = await api<BuildGenerationResult>("/api/builds/recommend", { method: "POST", body: JSON.stringify(scenario.request), retry: 1, retryOnRateLimit: true, signal: controller.signal });
          return { ...scenario, draft };
        } catch (reason: unknown) {
          if (controller.signal.aborted || !mountedRef.current || refreshRequestVersionRef.current !== requestVersion) throw reason;
          const diagnostics = refreshDiagnosticsFromError(reason);
          return { ...scenario, error: refreshErrorText(reason), ...(diagnostics ? { diagnostics } : {}) };
        }
      }));
      if (!mountedRef.current || refreshRequestVersionRef.current !== requestVersion || controller.signal.aborted) return;
      const meta = await api<{ catalogUpdatedAt: string }>("/api/meta", { retry: 1, signal: controller.signal });
      if (!mountedRef.current || refreshRequestVersionRef.current !== requestVersion || controller.signal.aborted) return;
      setRefreshState({ status: "ready", payload: budgetLadderExportPayloadFor(outcomes), outcomes, catalogSnapshotAt: meta.catalogUpdatedAt });
    } catch (reason: unknown) {
      if (mountedRef.current && refreshRequestVersionRef.current === requestVersion) setRefreshState({ status: "error", error: refreshErrorText(reason) });
    } finally {
      if (refreshAbortControllerRef.current === controller) refreshAbortControllerRef.current = null;
    }
  }

  async function applyRefreshedDraft(draft: BuildGenerationResult, checkNow: boolean) {
    const requestVersion = ++mutationRequestVersionRef.current;
    setApplyingDraft(true);
    try {
      await onApplyDraft(draft, checkNow);
    } finally {
      if (mountedRef.current && mutationRequestVersionRef.current === requestVersion) setApplyingDraft(false);
    }
  }

  async function applyVersionSnapshot(version: BudgetLadderShareSnapshot) {
    if (!version.request) {
      onToast("이 버전에는 다시 만들 조건이 없어요.");
      return;
    }
    const targetScenario = budgetLadderScenariosFor(version.request).find((scenario) => scenario.id === "target");
    if (!targetScenario) {
      onToast("이 버전의 예산 조건을 불러오지 못했어요.");
      return;
    }
    versionApplyAbortControllerRef.current?.abort();
    const controller = new AbortController();
    versionApplyAbortControllerRef.current = controller;
    const requestVersion = ++mutationRequestVersionRef.current;
    try {
      const draft = await api<BuildGenerationResult>("/api/builds/recommend", { method: "POST", body: JSON.stringify(targetScenario.request), retry: 1, retryOnRateLimit: true, signal: controller.signal });
      if (!mountedRef.current || mutationRequestVersionRef.current !== requestVersion || controller.signal.aborted) return;
      await onApplyDraft(draft, false);
    } catch (reason: unknown) {
      if (mountedRef.current && mutationRequestVersionRef.current === requestVersion && !controller.signal.aborted) onToast(reason instanceof Error ? reason.message : "선택한 버전으로 새 견적을 만들지 못했어요.");
    } finally {
      if (versionApplyAbortControllerRef.current === controller) versionApplyAbortControllerRef.current = null;
    }
  }

  async function saveCurrentRefreshSnapshot() {
    const outcomes = refreshState.outcomes;
    if (!snapshot || !outcomes || outcomes.length === 0) return;
    snapshotSaveAbortControllerRef.current?.abort();
    const controller = new AbortController();
    snapshotSaveAbortControllerRef.current = controller;
    const requestVersion = ++mutationRequestVersionRef.current;
    setSavingRefreshSnapshot(true);
    try {
      const request = budgetLadderBaseRequestFor(outcomes);
      const saved = await api<BudgetLadderShareResponse>("/api/budget-ladders", {
        method: "POST",
        body: JSON.stringify({
          name: budgetLadderDerivedSnapshotNameFor(snapshot.name),
          payload: budgetLadderExportPayloadFor(outcomes),
          ...(request ? { request } : {}),
          parentId: shareId,
          expiresInDays: 30
        }),
        retry: 0,
        signal: controller.signal
      });
      if (!mountedRef.current || mutationRequestVersionRef.current !== requestVersion || controller.signal.aborted) return;
      const url = `${window.location.origin}/budget-ladder/${saved.id}`;
      setSavedRefreshSnapshot({ id: saved.id, url, ownerToken: saved.ownerToken, ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), ...(saved.parentId ? { parentId: saved.parentId } : {}), ...(saved.versionNumber !== undefined ? { versionNumber: saved.versionNumber } : {}) });
      onBudgetLadderShareSaved({ id: saved.id, url, name: saved.name, createdAt: saved.createdAt, ...(saved.versionNumber !== undefined ? { versionNumber: saved.versionNumber } : {}), ...(saved.expiresAt ? { expiresAt: saved.expiresAt } : {}), ownerToken: saved.ownerToken });
      try {
        await navigator.clipboard.writeText(url);
        if (!mountedRef.current || mutationRequestVersionRef.current !== requestVersion || controller.signal.aborted) return;
        onToast("현재 결과를 새 공유 링크로 저장하고 복사했어요.");
      } catch {
        if (!mountedRef.current || mutationRequestVersionRef.current !== requestVersion || controller.signal.aborted) return;
        onToast(`현재 결과를 새 공유 링크로 저장했어요: ${url}`);
      }
    } catch (reason: unknown) {
      if (mountedRef.current && mutationRequestVersionRef.current === requestVersion && !controller.signal.aborted) onToast(reason instanceof Error ? reason.message : "새 공유 링크를 만들지 못했어요.");
    } finally {
      if (mountedRef.current && mutationRequestVersionRef.current === requestVersion) setSavingRefreshSnapshot(false);
      if (snapshotSaveAbortControllerRef.current === controller) snapshotSaveAbortControllerRef.current = null;
    }
  }

  async function revokeSavedRefreshSnapshot() {
    if (!savedRefreshSnapshot || !window.confirm("현재 결과의 공유 링크를 취소할까요? 취소하면 이 링크는 더 이상 열리지 않아요.")) return;
    snapshotSaveAbortControllerRef.current?.abort();
    const controller = new AbortController();
    snapshotSaveAbortControllerRef.current = controller;
    const requestVersion = ++mutationRequestVersionRef.current;
    const snapshotId = savedRefreshSnapshot.id;
    try {
      await api(`/api/budget-ladders/${encodeURIComponent(savedRefreshSnapshot.id)}`, { method: "DELETE", headers: { "X-Share-Owner-Token": savedRefreshSnapshot.ownerToken }, retry: 0, signal: controller.signal });
      if (!mountedRef.current || mutationRequestVersionRef.current !== requestVersion || controller.signal.aborted) return;
      setSavedRefreshSnapshot(null);
      onBudgetLadderShareRevoked(snapshotId);
      if (mountedRef.current) onToast("현재 결과의 공유 링크를 취소했어요.");
    } catch (reason: unknown) {
      if (mountedRef.current && mutationRequestVersionRef.current === requestVersion && !controller.signal.aborted) onToast(reason instanceof Error ? reason.message : "공유 링크를 취소하지 못했어요.");
    } finally {
      if (snapshotSaveAbortControllerRef.current === controller) snapshotSaveAbortControllerRef.current = null;
    }
  }

  async function copySnapshot() {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(budgetLadderTextForPayload(snapshot.payload));
      if (mountedRef.current) onToast("예산 비교표를 복사했어요.");
    } catch {
      if (mountedRef.current) onToast("복사하지 못했어요. 브라우저에서 복사를 허용한 뒤 다시 시도해 주세요.");
    }
  }

  function downloadSnapshot(format: "csv" | "json") {
    if (!snapshot) return;
    const content = format === "csv" ? budgetLadderCsvForPayload(snapshot.payload) : JSON.stringify(snapshot, null, 2);
    const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-shared-budget-ladder-${shareId}-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1_000);
    onToast(`예산 비교표를 ${format.toUpperCase()} 파일로 저장했어요.`);
  }

  const payload = snapshot?.payload;
  const catalogState = snapshot?.catalogChangedSinceShare === undefined
    ? "현재 부품 정보를 불러오지 못했어요."
    : snapshot.catalogChangedSinceShare
      ? "현재 부품의 가격·사양이 공유 당시와 달라요."
      : "현재 부품의 가격·사양이 공유 당시와 같아요.";
  return <div className="shared-budget-ladder-page">
    <div className="workspace-heading"><div><button className="back-link" type="button" onClick={onBack}><FiArrowLeft /> 홈으로</button><p className="eyebrow">공유 예산 비교</p><h1>{snapshot?.name ?? (loading ? "공유 예산 비교를 불러오는 중" : "공유 예산 구간 비교")}</h1><p>공유된 예산별 예상 금액과 부품 구성을 비교해요.</p></div><span className="admin-badge"><FiShare2 /> 공유 견적</span></div>
    {loading
      ? <div className="shared-budget-ladder-state"><FiLoader className="spin" /> 공유 예산 비교를 불러오는 중...</div>
      : error
        ? <div className="shared-budget-ladder-state error" role="alert"><FiXCircle /><span>{error}</span><button className="text-button" type="button" onClick={onBack}>홈으로</button></div>
        : snapshot && payload && <section className="shared-budget-ladder-card" aria-label="공유 예산 구간 비교">
          <div className="shared-budget-ladder-card-heading"><div><p className="eyebrow">공유한 예산 비교</p><h2>{snapshot.name}</h2><small>v{snapshot.versionNumber ?? 1} · 생성 {new Date(snapshot.createdAt).toLocaleString("ko-KR")} · {snapshot.expiresAt ? `만료 ${new Date(snapshot.expiresAt).toLocaleString("ko-KR")}` : "무기한"}{snapshot.parentId && <> · <a className="shared-budget-ladder-parent-link" href={`/budget-ladder/${encodeURIComponent(snapshot.parentId)}`}>이전 버전 보기</a></>}</small></div><div className="shared-budget-ladder-actions"><button className="button button-light" type="button" onClick={() => void copySnapshot()}><FiCopy /> 비교 복사</button><button className="button button-light" type="button" onClick={() => downloadSnapshot("csv")}><FiDownload /> CSV 저장</button><button className="button button-light" type="button" onClick={() => downloadSnapshot("json")}><FiDownload /> JSON 저장</button><button className="button button-secondary" type="button" onClick={() => void refreshAgainstCurrentCatalog()} disabled={!snapshot.request || refreshState.status === "loading"}><FiRefreshCw /> {refreshState.status === "loading" ? "다시 만드는 중..." : "현재 정보로 다시 만들기"}</button></div></div>
          {lineage && <><SharedBudgetLadderLineage lineage={lineage} /><SharedBudgetLadderVersionComparison lineage={lineage} currentSnapshot={snapshot} onApplyVersion={applyVersionSnapshot} onApplyMergedSelection={onApplyMergedSelection} onPreviewMergedSelection={onPreviewMergedSelection} /></>}
          <div className="shared-budget-ladder-context"><div><span>생성 조건</span><strong>{budgetLadderVersionRequestText(snapshot.request)}</strong></div><div className={snapshot.catalogChangedSinceShare ? "changed" : "same"}><span>현재 부품 정보</span><strong>{catalogState}</strong><small>공유 당시 기준 {new Date(snapshot.catalogSnapshotAt).toLocaleString("ko-KR")}{snapshot.catalogCurrentSnapshotAt ? ` · 현재 기준 ${new Date(snapshot.catalogCurrentSnapshotAt).toLocaleString("ko-KR")}` : ""}</small></div></div>
          {refreshState.status === "error" && <div className="shared-budget-ladder-refresh-error" role="alert"><FiXCircle /> {refreshState.error}</div>}
          {refreshState.status === "loading" && <div className="shared-budget-ladder-refresh-loading" role="status"><FiLoader className="spin" /> 절약형·목표 예산·여유형을 새로 만드는 중...</div>}
          {refreshState.status === "ready" && refreshState.payload && refreshState.outcomes && <SharedBudgetLadderRefreshComparison before={payload} after={refreshState.payload} outcomes={refreshState.outcomes} catalogSnapshotAt={refreshState.catalogSnapshotAt} onApplyDraft={applyRefreshedDraft} applying={applyingDraft} onSaveSnapshot={saveCurrentRefreshSnapshot} savedSnapshot={savedRefreshSnapshot} savingSnapshot={savingRefreshSnapshot} onRevokeSnapshot={revokeSavedRefreshSnapshot} />}
          <div className="shared-budget-ladder-table-wrap"><table><caption>공유 당시 예산과 부품 구성입니다.</caption><thead><tr><th scope="col">비교 항목</th>{payload.items.map((item) => <th scope="col" key={item.id}>{item.label}</th>)}</tr></thead><tbody><tr><th scope="row">상태</th>{payload.items.map((item) => <td key={`${item.id}-status`}><span className={`shared-budget-ladder-status ${sharedBudgetLadderStatusTone(item.status)}`}>{item.status}</span></td>)}</tr><tr><th scope="row">목표 예산</th>{payload.items.map((item) => <td key={`${item.id}-budget`}>{item.budgetWon.toLocaleString("ko-KR")}원</td>)}</tr><tr><th scope="row">예상 합계</th>{payload.items.map((item) => <td key={`${item.id}-total`}>{item.totalPriceWon === undefined ? "-" : `${item.totalPriceWon.toLocaleString("ko-KR")}원`}</td>)}</tr><tr><th scope="row">예산 결과</th>{payload.items.map((item) => <td key={`${item.id}-budget-result`}>{sharedBudgetLadderResultText(item)}</td>)}</tr>{PART_CATEGORIES.map((category) => <tr key={category}><th scope="row">{CATEGORY_LABELS[category]}</th>{payload.items.map((item) => <td key={`${item.id}-${category}`}>{sharedBudgetLadderLineText(item, category)}</td>)}</tr>)}{payload.items.some((item) => item.error) && <tr><th scope="row">오류</th>{payload.items.map((item) => <td key={`${item.id}-error`}>{item.error ?? "-"}</td>)}</tr>}</tbody></table></div>
          {payload.items.some((item) => item.diagnostics?.length) && <section className="shared-budget-ladder-diagnostics" aria-label="생성 실패 원인"><strong><FiInfo /> 만들지 못한 구간의 이유</strong>{payload.items.filter((item) => item.diagnostics?.length).map((item) => <article key={`${item.id}-diagnostics`}><b>{item.label}</b>{item.diagnostics?.slice(0, 2).map((diagnostic) => <div key={diagnostic.id}><strong>{diagnostic.title}</strong><p>{diagnostic.summary}</p><small>{diagnostic.facts.map((fact) => `${fact.label} ${fact.value}`).join(" · ")}{diagnostic.recommendation ? ` · 권장 ${diagnostic.recommendation}` : ""}</small></div>)}</article>)}</section>}
          {payload.changes.length > 0 && <section className="shared-budget-ladder-changes" aria-label="예산 증액 효과"><div><strong>예산 증액으로 바뀐 것</strong><span>공유 당시 성공한 인접 구간만 표시합니다.</span></div>{payload.changes.map((change) => <article key={`${change.fromId}-${change.toId}`}><div><strong>{change.fromLabel} → {change.toLabel}</strong><span>예산 {change.budgetDeltaWon >= 0 ? "+" : ""}{change.budgetDeltaWon.toLocaleString("ko-KR")}원 · 실제 합계 {change.totalPriceDeltaWon >= 0 ? "+" : ""}{change.totalPriceDeltaWon.toLocaleString("ko-KR")}원</span></div>{change.sameConfiguration ? <small>부품·수량 구성 동일</small> : <div>{change.changedLines.map((line) => <small key={line.category}><b>{line.label}</b> {line.before} → {line.after}</small>)}</div>}</article>)}</section>}
        </section>}
  </div>;
}
