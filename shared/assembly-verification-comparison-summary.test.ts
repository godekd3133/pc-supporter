import { describe, expect, it } from "vitest";
import { assemblyVerificationComparisonSummaryFor } from "./assembly-verification-comparison-summary";
import { emptyAssemblyVerificationLog, withAssemblyVerificationMeasurements } from "./assembly-verification";

function runFor(timestamp: string, label: string, cpuPeak: number, gpuPeak: number, cpuPower: number, gpuPower: number, temperatures: number[]) {
  return withAssemblyVerificationMeasurements({ ...emptyAssemblyVerificationLog("build-fingerprint", timestamp), runLabel: label }, {
    loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, measurementSource: "csv", measurementSeries: temperatures.map((cpuTemp, index) => ({ sampleIndex: index, elapsedSeconds: index * 60, cpuTempC: cpuTemp, gpuTempC: gpuPeak - (temperatures.length - index - 1), cpuUsagePercent: 95, gpuUsagePercent: 90, cpuPowerW: cpuPower, gpuPowerW: gpuPower }))
  }).log!;
}

function historyForSummary() {
  const first = runFor("2026-09-01T00:00:00.000Z", "조립 직후", 70, 60, 120, 250, [60, 65, 70]);
  const second = runFor("2026-09-02T00:00:00.000Z", "드라이버 설치 후", 65, 55, 110, 230, [55, 60, 65]);
  const third = runFor("2026-09-03T00:00:00.000Z", "장시간 부하 후", 80, 70, 140, 300, [65, 72, 80]);
  return { type: "pc-supporter-assembly-verification-history" as const, schemaVersion: 1 as const, buildFingerprint: "build-fingerprint", updatedAt: third.updatedAt, activeRunId: third.runId!, runs: [first, second, third] };
}

describe("assembly verification comparison summary", () => {
  it("ranks selected runs by observed peak temperature and reports baseline deltas", () => {
    const history = historyForSummary();
    const summary = assemblyVerificationComparisonSummaryFor(history, history.activeRunId);

    expect(summary).toMatchObject({ overlay: { runCount: 3 }, baselineRunId: history.runs[0].runId, latestRunId: history.runs[2].runId });
    expect(summary.cpuPeakRows.map((row) => row.runLabel)).toEqual(["드라이버 설치 후", "조립 직후", "장시간 부하 후"]);
    expect(summary.cpuPeakRows[0]).toMatchObject({ rank: 1, value: 65, baselineDelta: -5, detail: "CPU 최고 65°C" });
    expect(summary.gpuPowerRows.find((row) => row.runId === history.runs[2].runId)).toMatchObject({ value: 300, baselineDelta: 50, detail: "GPU 평균 300W · 관찰 순" });
  });

  it("ranks a run with observed stabilization before a run without stabilization", () => {
    const first = withAssemblyVerificationMeasurements({ ...emptyAssemblyVerificationLog("build-fingerprint", "2026-09-01T00:00:00.000Z"), runLabel: "불안정 회차" }, { loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, measurementSource: "csv", measurementSeries: [{ sampleIndex: 0, elapsedSeconds: 0, cpuTempC: 60, cpuUsagePercent: 95, gpuUsagePercent: 10 }, { sampleIndex: 1, elapsedSeconds: 60, cpuTempC: 70, cpuUsagePercent: 95, gpuUsagePercent: 10 }, { sampleIndex: 2, elapsedSeconds: 120, cpuTempC: 75, cpuUsagePercent: 95, gpuUsagePercent: 10 }, { sampleIndex: 3, elapsedSeconds: 180, cpuTempC: 75, cpuUsagePercent: 95, gpuUsagePercent: 10 }] }).log!;
    const second = withAssemblyVerificationMeasurements({ ...emptyAssemblyVerificationLog("build-fingerprint", "2026-09-02T00:00:00.000Z"), runLabel: "안정화 회차" }, { loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, measurementSource: "csv", measurementSeries: [{ sampleIndex: 0, elapsedSeconds: 0, cpuTempC: 60, cpuUsagePercent: 95, gpuUsagePercent: 10 }, { sampleIndex: 1, elapsedSeconds: 60, cpuTempC: 68, cpuUsagePercent: 95, gpuUsagePercent: 10 }, { sampleIndex: 2, elapsedSeconds: 120, cpuTempC: 69, cpuUsagePercent: 95, gpuUsagePercent: 10 }, { sampleIndex: 3, elapsedSeconds: 180, cpuTempC: 69, cpuUsagePercent: 95, gpuUsagePercent: 10 }] }).log!;
    const history = { type: "pc-supporter-assembly-verification-history" as const, schemaVersion: 1 as const, buildFingerprint: "build-fingerprint", updatedAt: second.updatedAt, activeRunId: second.runId!, runs: [first, second] };
    const summary = assemblyVerificationComparisonSummaryFor(history, second.runId);

    expect(summary.cpuStabilityRows[0]).toMatchObject({ runId: second.runId, rank: 1, value: 60, detail: "1/1개 구간 · 안정화 확인 · 60초 이후" });
    expect(summary.cpuStabilityRows.find((row) => row.runId === first.runId)).toMatchObject({ detail: "0/1개 구간 · 안정화 미확인" });
  });

  it("keeps a one-run selection labeled as insufficient comparison", () => {
    const history = historyForSummary();
    const summary = assemblyVerificationComparisonSummaryFor(history, history.runs[1].runId!, [history.runs[1].runId!]);

    expect(summary).toMatchObject({ overlay: { runCount: 1 }, reason: "insufficient-comparison" });
    expect(summary.cpuPeakRows).toHaveLength(1);
  });
});
