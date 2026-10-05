import { describe, expect, it } from "vitest";
import type { Part, PartCategory } from "./types";
import { gamingAdjustmentDependentCategories, gamingAppropriateMemoryCapacityGb, gamingCoolerTierFor, gamingPartSuitabilityFor, gamingPartTierAdjacencyFor, gamingPartTierFor, gamingSupportRequirementsFor, gamingTierAssessmentFor } from "./gaming-part-tiers";

function part(category: PartCategory, name: string, specs: Part["specs"] = {}, priceWon = 100_000): Part {
  return { id: `${category}-${name}`, category, name, model: name, source: "manual", specs, priceWon, listingType: "retail", dataQuality: "manual", missingFields: [], updatedAt: "2026-10-05T00:00:00.000Z" };
}
const cpu = (model: string, specs: Part["specs"] = {}) => part("cpu", `AMD Ryzen ${model}`, { socket: model.startsWith("5") ? "AM4" : "AM5", memoryType: model.startsWith("5") ? "DDR4" : "DDR5", tdpW: 65, pptW: 88, coolerIncluded: true, ...specs });
const a520 = () => part("motherboard", "ASRock A520M-HVS 대원씨티에스", { socket: "AM4", memoryType: "DDR4", memorySlots: 2, maxMemoryGb: 64, formFactor: "mATX" });
const b550 = () => part("motherboard", "ASUS TUF Gaming B550M-PLUS STCOM", { socket: "AM4", memoryType: "DDR4", memorySlots: 4, maxMemoryGb: 128, formFactor: "mATX" });
const b850 = () => part("motherboard", "GIGABYTE B850M GAMING X WIFI6E 제이씨현", { socket: "AM5", memoryType: "DDR5", memorySlots: 4, maxMemoryGb: 256, formFactor: "mATX" });
const x870 = () => part("motherboard", "MSI MAG X870E 토마호크 WIFI", { socket: "AM5", memoryType: "DDR5", memorySlots: 4, maxMemoryGb: 256, formFactor: "ATX" });
const gpu = (model: string, vramGb = 16, specs: Part["specs"] = {}) => part("gpu", `MSI ${model} ${vramGb}GB`, { vramGb, powerW: 180, recommendedPsuW: 600, lengthMm: 280, thicknessMm: 40, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 1 }]], ...specs });
const ag400 = () => part("cooler", "DEEPCOOL AG400 G2", { coolerType: "air", supportedSockets: ["AM4", "AM5"], maxCoolerHeightMm: 154.5 });
const pa120 = () => part("cooler", "Thermalright Peerless Assassin 120 SE 서린", { coolerType: "air", supportedSockets: ["AM4", "AM5"], maxCoolerHeightMm: 155 });
const water = () => part("cooler", "CORSAIR NAUTILUS 360 RS", { coolerType: "liquid", supportedSockets: ["AM4", "AM5"], radiatorSizeMm: 360 });
const ram = (capacityGb: number, memoryType = "DDR4", specs: Part["specs"] = {}) => part("memory", `KLEVV ${memoryType} ${capacityGb}GB`, { capacityGb, memoryType, memoryModuleCountPerKit: 1, speedMhz: memoryType === "DDR4" ? 3200 : 5600, ...specs }, capacityGb * 1000);
const psu = (wattageW: number, specs: Part["specs"] = {}) => part("psu", `${wattageW}W`, { wattageW, pciePowerConnectors: { pcie_8pin_6plus2: 2 }, psuDepthMm: 140, psuFormFactor: "ATX", ...specs });
const computerCase = (specs: Part["specs"] = {}) => part("case", "메쉬 케이스", { motherboardFormFactors: ["mATX", "ATX"], maxGpuLengthMm: 330, maxCoolerHeightMm: 160, maxPsuLengthMm: 180, supportedPsuFormFactors: ["ATX"], ...specs });
const storage = (category: "ssd" | "hdd", capacityGb: number, specs: Part["specs"] = {}, priceWon = capacityGb * 100) => part(category, `${category.toUpperCase()} ${capacityGb}GB`, { capacityGb, interface: category === "ssd" ? "NVMe" : "SATA", ...specs }, priceWon);

describe("gaming component role and capacity tiers", () => {
  it("keeps a Ryzen 7800X3D gaming role above a 9700X without treating R23 multi-core score as game FPS", () => {
    const cached = gamingPartTierFor(cpu("7800X3D", { tdpW: 120, pptW: 162, l3CacheMb: 96 }));
    const ordinary = gamingPartTierFor(cpu("9700X", { l3CacheMb: 32 }));
    expect(cached.order).toBeGreaterThan(ordinary.order!);
    expect(cached.evidence).toBe("project_policy");
    expect(cached.notes.join(" ")).toContain("FPS 실측값은 아닙니다");
  });

  it("does not make core count itself a gaming upgrade", () => {
    const base = cpu("5600");
    const moreCores = { ...base, id: "many-core", specs: { ...base.specs, cores: 16, threads: 32, cinebenchR23Multi: 50000 } };
    expect(gamingPartTierFor(base).order).toBe(gamingPartTierFor(moreCores).order);
  });

  it("classifies GPU variants by the exact QHD reference and VRAM", () => {
    const eight = gamingPartTierFor(gpu("RTX 5060 Ti", 8));
    const sixteen = gamingPartTierFor(gpu("RTX 5060 Ti", 16));
    expect(eight.order).toBe(97.4);
    expect(sixteen.order).toBe(100);
    expect(eight.key).not.toBe(sixteen.key);
    expect(sixteen.evidence).toBe("video_table");
  });

  it("uses newly verified Radeon 9000 rows and recommends RAM after retaining its upper GPU role", () => {
    const radeon = gamingPartTierFor(gpu("RX 9070 XT", 16));
    expect(radeon.order).toBe(161.3);
    expect(radeon.evidence).toBe("video_table");
    expect(gamingAppropriateMemoryCapacityGb(gpu("RX 9070 XT"))).toBe(32);
  });

  it("uses actual model identity instead of an outdated catalog ID", () => {
    const actual = { ...cpu("9800X3D"), id: "cpu-7800x3d" };
    expect(gamingPartTierFor(actual).key).toBe("cpu:9800X3D");
  });

  it("separates motherboard socket from tier and never fabricates VRM wattage", () => {
    expect(gamingPartTierFor(a520())).toMatchObject({ tier: 0, platform: "AM4" });
    expect(gamingPartTierFor(b550())).toMatchObject({ tier: 1, platform: "AM4" });
    expect(gamingPartTierFor(b850())).toMatchObject({ tier: 1, platform: "AM5" });
    expect(gamingPartTierFor(x870())).toMatchObject({ tier: 2, platform: "AM5" });
    expect(gamingPartTierFor(b850()).notes.join(" ")).toContain("출력(W)으로 바꾸지");
  });

  it("recognizes packaged stock, single tower, dual tower and the exact 360 model", () => {
    expect(gamingCoolerTierFor(undefined, cpu("5600"))).toBe(0);
    expect(gamingCoolerTierFor(undefined, cpu("7500F", { coolerIncluded: false }))).toBeUndefined();
    expect(gamingCoolerTierFor(ag400())).toBe(1);
    expect(gamingCoolerTierFor(pa120())).toBe(2);
    expect(gamingCoolerTierFor(water())).toBe(3);
    expect(gamingCoolerTierFor({ ...water(), name: "CORSAIR NAUTILUS 360 RS ARGB", model: "NAUTILUS 360 RS ARGB" })).toBeUndefined();
  });

  it("treats total RAM capacity as the role and does not rank DDR5-8000 marketing speed as ordinary stability", () => {
    expect(gamingPartTierFor(ram(8), { memoryQuantity: 2 })).toMatchObject({ tier: 1, order: 16, label: "16GB DDR4" });
    const extreme = gamingPartTierFor(ram(32, "DDR5", { speedMhz: 8000 }));
    expect(extreme.order).toBe(32);
    expect(extreme.notes.join(" ")).toContain("보장하지 않습니다");
  });

  it("labels parts by their CPU generation, GPU chip and actual capacity", () => {
    expect(gamingPartTierFor(cpu("9800X3D")).label).toBe("Ryzen 9000 · 3D V-Cache");
    expect(gamingPartTierFor(cpu("5600")).label).toBe("Ryzen 5000");
    expect(gamingPartTierFor(cpu("5500")).label).toBe("Ryzen 5000");
    expect(gamingPartTierFor(gpu("RTX 5060 Ti", 16)).label).toBe("RTX 5060 Ti · 16GB");
    expect(gamingPartTierFor(storage("ssd", 2000))).toMatchObject({ label: "2TB SSD", order: 2000, evidence: "catalog_spec" });
    expect(gamingPartTierFor(storage("hdd", 8000))).toMatchObject({ label: "8TB HDD", order: 8000, evidence: "catalog_spec" });
  });
});

describe("minimum requirements and appropriate spending", () => {
  it("keeps 16GB minimum and recommends 32GB only once an upper GPU is present", () => {
    expect(gamingAppropriateMemoryCapacityGb(undefined)).toBe(16);
    expect(gamingAppropriateMemoryCapacityGb(gpu("RTX 5060 Ti"))).toBe(16);
    expect(gamingAppropriateMemoryCapacityGb(gpu("RTX 5070", 12))).toBe(16);
    expect(gamingAppropriateMemoryCapacityGb(gpu("RTX 5070 Ti"))).toBe(32);
    expect(gamingAppropriateMemoryCapacityGb(gpu("RTX 5090", 32), 64)).toBe(64);
    const requirements = gamingSupportRequirementsFor({ cpu: cpu("7500F", { coolerIncluded: false }), gpu: gpu("RTX 5090", 32, { powerW: 575, recommendedPsuW: 1000 }), motherboard: b850() });
    expect(requirements.memory).toMatchObject({ minimumCapacityGb: 16, appropriateCapacityGb: 32, memoryType: "DDR5" });
  });

  it("selects source-reviewed minimum motherboard roles and rejects an AM4 platform for AM5", () => {
    expect(gamingSupportRequirementsFor({ cpu: cpu("5600") }).motherboard.minimumTier).toBe(0);
    expect(gamingSupportRequirementsFor({ cpu: cpu("5950X", { tdpW: 105 }) }).motherboard.minimumTier).toBe(1);
    expect(gamingSupportRequirementsFor({ cpu: cpu("7500F") }).motherboard.minimumTier).toBe(1);
    const highPower = cpu("9950X", { tdpW: 170, pptW: 230, coolerIncluded: false });
    expect(gamingSupportRequirementsFor({ cpu: highPower }).motherboard.minimumTier).toBe(2);
    expect(gamingPartSuitabilityFor(b850(), { cpu: highPower }).minimum).toBe("unmet");
    expect(gamingPartSuitabilityFor(x870(), { cpu: highPower }).minimum).toBe("met");
    expect(gamingPartSuitabilityFor(a520(), { cpu: cpu("7500F") }).minimum).toBe("unmet");
  });

  it("preserves unknown CPU TDP instead of declaring the board adequate from its tier", () => {
    const unknown = cpu("7500F", { tdpW: undefined, pptW: undefined });
    expect(gamingSupportRequirementsFor({ cpu: unknown }).motherboard.minimumTier).toBeUndefined();
    expect(gamingPartSuitabilityFor(b850(), { cpu: unknown })).toMatchObject({ minimum: "unknown", appropriate: "unknown" });
  });

  it("uses dual-tower minimum for 170W CPU and flags an unnecessary 3-row AIO as extra spending", () => {
    const highPower = cpu("9950X", { tdpW: 170, pptW: 230, coolerIncluded: false });
    expect(gamingSupportRequirementsFor({ cpu: highPower }).cooler).toMatchObject({ minimumTier: 2, appropriateTier: 2, stockAllowed: false });
    expect(gamingPartSuitabilityFor(ag400(), { cpu: highPower }).minimum).toBe("unmet");
    expect(gamingPartSuitabilityFor(pa120(), { cpu: highPower })).toMatchObject({ minimum: "met", appropriate: "met" });
    expect(gamingPartSuitabilityFor(water(), { cpu: highPower })).toMatchObject({ minimum: "met", appropriate: "excessive" });
  });

  it("marks top-GPU 16GB as below appropriate while preserving its minimum distinction", () => {
    const context = { cpu: cpu("7500F"), gpu: gpu("RTX 5090", 32), motherboard: b850() };
    expect(gamingPartSuitabilityFor(ram(16, "DDR5"), context)).toMatchObject({ minimum: "met", appropriate: "below" });
    expect(gamingPartSuitabilityFor(ram(32, "DDR5"), context)).toMatchObject({ minimum: "met", appropriate: "met" });
    expect(gamingPartSuitabilityFor(ram(64, "DDR5"), context)).toMatchObject({ minimum: "met", appropriate: "excessive" });
  });

  it("blocks RAM generation and slot count errors even when the capacity tier is high", () => {
    expect(gamingPartSuitabilityFor(ram(32), { motherboard: b850() }).minimum).toBe("unmet");
    expect(gamingPartSuitabilityFor(ram(8), { motherboard: a520(), memoryQuantity: 4 }).minimum).toBe("unmet");
  });

  it("keeps DDR5-8000 actual OC stability unverified even with enough motherboard slots", () => {
    const result = gamingPartSuitabilityFor(ram(32, "DDR5", { speedMhz: 8000, memoryModuleCountPerKit: 2 }), { motherboard: b850() });
    expect(result.minimum).toBe("unknown");
    expect(result.checks.find((item) => item.code === "memory-oc-validation")?.status).toBe("unknown");
  });

  it("rejects inadequate wattage or GPU connectors and flags unnecessary PSU capacity", () => {
    const context = { cpu: cpu("5600"), gpu: gpu("RTX 5060 Ti") };
    expect(gamingSupportRequirementsFor(context).psu).toMatchObject({ minimumWattageW: 600, appropriateMaxWattageW: 650, gpuPowerEvidence: "catalog_spec" });
    expect(gamingPartSuitabilityFor(psu(500), context).minimum).toBe("unmet");
    expect(gamingPartSuitabilityFor(psu(650), context)).toMatchObject({ minimum: "met", appropriate: "met" });
    expect(gamingPartSuitabilityFor(psu(850), context)).toMatchObject({ minimum: "met", appropriate: "excessive" });
    expect(gamingPartSuitabilityFor(psu(650, { pciePowerConnectors: { pcie_8pin_6plus2: 0 } }), context).minimum).toBe("unmet");
    expect(gamingPartSuitabilityFor(psu(650, { pciePowerConnectors: undefined }), context).minimum).toBe("unknown");
  });

  it("does not record an RX580 connector allowance as measured GPU TGP", () => {
    const rx580 = part("gpu", "AFOX 라데온 RX 580 2048SP D5 8GB 디앤디컴", { recommendedPsuW: 400, pciePowerOptions: [[{ kind: "pcie_8pin_6plus2", count: 1 }]] });
    expect(gamingSupportRequirementsFor({ cpu: cpu("5600"), gpu: rx580 }).psu).toMatchObject({ minimumWattageW: 463, gpuPowerEvidence: "planning_upper_bound" });
    expect(rx580.specs.powerW).toBeUndefined();
    expect(gamingPartSuitabilityFor(psu(500), { cpu: cpu("5600"), gpu: rx580 }).notes.join(" ")).toContain("전력 상한");
  });

  it("retains case dimensions, radiator and PSU conditions independently of a large case tier", () => {
    const context = { motherboard: b850(), gpu: gpu("RTX 5070 Ti", 16, { lengthMm: 350 }), cooler: ag400(), psu: psu(650) };
    expect(gamingPartSuitabilityFor(computerCase(), context).minimum).toBe("unmet");
    expect(gamingPartSuitabilityFor(computerCase({ maxGpuLengthMm: 400 }), context).minimum).toBe("met");
    expect(gamingPartSuitabilityFor(computerCase({ maxGpuLengthMm: undefined }), context).minimum).toBe("unknown");
    expect(gamingPartSuitabilityFor(computerCase({ radiatorSizesMm: [240] }), { motherboard: b850(), cooler: water() }).minimum).toBe("unmet");
    expect(gamingPartSuitabilityFor(computerCase({ radiatorSizesMm: [360] }), { motherboard: b850(), cooler: water() }).minimum).toBe("met");
  });

  it("does not accept every mATX board in the compact C10M", () => {
    const compact = { ...computerCase(), name: "앱코 C10M 컴팩트" };
    expect(gamingPartSuitabilityFor(compact, { motherboard: a520() }).minimum).toBe("met");
    expect(gamingPartSuitabilityFor(compact, { motherboard: b850() }).minimum).toBe("unmet");
  });

  it("keeps high-power GPU cable and thickness clearance unknown without actual physical evidence", () => {
    const large = gpu("RTX 5090", 32, { widthMm: 150, thicknessMm: 70, pciePowerOptions: [[{ kind: "12v2x6", count: 1 }]], gpuCableBendClearanceMm: 35 });
    const result = gamingPartSuitabilityFor(computerCase(), { motherboard: b850(), gpu: large });
    expect(result.minimum).toBe("unknown");
    expect(result.checks.find((item) => item.code === "case-gpu-cable-clearance")?.status).toBe("unknown");
    expect(result.checks.find((item) => item.code === "case-gpu-thickness-clearance")?.status).toBe("unknown");
    expect(gamingSupportRequirementsFor({ gpu: large }).case).toMatchObject({ gpuThicknessMm: 70, gpuWidthMm: 150, gpuCableBendClearanceMm: 35 });
  });
});

describe("manual tier adjacency and dependency rebuilding", () => {
  it("keeps the requested 5600 → 7500F step even when a cheaper 7400F is present", () => {
    const base = cpu("5600");
    const next = cpu("7500F");
    const cheap = { ...cpu("7400F"), priceWon: 50_000 };
    expect(gamingPartTierAdjacencyFor([base, next, cheap], base.id).upId).toBe(next.id);
  });

  it("picks the cheapest exact GPU role and does not treat brand or color as an upgrade", () => {
    const current = gpu("RTX 5060", 8);
    const expensive = { ...gpu("RTX 5060 Ti", 16), id: "white", priceWon: 600_000 };
    const inexpensive = { ...expensive, id: "black", priceWon: 500_000 };
    expect(gamingPartTierAdjacencyFor([current, expensive, inexpensive], current.id).upId).toBe("black");
  });

  it("keeps board changes on the existing CPU socket", () => {
    expect(gamingPartTierAdjacencyFor([a520(), b550(), b850(), x870()], a520().id).upId).toBe(b550().id);
    expect(gamingPartTierAdjacencyFor([a520(), b550(), b850(), x870()], b850().id).upId).toBe(x870().id);
  });

  it("orders RAM by capacity and prevents a more expensive cross-platform downgrade", () => {
    const current = ram(16);
    const high = ram(32);
    const foreign = ram(8, "DDR5");
    expect(gamingPartTierAdjacencyFor([current, high, foreign], current.id)).toMatchObject({ upMemoryCapacityGb: 32 });
    expect(gamingPartTierAdjacencyFor([current, high, foreign], current.id).downId).toBeUndefined();
  });

  it("changes SSD capacity instead of treating same-capacity brand or interface changes as an upgrade", () => {
    const current = storage("ssd", 1000);
    const sameCapacity = { ...current, id: "ssd-new-brand", priceWon: 300_000, specs: { ...current.specs, interface: "SATA" } };
    const larger = storage("ssd", 2000);
    const cheaperLarger = { ...larger, id: "ssd-cheaper-2tb", priceWon: 120_000 };
    const smaller = storage("ssd", 500);
    expect(gamingPartTierAdjacencyFor([current, sameCapacity, larger, cheaperLarger, smaller], current.id)).toEqual({ upId: cheaperLarger.id, upStorageCapacityGb: 2000, downId: smaller.id, downStorageCapacityGb: 500 });
    expect(gamingPartTierAdjacencyFor([current, sameCapacity], current.id)).toEqual({});
  });

  it("keeps 500GB as the SSD floor and groups 512GB and 1024GB variants into selectable steps", () => {
    const capacities = [250, 500, 512, 1000, 1024, 2000, 4000].map((capacity) => storage("ssd", capacity));
    expect(gamingPartTierAdjacencyFor(capacities, storage("ssd", 500).id)).toEqual({ upId: storage("ssd", 1000).id, upStorageCapacityGb: 1000 });
    expect(gamingPartTierAdjacencyFor(capacities, storage("ssd", 512).id).downId).toBeUndefined();
    expect(gamingPartTierAdjacencyFor(capacities, storage("ssd", 1024).id)).toEqual({ upId: storage("ssd", 2000).id, upStorageCapacityGb: 2000, downId: storage("ssd", 500).id, downStorageCapacityGb: 500 });
    expect(gamingPartTierAdjacencyFor(capacities, storage("ssd", 4000).id).upId).toBeUndefined();
    expect(gamingPartTierAdjacencyFor([...capacities, storage("ssd", 8000)], storage("ssd", 8000).id)).toEqual({ downId: storage("ssd", 4000).id, downStorageCapacityGb: 4000 });
    expect(gamingPartTierAdjacencyFor([part("ssd", "capacity unknown")], "ssd-capacity unknown")).toEqual({});
  });

  it("uses per-drive HDD capacity steps independently of the number of HDDs", () => {
    const capacities = [1000, 2000, 4000, 8000, 16000].map((capacity) => storage("hdd", capacity));
    expect(gamingPartTierAdjacencyFor(capacities, storage("hdd", 4000).id, { hddCount: 2 })).toEqual({ upId: storage("hdd", 8000).id, upHddCapacityGb: 8000, downId: storage("hdd", 2000).id, downHddCapacityGb: 2000 });
    expect(gamingPartTierAdjacencyFor(capacities, storage("hdd", 2000).id).downId).toBeUndefined();
    expect(gamingPartTierAdjacencyFor(capacities, storage("hdd", 16000).id).upId).toBeUndefined();
    expect(gamingPartTierAdjacencyFor([...capacities, storage("hdd", 6000)], storage("hdd", 6000).id)).toEqual({ upId: storage("hdd", 8000).id, upHddCapacityGb: 8000, downId: storage("hdd", 4000).id, downHddCapacityGb: 4000 });
    const result = gamingTierAssessmentFor({ ssd: storage("ssd", 2000), hdd: storage("hdd", 4000) }, { hddCount: 2 });
    expect(result.categories.ssd?.tier.label).toBe("2TB SSD");
    expect(result.categories.hdd?.tier.label).toBe("4TB HDD");
  });

  it("represents real RAM quantity changes and picks a larger module when four DIMMs would exceed the board", () => {
    const current = ram(8);
    const next = ram(16);
    const result = gamingPartTierAdjacencyFor([current, next], current.id, { motherboard: a520(), memoryQuantity: 2 });
    expect(result).toMatchObject({ upId: next.id, upMemoryCapacityGb: 32 });
    const sameKit = gamingPartTierAdjacencyFor([next], next.id, { motherboard: a520(), memoryQuantity: 1 });
    expect(sameKit).toMatchObject({ upId: next.id, upMemoryCapacityGb: 32 });
    expect(gamingPartTierAdjacencyFor([current], current.id, { motherboard: a520(), memoryQuantity: 2 }).upId).toBeUndefined();
  });

  it("releases the CPU platform chain including case and GPU power/mount dependencies", () => {
    expect(gamingAdjustmentDependentCategories("cpu")).toEqual(expect.arrayContaining(["cpu", "motherboard", "memory", "cooler", "psu", "case"]));
    expect(gamingAdjustmentDependentCategories("cpu")).not.toContain("gpu");
    expect(gamingAdjustmentDependentCategories("gpu")).toEqual(expect.arrayContaining(["gpu", "psu", "case", "cooler"]));
    expect(gamingAdjustmentDependentCategories("gpu")).not.toContain("cpu");
  });

  it("produces a serializable whole-build policy assessment without claiming full compatibility", () => {
    const result = gamingTierAssessmentFor({ cpu: cpu("7500F"), gpu: gpu("RTX 5090", 32), motherboard: b850(), memory: ram(16, "DDR5"), psu: psu(650), case: computerCase() });
    expect(result.requirements.memory.appropriateCapacityGb).toBe(32);
    expect(result.categories.memory?.appropriate).toBe("below");
    expect(JSON.parse(JSON.stringify(result)).policyVersion).toBe("gaming-part-tiers-2026-10-05");
    expect(result).not.toHaveProperty("compatibility");
  });
});

describe("mixed RAM total measurements", () => {
  it("classifies and checks actual capacity and DIMM count independently of the representative kit", () => {
    const context = { cpu: cpu("5600"), gpu: gpu("RTX 5070 Ti"), motherboard: a520(), memoryQuantity: 2, memoryCapacityGb: 16, actualMemoryCapacityGb: 24, actualMemoryModuleCount: 3 };
    for (const representative of [ram(8), ram(16)]) {
      const result = gamingPartSuitabilityFor(representative, context);
      expect(result.tier.order).toBe(24);
      expect(result.appropriate).toBe("below");
      expect(result.minimum).toBe("unmet");
      expect(result.checks.find((check) => check.code === "memory-slot-count")?.status).toBe("unmet");
    }
  });
});

describe("adjacent support parts respect known minimums", () => {
  it("does not offer a PSU or cooler below the selected hardware requirements", () => {
    const power = [psu(500), psu(600), psu(700), psu(850)];
    const powerContext = { cpu: cpu("7500F"), gpu: gpu("RTX 5060 Ti", 16, { recommendedPsuW: 650 }), motherboard: b850() };
    expect(gamingPartTierAdjacencyFor(power, psu(700).id, powerContext).downId).toBeUndefined();
    const heatContext = { cpu: cpu("9950X", { tdpW: 170, pptW: 230 }), motherboard: x870() };
    expect(gamingPartTierAdjacencyFor([ag400(), pa120(), water()], pa120().id, heatContext).downId).toBeUndefined();
    expect(gamingPartTierAdjacencyFor([b850(), x870()], x870().id, heatContext).downId).toBeUndefined();
  });
});
