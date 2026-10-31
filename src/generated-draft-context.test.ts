import { describe, expect, it } from 'vitest';
import { generatedDraftContextFromJson, recommendationPreferencesForGeneratedDraft, generatedDraftWithoutPersistedFpsAssessment, generatorPresetConfigForGeneratedDraft } from './generated-draft-context';
import type { BuildGenerationResult } from '../shared/types';
import { generatorPartAdjustmentRequestFor } from './generator-balance';
const selection = { memory: [{partId:'memory',quantity:1}], ssd:[{partId:'ssd',quantity:1}], hdd:[],cpu:{partId:'cpu',quantity:1},motherboard:{partId:'motherboard',quantity:1},case:{partId:'case',quantity:1},psu:{partId:'psu',quantity:1},useIntegratedGraphics:true };
const draft: BuildGenerationResult = { gamingTestbedPhase1:true,profile:'gaming',priority:'performance',status:'compatible',selection,budgetWon:800000,totalPriceWon:750000,memoryCapacityGb:16,storageCapacityGb:1000,hddCount:0,rationale:[],warnings:[],gamingResolution:'1440p',gamingRefreshRate:144,includeNonRetail:false,listingPolicy:'retail_only',budgetDeltaWon:-50000,withinBudget:true,priceComplete:true,blockerCount:0,warningCount:0,unknownCount:0,lines:(['cpu','memory','motherboard','ssd','case','psu'] as const).map(category=>({category,partId:category,name:category,quantity:1,priceWon:100000})) };
describe('generated draft context',()=>{
 it('restores controls for the same valid generated build after reload',()=>{expect(generatedDraftContextFromJson(JSON.stringify(draft))?.selection.cpu?.partId).toBe('cpu');});
 it('rejects corrupted, oversized and mismatched build contexts',()=>{
  expect(generatedDraftContextFromJson('broken')).toBeNull();
  expect(generatedDraftContextFromJson(' '.repeat(64001))).toBeNull();
  expect(generatedDraftContextFromJson(JSON.stringify({...draft,lines:[...draft.lines,{...draft.lines[0],partId:'mismatch'}]}))).toBeNull();
  expect(generatedDraftContextFromJson(JSON.stringify({...draft,selection:{...selection,cpu:{partId:'different',quantity:1}}}))).toBeNull();
 });
});


describe('game-target generated draft persistence',()=>{
 it('restores request settings but discards untrusted persisted FPS claims',()=>{
  const target = {...draft,gamingMode:'target_fps' as const,gamingTargetFps:120,gamingGameIds:['pubg'],gpuVendorPreference:'amd' as const,gamingGraphicsPreset:'high' as const,gamingRayTracing:true,gamingUpscaling:'native' as const,gamingTargetAssessment:{status:'verified',targetMet:true}};
  const restored=generatedDraftContextFromJson(JSON.stringify(target));
  expect(restored).toMatchObject({gamingMode:'target_fps',gamingTargetFps:120,gamingGameIds:['pubg'],gpuVendorPreference:'amd',gamingRayTracing:true});
  expect(restored?.gamingTargetAssessment).toBeUndefined();
  expect(recommendationPreferencesForGeneratedDraft(restored!)).toMatchObject({gamingTargetFps:120,gamingRefreshRate:144,gamingGameIds:['pubg'],gamingUpscaling:'native'});
 });
 it('rejects invalid target metadata while retaining the legacy budget draft',()=>{
  expect(generatedDraftContextFromJson(JSON.stringify({...draft,gamingMode:'target_fps',gamingTargetFps:501,gamingGameIds:['pubg']}))).toBeNull();
  expect(generatedDraftContextFromJson(JSON.stringify({...draft,gamingMode:'target_fps',gamingTargetFps:120,gamingGameIds:[]}))).toBeNull();
  expect(generatedDraftContextFromJson(JSON.stringify({...draft,gamingGameIds:Array(6).fill('pubg')}))).toBeNull();
  expect(generatedDraftContextFromJson(JSON.stringify(draft))).not.toBeNull();
 });
 it('does not carry game settings into a non-gaming applied draft',()=>{
  const prefs=recommendationPreferencesForGeneratedDraft({...draft,profile:'office'});
  expect(prefs.gamingMode).toBeUndefined();expect(prefs.gamingTargetFps).toBeUndefined();expect(prefs.gamingGameIds).toBeUndefined();
  expect(generatedDraftWithoutPersistedFpsAssessment(draft).gamingTargetAssessment).toBeUndefined();
 });
});


describe('persisted tier safety',()=>{
 it('discards derived tier objects and validates RAM adjacency capacities',()=>{
  const raw={...draft,partTiers:{memory:{upId:'memory',upMemoryCapacityGb:32}},partTierSuitability:'broken',gamingSupportRequirements:{garbage:true}};
  const parsed=generatedDraftContextFromJson(JSON.stringify(raw));
  expect(parsed?.partTiers?.memory?.upMemoryCapacityGb).toBe(32);
  expect(parsed?.partTierSuitability).toBeUndefined();expect(parsed?.gamingSupportRequirements).toBeUndefined();
  expect(generatedDraftContextFromJson(JSON.stringify({...draft,partTiers:{memory:{upId:'memory',upMemoryCapacityGb:17}}}))).toBeNull();
 });
 it('restores SSD and per-drive HDD capacity controls without changing the HDD quantity',()=>{
  const storageDraft={...draft,hddCount:2,hddCapacityGb:4000,selection:{...selection,hdd:[{partId:'hdd',quantity:2}]},lines:[...draft.lines,{category:'hdd' as const,partId:'hdd',name:'HDD 4TB',quantity:2,priceWon:100000}],partTiers:{ssd:{upId:'ssd-2tb',upStorageCapacityGb:2000,downId:'ssd-500gb',downStorageCapacityGb:500},hdd:{upId:'hdd-8tb',upHddCapacityGb:8000,downId:'hdd-2tb',downHddCapacityGb:2000}}};
  const restored=generatedDraftContextFromJson(JSON.stringify(storageDraft));
  expect(restored).toMatchObject({hddCount:2,hddCapacityGb:4000,storageCapacityGb:1000,partTiers:storageDraft.partTiers});
  expect(restored?.selection.hdd).toEqual([{partId:'hdd',quantity:2}]);
 });
 it('rejects invalid, misplaced or ID-free storage capacity metadata',()=>{
  for(const partTiers of [
   {ssd:{upId:'ssd',upStorageCapacityGb:750}},
   {ssd:{downId:'ssd',downStorageCapacityGb:250}},
   {hdd:{upId:'hdd',upHddCapacityGb:1000}},
   {memory:{upId:'memory',upStorageCapacityGb:2000}},
   {ssd:{upId:'ssd',upHddCapacityGb:8000}},
   {ssd:{upStorageCapacityGb:2000}},
   {hdd:{downHddCapacityGb:2000}}
  ]) expect(generatedDraftContextFromJson(JSON.stringify({...draft,partTiers}))).toBeNull();
  expect(generatedDraftContextFromJson(JSON.stringify({...draft,hddCount:0.5}))).toBeNull();
 });
});


describe('editing generated game conditions',()=>{
 it('carries the exact game-target metadata into the onboarding preset seam',()=>{
  const config=generatorPresetConfigForGeneratedDraft({...draft,gamingMode:'target_fps',gamingTargetFps:120,gpuVendorPreference:'amd',gamingGameIds:['pubg'],gamingGraphicsPreset:'high',gamingRayTracing:true,gamingUpscaling:'native'});
  expect(config).toMatchObject({profile:'gaming',gamingMode:'target_fps',gamingTargetFps:120,gamingRefreshRate:144,gpuVendorPreference:'amd',gamingGameIds:['pubg'],gamingRayTracing:true,gamingUpscaling:'native',budgetWon:800000});
 });
});


it('restores explicit platform choices but removes persisted balance claims', () => {
 const cpuGpuBalance={cpu:{level:'good' as const},gpu:{level:'good' as const},recommendedCpuModels:['5600'],evidence:'derived_policy' as const};
 const explicit={...draft,cpuVendorPreference:'intel' as const,memoryTypePreference:'DDR4' as const,cpuGpuBalance};
 const restored=generatedDraftContextFromJson(JSON.stringify(explicit));
 expect(restored).toMatchObject({cpuVendorPreference:'intel',memoryTypePreference:'DDR4'});
 expect(restored?.cpuGpuBalance).toBeUndefined();
 expect(generatorPresetConfigForGeneratedDraft(restored!)).toMatchObject({cpuVendorPreference:'intel',memoryTypePreference:'DDR4'});
 expect(generatedDraftContextFromJson(JSON.stringify({...draft,cpuVendorPreference:'nvidia'}))).toBeNull();
 expect(generatedDraftContextFromJson(JSON.stringify({...draft,memoryTypePreference:'DDR3'}))).toBeNull();
});


describe("restored strict step capacity facts", () => {
 it("keeps known actual capacities while discarding derived suitability claims", () => {
  const original={...draft,partTiers:{memory:{currentCapacityGb:64,downId:"memory32",downMemoryCapacityGb:32},ssd:{currentCapacityGb:4000,downId:"ssd2tb",downStorageCapacityGb:2000}}};
  const stripped=generatedDraftWithoutPersistedFpsAssessment(original);
  const restored=generatedDraftContextFromJson(JSON.stringify(stripped));
  expect(restored?.partTierSuitability).toBeUndefined();
  expect(restored?.partTiers?.memory?.currentCapacityGb).toBe(64);
  expect(generatorPartAdjustmentRequestFor(restored!,"memory","down")?.memoryCapacityGb).toBe(32);
  expect(generatorPartAdjustmentRequestFor(restored!,"ssd","down")?.storageCapacityGb).toBe(2000);
  const skipped={...restored!,partTiers:{memory:{currentCapacityGb:64,downId:"memory16",downMemoryCapacityGb:16}}};
  expect(generatorPartAdjustmentRequestFor(skipped,"memory","down")).toBeUndefined();
 });
 it("extracts only a bounded capacity number from previous derived tier metadata", () => {
  const old=JSON.parse(JSON.stringify({...draft,partTierSuitability:{memory:{tier:{order:64},minimum:"met",appropriate:"met"}}}));
  const stripped=generatedDraftWithoutPersistedFpsAssessment(old);
  expect(stripped.partTierSuitability).toBeUndefined();
  expect(stripped.partTiers?.memory).toEqual({currentCapacityGb:64});
  expect(generatedDraftContextFromJson(JSON.stringify(stripped))?.partTiers?.memory?.currentCapacityGb).toBe(64);
 });
 it("restores a missing-step reason without inventing an adjacent part ID", () => {
  const reason="RTX5060TI 단계의 판매 가능한 부품이 없습니다.";
  const restored=generatedDraftContextFromJson(JSON.stringify({...draft,partTiers:{gpu:{upUnavailableReason:reason}}}));
  expect(restored?.partTiers?.gpu).toEqual({upUnavailableReason:reason});
  expect(generatorPartAdjustmentRequestFor(restored!,"gpu","up")).toBeUndefined();
 });
 it("rejects misplaced or unbounded actual capacities and invalid reason text", () => {
  for(const partTiers of [{cpu:{currentCapacityGb:64}},{memory:{currentCapacityGb:0}},{memory:{currentCapacityGb:1.5}},{memory:{currentCapacityGb:2048}},{ssd:{currentCapacityGb:Infinity}},{gpu:{upUnavailableReason:1}},{gpu:{downUnavailableReason:"x".repeat(501)}}])
   expect(generatedDraftContextFromJson(JSON.stringify({...draft,partTiers}))).toBeNull();
 });
});
