import type { AssemblyVerificationComparisonRankRow, AssemblyVerificationComparisonSummary } from "./assembly-verification-comparison-summary";

export type AssemblyVerificationDecisionStatus = "improved" | "unchanged" | "recheck" | "inconclusive";
export type AssemblyVerificationDecisionDimensionStatus = "improved" | "unchanged" | "recheck" | "unknown" | "observational-lower" | "observational-higher";
export type AssemblyVerificationDecisionDimensionId = "cpu-temperature" | "gpu-temperature" | "cpu-stability" | "gpu-stability" | "cpu-power" | "gpu-power";

export type AssemblyVerificationDecisionDimension = {
  id: AssemblyVerificationDecisionDimensionId;
  title: string;
  status: AssemblyVerificationDecisionDimensionStatus;
  summary: string;
  baseline?: AssemblyVerificationComparisonRankRow;
  latest?: AssemblyVerificationComparisonRankRow;
};

export type AssemblyVerificationDecisionSummary = {
  type: "pc-supporter-assembly-verification-decision";
  schemaVersion: 1;
  status: AssemblyVerificationDecisionStatus;
  baselineRunId?: string;
  latestRunId?: string;
  dimensions: AssemblyVerificationDecisionDimension[];
  nextAction: string;
};

function metricDeltaFor(row: AssemblyVerificationComparisonRankRow | undefined) {
  return row?.baselineDelta;
}

function temperatureDimension(id: "cpu-temperature" | "gpu-temperature", title: string, rows: AssemblyVerificationComparisonRankRow[], baselineRunId: string | undefined, latestRunId: string | undefined): AssemblyVerificationDecisionDimension {
  const baseline = rows.find((row) => row.runId === baselineRunId);
  const latest = rows.find((row) => row.runId === latestRunId);
  const delta = metricDeltaFor(latest);
  const status: AssemblyVerificationDecisionDimensionStatus = delta === undefined ? "unknown" : delta < 0 ? "improved" : delta > 0 ? "recheck" : "unchanged";
  return {
    id,
    title,
    status,
    summary: latest?.value === undefined ? "최신 회차 값 미기록" : delta === undefined ? `최신 ${latest.value}°C · 기준 비교 불가` : `최신 ${latest.value}°C · 기준 대비 ${delta > 0 ? "+" : ""}${delta}°C`,
    ...(baseline ? { baseline } : {}),
    ...(latest ? { latest } : {})
  };
}

function stabilityDimension(id: "cpu-stability" | "gpu-stability", title: string, rows: AssemblyVerificationComparisonRankRow[], baselineRunId: string | undefined, latestRunId: string | undefined): AssemblyVerificationDecisionDimension {
  const baseline = rows.find((row) => row.runId === baselineRunId);
  const latest = rows.find((row) => row.runId === latestRunId);
  const baselineKnown = baseline?.value !== undefined;
  const latestKnown = latest?.value !== undefined;
  const status: AssemblyVerificationDecisionDimensionStatus = latestKnown && !baselineKnown ? "improved" : !latestKnown && baselineKnown ? "recheck" : latestKnown && baselineKnown && (latest!.baselineDelta ?? 0) < 0 ? "improved" : latestKnown && baselineKnown && (latest!.baselineDelta ?? 0) > 0 ? "recheck" : baselineKnown || latestKnown ? "unchanged" : "unknown";
  const summary = latestKnown ? `최신 ${latest!.value}초 이후 안정화 관찰${latest!.baselineDelta === undefined ? " · 기준 비교 불가" : ` · 기준 대비 ${latest!.baselineDelta > 0 ? "+" : ""}${latest!.baselineDelta}초`}` : "최신 회차에서 안정화 미확인";
  return { id, title, status, summary, ...(baseline ? { baseline } : {}), ...(latest ? { latest } : {}) };
}

function powerDimension(id: "cpu-power" | "gpu-power", title: string, rows: AssemblyVerificationComparisonRankRow[], baselineRunId: string | undefined, latestRunId: string | undefined): AssemblyVerificationDecisionDimension {
  const baseline = rows.find((row) => row.runId === baselineRunId);
  const latest = rows.find((row) => row.runId === latestRunId);
  const delta = metricDeltaFor(latest);
  const status: AssemblyVerificationDecisionDimensionStatus = delta === undefined ? "unknown" : delta < 0 ? "observational-lower" : delta > 0 ? "observational-higher" : "unchanged";
  return { id, title, status, summary: latest?.value === undefined ? "최신 회차 전력 미기록" : delta === undefined ? `최신 ${latest.value}W · 기준 비교 불가` : `최신 ${latest.value}W · 기준 대비 ${delta > 0 ? "+" : ""}${delta}W · 관찰 순`, ...(baseline ? { baseline } : {}), ...(latest ? { latest } : {}) };
}

export function assemblyVerificationDecisionSummaryFor(summary: AssemblyVerificationComparisonSummary): AssemblyVerificationDecisionSummary {
  const baselineRunId = summary.baselineRunId;
  const latestRunId = summary.latestRunId;
  const dimensions: AssemblyVerificationDecisionDimension[] = [
    temperatureDimension("cpu-temperature", "CPU 열 상태", summary.cpuPeakRows, baselineRunId, latestRunId),
    temperatureDimension("gpu-temperature", "GPU 열 상태", summary.gpuPeakRows, baselineRunId, latestRunId),
    stabilityDimension("cpu-stability", "CPU 안정화", summary.cpuStabilityRows, baselineRunId, latestRunId),
    stabilityDimension("gpu-stability", "GPU 안정화", summary.gpuStabilityRows, baselineRunId, latestRunId),
    powerDimension("cpu-power", "CPU 전력 관찰", summary.cpuPowerRows, baselineRunId, latestRunId),
    powerDimension("gpu-power", "GPU 전력 관찰", summary.gpuPowerRows, baselineRunId, latestRunId)
  ];
  const thermalOrStability = dimensions.filter((dimension) => ["cpu-temperature", "gpu-temperature", "cpu-stability", "gpu-stability"].includes(dimension.id));
  const hasRecheck = thermalOrStability.some((dimension) => dimension.status === "recheck");
  const hasImprovement = thermalOrStability.some((dimension) => dimension.status === "improved");
  const allKnownUnchanged = thermalOrStability.every((dimension) => dimension.status === "unchanged");
  const hasUnknown = thermalOrStability.some((dimension) => dimension.status === "unknown");
  const status: AssemblyVerificationDecisionStatus = summary.overlay.runCount < 2 || summary.reason === "no-selected-runs" ? "inconclusive" : hasRecheck ? "recheck" : hasImprovement ? "improved" : allKnownUnchanged ? "unchanged" : hasUnknown ? "inconclusive" : "unchanged";
  const nextAction = status === "recheck" ? "같은 부하 조건으로 재측정하고 케이스·팬·전원 연결을 다시 확인하세요." : status === "improved" ? "기준 회차보다 개선된 관찰이 있습니다. 같은 조건을 한 번 더 기록해 추세를 확인하세요." : status === "unchanged" ? "기준 회차와 큰 변화가 없습니다. 측정 조건을 유지해 다음 회차를 기록하세요." : "비교 회차 또는 측정값이 부족합니다. 같은 조건의 실측 회차를 2개 이상 확보하세요.";
  return { type: "pc-supporter-assembly-verification-decision", schemaVersion: 1, status, ...(baselineRunId ? { baselineRunId } : {}), ...(latestRunId ? { latestRunId } : {}), dimensions, nextAction };
}
