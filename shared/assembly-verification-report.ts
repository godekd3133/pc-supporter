import type { AssemblyVerificationComparisonFilter, AssemblyVerificationComparisonPoint, AssemblyVerificationHistory, AssemblyVerificationLoadScenario, AssemblyVerificationLoadTool, AssemblyVerificationMeasurementQuality, AssemblyVerificationMeasurementSource, AssemblyVerificationNoiseLevel, AssemblyVerificationRecheckSignal, AssemblyVerificationState, AssemblyVerificationTelemetryAnalysis, AssemblyVerificationTelemetryMetricAnalysis } from "./assembly-verification";
import { assemblyVerificationComparisonFor, assemblyVerificationRecheckSignalsFor, assemblyVerificationStateLabel, assemblyVerificationTelemetryAnalysisFor } from "./assembly-verification";
import type { AssemblyVerificationLoadProfile, AssemblyVerificationLoadProfileComparison } from "./assembly-verification-load";
import { assemblyVerificationLoadProfileComparisonFor, assemblyVerificationLoadProfileFor } from "./assembly-verification-load";
import type { AssemblyVerificationTelemetryOverlay } from "./assembly-verification-overlay";
import { assemblyVerificationTelemetryOverlayFor } from "./assembly-verification-overlay";
import type { AssemblyVerificationComparisonSummary } from "./assembly-verification-comparison-summary";
import { assemblyVerificationComparisonSummaryFor } from "./assembly-verification-comparison-summary";
import type { AssemblyVerificationDecisionSummary } from "./assembly-verification-decision";
import { assemblyVerificationDecisionSummaryFor } from "./assembly-verification-decision";

export type AssemblyVerificationReportRun = AssemblyVerificationComparisonPoint & {
  measurementSource?: AssemblyVerificationMeasurementSource;
  measurementSourceLabel?: string;
  measurementSampleCount?: number;
  measurementSeriesPointCount?: number;
  telemetryAnalysis?: AssemblyVerificationTelemetryAnalysis;
  loadProfile?: AssemblyVerificationLoadProfile;
  loadProfileComparison?: AssemblyVerificationLoadProfileComparison;
  measurementQuality?: AssemblyVerificationMeasurementQuality;
};

export type AssemblyVerificationReport = {
  type: "pc-supporter-assembly-verification-report";
  schemaVersion: 1;
  generatedAt: string;
  filter: AssemblyVerificationComparisonFilter;
  referenceRunId?: string;
  runs: AssemblyVerificationReportRun[];
  signals: AssemblyVerificationRecheckSignal[];
  telemetryOverlay?: AssemblyVerificationTelemetryOverlay;
  qualityOverlay?: AssemblyVerificationTelemetryOverlay;
  comparisonSummary?: AssemblyVerificationComparisonSummary;
  decisionSummary?: AssemblyVerificationDecisionSummary;
};

function toolLabel(value: AssemblyVerificationLoadTool) {
  return value === "occt" ? "OCCT" : value === "cinebench" ? "Cinebench" : value === "3dmark" ? "3DMark" : value === "crystaldiskmark" ? "CrystalDiskMark" : value === "other" ? "기타" : "기록하지 않음";
}

function scenarioLabel(value: AssemblyVerificationLoadScenario) {
  return value === "idle" ? "유휴" : value === "cpu" ? "CPU 부하" : value === "gpu" ? "GPU 부하" : value === "mixed" ? "혼합 부하" : value === "storage" ? "저장장치 부하" : value === "custom" ? "사용자 지정" : "기록하지 않음";
}

function noiseLabel(value: AssemblyVerificationNoiseLevel) {
  return value === "quiet" ? "조용함" : value === "normal" ? "보통" : value === "loud" ? "큼" : "기록하지 않음";
}

function metricText(value: number | undefined, suffix = "") {
  return value === undefined ? "기록 없음" : `${value}${suffix}`;
}

function signedMetricText(value: number | undefined, suffix = "") {
  if (value === undefined) return "비교 불가";
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

function sourceText(run: AssemblyVerificationReportRun) {
  if (run.measurementSource === "csv") return `CSV${run.measurementSourceLabel ? ` · ${run.measurementSourceLabel}` : ""}${run.measurementSampleCount !== undefined ? ` · 원본 기록 ${run.measurementSampleCount}개` : ""}${run.measurementSeriesPointCount !== undefined ? ` · 온도 기록 ${run.measurementSeriesPointCount}개` : ""}`;
  if (run.measurementSource === "manual") return "직접 입력";
  return "출처 기록 없음";
}

function continuityText(run: AssemblyVerificationReportRun) {
  const continuity = run.measurementQuality?.continuity;
  if (!continuity) return "연속성 기록 없음";
  const status = continuity.status === "continuous" ? "연속" : continuity.status === "gapped" ? "중간 누락" : "확인 불가";
  return `시간 기록 ${status} · 기록 시각 ${continuity.timestampCount}개 · 읽지 못한 시각 ${continuity.unparsedTimestampCount}개 · 누락 구간 ${continuity.gapCount}곳 · 빠진 것으로 보이는 기록 ${continuity.estimatedMissingSamples}개`;
}

function reportLabelText(value: string) {
  return value
    .replace(/^(.*?)(\d+)회차$/, (_, label: string, index: string) => `${label.trim()} · 측정 기록 ${index}`)
    .replaceAll("회차", "측정 기록")
    .replaceAll("runId", "기록 ID")
    .replaceAll("timestamp", "시간 기록")
    .replaceAll("시간축", "시간 기록")
    .replaceAll("델타", "측정값 차이");
}

function reportRunHeading(run: Pick<AssemblyVerificationReportRun, "index" | "runLabel">) {
  const label = reportLabelText(run.runLabel);
  return label.includes("측정 기록") ? label : `측정 기록 ${run.index}: ${label}`;
}

function measurementQualityLabel(status: NonNullable<AssemblyVerificationReportRun["measurementQuality"]>["status"]) {
  return status === "complete" ? "자료 충분" : status === "partial" ? "일부 자료" : "자료 확인 필요";
}

function decisionStatusLabel(status: NonNullable<AssemblyVerificationReport["decisionSummary"]>["status"]) {
  return status === "improved" ? "개선 관찰" : status === "recheck" ? "다시 확인 필요" : status === "unchanged" ? "큰 변화 없음" : "비교할 자료 부족";
}

function decisionDimensionStatusLabel(status: NonNullable<AssemblyVerificationReport["decisionSummary"]>["dimensions"][number]["status"]) {
  return status === "improved" ? "개선 관찰" : status === "recheck" ? "다시 확인 필요" : status === "unchanged" ? "변화 없음" : status === "observational-lower" ? "더 낮게 관찰" : status === "observational-higher" ? "더 높게 관찰" : "비교 정보 없음";
}

function comparisonBlockReasonText(reason: AssemblyVerificationReportRun["comparisonBlockReason"]) {
  return reason === "condition-changed" ? "조건 변경" : reason === "condition-missing" ? "조건 기록 없음" : reason === "measurement-quality-review" ? "측정 자료 확인 필요" : reason === "measurement-continuity-gapped" ? "시간 기록 누락·역순" : undefined;
}

function telemetryTrendLabel(trend: AssemblyVerificationTelemetryMetricAnalysis["trend"]) {
  return trend === "rising" ? "상승" : trend === "falling" ? "하락" : trend === "unchanged" ? "변화 없음" : "측정값 부족";
}

function telemetrySuffix(metric: AssemblyVerificationTelemetryMetricAnalysis["metric"]) {
  return metric.endsWith("TempC") ? "°C" : metric.endsWith("Percent") ? "%" : metric.endsWith("MHz") ? "MHz" : metric.endsWith("PowerW") ? "W" : "RPM";
}

function telemetryAnalysisTextForMetric(analysis: AssemblyVerificationTelemetryMetricAnalysis) {
  const suffix = telemetrySuffix(analysis.metric);
  const delta = `${analysis.delta > 0 ? "+" : ""}${analysis.delta}${suffix}`;
  const rate = analysis.ratePerMinute !== undefined ? ` · 변화율 ${analysis.ratePerMinute > 0 ? "+" : ""}${analysis.ratePerMinute}${suffix}/분` : "";
  const peakAt = analysis.peakAtSeconds !== undefined ? ` · 최고점 ${analysis.peakAtSeconds}초` : "";
  const window = analysis.finalWindowSpread !== undefined ? ` · 마지막 3점 범위 ${analysis.finalWindowSpread}${suffix}` : "";
  return `${telemetryTrendLabel(analysis.trend)} · 시작 ${analysis.first}${suffix} → 종료 ${analysis.last}${suffix} · 변화 ${delta}${rate}${peakAt}${window}`;
}

function telemetryAnalysisText(analysis: AssemblyVerificationTelemetryAnalysis) {
  const metrics = [analysis.metrics.cpuTempC, analysis.metrics.gpuTempC].filter((metric): metric is AssemblyVerificationTelemetryMetricAnalysis => Boolean(metric));
  const observed = metrics.length > 0 ? metrics.map((metric) => `${metric.metric === "cpuTempC" ? "CPU" : "GPU"} ${telemetryAnalysisTextForMetric(metric)}`).join(" · ") : "비교할 온도 기록 부족";
  return `${observed}${analysis.elapsedSeconds !== undefined ? ` · 관찰 ${analysis.elapsedSeconds}초` : " · 시간축 기록 없음"}`;
}

function telemetryContextText(analysis: AssemblyVerificationTelemetryAnalysis) {
  const entries: Array<[keyof AssemblyVerificationTelemetryAnalysis["metrics"], string]> = [["cpuUsagePercent", "CPU 사용률"], ["gpuUsagePercent", "GPU 사용률"], ["cpuClockMHz", "CPU 클럭"], ["gpuClockMHz", "GPU 클럭"], ["cpuPowerW", "CPU 전력"], ["gpuPowerW", "GPU 전력"]];
  const values = entries.map(([metric, label]) => {
    const value = analysis.metrics[metric];
    return value ? `${label} 평균 ${value.mean}${telemetrySuffix(value.metric)} · 최고 ${value.max}${telemetrySuffix(value.metric)}` : undefined;
  }).filter((value): value is string => Boolean(value));
  return values.length > 0 ? values.join(" · ") : "추가 센서 기록 없음";
}

function telemetryAnalysisTextForCsv(analysis: AssemblyVerificationTelemetryMetricAnalysis) {
  return telemetryTrendLabel(analysis.trend);
}

function loadProfileText(profile: AssemblyVerificationLoadProfile) {
  if (profile.reason === "usage-not-recorded") return "사용률 센서 기록 없음";
  const segments = profile.segments.map((segment) => `${segment.breakBefore === "gap" ? `공백 ${segment.gapBeforeSeconds ?? "-"}초 후 ` : segment.breakBefore === "non-monotonic" ? "시간 역순 후 " : ""}${segment.label} ${segment.pointCount}점`).join(" → ");
  const stability = profile.segments.flatMap((segment) => [segment.cpuTempStability ? `CPU 안정화 ${segment.cpuTempStability.stabilized ? "확인" : "미확인"}` : undefined, segment.gpuTempStability ? `GPU 안정화 ${segment.gpuTempStability.stabilized ? "확인" : "미확인"}` : undefined]).filter((value): value is string => Boolean(value));
  return `${segments || "구간 없음"} · 사용률 기록 ${profile.usageCoveragePercent}% · 분류되지 않은 기록 ${profile.unclassifiedPointCount}개${stability.length > 0 ? ` · ${stability.join(" · ")}` : ""}`;
}

function loadProfileComparisonText(comparison: AssemblyVerificationLoadProfileComparison) {
  if (comparison.reason === "reference-condition-missing") return "부하 조건 미완성으로 비교 불가";
  if (comparison.reason === "different-condition") return "이전 측정 기록의 부하 조건이 달라 비교하지 않음";
  if (comparison.reason === "measurement-continuity-gapped") return "시간 기록이 끊기거나 역순이라 비교하지 않음";
  if (comparison.reason === "measurement-quality-review") return "측정 자료를 더 확인해야 해 비교하지 않음";
  if (comparison.reason === "no-previous-run") return "같은 조건의 이전 측정 기록 없음";
  if (comparison.reason === "profile-missing") return "사용률 기록 없음";
  const segments = comparison.segments.map((segment) => `${segment.label}${segment.occurrenceIndex > 0 ? ` ${segment.occurrenceIndex + 1}` : ""}: ${[segment.cpuTempLastDelta === undefined ? undefined : `CPU 종료 ${segment.cpuTempLastDelta > 0 ? "+" : ""}${segment.cpuTempLastDelta}°C`, segment.gpuTempLastDelta === undefined ? undefined : `GPU 종료 ${segment.gpuTempLastDelta > 0 ? "+" : ""}${segment.gpuTempLastDelta}°C`, segment.cpuPowerMeanDelta === undefined ? undefined : `CPU 전력 ${segment.cpuPowerMeanDelta > 0 ? "+" : ""}${segment.cpuPowerMeanDelta}W`, segment.gpuPowerMeanDelta === undefined ? undefined : `GPU 전력 ${segment.gpuPowerMeanDelta > 0 ? "+" : ""}${segment.gpuPowerMeanDelta}W`].filter((value): value is string => Boolean(value)).join(" · ") || "공통 측정값 없음"}`).join(" | ");
  return `${comparison.previousRunLabel ? reportLabelText(comparison.previousRunLabel) : "이전 측정 기록"} · ${segments || "비교 구간 없음"}`;
}

function telemetryOverlayText(overlay: AssemblyVerificationTelemetryOverlay) {
  if (overlay.reason === "reference-condition-missing") return "기준이 되는 부하 조건을 기록하지 않아 비교할 수 없습니다.";
  if (overlay.reason === "no-matching-run-series") return "같은 조건의 온도 기록이 없어 비교할 수 없습니다.";
  const runs = overlay.runs.map((run) => `${reportLabelText(run.runLabel)}: CPU 최고 ${run.cpuTempPeak === undefined ? "-" : `${run.cpuTempPeak}°C`} · GPU 최고 ${run.gpuTempPeak === undefined ? "-" : `${run.gpuTempPeak}°C`}`).join(" | ");
  return `${overlay.runCount}개 측정 기록 · ${runs || "기록 없음"}`;
}

function reportOverlayCountText(overlay: AssemblyVerificationTelemetryOverlay | undefined) {
  return overlay && overlay.runCount > 0 ? `${overlay.runCount}개` : "없음";
}

export function assemblyVerificationReportFor(history: AssemblyVerificationHistory, filter: AssemblyVerificationComparisonFilter = "all", referenceRunId = history.activeRunId, generatedAt = new Date().toISOString(), overlayIncludedRunIds?: string[]): AssemblyVerificationReport {
  const comparison = assemblyVerificationComparisonFor(history, filter, referenceRunId);
  const telemetryOverlay = assemblyVerificationTelemetryOverlayFor(history, referenceRunId, overlayIncludedRunIds ? { includedRunIds: overlayIncludedRunIds } : {});
  const reviewOverlayCandidate = assemblyVerificationTelemetryOverlayFor(history, referenceRunId, { ...(overlayIncludedRunIds ? { includedRunIds: overlayIncludedRunIds } : {}), includeReviewQuality: true });
  const qualityOverlay = reviewOverlayCandidate.runs.filter((run) => run.measurementQualityStatus === "review" || run.measurementContinuityStatus === "gapped").length > 0
    ? { ...reviewOverlayCandidate, runs: reviewOverlayCandidate.runs.filter((run) => run.measurementQualityStatus === "review" || run.measurementContinuityStatus === "gapped"), runCount: reviewOverlayCandidate.runs.filter((run) => run.measurementQualityStatus === "review" || run.measurementContinuityStatus === "gapped").length }
    : undefined;
  const comparisonSummary = assemblyVerificationComparisonSummaryFor(history, referenceRunId, overlayIncludedRunIds);
  const decisionSummary = assemblyVerificationDecisionSummaryFor(comparisonSummary);
  const byRunId = new Map(history.runs.map((run) => [run.runId, run]));
  const runs = comparison.points.map((point) => {
    const run = byRunId.get(point.runId);
    return {
      ...point,
      ...(run?.measurementSource ? { measurementSource: run.measurementSource } : {}),
      ...(run?.measurementSourceLabel ? { measurementSourceLabel: run.measurementSourceLabel } : {}),
      ...(run?.measurementSampleCount !== undefined ? { measurementSampleCount: run.measurementSampleCount } : {}),
      ...(run?.measurementQuality ? { measurementQuality: run.measurementQuality } : {}),
      ...(run?.measurementSeries && run.measurementSeries.length > 0 ? { measurementSeriesPointCount: run.measurementSeries.length, telemetryAnalysis: assemblyVerificationTelemetryAnalysisFor(run.measurementSeries), loadProfile: assemblyVerificationLoadProfileFor(run.measurementSeries, run.measurementQuality?.continuity?.gapToleranceSeconds), loadProfileComparison: assemblyVerificationLoadProfileComparisonFor(history, filter, point.runId) } : {})
    };
  });
  return {
    type: "pc-supporter-assembly-verification-report",
    schemaVersion: 1,
    generatedAt,
    filter,
    ...(comparison.referenceRunId ? { referenceRunId: comparison.referenceRunId } : {}),
    runs,
    signals: assemblyVerificationRecheckSignalsFor(comparison),
    telemetryOverlay,
    ...(qualityOverlay ? { qualityOverlay } : {}),
    comparisonSummary,
    decisionSummary
  };
}

export function assemblyVerificationReportTextFor(report: AssemblyVerificationReport) {
  const lines = [
    "# 조립 후 측정 기록",
    "",
    `생성 시각: ${report.generatedAt}`,
    `비교 범위: ${report.filter === "same-load" ? "같은 부하 조건" : "전체 측정 기록"}`,
    `측정 기록 수: ${report.runs.length}`,
    `추가로 확인할 내용: ${report.signals.length}개`,
    ""
  ];
  if (report.signals.length > 0) {
    lines.push("## 추가로 확인할 내용", "");
    for (const signal of report.signals) {
      const relatedRuns = signal.runIds.map((runId) => report.runs.find((run) => run.runId === runId)).filter((run): run is AssemblyVerificationReportRun => Boolean(run));
      const relatedLabels = relatedRuns.map(reportRunHeading).join(", ");
      lines.push(`- ${reportLabelText(signal.title)}: ${reportLabelText(signal.summary)}`, `  - 확인 내용: ${reportLabelText(signal.evidence)}`, `  - 해당 측정 기록: ${relatedLabels || "기록 없음"}`);
    }
    lines.push("");
  }
  lines.push("## 측정 기록", "");
  for (const run of report.runs) {
    const condition = [toolLabel(run.loadTool), scenarioLabel(run.loadScenario), run.testDurationMinutes !== undefined ? `${run.testDurationMinutes}분` : "시간 기록 없음"].join(" · ");
    lines.push(
      `### ${reportRunHeading(run)}`,
      `- 상태: ${assemblyVerificationStateLabel(run.state)}`,
      `- 조건: ${condition}`,
      `- CPU: ${metricText(run.cpuMaxTempC, "°C")} · 주변 ${metricText(run.ambientTempC, "°C")} · 보정 ${metricText(run.cpuAmbientAdjustedC, "°C")} · 직전 대비 ${signedMetricText(run.cpuDeltaC, "°C")} · 보정 대비 ${signedMetricText(run.cpuAmbientAdjustedDeltaC, "°C")}`,
      `- GPU: ${metricText(run.gpuMaxTempC, "°C")} · 보정 ${metricText(run.gpuAmbientAdjustedC, "°C")} · 직전 대비 ${signedMetricText(run.gpuDeltaC, "°C")} · 보정 대비 ${signedMetricText(run.gpuAmbientAdjustedDeltaC, "°C")}`,
      `- 팬: CPU ${metricText(run.cpuFanRpm, "RPM")} · GPU ${metricText(run.gpuFanRpm, "RPM")} · 소음 ${noiseLabel(run.noiseLevel)}`,
      `- 측정 출처: ${sourceText(run)}`,
      ...(run.measurementQuality ? [`- 측정 자료: ${measurementQualityLabel(run.measurementQuality.status)} · 읽은 행 ${run.measurementQuality.validSampleCount}/${run.measurementQuality.rowCount} · 기본 센서 ${run.measurementQuality.recognizedCoreColumnCount}/${run.measurementQuality.coreColumnCount} · 추가 센서 ${run.measurementQuality.telemetryColumnCount}개 · 시간 기록 ${run.measurementQuality.hasTimeAxis ? "있음" : "없음"} · ${continuityText(run)}`] : []),
      ...(run.telemetryAnalysis ? [`- 온도 변화: ${telemetryAnalysisText(run.telemetryAnalysis)}`] : []),
      ...(run.telemetryAnalysis ? [`- 부하 맥락: ${telemetryContextText(run.telemetryAnalysis)}`] : []),
      ...(run.loadProfile ? [`- 부하 구간: ${loadProfileText(run.loadProfile)}`] : []),
      ...(run.loadProfileComparison ? [`- 이전 동일 조건 비교: ${loadProfileComparisonText(run.loadProfileComparison)}`] : []),
      `- 비교 가능: ${run.comparableToPrevious === false ? `아니오 · ${comparisonBlockReasonText(run.comparisonBlockReason) ?? "비교 제외"}` : run.comparableToPrevious ? "예" : "기준 기록"}`,
      ""
    );
  }
  if (report.runs.length === 0) lines.push("저장된 측정 기록이 없습니다.", "");
  if (report.telemetryOverlay) {
    lines.push("## 같은 조건 측정값 비교", "", `- ${telemetryOverlayText(report.telemetryOverlay)}`, "- 측정 시간의 길이가 달라도 진행률을 맞춰 기록별 온도 변화를 비교합니다.", "");
  }
  if (report.qualityOverlay) {
    const runs = report.qualityOverlay.runs.map((run) => `${reportLabelText(run.runLabel)}: ${run.measurementContinuityStatus === "gapped" ? "시간 기록 누락·역순" : "측정 자료 확인 필요"}`).join(" | ");
    lines.push("## 측정 자료를 더 확인할 기록", "", `- ${report.qualityOverlay.runCount}개 · ${runs || "기록 없음"}`, "- 누락된 시간 기록은 선을 이어 표시하지 않습니다. 해당 기록은 온도 차이 계산과 종합 요약에서 제외했습니다.", "");
  }
  if (report.decisionSummary) {
    lines.push("## 측정 결과 요약", "", `- 결과: ${decisionStatusLabel(report.decisionSummary.status)}`, `- 권장 안내: ${report.decisionSummary.nextAction}`);
    for (const dimension of report.decisionSummary.dimensions) lines.push(`- ${dimension.title}: ${dimension.summary} · ${decisionDimensionStatusLabel(dimension.status)}`);
    lines.push("");
  }
  lines.push("참고: 실제 측정값과 알림은 입력하거나 가져온 자료를 바탕으로 한 관찰 결과입니다. 제조사 보증이나 안전 인증, 고장 판정은 아닙니다.");
  return lines.join("\n");
}

function csvCell(value: string | number | boolean | undefined) {
  const raw = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function assemblyVerificationReportCsvFor(report: AssemblyVerificationReport) {
  const header = ["기록 번호", "기록 이름", "기록 ID", "상태", "부하 도구", "부하 시나리오", "테스트 시간(분)", "주변 온도(°C)", "CPU 최고(°C)", "GPU 최고(°C)", "CPU 보정(°C)", "GPU 보정(°C)", "Δ CPU(°C)", "Δ GPU(°C)", "Δ CPU 보정(°C)", "Δ GPU 보정(°C)", "CPU 팬(RPM)", "GPU 팬(RPM)", "소음", "측정 출처", "측정 자료 상태", "읽은 행", "기본 센서", "추가 센서", "시간 기록", "시간 기록 연속성", "누락 구간", "빠진 것으로 보이는 기록", "제외 행", "오류 셀", "원본 기록 수", "시간별 기록 수", "CPU 온도 변화", "GPU 온도 변화", "CPU 변화율(°C/분)", "GPU 변화율(°C/분)", "CPU 사용률 평균(%)", "GPU 사용률 평균(%)", "CPU 클럭 평균(MHz)", "GPU 클럭 평균(MHz)", "CPU 전력 평균(W)", "GPU 전력 평균(W)", "부하 구간 요약", "사용률 자료 비율(%)", "확인이 필요한 지점", "안정화 관찰", "이전 동일 조건 비교", "겹쳐 본 기록 수", "자료 확인 기록 수", "비교 결과", "권장 안내", "비교에서 제외한 이유", "비교 가능"];
  const rows = report.runs.map((run) => [
    run.index,
    run.runLabel,
    run.runId,
    assemblyVerificationStateLabel(run.state),
    toolLabel(run.loadTool),
    scenarioLabel(run.loadScenario),
    run.testDurationMinutes,
    run.ambientTempC,
    run.cpuMaxTempC,
    run.gpuMaxTempC,
    run.cpuAmbientAdjustedC,
    run.gpuAmbientAdjustedC,
    run.cpuDeltaC,
    run.gpuDeltaC,
    run.cpuAmbientAdjustedDeltaC,
    run.gpuAmbientAdjustedDeltaC,
    run.cpuFanRpm,
    run.gpuFanRpm,
    noiseLabel(run.noiseLevel),
    sourceText(run),
    run.measurementQuality ? measurementQualityLabel(run.measurementQuality.status) : undefined,
    run.measurementQuality ? `${run.measurementQuality.validSampleCount}/${run.measurementQuality.rowCount}` : undefined,
    run.measurementQuality ? `${run.measurementQuality.recognizedCoreColumnCount}/${run.measurementQuality.coreColumnCount}` : undefined,
    run.measurementQuality?.telemetryColumnCount,
    run.measurementQuality?.hasTimeAxis === undefined ? undefined : run.measurementQuality.hasTimeAxis ? "있음" : "없음",
    run.measurementQuality?.continuity ? continuityText(run) : undefined,
    run.measurementQuality?.continuity?.gapCount,
    run.measurementQuality?.continuity?.estimatedMissingSamples,
    run.measurementQuality?.skippedRowCount,
    run.measurementQuality?.invalidValueCount,
    run.measurementSampleCount,
    run.measurementSeriesPointCount,
    run.telemetryAnalysis?.metrics.cpuTempC ? telemetryAnalysisTextForCsv(run.telemetryAnalysis.metrics.cpuTempC) : undefined,
    run.telemetryAnalysis?.metrics.gpuTempC ? telemetryAnalysisTextForCsv(run.telemetryAnalysis.metrics.gpuTempC) : undefined,
    run.telemetryAnalysis?.metrics.cpuTempC?.ratePerMinute,
    run.telemetryAnalysis?.metrics.gpuTempC?.ratePerMinute,
    run.telemetryAnalysis?.metrics.cpuUsagePercent?.mean,
    run.telemetryAnalysis?.metrics.gpuUsagePercent?.mean,
    run.telemetryAnalysis?.metrics.cpuClockMHz?.mean,
    run.telemetryAnalysis?.metrics.gpuClockMHz?.mean,
    run.telemetryAnalysis?.metrics.cpuPowerW?.mean,
    run.telemetryAnalysis?.metrics.gpuPowerW?.mean,
    run.loadProfile ? loadProfileText(run.loadProfile) : undefined,
    run.loadProfile?.usageCoveragePercent,
    run.loadProfile?.unclassifiedPointCount,
    run.loadProfile ? run.loadProfile.segments.flatMap((segment) => [segment.cpuTempStability ? `CPU ${segment.cpuTempStability.stabilized ? "안정화 확인" : "안정화 미확인"}` : undefined, segment.gpuTempStability ? `GPU ${segment.gpuTempStability.stabilized ? "안정화 확인" : "안정화 미확인"}` : undefined]).filter((value): value is string => Boolean(value)).join(" · ") : undefined,
    run.loadProfileComparison ? loadProfileComparisonText(run.loadProfileComparison) : undefined,
    run.telemetryAnalysis ? reportOverlayCountText(report.telemetryOverlay) : undefined,
    run.telemetryAnalysis ? reportOverlayCountText(report.qualityOverlay) : undefined,
    report.decisionSummary ? decisionStatusLabel(report.decisionSummary.status) : undefined,
    report.decisionSummary?.nextAction,
    comparisonBlockReasonText(run.comparisonBlockReason),
    run.comparableToPrevious === undefined ? "기준" : run.comparableToPrevious ? "예" : "아니오"
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map((value) => csvCell(value)).join(",")).join("\r\n")}\r\n`;
}

export function assemblyVerificationReportJsonFor(report: AssemblyVerificationReport) {
  return JSON.stringify(report, null, 2);
}
