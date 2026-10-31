import type { GamingBalanceLevel, Part } from "./types";

/** These are reviewed pairing rules, never extrapolated FPS measurements. */
export const GAMING_BUILD_REFERENCE_VERSION = "gaming-pairings-2026-10-12";
export const GAMING_REFERENCE_PROVENANCE = {
  director: { kind: "reviewed_pairing_policy", date: "2026-10-12", description: "사장님이 검증 기준으로 지정한 CPU/GPU 조합 및 배틀그라운드 조건" },
  video: { kind: "benchmark_evidence", url: "https://www.youtube.com/watch?v=6NoegO2rlkE&t=76", captures: [181, 535, 839, 851], description: "GPU별 별도 게임 측정 열. CPU의 단일 수치 비율을 조합 판정에 사용하지 않음" }
} as const;

export const REFERENCE_GPU_MODELS = ["RTX 3050", "RTX 5050", "RTX 5060", "RTX 5060 Ti", "RTX 5070", "RTX 5070 Ti", "RTX 5080", "RTX 5090"] as const;
export type ReferenceGpuModel = typeof REFERENCE_GPU_MODELS[number];
export type ReferenceCpuGroup = "legacy_value" | "entry" | "mainstream" | "x3d_7800" | "x3d_9800";
export interface GamingBuildReference {
  id: string;
  cpuGroup: ReferenceCpuGroup;
  cpuModels: readonly string[];
  /** CPU level; GPU level is the inverse. The Ti VRAM variants share a row. */
  levels: Readonly<Record<ReferenceGpuModel, GamingBalanceLevel>>;
  provenance: "director_with_project_extensions" | "project_review";
}
function levels(values: readonly GamingBalanceLevel[]): GamingBuildReference["levels"] {
  return Object.fromEntries(REFERENCE_GPU_MODELS.map((model,index)=>[model,values[index]])) as GamingBuildReference["levels"];
}
export const GAMING_BUILD_REFERENCES: readonly GamingBuildReference[] = [
  { id: "legacy-value", cpuGroup: "legacy_value", cpuModels: ["5500GT", "5600", "12100F", "14100F", "13400F"], provenance: "project_review", levels: /* @__PURE__ */ levels(["good", "good", "slightly_weak", "slightly_weak", "too_weak", "too_weak", "too_weak", "too_weak"]) },
  { id: "entry-5050", cpuGroup: "entry", cpuModels: ["7500F", "7600", "14400F"], provenance: "director_with_project_extensions", levels: /* @__PURE__ */ levels(["slightly_strong", "good", "slightly_weak", "slightly_weak", "too_weak", "too_weak", "too_weak", "too_weak"]) },
  { id: "mainstream-5060", cpuGroup: "mainstream", cpuModels: ["9600", "9600X", "9700X", "14600KF", "250KF", "265K", "265KF", "14900K", "14900KF", "14900KS"], provenance: "director_with_project_extensions", levels: /* @__PURE__ */ levels(["too_strong", "slightly_strong", "good", "good", "slightly_weak", "too_weak", "too_weak", "too_weak"]) },
  { id: "7800x3d-5060ti-5070", cpuGroup: "x3d_7800", cpuModels: ["7800X3D"], provenance: "director_with_project_extensions", levels: /* @__PURE__ */ levels(["too_strong", "too_strong", "slightly_strong", "good", "good", "slightly_weak", "too_weak", "too_weak"]) },
  { id: "9800x3d-family-5070-5090", cpuGroup: "x3d_9800", cpuModels: ["9800X3D", "9850X3D", "9900X3D", "9950X3D"], provenance: "director_with_project_extensions", levels: /* @__PURE__ */ levels(["too_strong", "too_strong", "too_strong", "slightly_strong", "good", "good", "good", "good"]) }
];

/** Cells explicitly supplied by the director; all other cells are conservative project rules. */
function directorPairingKeys(): readonly string[] { return [
  "14400F:RTX 5050", "14400F:RTX 5060", "7500F:RTX 5050", "7500F:RTX 5060", "9600X:RTX 5060",
  ...["RTX 5060", "RTX 5060 Ti", "RTX 5070", "RTX 5070 Ti", "RTX 5080"].map((gpu)=>`7800X3D:${gpu}`),
  ...["9800X3D", "9850X3D", "9900X3D", "9950X3D"].flatMap((cpu)=>["RTX 5060 Ti", "RTX 5070", "RTX 5090"].map((gpu)=>`${cpu}:${gpu}`))
]; }
export const DIRECTOR_PAIRING_REFERENCE_KEYS: readonly string[] = /* @__PURE__ */ directorPairingKeys();

export function gamingReferenceForCpuModel(model: string): GamingBuildReference | undefined {
  return GAMING_BUILD_REFERENCES.find((reference)=>reference.cpuModels.includes(model.toUpperCase()));
}
export function referenceGpuModelFor(name: string): ReferenceGpuModel | undefined {
  if (/\bRTX\s*(?:3050|5050|5060|5070|5080|5090)\s*(?:Ti\s*)?SUPER\b/i.test(name)) return undefined;
  const match = name.match(/\bRTX\s*(3050|5050|5060|5070|5080|5090)\s*(Ti)?\b/i);
  if (!match) return undefined;
  const model = `RTX ${match[1]}${match[2] ? " Ti" : ""}`;
  return REFERENCE_GPU_MODELS.find((reference)=>reference.toLowerCase()===model.toLowerCase());
}
/** Older/Radeon equivalents are explicitly a project policy, not the director's measured pairs. */
export function equivalentReferenceGpuModelFor(name: string): ReferenceGpuModel | undefined {
  if (/\bRTX\s*4090\b/i.test(name)) return "RTX 5090";
  if (/\bRTX\s*4080\b/i.test(name)) return "RTX 5080";
  if (/\bRX\s*9070\s*XT\b/i.test(name)) return "RTX 5070 Ti";
  if (/\bRX\s*9070\b/i.test(name)) return "RTX 5070";
  if (/\b(?:RTX\s*4060\s*Ti|RX\s*9060\s*XT)\b/i.test(name)) return "RTX 5060 Ti";
  if (/\bRTX\s*4060\b/i.test(name)) return "RTX 5060";
  if (/\bRX\s*580\b/i.test(name)) return "RTX 3050";
  return undefined;
}
export function hasPubgGameContext(gameIds: readonly string[] = []): boolean {
  return gameIds.some((id)=>/^(?:pubg|배그|배틀그라운드|playerunknown'?s? battlegrounds)$/i.test(id.trim()));
}
export const GAMING_RESOLUTION_REFERENCES = [
  { id: "director-fhd-8gb", resolution: "1080p", minimumVramGb: 8, provenance: "director", date: "2026-10-12" },
  { id: "director-qhd-12gb", resolution: "1440p", minimumVramGb: 12, provenance: "director", date: "2026-10-12" },
  { id: "director-4k-16gb", resolution: "2160p", minimumVramGb: 16, provenance: "director", date: "2026-10-12" }
] as const;
/** Reviewed model floors supplement VRAM. These are project recommendation policy, not measured FPS guarantees. */
export const GAMING_RESOLUTION_GPU_REFERENCES = [
  { id: "project-4k-rtx5070ti", resolution: "2160p", minimumGpuModel: "RTX 5070 Ti", provenance: "project_review", date: "2026-10-12" }
] as const;
export function resolutionGpuReferenceFor(resolution: string | undefined) {
  if (/^(?:2160p|4k|uhd)$/i.test(resolution ?? "")) return GAMING_RESOLUTION_GPU_REFERENCES[0];
  return undefined;
}
export function gpuMeetsResolutionReference(gpu: Part | undefined, resolution: string | undefined): boolean {
  const reference = resolutionGpuReferenceFor(resolution);
  if (!reference) return true;
  if (!gpu) return false;
  const name = `${gpu.name} ${gpu.model ?? ""}`;
  const model = referenceGpuModelFor(name) ?? equivalentReferenceGpuModelFor(name);
  return model !== undefined && REFERENCE_GPU_MODELS.indexOf(model) >= REFERENCE_GPU_MODELS.indexOf(reference.minimumGpuModel);
}
/** Resolution memory floor is a separate recommendation rule, not CPU balance. */
export function resolutionVramRequirementFor(resolution: string | undefined): number {
  if (/^(?:2160p|4k|uhd)$/i.test(resolution ?? "")) return GAMING_RESOLUTION_REFERENCES[2].minimumVramGb;
  if (/^(?:1440p|qhd)$/i.test(resolution ?? "")) return GAMING_RESOLUTION_REFERENCES[1].minimumVramGb;
  return GAMING_RESOLUTION_REFERENCES[0].minimumVramGb;
}
