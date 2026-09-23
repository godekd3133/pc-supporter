// Extracted from App.tsx to keep the entry chunk lean. Loaded lazily.
import { buildCompatibilityInputFingerprint } from "../shared/build-fingerprint";
import { savedBuildComparisonRowDiffFor } from "../shared/saved-build-comparison-diff";
import type { SavedBuildMetadataHistoryEntry } from "../shared/saved-build-decision-note";
import { type SavedBuildMonitorItem, type SavedBuildMonitorResponse, savedBuildMonitorAssessmentFor } from "../shared/saved-build-monitor";
import { type SavedBuildMonitorAlert, dismissSavedBuildMonitorAlerts, markSavedBuildMonitorAlertsRead, mergeSavedBuildMonitorAlerts, savedBuildMonitorAlertFor } from "../shared/saved-build-monitor-alerts";
import { type SavedBuildMonitorSubscriptionResponse, type SavedBuildServerMonitorAlertPolicy, type SavedBuildServerMonitorInterval, SAVED_BUILD_SERVER_MONITOR_ALERT_POLICIES, SAVED_BUILD_SERVER_MONITOR_INTERVALS, savedBuildMonitorAlertAllowed } from "../shared/saved-build-monitor-subscription";
import { type SavedBuildPriorityFilter, type SavedBuildPriorityRow, savedBuildPriorityMatches, savedBuildPriorityRowsFor } from "../shared/saved-build-priority";
import { type SavedBuildPriorityAction, savedBuildNextActionFor } from "../shared/saved-build-priority-action";
import { type SavedBuildPurchaseProgressFilter, savedBuildPurchaseProgressMatchesFilter, savedBuildPurchaseProgressSummaryFor } from "../shared/saved-build-purchase-progress";
import { type SavedBuildVersionGroup, savedBuildVersionGroupsFor, savedBuildVersionLabelFor } from "../shared/saved-build-version";
import { savedBuildOriginAvailabilityLabelFor, savedBuildOriginDetailFor, savedBuildOriginLabelFor, type SavedBuildOriginAvailability } from "../shared/saved-build-origin";
import { GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY } from "../shared/generator-variants-local-share";
import { type AccessoryItem, type BuildSelection, type CompatibilityResult, type Part, type RecommendationPreferences, type SavedBuild, CATEGORY_LABELS, isKnownPrice, LISTING_POLICY_LABELS, PART_CATEGORIES, RECOMMENDATION_PROFILE_LABELS } from "../shared/types";
import type { SavedBuildLiveCheck } from "./SavedBuildComparisonDecision";
import { api } from "./api";
import type { BrowserNotificationPermission } from "./browser-notification";
import { savedBuildMonitorAutoRefreshEnabledFromStorage, savedBuildMonitorAutoRefreshMinutesFromStorage } from "./saved-build-monitor-storage";
import { Suspense, useEffect, useMemo, useRef, useState, lazy } from "react";
import { FiActivity, FiAlertTriangle, FiArrowLeft, FiCheckCircle, FiClock, FiCopy, FiCpu, FiDatabase, FiDownload, FiEdit3, FiExternalLink, FiGitBranch, FiInfo, FiKey, FiLayers, FiLoader, FiMoreHorizontal, FiPlus, FiRefreshCw, FiSave, FiServer, FiShield, FiTrash2, FiTool, FiXCircle, FiZap } from "react-icons/fi";
import { formatPriceDelta, formatWon } from "./app-format";
import { type SavedBuildOpenFocus } from "./app-types";
import { accessorySelections, selectionList } from "./build-edit";
import { CategoryIcon } from "./part-visuals";
import { currentDraftComparisonFor } from "./result-shared";
import { readSavedBuildOwnerToken } from "./saved-build-storage";
import { SavedBuildCheckBadge, SavedBuildCheckTimeline, myPcAssetReportFor, savedAccessoryLineText, savedCheckDriftText, savedCheckRiskText, savedCheckStatusText, savedCoreLineText, savedPreferenceText, savedPriceText } from "./SavedCheckTimeline";

const LazySavedBuildPriorityPanel = lazy(() => import("./SavedBuildInsights").then((module) => ({ default: module.SavedBuildPriorityPanel })));
const LazySavedBuildVersionPanel = lazy(() => import("./SavedBuildInsights").then((module) => ({ default: module.SavedBuildVersionPanel })));
const LazySavedBuildComparisonDecisionSummary = lazy(() => import("./SavedBuildComparisonDecision").then((module) => ({ default: module.SavedBuildComparisonDecisionSummary })));
const LazySavedBuildPurchaseProgressComparison = lazy(() => import("./SavedBuildPurchaseProgressComparison").then((module) => ({ default: module.SavedBuildPurchaseProgressComparison })));
const LazySavedBuildPurchasePriceHistoryComparison = lazy(() => import("./SavedBuildPurchasePriceHistoryComparison").then((module) => ({ default: module.SavedBuildPurchasePriceHistoryComparison })));
const LazySavedBuildPurchasePriceHistoryPanel = lazy(() => import("./SavedBuildPurchasePriceHistoryPanel").then((module) => ({ default: module.SavedBuildPurchasePriceHistoryPanel })));
const LazySavedBuildMonitorAlertsPanel = lazy(() => import("./SavedBuildMonitorAlertsPanel").then((module) => ({ default: module.SavedBuildMonitorAlertsPanel })));

export const SAVED_BUILD_MONITOR_AUTO_REFRESH_STORAGE_KEY = "pc-supporter-saved-build-monitor-auto-refresh";

export const SAVED_BUILD_MONITOR_INTERVAL_STORAGE_KEY = "pc-supporter-saved-build-monitor-interval";

export type SavedBuildMetadataHistoryResponse = {
  buildId: string;
  current: { name: string; decisionNote?: string };
  total: number;
  items: SavedBuildMetadataHistoryEntry[];
};

export type SavedBuildMetadataHistoryViewState =
  | { status: "loading" }
  | { status: "ready"; value: SavedBuildMetadataHistoryResponse }
  | { status: "error"; message: string };

export function BuildComparisonPanel({ builds, onOpenBuild, openingBuildId, onLiveChecksChange }: { builds: SavedBuild[]; onOpenBuild?: (build: SavedBuild, focus?: "purchase-list") => void; openingBuildId?: string | null; onLiveChecksChange?: (checks: Record<string, SavedBuildLiveCheck>) => void }) {
  const [liveChecks, setLiveChecks] = useState<Record<string, SavedBuildLiveCheck>>({});
  const [reloadToken, setReloadToken] = useState(0);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [showDifferencesOnly, setShowDifferencesOnly] = useState(false);
  const comparisonKey = JSON.stringify(builds.map((saved) => ({ id: saved.id, updatedAt: saved.updatedAt, selection: saved.selection, recommendationPreferences: saved.recommendationPreferences })));

  useEffect(() => {
    let cancelled = false;
    const initialChecks = Object.fromEntries(builds.map((saved) => [saved.id, { status: "loading" as const }])) as Record<string, SavedBuildLiveCheck>;
    setLiveChecks(initialChecks);
    onLiveChecksChange?.(initialChecks);
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
        return [saved.id, { status: "error" as const, message: error instanceof Error ? error.message : "현재 부품 정보로 다시 확인하지 못했습니다." }] as const;
      }
    })).then((entries) => {
      if (!cancelled) {
        const nextChecks = Object.fromEntries(entries) as Record<string, SavedBuildLiveCheck>;
        setLiveChecks(nextChecks);
        onLiveChecksChange?.(nextChecks);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [comparisonKey, reloadToken, onLiveChecksChange]);

  const rows: Array<{ label: string; values: string[] }> = [
    { label: "저장 당시 예상 금액", values: builds.map((saved) => savedPriceText(saved, "totalPriceWon")) },
    { label: "핵심 부품 금액", values: builds.map((saved) => savedPriceText(saved, "coreTotalPriceWon")) },
    { label: "주변 부품 금액", values: builds.map((saved) => savedPriceText(saved, "accessoryTotalPriceWon")) },
    { label: "저장 당시 호환 상태", values: builds.map((saved) => saved.checkSnapshot ? savedCheckStatusText(saved.checkSnapshot.status) : saved.id === "current-draft" ? "저장 전 구성" : "검사 기록 없음") },
    { label: "저장 당시 호환 항목", values: builds.map((saved) => saved.checkSnapshot ? savedCheckRiskText(saved.checkSnapshot) : "기록 없음") },
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


  function livePriceFor(check: SavedBuildLiveCheck | undefined) {
    if (!check || check.status === "loading") return "계산 중...";
    if (check.status === "error") return "확인 불가";
    return check.result.priceComplete ? formatWon(check.result.totalPriceWon) : "가격 확인 필요";
  }

  const liveRows: Array<{ label: string; values: string[] }> = [
    { label: "현재 호환 상태", values: builds.map((saved) => liveStatusFor(liveChecks[saved.id])) },
    { label: "현재 호환 항목", values: builds.map((saved) => liveRiskFor(liveChecks[saved.id])) },
    { label: "현재 예상 금액", values: builds.map((saved) => livePriceFor(liveChecks[saved.id])) },
    { label: "부품·가격 변화", values: builds.map((saved) => savedCheckDriftText(saved, liveChecks[saved.id])) }
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
  return <section className="history-comparison" aria-label="견적 검사 기록 비교" data-testid="saved-build-current-comparison"><div className="history-comparison-heading"><div><h2>{includesCurrentDraft ? "견적 검사 기록 비교" : "저장 견적 비교"}</h2><p>저장할 때와 지금의 호환 상태·성능·가격을 비교합니다.</p></div><div className="history-comparison-heading-actions"><span>{builds.length}개 선택</span><button className="text-button history-comparison-export-button" type="button" onClick={() => void copyComparison()}><FiCopy /> 비교 복사</button><button className="text-button history-comparison-export-button" type="button" onClick={() => void downloadComparison("csv")}><FiDownload /> CSV 저장</button><button className="text-button history-comparison-export-button" type="button" onClick={() => void downloadComparison("json")}><FiDownload /> JSON 저장</button><button className="button button-light" type="button" onClick={() => setReloadToken((current) => current + 1)} disabled={isReloading}><FiRefreshCw /> {isReloading ? "재검사 중..." : "현재 기준 다시 검사"}</button></div></div>{exportMessage && <p className="history-comparison-export-message" role="status">{exportMessage}</p>}<Suspense fallback={<div className="history-comparison-decision" role="status"><p className="history-comparison-decision-note">결정 요약을 불러오는 중...</p></div>}><LazySavedBuildComparisonDecisionSummary builds={builds} liveChecks={liveChecks} formatWon={formatWon} onOpenBuild={onOpenBuild} openingBuildId={openingBuildId} /></Suspense><div className="history-comparison-diff-toolbar"><div className="history-comparison-diff-summary"><FiLayers /><div><strong>비교 기준 · {baselineName}</strong><small>기준 견적과 다른 값 {changedCellCount}개 셀 · {changedRowCount}개 항목</small></div></div><div className="history-comparison-diff-controls" role="group" aria-label="비교표 표시 방식"><button className={!showDifferencesOnly ? "selected" : ""} type="button" aria-pressed={!showDifferencesOnly} onClick={() => setShowDifferencesOnly(false)}>전체 {allComparisonRows.length}</button><button className={showDifferencesOnly ? "selected" : ""} type="button" aria-pressed={showDifferencesOnly} onClick={() => setShowDifferencesOnly(true)} disabled={changedRowCount === 0}>차이만 {changedRowCount}</button></div></div>{showDifferencesOnly && <p className="history-comparison-diff-status" role="status"><FiInfo /> 첫 번째 견적과 값이 다른 항목만 표시하고 있습니다. 비교표의 기준 열은 강조하지 않습니다.</p>}<div className="history-comparison-table-wrap"><table><caption>{showDifferencesOnly ? "첫 번째 견적과 다른 항목만 표시한 비교 표" : "저장 당시 검사 결과와 현재 기준 재검사 결과 비교 표"}</caption><thead><tr><th scope="col">비교 항목</th>{builds.map((saved, index) => <th scope="col" key={saved.id}><span className="history-comparison-column-name">{saved.name}</span>{index === 0 && <small className="history-comparison-column-baseline">비교 기준</small>}</th>)}</tr></thead><tbody>{visibleSnapshotRows.length > 0 ? visibleSnapshotRows.map((row) => renderRow(row, "snapshot")) : <tr><td className="history-comparison-empty" colSpan={builds.length + 1}>기준 견적과 다른 저장 시점 항목이 없습니다.</td></tr>}</tbody><tbody className="history-comparison-live-body"><tr><th colSpan={builds.length + 1}>현재 부품 정보로 다시 확인</th></tr>{visibleLiveRows.length > 0 ? visibleLiveRows.map((row) => renderRow(row, "live")) : <tr><td className="history-comparison-empty" colSpan={builds.length + 1}>기준 견적과 다른 현재 재검사 항목이 없습니다.</td></tr>}</tbody></table></div><p className="history-comparison-note"><FiInfo /> 저장 당시 결과와 현재 부품 정보로 다시 확인한 결과를 보여줍니다. 현재 기준으로 다시 확인해도 저장된 견적은 바뀌지 않습니다.</p></section>;
}

export function SavedBuildMonitorCardState({ item, loading }: { item: SavedBuildMonitorItem | undefined; loading: boolean }) {
  if (!item) {
    return loading ? <div className="history-health-card-state loading" role="status"><FiLoader className="spin" /><span>현재 부품 정보 확인 중...</span></div> : null;
  }
  if (item.status !== "ready") {
    return <div className="history-health-card-state failed" role="alert" data-testid="saved-build-health-failed"><FiXCircle /><div><strong>현재 상태 불러오기 실패</strong><p>{item.message}</p></div></div>;
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

export type SavedBuildServerMonitorViewState =
  | { status: "loading" }
  | { status: "ready"; value: SavedBuildMonitorSubscriptionResponse }
  | { status: "error"; message: string };

export type SavedBuildPriorityActionViewState =
  | { status: "loading" }
  | { status: "ready"; value: SavedBuildPriorityAction }
  | { status: "error"; message: string };

export function serverMonitorIntervalText(minutes: SavedBuildServerMonitorInterval) {
  return minutes === 60 ? "1시간" : minutes === 360 ? "6시간" : "24시간";
}

export function serverMonitorAlertPolicyText(policy: SavedBuildServerMonitorAlertPolicy) {
  return policy === "critical" ? "위험 악화만" : policy === "risk" ? "위험 변화" : "모든 변화";
}

export function SavedBuildServerMonitorPanel({ builds, states, busyBuildId, onConfigure, onRun, onReload }: { builds: SavedBuild[]; states: Record<string, SavedBuildServerMonitorViewState>; busyBuildId: string | null; onConfigure: (build: SavedBuild, enabled: boolean, intervalMinutes: SavedBuildServerMonitorInterval, alertPolicy: SavedBuildServerMonitorAlertPolicy) => void; onRun: (build: SavedBuild) => void; onReload: () => void }) {
  return <section className="history-server-monitor" aria-label="소유자 서버 백그라운드 점검" data-testid="saved-build-server-monitor">
    <div className="history-server-monitor-heading"><div><h2><FiServer /> 서버 점검</h2><p>이 브라우저에서 관리할 수 있는 견적을 1·6·24시간 간격으로 점검합니다.</p></div><button className="button button-light" type="button" onClick={onReload} disabled={busyBuildId !== null}><FiRefreshCw /> 상태 새로고침</button></div>
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

  </section>;
}

export function priorityRiskDeltaText(row: SavedBuildPriorityRow) {
  if (row.riskDelta === undefined) return "이전 결과 없음";
  return row.riskDelta === 0 ? "호환 상태 변화 없음" : row.riskDelta > 0 ? "호환 주의 증가" : "호환 상태 개선";
}

export function SavedBuildRiskTrend({ row }: { row: SavedBuildPriorityRow }) {
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
  return <section className="saved-build-priority-panel" aria-label="저장 견적 요약" data-testid="saved-build-priority-board">
    <div className="saved-build-priority-heading"><div><h2>먼저 살펴볼 견적</h2><p>호환 문제가 있거나 가격이 달라진 견적을 먼저 보여줘요.</p></div><span className="saved-build-priority-icon"><FiActivity /></span></div>
    <div className="saved-build-priority-stats"><div className="attention"><span>호환 문제</span><strong>{attentionCount}</strong><small>사용 전 살펴볼 항목</small></div><div className="changed"><span>가격·구성 변경</span><strong>{changedCount}</strong><small>이전 견적과 달라짐</small></div><div className="stable"><span>변화 없음</span><strong>{stableCount}</strong><small>부품 구성 유지</small></div></div>
    <div className="saved-build-priority-filters" role="group" aria-label="견적 우선순위 필터">{filterOptions.map((option) => <button className={filter === option.id ? "selected" : ""} type="button" aria-pressed={filter === option.id} data-testid={`saved-build-priority-filter-${option.id}`} onClick={() => setFilter(option.id)} key={option.id}>{option.label}<span>{option.count}</span></button>)}</div>
    {visibleRows.length === 0 ? <div className="saved-build-priority-empty"><FiInfo /><span>선택한 조건에 맞는 저장 견적이 없습니다.</span></div> : <div className="saved-build-priority-list">{visibleRows.map((row, index) => {
      const currentStatus = row.status ? savedCheckStatusText(row.status) : "호환 결과 없음";
      const riskText = row.snapshot ? savedCheckRiskText(row.snapshot) : "호환 정보 없음";
      const riskTone = row.level === "critical" || row.level === "failed" ? "attention" : row.level === "review" ? "review" : row.level === "changed" ? "changed" : "stable";
      const actionState = actionStates[row.id];
      const actionValue = actionState?.status === "ready" ? actionState.value : undefined;
      return <article className={`saved-build-priority-row ${riskTone}`} data-testid={`saved-build-priority-row-${row.id}`} key={row.id}>
        <span className="saved-build-priority-rank">{index + 1}</span>
        <div className="saved-build-priority-main"><div className="saved-build-priority-title"><strong>{row.name}</strong><span className={`saved-build-priority-label ${riskTone}`}>{row.label}</span></div><small>{currentStatus} · {riskText}{row.lastCheckedAt ? ` · ${new Date(row.lastCheckedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}` : ""}</small>{row.primaryFinding && <p><FiAlertTriangle /> {row.primaryFinding.title}</p>}{row.priceDeltaWon !== undefined && <em>직전 기록 대비 가격 {formatPriceDelta(row.priceDeltaWon)}</em>}{row.level === "failed" && <p><FiXCircle /> 현재 호환 상태를 불러오지 못했어요.</p>}</div>
        
        <div className="saved-build-priority-action"><span>{priorityRiskDeltaText(row)}</span><button className="text-button" type="button" onClick={() => onAnalyzeAction(row.id)} disabled={actionState?.status === "loading"}>{actionState?.status === "loading" ? <><FiLoader className="spin" /> 추천 부품을 찾는 중...</> : actionState?.status === "ready" ? <><FiRefreshCw /> 다시 계산</> : <><FiZap /> 추천 보기</>}</button><button className="text-button" type="button" onClick={() => onOpen(row.id)} disabled={openingBuildId !== null}>{openingBuildId === row.id ? <><FiLoader className="spin" /> 불러오는 중...</> : <><FiExternalLink /> 견적 보기</>}</button></div>
        {actionState?.status === "error" && <div className="saved-build-priority-action-detail error" role="alert"><FiXCircle /><span>{actionState.message}</span><button className="text-button" type="button" onClick={() => onAnalyzeAction(row.id)}>다시 시도</button></div>}
        {actionValue && <div className="saved-build-priority-action-detail" data-testid={`saved-build-priority-action-${row.id}`}><div className="saved-build-priority-action-heading"><strong>{actionValue.title}</strong><span>{actionValue.kind === "repair_plan" ? "전체 수리 플랜" : actionValue.kind === "analysis" ? "부품 추천" : "추가 부품 없음"}</span></div>{actionValue.nextAction && <p className="saved-build-priority-action-next"><FiZap /> <strong>추천</strong> {actionValue.nextAction}</p>}{actionValue.changes.length > 0 && <div className="saved-build-priority-action-changes">{actionValue.changes.slice(0, 3).map((change) => <span key={`${change.category}-${change.toPartName}-${change.toQuantity ?? ""}`}><b>{CATEGORY_LABELS[change.category]}</b>{change.kind === "change_quantity" ? `${change.fromQuantity ?? "?"}개 → ${change.toQuantity ?? "?"}개` : `${change.fromPartName ?? "현재 선택"} → ${change.toPartName}`}{change.priceDeltaWon !== undefined ? ` · ${formatPriceDelta(change.priceDeltaWon)}` : ""}</span>)}</div>}<div className="saved-build-priority-action-stats"><span><strong>{actionValue.resolvedBlockers}</strong>개 차단 감소</span><span><strong>{actionValue.remainingBlockers}</strong>개 차단 남음</span><span><strong>{actionValue.remainingWarnings}</strong>개 주의 남음</span><span><strong>{actionValue.remainingUnknown}</strong>개 확인 필요</span>{actionValue.priceDeltaWon !== undefined && <span><strong>{formatPriceDelta(actionValue.priceDeltaWon)}</strong> 총액 변화</span>}{actionValue.afterTotalPriceWon !== undefined && <span><strong>{actionValue.priceComplete ? formatWon(actionValue.afterTotalPriceWon) : "가격 확인 필요"}</strong> 적용 후 금액</span>}</div><p className="saved-build-priority-action-summary">{actionValue.summary}</p></div>}
      </article>;
    })}</div>}
    <p className="saved-build-priority-note"><FiInfo /> 가격과 호환 상태가 달라진 견적을 먼저 보여드려요.</p>
  </section>;
}

export function SavedBuildVersionPanel({ groups, openingBuildId, onOpen }: { groups: SavedBuildVersionGroup[]; openingBuildId: string | null; onOpen: (build: SavedBuild, focus?: "purchase-list") => void }) {
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.versionGroupId ?? "");
  useEffect(() => {
    if (!groups.some((group) => group.versionGroupId === selectedGroupId)) setSelectedGroupId(groups[0]?.versionGroupId ?? "");
  }, [groups, selectedGroupId]);
  const selectedGroup = groups.find((group) => group.versionGroupId === selectedGroupId) ?? groups[0];
  if (!selectedGroup) return null;
  const versionsForComparison = selectedGroup.builds.slice(-2).map((build) => ({ ...build, name: `${savedBuildVersionLabelFor(build)} · ${build.name}` }));
  return <section className="saved-build-version-panel" aria-label="저장 견적 버전 비교" data-testid="saved-build-version-panel">
    <div className="saved-build-version-heading"><div><h2>견적 버전 비교</h2><p>수리 플랜이나 수정 후 새로 저장한 견적을 원본과 분리해, 최신 두 버전을 같은 기준으로 비교합니다.</p></div><span className="saved-build-version-icon"><FiLayers /></span></div>
    {groups.length > 1 && <div className="saved-build-version-groups" role="group" aria-label="견적 버전 그룹">{groups.map((group) => <button className={group.versionGroupId === selectedGroup.versionGroupId ? "selected" : ""} type="button" aria-pressed={group.versionGroupId === selectedGroup.versionGroupId} data-testid={`saved-build-version-group-${group.versionGroupId}`} onClick={() => setSelectedGroupId(group.versionGroupId)} key={group.versionGroupId}>{group.builds[0]?.name ?? "견적"}<span>{group.builds.length}개 버전</span></button>)}</div>}
    <div className="saved-build-version-list">{selectedGroup.builds.map((build) => <article className="saved-build-version-row" key={build.id}><span className="saved-build-version-number">{savedBuildVersionLabelFor(build)}</span><div><strong>{build.name}</strong><small>{build.checkSnapshot ? `${savedCheckStatusText(build.checkSnapshot.status)} · ${savedCheckRiskText(build.checkSnapshot)}` : "검사 기록 없음"} · {new Date(build.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</small></div><button className="text-button" type="button" onClick={() => onOpen(build)} disabled={openingBuildId !== null}>{openingBuildId === build.id ? <><FiLoader className="spin" /> 불러오는 중...</> : <><FiExternalLink /> 버전 열기</>}</button></article>)}</div>
    {versionsForComparison.length === 2 && <BuildComparisonPanel builds={versionsForComparison} onOpenBuild={onOpen} openingBuildId={openingBuildId} />}
    <p className="saved-build-version-note"><FiInfo /> 버전 비교는 저장된 스냅샷과 현재 카탈로그 재검사를 함께 사용합니다. 비교만으로 기존 버전이나 공유 링크를 변경하지 않습니다.</p>
  </section>;
}

export function HistoryView({ builds, currentBuild, currentPreferences, partMap, accessoryMap, monitorAlerts, onMonitorAlertsChange, browserNotificationPermission, browserNotificationEnabled, onRequestBrowserNotifications, onBrowserNotificationsEnabledChange, onBack, onOpen, onRefreshSavedBuilds, onStart, onRevoke, onEditMetadata, revokingShare, onRecordCheck, recordingCheckId, openingBuildId, onShareVersionComparison, onSaveVersion, onOpenRecoverOwnership, onIssueRecoveryCode, onToggleMyPc, myPcBusyId, recoveryCodeBusy, onToast }: { builds: SavedBuild[]; currentBuild: BuildSelection; currentPreferences: RecommendationPreferences; partMap: ReadonlyMap<string, Part>; accessoryMap: ReadonlyMap<string, AccessoryItem>; monitorAlerts: SavedBuildMonitorAlert[]; onMonitorAlertsChange: (alerts: SavedBuildMonitorAlert[]) => void; browserNotificationPermission: BrowserNotificationPermission; browserNotificationEnabled: boolean; onRequestBrowserNotifications: () => Promise<void>; onBrowserNotificationsEnabledChange: (enabled: boolean) => void; onBack: () => void; onOpen: (saved: SavedBuild, focus?: SavedBuildOpenFocus) => void; onRefreshSavedBuilds: () => Promise<boolean>; onStart: () => void; onRevoke: (id: string) => void; onEditMetadata: (saved: SavedBuild) => void; revokingShare: boolean; onRecordCheck: (id: string) => void; recordingCheckId: string | null; openingBuildId: string | null; onShareVersionComparison: (before: SavedBuild, after: SavedBuild) => void | Promise<void>; onSaveVersion?: (saved: SavedBuild) => void; onOpenRecoverOwnership: (saved?: SavedBuild) => void; onIssueRecoveryCode: (saved: SavedBuild) => void; onToggleMyPc: (saved: SavedBuild) => Promise<void>; myPcBusyId: string | null; recoveryCodeBusy: boolean; onToast: (message: string) => void }) {
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
  const [originAvailability, setOriginAvailability] = useState<Record<string, SavedBuildOriginAvailability>>({});
  const [originRefreshNonce, setOriginRefreshNonce] = useState(0);
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
  const originShareIds = useMemo(() => [...new Set(builds.flatMap((saved) => saved.origin?.kind === "shared_generator_variants" && saved.origin.sourceShareId ? [saved.origin.sourceShareId] : []))], [builds]);
  const originShareKey = originShareIds.join("|");

  useEffect(() => {
    monitorAlertsRef.current = monitorAlerts;
  }, [monitorAlerts]);

  useEffect(() => {
    const refresh = () => setOriginRefreshNonce((current) => current + 1);
    const onStorage = (event: StorageEvent) => {
      if (event.key === GENERATOR_VARIANTS_LOCAL_SHARES_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (originShareIds.length === 0) {
      setOriginAvailability({});
      return;
    }
    let cancelled = false;
    setOriginAvailability(Object.fromEntries(originShareIds.map((id) => [id, "checking" as const])));
    void Promise.all(originShareIds.map(async (id) => {
      try {
        await api(`/api/generator-variants/${encodeURIComponent(id)}`, { retry: 0 });
        return [id, "active" as const] as const;
      } catch {
        return [id, "unavailable" as const] as const;
      }
    })).then((entries) => {
      if (!cancelled) setOriginAvailability(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [originShareKey, originRefreshNonce]);

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
      if (!token) return [build.id, { status: "error" as const, message: "이 브라우저에서 견적 소유권을 확인할 수 없습니다." }] as const;
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
      onToast("이 브라우저에서 견적을 관리할 수 없습니다. 복구 코드를 사용해 주세요.");
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
      onToast("이 브라우저에서 견적을 관리할 수 없습니다. 복구 코드를 사용해 주세요.");
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

  function handleToggleMyPc(saved: SavedBuild) {
    // 승격 시 서버가 모니터 구독을 함께 켜므로, 완료 후 구독 상태를 다시 불러와 패널에 반영한다.
    void Promise.resolve(onToggleMyPc(saved)).then(() => setServerMonitorReloadNonce((current) => current + 1));
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
    <div className="workspace-heading"><div><button className="back-link" onClick={onBack}><FiArrowLeft /> 홈으로</button><h1>저장된 견적</h1><p>저장한 부품 구성과 예상 금액을 다시 볼 수 있어요.</p></div><div className="history-heading-actions"><button className="button button-light history-recover-button" type="button" data-testid="history-recover-ownership" onClick={() => onOpenRecoverOwnership()}><FiKey /> 소유권 되찾기</button><button className="button button-light history-details-toggle" type="button" aria-expanded={historyDetailsOpen} onClick={() => setHistoryDetailsOpen((current) => !current)}><FiMoreHorizontal /> {historyDetailsOpen ? "핵심 정보만 보기" : "호환·가격 상세"}</button><button className="button button-primary" onClick={onStart}><FiPlus /> 새 견적 만들기</button></div></div>
    {builds.length > 0 && <section className="history-health-panel" aria-label="저장 견적 전체 건강 점검" data-testid="saved-build-health-dashboard">
      <div className="history-health-heading">
        <div><h2>저장 견적 상태</h2><p>저장된 견적의 가격과 호환 상태를 보여줘요.</p></div>
        <button className="button button-light" type="button" onClick={() => setMonitorRefreshNonce((current) => current + 1)} disabled={monitorLoading}><FiRefreshCw className={monitorLoading ? "spin" : undefined} /> {monitorLoading ? "전체 점검 중..." : "상태 갱신"}</button>
      </div>
      {monitorError && <div className="history-health-error" role="alert"><FiXCircle /><span>{monitorError}</span><button className="text-button" type="button" onClick={() => setMonitorRefreshNonce((current) => current + 1)}>다시 시도</button></div>}
      {(readyMonitorItems.length > 0 || failedCount > 0) && <div className="history-health-summary" aria-live="polite">
        <div className="critical"><span>호환 문제</span><strong>{criticalCount}</strong></div>
        <div className="review"><span>확인 필요</span><strong>{reviewCount}</strong></div>
        <div className="changed"><span>변경됨</span><strong>{changedCount}</strong></div>
        <div className="stable"><span>안정</span><strong>{stableCount}</strong></div>
        <div className="failed"><span>불러오기 실패</span><strong>{failedCount}</strong></div>
      </div>}
      <div className="history-health-monitor-controls">
        <label><input type="checkbox" aria-label="저장 견적 자동 점검" checked={monitorAutoRefreshEnabled} onChange={(event) => { setMonitorAutoRefreshEnabled(event.target.checked); if (event.target.checked) setMonitorRefreshNonce((current) => current + 1); }} /><span>페이지를 열어 둔 동안 자동 상태 갱신</span></label>
        {monitorAutoRefreshEnabled && <label className="history-health-monitor-interval"><span>주기</span><select aria-label="저장 견적 자동 점검 주기" value={monitorAutoRefreshMinutes} onChange={(event) => setMonitorAutoRefreshMinutes(Number(event.target.value) as 5 | 15 | 30)}><option value={5}>5분</option><option value={15}>15분</option><option value={30}>30분</option></select></label>}
        <span className="history-health-monitor-status">{monitorAutoRefreshEnabled ? `자동 점검 ${monitorAutoRefreshMinutes}분마다` : "자동 상태 갱신 꺼짐"}</span>
      </div>
      <p className="history-health-note"><FiShield /> 이 점검은 저장 견적과 공유 링크를 바꾸지 않습니다. 검사 이력은 이 브라우저에서 관리할 수 있는 견적에만 추가됩니다.{monitorCheckedAt ? ` · 마지막 전체 점검 ${new Date(monitorCheckedAt).toLocaleString("ko-KR")}` : ""}</p>
    </section>}
    {builds.length > 0 && !monitorLoading && <Suspense fallback={<div className="shared-build-state" data-testid="saved-build-priority-loading"><FiLoader className="spin" /><span>저장 견적 우선순위 보드를 불러오는 중...</span></div>}><LazySavedBuildPriorityPanel rows={priorityRows} actionStates={priorityActionStates} openingBuildId={openingBuildId} onAnalyzeAction={(id) => void analyzePriorityAction(id)} onOpen={(id) => { const saved = builds.find((build) => build.id === id); if (saved) onOpen(saved); }} /></Suspense>}
    {versionGroups.length > 0 && <Suspense fallback={<div className="shared-build-state" data-testid="saved-build-version-loading"><FiLoader className="spin" /><span>견적 버전 비교를 불러오는 중...</span></div>}><LazySavedBuildVersionPanel groups={versionGroups} openingBuildId={openingBuildId} onOpen={onOpen} onShareVersionComparison={onShareVersionComparison} onSaveVersion={onSaveVersion} BuildComparisonPanel={BuildComparisonPanel} partMap={partMap} accessoryMap={accessoryMap} fallbackPreferences={currentPreferences} originAvailability={originAvailability} /></Suspense>}
    {ownedBuilds.length > 0 && <SavedBuildServerMonitorPanel builds={ownedBuilds} states={serverMonitorStates} busyBuildId={serverMonitorBusyBuildId} onConfigure={(build, enabled, intervalMinutes, alertPolicy) => void configureServerMonitor(build, enabled, intervalMinutes, alertPolicy)} onRun={(build) => void runServerMonitorNow(build)} onReload={() => setServerMonitorReloadNonce((current) => current + 1)} />}
    {ownedBuilds.length === 0 && builds.length > 0 && <section className="history-server-monitor locked" aria-label="서버 점검 사용 안내" data-testid="saved-build-server-monitor-locked"><span className="history-server-monitor-icon"><FiShield /></span><div><h2>내 견적을 새로 저장하면 서버 점검을 사용할 수 있습니다.</h2><p>이 브라우저에서 소유권을 확인하지 못한 기존·공유 견적은 조회만 할 수 있습니다. 내 견적을 새 링크로 저장하면 1·6·24시간 간격의 점검을 설정할 수 있습니다.</p></div></section>}
    {(builds.length > 0 || visibleMonitorAlerts.length > 0) && <Suspense fallback={<div className="history-monitor-alerts loading" aria-label="저장 견적 알림함 로딩" role="status"><FiLoader className="spin" /> 저장 견적 알림함을 불러오는 중...</div>}><LazySavedBuildMonitorAlertsPanel alerts={visibleMonitorAlerts} availableBuildIds={availableBuildIds} openingBuildId={openingBuildId} browserNotificationPermission={browserNotificationPermission} browserNotificationEnabled={browserNotificationEnabled} onRequestBrowserNotifications={() => void onRequestBrowserNotifications()} onBrowserNotificationsEnabledChange={onBrowserNotificationsEnabledChange} onReadAll={markAllMonitorAlertsRead} onDismissAll={() => dismissMonitorAlerts(visibleMonitorAlerts.map((alert) => alert.id))} onDismiss={(id) => dismissMonitorAlerts([id])} onOpenBuild={openMonitorAlertBuild} /></Suspense>}
    {hasCurrentSelection && <section className="history-current-compare" aria-label="현재 편집기 견적 비교"><div><h2>현재 편집기 견적</h2><p>아직 저장하지 않은 현재 구성을 저장 견적과 최대 2개까지 비교할 수 있습니다.</p><small>{currentDraft.summary?.priceComplete && isKnownPrice(currentDraft.summary.totalPriceWon) ? `현재 합계 ${formatWon(currentDraft.summary.totalPriceWon)}` : "현재 금액 확인 필요"} · 추천 기준 {savedPreferenceText(currentDraft)}</small></div><button className={compareIds.includes(currentDraft.id) ? "history-compare-toggle selected" : "history-compare-toggle"} type="button" aria-pressed={compareIds.includes(currentDraft.id)} disabled={!compareIds.includes(currentDraft.id) && compareIds.length >= 3} onClick={() => toggleCompare(currentDraft.id)}>{compareIds.includes(currentDraft.id) ? "현재 견적 비교 중" : "현재 견적 비교"}</button></section>}
    {compareIds.length > 0 && <p className="history-compare-selection-note" role="status">{compareIds.length} / 3개 견적을 비교 대상으로 선택했습니다. 현재 편집기 견적과 저장 견적을 합쳐 최대 3개까지 비교할 수 있습니다.</p>}
    {builds.length > 0 && <section className="history-purchase-progress-filter" aria-label="저장 견적 구매 진행률 필터" data-testid="saved-build-purchase-progress-filter"><div><h2>구매 진행률 보기</h2><p>결과 화면을 열지 않아도 서버에 기록된 구매 상태를 견적별로 확인합니다.</p><button className="text-button history-purchase-progress-filter-refresh" type="button" data-testid="saved-build-purchase-progress-refresh" onClick={() => void refreshPurchaseProgress()} disabled={purchaseProgressRefreshing}>{purchaseProgressRefreshing ? <><FiRefreshCw className="spin" /> 확인 중...</> : <><FiRefreshCw /> 서버 구매 상태 새로고침</>}</button></div><div className="history-purchase-progress-filter-options" role="group" aria-label="구매 진행률 필터">{purchaseProgressFilterOptions.map((option) => <button className={purchaseProgressFilter === option.id ? "selected" : ""} type="button" aria-pressed={purchaseProgressFilter === option.id} data-testid={`saved-build-purchase-progress-filter-${option.id}`} onClick={() => setPurchaseProgressFilter(option.id)} key={option.id}>{option.label}<span>{option.count}</span></button>)}</div></section>}
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
      const originStatus = saved.origin?.sourceShareId ? originAvailability[saved.origin.sourceShareId] : undefined;
      const purchaseProgressLabel = purchaseProgress.status === "completed" ? "모두 구매 완료" : purchaseProgress.status === "in-progress" ? "구매 진행 중" : "서버 기록 없음";
      return <article className="history-card" key={saved.id}>
        <div className="history-card-top"><span className="history-icon"><FiSave /></span><span className="history-date">{new Date(saved.updatedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</span><button className={selectedForCompare ? "history-compare-toggle selected" : "history-compare-toggle"} type="button" aria-pressed={selectedForCompare} disabled={!selectedForCompare && compareIds.length >= 3} onClick={() => toggleCompare(saved.id)}>{selectedForCompare ? "비교 중" : "비교"}</button></div>
        <h2>{saved.name}</h2>
        {saved.decisionNote && <div className="history-card-decision-note" data-testid="saved-build-decision-note"><FiInfo /><div><span>선택 메모</span><strong>{saved.decisionNote}</strong></div></div>}

        <p>{selectedCount}개 카테고리 선택{accessoryCount > 0 ? ` · 주변 부품 ${accessoryCount}종` : ""}{summary ? ` · ${summary.priceComplete && isKnownPrice(summary.totalPriceWon) ? formatWon(summary.totalPriceWon) : "견적 금액 확인 필요"}` : ""}{preferences ? ` · ${RECOMMENDATION_PROFILE_LABELS[preferences.profile]} · ${LISTING_POLICY_LABELS[preferences.listingPolicy ?? "retail_only"]}` : ""} · 공유 가능한 견적 · {saved.expiresAt ? `만료 ${new Date(saved.expiresAt).toLocaleString("ko-KR")}` : "공유 무기한"}</p>
        <div className="history-preview">{PART_CATEGORIES.filter((category) => selectionList(saved.selection, category).length > 0).slice(0, 5).map((category) => <span key={category}><CategoryIcon category={category} /> {CATEGORY_LABELS[category]}</span>)}{accessoryCount > 0 && <span><FiTool /> 주변 {accessoryCount}종</span>}{summary && <span><FiDatabase /> {summary.priceComplete && isKnownPrice(summary.totalPriceWon) ? formatWon(summary.totalPriceWon) : "금액 확인 필요"}</span>}{selectedCount > 5 && <span>+{selectedCount - 5}</span>}</div>
        <div className={`history-card-purchase-progress ${purchaseProgress.status}`} data-testid={`saved-build-purchase-progress-${saved.id}`}><div className="history-card-purchase-progress-heading"><span>구매 진행률</span><div><strong>{purchaseProgress.status === "unrecorded" ? "기록 없음" : `${purchaseProgress.checked} / ${purchaseProgress.total}개`}</strong><button className="text-button history-card-purchase-progress-open" type="button" data-testid={`saved-build-purchase-list-${saved.id}`} onClick={() => onOpen(saved, "purchase-list")} disabled={openingBuildId !== null}>{openingBuildId === saved.id ? <><FiLoader className="spin" /> 여는 중...</> : <><FiExternalLink /> 구매 목록 보기</>}</button></div></div>{purchaseProgress.status !== "unrecorded" && <div className="history-card-purchase-progress-bar" role="progressbar" aria-label={`${saved.name} 구매 진행률 ${purchaseProgress.percent}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={purchaseProgress.percent}><span style={{ width: `${purchaseProgress.percent}%` }} /></div>}<small>{purchaseProgressLabel}{purchaseProgress.status !== "unrecorded" ? ` · 주문 ${purchaseProgress.stageCounts.ordered} · 수령 ${purchaseProgress.stageCounts.received} · 조립 ${purchaseProgress.stageCounts.installed}` : ""}{purchaseProgress.historyCount > 0 ? ` · 이전 이력 ${purchaseProgress.historyCount}개` : ""}{purchaseProgress.updatedAt ? ` · ${new Date(purchaseProgress.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}` : ""}</small></div>
        <SavedBuildMonitorCardState item={monitorItem} loading={monitorLoading} />
        {saved.myPcAt ? <MyPcCardState saved={saved} monitorItem={monitorItem} partMap={partMap} accessoryMap={accessoryMap} owned={owned} busy={myPcBusyId === saved.id} onToggle={() => handleToggleMyPc(saved)} /> : owned && purchaseProgress.status === "completed" ? <div className="history-card-my-pc promote" data-testid={`saved-build-my-pc-promote-${saved.id}`}><FiCpu /><div><strong>모든 부품 구매 완료 — 내 PC로 등록할 수 있습니다.</strong><span>등록하면 더 좋은 CPU/GPU가 카탈로그에 들어올 때 알려드리고, 구매 단계 정보 알림은 줄어듭니다.</span></div><button className="text-button history-card-my-pc-button" type="button" onClick={() => handleToggleMyPc(saved)} disabled={myPcBusyId !== null || openingBuildId !== null}>{myPcBusyId === saved.id ? <><FiLoader className="spin" /> 등록 중...</> : "내 PC로 등록"}</button></div> : null}
        {saved.checkSnapshot && <SavedBuildCheckBadge snapshot={saved.checkSnapshot} />}
        {saved.checkHistory && saved.checkHistory.length > 0 && <SavedBuildCheckTimeline history={saved.checkHistory} partMap={partMap} showDiff={false} />}
        <button className="button button-secondary full-width" onClick={() => onOpen(saved)} disabled={openingBuildId !== null}>{openingBuildId === saved.id ? <><FiLoader className="spin" /> 결과 불러오는 중...</> : <><FiExternalLink /> 결과 다시 보기</>}</button>
        {!owned && <button className="text-button history-recover-card-button" type="button" data-testid={`saved-build-recover-${saved.id}`} onClick={() => onOpenRecoverOwnership(saved)} disabled={openingBuildId !== null}><FiKey /> 복구 코드로 소유권 되찾기</button>}
        {owned && <div className="history-card-actions"><button className="text-button history-edit-metadata-button" type="button" data-testid={`saved-build-edit-metadata-${saved.id}`} onClick={() => onEditMetadata(saved)} disabled={revokingShare || recordingCheckId !== null || openingBuildId !== null}><FiEdit3 /> 설명 수정</button><button className="text-button history-recovery-code-button" type="button" data-testid={`saved-build-recovery-code-${saved.id}`} onClick={() => onIssueRecoveryCode(saved)} disabled={recoveryCodeBusy || revokingShare || recordingCheckId !== null || openingBuildId !== null}>{recoveryCodeBusy ? <><FiLoader className="spin" /> 코드 발급 중...</> : <><FiKey /> 복구 코드</>}</button><button className="text-button history-metadata-history-button" type="button" data-testid={`saved-build-metadata-history-${saved.id}`} onClick={() => void toggleMetadataHistory(saved)} disabled={revokingShare || recordingCheckId !== null || openingBuildId !== null || metadataHistory?.status === "loading"}>{metadataHistory?.status === "loading" ? <><FiLoader className="spin" /> 이력 불러오는 중...</> : metadataHistory?.status === "ready" ? <><FiClock /> 변경 이력 닫기</> : <><FiClock /> 변경 이력 보기</>}</button><button className="text-button history-record-check-button" type="button" onClick={() => onRecordCheck(saved.id)} disabled={recordingCheckId !== null || revokingShare || openingBuildId !== null}>{recordingCheckId === saved.id ? <><FiLoader className="spin" /> 검사 기록 추가 중...</> : <><FiRefreshCw /> {monitorAssessment?.recordRecommended ? "현재 변화 기록 남기기" : "현재 기준 다시 기록"}</>}</button><button className="text-button history-revoke-button" type="button" onClick={() => onRevoke(saved.id)} disabled={revokingShare || recordingCheckId !== null || openingBuildId !== null}>{revokingShare ? <><FiLoader className="spin" /> 취소 중...</> : <><FiTrash2 /> 공유 링크 취소</>}</button></div>}
        {owned && metadataHistory && <SavedBuildMetadataHistoryPanel buildId={saved.id} state={metadataHistory} onRetry={() => void toggleMetadataHistory(saved)} />}
      </article>;
    })}</div>}
    {compareBuilds.length >= 2 && <BuildComparisonPanel builds={compareBuilds} onOpenBuild={onOpen} openingBuildId={openingBuildId} />}
    {comparedSavedBuilds.length >= 2 && <Suspense fallback={<div className="shared-build-state" data-testid="saved-build-purchase-progress-comparison-loading"><FiLoader className="spin" /><span>구매 진행률 비교를 불러오는 중...</span></div>}><LazySavedBuildPurchaseProgressComparison builds={comparedSavedBuilds} /></Suspense>}
    {comparedSavedBuilds.length >= 2 && <Suspense fallback={<div className="shared-build-state" data-testid="saved-build-purchase-price-history-comparison-loading"><FiLoader className="spin" /><span>가격 이력 비교를 불러오는 중...</span></div>}><LazySavedBuildPurchasePriceHistoryComparison builds={comparedSavedBuilds} /></Suspense>}
  </div>;
}

export function SavedBuildMetadataHistoryPanel({ buildId, state, onRetry }: { buildId: string; state: SavedBuildMetadataHistoryViewState; onRetry: () => void }) {
  if (state.status === "loading") return <div className="saved-build-metadata-history loading" data-testid={`saved-build-metadata-history-panel-${buildId}`} role="status"><FiLoader className="spin" /><span>이전 설명 변경 이력을 불러오는 중...</span></div>;
  if (state.status === "error") return <div className="saved-build-metadata-history error" data-testid={`saved-build-metadata-history-panel-${buildId}`} role="alert"><FiXCircle /><span>{state.message}</span><button className="text-button" type="button" onClick={onRetry}>다시 시도</button></div>;
  return <section className="saved-build-metadata-history" data-testid={`saved-build-metadata-history-panel-${buildId}`} aria-label="저장 견적 설명 변경 이력"><div className="saved-build-metadata-history-heading"><div><strong>설명 변경 이력</strong></div><em>{state.value.total}회</em></div>{state.value.items.length === 0 ? <p className="saved-build-metadata-history-empty"><FiInfo /> 아직 이름이나 선택 이유를 수정한 기록이 없습니다.</p> : <div className="saved-build-metadata-history-list">{state.value.items.map((entry) => <article key={`${entry.changedAt}-${entry.nextName}`}><div className="saved-build-metadata-history-meta"><span>{new Date(entry.changedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</span><strong>{entry.changedFields.map((field) => field === "name" ? "이름" : "선택 이유").join(" · ")} 변경</strong></div><div className="saved-build-metadata-history-diff"><div><small>변경 전</small><strong>{entry.previousName}</strong><span>{entry.previousDecisionNote ?? "메모 없음"}</span></div><b aria-hidden="true">→</b><div><small>변경 후</small><strong>{entry.nextName}</strong><span>{entry.nextDecisionNote ?? "메모 없음"}</span></div></div></article>)}</div>}</section>;
}

export function MyPcCardState({ saved, monitorItem, partMap, accessoryMap, owned, busy, onToggle }: { saved: SavedBuild; monitorItem: SavedBuildMonitorItem | undefined; partMap: ReadonlyMap<string, Part>; accessoryMap: ReadonlyMap<string, AccessoryItem>; owned: boolean; busy: boolean; onToggle: () => void }) {
  const report = myPcAssetReportFor(saved, monitorItem, partMap, accessoryMap);
  const delta = report.currentPrice !== undefined && report.paidTotal !== undefined ? report.currentPrice - report.paidTotal : undefined;
  const deltaPercent = delta !== undefined && report.paidTotal ? Math.round((delta / report.paidTotal) * 100) : undefined;
  return <div className="history-card-my-pc owned" data-testid={`saved-build-my-pc-${saved.id}`}>
    <div className="history-card-my-pc-heading"><span className="history-card-my-pc-badge"><FiCpu /> 내 PC</span><small>등록 {new Date(saved.myPcAt!).toLocaleString("ko-KR", { dateStyle: "short" })}</small></div>
    <div className="history-card-my-pc-asset">
      {report.currentPrice !== undefined ? <span>현재가 {formatWon(report.currentPrice)}</span> : <span>현재가 확인 중</span>}
      {report.paidTotal !== undefined && <span>구매가 {formatWon(report.paidTotal)}</span>}
      {delta !== undefined && deltaPercent !== undefined && <em className={delta <= 0 ? "down" : "up"}>{delta <= 0 ? "▼" : "▲"} {formatWon(Math.abs(delta))} ({Math.abs(deltaPercent)}%)</em>}
    </div>
    {report.checkedAt && <small>현재가 기준 {new Date(report.checkedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</small>}
    {owned && <button className="text-button history-card-my-pc-unregister" type="button" onClick={onToggle} disabled={busy}>{busy ? "해제 중..." : "내 PC 등록 해제"}</button>}
  </div>;
}
