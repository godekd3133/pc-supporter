import { describe,expect,it } from "vitest";
import type { BuildGenerationRequest,Part,PartCategory } from "../shared/types";
import { generateBuildDraft,minimumFeasibleBuildPriceFor,buildGenerationRecoveryOptionsFor,BuildGenerationError,evaluateBuild } from "../shared/domain/engine";
import { publicApiPayloadProjection } from "../shared/public-api-projection";
import { seedCatalog } from "./seed-catalog";
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


describe("October 12 reviewed gaming engine",()=>{
  it("selects a reviewed suitable CPU when a 3.3m budget can afford it",()=>{
    const draft=generateBuildDraft(testbed(),request(3300000),[],phase1);
    expect(draft.cpuGpuBalance?.cpu.level).toBe("good");
    expect(testbed().find(p=>p.id===draft.selection.cpu?.partId)?.name).toMatch(/X3D/);
    expect(["gpu-5070-test","gpu-5080-test"]).toContain(draft.selection.gpu?.partId);
    expect(draft.withinBudget).toBe(true);
  });
  it("retains game context in scoring, generation result and editor analysis",()=>{
    const catalog=testbed();
    const next={...request(2200000),gamingMode:"budget" as const,gamingGameIds:["pubg"]};
    const draft=generateBuildDraft(catalog,next,[],phase1);
    expect(catalog.find(p=>p.id===draft.selection.cpu?.partId)?.name).toMatch(/X3D/);
    expect(draft.cpuGpuBalance?.cpu.level).not.toBe("slightly_weak");
    expect(draft.analysis?.cpuGpuBalance?.contextRules).not.toContain("pubg-requires-x3d");
    const pinned=generateBuildDraft(catalog,{...next,pinnedParts:{cpu:"cpu-9600x-test",gpu:"gpu-5060-test"}},[],phase1);
    expect(pinned.cpuGpuBalance?.cpu.level).toBe("slightly_weak");
    expect(pinned.analysis?.cpuGpuBalance?.cpu.level).toBe("slightly_weak");
    const evaluation=evaluateBuild(pinned.selection,catalog,{includeAnalysis:true,recommendationPreferences:{profile:"gaming",priority:"balanced",gamingGameIds:["pubg"]}});
    expect(evaluation.analysis?.cpuGpuBalance?.contextRules).toContain("pubg-requires-x3d");
  });
  it("rejects QHD 8GB and 4K 5060Ti16GB even when the GPU is pinned",()=>{
    expect(()=>generateBuildDraft(testbed(),{...request(5000000),gamingResolution:"1440p",pinnedParts:{gpu:"gpu-5060-test"}},[],phase1)).toThrow(/해상도/);
    expect(()=>generateBuildDraft(testbed(),{...request(5000000),gamingResolution:"4k",pinnedParts:{gpu:"gpu-5060ti-test"}},[],phase1)).toThrow(/해상도/);
    expect(()=>generateBuildDraft(testbed(),{...request(5000000),gamingResolution:"4k",includeGpu:false},[],phase1)).toThrow(/외장/);
  });
  it("reports insufficient 4K budget and exposes three genuinely viable choices without dropping games",()=>{
    const next={...request(2000000),gamingMode:"budget" as const,gamingResolution:"4k" as const,gamingGameIds:["pubg"]};
    expect(minimumFeasibleBuildPriceFor(testbed(),next,phase1)).toBeGreaterThan(2000000);
    try {generateBuildDraft(testbed(),next,[],phase1);throw new Error("should reject");} catch(error) {
      expect(error).toBeInstanceOf(BuildGenerationError);
      expect((error as BuildGenerationError).diagnostics.map(d=>d.id)).toContain("resolution-budget");
    }
    const options=buildGenerationRecoveryOptionsFor(testbed(),next,phase1);
    expect(options.map(o=>o.id)).toEqual(["resolution-edit-budget","resolution-fit-budget","resolution-recommended"]);
    const projected=publicApiPayloadProjection({recoveryOptions:options}) as {recoveryOptions:Array<{id:string;summary?:string}>};
    expect(projected.recoveryOptions.filter(option=>typeof option.summary==="string").map(option=>option.id)).toEqual(["resolution-edit-budget","resolution-fit-budget","resolution-recommended"]);
    for(const option of options){expect(option.preview.withinBudget).toBe(true);expect(option.preview.priceComplete).toBe(true);expect(option.preview.blockerCount).toBe(0);expect(option.request.gamingGameIds).toEqual(["pubg"]);}
    expect(options[1].request.budgetWon).toBe(2000000);
    expect(options[1].request.gamingResolution).toBe("1080p");
    expect(options[0].request.gamingResolution).toBe("4k");
    expect(options[2].request.gamingResolution).toBe("4k");
  });
  it("defaults unqualified phase-one budgets to FHD and keeps the affordable 5500GT fallback",()=>{
    const draft=generateBuildDraft(testbed(),request(800000),[],phase1);
    expect(draft.gamingResolution).toBe("1080p");
    expect(draft.selection.cpu?.partId).toBe("cpu-5500gt");
    expect(draft.selection.gpu).toBeUndefined();
  });
  it("can select a whitelisted 500GB SSD and rejects targets smaller than 500GB",()=>{
    const part=fixture("ssd","samsung-500","삼성전자 980 PRO M.2 NVMe 500GB",90000,{capacityGb:500,formFactor:"M.2",interface:"NVMe",m2PcieGeneration:4},"삼성전자");
    const draft=generateBuildDraft([...testbed().filter(p=>p.category!=="ssd"),part],{...request(2000000),storageCapacityGb:500},[],phase1);
    expect(draft.selection.ssd[0].partId).toBe(part.id);
    expect(()=>generateBuildDraft([...testbed(),part],{...request(2000000),storageCapacityGb:250},[],phase1)).toThrow(/500GB/);
  });
});
