import { type Part, type CompatibilityResult, type BuildGenerationDiagnostic, type PartSelection, type RecommendationProfile, RECOMMENDATION_PROFILE_LABELS, type PartCategory, type GamingResolution, type GamingRefreshRate, type GpuTargetFit, type GpuTargetEvidence, GAMING_RESOLUTION_VRAM_TARGETS, GAMING_RESOLUTION_LABELS, GAMING_REFRESH_RATE_LABELS, type FindingSeverity, isKnownPrice, type PciePowerRequirement, type BuildSelection, type PhysicalEvidenceSummary, type Finding, type SimilarityDimensionEvidence, type SimilarityBasis, type SimilarityEvidence, type UpgradeCompatibilityEvidence, type UpgradeBudgetEvidence, type UpgradeExpansionEvidence, type UpgradeRecommendation, type SimilarityConfidence, type ValueLabel, type ValueEvidence, type GpuVendor } from "../../types";
import { classifyDataFreshness } from "../data-health";
import { type EngineTargetFiltersConfig } from "../../engine-target-filters";
import { type ReferenceBuild } from "../../reference-builds";
import { type GamingFpsReference } from "../../gaming-target-assessment";
import { catalogMissingFieldLabelFor } from "../../catalog-spec-coverage";
import { scoreCachedByIdentity } from "../../generator-score-cache";
import { gpuPurchaseEvidenceFor, pciePowerMatchFor, pcieCableTopologyStatusFor } from "../../gpu-fit";
import { physicalSourceCheckNeedsReview } from "../../physical-source-check";
import { OBJECTIVE_BENCHMARK_DIMENSION_KEYS, type ObjectiveScore, type ObjectiveScoreExtraTerm, objectiveScoreForDimensions } from "../../objective-score";
import { savedBuildComparisonExpansionFor } from "../../saved-build-comparison";
import { VALUE_SCORE_MAX } from "../../value-score";
import { type GamingAdvisoryTuning } from "../../gaming-catalog";
import { gpuGamingIndexFor, cpuRelativeIndexFor, CPU_SINGLE_REFERENCE, CPU_MULTI_REFERENCE } from "../../relative-performance-index";

export const ENGINE_VERSION = "2.64.0";

export function benchmarkFreshnessFor(part: Part) {
  return classifyDataFreshness(part.specs.benchmarkProvenance?.updatedAt ?? part.updatedAt);
}

export type EvaluationCache = Map<string, CompatibilityResult>;
const catalogPartIndexCache = new WeakMap<Part[], Map<string, Part>>();

export type EngineClockOptions = {
  now?: string | number;
};

export type EngineGenerationOptions = EngineClockOptions & {
  targetFilters?: EngineTargetFiltersConfig;
  /** Budget-first gaming test bed; general catalog and other profiles retain their policy. */
  gamingTestbedPhase1?: boolean;
  /** 미지정 시 내장 참조 견적표를 쓰고, 빈 배열이면 참조 유도를 끈다. */
  referenceBuilds?: readonly ReferenceBuild[];
  gamingFpsReferences?: readonly GamingFpsReference[];
};

function catalogPartIndexFor(catalog: Part[]) {
  const cached = catalogPartIndexCache.get(catalog);
  if (cached) return cached;
  const index = new Map<string, Part>();
  for (const part of catalog) {
    if (!index.has(part.id)) index.set(part.id, part);
  }
  catalogPartIndexCache.set(catalog, index);
  return index;
}

export class BuildGenerationError extends Error {
  readonly diagnostics: BuildGenerationDiagnostic[];

  constructor(message: string, diagnostics: BuildGenerationDiagnostic[]) {
    super(message);
    this.name = "BuildGenerationError";
    this.diagnostics = diagnostics;
  }
}

export type SelectionWithPart = {
  selection: PartSelection;
  part: Part;
};

const PROFILE_SUMMARIES: Record<RecommendationProfile, string> = {
  general: `${RECOMMENDATION_PROFILE_LABELS.general} 기준 / 호환성과 현재 스펙 유사도를 우선 비교합니다.`,
  gaming: `${RECOMMENDATION_PROFILE_LABELS.gaming} 기준 / GPU VRAM/그래픽 처리 여유/메모리 속도를 더 중요하게 봅니다.`,
  creator: `${RECOMMENDATION_PROFILE_LABELS.creator} 기준 / CPU 병렬성/메모리 용량/SSD 쓰기 성능을 더 중요하게 봅니다.`,
  development: `${RECOMMENDATION_PROFILE_LABELS.development} 기준 / CPU 병렬성/메모리 용량/저장장치 용량을 더 중요하게 봅니다.`,
  office: `${RECOMMENDATION_PROFILE_LABELS.office} 기준 / 기본 성능/확장성/가격 변화를 함께 비교합니다.`
};

type ProfileWeightMap = Partial<Record<PartCategory, Record<string, number>>>;

const PROFILE_WEIGHT_OVERRIDES: Record<RecommendationProfile, ProfileWeightMap> = {
  general: {},
  gaming: {
    cpu: { cinebenchR23Single: 7, cinebenchR23Multi: 1, boostClockGhz: 4, cores: 1, threads: 1, l3CacheMb: 5 },
    gpu: { gpuStreamProcessors: 5, gpuMemoryBandwidthGbps: 5, gpuBoostClockMhz: 3, vramGb: 6 },
    memory: { speedMhz: 5, capacityGb: 2, memoryCasLatency: 3 },
    ssd: { sequentialReadMbps: 4, sequentialWriteMbps: 2, capacityGb: 1, ssdReadIops: 3, ssdWriteIops: 2 }
  },
  creator: {
    cpu: { cinebenchR23Single: 3, cinebenchR23Multi: 7, cores: 5, threads: 5, boostClockGhz: 2 },
    gpu: { gpuStreamProcessors: 3, gpuMemoryBandwidthGbps: 4, gpuBoostClockMhz: 2, vramGb: 3 },
    memory: { capacityGb: 6, speedMhz: 2, memoryCasLatency: 2 },
    ssd: { sequentialWriteMbps: 5, sequentialReadMbps: 3, capacityGb: 2, ssdReadIops: 3, ssdWriteIops: 4 }
  },
  development: {
    cpu: { cinebenchR23Single: 3, cinebenchR23Multi: 6, cores: 4, threads: 5, boostClockGhz: 1 },
    memory: { capacityGb: 6, speedMhz: 2, memoryCasLatency: 2 },
    ssd: { capacityGb: 4, sequentialReadMbps: 3, sequentialWriteMbps: 3, ssdReadIops: 3, ssdWriteIops: 3 },
    gpu: { vramGb: 3 }
  },
  office: {
    cpu: { boostClockGhz: 3, cores: 2 },
    motherboard: { maxMemoryGb: 3, memorySlots: 2, m2Slots: 2 },
    memory: { capacityGb: 3, speedMhz: 2, memoryCasLatency: 1 },
    ssd: { sequentialReadMbps: 2, capacityGb: 2, ssdReadIops: 1, ssdWriteIops: 1 },
    case: { maxCoolerHeightMm: 2, hddBays: 2 }
  }
};

const GPU_RESOLUTION_WEIGHT_OVERRIDES: Record<GamingResolution, Record<string, number>> = {
  "1080p": { gpuStreamProcessors: 6, gpuMemoryBandwidthGbps: 4, gpuBoostClockMhz: 2, vramGb: 3 },
  "1440p": { gpuStreamProcessors: 6, gpuMemoryBandwidthGbps: 6, gpuBoostClockMhz: 2, vramGb: 5 },
  "4k": { gpuStreamProcessors: 5, gpuMemoryBandwidthGbps: 7, gpuBoostClockMhz: 2, vramGb: 7 }
};

export const DEFAULT_GAMING_RESOLUTION: GamingResolution = "1440p";
export const DEFAULT_GAMING_REFRESH_RATE: GamingRefreshRate = 144;
const GAMING_REFRESH_RATE_WEIGHT_OVERRIDES: Record<GamingRefreshRate, Partial<Record<PartCategory, Record<string, number>>>> = {
  60: {
    cpu: { cinebenchR23Single: 5, cinebenchR23Multi: 3, cores: 2, threads: 1, boostClockGhz: 2, l3CacheMb: 4 },
    gpu: { gpu3dmarkTimeSpyScore: 5, gpu3dmarkPortRoyalScore: 4, gpuStreamProcessors: 5, gpuMemoryBandwidthGbps: 4, gpuBoostClockMhz: 2 }
  },
  144: {
    cpu: { cinebenchR23Single: 8, cinebenchR23Multi: 1, cores: 1, threads: 1, boostClockGhz: 3, l3CacheMb: 6 },
    gpu: { gpu3dmarkTimeSpyScore: 7, gpu3dmarkPortRoyalScore: 5, gpuStreamProcessors: 6, gpuMemoryBandwidthGbps: 6, gpuBoostClockMhz: 2 }
  },
  240: {
    cpu: { cinebenchR23Single: 10, cinebenchR23Multi: 1, cores: 1, threads: 1, boostClockGhz: 4, l3CacheMb: 8 },
    gpu: { gpu3dmarkTimeSpyScore: 9, gpu3dmarkPortRoyalScore: 5, gpuStreamProcessors: 8, gpuMemoryBandwidthGbps: 6, gpuBoostClockMhz: 3 }
  }
};

export function profileSummaryFor(profile: RecommendationProfile) {
  return PROFILE_SUMMARIES[profile];
}

function gpuTargetFitFor(vramGb: number | undefined, targetVramGb: number): GpuTargetFit {
  if (vramGb === undefined || !Number.isFinite(vramGb) || vramGb <= 0) return "unknown";
  return vramGb >= targetVramGb ? "met" : "partial";
}

function gpuTargetFitLabel(fit: GpuTargetFit) {
  return fit === "met" ? "권장 기준 충족" : fit === "partial" ? "권장 기준 미달" : "VRAM 확인 필요";
}

export function formatTargetVram(vramGb: number | undefined) {
  return vramGb === undefined ? "확인 불가" : `${vramGb}GB`;
}

export function gpuTargetEvidenceFor(current: Part, candidate: Part | undefined, resolution: GamingResolution, refreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE, targetVramOverride?: number): GpuTargetEvidence | undefined {
  if (current.category !== "gpu") return undefined;
  const targetVramGb = targetVramOverride ?? GAMING_RESOLUTION_VRAM_TARGETS[resolution];
  const currentVramGb = current.specs.vramGb;
  const candidateVramGb = candidate?.specs.vramGb;
  const currentFit = gpuTargetFitFor(currentVramGb, targetVramGb);
  const candidateFit = candidate ? gpuTargetFitFor(candidateVramGb, targetVramGb) : undefined;
  const resolutionLabel = GAMING_RESOLUTION_LABELS[resolution];
  const refreshRateLabel = GAMING_REFRESH_RATE_LABELS[refreshRate];
  const summary = candidate
    ? `${resolutionLabel} / ${refreshRateLabel} / 권장 VRAM ${targetVramGb}GB / 현재 ${formatTargetVram(currentVramGb)} → 부품 ${formatTargetVram(candidateVramGb)} / ${gpuTargetFitLabel(candidateFit ?? "unknown")}`
    : `${resolutionLabel} / ${refreshRateLabel} / 권장 VRAM ${targetVramGb}GB / 현재 ${formatTargetVram(currentVramGb)} / ${gpuTargetFitLabel(currentFit)}`;
  return {
    resolution,
    refreshRate,
    targetVramGb,
    ...(currentVramGb !== undefined ? { currentVramGb } : {}),
    ...(candidateVramGb !== undefined ? { candidateVramGb } : {}),
    currentFit,
    ...(candidateFit ? { candidateFit } : {}),
    summary
  };
}

function gpuTargetScoreFor(part: Part, resolution: GamingResolution, targetVramOverride?: number) {
  if (part.category !== "gpu") return undefined;
  const targetVramGb = targetVramOverride ?? GAMING_RESOLUTION_VRAM_TARGETS[resolution];
  const vramGb = part.specs.vramGb;
  if (vramGb === undefined || !Number.isFinite(vramGb) || vramGb <= 0) return 50;
  return Math.max(0, Math.min(100, Math.round((vramGb / targetVramGb) * 100)));
}

export const severityRank: Record<FindingSeverity, number> = {
  blocker: 0,
  unknown: 1,
  warning: 2,
  info: 3
};

export function candidateCompatibilityDeltaFindings(baseline: CompatibilityResult, evaluation: CompatibilityResult, candidateId: string) {
  const baselineByRule = new Map(baseline.findings.map((finding) => [finding.ruleId, finding]));
  return evaluation.findings
    .filter((finding) => finding.affectedPartIds.includes(candidateId))
    .filter((finding) => {
      const previous = baselineByRule.get(finding.ruleId);
      return !previous || severityRank[finding.severity] < severityRank[previous.severity];
    });
}

export function candidateDataQualityReasonsFor(candidate: Part) {
  if (candidate.dataQuality !== "incomplete" && candidate.missingFields.length === 0) return [];
  const missingFields = candidate.missingFields.map((field) => catalogMissingFieldLabelFor(field));
  return [missingFields.length > 0 ? `필수 스펙 미확인: ${missingFields.join(", ")}` : "필수 스펙 미확인"];
}

// 후보 풀을 줄일 때도 확인 우선 후보가 유사도 상위권 밖으로 밀려나지 않도록
// 점수 계산과 같은 입력 축을 사용하는 정렬용 점수입니다. 최종 추천 순서는
// 후보를 실제로 적용한 뒤 계산하는 recommendationTrust를 사용합니다.
const reliabilityDataQualityPoints: Record<Part["dataQuality"], number> = {
  manual: 40,
  live: 32,
  seed: 18,
  incomplete: 0
};

const reliabilityFreshnessPoints: Record<ReturnType<typeof classifyDataFreshness>, number> = {
  fresh: 12,
  aging: 7,
  stale: 1,
  unknown: 0
};

export function partReliabilityScoreFor(part: Part, cache?: Map<Part, number>) {
  const compute = () => {
    const freshness = classifyDataFreshness(part.updatedAt);
    const missingFieldScore = part.missingFields.length === 0
      ? 14
      : Math.max(0, 10 - part.missingFields.length * 2);
    return reliabilityDataQualityPoints[part.dataQuality]
      + reliabilityFreshnessPoints[freshness]
      + missingFieldScore
      + (isKnownPrice(part.priceWon) ? 6 : 0)
      + (part.danawaUrl ? 5 : 0)
      + (part.specs.catalogSpecProvenance ? 4 : 0)
      + (part.specs.benchmarkProvenance ? 2 : 0);
  };
  return cache ? scoreCachedByIdentity(cache, part, compute) : compute();
}

export function selectedPart(catalog: Part[], selection: PartSelection | undefined) {
  if (!selection) return undefined;
  return catalogPartIndexFor(catalog).get(selection.partId);
}

export function selectedParts(catalog: Part[], selections: PartSelection[]) {
  return selections
    .map((selection) => {
      const part = selectedPart(catalog, selection);
      return part ? { selection, part } : undefined;
    })
    .filter((item): item is SelectionWithPart => Boolean(item));
}

export function physicalMemoryModuleCount(memory: SelectionWithPart[]) {
  return memory.reduce(
    (total, { selection, part }) => total + selection.quantity * (part.specs.memoryModuleCountPerKit ?? 1),
    0
  );
}

export const SYSTEM_BASE_LOAD_W = 100;
export const PSU_LOAD_HEADROOM_RATIO = 1.2;
const VRM_ENTRY_VCORE_OUTPUT_A = 300;
// 저전력 CPU용으로 나온 칩셋. 제조사가 고전력 CPU의 전력 한도를 낮추는 경우가 많다.
const VRM_ENTRY_CHIPSETS = new Set(["A320", "A520", "A620", "H310", "H410", "H510", "H610", "H810"]);

function motherboardChipsetFor(motherboard: Part) {
  return motherboard.specs.chipset ?? motherboard.name.match(/\b([ABHQWXZ]\d{3})/)?.[1];
}

type MotherboardVrmTier = { tier: "entry" | "standard"; reason: string } | { tier: "unknown" };

export function motherboardVrmTierFor(motherboard: Part): MotherboardVrmTier {
  const chipset = motherboardChipsetFor(motherboard);
  const outputA = motherboard.specs.vrmVcoreOutputA;
  if (chipset && VRM_ENTRY_CHIPSETS.has(chipset.slice(0, 4).toUpperCase())) return { tier: "entry", reason: `보급형 칩셋 ${chipset}` };
  if (outputA !== undefined && outputA <= VRM_ENTRY_VCORE_OUTPUT_A) return { tier: "entry", reason: `Vcore 출력 합계 ${outputA}A` };
  if (outputA !== undefined) return { tier: "standard", reason: `Vcore 출력 합계 ${outputA}A` };
  if (chipset) return { tier: "standard", reason: `칩셋 ${chipset}` };
  return { tier: "unknown" };
}

// 킷당 모듈 수가 없으면 capacityGb가 킷 합계인지 모듈 1개인지 알 수 없어 모듈 용량을 정하지 않는다.
export function memoryModuleCapacityGb(part: Part) {
  const { capacityGb, memoryModuleCountPerKit } = part.specs;
  if (capacityGb === undefined || memoryModuleCountPerKit === undefined || memoryModuleCountPerKit < 1) return undefined;
  return capacityGb / memoryModuleCountPerKit;
}

// 소비자용 ATX/E-ATX/mATX 데스크톱 보드는 사실상 모두 DIMM 슬롯이다. ITX는 Thin Mini-ITX가
// SO-DIMM을 쓰므로 추론하지 않고, 모바일 CPU 온보드 보드를 거르기 위해 데스크톱 소켓이 확인된 보드만 추론한다.
const DESKTOP_DIMM_BOARD_FORM_FACTORS = new Set(["ATX", "E-ATX", "mATX"]);
const DESKTOP_CPU_SOCKET_PATTERN = /^(?:AM\d|LGA\d{4}(?:-V\d+)?|S?TRX?\d|SWRX\d)$/i;

export function motherboardMemorySlotFormFactorFor(motherboard: Part): { formFactor?: "DIMM" | "SO-DIMM"; inferred: boolean } {
  const { memoryFormFactor, formFactor, socket } = motherboard.specs;
  if (memoryFormFactor) return { formFactor: memoryFormFactor, inferred: false };
  if (formFactor && DESKTOP_DIMM_BOARD_FORM_FACTORS.has(formFactor) && socket && DESKTOP_CPU_SOCKET_PATTERN.test(socket)) {
    return { formFactor: "DIMM", inferred: true };
  }
  return { inferred: false };
}

export function isTwoPointFiveInchStorage(part: Part) {
  return storageFormFactorFamily(part.specs.formFactor) === "2.5";
}

// 대부분의 3.5인치 트레이는 2.5인치 나사 구멍을 갖춘 겸용이라, HDD가 쓰지 않는 3.5인치 베이도 2.5인치 장착 공간으로 센다.
export function twoPointFiveInchMountCapacity(computerCase: Part, hdds: SelectionWithPart[]) {
  const hddCount = hdds.reduce((total, { selection }) => total + selection.quantity, 0);
  const spareHddBays = Math.max(0, (computerCase.specs.hddBays ?? 0) - hddCount);
  return (computerCase.specs.ssdBays ?? 0) + spareHddBays;
}

// DDR5/DDR4를 모두 지원하는 CPU(인텔 12~14세대)는 RAM 세대에 맞는 공식 속도를 쓴다.
export function cpuMemorySpeedLimitFor(cpu: Part | undefined, memoryType: string | undefined) {
  const byType = cpu?.specs.maxMemorySpeedMhzByType;
  const typed = memoryType === "DDR4" || memoryType === "DDR5" ? byType?.[memoryType] : undefined;
  return typed ?? cpu?.specs.maxMemorySpeedMhz;
}

// toLocaleString("ko-KR")은 호출마다 Intl 포매터를 새로 만든다 — 호환 검사
// 한 번에 수만 번 불리므로 같은 출력을 내는 포매터를 재사용한다.
export const KO_NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

export function formatPrice(value: number) {
  return `${KO_NUMBER_FORMAT.format(Math.round(value))}원`;
}

export function pcieEightPinRequirementCount(requirements: PciePowerRequirement[]) {
  return requirements
    .filter((requirement) => requirement.kind === "pcie_8pin_6plus2")
    .reduce((total, requirement) => total + requirement.count, 0);
}

export function cloneBuild(build: BuildSelection): BuildSelection {
  return {
    ...build,
    memory: build.memory.map((item) => ({ ...item })),
    ssd: build.ssd.map((item) => ({ ...item })),
    hdd: build.hdd.map((item) => ({ ...item })),
    accessories: build.accessories?.map((item) => ({ ...item })),
    m2SlotSelection: build.m2SlotSelection ? { ...build.m2SlotSelection } : undefined
  };
}

export function recommendedMemoryKitQuantity(build: BuildSelection, catalog: Part[], candidate: Part) {
  if (candidate.category !== "memory") return undefined;
  const memory = selectedParts(catalog, build.memory);
  if (memory.length === 0 || candidate.specs.capacityGb === undefined || candidate.specs.capacityGb <= 0) return undefined;
  if (memory.some(({ part }) => part.specs.capacityGb === undefined)) return undefined;
  const totalCapacityGb = memory.reduce(
    (total, { selection, part }) => total + (part.specs.capacityGb ?? 0) * selection.quantity,
    0
  );
  const quantity = Math.max(1, Math.ceil(totalCapacityGb / candidate.specs.capacityGb));
  if (quantity > 99) return undefined;
  const motherboard = selectedPart(catalog, build.motherboard);
  if (motherboard?.specs.memorySlots !== undefined) {
    const modulesPerKit = candidate.specs.memoryModuleCountPerKit;
    if (modulesPerKit === undefined) return undefined;
    if (quantity * modulesPerKit > motherboard.specs.memorySlots) return undefined;
  }
  return quantity;
}

export function replaceSelection(build: BuildSelection, category: PartCategory, partId: string, quantityOverride?: number): BuildSelection {
  const next = cloneBuild(build);
  if (category === "memory") {
    next.memory = [{ partId, quantity: quantityOverride ?? next.memory[0]?.quantity ?? 2 }];
  } else if (category === "ssd") {
    next.ssd = [{ partId, quantity: next.ssd[0]?.quantity ?? 1 }];
  } else if (category === "hdd") {
    next.hdd = [{ partId, quantity: next.hdd[0]?.quantity ?? 1 }];
  } else {
    next[category] = { partId, quantity: build[category]?.quantity ?? 1 };
  }
  if (category === "motherboard" || category === "ssd") delete next.m2SlotSelection;
  return next;
}

export function buildPriceInfo(catalog: Part[], build: BuildSelection) {
  const singleSelections = [build.cpu, build.cooler, build.motherboard, build.gpu, build.case, build.psu]
    .filter((selection): selection is PartSelection => Boolean(selection));
  const singleParts = singleSelections.map((selection) => ({ selection, part: selectedPart(catalog, selection) }));
  const multi = [
    ...selectedParts(catalog, build.memory),
    ...selectedParts(catalog, build.ssd),
    ...selectedParts(catalog, build.hdd)
  ];
  const partsComplete = singleParts.length === singleSelections.length
    && singleParts.every(({ part }) => isKnownPrice(part?.priceWon))
    && multi.every(({ part }) => isKnownPrice(part.priceWon));
  const total = [
    ...singleParts.map(({ selection, part }) => (part?.priceWon ?? 0) * selection.quantity),
    ...multi.map(({ selection, part }) => (part.priceWon ?? 0) * selection.quantity)
  ].reduce((sum, price) => sum + price, 0);
  return { total, complete: partsComplete };
}

export function currentCategoryPart(catalog: Part[], build: BuildSelection, category: PartCategory) {
  const selection = category === "memory" ? build.memory[0] : category === "ssd" ? build.ssd[0] : category === "hdd" ? build.hdd[0] : build[category];
  return selectedPart(catalog, selection);
}

export function categorySelections(build: BuildSelection, category: PartCategory): PartSelection[] {
  if (category === "memory") return build.memory;
  if (category === "ssd") return build.ssd;
  if (category === "hdd") return build.hdd;
  const selection = build[category];
  return selection ? [selection] : [];
}

export function selectedCorePartIds(build: BuildSelection) {
  return new Set([
    build.cpu?.partId,
    build.cooler?.partId,
    build.motherboard?.partId,
    build.gpu?.partId,
    build.case?.partId,
    build.psu?.partId,
    ...build.memory.map((selection) => selection.partId),
    ...build.ssd.map((selection) => selection.partId),
    ...build.hdd.map((selection) => selection.partId)
  ].filter((partId): partId is string => Boolean(partId)));
}

export function physicalEvidenceSummaryFor(targetCategory: PartCategory, evaluation: CompatibilityResult): PhysicalEvidenceSummary | undefined {
  if (targetCategory !== "gpu" && targetCategory !== "case" && targetCategory !== "psu") return undefined;
  if (!evaluation.gpuFit) return undefined;
  const evidence = gpuPurchaseEvidenceFor(evaluation.gpuFit);
  const sources = evidence.sources && evidence.sources.length > 0 ? { sources: evidence.sources } : {};
  if (evidence.status === "not_applicable") return { status: "not_applicable", summary: "현재 구성에서는 GPU 물리/PCIe 케이블 확인이 적용되지 않습니다.", ...sources };
  if (evidence.status === "compatible") return { status: "verified", summary: "필요한 GPU/케이스 물리와 PCIe 케이블 정보가 확인되었습니다.", ...sources };
  const missing: string[] = [];
  if (evidence.sources?.some((source) => physicalSourceCheckNeedsReview(source.sourceCheck, Boolean(source.url)))) missing.push("정보 URL/모델 식별");
  if (evidence.physical === "needs_review") missing.push("GPU/케이스 장착 정보");
  if (evidence.pcieCableTopology === "needs_review") missing.push("다중 8핀 케이블 연결 방식 정보");
  return { status: "review", summary: `${missing.join(" / ") || "장착 정보"}를 구매 전 확인해야 합니다.`, ...sources };
}

function storageFormFactorFamily(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replace(/\s/g, "");
  if (normalized.includes("m.2")) {
    const dimension = normalized.match(/(2242|2260|2280|22110)/)?.[1];
    return `m2:${dimension ?? "generic"}`;
  }
  if (normalized.includes("2.5") || normalized.includes("6.4cm")) return "2.5";
  if (normalized.includes("3.5") || normalized.includes("8.9cm")) return "3.5";
  return normalized;
}

function storageFormFactorsMatch(current: string, candidate: string) {
  if (current.startsWith("m2:") && candidate.startsWith("m2:")) {
    const currentDimension = current.slice(3);
    const candidateDimension = candidate.slice(3);
    return currentDimension === "generic"
      || candidateDimension === "generic"
      || currentDimension === candidateDimension;
  }
  return current === candidate;
}

function candidatePreservesStorageIntent(
  finding: Finding,
  build: BuildSelection,
  catalog: Part[],
  targetCategory: PartCategory,
  candidate: Part
) {
  if (targetCategory !== "ssd" && targetCategory !== "hdd") return true;
  const current = catalog.find((part) => part.category === targetCategory && finding.affectedPartIds.includes(part.id))
    ?? currentCategoryPart(catalog, build, targetCategory);
  if (!current) return true;

  const currentFormFactor = storageFormFactorFamily(current.specs.formFactor);
  const candidateFormFactor = storageFormFactorFamily(candidate.specs.formFactor);
  if (currentFormFactor && (!candidateFormFactor || !storageFormFactorsMatch(currentFormFactor, candidateFormFactor))) return false;
  if (current.specs.capacityGb !== undefined && (candidate.specs.capacityGb === undefined || candidate.specs.capacityGb < current.specs.capacityGb)) return false;
  return true;
}

export function candidateIsPlausible(finding: Finding, build: BuildSelection, candidate: Part, catalog: Part[], targetCategoryOverride?: PartCategory) {
  const targetCategory = targetCategoryOverride ?? finding.actions.find((item) => item.type === "replace_part")?.targetCategory;
  if (!targetCategory || candidate.category !== targetCategory) return false;
  const cpu = selectedPart(catalog, build.cpu);
  const motherboard = selectedPart(catalog, build.motherboard);
  const gpu = selectedPart(catalog, build.gpu);
  const computerCase = selectedPart(catalog, build.case);
  const psu = selectedPart(catalog, build.psu);
  const cooler = selectedPart(catalog, build.cooler);
  const memory = selectedParts(catalog, build.memory);
  const ssds = selectedParts(catalog, build.ssd);
  const hdds = selectedParts(catalog, build.hdd);
  const totalMemoryGb = memory.every(({ part }) => part.specs.capacityGb !== undefined)
    ? memory.reduce((total, { selection, part }) => total + (part.specs.capacityGb ?? 0) * selection.quantity, 0)
    : undefined;
  const memoryCount = physicalMemoryModuleCount(memory);
  const memoryFormFactors = [...new Set(memory.map(({ part }) => part.specs.formFactor).filter((formFactor): formFactor is string => Boolean(formFactor)))];
  const m2Count = ssds.every(({ part }) => part.specs.formFactor !== undefined)
    ? ssds.reduce((total, { selection, part }) => total + (part.specs.formFactor?.toLowerCase().includes("m.2") ? selection.quantity : 0), 0)
    : undefined;
  const m2Parts = ssds.filter(({ part }) => part.specs.formFactor?.toLowerCase().includes("m.2"));
  const requiredM2Interfaces = [...new Set(
    m2Parts
      .map(({ part }) => part.specs.interface)
      .filter((value): value is "NVMe" | "SATA" => value === "NVMe" || value === "SATA")
  )];
  const hddCount = hdds.reduce((total, { selection }) => total + selection.quantity, 0);

  if (!candidatePreservesStorageIntent(finding, build, catalog, targetCategory, candidate)) return false;

  if (finding.ruleId === "cpu-motherboard-socket") {
    if (targetCategory === "motherboard" && cpu?.specs.socket) return candidate.specs.socket !== undefined && candidate.specs.socket === cpu.specs.socket;
    if (targetCategory === "cpu" && motherboard?.specs.socket) return candidate.specs.socket !== undefined && candidate.specs.socket === motherboard.specs.socket;
  }
  if (finding.ruleId === "cpu-motherboard-power") {
    const cpuPower = cpu?.specs.pptW ?? cpu?.specs.tdpW;
    if (targetCategory === "motherboard" && cpuPower !== undefined) {
      if (candidate.specs.vrmCapacityW !== undefined) return candidate.specs.vrmCapacityW >= cpuPower;
      return motherboardVrmTierFor(candidate).tier === "standard";
    }
  }
  if (finding.ruleId === "memory-type") {
    const expected = targetCategory === "motherboard" ? cpu?.specs.memoryType : motherboard?.specs.memoryType;
    if (expected) return candidate.specs.memoryType !== undefined && candidate.specs.memoryType === expected;
  }
  if (finding.ruleId === "memory-profile") {
    const selectedProfiles = [...new Set(memory.flatMap(({ part }) => part.specs.memoryProfiles ?? []))];
    if (targetCategory === "motherboard" && selectedProfiles.length > 0) {
      return candidate.specs.memoryProfiles !== undefined && selectedProfiles.every((profile) => candidate.specs.memoryProfiles!.includes(profile));
    }
    if (targetCategory === "memory" && motherboard?.specs.memoryProfiles && motherboard.specs.memoryProfiles.length > 0) {
      return candidate.specs.memoryProfiles !== undefined && candidate.specs.memoryProfiles.some((profile) => motherboard.specs.memoryProfiles!.includes(profile));
    }
  }
  if (finding.ruleId === "memory-mixing" && targetCategory === "memory") {
    return recommendedMemoryKitQuantity(build, catalog, candidate) !== undefined;
  }
  if (finding.ruleId === "memory-form-factor") {
    const boardSlotFormFactor = motherboard ? motherboardMemorySlotFormFactorFor(motherboard).formFactor : undefined;
    if (targetCategory === "motherboard" && memoryFormFactors.length === 1) {
      const candidateSlotFormFactor = motherboardMemorySlotFormFactorFor(candidate).formFactor;
      return candidateSlotFormFactor !== undefined && candidateSlotFormFactor === memoryFormFactors[0];
    }
    if (targetCategory === "memory" && boardSlotFormFactor) return candidate.specs.formFactor !== undefined && candidate.specs.formFactor === boardSlotFormFactor;
  }
  if (finding.ruleId === "memory-capacity" && targetCategory === "motherboard" && totalMemoryGb !== undefined) return candidate.specs.maxMemoryGb !== undefined && candidate.specs.maxMemoryGb >= totalMemoryGb;
  if (finding.ruleId === "memory-slots" && targetCategory === "motherboard") return candidate.specs.memorySlots !== undefined && candidate.specs.memorySlots >= memoryCount;
  if (finding.ruleId === "memory-module-capacity" && targetCategory === "motherboard") {
    const largestModuleGb = Math.max(0, ...memory.map(({ part }) => memoryModuleCapacityGb(part) ?? 0));
    return candidate.specs.maxMemoryGb !== undefined
      && candidate.specs.memorySlots !== undefined
      && candidate.specs.memorySlots > 0
      && candidate.specs.maxMemoryGb / candidate.specs.memorySlots >= largestModuleGb;
  }
  if (finding.ruleId === "m2-slots" && targetCategory === "motherboard" && m2Count !== undefined) return candidate.specs.m2Slots !== undefined && candidate.specs.m2Slots >= m2Count;
  if (finding.ruleId === "m2-interface") {
    if (targetCategory === "motherboard" && requiredM2Interfaces.length > 0) {
      return candidate.specs.m2Interfaces !== undefined && requiredM2Interfaces.every((interfaceName) => candidate.specs.m2Interfaces!.includes(interfaceName));
    }
    if (targetCategory === "ssd" && motherboard?.specs.m2Interfaces && motherboard.specs.m2Interfaces.length > 0) {
      return candidate.specs.formFactor?.toLowerCase().includes("m.2") === true
        && candidate.specs.interface !== undefined
        && motherboard.specs.m2Interfaces.includes(candidate.specs.interface as "NVMe" | "SATA");
    }
  }
  if (finding.ruleId === "m2-pcie-generation") {
    const currentNvmeGenerations = m2Parts
      .filter(({ part }) => part.specs.interface === "NVMe")
      .map(({ part }) => part.specs.m2PcieGeneration)
      .filter((value): value is number => value !== undefined);
    const motherboardGenerations = motherboard?.specs.m2PcieGenerations;
    const motherboardMaxGeneration = motherboardGenerations && motherboardGenerations.length > 0 ? Math.max(...motherboardGenerations) : undefined;
    const requiredGeneration = currentNvmeGenerations.length > 0 ? Math.max(...currentNvmeGenerations) : undefined;
    if (targetCategory === "motherboard" && requiredGeneration !== undefined) {
      return candidate.specs.m2PcieGenerations !== undefined
        && candidate.specs.m2PcieGenerations.length > 0
        && Math.max(...candidate.specs.m2PcieGenerations) >= requiredGeneration;
    }
    if (targetCategory === "ssd" && motherboardMaxGeneration !== undefined) {
      return candidate.specs.interface === "NVMe"
        && candidate.specs.m2PcieGeneration !== undefined
        && candidate.specs.m2PcieGeneration <= motherboardMaxGeneration;
    }
  }
  if (finding.ruleId === "m2-slot-pcie-generation" && targetCategory === "ssd") {
    const registeredGenerations = motherboard?.specs.m2SlotProfiles
      ?.map((profile) => profile.pcieGeneration)
      .filter((value): value is number => value !== undefined);
    const maximumRegisteredGeneration = registeredGenerations && registeredGenerations.length > 0
      ? Math.max(...registeredGenerations)
      : undefined;
    return candidate.specs.interface === "NVMe"
      && candidate.specs.formFactor?.toLowerCase().includes("m.2")
      && candidate.specs.m2PcieGeneration !== undefined
      && (maximumRegisteredGeneration === undefined || candidate.specs.m2PcieGeneration <= maximumRegisteredGeneration);
  }
  if (finding.ruleId === "gpu-motherboard-pcie") {
    const gpuSlotWidth = gpu?.specs.pcieSlotWidth;
    if (targetCategory === "motherboard" && gpuSlotWidth !== undefined && (gpuSlotWidth === 16 || gpuSlotWidth === 8)) {
      return candidate.specs.pcieX16Slots !== undefined
        && (gpuSlotWidth === 16 ? candidate.specs.pcieX16Slots > 0 : candidate.specs.pcieX16Slots > 0 || (candidate.specs.pcieX8Slots ?? 0) > 0);
    }
    if (targetCategory === "gpu" && motherboard?.specs.pcieX16Slots !== undefined) {
      return candidate.specs.pcieSlotWidth !== undefined
        && (candidate.specs.pcieSlotWidth === 16 || candidate.specs.pcieSlotWidth === 8)
        && (candidate.specs.pcieSlotWidth === 16 ? motherboard.specs.pcieX16Slots > 0 : motherboard.specs.pcieX16Slots > 0 || (motherboard.specs.pcieX8Slots ?? 0) > 0);
    }
  }
  if (finding.ruleId === "gpu-psu-connector") {
    const gpuPowerOptions = gpu?.specs.pciePowerOptions;
    if (targetCategory === "psu" && gpuPowerOptions) {
      return candidate.specs.pciePowerConnectors !== undefined
        && pciePowerMatchFor(gpuPowerOptions, candidate.specs.pciePowerConnectors).status === "compatible";
    }
    if (targetCategory === "gpu" && psu?.specs.pciePowerConnectors) {
      return candidate.specs.pciePowerOptions !== undefined
        && pciePowerMatchFor(candidate.specs.pciePowerOptions, psu.specs.pciePowerConnectors).status === "compatible";
    }
  }
  if (finding.ruleId === "gpu-psu-cable-topology" && targetCategory === "psu" && gpu?.specs.pciePowerOptions) {
    const connectorMatch = pciePowerMatchFor(gpu.specs.pciePowerOptions, candidate.specs.pciePowerConnectors);
    if (connectorMatch.status !== "compatible" || connectorMatch.matchedOptionIndex === undefined) return false;
    const requiredEightPinCount = pcieEightPinRequirementCount(gpu.specs.pciePowerOptions[connectorMatch.matchedOptionIndex] ?? []);
    if (requiredEightPinCount === 0) return true;
    return pcieCableTopologyStatusFor(
      gpu.specs.pciePowerOptions,
      connectorMatch,
      candidate.specs.psuIndependentPcieCableRuns,
      candidate.specs.psuPcieCableTopology
    ) === "compatible";
  }
  if (finding.ruleId === "case-hdd-bays" && targetCategory === "case") return candidate.specs.hddBays !== undefined && candidate.specs.hddBays >= hddCount;
  if (finding.ruleId === "case-ssd-bays" && targetCategory === "case") {
    const twoPointFiveInchSsdCount = ssds
      .filter(({ part }) => isTwoPointFiveInchStorage(part))
      .reduce((total, { selection }) => total + selection.quantity, 0);
    return candidate.specs.ssdBays !== undefined && twoPointFiveInchMountCapacity(candidate, hdds) >= twoPointFiveInchSsdCount;
  }
  if (finding.ruleId === "cpu-cooler-socket" && targetCategory === "cooler" && cpu?.specs.socket) return candidate.specs.supportedSockets !== undefined && candidate.specs.supportedSockets.includes(cpu.specs.socket);
  if (finding.ruleId === "case-cooler-height" && targetCategory === "case" && cooler?.specs.maxCoolerHeightMm !== undefined) return candidate.specs.maxCoolerHeightMm !== undefined && candidate.specs.maxCoolerHeightMm >= cooler.specs.maxCoolerHeightMm;
  if (finding.ruleId === "case-cooler-height" && targetCategory === "cooler" && computerCase?.specs.maxCoolerHeightMm !== undefined) return candidate.specs.maxCoolerHeightMm !== undefined && candidate.specs.maxCoolerHeightMm <= computerCase.specs.maxCoolerHeightMm;
  if (finding.ruleId === "gpu-case-length" && targetCategory === "case" && gpu?.specs.lengthMm !== undefined) return candidate.specs.maxGpuLengthMm !== undefined && candidate.specs.maxGpuLengthMm >= gpu.specs.lengthMm;
  if (finding.ruleId === "gpu-case-length" && targetCategory === "gpu" && computerCase?.specs.maxGpuLengthMm !== undefined) return candidate.specs.lengthMm !== undefined && candidate.specs.lengthMm <= computerCase.specs.maxGpuLengthMm;
  if (finding.ruleId === "gpu-case-low-profile" && targetCategory === "gpu") return candidate.specs.lowProfileBracket === true;
  if (finding.ruleId === "gpu-case-low-profile" && targetCategory === "case") return candidate.specs.lowProfileOnly !== true;
  if (finding.ruleId === "psu-case-length" && targetCategory === "case" && psu?.specs.psuDepthMm !== undefined) return candidate.specs.maxPsuLengthMm !== undefined && candidate.specs.maxPsuLengthMm >= psu.specs.psuDepthMm;
  if (finding.ruleId === "psu-case-length" && targetCategory === "psu" && computerCase?.specs.maxPsuLengthMm !== undefined) return candidate.specs.psuDepthMm !== undefined && candidate.specs.psuDepthMm <= computerCase.specs.maxPsuLengthMm;
  if (finding.ruleId === "psu-case-form-factor" && targetCategory === "case" && psu?.specs.psuFormFactor) return candidate.specs.supportedPsuFormFactors !== undefined && candidate.specs.supportedPsuFormFactors.includes(psu.specs.psuFormFactor);
  if (finding.ruleId === "psu-case-form-factor" && targetCategory === "psu" && computerCase?.specs.supportedPsuFormFactors) return candidate.specs.psuFormFactor !== undefined && computerCase.specs.supportedPsuFormFactors.includes(candidate.specs.psuFormFactor);
  if (finding.ruleId === "gpu-psu-power" && targetCategory === "psu" && gpu?.specs.recommendedPsuW !== undefined) return candidate.specs.wattageW !== undefined && candidate.specs.wattageW >= gpu.specs.recommendedPsuW;
  if (finding.ruleId === "psu-system-power" && targetCategory === "psu") {
    const cpuLoadW = cpu?.specs.pptW ?? cpu?.specs.tdpW;
    if (cpuLoadW !== undefined) {
      const estimatedLoadW = PSU_LOAD_HEADROOM_RATIO * (cpuLoadW + SYSTEM_BASE_LOAD_W);
      return candidate.specs.wattageW !== undefined && candidate.specs.wattageW > estimatedLoadW * PSU_LOAD_HEADROOM_RATIO;
    }
  }
  if (finding.ruleId === "gpu-psu-power" && targetCategory === "gpu" && psu?.specs.wattageW !== undefined) return candidate.specs.recommendedPsuW !== undefined && candidate.specs.recommendedPsuW <= psu.specs.wattageW;
  if (finding.ruleId === "case-motherboard-form-factor" && targetCategory === "case" && motherboard?.specs.formFactor) return candidate.specs.motherboardFormFactors !== undefined && candidate.specs.motherboardFormFactors.includes(motherboard.specs.formFactor);
  return true;
}

function efficiencyRank(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized.includes("titanium") || normalized.includes("티타늄")) return 6;
  if (normalized.includes("platinum") || normalized.includes("플래티넘")) return 5;
  if (normalized.includes("gold") || normalized.includes("골드")) return 4;
  if (normalized.includes("silver") || normalized.includes("실버")) return 3;
  if (normalized.includes("bronze") || normalized.includes("브론즈")) return 2;
  return 1;
}

function effectiveMemoryLatencyForPart(part: Part) {
  if (part.category !== "memory") return undefined;
  const speedMhz = part.specs.speedMhz;
  const memoryCasLatency = part.specs.memoryCasLatency;
  if (speedMhz !== undefined && speedMhz > 0 && memoryCasLatency !== undefined) {
    return Number(((memoryCasLatency * 2000) / speedMhz).toFixed(2));
  }
  return part.specs.memoryEffectiveLatencyNs;
}

export function performanceDimensions(part: Part) {
  if (part.category === "cpu") {
    return {
      cinebenchR23Single: part.specs.cinebenchR23Single,
      cinebenchR23Multi: part.specs.cinebenchR23Multi,
      cores: part.specs.cores,
      threads: part.specs.threads,
      boostClockGhz: part.specs.boostClockGhz,
      l3CacheMb: part.specs.l3CacheMb
    };
  }
  if (part.category === "gpu") {
    return {
      gpu3dmarkTimeSpyScore: part.specs.gpu3dmarkTimeSpyScore,
      gpu3dmarkPortRoyalScore: part.specs.gpu3dmarkPortRoyalScore,
      vramGb: part.specs.vramGb,
      gpuMemoryBandwidthGbps: part.specs.gpuMemoryBandwidthGbps,
      gpuStreamProcessors: part.specs.gpuStreamProcessors,
      gpuBoostClockMhz: part.specs.gpuBoostClockMhz
    };
  }
  if (part.category === "memory") {
    const effectiveLatency = effectiveMemoryLatencyForPart(part);
    return {
      capacityGb: part.specs.capacityGb,
      speedMhz: part.specs.speedMhz,
      memoryEffectiveLatencyNs: effectiveLatency,
      memoryCasLatency: effectiveLatency === undefined ? part.specs.memoryCasLatency : undefined,
      memoryRcdLatency: part.specs.memoryRcdLatency,
      memoryTrpLatency: part.specs.memoryTrpLatency,
      memoryTrasLatency: part.specs.memoryTrasLatency
    };
  }
  if (part.category === "ssd") {
    return {
      capacityGb: part.specs.capacityGb,
      m2PcieGeneration: part.specs.m2PcieGeneration,
      sequentialReadMbps: part.specs.sequentialReadMbps,
      sequentialWriteMbps: part.specs.sequentialWriteMbps,
      ssdReadIops: part.specs.ssdReadIops,
      ssdWriteIops: part.specs.ssdWriteIops
    };
  }
  if (part.category === "hdd") {
    return {
      capacityGb: part.specs.capacityGb,
      sequentialReadMbps: part.specs.sequentialReadMbps,
      sequentialWriteMbps: part.specs.sequentialWriteMbps
    };
  }
  if (part.category === "motherboard") {
    return {
      maxMemoryGb: part.specs.maxMemoryGb,
      memorySlots: part.specs.memorySlots,
      m2Slots: part.specs.m2Slots
    };
  }
  if (part.category === "cooler") {
    return {
      maxCoolingW: part.specs.maxCoolingW,
      radiatorSizeMm: part.specs.radiatorSizeMm
    };
  }
  if (part.category === "case") {
    return {
      maxGpuLengthMm: part.specs.maxGpuLengthMm,
      maxCoolerHeightMm: part.specs.maxCoolerHeightMm,
      hddBays: part.specs.hddBays
    };
  }
  return {
    wattageW: part.specs.wattageW,
    efficiency: efficiencyRank(part.specs.efficiency)
  };
}

export function engineNowMilliseconds(now: string | number | undefined) {
  if (now === undefined) return Date.now();
  const milliseconds = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(milliseconds) || !Number.isFinite(new Date(milliseconds).getTime())) {
    throw new Error("Engine clock must be a valid timestamp.");
  }
  return milliseconds;
}

function generatorPerformanceDimensions(part: Part, now: number) {
  const dimensions = performanceDimensions(part);
  if (part.category !== "cpu" && part.category !== "gpu") return dimensions;
  const provenance = part.specs.benchmarkProvenance;
  const benchmarkUpdatedAt = provenance?.updatedAt ? Date.parse(provenance.updatedAt) : Number.NaN;
  const benchmarkAgeMs = Number.isFinite(benchmarkUpdatedAt) ? Math.max(0, now - benchmarkUpdatedAt) : Number.POSITIVE_INFINITY;
  const benchmarkWithinValidityWindow = benchmarkUpdatedAt <= now + 24 * 60 * 60 * 1000
    && benchmarkAgeMs <= 365 * 24 * 60 * 60 * 1000;
  const hasCredibleCurrentSource = (provenance?.sourceKind === "official" || provenance?.sourceKind === "independent_review")
    && Boolean(provenance.sourceUrl?.trim())
    && benchmarkWithinValidityWindow;
  if (hasCredibleCurrentSource) return dimensions;
  if (part.category === "cpu") {
    return { ...dimensions, cinebenchR23Single: undefined, cinebenchR23Multi: undefined };
  }
  return { ...dimensions, gpu3dmarkTimeSpyScore: undefined, gpu3dmarkPortRoyalScore: undefined };
}

function performanceDataCoverageFor(part: Part) {
  return Object.values(performanceDimensions(part)).filter((value): value is number => typeof value === "number" && Number.isFinite(value)).length;
}

type PerformanceReferenceCategory = Extract<PartCategory, "cpu" | "gpu">;

export type SimilarityComparison = {
  part: Part;
  reference?: Part;
  transferredDimensions: string[];
};

const MODEL_FAMILY_TRANSFER_DIMENSIONS: Record<PerformanceReferenceCategory, ReadonlySet<string>> = {
  cpu: new Set([
    "cinebenchR23Single",
    "cinebenchR23Multi",
    "cores",
    "threads"
  ]),
  gpu: new Set([
    "gpu3dmarkTimeSpyScore",
    "gpu3dmarkPortRoyalScore",
    "vramGb",
    "gpuMemoryBandwidthGbps",
    "gpuStreamProcessors"
  ])
};

function isUsablePerformanceValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function gpuModelFamilyFor(part: Pick<Part, "category" | "name" | "model">) {
  if (part.category !== "gpu") return undefined;
  const source = `${part.model ?? ""} ${part.name}`;
  const match = source.match(/\b((?:RTX|GTX|RX)\s*\d{3,4}(?:\s*(?:TI|SUPER|XT|XTX|GRE))?)/i);
  return match?.[1].replace(/\s+/g, "").toUpperCase();
}

export function cpuModelFamilyFor(part: Pick<Part, "category" | "name" | "model">) {
  if (part.category !== "cpu") return undefined;
  const source = `${part.model ?? ""} ${part.name}`;
  const vendor = /(?:AMD|라이젠|RYZEN|애슬론)/i.test(source)
    ? "AMD"
    : /(?:INTEL|인텔|코어|셀러론|펜티엄|프로세서)/i.test(source)
      ? "INTEL"
      : undefined;
  // 다나와에는 i7-14700K뿐 아니라 Core Ultra 7 265K, Pentium G6405,
  // Core2Duo E7500처럼 3자리/문자 접두 모델도 함께 들어온다. 제품명에
  // 세대 표기가 섞여 있어 숫자 토큰 하나를 넓게 잡되, i5/i7 등 등급 접두는
  // 제거해 같은 실제 모델 번호의 판매 변형을 하나의 계열로 정규화한다.
  const match = source.match(/\b(?:I[3579]\s*-\s*\d{3,5}|[A-Z]\d{3,5}|\d{3,5})[A-Z0-9]{0,5}\b/i);
  if (!match?.[0] || !vendor) return undefined;
  const model = match[0].replace(/[\s-]/g, "").toUpperCase().replace(/^I[3579]/, "");
  return `${vendor}:${model}`;
}

function performanceFamilyFor(part: Part) {
  if (part.category === "gpu") {
    const family = gpuModelFamilyFor(part);
    return family ? `GPU:${family}` : undefined;
  }
  if (part.category === "cpu") return cpuModelFamilyFor(part);
  return undefined;
}

function performanceReferenceFor(current: Part | undefined, catalog: Part[]) {
  if (!current || (current.category !== "cpu" && current.category !== "gpu")) return undefined;
  const family = performanceFamilyFor(current);
  if (!family) return undefined;
  const currentDimensions = performanceDimensions(current) as Record<string, unknown>;
  const transferableDimensions = MODEL_FAMILY_TRANSFER_DIMENSIONS[current.category];
  const missingTransferableDimensions = Object.entries(currentDimensions)
    .filter(([key, value]) => transferableDimensions.has(key) && !isUsablePerformanceValue(value))
    .map(([key]) => key);
  if (missingTransferableDimensions.length === 0) return undefined;
  const qualityRank: Record<Part["dataQuality"], number> = { manual: 4, live: 3, seed: 2, incomplete: 1 };
  return catalog
    .filter((part) => {
      if (part.id === current.id || part.category !== current.category || part.dataQuality === "incomplete" || performanceFamilyFor(part) !== family || performanceDataCoverageFor(part) < 2) return false;
      const referenceDimensions = performanceDimensions(part) as Record<string, unknown>;
      return missingTransferableDimensions.some((key) => isUsablePerformanceValue(referenceDimensions[key]));
    })
    .sort((left, right) => qualityRank[right.dataQuality] - qualityRank[left.dataQuality]
      || performanceDataCoverageFor(right) - performanceDataCoverageFor(left)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.name.localeCompare(right.name, "ko-KR"))[0];
}

export function performanceComparisonFor(current: Part | undefined, catalog: Part[]): SimilarityComparison | undefined {
  if (!current) return undefined;
  const reference = performanceReferenceFor(current, catalog);
  if (!reference) return { part: current, transferredDimensions: [] };

  const transferableDimensions = MODEL_FAMILY_TRANSFER_DIMENSIONS[current.category as PerformanceReferenceCategory];
  const currentDimensions = performanceDimensions(current) as Record<string, unknown>;
  const referenceDimensions = performanceDimensions(reference) as Record<string, unknown>;
  const mergedSpecs = { ...current.specs };
  const transferredDimensions: string[] = [];
  for (const [key, currentValue] of Object.entries(currentDimensions)) {
    if (!transferableDimensions.has(key) || isUsablePerformanceValue(currentValue)) continue;
    const referenceValue = referenceDimensions[key];
    if (!isUsablePerformanceValue(referenceValue)) continue;
    (mergedSpecs as Record<string, unknown>)[key] = referenceValue;
    transferredDimensions.push(key);
  }
  if (transferredDimensions.length === 0) return { part: current, transferredDimensions: [] };
  return {
    part: { ...current, specs: mergedSpecs },
    reference,
    transferredDimensions
  };
}

function formatPerformanceDimension(key: string, value: number) {
  if (key === "cinebenchR23Single") return `R23 싱글 ${value.toLocaleString("ko-KR")}`;
  if (key === "cinebenchR23Multi") return `R23 멀티 ${value.toLocaleString("ko-KR")}`;
  if (key === "gpuStreamProcessors") return `스트림 ${value.toLocaleString("ko-KR")}`;
  if (key === "gpuMemoryBandwidthGbps") return `VRAM 대역폭 ${value.toLocaleString("ko-KR")}GB/s`;
  if (key === "gpuBoostClockMhz") return `부스트 ${value.toLocaleString("ko-KR")}MHz`;
  if (key === "gpu3dmarkTimeSpyScore") return `Time Spy ${value.toLocaleString("ko-KR")}`;
  if (key === "gpu3dmarkPortRoyalScore") return `Port Royal ${value.toLocaleString("ko-KR")}`;
  if (key === "cores") return `${value}코어`;
  if (key === "threads") return `${value}스레드`;
  if (key === "boostClockGhz") return `${value}GHz`;
  if (key === "vramGb" || key === "capacityGb" || key === "maxMemoryGb") return `${value}GB`;
  if (key === "speedMhz") return `${value}MHz`;
  if (key === "m2PcieGeneration") return `PCIe ${value.toFixed(1)}`;
  if (key === "memoryEffectiveLatencyNs") return `${value.toFixed(2)}ns`;
  if (key === "memoryCasLatency") return `CL${value}`;
  if (key === "memoryRcdLatency") return `tRCD ${value}`;
  if (key === "memoryTrpLatency") return `tRP ${value}`;
  if (key === "memoryTrasLatency") return `tRAS ${value}`;
  if (key === "sequentialReadMbps" || key === "sequentialWriteMbps") return `${value}MB/s`;
  if (key === "ssdReadIops") return `읽기 IOPS ${formatIops(value)}`;
  if (key === "ssdWriteIops") return `쓰기 IOPS ${formatIops(value)}`;
  if (key === "efficiency") return `80PLUS ${["", "Standard", "Bronze", "Silver", "Gold", "Platinum", "Titanium"][value] ?? "확인 필요"}`;
  if (key === "memorySlots" || key === "m2Slots" || key === "hddBays") return `${value}개`;
  if (key === "radiatorSizeMm") return `${value}mm 라디에이터`;
  if (key === "maxCoolingW") return `${value}W 지원`;
  if (key === "wattageW" || key === "powerW" || key === "recommendedPsuW") return `${value}W`;
  if (key === "maxGpuLengthMm" || key === "maxCoolerHeightMm") return `${value}mm`;
  return String(value);
}

function performanceDimensionLabel(key: string) {
  if (key === "cinebenchR23Single") return "R23 싱글";
  if (key === "cinebenchR23Multi") return "R23 멀티";
  if (key === "gpuStreamProcessors") return "스트림 프로세서";
  if (key === "gpuMemoryBandwidthGbps") return "VRAM 대역폭";
  if (key === "gpuBoostClockMhz") return "GPU 부스트";
  if (key === "gpu3dmarkTimeSpyScore") return "3DMark Time Spy";
  if (key === "gpu3dmarkPortRoyalScore") return "3DMark Port Royal";
  if (key === "cores") return "코어";
  if (key === "threads") return "스레드";
  if (key === "boostClockGhz") return "부스트 클럭";
  if (key === "vramGb") return "VRAM";
  if (key === "capacityGb") return "용량";
  if (key === "speedMhz") return "속도";
  if (key === "m2PcieGeneration") return "M.2 PCIe 세대";
  if (key === "memoryEffectiveLatencyNs") return "실효 CAS 지연";
  if (key === "memoryCasLatency") return "CAS 레이턴시";
  if (key === "memoryRcdLatency") return "tRCD";
  if (key === "memoryTrpLatency") return "tRP";
  if (key === "memoryTrasLatency") return "tRAS";
  if (key === "sequentialReadMbps") return "순차 읽기";
  if (key === "sequentialWriteMbps") return "순차 쓰기";
  if (key === "ssdReadIops") return "읽기 IOPS";
  if (key === "ssdWriteIops") return "쓰기 IOPS";
  if (key === "maxMemoryGb") return "최대 메모리";
  if (key === "memorySlots") return "RAM 슬롯";
  if (key === "m2Slots") return "M.2 슬롯";
  if (key === "maxCoolingW") return "냉각 지원";
  if (key === "radiatorSizeMm") return "라디에이터";
  if (key === "maxGpuLengthMm") return "GPU 허용 길이";
  if (key === "maxCoolerHeightMm") return "쿨러 허용 높이";
  if (key === "hddBays") return "HDD 베이";
  if (key === "wattageW") return "정격 출력";
  if (key === "efficiency") return "효율";
  return key;
}

function formatIops(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  return value.toLocaleString("ko-KR");
}

function performanceDimensionHigherIsBetter(key: string) {
  return !["memoryEffectiveLatencyNs", "memoryCasLatency", "memoryRcdLatency", "memoryTrpLatency", "memoryTrasLatency"].includes(key);
}

function canCompareSimilarityDimension(current: Part, candidate: Part, key: string) {
  if (key !== "gpuStreamProcessors" || current.category !== "gpu" || candidate.category !== "gpu") return true;
  const currentVendor = current.specs.gpuVendor;
  const candidateVendor = candidate.specs.gpuVendor;
  if (currentVendor && candidateVendor && currentVendor !== candidateVendor) return false;
  const currentFamily = current.specs.gpuArchitectureFamily;
  const candidateFamily = candidate.specs.gpuArchitectureFamily;
  return !currentFamily || !candidateFamily || currentFamily === candidateFamily;
}

function gpuSimilarityNote(current: Part, candidate: Part) {
  if (current.category !== "gpu" || candidate.category !== "gpu") return undefined;
  if (current.specs.gpuVendor && candidate.specs.gpuVendor && current.specs.gpuVendor !== candidate.specs.gpuVendor) {
    return "GPU 계열이 달라 스트림 프로세서는 유사도에서 제외했습니다.";
  }
  if (current.specs.gpuArchitectureFamily && candidate.specs.gpuArchitectureFamily && current.specs.gpuArchitectureFamily !== candidate.specs.gpuArchitectureFamily) {
    return `GPU 세대 계열(${current.specs.gpuArchitectureFamily} / ${candidate.specs.gpuArchitectureFamily})이 달라 스트림 프로세서는 유사도에서 제외했습니다.`;
  }
  return undefined;
}

function formatPerformanceEvidenceValue(key: string, value: number) {
  const label = performanceDimensionLabel(key);
  const formatted = formatPerformanceDimension(key, value);
  return formatted.startsWith(`${label} `) ? formatted.slice(label.length + 1) : formatted;
}

const BENCHMARK_DIMENSION_KEYS = OBJECTIVE_BENCHMARK_DIMENSION_KEYS;

export function similarityBasisForDimensions(dimensions: SimilarityDimensionEvidence[]): SimilarityBasis | undefined {
  const hasBenchmark = dimensions.some((dimension) => BENCHMARK_DIMENSION_KEYS.has(dimension.key));
  const hasSpec = dimensions.some((dimension) => !BENCHMARK_DIMENSION_KEYS.has(dimension.key));
  if (hasBenchmark && hasSpec) return "mixed";
  if (hasBenchmark) return "benchmark";
  if (hasSpec) return "spec";
  return undefined;
}

function performanceChangeText(currentValue: number, candidateValue: number) {
  if (candidateValue === currentValue) return "동일";
  if (currentValue === 0) return "변화율 확인 불가";
  const percentage = ((candidateValue - currentValue) / Math.abs(currentValue)) * 100;
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(1)}%`;
}

export function performanceSummaryFor(current: Part | undefined, candidate: Part, comparison?: SimilarityComparison) {
  const comparisonCurrent = comparison?.part ?? current;
  if (!comparisonCurrent) return "기존 부품 없음 / 호환 조건 우선";
  const currentDimensions = performanceDimensions(comparisonCurrent);
  const candidateDimensions = performanceDimensions(candidate);
  const comparisons = Object.entries(currentDimensions)
    .filter(([key, currentValue]) => {
      const candidateValue = candidateDimensions[key as keyof typeof candidateDimensions];
      return typeof currentValue === "number" && typeof candidateValue === "number" && canCompareSimilarityDimension(comparisonCurrent, candidate, key);
    })
    .slice(0, 4)
    .map(([key, currentValue]) => {
      const candidateValue = candidateDimensions[key as keyof typeof candidateDimensions] as number;
      return `${formatPerformanceDimension(key, currentValue as number)} → ${formatPerformanceDimension(key, candidateValue)} (${performanceChangeText(currentValue as number, candidateValue)})`;
    });
  const summary = comparisons.length > 0
    ? comparisons.join(" / ")
    : "비교 가능한 스펙 부족 / 호환 조건 우선";
  const referenceCategoryLabel = comparison?.reference?.category === "gpu" ? "GPU" : "CPU";
  return comparison?.reference ? `동일 ${referenceCategoryLabel} 모델 계열 참조 기준 / ${summary}` : summary;
}

const BASE_PERFORMANCE_DIMENSION_WEIGHTS: Record<string, number> = {
  cinebenchR23Single: 6,
  cinebenchR23Multi: 7,
  cores: 4,
  threads: 3,
  boostClockGhz: 2,
  vramGb: 4,
  gpuStreamProcessors: 5,
  gpuMemoryBandwidthGbps: 4,
  gpuBoostClockMhz: 2,
  gpu3dmarkTimeSpyScore: 7,
  gpu3dmarkPortRoyalScore: 6,
  capacityGb: 4,
  m2PcieGeneration: 1,
  speedMhz: 3,
  memoryEffectiveLatencyNs: 3,
  memoryCasLatency: 2,
  memoryRcdLatency: 1,
  memoryTrpLatency: 1,
  memoryTrasLatency: 1,
  sequentialReadMbps: 3,
  sequentialWriteMbps: 3,
  ssdReadIops: 2,
  ssdWriteIops: 2,
  maxMemoryGb: 2,
  memorySlots: 1,
  m2Slots: 1,
  maxCoolingW: 4,
  radiatorSizeMm: 2,
  maxGpuLengthMm: 2,
  maxCoolerHeightMm: 2,
  hddBays: 1,
  wattageW: 3,
  efficiency: 1
};

function performanceWeightsFor(category: PartCategory, profile: RecommendationProfile, gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION, gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE) {
  const weights: Record<string, number> = {
    ...BASE_PERFORMANCE_DIMENSION_WEIGHTS,
    ...(PROFILE_WEIGHT_OVERRIDES[profile][category] ?? {})
  };
  if (profile === "gaming" && category === "gpu") {
    Object.assign(weights, GPU_RESOLUTION_WEIGHT_OVERRIDES[gamingResolution]);
  }
  if (profile === "gaming") {
    Object.assign(weights, GAMING_REFRESH_RATE_WEIGHT_OVERRIDES[gamingRefreshRate]?.[category] ?? {});
  }
  return weights;
}

export function similarityFor(
  current: Part | undefined,
  candidate: Part,
  profile: RecommendationProfile = "general",
  gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION,
  comparison?: SimilarityComparison,
  gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE
) {
  const comparisonCurrent = comparison?.part ?? current;
  if (!comparisonCurrent) {
    return {
      score: 50,
      label: "대안" as const,
      evidence: { comparedDimensions: 0, totalDimensions: 0, confidence: "unknown" as const, dimensions: [] } satisfies SimilarityEvidence
    };
  }
  const currentDimensions = performanceDimensions(comparisonCurrent);
  const candidateDimensions = performanceDimensions(candidate);
  const weights = performanceWeightsFor(candidate.category, profile, gamingResolution, gamingRefreshRate);
  let weightedScore = 0;
  let totalWeight = 0;
  let comparedDimensions = 0;
  const dimensions: SimilarityDimensionEvidence[] = [];
  const totalDimensions = Object.entries(currentDimensions).filter(([key, value]) => typeof value === "number" && canCompareSimilarityDimension(comparisonCurrent, candidate, key)).length;
  for (const [key, currentValue] of Object.entries(currentDimensions)) {
    const candidateValue = candidateDimensions[key as keyof typeof candidateDimensions];
    if (typeof currentValue !== "number" || typeof candidateValue !== "number" || !canCompareSimilarityDimension(comparisonCurrent, candidate, key)) continue;
    comparedDimensions += 1;
    const scale = key === "efficiency" ? 5 : Math.max(Math.abs(currentValue), Math.abs(candidateValue), 1);
    const score = Math.max(0, 100 - (Math.abs(candidateValue - currentValue) / scale) * 100);
    const weight = weights[key] ?? 1;
    weightedScore += score * weight;
    totalWeight += weight;
    dimensions.push({
      key,
      label: performanceDimensionLabel(key),
      currentValue: formatPerformanceEvidenceValue(key, currentValue),
      candidateValue: formatPerformanceEvidenceValue(key, candidateValue),
      score: Math.round(score),
      weight,
      source: comparison?.transferredDimensions.includes(key) ? "model_reference" : "selected"
    });
  }
  const confidence = totalDimensions === 0 || comparedDimensions === 0
    ? "unknown" as const
    : comparedDimensions === totalDimensions && comparedDimensions >= 2
      ? "high" as const
      : "limited" as const;
  const score = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 50;
  const gpuNote = gpuSimilarityNote(comparisonCurrent, candidate);
  const referenceNote = comparison?.reference
    ? `현재 선택 부품에 없는 ${comparison.transferredDimensions.map((key) => performanceDimensionLabel(key)).join(" / ")}는 동일 ${comparison.reference.category === "gpu" ? "GPU" : "CPU"} 모델 계열의 확인된 카탈로그 참조(${comparison.reference.name})에서 보완했습니다. 선택 부품에 직접 확인된 값은 그대로 사용했습니다.`
    : undefined;
  const notes = [referenceNote, gpuNote].filter((note): note is string => Boolean(note));
  const basis = similarityBasisForDimensions(dimensions);
  const reference = comparison?.reference
    ? {
      partId: comparison.reference.id,
      partName: comparison.reference.name,
      category: comparison.reference.category as PerformanceReferenceCategory,
      dataQuality: comparison.reference.dataQuality,
      updatedAt: comparison.reference.updatedAt,
      transferredDimensions: comparison.transferredDimensions,
      ...(comparison.reference.specs.benchmarkProvenance?.sourceKind ? { benchmarkSourceKind: comparison.reference.specs.benchmarkProvenance.sourceKind } : {}),
      ...(comparison.reference.specs.benchmarkProvenance?.sourceCheck ? { benchmarkSourceCheck: comparison.reference.specs.benchmarkProvenance.sourceCheck } : {})
    }
    : undefined;
  return {
    score,
    label: similarityLabelFor(score, confidence),
    evidence: { comparedDimensions, totalDimensions, confidence, ...(basis ? { basis } : {}), dimensions, ...(reference ? { reference } : {}), ...(notes.length > 0 ? { notes } : {}) } satisfies SimilarityEvidence
  };
}

export type UpgradeAssessment = {
  improvementPercent: number;
  improvedDimensions: string[];
  upgradeScore: number;
};

export type UpgradeRecommendationLimits = {
  maxPerCategory?: number;
  maxTotal?: number;
};

export function upgradeAssessmentFor(current: Part, candidate: Part, profile: RecommendationProfile, gamingResolution: GamingResolution, gamingRefreshRate: GamingRefreshRate): UpgradeAssessment | undefined {
  if (current.category !== candidate.category) return undefined;
  const currentDimensions = performanceDimensions(current);
  const candidateDimensions = performanceDimensions(candidate);
  const weights = performanceWeightsFor(candidate.category, profile, gamingResolution, gamingRefreshRate);
  let weightedImprovement = 0;
  let totalWeight = 0;
  let comparedDimensions = 0;
  const improvedDimensions: string[] = [];
  let materiallyWorse = false;
  for (const [key, currentValue] of Object.entries(currentDimensions)) {
    const candidateValue = candidateDimensions[key as keyof typeof candidateDimensions];
    if (typeof currentValue !== "number" || typeof candidateValue !== "number" || !canCompareSimilarityDimension(current, candidate, key)) continue;
    comparedDimensions += 1;
    const scale = key === "efficiency" ? 5 : Math.max(Math.abs(currentValue), Math.abs(candidateValue), 1);
    const rawDelta = ((candidateValue - currentValue) / scale) * 100;
    const directionalDelta = performanceDimensionHigherIsBetter(key) ? rawDelta : -rawDelta;
    const weight = weights[key] ?? 1;
    weightedImprovement += directionalDelta * weight;
    totalWeight += weight;
    if (directionalDelta >= 1) improvedDimensions.push(performanceDimensionLabel(key));
    if (directionalDelta <= -10) materiallyWorse = true;
  }
  if (comparedDimensions === 0 || improvedDimensions.length === 0 || materiallyWorse || totalWeight === 0) return undefined;
  const improvementPercent = weightedImprovement / totalWeight;
  if (!Number.isFinite(improvementPercent) || improvementPercent < 2) return undefined;
  return {
    improvementPercent: Number(improvementPercent.toFixed(1)),
    improvedDimensions: [...new Set(improvedDimensions)],
    upgradeScore: Math.max(0, Math.min(100, Math.round(40 + improvementPercent * 0.8)))
  };
}

export function upgradeCompatibilityEvidenceFor(category: PartCategory, evaluation: CompatibilityResult): UpgradeCompatibilityEvidence {
  const evidence: UpgradeCompatibilityEvidence = {
    blockerCount: evaluation.blockerCount,
    warningCount: evaluation.warningCount,
    unknownCount: evaluation.unknownCount
  };
  if (category === "cpu") {
    if (evaluation.metrics.powerHeadroomW !== undefined) evidence.powerHeadroomW = evaluation.metrics.powerHeadroomW;
    if (evaluation.metrics.coolerHeadroomW !== undefined) evidence.coolerHeadroomW = evaluation.metrics.coolerHeadroomW;
  }
  if (category === "gpu") {
    if (evaluation.metrics.powerHeadroomW !== undefined) evidence.powerHeadroomW = evaluation.metrics.powerHeadroomW;
    if (evaluation.metrics.gpuClearanceMm !== undefined) evidence.gpuClearanceMm = evaluation.metrics.gpuClearanceMm;
  }
  if (category === "cooler") {
    if (evaluation.metrics.coolerHeadroomW !== undefined) evidence.coolerHeadroomW = evaluation.metrics.coolerHeadroomW;
    if (evaluation.metrics.coolerClearanceMm !== undefined) evidence.coolerClearanceMm = evaluation.metrics.coolerClearanceMm;
  }
  if (category === "case") {
    if (evaluation.metrics.gpuClearanceMm !== undefined) evidence.gpuClearanceMm = evaluation.metrics.gpuClearanceMm;
    if (evaluation.metrics.coolerClearanceMm !== undefined) evidence.coolerClearanceMm = evaluation.metrics.coolerClearanceMm;
    if (evaluation.metrics.hddBayHeadroom !== undefined) evidence.hddBayHeadroom = evaluation.metrics.hddBayHeadroom;
  }
  if (category === "psu") {
    if (evaluation.metrics.powerHeadroomW !== undefined) evidence.powerHeadroomW = evaluation.metrics.powerHeadroomW;
    if (evaluation.metrics.psuClearanceMm !== undefined) evidence.psuClearanceMm = evaluation.metrics.psuClearanceMm;
  }
  if (category === "memory" || category === "motherboard") {
    if (evaluation.metrics.memoryHeadroomGb !== undefined) evidence.memoryHeadroomGb = evaluation.metrics.memoryHeadroomGb;
    if (evaluation.metrics.memorySlotHeadroom !== undefined) evidence.memorySlotHeadroom = evaluation.metrics.memorySlotHeadroom;
  }
  if (category === "motherboard" || category === "ssd") {
    if (evaluation.metrics.m2Headroom !== undefined) evidence.m2Headroom = evaluation.metrics.m2Headroom;
    if (evaluation.metrics.sataHeadroom !== undefined) evidence.sataHeadroom = evaluation.metrics.sataHeadroom;
  }
  if (category === "hdd") {
    if (evaluation.metrics.sataHeadroom !== undefined) evidence.sataHeadroom = evaluation.metrics.sataHeadroom;
    if (evaluation.metrics.hddBayHeadroom !== undefined) evidence.hddBayHeadroom = evaluation.metrics.hddBayHeadroom;
  }
  return evidence;
}

export function upgradeBudgetEvidenceFor(budgetWon: number, baselinePrice: ReturnType<typeof buildPriceInfo>, evaluation: CompatibilityResult): UpgradeBudgetEvidence {
  const priceComplete = baselinePrice.complete && evaluation.priceComplete;
  return {
    budgetWon,
    ...(baselinePrice.complete ? { currentCoreTotalPriceWon: baselinePrice.total } : {}),
    ...(evaluation.priceComplete ? { afterCoreTotalPriceWon: evaluation.totalPriceWon } : {}),
    ...(priceComplete ? {
      budgetDeltaWon: evaluation.totalPriceWon - budgetWon,
      withinBudget: evaluation.totalPriceWon <= budgetWon
    } : {}),
    priceComplete
  };
}

export function upgradeExpansionEvidenceFor(baseline: CompatibilityResult, evaluation: CompatibilityResult): UpgradeExpansionEvidence {
  const baselineExpansion = savedBuildComparisonExpansionFor(baseline.metrics);
  const candidateExpansion = savedBuildComparisonExpansionFor(evaluation.metrics);
  const scoreDelta = baselineExpansion.score !== undefined && candidateExpansion.score !== undefined
    ? candidateExpansion.score - baselineExpansion.score
    : undefined;
  return {
    ...(baselineExpansion.score !== undefined ? { baselineScore: baselineExpansion.score } : {}),
    ...(candidateExpansion.score !== undefined ? { candidateScore: candidateExpansion.score } : {}),
    ...(scoreDelta !== undefined ? { scoreDelta } : {}),
    baselineKnownDimensionCount: baselineExpansion.knownDimensionCount,
    baselineTotalDimensionCount: baselineExpansion.totalDimensionCount,
    candidateKnownDimensionCount: candidateExpansion.knownDimensionCount,
    candidateTotalDimensionCount: candidateExpansion.totalDimensionCount,
    baselineLevel: baselineExpansion.level,
    candidateLevel: candidateExpansion.level,
    baselineSummary: baselineExpansion.summary,
    candidateSummary: candidateExpansion.summary
  };
}

// 한도(limits)는 정렬된 전체 후보에서 범주별/전체 개수만 자른다 — 결과 화면은
// 같은 후보 목록을 두 한도(표시용/조합 탐색용)로 쓰므로 탐색은 한 번만 한다.
export function limitUpgradeRecommendations(ranked: readonly UpgradeRecommendation[], limits: UpgradeRecommendationLimits = {}): UpgradeRecommendation[] {
  const maxPerCategory = Math.max(1, limits.maxPerCategory ?? 2);
  const maxTotal = Math.max(1, limits.maxTotal ?? 8);
  const categoryCounts = new Map<PartCategory, number>();
  return ranked
    .filter((recommendation) => {
      const count = categoryCounts.get(recommendation.category) ?? 0;
      if (count >= maxPerCategory) return false;
      categoryCounts.set(recommendation.category, count + 1);
      return true;
    })
    .slice(0, maxTotal);
}

export function similarityScoreForSort(candidate: { similarityScore: number; similarityEvidence?: SimilarityEvidence }) {
  const evidence = candidate.similarityEvidence;
  if (!evidence || evidence.totalDimensions <= 0 || evidence.comparedDimensions <= 0) return 0;
  return candidate.similarityScore * (evidence.comparedDimensions / evidence.totalDimensions);
}

export function similarityLabelFor(score: number, confidence: SimilarityConfidence = "high"): "동급" | "유사" | "대안" {
  if (confidence === "unknown") return "대안";
  if (confidence === "limited") return score >= 65 ? "유사" : "대안";
  return score >= 85 ? "동급" : score >= 65 ? "유사" : "대안";
}

function valueLabelFor(score: number): ValueLabel {
  if (score >= 115) return "가성비 우수";
  if (score >= 90) return "가성비 균형";
  return "가격 대비 낮음";
}

export function valueForPrices(currentPriceWon: number | undefined, candidatePriceWon: number | undefined, similarityScore: number, similarityEvidence: SimilarityEvidence) {
  if (!isKnownPrice(currentPriceWon) || !isKnownPrice(candidatePriceWon) || similarityEvidence.comparedDimensions === 0) return undefined;
  const priceChangePercent = ((candidatePriceWon - currentPriceWon) / currentPriceWon) * 100;
  const comparableSimilarityScore = similarityScoreForSort({ similarityScore, similarityEvidence });
  const valueScore = Math.round(Math.max(0, Math.min(VALUE_SCORE_MAX, comparableSimilarityScore * (currentPriceWon / candidatePriceWon))));
  const valueLabel = valueLabelFor(valueScore);
  const valueEvidence: ValueEvidence = {
    scoreScale: VALUE_SCORE_MAX,
    currentPriceWon,
    candidatePriceWon,
    priceDeltaWon: candidatePriceWon - currentPriceWon,
    priceChangePercent: Number(priceChangePercent.toFixed(1)),
    similarityScore: comparableSimilarityScore
  };
  return { valueScore, valueLabel, valueEvidence };
}

export const GENERATOR_CATEGORY_WEIGHTS: Record<RecommendationProfile, Partial<Record<PartCategory, number>>> = {
  general: { cpu: 3, gpu: 4, motherboard: 2, memory: 2, ssd: 2, cooler: 1, case: 1, psu: 1 },
  gaming: { cpu: 4, gpu: 7, motherboard: 1, memory: 3, ssd: 1, cooler: 1, case: 1, psu: 1 },
  creator: { cpu: 5, gpu: 4, motherboard: 1, memory: 5, ssd: 3, cooler: 1, case: 1, psu: 1 },
  development: { cpu: 4, gpu: 4, motherboard: 1, memory: 5, ssd: 3, cooler: 1, case: 1, psu: 1 },
  office: { cpu: 3, gpu: 1, motherboard: 2, memory: 3, ssd: 3, cooler: 1, case: 1, psu: 1 }
};

// CUDA/NVENC 생태계가 실질 표준인 작업(영상/3D/스트리밍, GPU를 단 개발)과
// 레이 트레이싱을 명시한 게이밍 요청은 NVIDIA를 우선한다. 측정값이 아니라
// 작업부하 정책이다 — 해당 벤더 후보가 있으면 풀을 그 벤더로 좁히고
// 점수 항으로도 한 번 더 반영한다. 후보가 없으면 전체 풀을 유지한다.
const GPU_VENDOR_PREFERENCE_WEIGHT = 4;

// 게이밍 CPU 포화점 — 이 값을 넘는 싱글/멀티/코어 지표는 게임 체감에 거의
// 기여하지 않는다(GPU 바운드). 9800X3D급(싱글 ~2250, 멀티 ~24000, 8코어,
// 부스트 ~5.3GHz)을 상단으로 둬 실제 상점 라인업의 CPU 대역과 맞춘다.
const GAMING_CPU_SINGLE_SATURATION = 2_250;
const GAMING_CPU_MULTI_SATURATION = 24_000;
const GAMING_CPU_SATURATION_DIMS: Record<string, number> = {
  cinebenchR23Single: GAMING_CPU_SINGLE_SATURATION,
  cinebenchR23Multi: GAMING_CPU_MULTI_SATURATION,
  cores: 8,
  threads: 16,
  boostClockGhz: 5.3
};

function gpuVendorFitIndex(part: Part, preferred: GpuVendor) {
  const vendor = part.specs.gpuVendor;
  if (vendor === undefined) return 55;
  return vendor === preferred ? 100 : 45;
}

export function generatorObjectiveScores(parts: Part[], profile: RecommendationProfile, gamingResolution: GamingResolution = DEFAULT_GAMING_RESOLUTION, gamingRefreshRate: GamingRefreshRate = DEFAULT_GAMING_REFRESH_RATE, gamingAdvisoryTuning?: GamingAdvisoryTuning, gpuVendorPreference?: GpuVendor, nowMilliseconds = Date.now()) {
  const scores = new Map<string, ObjectiveScore>();
  for (const part of parts) {
    const weights = performanceWeightsFor(part.category, profile, gamingResolution, gamingRefreshRate);
    const extras: ObjectiveScoreExtraTerm[] = [];
    if (profile === "gaming" && part.category === "gpu") {
      extras.push({
        index: gpuTargetScoreFor(part, gamingResolution, gamingAdvisoryTuning?.targetVramGb) ?? 50,
        weight: gamingAdvisoryTuning?.gpuTargetWeight ?? 5
      });
    }
    if (part.category === "gpu" && gpuVendorPreference !== undefined) {
      extras.push({ index: gpuVendorFitIndex(part, gpuVendorPreference), weight: GPU_VENDOR_PREFERENCE_WEIGHT });
    }
    const dims = generatorPerformanceDimensions(part, nowMilliseconds);
    // 상대 지수 함수는 출처 검증된 벤치마크만 쓰게 dims로 덮어쓴다 — 검증 없는
    // 스펙 값(cinebench/3DMark)이 제멋대로 큰 픽스처/오류 데이터를 그대로
    // 통과시키는 걸 막는다.
    const benchmarkFilteredPart = {
      ...part,
      specs: {
        ...part.specs,
        cinebenchR23Single: dims.cinebenchR23Single,
        cinebenchR23Multi: dims.cinebenchR23Multi,
        gpu3dmarkTimeSpyScore: dims.gpu3dmarkTimeSpyScore,
        gpu3dmarkPortRoyalScore: dims.gpu3dmarkPortRoyalScore
      }
    };
    // CUDA 코어 수/대역폭 같은 스펙 프록시는 세대 간 성능 비교가 안 돼
    // 구형 고스펙 카드(RTX 2060 12GB)가 현세대 보급형보다 높게 매겨진다.
    // 모델별 상대 게임 지수 테이블을 한 항목으로 넣어 실측 성능 순서를 반영한다.
    const gpuGamingIndex = part.category === "gpu" ? gpuGamingIndexFor(benchmarkFilteredPart) : undefined;
    if (gpuGamingIndex !== undefined) {
      extras.push({
        index: gpuGamingIndex,
        weight: profile === "gaming" ? 10 : profile === "creator" ? 4 : profile === "development" ? 3 : 2
      });
    }
    // CPU도 벤치 실측이 없는 라이브 부품이 대부분이라 모델별 싱글/멀티 지수를
    // 보강한다 — 부스트 클럭만으로는 세대 간 IPC 차이가 사라진다.
    const cpuRelative = part.category === "cpu" ? cpuRelativeIndexFor(benchmarkFilteredPart) : undefined;
    if (cpuRelative) {
      extras.push({ index: ((profile === "gaming" ? Math.min(cpuRelative.single, GAMING_CPU_SINGLE_SATURATION) : cpuRelative.single) / CPU_SINGLE_REFERENCE) * 100, weight: profile === "gaming" ? 4 : 2 });
      extras.push({ index: (profile === "gaming" ? Math.min(cpuRelative.multi, GAMING_CPU_MULTI_SATURATION) : cpuRelative.multi) / CPU_MULTI_REFERENCE * 100, weight: profile === "creator" || profile === "development" ? 5 : 1 });
    }
    // 게임은 대부분 GPU 바운드라 i9/Ultra9급 CPU가 예산을 삼켜도 프레임이
    // 안 오른다 — 상점 조립PC가 CPU를 미드~X3D 대역에 플랫하게 묶는 이유다.
    // 게이밍 프로필은 X3D급(싱글 2250/멀티 24000/8코어) 위로 포화시키고,
    // 게임 체감의 실제 분기점인 L3 캐시는 포화하지 않는다.
    if (profile === "gaming" && part.category === "cpu") {
      for (const [key, cap] of Object.entries(GAMING_CPU_SATURATION_DIMS)) {
        const value = dims[key as keyof typeof dims];
        if (typeof value === "number") (dims as Record<string, number | undefined>)[key] = Math.min(value, cap);
      }
    }
    scores.set(part.id, objectiveScoreForDimensions(part.category, dims, weights, extras));
  }
  return scores;
}
