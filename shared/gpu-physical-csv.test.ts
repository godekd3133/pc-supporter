import { describe, expect, it } from "vitest";
import type { GpuPhysicalOverrideCsvItem } from "./gpu-physical-csv";
import { gpuPhysicalOverridesToCsv, parseGpuPhysicalOverridesCsv } from "./gpu-physical-csv";

describe("GPU physical override CSV", () => {
  it("round-trips quoted evidence and all physical categories", () => {
    const overrides = [
      { partId: "gpu-1", partName: "테스트, GPU", category: "gpu" as const, manufacturerModel: "GPU-TEST-1", manufacturerRevision: "rev-A", gpuSlotOccupancy: 3.5, gpuCableBendClearanceMm: 40, sourceNote: "제조사 매뉴얼, 12페이지\n측면 패널 기준", sourceUrl: "https://example.com/gpu", updatedAt: "2026-09-01T00:00:00.000Z" },
      { partId: "case-1", partName: "테스트 케이스", category: "case" as const, manufacturerModel: "CASE-TEST-1", caseSidePanelClearanceMm: 45, sourceNote: "케이스 설치 설명서", updatedAt: "2026-09-01T00:00:00.000Z" },
      { partId: "psu-1", partName: "테스트 PSU", category: "psu" as const, manufacturerModel: "PSU-TEST-1", psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent" as const, sourceNote: "케이블 구성표", updatedAt: "2026-09-01T00:00:00.000Z" }
    ] satisfies GpuPhysicalOverrideCsvItem[];
    const parsed = parseGpuPhysicalOverridesCsv(gpuPhysicalOverridesToCsv(overrides));

    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ partId: "gpu-1", category: "gpu", manufacturerModel: "GPU-TEST-1", manufacturerRevision: "rev-A", gpuSlotOccupancy: 3.5, gpuCableBendClearanceMm: 40, sourceNote: "제조사 매뉴얼, 12페이지\n측면 패널 기준", sourceUrl: "https://example.com/gpu" }),
      expect.objectContaining({ partId: "case-1", category: "case", caseSidePanelClearanceMm: 45 }),
      expect.objectContaining({ partId: "psu-1", category: "psu", psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent" })
    ]));
  });

  it("accepts Korean category and topology labels used in spreadsheets", () => {
    const csv = [
      "partId,partName,category,manufacturerModel,manufacturerRevision,gpuSlotOccupancy,gpuCableBendClearanceMm,caseSidePanelClearanceMm,psuIndependentPcieCableRuns,psuPcieCableTopology,sourceNote,sourceUrl,updatedAt",
      "psu-1,테스트 PSU,파워서플라이,PSU-TEST-1,,,,,2,분배·공유 케이블,케이블 표,,2026-09-01"
    ].join("\n");
    const parsed = parseGpuPhysicalOverridesCsv(csv);

    expect(parsed.errors).toEqual([]);
    expect(parsed.items[0]).toMatchObject({ partId: "psu-1", category: "psu", psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "shared" });
  });

  it("reports malformed physical values before sending them to the server", () => {
    const csv = [
      "partId,partName,category,manufacturerModel,manufacturerRevision,gpuSlotOccupancy,gpuCableBendClearanceMm,caseSidePanelClearanceMm,psuIndependentPcieCableRuns,psuPcieCableTopology,sourceNote,sourceUrl,updatedAt",
      "gpu-1,GPU,gpu,GPU-TEST-1,,three,,,,,근거,,"
    ].join("\n");
    const parsed = parseGpuPhysicalOverridesCsv(csv);

    expect(parsed.items).toEqual([]);
    expect(parsed.errors[0]).toContain("gpuSlotOccupancy은 숫자");
  });

  it("requires the manufacturer model column value for each row", () => {
    const csv = [
      "partId,partName,category,manufacturerModel,manufacturerRevision,gpuSlotOccupancy,gpuCableBendClearanceMm,caseSidePanelClearanceMm,psuIndependentPcieCableRuns,psuPcieCableTopology,sourceNote,sourceUrl,updatedAt",
      "gpu-1,GPU,gpu,,rev-A,3,,,,,근거,,"
    ].join("\n");
    const parsed = parseGpuPhysicalOverridesCsv(csv);

    expect(parsed.items).toEqual([]);
    expect(parsed.errors[0]).toContain("manufacturerModel");
  });
});
