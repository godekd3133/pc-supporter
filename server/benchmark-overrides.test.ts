import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { applyBenchmarkOverrides, validateBenchmarkOverrideBatch } from "./benchmark-overrides";

function part(overrides: Partial<Part>): Part {
  return {
    id: "cpu-benchmark-fixture",
    category: "cpu",
    name: "벤치마크 CPU",
    source: "danawa",
    sourceProductCode: "cpu-fixture",
    specs: { socket: "AM5", cinebenchR23Single: 1800 },
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-08-28T00:00:00.000Z",
    ...overrides
  };
}

describe("benchmark overrides", () => {
  it("validates CPU and GPU scores with explicit provenance", () => {
    const catalog = [
      part({ id: "cpu-1", sourceProductCode: "cpu-1" }),
      part({ id: "gpu-1", sourceProductCode: "gpu-1", category: "gpu", name: "벤치마크 GPU", specs: { vramGb: 16 } })
    ];
    const validation = validateBenchmarkOverrideBatch({
      items: [
        { partId: "cpu-1", cinebenchR23Multi: 18500, sourceKind: "official", sourceNote: "공식 테스트 표 2026-08", sourceUrl: "https://example.com/cpu" },
        { partId: "gpu-1", gpu3dmarkTimeSpyScore: 15000, gpu3dmarkPortRoyalScore: 11000, sourceKind: "independent_review", sourceNote: "3DMark 결과 캡처" }
      ]
    }, catalog);

    expect(validation.errors).toEqual([]);
    expect(validation.items.every((item) => item.valid)).toBe(true);
    expect(validation.items.map((item) => item.operation)).toEqual(["create", "create"]);
    expect(validation.validOverrides).toHaveLength(2);
    expect(validation.validOverrides[0]).toMatchObject({ partId: "cpu-1", scores: { cinebenchR23Multi: 18500 }, sourceKind: "official", sourceNote: "공식 테스트 표 2026-08" });
    expect(validation.validOverrides[1]).toMatchObject({ partId: "gpu-1", scores: { gpu3dmarkTimeSpyScore: 15000, gpu3dmarkPortRoyalScore: 11000 }, sourceKind: "independent_review" });

    const legacyValidation = validateBenchmarkOverrideBatch({ items: [{ partId: "cpu-1", cinebenchR23Single: 2000, sourceNote: "기존 CSV" }] }, catalog);
    expect(legacyValidation.validOverrides[0].sourceKind).toBe("other");

    const updateValidation = validateBenchmarkOverrideBatch({
      items: [{ partId: "cpu-1", cinebenchR23Multi: 18500, sourceKind: "official", sourceNote: "수정된 테스트 표" }]
    }, catalog, {
      "cpu-1": { partId: "cpu-1", scores: { cinebenchR23Multi: 18000 }, sourceKind: "independent_review", sourceNote: "이전 테스트 표", updatedAt: "2026-08-28T00:00:00.000Z" }
    });
    expect(updateValidation.items[0]).toMatchObject({ operation: "update", changedFields: ["cinebenchR23Multi", "sourceKind", "sourceNote"] });

    const unchangedValidation = validateBenchmarkOverrideBatch({
      items: [{ partId: "cpu-1", cinebenchR23Multi: 18000, sourceKind: "independent_review", sourceNote: "이전 테스트 표" }]
    }, catalog, {
      "cpu-1": { partId: "cpu-1", scores: { cinebenchR23Multi: 18000 }, sourceKind: "independent_review", sourceNote: "이전 테스트 표", updatedAt: "2026-08-28T00:00:00.000Z" }
    });
    expect(unchangedValidation.items[0]).toMatchObject({ operation: "unchanged", changedFields: [] });
  });

  it("rejects malformed, cross-category, duplicate, and untraceable entries atomically", () => {
    const catalog = [part({ id: "cpu-1", sourceProductCode: "cpu-1" })];
    const validation = validateBenchmarkOverrideBatch({
      items: [
        { partId: "cpu-1", gpu3dmarkTimeSpyScore: 15000, sourceKind: "unknown", sourceNote: "CPU에 GPU 점수 입력" },
        { partId: "cpu-1", cinebenchR23Single: 0, sourceNote: "중복" },
        { partId: "missing", cinebenchR23Multi: 18000, sourceUrl: "http://example.com" }
      ]
    }, catalog);

    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("CPU에 사용할 수 없는 벤치마크 필드"),
      expect.stringContaining("같은 partId가 일괄 입력에서 중복"),
      expect.stringContaining("cinebenchR23Single는 1부터 1,000,000 사이의 정수"),
      expect.stringContaining("확인 정보 sourceNote가 필요"),
      expect.stringContaining("sourceKind은 official"),
      expect.stringContaining("sourceUrl은 HTTPS 주소만")
    ]));
    expect(validation.validOverrides).toEqual([]);
  });

  it("applies only validated score fields without changing part identity or other specs", () => {
    const cpu = part({ id: "cpu-1", sourceProductCode: "cpu-1", specs: { socket: "AM5", cores: 6 } });
    const applied = applyBenchmarkOverrides([cpu], {
      "cpu-1": {
        partId: "cpu-1",
        scores: { cinebenchR23Single: 2000, cinebenchR23Multi: 18000, gpu3dmarkTimeSpyScore: 15000, gpu3dmarkPortRoyalScore: 0 },
        sourceKind: "official",
        sourceNote: "확인 표",
        sourceUrl: "https://example.com/benchmark",
        updatedAt: "2026-08-28T00:00:00.000Z"
      }
    });

    expect(applied[0]).toMatchObject({ id: "cpu-1", name: "벤치마크 CPU", specs: { socket: "AM5", cores: 6, cinebenchR23Single: 2000, cinebenchR23Multi: 18000 } });
    expect(applied[0].specs.gpu3dmarkTimeSpyScore).toBeUndefined();
    expect(applied[0].specs.gpu3dmarkPortRoyalScore).toBeUndefined();
    expect(applied[0].specs.benchmarkProvenance).toMatchObject({ sourceKind: "official", sourceNote: "확인 표", sourceUrl: "https://example.com/benchmark" });
  });

  it("clears stale same-category scores when an override only sources part of the benchmark set", () => {
    const gpu = part({
      id: "gpu-timespy-only",
      category: "gpu",
      name: "Time Spy GPU",
      sourceProductCode: "gpu-timespy-only",
      specs: { vramGb: 8, gpu3dmarkTimeSpyScore: 14000, gpu3dmarkPortRoyalScore: 9000 }
    });
    const cpu = part({
      id: "cpu-single-only",
      sourceProductCode: "cpu-single-only",
      specs: { socket: "AM5", cinebenchR23Single: 1800, cinebenchR23Multi: 16000 }
    });
    const completeGpu = part({
      id: "gpu-complete",
      category: "gpu",
      name: "Complete GPU",
      sourceProductCode: "gpu-complete",
      specs: { vramGb: 16, gpu3dmarkTimeSpyScore: 14000, gpu3dmarkPortRoyalScore: 9000 }
    });
    const provenance = { sourceKind: "independent_review" as const, sourceNote: "검증된 벤치마크", updatedAt: "2026-09-20T00:00:00.000Z" };
    const applied = applyBenchmarkOverrides([gpu, cpu, completeGpu], {
      "gpu-timespy-only": { partId: "gpu-timespy-only", scores: { gpu3dmarkTimeSpyScore: 15000 }, ...provenance },
      "cpu-single-only": { partId: "cpu-single-only", scores: { cinebenchR23Single: 2000 }, ...provenance },
      "gpu-complete": { partId: "gpu-complete", scores: { gpu3dmarkTimeSpyScore: 15000, gpu3dmarkPortRoyalScore: 10000 }, ...provenance }
    });

    expect(applied[0].specs).toMatchObject({ vramGb: 8, gpu3dmarkTimeSpyScore: 15000 });
    expect(applied[0].specs.gpu3dmarkPortRoyalScore).toBeUndefined();
    expect(applied[1].specs).toMatchObject({ socket: "AM5", cinebenchR23Single: 2000 });
    expect(applied[1].specs.cinebenchR23Multi).toBeUndefined();
    expect(applied[2].specs).toMatchObject({ vramGb: 16, gpu3dmarkTimeSpyScore: 15000, gpu3dmarkPortRoyalScore: 10000 });

    const unchanged = applyBenchmarkOverrides([gpu], {});
    expect(unchanged[0]).toBe(gpu);
    expect(unchanged[0].specs.gpu3dmarkPortRoyalScore).toBe(9000);
  });

  it("carries a persisted source-check result into benchmark provenance", () => {
    const cpu = part({ id: "cpu-source-checked", sourceProductCode: "cpu-source-checked", specs: { socket: "AM5" } });
    const sourceCheck = { requestedUrl: "https://example.com/benchmark", checkedAt: "2026-09-03T00:00:00.000Z", status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0, httpStatus: 200, contentType: "text/html", detail: "모델 식별 확인" };
    const applied = applyBenchmarkOverrides([cpu], {
      "cpu-source-checked": {
        partId: "cpu-source-checked",
        scores: { cinebenchR23Multi: 18000 },
        sourceKind: "official",
        sourceNote: "확인 표",
        sourceUrl: "https://example.com/benchmark",
        sourceCheck,
        updatedAt: "2026-09-03T00:00:00.000Z"
      }
    });

    expect(applied[0].specs.benchmarkProvenance?.sourceCheck).toEqual(sourceCheck);
  });

  it("keeps legacy overrides usable and marks their provenance as unclassified", () => {
    const cpu = part({ id: "cpu-legacy", sourceProductCode: "cpu-legacy", specs: { socket: "AM5" } });
    const applied = applyBenchmarkOverrides([cpu], {
      "cpu-legacy": { partId: "cpu-legacy", scores: { cinebenchR23Single: 1900 }, sourceNote: "이전 보강 파일", updatedAt: "2026-08-28T00:00:00.000Z" }
    });

    expect(applied[0].specs.benchmarkProvenance).toMatchObject({ sourceKind: "other", sourceNote: "이전 보강 파일" });
  });

  it("does not carry an unsafe persisted source URL into catalog provenance", () => {
    const cpu = part({ id: "cpu-unsafe-url", sourceProductCode: "cpu-unsafe-url", specs: { socket: "AM5" } });
    const applied = applyBenchmarkOverrides([cpu], {
      "cpu-unsafe-url": {
        partId: "cpu-unsafe-url",
        scores: { cinebenchR23Multi: 18000 },
        sourceKind: "official",
        sourceNote: "이전 저장값",
        sourceUrl: "javascript:alert(1)",
        updatedAt: "2026-08-28T00:00:00.000Z"
      }
    });

    expect(applied[0].specs.benchmarkProvenance).toMatchObject({ sourceKind: "official", sourceNote: "이전 저장값" });
    expect(applied[0].specs.benchmarkProvenance?.sourceUrl).toBeUndefined();
  });
});
