import { describe, expect, it } from "vitest";
import { assemblyVerificationLoadProfileComparisonFor, assemblyVerificationLoadProfileFor } from "./assembly-verification-load";
import { emptyAssemblyVerificationLog, withAssemblyVerificationMeasurements } from "./assembly-verification";

describe("assembly verification load profile", () => {
  it("splits contiguous points into idle, CPU, mixed, and GPU load segments", () => {
    const profile = assemblyVerificationLoadProfileFor([
      { sampleIndex: 0, elapsedSeconds: 0, cpuUsagePercent: 5, gpuUsagePercent: 10, cpuTempC: 40, gpuTempC: 35, cpuPowerW: 30, gpuPowerW: 20 },
      { sampleIndex: 1, elapsedSeconds: 60, cpuUsagePercent: 95, gpuUsagePercent: 10, cpuTempC: 60, gpuTempC: 45, cpuPowerW: 100, gpuPowerW: 50 },
      { sampleIndex: 2, elapsedSeconds: 120, cpuUsagePercent: 98, gpuUsagePercent: 15, cpuTempC: 70, gpuTempC: 50, cpuPowerW: 120, gpuPowerW: 60 },
      { sampleIndex: 3, elapsedSeconds: 180, cpuUsagePercent: 90, gpuUsagePercent: 90, cpuTempC: 80, gpuTempC: 70, cpuPowerW: 130, gpuPowerW: 280 },
      { sampleIndex: 4, elapsedSeconds: 240, cpuUsagePercent: 10, gpuUsagePercent: 95, cpuTempC: 70, gpuTempC: 75, cpuPowerW: 50, gpuPowerW: 300 }
    ]);

    expect(profile).toMatchObject({ pointCount: 5, usagePointCount: 5, usageCoveragePercent: 100, classifiedPointCount: 5, unclassifiedPointCount: 0, segments: [{ kind: "idle" }, { kind: "cpu", pointCount: 2 }, { kind: "mixed" }, { kind: "gpu" }] });
    expect(profile.segments[1]).toMatchObject({ label: "CPU 부하", durationSeconds: 60, cpuUsageMean: 96.5, cpuUsageMax: 98, cpuTempFirst: 60, cpuTempLast: 70, cpuTempDelta: 10, cpuPowerMean: 110, cpuTempChangePer100W: 9.1, cpuTempStability: { stabilized: false, windowPointCount: 2 } });
    expect(profile.segments[1].reason).toContain("CPU 사용률 평균 96.5%");

    const stableProfile = assemblyVerificationLoadProfileFor([
      { sampleIndex: 0, elapsedSeconds: 0, cpuUsagePercent: 95, gpuUsagePercent: 10, cpuTempC: 60 },
      { sampleIndex: 1, elapsedSeconds: 60, cpuUsagePercent: 96, gpuUsagePercent: 12, cpuTempC: 70 },
      { sampleIndex: 2, elapsedSeconds: 120, cpuUsagePercent: 97, gpuUsagePercent: 10, cpuTempC: 71 },
      { sampleIndex: 3, elapsedSeconds: 180, cpuUsagePercent: 96, gpuUsagePercent: 11, cpuTempC: 71 },
      { sampleIndex: 4, elapsedSeconds: 240, cpuUsagePercent: 96, gpuUsagePercent: 10, cpuTempC: 70.5 }
    ]);
    expect(stableProfile.segments[0].cpuTempStability).toMatchObject({ stabilized: true, windowPointCount: 4, windowSpreadC: 1, stabilizedAfterSeconds: 60 });
  });

  it("keeps partial and unknown points visible instead of inventing a load type", () => {
    const profile = assemblyVerificationLoadProfileFor([
      { sampleIndex: 0, elapsedSeconds: 0, cpuTempC: 40 },
      { sampleIndex: 1, elapsedSeconds: 60, cpuUsagePercent: 80, cpuTempC: 60 },
      { sampleIndex: 2, elapsedSeconds: 120, gpuTempC: 70 }
    ]);

    expect(profile).toMatchObject({ usagePointCount: 1, usageCoveragePercent: 33, classifiedPointCount: 1, unclassifiedPointCount: 2, segments: [{ kind: "partial" }] });
    expect(profile.segments.map((segment) => segment.kind)).toEqual(["partial"]);
  });

  it("reports a clear reason when no usage telemetry exists", () => {
    const profile = assemblyVerificationLoadProfileFor([{ sampleIndex: 0, cpuTempC: 50 }, { sampleIndex: 1, cpuTempC: 55 }]);

    expect(profile).toMatchObject({ pointCount: 2, usagePointCount: 0, usageCoveragePercent: 0, classifiedPointCount: 0, unclassifiedPointCount: 2, segments: [], reason: "usage-not-recorded" });
  });

  it("compares matching load segments with the previous same-condition run only", () => {
    const first = withAssemblyVerificationMeasurements(emptyAssemblyVerificationLog("build-fingerprint", "2026-09-01T00:00:00.000Z"), {
      loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, measurementSource: "csv",
      cpuMaxTempC: 75, measurementSeries: [
        { sampleIndex: 0, elapsedSeconds: 0, cpuUsagePercent: 95, gpuUsagePercent: 10, cpuTempC: 60 },
        { sampleIndex: 1, elapsedSeconds: 60, cpuUsagePercent: 96, gpuUsagePercent: 10, cpuTempC: 70 },
        { sampleIndex: 2, elapsedSeconds: 120, cpuUsagePercent: 96, gpuUsagePercent: 10, cpuTempC: 75 },
        { sampleIndex: 3, elapsedSeconds: 180, cpuUsagePercent: 95, gpuUsagePercent: 10, cpuTempC: 75 }
      ]
    }).log!;
    const second = withAssemblyVerificationMeasurements(emptyAssemblyVerificationLog("build-fingerprint", "2026-09-02T00:00:00.000Z"), {
      loadTool: "occt", loadScenario: "mixed", testDurationMinutes: 20, measurementSource: "csv",
      cpuMaxTempC: 69, measurementSeries: [
        { sampleIndex: 0, elapsedSeconds: 0, cpuUsagePercent: 95, gpuUsagePercent: 10, cpuTempC: 60 },
        { sampleIndex: 1, elapsedSeconds: 60, cpuUsagePercent: 96, gpuUsagePercent: 10, cpuTempC: 68 },
        { sampleIndex: 2, elapsedSeconds: 120, cpuUsagePercent: 96, gpuUsagePercent: 10, cpuTempC: 69 },
        { sampleIndex: 3, elapsedSeconds: 180, cpuUsagePercent: 95, gpuUsagePercent: 10, cpuTempC: 69 }
      ]
    }).log!;
    const changedCondition = withAssemblyVerificationMeasurements(emptyAssemblyVerificationLog("build-fingerprint", "2026-09-03T00:00:00.000Z"), {
      loadTool: "cinebench", loadScenario: "cpu", testDurationMinutes: 10, cpuMaxTempC: 70, measurementSource: "csv", measurementSeries: [{ sampleIndex: 0, elapsedSeconds: 0, cpuUsagePercent: 95, gpuUsagePercent: 10, cpuTempC: 70 }, { sampleIndex: 1, elapsedSeconds: 60, cpuUsagePercent: 95, gpuUsagePercent: 10, cpuTempC: 70 }]
    }).log!;
    const history = { type: "pc-supporter-assembly-verification-history" as const, schemaVersion: 1 as const, buildFingerprint: "build-fingerprint", updatedAt: changedCondition.updatedAt, activeRunId: second.runId!, runs: [first, second] };
    const sameCondition = assemblyVerificationLoadProfileComparisonFor(history, "same-load", second.runId);

    expect(sameCondition).toMatchObject({ previousRunId: first.runId, segments: [{ kind: "cpu", cpuTempLastDelta: -6, cpuStabilityChange: "improved" }] });
    expect(assemblyVerificationLoadProfileComparisonFor({ ...history, activeRunId: changedCondition.runId!, runs: [first, changedCondition] }, "all", changedCondition.runId)).toMatchObject({ reason: "different-condition", segments: [{ kind: "cpu" }] });
  });
});
