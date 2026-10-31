import { isQuoteBrandAllowed, isListingAllowed } from "./domain/listing";
import { describe, expect, it } from "vitest";
import type { Part } from "./types";
import { CPU_GAMING_EVIDENCE, cpuGamingEvidenceFor, cpuGamingValueFrontier, cpuGpuBalanceFor, cpuMeetsGamingGpuFloor, gamingFallbackSsdAllowed, gamingPreferredSsdCandidates } from "./cpu-gaming-policy";
const cpu = (model: string, priceWon = 100000): Part => ({ id: model, category: "cpu", name: `AMD Ryzen ${model}`, specs: { integratedGraphics: false }, priceWon, source: "manual", dataQuality: "manual", missingFields: [], updatedAt: "2026-10-06" });
const gpu = (model: string): Part => ({ ...cpu(model), category: "gpu", name: model });
describe("CPU gaming recommendation learning", () => {
  it("keeps the small set and missing benchmark cells honest", () => {
    expect(CPU_GAMING_EVIDENCE).toHaveLength(20);
    expect(cpuGamingEvidenceFor(cpu("5500GT"))?.gaming["RTX 4090"]).toBeUndefined();
    expect(cpuGamingEvidenceFor(cpu("9800X3D"))?.gaming["RTX 4090"]).toBe(128.4);
    expect(cpuGamingEvidenceFor(cpu("5600"))?.gaming["RTX 4060 Ti"]).toBe(99.8);
  });
  it("flags the two physically compatible but economically unbalanced examples", () => {
    expect(cpuGpuBalanceFor(cpu("5600"), gpu("RTX 5090"))?.cpu.level).toBe("too_weak");
    expect(cpuGpuBalanceFor(cpu("9800X3D"), gpu("RTX 3050"))?.cpu.level).toBe("too_strong");
    expect(cpuGpuBalanceFor(cpu("9800X3D"), gpu("RTX 3050"))?.gpu.level).toBe("too_weak");
    expect(cpuGpuBalanceFor(cpu("5600"), gpu("RTX 5060 Ti"))?.cpu.level).toBe("slightly_weak");
    expect(cpuGpuBalanceFor(cpu("5600"), gpu("RTX 5060 Ti"))?.evidence).toBe("derived_policy");
    expect(cpuGpuBalanceFor(cpu("5600"), gpu("RTX 4060 Ti"))?.evidence).toBe("derived_policy");
    expect(cpuGpuBalanceFor(cpu("unknown"), gpu("RTX 5090"))).toBeUndefined();
  });
  it("requires source-recommended X3D performance for upper GPU automatic pairs", () => {
    expect(cpuMeetsGamingGpuFloor(cpu("5600"), gpu("RTX 5090"))).toBe(false);
    expect(cpuMeetsGamingGpuFloor(cpu("7800X3D"), gpu("RTX 5070 Ti"))).toBe(false);
    expect(cpuMeetsGamingGpuFloor(cpu("9800X3D"), gpu("RTX 5070 Ti"))).toBe(true);
    expect(cpuMeetsGamingGpuFloor(cpu("9700X"), gpu("RX 9070 XT"))).toBe(false);
  });
  it.each([
    ["14400F", "RTX 5050", "good"], ["14400F", "RTX 5060", "slightly_weak"],
    ["7500F", "RTX 5050", "good"], ["7500F", "RTX 5060", "slightly_weak"],
    ["9600X", "RTX 5060", "good"], ["7800X3D", "RTX 5060", "slightly_strong"],
    ["7800X3D", "RTX 5060 Ti", "good"], ["7800X3D", "RTX 5070", "good"],
    ["7800X3D", "RTX 5070 Ti", "slightly_weak"], ["7800X3D", "RTX 5080", "too_weak"],
    ["9800X3D", "RTX 5060 Ti", "slightly_strong"], ["9800X3D", "RTX 5070", "good"],
    ["9800X3D", "RTX 5090", "good"]
  ])("matches reviewed %s + %s pairing", (cpuModel, gpuModel, level) => {
    const assessment = cpuGpuBalanceFor(cpu(cpuModel),gpu(gpuModel));
    expect(assessment?.cpu.level).toBe(level);
    expect(assessment?.referenceId).toContain("gaming-pairings-2026-10-12");
    expect(assessment?.contextRules).toContain("director-pairing-reference");
  });
  it("keeps the upper X3D family and VRAM variants in the same balance class", () => {
    for (const model of ["9800X3D","9850X3D","9900X3D","9950X3D"]) {
      expect(cpuGpuBalanceFor(cpu(model),gpu("RTX 5060Ti 8GB"))?.cpu.level).toBe("slightly_strong");
      expect(cpuGpuBalanceFor(cpu(model),gpu("RTX 5060 Ti 16GB"))?.cpu.level).toBe("slightly_strong");
      expect(cpuGpuBalanceFor(cpu(model),gpu("RTX 5090"))?.cpu.level).toBe("good");
    }
  });
  it("uses PUBG context without inventing benchmark data or weakening a severe warning", () => {
    expect(cpuGpuBalanceFor(cpu("14900K"),gpu("RTX 5060"),undefined,["pubg"])?.cpu.level).toBe("slightly_weak");
    expect(cpuGpuBalanceFor(cpu("9600X"),gpu("RTX 5060"),undefined,["배그"])?.contextRules).toContain("pubg-requires-x3d");
    expect(cpuGpuBalanceFor(cpu("5600"),gpu("RTX 5090"),undefined,["pubg"])?.cpu.level).toBe("too_weak");
    expect(cpuGpuBalanceFor(cpu("7800X3D"),gpu("RTX 5070"),undefined,["pubg"])?.cpu.level).toBe("good");
    expect(cpuMeetsGamingGpuFloor(cpu("14400F"),gpu("RTX 5050"),undefined,["pubg"])).toBe(false);
    expect(cpuMeetsGamingGpuFloor(cpu("14400F"),gpu("RTX 5050"),"intel",["pubg"])).toBe(true);
    expect(cpuGpuBalanceFor(cpu("14900K"),gpu("RTX 5060"))?.cpuGamingPercent).toBeUndefined();
  });
  it("does not change pairing grades when prices or measurements from another column change", () => {
    expect(cpuGpuBalanceFor(cpu("7800X3D",999999),gpu("RTX 5070"))?.cpu.level).toBe("good");
    expect(cpuGpuBalanceFor(cpu("7800X3D",1),gpu("RTX 5070"))?.cpu.level).toBe("good");
    expect(cpuGpuBalanceFor(cpu("7800X3D"),gpu("RTX 5080"))?.cpuGamingPercent).toBeUndefined();
  });
  it("recomputes the price frontier when actual platform costs change", () => {
    const a = cpu("9600", 200000), b = cpu("9600X", 240000), c = cpu("9700X", 350000);
    expect(cpuGamingValueFrontier([a,b,c], (part) => part.id === b.id ? 450000 : part.id === a.id ? 500000 : 700000).map((part) => part.id)).toEqual(["9600X", "9700X"]);
    expect(cpuGamingValueFrontier([a,b,c], (part) => part.id === b.id ? 650000 : part.id === a.id ? 500000 : 600000).map((part) => part.id)).toEqual(["9600", "9700X"]);
  });
});

describe("reviewed gaming SSD candidates", () => {
  const ssd = (name:string,capacityGb:number,priceWon:number):Part => ({...cpu(name,priceWon),name,category:"ssd",brand:name.startsWith("SK")?"SK hynix":"Samsung",specs:{capacityGb,formFactor:"M.2",interface:"NVMe"}});
  it("allows 500GB and higher known models while excluding small/OEM/unreviewed families", () => {
    expect(gamingFallbackSsdAllowed(ssd("Samsung 990 PRO M.2 NVMe",500,100000))).toBe(true);
    expect(gamingFallbackSsdAllowed(ssd("SK hynix P31 M.2 NVMe",512,100000))).toBe(true);
    expect(gamingFallbackSsdAllowed(ssd("Samsung 980 PRO M.2 NVMe",250,60000))).toBe(false);
    expect(gamingFallbackSsdAllowed(ssd("Samsung PM9A1 M.2 NVMe",1000,100000))).toBe(false);
    expect(gamingFallbackSsdAllowed(ssd("SK hynix unknown M.2 NVMe",1000,100000))).toBe(false);
  });
  it("treats automatic capacity as a minimum and retains a larger cheaper whitelisted model", () => {
    const samsung=ssd("Samsung 990 PRO M.2 NVMe",500,150000), hynix=ssd("SK hynix P31 M.2 NVMe",512,110000);
    const larger=ssd("Samsung 990 EVO Plus M.2 NVMe",1000,90000);
    expect(gamingPreferredSsdCandidates([samsung,hynix,larger],500)).toEqual([larger]);
    const fixed=ssd("ESSENCORE KLEVV CRAS C910G M.2 NVMe",500,160000);
    expect(gamingPreferredSsdCandidates([samsung,hynix,fixed],500)).toEqual([fixed]);
  });
});

describe("exact fixed SSD brand exception", () => {
  it("permits C910G by full name without opening other ESSENCORE or KLEVV SSDs", () => {
    expect(isQuoteBrandAllowed("ssd","ESSENCORE","ESSENCORE KLEVV CRAS C910G M.2 NVMe (1TB)")).toBe(true);
    expect(isQuoteBrandAllowed("ssd","ESSENCORE","ESSENCORE KLEVV CRAS C910 M.2 NVMe (1TB)")).toBe(false);
    expect(isQuoteBrandAllowed("ssd","KLEVV")).toBe(false);
    const foreign = {...cpu("ssd"),category:"ssd" as const,brand:"ESSENCORE",name:"ESSENCORE KLEVV CRAS C910G M.2 NVMe (해외구매 1TB)"};
    expect(isListingAllowed(foreign,"include_bulk")).toBe(false);
  });
});
