import { describe, expect, it } from "vitest";
import type { Part } from "../shared/types";
import { applyGpuPhysicalOverrides, stripGpuPhysicalOverrides, validateGpuPhysicalOverride, validateGpuPhysicalOverrideBatch } from "./gpu-physical-overrides";

const gpu: Part = {
  id: "gpu-physical-1",
  category: "gpu",
  name: "테스트 GPU",
  source: "seed",
  specs: {},
  dataQuality: "seed",
  missingFields: [],
  updatedAt: "2026-09-01T00:00:00.000Z"
};

const computerCase: Part = {
  id: "case-physical-1",
  category: "case",
  name: "테스트 케이스",
  source: "seed",
  specs: {},
  dataQuality: "seed",
  missingFields: [],
  updatedAt: "2026-09-01T00:00:00.000Z"
};

const psu: Part = {
  id: "psu-physical-1",
  category: "psu",
  name: "테스트 PSU",
  source: "seed",
  specs: {},
  dataQuality: "seed",
  missingFields: [],
  updatedAt: "2026-09-01T00:00:00.000Z"
};

describe("GPU physical compatibility overrides", () => {
  it("accepts evidence-backed GPU physical values", () => {
    const result = validateGpuPhysicalOverride(gpu, {
      gpuSlotOccupancy: 3.5,
      gpuCableBendClearanceMm: 40,
      manufacturerModel: "GPU-TEST-1",
      sourceNote: "제조사 설치 가이드 12페이지"
    });

    expect(result.errors).toEqual([]);
    expect(result.value).toMatchObject({ partId: gpu.id, gpuSlotOccupancy: 3.5, gpuCableBendClearanceMm: 40, manufacturerModel: "GPU-TEST-1", sourceNote: "제조사 설치 가이드 12페이지" });
  });

  it("accepts evidence-backed case side clearance values", () => {
    const result = validateGpuPhysicalOverride(computerCase, {
      caseSidePanelClearanceMm: 45,
      manufacturerModel: "CASE-TEST-1",
      sourceNote: "케이스 제조사 조립 설명서 8페이지",
      sourceUrl: "https://example.com/manual"
    });

    expect(result.errors).toEqual([]);
    expect(result.value?.caseSidePanelClearanceMm).toBe(45);
  });

  it("accepts explicit PSU cable run evidence", () => {
    const result = validateGpuPhysicalOverride(psu, {
      psuIndependentPcieCableRuns: 2,
      psuPcieCableTopology: "independent",
      manufacturerModel: "PSU-TEST-1",
      sourceNote: "PSU 제조사 케이블 구성표"
    });

    expect(result.errors).toEqual([]);
    expect(result.value).toMatchObject({ psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent" });
  });

  it("validates GPU, case, and PSU evidence together without changing the input shape", () => {
    const result = validateGpuPhysicalOverrideBatch({ items: [
      { partId: gpu.id, gpuSlotOccupancy: 3, manufacturerModel: "GPU-TEST-1", sourceNote: "GPU 설치 가이드" },
      { partId: computerCase.id, caseSidePanelClearanceMm: 45, manufacturerModel: "CASE-TEST-1", sourceNote: "케이스 매뉴얼" },
      { partId: psu.id, psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent", manufacturerModel: "PSU-TEST-1", sourceNote: "PSU 케이블 표" }
    ] }, [gpu, computerCase, psu]);

    expect(result.errors).toEqual([]);
    expect(result.validOverrides).toHaveLength(3);
    expect(result.items.map((item) => item.category)).toEqual(["gpu", "case", "psu"]);
    expect(result.items.every((item) => item.valid)).toBe(true);
  });

  it("rejects a physical override batch atomically when one item lacks evidence", () => {
    const result = validateGpuPhysicalOverrideBatch({ items: [
      { partId: gpu.id, gpuSlotOccupancy: 3, manufacturerModel: "GPU-TEST-1", sourceNote: "GPU 설치 가이드" },
      { partId: psu.id, psuIndependentPcieCableRuns: 2, manufacturerModel: "PSU-TEST-1" }
    ] }, [gpu, computerCase, psu]);

    expect(result.validOverrides).toEqual([]);
    expect(result.items[0]).toMatchObject({ partId: gpu.id, valid: true, operation: "create" });
    expect(result.items[1]).toMatchObject({ partId: psu.id, valid: false });
    expect(result.errors.some((error) => error.includes("검수 근거"))).toBe(true);
  });

  it("rejects cross-category fields and unsupported values", () => {
    const result = validateGpuPhysicalOverride(gpu, {
      gpuSlotOccupancy: 3.25,
      caseSidePanelClearanceMm: 20,
      manufacturerModel: "GPU-TEST-1",
      sourceNote: "근거"
    });

    expect(result.value).toBeUndefined();
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("0.5"),
      expect.stringContaining("케이스 측면")
    ]));
  });

  it("requires a source note and does not accept an override without evidence", () => {
    const result = validateGpuPhysicalOverride(computerCase, { caseSidePanelClearanceMm: 40, manufacturerModel: "CASE-TEST-1" });

    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("검수 근거"),
    ]));
  });

  it("requires a manufacturer model identity even when the measurement note exists", () => {
    const result = validateGpuPhysicalOverride(computerCase, { caseSidePanelClearanceMm: 40, sourceNote: "케이스 매뉴얼" });

    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("manufacturerModel")
    ]));
  });

  it("applies manual values at runtime and strips them before catalog persistence", () => {
    const overrides = {
      [gpu.id]: { partId: gpu.id, gpuSlotOccupancy: 3, gpuCableBendClearanceMm: 42, manufacturerModel: "GPU-TEST-1", sourceNote: "GPU 매뉴얼", sourceUrl: "https://vendor.example/gpu", sourceCheck: { requestedUrl: "https://vendor.example/gpu", checkedAt: "2026-09-01T00:00:00.000Z", status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0, httpStatus: 200 }, updatedAt: "2026-09-01T00:00:00.000Z" },
      [computerCase.id]: { partId: computerCase.id, caseSidePanelClearanceMm: 50, manufacturerModel: "CASE-TEST-1", sourceNote: "케이스 매뉴얼", updatedAt: "2026-09-01T00:00:00.000Z" },
      [psu.id]: { partId: psu.id, psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent" as const, manufacturerModel: "PSU-TEST-1", sourceNote: "PSU 매뉴얼", updatedAt: "2026-09-01T00:00:00.000Z" }
    };
    const applied = applyGpuPhysicalOverrides([gpu, computerCase, psu], overrides);

    expect(applied[0].specs).toMatchObject({ gpuSlotOccupancy: 3, gpuCableBendClearanceMm: 42 });
    expect(applied[0].specs).toMatchObject({ physicalEvidenceSourceNote: "GPU 매뉴얼", physicalEvidenceSourceUrl: "https://vendor.example/gpu" });
    expect(applied[0].specs.physicalEvidenceManufacturerModel).toBe("GPU-TEST-1");
    expect(applied[0].specs.physicalEvidenceUpdatedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(applied[0].specs.physicalEvidenceSourceCheck).toMatchObject({ status: "reachable", identityStatus: "matched" });
    expect(applied[1].specs.caseSidePanelClearanceMm).toBe(50);
    expect(applied[2].specs).toMatchObject({ psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent" });
    expect(stripGpuPhysicalOverrides(applied[0]).specs).not.toHaveProperty("gpuSlotOccupancy");
    expect(stripGpuPhysicalOverrides(applied[0]).specs).not.toHaveProperty("physicalEvidenceSourceNote");
    expect(stripGpuPhysicalOverrides(applied[0]).specs).not.toHaveProperty("physicalEvidenceSourceUrl");
    expect(stripGpuPhysicalOverrides(applied[0]).specs).not.toHaveProperty("physicalEvidenceManufacturerModel");
    expect(stripGpuPhysicalOverrides(applied[0]).specs).not.toHaveProperty("physicalEvidenceUpdatedAt");
    expect(stripGpuPhysicalOverrides(applied[0]).specs).not.toHaveProperty("physicalEvidenceSourceCheck");
    expect(stripGpuPhysicalOverrides(applied[1]).specs).not.toHaveProperty("caseSidePanelClearanceMm");
    expect(stripGpuPhysicalOverrides(applied[2]).specs).not.toHaveProperty("psuIndependentPcieCableRuns");
  });
});
