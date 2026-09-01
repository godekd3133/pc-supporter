import { describe, expect, it } from "vitest";
import { assemblyVerificationDecisionSummaryFor } from "./assembly-verification-decision";
import type { AssemblyVerificationComparisonSummary } from "./assembly-verification-comparison-summary";

function row(runId: string, runLabel: string, value: number | undefined, baselineDelta: number | undefined, detail = "측정값") {
  return { runId, runLabel, index: runId === "r1" ? 1 : 2, ...(value === undefined ? {} : { value }), ...(baselineDelta === undefined ? {} : { baselineDelta }), detail };
}

function summaryFor(status: "improved" | "unchanged" | "recheck" | "inconclusive"): AssemblyVerificationComparisonSummary {
  const baseline = row("r1", "기준 회차", 70, 0);
  const latest = status === "improved" ? row("r2", "최신 회차", 65, -5) : status === "recheck" ? row("r2", "최신 회차", 75, 5) : status === "unchanged" ? row("r2", "최신 회차", 70, 0) : row("r2", "최신 회차", undefined, undefined, "최신 값 미기록");
  const overlay = { filter: "same-load" as const, bucketCount: 24, runCount: status === "inconclusive" ? 1 : 2, runs: [] };
  return {
    overlay,
    baselineRunId: "r1",
    latestRunId: "r2",
    cpuPeakRows: [baseline, latest],
    gpuPeakRows: [baseline, latest],
    cpuStabilityRows: status === "inconclusive" ? [row("r1", "기준 회차", undefined, undefined, "안정화 미확인"), row("r2", "최신 회차", undefined, undefined, "안정화 미확인")] : [baseline, latest],
    gpuStabilityRows: status === "inconclusive" ? [row("r1", "기준 회차", undefined, undefined, "안정화 미확인"), row("r2", "최신 회차", undefined, undefined, "안정화 미확인")] : [baseline, latest],
    cpuPowerRows: [row("r1", "기준 회차", 100, 0, "CPU 평균 100W · 관찰 순"), row("r2", "최신 회차", 120, 20, "CPU 평균 120W · 관찰 순")],
    gpuPowerRows: [row("r1", "기준 회차", 200, 0, "GPU 평균 200W · 관찰 순"), row("r2", "최신 회차", 180, -20, "GPU 평균 180W · 관찰 순")]
  };
}

describe("assembly verification decision summary", () => {
  it("requests recheck when the latest thermal observation worsens", () => {
    const decision = assemblyVerificationDecisionSummaryFor(summaryFor("recheck"));

    expect(decision).toMatchObject({ status: "recheck", nextAction: "같은 부하 조건으로 재측정하고 케이스·팬·전원 연결을 다시 확인하세요." });
    expect(decision.dimensions.find((dimension) => dimension.id === "cpu-temperature")).toMatchObject({ status: "recheck", summary: "최신 75°C · 기준 대비 +5°C" });
    expect(decision.dimensions.find((dimension) => dimension.id === "cpu-power")).toMatchObject({ status: "observational-higher" });
  });

  it("reports improvement when the latest thermal observation is lower", () => {
    const decision = assemblyVerificationDecisionSummaryFor(summaryFor("improved"));

    expect(decision.status).toBe("improved");
    expect(decision.dimensions.find((dimension) => dimension.id === "cpu-temperature")).toMatchObject({ status: "improved", summary: "최신 65°C · 기준 대비 -5°C" });
  });

  it("reports unchanged when thermal observations do not move", () => {
    const decision = assemblyVerificationDecisionSummaryFor(summaryFor("unchanged"));

    expect(decision.status).toBe("unchanged");
    expect(decision.dimensions.filter((dimension) => dimension.id.endsWith("temperature") || dimension.id.endsWith("stability")).every((dimension) => dimension.status === "unchanged")).toBe(true);
  });

  it("keeps a one-run or missing-measurement comparison inconclusive", () => {
    const decision = assemblyVerificationDecisionSummaryFor(summaryFor("inconclusive"));

    expect(decision).toMatchObject({ status: "inconclusive", nextAction: "비교 회차 또는 측정값이 부족합니다. 같은 조건의 실측 회차를 2개 이상 확보하세요." });
    expect(decision.dimensions.find((dimension) => dimension.id === "cpu-temperature")).toMatchObject({ status: "unknown" });
  });
});
