import type { AssemblyVerificationHistory } from "./assembly-verification";
import { assemblyVerificationLoadProfileFor } from "./assembly-verification-load";
import type { AssemblyVerificationTelemetryOverlay } from "./assembly-verification-overlay";
import { assemblyVerificationTelemetryOverlayFor } from "./assembly-verification-overlay";

export type AssemblyVerificationComparisonRankRow = {
  runId: string;
  runLabel: string;
  index: number;
  value?: number;
  baselineDelta?: number;
  detail: string;
  rank?: number;
};

export type AssemblyVerificationComparisonSummary = {
  overlay: AssemblyVerificationTelemetryOverlay;
  baselineRunId?: string;
  latestRunId?: string;
  cpuPeakRows: AssemblyVerificationComparisonRankRow[];
  gpuPeakRows: AssemblyVerificationComparisonRankRow[];
  cpuStabilityRows: AssemblyVerificationComparisonRankRow[];
  gpuStabilityRows: AssemblyVerificationComparisonRankRow[];
  cpuPowerRows: AssemblyVerificationComparisonRankRow[];
  gpuPowerRows: AssemblyVerificationComparisonRankRow[];
  reason?: "reference-condition-missing" | "no-selected-runs" | "insufficient-comparison";
};

function rounded(value: number) {
  return Number(value.toFixed(1));
}

function activeSegmentsFor(profile: ReturnType<typeof assemblyVerificationLoadProfileFor>) {
  const active = profile.segments.filter((segment) => segment.kind !== "idle");
  return active.length > 0 ? active : profile.segments;
}

function weightedMean(values: Array<{ value: number; weight: number }>) {
  const totalWeight = values.reduce((total, item) => total + item.weight, 0);
  return totalWeight > 0 ? rounded(values.reduce((total, item) => total + item.value * item.weight, 0) / totalWeight) : undefined;
}

function stabilityObservation(profile: ReturnType<typeof assemblyVerificationLoadProfileFor>, metric: "cpuTempStability" | "gpuTempStability") {
  const segments = activeSegmentsFor(profile);
  const observed = segments.map((segment) => segment[metric]).filter((stability): stability is NonNullable<typeof stability> => Boolean(stability));
  const stable = observed.filter((stability) => stability.stabilized && stability.stabilizedAfterSeconds !== undefined);
  return {
    stableCount: stable.length,
    segmentCount: observed.length,
    seconds: stable.length > 0 ? Math.max(...stable.map((stability) => stability.stabilizedAfterSeconds!)) : undefined
  };
}

function rankRows(rows: Array<Omit<AssemblyVerificationComparisonRankRow, "rank" | "baselineDelta"> & { rawValue?: number }>, baselineValue: number | undefined, stability = false) {
  const sorted = rows.slice().sort((left, right) => {
    if (left.rawValue === undefined && right.rawValue === undefined) return left.index - right.index;
    if (left.rawValue === undefined) return 1;
    if (right.rawValue === undefined) return -1;
    return left.rawValue - right.rawValue;
  });
  let rank = 0;
  let lastValue: number | undefined;
  return sorted.map((row) => {
    const hasValue = row.rawValue !== undefined;
    if (hasValue && (!stability || row.detail.includes("안정화 확인"))) {
      if (lastValue === undefined || row.rawValue !== lastValue) rank += 1;
      lastValue = row.rawValue;
    }
    return {
      runId: row.runId,
      runLabel: row.runLabel,
      index: row.index,
      ...(row.rawValue !== undefined ? { value: row.rawValue } : {}),
      ...(row.rawValue !== undefined && baselineValue !== undefined ? { baselineDelta: rounded(row.rawValue - baselineValue) } : {}),
      detail: row.detail,
      ...(hasValue && (!stability || row.detail.includes("안정화 확인")) ? { rank } : {})
    };
  });
}

export function assemblyVerificationComparisonSummaryFor(history: AssemblyVerificationHistory, referenceRunId = history.activeRunId, includedRunIds?: string[]): AssemblyVerificationComparisonSummary {
  const overlay = assemblyVerificationTelemetryOverlayFor(history, referenceRunId, includedRunIds ? { includedRunIds } : {});
  if (overlay.reason === "reference-condition-missing") return { overlay, cpuPeakRows: [], gpuPeakRows: [], cpuStabilityRows: [], gpuStabilityRows: [], cpuPowerRows: [], gpuPowerRows: [], reason: "reference-condition-missing" };
  if (overlay.runCount === 0) return { overlay, cpuPeakRows: [], gpuPeakRows: [], cpuStabilityRows: [], gpuStabilityRows: [], cpuPowerRows: [], gpuPowerRows: [], reason: "no-selected-runs" };
  const facts = overlay.runs.map((overlayRun) => {
    const run = history.runs.find((candidate) => candidate.runId === overlayRun.runId);
    const profile = assemblyVerificationLoadProfileFor(run?.measurementSeries, run?.measurementQuality?.continuity?.gapToleranceSeconds);
    const activeSegments = activeSegmentsFor(profile);
    const cpuStability = stabilityObservation(profile, "cpuTempStability");
    const gpuStability = stabilityObservation(profile, "gpuTempStability");
    const cpuPower = weightedMean(activeSegments.flatMap((segment) => segment.cpuPowerMean === undefined ? [] : [{ value: segment.cpuPowerMean, weight: segment.pointCount }]));
    const gpuPower = weightedMean(activeSegments.flatMap((segment) => segment.gpuPowerMean === undefined ? [] : [{ value: segment.gpuPowerMean, weight: segment.pointCount }]));
    return { overlayRun, cpuStability, gpuStability, cpuPower, gpuPower };
  });
  const baseline = facts[0];
  const rowsFor = (valueFor: (fact: (typeof facts)[number]) => number | undefined, detailFor: (fact: (typeof facts)[number], value: number | undefined) => string, stability = false) => rankRows(facts.map(({ overlayRun, ...fact }) => {
    const rawValue = valueFor({ overlayRun, ...fact });
    return { runId: overlayRun.runId, runLabel: overlayRun.runLabel, index: overlayRun.index, detail: detailFor({ overlayRun, ...fact }, rawValue), rawValue };
  }), valueFor(baseline), stability);
  const cpuStabilityRows = rowsFor((fact) => fact.cpuStability.seconds, (fact, value) => `${fact.cpuStability.stableCount}/${fact.cpuStability.segmentCount}개 구간 · ${value === undefined ? "안정화 미확인" : `안정화 확인 · ${value}초 이후`}`, true);
  const gpuStabilityRows = rowsFor((fact) => fact.gpuStability.seconds, (fact, value) => `${fact.gpuStability.stableCount}/${fact.gpuStability.segmentCount}개 구간 · ${value === undefined ? "안정화 미확인" : `안정화 확인 · ${value}초 이후`}`, true);
  return {
    overlay,
    baselineRunId: overlay.runs[0]?.runId,
    latestRunId: overlay.runs.at(-1)?.runId,
    cpuPeakRows: rowsFor((fact) => fact.overlayRun.cpuTempPeak, (fact, value) => value === undefined ? "CPU 최고 온도 미기록" : `CPU 최고 ${value}°C`),
    gpuPeakRows: rowsFor((fact) => fact.overlayRun.gpuTempPeak, (fact, value) => value === undefined ? "GPU 최고 온도 미기록" : `GPU 최고 ${value}°C`),
    cpuStabilityRows,
    gpuStabilityRows,
    cpuPowerRows: rowsFor((fact) => fact.cpuPower, (fact, value) => value === undefined ? "CPU 전력 미기록" : `CPU 평균 ${value}W · 관찰 순`, false),
    gpuPowerRows: rowsFor((fact) => fact.gpuPower, (fact, value) => value === undefined ? "GPU 전력 미기록" : `GPU 평균 ${value}W · 관찰 순`, false),
    ...(overlay.runCount < 2 ? { reason: "insufficient-comparison" as const } : {})
  };
}
