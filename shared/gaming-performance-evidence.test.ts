import { describe, expect, it } from "vitest";
import { gamingPerformanceAssessmentFor, gamingPerformanceEvidenceBatchValidationFor, gamingPerformanceEvidenceFromJson, gamingPerformanceEvidenceRecordFromUnknown, gamingPerformanceEvidenceRequestFor, gamingPerformanceEvidenceRequestFromJson, gamingPerformanceEvidenceSummaryFor } from "./gaming-performance-evidence";

const record = (overrides: Record<string, unknown> = {}) => ({
  id: "evidence-cyberpunk-7900xtx",
  gameId: "cyberpunk",
  gpuPartId: "gpu-7900xtx",
  gpuName: "AMD Radeon RX 7900 XTX",
  resolution: "4k",
  refreshRate: 144,
  graphicsPreset: "high",
  rayTracing: true,
  upscaling: "quality",
  averageFps: 92,
  onePercentLowFps: 68,
  driverVersion: "24.5.1",
  measuredAt: "2026-09-01T00:00:00.000Z",
  sourceKind: "independent_review",
  sourceUrl: "https://example.com/review",
  sourceNote: "고정 드라이버·동일 장면 측정",
  ...overrides
});

const condition = {
  gameId: "cyberpunk",
  resolution: "4k" as const,
  refreshRate: 144 as const,
  graphicsPreset: "high" as const,
  rayTracing: true,
  upscaling: "quality" as const,
  gpuPartId: "gpu-7900xtx"
};

describe("gaming performance evidence contract", () => {
  it("accepts a fully sourced record and rejects unsafe evidence values", () => {
    expect(gamingPerformanceEvidenceRecordFromUnknown(record())).toMatchObject({ averageFps: 92, onePercentLowFps: 68, sourceKind: "independent_review" });
    expect(gamingPerformanceEvidenceRecordFromUnknown(record({ sourceUrl: "http://example.com/review" }))).toBeNull();
    expect(gamingPerformanceEvidenceRecordFromUnknown(record({ onePercentLowFps: 120 }))).toBeNull();
  });

  it("deduplicates valid JSON records and fails closed for oversized input", () => {
    expect(gamingPerformanceEvidenceFromJson(JSON.stringify([record(), record(), { ...record(), id: "invalid", averageFps: 0 }]))).toHaveLength(1);
    expect(gamingPerformanceEvidenceFromJson(JSON.stringify(Array.from({ length: 5_001 }, () => record())))).toEqual([]);
  });

  it("returns actionable batch validation errors before an admin save", () => {
    const validation = gamingPerformanceEvidenceBatchValidationFor({ items: [record(), record(), record({ id: "invalid", gpuPartId: undefined })] });
    expect(validation).toMatchObject({ valid: false, validCount: 1, invalidCount: 2, duplicateIds: ["evidence-cyberpunk-7900xtx"] });
    expect(validation.errors.map((error) => error.message)).toEqual(expect.arrayContaining(["같은 자료 ID가 중복되었습니다.", "필수 조건·GPU ID·출처 URL·측정값을 확인해 주세요."]));
  });

  it("keeps not-recorded, missing, partial, stale, and verified states separate", () => {
    expect(gamingPerformanceEvidenceSummaryFor([], [condition], "2026-09-10T00:00:00.000Z")).toMatchObject({ status: "not_recorded" });
    expect(gamingPerformanceEvidenceSummaryFor([gamingPerformanceEvidenceRecordFromUnknown(record({ averageFps: 160 }))!], [{ ...condition, gameId: "pubg" }], "2026-09-10T00:00:00.000Z")).toMatchObject({ status: "missing" });
    expect(gamingPerformanceEvidenceSummaryFor([gamingPerformanceEvidenceRecordFromUnknown(record({ averageFps: 160 }))!], [condition, { ...condition, gameId: "pubg" }], "2026-09-10T00:00:00.000Z")).toMatchObject({ status: "partial", matchedGameIds: ["cyberpunk"], missingGameIds: ["pubg"] });
    expect(gamingPerformanceEvidenceSummaryFor([gamingPerformanceEvidenceRecordFromUnknown(record({ measuredAt: "2025-01-01T00:00:00.000Z" }))!], [condition], "2026-09-10T00:00:00.000Z")).toMatchObject({ status: "stale", staleRecordIds: ["evidence-cyberpunk-7900xtx"] });
    expect(gamingPerformanceEvidenceSummaryFor([gamingPerformanceEvidenceRecordFromUnknown(record())!], [condition], "2026-09-10T00:00:00.000Z")).toMatchObject({ status: "target_not_met", matchedGameIds: ["cyberpunk"], belowTargetRecordIds: ["evidence-cyberpunk-7900xtx"] });
    expect(gamingPerformanceEvidenceSummaryFor([gamingPerformanceEvidenceRecordFromUnknown(record({ averageFps: 160 }))!], [condition], "2026-09-10T00:00:00.000Z")).toMatchObject({ status: "verified", matchedGameIds: ["cyberpunk"], measurements: [{ averageFps: 160 }] });
    expect(gamingPerformanceEvidenceSummaryFor([gamingPerformanceEvidenceRecordFromUnknown(record({ averageFps: 160, gpuPartId: "different-gpu" }))!], [condition], "2026-09-10T00:00:00.000Z")).toMatchObject({ status: "missing" });
  });

  it("builds the same exact-condition assessment for generation and compatibility results", () => {
    const pubg = gamingPerformanceEvidenceRecordFromUnknown(record({ id: "evidence-pubg-7900xtx", gameId: "pubg", averageFps: 171, onePercentLowFps: 128 }));
    const assessment = gamingPerformanceAssessmentFor([gamingPerformanceEvidenceRecordFromUnknown(record({ averageFps: 160 }))!, pubg!], {
      gameIds: ["cyberpunk", "pubg"],
      resolution: "4k",
      refreshRate: 144,
      graphicsPreset: "high",
      rayTracing: true,
      upscaling: "quality",
      gpuPartId: "gpu-7900xtx",
      gpuName: "AMD Radeon RX 7900 XTX"
    }, "2026-09-10T00:00:00.000Z");
    expect(assessment).toMatchObject({
      status: "verified",
      gameIds: ["cyberpunk", "pubg"],
      gpuPartId: "gpu-7900xtx",
      gpuName: "AMD Radeon RX 7900 XTX",
      matchedRecordIds: ["evidence-cyberpunk-7900xtx", "evidence-pubg-7900xtx"],
      measurements: [{ gameId: "cyberpunk", averageFps: 160 }, { gameId: "pubg", averageFps: 171 }]
    });
    expect(gamingPerformanceAssessmentFor([], { gameIds: [], resolution: "1440p", refreshRate: 144 })).toMatchObject({ status: "not_recorded", gameIds: [] });
  });

  it("creates a condition-only measurement request without inventing FPS values", () => {
    const request = gamingPerformanceEvidenceRequestFor({
      status: "not_recorded",
      gameIds: ["cyberpunk", "pubg"],
      resolution: "4k",
      refreshRate: 144,
      graphicsPreset: "high",
      rayTracing: true,
      upscaling: "quality",
      gpuPartId: "gpu-7900xtx",
      gpuName: "AMD Radeon RX 7900 XTX",
      note: "자료 없음"
    }, "2026-09-17T00:00:00.000Z");
    expect(request).toEqual({
      schemaVersion: 1,
      kind: "gaming-performance-evidence-request",
      createdAt: "2026-09-17T00:00:00.000Z",
      gameIds: ["cyberpunk", "pubg"],
      resolution: "4k",
      refreshRate: 144,
      graphicsPreset: "high",
      rayTracing: true,
      upscaling: "quality",
      gpuPartId: "gpu-7900xtx",
      gpuName: "AMD Radeon RX 7900 XTX"
    });
    expect(JSON.stringify(request)).not.toMatch(/averageFps|onePercentLowFps/);
    expect(gamingPerformanceEvidenceRequestFromJson(JSON.stringify(request))).toEqual(request);
    expect(gamingPerformanceEvidenceRequestFromJson(JSON.stringify({ ...request, averageFps: 160 }))).toBeNull();
    expect(gamingPerformanceEvidenceRequestFromJson(JSON.stringify({ ...request, schemaVersion: 2 }))).toBeNull();
  });
});
