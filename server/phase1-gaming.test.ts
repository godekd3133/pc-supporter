import { describe, expect, it } from "vitest";
import type { BuildGenerationRequest, Part, PartCategory } from "../shared/types";
import { phase1CpuGamingClass, phase1GamingPartAllowed, phase1GpuGamingClass } from "../shared/phase1-gaming-policy";
import { generateBuildDraft, minimumFeasibleBuildPriceFor } from "./engine";
import { seedCatalog } from "./seed-catalog";
import { applyPhase1CatalogSnapshot } from "./phase1-catalog";
import { generatorPartAdjustmentRequestFor } from "../src/generator-balance";

const phase1 = { gamingTestbedPhase1: true };
const reference = (category: PartCategory) => seedCatalog.find((part) => part.category === category)!;
function fixture(category: PartCategory, id: string, name: string, priceWon: number, specs: Part["specs"] = {}, brand?: string): Part {
  const base = reference(category);
  return { ...base, id, name, model: name, brand: brand ?? base.brand, priceWon, source: "danawa", sourceProductCode: id,
    listingType: "retail", dataQuality: "live", missingFields: [], danawaUrl: `https://prod.danawa.com/info/?pcode=${id}`,
    specs: { ...base.specs, ...specs } };
}

function testbed(): Part[] {
  const cpuSpecs = { cores: 6, threads: 12, tdpW: 65, pptW: 88, coolerIncluded: true, integratedGraphics: false, socket: "AM4", memoryType: "DDR4", maxMemorySpeedMhz: 3200 } as const;
  const boardSpecs = { socket: "AM4", memoryType: "DDR4", memoryFormFactor: "DIMM", maxMemorySpeedMhz: 3200, vrmCapacityW: 88, memorySlots: 2, formFactor: "mATX" } as const;
  const gpuSpecs = { gpuVendor: "nvidia", pciePowerOptions: [], powerW: 100, recommendedPsuW: 500, vramGb: 8, lengthMm: 200, thicknessMm: 40 } satisfies Part["specs"];
  return [
    fixture("cpu", "cpu-5500gt", "AMD 라이젠5 5500GT (정품)", 195_000, { ...cpuSpecs, integratedGraphics: true }),
    fixture("cpu", "cpu-5600", "AMD 라이젠5 5600 (정품)", 158_000, cpuSpecs),
    fixture("cpu", "cpu-5700x", "AMD 라이젠7 5700X (정품)", 230_000, { ...cpuSpecs, cores: 8, threads: 16, coolerIncluded: false }),
    fixture("cpu", "cpu-7500f", "AMD 라이젠5 7500F (정품)", 170_000, { ...cpuSpecs, socket: "AM5", memoryType: "DDR5", maxMemorySpeedMhz: 5200, coolerIncluded: false }),
    fixture("cpu", "cpu-7800x3d-test", "AMD 라이젠7 7800X3D (정품)", 390_000, { ...cpuSpecs, socket: "AM5", memoryType: "DDR5", maxMemorySpeedMhz: 5200, cores: 8, threads: 16, coolerIncluded: false, tdpW: 120, pptW: 162, l3CacheMb: 96 }),
    fixture("cpu", "cpu-9700x-test", "AMD 라이젠7 9700X (정품)", 390_000, { ...cpuSpecs, socket: "AM5", memoryType: "DDR5", maxMemorySpeedMhz: 5600, cores: 8, threads: 16, coolerIncluded: false }),
    fixture("motherboard", "board-a520", "ASRock A520M-HVS 대원씨티에스", 55_000, boardSpecs),
    fixture("motherboard", "board-b550", "ASUS TUF Gaming B550M-PLUS STCOM", 157_000, { ...boardSpecs, vrmCapacityW: 300, memorySlots: 4 }),
    fixture("motherboard", "board-b850", "GIGABYTE B850M GAMING X WIFI6E 제이씨현", 188_000, { ...boardSpecs, socket: "AM5", memoryType: "DDR5", maxMemorySpeedMhz: 8000, vrmCapacityW: 600, memorySlots: 4 }),
    fixture("motherboard", "board-x870", "MSI MAG X870E 토마호크 WIFI", 439_000, { ...boardSpecs, socket: "AM5", memoryType: "DDR5", maxMemorySpeedMhz: 8000, vrmCapacityW: 1100, memorySlots: 4 }),
    fixture("memory", "ram-ddr4-16", "ESSENCORE KLEVV DDR4-3200 CL22 파인인포 (16GB)", 179_000, { memoryType: "DDR4", capacityGb: 16, speedMhz: 3200, memoryCasLatency: 22, memoryModuleCountPerKit: 1, memoryProfiles: [] }, "ESSENCORE"),
    fixture("memory", "ram-ddr4-8", "ESSENCORE KLEVV DDR4-3200 CL22 파인인포 (8GB)", 110_000, { memoryType: "DDR4", capacityGb: 8, speedMhz: 3200, memoryModuleCountPerKit: 1, memoryProfiles: [] }, "ESSENCORE"),
    fixture("memory", "ram-ddr5-16", "ESSENCORE KLEVV DDR5-5600 CL46 파인인포 (16GB)", 334_000, { memoryType: "DDR5", capacityGb: 16, speedMhz: 5600, memoryCasLatency: 46, memoryModuleCountPerKit: 1, memoryProfiles: [] }, "ESSENCORE"),
    fixture("memory", "ram-premium", "PATRIOT DDR5-8000 CL38 VIPER Xtreme5 RGB 패키지 (32GB)", 832_000, { memoryType: "DDR5", capacityGb: 32, speedMhz: 8000, memoryModuleCountPerKit: 2 }, "PATRIOT"),
    fixture("cooler", "cooler-ag400", "DEEPCOOL AG400 G2", 25_000, { supportedSockets: ["AM4", "AM5"], maxCoolingW: 180, maxCoolerHeightMm: 150, coolerType: "air" }),
    fixture("cooler", "cooler-pa120", "Thermalright Peerless Assassin 120 SE 서린", 55_000, { supportedSockets: ["AM4", "AM5"], maxCoolingW: 230, maxCoolerHeightMm: 155, coolerType: "air" }),
    fixture("gpu", "gpu-3050-test", "MSI 지포스 RTX 3050 벤투스 2X E OC D6 6GB", 180_000, { ...gpuSpecs, vramGb: 6 }),
    fixture("gpu", "gpu-5050-test", "MSI 지포스 RTX 5050 8GB", 280_000, gpuSpecs),
    fixture("gpu", "gpu-5060-test", "MSI 지포스 RTX 5060 8GB", 380_000, gpuSpecs),
    fixture("gpu", "gpu-5060ti-test", "MSI 지포스 RTX 5060 Ti 16GB", 550_000, { ...gpuSpecs, powerW: 180, recommendedPsuW: 600, vramGb: 16 }),
    fixture("gpu", "gpu-5070-test", "MSI 지포스 RTX 5070 12GB", 750_000, { ...gpuSpecs, powerW: 250, recommendedPsuW: 650, vramGb: 12 }),
    fixture("gpu", "gpu-5080-test", "MSI 지포스 RTX 5080 16GB", 1_800_000, { ...gpuSpecs, powerW: 360, recommendedPsuW: 850, vramGb: 16, lengthMm: 330 }),
    fixture("gpu", "gpu-5090-test", "MSI 지포스 RTX 5090 32GB", 5_000_000, { ...gpuSpecs, powerW: 575, recommendedPsuW: 1000, vramGb: 32, lengthMm: 350 }),
    fixture("ssd", "ssd-test", "삼성전자 NVMe 1TB", 259_000),
    fixture("case", "case-value", "기본 메쉬 케이스", 40_000, { maxGpuLengthMm: 300, maxCoolerHeightMm: 160, fanCount: 4 }),
    fixture("case", "case-large", "대형 메쉬 케이스", 65_000, { maxGpuLengthMm: 400, maxCoolerHeightMm: 170, fanCount: 4 }),
    fixture("case", "case-premium", "고가 대형 케이스", 300_000, { maxGpuLengthMm: 500, maxCoolerHeightMm: 200, fanCount: 8 }),
    ...[500, 600, 650, 850, 1000].map((wattage, index) => fixture("psu", `psu-${wattage}-test`, `마이크로닉스 ${wattage}W`, 50_000 + index * 15_000, { wattageW: wattage, pciePowerConnectors: { pcie_8pin_6plus2: 2 } }, "마이크로닉스"))
  ];
}

const request = (budgetWon: number): BuildGenerationRequest => ({ profile: "gaming", budgetWon, includeGpu: true, memoryCapacityGb: 16, storageCapacityGb: 1000 });

function sourceBackedAdjustmentCatalog(): Part[] {
  // Checked-in public product captures keep clean checkouts independent of
  // private runtime catalog files, with actual IDs, prices and dimensions.
  return applyPhase1CatalogSnapshot([]);
}

describe("phase-one gaming budget test bed", () => {
  it("builds the 800,000 won entry with a packaged 5500GT and no paid cooler when the discrete minimum does not fit", () => {
    const draft = generateBuildDraft(testbed(), request(800_000), [], phase1);
    expect(draft.selection.cpu?.partId).toBe("cpu-5500gt");
    expect(draft.selection.useIntegratedGraphics).toBe(true);
    expect(draft.selection.gpu).toBeUndefined();
    expect(draft.selection.cooler).toBeUndefined();
    expect(draft.selection.memory).toEqual([{ partId: "ram-ddr4-16", quantity: 1 }]);
    expect(draft.totalPriceWon).toBe(778_000);
    expect(draft.blockerCount).toBe(0);
    expect(draft.partTiers?.cpu?.upId).toBe("cpu-5600");
    expect(draft.partTiers?.gpu?.upId).toBe("gpu-3050-test");
    expect(draft.partTiers?.cooler?.upId).toBe("cooler-ag400");
    expect(minimumFeasibleBuildPriceFor(testbed(), { ...request(800_000), includeGpu: false }, phase1)).toBe(778_000);
  });

  it("upgrades GPUs monotonically from 1m to 10m and retains required-capacity RAM, economical cases and adequate PSUs", () => {
    const budgets = [1_000_000, 1_200_000, 1_400_000, 1_600_000, 1_800_000, 2_200_000, 3_000_000, 4_000_000, 6_000_000, 10_000_000];
    const catalog = testbed();
    const drafts = budgets.map((budget) => generateBuildDraft(catalog, request(budget), [], phase1));
    const classes = drafts.map((draft) => phase1GpuGamingClass(catalog.find((part) => part.id === draft.selection.gpu?.partId)));
    expect(classes).toEqual([...classes].sort((a, b) => a - b));
    expect(drafts[0].selection.gpu?.partId).toBe("gpu-3050-test");
    expect(drafts[3].selection.gpu?.partId).toBe("gpu-5070-test");
    expect(drafts.at(-1)?.selection.gpu?.partId).toBe("gpu-5090-test");
    for (const draft of drafts) {
      expect(draft.totalPriceWon).toBeLessThanOrEqual(draft.budgetWon);
      expect(draft.blockerCount).toBe(0);
      expect(draft.selection.case?.partId).not.toBe("case-premium");
      expect(draft.selection.memory).toHaveLength(1);
      const ram = catalog.find((part) => part.id === draft.selection.memory[0].partId)!;
      expect(ram.specs.capacityGb! * draft.selection.memory[0].quantity).toBe(16);
      const gpu = catalog.find((part) => part.id === draft.selection.gpu?.partId)!;
      const psu = catalog.find((part) => part.id === draft.selection.psu?.partId)!;
      expect(psu.specs.wattageW).toBe(gpu.specs.recommendedPsuW);
    }
  });

  it("uses the GPU budget beyond the old seventy-percent cap before upgrading CPU or decorative components", () => {
    const draft = generateBuildDraft(testbed(), request(6_000_000), [], phase1);
    expect(draft.selection.gpu?.partId).toBe("gpu-5090-test");
    expect(draft.withinBudget).toBe(true);
  });

  it("moves a 5600 CPU to the next general AM5 gaming class and rebuilds RAM, motherboard and cooling together", () => {
    const catalog = testbed();
    const baseline = generateBuildDraft(catalog, request(1_200_000), [], phase1);
    expect(baseline.selection.cpu?.partId).toBe("cpu-5600");
    expect(baseline.partTiers?.cpu?.upId).toBe("cpu-7500f");
    const adjusted = generateBuildDraft(catalog, { ...request(1_200_000), pinnedParts: { cpu: baseline.partTiers!.cpu!.upId! } }, [], phase1);
    expect(adjusted.selection.cpu?.partId).toBe("cpu-7500f");
    expect(adjusted.selection.motherboard?.partId).toBe("board-b850");
    expect(adjusted.selection.memory[0].partId).toBe("ram-ddr5-16");
    expect(adjusted.selection.cooler?.partId).toBe("cooler-ag400");
    expect(adjusted.blockerCount).toBe(0);
  });

  it("keeps the promised 5600 → 7500F CPU + step when the actual catalog also contains a cheaper 7400F", () => {
    const catalog = sourceBackedAdjustmentCatalog();
    const baseline = generateBuildDraft(catalog, { ...request(1_000_000), gamingTestbedPhase1: true, pinnedParts: { case: "danawa-case-96308750" } });
    expect(baseline.selection.cpu?.partId).toBe("danawa-cpu-16741211");
    expect(baseline.selection.gpu?.partId).toBe("danawa-gpu-78306452");
    expect(baseline.partTiers?.cpu?.upId).toBe("danawa-cpu-21694499");
    const next = generatorPartAdjustmentRequestFor(baseline, "cpu", "up")!;
    expect(next.pinnedParts?.cpu).toBe("danawa-cpu-21694499");
    expect(next.pinnedParts?.case).toBeUndefined();
    const adjusted = generateBuildDraft(catalog, next);
    expect(adjusted.selection.cpu?.partId).toBe("danawa-cpu-21694499");
    expect(adjusted.selection.motherboard?.partId).toBe("danawa-motherboard-122697197");
    expect(adjusted.selection.memory[0].partId).toBe("danawa-memory-18965774");
    expect(adjusted.selection.case?.partId).not.toBe("danawa-case-96308750");
    expect(adjusted.selection.gpu?.partId).toBe("danawa-gpu-78306452");
    expect(adjusted.blockerCount).toBe(0);
  });

  it("does not label a more expensive DDR5 platform switch as a RAM downgrade from the minimum DDR4 configuration", () => {
    const catalog = sourceBackedAdjustmentCatalog();
    const baseline = generateBuildDraft(catalog, { ...request(1_000_000), gamingTestbedPhase1: true });
    expect(baseline.selection.memory[0].partId).toBe("danawa-memory-11787091");
    expect(baseline.partTiers?.memory?.downId).toBeUndefined();
    expect(generatorPartAdjustmentRequestFor(baseline, "memory", "down")).toBeUndefined();
  });

  it("rebuilds an actual C10M/RX580 DDR4 quote through the UI's memory + helper and the engine's AM5 compatibility path", () => {
    const catalog = sourceBackedAdjustmentCatalog();
    const baseline = generateBuildDraft(catalog, { ...request(1_000_000), gamingTestbedPhase1: true, pinnedParts: { case: "danawa-case-96308750" } });
    expect(baseline.selection.case?.partId).toBe("danawa-case-96308750");
    expect(baseline.selection.memory[0].partId).toBe("danawa-memory-11787091");
    const next = generatorPartAdjustmentRequestFor(baseline, "memory", "up")!;
    expect(next.includeGpu).toBe(true);
    const targetMemoryId = next.pinnedParts?.memory;
    expect(targetMemoryId).toBeDefined();
    const targetMemory = catalog.find((part) => part.id === targetMemoryId)!;
    expect(targetMemory.category).toBe("memory");
    expect(targetMemory.specs.memoryType).toBe("DDR5");
    for (const category of ["cpu", "motherboard", "cooler", "case", "psu"] as const) expect(next.pinnedParts?.[category]).toBeUndefined();
    const adjusted = generateBuildDraft(catalog, next);
    expect(catalog.find((part) => part.id === adjusted.selection.cpu?.partId)?.specs.socket).toBe("AM5");
    expect(adjusted.selection.motherboard?.partId).toBe("danawa-motherboard-122697197");
    expect(adjusted.selection.memory[0].partId).toBe(targetMemoryId);
    expect(adjusted.selection.gpu?.partId).toBe("danawa-gpu-78306452");
    expect(adjusted.selection.case?.partId).not.toBe("danawa-case-96308750");
    expect(adjusted.blockerCount).toBe(0);
  });

  it("rebuilds the PSU and case to fit a pinned longer and higher-powered GPU", () => {
    const adjusted = generateBuildDraft(testbed(), { ...request(1_200_000), pinnedParts: { gpu: "gpu-5080-test" } }, [], phase1);
    expect(adjusted.selection.gpu?.partId).toBe("gpu-5080-test");
    expect(adjusted.selection.case?.partId).toBe("case-large");
    expect(adjusted.selection.psu?.partId).toBe("psu-850-test");
    expect(adjusted.blockerCount).toBe(0);
  });

  it("adds the necessary discrete display path when upgrading an integrated-only build to a CPU without integrated graphics", () => {
    const adjusted = generateBuildDraft(testbed(), { ...request(800_000), gamingTestbedPhase1: true, includeGpu: false, pinnedParts: { cpu: "cpu-5600" } });
    expect(adjusted.gamingTestbedPhase1).toBe(true);
    expect(adjusted.selection.cpu?.partId).toBe("cpu-5600");
    expect(adjusted.selection.gpu?.partId).toBe("gpu-3050-test");
    expect(adjusted.selection.useIntegratedGraphics).toBe(false);
    expect(adjusted.blockerCount).toBe(0);
  });

  it("rejects conflicting explicit CPU and motherboard pins instead of returning an incompatible adjustment", () => {
    expect(() => generateBuildDraft(testbed(), { ...request(1_400_000), pinnedParts: { cpu: "cpu-7500f", motherboard: "board-a520" } }, [], phase1)).toThrow("선택한 부품");
    const hotAm4 = fixture("cpu", "cpu-5950x-test", "AMD 라이젠9 5950X (정품)", 390_000, { socket: "AM4", memoryType: "DDR4", tdpW: 105, pptW: 142, coolerIncluded: false });
    const hotAm5 = fixture("cpu", "cpu-9950x-test", "AMD 라이젠9 9950X (정품)", 650_000, { socket: "AM5", memoryType: "DDR5", tdpW: 170, pptW: 230, coolerIncluded: false });
    expect(() => generateBuildDraft([...testbed(), hotAm4], { ...request(1_400_000), pinnedParts: { cpu: hotAm4.id, motherboard: "board-a520" } }, [], phase1)).toThrow("선택한 부품");
    expect(() => generateBuildDraft([...testbed(), hotAm5], { ...request(2_500_000), pinnedParts: { cpu: hotAm5.id, cooler: "cooler-ag400" } }, [], phase1)).toThrow("선택한 부품");
  });

  it("uses and preserves a physically complete sourced case with unknown HDD bays when no HDD was requested", () => {
    const catalog = testbed().map((part) => part.id === "case-value" ? { ...part, dataQuality: "incomplete" as const, missingFields: ["hddBays"], specs: { ...part.specs, hddBays: undefined } } : part);
    const first = generateBuildDraft(catalog, request(800_000), [], phase1);
    expect(first.selection.case?.partId).toBe("case-value");
    const adjusted = generateBuildDraft(catalog, { ...request(800_000), includeGpu: false, pinnedParts: { cpu: "cpu-5600", case: "case-value" } }, [], phase1);
    expect(adjusted.selection.case?.partId).toBe("case-value");
    expect(adjusted.blockerCount).toBe(0);
    expect(catalog.find((part) => part.id === "case-value")?.dataQuality).toBe("incomplete");
  });

  it("offers the exact 360mm liquid cooler without fabricating air-cooler height or a fixed mounting position", () => {
    const liquid = fixture("cooler", "cooler-nautilus", "CORSAIR NAUTILUS 360 RS", 124_330, { supportedSockets: ["AM4", "AM5"], coolerType: "liquid", radiatorSizeMm: 360, radiatorPosition: undefined, maxCoolerHeightMm: undefined, maxCoolingW: undefined });
    const radiatorCase = fixture("case", "case-radiator", "360mm 지원 케이스", 80_000, { maxGpuLengthMm: 400, maxCoolerHeightMm: 170, radiatorSizesMm: [360], radiatorSupports: [{ position: "top", sizesMm: [360] }] });
    const draft = generateBuildDraft([...testbed(), liquid, radiatorCase], { ...request(2_000_000), pinnedParts: { cooler: liquid.id } }, [], phase1);
    expect(draft.selection.cooler?.partId).toBe(liquid.id);
    expect(draft.selection.case?.partId).toBe(radiatorCase.id);
    expect(draft.blockerCount).toBe(0);
    expect(liquid.specs.maxCoolingW).toBeUndefined();
  });

  it("uses the exact RX580's connector planning allowance without inventing a measured GPU power value", () => {
    const legacyGpu = fixture("gpu", "gpu-rx580-test", "AFOX 라데온 RX 580 2048SP D5 8GB 디앤디컴", 185_990, { gpuVendor: "amd", powerW: undefined, recommendedPsuW: 400, lengthMm: 212, thicknessMm: 41.5, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 1 }]] }, "AFOX");
    legacyGpu.dataQuality = "incomplete";
    legacyGpu.missingFields = ["powerW"];
    const draft = generateBuildDraft([...testbed().filter((part) => part.category !== "gpu"), legacyGpu], request(1_000_000), [], phase1);
    expect(draft.selection.gpu?.partId).toBe(legacyGpu.id);
    expect(draft.selection.psu?.partId).toBe("psu-500-test");
    expect(draft.blockerCount).toBe(0);
    expect(draft.status).toBe("needs_review");
    expect(legacyGpu.specs.powerW).toBeUndefined();
  });

  it("rejects overseas prices, non-whitelisted lookalikes and a missing cooler package even when all listings is requested", () => {
    const catalog = testbed();
    const overseas = { ...catalog.find((part) => part.id === "cpu-7800x3d-test")!, id: "overseas", priceWon: 10_000, name: "AMD 라이젠7 7800X3D 해외직구", listingType: "overseas" as const };
    const unboxed = { ...catalog.find((part) => part.id === "cpu-5600")!, id: "unboxed", priceWon: 120_000, specs: { ...catalog.find((part) => part.id === "cpu-5600")!.specs, coolerIncluded: false } };
    catalog.push(overseas, unboxed, fixture("gpu", "old-4080", "MSI 지포스 RTX 4080 16GB", 10_000));
    const draft = generateBuildDraft(catalog, { ...request(1_400_000), listingPolicy: "all" }, [], phase1);
    expect(draft.lines.some((line) => line.partId === overseas.id || line.partId === "old-4080")).toBe(false);
    const forced = generateBuildDraft(catalog, { ...request(1_000_000), pinnedParts: { cpu: unboxed.id } }, [], phase1);
    expect(forced.selection.cooler?.partId).toBe("cooler-ag400");
    expect(() => generateBuildDraft(catalog, { ...request(1_400_000), pinnedParts: { cpu: overseas.id } }, [], phase1)).toThrow("현재 게임 견적에 사용할 수 없습니다");
    expect(phase1GamingPartAllowed(fixture("motherboard", "lookalike", "ASRock A520M-HDV 대원씨티에스", 1))).toBe(false);
    expect(phase1GamingPartAllowed(fixture("memory", "lookalike-ram", "ESSENCORE KLEVV DDR5-6000 CL30 파인인포 (16GB)", 1))).toBe(false);
  });

  it("keeps game FPS, refresh-rate and memory-speed upgrades from overriding the first budget-only test bed", () => {
    const catalog = testbed();
    const plain = generateBuildDraft(catalog, request(1_200_000), [], phase1);
    const withSecondPhaseGoals = generateBuildDraft(catalog, { ...request(1_200_000), gamingGameIds: ["cyberpunk"], gamingResolution: "4k", gamingRefreshRate: 240, gamingRayTracing: true, performanceTier: "top" }, [], phase1);
    expect(withSecondPhaseGoals.selection).toEqual(plain.selection);
    expect(phase1CpuGamingClass(catalog.find((part) => part.id === "cpu-7800x3d-test"))).toBeGreaterThan(phase1CpuGamingClass(catalog.find((part) => part.id === "cpu-9700x-test")));
  });
});
