import { useEffect, useState, type ComponentType } from "react";
import { FiActivity, FiAlertTriangle, FiExternalLink, FiInfo, FiLayers, FiLoader, FiRefreshCw, FiZap, FiXCircle } from "react-icons/fi";
import { savedBuildPriorityMatches } from "../shared/saved-build-priority";
import type { SavedBuildPriorityFilter, SavedBuildPriorityRow } from "../shared/saved-build-priority";
import type { SavedBuildPriorityAction } from "../shared/saved-build-priority-action";
import { savedBuildVersionLabelFor } from "../shared/saved-build-version";
import type { SavedBuildVersionGroup } from "../shared/saved-build-version";
import type { SavedBuild, SavedBuildCheckSnapshot, Part, PartCategory } from "../shared/types";
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

export function SavedBuildVersionPanel({ groups, openingBuildId, onOpen, BuildComparisonPanel }: { groups: SavedBuildVersionGroup[]; openingBuildId: string | null; onOpen: (build: SavedBuild) => void; BuildComparisonPanel: ComponentType<{ builds: SavedBuild[] }> }) {
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
    {versionsForComparison.length === 2 && <BuildComparisonPanel builds={versionsForComparison} />}
    <p className="saved-build-version-note"><FiInfo /> 버전 비교는 저장된 스냅샷과 현재 카탈로그 재검사를 함께 사용합니다. 비교만으로 기존 버전이나 공유 링크를 변경하지 않습니다.</p>
  </section>;
}
