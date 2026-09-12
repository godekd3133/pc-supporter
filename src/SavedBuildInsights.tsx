import { useEffect, useRef, useState, type ComponentType } from "react";
import { FiActivity, FiAlertTriangle, FiCopy, FiDownload, FiExternalLink, FiGitBranch, FiInfo, FiLayers, FiLoader, FiRefreshCw, FiShare2, FiZap, FiXCircle } from "react-icons/fi";
import { savedBuildPriorityMatches } from "../shared/saved-build-priority";
import type { SavedBuildPriorityFilter, SavedBuildPriorityRow } from "../shared/saved-build-priority";
import type { SavedBuildPriorityAction } from "../shared/saved-build-priority-action";
import { savedBuildVersionLabelFor, savedBuildVersionNumberFor } from "../shared/saved-build-version";
import type { SavedBuildVersionGroup } from "../shared/saved-build-version";
import { savedBuildVersionDeltaFor } from "../shared/saved-build-version-delta";
import { buildTransferDiffFor } from "../shared/build-transfer-diff";
import { savedBuildVersionComparisonExportFor, savedBuildVersionComparisonTextFor } from "../shared/saved-build-version-export";
import type { AccessoryItem, SavedBuild, SavedBuildCheckSnapshot, Part, PartCategory, RecommendationPreferences } from "../shared/types";
import { CATEGORY_LABELS, isKnownPrice, PART_CATEGORIES } from "../shared/types";

export type SavedBuildPriorityActionViewState =
  | { status: "loading" }
  | { status: "ready"; value: SavedBuildPriorityAction }
  | { status: "error"; message: string };

function formatWon(value: number | undefined) {
  return isKnownPrice(value) ? `${value.toLocaleString("ko-KR")}원` : "가격 확인 중";
}

function formatPriceDelta(value: number | undefined) {
  if (value === undefined) return "가격 확인 필요";
  if (value === 0) return "현재와 같은 가격";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}원`;
}

function savedCheckStatusText(status: SavedBuildCheckSnapshot["status"]) {
  return status === "compatible" ? "호환 가능" : status === "needs_review" ? "확인 필요" : "호환 불가";
}

function savedCheckRiskText(snapshot: SavedBuildCheckSnapshot) {
  const accessory = snapshot.accessoryCompatibility;
  const base = `${snapshot.blockerCount} 차단 · ${snapshot.warningCount} 주의 · ${snapshot.unknownCount} 확인 필요`;
  return !accessory || (accessory.blockerCount === 0 && accessory.warningCount === 0 && accessory.unknownCount === 0)
    ? base
    : `${base} · 주변 ${accessory.blockerCount} 차단 · ${accessory.warningCount} 주의 · ${accessory.unknownCount} 확인 필요`;
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

function versionDeltaDirectionLabel(direction: NonNullable<ReturnType<typeof savedBuildVersionDeltaFor>["transition"]>["direction"] | undefined) {
  return direction === "improved" ? "위험 감소" : direction === "regressed" ? "위험 증가" : direction === "changed" ? "일부 변경" : direction === "same" ? "변화 없음" : "비교 기준 없음";
}

function signedVersionDelta(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function SavedBuildPriorityPanel({ rows, actionStates, openingBuildId, onAnalyzeAction, onOpen }: { rows: SavedBuildPriorityRow[]; actionStates: Record<string, SavedBuildPriorityActionViewState>; openingBuildId: string | null; onAnalyzeAction: (id: string) => void; onOpen: (id: string) => void }) {
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
        <div className="saved-build-priority-action"><span>{priorityRiskDeltaText(row)}</span><button className="text-button" type="button" onClick={() => onAnalyzeAction(row.id)} disabled={actionState?.status === "loading"}>{actionState?.status === "loading" ? <><FiLoader className="spin" /> 조치 계산 중...</> : actionState?.status === "ready" ? <><FiRefreshCw /> 조치 다시 계산</> : <><FiZap /> 다음 조치 분석</>}</button><button className="text-button" type="button" onClick={() => onOpen(row.id)} disabled={openingBuildId !== null}>{openingBuildId === row.id ? <><FiLoader className="spin" /> 불러오는 중...</> : <><FiExternalLink /> 견적 보기</>}</button></div>
        {actionState?.status === "error" && <div className="saved-build-priority-action-detail error" role="alert"><FiXCircle /><span>{actionState.message}</span><button className="text-button" type="button" onClick={() => onAnalyzeAction(row.id)}>다시 시도</button></div>}
        {actionValue && <div className="saved-build-priority-action-detail" data-testid={`saved-build-priority-action-${row.id}`}><div className="saved-build-priority-action-heading"><strong>{actionValue.title}</strong><span>{actionValue.kind === "repair_plan" ? "전체 규칙 엔진 수리 플랜" : actionValue.kind === "analysis" ? "분석 엔진 제안" : "추가 후보 없음"}</span></div>{actionValue.nextAction && <p className="saved-build-priority-action-next"><FiZap /> <strong>먼저 확인</strong> {actionValue.nextAction}</p>}{actionValue.changes.length > 0 && <div className="saved-build-priority-action-changes">{actionValue.changes.slice(0, 3).map((change) => <span key={`${change.category}-${change.toPartName}-${change.toQuantity ?? ""}`}><b>{CATEGORY_LABELS[change.category]}</b>{change.kind === "change_quantity" ? `${change.fromQuantity ?? "?"}개 → ${change.toQuantity ?? "?"}개` : `${change.fromPartName ?? "현재 선택"} → ${change.toPartName}`}{change.priceDeltaWon !== undefined ? ` · ${formatPriceDelta(change.priceDeltaWon)}` : ""}</span>)}</div>}<div className="saved-build-priority-action-stats"><span><strong>{actionValue.resolvedBlockers}</strong>개 차단 감소</span><span><strong>{actionValue.remainingBlockers}</strong>개 차단 남음</span><span><strong>{actionValue.remainingWarnings}</strong>개 주의 남음</span><span><strong>{actionValue.remainingUnknown}</strong>개 확인 필요</span>{actionValue.priceDeltaWon !== undefined && <span><strong>{formatPriceDelta(actionValue.priceDeltaWon)}</strong> 총액 변화</span>}{actionValue.afterTotalPriceWon !== undefined && <span><strong>{actionValue.priceComplete ? formatWon(actionValue.afterTotalPriceWon) : "가격 확인 필요"}</strong> 적용 후 금액</span>}</div><p className="saved-build-priority-action-summary">{actionValue.summary}</p></div>}
      </article>;
    })}</div>}
    <p className="saved-build-priority-note"><FiInfo /> 위험 점수는 차단 100점·주의 10점·확인 필요 1점으로 계산한 정렬용 신호입니다. 실제 구매 가능 여부를 대신하지 않으며, 각 행의 견적 보기에서 전체 근거와 대체 후보를 확인하세요.</p>
  </section>;
}

export function SavedBuildVersionPanel({ groups, openingBuildId, onOpen, onShareVersionComparison, BuildComparisonPanel, partMap, accessoryMap, fallbackPreferences }: { groups: SavedBuildVersionGroup[]; openingBuildId: string | null; onOpen: (build: SavedBuild, focus?: "purchase-list") => void; onShareVersionComparison?: (before: SavedBuild, after: SavedBuild) => void | Promise<void>; BuildComparisonPanel: ComponentType<{ builds: SavedBuild[]; onOpenBuild?: (build: SavedBuild, focus?: "purchase-list") => void; openingBuildId?: string | null }>; partMap: ReadonlyMap<string, Part>; accessoryMap: ReadonlyMap<string, AccessoryItem>; fallbackPreferences: RecommendationPreferences }) {
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.versionGroupId ?? "");
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [sharingVersion, setSharingVersion] = useState(false);
  const shareRequestRef = useRef(0);
  const shareInFlightRef = useRef(false);
  const shareContextKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (!groups.some((group) => group.versionGroupId === selectedGroupId)) setSelectedGroupId(groups[0]?.versionGroupId ?? "");
  }, [groups, selectedGroupId]);
  const selectedGroup = groups.find((group) => group.versionGroupId === selectedGroupId) ?? groups[0];
  const latestVersionIds = selectedGroup?.builds.slice(-2).map((build) => build.id) ?? [];
  const latestVersionKey = latestVersionIds.join(",");
  const shareContextKey = `${selectedGroup?.versionGroupId ?? ""}|${latestVersionKey}|${comparisonIds.join(",")}`;
  useEffect(() => {
    setComparisonIds(latestVersionIds);
  }, [selectedGroup?.versionGroupId, latestVersionKey]);
  useEffect(() => {
    if (shareContextKeyRef.current === shareContextKey) return;
    shareContextKeyRef.current = shareContextKey;
    shareRequestRef.current += 1;
    shareInFlightRef.current = false;
    setSharingVersion(false);
  }, [shareContextKey]);
  useEffect(() => () => {
    shareRequestRef.current += 1;
    shareInFlightRef.current = false;
  }, []);
  if (!selectedGroup) return null;
  const comparedVersions = selectedGroup.builds.filter((build) => comparisonIds.includes(build.id)).sort((left, right) => savedBuildVersionNumberFor(left) - savedBuildVersionNumberFor(right));
  const versionsForComparison = comparedVersions.map((build) => ({ ...build, name: `${savedBuildVersionLabelFor(build)} · ${build.name}` }));
  const toggleComparisonVersion = (buildId: string) => setComparisonIds((current) => current.includes(buildId) ? current.filter((id) => id !== buildId) : current.length >= 2 ? current : [...current, buildId]);
  const versionComparisonInput = comparedVersions.length === 2 ? { before: comparedVersions[0], after: comparedVersions[1], partMap, accessoryMap, fallbackPreferences } : undefined;
  async function shareVersionComparison() {
    if (!versionComparisonInput || !onShareVersionComparison || sharingVersion || shareInFlightRef.current) return;
    const requestVersion = ++shareRequestRef.current;
    const isCurrent = () => mountedRef.current && shareRequestRef.current === requestVersion;
    shareInFlightRef.current = true;
    setSharingVersion(true);
    try {
      await onShareVersionComparison(versionComparisonInput.before, versionComparisonInput.after);
    } finally {
      if (isCurrent()) {
        shareInFlightRef.current = false;
        setSharingVersion(false);
      }
    }
  }
  async function copyVersionComparison() {
    if (!versionComparisonInput) return;
    const requestVersion = shareRequestRef.current;
    try {
      await navigator.clipboard.writeText(savedBuildVersionComparisonTextFor(versionComparisonInput));
      if (mountedRef.current && shareRequestRef.current === requestVersion) setExportStatus("버전 비교를 클립보드에 복사했습니다.");
    } catch {
      if (mountedRef.current && shareRequestRef.current === requestVersion) setExportStatus("버전 비교 복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.");
    }
  }
  function downloadVersionComparison() {
    if (!versionComparisonInput) return;
    const exported = savedBuildVersionComparisonExportFor(versionComparisonInput);
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pc-supporter-version-comparison-${exported.before.label}-${exported.after.label}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
    setExportStatus("버전 비교 JSON을 저장했습니다.");
  }
  return <section className="saved-build-version-panel" aria-label="저장 견적 버전 비교" data-testid="saved-build-version-panel">
    <div className="saved-build-version-heading"><div><p className="eyebrow">BUILD VERSIONS</p><h2>견적 버전 비교</h2><p>수리 플랜이나 수정 후 새로 저장한 견적을 원본과 분리해, 최신 두 버전을 같은 기준으로 비교합니다.</p></div><span className="saved-build-version-icon"><FiLayers /></span></div>
    {groups.length > 1 && <div className="saved-build-version-groups" role="group" aria-label="견적 버전 그룹">{groups.map((group) => <button className={group.versionGroupId === selectedGroup.versionGroupId ? "selected" : ""} type="button" aria-pressed={group.versionGroupId === selectedGroup.versionGroupId} data-testid={`saved-build-version-group-${group.versionGroupId}`} onClick={() => setSelectedGroupId(group.versionGroupId)} key={group.versionGroupId}>{group.builds[0]?.name ?? "견적"}<span>{group.builds.length}개 버전</span></button>)}</div>}
    <div className="saved-build-version-compare-toolbar" role="group" aria-label="비교할 견적 버전 선택" aria-live="polite"><div><span>비교 버전 {comparedVersions.length} / 2</span><small>최신 두 버전이 기본 선택됩니다. 다른 버전을 비교하려면 선택을 해제한 뒤 버전을 선택하세요.</small></div>{versionComparisonInput && <div className="saved-build-version-compare-actions"><button className="text-button" type="button" data-testid="saved-build-version-copy" onClick={() => void copyVersionComparison()}><FiCopy /> 비교 복사</button><button className="text-button" type="button" data-testid="saved-build-version-download-json" onClick={downloadVersionComparison}><FiDownload /> JSON 저장</button>{onShareVersionComparison && <button className="text-button" type="button" data-testid="saved-build-version-share" onClick={() => void shareVersionComparison()} disabled={sharingVersion}>{sharingVersion ? <><FiLoader className="spin" /> 공유 중...</> : <><FiShare2 /> 링크 공유</>}</button>}</div>}</div>
    <div className="saved-build-version-compare-options" role="group" aria-label="버전 비교 선택지">{selectedGroup.builds.map((build) => { const selected = comparisonIds.includes(build.id); const locked = !selected && comparisonIds.length >= 2; return <button className={selected ? "selected" : ""} type="button" data-testid={`saved-build-version-compare-toggle-${build.id}`} aria-pressed={selected} aria-label={`${savedBuildVersionLabelFor(build)} ${build.name} ${selected ? "비교 중" : locked ? "비교 선택 잠김 · 먼저 비교 중인 버전을 해제하세요" : "비교 선택"}`} title={locked ? "비교 버전은 최대 2개입니다. 먼저 비교 중인 버전을 해제하세요." : undefined} onClick={() => toggleComparisonVersion(build.id)} disabled={locked} key={build.id}><span>{savedBuildVersionLabelFor(build)}</span><small>{build.name}</small>{selected && <em>비교 중</em>}</button>; })}</div>
    {comparedVersions.length === 2 && (() => { const [before, after] = comparedVersions; const delta = savedBuildVersionDeltaFor(before, after); const transition = delta.transition; return <section className={`saved-build-version-summary ${transition?.direction ?? "unknown"}`} data-testid="saved-build-version-summary" aria-label="선택한 두 버전 적용 요약"><div className="saved-build-version-summary-heading"><div><strong>선택한 두 버전 적용 요약</strong><small>{savedBuildVersionLabelFor(before)} → {savedBuildVersionLabelFor(after)} · {versionDeltaDirectionLabel(transition?.direction)}</small></div><FiActivity /></div><div className="saved-build-version-summary-grid"><div><span>구성</span><strong>{delta.selectionChangedCategoryCount > 0 ? `${delta.selectionChangedCategoryCount}개 범주 변경` : "변화 없음"}</strong></div><div><span>위험 변화</span><strong>{transition ? `차단 ${signedVersionDelta(transition.blockerDelta)} · 주의 ${signedVersionDelta(transition.warningDelta)} · 확인 ${signedVersionDelta(transition.unknownDelta)}` : "비교 기준 없음"}</strong></div><div><span>finding 변화</span><strong>{delta.resolvedFindingCount !== undefined ? `해결 ${delta.resolvedFindingCount} · 신규 ${delta.newFindingCount} · 변경 ${delta.changedFindingCount}` : "비교 기준 없음"}</strong></div><div><span>총액</span><strong>{transition?.priceDeltaWon !== undefined ? `${transition.priceDeltaWon > 0 ? "+" : ""}${transition.priceDeltaWon.toLocaleString("ko-KR")}원` : "가격 확인 필요"}</strong></div><div><span>분석 점수</span><strong>{transition?.analysisScoreDelta !== undefined ? `${transition.analysisScoreDelta > 0 ? "+" : ""}${transition.analysisScoreDelta}점` : "확인 필요"}</strong></div></div></section>; })()}
    <div className="saved-build-version-list">{selectedGroup.builds.map((build, index) => { const previous = selectedGroup.builds[index - 1]; const parent = build.derivedFromBuildId ? selectedGroup.builds.find((candidate) => candidate.id === build.derivedFromBuildId) : undefined; const baseline = parent ?? previous; const versionDelta = baseline ? savedBuildVersionDeltaFor(baseline, build) : undefined; const transferDiff = baseline ? buildTransferDiffFor(baseline.selection, baseline.recommendationPreferences ?? fallbackPreferences, build.selection, build.recommendationPreferences ?? fallbackPreferences, { partName: (partId) => partMap.get(partId)?.name, accessoryName: (accessoryId) => accessoryMap.get(accessoryId)?.name }) : undefined; const noteChanged = Boolean(previous) && previous?.decisionNote !== build.decisionNote; const transition = versionDelta?.transition; const priceDelta = transition?.priceDeltaWon; const analysisDelta = transition?.analysisScoreDelta; return <article className="saved-build-version-row" key={build.id}><span className="saved-build-version-number">{savedBuildVersionLabelFor(build)}</span><div><strong>{build.name}</strong><small>{build.checkSnapshot ? `${savedCheckStatusText(build.checkSnapshot.status)} · ${savedCheckRiskText(build.checkSnapshot)}` : "검사 기록 없음"} · {new Date(build.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</small><small className="saved-build-version-lineage" data-testid={`saved-build-version-lineage-${build.id}`}><FiGitBranch /> {parent ? `${savedBuildVersionLabelFor(parent)} · ${parent.name}에서 파생` : build.derivedFromBuildId ? "부모 버전 확인 필요" : index === 0 ? "라인리지 원본" : "같은 그룹의 이전 버전"}</small>{versionDelta && <small className="saved-build-version-delta" data-testid={`saved-build-version-delta-${build.id}`}><FiActivity /> {versionDelta.selectionChangedCategoryCount > 0 ? `구성 ${versionDelta.selectionChangedCategoryCount}개 범주 변경` : "구성 변화 없음"}{transition ? ` · 차단 ${transition.blockerDelta > 0 ? "+" : ""}${transition.blockerDelta} · 주의 ${transition.warningDelta > 0 ? "+" : ""}${transition.warningDelta} · 확인 ${transition.unknownDelta > 0 ? "+" : ""}${transition.unknownDelta}` : " · 검사 비교 기준 없음"}{versionDelta.resolvedFindingCount !== undefined ? ` · finding 해결 ${versionDelta.resolvedFindingCount} · 신규 ${versionDelta.newFindingCount} · 변경 ${versionDelta.changedFindingCount}` : ""}{priceDelta !== undefined ? ` · 금액 ${priceDelta > 0 ? "+" : ""}${priceDelta.toLocaleString("ko-KR")}원` : ""}{analysisDelta !== undefined ? ` · 분석 ${analysisDelta > 0 ? "+" : ""}${analysisDelta}점` : ""}</small>}{transferDiff && transferDiff.rows.length > 0 && <small className="saved-build-version-changes" data-testid={`saved-build-version-changes-${build.id}`}><FiLayers /> {transferDiff.rows.slice(0, 2).map((row) => `${row.label}: ${row.before} → ${row.after}`).join(" · ")}{transferDiff.rows.length > 2 ? ` · 외 ${transferDiff.rows.length - 2}개` : ""}</small>}{build.decisionNote ? <small className="saved-build-version-decision-note" data-testid={`saved-build-version-decision-note-${build.id}`}><FiInfo /> 선택 이유 · {build.decisionNote}</small> : noteChanged ? <small className="saved-build-version-decision-note removed" data-testid={`saved-build-version-decision-note-${build.id}`}><FiInfo /> 이전 버전의 선택 이유를 삭제함</small> : null}{noteChanged && <span className="saved-build-version-change-label">선택 이유 변경</span>}</div><button className="text-button" type="button" onClick={() => onOpen(build)} disabled={openingBuildId !== null}>{openingBuildId === build.id ? <><FiLoader className="spin" /> 불러오는 중...</> : <><FiExternalLink /> 버전 열기</>}</button></article>; })}</div>
    {comparedVersions.length === 2 && <div className="saved-build-version-context" data-testid="saved-build-version-decision-note"><div><span>{savedBuildVersionLabelFor(comparedVersions[0])} 선택 이유</span><strong>{comparedVersions[0].decisionNote ?? "메모 없음"}</strong></div><span className="saved-build-version-context-arrow" aria-hidden="true">→</span><div><span>{savedBuildVersionLabelFor(comparedVersions[1])} 선택 이유</span><strong>{comparedVersions[1].decisionNote ?? "메모 없음"}</strong></div></div>}
    {versionsForComparison.length === 2 && <BuildComparisonPanel builds={versionsForComparison} onOpenBuild={onOpen} openingBuildId={openingBuildId} />}
    {exportStatus && <p className="saved-build-version-export-status" data-testid="saved-build-version-export-status" role="status"><FiInfo /> {exportStatus}</p>}
    <p className="saved-build-version-note"><FiInfo /> 버전 비교는 저장된 스냅샷과 현재 카탈로그 재검사를 함께 사용합니다. 비교만으로 기존 버전이나 공유 링크를 변경하지 않습니다.</p>
  </section>;
}
