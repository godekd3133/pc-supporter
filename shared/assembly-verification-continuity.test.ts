import { describe, expect, it } from "vitest";
import { parseAssemblyVerificationCsv } from "./assembly-verification-csv";
import { assemblyVerificationLoadProfileFor } from "./assembly-verification-load";
import { assemblyVerificationComparisonFor, assemblyVerificationRecheckSignalsFor, emptyAssemblyVerificationLog, withAssemblyVerificationMeasurements } from "./assembly-verification";

describe("assembly verification timestamp continuity", () => {
  it("detects a long gap and estimates missing samples from the median interval", () => {
    const parsed = parseAssemblyVerificationCsv(["Time,CPU Package [°C]", "20:00,50", "20:01,60", "20:02,65", "20:03,68", "20:07,70"].join("\n"));

    expect(parsed.errors).toEqual([]);
    expect(parsed.import?.quality).toMatchObject({ status: "review", rowCount: 5, validSampleCount: 5, hasTimeAxis: true, continuity: { status: "gapped", timestampCount: 5, sampleIntervalSeconds: 60, observedDurationSeconds: 420, gapCount: 1, largestGapSeconds: 240, nonMonotonicCount: 0, estimatedMissingSamples: 3, gapToleranceSeconds: 120 } });
    expect(parsed.import?.warnings.some((warning) => warning.includes("시간축 공백 1개"))).toBe(true);
  });

  it("marks reverse timestamps as gapped instead of sorting them silently", () => {
    const parsed = parseAssemblyVerificationCsv(["Time,CPU Package [°C]", "20:00,50", "20:01,60", "20:00:30,65"].join("\n"));

    expect(parsed.errors).toEqual([]);
    expect(parsed.import?.quality.continuity).toMatchObject({ status: "gapped", timestampCount: 3, nonMonotonicCount: 1, gapCount: 0 });
  });

  it("lowers quality when a timestamp cell cannot be parsed even if other intervals are valid", () => {
    const parsed = parseAssemblyVerificationCsv(["Time,CPU Package [°C]", "20:00,50", "not-a-time,55", "20:01,60"].join("\n"));

    expect(parsed.errors).toEqual([]);
    expect(parsed.import?.quality).toMatchObject({ status: "review", continuity: { status: "continuous", timestampCount: 2, unparsedTimestampCount: 1 } });
    expect(parsed.import?.warnings.some((warning) => warning.includes("해석하지 못한 timestamp 1개"))).toBe(true);
  });

  it("keeps continuity unknown when the export has no time column", () => {
    const parsed = parseAssemblyVerificationCsv(["CPU Package [°C],GPU Temperature [°C]", "50,40", "55,45"].join("\n"));

    expect(parsed.errors).toEqual([]);
    expect(parsed.import?.quality).toMatchObject({ status: "partial", hasTimeAxis: false, continuity: { status: "unknown", timestampCount: 0, gapCount: 0, estimatedMissingSamples: 0 } });
    expect(parsed.import?.warnings.some((warning) => warning.includes("샘플 순서"))).toBe(true);
  });

  it("splits a same-kind load profile at a timestamp gap instead of merging both sides", () => {
    const profile = assemblyVerificationLoadProfileFor([
      { sampleIndex: 0, elapsedSeconds: 0, cpuUsagePercent: 95, gpuUsagePercent: 10, cpuTempC: 60 },
      { sampleIndex: 1, elapsedSeconds: 60, cpuUsagePercent: 95, gpuUsagePercent: 10, cpuTempC: 65 },
      { sampleIndex: 2, elapsedSeconds: 300, cpuUsagePercent: 95, gpuUsagePercent: 10, cpuTempC: 70 }
    ], 120);

    expect(profile.segments).toHaveLength(2);
    expect(profile.segments[0]).toMatchObject({ kind: "cpu", pointCount: 2 });
    expect(profile.segments[1]).toMatchObject({ kind: "cpu", pointCount: 1, breakBefore: "gap", gapBeforeSeconds: 240 });
  });

  it("blocks deltas for a review-quality or gapped run and emits a quality signal", () => {
    const first = withAssemblyVerificationMeasurements(emptyAssemblyVerificationLog("build-fingerprint", "2026-09-01T00:00:00.000Z"), { loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, cpuMaxTempC: 70, ambientTempC: 24 }).log!;
    const second = withAssemblyVerificationMeasurements(emptyAssemblyVerificationLog("build-fingerprint", "2026-09-02T00:00:00.000Z"), { loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, cpuMaxTempC: 80, ambientTempC: 24, measurementSource: "csv", measurementQuality: { status: "review", rowCount: 5, validSampleCount: 5, skippedRowCount: 0, invalidValueCount: 0, recognizedCoreColumnCount: 5, coreColumnCount: 5, telemetryColumnCount: 0, hasTimeAxis: true, seriesPointCount: 5, continuity: { status: "gapped", timestampCount: 5, unparsedTimestampCount: 0, sampleIntervalSeconds: 60, observedDurationSeconds: 420, gapCount: 1, largestGapSeconds: 240, nonMonotonicCount: 0, estimatedMissingSamples: 3, gapToleranceSeconds: 120 } } }).log!;
    const history = { type: "pc-supporter-assembly-verification-history" as const, schemaVersion: 1 as const, buildFingerprint: "build-fingerprint", updatedAt: second.updatedAt, activeRunId: second.runId!, runs: [first, second] };
    const comparison = assemblyVerificationComparisonFor(history, "same-load", second.runId);

    expect(comparison.points[1]).toMatchObject({ comparableToPrevious: false, comparisonBlockReason: "measurement-continuity-gapped" });
    expect(comparison.points[1].cpuDeltaC).toBeUndefined();
    expect(assemblyVerificationRecheckSignalsFor(comparison).map((signal) => signal.id)).toContain("measurement-quality-review");
  });
});
