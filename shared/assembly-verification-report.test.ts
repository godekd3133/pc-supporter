import { describe, expect, it } from "vitest";
import { assemblyVerificationReportCsvFor, assemblyVerificationReportFor, assemblyVerificationReportJsonFor, assemblyVerificationReportTextFor } from "./assembly-verification-report";
import { emptyAssemblyVerificationLog, withAssemblyVerificationMeasurements } from "./assembly-verification";

function measuredRun(timestamp: string, label: string, cpu: number, gpu: number, ambient: number, cpuFan: number, gpuFan: number, noiseLevel: "quiet" | "normal" | "loud") {
  const log = emptyAssemblyVerificationLog("build-fingerprint", timestamp);
  return withAssemblyVerificationMeasurements({ ...log, runLabel: label }, {
    loadTool: "occt",
    loadScenario: "mixed",
    testDurationMinutes: 20,
    cpuMaxTempC: cpu,
    gpuMaxTempC: gpu,
    ambientTempC: ambient,
    cpuFanRpm: cpuFan,
    gpuFanRpm: gpuFan,
    noiseLevel,
    measurementSource: "csv",
    measurementSourceLabel: "hwinfo.csv",
    measurementSampleCount: 120,
    measurementQuality: { status: "complete", rowCount: 120, validSampleCount: 120, skippedRowCount: 0, invalidValueCount: 0, recognizedCoreColumnCount: 5, coreColumnCount: 5, telemetryColumnCount: 6, hasTimeAxis: true, seriesPointCount: 2, continuity: { status: "continuous", timestampCount: 2, unparsedTimestampCount: 0, sampleIntervalSeconds: 60, observedDurationSeconds: 60, gapCount: 0, nonMonotonicCount: 0, estimatedMissingSamples: 0, gapToleranceSeconds: 120 } },
    measurementSeries: [{ sampleIndex: 0, elapsedSeconds: 0, cpuTempC: cpu - 4, gpuTempC: gpu - 4, cpuUsagePercent: 95, gpuUsagePercent: 98, cpuClockMHz: 4500, gpuClockMHz: 2500, cpuPowerW: 120, gpuPowerW: 300 }, { sampleIndex: 1, elapsedSeconds: 60, cpuTempC: cpu, gpuTempC: gpu, cpuUsagePercent: 100, gpuUsagePercent: 99, cpuClockMHz: 4600, gpuClockMHz: 2600, cpuPowerW: 140, gpuPowerW: 320 }]
  }).log!;
}

function historyForReport() {
  const first = measuredRun("2026-09-01T00:00:00.000Z", "조립 직후", 70, 60, 24, 1000, 1100, "quiet");
  const second = measuredRun("2026-09-02T00:00:00.000Z", "드라이버 설치 후", 75, 65, 25, 1200, 1300, "normal");
  const third = measuredRun("2026-09-03T00:00:00.000Z", "장시간 부하 후", 82, 70, 26, 1400, 1500, "loud");
  return { type: "pc-supporter-assembly-verification-history" as const, schemaVersion: 1 as const, buildFingerprint: "build-fingerprint", updatedAt: third.updatedAt, activeRunId: third.runId!, runs: [first, second, third] };
}

describe("assembly verification report", () => {
  it("combines same-condition deltas, measurement provenance, and recheck signals", () => {
    const history = historyForReport();
    const report = assemblyVerificationReportFor(history, "same-load", undefined, "2026-09-04T00:00:00.000Z");
    const subsetReport = assemblyVerificationReportFor(history, "same-load", history.runs[2].runId, "2026-09-04T00:00:00.000Z", [history.runs[1].runId!]);

    expect(report).toMatchObject({ type: "pc-supporter-assembly-verification-report", schemaVersion: 1, generatedAt: "2026-09-04T00:00:00.000Z", filter: "same-load", runs: [{ index: 1, loadProfile: { segments: [{ kind: "mixed", pointCount: 2 }] } }, { cpuDeltaC: 5 }, { cpuDeltaC: 7, measurementSource: "csv", measurementSeriesPointCount: 2 }] });
    expect(report.signals.map((signal) => signal.id)).toEqual(expect.arrayContaining(["cpu-temperature-rise", "gpu-temperature-rise", "fan-rpm-rise", "noise-rise"]));
    expect(subsetReport.telemetryOverlay).toMatchObject({ runCount: 1, runs: [{ runId: history.runs[1].runId, runLabel: "드라이버 설치 후" }] });
  });

  it("writes a readable report with its non-certification boundary", () => {
    const text = assemblyVerificationReportTextFor(assemblyVerificationReportFor(historyForReport(), "all", undefined, "2026-09-04T00:00:00.000Z"));

    expect(text).toContain("# PC Supporter 실측 리포트");
    expect(text).toContain("## 재확인 신호");
    expect(text).toContain("CSV · hwinfo.csv · 원본 120샘플 · 시계열 2점");
    expect(text).toContain("측정 입력 품질: complete");
    expect(text).toContain("시간축 연속성 연속");
    expect(text).toContain("시계열 관찰: CPU 상승");
    expect(text).toContain("CPU 사용률 평균 97.5% · 최고 100%");
    expect(text).toContain("부하 구간: 혼합 부하 2점");
    expect(text).toContain("이전 동일 조건 비교:");
    expect(text).toContain("안전 인증·고장 확정이 아닙니다.");
  });

  it("serializes a spreadsheet-safe CSV and compact JSON without raw series", () => {
    const history = historyForReport();
    history.runs[0].runLabel = "OCCT, 조립 직후";
    const report = assemblyVerificationReportFor(history, "all", undefined, "2026-09-04T00:00:00.000Z");
    const csv = assemblyVerificationReportCsvFor(report);
    const json = JSON.parse(assemblyVerificationReportJsonFor(report)) as { type: string; runs: Array<Record<string, unknown>> };

    expect(csv.startsWith("\uFEFF회차,회차 이름,runId")).toBe(true);
    expect(csv).toContain('"OCCT, 조립 직후"');
    expect(csv).toContain("시계열 2점");
    expect(csv).toContain("이전 동일 조건 비교");
    expect(json.type).toBe("pc-supporter-assembly-verification-report");
    expect(json.runs[0]).not.toHaveProperty("measurementSeries");
  });
});
