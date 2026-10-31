import { describe, expect, it } from "vitest";
import type { BuildGenerationRequest, Part, PartCategory } from "../shared/types";
import { phase1CpuGamingClass, phase1GamingPartAllowed, phase1GpuGamingClass, phase1GamingFilters } from "../shared/phase1-gaming-policy";
import { generateBuildDraft, minimumFeasibleBuildPriceFor } from "./engine";
import { seedCatalog } from "./seed-catalog";
import { applyPhase1CatalogSnapshot } from "./phase1-catalog";
import { generatorManualPartRequestFor, generatorPartAdjustmentRequestFor } from "../src/generator-balance";

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
    fixture("cpu", "cpu-9600x-test", "AMD 라이젠5 9600X (정품)", 210_000, { ...cpuSpecs, socket: "AM5", memoryType: "DDR5", maxMemorySpeedMhz: 5600, coolerIncluded: false }),
    fixture("cpu", "cpu-9800x3d-test", "AMD 라이젠7 9800X3D (정품)", 600_000, { ...cpuSpecs, socket: "AM5", memoryType: "DDR5", maxMemorySpeedMhz: 5600, cores: 8, threads: 16, coolerIncluded: false, tdpW: 120, pptW: 162, l3CacheMb: 96 }),
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
    fixture("ssd", "ssd-test", "ESSENCORE KLEVV CRAS C910G M.2 NVMe 1TB", 259_000, {}, "ESSENCORE"),
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
  const sourced = applyPhase1CatalogSnapshot([]);
  // Only this new SSD-policy test fixture is synthetic; existing CPU/board/case IDs remain the captured products.
  const cheapestSsd = sourced.filter((part) => part.category === "ssd" && (part.specs.capacityGb ?? 0) >= 1000 && part.priceWon).sort((a,b) => a.priceWon! - b.priceWon!)[0];
  return [...sourced, fixture("ssd", "fixture-c910g-1tb", "ESSENCORE KLEVV CRAS C910G M.2 NVMe 1TB", cheapestSsd?.priceWon ?? 259000, { capacityGb: 1000, formFactor: "M.2", interface: "NVMe", m2PcieGeneration: 3 }, "ESSENCORE")];
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
    expect(classes[3]).toBeGreaterThanOrEqual(classes[0]);
    for (const draft of drafts) expect(draft.cpuGpuBalance?.cpu.level).toBe("good");
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

  it("keeps the strongest balanced pair when the 5090 and a suitable CPU platform exceed the budget", () => {
    const draft = generateBuildDraft(testbed(), request(6_000_000), [], phase1);
    expect(draft.selection.gpu?.partId).toBe("gpu-5080-test");
    expect(draft.cpuGpuBalance?.cpu.level).toBe("good");
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

  it("rebuilds an actual C10M/RX580 DDR4 quote through manual DDR5 selection and the engine's AM5 compatibility path", () => {
    const catalog = sourceBackedAdjustmentCatalog();
    const baseline = generateBuildDraft(catalog, { ...request(1_000_000), gamingTestbedPhase1: true, pinnedParts: { case: "danawa-case-96308750" } });
    expect(baseline.selection.case?.partId).toBe("danawa-case-96308750");
    expect(baseline.selection.memory[0].partId).toBe("danawa-memory-11787091");
    const nextMemory = catalog.filter(part=>part.category==="memory" && part.specs.memoryType==="DDR5" && /KLEVV DDR5-5600 CL46/.test(part.name)).sort((a,b)=>(a.priceWon??Infinity)-(b.priceWon??Infinity))[0];
    expect(nextMemory).toBeDefined();
    const next = generatorManualPartRequestFor(baseline,"memory",nextMemory.id,{memoryTypePreference:"DDR5"});
    expect(next).toBeDefined();
    if (!next) throw new Error("검증용 DDR5 수동 변경 요청을 만들지 못했습니다.");
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

  it("preserves integrated graphics through the CPU adjustment request when the new CPU still has a display path", () => {
    const catalog = testbed();
    const baseline = generateBuildDraft(catalog, { ...request(800_000), gamingTestbedPhase1: true });
    expect(baseline.selection.cpu?.partId).toBe("cpu-5500gt");
    const previousCpu = catalog.find((part) => part.id === baseline.selection.cpu?.partId)!;
    const nextCpu = { ...previousCpu, id: "cpu-5600g-test", name: "AMD 라이젠5 5600G (정품)", model: "AMD 라이젠5 5600G (정품)", priceWon: 225_000 };
    const stepped = { ...baseline, partTiers: { ...baseline.partTiers, cpu: { ...baseline.partTiers?.cpu, upId: nextCpu.id } } };
    const next = generatorPartAdjustmentRequestFor(stepped, "cpu", "up")!;
    expect(next.includeGpu).toBe(false);
    const adjusted = generateBuildDraft([...catalog, nextCpu], next);
    expect(adjusted.selection.cpu?.partId).toBe(nextCpu.id);
    expect(adjusted.selection.gpu).toBeUndefined();
    expect(adjusted.selection.useIntegratedGraphics).toBe(true);
    expect(adjusted.selection.ssd).toEqual(baseline.selection.ssd);
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

  it("uses explicit resolution floors while leaving unspecified phase-one requests at FHD", () => {
    const catalog = testbed();
    const plain = generateBuildDraft(catalog, request(1_200_000), [], phase1);
    expect(plain.gamingResolution).toBe("1080p");
    expect(() => generateBuildDraft(catalog, { ...request(1_200_000), gamingGameIds: ["cyberpunk"], gamingResolution: "4k", gamingRefreshRate: 240, gamingRayTracing: true, performanceTier: "top" }, [], phase1)).toThrow(/예산|4K/);
    expect(phase1CpuGamingClass(catalog.find((part) => part.id === "cpu-7800x3d-test"))).toBeGreaterThan(phase1CpuGamingClass(catalog.find((part) => part.id === "cpu-9700x-test")));
  });
});

 describe("learned CPU balance and explicit platform requests", () => {
  it("keeps manually selected weak CPU + high GPU but reports red balance without inventing a physical blocker", () => {
    const draft = generateBuildDraft(testbed(), { ...request(10000000), pinnedParts: {cpu: "cpu-5600", gpu: "gpu-5090-test"} }, [], phase1);
    expect(draft.selection.cpu?.partId).toBe("cpu-5600");
    expect(draft.selection.gpu?.partId).toBe("gpu-5090-test");
    expect(draft.blockerCount).toBe(0);
    expect(draft.cpuGpuBalance?.cpu.level).toBe("too_weak");
    expect(draft.analysis?.cpuGpuBalance?.cpu.level).toBe("too_weak");
  });
  it("preserves each top CPU manual step even when its gaming score is lower", () => {
    const source = testbed();
    const base = source.find((part) => part.id === "cpu-7800x3d-test")!;
    const models = ["9800X3D", "9850X3D", "9900X3D", "9950X3D"];
    const catalog = [...source,...models.map((model, index) => ({...base,id:model,name:`AMD 라이젠9 ${model} (정품)`,priceWon:500000+index*100000}))];
    for (let index=0;index<models.length;index++) {
      const draft = generateBuildDraft(catalog,{...request(10000000),pinnedParts:{cpu:models[index],gpu:"gpu-3050-test"}},[],phase1);
      expect(draft.partTiers?.cpu?.upId).toBe(models[index+1]);
      expect(draft.partTiers?.cpu?.downId).toBe(index ? models[index-1] : "cpu-7800x3d-test");
      expect(draft.cpuGpuBalance?.cpu.level).toBe("too_strong");
    }
  });
  it("keeps CPU tier actions inside the explicitly requested DDR platform", () => {
    const catalog = testbed();
    const draft = generateBuildDraft(catalog,{...request(1200000),gamingMode:"budget",memoryTypePreference:"DDR4"},[],phase1);
    expect(draft.selection.cpu?.partId).toBe("cpu-5600");
    expect(draft.partTiers?.cpu?.upId).toBeUndefined();
    expect(generatorPartAdjustmentRequestFor(draft,"cpu","up")).toBeUndefined();

    const base = catalog.find((part) => part.id === "cpu-7500f")!;
    const intel = fixture("cpu","intel-14100-tier","인텔 코어i3-14세대 14100F",160000,{...base.specs,socket:"LGA1700",memoryType:"DDR4",tdpW:58,pptW:89,coolerIncluded:true,integratedGraphics:false},"Intel");
    const dual = {...intel,id:"intel-14600-tier",name:"인텔 코어i5-14세대 14600KF",priceWon:250000,specs:{...intel.specs,memoryType:"DDR5"}};
    const ddr5Only = {...dual,id:"intel-250-tier",name:"인텔 코어 울트라5 250KF",specs:{...dual.specs,socket:"LGA1851"}};
    const board = fixture("motherboard","intel-tier-board","MSI B760M DDR4",100000,{socket:"LGA1700",memoryType:"DDR4",vrmCapacityW:300,maxMemorySpeedMhz:3200,memorySlots:4,formFactor:"mATX"},"MSI");
    const intelDraft = generateBuildDraft([...catalog,intel,dual,ddr5Only,board],{...request(2200000),gamingMode:"budget",cpuVendorPreference:"intel",memoryTypePreference:"DDR4",pinnedParts:{cpu:intel.id}},[],phase1);
    expect(intelDraft.partTiers?.cpu?.upId).toBeUndefined();
    expect(intelDraft.partTiers?.cpu?.upUnavailableReason).toContain("13400F");
    expect(intelDraft.partTiers?.cpu?.upId).not.toBe(ddr5Only.id);
  });
  it("enforces DDR5 and AMD by rebuilding rather than silently ignoring the toggle", () => {
    const catalog = testbed();
    const draft = generateBuildDraft(catalog, {...request(2200000), cpuVendorPreference: "amd", memoryTypePreference: "DDR5"}, [], phase1);
    expect(catalog.find((part) => part.id === draft.selection.cpu?.partId)?.specs.socket).toBe("AM5");
    expect(catalog.find((part) => part.id === draft.selection.memory[0].partId)?.specs.memoryType).toBe("DDR5");
  });
  it("overrides only the AMD CPU/board allowlist when Intel is requested, and rebuilds DDR4/DDR5 on LGA1700", () => {
    const base = testbed();
    const intelCpu = fixture("cpu", "intel-14100f", "인텔 코어i3-14세대 14100F", 160000, {socket:"LGA1700", memoryType:"DDR4", cores:4,threads:8,tdpW:58,pptW:89,coolerIncluded:true,integratedGraphics:false}, "Intel");
    const intelBoards = ["DDR4", "DDR5"].map((memoryType) => fixture("motherboard", `intel-board-${memoryType}`, `MSI B760M ${memoryType}`, 100000, {socket:"LGA1700",memoryType,vrmCapacityW:300,maxMemorySpeedMhz:5600,memorySlots:4,formFactor:"mATX"}, "MSI"));
    const catalog = [...base, intelCpu, ...intelBoards];
    // Exact CPU facet observed in live-target-filters.json on 2026-10-06.
    const adminFilters = {schemaVersion:1 as const, enabled:true, categories:{cpu:{specValues:{cpuSeries:["Ryzen 5000","Ryzen 7000","Ryzen 9000"],memoryType:["DDR4","DDR5"]},namePatterns:["라이젠"],excludePartIds:["blocked-cpu"],priceWon:{max:400000}},motherboard:{namePatterns:["B850M GAMING X","MAG X870E 토마호크 WIFI","A520M-HVS","TUF Gaming B550M-PLUS"]}}};
    const original = JSON.stringify(adminFilters);
    const intelFilters = phase1GamingFilters(adminFilters, undefined, "intel");
    expect(intelFilters.categories.cpu?.specValues?.cpuSeries).toBeUndefined();
    expect(intelFilters.categories.cpu?.specValues?.memoryType).toEqual(["DDR4","DDR5"]);
    expect(intelFilters.categories.cpu?.excludePartIds).toEqual(["blocked-cpu"]);
    expect(intelFilters.categories.cpu?.priceWon).toEqual({max:400000});
    expect(JSON.stringify(adminFilters)).toBe(original);
    for (const memoryTypePreference of ["DDR4", "DDR5"] as const) {
      const draft = generateBuildDraft(catalog, {...request(2200000), cpuVendorPreference:"intel",memoryTypePreference}, [], {...phase1,targetFilters:adminFilters});
      expect(draft.selection.cpu?.partId).toBe("intel-14100f");
      expect(draft.selection.motherboard?.partId).toBe(`intel-board-${memoryTypePreference}`);
      expect(catalog.find((part) => part.id === draft.selection.memory[0].partId)?.specs.memoryType).toBe(memoryTypePreference);
    }
    const excluded = {...adminFilters,categories:{...adminFilters.categories,cpu:{...adminFilters.categories.cpu,excludePartIds:["intel-14100f"]}}};
    expect(() => generateBuildDraft(catalog,{...request(2200000),cpuVendorPreference:"intel"},[],{...phase1,targetFilters:excluded})).toThrow(/CPU/);
    const mixed = phase1GamingFilters({...adminFilters,categories:{...adminFilters.categories,cpu:{...adminFilters.categories.cpu,specValues:{cpuSeries:["Ryzen 9000","Core 14"]}}}},undefined,"intel");
    expect(mixed.categories.cpu?.specValues?.cpuSeries).toEqual(["Ryzen 9000","Core 14"]);
  });
  it("uses only reviewed live Intel DDR4/DDR5 boards when numeric VRM capacity is absent", () => {
    const base = testbed().map((part) => part.category === "cooler" ? {...part,specs:{...part.specs,supportedSockets:["AM4","AM5","LGA1700"]}} : part);
    const cpu = fixture("cpu","intel-reviewed-14400f","인텔 코어i5-14세대 14400F",230000,{socket:"LGA1700",memoryType:"DDR5",cores:10,tdpW:65,pptW:undefined,coolerIncluded:false,integratedGraphics:false},"Intel");
    const boards = [
      fixture("motherboard","danawa-motherboard-18651545","GIGABYTE B760M AORUS ELITE D4 피씨디렉트",197330,{socket:"LGA1700",memoryType:"DDR4",vrmCapacityW:undefined,maxMemorySpeedMhz:5333,memorySlots:4,formFactor:"mATX"},"GIGABYTE"),
      fixture("motherboard","danawa-motherboard-18649997","GIGABYTE B760M AORUS ELITE 제이씨현",190000,{socket:"LGA1700",memoryType:"DDR5",vrmCapacityW:undefined,maxMemorySpeedMhz:7600,memorySlots:4,formFactor:"mATX"},"GIGABYTE")
    ];
    for (const memoryTypePreference of ["DDR4","DDR5"] as const) {
      const draft = generateBuildDraft([...base,cpu,...boards],{...request(4000000),gamingMode:"budget",cpuVendorPreference:"intel",memoryTypePreference},[],phase1);
      expect(draft.selection.cpu?.partId).toBe(cpu.id);
      expect(draft.selection.motherboard?.partId).toBe(boards.find((part) => part.specs.memoryType === memoryTypePreference)!.id);
      expect(draft.blockerCount).toBe(0);
      expect(draft.warnings.some((warning) => warning.includes("마이크로코드"))).toBe(true);
      expect(boards.every((part) => part.specs.vrmCapacityW === undefined)).toBe(true);
    }
    const unreviewed = {...boards[0],id:"unreviewed-intel-board"};
    expect(() => generateBuildDraft([...base,cpu,unreviewed],{...request(4000000),gamingMode:"budget",cpuVendorPreference:"intel",memoryTypePreference:"DDR4"},[],phase1)).toThrow(/CPU/);
  });
  it("honors explicit Intel with an orange reviewed pair and excludes severely weak upper-GPU pairs", () => {
    const base = testbed().map((part) => part.category === "cooler" ? {...part,specs:{...part.specs,supportedSockets:["AM4","AM5","LGA1700"]}} : part);
    const cpu = fixture("cpu","intel-14600kf","인텔 코어i5-14세대 14600KF",240000,{socket:"LGA1700",memoryType:"DDR5",cores:14,threads:20,tdpW:125,pptW:181,coolerIncluded:false,integratedGraphics:false},"Intel");
    const board = fixture("motherboard","intel-b760","MSI B760M DDR5",120000,{socket:"LGA1700",memoryType:"DDR5",vrmCapacityW:350,maxMemorySpeedMhz:5600,memorySlots:4,formFactor:"mATX"},"MSI");
    const draft = generateBuildDraft([...base,cpu,board],{...request(10000000),cpuVendorPreference:"intel"},[],phase1);
    expect(draft.selection.gpu?.partId).toBe("gpu-5070-test");
    expect(draft.selection.cpu?.partId).toBe("intel-14600kf");
    expect(draft.cpuGpuBalance?.cpu.level).toBe("slightly_weak");
    expect(draft.cpuGpuBalance?.evidence).toBe("derived_policy");
  });
  it("lets the approved fixed SSD replace the old Samsung-only admin name and brand filters", () => {
    const draft = generateBuildDraft(testbed(), request(2200000), [], {...phase1,targetFilters:{schemaVersion:1,enabled:true,categories:{ssd:{brands:["Samsung"],namePatterns:["Samsung"]}}}});
    expect(draft.selection.ssd[0].partId).toBe("ssd-test");
  });
  it("uses only a genuine same-capacity Samsung or SK hynix M.2 fallback, otherwise reports missing SSD", () => {
    const catalog = testbed().map((part) => part.category === "ssd" ? {...part,name:"Kingston NVMe 1TB"} : part);
    expect(() => generateBuildDraft(catalog, request(2200000), [], phase1)).toThrow(/SSD/);
    expect(() => generateBuildDraft(testbed(), {...request(2200000),storageCapacityGb:2000}, [], phase1)).toThrow(/SSD/);
    const samsung = fixture("ssd","samsung-1tb","삼성전자 990 PRO M.2 NVMe 1TB",220000,{capacityGb:1000,formFactor:"M.2",interface:"NVMe"},"삼성전자");
    const hynix = {...samsung,id:"hynix-1tb",brand:"SK hynix",name:"SK hynix P31 M.2 NVMe 1TB",priceWon:190000};
    const fallback = generateBuildDraft([...catalog,samsung,hynix],request(2200000),[],phase1);
    expect(fallback.selection.ssd[0].partId).toBe("hynix-1tb");
    expect(() => generateBuildDraft(catalog,{...request(2200000),pinnedParts:{ssd:"ssd-test"}},[],phase1)).toThrow(/현재 게임 견적에 사용할 수 없습니다/);
  });
  it("keeps SSD capacity value ahead of storage speed even in a performance-priority gaming request", () => {
    const affordable = fixture("ssd", "samsung-value-2tb", "삼성전자 990 EVO Plus M.2 NVMe (2TB)", 300000, {capacityGb:2000,formFactor:"M.2",interface:"NVMe",m2PcieGeneration:5,sequentialReadMbps:7250,sequentialWriteMbps:6300}, "삼성전자");
    const faster = fixture("ssd", "samsung-premium-2tb", "삼성전자 990 PRO M.2 NVMe (2TB)", 500000, {capacityGb:2000,formFactor:"M.2",interface:"NVMe",m2PcieGeneration:4,sequentialReadMbps:7450,sequentialWriteMbps:6900}, "삼성전자");
    const catalog=[...testbed().map(part=>part.category==="motherboard"?{...part,specs:{...part.specs,m2PcieGenerations:[4]}}:part),affordable,faster];
    const next={...request(10000000),gamingMode:"budget" as const,priority:"performance" as const,storageCapacityGb:2000};
    const draft=generateBuildDraft(catalog,next,[],phase1);
    expect(draft.selection.ssd[0].partId).toBe(affordable.id);
    expect(draft.blockerCount).toBe(0);
    expect(draft.warnings.some(warning=>warning.includes("PCIe"))).toBe(true);
    expect(generateBuildDraft(catalog,{...next,pinnedParts:{ssd:faster.id}},[],phase1).selection.ssd[0].partId).toBe(faster.id);
  });
});
