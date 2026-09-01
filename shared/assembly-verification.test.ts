import { describe, expect, it } from "vitest";
import { ASSEMBLY_VERIFICATION_CHECKS, assemblyVerificationComparisonFor, assemblyVerificationHistoryJsonFor, assemblyVerificationJsonFor, assemblyVerificationProgressFor, assemblyVerificationRecheckSignalsFor, assemblyVerificationSavedHistoryFor, assemblyVerificationSavedSnapshotFor, assemblyVerificationSavedSnapshotFromUnknown, assemblyVerificationStateFor, assemblyVerificationTelemetryAnalysisFor, assemblyVerificationTrendFor, emptyAssemblyVerificationHistory, emptyAssemblyVerificationLog, parseAssemblyVerificationHistoryJson, parseAssemblyVerificationJson, withAssemblyVerificationCheck, withAssemblyVerificationMeasurements } from "./assembly-verification";

describe("assembly verification log", () => {
  it("starts with six unchecked real-build checks", () => {
    const log = emptyAssemblyVerificationLog("build-fingerprint", "2026-09-01T00:00:00.000Z");

    expect(ASSEMBLY_VERIFICATION_CHECKS).toHaveLength(6);
    expect(assemblyVerificationProgressFor(log)).toEqual({ total: 6, checked: 0, passed: 0, failed: 0, remaining: 6, percent: 0 });
    expect(assemblyVerificationStateFor(log)).toBe("not_started");
  });

  it("keeps failed checks visible while counting pass/fail results as checked", () => {
    let log = emptyAssemblyVerificationLog("build-fingerprint");
    log = withAssemblyVerificationCheck(log, "post", "pass", "BIOS 진입 확인");
    log = withAssemblyVerificationCheck(log, "fan-rgb", "fail", "후면 팬 미회전");

    expect(assemblyVerificationProgressFor(log)).toMatchObject({ total: 6, checked: 2, passed: 1, failed: 1, remaining: 4, percent: 33 });
    expect(assemblyVerificationStateFor(log)).toBe("failed");
    expect(log.checks["fan-rgb"]).toMatchObject({ status: "fail", note: "후면 팬 미회전" });
  });

  it("validates measured temperatures and noise before updating the log", () => {
    const log = emptyAssemblyVerificationLog("build-fingerprint");
    const updated = withAssemblyVerificationMeasurements(log, { cpuMaxTempC: "78.5", gpuMaxTempC: 72, noiseLevel: "normal", loadTool: "occt", loadScenario: "mixed", testDurationMinutes: "20", ambientTempC: "24", cpuFanRpm: "1200", gpuFanRpm: "1450", note: "OCCT 20분", measurementSource: "csv", measurementSourceLabel: "hwinfo.csv", measurementSampleCount: 120, measurementImportedAt: "2026-09-01T00:00:00.000Z", measurementSeries: [{ sampleIndex: 0, elapsedSeconds: 0, cpuTempC: 78.5, gpuTempC: 72 }, { sampleIndex: 1, elapsedSeconds: 60, cpuTempC: 78, gpuTempC: 71 }], measurementQuality: { status: "complete", rowCount: 120, validSampleCount: 120, skippedRowCount: 0, invalidValueCount: 0, recognizedCoreColumnCount: 5, coreColumnCount: 5, telemetryColumnCount: 6, hasTimeAxis: true, seriesPointCount: 2 } });

    expect(updated.errors).toEqual([]);
    expect(updated.log).toMatchObject({ cpuMaxTempC: 78.5, gpuMaxTempC: 72, noiseLevel: "normal", loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, ambientTempC: 24, cpuFanRpm: 1200, gpuFanRpm: 1450, note: "OCCT 20분", measurementSource: "csv", measurementSourceLabel: "hwinfo.csv", measurementSampleCount: 120, measurementImportedAt: "2026-09-01T00:00:00.000Z" });
    expect(updated.log?.measurementSeries).toHaveLength(2);
    expect(updated.log?.measurementQuality).toMatchObject({ status: "complete", validSampleCount: 120, recognizedCoreColumnCount: 5, telemetryColumnCount: 6, hasTimeAxis: true, seriesPointCount: 2 });
    expect(assemblyVerificationSavedSnapshotFor(updated.log!)).toMatchObject({ measurementSource: "csv", measurementSourceLabel: "hwinfo.csv", measurementSampleCount: 120, measurementImportedAt: "2026-09-01T00:00:00.000Z", measurementSeriesPointCount: 2 });
    expect(withAssemblyVerificationMeasurements(log, { cpuMaxTempC: 151, noiseLevel: "unknown", testDurationMinutes: 0, ambientTempC: 61, cpuFanRpm: 12.5 }).errors).toEqual(expect.arrayContaining(["CPU 최고 온도은 0~150°C 사이의 숫자여야 합니다.", "소음 수준 값이 올바르지 않습니다.", "테스트 시간은 1~1440 사이의 정수여야 합니다.", "주변 온도은 0~60 사이의 숫자여야 합니다.", "CPU 팬 RPM은 0~30000 사이의 정수여야 합니다."]));
  });

  it("round-trips only for the same build fingerprint", () => {
    const log = emptyAssemblyVerificationLog("build-fingerprint", "2026-09-01T00:00:00.000Z");
    const json = assemblyVerificationJsonFor(withAssemblyVerificationCheck(log, "bios", "pass"));
    const parsed = parseAssemblyVerificationJson(json, "build-fingerprint");
    const wrongBuild = parseAssemblyVerificationJson(json, "other-build");

    expect(parsed.errors).toEqual([]);
    expect(parsed.log?.checks.bios.status).toBe("pass");
    expect(wrongBuild.log).toBeUndefined();
    expect(wrongBuild.errors[0]).toContain("다른 조립 검증 로그");
  });

  it("creates a compact share-safe snapshot without per-check notes", () => {
    let log = emptyAssemblyVerificationLog("build-fingerprint", "2026-09-01T00:00:00.000Z");
    log = withAssemblyVerificationCheck(log, "post", "pass", "BIOS 진입 확인");
    const measured = withAssemblyVerificationMeasurements(log, { loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, ambientTempC: 24, cpuMaxTempC: 78.5, gpuMaxTempC: 72, noiseLevel: "normal" });
    const snapshot = assemblyVerificationSavedSnapshotFor(measured.log!);

    expect(snapshot).toMatchObject({ type: "pc-supporter-assembly-verification-summary", state: "in_progress", checked: 1, passed: 1, failed: 0, loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, ambientTempC: 24, cpuMaxTempC: 78.5, gpuMaxTempC: 72, noiseLevel: "normal" });
    expect(snapshot).not.toHaveProperty("note");
    expect(assemblyVerificationSavedSnapshotFromUnknown(snapshot)).toEqual(snapshot);
    expect(assemblyVerificationSavedSnapshotFromUnknown({ ...snapshot, checked: 6 })).toBeUndefined();
  });

  it("upgrades legacy single-run JSON and round-trips a multi-run history", () => {
    const first = withAssemblyVerificationCheck(emptyAssemblyVerificationLog("build-fingerprint", "2026-09-01T00:00:00.000Z"), "post", "pass");
    const second = withAssemblyVerificationCheck({ ...emptyAssemblyVerificationLog("build-fingerprint", "2026-09-02T00:00:00.000Z"), runLabel: "드라이버 설치 후" }, "bios", "pass");
    const history = { type: "pc-supporter-assembly-verification-history" as const, schemaVersion: 1 as const, buildFingerprint: "build-fingerprint", updatedAt: "2026-09-02T00:00:00.000Z", activeRunId: second.runId!, runs: [first, second] };
    const parsed = parseAssemblyVerificationHistoryJson(assemblyVerificationHistoryJsonFor(history), "build-fingerprint");
    const legacy = parseAssemblyVerificationHistoryJson(assemblyVerificationJsonFor(first), "build-fingerprint");

    expect(parsed.errors).toEqual([]);
    expect(parsed.history?.runs).toHaveLength(2);
    expect(parsed.history?.activeRunId).toBe(second.runId);
    expect(parsed.history?.runs[1].runLabel).toBe("드라이버 설치 후");
    expect(legacy.errors).toEqual([]);
    expect(legacy.history?.runs).toHaveLength(1);
    expect(assemblyVerificationSavedHistoryFor(history)).toHaveLength(2);
    expect(assemblyVerificationTrendFor(history)).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 1, runLabel: first.runLabel, checked: 1 }),
      expect.objectContaining({ index: 2, runLabel: second.runLabel, checked: 1 })
    ]));
    expect(parseAssemblyVerificationHistoryJson(assemblyVerificationHistoryJsonFor({ ...history, activeRunId: "missing" }), "build-fingerprint").errors[0]).toContain("activeRunId");
    expect(emptyAssemblyVerificationHistory("build-fingerprint").runs).toHaveLength(1);
  });

  it("calculates ambient-adjusted deltas only between matching load conditions", () => {
    const first = withAssemblyVerificationMeasurements(emptyAssemblyVerificationLog("build-fingerprint", "2026-09-01T00:00:00.000Z"), { loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, ambientTempC: 24, cpuMaxTempC: 70, gpuMaxTempC: 60, cpuFanRpm: 1000, gpuFanRpm: 1000, noiseLevel: "quiet" }).log!;
    const second = withAssemblyVerificationMeasurements(emptyAssemblyVerificationLog("build-fingerprint", "2026-09-02T00:00:00.000Z"), { loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, ambientTempC: 26, cpuMaxTempC: 75, gpuMaxTempC: 65, cpuFanRpm: 1200, gpuFanRpm: 1100, noiseLevel: "normal" }).log!;
    const third = withAssemblyVerificationMeasurements(emptyAssemblyVerificationLog("build-fingerprint", "2026-09-03T00:00:00.000Z"), { loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, ambientTempC: 28, cpuMaxTempC: 82, gpuMaxTempC: 70, cpuFanRpm: 1400, gpuFanRpm: 1200, noiseLevel: "loud" }).log!;
    const different = withAssemblyVerificationMeasurements(emptyAssemblyVerificationLog("build-fingerprint", "2026-09-04T00:00:00.000Z"), { loadTool: "cinebench", loadScenario: "cpu", testDurationMinutes: 20, ambientTempC: 24, cpuMaxTempC: 80 }).log!;
    const history = { type: "pc-supporter-assembly-verification-history" as const, schemaVersion: 1 as const, buildFingerprint: "build-fingerprint", updatedAt: "2026-09-04T00:00:00.000Z", activeRunId: third.runId!, runs: [first, second, third, different] };
    const all = assemblyVerificationComparisonFor(history, "all", different.runId);
    const sameLoad = assemblyVerificationComparisonFor(history, "same-load", third.runId);

    expect(all.points[1]).toMatchObject({ comparableToPrevious: true, cpuDeltaC: 5, gpuDeltaC: 5, cpuAmbientAdjustedC: 49, gpuAmbientAdjustedC: 39, cpuAmbientAdjustedDeltaC: 3, gpuAmbientAdjustedDeltaC: 3 });
    expect(all.points[2]).toMatchObject({ comparableToPrevious: true, cpuDeltaC: 7, cpuAmbientAdjustedDeltaC: 5 });
    expect(all.points[3]).toMatchObject({ comparableToPrevious: false });
    expect(all.points[3].cpuDeltaC).toBeUndefined();
    expect(sameLoad.points).toHaveLength(3);
    expect(sameLoad.points[1]).toMatchObject({ runId: second.runId, cpuDeltaC: 5 });
    expect(sameLoad.points[2]).toMatchObject({ runId: third.runId, cpuDeltaC: 7 });
    expect(assemblyVerificationRecheckSignalsFor(sameLoad).map((signal) => signal.id)).toEqual(expect.arrayContaining(["cpu-temperature-rise", "gpu-temperature-rise", "fan-rpm-rise", "noise-rise"]));
    const analysis = assemblyVerificationTelemetryAnalysisFor([
      { sampleIndex: 0, elapsedSeconds: 0, cpuTempC: 70, gpuTempC: 60 },
      { sampleIndex: 1, elapsedSeconds: 60, cpuTempC: 75, gpuTempC: 65, cpuUsagePercent: 80, cpuPowerW: 100 },
      { sampleIndex: 2, elapsedSeconds: 120, cpuTempC: 82, gpuTempC: 70, cpuUsagePercent: 100, cpuPowerW: 140 }
    ]);
    expect(analysis).toMatchObject({ pointCount: 3, timeBased: true, elapsedSeconds: 120 });
    expect(analysis.metrics.cpuTempC).toMatchObject({ first: 70, last: 82, delta: 12, trend: "rising", stepCount: 2, positiveStepCount: 2, peakAtSeconds: 120, ratePerMinute: 6, lastStepDelta: 7, finalWindowSpread: 12 });
    expect(analysis.metrics.cpuUsagePercent).toMatchObject({ first: 80, last: 100, mean: 90, delta: 20, trend: "rising", stepCount: 1, positiveStepCount: 1 });
    expect(analysis.metrics.cpuPowerW).toMatchObject({ mean: 120, max: 140 });
  });
});
