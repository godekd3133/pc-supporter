import { describe,expect,it } from "vitest";
import { GAMING_BUILD_REFERENCES,REFERENCE_GPU_MODELS,referenceGpuModelFor,resolutionVramRequirementFor,hasPubgGameContext,gpuMeetsResolutionReference,resolutionGpuReferenceFor } from "./gaming-build-references";
import type { Part } from "./types";

describe("reviewed build reference data",()=>{
  it("keeps complete unique reference rows without associating prices with grades",()=>{
    expect(new Set(GAMING_BUILD_REFERENCES.map(r=>r.id)).size).toBe(GAMING_BUILD_REFERENCES.length);
    for(const row of GAMING_BUILD_REFERENCES) expect(Object.keys(row.levels)).toEqual([...REFERENCE_GPU_MODELS]);
    expect(referenceGpuModelFor("MSI RTX5060ti 16GB")).toBe("RTX 5060 Ti");
    expect(referenceGpuModelFor("RTX 5060 Ti 8GB")).toBe("RTX 5060 Ti");
    expect(referenceGpuModelFor("unknown")).toBeUndefined();
    expect(referenceGpuModelFor("RTX 5070 SUPER")).toBeUndefined();
  });
  it("separates VRAM resolution floors from CPU GPU pairing",()=>{
    expect(resolutionVramRequirementFor("1080p")).toBe(8);
    expect(resolutionVramRequirementFor("1440p")).toBe(12);
    expect(resolutionVramRequirementFor("2160p")).toBe(16);
    expect(resolutionVramRequirementFor("4K")).toBe(16);
    expect(hasPubgGameContext(["league","배틀그라운드"])).toBe(true);
    expect(hasPubgGameContext(["league"])).toBe(false);
  });
  it("does not market 5060 Ti 16GB as a 4K reference solely because it has 16GB",()=>{
    const gpu=(name:string):Part=>({id:name,category:"gpu",name,specs:{vramGb:16},source:"manual",dataQuality:"manual",missingFields:[],updatedAt:"2026-10-12"});
    expect(gpuMeetsResolutionReference(gpu("RTX 5060 Ti 16GB"),"2160p")).toBe(false);
    expect(gpuMeetsResolutionReference(gpu("RTX 5060 Ti 16GB"),"1440p")).toBe(true);
    expect(gpuMeetsResolutionReference(gpu("RTX 5070 12GB"),"1440p")).toBe(true);
    expect(gpuMeetsResolutionReference(gpu("RTX 5070 Ti 16GB"),"2160p")).toBe(true);
    expect(gpuMeetsResolutionReference(gpu("RX 9070 XT 16GB"),"2160p")).toBe(true);
    expect(gpuMeetsResolutionReference(gpu("RTX 3050 6GB"),"1080p")).toBe(true);
    expect(gpuMeetsResolutionReference(gpu("RX 580 8GB"),"1080p")).toBe(true);
    expect(gpuMeetsResolutionReference(undefined,"2160p")).toBe(false);
    expect(resolutionGpuReferenceFor("2160p")?.provenance).toBe("project_review");
  });
});
