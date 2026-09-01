import { describe, expect, it } from "vitest";
import { assemblyVerificationTelemetryOverlayFor } from "./assembly-verification-overlay";
import { emptyAssemblyVerificationLog, withAssemblyVerificationMeasurements } from "./assembly-verification";

function runFor(timestamp: string, label: string, cpuOffset: number) {
  return withAssemblyVerificationMeasurements({ ...emptyAssemblyVerificationLog("build-fingerprint", timestamp), runLabel: label }, {
    loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, measurementSource: "csv", measurementSeries: [
      { sampleIndex: 0, elapsedSeconds: 0, cpuTempC: 50 + cpuOffset, gpuTempC: 45 + cpuOffset, cpuUsagePercent: 80, gpuUsagePercent: 85 },
      { sampleIndex: 1, elapsedSeconds: 60, cpuTempC: 60 + cpuOffset, gpuTempC: 55 + cpuOffset, cpuUsagePercent: 90, gpuUsagePercent: 90 },
      { sampleIndex: 2, elapsedSeconds: 120, cpuTempC: 70 + cpuOffset, gpuTempC: 65 + cpuOffset, cpuUsagePercent: 100, gpuUsagePercent: 95 }
    ]
  }).log!;
}

describe("assembly verification telemetry overlay", () => {
  it("normalizes matching runs to progress percentages while retaining run summaries", () => {
    const first = runFor("2026-09-01T00:00:00.000Z", "조립 직후", 0);
    const second = runFor("2026-09-02T00:00:00.000Z", "드라이버 설치 후", -3);
    const history = { type: "pc-supporter-assembly-verification-history" as const, schemaVersion: 1 as const, buildFingerprint: "build-fingerprint", updatedAt: second.updatedAt, activeRunId: second.runId!, runs: [first, second] };

    const overlay = assemblyVerificationTelemetryOverlayFor(history, second.runId);

    expect(overlay).toMatchObject({ filter: "same-load", runCount: 2, bucketCount: 24, conditionKey: "occt:mixed:20", runs: [{ runLabel: "조립 직후", originalPointCount: 3, cpuTempFirst: 50, cpuTempLast: 70, cpuTempPeak: 70, cpuUsageMean: 90 }, { runLabel: "드라이버 설치 후", cpuTempFirst: 47, cpuTempLast: 67, cpuTempPeak: 67 }] });
    expect(overlay.runs[0].points).toHaveLength(24);
    expect(overlay.runs[0].points[0]).toMatchObject({ progressPercent: 0, cpuTempC: 50, gpuTempC: 45 });
    expect(overlay.runs[0].points.at(-1)).toMatchObject({ progressPercent: 100, cpuTempC: 70, gpuTempC: 65 });
  });

  it("does not create an overlay when the reference condition is incomplete", () => {
    const run = withAssemblyVerificationMeasurements({ ...emptyAssemblyVerificationLog("build-fingerprint"), measurementSource: "csv" }, { measurementSeries: [{ sampleIndex: 0, cpuTempC: 50 }, { sampleIndex: 1, cpuTempC: 55 }] }).log!;
    const history = { type: "pc-supporter-assembly-verification-history" as const, schemaVersion: 1 as const, buildFingerprint: "build-fingerprint", updatedAt: run.updatedAt, activeRunId: run.runId!, runs: [run] };

    expect(assemblyVerificationTelemetryOverlayFor(history)).toMatchObject({ runCount: 0, runs: [], reason: "reference-condition-missing" });
  });

  it("reports missing comparable series instead of inventing a line", () => {
    const run = withAssemblyVerificationMeasurements({ ...emptyAssemblyVerificationLog("build-fingerprint"), loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, measurementSource: "csv" }, { loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, measurementSeries: [{ sampleIndex: 0, cpuTempC: 50 }] }).log!;
    const history = { type: "pc-supporter-assembly-verification-history" as const, schemaVersion: 1 as const, buildFingerprint: "build-fingerprint", updatedAt: run.updatedAt, activeRunId: run.runId!, runs: [run] };

    expect(assemblyVerificationTelemetryOverlayFor(history)).toMatchObject({ runCount: 0, runs: [], reason: "no-matching-run-series" });
  });

  it("supports an explicit subset and bucket count for focused review", () => {
    const first = runFor("2026-09-01T00:00:00.000Z", "조립 직후", 0);
    const second = runFor("2026-09-02T00:00:00.000Z", "드라이버 설치 후", -3);
    const history = { type: "pc-supporter-assembly-verification-history" as const, schemaVersion: 1 as const, buildFingerprint: "build-fingerprint", updatedAt: second.updatedAt, activeRunId: second.runId!, runs: [first, second] };

    const overlay = assemblyVerificationTelemetryOverlayFor(history, second.runId, { includedRunIds: [second.runId!], bucketCount: 12 });

    expect(overlay).toMatchObject({ runCount: 1, bucketCount: 12, runs: [{ runId: second.runId, runLabel: "드라이버 설치 후" }] });
    expect(overlay.runs[0].points).toHaveLength(12);
  });

  it("excludes review-quality or gapped runs from overlay lines", () => {
    const valid = runFor("2026-09-01T00:00:00.000Z", "정상 회차", 0);
    const gapped = { ...runFor("2026-09-02T00:00:00.000Z", "공백 회차", -3), measurementSeries: [{ sampleIndex: 0, elapsedSeconds: 0, cpuTempC: 47, gpuTempC: 42, cpuUsagePercent: 80, gpuUsagePercent: 85 }, { sampleIndex: 1, elapsedSeconds: 60, cpuTempC: 57, gpuTempC: 52, cpuUsagePercent: 90, gpuUsagePercent: 90 }, { sampleIndex: 2, elapsedSeconds: 120, cpuTempC: 64, gpuTempC: 59, cpuUsagePercent: 95, gpuUsagePercent: 92 }, { sampleIndex: 3, elapsedSeconds: 360, cpuTempC: 67, gpuTempC: 62, cpuUsagePercent: 95, gpuUsagePercent: 92 }, { sampleIndex: 4, elapsedSeconds: 420, cpuTempC: 67, gpuTempC: 62, cpuUsagePercent: 95, gpuUsagePercent: 92 }], measurementQuality: { status: "review" as const, rowCount: 5, validSampleCount: 5, skippedRowCount: 0, invalidValueCount: 0, recognizedCoreColumnCount: 5, coreColumnCount: 5, telemetryColumnCount: 0, hasTimeAxis: true, seriesPointCount: 5, continuity: { status: "gapped" as const, timestampCount: 5, unparsedTimestampCount: 0, gapCount: 1, largestGapSeconds: 240, nonMonotonicCount: 0, estimatedMissingSamples: 3, sampleIntervalSeconds: 60, gapToleranceSeconds: 120 } } };
    const history = { type: "pc-supporter-assembly-verification-history" as const, schemaVersion: 1 as const, buildFingerprint: "build-fingerprint", updatedAt: gapped.updatedAt, activeRunId: gapped.runId!, runs: [valid, gapped] };

    expect(assemblyVerificationTelemetryOverlayFor(history, gapped.runId)).toMatchObject({ runCount: 1, runs: [{ runId: valid.runId, runLabel: "정상 회차" }] });
    expect(assemblyVerificationTelemetryOverlayFor(history, gapped.runId, { includeReviewQuality: true })).toMatchObject({ runCount: 2, runs: [{ runId: valid.runId }, { runId: gapped.runId, measurementQualityStatus: "review", measurementContinuityStatus: "gapped", gapProgressPercents: [75] }] });
  });
});
