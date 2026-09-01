import { describe, expect, it } from "vitest";
import type { BuildSelection, M2SlotProfile, MemoryProfile, Part, PciePowerConnectorKind, PciePowerRequirement } from "../shared/types";
import { BuildGenerationError, assessAlternativePart, alternativeRiskForPart, buildGenerationRecoveryOptionsFor, candidateFixesFinding, candidateSimilarityForBuild, compareCandidateSimilarity, compareCandidateValue, evaluateBuild, generateBuildDraft, isSafeAlternativePart } from "./engine";
import { seedCatalog } from "./seed-catalog";

const compatibleBuild = (): BuildSelection => ({
  cpu: { partId: "cpu-7800x3d", quantity: 1 },
  cooler: { partId: "cooler-tower-am5-1700", quantity: 1 },
  motherboard: { partId: "mb-b650-4x3", quantity: 1 },
  memory: [{ partId: "memory-ddr5-16-5600", quantity: 2 }],
  gpu: { partId: "gpu-rtx-4060", quantity: 1 },
  ssd: [{ partId: "ssd-nvme-1tb", quantity: 1 }],
  hdd: [{ partId: "hdd-seagate-4tb", quantity: 1 }],
  case: { partId: "case-full-airflow", quantity: 1 },
  psu: { partId: "psu-1000w", quantity: 1 },
  useIntegratedGraphics: false
});

function cpuUpgradeFixture(candidatePptW = 170) {
  const baseCpu = seedCatalog.find((part) => part.id === "cpu-7800x3d")!;
  const currentCpu: Part = {
    ...baseCpu,
    id: "cpu-upgrade-current",
    name: "테스트 현재 CPU",
    priceWon: 300000,
    specs: {
      ...baseCpu.specs,
      cores: 6,
      threads: 12,
      boostClockGhz: 4.8,
      cinebenchR23Single: 1800,
      cinebenchR23Multi: 14000,
      pptW: 150,
      tdpW: 105
    }
  };
  const candidateCpu: Part = {
    ...baseCpu,
    id: "cpu-upgrade-candidate",
    name: "테스트 호환 업그레이드 CPU",
    priceWon: 500000,
    specs: {
      ...baseCpu.specs,
      cores: 8,
      threads: 16,
      boostClockGhz: 5.2,
      cinebenchR23Single: 1950,
      cinebenchR23Multi: 18000,
      pptW: candidatePptW,
      tdpW: 120
    }
  };
  const build = compatibleBuild();
  build.cpu = { partId: currentCpu.id, quantity: 1 };
  return { build, catalog: [...seedCatalog, currentCpu, candidateCpu], currentCpu, candidateCpu };
}

function gpuResolutionFixture() {
  const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
  const currentGpu: Part = {
    ...baseGpu,
    id: "gpu-resolution-current",
    name: "테스트 FHD 기준 GPU",
    specs: {
      ...baseGpu.specs,
      gpuVendor: "nvidia",
      gpuArchitectureFamily: "RTX 40",
      vramGb: 8,
      gpuMemoryBandwidthGbps: 288,
      gpuStreamProcessors: 3072,
      gpuBoostClockMhz: 2535,
      gpu3dmarkTimeSpyScore: 7800,
      gpu3dmarkPortRoyalScore: 5200,
      powerW: 115,
      recommendedPsuW: 550
    }
  };
  const candidateGpu: Part = {
    ...baseGpu,
    id: "gpu-resolution-candidate",
    name: "테스트 QHD 권장 GPU",
    priceWon: 650000,
    specs: {
      ...baseGpu.specs,
      gpuVendor: "nvidia",
      gpuArchitectureFamily: "RTX 40",
      vramGb: 12,
      gpuMemoryBandwidthGbps: 432,
      gpuStreamProcessors: 4608,
      gpuBoostClockMhz: 2600,
      gpu3dmarkTimeSpyScore: 11800,
      gpu3dmarkPortRoyalScore: 8200,
      powerW: 180,
      recommendedPsuW: 550
    }
  };
  const build = compatibleBuild();
  build.gpu = { partId: currentGpu.id, quantity: 1 };
  const catalog = seedCatalog.filter((part) => part.category !== "gpu").concat(currentGpu, candidateGpu);
  return { build, catalog, currentGpu, candidateGpu };
}

function balanceFixture() {
  const baseCpu = seedCatalog.find((part) => part.id === "cpu-7800x3d")!;
  const weakCpu: Part = {
    ...baseCpu,
    id: "cpu-balance-weak",
    name: "테스트 CPU 상대 지수 낮음",
    specs: { ...baseCpu.specs, cores: 4, threads: 8, boostClockGhz: 3.8, cinebenchR23Single: 1100, cinebenchR23Multi: 6500 }
  };
  const peerCpu: Part = {
    ...baseCpu,
    id: "cpu-balance-peer",
    name: "테스트 CPU 상대 지수 높음",
    specs: { ...baseCpu.specs, cores: 16, threads: 32, boostClockGhz: 5.4, cinebenchR23Single: 2200, cinebenchR23Multi: 30000 }
  };
  const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
  const strongGpu: Part = {
    ...baseGpu,
    id: "gpu-balance-strong",
    name: "테스트 GPU 상대 지수 높음",
    specs: { ...baseGpu.specs, vramGb: 24, gpuStreamProcessors: 10000, gpuMemoryBandwidthGbps: 900, gpuBoostClockMhz: 3000 }
  };
  const peerGpu: Part = {
    ...baseGpu,
    id: "gpu-balance-peer",
    name: "테스트 GPU 상대 지수 낮음",
    specs: { ...baseGpu.specs, vramGb: 4, gpuStreamProcessors: 1000, gpuMemoryBandwidthGbps: 128, gpuBoostClockMhz: 1500 }
  };
  const build = compatibleBuild();
  build.cpu = { partId: weakCpu.id, quantity: 1 };
  build.gpu = { partId: strongGpu.id, quantity: 1 };
  const catalog = seedCatalog.filter((part) => part.category !== "cpu" && part.category !== "gpu").concat(weakCpu, peerCpu, strongGpu, peerGpu);
  return { build, catalog };
}

function sataM2Fixture(m2Interfaces: Array<"NVMe" | "SATA"> | undefined, ssdInterface: "NVMe" | "SATA" = "SATA") {
  const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
  const baseSsd = seedCatalog.find((part) => part.id === "ssd-nvme-1tb")!;
  const motherboard = {
    ...baseMotherboard,
    id: `mb-m2-interface-${m2Interfaces?.join("-") ?? "unknown"}`,
    specs: { ...baseMotherboard.specs, m2Interfaces }
  };
  const ssd = {
    ...baseSsd,
    id: "ssd-m2-sata-test",
    name: `테스트 M.2 ${ssdInterface} SSD`,
    specs: { ...baseSsd.specs, interface: ssdInterface, formFactor: "M.2 2280" }
  };
  const build = compatibleBuild();
  build.motherboard = { partId: motherboard.id, quantity: 1 };
  build.ssd = [{ partId: ssd.id, quantity: 1 }];
  return { build, catalog: [...seedCatalog, motherboard, ssd] };
}

function m2PcieGenerationFixture(boardGenerations: number[] | undefined, ssdGeneration = 5) {
  const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
  const baseSsd = seedCatalog.find((part) => part.id === "ssd-nvme-1tb")!;
  const motherboard = {
    ...baseMotherboard,
    id: `mb-m2-pcie-${boardGenerations?.join("-") ?? "unknown"}`,
    specs: { ...baseMotherboard.specs, m2PcieGenerations: boardGenerations }
  };
  const ssd = {
    ...baseSsd,
    id: `ssd-m2-pcie-${ssdGeneration}`,
    name: `테스트 PCIe ${ssdGeneration}.0 NVMe SSD`,
    specs: { ...baseSsd.specs, interface: "NVMe", formFactor: "M.2 2280", m2PcieGeneration: ssdGeneration }
  };
  const build = compatibleBuild();
  build.motherboard = { partId: motherboard.id, quantity: 1 };
  build.ssd = [{ partId: ssd.id, quantity: 1 }];
  return { build, catalog: [...seedCatalog, motherboard, ssd] };
}

function memoryFormFactorFixture(boardFormFactor: "DIMM" | "SO-DIMM" | undefined, memoryFormFactor: "DIMM" | "SO-DIMM") {
  const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
  const baseMemory = seedCatalog.find((part) => part.id === "memory-ddr5-16-5600")!;
  const motherboard = {
    ...baseMotherboard,
    id: `mb-memory-form-${boardFormFactor ?? "unknown"}`,
    specs: { ...baseMotherboard.specs, memoryFormFactor: boardFormFactor }
  };
  const memory = {
    ...baseMemory,
    id: `memory-form-${memoryFormFactor}`,
    name: `테스트 ${memoryFormFactor} 메모리`,
    specs: { ...baseMemory.specs, formFactor: memoryFormFactor }
  };
  const build = compatibleBuild();
  build.motherboard = { partId: motherboard.id, quantity: 1 };
  build.memory = [{ partId: memory.id, quantity: 2 }];
  return { build, catalog: [...seedCatalog, motherboard, memory] };
}

function pcieFixture(motherboardX16Slots: number | undefined, motherboardX8Slots: number | undefined = 0, gpuSlotWidth: number = 16) {
  const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
  const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
  const motherboard = {
    ...baseMotherboard,
    id: `mb-pcie-${motherboardX16Slots ?? "unknown"}`,
    specs: { ...baseMotherboard.specs, pcieX16Slots: motherboardX16Slots, pcieX8Slots: motherboardX8Slots }
  };
  const gpu = {
    ...baseGpu,
    id: `gpu-pcie-${gpuSlotWidth}`,
    specs: { ...baseGpu.specs, pcieSlotWidth: gpuSlotWidth }
  };
  const build = compatibleBuild();
  build.motherboard = { partId: motherboard.id, quantity: 1 };
  build.gpu = { partId: gpu.id, quantity: 1 };
  return { build, catalog: [...seedCatalog, motherboard, gpu] };
}

function pciePowerFixture(
  gpuPowerOptions: PciePowerRequirement[][] | undefined,
  psuPowerConnectors: Partial<Record<PciePowerConnectorKind, number>> | undefined
) {
  const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
  const basePsu = seedCatalog.find((part) => part.id === "psu-1000w")!;
  const gpu = {
    ...baseGpu,
    id: "gpu-power-test",
    specs: { ...baseGpu.specs, pciePowerOptions: gpuPowerOptions }
  };
  const psu = {
    ...basePsu,
    id: "psu-power-test",
    specs: { ...basePsu.specs, pciePowerConnectors: psuPowerConnectors }
  };
  const build = compatibleBuild();
  build.gpu = { partId: gpu.id, quantity: 1 };
  build.psu = { partId: psu.id, quantity: 1 };
  return { build, catalog: [...seedCatalog, gpu, psu] };
}

function psuCaseFixture(
  psuDepthMm: number | undefined,
  maxPsuLengthMm: number | undefined,
  psuFormFactor = "ATX",
  supportedPsuFormFactors: string[] | undefined = ["ATX"]
) {
  const basePsu = seedCatalog.find((part) => part.id === "psu-1000w")!;
  const baseCase = seedCatalog.find((part) => part.id === "case-full-airflow")!;
  const psu: Part = {
    ...basePsu,
    id: "psu-case-test",
    specs: { ...basePsu.specs, psuDepthMm, psuFormFactor }
  };
  const computerCase: Part = {
    ...baseCase,
    id: "case-psu-test",
    specs: { ...baseCase.specs, maxPsuLengthMm, supportedPsuFormFactors }
  };
  const build = compatibleBuild();
  build.psu = { partId: psu.id, quantity: 1 };
  build.case = { partId: computerCase.id, quantity: 1 };
  return { build, catalog: [...seedCatalog, psu, computerCase] };
}

function positionedRadiatorFixture(coolerPosition: "front" | "top" | undefined, casePosition: "front" | "top" = "top") {
  const baseCooler = seedCatalog.find((part) => part.id === "cooler-tower-am5-1700")!;
  const baseCase = seedCatalog.find((part) => part.id === "case-full-airflow")!;
  const cooler: Part = {
    ...baseCooler,
    id: `cooler-liquid-${coolerPosition ?? "unknown"}`,
    name: "테스트 240mm 수랭 쿨러",
    specs: { ...baseCooler.specs, coolerType: "liquid", radiatorSizeMm: 240, radiatorPosition: coolerPosition, maxCoolingW: 300 }
  };
  const computerCase: Part = {
    ...baseCase,
    id: `case-radiator-${casePosition}`,
    name: "테스트 위치별 라디에이터 케이스",
    specs: { ...baseCase.specs, radiatorSizesMm: [240], radiatorSupports: [{ position: casePosition, sizesMm: [240] }] }
  };
  const build = compatibleBuild();
  build.cooler = { partId: cooler.id, quantity: 1 };
  build.case = { partId: computerCase.id, quantity: 1 };
  return { build, catalog: [...seedCatalog, cooler, computerCase] };
}

describe("compatibility engine", () => {
  it("reuses request-scoped evaluations for the same candidate build", () => {
    const evaluationCache = new Map<string, ReturnType<typeof evaluateBuild>>();
    const build = compatibleBuild();
    const first = evaluateBuild(build, seedCatalog, {
      includeSuggestions: false,
      evaluationCache
    });
    const second = evaluateBuild(build, seedCatalog, {
      includeSuggestions: false,
      evaluationCache
    });

    expect(evaluationCache.size).toBe(1);
    expect(second).toBe(first);
  });

  it("passes a complete compatible build", () => {
    const result = evaluateBuild(compatibleBuild(), seedCatalog, { includeSuggestions: false });

    expect(result.status).toBe("compatible");
    expect(result.blockerCount).toBe(0);
    expect(result.unknownCount).toBe(0);
    expect(result.metrics.totalMemoryGb).toBe(32);
    expect(result.metrics.memorySlotsUsed).toBe(2);
    expect(result.metrics.m2Used).toBe(1);
    expect(result.metrics.powerHeadroomW).toBe(450);
    expect(result.gpuFit).toMatchObject({ status: "compatible", length: { status: "compatible" }, power: { status: "compatible" }, connector: { status: "compatible" } });
    expect(result.links).toHaveLength(11);
    expect(result.links.every((link) => link.status === "compatible")).toBe(true);
  });

  it("returns a clearly labeled catalog-relative analysis for the selected profile", () => {
    const result = evaluateBuild(compatibleBuild(), seedCatalog, {
      recommendationPreferences: { priority: "balanced", profile: "gaming" }
    });

    expect(result.analysis.profile).toBe("gaming");
    expect(result.analysis.scoreBasis).toContain("실제 벤치마크");
    expect(result.analysis.factors.some((factor) => factor.category === "gpu")).toBe(true);
    expect(["상위권", "균형형", "보완 권장", "계산 불가"]).toContain(result.analysis.scoreLabel);
  });

  it("reports a CPU-GPU balance signal from catalog-relative scores without claiming FPS", () => {
    const { build, catalog } = balanceFixture();
    const result = evaluateBuild(build, catalog, {
      recommendationPreferences: { priority: "performance", profile: "gaming", gamingResolution: "1440p" }
    });

    expect(result.analysis.balance).toMatchObject({ status: "cpu_limited" });
    expect(result.analysis.balance?.cpuScore).toBeLessThan(result.analysis.balance?.gpuScore ?? 0);
    expect(result.analysis.balance?.gap).toBeGreaterThanOrEqual(20);
    expect(result.analysis.balance?.summary).toContain("카탈로그 상대 지수");
    expect(result.analysis.strengths).toHaveLength(2);
    expect(result.analysis.strengths.every((insight) => insight.score >= 75)).toBe(true);
    expect(result.analysis.focusAreas).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "cpu", score: expect.any(Number), title: "CPU 보완" })
    ]));
    expect(result.analysis.nextActions).toContain("CPU·GPU 상대 지수 차이를 확인하고 CPU 업그레이드 후보를 먼저 비교해 보세요.");
  });

  it("surfaces unknown GPU VRAM as an analysis signal without changing compatibility status", () => {
    const result = evaluateBuild(compatibleBuild(), seedCatalog, {
      recommendationPreferences: { priority: "balanced", profile: "gaming", gamingResolution: "4k" }
    });

    expect(result.status).toBe("compatible");
    expect(result.analysis.gpuTarget?.currentFit).toBe("unknown");
    expect(result.analysis.bottlenecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "gpu-target-vram-unknown", severity: "info" })
    ]));
    expect(result.analysis.nextActions).toContain("GPU 제조사 원문에서 VRAM 확인");
  });

  it("skips the presentation analysis on internal candidate evaluations", () => {
    const result = evaluateBuild(compatibleBuild(), seedCatalog, {
      includeSuggestions: false,
      recommendationPreferences: { priority: "balanced", profile: "gaming" }
    });

    expect(result.analysis.scoreLabel).toBe("계산 불가");
    expect(result.analysis.factors).toHaveLength(0);
    const analyzed = evaluateBuild(compatibleBuild(), seedCatalog, {
      includeSuggestions: false,
      includeAnalysis: true,
      recommendationPreferences: { priority: "balanced", profile: "gaming", gamingResolution: "1440p" }
    });

    expect(analyzed.analysis.profile).toBe("gaming");
    expect(analyzed.analysis.factors.length).toBeGreaterThan(0);
    expect(analyzed.analysis.scoreBasis).toContain("실제 벤치마크");
    expect(analyzed.repairPlans).toBeUndefined();
    expect(analyzed.findings.some((finding) => finding.suggestions)).toBe(false);
  });

  it("offers compatible CPU upgrades with measured performance and price evidence", () => {
    const { build, catalog, candidateCpu } = cpuUpgradeFixture();
    const result = evaluateBuild(build, catalog, {
      recommendationPreferences: { priority: "balanced", profile: "general", listingPolicy: "retail_only" }
    });
    const recommendation = result.upgradeRecommendations?.find((item) => item.part.id === candidateCpu.id);

    expect(recommendation).toBeDefined();
    expect(recommendation).toMatchObject({
      category: "cpu",
      currentPartId: "cpu-upgrade-current",
      improvementPercent: expect.any(Number),
      currentPriceWon: 300000,
      priceDeltaWon: 200000,
      compatibilityEvidence: expect.objectContaining({ blockerCount: 0, warningCount: 0, unknownCount: 0 })
    });
    expect(recommendation!.improvementPercent).toBeGreaterThan(0);
    expect(recommendation!.upgradeScore).toBeGreaterThan(50);
    expect(recommendation!.upgradeScore).toBeLessThan(100);
    expect(recommendation!.improvedDimensions).toEqual(expect.arrayContaining(["코어", "R23 멀티"]));
    expect(recommendation!.performanceSummary).toContain("→");
    expect(recommendation!.compatibilityEvidence.powerHeadroomW).toBeGreaterThan(0);
    expect(recommendation!.expansionEvidence).toMatchObject({
      baselineScore: expect.any(Number),
      candidateScore: expect.any(Number),
      scoreDelta: expect.any(Number),
      candidateKnownDimensionCount: expect.any(Number),
      candidateTotalDimensionCount: expect.any(Number)
    });
    expect(result.upgradeRecommendations!.length).toBeLessThanOrEqual(8);
  });

  it("reports applied core totals against the target budget and prioritizes in-budget upgrades", () => {
    const fixture = cpuUpgradeFixture();
    const cheaperCandidate: Part = {
      ...fixture.candidateCpu,
      id: "cpu-upgrade-budget-fit",
      name: "테스트 예산 내 업그레이드 CPU",
      priceWon: 350000
    };
    const expensiveCandidate: Part = {
      ...fixture.candidateCpu,
      id: "cpu-upgrade-budget-over",
      name: "테스트 예산 초과 업그레이드 CPU",
      priceWon: 800000
    };
    const catalog = fixture.catalog
      .filter((part) => part.category !== "cpu")
      .concat(fixture.currentCpu, cheaperCandidate, expensiveCandidate);
    const baseline = evaluateBuild(fixture.build, catalog, { includeSuggestions: false });
    const result = evaluateBuild(fixture.build, catalog, {
      recommendationPreferences: { priority: "budget", profile: "general", budgetWon: baseline.totalPriceWon + 100000 }
    });
    const recommendations = result.upgradeRecommendations ?? [];
    const inBudget = recommendations.find((item) => item.part.id === cheaperCandidate.id);
    const overBudget = recommendations.find((item) => item.part.id === expensiveCandidate.id);

    expect(inBudget?.budgetEvidence).toMatchObject({
      budgetWon: baseline.totalPriceWon + 100000,
      currentCoreTotalPriceWon: baseline.totalPriceWon,
      priceComplete: true,
      withinBudget: true
    });
    expect(inBudget?.budgetEvidence?.afterCoreTotalPriceWon).toBeDefined();
    expect(inBudget?.budgetEvidence?.budgetDeltaWon).toBeLessThanOrEqual(0);
    expect(overBudget?.budgetEvidence).toMatchObject({ priceComplete: true, withinBudget: false });
    expect(overBudget?.budgetEvidence?.budgetDeltaWon).toBeGreaterThan(0);
    expect(recommendations[0]?.part.id).toBe(cheaperCandidate.id);
  });

  it("does not claim upgrade budget fit when the candidate price is unknown", () => {
    const fixture = cpuUpgradeFixture();
    const catalog = fixture.catalog.map((part) => part.id === fixture.candidateCpu.id ? { ...part, priceWon: undefined } : part);
    const result = evaluateBuild(fixture.build, catalog, {
      recommendationPreferences: { priority: "budget", profile: "general", budgetWon: 2_000_000 }
    });
    const recommendation = result.upgradeRecommendations?.find((item) => item.part.id === fixture.candidateCpu.id);

    expect(recommendation?.budgetEvidence).toMatchObject({ budgetWon: 2_000_000, priceComplete: false });
    expect(recommendation?.budgetEvidence?.withinBudget).toBeUndefined();
    expect(recommendation?.budgetEvidence?.afterCoreTotalPriceWon).toBeUndefined();
  });

  it("applies the selected gaming resolution to GPU target evidence and upgrade weighting", () => {
    const { build, catalog, currentGpu, candidateGpu } = gpuResolutionFixture();
    const result = evaluateBuild(build, catalog, {
      recommendationPreferences: { priority: "performance", profile: "gaming", gamingResolution: "1440p" }
    });
    const recommendation = result.upgradeRecommendations?.find((item) => item.part.id === candidateGpu.id);

    expect(result.analysis.gpuTarget).toMatchObject({
      resolution: "1440p",
      targetVramGb: 12,
      currentVramGb: currentGpu.specs.vramGb,
      currentFit: "partial",
      summary: expect.stringContaining("권장 VRAM 12GB")
    });
    expect(result.analysis.bottlenecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "gpu-target-vram", severity: "warning", category: "gpu" })
    ]));
    expect(result.analysis.nextActions).toContain("권장 VRAM을 충족하는 GPU 후보 비교");
    expect(recommendation?.gpuTarget).toMatchObject({
      resolution: "1440p",
      targetVramGb: 12,
      currentFit: "partial",
      candidateVramGb: candidateGpu.specs.vramGb,
      candidateFit: "met"
    });
    expect(recommendation?.compatibilityEvidence).toMatchObject({ blockerCount: 0, warningCount: 0, unknownCount: 0 });
    expect(recommendation?.compatibilityEvidence.powerHeadroomW).toBeGreaterThan(0);
    expect(recommendation?.compatibilityEvidence.gpuClearanceMm).toBeGreaterThan(0);
    expect(recommendation?.reason).toContain("QHD · 1440p");
    expect(recommendation?.similarityEvidence).toMatchObject({ basis: "mixed" });
    expect(recommendation?.performanceSummary).toContain("Time Spy");
    expect(recommendation?.physicalEvidence).toMatchObject({ status: "review" });
    expect(recommendation?.physicalEvidence?.summary).toContain("GPU·케이스 물리 근거");
  });

  it("applies the selected gaming refresh rate to target evidence and CPU-GPU comparison weights", () => {
    const { build, catalog, currentGpu, candidateGpu } = gpuResolutionFixture();
    const standardRate = evaluateBuild(build, catalog, {
      recommendationPreferences: { priority: "performance", profile: "gaming", gamingResolution: "1440p", gamingRefreshRate: 60 }
    });
    const highRate = evaluateBuild(build, catalog, {
      recommendationPreferences: { priority: "performance", profile: "gaming", gamingResolution: "1440p", gamingRefreshRate: 240 }
    });
    const standardSimilarity = candidateSimilarityForBuild(build, catalog, "gpu", candidateGpu, "gaming", "1440p", 60);
    const highSimilarity = candidateSimilarityForBuild(build, catalog, "gpu", candidateGpu, "gaming", "1440p", 240);
    const standardTimeSpyWeight = standardSimilarity.similarityEvidence.dimensions.find((dimension) => dimension.key === "gpu3dmarkTimeSpyScore")?.weight;
    const highTimeSpyWeight = highSimilarity.similarityEvidence.dimensions.find((dimension) => dimension.key === "gpu3dmarkTimeSpyScore")?.weight;

    expect(standardRate.analysis.gpuTarget).toMatchObject({ refreshRate: 60, currentVramGb: currentGpu.specs.vramGb });
    expect(highRate.analysis.gpuTarget).toMatchObject({ refreshRate: 240, currentVramGb: currentGpu.specs.vramGb });
    expect(standardRate.analysis.gpuTarget?.summary).toContain("60Hz");
    expect(highRate.analysis.gpuTarget?.summary).toContain("240Hz");
    expect(highTimeSpyWeight).toBeGreaterThan(standardTimeSpyWeight ?? 0);
  });

  it("keeps upgrade compatibility evidence focused on the replaced category", () => {
    const baseSsd = seedCatalog.find((part) => part.id === "ssd-nvme-1tb")!;
    const candidateSsd: Part = {
      ...baseSsd,
      id: "ssd-upgrade-evidence-candidate",
      name: "테스트 카테고리 근거 2TB SSD",
      specs: {
        ...baseSsd.specs,
        capacityGb: 2000,
        sequentialReadMbps: (baseSsd.specs.sequentialReadMbps ?? 0) + 100,
        sequentialWriteMbps: (baseSsd.specs.sequentialWriteMbps ?? 0) + 100
      }
    };
    const build = compatibleBuild();
    const catalog = [...seedCatalog, candidateSsd];
    const result = evaluateBuild(build, catalog, {
      recommendationPreferences: { priority: "balanced", profile: "general" }
    });
    const ssdRecommendation = result.upgradeRecommendations?.find((item) => item.category === "ssd");

    expect(ssdRecommendation).toBeDefined();
    expect(ssdRecommendation?.compatibilityEvidence).not.toHaveProperty("powerHeadroomW");
    expect(ssdRecommendation?.compatibilityEvidence).not.toHaveProperty("coolerHeadroomW");
    expect(ssdRecommendation?.compatibilityEvidence).not.toHaveProperty("gpuClearanceMm");
    expect(ssdRecommendation?.compatibilityEvidence.m2Headroom ?? ssdRecommendation?.compatibilityEvidence.sataHeadroom).toBeDefined();
  });

  it("offers a compatible RAM capacity upgrade with memory headroom evidence", () => {
    const baseMemory = seedCatalog.find((part) => part.id === "memory-ddr5-16-5600")!;
    const candidateMemory: Part = {
      ...baseMemory,
      id: "memory-upgrade-capacity-candidate",
      name: "테스트 호환 32GB 메모리",
      priceWon: 110000,
      specs: { ...baseMemory.specs, capacityGb: 32 }
    };
    const build = compatibleBuild();
    const result = evaluateBuild(build, [...seedCatalog, candidateMemory], {
      recommendationPreferences: { priority: "performance", profile: "creator" }
    });
    const recommendation = result.upgradeRecommendations?.find((item) => item.part.id === candidateMemory.id);

    expect(recommendation).toBeDefined();
    expect(recommendation?.category).toBe("memory");
    expect(recommendation?.quantity).toBe(2);
    expect(recommendation?.priceDeltaWon).toBe(104000);
    expect(recommendation?.improvedDimensions).toContain("용량");
    expect(recommendation?.compatibilityEvidence).toMatchObject({ blockerCount: 0, warningCount: 0, unknownCount: 0 });
    expect(recommendation?.compatibilityEvidence.memoryHeadroomGb).toBeGreaterThan(0);
    expect(recommendation?.compatibilityEvidence.memorySlotHeadroom).toBeGreaterThan(0);
  });

  it("offers a two-part compatible upgrade bundle with combined price and budget evidence", () => {
    const cpuFixture = cpuUpgradeFixture();
    const baseMemory = seedCatalog.find((part) => part.id === "memory-ddr5-16-5600")!;
    const candidateMemory: Part = {
      ...baseMemory,
      id: "memory-upgrade-bundle-candidate",
      name: "테스트 조합 32GB 메모리",
      priceWon: 110000,
      specs: { ...baseMemory.specs, capacityGb: 32 }
    };
    const catalog = [...cpuFixture.catalog, candidateMemory];
    const baseline = evaluateBuild(cpuFixture.build, catalog, { includeSuggestions: false });
    const budgetWon = baseline.totalPriceWon + 350000;
    const result = evaluateBuild(cpuFixture.build, catalog, {
      recommendationPreferences: { priority: "budget", profile: "creator", budgetWon }
    });
    const bundle = result.upgradeBundles?.find((item) => {
      const categories = item.changes.map((change) => change.category);
      return categories.includes("cpu") && categories.includes("memory");
    });

    expect(bundle).toBeDefined();
    expect(bundle?.changes).toHaveLength(2);
    expect(new Set(bundle?.changes.map((change) => change.category)).size).toBe(2);
    expect(bundle?.totalPriceDeltaWon).toBe(304000);
    expect(bundle?.expansionEvidence).toMatchObject({
      baselineScore: expect.any(Number),
      candidateScore: expect.any(Number),
      scoreDelta: expect.any(Number),
      candidateKnownDimensionCount: expect.any(Number),
      candidateTotalDimensionCount: expect.any(Number)
    });
    expect(bundle?.compatibilityEvidence).toEqual({ blockerCount: 0, warningCount: 0, unknownCount: 0 });
    expect(bundle?.budgetEvidence).toMatchObject({ budgetWon, priceComplete: true, withinBudget: true });
    expect(bundle?.budgetEvidence?.afterCoreTotalPriceWon).toBe(baseline.totalPriceWon + 304000);
    expect(result.upgradeBundleSearch).toMatchObject({
      candidateCount: expect.any(Number),
      candidateCategoryCount: expect.any(Number),
      candidatePairCount: expect.any(Number),
      evaluatedPairCount: expect.any(Number),
      safeBundleCount: expect.any(Number),
      returnedBundleCount: result.upgradeBundles?.length
    });
    expect(result.upgradeBundleSearch?.safeBundleCount).toBeGreaterThanOrEqual(result.upgradeBundleSearch?.returnedBundleCount ?? 0);
    expect(result.upgradeBundleSearch?.candidateTripleCount).toBeGreaterThan(0);
    expect(result.upgradeBundles?.some((item) => item.changes.length === 3)).toBe(true);
  });

  it("does not collapse a multi-SSD build into a single-disk upgrade recommendation", () => {
    const build = compatibleBuild();
    build.ssd = [
      { partId: "ssd-nvme-1tb", quantity: 1 },
      { partId: "ssd-sata-1tb", quantity: 1 }
    ];
    const result = evaluateBuild(build, seedCatalog, {
      recommendationPreferences: { priority: "performance", profile: "general" }
    });

    expect(result.upgradeRecommendations?.some((item) => item.category === "ssd")).toBe(false);
  });

  it("does not offer an upgrade that creates a new power blocker", () => {
    const { build, catalog, candidateCpu } = cpuUpgradeFixture(220);
    const result = evaluateBuild(build, catalog, {
      recommendationPreferences: { priority: "performance", profile: "general", listingPolicy: "retail_only" }
    });

    expect(result.upgradeRecommendations?.some((item) => item.part.id === candidateCpu.id) ?? false).toBe(false);
    const candidateEvaluation = evaluateBuild({ ...build, cpu: { partId: candidateCpu.id, quantity: 1 } }, catalog, { includeSuggestions: false });
    expect(candidateEvaluation.findings.some((finding) => finding.ruleId === "cpu-motherboard-power")).toBe(true);
  });

  it("does not offer a higher-generation SSD when it introduces a link downgrade warning", () => {
    const fixture = m2PcieGenerationFixture([4], 4);
    const currentSsd = {
      ...fixture.catalog.find((part) => part.id === "ssd-m2-pcie-4")!,
      id: "ssd-upgrade-current",
      specs: { ...fixture.catalog.find((part) => part.id === "ssd-m2-pcie-4")!.specs, sequentialReadMbps: 7000, sequentialWriteMbps: 6000 }
    };
    const candidateSsd = {
      ...currentSsd,
      id: "ssd-upgrade-pcie5",
      name: "PCIe 5.0 경고 유발 SSD",
      specs: { ...currentSsd.specs, m2PcieGeneration: 5, sequentialReadMbps: 10000, sequentialWriteMbps: 9000 }
    };
    const build = { ...fixture.build, ssd: [{ partId: currentSsd.id, quantity: 1 }] };
    const catalog = [...fixture.catalog, currentSsd, candidateSsd];
    const result = evaluateBuild(build, catalog, { recommendationPreferences: { priority: "performance", profile: "general", listingPolicy: "retail_only" } });

    expect(result.findings.some((finding) => finding.ruleId === "m2-pcie-generation")).toBe(false);
    expect(result.upgradeRecommendations?.some((item) => item.part.id === candidateSsd.id) ?? false).toBe(false);
    const candidateEvaluation = evaluateBuild({ ...build, ssd: [{ partId: candidateSsd.id, quantity: 1 }] }, catalog, { includeSuggestions: false });
    expect(candidateEvaluation.findings.find((finding) => finding.ruleId === "m2-pcie-generation")?.severity).toBe("warning");
  });

  it("surfaces a critical power bottleneck in the analysis when the PSU is undersized", () => {
    const build = compatibleBuild();
    build.gpu = { partId: "gpu-rtx-5090", quantity: 1 };
    build.psu = { partId: "psu-650w", quantity: 1 };
    const result = evaluateBuild(build, seedCatalog);

    expect(result.findings.some((finding) => finding.ruleId === "gpu-psu-power")).toBe(true);
    expect(result.gpuFit).toMatchObject({ status: "incompatible", power: { status: "incompatible" } });
    expect(result.analysis.bottlenecks.some((bottleneck) => bottleneck.severity === "critical" && bottleneck.category === "psu")).toBe(true);
    expect(result.analysis.nextActions.some((action) => action.includes("파워"))).toBe(true);
  });

  it("keeps multi-target replacement suggestions representative of each replacement category", () => {
    const build = compatibleBuild();
    build.gpu = { partId: "gpu-rtx-5090", quantity: 1 };
    build.psu = { partId: "psu-650w", quantity: 1 };
    const finding = evaluateBuild(build, seedCatalog).findings.find((item) => item.ruleId === "gpu-psu-power");
    const categories = new Set((finding?.suggestions ?? []).map((suggestion) => suggestion.part.category));

    expect(categories).toEqual(new Set(["gpu", "psu"]));
    expect(finding?.suggestions?.some((suggestion) => suggestion.part.category === "gpu" && suggestion.fixesCurrentIssue)).toBe(true);
    expect(finding?.suggestions?.some((suggestion) => suggestion.part.category === "psu" && suggestion.fixesCurrentIssue)).toBe(true);
  });

  it("accepts a GPU when a compatible PCIe x16 slot is confirmed", () => {
    const { build, catalog } = pcieFixture(1, 0, 16);
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });

    expect(result.findings.some((finding) => finding.ruleId === "gpu-motherboard-pcie")).toBe(false);
    expect(result.links.find((link) => link.id === "motherboard-gpu")?.status).toBe("compatible");
  });

  it("blocks a GPU when the motherboard explicitly has no PCIe x16 slot", () => {
    const { build, catalog } = pcieFixture(0, 0, 16);
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "gpu-motherboard-pcie");

    expect(finding?.severity).toBe("blocker");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "그래픽카드 PCIe 장착 폭", actual: "x16" }),
      expect.objectContaining({ label: "메인보드 PCIe x16 슬롯", expected: "0개" })
    ]));
    expect(result.links.find((link) => link.id === "motherboard-gpu")?.status).toBe("issue");
  });

  it("marks GPU PCIe compatibility as unknown when motherboard slot counts are missing", () => {
    const { build, catalog } = pcieFixture(undefined, undefined, 16);
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "gpu-motherboard-pcie");

    expect(finding?.severity).toBe("unknown");
    expect(result.status).toBe("needs_review");
  });

  it("blocks a GPU when the PSU has fewer confirmed 8-pin connectors than required", () => {
    const { build, catalog } = pciePowerFixture(
      [[{ kind: "pcie_8pin_6plus2", count: 2 }]],
      { pcie_8pin_6plus2: 1 }
    );
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "gpu-psu-connector");

    expect(finding?.severity).toBe("blocker");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "GPU 요구 전원", actual: "8핀(6+2) 2개" }),
      expect.objectContaining({ label: "PSU 확인 커넥터", expected: "8핀(6+2) 1개" })
    ]));
    expect(result.links.find((link) => link.id === "gpu-psu")?.status).toBe("issue");
  });

  it("accepts a high-power GPU through an explicitly included 8-pin adapter", () => {
    const { build, catalog } = pciePowerFixture(
      [[{ kind: "12v2x6", count: 1 }], [{ kind: "pcie_8pin_6plus2", count: 2 }]],
      { pcie_8pin_6plus2: 2 }
    );
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });

    expect(result.findings.some((finding) => finding.ruleId === "gpu-psu-connector")).toBe(false);
  });

  it("keeps connector compatibility unknown when the PSU connector inventory is incomplete", () => {
    const { build, catalog } = pciePowerFixture(
      [[{ kind: "12v2x6", count: 1 }]],
      { pcie_8pin_6plus2: 2 }
    );
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "gpu-psu-connector");

    expect(finding?.severity).toBe("unknown");
    expect(result.status).toBe("needs_review");
  });

  it("does not silently pass when both GPU and PSU connector evidence is missing", () => {
    const { build, catalog } = pciePowerFixture(undefined, undefined);
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "gpu-psu-connector");

    expect(finding?.severity).toBe("unknown");
    expect(result.links.find((link) => link.id === "gpu-psu")?.status).toBe("unknown");
  });

  it("does not equate 12VHPWR with 12V2x6 without an explicit adapter path", () => {
    const { build, catalog } = pciePowerFixture(
      [[{ kind: "12vhpwr", count: 1 }]],
      { "12v2x6": 1 }
    );
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "gpu-psu-connector");

    expect(finding?.severity).toBe("unknown");
  });

  it("recommends a compatible PSU candidate for a confirmed connector shortage", () => {
    const basePsu = seedCatalog.find((part) => part.id === "psu-1000w")!;
    const currentPsu = {
      ...basePsu,
      id: "psu-current-8pin-1",
      name: "테스트 8핀 1개 파워",
      specs: { ...basePsu.specs, pciePowerConnectors: { pcie_8pin_6plus2: 1 } }
    };
    const replacementPsu = {
      ...basePsu,
      id: "psu-replacement-8pin-2",
      name: "테스트 8핀 2개 파워",
      specs: { ...basePsu.specs, pciePowerConnectors: { pcie_8pin_6plus2: 2 } }
    };
    const gpu: Part = {
      ...seedCatalog.find((part) => part.id === "gpu-rtx-4060")!,
      id: "gpu-requires-2x8pin",
      specs: { ...seedCatalog.find((part) => part.id === "gpu-rtx-4060")!.specs, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 2 }]] }
    };
    const build = compatibleBuild();
    build.gpu = { partId: gpu.id, quantity: 1 };
    build.psu = { partId: currentPsu.id, quantity: 1 };
    const result = evaluateBuild(build, [...seedCatalog, currentPsu, replacementPsu, gpu]);
    const finding = result.findings.find((item) => item.ruleId === "gpu-psu-connector");

    expect(finding?.severity).toBe("blocker");
    expect(finding?.suggestions?.some((suggestion) => suggestion.part.id === replacementPsu.id && suggestion.fixesCurrentIssue)).toBe(true);
  });

  it("marks explicit PCIe lane sharing as unknown without claiming a specific slot is disabled", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const motherboard = {
      ...baseMotherboard,
      id: "mb-m2-lane-sharing",
      specs: { ...baseMotherboard.specs, m2LaneSharing: undefined, m2LaneSharingScopes: ["pcie" as const], m2LaneSharingNote: "PCIe 레인공유" }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    const result = evaluateBuild(build, [...seedCatalog, motherboard], { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "m2-pcie-lane-sharing");

    expect(finding?.severity).toBe("unknown");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "메인보드 원문 표기", actual: "PCIe 레인공유" })
    ]));
    expect(result.links.find((link) => link.id === "motherboard-ssd")?.status).toBe("compatible");
    expect(result.links.find((link) => link.id === "motherboard-gpu")?.status).toBe("unknown");
  });

  it("does not treat SATA-only lane sharing as a PCIe GPU uncertainty", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const motherboard = {
      ...baseMotherboard,
      id: "mb-m2-sata-sharing",
      specs: { ...baseMotherboard.specs, m2LaneSharing: undefined, m2LaneSharingScopes: ["sata" as const], m2LaneSharingNote: "SATA 레인공유" }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    const result = evaluateBuild(build, [...seedCatalog, motherboard], { includeSuggestions: false });

    expect(result.findings.some((finding) => finding.ruleId === "m2-pcie-lane-sharing")).toBe(false);
    expect(result.links.find((link) => link.id === "motherboard-gpu")?.status).toBe("compatible");
  });

  it("warns about a thick GPU as a physical-clearance review, not a blocker", () => {
    const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
    const gpu = { ...baseGpu, id: "gpu-thick-test", specs: { ...baseGpu.specs, thicknessMm: 66 } };
    const build = compatibleBuild();
    build.gpu = { partId: gpu.id, quantity: 1 };
    const result = evaluateBuild(build, [...seedCatalog, gpu], { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "gpu-thickness");

    expect(finding?.severity).toBe("warning");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "그래픽카드 두께", actual: "66mm" })
    ]));
    expect(result.metrics.gpuThicknessMm).toBe(66);
    expect(result.links.find((link) => link.id === "gpu-case")?.status).toBe("issue");
  });

  it("marks GPU-case thickness as unknown when the selected GPU has no thickness evidence", () => {
    const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
    const gpu = { ...baseGpu, id: "gpu-thickness-unknown", specs: { ...baseGpu.specs, thicknessMm: undefined } };
    const build = compatibleBuild();
    build.gpu = { partId: gpu.id, quantity: 1 };
    const result = evaluateBuild(build, [...seedCatalog, gpu], { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "gpu-thickness");

    expect(finding?.severity).toBe("unknown");
    expect(result.links.find((link) => link.id === "gpu-case")?.status).toBe("unknown");
  });

  it("blocks a manually verified GPU cable bend conflict without deriving it from card thickness", () => {
    const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
    const baseCase = seedCatalog.find((part) => part.id === "case-full-airflow")!;
    const gpu: Part = { ...baseGpu, id: "gpu-cable-clearance-test", specs: { ...baseGpu.specs, gpuSlotOccupancy: 3, gpuCableBendClearanceMm: 40 } };
    const computerCase: Part = { ...baseCase, id: "case-cable-clearance-test", specs: { ...baseCase.specs, caseSidePanelClearanceMm: 30 } };
    const build = compatibleBuild();
    build.gpu = { partId: gpu.id, quantity: 1 };
    build.case = { partId: computerCase.id, quantity: 1 };
    const result = evaluateBuild(build, [...seedCatalog, gpu, computerCase], { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "gpu-cable-clearance");

    expect(finding?.severity).toBe("blocker");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "GPU 케이블 굽힘 여유", expected: "40mm" }),
      expect.objectContaining({ label: "케이스 측면 케이블 여유", actual: "30mm" })
    ]));
    expect(result.gpuFit?.physical).toMatchObject({ status: "incompatible", cableClearanceMm: -10 });
  });

  it("keeps a partial manually verified cable clearance as review instead of blocking", () => {
    const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
    const gpu: Part = { ...baseGpu, id: "gpu-cable-clearance-partial", specs: { ...baseGpu.specs, gpuCableBendClearanceMm: 40 } };
    const build = compatibleBuild();
    build.gpu = { partId: gpu.id, quantity: 1 };
    const result = evaluateBuild(build, [...seedCatalog, gpu], { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "gpu-cable-clearance");

    expect(finding?.severity).toBe("unknown");
    expect(result.gpuFit?.physical.status).toBe("needs_review");
  });

  it("labels a safe GPU alternative when its physical evidence is not reviewed", () => {
    const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
    const currentGpu: Part = { ...baseGpu, id: "gpu-physical-current", specs: { ...baseGpu.specs, lengthMm: 450 } };
    const candidateGpu: Part = { ...baseGpu, id: "gpu-physical-candidate", specs: { ...baseGpu.specs, lengthMm: 280 } };
    const build = compatibleBuild();
    build.gpu = { partId: currentGpu.id, quantity: 1 };
    const catalog = seedCatalog.filter((part) => part.category !== "gpu").concat(currentGpu, candidateGpu);
    const result = evaluateBuild(build, catalog);
    const suggestion = result.findings.find((item) => item.ruleId === "gpu-case-length")?.suggestions?.find((item) => item.part.id === candidateGpu.id);

    expect(suggestion?.fixesCurrentIssue).toBe(true);
    expect(suggestion?.physicalEvidence).toMatchObject({ status: "review" });
    expect(suggestion?.physicalEvidence?.summary).toContain("GPU·케이스 물리 근거");
  });

  it("marks a GPU alternative's physical evidence as verified only after values and provenance are registered", () => {
    const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
    const currentGpu: Part = { ...baseGpu, id: "gpu-physical-current-verified", specs: { ...baseGpu.specs, lengthMm: 450 } };
    const sourceCheckedAt = new Date().toISOString();
    const candidateGpu: Part = { ...baseGpu, id: "gpu-physical-candidate-verified", specs: { ...baseGpu.specs, lengthMm: 280, gpuSlotOccupancy: 2, gpuCableBendClearanceMm: 35, physicalEvidenceSourceNote: "GPU 제조사 설치 가이드", physicalEvidenceManufacturerModel: "GPU-TEST-VERIFIED", physicalEvidenceSourceUrl: "https://vendor.example/gpu-manual", physicalEvidenceSourceCheck: { requestedUrl: "https://vendor.example/gpu-manual", checkedAt: sourceCheckedAt, status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0 } } };
    const baseCase = seedCatalog.find((part) => part.id === "case-full-airflow")!;
    const computerCase: Part = { ...baseCase, specs: { ...baseCase.specs, caseSidePanelClearanceMm: 50, physicalEvidenceSourceNote: "케이스 제조사 조립 설명서", physicalEvidenceManufacturerModel: "CASE-TEST-VERIFIED", physicalEvidenceSourceUrl: "https://vendor.example/case-manual", physicalEvidenceSourceCheck: { requestedUrl: "https://vendor.example/case-manual", checkedAt: sourceCheckedAt, status: "reachable" as const, identityStatus: "matched" as const, redirectCount: 0 } } };
    const build = compatibleBuild();
    build.gpu = { partId: currentGpu.id, quantity: 1 };
    const catalog = seedCatalog.filter((part) => part.category !== "gpu" && part.id !== baseCase.id).concat(currentGpu, candidateGpu, computerCase);
    const result = evaluateBuild(build, catalog);
    const suggestion = result.findings.find((item) => item.ruleId === "gpu-case-length")?.suggestions?.find((item) => item.part.id === candidateGpu.id);

    expect(suggestion?.fixesCurrentIssue).toBe(true);
    expect(suggestion?.physicalEvidence).toMatchObject({ status: "verified" });
    expect(suggestion?.physicalEvidence?.summary).toContain("확인되었습니다");
    expect(suggestion?.physicalEvidence?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "gpu", url: "https://vendor.example/gpu-manual" }),
      expect.objectContaining({ category: "case", url: "https://vendor.example/case-manual" })
    ]));
  });

  it("warns when a GPU uses multiple 8-pin connectors but the PSU has fewer independent cable runs", () => {
    const fixture = pciePowerFixture([[{ kind: "pcie_8pin_6plus2", count: 2 }]], { pcie_8pin_6plus2: 2 });
    const catalog = fixture.catalog.map((part) => part.id === "psu-power-test"
      ? { ...part, specs: { ...part.specs, psuIndependentPcieCableRuns: 1, psuPcieCableTopology: "independent" as const } }
      : part);
    const result = evaluateBuild(fixture.build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "gpu-psu-cable-topology");

    expect(finding?.severity).toBe("warning");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "필요한 8핀 커넥터", actual: "2개" }),
      expect.objectContaining({ label: "검수된 독립 PCIe 케이블 런", actual: "1개" })
    ]));
    expect(result.gpuFit?.connector.psuCableTopologyStatus).toBe("needs_review");
    expect(result.links.find((link) => link.id === "gpu-psu")?.status).toBe("issue");
  });

  it("accepts multiple 8-pin connectors when independent cable runs are explicitly sufficient", () => {
    const fixture = pciePowerFixture([[{ kind: "pcie_8pin_6plus2", count: 2 }]], { pcie_8pin_6plus2: 2 });
    const catalog = fixture.catalog.map((part) => part.id === "psu-power-test"
      ? { ...part, specs: { ...part.specs, psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent" as const } }
      : part);
    const result = evaluateBuild(fixture.build, catalog, { includeSuggestions: false });

    expect(result.findings.some((item) => item.ruleId === "gpu-psu-cable-topology")).toBe(false);
    expect(result.gpuFit?.connector.psuCableTopologyStatus).toBe("compatible");
  });

  it("does not present a PSU without topology evidence as solving a multi-8-pin warning", () => {
    const fixture = pciePowerFixture([[{ kind: "pcie_8pin_6plus2", count: 2 }]], { pcie_8pin_6plus2: 2 });
    const catalog = fixture.catalog.map((part) => part.id === "psu-power-test"
      ? { ...part, specs: { ...part.specs, psuIndependentPcieCableRuns: 1, psuPcieCableTopology: "independent" as const } }
      : part);
    const basePsu = catalog.find((part) => part.id === "psu-power-test")!;
    const candidateWithoutProof: Part = {
      ...basePsu,
      id: "psu-topology-candidate-no-proof",
      name: "토폴로지 근거 없는 후보 PSU",
      specs: { ...basePsu.specs, psuIndependentPcieCableRuns: undefined, psuPcieCableTopology: undefined }
    };
    const finding = evaluateBuild(fixture.build, catalog, { includeSuggestions: false }).findings.find((item) => item.ruleId === "gpu-psu-cable-topology");
    expect(finding).toBeDefined();
    const assessment = assessAlternativePart(fixture.build, [...catalog, candidateWithoutProof], "psu", candidateWithoutProof, finding);

    expect(assessment.fixesCurrentIssue).toBe(false);
  });

  it("recognizes a PSU with sufficient independent runs as solving a multi-8-pin warning", () => {
    const fixture = pciePowerFixture([[{ kind: "pcie_8pin_6plus2", count: 2 }]], { pcie_8pin_6plus2: 2 });
    const catalog = fixture.catalog.map((part) => part.id === "psu-power-test"
      ? { ...part, specs: { ...part.specs, psuIndependentPcieCableRuns: 1, psuPcieCableTopology: "independent" as const } }
      : part);
    const basePsu = catalog.find((part) => part.id === "psu-power-test")!;
    const verifiedCandidate: Part = {
      ...basePsu,
      id: "psu-topology-candidate-verified",
      name: "독립 케이블 검수 후보 PSU",
      specs: { ...basePsu.specs, psuIndependentPcieCableRuns: 2, psuPcieCableTopology: "independent" as const }
    };
    const finding = evaluateBuild(fixture.build, catalog, { includeSuggestions: false }).findings.find((item) => item.ruleId === "gpu-psu-cable-topology");
    expect(finding).toBeDefined();
    const assessment = assessAlternativePart(fixture.build, [...catalog, verifiedCandidate], "psu", verifiedCandidate, finding);

    expect(assessment.fixesCurrentIssue).toBe(true);
  });

  it("includes physical purchase evidence in precision picker assessments", () => {
    const fixture = pciePowerFixture([[{ kind: "pcie_8pin_6plus2", count: 2 }]], { pcie_8pin_6plus2: 2 });
    const basePsu = fixture.catalog.find((part) => part.id === "psu-power-test")!;
    const candidate: Part = {
      ...basePsu,
      id: "psu-picker-physical-evidence",
      name: "물리 근거가 표시되는 후보 PSU",
      specs: {
        ...basePsu.specs,
        psuIndependentPcieCableRuns: 2,
        psuPcieCableTopology: "independent",
        physicalEvidenceSourceNote: "PSU 제조사 케이블 구성표",
        physicalEvidenceManufacturerModel: "PSU-TEST-PICKER",
        physicalEvidenceSourceUrl: "https://vendor.example/psu-manual"
      }
    };
    const assessment = assessAlternativePart(fixture.build, [...fixture.catalog, candidate], "psu", candidate);

    expect(assessment.physicalEvidence).toMatchObject({ status: "review", sources: [{ category: "psu", manufacturerModel: "PSU-TEST-PICKER", note: "PSU 제조사 케이블 구성표", url: "https://vendor.example/psu-manual" }] });
  });

  it("accepts a PSU when its depth and form factor fit the case", () => {
    const { build, catalog } = psuCaseFixture(150, 220, "ATX", ["ATX"]);
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });

    expect(result.findings.some((finding) => finding.ruleId === "psu-case-length")).toBe(false);
    expect(result.findings.some((finding) => finding.ruleId === "psu-case-form-factor")).toBe(false);
    expect(result.metrics.psuClearanceMm).toBe(70);
    expect(result.links.find((link) => link.id === "psu-case")?.status).toBe("compatible");
  });

  it("blocks a PSU that is longer than the case power bay", () => {
    const { build, catalog } = psuCaseFixture(240, 220, "ATX", ["ATX"]);
    const baseCase = seedCatalog.find((part) => part.id === "case-full-airflow")!;
    const roomyCase: Part = {
      ...baseCase,
      id: "case-roomy-psu",
      name: "테스트 대형 파워 수용 케이스",
      specs: { ...baseCase.specs, maxPsuLengthMm: 260, supportedPsuFormFactors: ["ATX"] }
    };
    const result = evaluateBuild(build, [...catalog, roomyCase]);
    const finding = result.findings.find((item) => item.ruleId === "psu-case-length");

    expect(finding?.severity).toBe("blocker");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "파워서플라이 깊이", actual: "240mm" }),
      expect.objectContaining({ label: "케이스 허용 파워 길이", expected: "220mm" })
    ]));
    expect(finding?.suggestions?.some((suggestion) => suggestion.part.id === roomyCase.id && suggestion.fixesCurrentIssue)).toBe(true);
    expect(result.links.find((link) => link.id === "psu-case")?.status).toBe("issue");
  });

  it("blocks a PSU form factor that the case does not support", () => {
    const { build, catalog } = psuCaseFixture(150, 220, "SFX", ["ATX"]);
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "psu-case-form-factor");

    expect(finding?.severity).toBe("blocker");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "파워서플라이 규격", actual: "SFX" }),
      expect.objectContaining({ label: "케이스 지원 파워 규격", expected: "ATX" })
    ]));
  });

  it("marks PSU-case fit as unknown when one physical dimension is missing", () => {
    const { build, catalog } = psuCaseFixture(undefined, 220, "ATX", ["ATX"]);
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "psu-case-length");

    expect(finding?.severity).toBe("unknown");
    expect(result.status).toBe("needs_review");
  });

  it("does not call a replacement fully compatible while a warning remains", () => {
    const { build, catalog } = psuCaseFixture(240, 220, "ATX", ["ATX"]);
    const baseCase = seedCatalog.find((part) => part.id === "case-full-airflow")!;
    const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
    const roomyCase: Part = {
      ...baseCase,
      id: "case-roomy-psu-warning",
      name: "테스트 여유 케이스",
      specs: { ...baseCase.specs, maxPsuLengthMm: 260, supportedPsuFormFactors: ["ATX"] }
    };
    const thickGpu: Part = {
      ...baseGpu,
      id: "gpu-thick-remaining-warning",
      specs: { ...baseGpu.specs, thicknessMm: 66 }
    };
    build.gpu = { partId: thickGpu.id, quantity: 1 };
    const result = evaluateBuild(build, [...catalog, roomyCase, thickGpu]);
    const finding = result.findings.find((item) => item.ruleId === "psu-case-length");
    const suggestion = finding?.suggestions?.find((item) => item.part.id === roomyCase.id);

    expect(suggestion?.remainingWarnings).toBeGreaterThan(0);
    expect(suggestion?.reason).toContain("주의");
    expect(suggestion?.reason).not.toContain("전체 구성도 호환됩니다");
  });

  it("reports the multiple conflicts demonstrated in the video", () => {
    const result = evaluateBuild(
      {
        cpu: { partId: "cpu-7500f", quantity: 1 },
        cooler: { partId: "cooler-small-am5", quantity: 1 },
        motherboard: { partId: "mb-a620-small", quantity: 1 },
        memory: [{ partId: "memory-ddr5-32-7200", quantity: 4 }],
        gpu: { partId: "gpu-rtx-5090", quantity: 1 },
        ssd: [{ partId: "ssd-nvme-1tb", quantity: 4 }],
        hdd: [{ partId: "hdd-seagate-4tb", quantity: 4 }],
        case: { partId: "case-compact-matx", quantity: 1 },
        psu: { partId: "psu-650w", quantity: 1 },
        useIntegratedGraphics: false
      },
      seedCatalog
    );

    expect(result.status).toBe("incompatible");
    expect(result.blockerCount).toBeGreaterThanOrEqual(4);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["memory-capacity", "m2-slots", "case-hdd-bays", "gpu-case-length", "gpu-psu-power"])
    );
    expect(result.findings.some((finding) => finding.suggestions?.some((suggestion) => suggestion.priceDeltaWon !== undefined))).toBe(true);
    expect(result.links.find((link) => link.id === "motherboard-memory")?.status).toBe("issue");
    expect(result.links.find((link) => link.id === "motherboard-ssd")?.status).toBe("issue");
    expect(result.links.find((link) => link.id === "gpu-case")?.status).toBe("issue");
    expect(result.links.find((link) => link.id === "gpu-psu")?.status).toBe("issue");
  });

  it("warns when a case needs more direct fan headers than the motherboard provides", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseCase = seedCatalog.find((part) => part.id === "case-full-airflow")!;
    const motherboard = {
      ...baseMotherboard,
      id: "mb-fan-headers-2",
      specs: { ...baseMotherboard.specs, fanPortCount: 2 }
    };
    const computerCase = {
      ...baseCase,
      id: "case-seven-fans",
      specs: { ...baseCase.specs, fanCount: 7 }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.case = { partId: computerCase.id, quantity: 1 };
    const result = evaluateBuild(build, [...seedCatalog, motherboard, computerCase], { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "case-fan-headers");

    expect(finding?.severity).toBe("warning");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "케이스 기본 팬", actual: "7개" }),
      expect.objectContaining({ label: "메인보드 팬 헤더", expected: "2개" })
    ]));
    expect(finding?.actions[0].label).toBe("팬 허브·컨트롤러 확인");
    expect(result.links.find((link) => link.id === "motherboard-case")?.status).toBe("issue");
  });

  it("marks fan connection as unknown when the motherboard header count is missing", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseCase = seedCatalog.find((part) => part.id === "case-full-airflow")!;
    const motherboard = {
      ...baseMotherboard,
      id: "mb-fan-headers-unknown",
      specs: { ...baseMotherboard.specs, fanPortCount: undefined }
    };
    const computerCase = {
      ...baseCase,
      id: "case-seven-fans-unknown",
      specs: { ...baseCase.specs, fanCount: 7 }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.case = { partId: computerCase.id, quantity: 1 };
    const result = evaluateBuild(build, [...seedCatalog, motherboard, computerCase], { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "case-fan-headers");

    expect(finding?.severity).toBe("unknown");
    expect(finding?.message).toContain("확정할 수 없습니다");
    expect(result.status).toBe("needs_review");
  });

  it("blocks a SATA M.2 SSD on a motherboard that only lists NVMe M.2 support", () => {
    const { build, catalog } = sataM2Fixture(["NVMe"]);
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "m2-interface");

    expect(finding?.severity).toBe("blocker");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "선택한 SATA M.2 SSD", actual: "1개" }),
      expect.objectContaining({ label: "메인보드 M.2 연결", expected: "NVMe" })
    ]));
    expect(result.links.find((link) => link.id === "motherboard-ssd")?.status).toBe("issue");
  });

  it("accepts a SATA M.2 SSD when the motherboard lists SATA M.2 support", () => {
    const { build, catalog } = sataM2Fixture(["NVMe", "SATA"]);
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });

    expect(result.findings.some((finding) => finding.ruleId === "m2-interface")).toBe(false);
  });

  it("marks SATA M.2 compatibility as unknown when the motherboard interface list is missing", () => {
    const { build, catalog } = sataM2Fixture(undefined);
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "m2-interface");

    expect(finding?.severity).toBe("unknown");
    expect(result.status).toBe("needs_review");
  });

  it("blocks an NVMe M.2 SSD on a motherboard that only lists SATA support", () => {
    const { build, catalog } = sataM2Fixture(["SATA"], "NVMe");
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "m2-interface");

    expect(finding?.severity).toBe("blocker");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "선택한 NVMe M.2 SSD", actual: "1개" }),
      expect.objectContaining({ label: "메인보드 M.2 연결", expected: "SATA" })
    ]));
    expect(result.links.find((link) => link.id === "motherboard-ssd")?.status).toBe("issue");
  });

  it("marks NVMe M.2 compatibility as unknown when the motherboard interface list is missing", () => {
    const { build, catalog } = sataM2Fixture(undefined, "NVMe");
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "m2-interface");

    expect(finding?.severity).toBe("unknown");
    expect(result.status).toBe("needs_review");
  });

  it("warns about an NVMe PCIe generation downgrade and recommends a compatible-generation replacement", () => {
    const { build, catalog } = m2PcieGenerationFixture([4], 5);
    const baseSsd = seedCatalog.find((part) => part.id === "ssd-nvme-1tb")!;
    const replacementSsd = {
      ...baseSsd,
      id: "ssd-m2-pcie-4-candidate",
      name: "테스트 PCIe 4.0 NVMe 대체 SSD",
      priceWon: 99000,
      specs: { ...baseSsd.specs, interface: "NVMe", formFactor: "M.2 2280", m2PcieGeneration: 4 }
    };
    const u2Replacement = {
      ...replacementSsd,
      id: "ssd-m2-pcie-u2-candidate",
      name: "테스트 U.2 PCIe 4.0 대체 SSD",
      specs: { ...replacementSsd.specs, formFactor: "U.2" }
    };
    const smallerReplacement = {
      ...replacementSsd,
      id: "ssd-m2-pcie-smaller-candidate",
      name: "테스트 PCIe 4.0 512GB 대체 SSD",
      specs: { ...replacementSsd.specs, capacityGb: 512 }
    };
    const result = evaluateBuild(build, [...catalog, replacementSsd, u2Replacement, smallerReplacement]);
    const finding = result.findings.find((item) => item.ruleId === "m2-pcie-generation");

    expect(finding?.severity).toBe("warning");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "NVMe SSD PCIe 세대", actual: "PCIe 5.0" }),
      expect.objectContaining({ label: "메인보드 M.2 지원 세대", expected: "PCIe 4.0" }),
      expect.objectContaining({ label: "실제 링크 상한", expected: "PCIe 4.0" })
    ]));
    expect(result.links.find((link) => link.id === "motherboard-ssd")?.status).toBe("issue");
    const suggestion = finding?.suggestions?.find((item) => item.part.id === replacementSsd.id);
    expect(suggestion?.fixesCurrentIssue).toBe(true);
    expect(finding?.suggestions?.some((item) => item.part.id === u2Replacement.id)).toBe(false);
    expect(finding?.suggestions?.some((item) => item.part.id === smallerReplacement.id)).toBe(false);
    expect(candidateFixesFinding(finding!, build, [...catalog, replacementSsd, u2Replacement, smallerReplacement], "ssd", replacementSsd)).toBe(true);
    expect(candidateFixesFinding(finding!, build, [...catalog, replacementSsd, u2Replacement, smallerReplacement], "ssd", u2Replacement)).toBe(false);
    expect(suggestion?.similarityEvidence.dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "m2PcieGeneration", label: "M.2 PCIe 세대" })
    ]));
    expect(suggestion?.performanceSummary).toContain("PCIe 5.0");

    const matched = m2PcieGenerationFixture([5], 5);
    const matchedResult = evaluateBuild(matched.build, matched.catalog, { includeSuggestions: false });
    expect(matchedResult.findings.some((item) => item.ruleId === "m2-pcie-generation")).toBe(false);
    const unknownGenerationSsd = {
      ...baseSsd,
      id: "ssd-m2-pcie-unknown-candidate",
      name: "PCIe 세대 확인 필요 NVMe SSD",
      specs: { ...baseSsd.specs, interface: "NVMe", formFactor: "M.2 2280", m2PcieGeneration: undefined }
    };
    expect(assessAlternativePart(matched.build, [...matched.catalog, unknownGenerationSsd], "ssd", unknownGenerationSsd)).toMatchObject({
      risk: "review",
      reasons: ["후보 NVMe M.2 SSD의 PCIe 세대가 확인되지 않습니다."]
    });

    const mixedGenerations = m2PcieGenerationFixture([4, 5], 5);
    const secondSsd = {
      ...baseSsd,
      id: "ssd-m2-pcie-4-second",
      name: "테스트 PCIe 4.0 두 번째 NVMe SSD",
      specs: { ...baseSsd.specs, interface: "NVMe", formFactor: "M.2 2280", m2PcieGeneration: 4 }
    };
    const mixedBuild = {
      ...mixedGenerations.build,
      ssd: [mixedGenerations.build.ssd[0], { partId: secondSsd.id, quantity: 1 }]
    };
    const mixedResult = evaluateBuild(mixedBuild, [...mixedGenerations.catalog, secondSsd], { includeSuggestions: false });
    const topologyFinding = mixedResult.findings.find((item) => item.ruleId === "m2-slot-topology");
    expect(topologyFinding?.severity).toBe("unknown");
    expect(topologyFinding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "선택한 M.2 SSD", actual: "2개" }),
      expect.objectContaining({ label: "확인 필요", actual: "M2_1·M2_2·M2_3별 PCIe 세대·CPU 직결·레인 공유" })
    ]));
    expect(mixedResult.links.find((link) => link.id === "motherboard-ssd")?.status).toBe("unknown");
    expect(mixedResult.status).toBe("needs_review");

    const limitedBoard = {
      ...mixedGenerations.catalog.find((part) => part.id === mixedBuild.motherboard?.partId)!,
      id: "mb-m2-pcie-limited-slots",
      specs: { ...mixedGenerations.catalog.find((part) => part.id === mixedBuild.motherboard?.partId)!.specs, m2Slots: 1 }
    };
    const limitedResult = evaluateBuild(
      { ...mixedBuild, motherboard: { partId: limitedBoard.id, quantity: 1 } },
      [...mixedGenerations.catalog, secondSsd, limitedBoard],
      { includeSuggestions: false }
    );
    expect(limitedResult.findings.find((item) => item.ruleId === "m2-slots")?.severity).toBe("blocker");
    expect(limitedResult.findings.some((item) => item.ruleId === "m2-slot-topology")).toBe(false);
  });

  it("uses a complete manual M.2 slot mapping to assign SSDs without a topology warning", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseSsd = seedCatalog.find((part) => part.id === "ssd-nvme-1tb")!;
    const profiles: M2SlotProfile[] = [
      { slotId: "M2_1", interfaces: ["NVMe"], pcieGeneration: 5, connection: "cpu", sharedWith: [] },
      { slotId: "M2_2", interfaces: ["NVMe"], pcieGeneration: 4, connection: "chipset", sharedWith: [] },
      { slotId: "M2_3", interfaces: ["NVMe"], pcieGeneration: 4, connection: "chipset", sharedWith: [] }
    ];
    const motherboard = {
      ...baseMotherboard,
      id: "mb-m2-manual-complete",
      specs: { ...baseMotherboard.specs, m2SlotProfiles: profiles }
    };
    const firstSsd = {
      ...baseSsd,
      id: "ssd-m2-manual-gen5",
      name: "매뉴얼 배치 PCIe 5.0 SSD",
      specs: { ...baseSsd.specs, m2PcieGeneration: 5 }
    };
    const secondSsd = {
      ...baseSsd,
      id: "ssd-m2-manual-gen4",
      name: "매뉴얼 배치 PCIe 4.0 SSD",
      specs: { ...baseSsd.specs, m2PcieGeneration: 4 }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.ssd = [
      { partId: firstSsd.id, quantity: 1 },
      { partId: secondSsd.id, quantity: 1 }
    ];
    const result = evaluateBuild(build, [...seedCatalog, motherboard, firstSsd, secondSsd], { includeSuggestions: false });

    expect(result.findings.some((item) => item.ruleId === "m2-slot-topology")).toBe(false);
    expect(result.findings.some((item) => item.ruleId === "m2-slot-routing")).toBe(false);
    expect(result.findings.some((item) => item.ruleId === "m2-slot-pcie-generation")).toBe(false);
    expect(result.metrics.m2SlotAssignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ slotId: "M2_1", partId: firstSsd.id, slotPcieGeneration: 5, linkGeneration: 5, connection: "cpu" }),
      expect.objectContaining({ slotId: "M2_2", partId: secondSsd.id, slotPcieGeneration: 4, linkGeneration: 4, connection: "chipset" })
    ]));

    const allGen4Profiles = profiles.map((profile) => ({ ...profile, pcieGeneration: 4 }));
    const allGen4Motherboard = { ...motherboard, id: "mb-m2-manual-all-gen4", specs: { ...motherboard.specs, m2SlotProfiles: allGen4Profiles } };
    const downgradedResult = evaluateBuild(
      { ...build, motherboard: { partId: allGen4Motherboard.id, quantity: 1 } },
      [...seedCatalog, allGen4Motherboard, firstSsd, secondSsd],
      { includeSuggestions: false }
    );
    expect(downgradedResult.findings.find((item) => item.ruleId === "m2-slot-pcie-generation")?.severity).toBe("warning");
    expect(downgradedResult.metrics.m2SlotAssignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ partId: firstSsd.id, slotPcieGeneration: 4, linkGeneration: 4 })
    ]));

    const sharingProfiles = profiles.map((profile, index) => index === 1 ? { ...profile, sharedWith: ["SATA_3"] } : profile);
    const sharingMotherboard = { ...motherboard, id: "mb-m2-manual-sharing", specs: { ...motherboard.specs, m2SlotProfiles: sharingProfiles } };
    const sharingResult = evaluateBuild(
      { ...build, motherboard: { partId: sharingMotherboard.id, quantity: 1 } },
      [...seedCatalog, sharingMotherboard, firstSsd, secondSsd],
      { includeSuggestions: false }
    );
    expect(sharingResult.findings.find((item) => item.ruleId === "m2-slot-sharing")?.severity).toBe("unknown");
    expect(sharingResult.findings.some((item) => item.ruleId === "m2-slot-topology")).toBe(false);
  });

  it("blocks a manually mapped M.2 build when no registered slot accepts the SSD interface", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const motherboard = {
      ...baseMotherboard,
      id: "mb-m2-manual-sata-only",
      specs: {
        ...baseMotherboard.specs,
        m2SlotProfiles: [1, 2, 3].map((slot) => ({ slotId: `M2_${slot}`, interfaces: ["SATA"] as Array<"SATA">, pcieGeneration: 4, connection: "chipset" as const, sharedWith: [] }))
      }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.m2SlotSelection = { M2_1: "ssd-nvme-1tb" };
    const result = evaluateBuild(build, [...seedCatalog, motherboard], { includeSuggestions: false });

    expect(result.findings.find((item) => item.ruleId === "m2-slot-routing")?.severity).toBe("blocker");
    expect(result.findings.some((item) => item.ruleId === "m2-slot-topology")).toBe(false);
  });

  it("uses the user's complete M.2 slot selection and marks the result as manual", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseSsd = seedCatalog.find((part) => part.id === "ssd-nvme-1tb")!;
    const motherboard: Part = {
      ...baseMotherboard,
      id: "mb-m2-user-selection",
      specs: {
        ...baseMotherboard.specs,
        m2SlotProfiles: [
          { slotId: "M2_1", interfaces: ["NVMe"], pcieGeneration: 5, connection: "cpu" as const, sharedWith: [] },
          { slotId: "M2_2", interfaces: ["NVMe"], pcieGeneration: 4, connection: "chipset" as const, sharedWith: [] },
          { slotId: "M2_3", interfaces: ["NVMe"], pcieGeneration: 4, connection: "chipset" as const, sharedWith: [] }
        ]
      }
    };
    const gen5Ssd = { ...baseSsd, id: "ssd-user-selection-gen5", name: "사용자 지정 PCIe 5.0 SSD", specs: { ...baseSsd.specs, m2PcieGeneration: 5 } };
    const gen4Ssd = { ...baseSsd, id: "ssd-user-selection-gen4", name: "사용자 지정 PCIe 4.0 SSD", specs: { ...baseSsd.specs, m2PcieGeneration: 4 } };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.ssd = [{ partId: gen5Ssd.id, quantity: 1 }, { partId: gen4Ssd.id, quantity: 1 }];
    build.m2SlotSelection = { M2_1: gen4Ssd.id, M2_2: gen5Ssd.id };

    const result = evaluateBuild(build, [...seedCatalog, motherboard, gen5Ssd, gen4Ssd], { includeSuggestions: false });

    expect(result.metrics.m2SlotAssignmentMode).toBe("manual");
    expect(result.metrics.m2SlotAssignments).toEqual(expect.arrayContaining([
      expect.objectContaining({ slotId: "M2_1", partId: gen4Ssd.id, linkGeneration: 4 }),
      expect.objectContaining({ slotId: "M2_2", partId: gen5Ssd.id, linkGeneration: 4 })
    ]));
    expect(result.findings.some((item) => item.ruleId === "m2-slot-topology")).toBe(false);
    expect(result.findings.some((item) => item.ruleId === "m2-slot-routing")).toBe(false);
    expect(result.findings.find((item) => item.ruleId === "m2-slot-pcie-generation")?.severity).toBe("warning");
  });

  it("blocks an incomplete user M.2 slot selection instead of silently auto-filling it", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseSsd = seedCatalog.find((part) => part.id === "ssd-nvme-1tb")!;
    const motherboard: Part = {
      ...baseMotherboard,
      id: "mb-m2-user-selection-incomplete",
      specs: {
        ...baseMotherboard.specs,
        m2SlotProfiles: [1, 2, 3].map((slot) => ({ slotId: `M2_${slot}`, interfaces: ["NVMe"] as Array<"NVMe">, pcieGeneration: 4, connection: "chipset" as const, sharedWith: [] }))
      }
    };
    const secondSsd = { ...baseSsd, id: "ssd-user-selection-second", name: "두 번째 사용자 지정 SSD", specs: { ...baseSsd.specs, m2PcieGeneration: 4 } };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.ssd = [{ partId: baseSsd.id, quantity: 1 }, { partId: secondSsd.id, quantity: 1 }];
    build.m2SlotSelection = { M2_1: baseSsd.id };

    const result = evaluateBuild(build, [...seedCatalog, motherboard, secondSsd], { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "m2-slot-selection");

    expect(finding?.severity).toBe("blocker");
    expect(finding?.message).toContain("지정한 슬롯 1개");
    expect(result.metrics.m2SlotAssignments).toBeUndefined();
    expect(result.findings.some((item) => item.ruleId === "m2-slot-routing")).toBe(false);
  });

  it("calculates price-to-similarity value and ranks cheaper equivalent candidates first", () => {
    const baseSsd = seedCatalog.find((part) => part.id === "ssd-nvme-1tb")!;
    const currentSsd = {
      ...baseSsd,
      id: "ssd-value-current",
      priceWon: 200000,
      specs: { ...baseSsd.specs, capacityGb: 1000, m2PcieGeneration: 4, sequentialReadMbps: 7000, sequentialWriteMbps: 6000 }
    };
    const cheaperEquivalent = {
      ...currentSsd,
      id: "ssd-value-cheap",
      priceWon: 100000,
      name: "가격 대비 유사도 높은 SSD"
    };
    const expensiveEquivalent = {
      ...currentSsd,
      id: "ssd-value-expensive",
      priceWon: 400000,
      name: "가격 대비 유사도 낮은 SSD"
    };
    const build = compatibleBuild();
    build.ssd = [{ partId: currentSsd.id, quantity: 1 }];
    const catalog = [...seedCatalog, currentSsd, cheaperEquivalent, expensiveEquivalent];
    const cheap = candidateSimilarityForBuild(build, catalog, "ssd", cheaperEquivalent);
    const expensive = candidateSimilarityForBuild(build, catalog, "ssd", expensiveEquivalent);

    expect(cheap.similarityScore).toBe(100);
    expect(cheap.valueScore).toBe(200);
    expect(cheap.valueLabel).toBe("가성비 우수");
    expect(cheap.valueEvidence).toMatchObject({ scoreScale: 200, currentPriceWon: 200000, candidatePriceWon: 100000, priceDeltaWon: -100000, priceChangePercent: -50, similarityScore: 100 });
    expect(expensive.valueScore).toBe(50);
    expect(expensive.valueLabel).toBe("가격 대비 낮음");
    expect(compareCandidateValue(cheap, expensive)).toBeLessThan(0);
    const noEvidenceCandidate = {
      ...currentSsd,
      id: "ssd-value-no-evidence",
      name: "가격만 확인된 SSD",
      specs: { ...currentSsd.specs, capacityGb: undefined, m2PcieGeneration: undefined, sequentialReadMbps: undefined, sequentialWriteMbps: undefined }
    };
    const noEvidence = candidateSimilarityForBuild(build, [...catalog, noEvidenceCandidate], "ssd", noEvidenceCandidate);
    expect(noEvidence.similarityEvidence.comparedDimensions).toBe(0);
    expect(noEvidence.valueScore).toBeUndefined();
  });

  it("warns when known RGB devices exceed the motherboard RGB header count", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseCase = seedCatalog.find((part) => part.id === "case-full-airflow")!;
    const motherboard = {
      ...baseMotherboard,
      id: "mb-rgb-headers-2",
      specs: { ...baseMotherboard.specs, fanPortCount: 7, rgbPortCount: 2 }
    };
    const computerCase = {
      ...baseCase,
      id: "case-rgb-seven",
      specs: { ...baseCase.specs, fanCount: 7, rgbDeviceCount: 7 }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.case = { partId: computerCase.id, quantity: 1 };
    const result = evaluateBuild(build, [...seedCatalog, motherboard, computerCase], { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "case-rgb-headers");

    expect(finding?.severity).toBe("warning");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "케이스 RGB 장치", actual: "7개" }),
      expect.objectContaining({ label: "메인보드 RGB/ARGB 헤더", expected: "2개" })
    ]));
    expect(finding?.actions[0].label).toBe("RGB 허브·전압 확인");
    expect(result.links.find((link) => link.id === "motherboard-case")?.status).toBe("issue");
  });

  it("does not guess RGB compatibility when the motherboard header count is missing", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseCase = seedCatalog.find((part) => part.id === "case-full-airflow")!;
    const motherboard = {
      ...baseMotherboard,
      id: "mb-rgb-headers-unknown",
      specs: { ...baseMotherboard.specs, fanPortCount: 7, rgbPortCount: undefined }
    };
    const computerCase = {
      ...baseCase,
      id: "case-rgb-unknown",
      specs: { ...baseCase.specs, fanCount: 7, rgbDeviceCount: 7 }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.case = { partId: computerCase.id, quantity: 1 };
    const result = evaluateBuild(build, [...seedCatalog, motherboard, computerCase], { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "case-rgb-headers");

    expect(finding?.severity).toBe("unknown");
    expect(finding?.message).toContain("확정할 수 없습니다");
    expect(result.status).toBe("needs_review");
  });

  it("warns when the case RGB voltage has no matching motherboard header", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseCase = seedCatalog.find((part) => part.id === "case-full-airflow")!;
    const motherboard = {
      ...baseMotherboard,
      id: "mb-rgb-voltage-mismatch",
      specs: { ...baseMotherboard.specs, rgbPortCount: 2, rgb5vPortCount: 2, rgb12vPortCount: 0 }
    };
    const computerCase = {
      ...baseCase,
      id: "case-rgb-12v",
      specs: { ...baseCase.specs, rgbDeviceCount: 1, rgbDeviceVoltage: "12V" as const }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.case = { partId: computerCase.id, quantity: 1 };
    const result = evaluateBuild(build, [...seedCatalog, motherboard, computerCase], { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "case-rgb-voltage");

    expect(finding?.severity).toBe("warning");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "케이스 RGB 전압", actual: "12V" }),
      expect.objectContaining({ label: "메인보드 12V RGB 헤더", actual: "0개" })
    ]));
    expect(result.links.find((link) => link.id === "motherboard-case")?.status).toBe("issue");
  });

  it("keeps RGB voltage compatibility unknown when voltage-specific headers are missing", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseCase = seedCatalog.find((part) => part.id === "case-full-airflow")!;
    const motherboard = {
      ...baseMotherboard,
      id: "mb-rgb-voltage-unknown",
      specs: { ...baseMotherboard.specs, rgbPortCount: 2, rgb5vPortCount: undefined, rgb12vPortCount: undefined }
    };
    const computerCase = {
      ...baseCase,
      id: "case-rgb-5v-unknown",
      specs: { ...baseCase.specs, rgbDeviceCount: 1, rgbDeviceVoltage: "5V" as const }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.case = { partId: computerCase.id, quantity: 1 };
    const result = evaluateBuild(build, [...seedCatalog, motherboard, computerCase], { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "case-rgb-voltage");

    expect(finding?.severity).toBe("unknown");
    expect(result.status).toBe("needs_review");
  });

  it("blocks SO-DIMM memory on a DIMM motherboard", () => {
    const { build, catalog } = memoryFormFactorFixture("DIMM", "SO-DIMM");
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "memory-form-factor");

    expect(finding?.severity).toBe("blocker");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "메인보드 메모리 슬롯", expected: "DIMM" }),
      expect.objectContaining({ label: "테스트 SO-DIMM 메모리 규격", actual: "SO-DIMM" })
    ]));
    expect(result.links.find((link) => link.id === "motherboard-memory")?.status).toBe("issue");
  });

  it("accepts matching DIMM and SO-DIMM memory slot configurations", () => {
    const dimm = evaluateBuild(memoryFormFactorFixture("DIMM", "DIMM").build, memoryFormFactorFixture("DIMM", "DIMM").catalog, { includeSuggestions: false });
    const sodimm = evaluateBuild(memoryFormFactorFixture("SO-DIMM", "SO-DIMM").build, memoryFormFactorFixture("SO-DIMM", "SO-DIMM").catalog, { includeSuggestions: false });

    expect(dimm.findings.some((finding) => finding.ruleId === "memory-form-factor")).toBe(false);
    expect(sodimm.findings.some((finding) => finding.ruleId === "memory-form-factor")).toBe(false);
  });

  it("marks memory form factor as unknown when the motherboard slot format is missing", () => {
    const { build, catalog } = memoryFormFactorFixture(undefined, "SO-DIMM");
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "memory-form-factor");

    expect(finding?.severity).toBe("unknown");
    expect(result.status).toBe("needs_review");
  });

  it("checks EXPO and XMP profile overlap without treating a mismatch as a physical blocker", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseMemory = seedCatalog.find((part) => part.id === "memory-ddr5-16-5600")!;
    const expoBoard = {
      ...baseMotherboard,
      id: "mb-profile-expo",
      specs: { ...baseMotherboard.specs, memoryProfiles: ["EXPO"] as MemoryProfile[] }
    };
    const xmpBoard = {
      ...baseMotherboard,
      id: "mb-profile-xmp",
      specs: { ...baseMotherboard.specs, memoryProfiles: ["XMP"] as MemoryProfile[] }
    };
    const unknownBoard = {
      ...baseMotherboard,
      id: "mb-profile-unknown",
      specs: { ...baseMotherboard.specs, memoryProfiles: undefined }
    };
    const expoMemory = {
      ...baseMemory,
      id: "memory-profile-expo",
      specs: { ...baseMemory.specs, memoryProfiles: ["EXPO"] as MemoryProfile[] }
    };
    const build = compatibleBuild();
    build.memory = [{ partId: expoMemory.id, quantity: 2 }];
    const catalog = [...seedCatalog, expoBoard, xmpBoard, unknownBoard, expoMemory];

    const matching = evaluateBuild({ ...build, motherboard: { partId: expoBoard.id, quantity: 1 } }, catalog, { includeSuggestions: false });
    const mismatch = evaluateBuild({ ...build, motherboard: { partId: xmpBoard.id, quantity: 1 } }, catalog, { includeSuggestions: false });
    const unknown = evaluateBuild({ ...build, motherboard: { partId: unknownBoard.id, quantity: 1 } }, catalog, { includeSuggestions: false });
    const partialMismatch = evaluateBuild({ ...build, cpu: undefined, motherboard: { partId: xmpBoard.id, quantity: 1 } }, catalog, { includeSuggestions: false });
    const mismatchWithSuggestions = evaluateBuild({ ...build, motherboard: { partId: xmpBoard.id, quantity: 1 } }, catalog);
    const profileFinding = mismatchWithSuggestions.findings.find((finding) => finding.ruleId === "memory-profile");
    const profileReplacement = profileFinding?.suggestions?.find((suggestion) => suggestion.part.id === expoBoard.id);

    expect(matching.findings.some((finding) => finding.ruleId === "memory-profile")).toBe(false);
    expect(mismatch.findings.find((finding) => finding.ruleId === "memory-profile")).toMatchObject({ severity: "warning", title: "RAM 프로파일과 메인보드 지원 프로파일이 다릅니다." });
    expect(mismatch.blockerCount).toBe(0);
    expect(unknown.findings.find((finding) => finding.ruleId === "memory-profile")?.severity).toBe("unknown");
    expect(partialMismatch.findings.find((finding) => finding.ruleId === "memory-profile")).toMatchObject({ severity: "warning" });
    expect(profileReplacement?.fixesCurrentIssue).toBe(true);
    expect(profileReplacement?.performanceSummary.length).toBeGreaterThan(0);
  });

  it("only recommends candidates that fix the current issue and reports performance similarity", () => {
    const compatibleCapacityMotherboard = {
      ...seedCatalog.find((part) => part.id === "mb-b650-4x3")!,
      id: "mb-am5-matx-192gb",
      name: "테스트 AM5 mATX 192GB 메인보드",
      specs: {
        ...seedCatalog.find((part) => part.id === "mb-b650-4x3")!.specs,
        formFactor: "mATX"
      }
    };
    const result = evaluateBuild(
      {
        cpu: { partId: "cpu-7500f", quantity: 1 },
        cooler: { partId: "cooler-small-am5", quantity: 1 },
        motherboard: { partId: "mb-a620-small", quantity: 1 },
        memory: [{ partId: "memory-ddr5-32-7200", quantity: 4 }],
        gpu: { partId: "gpu-rtx-5090", quantity: 1 },
        ssd: [{ partId: "ssd-nvme-1tb", quantity: 4 }],
        hdd: [{ partId: "hdd-seagate-4tb", quantity: 4 }],
        case: { partId: "case-compact-matx", quantity: 1 },
        psu: { partId: "psu-650w", quantity: 1 },
        useIntegratedGraphics: false
      },
      [...seedCatalog, compatibleCapacityMotherboard]
    );
    const finding = result.findings.find((item) => item.ruleId === "memory-capacity");
    const suggestions = finding?.suggestions ?? [];

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((suggestion) => suggestion.fixesCurrentIssue)).toBe(true);
    expect(suggestions.every((suggestion) => suggestion.similarityScore >= 0 && suggestion.similarityScore <= 100)).toBe(true);
    expect(suggestions.every((suggestion) => ["동급", "유사", "대안"].includes(suggestion.similarityLabel))).toBe(true);
    expect(suggestions.every((suggestion) => suggestion.performanceSummary.length > 0)).toBe(true);
    expect(suggestions[0].reason).toContain("해결");
    expect(suggestions.some((suggestion) => suggestion.part.id === "mb-b760-intel")).toBe(false);
    expect((result.findings.find((item) => item.ruleId === "memory-slots")?.suggestions ?? []).some((suggestion) => suggestion.part.id === "mb-b760-intel")).toBe(false);

    const plans = result.repairPlans ?? [];
    expect(new Set(plans.map((plan) => plan.label)).size).toBe(plans.length);
    expect(plans.map((plan) => plan.label)).toEqual(expect.arrayContaining(["최소 변경", "가성비", "성능 유지"]));
    expect(new Set(plans.map((plan) => plan.changes.map((change) => change.category).sort().join("|"))).size).toBe(plans.length);
    expect(plans.every((plan) => plan.resolvedFindingTitles.length === plan.resolvedFindings)).toBe(true);
    expect(plans.every((plan) => plan.resolvedFindingTitles.length > 0)).toBe(true);
    expect(plans.every((plan) => Array.isArray(plan.remainingFindingTitles))).toBe(true);
    expect(plans.some((plan) => plan.remainingBlockers > 0 && (plan.remainingFindingTitles?.length ?? 0) > 0)).toBe(true);
    expect(plans.every((plan) => Array.isArray(plan.remainingFindingRuleIds))).toBe(true);
    expect(plans.some((plan) => (plan.remainingFindingRuleIds?.length ?? 0) > 0)).toBe(true);
  });

  it("uses RAM CAS latency in replacement similarity evidence", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseMemory = seedCatalog.find((part) => part.id === "memory-ddr5-16-5600")!;
    const motherboard = {
      ...baseMotherboard,
      id: "mb-memory-speed-5600",
      specs: { ...baseMotherboard.specs, maxMemorySpeedMhz: 5600 }
    };
    const currentMemory = {
      ...baseMemory,
      id: "memory-ddr5-32-6000-cl30",
      name: "테스트 DDR5-6000 CL30 메모리",
      specs: {
        ...baseMemory.specs,
        capacityGb: 32,
        speedMhz: 6000,
        memoryCasLatency: 30,
        memoryVoltageV: 1.35
      }
    };
    const replacementMemory = {
      ...baseMemory,
      id: "memory-ddr5-32-5600-cl36",
      name: "테스트 DDR5-5600 CL36 메모리",
      specs: {
        ...baseMemory.specs,
        capacityGb: 32,
        speedMhz: 5600,
        memoryCasLatency: 36,
        memoryVoltageV: 1.25
      }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.memory = [{ partId: currentMemory.id, quantity: 2 }];
    const result = evaluateBuild(build, [...seedCatalog, motherboard, currentMemory, replacementMemory]);
    const suggestion = result.findings
      .find((finding) => finding.ruleId === "memory-speed")
      ?.suggestions?.find((item) => item.part.id === replacementMemory.id);
    expect(suggestion?.fixesCurrentIssue).toBe(true);
    expect(suggestion?.performanceSummary).toContain("10.00ns");
    expect(suggestion?.performanceSummary).toContain("12.86ns");
    expect(suggestion?.similarityEvidence).toMatchObject({ comparedDimensions: 3, totalDimensions: 3, confidence: "high" });
    expect(suggestion?.similarityEvidence.dimensions?.some((dimension) => dimension.key === "memoryEffectiveLatencyNs" && dimension.currentValue === "10.00ns" && dimension.candidateValue === "12.86ns")).toBe(true);
  });

  it("includes the full RAM timing tuple in replacement evidence", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseMemory = seedCatalog.find((part) => part.id === "memory-ddr5-16-5600")!;
    const motherboard = {
      ...baseMotherboard,
      id: "mb-full-memory-timing-5600",
      specs: { ...baseMotherboard.specs, maxMemorySpeedMhz: 5600 }
    };
    const currentMemory = {
      ...baseMemory,
      id: "memory-full-timing-current",
      name: "테스트 DDR5-6000 CL30 36-36-76",
      specs: {
        ...baseMemory.specs,
        capacityGb: 32,
        speedMhz: 6000,
        memoryTiming: "CL30-36-36-76",
        memoryCasLatency: 30,
        memoryRcdLatency: 36,
        memoryTrpLatency: 36,
        memoryTrasLatency: 76
      }
    };
    const replacementMemory = {
      ...baseMemory,
      id: "memory-full-timing-candidate",
      name: "테스트 DDR5-5600 CL30 40-40-80",
      specs: {
        ...baseMemory.specs,
        capacityGb: 32,
        speedMhz: 5600,
        memoryTiming: "CL30-40-40-80",
        memoryCasLatency: 30,
        memoryRcdLatency: 40,
        memoryTrpLatency: 40,
        memoryTrasLatency: 80
      }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.memory = [{ partId: currentMemory.id, quantity: 2 }];
    const result = evaluateBuild(build, [...seedCatalog, motherboard, currentMemory, replacementMemory]);
    const suggestion = result.findings
      .find((finding) => finding.ruleId === "memory-speed")
      ?.suggestions?.find((item) => item.part.id === replacementMemory.id);
    const pickerSimilarity = candidateSimilarityForBuild(build, [...seedCatalog, motherboard, currentMemory, replacementMemory], "memory", replacementMemory);

    expect(suggestion?.similarityEvidence).toMatchObject({ comparedDimensions: 6, totalDimensions: 6, confidence: "high" });
    expect(suggestion?.similarityEvidence.dimensions?.map((dimension) => dimension.key)).toEqual([
      "capacityGb",
      "speedMhz",
      "memoryEffectiveLatencyNs",
      "memoryRcdLatency",
      "memoryTrpLatency",
      "memoryTrasLatency"
    ]);
    expect(suggestion?.performanceSummary).toContain("10.00ns");
    expect(suggestion?.performanceSummary).toContain("tRCD 36");
    expect(pickerSimilarity).toMatchObject({ similarityScore: suggestion?.similarityScore, similarityLabel: suggestion?.similarityLabel });
    expect(pickerSimilarity.similarityEvidence).toMatchObject({ comparedDimensions: 6, totalDimensions: 6, confidence: "high" });
  });

  it("prefers stronger similarity evidence when candidate scores are tied", () => {
    const highEvidence = { similarityScore: 100, similarityEvidence: { comparedDimensions: 6, totalDimensions: 6, confidence: "high" as const } };
    const limitedEvidence = { similarityScore: 100, similarityEvidence: { comparedDimensions: 3, totalDimensions: 6, confidence: "limited" as const } };

    expect(compareCandidateSimilarity(highEvidence, limitedEvidence)).toBeLessThan(0);
    expect(compareCandidateSimilarity(limitedEvidence, highEvidence)).toBeGreaterThan(0);
  });

  it("uses the lower CPU or motherboard memory limit only when an EXPO/XMP profile is known", () => {
    const baseCpu = seedCatalog.find((part) => part.id === "cpu-7800x3d")!;
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseMemory = seedCatalog.find((part) => part.id === "memory-ddr5-16-5600")!;
    const cpu = {
      ...baseCpu,
      id: "cpu-memory-limit-5200",
      specs: { ...baseCpu.specs, maxMemorySpeedMhz: 5200 }
    };
    const motherboard = {
      ...baseMotherboard,
      id: "mb-memory-limit-7600",
      specs: { ...baseMotherboard.specs, maxMemorySpeedMhz: 7600, memoryProfiles: ["XMP"] as MemoryProfile[] }
    };
    const profileMemory = {
      ...baseMemory,
      id: "memory-profile-speed-6000",
      specs: { ...baseMemory.specs, speedMhz: 6000, memoryProfiles: ["XMP"] as MemoryProfile[] }
    };
    const noProfileMemory = {
      ...profileMemory,
      id: "memory-no-profile-speed-6000",
      specs: { ...profileMemory.specs, memoryProfiles: undefined }
    };
    const unknownCpu = {
      ...cpu,
      id: "cpu-memory-limit-unknown",
      specs: { ...cpu.specs, maxMemorySpeedMhz: undefined }
    };
    const build = compatibleBuild();
    build.cpu = { partId: cpu.id, quantity: 1 };
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.memory = [{ partId: profileMemory.id, quantity: 2 }];
    const catalog = [...seedCatalog, cpu, motherboard, profileMemory, noProfileMemory, unknownCpu];
    const profileResult = evaluateBuild(build, catalog, { includeSuggestions: false });
    const profileFinding = profileResult.findings.find((finding) => finding.ruleId === "memory-speed");

    expect(profileFinding).toMatchObject({ severity: "warning", title: "RAM 속도가 CPU·메인보드의 확인된 지원 상한을 초과합니다." });
    expect(profileFinding?.facts).toEqual(expect.arrayContaining([
      { label: "유효 확인 상한", expected: "5,200MHz" },
      { label: "메인보드 지원 속도", expected: "7,600MHz" },
      { label: "CPU 공식 지원 속도", expected: "5,200MHz" }
    ]));

    const noProfileResult = evaluateBuild({ ...build, memory: [{ partId: noProfileMemory.id, quantity: 2 }] }, catalog, { includeSuggestions: false });
    expect(noProfileResult.findings.some((finding) => finding.ruleId === "memory-speed")).toBe(false);

    const unknownCpuResult = evaluateBuild({ ...build, cpu: { partId: unknownCpu.id, quantity: 1 } }, catalog, { includeSuggestions: false });
    expect(unknownCpuResult.findings.find((finding) => finding.ruleId === "memory-speed")?.severity).toBe("unknown");

    const boardLimitedMotherboard = {
      ...motherboard,
      id: "mb-memory-limit-5600",
      specs: { ...motherboard.specs, maxMemorySpeedMhz: 5600 }
    };
    const boardLimitedResult = evaluateBuild({ ...build, motherboard: { partId: boardLimitedMotherboard.id, quantity: 1 } }, [...catalog, boardLimitedMotherboard], { includeSuggestions: false });
    expect(boardLimitedResult.findings.find((finding) => finding.ruleId === "memory-speed")?.facts).toEqual(expect.arrayContaining([
      { label: "유효 확인 상한", expected: "5,200MHz" }
    ]));
  });

  it("counts the physical modules inside a RAM kit for slot and dual-channel checks", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseMemory = seedCatalog.find((part) => part.id === "memory-ddr5-16-5600")!;
    const motherboard = {
      ...baseMotherboard,
      id: "mb-two-memory-slots",
      specs: { ...baseMotherboard.specs, memorySlots: 2 }
    };
    const memoryKit = {
      ...baseMemory,
      id: "memory-ddr5-32-kit-2x16",
      name: "테스트 DDR5 32GB (16GBx2) 킷",
      specs: {
        ...baseMemory.specs,
        capacityGb: 32,
        memoryModuleCountPerKit: 2
      }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.memory = [{ partId: memoryKit.id, quantity: 1 }];
    const result = evaluateBuild(build, [...seedCatalog, motherboard, memoryKit], { includeSuggestions: false });

    expect(result.metrics.memorySlotsUsed).toBe(2);
    expect(result.findings.some((finding) => finding.ruleId === "memory-slots")).toBe(false);
    expect(result.findings.some((finding) => finding.ruleId === "memory-dual-channel")).toBe(false);
  });

  it("warns when different RAM kits mix known speed, timing, voltage, or profile values", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseMemory = seedCatalog.find((part) => part.id === "memory-ddr5-16-5600")!;
    const firstMemory = {
      ...baseMemory,
      id: "memory-mix-expo",
      name: "테스트 DDR5-6000 CL30 킷",
      specs: {
        ...baseMemory.specs,
        capacityGb: 16,
        speedMhz: 6000,
        memoryCasLatency: 30,
        memoryVoltageV: 1.35,
        memoryProfiles: undefined,
        memoryModuleCountPerKit: 1
      }
    };
    const secondMemory = {
      ...baseMemory,
      id: "memory-mix-xmp",
      name: "테스트 DDR5-5600 CL36 킷",
      specs: {
        ...baseMemory.specs,
        capacityGb: 16,
        speedMhz: 5600,
        memoryCasLatency: 36,
        memoryVoltageV: 1.25,
        memoryProfiles: undefined,
        memoryModuleCountPerKit: 1
      }
    };
    const replacementMemory = {
      ...baseMemory,
      id: "memory-mix-replacement",
      name: "테스트 DDR5-6000 CL30 단일 모듈",
      priceWon: 42000,
      specs: {
        ...baseMemory.specs,
        capacityGb: 16,
        speedMhz: 6000,
        memoryCasLatency: 30,
        memoryVoltageV: 1.35,
        memoryProfiles: undefined,
        memoryModuleCountPerKit: 1
      }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: baseMotherboard.id, quantity: 1 };
    build.memory = [
      { partId: firstMemory.id, quantity: 1 },
      { partId: secondMemory.id, quantity: 1 }
    ];
    const catalog = [...seedCatalog, firstMemory, secondMemory, replacementMemory];
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "memory-mixing");

    expect(finding).toMatchObject({ severity: "warning", title: "서로 다른 RAM 킷을 혼용하고 있습니다." });
    expect(finding?.facts).toEqual(expect.arrayContaining([
      { label: "혼용 RAM", actual: "2종" },
      { label: "RAM 속도", actual: "6000MHz / 5600MHz" },
      { label: "CAS 레이턴시", actual: "CL30 / CL36" },
      { label: "전압", actual: "1.35V / 1.25V" }
    ]));
    expect(result.blockerCount).toBe(0);
    expect(result.links.find((link) => link.id === "motherboard-memory")?.status).toBe("issue");

    const duplicateBuild = { ...build, memory: [{ partId: firstMemory.id, quantity: 2 }] };
    const duplicateResult = evaluateBuild(duplicateBuild, catalog, { includeSuggestions: false });
    expect(duplicateResult.findings.some((item) => item.ruleId === "memory-mixing")).toBe(false);

    const resultWithSuggestions = evaluateBuild(build, catalog);
    const suggestedReplacement = resultWithSuggestions.findings
      .find((item) => item.ruleId === "memory-mixing")
      ?.suggestions?.find((item) => item.part.id === replacementMemory.id);
    const pickerAssessment = assessAlternativePart(build, catalog, "memory", replacementMemory);
    expect(suggestedReplacement).toMatchObject({ recommendedQuantity: 2, fixesCurrentIssue: true });
    expect(suggestedReplacement?.currentPriceWon).toBe(firstMemory.priceWon! + secondMemory.priceWon!);
    expect(suggestedReplacement?.priceDeltaWon).toBe(replacementMemory.priceWon * 2 - (firstMemory.priceWon! + secondMemory.priceWon!));
    expect(resultWithSuggestions.repairPlans?.some((plan) => plan.changes.some((change) => change.toPart.id === replacementMemory.id && change.toQuantity === 2))).toBe(true);
    expect(pickerAssessment).toMatchObject({ risk: "safe", recommendedQuantity: 2 });
  });

  it("marks RAM kit mixing as unknown when comparison metadata is missing", () => {
    const baseMemory = seedCatalog.find((part) => part.id === "memory-ddr5-16-5600")!;
    const knownMemory = {
      ...baseMemory,
      id: "memory-mix-known",
      specs: {
        ...baseMemory.specs,
        speedMhz: 6000,
        memoryCasLatency: 30,
        memoryVoltageV: 1.35
      }
    };
    const incompleteMemory = {
      ...baseMemory,
      id: "memory-mix-incomplete",
      specs: {
        ...baseMemory.specs,
        speedMhz: undefined,
        memoryCasLatency: undefined,
        memoryVoltageV: undefined,
        memoryProfiles: undefined,
        memoryModuleCountPerKit: undefined
      }
    };
    const build = compatibleBuild();
    build.memory = [
      { partId: knownMemory.id, quantity: 1 },
      { partId: incompleteMemory.id, quantity: 1 }
    ];
    const result = evaluateBuild(build, [...seedCatalog, knownMemory, incompleteMemory], { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "memory-mixing");

    expect(finding).toMatchObject({ severity: "unknown", title: "서로 다른 RAM 킷의 혼용 안정성을 확인할 수 없습니다." });
    expect(finding?.facts.find((fact) => fact.label === "확인되지 않은 비교 항목")?.actual).toContain("RAM 속도");
  });

  it("filters the part picker to candidates without a hard finding on the candidate itself", () => {
    const safeMotherboard = {
      ...seedCatalog.find((part) => part.id === "mb-b650-4x3")!,
      id: "mb-picker-safe-board"
    };
    const unsafeMotherboard = seedCatalog.find((part) => part.id === "mb-b760-intel")!;
    const build = compatibleBuild();
    const catalog = [...seedCatalog, safeMotherboard];

    expect(isSafeAlternativePart(build, catalog, "motherboard", safeMotherboard)).toBe(true);
    expect(isSafeAlternativePart(build, catalog, "motherboard", unsafeMotherboard)).toBe(false);
    expect(isSafeAlternativePart(build, catalog, "motherboard", seedCatalog.find((part) => part.id === "mb-b650-4x3")!)).toBe(false);
  });

  it("reports how much of the comparable spec is covered by a replacement score", () => {
    const baseCpu = seedCatalog.find((part) => part.id === "cpu-7800x3d")!;
    const currentCpu = {
      ...baseCpu,
      id: "cpu-lga-limited-baseline",
      name: "테스트 LGA 성능 기준 CPU",
      specs: { ...baseCpu.specs, socket: "LGA1700", cores: 8, threads: 16, boostClockGhz: 5 }
    };
    const completeCpu = {
      ...baseCpu,
      id: "cpu-am5-complete-evidence",
      name: "테스트 AM5 완전 근거 CPU",
      specs: { ...baseCpu.specs, cores: 8, threads: 16, boostClockGhz: 5 }
    };
    const limitedCpu = {
      ...completeCpu,
      id: "cpu-am5-limited-evidence",
      name: "테스트 AM5 제한 근거 CPU",
      specs: { ...completeCpu.specs, threads: undefined, boostClockGhz: undefined }
    };
    const build = compatibleBuild();
    build.cpu = { partId: currentCpu.id, quantity: 1 };
    const catalog = seedCatalog
      .filter((part) => part.category !== "cpu")
      .concat(currentCpu, completeCpu, limitedCpu);
    const result = evaluateBuild(build, catalog);
    const finding = result.findings.find((item) => item.ruleId === "cpu-motherboard-socket");
    const completeSuggestion = finding?.suggestions?.find((suggestion) => suggestion.part.id === completeCpu.id);
    const limitedSuggestion = finding?.suggestions?.find((suggestion) => suggestion.part.id === limitedCpu.id);

    expect(completeSuggestion?.similarityEvidence).toMatchObject({ comparedDimensions: 3, totalDimensions: 3, confidence: "high" });
    expect(limitedSuggestion?.similarityEvidence).toMatchObject({ comparedDimensions: 1, totalDimensions: 3, confidence: "limited" });
    expect(completeSuggestion?.similarityLabel).toBe("동급");
    expect(limitedSuggestion?.similarityLabel).toBe("유사");

    const limitedOnlyResult = evaluateBuild(build, [
      ...seedCatalog.filter((part) => part.category !== "cpu"),
      currentCpu,
      limitedCpu
    ]);
    const limitedPlan = limitedOnlyResult.repairPlans?.find((plan) => plan.changes.some((change) => change.toPart.id === limitedCpu.id));
    expect(limitedPlan?.similarityLabel).toBe("유사");
    expect(limitedPlan?.similarityEvidence).toMatchObject({ comparedDimensions: 1, totalDimensions: 3, confidence: "limited" });
  });

  it("does not recommend a candidate that resolves one issue by introducing a new unknown", () => {
    const currentMotherboard = seedCatalog.find((part) => part.id === "mb-b760-intel")!;
    const safeMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const riskyMotherboard = {
      ...safeMotherboard,
      id: "mb-am5-missing-m2-evidence",
      name: "테스트 AM5 M.2 정보 부족 메인보드",
      specs: { ...safeMotherboard.specs, m2Interfaces: undefined }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: currentMotherboard.id, quantity: 1 };
    const catalog = seedCatalog
      .filter((part) => part.category !== "motherboard")
      .concat(currentMotherboard, safeMotherboard, riskyMotherboard);
    const result = evaluateBuild(build, catalog);
    const suggestions = result.findings.find((item) => item.ruleId === "cpu-motherboard-socket")?.suggestions ?? [];

    expect(suggestions.some((suggestion) => suggestion.part.id === safeMotherboard.id)).toBe(true);
    expect(suggestions.some((suggestion) => suggestion.part.id === riskyMotherboard.id)).toBe(false);
    expect(alternativeRiskForPart(build, catalog, "motherboard", riskyMotherboard)).toBe("review");
    expect(assessAlternativePart(build, catalog, "motherboard", riskyMotherboard).reasons).toContain("M.2 SSD와 메인보드 M.2 연결 정보를 확인할 수 없습니다.");
  });

  it("uses Cinebench R23 scores when ranking CPU alternatives", () => {
    const baseCpu = seedCatalog.find((part) => part.id === "cpu-7800x3d")!;
    const currentCpu = {
      ...baseCpu,
      id: "cpu-lga-benchmark-baseline",
      name: "테스트 LGA 벤치마크 기준 CPU",
      specs: { ...baseCpu.specs, socket: "LGA1700", cores: 8, threads: 16, boostClockGhz: 5, cinebenchR23Single: 1788, cinebenchR23Multi: 18208 }
    };
    const closeCpu = {
      ...baseCpu,
      id: "cpu-am5-close-benchmark",
      name: "테스트 AM5 동급 벤치마크 CPU",
      specs: { ...baseCpu.specs, cores: 8, threads: 16, boostClockGhz: 5, cinebenchR23Single: 1790, cinebenchR23Multi: 18000 }
    };
    const farCpu = {
      ...baseCpu,
      id: "cpu-am5-far-benchmark",
      name: "테스트 AM5 낮은 벤치마크 CPU",
      specs: { ...baseCpu.specs, cores: 8, threads: 16, boostClockGhz: 5, cinebenchR23Single: 1200, cinebenchR23Multi: 6000 }
    };
    const build = compatibleBuild();
    build.cpu = { partId: currentCpu.id, quantity: 1 };
    const catalog = seedCatalog.filter((part) => part.category !== "cpu").concat(currentCpu, closeCpu, farCpu);
    const result = evaluateBuild(build, catalog, { recommendationPreferences: { profile: "general", priority: "performance" } });
    const suggestions = result.findings.find((item) => item.ruleId === "cpu-motherboard-socket")?.suggestions ?? [];
    const closeSuggestion = suggestions.find((suggestion) => suggestion.part.id === closeCpu.id);
    const farSuggestion = suggestions.find((suggestion) => suggestion.part.id === farCpu.id);

    expect(closeSuggestion?.similarityScore).toBeGreaterThan(farSuggestion?.similarityScore ?? -1);
    expect(closeSuggestion?.similarityEvidence).toMatchObject({ comparedDimensions: 5, totalDimensions: 5, confidence: "high" });
    expect(closeSuggestion?.performanceSummary).toContain("%");
    expect(closeSuggestion?.similarityEvidence.dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "cinebenchR23Multi", label: "R23 멀티", weight: 7 })
    ]));
  });

  it("uses parsed GPU performance specs when ranking graphics alternatives", () => {
    const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
    const currentGpu = {
      ...baseGpu,
      id: "gpu-long-benchmark-baseline",
      name: "테스트 장착 불가 GPU 기준 모델",
      specs: {
        ...baseGpu.specs,
        lengthMm: 500,
        vramGb: 8,
        gpuBoostClockMhz: 2600,
        gpuStreamProcessors: 4608,
        gpuMemoryBandwidthGbps: 288,
        powerW: 180,
        recommendedPsuW: 550
      }
    };
    const closeGpu = {
      ...baseGpu,
      id: "gpu-close-benchmark",
      name: "테스트 장착 가능 동급 GPU",
      specs: {
        ...baseGpu.specs,
        lengthMm: 220,
        vramGb: 8,
        gpuBoostClockMhz: 2590,
        gpuStreamProcessors: 4608,
        gpuMemoryBandwidthGbps: 288,
        powerW: 175,
        recommendedPsuW: 550
      }
    };
    const farGpu = {
      ...baseGpu,
      id: "gpu-far-benchmark",
      name: "테스트 장착 가능 낮은 성능 GPU",
      specs: {
        ...baseGpu.specs,
        lengthMm: 220,
        vramGb: 4,
        gpuBoostClockMhz: 2000,
        gpuStreamProcessors: 2048,
        gpuMemoryBandwidthGbps: 128,
        powerW: 120,
        recommendedPsuW: 450
      }
    };
    const build = compatibleBuild();
    build.gpu = { partId: currentGpu.id, quantity: 1 };
    const catalog = seedCatalog.filter((part) => part.category !== "gpu").concat(currentGpu, closeGpu, farGpu);
    const result = evaluateBuild(build, catalog, { recommendationPreferences: { profile: "gaming", priority: "performance" } });
    const suggestions = result.findings.find((item) => item.ruleId === "gpu-case-length")?.suggestions ?? [];
    const closeSuggestion = suggestions.find((suggestion) => suggestion.part.id === closeGpu.id);
    const farSuggestion = suggestions.find((suggestion) => suggestion.part.id === farGpu.id);

    expect(closeSuggestion?.similarityScore).toBeGreaterThan(farSuggestion?.similarityScore ?? -1);
    expect(closeSuggestion?.similarityEvidence).toMatchObject({ comparedDimensions: 4, totalDimensions: 4, confidence: "high" });
    expect(closeSuggestion?.performanceSummary).toContain("%");
    expect(closeSuggestion?.similarityEvidence.dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "gpuMemoryBandwidthGbps", label: "VRAM 대역폭", weight: 6 })
    ]));
  });

  it("uses a verified same-GPU-family reference when the selected GPU lacks performance fields", () => {
    const currentGpu = seedCatalog.find((part) => part.id === "gpu-rtx-5090")!;
    const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
    const referenceGpu: Part = {
      ...baseGpu,
      id: "gpu-rtx5090-performance-reference",
      name: "검증된 RTX 5090 계열 참조 모델",
      model: "RTX 5090 Compact Reference",
      source: "danawa",
      sourceProductCode: "reference-5090",
      dataQuality: "live",
      specs: {
        ...baseGpu.specs,
        gpuVendor: "nvidia",
        gpuArchitectureFamily: "RTX 50",
        vramGb: 32,
        gpuBoostClockMhz: 2500,
        gpuStreamProcessors: 21760,
        gpuMemoryBandwidthGbps: 1792,
        lengthMm: 260,
        thicknessMm: 50,
        powerW: 575,
        recommendedPsuW: 1000
      }
    };
    const closeGpu: Part = {
      ...referenceGpu,
      id: "gpu-rtx5090-compact-candidate",
      name: "RTX 5090 호환 컴팩트 후보",
      model: "RTX 5090 Compact Candidate",
      sourceProductCode: "candidate-5090",
      specs: { ...referenceGpu.specs, lengthMm: 250 }
    };
    const farGpu: Part = {
      ...baseGpu,
      id: "gpu-rtx4060-compact-candidate",
      name: "RTX 4060 호환 컴팩트 후보",
      model: "RTX 4060 Compact Candidate",
      specs: {
        ...baseGpu.specs,
        gpuVendor: "nvidia",
        gpuArchitectureFamily: "RTX 40",
        vramGb: 8,
        gpuBoostClockMhz: 2535,
        gpuStreamProcessors: 3072,
        gpuMemoryBandwidthGbps: 288,
        lengthMm: 220,
        powerW: 115,
        recommendedPsuW: 550
      }
    };
    const build = compatibleBuild();
    build.gpu = { partId: currentGpu.id, quantity: 1 };
    build.case = { partId: "case-compact-matx", quantity: 1 };
    const catalog = [...seedCatalog, referenceGpu, closeGpu, farGpu];
    const closeSimilarity = candidateSimilarityForBuild(build, catalog, "gpu", closeGpu, "gaming", "1440p");
    const farSimilarity = candidateSimilarityForBuild(build, catalog, "gpu", farGpu, "gaming", "1440p");
    const result = evaluateBuild(build, catalog, { recommendationPreferences: { profile: "gaming", priority: "performance" } });
    const suggestion = result.findings.find((item) => item.ruleId === "gpu-case-length")?.suggestions?.find((item) => item.part.id === closeGpu.id);

    expect(closeSimilarity.similarityScore).toBeGreaterThan(farSimilarity.similarityScore);
    expect(closeSimilarity.similarityEvidence).toMatchObject({ comparedDimensions: 4, totalDimensions: 4, confidence: "high" });
    expect(closeSimilarity.similarityEvidence.notes?.[0]).toContain("동일 GPU 모델 계열의 검증된 카탈로그 참조");
    expect(closeSimilarity.performanceSummary).toContain("동일 GPU 모델 계열 참조 기준");
    expect(suggestion).toBeDefined();
    expect(suggestion?.similarityScore).toBe(closeSimilarity.similarityScore);
    expect(suggestion?.performanceSummary).toContain("동일 GPU 모델 계열 참조 기준");
    expect(compareCandidateSimilarity(
      { similarityScore: 99, similarityEvidence: { comparedDimensions: 1, totalDimensions: 3, confidence: "limited" } },
      { similarityScore: 54, similarityEvidence: { comparedDimensions: 3, totalDimensions: 3, confidence: "high" } }
    )).toBeGreaterThan(0);
  });

  it("uses a verified same-CPU-family reference when the selected CPU lacks performance fields", () => {
    const currentCpu = seedCatalog.find((part) => part.id === "cpu-7500f")!;
    const baseCpu = seedCatalog.find((part) => part.id === "cpu-i7-14700k")!;
    const referenceCpu: Part = {
      ...currentCpu,
      id: "cpu-7500f-performance-reference",
      name: "검증된 Ryzen 5 7500F 계열 참조 모델",
      model: "AMD Ryzen 5 7500F Reference",
      source: "danawa",
      sourceProductCode: "reference-7500f",
      dataQuality: "live",
      specs: {
        ...currentCpu.specs,
        cores: 6,
        threads: 12,
        boostClockGhz: 5,
        cinebenchR23Single: 1824,
        cinebenchR23Multi: 13824
      }
    };
    const closeCpu: Part = {
      ...baseCpu,
      id: "cpu-14700k-compatible-close",
      name: "LGA 호환 근접 성능 CPU",
      model: "Intel 14700K Compatible Close",
      specs: {
        ...baseCpu.specs,
        cores: 6,
        threads: 12,
        boostClockGhz: 5,
        cinebenchR23Single: 1810,
        cinebenchR23Multi: 13700,
        pptW: 150,
        tdpW: 105
      }
    };
    const farCpu: Part = {
      ...baseCpu,
      id: "cpu-14700k-compatible-far",
      name: "LGA 호환 낮은 성능 CPU",
      model: "Intel 14700K Compatible Far",
      specs: {
        ...baseCpu.specs,
        cores: 2,
        threads: 4,
        boostClockGhz: 3.5,
        cinebenchR23Single: 900,
        cinebenchR23Multi: 3000,
        pptW: 80,
        tdpW: 65
      }
    };
    const build = compatibleBuild();
    build.cpu = { partId: currentCpu.id, quantity: 1 };
    build.motherboard = { partId: "mb-b760-intel", quantity: 1 };
    const catalog = [...seedCatalog, referenceCpu, closeCpu, farCpu];
    const closeSimilarity = candidateSimilarityForBuild(build, catalog, "cpu", closeCpu, "general");
    const result = evaluateBuild(build, catalog, { recommendationPreferences: { profile: "general", priority: "performance" } });
    const suggestion = result.findings.find((item) => item.ruleId === "cpu-motherboard-socket")?.suggestions?.find((item) => item.part.id === closeCpu.id);

    expect(closeSimilarity.similarityEvidence).toMatchObject({ comparedDimensions: 5, totalDimensions: 5, confidence: "high", basis: "mixed" });
    expect(closeSimilarity.similarityEvidence.notes?.[0]).toContain("동일 CPU 모델 계열의 검증된 카탈로그 참조");
    expect(closeSimilarity.performanceSummary).toContain("동일 CPU 모델 계열 참조 기준");
    expect(suggestion).toBeDefined();
    expect(suggestion?.performanceSummary).toContain("동일 CPU 모델 계열 참조 기준");

    const x3dCurrentCpu = seedCatalog.find((part) => part.id === "cpu-7800x3d")!;
    const x3dReferenceCpu: Part = {
      ...referenceCpu,
      id: "cpu-7800x3d-performance-reference",
      name: "검증된 Ryzen 7 7800X3D 계열 참조 모델",
      model: "AMD Ryzen 7 7800X3D Reference",
      sourceProductCode: "reference-7800x3d",
      specs: { ...referenceCpu.specs, cores: 8, threads: 16, boostClockGhz: 5, cinebenchR23Single: 1788, cinebenchR23Multi: 18208 }
    };
    const x3dBuild = { ...build, cpu: { partId: x3dCurrentCpu.id, quantity: 1 } };
    const x3dSimilarity = candidateSimilarityForBuild(x3dBuild, [...seedCatalog, x3dReferenceCpu, closeCpu], "cpu", closeCpu, "general");
    expect(x3dSimilarity.similarityEvidence.notes?.[0]).toContain("동일 CPU 모델 계열의 검증된 카탈로그 참조");
  });

  it("uses SSD IOPS alongside sequential throughput when ranking storage alternatives", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseSsd = seedCatalog.find((part) => part.id === "ssd-nvme-1tb")!;
    const motherboard = {
      ...baseMotherboard,
      id: "mb-sata-m2-for-ssd-iops",
      specs: { ...baseMotherboard.specs, m2Interfaces: ["SATA"] as Array<"SATA"> }
    };
    const currentSsd = {
      ...baseSsd,
      id: "ssd-nvme-iops-current",
      name: "테스트 NVMe SSD 1TB 고성능",
      specs: {
        ...baseSsd.specs,
        interface: "NVMe",
        capacityGb: 1000,
        sequentialReadMbps: 7000,
        sequentialWriteMbps: 6000,
        ssdReadIops: 1_000_000,
        ssdWriteIops: 900_000
      }
    };
    const replacementSsd = {
      ...baseSsd,
      id: "ssd-sata-iops-candidate",
      name: "테스트 SATA SSD 1TB 대안",
      specs: {
        ...baseSsd.specs,
        interface: "SATA",
        capacityGb: 1000,
        sequentialReadMbps: 550,
        sequentialWriteMbps: 520,
        ssdReadIops: 90_000,
        ssdWriteIops: 80_000
      }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: motherboard.id, quantity: 1 };
    build.ssd = [{ partId: currentSsd.id, quantity: 1 }];
    const catalog = [...seedCatalog, motherboard, currentSsd, replacementSsd];
    const result = evaluateBuild(build, catalog);
    const suggestion = result.findings
      .find((finding) => finding.ruleId === "m2-interface")
      ?.suggestions?.find((item) => item.part.id === replacementSsd.id);

    expect(suggestion?.fixesCurrentIssue).toBe(true);
    expect(suggestion?.similarityEvidence).toMatchObject({ comparedDimensions: 5, totalDimensions: 5, confidence: "high", basis: "spec" });
    expect(suggestion?.similarityEvidence.dimensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "ssdReadIops", label: "읽기 IOPS" }),
      expect.objectContaining({ key: "ssdWriteIops", label: "쓰기 IOPS" })
    ]));
    expect(suggestion?.performanceSummary).toContain("읽기 IOPS");
  });

  it("does not compare stream processor counts across GPU vendors", () => {
    const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
    const currentGpu = {
      ...baseGpu,
      id: "gpu-nvidia-cross-vendor-baseline",
      name: "NVIDIA 교차 계열 비교 기준 GPU",
      specs: {
        ...baseGpu.specs,
        gpuVendor: "nvidia" as const,
        lengthMm: 500,
        vramGb: 16,
        gpuBoostClockMhz: 2600,
        gpuStreamProcessors: 4608,
        gpuMemoryBandwidthGbps: 448
      }
    };
    const amdGpu = {
      ...baseGpu,
      id: "gpu-amd-cross-vendor-candidate",
      name: "AMD 교차 계열 비교 후보 GPU",
      specs: {
        ...baseGpu.specs,
        gpuVendor: "amd" as const,
        lengthMm: 220,
        vramGb: 16,
        gpuBoostClockMhz: 2500,
        gpuStreamProcessors: 4096,
        gpuMemoryBandwidthGbps: 448
      }
    };
    const build = compatibleBuild();
    build.gpu = { partId: currentGpu.id, quantity: 1 };
    const catalog = seedCatalog.filter((part) => part.category !== "gpu").concat(currentGpu, amdGpu);
    const result = evaluateBuild(build, catalog, { recommendationPreferences: { profile: "gaming", priority: "performance" } });
    const suggestion = result.findings.find((item) => item.ruleId === "gpu-case-length")?.suggestions?.find((item) => item.part.id === amdGpu.id);

    expect(suggestion?.similarityEvidence).toMatchObject({ comparedDimensions: 3, totalDimensions: 3, confidence: "high" });
    expect(suggestion?.similarityEvidence.dimensions?.some((dimension) => dimension.key === "gpuStreamProcessors")).toBe(false);
    expect(suggestion?.similarityEvidence.notes).toContain("GPU 계열이 달라 스트림 프로세서는 유사도에서 제외했습니다.");
    expect(suggestion?.performanceSummary).not.toContain("스트림");
  });

  it("does not compare stream processor counts across GPU architecture families", () => {
    const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
    const currentGpu = {
      ...baseGpu,
      id: "gpu-rtx50-architecture-baseline",
      name: "RTX 50 아키텍처 기준 GPU",
      specs: {
        ...baseGpu.specs,
        gpuVendor: "nvidia" as const,
        gpuArchitectureFamily: "RTX 50",
        lengthMm: 500,
        vramGb: 16,
        gpuBoostClockMhz: 2600,
        gpuStreamProcessors: 4608,
        gpuMemoryBandwidthGbps: 448
      }
    };
    const candidateGpu = {
      ...baseGpu,
      id: "gpu-rtx40-architecture-candidate",
      name: "RTX 40 아키텍처 후보 GPU",
      specs: {
        ...baseGpu.specs,
        gpuVendor: "nvidia" as const,
        gpuArchitectureFamily: "RTX 40",
        lengthMm: 220,
        vramGb: 16,
        gpuBoostClockMhz: 2500,
        gpuStreamProcessors: 4096,
        gpuMemoryBandwidthGbps: 448
      }
    };
    const build = compatibleBuild();
    build.gpu = { partId: currentGpu.id, quantity: 1 };
    const catalog = seedCatalog.filter((part) => part.category !== "gpu").concat(currentGpu, candidateGpu);
    const result = evaluateBuild(build, catalog, { recommendationPreferences: { profile: "gaming", priority: "performance" } });
    const suggestion = result.findings.find((item) => item.ruleId === "gpu-case-length")?.suggestions?.find((item) => item.part.id === candidateGpu.id);

    expect(suggestion?.similarityEvidence).toMatchObject({ comparedDimensions: 3, totalDimensions: 3, confidence: "high" });
    expect(suggestion?.similarityEvidence.dimensions?.some((dimension) => dimension.key === "gpuStreamProcessors")).toBe(false);
    expect(suggestion?.similarityEvidence.notes).toContain("GPU 세대 계열(RTX 50 · RTX 40)이 달라 스트림 프로세서는 유사도에서 제외했습니다.");
  });

  it("keeps similarity distance symmetric for higher and lower performance candidates", () => {
    const baseCpu = seedCatalog.find((part) => part.id === "cpu-7800x3d")!;
    const currentCpu = {
      ...baseCpu,
      id: "cpu-symmetric-baseline",
      name: "대칭 점수 기준 CPU",
      specs: { ...baseCpu.specs, socket: "LGA1700", cores: 8, threads: 16, boostClockGhz: 5, cinebenchR23Single: 1000, cinebenchR23Multi: 10000 }
    };
    const higherCpu = {
      ...baseCpu,
      id: "cpu-symmetric-higher",
      name: "대칭 점수 상향 CPU",
      specs: { ...baseCpu.specs, cores: 16, threads: 32, boostClockGhz: 10, cinebenchR23Single: 2000, cinebenchR23Multi: 20000 }
    };
    const lowerCpu = {
      ...baseCpu,
      id: "cpu-symmetric-lower",
      name: "대칭 점수 하향 CPU",
      specs: { ...baseCpu.specs, cores: 4, threads: 8, boostClockGhz: 2.5, cinebenchR23Single: 500, cinebenchR23Multi: 5000 }
    };
    const build = compatibleBuild();
    build.cpu = { partId: currentCpu.id, quantity: 1 };
    const catalog = seedCatalog.filter((part) => part.category !== "cpu").concat(currentCpu, higherCpu, lowerCpu);
    const result = evaluateBuild(build, catalog, { recommendationPreferences: { profile: "general", priority: "performance" } });
    const suggestions = result.findings.find((item) => item.ruleId === "cpu-motherboard-socket")?.suggestions ?? [];
    const higherSuggestion = suggestions.find((suggestion) => suggestion.part.id === higherCpu.id);
    const lowerSuggestion = suggestions.find((suggestion) => suggestion.part.id === lowerCpu.id);

    expect(higherSuggestion).toBeDefined();
    expect(lowerSuggestion).toBeDefined();
    expect(higherSuggestion?.similarityScore).toBe(lowerSuggestion?.similarityScore);
  });

  it("marks a replacement as fully compatible when it removes the only blocker", () => {
    const build = compatibleBuild();
    build.motherboard = { partId: "mb-b760-intel", quantity: 1 };
    const result = evaluateBuild(build, seedCatalog);
    const finding = result.findings.find((item) => item.ruleId === "cpu-motherboard-socket");
    const suggestion = finding?.suggestions?.find((item) => item.part.id === "mb-b650-4x3");

    expect(result.blockerCount).toBe(1);
    expect(suggestion).toBeDefined();
    expect(suggestion?.fixesCurrentIssue).toBe(true);
    expect(suggestion?.remainingBlockers).toBe(0);
    expect(suggestion?.remainingWarnings).toBe(0);
    expect(suggestion?.reason).toContain("전체 구성도 호환");
    const fullPlan = result.repairPlans?.find((plan) => plan.label === "완전 호환");
    expect(fullPlan).toBeDefined();
    expect(fullPlan).toMatchObject({ remainingBlockers: 0, remainingWarnings: 0, remainingUnknown: 0 });
  });

  it("calculates a repair plan price delta using the selected quantity", () => {
    const slowerMotherboard = {
      ...seedCatalog.find((part) => part.id === "mb-b650-4x3")!,
      id: "mb-b650-slower-memory",
      specs: {
        ...seedCatalog.find((part) => part.id === "mb-b650-4x3")!.specs,
        maxMemorySpeedMhz: 5600
      }
    };
    const build = compatibleBuild();
    build.motherboard = { partId: slowerMotherboard.id, quantity: 1 };
    build.memory = [{ partId: "memory-ddr5-32-7200", quantity: 2 }];
    const result = evaluateBuild(build, [...seedCatalog, slowerMotherboard]);
    const plan = result.repairPlans?.find((item) => item.changes.length === 1 && item.changes[0].category === "memory");

    expect(result.findings.some((item) => item.ruleId === "memory-speed")).toBe(true);
    expect(plan).toBeDefined();
    expect(plan?.changes[0].priceDeltaWon).toBe(-222000);
    expect(plan?.priceDeltaWon).toBe(-222000);
  });

  it("offers a quantity-only repair plan when reducing the module count fixes the warning", () => {
    const build = compatibleBuild();
    build.memory = [{ partId: "memory-ddr5-16-5600", quantity: 4 }];
    const result = evaluateBuild(build, seedCatalog);
    const plan = result.repairPlans?.find((item) => item.changes.some((change) => change.kind === "change_quantity"));

    expect(result.warningCount).toBe(1);
    expect(plan).toBeDefined();
    expect(plan?.changes).toHaveLength(1);
    expect(plan?.changes[0].category).toBe("memory");
    expect(plan?.changes[0].fromQuantity).toBe(4);
    expect(plan?.changes[0].toQuantity).toBe(2);
    expect(plan?.changes[0].priceDeltaWon).toBe(-116000);
    expect(plan?.remainingWarnings).toBe(0);
    expect(plan?.title).toContain("수량 조정");
  });

  it("includes quantities when calculating prices for single-slot selections", () => {
    const oneGpu = evaluateBuild(compatibleBuild(), seedCatalog, { includeSuggestions: false });
    const twoGpuBuild = compatibleBuild();
    twoGpuBuild.gpu = { partId: "gpu-rtx-4060", quantity: 2 };
    const twoGpu = evaluateBuild(twoGpuBuild, seedCatalog, { includeSuggestions: false });

    expect(twoGpu.totalPriceWon - oneGpu.totalPriceWon).toBe(439000);
  });

  it("orders plans by the requested priority and reports budget fit", () => {
    const build = compatibleBuild();
    build.motherboard = { partId: "mb-b760-intel", quantity: 1 };
    const result = evaluateBuild(build, seedCatalog, {
      recommendationPreferences: { priority: "budget", profile: "general", budgetWon: 1_500_000 }
    });

    expect(result.recommendationPreferences).toEqual({ priority: "budget", profile: "general", budgetWon: 1_500_000 });
    expect(result.repairPlans?.[0].label).toBe("가성비");
    expect(result.repairPlans?.every((plan) => plan.budgetWon === 1_500_000 && plan.withinBudget !== undefined)).toBe(true);
    expect(result.repairPlans?.[0].reason).toContain("예산");
  });

  it("applies the selected use profile to recommendation explanations", () => {
    const build = compatibleBuild();
    build.motherboard = { partId: "mb-b760-intel", quantity: 1 };
    const result = evaluateBuild(build, seedCatalog, {
      recommendationPreferences: { priority: "performance", profile: "gaming" }
    });
    const suggestion = result.findings.find((finding) => finding.ruleId === "cpu-motherboard-socket")?.suggestions?.[0];

    expect(result.recommendationPreferences).toEqual({ priority: "performance", profile: "gaming" });
    expect(result.repairPlans?.[0].profileSummary).toContain("게이밍");
    expect(suggestion?.profileSummary).toContain("게이밍");
  });

  it("keeps replacement recommendations within the selected listing policy", () => {
    const currentMotherboard = seedCatalog.find((part) => part.id === "mb-b760-intel")!;
    const usedReplacement = {
      ...seedCatalog.find((part) => part.id === "mb-b650-4x3")!,
      id: "mb-b650-used-replacement",
      name: "동일 성능 메인보드 중고",
      listingType: "used" as const
    };
    const catalog = seedCatalog
      .filter((part) => part.category !== "motherboard")
      .concat(currentMotherboard, usedReplacement);
    const build = compatibleBuild();
    build.motherboard = { partId: currentMotherboard.id, quantity: 1 };

    const retailOnly = evaluateBuild(build, catalog, {
      recommendationPreferences: { priority: "balanced", profile: "general" }
    });
    const allListings = evaluateBuild(build, catalog, {
      recommendationPreferences: { priority: "balanced", profile: "general", listingPolicy: "all" }
    });

    expect(retailOnly.findings.find((finding) => finding.ruleId === "cpu-motherboard-socket")?.suggestions)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ part: expect.objectContaining({ id: usedReplacement.id }) })]));
    expect(allListings.findings.find((finding) => finding.ruleId === "cpu-motherboard-socket")?.suggestions)
      .toEqual(expect.arrayContaining([expect.objectContaining({ part: expect.objectContaining({ id: usedReplacement.id }) })]));
  });

  it("orders equally compatible replacement candidates by the requested priority", () => {
    const currentMotherboard = seedCatalog.find((part) => part.id === "mb-b760-intel")!;
    const baseReplacement = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const expensiveReplacement = { ...baseReplacement, id: "mb-b650-expensive", name: "동일 성능 메인보드 프리미엄", priceWon: 999000 };
    const cheapReplacement = { ...baseReplacement, id: "mb-b650-cheap", name: "동일 성능 메인보드 가성비", priceWon: 1000 };
    const catalog = seedCatalog
      .filter((part) => part.category !== "motherboard")
      .concat(currentMotherboard, expensiveReplacement, cheapReplacement);
    const build = compatibleBuild();
    build.motherboard = { partId: currentMotherboard.id, quantity: 1 };

    const result = evaluateBuild(build, catalog, {
      recommendationPreferences: { priority: "budget", profile: "general" }
    });
    const suggestions = result.findings.find((finding) => finding.ruleId === "cpu-motherboard-socket")?.suggestions ?? [];

    expect(suggestions.map((suggestion) => suggestion.part.id).slice(0, 2)).toEqual([cheapReplacement.id, expensiveReplacement.id]);
  });

  it("generates a compatible office draft within the requested budget", () => {
    const draft = generateBuildDraft(seedCatalog, {
      profile: "office",
      budgetWon: 1_500_000,
      includeGpu: false
    });

    expect(draft.status).toBe("compatible");
    expect(draft.blockerCount).toBe(0);
    expect(draft.unknownCount).toBe(0);
    expect(draft.withinBudget).toBe(true);
    expect(draft.selection.gpu).toBeUndefined();
    expect(draft.selection.useIntegratedGraphics).toBe(true);
    expect(draft.lines.map((line) => line.category)).toEqual(expect.arrayContaining(["cpu", "motherboard", "memory", "ssd", "case", "psu"]));
    expect(draft.lines.find((line) => line.category === "cpu")?.specSummary).toContain("소켓");
    expect(draft.lines.find((line) => line.category === "memory")?.specSummary).toContain("MHz");
    const rechecked = evaluateBuild(draft.selection, seedCatalog, { includeSuggestions: false });
    expect(rechecked.findings.some((finding) => finding.ruleId === "memory-speed")).toBe(false);
    expect(rechecked.metrics.memorySlotsUsed).toBeLessThanOrEqual(rechecked.metrics.memorySlotsTotal ?? 0);

    const retailOnlyRequest = {
      profile: "office" as const,
      priority: "balanced" as const,
      budgetWon: 1_500_000,
      includeGpu: false,
      gamingResolution: "1440p" as const,
      memoryCapacityGb: 32,
      storageCapacityGb: 1000,
      hddCapacityGb: 4000,
      hddCount: 0,
      listingPolicy: "retail_only" as const
    };
    const bulkMotherboardCatalog = seedCatalog.map((part) => part.category === "motherboard" ? { ...part, listingType: "bulk" as const } : part);
    expect(() => generateBuildDraft(bulkMotherboardCatalog, retailOnlyRequest)).toThrow(/메인보드/);
    let missingPoolError: unknown;
    try {
      generateBuildDraft(bulkMotherboardCatalog, retailOnlyRequest);
    } catch (error: unknown) {
      missingPoolError = error;
    }
    expect(missingPoolError).toBeInstanceOf(BuildGenerationError);
    expect(missingPoolError).toMatchObject({ diagnostics: [{ id: "candidate-pools", facts: expect.arrayContaining([{ label: "메인보드 후보", value: "0개" }]) }] });
    const recoveryOptions = buildGenerationRecoveryOptionsFor(bulkMotherboardCatalog, retailOnlyRequest);
    expect(recoveryOptions.find((option) => option.id === "include-bulk")).toMatchObject({
      changedFields: ["구매 조건: 벌크 포함"],
      preview: { status: "compatible", blockerCount: 0 }
    });
    const noPairCatalog = seedCatalog.map((part) => part.category === "motherboard" ? { ...part, specs: { ...part.specs, socket: "NO-SUCH-SOCKET" } } : part);
    let generationError: unknown;
    try {
      generateBuildDraft(noPairCatalog, { profile: "office", budgetWon: 1_500_000, includeGpu: false });
    } catch (error: unknown) {
      generationError = error;
    }
    expect(generationError).toBeInstanceOf(BuildGenerationError);
    expect(generationError).toMatchObject({ diagnostics: [{ id: "cpu-motherboard-pair", facts: expect.arrayContaining([{ label: "호환쌍", value: "0개" }]) }] });
    const hddRecoveryOptions = buildGenerationRecoveryOptionsFor(seedCatalog, {
      profile: "office",
      priority: "balanced",
      budgetWon: 3_000_000,
      includeGpu: false,
      gamingResolution: "1440p",
      memoryCapacityGb: 32,
      storageCapacityGb: 1000,
      hddCapacityGb: 4000,
      hddCount: 4,
      listingPolicy: "retail_only"
    });
    expect(hddRecoveryOptions.find((option) => option.id === "hdd-2")?.request.hddCount).toBe(2);

    const compatibleExpensiveCpu = { ...seedCatalog.find((part) => part.id === "cpu-7800x3d")!, id: "cpu-generator-beam-compatible", priceWon: 900000, name: "호환 가능한 고가 CPU" };
    const incompatibleCheapCpus = Array.from({ length: 121 }, (_value, index) => ({
      ...compatibleExpensiveCpu,
      id: `cpu-generator-beam-incompatible-${index}`,
      name: `호환 후보에서 제외되는 저가 CPU ${index + 1}`,
      priceWon: 1000 + index,
      specs: { ...compatibleExpensiveCpu.specs, socket: "NO-SUCH-SOCKET", cores: 32, threads: 64, boostClockGhz: 5.8, cinebenchR23Multi: 50000 }
    }));
    const beamSearchDraft = generateBuildDraft(seedCatalog.filter((part) => part.category !== "cpu").concat(compatibleExpensiveCpu, ...incompatibleCheapCpus), {
      profile: "office",
      budgetWon: 3_000_000,
      includeGpu: false
    });
    expect(beamSearchDraft.selection.cpu?.partId).toBe(compatibleExpensiveCpu.id);
  });

  it("uses a case with unknown HDD bays when HDD is not requested, but rejects it when HDD is requested", () => {
    const baseCase = seedCatalog.find((part) => part.id === "case-full-airflow")!;
    const caseWithoutHddEvidence: Part = {
      ...baseCase,
      id: "case-generator-no-hdd-evidence",
      name: "HDD 베이 정보 부족 케이스",
      dataQuality: "incomplete",
      missingFields: ["hddBays"],
      specs: { ...baseCase.specs, hddBays: undefined }
    };
    const catalog = seedCatalog.filter((part) => part.category !== "case").concat(caseWithoutHddEvidence);
    const noHddDraft = generateBuildDraft(catalog, { profile: "office", budgetWon: 1_500_000, includeGpu: false, hddCount: 0 });

    expect(noHddDraft.selection.case?.partId).toBe(caseWithoutHddEvidence.id);
    expect(noHddDraft.status).toBe("compatible");
    expect(noHddDraft.unknownCount).toBe(0);
    expect(() => generateBuildDraft(catalog, { profile: "office", budgetWon: 1_500_000, includeGpu: false, hddCount: 1, hddCapacityGb: 4000 })).toThrow(/케이스/);
  });

  it("honors budget and performance priority when generating a draft", () => {
    const baseCpu = seedCatalog.find((part) => part.id === "cpu-7800x3d")!;
    const budgetCpu: Part = {
      ...baseCpu,
      id: "cpu-generator-budget-priority",
      name: "테스트 자동 구성 가성비 CPU",
      priceWon: 100000,
      specs: { ...baseCpu.specs, cores: 4, threads: 8, boostClockGhz: 4.2, cinebenchR23Single: 1500, cinebenchR23Multi: 9000 }
    };
    const performanceCpu: Part = {
      ...baseCpu,
      id: "cpu-generator-performance-priority",
      name: "테스트 자동 구성 성능 CPU",
      priceWon: 550000,
      specs: { ...baseCpu.specs, cores: 16, threads: 32, boostClockGhz: 5.4, cinebenchR23Single: 2200, cinebenchR23Multi: 30000, pptW: 170 }
    };
    const catalog = seedCatalog.filter((part) => part.category !== "cpu").concat(budgetCpu, performanceCpu);
    const budgetDraft = generateBuildDraft(catalog, { profile: "office", priority: "budget", budgetWon: 2_000_000, includeGpu: false });
    const performanceDraft = generateBuildDraft(catalog, { profile: "office", priority: "performance", budgetWon: 2_000_000, includeGpu: false });

    expect(budgetDraft.priority).toBe("budget");
    expect(performanceDraft.priority).toBe("performance");
    expect(budgetDraft.selection.cpu?.partId).toBe(budgetCpu.id);
    expect(performanceDraft.selection.cpu?.partId).toBe(performanceCpu.id);
    expect(budgetDraft.blockerCount).toBe(0);
    expect(performanceDraft.blockerCount).toBe(0);
  });

  it("honors the requested RAM capacity in an automatic draft", () => {
    const baseMemory = seedCatalog.find((part) => part.id === "memory-ddr5-16-5600")!;
    const memory64GbKit: Part = {
      ...baseMemory,
      id: "memory-generator-64gb-kit",
      name: "테스트 자동 구성 32GB 모듈",
      priceWon: 110000,
      specs: { ...baseMemory.specs, capacityGb: 32 }
    };
    const catalog = seedCatalog.filter((part) => part.category !== "memory").concat(memory64GbKit);
    const draft = generateBuildDraft(catalog, {
      profile: "office",
      budgetWon: 2_000_000,
      includeGpu: false,
      memoryCapacityGb: 64
    });
    const memoryLine = draft.lines.find((line) => line.category === "memory");
    const selectedMemory = catalog.find((part) => part.id === draft.selection.memory[0]?.partId);

    expect(draft.memoryCapacityGb).toBe(64);
    expect(memoryLine?.partId).toBe(memory64GbKit.id);
    expect((selectedMemory?.specs.capacityGb ?? 0) * (memoryLine?.quantity ?? 0)).toBeGreaterThanOrEqual(64);
    expect(draft.blockerCount).toBe(0);
    expect(draft.unknownCount).toBe(0);
  });

  it("carries the gaming resolution into an automatic draft and its rationale", () => {
    const draft = generateBuildDraft(seedCatalog, {
      profile: "gaming",
      budgetWon: 3_000_000,
      includeGpu: true,
      gamingResolution: "4k",
      gamingRefreshRate: 240
    });

    expect(draft.gamingResolution).toBe("4k");
    expect(draft.gamingRefreshRate).toBe(240);
    expect(draft.gpuTarget?.resolution).toBe("4k");
    expect(draft.gpuTarget?.currentFit).toBe("unknown");
    expect(draft.rationale.some((item) => item.includes("권장 VRAM 16GB") && item.includes("240Hz"))).toBe(true);
    expect(draft.warnings.some((item) => item.includes("GPU VRAM을 원문에서 확인해 주세요"))).toBe(true);
    expect(draft.blockerCount).toBe(0);
    expect(draft.unknownCount).toBe(0);
  });

  it("marks a compatible automatic gaming draft when its GPU misses the selected VRAM target", () => {
    const baseGpu = seedCatalog.find((part) => part.id === "gpu-rtx-4060")!;
    const gpuWithKnownVram: Part = {
      ...baseGpu,
      id: "gpu-generator-qhd-target-miss",
      name: "테스트 4K 권장 미달 GPU",
      specs: { ...baseGpu.specs, vramGb: 8 }
    };
    const catalog = seedCatalog.filter((part) => part.category !== "gpu").concat(gpuWithKnownVram);
    const draft = generateBuildDraft(catalog, {
      profile: "gaming",
      budgetWon: 3_000_000,
      includeGpu: true,
      gamingResolution: "4k"
    });

    expect(draft.gpuTarget).toMatchObject({ resolution: "4k", targetVramGb: 16, currentVramGb: 8, currentFit: "partial" });
    expect(draft.warnings.some((item) => item.includes("권장 기준 미달") && item.includes("부족할 수 있습니다"))).toBe(true);
    expect(draft.status).toBe("compatible");
  });

  it("reports an over-budget draft instead of claiming a false budget fit", () => {
    const draft = generateBuildDraft(seedCatalog, {
      profile: "office",
      budgetWon: 100_000,
      includeGpu: false
    });

    expect(draft.status).toBe("compatible");
    expect(draft.withinBudget).toBe(false);
    expect(draft.budgetDeltaWon).toBeGreaterThan(0);
    expect(draft.warnings[0]).toContain("목표 예산");
  });

  it("honors SSD capacity and HDD quantity requirements in the generated draft", () => {
    const draft = generateBuildDraft(seedCatalog, {
      profile: "office",
      budgetWon: 2_000_000,
      includeGpu: false,
      storageCapacityGb: 1000,
      hddCapacityGb: 4000,
      hddCount: 2
    });

    const ssd = draft.lines.find((line) => line.category === "ssd");
    const hdd = draft.lines.find((line) => line.category === "hdd");
    expect(draft.blockerCount).toBe(0);
    expect(draft.unknownCount).toBe(0);
    expect(ssd?.quantity).toBe(1);
    expect(seedCatalog.find((part) => part.id === ssd?.partId)?.specs.capacityGb).toBeGreaterThanOrEqual(1000);
    expect(hdd?.quantity).toBe(2);
    expect(seedCatalog.find((part) => part.id === hdd?.partId)?.specs.capacityGb).toBeGreaterThanOrEqual(4000);
  });

  it("does not generate an NVMe SSD above the motherboard M.2 PCIe generation", () => {
    const baseMotherboard = seedCatalog.find((part) => part.id === "mb-b650-4x3")!;
    const baseSsd = seedCatalog.find((part) => part.id === "ssd-nvme-1tb")!;
    const motherboard: Part = {
      ...baseMotherboard,
      id: "mb-generator-pcie4",
      specs: { ...baseMotherboard.specs, m2PcieGenerations: [4] }
    };
    const pcie5Ssd: Part = {
      ...baseSsd,
      id: "ssd-generator-pcie5",
      name: "자동 구성 제외 PCIe 5.0 NVMe SSD",
      specs: { ...baseSsd.specs, m2PcieGeneration: 5 }
    };
    const pcie4Ssd: Part = {
      ...baseSsd,
      id: "ssd-generator-pcie4",
      name: "자동 구성 허용 PCIe 4.0 NVMe SSD",
      specs: { ...baseSsd.specs, m2PcieGeneration: 4 }
    };
    const catalog = seedCatalog
      .filter((part) => part.category !== "motherboard" && part.category !== "ssd")
      .concat(motherboard, pcie5Ssd, pcie4Ssd);

    const draft = generateBuildDraft(catalog, {
      profile: "office",
      budgetWon: 1_500_000,
      includeGpu: false,
      storageCapacityGb: 1000
    });
    const selectedSsd = catalog.find((part) => part.id === draft.selection.ssd[0]?.partId);

    expect(selectedSsd?.id).toBe(pcie4Ssd.id);
    expect(selectedSsd?.specs.m2PcieGeneration).toBeLessThanOrEqual(4);
    expect(draft.blockerCount).toBe(0);
    expect(draft.unknownCount).toBe(0);
  });

  it("excludes non-retail listings by default and only includes them when requested", () => {
    const baseCpu = seedCatalog.find((part) => part.id === "cpu-7800x3d")!;
    const restrictedCpu = {
      ...baseCpu,
      id: "cpu-7800x3d-used",
      name: `${baseCpu.name} 중고`,
      priceWon: 1
    };
    const catalog = [...seedCatalog, restrictedCpu];
    const defaultDraft = generateBuildDraft(catalog, { profile: "office", budgetWon: 1_500_000, includeGpu: false });
    const allowedDraft = generateBuildDraft(catalog, { profile: "office", budgetWon: 1_500_000, includeGpu: false, includeNonRetail: true });

    expect(defaultDraft.lines.find((line) => line.category === "cpu")?.partId).not.toBe(restrictedCpu.id);
    expect(allowedDraft.lines.find((line) => line.category === "cpu")?.partId).toBe(restrictedCpu.id);
  });

  it("does not claim a complete total when a selected part has no price", () => {
    const catalog = seedCatalog.map((part) => part.id === "gpu-rtx-4060"
      ? { ...part, priceWon: undefined }
      : part);
    const result = evaluateBuild(compatibleBuild(), catalog, { includeSuggestions: false });

    expect(result.totalPriceWon).toBeGreaterThan(0);
    expect(result.priceComplete).toBe(false);
  });

  it("treats a zero price as unknown instead of a complete price", () => {
    const catalog = seedCatalog.map((part) => part.id === "gpu-rtx-4060"
      ? { ...part, priceWon: 0 }
      : part);
    const result = evaluateBuild(compatibleBuild(), catalog, { includeSuggestions: false });

    expect(result.priceComplete).toBe(false);
  });

  it("does not silently pass missing or incomplete power data", () => {
    const build = compatibleBuild();
    build.gpu = { partId: "gpu-rtx-5090", quantity: 1 };
    build.psu = { partId: "psu-unknown-850w", quantity: 1 };
    const result = evaluateBuild(build, seedCatalog, { includeSuggestions: false });

    expect(result.status).toBe("incompatible");
    expect(result.warningCount).toBeGreaterThanOrEqual(1);
    expect(result.findings.some((finding) => finding.ruleId === "psu-data-quality")).toBe(true);
    expect(result.links.find((link) => link.id === "gpu-psu")?.status).toBe("issue");
  });

  it("checks motherboard SATA capacity even when the build has HDDs but no SSD", () => {
    const build = compatibleBuild();
    build.ssd = [];
    build.hdd = [{ partId: "hdd-seagate-4tb", quantity: 5 }];
    const result = evaluateBuild(build, seedCatalog, { includeSuggestions: false });

    expect(result.findings.some((finding) => finding.ruleId === "sata-ports")).toBe(true);
    expect(result.links.find((link) => link.id === "motherboard-hdd")?.status).toBe("issue");
  });

  it("blocks a non-SATA HDD and keeps an unknown HDD interface as review", () => {
    const baseHdd = seedCatalog.find((part) => part.id === "hdd-seagate-4tb")!;
    const sasHdd: Part = {
      ...baseHdd,
      id: "hdd-sas-direct-connection",
      name: "테스트 SAS HDD",
      specs: { ...baseHdd.specs, interface: "SAS", capacityGb: 18000 }
    };
    const unknownHdd: Part = {
      ...baseHdd,
      id: "hdd-interface-unknown",
      name: "테스트 인터페이스 미확인 HDD",
      specs: { ...baseHdd.specs, interface: undefined, capacityGb: 18000 }
    };
    const sasBuild = compatibleBuild();
    sasBuild.hdd = [{ partId: sasHdd.id, quantity: 1 }];
    const unknownBuild = compatibleBuild();
    unknownBuild.hdd = [{ partId: unknownHdd.id, quantity: 1 }];
    const catalog = [...seedCatalog, sasHdd, unknownHdd];
    const sasResult = evaluateBuild(sasBuild, catalog, { includeSuggestions: false });
    const unknownResult = evaluateBuild(unknownBuild, catalog, { includeSuggestions: false });

    expect(sasResult.findings.some((finding) => finding.ruleId === "hdd-interface" && finding.severity === "blocker")).toBe(true);
    expect(sasResult.links.find((link) => link.id === "motherboard-hdd")?.status).toBe("issue");
    expect(unknownResult.findings.some((finding) => finding.ruleId === "hdd-interface" && finding.severity === "unknown")).toBe(true);
    expect(unknownResult.status).toBe("needs_review");
  });

  it("does not recommend a SAS HDD as a compatible SATA upgrade", () => {
    const baseHdd = seedCatalog.find((part) => part.id === "hdd-seagate-4tb")!;
    const sasHdd: Part = {
      ...baseHdd,
      id: "hdd-sas-upgrade-candidate",
      name: "테스트 SAS 업그레이드 후보",
      priceWon: 500000,
      specs: { ...baseHdd.specs, interface: "SAS", capacityGb: 18000 }
    };
    const result = evaluateBuild(compatibleBuild(), [...seedCatalog, sasHdd], {
      recommendationPreferences: { priority: "performance", profile: "general" }
    });

    expect(result.upgradeRecommendations?.some((item) => item.part.id === sasHdd.id)).toBe(false);
  });

  it("requires a display path when a CPU has no integrated graphics", () => {
    const build = compatibleBuild();
    build.cpu = { partId: "cpu-7500f", quantity: 1 };
    build.gpu = undefined;
    build.useIntegratedGraphics = true;
    const result = evaluateBuild(build, seedCatalog, { includeSuggestions: false });

    expect(result.findings.some((finding) => finding.ruleId === "display-output")).toBe(true);
    expect(result.blockerCount).toBeGreaterThan(0);
  });

  it("does not pass an iGPU-only build when the CPU graphics field is unknown", () => {
    const catalog = seedCatalog.map((part) => part.id === "cpu-7800x3d"
      ? { ...part, specs: { ...part.specs, integratedGraphics: undefined } }
      : part);
    const build = compatibleBuild();
    build.gpu = undefined;
    build.useIntegratedGraphics = true;
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });

    expect(result.findings.some((finding) => finding.ruleId === "display-output" && finding.severity === "unknown")).toBe(true);
    expect(result.status).toBe("needs_review");
  });

  it("accepts a boxed CPU cooler when the CPU explicitly includes one", () => {
    const catalog = seedCatalog.map((part) => part.id === "cpu-7800x3d"
      ? { ...part, specs: { ...part.specs, coolerIncluded: true } }
      : part);
    const build = compatibleBuild();
    build.cooler = undefined;
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });

    expect(result.findings.some((finding) => finding.ruleId === "required-cooler")).toBe(false);
  });

  it("requires case radiator facts for a liquid cooler instead of silently passing", () => {
    const liquidCooler = {
      ...seedCatalog.find((part) => part.id === "cooler-tower-am5-1700")!,
      id: "cooler-liquid-360",
      name: "Liquid 360",
      specs: {
        supportedSockets: ["AM5"],
        coolerType: "liquid" as const,
        radiatorSizeMm: 360,
        maxCoolingW: 300
      }
    };
    const catalog = [...seedCatalog, liquidCooler];
    const build = compatibleBuild();
    build.cooler = { partId: liquidCooler.id, quantity: 1 };
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });

    expect(result.findings.some((finding) => finding.ruleId === "case-radiator-support")).toBe(true);
    expect(result.unknownCount).toBeGreaterThan(0);
  });

  it("accepts a liquid cooler when its radiator position and size match the case", () => {
    const { build, catalog } = positionedRadiatorFixture("top", "top");
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });

    expect(result.findings.some((finding) => finding.ruleId === "case-radiator-support")).toBe(false);
  });

  it("blocks a liquid cooler when its size fits only another case position", () => {
    const { build, catalog } = positionedRadiatorFixture("front", "top");
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "case-radiator-support");

    expect(finding?.severity).toBe("blocker");
    expect(finding?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "쿨러 라디에이터", actual: "전면 · 240mm" }),
      expect.objectContaining({ label: "케이스 해당 위치 지원", expected: "해당 위치 지원 정보 없음" })
    ]));
  });

  it("keeps position-specific radiator support as unknown when the cooler position is missing", () => {
    const { build, catalog } = positionedRadiatorFixture(undefined, "top");
    const result = evaluateBuild(build, catalog, { includeSuggestions: false });
    const finding = result.findings.find((item) => item.ruleId === "case-radiator-support");

    expect(finding?.severity).toBe("unknown");
    expect(finding?.title).toContain("장착 위치");
  });
});
