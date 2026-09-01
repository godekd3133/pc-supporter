import { describe, expect, it } from "vitest";
import type { BuildMetrics, Finding, Part } from "./types";
import { GPU_THICKNESS_WARNING_MM, gpuFitSummaryFor, gpuPurchaseEvidenceFor, pciePowerMatchFor } from "./gpu-fit";

const gpu: Part = {
  id: "gpu-1",
  category: "gpu",
  name: "테스트 GPU",
  source: "seed",
  specs: {
    powerW: 320,
    recommendedPsuW: 850,
    lengthMm: 340,
    thicknessMm: 40,
    pciePowerOptions: [[{ kind: "12v2x6", count: 1 }], [{ kind: "pcie_8pin_6plus2", count: 2 }]]
  },
  dataQuality: "seed",
  missingFields: [],
  updatedAt: "2026-08-28T00:00:00.000Z"
};

const computerCase: Part = {
  id: "case-1",
  category: "case",
  name: "테스트 케이스",
  source: "seed",
  specs: { maxGpuLengthMm: 360 },
  dataQuality: "seed",
  missingFields: [],
  updatedAt: "2026-08-28T00:00:00.000Z"
};

const psu: Part = {
  id: "psu-1",
  category: "psu",
  name: "테스트 PSU",
  source: "seed",
  specs: { wattageW: 1000, pciePowerConnectors: { pcie_8pin_6plus2: 2 } },
  dataQuality: "seed",
  missingFields: [],
  updatedAt: "2026-08-28T00:00:00.000Z"
};

const metrics: BuildMetrics = {
  gpuPowerW: 320,
  recommendedPsuW: 850,
  psuWattageW: 1000,
  powerHeadroomW: 150,
  gpuLengthMm: 340,
  maxGpuLengthMm: 360,
  gpuClearanceMm: 20,
  gpuThicknessMm: 40
};

function finding(ruleId: string, severity: Finding["severity"]): Finding {
  return { id: `${ruleId}-1`, ruleId, severity, title: ruleId, message: ruleId, affectedPartIds: [], facts: [], actions: [] };
}

describe("GPU fit evidence", () => {
  it("selects the first fully confirmed PCIe power path", () => {
    const match = pciePowerMatchFor(gpu.specs.pciePowerOptions!, { "12v2x6": 1, pcie_8pin_6plus2: 2 });

    expect(match).toMatchObject({ status: "compatible", matchedOptionIndex: 0 });
    expect(match.optionFits[0].missing).toEqual([]);
  });

  it("keeps a confirmed adapter alternative usable when the direct path is absent", () => {
    const match = pciePowerMatchFor(gpu.specs.pciePowerOptions!, { pcie_8pin_6plus2: 2 });

    expect(match.status).toBe("compatible");
    expect(match.matchedOptionIndex).toBe(1);
    expect(match.optionFits[0].status).toBe("unknown");
  });

  it("distinguishes a connector shortage from an unknown connector inventory", () => {
    const shortage = pciePowerMatchFor([[{ kind: "pcie_8pin_6plus2", count: 2 }]], { pcie_8pin_6plus2: 1 });
    const unknown = pciePowerMatchFor([[{ kind: "12v2x6", count: 1 }]], { pcie_8pin_6plus2: 2 });

    expect(shortage.status).toBe("blocker");
    expect(shortage.optionFits[0].missing).toEqual([{ kind: "pcie_8pin_6plus2", count: 2 }]);
    expect(unknown.status).toBe("unknown");
    expect(unknown.optionFits[0].unknown).toEqual([{ kind: "12v2x6", count: 1 }]);
  });

  it("keeps a mixed shortage and unknown path conservative like the compatibility engine", () => {
    const match = pciePowerMatchFor([[{ kind: "pcie_8pin_6plus2", count: 2 }, { kind: "12v2x6", count: 1 }]], { pcie_8pin_6plus2: 1 });

    expect(match.status).toBe("unknown");
    expect(match.optionFits[0]).toMatchObject({ status: "unknown", missing: [{ kind: "pcie_8pin_6plus2", count: 2 }], unknown: [{ kind: "12v2x6", count: 1 }] });
  });

  it("combines length, thickness, power, and connector evidence into one summary", () => {
    const summary = gpuFitSummaryFor(metrics, gpu, computerCase, psu, []);

    expect(summary.status).toBe("compatible");
    expect(summary.length).toMatchObject({ status: "compatible", clearanceMm: 20 });
    expect(summary.thickness).toMatchObject({ status: "compatible", warningThresholdMm: GPU_THICKNESS_WARNING_MM });
    expect(summary.power).toMatchObject({ status: "compatible", headroomW: 150 });
    expect(summary.connector).toMatchObject({ status: "compatible", matchedOptionIndex: 1, requirementsKnown: true });
  });

  it("preserves engine blocker and review severity in the summary", () => {
    const summary = gpuFitSummaryFor(metrics, gpu, computerCase, psu, [finding("gpu-case-length", "blocker"), finding("gpu-thickness", "warning")]);

    expect(summary.status).toBe("incompatible");
    expect(summary.length.status).toBe("incompatible");
    expect(summary.thickness.status).toBe("needs_review");
  });

  it("does not claim a GPU fit when no GPU is selected", () => {
    const summary = gpuFitSummaryFor({}, undefined, computerCase, psu);

    expect(summary.status).toBe("not_applicable");
    expect(summary.length.status).toBe("not_applicable");
    expect(summary.connector.status).toBe("not_applicable");
  });

  it("does not confuse missing GPU power evidence with an explicit no-connector declaration", () => {
    const missing = gpuFitSummaryFor(metrics, { ...gpu, specs: { ...gpu.specs, pciePowerOptions: undefined } }, computerCase, psu);
    const noConnector = gpuFitSummaryFor(metrics, { ...gpu, specs: { ...gpu.specs, pciePowerOptions: [] } }, computerCase, psu);

    expect(missing.connector).toMatchObject({ status: "needs_review", requirementsKnown: false, options: [] });
    expect(noConnector.connector).toMatchObject({ status: "compatible", requirementsKnown: true, options: [] });
  });

  it("reports a manual GPU cable clearance conflict without inferring it from thickness", () => {
    const summary = gpuFitSummaryFor(
      metrics,
      { ...gpu, specs: { ...gpu.specs, gpuSlotOccupancy: 3, gpuCableBendClearanceMm: 40 } },
      { ...computerCase, specs: { ...computerCase.specs, caseSidePanelClearanceMm: 30 } },
      psu,
      []
    );

    expect(summary.physical).toMatchObject({ status: "incompatible", gpuSlotOccupancy: 3, cableClearanceMm: -10 });
    expect(summary.status).toBe("incompatible");
  });

  it("keeps electrically sufficient but shared PCIe cable topology as review", () => {
    const summary = gpuFitSummaryFor(metrics, gpu, computerCase, { ...psu, specs: { ...psu.specs, psuIndependentPcieCableRuns: 1, psuPcieCableTopology: "shared" } }, []);

    expect(summary.connector).toMatchObject({ status: "compatible", matchedOptionIndex: 1, psuCableTopologyStatus: "needs_review", psuIndependentPcieCableRuns: 1, psuPcieCableTopology: "shared" });
    expect(summary.status).toBe("needs_review");
  });

  it("requires purchase review when physical and multi-8-pin evidence is not registered", () => {
    const summary = gpuFitSummaryFor(metrics, gpu, computerCase, psu, []);
    const evidence = gpuPurchaseEvidenceFor(summary);

    expect(evidence).toMatchObject({ status: "needs_review", physical: "needs_review", pcieCableTopology: "needs_review", physicalEvidenceExpected: true, pcieCableTopologyExpected: true });
  });

  it("does not require cable topology evidence for a single direct auxiliary connector", () => {
    const directGpu = { ...gpu, specs: { ...gpu.specs, pciePowerOptions: [[{ kind: "12v2x6" as const, count: 1 }]] } };
    const directPsu = { ...psu, specs: { ...psu.specs, pciePowerConnectors: { "12v2x6": 1 } } };
    const evidence = gpuPurchaseEvidenceFor(gpuFitSummaryFor(metrics, directGpu, computerCase, directPsu, []));

    expect(evidence).toMatchObject({ physical: "needs_review", pcieCableTopology: "not_applicable", physicalEvidenceExpected: true, pcieCableTopologyExpected: false });
  });

  it("passes purchase evidence only when all registered physical and cable values are sufficient", () => {
    const completeGpu = { ...gpu, specs: { ...gpu.specs, gpuSlotOccupancy: 3, gpuCableBendClearanceMm: 40, physicalEvidenceSourceNote: "GPU 제조사 설치 가이드", physicalEvidenceManufacturerModel: "GPU-TEST-1" } };
    const completeCase = { ...computerCase, specs: { ...computerCase.specs, caseSidePanelClearanceMm: 50, physicalEvidenceSourceNote: "케이스 제조사 설명서", physicalEvidenceManufacturerModel: "CASE-TEST-1" } };
    const completePsu = { ...psu, specs: { ...psu.specs, psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent" as const, physicalEvidenceSourceNote: "PSU 제조사 케이블 표", physicalEvidenceManufacturerModel: "PSU-TEST-1" } };
    const evidence = gpuPurchaseEvidenceFor(gpuFitSummaryFor(metrics, completeGpu, completeCase, completePsu, []));

    expect(evidence).toMatchObject({ status: "compatible", physical: "compatible", pcieCableTopology: "compatible" });
    expect(evidence.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "gpu", manufacturerModel: "GPU-TEST-1", note: "GPU 제조사 설치 가이드" }),
      expect.objectContaining({ category: "case", manufacturerModel: "CASE-TEST-1", note: "케이스 제조사 설명서" }),
      expect.objectContaining({ category: "psu", manufacturerModel: "PSU-TEST-1", note: "PSU 제조사 케이블 표" })
    ]));
  });

  it("keeps numeric physical values in review when their provenance is missing", () => {
    const completeGpu = { ...gpu, specs: { ...gpu.specs, gpuSlotOccupancy: 3, gpuCableBendClearanceMm: 40 } };
    const completeCase = { ...computerCase, specs: { ...computerCase.specs, caseSidePanelClearanceMm: 50 } };
    const completePsu = { ...psu, specs: { ...psu.specs, psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent" as const } };
    const evidence = gpuPurchaseEvidenceFor(gpuFitSummaryFor(metrics, completeGpu, completeCase, completePsu, []));

    expect(evidence).toMatchObject({ status: "needs_review", physical: "needs_review", pcieCableTopology: "needs_review" });
    expect(evidence.sources).toEqual([]);
  });

  it("downgrades complete physical evidence when its review timestamp is stale", () => {
    const completeGpu = { ...gpu, specs: { ...gpu.specs, gpuSlotOccupancy: 3, gpuCableBendClearanceMm: 40, physicalEvidenceSourceNote: "오래된 GPU 가이드", physicalEvidenceManufacturerModel: "GPU-STALE-1", physicalEvidenceUpdatedAt: "2026-07-01T00:00:00.000Z" } };
    const completeCase = { ...computerCase, specs: { ...computerCase.specs, caseSidePanelClearanceMm: 50, physicalEvidenceSourceNote: "오래된 케이스 가이드", physicalEvidenceManufacturerModel: "CASE-STALE-1", physicalEvidenceUpdatedAt: "2026-07-01T00:00:00.000Z" } };
    const completePsu = { ...psu, specs: { ...psu.specs, psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent" as const, physicalEvidenceSourceNote: "오래된 PSU 표", physicalEvidenceManufacturerModel: "PSU-STALE-1", physicalEvidenceUpdatedAt: "2026-07-01T00:00:00.000Z" } };
    const fit = gpuFitSummaryFor(metrics, completeGpu, completeCase, completePsu, []);
    const evidence = gpuPurchaseEvidenceFor(fit);

    expect(evidence).toMatchObject({ status: "needs_review", physical: "needs_review", pcieCableTopology: "needs_review" });
    expect(evidence.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "gpu", updatedAt: "2026-07-01T00:00:00.000Z" }),
      expect.objectContaining({ category: "psu", updatedAt: "2026-07-01T00:00:00.000Z" })
    ]));
  });

  it("downgrades complete evidence when a saved source URL check reports an identity mismatch", () => {
    const completeGpu = { ...gpu, specs: { ...gpu.specs, gpuSlotOccupancy: 3, gpuCableBendClearanceMm: 40, physicalEvidenceSourceNote: "GPU 제조사 설치 가이드", physicalEvidenceManufacturerModel: "GPU-EXPECTED", physicalEvidenceSourceUrl: "https://vendor.example/wrong", physicalEvidenceSourceCheck: { requestedUrl: "https://vendor.example/wrong", checkedAt: "2026-09-01T00:00:00.000Z", status: "identity_mismatch" as const, identityStatus: "not_found" as const, redirectCount: 0, httpStatus: 200 } } };
    const completeCase = { ...computerCase, specs: { ...computerCase.specs, caseSidePanelClearanceMm: 50, physicalEvidenceSourceNote: "케이스 제조사 설명서", physicalEvidenceManufacturerModel: "CASE-EXPECTED" } };
    const completePsu = { ...psu, specs: { ...psu.specs, psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent" as const, physicalEvidenceSourceNote: "PSU 제조사 케이블 표", physicalEvidenceManufacturerModel: "PSU-EXPECTED" } };
    const evidence = gpuPurchaseEvidenceFor(gpuFitSummaryFor(metrics, completeGpu, completeCase, completePsu, []));

    expect(evidence).toMatchObject({ status: "needs_review", physical: "needs_review", pcieCableTopology: "compatible" });
    expect(evidence.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "gpu", sourceCheck: expect.objectContaining({ status: "identity_mismatch", identityStatus: "not_found" }) })
    ]));
  });
});
