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
  if (run.measurementSource === "csv") return `CSV${run.measurementSourceLabel ? ` · ${run.measurementSourceLabel}` : ""}${run.measurementSampleCount !== undefined ? ` · 원본 ${run.measurementSampleCount}샘플` : ""}${run.measurementSeriesPointCount !== undefined ? ` · 시계열 ${run.measurementSeriesPointCount}점` : ""}`;
  if (run.measurementSource === "manual") return "직접 입력";
  return "출처 미기록";
}

function continuityText(run: AssemblyVerificationReportRun) {
  const continuity = run.measurementQuality?.continuity;
  if (!continuity) return "연속성 미기록";
  const status = continuity.status === "continuous" ? "연속" : continuity.status === "gapped" ? "공백 있음" : "확인 불가";
  return `시간축 연속성 ${status} · timestamp ${continuity.timestampCount}개 · 해석 실패 ${continuity.unparsedTimestampCount}개 · 공백 ${continuity.gapCount}개 · 예상 누락 ${continuity.estimatedMissingSamples}개`;
}

function comparisonBlockReasonText(reason: AssemblyVerificationReportRun["comparisonBlockReason"]) {
  return reason === "condition-changed" ? "조건 변경" : reason === "condition-missing" ? "조건 미기록" : reason === "measurement-quality-review" ? "측정 품질 확인" : reason === "measurement-continuity-gapped" ? "시간축 공백·역순" : undefined;
}

function telemetryTrendLabel(trend: AssemblyVerificationTelemetryMetricAnalysis["trend"]) {
  return trend === "rising" ? "상승" : trend === "falling" ? "하락" : trend === "unchanged" ? "변화 없음" : "샘플 부족";
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
  const observed = metrics.length > 0 ? metrics.map((metric) => `${metric.metric === "cpuTempC" ? "CPU" : "GPU"} ${telemetryAnalysisTextForMetric(metric)}`).join(" · ") : "온도 시계열 샘플 부족";
  return `${observed}${analysis.elapsedSeconds !== undefined ? ` · 관찰 ${analysis.elapsedSeconds}초` : " · 시간축 미기록"}`;
}

function telemetryContextText(analysis: AssemblyVerificationTelemetryAnalysis) {
  const entries: Array<[keyof AssemblyVerificationTelemetryAnalysis["metrics"], string]> = [["cpuUsagePercent", "CPU 사용률"], ["gpuUsagePercent", "GPU 사용률"], ["cpuClockMHz", "CPU 클럭"], ["gpuClockMHz", "GPU 클럭"], ["cpuPowerW", "CPU 전력"], ["gpuPowerW", "GPU 전력"]];
  const values = entries.map(([metric, label]) => {
    const value = analysis.metrics[metric];
    return value ? `${label} 평균 ${value.mean}${telemetrySuffix(value.metric)} · 최고 ${value.max}${telemetrySuffix(value.metric)}` : undefined;
  }).filter((value): value is string => Boolean(value));
  return values.length > 0 ? values.join(" · ") : "추가 부하 센서 미기록";
}

function telemetryAnalysisTextForCsv(analysis: AssemblyVerificationTelemetryMetricAnalysis) {
  return telemetryTrendLabel(analysis.trend);
}

function loadProfileText(profile: AssemblyVerificationLoadProfile) {
  if (profile.reason === "usage-not-recorded") return "사용률 센서 미기록";
  const segments = profile.segments.map((segment) => `${segment.breakBefore === "gap" ? `공백 ${segment.gapBeforeSeconds ?? "-"}초 후 ` : segment.breakBefore === "non-monotonic" ? "시간 역순 후 " : ""}${segment.label} ${segment.pointCount}점`).join(" → ");
  const stability = profile.segments.flatMap((segment) => [segment.cpuTempStability ? `CPU 안정화 ${segment.cpuTempStability.stabilized ? "확인" : "미확인"}` : undefined, segment.gpuTempStability ? `GPU 안정화 ${segment.gpuTempStability.stabilized ? "확인" : "미확인"}` : undefined]).filter((value): value is string => Boolean(value));
  return `${segments || "구간 없음"} · 커버리지 ${profile.usageCoveragePercent}% · 미분류 ${profile.unclassifiedPointCount}점${stability.length > 0 ? ` · ${stability.join(" · ")}` : ""}`;
}

function loadProfileComparisonText(comparison: AssemblyVerificationLoadProfileComparison) {
  if (comparison.reason === "reference-condition-missing") return "부하 조건 미완성으로 비교 불가";
  if (comparison.reason === "different-condition") return "이전 회차의 부하 조건이 달라 비교하지 않음";
  if (comparison.reason === "measurement-continuity-gapped") return "측정 시간축 공백·역순 때문에 비교하지 않음";
  if (comparison.reason === "measurement-quality-review") return "측정 품질 확인 필요로 비교하지 않음";
  if (comparison.reason === "no-previous-run") return "같은 조건의 이전 회차 없음";
  if (comparison.reason === "profile-missing") return "사용률 시계열 없음";
  const segments = comparison.segments.map((segment) => `${segment.label}${segment.occurrenceIndex > 0 ? ` ${segment.occurrenceIndex + 1}` : ""}: ${[segment.cpuTempLastDelta === undefined ? undefined : `CPU 종료 ${segment.cpuTempLastDelta > 0 ? "+" : ""}${segment.cpuTempLastDelta}°C`, segment.gpuTempLastDelta === undefined ? undefined : `GPU 종료 ${segment.gpuTempLastDelta > 0 ? "+" : ""}${segment.gpuTempLastDelta}°C`, segment.cpuPowerMeanDelta === undefined ? undefined : `CPU 전력 ${segment.cpuPowerMeanDelta > 0 ? "+" : ""}${segment.cpuPowerMeanDelta}W`, segment.gpuPowerMeanDelta === undefined ? undefined : `GPU 전력 ${segment.gpuPowerMeanDelta > 0 ? "+" : ""}${segment.gpuPowerMeanDelta}W`].filter((value): value is string => Boolean(value)).join(" · ") || "공통 측정값 없음"}`).join(" | ");
  return `${comparison.previousRunLabel ?? "이전 회차"} · ${segments || "비교 구간 없음"}`;
}

function telemetryOverlayText(overlay: AssemblyVerificationTelemetryOverlay) {
  if (overlay.reason === "reference-condition-missing") return "부하 조건 미완성으로 overlay 불가";
  if (overlay.reason === "no-matching-run-series") return "비교 가능한 시계열 없음";
  const runs = overlay.runs.map((run) => `${run.runLabel}: CPU 최고 ${run.cpuTempPeak === undefined ? "-" : `${run.cpuTempPeak}°C`} · GPU 최고 ${run.gpuTempPeak === undefined ? "-" : `${run.gpuTempPeak}°C`}`).join(" | ");
  return `${overlay.runCount}회차 · ${runs || "회차 없음"}`;
}

function reportOverlayCountText(overlay: AssemblyVerificationTelemetryOverlay | undefined) {
  return overlay && overlay.runCount > 0 ? `${overlay.runCount}회차` : "없음";
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
    "# PC Supporter 실측 리포트",
    "",
    `생성 시각: ${report.generatedAt}`,
    `비교 범위: ${report.filter === "same-load" ? "같은 부하 조건" : "전체 회차"}`,
    `회차 수: ${report.runs.length}`,
    `재확인 신호: ${report.signals.length}개`,
    ""
  ];
  if (report.signals.length > 0) {
    lines.push("## 재확인 신호", "");
    for (const signal of report.signals) {
      lines.push(`- ${signal.title}: ${signal.summary}`, `  - 근거: ${signal.evidence}`, `  - 해당 회차: ${signal.runIds.join(", ")}`);
    }
    lines.push("");
  }
  lines.push("## 회차별 측정", "");
  for (const run of report.runs) {
    const condition = [toolLabel(run.loadTool), scenarioLabel(run.loadScenario), run.testDurationMinutes !== undefined ? `${run.testDurationMinutes}분` : "시간 미기록"].join(" · ");
    lines.push(
      `### ${run.index}. ${run.runLabel}`,
      `- 상태: ${assemblyVerificationStateLabel(run.state)}`,
      `- 조건: ${condition}`,
      `- CPU: ${metricText(run.cpuMaxTempC, "°C")} · 주변 ${metricText(run.ambientTempC, "°C")} · 보정 ${metricText(run.cpuAmbientAdjustedC, "°C")} · 직전 대비 ${signedMetricText(run.cpuDeltaC, "°C")} · 보정 대비 ${signedMetricText(run.cpuAmbientAdjustedDeltaC, "°C")}`,
      `- GPU: ${metricText(run.gpuMaxTempC, "°C")} · 보정 ${metricText(run.gpuAmbientAdjustedC, "°C")} · 직전 대비 ${signedMetricText(run.gpuDeltaC, "°C")} · 보정 대비 ${signedMetricText(run.gpuAmbientAdjustedDeltaC, "°C")}`,
      `- 팬: CPU ${metricText(run.cpuFanRpm, "RPM")} · GPU ${metricText(run.gpuFanRpm, "RPM")} · 소음 ${noiseLabel(run.noiseLevel)}`,
      `- 측정 출처: ${sourceText(run)}`,
      ...(run.measurementQuality ? [`- 측정 입력 품질: ${run.measurementQuality.status} · 유효 ${run.measurementQuality.validSampleCount}/${run.measurementQuality.rowCount}행 · 기본 센서 ${run.measurementQuality.recognizedCoreColumnCount}/${run.measurementQuality.coreColumnCount} · 추가 ${run.measurementQuality.telemetryColumnCount}개 · 시간축 ${run.measurementQuality.hasTimeAxis ? "있음" : "없음"} · ${continuityText(run)}`] : []),
      ...(run.telemetryAnalysis ? [`- 시계열 관찰: ${telemetryAnalysisText(run.telemetryAnalysis)}`] : []),
      ...(run.telemetryAnalysis ? [`- 부하 맥락: ${telemetryContextText(run.telemetryAnalysis)}`] : []),
      ...(run.loadProfile ? [`- 부하 구간: ${loadProfileText(run.loadProfile)}`] : []),
      ...(run.loadProfileComparison ? [`- 이전 동일 조건 비교: ${loadProfileComparisonText(run.loadProfileComparison)}`] : []),
      `- 비교 가능: ${run.comparableToPrevious === false ? `아니오 · ${comparisonBlockReasonText(run.comparisonBlockReason) ?? "비교 제외"}` : run.comparableToPrevious ? "예" : "기준 회차"}`,
      ""
    );
  }
  if (report.runs.length === 0) lines.push("기록된 회차가 없습니다.", "");
  if (report.telemetryOverlay) {
    lines.push("## 동일 조건 시계열 겹쳐보기", "", `- ${telemetryOverlayText(report.telemetryOverlay)}`, "- 각 회차의 시계열을 0~100% 진행률로 정규화해 겹쳐 봅니다.", "");
  }
  if (report.qualityOverlay) {
    const runs = report.qualityOverlay.runs.map((run) => `${run.runLabel}: ${run.measurementContinuityStatus === "gapped" ? "시간축 공백/역순" : "측정 품질 확인"}`).join(" | ");
    lines.push("## 품질 이슈 회차 검토용 overlay", "", `- ${report.qualityOverlay.runCount}회차 · ${runs || "회차 없음"}`, "- 공백 전·후 선을 단절해 표시하며 정상 델타·결정 요약에는 사용하지 않습니다.", "");
  }
  if (report.decisionSummary) {
    const statusLabel = report.decisionSummary.status === "improved" ? "개선 관찰" : report.decisionSummary.status === "recheck" ? "재확인 필요" : report.decisionSummary.status === "unchanged" ? "변화 없음" : "비교 불충분";
    lines.push("## 실측 결정 요약", "", `- 상태: ${statusLabel}`, `- 다음 행동: ${report.decisionSummary.nextAction}`);
    for (const dimension of report.decisionSummary.dimensions) lines.push(`- ${dimension.title}: ${dimension.summary} · ${dimension.status}`);
    lines.push("");
  }
  lines.push("주의: 이 리포트의 실측값과 신호는 입력·가져온 데이터의 관찰 결과이며, 제조사 보증·안전 인증·고장 확정이 아닙니다.");
  return lines.join("\n");
}

function csvCell(value: string | number | boolean | undefined) {
  const raw = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function assemblyVerificationReportCsvFor(report: AssemblyVerificationReport) {
  const header = ["회차", "회차 이름", "runId", "상태", "부하 도구", "부하 시나리오", "테스트 시간(분)", "주변 온도(°C)", "CPU 최고(°C)", "GPU 최고(°C)", "CPU 보정(°C)", "GPU 보정(°C)", "Δ CPU(°C)", "Δ GPU(°C)", "Δ CPU 보정(°C)", "Δ GPU 보정(°C)", "CPU 팬(RPM)", "GPU 팬(RPM)", "소음", "측정 출처", "측정 입력 품질", "유효 행", "기본 센서", "추가 센서", "시간축", "시간축 연속성", "측정 공백", "예상 누락", "제외 행", "오류 셀", "원본 샘플 수", "시계열 포인트", "CPU 시계열 관찰", "GPU 시계열 관찰", "CPU 변화율(°C/분)", "GPU 변화율(°C/분)", "CPU 사용률 평균(%)", "GPU 사용률 평균(%)", "CPU 클럭 평균(MHz)", "GPU 클럭 평균(MHz)", "CPU 전력 평균(W)", "GPU 전력 평균(W)", "부하 구간 요약", "사용률 커버리지(%)", "미분류 포인트", "안정화 관찰", "이전 동일 조건 비교", "overlay 회차 수", "품질 검토 overlay 회차 수", "결정 상태", "결정 다음 행동", "비교 제외 사유", "비교 가능"];
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
    run.measurementQuality?.status,
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
    report.decisionSummary?.status,
    report.decisionSummary?.nextAction,
    comparisonBlockReasonText(run.comparisonBlockReason),
    run.comparableToPrevious === undefined ? "기준" : run.comparableToPrevious ? "예" : "아니오"
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map((value) => csvCell(value)).join(",")).join("\r\n")}\r\n`;
}

export function assemblyVerificationReportJsonFor(report: AssemblyVerificationReport) {
  return JSON.stringify(report, null, 2);
}
