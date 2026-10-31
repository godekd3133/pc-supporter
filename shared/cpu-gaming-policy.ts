import type { CpuGpuBalanceAssessment, Part } from "./types";
import { GAMING_BUILD_REFERENCE_VERSION, GAMING_BUILD_REFERENCES, DIRECTOR_PAIRING_REFERENCE_KEYS, gamingReferenceForCpuModel, referenceGpuModelFor, equivalentReferenceGpuModelFor, hasPubgGameContext } from "./gaming-build-references";

export const CPU_GAMING_POLICY_VERSION = "cpu-gaming-references-2026-10-12";
export const CPU_GAMING_VIDEO_EVIDENCE = {
  url: "https://www.youtube.com/watch?v=6NoegO2rlkE&t=76",
  condition: "1920×1080 FHD, game average relative to Intel 14900KS / 13600K as shown in the source table; GPU columns are separate tests",
  captures: [181, 535, 839, 851].map((seconds) => `artifacts/phase1-evidence/cpu-video-${seconds}s.png`),
  sourcePriceDate: "2026-09-10",
  pricePolicy: "Source prices are historical evidence only. Recommendation value uses the current catalog CPU + motherboard + requested RAM + cooler cost.",
  derivedPolicy: "The creator recommendation of 7800X3D / 9800X3D for RTX 5070 Ti / RX 9070 XT and above is historical source evidence. Active pairing grades use the director-reviewed 2026-10-12 reference matrix. Legacy GPU equivalents are project policy, not measured FPS; grades do not use numeric percentage thresholds."
} as const;

export interface CpuGamingEvidenceRow {
  model: string;
  vendor: "amd" | "intel";
  gaming: Partial<Record<"RTX 4090" | "RTX 5070" | "RTX 4060 Ti" | "RTX 3050", number>>;
  captureSeconds?: number;
  memoryType?: "DDR4" | "DDR5";
  /** For shortlisted models whose own row is outside the available captures. Never presented as a measured percentage. */
  policyClass?: number;
}

/** Bounded recommendation set. Missing cells intentionally stay absent. */
export const CPU_GAMING_EVIDENCE: readonly CpuGamingEvidenceRow[] = [
  { model: "5500GT", memoryType: "DDR4", vendor: "amd", gaming: { "RTX 5070": 78.1, "RTX 4060 Ti": 82.8, "RTX 3050": 93.9 }, captureSeconds: 851 },
  { model: "5600", memoryType: "DDR4", vendor: "amd", gaming: { "RTX 4090": 77.6, "RTX 5070": 88.6, "RTX 4060 Ti": 99.8 }, captureSeconds: 851 },
  { model: "7500F", memoryType: "DDR5", vendor: "amd", gaming: {}, policyClass: 98 },
  { model: "7600", memoryType: "DDR5", vendor: "amd", gaming: { "RTX 4090": 92.8, "RTX 5070": 98.6 }, captureSeconds: 839 },
  { model: "9600", memoryType: "DDR5", vendor: "amd", gaming: { "RTX 4090": 108.4 }, captureSeconds: 535 },
  { model: "9600X", memoryType: "DDR5", vendor: "amd", gaming: { "RTX 4090": 111.1 }, captureSeconds: 181 },
  { model: "9700X", memoryType: "DDR5", vendor: "amd", gaming: { "RTX 4090": 113.7 }, captureSeconds: 181 },
  { model: "7800X3D", memoryType: "DDR5", vendor: "amd", gaming: { "RTX 4090": 121.4, "RTX 5070": 115.5 }, captureSeconds: 181 },
  { model: "9800X3D", memoryType: "DDR5", vendor: "amd", gaming: { "RTX 4090": 128.4 }, captureSeconds: 181 },
  { model: "9850X3D", memoryType: "DDR5", vendor: "amd", gaming: { "RTX 4090": 130.5 }, captureSeconds: 181 },
  { model: "9900X3D", memoryType: "DDR5", vendor: "amd", gaming: { "RTX 4090": 122.5 }, captureSeconds: 181 },
  { model: "9950X3D", memoryType: "DDR5", vendor: "amd", gaming: { "RTX 4090": 125.6 }, captureSeconds: 181 },
  { model: "12100F", memoryType: "DDR4", vendor: "intel", gaming: { "RTX 4090": 68.2, "RTX 5070": 84.2, "RTX 4060 Ti": 95.5, "RTX 3050": 100 }, captureSeconds: 851 },
  { model: "14100F", memoryType: "DDR4", vendor: "intel", gaming: { "RTX 4090": 73.9, "RTX 5070": 87.4, "RTX 4060 Ti": 97.9, "RTX 3050": 100.8 }, captureSeconds: 851 },
  { model: "13400F", vendor: "intel", gaming: {}, policyClass: 90 },
  { model: "14400F", vendor: "intel", gaming: {}, policyClass: 92 },
  { model: "14600KF", memoryType: "DDR5", vendor: "intel", gaming: { "RTX 4090": 100.9, "RTX 5070": 100 }, captureSeconds: 839 },
  { model: "250KF", memoryType: "DDR5", vendor: "intel", gaming: { "RTX 4090": 105.5, "RTX 5070": 99.8 }, captureSeconds: 839 },
  { model: "265K", memoryType: "DDR5", vendor: "intel", gaming: { "RTX 4090": 102.5 }, captureSeconds: 839 },
  { model: "265KF", memoryType: "DDR5", vendor: "intel", gaming: { "RTX 4090": 102.5 }, captureSeconds: 839 }
];

export function cpuGamingModelFor(part: Part): string | undefined {
  const text = `${part.name} ${part.model ?? ""}`;
  return text.match(/\b(\d{4,5}(?:X3D|GT|KF|[XFKG])?|2[56]5?0?K?F?)\b/i)?.[1].toUpperCase();
}
export function cpuGamingEvidenceFor(part: Part | undefined): CpuGamingEvidenceRow | undefined {
  return part ? CPU_GAMING_EVIDENCE.find((row) => row.model === cpuGamingModelFor(part)) : undefined;
}
export function cpuGamingScoreFor(part: Part | undefined): number | undefined {
  const row = cpuGamingEvidenceFor(part);
  return row?.gaming["RTX 4090"] ?? row?.policyClass ?? (row?.model === "5500GT" ? 70 : undefined);
}
export function gamingSsdNameAllowed(name: string): boolean {
  return /^(?:ESSENCORE\s+)?KLEVV\s+CRAS\s+C910G\s+M\.2\s+NVMe(?:\s|\(|$)/i.test(name);
}
/** Explicit retail M.2 NVMe model families, checked against manufacturer product documents. */
export const GAMING_SSD_WHITELIST = {
  samsung: ["970 EVO Plus", "980", "980 PRO", "990 EVO", "990 EVO Plus", "990 PRO"],
  skHynix: ["P31", "P41"],
  klevv: ["C910G"]
} as const;
export function gamingSsdFamilyAllowed(part: Part): boolean {
  return part.category === "ssd" && gamingSsdNameAllowed(part.name) && (part.specs.capacityGb ?? 0) >= 500;
}
export function gamingFallbackSsdAllowed(part: Part): boolean {
  if (part.category !== "ssd" || (part.specs.capacityGb ?? 0) < 500 || !/M\.2/i.test(part.specs.formFactor ?? part.name) || !/NVMe/i.test(part.specs.interface ?? part.name)) return false;
  const identity = `${part.brand ?? ""} ${part.name}`;
  if (/Samsung|삼성전자/i.test(identity)) return /\b(?:970\s+EVO\s+Plus|980(?:\s+PRO)?|990\s+(?:EVO(?:\s+Plus)?|PRO))\b/i.test(part.name);
  return /SK\s*하이닉스|SK\s*hynix/i.test(identity) && /\bP(?:31|41)\b(?!\s*Plus)/i.test(part.name);
}
/** Call after actual price/listing/spec eligibility is established. No unavailable SKU is fabricated. */
export function gamingPreferredSsdCandidates(parts: readonly Part[], capacityGb: number): Part[] {
  const nominalCapacity = (part:Part) => [500,1000,2000,4000].find(step=>part.specs.capacityGb===step || part.specs.capacityGb===step*1.024) ?? part.specs.capacityGb ?? 0;
  // Automatic storage requests are a minimum. A larger reviewed SSD costing
  // less must not be discarded merely because the form says 500GB or more.
  const allowed = parts.filter(part => (part.specs.capacityGb??0)>=capacityGb && (part.specs.capacityGb??Infinity)<=capacityGb*2.048 && (gamingSsdFamilyAllowed(part)||gamingFallbackSsdAllowed(part)));
  const undominated = allowed.filter(part=>!allowed.some(other=>nominalCapacity(other)>nominalCapacity(part) && (other.priceWon??Infinity)<=(part.priceWon??Infinity)));
  const fixed = undominated.filter(gamingSsdFamilyAllowed);
  const preferred = fixed.length ? fixed : undominated.filter(gamingFallbackSsdAllowed);
  // Keep alternatives until the motherboard fit check. The generator selects
  // the lowest capacity cost from the compatible candidates.
  return [...preferred].sort((a,b) => (a.priceWon ?? Infinity) / a.specs.capacityGb! - (b.priceWon ?? Infinity) / b.specs.capacityGb!);
}

/** Reviewed pairings govern balance; measured percentages remain separate evidence. */
export function cpuGpuBalanceFor(cpu: Part | undefined, gpu: Part | undefined, memoryType?: string, gameIds: readonly string[] = []): CpuGpuBalanceAssessment | undefined {
  if (!cpu || !gpu) return undefined;
  const model = cpuGamingModelFor(cpu);
  const reference = model ? gamingReferenceForCpuModel(model) : undefined;
  const gpuName = `${gpu.name} ${gpu.model ?? ""}`;
  const exactGpu = referenceGpuModelFor(gpuName);
  const gpuModel = exactGpu ?? equivalentReferenceGpuModelFor(gpuName);
  if (!reference || !gpuModel) return undefined;
  let level = reference.levels[gpuModel];
  const contextRules: string[] = [exactGpu && DIRECTOR_PAIRING_REFERENCE_KEYS.includes(`${model}:${gpuModel}`) ? "director-pairing-reference" : "project-pairing-policy"];
  if (!exactGpu) contextRules.push("legacy-gpu-equivalence");
  if (hasPubgGameContext(gameIds) && !/X3D$/i.test(model!)) {
    // PUBG requires an X3D reference even when a non-X3D pair is otherwise good.
    if (level !== "too_weak") level = "slightly_weak";
    contextRules.push("pubg-requires-x3d");
  }
  const inverse = { too_weak: "too_strong", slightly_weak: "slightly_strong", good: "good", slightly_strong: "slightly_weak", too_strong: "too_weak" } as const;
  const recommendedCpuModels = GAMING_BUILD_REFERENCES.filter((candidate) => candidate.levels[gpuModel] === "good")
    .flatMap((candidate) => candidate.cpuModels).filter((candidate) => !hasPubgGameContext(gameIds) || /X3D$/.test(candidate));
  // Never attach a measurement from a different GPU column to a pairing grade.
  const row = cpuGamingEvidenceFor(cpu);
  const measured = exactGpu === "RTX 3050" || exactGpu === "RTX 5070" ? row?.gaming[exactGpu] : undefined;
  return { cpu: { level }, gpu: { level: inverse[level] }, recommendedCpuModels,
    referenceId: `${GAMING_BUILD_REFERENCE_VERSION}:${reference.id}:${gpuModel.replace(/ /g,"-").toLowerCase()}`,
    policyVersion: GAMING_BUILD_REFERENCE_VERSION, contextRules,
    ...(measured !== undefined && (memoryType === undefined || row?.memoryType === undefined || row.memoryType === memoryType) ? { cpuGamingPercent: measured, referenceGpuModel: exactGpu } : {}),
    evidence: "derived_policy" };
}
export function cpuMeetsGamingGpuFloor(cpu: Part | undefined, gpu: Part | undefined, cpuVendorPreference?: "amd" | "intel", gameIds: readonly string[] = []): boolean {
  if (!gpu) return true;
  const assessment = cpuGpuBalanceFor(cpu,gpu,undefined,gameIds);
  if (!assessment) return false;
  // A manually selected Intel platform can show an honest slight mismatch;
  // AUTO prefers a CPU that meets the reviewed GPU reference.
  return assessment.cpu.level !== "too_weak" && (cpuVendorPreference === "intel" || assessment.cpu.level !== "slightly_weak");
}

/** Price frontier uses whole viable platforms, not a frozen video CPU price. */
export function cpuGamingValueFrontier(cpus: readonly Part[], platformCostFor: (cpu: Part) => number): Part[] {
  const candidates = cpus.map((cpu) => ({ cpu, score: cpuGamingScoreFor(cpu), cost: platformCostFor(cpu) })).filter((row): row is {cpu: Part; score: number; cost: number} => row.score !== undefined && Number.isFinite(row.cost));
  return candidates.filter((row) => !candidates.some((other) => other.cpu.id !== row.cpu.id && other.cpu.specs.integratedGraphics === row.cpu.specs.integratedGraphics && other.score >= row.score && other.cost <= row.cost && (other.score > row.score || other.cost < row.cost))).map((row) => row.cpu);
}
