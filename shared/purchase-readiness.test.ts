import { describe, expect, it } from "vitest";
import type { GpuFitSummary } from "./gpu-fit";
import type { CompatibilityResult } from "./types";
import { purchaseReadinessFor } from "./purchase-readiness";

const unreviewedGpuFit: GpuFitSummary = {
  status: "compatible",
  length: { status: "compatible", actualMm: 340, limitMm: 360, clearanceMm: 20 },
  thickness: { status: "compatible", actualMm: 40, warningThresholdMm: 55 },
  power: { status: "compatible", gpuPowerW: 320, recommendedPsuW: 850, psuWattageW: 1000, headroomW: 150 },
  physical: { status: "not_applicable" },
  connector: {
    status: "compatible",
    options: [[{ kind: "pcie_8pin_6plus2", count: 2 }]],
    requirementsKnown: true,
    adapterOptionIndices: [],
    connectors: { pcie_8pin_6plus2: 2 },
    psuCableTopologyStatus: "not_applicable",
    matchedOptionIndex: 0,
    optionFits: [{ status: "compatible", missing: [], unknown: [] }]
  }
};

const baseResult = {
  status: "compatible",
  blockerCount: 0,
  warningCount: 0,
  unknownCount: 0,
  findings: [],
  metrics: {},
  analysis: { profile: "general", scoreLabel: "계산 불가", scoreBasis: "테스트", confidence: "unknown", factors: [], strengths: [], focusAreas: [], bottlenecks: [], nextActions: [] },
  totalPriceWon: 1_000_000,
  priceComplete: true,
  recommendationPreferences: { profile: "general", priority: "balanced", listingPolicy: "retail_only" },
  dataHealth: { selectedCount: 1, selectedQuantity: 1, freshCount: 1, agingCount: 0, staleCount: 0, unknownFreshnessCount: 0, incompleteCount: 0, unpricedCount: 0, overall: "verified", items: [] },
  checkedAt: "2026-09-01T00:00:00.000Z",
  catalogSnapshotAt: "2026-09-01T00:00:00.000Z",
  engineVersion: "2.56.0"
} as unknown as CompatibilityResult;

describe("purchase readiness", () => {
  it("does not claim purchase readiness when GPU physical evidence is absent", () => {
    const readiness = purchaseReadinessFor({ ...baseResult, gpuFit: unreviewedGpuFit });
    const physical = readiness.items.find((item) => item.id === "physical");

    expect(readiness.state).toBe("review");
    expect(readiness.label).toBe("확인 후 구매");
    expect(physical).toMatchObject({ state: "review" });
    expect(physical?.summary).toContain("부품이 들어가는지, 전원 단자가 맞는지");
  });

  it("can become purchase-ready after complete physical evidence is registered", () => {
    const completeGpuFit: GpuFitSummary = {
      ...unreviewedGpuFit,
      physical: { status: "compatible", gpuSlotOccupancy: 3, gpuCableBendClearanceMm: 40, caseSidePanelClearanceMm: 50, cableClearanceMm: 10, evidenceSources: [{ category: "gpu", manufacturerModel: "GPU-TEST-1", note: "GPU 제조사 설치 가이드" }, { category: "case", manufacturerModel: "CASE-TEST-1", note: "케이스 제조사 설명서" }] },
      connector: { ...unreviewedGpuFit.connector, psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent", psuCableTopologyStatus: "compatible", cableEvidenceSources: [{ category: "psu", manufacturerModel: "PSU-TEST-1", note: "PSU 제조사 케이블 표" }] }
    };
    const readiness = purchaseReadinessFor({ ...baseResult, gpuFit: completeGpuFit });

    expect(readiness.state).toBe("ready");
    expect(readiness.items.find((item) => item.id === "physical")).toMatchObject({ state: "pass" });
  });

  it("keeps a build in review when power or cooling headroom is narrow", () => {
    const readiness = purchaseReadinessFor({
      ...baseResult,
      metrics: {
        powerHeadroomW: 100,
        psuWattageW: 850,
        recommendedPsuW: 750,
        coolerHeadroomW: 20,
        coolerCapacityW: 160,
        cpuPowerW: 140
      }
    });
    const physical = readiness.items.find((item) => item.id === "physical");

    expect(readiness.state).toBe("review");
    expect(physical).toMatchObject({ state: "review", label: "장착·전력·냉각" });
    expect(physical?.summary).toContain("파워·쿨러 정보를 확인");
  });

  it("blocks purchase when a resource budget is below zero", () => {
    const readiness = purchaseReadinessFor({ ...baseResult, metrics: { powerHeadroomW: -1, psuWattageW: 750, recommendedPsuW: 751 } });

    expect(readiness.state).toBe("blocked");
    expect(readiness.items.find((item) => item.id === "physical")).toMatchObject({ state: "blocked" });
  });
});
