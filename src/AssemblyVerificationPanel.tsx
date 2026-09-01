import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { FiAlertTriangle, FiCheckCircle, FiDownload, FiInfo, FiRefreshCw, FiSave, FiShield, FiUpload, FiXCircle } from "react-icons/fi";
import type { AssemblyVerificationCheckId, AssemblyVerificationCheckStatus, AssemblyVerificationComparisonFilter, AssemblyVerificationHistory, AssemblyVerificationLoadScenario, AssemblyVerificationLoadTool, AssemblyVerificationLog, AssemblyVerificationMeasurementContinuityStatus, AssemblyVerificationMeasurementQuality, AssemblyVerificationSurfaceSummary, AssemblyVerificationTelemetryMetric, AssemblyVerificationTelemetryMetricAnalysis, AssemblyVerificationTelemetryPoint } from "../shared/assembly-verification";
import { ASSEMBLY_VERIFICATION_CHECKS, ASSEMBLY_VERIFICATION_HISTORY_LIMIT, assemblyVerificationComparisonFor, assemblyVerificationHistoryJsonFor, assemblyVerificationProgressFor, assemblyVerificationRecheckSignalsFor, assemblyVerificationStateFor, assemblyVerificationStateLabel, assemblyVerificationStatusLabel, assemblyVerificationTelemetryAnalysisFor, assemblyVerificationTelemetrySummaryFor, emptyAssemblyVerificationHistory, parseAssemblyVerificationHistoryJson, withAssemblyVerificationCheck, withAssemblyVerificationMeasurements } from "../shared/assembly-verification";
import type { AssemblyVerificationCsvImport, AssemblyVerificationCsvMetric, AssemblyVerificationCsvTelemetryMetric } from "../shared/assembly-verification-csv";
import { ASSEMBLY_VERIFICATION_CSV_METRIC_LABELS, ASSEMBLY_VERIFICATION_CSV_TELEMETRY_LABELS, assemblyVerificationCsvTemplateFor, parseAssemblyVerificationCsv } from "../shared/assembly-verification-csv";
import type { AssemblyVerificationLoadSegment, AssemblyVerificationLoadSegmentComparison } from "../shared/assembly-verification-load";
import { assemblyVerificationLoadProfileComparisonFor, assemblyVerificationLoadProfileFor } from "../shared/assembly-verification-load";
import type { AssemblyVerificationComparisonRankRow, AssemblyVerificationComparisonSummary } from "../shared/assembly-verification-comparison-summary";
import { assemblyVerificationComparisonSummaryFor } from "../shared/assembly-verification-comparison-summary";
import type { AssemblyVerificationDecisionDimensionStatus } from "../shared/assembly-verification-decision";
import { assemblyVerificationDecisionSummaryFor } from "../shared/assembly-verification-decision";
import type { AssemblyVerificationOverlayMetric, AssemblyVerificationOverlayRun } from "../shared/assembly-verification-overlay";
import { assemblyVerificationTelemetryOverlayFor } from "../shared/assembly-verification-overlay";
import { assemblyVerificationReportCsvFor, assemblyVerificationReportFor, assemblyVerificationReportJsonFor, assemblyVerificationReportTextFor } from "../shared/assembly-verification-report";
import type { SavedBuild } from "../shared/types";
import { api } from "./api";

function readStoredHistory(storageKey: string) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return emptyAssemblyVerificationHistory(storageKey);
    const parsed = parseAssemblyVerificationHistoryJson(raw, storageKey);
    return parsed.history ?? emptyAssemblyVerificationHistory(storageKey);
  } catch {
    return emptyAssemblyVerificationHistory(storageKey);
  }
}

function writeStoredHistory(storageKey: string, history: AssemblyVerificationHistory) {
  try {
    window.localStorage.setItem(storageKey, assemblyVerificationHistoryJsonFor(history));
  } catch {
    // Local storage가 가득 차도 화면의 현재 검증 기록은 계속 보여준다.
  }
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function downloadText(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function statusIcon(status: AssemblyVerificationCheckStatus) {
  return status === "fail" ? FiXCircle : status === "pass" ? FiCheckCircle : FiShield;
}

function metricText(value: number | undefined, suffix: string) {
  return value === undefined ? "-" : `${value}${suffix}`;
}

function noiseText(value: AssemblyVerificationLog["noiseLevel"]) {
  return value === "quiet" ? "조용함" : value === "normal" ? "보통" : value === "loud" ? "큼" : "-";
}

function deltaText(value: number | undefined, comparable: boolean | undefined, blockReason?: string) {
  if (value === undefined) return comparable === false ? blockReason === "measurement-quality-review" || blockReason === "measurement-continuity-gapped" ? "측정 품질 확인" : blockReason === "condition-missing" ? "조건 미기록" : "조건 변경" : "-";
  return `${value > 0 ? "+" : ""}${value}°C`;
}

function telemetryLineSegmentsFor(series: AssemblyVerificationTelemetryPoint[], metric: "cpuTempC" | "gpuTempC", gapToleranceSeconds?: number) {
  if (series.length < 2) return [];
  const hasElapsedRange = series.every((point) => point.elapsedSeconds !== undefined) && (series.at(-1)?.elapsedSeconds ?? 0) > (series[0].elapsedSeconds ?? 0);
  const firstElapsed = series[0].elapsedSeconds ?? 0;
  const lastElapsed = series.at(-1)?.elapsedSeconds ?? firstElapsed;
  const segments: string[][] = [];
  let segment: string[] = [];
  series.forEach((point, index) => {
    const value = point[metric];
    const previous = series[index - 1];
    const elapsedDelta = previous?.elapsedSeconds !== undefined && point.elapsedSeconds !== undefined ? point.elapsedSeconds - previous.elapsedSeconds : undefined;
    const continuityBreak = elapsedDelta !== undefined && (elapsedDelta <= 0 || gapToleranceSeconds !== undefined && elapsedDelta > gapToleranceSeconds);
    if (value === undefined || continuityBreak) {
      if (segment.length > 1) segments.push(segment);
      segment = [];
      return;
    }
    const x = hasElapsedRange ? ((point.elapsedSeconds! - firstElapsed) / (lastElapsed - firstElapsed)) * 100 : (index / (series.length - 1)) * 100;
    const y = 96 - (Math.min(150, Math.max(0, value)) / 150) * 88;
    segment.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  });
  if (segment.length > 1) segments.push(segment);
  return segments.map((points) => points.join(" "));
}

function telemetryMetricLabel(metric: AssemblyVerificationTelemetryMetric) {
  return metric === "cpuTempC" ? "CPU 온도" : metric === "gpuTempC" ? "GPU 온도" : metric === "cpuFanRpm" ? "CPU 팬 RPM" : metric === "gpuFanRpm" ? "GPU 팬 RPM" : metric === "cpuUsagePercent" ? "CPU 사용률" : metric === "gpuUsagePercent" ? "GPU 사용률" : metric === "cpuClockMHz" ? "CPU 클럭" : metric === "gpuClockMHz" ? "GPU 클럭" : metric === "cpuPowerW" ? "CPU 소비전력" : metric === "gpuPowerW" ? "GPU 소비전력" : "주변 온도";
}

function telemetryMetricSuffix(metric: AssemblyVerificationTelemetryMetric) {
  return metric.endsWith("TempC") ? "°C" : metric.endsWith("Percent") ? "%" : metric.endsWith("MHz") ? "MHz" : metric.endsWith("PowerW") ? "W" : "RPM";
}

function telemetryTrendText(trend: AssemblyVerificationTelemetryMetricAnalysis["trend"]) {
  return trend === "rising" ? "상승" : trend === "falling" ? "하락" : trend === "unchanged" ? "변화 없음" : "샘플 부족";
}

function telemetryAnalysisMetricText(analysis: AssemblyVerificationTelemetryMetricAnalysis) {
  const suffix = telemetryMetricSuffix(analysis.metric);
  const delta = `${analysis.delta > 0 ? "+" : ""}${analysis.delta}${suffix}`;
  const rate = analysis.ratePerMinute === undefined ? "" : ` · ${analysis.ratePerMinute > 0 ? "+" : ""}${analysis.ratePerMinute}${suffix}/분`;
  const peak = analysis.peakAtSeconds === undefined ? "" : ` · 최고점 ${analysis.peakAtSeconds}초`;
  const finalWindow = analysis.finalWindowSpread === undefined ? "" : ` · 마지막 3점 범위 ${analysis.finalWindowSpread}${suffix}`;
  return `${telemetryTrendText(analysis.trend)} · ${analysis.first}${suffix} → ${analysis.last}${suffix} · 변화 ${delta}${rate}${peak}${finalWindow}`;
}

function loadSegmentDurationText(segment: AssemblyVerificationLoadSegment) {
  if (segment.durationSeconds === undefined) return "시간축 미기록";
  return segment.durationSeconds >= 60 ? `${(segment.durationSeconds / 60).toFixed(1)}분` : `${segment.durationSeconds}초`;
}

function loadSegmentObservationText(segment: AssemblyVerificationLoadSegment) {
  const usage = [segment.cpuUsageMean === undefined ? undefined : `CPU ${segment.cpuUsageMean}%`, segment.gpuUsageMean === undefined ? undefined : `GPU ${segment.gpuUsageMean}%`].filter((value): value is string => Boolean(value)).join(" · ");
  const temperature = [segment.cpuTempDelta === undefined ? undefined : `CPU 온도 Δ ${segment.cpuTempDelta > 0 ? "+" : ""}${segment.cpuTempDelta}°C`, segment.gpuTempDelta === undefined ? undefined : `GPU 온도 Δ ${segment.gpuTempDelta > 0 ? "+" : ""}${segment.gpuTempDelta}°C`].filter((value): value is string => Boolean(value)).join(" · ");
  const power = [segment.cpuPowerMean === undefined ? undefined : `CPU ${segment.cpuPowerMean}W`, segment.gpuPowerMean === undefined ? undefined : `GPU ${segment.gpuPowerMean}W`].filter((value): value is string => Boolean(value)).join(" · ");
  const thermal = [segment.cpuTempChangePer100W === undefined ? undefined : `CPU 온도 변화/100W ${segment.cpuTempChangePer100W}°C`, segment.gpuTempChangePer100W === undefined ? undefined : `GPU 온도 변화/100W ${segment.gpuTempChangePer100W}°C`].filter((value): value is string => Boolean(value)).join(" · ");
  const stability = [segment.cpuTempStability ? `CPU 안정화 ${segment.cpuTempStability.stabilized ? "확인" : "미확인"}${segment.cpuTempStability.stabilizedAfterSeconds === undefined ? "" : ` · ${segment.cpuTempStability.stabilizedAfterSeconds}초 이후`}` : undefined, segment.gpuTempStability ? `GPU 안정화 ${segment.gpuTempStability.stabilized ? "확인" : "미확인"}${segment.gpuTempStability.stabilizedAfterSeconds === undefined ? "" : ` · ${segment.gpuTempStability.stabilizedAfterSeconds}초 이후`}` : undefined].filter((value): value is string => Boolean(value)).join(" · ");
  return [usage, temperature, power, thermal, stability].filter((value): value is string => Boolean(value)).join(" · ") || "센서값 미기록";
}

function signedDeltaText(value: number | undefined, suffix: string) {
  if (value === undefined) return undefined;
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

function stabilityChangeText(change: AssemblyVerificationLoadSegmentComparison["cpuStabilityChange"], deltaSeconds: number | undefined) {
  if (!change) return undefined;
  const label = change === "improved" ? "개선" : change === "regressed" ? "악화" : "변화 없음";
  return deltaSeconds === undefined ? `안정화 ${label}` : `안정화 ${label} · ${signedDeltaText(deltaSeconds, "초")}`;
}

function loadSegmentComparisonText(comparison: AssemblyVerificationLoadSegmentComparison) {
  if (!comparison.previous) return "같은 종류의 이전 구간 없음";
  const entries = [
    signedDeltaText(comparison.cpuTempLastDelta, "°C 종료 온도"),
    signedDeltaText(comparison.gpuTempLastDelta, "°C 종료 온도"),
    signedDeltaText(comparison.cpuUsageMeanDelta, "% CPU 사용률"),
    signedDeltaText(comparison.gpuUsageMeanDelta, "% GPU 사용률"),
    signedDeltaText(comparison.cpuPowerMeanDelta, "W CPU 전력"),
    signedDeltaText(comparison.gpuPowerMeanDelta, "W GPU 전력"),
    stabilityChangeText(comparison.cpuStabilityChange, comparison.cpuStabilizationDeltaSeconds),
    stabilityChangeText(comparison.gpuStabilityChange, comparison.gpuStabilizationDeltaSeconds)
  ].filter((value): value is string => Boolean(value));
  return entries.length > 0 ? entries.join(" · ") : "비교 가능한 공통 측정값 없음";
}

function overlayLineSegmentsFor(run: AssemblyVerificationOverlayRun, metric: AssemblyVerificationOverlayMetric) {
  const segments: string[][] = [];
  let segment: string[] = [];
  run.points.forEach((point, pointIndex) => {
    const value = point[metric];
    const previous = run.points[pointIndex - 1];
    const gapBefore = run.gapProgressPercents?.some((gap) => point.progressPercent >= gap && (previous?.progressPercent ?? -1) < gap) ?? false;
    if (value === undefined) {
      if (segment.length > 1) segments.push(segment);
      segment = [];
      return;
    }
    const y = 96 - (Math.min(150, Math.max(0, value)) / 150) * 88;
    const coordinate = `${point.progressPercent.toFixed(2)},${y.toFixed(2)}`;
    if (gapBefore) {
      if (segment.length > 1) segments.push(segment);
      segment = [coordinate];
      return;
    }
    segment.push(coordinate);
  });
  if (segment.length > 1) segments.push(segment);
  return segments.map((points) => points.join(" "));
}

function overlayColorFor(index: number) {
  return ["#4d9b88", "#7763b5", "#c18b52", "#ad657b", "#4f82a5", "#7c9b55"][index % 6];
}

function comparisonRankValueText(row: AssemblyVerificationComparisonRankRow, suffix: string) {
  return row.value === undefined ? "기록 없음" : `${row.value}${suffix}`;
}

function comparisonRankDeltaText(row: AssemblyVerificationComparisonRankRow, suffix: string) {
  return row.baselineDelta === undefined ? "기준값 없음" : `기준 대비 ${row.baselineDelta > 0 ? "+" : ""}${row.baselineDelta}${suffix}`;
}

function comparisonRankCard(title: string, rows: AssemblyVerificationComparisonRankRow[], suffix: string) {
  return { title, rows, suffix };
}

function decisionStatusText(status: AssemblyVerificationDecisionDimensionStatus | "improved" | "unchanged" | "recheck" | "inconclusive") {
  return status === "improved" ? "개선 관찰" : status === "unchanged" ? "변화 없음" : status === "recheck" ? "재확인 필요" : status === "inconclusive" ? "비교 불충분" : status === "observational-lower" ? "관찰상 낮음" : status === "observational-higher" ? "관찰상 높음" : "확인 필요";
}

function measurementQualityStatusText(status: AssemblyVerificationMeasurementQuality["status"]) {
  return status === "complete" ? "입력 품질 양호" : status === "partial" ? "부분 측정" : "확인 필요";
}

function measurementContinuityStatusText(status: AssemblyVerificationMeasurementContinuityStatus | undefined) {
  return status === "continuous" ? "연속" : status === "gapped" ? "공백 있음" : "확인 불가";
}

export function AssemblyVerificationPanel({ storageKey, savedBuildId, savedBuildOwnerToken, onServerSync, onSummaryChange }: { storageKey: string; savedBuildId?: string; savedBuildOwnerToken?: string; onServerSync?: (saved: SavedBuild) => void; onSummaryChange?: (summary: AssemblyVerificationSurfaceSummary) => void }) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const csvImportInputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<AssemblyVerificationHistory>(() => readStoredHistory(storageKey));
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [hydratedStorageKey, setHydratedStorageKey] = useState(storageKey);
  const [cpuTemp, setCpuTemp] = useState("");
  const [gpuTemp, setGpuTemp] = useState("");
  const [noiseLevel, setNoiseLevel] = useState<AssemblyVerificationLog["noiseLevel"]>("not_recorded");
  const [loadTool, setLoadTool] = useState<AssemblyVerificationLoadTool>("not_recorded");
  const [loadScenario, setLoadScenario] = useState<AssemblyVerificationLoadScenario>("not_recorded");
  const [testDurationMinutes, setTestDurationMinutes] = useState("");
  const [ambientTemp, setAmbientTemp] = useState("");
  const [cpuFanRpm, setCpuFanRpm] = useState("");
  const [gpuFanRpm, setGpuFanRpm] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [trendFilter, setTrendFilter] = useState<AssemblyVerificationComparisonFilter>("all");
  const [csvImportPreview, setCsvImportPreview] = useState<{ fileName: string; parsed: AssemblyVerificationCsvImport } | null>(null);
  const [resetPending, setResetPending] = useState(false);
  const [overlayReferenceRunId, setOverlayReferenceRunId] = useState<string | null>(null);
  const [overlayIncludedRunIds, setOverlayIncludedRunIds] = useState<string[] | null>(null);

  const activeRunId = selectedRunId ?? history.activeRunId;
  const activeLog = useMemo(() => history.runs.find((run) => run.runId === activeRunId) ?? history.runs.at(-1)!, [activeRunId, history]);
  const log = activeLog;
  const progress = useMemo(() => assemblyVerificationProgressFor(log), [log]);
  const state = useMemo(() => assemblyVerificationStateFor(log), [log]);
  const comparison = useMemo(() => assemblyVerificationComparisonFor(history, trendFilter, activeRunId), [activeRunId, history, trendFilter]);
  const sameLoadComparison = useMemo(() => assemblyVerificationComparisonFor(history, "same-load", activeRunId), [activeRunId, history]);
  const recheckSignals = useMemo(() => assemblyVerificationRecheckSignalsFor(comparison), [comparison]);
  const telemetryAnalysis = useMemo(() => assemblyVerificationTelemetryAnalysisFor(log.measurementSeries), [log.measurementSeries]);
  const loadProfile = useMemo(() => assemblyVerificationLoadProfileFor(log.measurementSeries, log.measurementQuality?.continuity?.gapToleranceSeconds), [log.measurementQuality?.continuity?.gapToleranceSeconds, log.measurementSeries]);
  const loadProfileComparison = useMemo(() => assemblyVerificationLoadProfileComparisonFor(history, trendFilter, activeRunId), [activeRunId, history, trendFilter]);
  const overlayCandidateRuns = useMemo(() => assemblyVerificationComparisonFor(history, "same-load", activeRunId).points.flatMap((point) => {
    const run = history.runs.find((candidate) => candidate.runId === point.runId);
    return run?.measurementSeries && run.measurementSeries.length > 1 ? [point] : [];
  }), [activeRunId, history]);
  const overlayCandidateRunIds = useMemo(() => overlayCandidateRuns.map((point) => point.runId), [overlayCandidateRuns]);
  const effectiveOverlayReferenceRunId = overlayReferenceRunId && overlayCandidateRunIds.includes(overlayReferenceRunId)
    ? overlayReferenceRunId
    : overlayCandidateRunIds.includes(activeRunId) ? activeRunId : overlayCandidateRunIds[0] ?? activeRunId;
  const effectiveOverlayIncludedRunIds = (overlayIncludedRunIds ?? overlayCandidateRunIds).filter((runId) => overlayCandidateRunIds.includes(runId));
  const telemetryOverlay = useMemo(() => assemblyVerificationTelemetryOverlayFor(history, effectiveOverlayReferenceRunId, { includedRunIds: effectiveOverlayIncludedRunIds }), [effectiveOverlayIncludedRunIds.join("|"), effectiveOverlayReferenceRunId, history]);
  const telemetryReviewOverlay = useMemo(() => assemblyVerificationTelemetryOverlayFor(history, effectiveOverlayReferenceRunId, { includedRunIds: effectiveOverlayIncludedRunIds, includeReviewQuality: true }), [effectiveOverlayIncludedRunIds.join("|"), effectiveOverlayReferenceRunId, history]);
  const qualityReviewOverlayRuns = useMemo(() => telemetryReviewOverlay.runs.filter((run) => run.measurementQualityStatus === "review" || run.measurementContinuityStatus === "gapped"), [telemetryReviewOverlay]);
  const comparisonSummary = useMemo(() => assemblyVerificationComparisonSummaryFor(history, effectiveOverlayReferenceRunId, effectiveOverlayIncludedRunIds), [effectiveOverlayIncludedRunIds.join("|"), effectiveOverlayReferenceRunId, history]);
  const decisionSummary = useMemo(() => assemblyVerificationDecisionSummaryFor(comparisonSummary), [comparisonSummary]);

  useEffect(() => {
    onSummaryChange?.({ ...progress, state, recheckSignalCount: recheckSignals.length, updatedAt: log.updatedAt, ...(log.runId ? { runId: log.runId } : {}) });
  }, [log.runId, log.updatedAt, onSummaryChange, progress.checked, progress.failed, progress.percent, progress.passed, progress.remaining, progress.total, recheckSignals.length, state]);

  useEffect(() => {
    const next = readStoredHistory(storageKey);
    setHistory(next);
    setSelectedRunId(next.activeRunId);
    const active = next.runs.find((run) => run.runId === next.activeRunId) ?? next.runs.at(-1)!;
    setCpuTemp(active.cpuMaxTempC?.toString() ?? "");
    setGpuTemp(active.gpuMaxTempC?.toString() ?? "");
    setNoiseLevel(active.noiseLevel);
    setLoadTool(active.loadTool);
    setLoadScenario(active.loadScenario);
    setTestDurationMinutes(active.testDurationMinutes?.toString() ?? "");
    setAmbientTemp(active.ambientTempC?.toString() ?? "");
    setCpuFanRpm(active.cpuFanRpm?.toString() ?? "");
    setGpuFanRpm(active.gpuFanRpm?.toString() ?? "");
    setNote(active.note ?? "");
    setMessage(null);
    setImportError(null);
    setTrendFilter("all");
    setCsvImportPreview(null);
    setResetPending(false);
    setOverlayReferenceRunId(null);
    setOverlayIncludedRunIds(null);
    setHydratedStorageKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (hydratedStorageKey === storageKey) writeStoredHistory(storageKey, history);
  }, [hydratedStorageKey, history, storageKey]);

  function updateActiveLog(update: (current: AssemblyVerificationLog) => AssemblyVerificationLog) {
    setHistory((currentHistory) => ({
      ...currentHistory,
      activeRunId,
      updatedAt: new Date().toISOString(),
      runs: currentHistory.runs.map((run) => run.runId === activeRunId ? update(run) : run)
    }));
  }

  function selectRun(runId: string) {
    const next = history.runs.find((run) => run.runId === runId);
    if (!next) return;
    setSelectedRunId(runId);
    setHistory((current) => ({ ...current, activeRunId: runId }));
    setCpuTemp(next.cpuMaxTempC?.toString() ?? "");
    setGpuTemp(next.gpuMaxTempC?.toString() ?? "");
    setNoiseLevel(next.noiseLevel);
    setLoadTool(next.loadTool);
    setLoadScenario(next.loadScenario);
    setTestDurationMinutes(next.testDurationMinutes?.toString() ?? "");
    setAmbientTemp(next.ambientTempC?.toString() ?? "");
    setCpuFanRpm(next.cpuFanRpm?.toString() ?? "");
    setGpuFanRpm(next.gpuFanRpm?.toString() ?? "");
    setNote(next.note ?? "");
    setMessage(null);
    setImportError(null);
    setTrendFilter("all");
    setCsvImportPreview(null);
    setResetPending(false);
  }

  function addRun() {
    if (history.runs.length >= ASSEMBLY_VERIFICATION_HISTORY_LIMIT) {
      setMessage(`실측 이력은 최대 ${ASSEMBLY_VERIFICATION_HISTORY_LIMIT}회차까지 저장할 수 있습니다.`);
      return;
    }
    const createdAt = new Date().toISOString();
    const nextRun = emptyAssemblyVerificationHistory(storageKey, createdAt).runs[0];
    const runId = nextRun.runId!;
    const run = { ...nextRun, runId, runLabel: `조립 검증 ${history.runs.length + 1}회차`, createdAt };
    setHistory((current) => ({ ...current, activeRunId: runId, updatedAt: createdAt, runs: [...current.runs, run] }));
    setSelectedRunId(runId);
    setCpuTemp("");
    setGpuTemp("");
    setNoiseLevel("not_recorded");
    setLoadTool("not_recorded");
    setLoadScenario("not_recorded");
    setTestDurationMinutes("");
    setAmbientTemp("");
    setCpuFanRpm("");
    setGpuFanRpm("");
    setNote("");
    setMessage(`${history.runs.length + 1}회차 실측 로그를 만들었습니다.`);
    setImportError(null);
    setTrendFilter("all");
    setCsvImportPreview(null);
    setResetPending(false);
  }

  function updateRunLabel(nextLabel: string) {
    updateActiveLog((current) => ({ ...current, runLabel: nextLabel, updatedAt: new Date().toISOString() }));
  }

  function updateCheck(id: AssemblyVerificationCheckId, status: AssemblyVerificationLog["checks"][AssemblyVerificationCheckId]["status"], nextNote?: string) {
    updateActiveLog((current) => withAssemblyVerificationCheck(current, id, status, nextNote ?? current.checks[id].note ?? ""));
    setMessage(null);
  }

  function updateCheckNote(id: AssemblyVerificationCheckId, nextNote: string) {
    updateActiveLog((current) => withAssemblyVerificationCheck(current, id, current.checks[id].status, nextNote));
    setMessage(null);
  }

  function saveMeasurements() {
    const parsed = withAssemblyVerificationMeasurements(log, { cpuMaxTempC: cpuTemp, gpuMaxTempC: gpuTemp, noiseLevel, loadTool, loadScenario, testDurationMinutes, ambientTempC: ambientTemp, cpuFanRpm, gpuFanRpm, note, measurementSource: "manual" });
    if (parsed.errors.length > 0 || !parsed.log) {
      setMessage(parsed.errors.join(" "));
      return;
    }
    updateActiveLog(() => parsed.log!);
    setMessage("테스트 조건·온도·소음·조립 메모를 저장했습니다.");
  }

  function downloadCsvTemplate() {
    downloadText(`pc-supporter-assembly-verification-template-${new Date().toISOString().slice(0, 10)}.csv`, assemblyVerificationCsvTemplateFor(), "text/csv;charset=utf-8");
    setMessage("실측 CSV 양식을 저장했습니다. HWiNFO·OCCT 센서 열을 같은 이름으로 맞춰 사용할 수 있습니다.");
  }

  async function importMeasurementCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 5_000_000) {
      setImportError("실측 CSV는 5MB 이하만 가져올 수 있습니다.");
      return;
    }
    try {
      const parsed = parseAssemblyVerificationCsv(await file.text());
      if (parsed.errors.length > 0 || !parsed.import) {
        setImportError(parsed.errors.join(" ") || "실측 CSV를 읽지 못했습니다.");
        setCsvImportPreview(null);
        return;
      }
      setCsvImportPreview({ fileName: file.name.slice(0, 160) || "측정 CSV", parsed: parsed.import });
      setImportError(null);
      setMessage("CSV 집계 결과를 확인한 뒤 현재 회차에 적용해 주세요.");
    } catch {
      setImportError("실측 CSV 파일을 읽지 못했습니다.");
      setCsvImportPreview(null);
    }
  }

  function applyCsvImport() {
    if (!csvImportPreview) return;
    const imported = csvImportPreview.parsed;
    const parsed = withAssemblyVerificationMeasurements(log, {
      cpuMaxTempC: imported.values.cpuMaxTempC ?? log.cpuMaxTempC,
      gpuMaxTempC: imported.values.gpuMaxTempC ?? log.gpuMaxTempC,
      ambientTempC: imported.values.ambientTempC ?? log.ambientTempC,
      cpuFanRpm: imported.values.cpuFanRpm ?? log.cpuFanRpm,
      gpuFanRpm: imported.values.gpuFanRpm ?? log.gpuFanRpm,
      noiseLevel,
      loadTool,
      loadScenario,
      testDurationMinutes,
      measurementSource: "csv",
      measurementSourceLabel: csvImportPreview.fileName,
      measurementSampleCount: imported.sampleCount,
      measurementImportedAt: new Date().toISOString(),
      measurementSeries: imported.series,
      measurementQuality: imported.quality
    });
    if (parsed.errors.length > 0 || !parsed.log) {
      setImportError(parsed.errors.join(" ") || "CSV 집계값을 적용하지 못했습니다.");
      return;
    }
    const next = parsed.log;
    updateActiveLog(() => next);
    setCpuTemp(next.cpuMaxTempC?.toString() ?? "");
    setGpuTemp(next.gpuMaxTempC?.toString() ?? "");
    setAmbientTemp(next.ambientTempC?.toString() ?? "");
    setCpuFanRpm(next.cpuFanRpm?.toString() ?? "");
    setGpuFanRpm(next.gpuFanRpm?.toString() ?? "");
    setCsvImportPreview(null);
    setImportError(null);
    setMessage(`${imported.sampleCount.toLocaleString("ko-KR")}개 유효 샘플의 최고 온도·최대 RPM·평균 주변 온도를 현재 회차에 적용했습니다.`);
  }

  function requestResetLog() {
    setResetPending(true);
    setMessage(null);
    setImportError(null);
  }

  function confirmResetLog() {
    const nextHistory = emptyAssemblyVerificationHistory(storageKey);
    setHistory(nextHistory);
    setSelectedRunId(nextHistory.activeRunId);
    setCpuTemp("");
    setGpuTemp("");
    setNoiseLevel("not_recorded");
    setLoadTool("not_recorded");
    setLoadScenario("not_recorded");
    setTestDurationMinutes("");
    setAmbientTemp("");
    setCpuFanRpm("");
    setGpuFanRpm("");
    setNote("");
    setTrendFilter("all");
    setCsvImportPreview(null);
    setResetPending(false);
    setMessage("조립 검증 기록을 초기화했습니다.");
  }

  function exportLog() {
    downloadJson(`pc-supporter-assembly-verification-${new Date().toISOString().slice(0, 10)}.json`, history);
    setMessage(`${history.runs.length}회차 조립 검증 이력 JSON을 저장했습니다.`);
  }

  function exportReport(format: "markdown" | "csv" | "json") {
    const report = assemblyVerificationReportFor(history, trendFilter, activeRunId, new Date().toISOString(), effectiveOverlayIncludedRunIds);
    const date = new Date().toISOString().slice(0, 10);
    if (format === "markdown") downloadText(`pc-supporter-assembly-verification-report-${date}.md`, assemblyVerificationReportTextFor(report), "text/markdown;charset=utf-8");
    else if (format === "csv") downloadText(`pc-supporter-assembly-verification-report-${date}.csv`, assemblyVerificationReportCsvFor(report), "text/csv;charset=utf-8");
    else downloadText(`pc-supporter-assembly-verification-report-${date}.json`, assemblyVerificationReportJsonFor(report), "application/json;charset=utf-8");
    setMessage(`${trendFilter === "same-load" ? "같은 부하 조건" : "전체 회차"} 기준 실측 ${format === "markdown" ? "Markdown" : format.toUpperCase()} 리포트를 저장했습니다.`);
  }

  async function syncToSavedBuild() {
    if (!savedBuildId || !savedBuildOwnerToken) {
      setMessage("서버 이력에 기록하려면 먼저 이 견적을 저장·공유해 주세요.");
      return;
    }
    setSyncing(true);
    try {
      const saved = await api<SavedBuild>(`/api/builds/${encodeURIComponent(savedBuildId)}/assembly-verification`, {
        method: "PUT",
        headers: { "X-Share-Owner-Token": savedBuildOwnerToken },
        body: JSON.stringify({ history }),
        retry: 0
      });
      onServerSync?.(saved);
      setMessage(`${history.runs.length}회차 실측 이력을 저장 견적의 읽기 전용 검사 이력에 기록했습니다.`);
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : "저장 견적에 실측 로그를 기록하지 못했습니다.");
    } finally {
      setSyncing(false);
    }
  }

  async function importLog(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parseAssemblyVerificationHistoryJson(await file.text(), storageKey);
      if (parsed.errors.length > 0 || !parsed.history) {
        setImportError(parsed.errors.join(" ") || "조립 검증 이력을 가져오지 못했습니다.");
        return;
      }
      setHistory(parsed.history);
      setSelectedRunId(parsed.history.activeRunId);
      const active = parsed.history.runs.find((run) => run.runId === parsed.history!.activeRunId) ?? parsed.history.runs.at(-1)!;
      setCpuTemp(active.cpuMaxTempC?.toString() ?? "");
      setGpuTemp(active.gpuMaxTempC?.toString() ?? "");
      setNoiseLevel(active.noiseLevel);
      setLoadTool(active.loadTool);
      setLoadScenario(active.loadScenario);
      setTestDurationMinutes(active.testDurationMinutes?.toString() ?? "");
      setAmbientTemp(active.ambientTempC?.toString() ?? "");
      setCpuFanRpm(active.cpuFanRpm?.toString() ?? "");
      setGpuFanRpm(active.gpuFanRpm?.toString() ?? "");
      setNote(active.note ?? "");
      setImportError(null);
      setCsvImportPreview(null);
      setResetPending(false);
      setMessage(`${parsed.history.runs.length}회차 조립 검증 이력을 가져왔습니다.`);
    } catch {
      setImportError("조립 검증 로그 JSON 파일을 읽지 못했습니다.");
    }
  }

  return <section className={`assembly-verification-panel ${state}`} aria-label="실제 조립 검증 로그" data-testid="assembly-verification-panel">
    <div className="assembly-verification-heading"><div><p className="eyebrow">REAL BUILD EVIDENCE</p><h2>실제 조립 검증 로그</h2><p>호환성 검사와 별도로, 조립 후 실제 부팅·인식·온도·소음 결과를 이 견적에 기록합니다. 이 기록은 자동으로 호환 판정을 통과시키지 않습니다.</p></div><span className={`assembly-verification-state ${state}`}>{state === "failed" ? <FiXCircle /> : state === "passed" ? <FiCheckCircle /> : state === "in_progress" ? <FiAlertTriangle /> : <FiInfo />} {assemblyVerificationStateLabel(state)}</span></div>
    <div className="assembly-verification-progress"><div><span>현재 회차 실측 확인 진행률</span><strong>{progress.checked} / {progress.total}개</strong><em>{progress.percent}%</em></div><div className="assembly-verification-progress-track" role="progressbar" aria-label={`현재 조립 검증 ${progress.percent}% 완료`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></div><small>{progress.failed > 0 ? `실패 확인 ${progress.failed}개 · 원인을 해결한 뒤 다시 기록하세요.` : progress.remaining > 0 ? `미확인 ${progress.remaining}개 · 조립 후 실제 결과를 기록하세요.` : "모든 항목에 결과가 기록됐습니다."}</small></div>
    <div className="assembly-verification-run-toolbar"><div><span>실측 회차</span><strong>{history.runs.length} / {ASSEMBLY_VERIFICATION_HISTORY_LIMIT}회차</strong></div><input aria-label="실측 회차 이름" value={log.runLabel ?? ""} onChange={(event) => updateRunLabel(event.target.value)} maxLength={160} placeholder="예: 조립 직후 · 드라이버 설치 후" /><button className="button button-secondary" type="button" onClick={addRun} disabled={history.runs.length >= ASSEMBLY_VERIFICATION_HISTORY_LIMIT || syncing}><FiRefreshCw /> 새 회차</button></div>
    <div className="assembly-verification-run-list" role="list" aria-label="실측 회차 목록">{history.runs.slice().reverse().map((run) => { const runProgress = assemblyVerificationProgressFor(run); const runState = assemblyVerificationStateFor(run); return <div role="listitem" key={run.runId}><button className={run.runId === activeRunId ? "selected" : ""} type="button" onClick={() => selectRun(run.runId!)}><span>{run.runLabel ?? "조립 검증 회차"}</span><small>{assemblyVerificationStateLabel(runState)} · {runProgress.checked}/{runProgress.total}개 · {new Date(run.updatedAt).toLocaleDateString("ko-KR")}{run.measurementSource === "csv" ? ` · CSV ${run.measurementSampleCount ?? "-"}샘플 · 시계열 ${run.measurementSeries?.length ?? 0}점` : ""}</small></button></div>; })}</div>
    <section className="assembly-verification-trend" aria-label="실측 회차별 추세 비교" data-testid="assembly-verification-trend"><div className="assembly-verification-subheading"><strong>회차별 추세 비교</strong><span>기록된 측정값만 비교 · 임계값 자동 판정 없음</span></div><div className="assembly-verification-trend-controls" role="group" aria-label="실측 추세 비교 필터"><button className={trendFilter === "all" ? "selected" : ""} type="button" aria-pressed={trendFilter === "all"} onClick={() => setTrendFilter("all")}>전체 회차</button><button className={trendFilter === "same-load" ? "selected" : ""} type="button" aria-pressed={trendFilter === "same-load"} onClick={() => setTrendFilter("same-load")} disabled={sameLoadComparison.points.length === 0}>같은 부하 조건</button></div><p className="assembly-verification-trend-summary">{trendFilter === "same-load" ? sameLoadComparison.reason === "reference-condition-missing" ? "현재 회차에 도구·시나리오·테스트 시간이 모두 기록되어야 같은 조건 비교를 할 수 있습니다." : "현재 회차와 같은 도구·시나리오·테스트 시간의 회차만 비교합니다." : "조건이 다른 회차 사이의 변화량은 계산하지 않습니다. 같은 부하 조건 필터를 선택하면 직전 동일 조건 대비 변화량을 봅니다."}</p>{recheckSignals.length > 0 && <div className="assembly-verification-signals" aria-label="실측 재확인 신호"><div className="assembly-verification-subheading"><strong>재확인 신호</strong><span>위험 판정이 아닌 반복 패턴 안내</span></div><div className="assembly-verification-signal-list">{recheckSignals.map((signal) => <article key={signal.id}><strong>{signal.title}</strong><p>{signal.summary}</p><small>{signal.evidence} · 해당 회차 {signal.runIds.length}개</small></article>)}</div></div>}{comparison.points.some((point) => point.cpuMaxTempC !== undefined || point.gpuMaxTempC !== undefined || point.ambientTempC !== undefined || point.cpuFanRpm !== undefined || point.gpuFanRpm !== undefined) ? <><div className="assembly-verification-trend-table-wrap"><table><caption>조립 검증 회차별 조건·온도·팬·소음</caption><thead><tr><th scope="col">회차</th><th scope="col">상태</th><th scope="col">CPU 최고</th><th scope="col">GPU 최고</th><th scope="col">주변</th><th scope="col">CPU 보정</th><th scope="col">GPU 보정</th><th scope="col">Δ CPU</th><th scope="col">Δ GPU</th><th scope="col">Δ CPU 보정</th><th scope="col">Δ GPU 보정</th><th scope="col">팬 RPM</th><th scope="col">조건</th></tr></thead><tbody>{comparison.points.map((point) => <tr key={point.runId}><th scope="row">{point.index}. {point.runLabel}</th><td>{assemblyVerificationStateLabel(point.state)}</td><td>{metricText(point.cpuMaxTempC, "°C")}</td><td>{metricText(point.gpuMaxTempC, "°C")}</td><td>{metricText(point.ambientTempC, "°C")}</td><td>{metricText(point.cpuAmbientAdjustedC, "°C")}</td><td>{metricText(point.gpuAmbientAdjustedC, "°C")}</td><td>{deltaText(point.cpuDeltaC, point.comparableToPrevious, point.comparisonBlockReason)}</td><td>{deltaText(point.gpuDeltaC, point.comparableToPrevious, point.comparisonBlockReason)}</td><td>{deltaText(point.cpuAmbientAdjustedDeltaC, point.comparableToPrevious, point.comparisonBlockReason)}</td><td>{deltaText(point.gpuAmbientAdjustedDeltaC, point.comparableToPrevious, point.comparisonBlockReason)}</td><td>{point.cpuFanRpm === undefined && point.gpuFanRpm === undefined ? "-" : `${point.cpuFanRpm ?? "-"}/${point.gpuFanRpm ?? "-"}`}</td><td>{point.testDurationMinutes !== undefined ? `${point.testDurationMinutes}분` : "-"} · {noiseText(point.noiseLevel)}</td></tr>)}</tbody></table></div><div className="assembly-verification-trend-bars" aria-label="회차별 CPU·GPU 최고 온도 막대 비교">{comparison.points.filter((point) => point.cpuMaxTempC !== undefined || point.gpuMaxTempC !== undefined).map((point) => <div className="assembly-verification-trend-bar-group" key={`bar-${point.runId}`}><strong>{point.index}회차</strong>{point.cpuMaxTempC !== undefined && <div><span>CPU</span><i><em style={{ width: `${Math.min(100, Math.max(0, (point.cpuMaxTempC / 150) * 100))}%` }} /></i><b>{point.cpuMaxTempC}°C</b></div>}{point.gpuMaxTempC !== undefined && <div><span>GPU</span><i><em className="gpu" style={{ width: `${Math.min(100, Math.max(0, (point.gpuMaxTempC / 150) * 100))}%` }} /></i><b>{point.gpuMaxTempC}°C</b></div>}</div>)}</div></> : <p className="assembly-verification-trend-empty"><FiInfo /> {comparison.reason === "reference-condition-missing" ? "같은 부하 조건 비교를 위해 현재 회차의 도구·시나리오·테스트 시간을 먼저 기록하세요." : comparison.reason === "no-matching-condition" ? "현재 회차와 같은 부하 조건으로 기록된 회차가 없습니다." : "온도·RPM을 저장하면 회차별 추세가 표시됩니다."}</p>}</section>
    <div className="assembly-verification-checks">{ASSEMBLY_VERIFICATION_CHECKS.map((definition) => { const entry = log.checks[definition.id]; const Icon = statusIcon(entry.status); return <article className={`assembly-verification-check ${entry.status}`} key={definition.id}><div className="assembly-verification-check-icon"><Icon /></div><div className="assembly-verification-check-copy"><strong>{definition.label}</strong><small>{definition.detail}</small><input aria-label={`${definition.label} 메모`} value={entry.note ?? ""} onChange={(event) => updateCheckNote(definition.id, event.target.value)} maxLength={500} placeholder="선택 메모: 측정 조건·오류 코드·확인 시각" /></div><label className="assembly-verification-check-status"><span>결과</span><select aria-label={`${definition.label} 상태`} value={entry.status} onChange={(event) => updateCheck(definition.id, event.target.value as typeof entry.status)}><option value="unchecked">미확인</option><option value="pass">통과</option><option value="fail">실패 확인</option></select><small>{assemblyVerificationStatusLabel(entry.status)}</small></label></article>; })}</div>
    <div className="assembly-verification-measurements"><div className="assembly-verification-subheading"><strong>테스트 조건</strong><span>선택 입력 · 재현 가능한 조건을 함께 기록</span></div><div className="assembly-verification-condition-grid"><label><span>부하 도구</span><select aria-label="부하 도구" value={loadTool} onChange={(event) => setLoadTool(event.target.value as AssemblyVerificationLoadTool)}><option value="not_recorded">기록하지 않음</option><option value="occt">OCCT</option><option value="cinebench">Cinebench</option><option value="3dmark">3DMark</option><option value="crystaldiskmark">CrystalDiskMark</option><option value="other">기타</option></select></label><label><span>부하 시나리오</span><select aria-label="부하 시나리오" value={loadScenario} onChange={(event) => setLoadScenario(event.target.value as AssemblyVerificationLoadScenario)}><option value="not_recorded">기록하지 않음</option><option value="idle">유휴</option><option value="cpu">CPU 부하</option><option value="gpu">GPU 부하</option><option value="mixed">혼합 부하</option><option value="storage">저장장치 부하</option><option value="custom">사용자 지정</option></select></label><label><span>테스트 시간 (분)</span><input aria-label="테스트 시간" type="number" min="1" max="1440" step="1" value={testDurationMinutes} onChange={(event) => setTestDurationMinutes(event.target.value)} placeholder="예: 20" /></label></div><div className="assembly-verification-subheading assembly-verification-measurement-subheading"><strong>온도·소음·팬 측정값</strong><span>{log.measurementSource === "csv" ? `CSV 집계 · ${log.measurementSourceLabel ?? "파일"} · ${log.measurementSampleCount ?? "-"}개 유효 샘플` : "직접 측정값 또는 CSV 집계값"}</span></div><div className="assembly-verification-measurement-grid"><label><span>CPU 최고 온도 (°C)</span><input aria-label="CPU 최고 온도" type="number" min="0" max="150" step="0.1" value={cpuTemp} onChange={(event) => setCpuTemp(event.target.value)} placeholder="예: 78.5" /></label><label><span>GPU 최고 온도 (°C)</span><input aria-label="GPU 최고 온도" type="number" min="0" max="150" step="0.1" value={gpuTemp} onChange={(event) => setGpuTemp(event.target.value)} placeholder="예: 72" /></label><label><span>주변 온도 (°C)</span><input aria-label="주변 온도" type="number" min="0" max="60" step="0.1" value={ambientTemp} onChange={(event) => setAmbientTemp(event.target.value)} placeholder="예: 24" /></label><label><span>CPU 팬 RPM</span><input aria-label="CPU 팬 RPM" type="number" min="0" max="30000" step="1" value={cpuFanRpm} onChange={(event) => setCpuFanRpm(event.target.value)} placeholder="예: 1200" /></label><label><span>GPU 팬 RPM</span><input aria-label="GPU 팬 RPM" type="number" min="0" max="30000" step="1" value={gpuFanRpm} onChange={(event) => setGpuFanRpm(event.target.value)} placeholder="예: 1450" /></label><label><span>체감 소음</span><select aria-label="체감 소음" value={noiseLevel} onChange={(event) => setNoiseLevel(event.target.value as AssemblyVerificationLog["noiseLevel"])}><option value="not_recorded">기록하지 않음</option><option value="quiet">조용함</option><option value="normal">보통</option><option value="loud">큼 · 원인 확인</option></select></label></div>{csvImportPreview && <section className="assembly-verification-csv-preview" aria-label="실측 CSV 가져오기 미리보기" data-testid="assembly-verification-csv-preview"><div className="assembly-verification-csv-preview-heading"><div><strong>측정 CSV 미리보기</strong><small>{csvImportPreview.fileName} · {csvImportPreview.parsed.delimiter === ";" ? "세미콜론" : csvImportPreview.parsed.delimiter === "\t" ? "탭" : "쉼표"} 구분</small></div><span>{csvImportPreview.parsed.sampleCount.toLocaleString("ko-KR")}개 유효 샘플</span></div><div className="assembly-verification-csv-stats"><span>전체 행 {csvImportPreview.parsed.rowCount.toLocaleString("ko-KR")}</span><span>집계 대상 {csvImportPreview.parsed.sampleCount.toLocaleString("ko-KR")}</span><span>제외 {csvImportPreview.parsed.skippedRowCount.toLocaleString("ko-KR")}</span><span>인식 열 {Object.keys(csvImportPreview.parsed.detectedHeaders).length}/5</span><span>추가 센서 {csvImportPreview.parsed.telemetryColumnCount}개</span></div><div className="assembly-verification-csv-mapping">{(Object.entries(csvImportPreview.parsed.detectedHeaders) as Array<[AssemblyVerificationCsvMetric, string]>).map(([metric, header]) => <div key={metric}><span>{ASSEMBLY_VERIFICATION_CSV_METRIC_LABELS[metric]}</span><small>{header} · {metric === "ambientTempC" ? "평균" : "최대"} {csvImportPreview.parsed.values[metric] ?? "-"}{metric.endsWith("TempC") ? "°C" : "RPM"}</small></div>)}</div>{csvImportPreview.parsed.telemetryColumnCount > 0 && <div className="assembly-verification-csv-extra-metrics">{(Object.entries(csvImportPreview.parsed.detectedTelemetryHeaders) as Array<[AssemblyVerificationCsvTelemetryMetric, string]>).map(([metric, header]) => <span key={metric}>{ASSEMBLY_VERIFICATION_CSV_TELEMETRY_LABELS[metric]} · {header}</span>)}</div>}{csvImportPreview.parsed.warnings.length > 0 && <div className="assembly-verification-csv-warnings" role="status">{csvImportPreview.parsed.warnings.map((warning) => <small key={warning}><FiInfo /> {warning}</small>)}</div>}<p><FiInfo /> 온도·팬은 유효 행의 최대값, 주변 온도는 평균값으로 집계합니다. 현재 회차의 부하 조건·소음·체크 결과는 유지됩니다.</p><div className="assembly-verification-csv-actions"><button className="button button-light" type="button" onClick={() => setCsvImportPreview(null)}>취소</button><button className="button button-primary" type="button" onClick={applyCsvImport}>이 집계값을 현재 회차에 적용</button></div></section>}<label className="assembly-verification-note-field"><span>조립 검증 종합 메모</span><textarea aria-label="조립 검증 종합 메모" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="예: OCCT 20분, 주변 24°C, CPU 팬 1,200RPM, 전면 팬 3개 모두 회전" /></label><div className="assembly-verification-actions"><button className="button button-primary" type="button" onClick={saveMeasurements} disabled={syncing}><FiSave /> 측정값 저장</button><button className="button button-light" type="button" onClick={exportLog} disabled={syncing}><FiDownload /> JSON 저장</button><input ref={importInputRef} className="assembly-verification-import-input" type="file" accept=".json,application/json" aria-label="조립 검증 로그 JSON 파일 가져오기" onChange={(event) => void importLog(event)} disabled={syncing} /><button className="button button-light" type="button" onClick={() => importInputRef.current?.click()} disabled={syncing}><FiUpload /> JSON 가져오기</button><input ref={csvImportInputRef} className="assembly-verification-import-input" type="file" accept=".csv,text/csv" aria-label="실측 측정 CSV 가져오기" onChange={(event) => void importMeasurementCsv(event)} disabled={syncing} /><button className="button button-light" type="button" onClick={() => csvImportInputRef.current?.click()} disabled={syncing}><FiUpload /> 측정 CSV 가져오기</button><button className="button button-light" type="button" onClick={downloadCsvTemplate} disabled={syncing}><FiDownload /> CSV 양식</button>{savedBuildId && savedBuildOwnerToken ? <button className="button button-secondary" type="button" onClick={() => void syncToSavedBuild()} disabled={syncing}><FiSave /> {syncing ? "서버 기록 중..." : "저장 견적에 기록"}</button> : <small className="assembly-verification-server-hint">견적 저장·공유 후 서버 이력 기록 가능</small>}{resetPending ? <div className="assembly-verification-reset-confirm" role="alertdialog" aria-label="조립 검증 기록 초기화 확인"><span>현재 견적의 조립 검증 이력을 모두 지울까요? 호환성 검사 결과는 바뀌지 않습니다.</span><button className="text-button" type="button" onClick={() => setResetPending(false)}>취소</button><button className="text-button danger-text-button" type="button" aria-label="조립 검증 기록 초기화 확인" onClick={confirmResetLog}>기록 초기화</button></div> : <button className="text-button assembly-verification-reset" type="button" onClick={requestResetLog} disabled={syncing}><FiRefreshCw /> 기록 초기화</button>}</div></div>
    {message && <p className="assembly-verification-message" role="status"><FiCheckCircle /> {message}</p>}
    {importError && <p className="assembly-verification-message error" role="alert"><FiXCircle /> {importError}</p>}
    <p className="assembly-verification-note"><FiInfo /> 실측 로그는 이 브라우저의 현재 견적 fingerprint에 묶어 저장합니다. 다른 부품·수량·추천 기준·카탈로그 기준의 견적에는 자동으로 재사용하지 않습니다. 측정 CSV는 인식된 유효 행의 온도·팬 RPM 최대값과 주변 온도 평균값으로 집계하며, 이 값도 자동 안전·위험 판정이 아니라 재확인 근거로만 사용합니다.</p>
    {log.measurementSeries && log.measurementSeries.length > 1 && <section className="assembly-verification-timeseries" aria-label="CSV 원본 시계열 추세" data-testid="assembly-verification-timeseries"><div className="assembly-verification-subheading"><strong>CSV 원본 시계열 추세</strong><span>{log.measurementSeries.length}점 압축 표시 · 원본 유효 샘플 {log.measurementSampleCount ?? "-"}개</span></div><div className="assembly-verification-timeseries-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="CSV CPU·GPU 온도 시계열"><line x1="0" y1="8" x2="100" y2="8" /><line x1="0" y1="52" x2="100" y2="52" /><line x1="0" y1="96" x2="100" y2="96" />{telemetryLineSegmentsFor(log.measurementSeries, "cpuTempC", log.measurementQuality?.continuity?.gapToleranceSeconds).map((points, index) => <polyline key={`cpu-${index}`} points={points} className="cpu-line" />)}{telemetryLineSegmentsFor(log.measurementSeries, "gpuTempC", log.measurementQuality?.continuity?.gapToleranceSeconds).map((points, index) => <polyline key={`gpu-${index}`} points={points} className="gpu-line" />)}</svg><div className="assembly-verification-timeseries-axis"><span>0</span><span>{log.measurementSeries.every((point) => point.elapsedSeconds !== undefined) ? `${((log.measurementSeries.at(-1)?.elapsedSeconds ?? 0) / 60).toFixed(1)}분` : "샘플 순서"}</span></div><div className="assembly-verification-timeseries-legend"><span><i className="cpu-dot" /> CPU 온도</span><span><i className="gpu-dot" /> GPU 온도</span><small>세로축 0~150°C · 임계값 자동 판정 없음</small></div></div><div className="assembly-verification-timeseries-stats">{(["cpuTempC", "gpuTempC", "cpuFanRpm", "gpuFanRpm", "cpuUsagePercent", "gpuUsagePercent", "cpuClockMHz", "gpuClockMHz", "cpuPowerW", "gpuPowerW"] as const).map((metric) => { const summary = assemblyVerificationTelemetrySummaryFor(log.measurementSeries, metric); return summary ? <div key={metric}><strong>{telemetryMetricLabel(metric)}</strong><small>최저 {summary.min}{telemetryMetricSuffix(metric)} · 평균 {summary.mean}{telemetryMetricSuffix(metric)} · 최고 {summary.max}{telemetryMetricSuffix(metric)} · {summary.count}개</small></div> : null; })}</div><p className="assembly-verification-timeseries-note"><FiInfo /> 시간 열이 있으면 경과 시간 기준, 없으면 샘플 순서 기준으로 표시합니다. 시계열은 최대 240개 포인트로 압축하며, 원본 CSV 파일 자체는 저장하지 않습니다.</p></section>}
    {history.runs.length > 0 && <section className="assembly-verification-report-export" aria-label="실측 리포트 내보내기" data-testid="assembly-verification-report-export"><div className="assembly-verification-subheading"><strong>실측 리포트</strong><span>{trendFilter === "same-load" ? "같은 부하 조건" : "전체 회차"} · 원본 CSV 제외</span></div><p>현재 비교 필터의 회차·조건·대표값·델타·재확인 신호를 검토용 파일로 저장합니다. 원본 CSV는 포함하지 않고 압축 시계열 포인트 수와 출처 메타데이터만 기록합니다.</p><div className="assembly-verification-report-actions"><button className="button button-light" type="button" onClick={() => exportReport("markdown")} disabled={syncing}><FiDownload /> Markdown 저장</button><button className="button button-light" type="button" onClick={() => exportReport("csv")} disabled={syncing}><FiDownload /> CSV 저장</button><button className="button button-light" type="button" onClick={() => exportReport("json")} disabled={syncing}><FiDownload /> 요약 JSON 저장</button></div></section>}
    {log.measurementSeries && log.measurementSeries.length > 1 && <section className="assembly-verification-telemetry-analysis" aria-label="시계열 관찰 해석" data-testid="assembly-verification-telemetry-analysis"><div className="assembly-verification-subheading"><strong>시계열 관찰 해석</strong><span>관찰값 요약 · 안전/위험 자동 판정 아님</span></div><div className="assembly-verification-telemetry-analysis-grid">{(["cpuTempC", "gpuTempC", "cpuFanRpm", "gpuFanRpm", "cpuUsagePercent", "gpuUsagePercent", "cpuClockMHz", "gpuClockMHz", "cpuPowerW", "gpuPowerW"] as const).map((metric) => { const analysis = telemetryAnalysis.metrics[metric]; return analysis ? <article key={metric}><div><strong>{telemetryMetricLabel(metric)}</strong><span>{telemetryTrendText(analysis.trend)}</span></div><p>{telemetryAnalysisMetricText(analysis)}</p><small>상승 단계 {analysis.positiveStepCount}/{analysis.stepCount} · 유효 샘플 {analysis.sampleCount}개</small></article> : null; })}</div><p className="assembly-verification-telemetry-analysis-note"><FiInfo /> 변화율은 시간 열이 있는 경우에만 계산합니다. `상승`은 첫 유효 샘플보다 마지막 유효 샘플이 높다는 관찰이며, 특정 온도가 안전하다는 보증이나 고장 판정이 아닙니다.</p></section>}
    {log.measurementSeries && log.measurementSeries.length > 1 && <section className="assembly-verification-load-profile" aria-label="부하 구간 분석" data-testid="assembly-verification-load-profile"><div className="assembly-verification-subheading"><strong>부하 구간 분석</strong><span>사용률 기반 관찰 · 호환성 판정과 분리</span></div>{loadProfile.reason === "usage-not-recorded" ? <p className="assembly-verification-load-profile-empty"><FiInfo /> CPU/GPU 사용률 열이 없어 부하 구간을 분류할 수 없습니다. 사용률 센서를 포함한 CSV를 가져오면 유휴·CPU·GPU·혼합 부하를 구분합니다.</p> : <><div className="assembly-verification-load-profile-stats"><span>사용률 커버리지 <b>{loadProfile.usageCoveragePercent}%</b></span><span>분류 구간 <b>{loadProfile.segments.length}개</b></span><span>미분류 포인트 <b>{loadProfile.unclassifiedPointCount}개</b></span></div><p className="assembly-verification-load-profile-rule">분류 기준 · 유휴 ≤ {loadProfile.thresholds.idleMaxPercent}% · 고부하 ≥ {loadProfile.thresholds.highMinPercent}% · 반대 센서 ≤ {loadProfile.thresholds.lowMaxPercent}%일 때 단일 부하로 표시합니다. 그 사이는 부분 부하입니다.</p><div className="assembly-verification-load-segments">{loadProfile.segments.map((segment) => <article key={segment.id}><div><strong>{segment.label}</strong><span>{segment.breakBefore === "gap" ? `공백 ${segment.gapBeforeSeconds ?? "-"}초 후 · ` : segment.breakBefore === "non-monotonic" ? "시간 역순 후 · " : ""}{loadSegmentDurationText(segment)} · {segment.pointCount}포인트</span></div><p>{segment.reason}</p><small>{loadSegmentObservationText(segment)}</small></article>)}</div></>}</section>}
    {loadProfile.segments.length > 0 && <section className="assembly-verification-load-comparison" aria-label="이전 동일 조건 부하 구간 비교" data-testid="assembly-verification-load-comparison"><div className="assembly-verification-subheading"><strong>이전 동일 조건과 비교</strong><span>{loadProfileComparison.previousRunLabel ? `${loadProfileComparison.previousRunLabel} → ${loadProfileComparison.currentRunLabel ?? "현재 회차"}` : "기준 회차"}</span></div>{loadProfileComparison.reason === "reference-condition-missing" ? <p className="assembly-verification-load-profile-empty"><FiInfo /> 부하 조건이 완성된 회차만 이전 회차와 비교할 수 있습니다.</p> : loadProfileComparison.reason === "different-condition" ? <p className="assembly-verification-load-profile-empty"><FiInfo /> 직전 회차의 부하 조건이 달라 같은 조건 비교를 하지 않습니다.</p> : loadProfileComparison.reason === "measurement-continuity-gapped" ? <p className="assembly-verification-load-profile-empty"><FiInfo /> 직전 회차 또는 현재 회차의 시간축 공백·역순 때문에 구간 비교를 하지 않습니다.</p> : loadProfileComparison.reason === "measurement-quality-review" ? <p className="assembly-verification-load-profile-empty"><FiInfo /> 측정 품질이 확인 필요인 회차라 구간 비교를 하지 않습니다.</p> : loadProfileComparison.reason === "no-previous-run" ? <p className="assembly-verification-load-profile-empty"><FiInfo /> 같은 조건의 이전 회차가 없어 현재 결과를 기준 회차로 표시합니다.</p> : <div className="assembly-verification-load-comparison-list">{loadProfileComparison.segments.map((segment) => <article key={`${segment.kind}-${segment.occurrenceIndex}`}><div><strong>{segment.label}{segment.occurrenceIndex > 0 ? ` ${segment.occurrenceIndex + 1}` : ""}</strong><span>현재 {segment.current.pointCount}포인트{segment.previous ? ` · 이전 ${segment.previous.pointCount}포인트` : ""}</span></div><p>{loadSegmentComparisonText(segment)}</p></article>)}</div>}</section>}
    {log.measurementSeries && log.measurementSeries.length > 1 && <section className="assembly-verification-overlay" aria-label="동일 조건 전체 회차 시계열 비교" data-testid="assembly-verification-overlay"><div className="assembly-verification-subheading"><strong>동일 조건 전체 회차 추세</strong><span>{telemetryOverlay.runCount > 0 ? `${telemetryOverlay.runCount}회차 overlay · 진행률 정규화` : "비교 준비 필요"}</span></div>{telemetryOverlay.runCount === 0 ? <p className="assembly-verification-load-profile-empty"><FiInfo />{telemetryOverlay.reason === "reference-condition-missing" ? "부하 도구·시나리오·테스트 시간이 모두 기록된 회차만 겹쳐 비교할 수 있습니다." : "같은 조건으로 2개 이상의 시계열 회차를 기록하면 전체 추세를 겹쳐 볼 수 있습니다."}</p> : <><div className="assembly-verification-overlay-chart-grid"><div><strong>CPU 온도</strong><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="동일 조건 회차별 CPU 온도 overlay"><line x1="0" y1="8" x2="100" y2="8" /><line x1="0" y1="52" x2="100" y2="52" /><line x1="0" y1="96" x2="100" y2="96" />{telemetryOverlay.runs.flatMap((run, index) => overlayLineSegmentsFor(run, "cpuTempC").map((points, segmentIndex) => <polyline key={`${run.runId}-cpu-${segmentIndex}`} points={points} style={{ stroke: overlayColorFor(index) }} />))}</svg></div><div><strong>GPU 온도</strong><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="동일 조건 회차별 GPU 온도 overlay"><line x1="0" y1="8" x2="100" y2="8" /><line x1="0" y1="52" x2="100" y2="52" /><line x1="0" y1="96" x2="100" y2="96" />{telemetryOverlay.runs.flatMap((run, index) => overlayLineSegmentsFor(run, "gpuTempC").map((points, segmentIndex) => <polyline key={`${run.runId}-gpu-${segmentIndex}`} points={points} style={{ stroke: overlayColorFor(index) }} />))}</svg></div></div><div className="assembly-verification-overlay-axis"><span>테스트 시작 0%</span><span>테스트 종료 100%</span></div><div className="assembly-verification-overlay-legend">{telemetryOverlay.runs.map((run, index) => <span key={run.runId}><i style={{ background: overlayColorFor(index) }} />{run.index}. {run.runLabel} · CPU 최고 {run.cpuTempPeak ?? "-"}°C · GPU 최고 {run.gpuTempPeak ?? "-"}°C</span>)}</div><div className="assembly-verification-overlay-summary">{telemetryOverlay.runs.map((run) => <article key={`summary-${run.runId}`}><strong>{run.runLabel}</strong><small>{run.originalPointCount}포인트 · CPU {run.cpuTempFirst ?? "-"} → {run.cpuTempPeak ?? "-"}°C · GPU {run.gpuTempFirst ?? "-"} → {run.gpuTempPeak ?? "-"}°C · 사용률 CPU {run.cpuUsageMean ?? "-"}% / GPU {run.gpuUsageMean ?? "-"}%</small></article>)}</div><p className="assembly-verification-overlay-note"><FiInfo /> 회차마다 샘플 수가 달라도 테스트 진행률 0~100%에 맞춰 겹쳐 표시합니다. 서로 다른 부하 조건은 overlay에 포함하지 않습니다.</p></>}</section>}
    {overlayCandidateRuns.length > 0 && <section className="assembly-verification-overlay-controls" aria-label="overlay 회차 선택" data-testid="assembly-verification-overlay-controls"><div className="assembly-verification-subheading"><strong>overlay 회차 선택</strong><span>같은 조건 후보 {overlayCandidateRuns.length}개</span></div><div className="assembly-verification-overlay-control-row"><label><span>기준 회차</span><select aria-label="overlay 기준 회차" value={effectiveOverlayReferenceRunId} onChange={(event) => { setOverlayReferenceRunId(event.target.value); setOverlayIncludedRunIds(null); }}>{overlayCandidateRuns.map((point) => <option value={point.runId} key={`reference-${point.runId}`}>{point.index}. {point.runLabel}</option>)}</select></label><div className="assembly-verification-overlay-control-actions"><button className="button button-light" type="button" onClick={() => setOverlayIncludedRunIds([...overlayCandidateRunIds])}>전체 회차</button><button className="button button-light" type="button" onClick={() => setOverlayIncludedRunIds([effectiveOverlayReferenceRunId])}>기준 회차만</button></div></div><div className="assembly-verification-overlay-checkboxes" role="group" aria-label="overlay에 포함할 회차">{overlayCandidateRuns.map((point) => { const checked = effectiveOverlayIncludedRunIds.includes(point.runId); return <label key={`include-${point.runId}`}><input type="checkbox" checked={checked} onChange={(event) => setOverlayIncludedRunIds((current) => { const next = new Set(current ?? overlayCandidateRunIds); if (event.target.checked) next.add(point.runId); else next.delete(point.runId); return [...next]; })} /><span>{point.index}. {point.runLabel}</span></label>; })}</div><p className="assembly-verification-overlay-control-note"><FiInfo /> 기준 회차를 바꾸면 동일 부하 조건 후보가 다시 계산됩니다. 선택 해제된 회차는 overlay와 회차 수 요약에서 제외됩니다.</p></section>}
    {comparisonSummary.overlay.runCount > 0 && <section className="assembly-verification-comparison-summary" aria-label="회차 비교 요약" data-testid="assembly-verification-comparison-summary"><div className="assembly-verification-subheading"><strong>회차 비교 요약</strong><span>{comparisonSummary.overlay.runCount}회차 · 기준 {comparisonSummary.baselineRunId ? "첫 선택 회차" : "-"}</span></div>{comparisonSummary.reason === "insufficient-comparison" && <p className="assembly-verification-comparison-summary-note"><FiInfo /> 비교 회차가 1개뿐이라 순위는 기준값 표시로만 제공합니다. 2개 이상 선택하면 개선·변화량을 비교할 수 있습니다.</p>}<div className="assembly-verification-comparison-summary-grid">{[comparisonRankCard("CPU 최고 온도 순", comparisonSummary.cpuPeakRows, "°C"), comparisonRankCard("GPU 최고 온도 순", comparisonSummary.gpuPeakRows, "°C"), comparisonRankCard("CPU 안정화 관찰", comparisonSummary.cpuStabilityRows, "초"), comparisonRankCard("GPU 안정화 관찰", comparisonSummary.gpuStabilityRows, "초"), comparisonRankCard("CPU 평균 전력 관찰", comparisonSummary.cpuPowerRows, "W"), comparisonRankCard("GPU 평균 전력 관찰", comparisonSummary.gpuPowerRows, "W")].map((card) => <article key={card.title}><strong>{card.title}</strong><div className="assembly-verification-comparison-rank-list">{card.rows.map((row) => <div key={row.runId}><span className="rank-number">{row.rank ?? "-"}</span><div><b>{row.runLabel}</b><small>{comparisonRankValueText(row, card.suffix)} · {comparisonRankDeltaText(row, card.suffix)}</small><em>{row.detail}</em></div></div>)}</div></article>)}</div><p className="assembly-verification-comparison-summary-note"><FiInfo /> 최고 온도는 낮은 관찰값 순, 안정화는 확인된 회차 우선·빠른 시점 순, 전력은 성능 우열이 아닌 평균 소비전력 관찰 순입니다. 사용률·클럭·냉각 구성 차이를 함께 확인하세요.</p></section>}
    {comparisonSummary.overlay.runCount > 0 && <section className={`assembly-verification-decision ${decisionSummary.status}`} aria-label="실측 결정 요약" data-testid="assembly-verification-decision"><div className="assembly-verification-subheading"><strong>실측 결정 요약</strong><span>기준 회차 → 최신 선택 회차 · 관찰값만 사용</span></div><div className="assembly-verification-decision-heading"><strong>{decisionStatusText(decisionSummary.status)}</strong><p>{decisionSummary.nextAction}</p></div><div className="assembly-verification-decision-grid">{decisionSummary.dimensions.map((dimension) => <article className={dimension.status} key={dimension.id}><div><strong>{dimension.title}</strong><span>{decisionStatusText(dimension.status)}</span></div><p>{dimension.summary}</p></article>)}</div><p className="assembly-verification-decision-note"><FiInfo /> 온도·안정화 상태는 재확인 판단에 사용하지만, 전력은 성능 우열이 아닌 관찰값입니다. 이 요약은 호환성·안전 인증·고장 확정이 아닙니다.</p></section>}
    {log.measurementQuality && <section className={`assembly-verification-quality ${log.measurementQuality.status}`} aria-label="측정 입력 품질" data-testid="assembly-verification-quality"><div className="assembly-verification-subheading"><strong>측정 입력 품질</strong><span>{measurementQualityStatusText(log.measurementQuality.status)}</span></div><div className="assembly-verification-quality-stats"><span>유효 행 <b>{log.measurementQuality.validSampleCount}/{log.measurementQuality.rowCount}</b></span><span>기본 센서 <b>{log.measurementQuality.recognizedCoreColumnCount}/{log.measurementQuality.coreColumnCount}</b></span><span>추가 센서 <b>{log.measurementQuality.telemetryColumnCount}개</b></span><span>시간축 <b>{log.measurementQuality.hasTimeAxis ? "있음" : "없음"}</b></span><span>시간축 연속성 <b>{measurementContinuityStatusText(log.measurementQuality.continuity?.status)}</b></span><span>시계열 <b>{log.measurementQuality.seriesPointCount}점</b></span>{log.measurementQuality.continuity && <span>공백/예상 누락 <b>{log.measurementQuality.continuity.gapCount}/{log.measurementQuality.continuity.estimatedMissingSamples}</b></span>}{log.measurementQuality.continuity && <span>timestamp 해석 실패 <b>{log.measurementQuality.continuity.unparsedTimestampCount}</b></span>}<span>제외/오류 <b>{log.measurementQuality.skippedRowCount}/{log.measurementQuality.invalidValueCount}</b></span></div><p className="assembly-verification-quality-note"><FiInfo /> 이 상태는 CSV 입력 완성도와 비교 가능 범위를 설명합니다. 호환성·안전·고장 판정이 아니며, 제외 행이나 잘못된 셀이 있으면 원본 센서 내보내기를 확인하세요.</p></section>}
    {qualityReviewOverlayRuns.length > 0 && <section className="assembly-verification-quality-overlay" aria-label="품질 이슈 회차 검토용 시계열" data-testid="assembly-verification-quality-overlay"><div className="assembly-verification-subheading"><strong>품질 이슈 회차 검토용 overlay</strong><span>{qualityReviewOverlayRuns.length}회차 · 정상 비교에서 제외</span></div><p className="assembly-verification-quality-overlay-intro"><FiInfo /> 아래 선은 공백·역순 timestamp 또는 오류 셀이 있는 회차를 확인하기 위한 검토용입니다. 결정 요약·정상 델타·재확인 상승 신호에는 사용하지 않습니다.</p><div className="assembly-verification-overlay-chart-grid"><div><strong>CPU 온도 · 검토용</strong><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="품질 이슈 회차 CPU 온도 검토용 overlay"><line x1="0" y1="8" x2="100" y2="8" /><line x1="0" y1="52" x2="100" y2="52" /><line x1="0" y1="96" x2="100" y2="96" />{qualityReviewOverlayRuns.flatMap((run, index) => <Fragment key={`review-cpu-${run.runId}`}>{overlayLineSegmentsFor(run, "cpuTempC").map((points, segmentIndex) => <polyline key={`${run.runId}-review-cpu-${segmentIndex}`} points={points} className="review-line" style={{ stroke: overlayColorFor(index) }} />)}{(run.gapProgressPercents ?? []).map((progress, markerIndex) => <line key={`${run.runId}-cpu-gap-${markerIndex}`} x1={progress} x2={progress} y1="5" y2="98" className="gap-marker" />)}</Fragment>)}</svg></div><div><strong>GPU 온도 · 검토용</strong><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="품질 이슈 회차 GPU 온도 검토용 overlay"><line x1="0" y1="8" x2="100" y2="8" /><line x1="0" y1="52" x2="100" y2="52" /><line x1="0" y1="96" x2="100" y2="96" />{qualityReviewOverlayRuns.flatMap((run, index) => <Fragment key={`review-gpu-${run.runId}`}>{overlayLineSegmentsFor(run, "gpuTempC").map((points, segmentIndex) => <polyline key={`${run.runId}-review-gpu-${segmentIndex}`} points={points} className="review-line" style={{ stroke: overlayColorFor(index) }} />)}{(run.gapProgressPercents ?? []).map((progress, markerIndex) => <line key={`${run.runId}-gpu-gap-${markerIndex}`} x1={progress} x2={progress} y1="5" y2="98" className="gap-marker" />)}</Fragment>)}</svg></div></div><div className="assembly-verification-overlay-axis"><span>테스트 시작 0%</span><span>테스트 종료 100%</span></div><div className="assembly-verification-overlay-legend">{qualityReviewOverlayRuns.map((run, index) => <span key={run.runId}><i style={{ background: overlayColorFor(index) }} />{run.index}. {run.runLabel} · {run.measurementContinuityStatus === "gapped" ? "시간축 공백/역순" : "측정 품질 확인"}</span>)}</div></section>}
  </section>;
}
