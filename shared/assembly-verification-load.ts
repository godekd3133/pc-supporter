import type { AssemblyVerificationComparisonFilter, AssemblyVerificationHistory, AssemblyVerificationTelemetryMetric, AssemblyVerificationTelemetryPoint } from "./assembly-verification";
import { assemblyVerificationComparisonFor, assemblyVerificationTelemetrySegmentsFor } from "./assembly-verification";

export const ASSEMBLY_VERIFICATION_LOAD_PROFILE_THRESHOLDS = {
  idleMaxPercent: 20,
  highMinPercent: 70,
  lowMaxPercent: 40,
  stabilityWindowC: 2,
  stabilityMinPoints: 3
} as const;

export type AssemblyVerificationLoadKind = "unknown" | "idle" | "cpu" | "gpu" | "mixed" | "partial";

export type AssemblyVerificationLoadSegmentStability = {
  metric: "cpuTempC" | "gpuTempC";
  stabilized: boolean;
  windowPointCount: number;
  windowSpreadC: number;
  stabilizedAfterSeconds?: number;
};

export type AssemblyVerificationLoadSegment = {
  id: string;
  kind: AssemblyVerificationLoadKind;
  label: string;
  reason: string;
  startSampleIndex: number;
  endSampleIndex: number;
  pointCount: number;
  breakBefore?: "gap" | "non-monotonic";
  gapBeforeSeconds?: number;
  startElapsedSeconds?: number;
  endElapsedSeconds?: number;
  durationSeconds?: number;
  cpuUsageMean?: number;
  cpuUsageMax?: number;
  gpuUsageMean?: number;
  gpuUsageMax?: number;
  cpuTempMean?: number;
  cpuTempFirst?: number;
  cpuTempLast?: number;
  cpuTempDelta?: number;
  gpuTempMean?: number;
  gpuTempFirst?: number;
  gpuTempLast?: number;
  gpuTempDelta?: number;
  cpuPowerMean?: number;
  gpuPowerMean?: number;
  cpuTempChangePer100W?: number;
  gpuTempChangePer100W?: number;
  cpuTempStability?: AssemblyVerificationLoadSegmentStability;
  gpuTempStability?: AssemblyVerificationLoadSegmentStability;
};

export type AssemblyVerificationLoadProfile = {
  pointCount: number;
  usagePointCount: number;
  usageCoveragePercent: number;
  classifiedPointCount: number;
  unclassifiedPointCount: number;
  segments: AssemblyVerificationLoadSegment[];
  thresholds: typeof ASSEMBLY_VERIFICATION_LOAD_PROFILE_THRESHOLDS;
  reason?: "usage-not-recorded" | "insufficient-points";
};

export type AssemblyVerificationLoadSegmentComparison = {
  kind: AssemblyVerificationLoadKind;
  label: string;
  occurrenceIndex: number;
  current: AssemblyVerificationLoadSegment;
  previous?: AssemblyVerificationLoadSegment;
  cpuTempLastDelta?: number;
  gpuTempLastDelta?: number;
  cpuTempMeanDelta?: number;
  gpuTempMeanDelta?: number;
  cpuUsageMeanDelta?: number;
  gpuUsageMeanDelta?: number;
  cpuPowerMeanDelta?: number;
  gpuPowerMeanDelta?: number;
  cpuTempChangePer100WDelta?: number;
  gpuTempChangePer100WDelta?: number;
  cpuStabilityChange?: "improved" | "regressed" | "unchanged";
  gpuStabilityChange?: "improved" | "regressed" | "unchanged";
  cpuStabilizationDeltaSeconds?: number;
  gpuStabilizationDeltaSeconds?: number;
};

export type AssemblyVerificationLoadProfileComparison = {
  filter: AssemblyVerificationComparisonFilter;
  referenceRunId?: string;
  currentRunId?: string;
  currentRunLabel?: string;
  previousRunId?: string;
  previousRunLabel?: string;
  segments: AssemblyVerificationLoadSegmentComparison[];
  reason?: "reference-condition-missing" | "no-previous-run" | "different-condition" | "measurement-quality-review" | "measurement-continuity-gapped" | "profile-missing";
};

export function assemblyVerificationLoadKindLabel(kind: AssemblyVerificationLoadKind) {
  return kind === "idle" ? "유휴" : kind === "cpu" ? "CPU 부하" : kind === "gpu" ? "GPU 부하" : kind === "mixed" ? "혼합 부하" : kind === "partial" ? "부분 부하" : "분류 불가";
}

function numberList(points: AssemblyVerificationTelemetryPoint[], metric: AssemblyVerificationTelemetryMetric) {
  return points.map((point) => point[metric]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function rounded(value: number) {
  return Number(value.toFixed(1));
}

function metricStats(points: AssemblyVerificationTelemetryPoint[], metric: AssemblyVerificationTelemetryMetric) {
  const values = numberList(points, metric);
  if (values.length === 0) return undefined;
  return {
    mean: rounded(values.reduce((total, value) => total + value, 0) / values.length),
    max: rounded(Math.max(...values)),
    first: rounded(values[0]),
    last: rounded(values.at(-1)!),
    delta: rounded(values.at(-1)! - values[0])
  };
}

function loadKindForPoint(point: AssemblyVerificationTelemetryPoint): AssemblyVerificationLoadKind {
  const cpu = point.cpuUsagePercent;
  const gpu = point.gpuUsagePercent;
  if (cpu === undefined && gpu === undefined) return "unknown";
  if (cpu === undefined || gpu === undefined) return "partial";
  const { idleMaxPercent, highMinPercent, lowMaxPercent } = ASSEMBLY_VERIFICATION_LOAD_PROFILE_THRESHOLDS;
  if (cpu <= idleMaxPercent && gpu <= idleMaxPercent) return "idle";
  if (cpu >= highMinPercent && gpu >= highMinPercent) return "mixed";
  if (cpu >= highMinPercent && gpu <= lowMaxPercent) return "cpu";
  if (gpu >= highMinPercent && cpu <= lowMaxPercent) return "gpu";
  return "partial";
}

function reasonFor(points: AssemblyVerificationTelemetryPoint[]) {
  const cpu = metricStats(points, "cpuUsagePercent");
  const gpu = metricStats(points, "gpuUsagePercent");
  return [cpu ? `CPU 사용률 평균 ${cpu.mean}%` : undefined, gpu ? `GPU 사용률 평균 ${gpu.mean}%` : undefined].filter((value): value is string => Boolean(value)).join(" · ") || "사용률 센서 미기록";
}

function temperatureStabilityFor(points: AssemblyVerificationTelemetryPoint[], metric: "cpuTempC" | "gpuTempC"): AssemblyVerificationLoadSegmentStability | undefined {
  const valuePoints = points.map((point) => ({ point, value: point[metric] })).filter((entry): entry is { point: AssemblyVerificationTelemetryPoint; value: number } => typeof entry.value === "number" && Number.isFinite(entry.value));
  if (valuePoints.length === 0) return undefined;
  const { stabilityMinPoints, stabilityWindowC } = ASSEMBLY_VERIFICATION_LOAD_PROFILE_THRESHOLDS;
  const finalWindow = valuePoints.slice(-stabilityMinPoints);
  const finalSpread = Math.max(...finalWindow.map((entry) => entry.value)) - Math.min(...finalWindow.map((entry) => entry.value));
  if (valuePoints.length < stabilityMinPoints) return { metric, stabilized: false, windowPointCount: valuePoints.length, windowSpreadC: rounded(finalSpread) };
  for (let startIndex = 0; startIndex <= valuePoints.length - stabilityMinPoints; startIndex += 1) {
    const window = valuePoints.slice(startIndex);
    const spread = Math.max(...window.map((entry) => entry.value)) - Math.min(...window.map((entry) => entry.value));
    if (spread <= stabilityWindowC) {
      const firstPoint = valuePoints[0].point;
      const stablePoint = window[0].point;
      return {
        metric,
        stabilized: true,
        windowPointCount: window.length,
        windowSpreadC: rounded(spread),
        ...(firstPoint.elapsedSeconds !== undefined && stablePoint.elapsedSeconds !== undefined ? { stabilizedAfterSeconds: rounded(Math.max(0, stablePoint.elapsedSeconds - firstPoint.elapsedSeconds)) } : {})
      };
    }
  }
  return { metric, stabilized: false, windowPointCount: finalWindow.length, windowSpreadC: rounded(finalSpread) };
}

function segmentFor(kind: AssemblyVerificationLoadKind, points: AssemblyVerificationTelemetryPoint[], index: number, boundary: { breakBefore?: "gap" | "non-monotonic"; gapBeforeSeconds?: number } = {}): AssemblyVerificationLoadSegment {
  const firstPoint = points[0];
  const lastPoint = points.at(-1)!;
  const cpuUsage = metricStats(points, "cpuUsagePercent");
  const gpuUsage = metricStats(points, "gpuUsagePercent");
  const cpuTemp = metricStats(points, "cpuTempC");
  const gpuTemp = metricStats(points, "gpuTempC");
  const cpuPower = metricStats(points, "cpuPowerW");
  const gpuPower = metricStats(points, "gpuPowerW");
  const durationSeconds = firstPoint.elapsedSeconds !== undefined && lastPoint.elapsedSeconds !== undefined
    ? rounded(Math.max(0, lastPoint.elapsedSeconds - firstPoint.elapsedSeconds))
    : undefined;
  return {
    id: `${kind}-${firstPoint.sampleIndex}-${lastPoint.sampleIndex}-${index}`,
    kind,
    label: assemblyVerificationLoadKindLabel(kind),
    reason: reasonFor(points),
    startSampleIndex: firstPoint.sampleIndex,
    endSampleIndex: lastPoint.sampleIndex,
    pointCount: points.length,
    ...(boundary.breakBefore ? { breakBefore: boundary.breakBefore } : {}),
    ...(boundary.gapBeforeSeconds !== undefined ? { gapBeforeSeconds: boundary.gapBeforeSeconds } : {}),
    ...(firstPoint.elapsedSeconds !== undefined ? { startElapsedSeconds: firstPoint.elapsedSeconds } : {}),
    ...(lastPoint.elapsedSeconds !== undefined ? { endElapsedSeconds: lastPoint.elapsedSeconds } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(cpuUsage ? { cpuUsageMean: cpuUsage.mean, cpuUsageMax: cpuUsage.max } : {}),
    ...(gpuUsage ? { gpuUsageMean: gpuUsage.mean, gpuUsageMax: gpuUsage.max } : {}),
    ...(cpuTemp ? { cpuTempMean: cpuTemp.mean, cpuTempFirst: cpuTemp.first, cpuTempLast: cpuTemp.last, cpuTempDelta: cpuTemp.delta } : {}),
    ...(gpuTemp ? { gpuTempMean: gpuTemp.mean, gpuTempFirst: gpuTemp.first, gpuTempLast: gpuTemp.last, gpuTempDelta: gpuTemp.delta } : {}),
    ...(cpuPower ? { cpuPowerMean: cpuPower.mean } : {}),
    ...(gpuPower ? { gpuPowerMean: gpuPower.mean } : {}),
    ...(cpuTemp && cpuPower && cpuPower.mean > 0 ? { cpuTempChangePer100W: rounded((cpuTemp.delta / cpuPower.mean) * 100) } : {}),
    ...(gpuTemp && gpuPower && gpuPower.mean > 0 ? { gpuTempChangePer100W: rounded((gpuTemp.delta / gpuPower.mean) * 100) } : {}),
    ...(cpuTemp ? { cpuTempStability: temperatureStabilityFor(points, "cpuTempC") } : {}),
    ...(gpuTemp ? { gpuTempStability: temperatureStabilityFor(points, "gpuTempC") } : {})
  };
}

export function assemblyVerificationLoadProfileFor(series: AssemblyVerificationTelemetryPoint[] | undefined, gapToleranceSeconds?: number): AssemblyVerificationLoadProfile {
  const points = series ?? [];
  const usagePointCount = points.filter((point) => point.cpuUsagePercent !== undefined || point.gpuUsagePercent !== undefined).length;
  if (points.length === 0 || usagePointCount === 0) return { pointCount: points.length, usagePointCount, usageCoveragePercent: 0, classifiedPointCount: 0, unclassifiedPointCount: points.length, segments: [], thresholds: ASSEMBLY_VERIFICATION_LOAD_PROFILE_THRESHOLDS, reason: "usage-not-recorded" };
  const runs: Array<{ kind: AssemblyVerificationLoadKind; points: AssemblyVerificationTelemetryPoint[]; breakBefore?: "gap" | "non-monotonic"; gapBeforeSeconds?: number }> = [];
  for (const timelineSegment of assemblyVerificationTelemetrySegmentsFor(points, gapToleranceSeconds)) {
    for (const [pointIndex, point] of timelineSegment.points.entries()) {
      const kind = loadKindForPoint(point);
      const startsAfterBreak = pointIndex === 0 && timelineSegment.breakBefore !== undefined;
      const current = runs.at(-1);
      if (current?.kind === kind && !startsAfterBreak) current.points.push(point);
      else runs.push({ kind, points: [point], ...(startsAfterBreak ? { breakBefore: timelineSegment.breakBefore, ...(timelineSegment.gapBeforeSeconds !== undefined ? { gapBeforeSeconds: timelineSegment.gapBeforeSeconds } : {}) } : {}) });
    }
  }
  const unclassifiedPointCount = runs.filter((run) => run.kind === "unknown").reduce((total, run) => total + run.points.length, 0);
  const classifiedPointCount = points.length - unclassifiedPointCount;
  return {
    pointCount: points.length,
    usagePointCount,
    usageCoveragePercent: Math.round((usagePointCount / points.length) * 100),
    classifiedPointCount,
    unclassifiedPointCount,
    segments: runs.filter((run) => run.kind !== "unknown").map((run, index) => segmentFor(run.kind, run.points, index, run)),
    thresholds: ASSEMBLY_VERIFICATION_LOAD_PROFILE_THRESHOLDS,
    ...(points.length < 2 ? { reason: "insufficient-points" as const } : {})
  };
}

function deltaFor(current: number | undefined, previous: number | undefined) {
  return current !== undefined && previous !== undefined ? rounded(current - previous) : undefined;
}

function stabilityChangeFor(current: AssemblyVerificationLoadSegmentStability | undefined, previous: AssemblyVerificationLoadSegmentStability | undefined) {
  if (!current || !previous) return undefined;
  if (current.stabilized && !previous.stabilized) return "improved" as const;
  if (!current.stabilized && previous.stabilized) return "regressed" as const;
  if (!current.stabilized && !previous.stabilized) return "unchanged" as const;
  if (current.stabilizedAfterSeconds !== undefined && previous.stabilizedAfterSeconds !== undefined) return current.stabilizedAfterSeconds < previous.stabilizedAfterSeconds ? "improved" as const : current.stabilizedAfterSeconds > previous.stabilizedAfterSeconds ? "regressed" as const : "unchanged" as const;
  return "unchanged" as const;
}

function segmentComparisonFor(current: AssemblyVerificationLoadSegment, previous: AssemblyVerificationLoadSegment | undefined, occurrenceIndex: number): AssemblyVerificationLoadSegmentComparison {
  return {
    kind: current.kind,
    label: current.label,
    occurrenceIndex,
    current,
    ...(previous ? {
      previous,
      ...(deltaFor(current.cpuTempLast, previous.cpuTempLast) !== undefined ? { cpuTempLastDelta: deltaFor(current.cpuTempLast, previous.cpuTempLast) } : {}),
      ...(deltaFor(current.gpuTempLast, previous.gpuTempLast) !== undefined ? { gpuTempLastDelta: deltaFor(current.gpuTempLast, previous.gpuTempLast) } : {}),
      ...(deltaFor(current.cpuTempMean, previous.cpuTempMean) !== undefined ? { cpuTempMeanDelta: deltaFor(current.cpuTempMean, previous.cpuTempMean) } : {}),
      ...(deltaFor(current.gpuTempMean, previous.gpuTempMean) !== undefined ? { gpuTempMeanDelta: deltaFor(current.gpuTempMean, previous.gpuTempMean) } : {}),
      ...(deltaFor(current.cpuUsageMean, previous.cpuUsageMean) !== undefined ? { cpuUsageMeanDelta: deltaFor(current.cpuUsageMean, previous.cpuUsageMean) } : {}),
      ...(deltaFor(current.gpuUsageMean, previous.gpuUsageMean) !== undefined ? { gpuUsageMeanDelta: deltaFor(current.gpuUsageMean, previous.gpuUsageMean) } : {}),
      ...(deltaFor(current.cpuPowerMean, previous.cpuPowerMean) !== undefined ? { cpuPowerMeanDelta: deltaFor(current.cpuPowerMean, previous.cpuPowerMean) } : {}),
      ...(deltaFor(current.gpuPowerMean, previous.gpuPowerMean) !== undefined ? { gpuPowerMeanDelta: deltaFor(current.gpuPowerMean, previous.gpuPowerMean) } : {}),
      ...(deltaFor(current.cpuTempChangePer100W, previous.cpuTempChangePer100W) !== undefined ? { cpuTempChangePer100WDelta: deltaFor(current.cpuTempChangePer100W, previous.cpuTempChangePer100W) } : {}),
      ...(deltaFor(current.gpuTempChangePer100W, previous.gpuTempChangePer100W) !== undefined ? { gpuTempChangePer100WDelta: deltaFor(current.gpuTempChangePer100W, previous.gpuTempChangePer100W) } : {}),
      ...(stabilityChangeFor(current.cpuTempStability, previous.cpuTempStability) ? { cpuStabilityChange: stabilityChangeFor(current.cpuTempStability, previous.cpuTempStability) } : {}),
      ...(stabilityChangeFor(current.gpuTempStability, previous.gpuTempStability) ? { gpuStabilityChange: stabilityChangeFor(current.gpuTempStability, previous.gpuTempStability) } : {}),
      ...(deltaFor(current.cpuTempStability?.stabilizedAfterSeconds, previous.cpuTempStability?.stabilizedAfterSeconds) !== undefined ? { cpuStabilizationDeltaSeconds: deltaFor(current.cpuTempStability?.stabilizedAfterSeconds, previous.cpuTempStability?.stabilizedAfterSeconds) } : {}),
      ...(deltaFor(current.gpuTempStability?.stabilizedAfterSeconds, previous.gpuTempStability?.stabilizedAfterSeconds) !== undefined ? { gpuStabilizationDeltaSeconds: deltaFor(current.gpuTempStability?.stabilizedAfterSeconds, previous.gpuTempStability?.stabilizedAfterSeconds) } : {})
    } : {})
  };
}

export function assemblyVerificationLoadProfileComparisonFor(history: AssemblyVerificationHistory, filter: AssemblyVerificationComparisonFilter = "all", referenceRunId = history.activeRunId): AssemblyVerificationLoadProfileComparison {
  const comparison = assemblyVerificationComparisonFor(history, filter, referenceRunId);
  const currentPoint = comparison.points.find((point) => point.runId === comparison.referenceRunId) ?? comparison.points.at(-1);
  const currentRun = history.runs.find((run) => run.runId === currentPoint?.runId);
  if (comparison.reason === "reference-condition-missing") return { filter, ...(currentPoint ? { referenceRunId: currentPoint.runId, currentRunId: currentPoint.runId, currentRunLabel: currentPoint.runLabel } : {}), segments: [], reason: "reference-condition-missing" };
  if (!currentRun || !currentPoint) return { filter, segments: [], reason: "profile-missing" };
  const currentProfile = assemblyVerificationLoadProfileFor(currentRun.measurementSeries, currentRun.measurementQuality?.continuity?.gapToleranceSeconds);
  if (currentProfile.segments.length === 0) return { filter, referenceRunId: currentPoint.runId, currentRunId: currentPoint.runId, currentRunLabel: currentPoint.runLabel, segments: [], reason: "profile-missing" };
  const currentIndex = comparison.points.findIndex((point) => point.runId === currentPoint.runId);
  const previousPoint = currentIndex > 0 ? comparison.points[currentIndex - 1] : undefined;
  const previousRun = previousPoint ? history.runs.find((run) => run.runId === previousPoint.runId) : undefined;
  const comparable = Boolean(previousPoint && currentPoint.comparableToPrevious !== false);
  const previousProfile = comparable && previousRun ? assemblyVerificationLoadProfileFor(previousRun.measurementSeries, previousRun.measurementQuality?.continuity?.gapToleranceSeconds) : undefined;
  const occurrenceByKind = new Map<AssemblyVerificationLoadKind, number>();
  const segments = currentProfile.segments.map((current) => {
    const occurrenceIndex = occurrenceByKind.get(current.kind) ?? 0;
    occurrenceByKind.set(current.kind, occurrenceIndex + 1);
    const previous = previousProfile?.segments.filter((segment) => segment.kind === current.kind)[occurrenceIndex];
    return segmentComparisonFor(current, previous, occurrenceIndex);
  });
  return {
    filter,
    referenceRunId: currentPoint.runId,
    currentRunId: currentPoint.runId,
    currentRunLabel: currentPoint.runLabel,
    ...(previousPoint && previousRun && comparable ? { previousRunId: previousPoint.runId, previousRunLabel: previousPoint.runLabel } : {}),
    segments,
    ...(!previousPoint ? { reason: "no-previous-run" as const } : !comparable ? { reason: currentPoint.comparisonBlockReason === "measurement-continuity-gapped" ? "measurement-continuity-gapped" as const : currentPoint.comparisonBlockReason === "measurement-quality-review" ? "measurement-quality-review" as const : "different-condition" as const } : {})
  };
}
