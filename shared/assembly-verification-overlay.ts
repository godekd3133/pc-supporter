import type { AssemblyVerificationComparisonFilter, AssemblyVerificationHistory, AssemblyVerificationMeasurementContinuityStatus, AssemblyVerificationMeasurementQualityStatus, AssemblyVerificationTelemetryPoint } from "./assembly-verification";
import { assemblyVerificationComparisonFor, assemblyVerificationTelemetryAnalysisFor, assemblyVerificationTelemetrySegmentsFor } from "./assembly-verification";

export const ASSEMBLY_VERIFICATION_OVERLAY_BUCKET_COUNT = 24;

export type AssemblyVerificationOverlayMetric = "cpuTempC" | "gpuTempC" | "cpuUsagePercent" | "gpuUsagePercent";

export type AssemblyVerificationOverlayPoint = {
  progressPercent: number;
  cpuTempC?: number;
  gpuTempC?: number;
  cpuUsagePercent?: number;
  gpuUsagePercent?: number;
};

export type AssemblyVerificationOverlayRun = {
  runId: string;
  runLabel: string;
  index: number;
  originalPointCount: number;
  points: AssemblyVerificationOverlayPoint[];
  cpuTempFirst?: number;
  cpuTempLast?: number;
  cpuTempPeak?: number;
  gpuTempFirst?: number;
  gpuTempLast?: number;
  gpuTempPeak?: number;
  cpuUsageMean?: number;
  gpuUsageMean?: number;
  measurementQualityStatus?: AssemblyVerificationMeasurementQualityStatus;
  measurementContinuityStatus?: AssemblyVerificationMeasurementContinuityStatus;
  gapProgressPercents?: number[];
};

export type AssemblyVerificationTelemetryOverlay = {
  filter: AssemblyVerificationComparisonFilter;
  conditionKey?: string;
  referenceRunId?: string;
  bucketCount: number;
  runCount: number;
  runs: AssemblyVerificationOverlayRun[];
  reason?: "reference-condition-missing" | "no-matching-run-series";
};

export type AssemblyVerificationTelemetryOverlayOptions = {
  includedRunIds?: string[];
  bucketCount?: number;
  includeReviewQuality?: boolean;
};

function rounded(value: number) {
  return Number(value.toFixed(1));
}

function metricValue(point: AssemblyVerificationTelemetryPoint, metric: AssemblyVerificationOverlayMetric) {
  return point[metric];
}

function normalizedPoints(series: AssemblyVerificationTelemetryPoint[], bucketCount: number) {
  return Array.from({ length: bucketCount }, (_, index) => {
    const source = series[Math.round((index * (series.length - 1)) / (bucketCount - 1))];
    return {
      progressPercent: rounded((index / (bucketCount - 1)) * 100),
      ...(metricValue(source, "cpuTempC") !== undefined ? { cpuTempC: metricValue(source, "cpuTempC") } : {}),
      ...(metricValue(source, "gpuTempC") !== undefined ? { gpuTempC: metricValue(source, "gpuTempC") } : {}),
      ...(metricValue(source, "cpuUsagePercent") !== undefined ? { cpuUsagePercent: metricValue(source, "cpuUsagePercent") } : {}),
      ...(metricValue(source, "gpuUsagePercent") !== undefined ? { gpuUsagePercent: metricValue(source, "gpuUsagePercent") } : {})
    };
  });
}

function gapProgressPercentsFor(series: AssemblyVerificationTelemetryPoint[], gapToleranceSeconds?: number) {
  if (series.length < 2) return [];
  return assemblyVerificationTelemetrySegmentsFor(series, gapToleranceSeconds).filter((segment) => segment.breakBefore).map((segment) => {
    const sampleIndex = segment.points[0]?.sampleIndex ?? 0;
    return rounded((sampleIndex / Math.max(1, series.length - 1)) * 100);
  });
}

export function assemblyVerificationTelemetryOverlayFor(history: AssemblyVerificationHistory, referenceRunId = history.activeRunId, options: AssemblyVerificationTelemetryOverlayOptions = {}): AssemblyVerificationTelemetryOverlay {
  const comparison = assemblyVerificationComparisonFor(history, "same-load", referenceRunId);
  const bucketCount = Math.max(8, Math.min(48, Math.round(options.bucketCount ?? ASSEMBLY_VERIFICATION_OVERLAY_BUCKET_COUNT)));
  if (comparison.reason === "reference-condition-missing") return { filter: "same-load", bucketCount, runCount: 0, runs: [], reason: "reference-condition-missing" };
  const runs = comparison.points.flatMap((point) => {
    if (options.includedRunIds && !options.includedRunIds.includes(point.runId)) return [];
    const run = history.runs.find((candidate) => candidate.runId === point.runId);
    const reviewQuality = run?.measurementQuality?.status === "review" || run?.measurementQuality?.continuity?.status === "gapped";
    if (reviewQuality && !options.includeReviewQuality) return [];
    if (!run?.measurementSeries || run.measurementSeries.length < 2) return [];
    const analysis = assemblyVerificationTelemetryAnalysisFor(run.measurementSeries);
    const cpuTemp = analysis.metrics.cpuTempC;
    const gpuTemp = analysis.metrics.gpuTempC;
    const cpuUsage = analysis.metrics.cpuUsagePercent;
    const gpuUsage = analysis.metrics.gpuUsagePercent;
    return [{
      runId: point.runId,
      runLabel: point.runLabel,
      index: point.index,
      originalPointCount: run.measurementSeries.length,
      points: normalizedPoints(run.measurementSeries, bucketCount),
      ...(cpuTemp ? { cpuTempFirst: cpuTemp.first, cpuTempLast: cpuTemp.last, cpuTempPeak: cpuTemp.max } : {}),
      ...(gpuTemp ? { gpuTempFirst: gpuTemp.first, gpuTempLast: gpuTemp.last, gpuTempPeak: gpuTemp.max } : {}),
      ...(cpuUsage ? { cpuUsageMean: cpuUsage.mean } : {}),
      ...(gpuUsage ? { gpuUsageMean: gpuUsage.mean } : {}),
      ...(run.measurementQuality ? { measurementQualityStatus: run.measurementQuality.status } : {}),
      ...(run.measurementQuality?.continuity ? { measurementContinuityStatus: run.measurementQuality.continuity.status, gapProgressPercents: gapProgressPercentsFor(run.measurementSeries, run.measurementQuality.continuity.gapToleranceSeconds) } : {})
    } satisfies AssemblyVerificationOverlayRun];
  });
  return {
    filter: "same-load",
    ...(comparison.conditionKey ? { conditionKey: comparison.conditionKey } : {}),
    ...(comparison.referenceRunId ? { referenceRunId: comparison.referenceRunId } : {}),
    bucketCount,
    runCount: runs.length,
    runs,
    ...(runs.length === 0 ? { reason: "no-matching-run-series" as const } : {})
  };
}
