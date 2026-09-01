import { describe, expect, it } from "vitest";
import type { GpuPhysicalOverride, Part } from "../shared/types";
import { physicalReviewCoverageFor, physicalReviewQueueFor, physicalReviewWorkPackageFor } from "./gpu-physical-review";
import { validateGpuPhysicalOverrideBatch } from "./gpu-physical-overrides";

function part(id: string, category: Part["category"], specs: Part["specs"]): Part {
  return {
    id,
    category,
    name: `${category}-${id}`,
    source: "seed",
    specs,
    dataQuality: "live",
    missingFields: [],
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
}

describe("GPU physical review queue", () => {
  it("prioritizes high-power multi-8-pin GPUs and names the missing evidence", () => {
    const gpu = part("gpu-review-1", "gpu", {
      powerW: 575,
      lengthMm: 359,
      thicknessMm: 72,
      pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 4 }]]
    });
    const queue = physicalReviewQueueFor([gpu], {});

    expect(queue).toMatchObject({ total: 1, queueTotal: 1, pendingCount: 1, partialCount: 0, reviewedCount: 0, coveragePercent: 0 });
    expect(queue.items[0]).toMatchObject({ partId: gpu.id, reviewStatus: "pending", priority: "high" });
    expect(queue.items[0].reviewReason).toContain("다중 8핀 4개");
    expect(queue.items[0].focusFields).toEqual(["GPU 물리 슬롯 점유", "GPU 케이블 굽힘 최소 여유"]);
  });

  it("separates reviewed, partial, and pending coverage without treating the queue as compatibility", () => {
    const gpu = part("gpu-review-2", "gpu", { powerW: 250 });
    const computerCase = part("case-review-1", "case", { maxGpuLengthMm: 330 });
    const psu = part("psu-review-1", "psu", { wattageW: 1300, pciePowerConnectors: { pcie_8pin_6plus2: 6, "12v2x6": 2 } });
    const overrides: Record<string, GpuPhysicalOverride> = {
      [gpu.id]: { partId: gpu.id, gpuSlotOccupancy: 3, manufacturerModel: "GPU-REVIEW-2", sourceNote: "부분 검수", updatedAt: "2026-09-01T00:00:00.000Z" },
      [computerCase.id]: { partId: computerCase.id, caseSidePanelClearanceMm: 45, manufacturerModel: "CASE-REVIEW-1", sourceNote: "완료 검수", updatedAt: "2026-09-01T00:00:00.000Z" },
      [psu.id]: { partId: psu.id, psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent", manufacturerModel: "PSU-REVIEW-1", sourceNote: "완료 검수", updatedAt: "2026-09-01T00:00:00.000Z" }
    };
    const queue = physicalReviewQueueFor([gpu, computerCase, psu], overrides, { now: "2026-09-01T00:00:00.000Z" });

    expect(queue).toMatchObject({ total: 3, queueTotal: 1, registeredCount: 3, reviewedCount: 2, partialCount: 1, staleCount: 0, pendingCount: 0, coveragePercent: 66.7 });
    expect(queue.items.map((item) => item.partId)).toEqual([gpu.id]);
    expect(queue.items[0].reviewStatus).toBe("partial");
    expect(queue.items[0].focusFields).toEqual(["GPU 케이블 굽힘 최소 여유"]);
  });

  it("filters and paginates the pending review queue", () => {
    const first = part("psu-review-a", "psu", { wattageW: 1000 });
    const second = part("psu-review-b", "psu", { wattageW: 650 });
    const third = part("psu-other", "psu", { wattageW: 500 });
    const queue = physicalReviewQueueFor([first, second, third], {}, { category: "psu", query: "review-b", offset: 0, limit: 1 });

    expect(queue).toMatchObject({ category: "psu", query: "review-b", total: 1, allQueueTotal: 1, queueTotal: 1, items: [{ partId: second.id }] });
  });

  it("filters by priority while retaining the unfiltered queue total for pagination context", () => {
    const highOne = part("psu-high-a", "psu", { wattageW: 1300, pciePowerConnectors: { pcie_8pin_6plus2: 4 } });
    const highTwo = part("psu-high-b", "psu", { wattageW: 1000, pciePowerConnectors: { pcie_8pin_6plus2: 4 } });
    const low = part("psu-low", "psu", { wattageW: 500 });
    const queue = physicalReviewQueueFor([highOne, highTwo, low], {}, { category: "psu", priority: "high", offset: 1, limit: 1 });

    expect(queue).toMatchObject({ priority: "high", allQueueTotal: 3, queueTotal: 2, items: [{ partId: highTwo.id }] });
  });

  it("moves a complete but stale physical review back into the queue", () => {
    const gpu = part("gpu-stale", "gpu", { powerW: 575, lengthMm: 359, thicknessMm: 72 });
    const overrides: Record<string, GpuPhysicalOverride> = {
      [gpu.id]: {
        partId: gpu.id,
        gpuSlotOccupancy: 3.5,
        gpuCableBendClearanceMm: 40,
        manufacturerModel: "GPU-STALE-1",
        sourceNote: "오래된 제조사 설치 가이드",
        updatedAt: "2026-07-01T00:00:00.000Z"
      }
    };
    const queue = physicalReviewQueueFor([gpu], overrides, { now: "2026-09-01T00:00:00.000Z" });

    expect(queue).toMatchObject({ total: 1, queueTotal: 1, registeredCount: 1, reviewedCount: 0, partialCount: 0, staleCount: 1, pendingCount: 0, coveragePercent: 0 });
    expect(queue.items[0]).toMatchObject({ reviewStatus: "stale", freshness: "stale", evidenceUpdatedAt: "2026-07-01T00:00:00.000Z" });
    expect(queue.items[0].focusFields).toEqual(["제조사 근거 신선도 재확인"]);
    expect(queue.items[0].reviewReason).toContain("근거 오래된 정보");
  });

  it("moves a complete review back into the queue when its URL identity check fails", () => {
    const gpu = part("gpu-source-check-failed", "gpu", { powerW: 450 });
    const overrides: Record<string, GpuPhysicalOverride> = {
      [gpu.id]: {
        partId: gpu.id,
        gpuSlotOccupancy: 3,
        gpuCableBendClearanceMm: 40,
        manufacturerModel: "GPU-EXPECTED",
        sourceNote: "제조사 페이지",
        sourceUrl: "https://vendor.example/wrong",
        sourceCheck: {
          requestedUrl: "https://vendor.example/wrong",
          checkedAt: "2026-09-01T00:00:00.000Z",
          status: "identity_mismatch",
          identityStatus: "not_found",
          redirectCount: 0,
          httpStatus: 200
        },
        updatedAt: "2026-09-01T00:00:00.000Z"
      }
    };
    const queue = physicalReviewQueueFor([gpu], overrides, { now: "2026-09-01T00:00:00.000Z" });

    expect(queue).toMatchObject({ total: 1, queueTotal: 1, reviewedCount: 0, staleCount: 1, coveragePercent: 0 });
    expect(queue.items[0]).toMatchObject({ reviewStatus: "stale", focusFields: ["근거 URL 접근·모델 식별 재확인"] });
    expect(queue.items[0].reviewReason).toContain("근거 URL 접근·모델 식별 재확인 필요");
  });

  it("aggregates cross-category review coverage and evidence freshness", () => {
    const partialGpu = part("gpu-coverage-partial", "gpu", { powerW: 300 });
    const staleGpu = part("gpu-coverage-stale", "gpu", { powerW: 450 });
    const computerCase = part("case-coverage-reviewed", "case", { maxGpuLengthMm: 360 });
    const pendingPsu = part("psu-coverage-pending", "psu", { wattageW: 750 });
    const agingPsu = part("psu-coverage-aging", "psu", { wattageW: 1000 });
    const overrides: Record<string, GpuPhysicalOverride> = {
      [partialGpu.id]: { partId: partialGpu.id, gpuSlotOccupancy: 3, manufacturerModel: "GPU-COVERAGE-PARTIAL", sourceNote: "부분 근거", updatedAt: "2026-09-01T00:00:00.000Z" },
      [staleGpu.id]: { partId: staleGpu.id, gpuSlotOccupancy: 3.5, gpuCableBendClearanceMm: 40, manufacturerModel: "GPU-COVERAGE-STALE", sourceNote: "재확인 필요", updatedAt: "2026-07-01T00:00:00.000Z" },
      [computerCase.id]: { partId: computerCase.id, caseSidePanelClearanceMm: 45, manufacturerModel: "CASE-COVERAGE-REVIEWED", sourceNote: "현재 근거", updatedAt: "2026-09-01T00:00:00.000Z" },
      [agingPsu.id]: { partId: agingPsu.id, psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent", manufacturerModel: "PSU-COVERAGE-AGING", sourceNote: "갱신 권장 근거", updatedAt: "2026-08-20T00:00:00.000Z" }
    };
    const coverage = physicalReviewCoverageFor([partialGpu, staleGpu, computerCase, pendingPsu, agingPsu], overrides, "2026-09-01T00:00:00.000Z");

    expect(coverage).toMatchObject({ total: 5, registeredCount: 4, reviewedCount: 2, partialCount: 1, staleCount: 1, pendingCount: 1, freshCount: 2, agingCount: 1, staleFreshnessCount: 1, unknownFreshnessCount: 1, queueCount: 3, coveragePercent: 40 });
    expect(coverage.categories).toEqual([
      expect.objectContaining({ category: "gpu", total: 2, registeredCount: 2, reviewedCount: 0, partialCount: 1, staleCount: 1, pendingCount: 0, freshCount: 1, agingCount: 0, staleFreshnessCount: 1, unknownFreshnessCount: 0, queueCount: 2, coveragePercent: 0 }),
      expect.objectContaining({ category: "case", total: 1, registeredCount: 1, reviewedCount: 1, partialCount: 0, staleCount: 0, pendingCount: 0, freshCount: 1, agingCount: 0, staleFreshnessCount: 0, unknownFreshnessCount: 0, queueCount: 0, coveragePercent: 100 }),
      expect.objectContaining({ category: "psu", total: 2, registeredCount: 1, reviewedCount: 1, partialCount: 0, staleCount: 0, pendingCount: 1, freshCount: 0, agingCount: 1, staleFreshnessCount: 0, unknownFreshnessCount: 1, queueCount: 1, coveragePercent: 50 })
    ]);
  });

  it("exports a priority work package that can be resumed from its next offset", () => {
    const highGpu = part("gpu-package-high", "gpu", { powerW: 575, lengthMm: 359, thicknessMm: 72, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 4 }]] });
    const lowGpu = part("gpu-package-low", "gpu", { powerW: 180 });
    const overrides: Record<string, GpuPhysicalOverride> = {
      [highGpu.id]: { partId: highGpu.id, gpuSlotOccupancy: 3.5, manufacturerModel: "GPU-PACKAGE-HIGH", sourceNote: "슬롯 근거", updatedAt: "2026-09-01T00:00:00.000Z" }
    };
    const workPackage = physicalReviewWorkPackageFor([highGpu, lowGpu], overrides, { category: "gpu", limit: 1, offset: 0, now: "2026-09-01T00:00:00.000Z" });

    expect(workPackage).toMatchObject({ schemaVersion: 1, kind: "gpu-physical-review-package", category: "gpu", offset: 0, limit: 1, nextOffset: 1, summary: { total: 2, queueTotal: 2, includedCount: 1, remainingCount: 1, coveragePercent: 0 } });
    expect(workPackage.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "gpuSlotOccupancy", required: true }),
      expect.objectContaining({ key: "gpuCableBendClearanceMm", required: true }),
      expect.objectContaining({ key: "manufacturerModel", required: true }),
      expect.objectContaining({ key: "sourceNote", required: true })
    ]));
    expect(workPackage.items[0]).toMatchObject({ partId: highGpu.id, reviewStatus: "partial", nextAction: "complete_missing_fields", nextActionLabel: "누락 물리 필드 보완", gpuSlotOccupancy: 3.5, manufacturerModel: "GPU-PACKAGE-HIGH" });

    const completedRows = workPackage.items.map((item) => ({ ...item, gpuCableBendClearanceMm: 40 }));
    const validation = validateGpuPhysicalOverrideBatch({ items: completedRows }, [highGpu, lowGpu], overrides);
    expect(validation.errors).toEqual([]);
    expect(validation.validOverrides).toHaveLength(1);
  });
});
